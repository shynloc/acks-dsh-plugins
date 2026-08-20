/**
 * dsh-areas — host plugin.
 *
 * The single authority for an Area: an ongoing responsibility rather than a
 * piece of work with an end. It therefore carries a review cadence and a
 * paused/active status, and deliberately no due date, completion state or
 * copied task list — work that ends belongs to a Project.
 *
 * One bounded, same-origin JSON API over one revisioned DSH JSON storage unit.
 * Every mutation carries an expected revision, so a stale write is refused
 * rather than silently overwriting a newer one; the compare and the write share
 * one serialized operation. Other domains store an area id, never a copy.
 *
 * Defensive posture mirrors the reviewed dsh-notebook, dsh-agenda and
 * dsh-bookmarks hosts, including the corrections their audits produced.
 */

import { randomUUID } from "node:crypto";

const name = "dsh-areas";
const inject = ["webServer", "storage"];

const PREFIX = "/api/areas";
const UNIT_NAME = "areas";
const UNIT_VERSION = 1;
const SCHEMA_VERSION = 1;
const TABLES = ["areas"];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_BODY_BYTES = 128 * 1024;
const MAX_AREAS = 2_000;
const MAX_NAME_CODE_POINTS = 120;
const MAX_PURPOSE_CODE_POINTS = 4_000;
const MAX_TAGS = 20;
const MAX_TAG_CODE_POINTS = 40;

const STATUSES = new Set(["active", "paused"]);
const REVIEW_CADENCES = new Set(["none", "weekly", "monthly", "quarterly"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const PURPOSE_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

const EDITABLE_FIELDS = ["name", "purpose", "status", "reviewCadence", "tags"];
const SERVER_OWNED_FIELDS = ["id", "lifecycle", "revision", "createdAt", "updatedAt", "archivedAt"];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Same-origin check, matching the audited guard used across the other hosts.
 * Sec-Fetch-Site is authoritative when the browser sends it ("none" covers a
 * user-typed URL); otherwise a missing Origin is a non-browser or same-origin
 * caller, and a present Origin must agree with Host.
 */
/**
 * The origin this request was actually addressed to, as scheme and host.
 *
 * The `Host` header carries no scheme, so comparing against it alone treats
 * `http://app.example` and `https://app.example` as the same origin — which
 * is exactly the pair an attacker wants, since a page served over plain HTTP
 * could then drive writes into the HTTPS app.
 *
 * The scheme comes from `X-Forwarded-Proto` where a reverse proxy sets it,
 * and from the socket otherwise. A browser cannot forge that header: it is
 * not CORS-safelisted, so a cross-origin fetch carrying it would have to be
 * preflighted, and no preflight is ever answered here. Non-browser clients
 * can set anything, but CSRF is a browser attack — a client that can set
 * arbitrary headers can set `Origin` too, and needs no help from us.
 */
function requestOrigin(req) {
  const headers = req.headers || {};
  const forwardedHost = String(headers["x-forwarded-host"] || "").split(",", 1)[0].trim();
  const host = (forwardedHost || String(headers.host || "")).trim().toLowerCase();
  if (host === "") return null;
  const forwardedProto = String(headers["x-forwarded-proto"] || "").split(",", 1)[0].trim().toLowerCase();
  const scheme = forwardedProto || (req.socket && req.socket.encrypted ? "https" : "http");
  if (scheme !== "http" && scheme !== "https") return null;
  return scheme + "://" + withoutDefaultPort(scheme, host);
}

/** `https://a.example:443` and `https://a.example` are the same origin. */
function withoutDefaultPort(scheme, host) {
  const suffix = scheme === "https" ? ":443" : ":80";
  return host.endsWith(suffix) ? host.slice(0, -suffix.length) : host;
}

function isSameOrigin(req) {
  // Sec-Fetch-Site is the browser's own account of where the request came
  // from, and it cannot be set by script, so it stays authoritative.
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string") return site === "same-origin" || site === "none";
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const expected = requestOrigin(req);
  if (expected === null) return false;
  let parsed;
  try {
    parsed = new URL(String(origin));
  } catch {
    return false;
  }
  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") return false;
  return scheme + "://" + withoutDefaultPort(scheme, parsed.host.toLowerCase()) === expected;
}

function send(res, status, body) {
  if (res.headersSent || res.writableEnded) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  res.end(payload);
}

function ok(res, body = {}) {
  send(res, 200, { ok: true, ...body });
}

function fail(res, status, error) {
  send(res, status, { ok: false, error });
}

function requireObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "JSON body must be an object");
  }
  return value;
}

function decodeId(fragment) {
  let id;
  try {
    id = decodeURIComponent(fragment);
  } catch {
    throw new HttpError(400, "invalid id encoding");
  }
  if (!UUID_PATTERN.test(id)) throw new HttpError(400, "invalid id");
  return id;
}

/**
 * Control characters are checked on the exact caller string, before trimming.
 * Trimming first would silently accept a leading newline or trailing tab, which
 * is the defect the Bookmarks audit found.
 */
function boundedText(value, field, maxCodePoints) {
  if (typeof value !== "string") throw new HttpError(400, `${field} must be a string`);
  if (CONTROL_PATTERN.test(value)) throw new HttpError(400, `${field} contains control characters`);
  const trimmed = value.trim();
  // Code points, not UTF-16 units, so CJK and astral symbols agree with the UI.
  const length = [...trimmed].length;
  if (length === 0) throw new HttpError(400, `${field} must be non-empty`);
  if (length > maxCodePoints) throw new HttpError(400, `${field} is too long`);
  return trimmed;
}

function readPurpose(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new HttpError(400, "purpose must be a string");
  // A purpose may span lines, so tab, carriage return and newline are the
  // only control characters allowed through.
  if (PURPOSE_CONTROL_PATTERN.test(value)) {
    throw new HttpError(400, "purpose contains control characters");
  }
  if ([...value].length > MAX_PURPOSE_CODE_POINTS) throw new HttpError(400, "purpose is too long");
  return value;
}

function readTags(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "tags must be an array");
  const seen = new Set();
  const tags = [];
  for (const entry of value) {
    const tag = boundedText(entry, "tag", MAX_TAG_CODE_POINTS);
    // De-duplicate but keep the order the caller supplied.
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  if (tags.length > MAX_TAGS) throw new HttpError(400, `at most ${MAX_TAGS} tags are allowed`);
  return tags;
}

function readStatus(value) {
  if (value === null || value === undefined) return "active";
  if (typeof value !== "string" || !STATUSES.has(value)) {
    throw new HttpError(400, "status must be active or paused");
  }
  return value;
}

function readReviewCadence(value) {
  if (value === null || value === undefined) return "none";
  if (typeof value !== "string" || !REVIEW_CADENCES.has(value)) {
    throw new HttpError(400, "reviewCadence must be none, weekly, monthly or quarterly");
  }
  return value;
}

function readExpectedRevision(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new HttpError(400, "expectedRevision must be an integer of at least 1");
  }
  return value;
}

function assertRevisionMatches(record, expectedRevision) {
  if (record.revision !== expectedRevision) {
    throw new HttpError(409, "the area changed since it was loaded");
  }
}

function rejectServerOwnedFields(body) {
  for (const field of SERVER_OWNED_FIELDS) {
    if (body[field] !== undefined) {
      throw new HttpError(400, `${field} is assigned by the server`);
    }
  }
}

function rejectUnknownFields(body, allowed) {
  for (const field of Object.keys(body)) {
    if (!allowed.includes(field)) throw new HttpError(400, `${field} is not editable`);
  }
}

function readBody(req) {
  const mediaType = String(req.headers?.["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    req.resume?.();
    return Promise.reject(new HttpError(415, "content-type must be application/json"));
  }

  const declared = Number(req.headers?.["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    req.resume?.();
    return Promise.reject(new HttpError(413, "request body is too large"));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const cleanup = () => {
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("aborted", onAborted);
    };
    const rejectOnce = (error, drain = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (drain) req.resume?.();
      reject(error);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejectOnce(new HttpError(413, "request body is too large"), true);
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(requireObject(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
      } catch (error) {
        reject(error instanceof HttpError ? error : new HttpError(400, "invalid JSON body"));
      }
    };
    const onError = () => rejectOnce(new HttpError(400, "failed to read request body"));
    const onAborted = () => rejectOnce(new HttpError(400, "request body was aborted"));

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
  });
}

function presentArea(record) {
  return {
    id: record.id,
    name: record.name,
    purpose: record.purpose,
    status: record.status,
    reviewCadence: record.reviewCadence,
    tags: [...record.tags],
    lifecycle: record.lifecycle,
    revision: record.revision,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    archivedAt: record.archivedAt,
  };
}

function apply(ctx) {
  let unitPromise = null;

  function unit() {
    if (unitPromise === null) {
      unitPromise = Promise.resolve(ctx.storage.backend.get("json").kv.open({
        name: UNIT_NAME,
        version: UNIT_VERSION,
        tables: TABLES,
        hasGlobal: false,
      }));
    }
    return unitPromise;
  }

  ctx.effect(() => () => {
    const pending = unitPromise;
    unitPromise = null;
    if (pending) {
      Promise.resolve(pending)
        .then((value) => value.close?.())
        .catch(() => {});
    }
  }, "dsh-areas: storage lifecycle");

  // One promise chain serializes every mutation. Because the revision compare
  // happens inside the serialized operation, two concurrent edits cannot both
  // observe the same revision and both win. The tail keeps a caught
  // continuation so a rejected operation cannot poison later writes, while the
  // caller still receives the original rejection.
  let queue = Promise.resolve();
  function serialize(operation) {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function loadAreas() {
    const store = await unit();
    const snapshot = await store.loadAll();
    return snapshot?.tables?.areas ?? {};
  }

  async function writeArea(record) {
    const store = await unit();
    await store.putRecord("areas", record.id, record);
    return record;
  }

  /**
   * The authoritative answer to one question other domains may ask: does this
   * Area id exist?
   *
   * Deliberately minimal. Exposing a getter or a list would let another domain
   * copy an Area object, which is exactly what the reference contract forbids
   * — a domain owns only its own nullable areaId.
   *
   * An archived area still exists: this plugin has no delete route, so an
   * accepted reference stays valid for the life of the record and archiving
   * never cascades into a task or bookmark.
   */
  const areaReferences = Object.freeze({
    async exists(id) {
      if (typeof id !== "string" || !UUID_PATTERN.test(id)) return false;
      const areas = await loadAreas();
      return Object.prototype.hasOwnProperty.call(areas, id);
    },
  });
  ctx.reflect.provide("acksAreas", areaReferences);

  async function requireArea(id) {
    const areas = await loadAreas();
    const record = areas[id];
    if (!record) throw new HttpError(404, "area not found");
    return record;
  }

  async function createArea(body) {
    rejectServerOwnedFields(body);
    rejectUnknownFields(body, EDITABLE_FIELDS);

    const areas = await loadAreas();
    if (Object.keys(areas).length >= MAX_AREAS) {
      throw new HttpError(409, `area limit of ${MAX_AREAS} reached`);
    }

    const now = Date.now();
    return writeArea({
      id: randomUUID(),
      name: boundedText(body.name, "name", MAX_NAME_CODE_POINTS),
      purpose: readPurpose(body.purpose),
      status: readStatus(body.status),
      reviewCadence: readReviewCadence(body.reviewCadence),
      tags: readTags(body.tags),
      lifecycle: "active",
      revision: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
  }

  async function editArea(id, body) {
    rejectServerOwnedFields(body);
    rejectUnknownFields(body, EDITABLE_FIELDS.concat(["expectedRevision"]));
    const expectedRevision = readExpectedRevision(body.expectedRevision);

    const supplied = EDITABLE_FIELDS.filter((field) => body[field] !== undefined);
    if (supplied.length === 0) {
      throw new HttpError(400, "at least one editable field is required");
    }

    const record = await requireArea(id);
    assertRevisionMatches(record, expectedRevision);

    const next = { ...record, tags: [...record.tags] };
    if (body.name !== undefined) next.name = boundedText(body.name, "name", MAX_NAME_CODE_POINTS);
    if (body.purpose !== undefined) next.purpose = readPurpose(body.purpose);
    if (body.status !== undefined) next.status = readStatus(body.status);
    if (body.reviewCadence !== undefined) next.reviewCadence = readReviewCadence(body.reviewCadence);
    if (body.tags !== undefined) next.tags = readTags(body.tags);

    // Lifecycle is never changed by an edit.
    next.lifecycle = record.lifecycle;
    next.revision = record.revision + 1;
    next.updatedAt = Date.now();
    return writeArea(next);
  }

  async function transition(id, action, body) {
    // A lifecycle body carries exactly one field. Accepting and ignoring
    // anything else is what the previous audit rejected.
    rejectServerOwnedFields(body);
    rejectUnknownFields(body, ["expectedRevision"]);
    const expectedRevision = readExpectedRevision(body.expectedRevision);

    const record = await requireArea(id);
    assertRevisionMatches(record, expectedRevision);

    const next = { ...record, tags: [...record.tags] };
    if (action === "archive") {
      if (record.lifecycle !== "active") throw new HttpError(409, "area is already archived");
      next.lifecycle = "archived";
      next.archivedAt = Date.now();
    } else if (action === "restore") {
      if (record.lifecycle !== "archived") throw new HttpError(409, "only an archived area can be restored");
      next.lifecycle = "active";
      next.archivedAt = null;
    } else {
      throw new HttpError(404, "unknown action");
    }

    // Status is independent of the archive lifecycle and is preserved.
    next.status = record.status;
    next.revision = record.revision + 1;
    next.updatedAt = Date.now();
    return writeArea(next);
  }

  async function route(method, sub, req, res) {
    if (sub === "/state") {
      if (method !== "GET") throw new HttpError(405, "method not allowed");
      const areas = await loadAreas();
      ok(res, {
        schemaVersion: SCHEMA_VERSION,
        areas: Object.values(areas)
          .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
          .map(presentArea),
      });
      return;
    }

    if (sub === "/areas") {
      if (method !== "POST") throw new HttpError(405, "method not allowed");
      const body = await readBody(req);
      const record = await serialize(() => createArea(body));
      ok(res, { area: presentArea(record) });
      return;
    }

    const detail = /^\/areas\/([^/]+)$/u.exec(sub);
    if (detail) {
      if (method !== "PATCH") throw new HttpError(405, "method not allowed");
      const id = decodeId(detail[1]);
      const body = await readBody(req);
      const record = await serialize(() => editArea(id, body));
      ok(res, { area: presentArea(record) });
      return;
    }

    const action = /^\/areas\/([^/]+)\/(archive|restore)$/u.exec(sub);
    if (action) {
      if (method !== "POST") throw new HttpError(405, "method not allowed");
      const id = decodeId(action[1]);
      const body = await readBody(req);
      const record = await serialize(() => transition(id, action[2], body));
      ok(res, { area: presentArea(record) });
      return;
    }

    throw new HttpError(404, "not found");
  }

  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: PREFIX,
    async handler(req, res) {
      try {
        const method = String(req.method ?? "GET").toUpperCase();
        // Reject a cross-origin mutation before parsing or routing, so an
        // untrusted caller never reaches body validation or storage.
        if (MUTATING_METHODS.has(method) && !isSameOrigin(req)) {
          throw new HttpError(403, "cross-origin request rejected");
        }
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        let sub = pathname.slice(PREFIX.length) || "/";
        if (sub.length > 1 && sub.endsWith("/")) sub = sub.slice(0, -1);
        await route(method, sub, req, res);
      } catch (error) {
        if (error instanceof HttpError) {
          fail(res, error.status, error.message);
          return;
        }
        ctx.logger?.warn?.(`dsh-areas: request failed: ${error?.stack ?? error}`);
        fail(res, 500, "internal server error");
      }
    },
  }), "dsh-areas: api");
}

export { apply, inject, name };
