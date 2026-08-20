/**
 * dsh-projects — host plugin.
 *
 * The single authority for the Project record: its id, phase, dates, lifecycle
 * and revision. One bounded, same-origin JSON API over one revisioned DSH JSON
 * storage unit.
 *
 * Every mutation carries an expected revision, so a stale write is refused
 * rather than silently overwriting a newer one. The compare and the write share
 * one serialized operation, which is what makes two concurrent edits resolve
 * deterministically. Other domains may later store a reference to a project id;
 * they must never copy the Project object.
 *
 * Defensive posture mirrors the reviewed dsh-notebook, dsh-agenda and
 * dsh-bookmarks hosts, including the corrections their audits produced.
 */

import { randomUUID } from "node:crypto";

const name = "dsh-projects";
const inject = ["webServer", "storage"];

const PREFIX = "/api/projects";
const UNIT_NAME = "projects";
const UNIT_VERSION = 1;
const SCHEMA_VERSION = 1;
const TABLES = ["projects"];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_BODY_BYTES = 128 * 1024;
const MAX_PROJECTS = 2_000;
const MAX_TITLE_CODE_POINTS = 200;
const MAX_OBJECTIVE_CHARS = 20_000;
const MAX_TAGS = 20;
const MAX_TAG_CODE_POINTS = 40;

const PHASES = new Set(["planned", "active", "on_hold", "completed"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;

const EDITABLE_FIELDS = ["title", "objective", "phase", "startDate", "endDate", "tags", "areaId"];
// A canonical reference is lowercase: the Areas authority stores lowercase
// keys, so accepting another casing would let two spellings name one Area.
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
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

function readObjective(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new HttpError(400, "objective must be a string");
  if (value.length > MAX_OBJECTIVE_CHARS) throw new HttpError(400, "objective is too long");
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

function readPhase(value) {
  if (value === null || value === undefined) return "planned";
  if (typeof value !== "string" || !PHASES.has(value)) {
    throw new HttpError(400, "phase must be planned, active, on_hold or completed");
  }
  return value;
}

/** Validates a real proleptic-Gregorian date, so 2026-02-29 is rejected. */
function readDate(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new HttpError(400, `${field} must be a string`);
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new HttpError(400, `${field} must be YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) throw new HttpError(400, `${field} is not a real date`);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > daysInMonth) throw new HttpError(400, `${field} is not a real date`);
  return value;
}

function assertDateOrder(startDate, endDate) {
  // Both are zero-padded YYYY-MM-DD, so a lexical comparison is a date
  // comparison and needs no time zone.
  if (startDate !== null && endDate !== null && endDate < startDate) {
    throw new HttpError(400, "endDate must not precede startDate");
  }
}

/**
 * Validates a nullable reference to an Area owned by dsh-areas.
 *
 * The project owns only this id. No Area name, purpose or revision is copied
 * in, so an Area rename never has to propagate and the two records cannot
 * disagree.
 *
 * acksAreas is an optional capability rather than a required injection, so a
 * standalone Projects stays usable for unlinked work. While it is missing, a
 * non-null link is refused with 503 instead of stored as a dangling reference;
 * clearing a link needs no authority.
 */
/**
 * Resolves an optional cross-domain capability.
 *
 * `ctx.reflect.get(name)` is deliberate. A bare `ctx.<service>` read throws
 * `cannot get property "..." without inject` in real Cordis, and adding the
 * name to `inject` is not the alternative: Cordis treats every injected name as
 * required and would leave this plugin inactive whenever the other domain is
 * absent. `reflect.get` returns the service when its providing fiber is active
 * and `undefined` otherwise, which is exactly the optional-capability contract
 * — unlinked work keeps running, and a requested non-null link is refused with
 * 503 rather than stored as a dangling reference.
 */
async function readAreaId(value, service) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !CANONICAL_UUID_PATTERN.test(value)) {
    throw new HttpError(400, "areaId must be a canonical UUID or null");
  }
  if (!service || typeof service.exists !== "function") {
    throw new HttpError(503, "Areas service is unavailable");
  }
  if (!(await service.exists(value))) {
    throw new HttpError(400, "areaId does not reference an Area");
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
    throw new HttpError(409, "the project changed since it was loaded");
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

function presentProject(record) {
  return {
    id: record.id,
    title: record.title,
    objective: record.objective,
    phase: record.phase,
    startDate: record.startDate,
    endDate: record.endDate,
    tags: [...record.tags],
    // An absent property is a record written before area references existed.
    areaId: record.areaId ?? null,
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
  }, "dsh-projects: storage lifecycle");

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

  async function loadProjects() {
    const store = await unit();
    const snapshot = await store.loadAll();
    return snapshot?.tables?.projects ?? {};
  }

  async function writeProject(record) {
    const store = await unit();
    await store.putRecord("projects", record.id, record);
    return record;
  }

  /**
   * The authoritative answer to one question other domains may ask: does this
   * Project id exist?
   *
   * Deliberately minimal. Exposing a getter or a list would let another domain
   * copy a Project object, which is exactly what the reference contract forbids
   * — a domain owns only its own nullable projectId.
   *
   * An archived project still exists: Projects has no delete route, so an
   * accepted reference stays valid for the life of the record and archiving
   * never cascades into a task or bookmark.
   */
  const projectReferences = Object.freeze({
    async exists(id) {
      if (typeof id !== "string" || !UUID_PATTERN.test(id)) return false;
      const projects = await loadProjects();
      return Object.prototype.hasOwnProperty.call(projects, id);
    },
  });
  ctx.reflect.provide("acksProjects", projectReferences);

  async function requireProject(id) {
    const projects = await loadProjects();
    const record = projects[id];
    if (!record) throw new HttpError(404, "project not found");
    return record;
  }

  async function createProject(body) {
    rejectServerOwnedFields(body);
    rejectUnknownFields(body, EDITABLE_FIELDS);

    const startDate = readDate(body.startDate, "startDate");
    const endDate = readDate(body.endDate, "endDate");
    assertDateOrder(startDate, endDate);
    const areaId = await readAreaId(body.areaId, ctx.reflect.get("acksAreas"));

    const projects = await loadProjects();
    if (Object.keys(projects).length >= MAX_PROJECTS) {
      throw new HttpError(409, `project limit of ${MAX_PROJECTS} reached`);
    }

    const now = Date.now();
    return writeProject({
      id: randomUUID(),
      title: boundedText(body.title, "title", MAX_TITLE_CODE_POINTS),
      objective: readObjective(body.objective),
      phase: readPhase(body.phase),
      startDate,
      endDate,
      tags: readTags(body.tags),
      areaId,
      lifecycle: "active",
      revision: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
  }

  async function editProject(id, body) {
    rejectServerOwnedFields(body);
    rejectUnknownFields(body, EDITABLE_FIELDS.concat(["expectedRevision"]));
    const expectedRevision = readExpectedRevision(body.expectedRevision);

    const supplied = EDITABLE_FIELDS.filter((field) => body[field] !== undefined);
    if (supplied.length === 0) {
      throw new HttpError(400, "at least one editable field is required");
    }

    const record = await requireProject(id);
    assertRevisionMatches(record, expectedRevision);

    const next = { ...record, tags: [...record.tags] };
    if (body.title !== undefined) next.title = boundedText(body.title, "title", MAX_TITLE_CODE_POINTS);
    if (body.objective !== undefined) next.objective = readObjective(body.objective);
    if (body.phase !== undefined) next.phase = readPhase(body.phase);
    if (body.tags !== undefined) next.tags = readTags(body.tags);
    if (body.startDate !== undefined) next.startDate = readDate(body.startDate, "startDate");
    if (body.endDate !== undefined) next.endDate = readDate(body.endDate, "endDate");
    assertDateOrder(next.startDate, next.endDate);
    // Validated only when supplied, so an unrelated edit never needs the
    // authority and never invents a reference on a legacy record.
    if (body.areaId !== undefined) next.areaId = await readAreaId(body.areaId, ctx.reflect.get("acksAreas"));
    else next.areaId = record.areaId ?? null;

    // Lifecycle is never changed by an edit.
    next.lifecycle = record.lifecycle;
    next.revision = record.revision + 1;
    next.updatedAt = Date.now();
    return writeProject(next);
  }

  async function transition(id, action, body) {
    // A lifecycle body carries exactly one field. Accepting and ignoring
    // anything else is what the previous audit rejected.
    rejectServerOwnedFields(body);
    rejectUnknownFields(body, ["expectedRevision"]);
    const expectedRevision = readExpectedRevision(body.expectedRevision);

    const record = await requireProject(id);
    assertRevisionMatches(record, expectedRevision);

    const next = { ...record, tags: [...record.tags] };
    if (action === "archive") {
      if (record.lifecycle !== "active") throw new HttpError(409, "project is already archived");
      next.lifecycle = "archived";
      next.archivedAt = Date.now();
    } else if (action === "restore") {
      if (record.lifecycle !== "archived") throw new HttpError(409, "only an archived project can be restored");
      next.lifecycle = "active";
      next.archivedAt = null;
    } else {
      throw new HttpError(404, "unknown action");
    }

    // Phase and the area reference are independent of the archive lifecycle
    // and are preserved.
    next.phase = record.phase;
    next.areaId = record.areaId ?? null;
    next.revision = record.revision + 1;
    next.updatedAt = Date.now();
    return writeProject(next);
  }

  async function route(method, sub, req, res) {
    if (sub === "/state") {
      if (method !== "GET") throw new HttpError(405, "method not allowed");
      const projects = await loadProjects();
      ok(res, {
        schemaVersion: SCHEMA_VERSION,
        projects: Object.values(projects)
          .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
          .map(presentProject),
      });
      return;
    }

    if (sub === "/projects") {
      if (method !== "POST") throw new HttpError(405, "method not allowed");
      const body = await readBody(req);
      const record = await serialize(() => createProject(body));
      ok(res, { project: presentProject(record) });
      return;
    }

    const detail = /^\/projects\/([^/]+)$/u.exec(sub);
    if (detail) {
      if (method !== "PATCH") throw new HttpError(405, "method not allowed");
      const id = decodeId(detail[1]);
      const body = await readBody(req);
      const record = await serialize(() => editProject(id, body));
      ok(res, { project: presentProject(record) });
      return;
    }

    const action = /^\/projects\/([^/]+)\/(archive|restore)$/u.exec(sub);
    if (action) {
      if (method !== "POST") throw new HttpError(405, "method not allowed");
      const id = decodeId(action[1]);
      const body = await readBody(req);
      const record = await serialize(() => transition(id, action[2], body));
      ok(res, { project: presentProject(record) });
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
        ctx.logger?.warn?.(`dsh-projects: request failed: ${error?.stack ?? error}`);
        fail(res, 500, "internal server error");
      }
    },
  }), "dsh-projects: api");
}

export { apply, inject, name };
