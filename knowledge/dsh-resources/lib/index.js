/**
 * dsh-resources — host plugin.
 *
 * The single authority for a Resource: a reusable curated asset or topic. A
 * Resource is deliberately **not** a second bookmark. It never stores a URL of
 * its own — an external address is represented by a Bookmark reference, so the
 * canonical URL keeps exactly one owner.
 *
 * One bounded, same-origin JSON API over one revisioned DSH JSON storage unit.
 * Every mutation carries an expected revision, so a stale write is refused
 * rather than silently overwriting a newer one; the compare and the write share
 * one serialized operation. Other domains store a resource id, never a copy.
 *
 * This module resolves nothing it stores. A note or bookmark source is checked
 * for *existence* through its owner's reference service, and a workspace source
 * is a validated string: the host never reads, stats, opens or serves the path
 * it names, and never requests a URL. That is what keeps this plugin free of
 * SSRF and path-traversal surface.
 *
 * Defensive posture mirrors the reviewed dsh-notebook, dsh-agenda,
 * dsh-bookmarks, dsh-projects and dsh-areas hosts, including the corrections
 * their audits produced.
 */

import { randomUUID } from "node:crypto";

const name = "dsh-resources";
const inject = ["webServer", "storage"];

const PREFIX = "/api/resources";
const UNIT_NAME = "resources";
const UNIT_VERSION = 1;
const SCHEMA_VERSION = 1;
const TABLES = ["resources"];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_BODY_BYTES = 128 * 1024;
const MAX_RESOURCES = 2_000;
const MAX_TITLE_CODE_POINTS = 160;
const MAX_SUMMARY_CODE_POINTS = 8_000;
const MAX_TAGS = 20;
const MAX_TAG_CODE_POINTS = 40;
const MAX_WORKSPACE_PATH_CODE_POINTS = 1_024;

const KINDS = new Set(["reference", "template", "media", "tool", "dataset", "other"]);
const STATUSES = new Set(["active", "dormant"]);
const SOURCE_TYPES = new Set(["none", "note", "bookmark", "workspace"]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
// A cross-domain reference is lowercase: an authority stores lowercase keys, so
// accepting another casing would let two spellings name one record. Notebook
// derives an imported note's id by hash, so versions 1-5 are all valid there.
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_NOTE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const SUMMARY_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

const EDITABLE_FIELDS = ["title", "summary", "kind", "status", "areaId", "sourceType", "sourceId", "tags"];
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

function readSummary(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new HttpError(400, "summary must be a string");
  // A summary may span lines, so tab, carriage return and newline are the only
  // control characters allowed through.
  if (SUMMARY_CONTROL_PATTERN.test(value)) {
    throw new HttpError(400, "summary contains control characters");
  }
  if ([...value].length > MAX_SUMMARY_CODE_POINTS) throw new HttpError(400, "summary is too long");
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

function readKind(value) {
  if (value === null || value === undefined) return "reference";
  if (typeof value !== "string" || !KINDS.has(value)) {
    throw new HttpError(400, "kind must be reference, template, media, tool, dataset or other");
  }
  return value;
}

function readStatus(value) {
  if (value === null || value === undefined) return "active";
  if (typeof value !== "string" || !STATUSES.has(value)) {
    throw new HttpError(400, "status must be active or dormant");
  }
  return value;
}

function readSourceType(value) {
  if (value === null || value === undefined) return "none";
  if (typeof value !== "string" || !SOURCE_TYPES.has(value)) {
    throw new HttpError(400, "sourceType must be none, note, bookmark or workspace");
  }
  return value;
}

/**
 * Normalizes a workspace source into a safe relative POSIX path.
 *
 * The host stores this string and nothing more: it never reads, stats, opens or
 * serves the path. The validation exists so a stored value can never be
 * *interpreted* as an escape by a future consumer — no absolute path, no drive
 * letter, no URL, no control character, no empty segment, no `.` or `..`.
 *
 * Backslashes are rejected rather than translated. Silently rewriting a
 * Windows-style path would make two different strings name one resource and
 * would hide a caller that is passing a native path where a POSIX one belongs.
 */
function readWorkspacePath(value) {
  if (typeof value !== "string") throw new HttpError(400, "sourceId must be a string");
  if (CONTROL_PATTERN.test(value)) throw new HttpError(400, "sourceId contains control characters");
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new HttpError(400, "sourceId must be non-empty");
  if ([...trimmed].length > MAX_WORKSPACE_PATH_CODE_POINTS) {
    throw new HttpError(400, "sourceId is too long");
  }
  if (trimmed.includes("\\")) throw new HttpError(400, "sourceId must use POSIX separators");
  if (trimmed.startsWith("/")) throw new HttpError(400, "sourceId must be a relative path");
  if (/^[a-z]:/iu.test(trimmed)) throw new HttpError(400, "sourceId must not name a drive");
  // A scheme-looking prefix is refused outright: a workspace source is a path,
  // never an address to resolve.
  if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) throw new HttpError(400, "sourceId must not be a URL");

  const segments = trimmed.split("/");
  for (const segment of segments) {
    if (segment.length === 0) throw new HttpError(400, "sourceId must not contain an empty segment");
    if (segment === "." || segment === "..") {
      throw new HttpError(400, "sourceId must not contain a relative segment");
    }
  }
  return segments.join("/");
}

function readExpectedRevision(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new HttpError(400, "expectedRevision must be an integer of at least 1");
  }
  return value;
}

function assertRevisionMatches(record, expectedRevision) {
  if (record.revision !== expectedRevision) {
    throw new HttpError(409, "the resource changed since it was loaded");
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

function presentResource(record) {
  return {
    id: record.id,
    title: record.title,
    summary: record.summary,
    kind: record.kind,
    status: record.status,
    areaId: record.areaId ?? null,
    sourceType: record.sourceType,
    sourceId: record.sourceId ?? null,
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
  }, "dsh-resources: storage lifecycle");

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

  async function loadResources() {
    const store = await unit();
    const snapshot = await store.loadAll();
    return snapshot?.tables?.resources ?? {};
  }

  async function writeResource(record) {
    const store = await unit();
    await store.putRecord("resources", record.id, record);
    return record;
  }

  /**
   * Resolves an optional cross-domain capability.
   *
   * `ctx.reflect.get(name)` is deliberate. A bare `ctx.<service>` read throws
   * `cannot get property "..." without inject` in real Cordis, and adding the
   * name to `inject` is not the alternative: Cordis treats every injected name
   * as required and would leave this plugin inactive whenever the other domain
   * is absent. `reflect.get` returns the service while its providing fiber is
   * active and `undefined` otherwise, which is exactly the optional-capability
   * contract — unlinked work keeps running, and a requested non-null link is
   * refused with 503 rather than stored as a dangling reference.
   */
  function authority(serviceName) {
    return ctx.reflect.get(serviceName);
  }

  async function readAreaId(value) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string" || !CANONICAL_UUID_PATTERN.test(value)) {
      throw new HttpError(400, "areaId must be a canonical UUID or null");
    }
    const service = authority("acksAreas");
    if (!service || typeof service.exists !== "function") {
      throw new HttpError(503, "Areas service is unavailable");
    }
    if (!(await service.exists(value))) {
      throw new HttpError(400, "areaId does not reference an Area");
    }
    return value;
  }

  /**
   * Validates the `sourceType`/`sourceId` pair as one unit.
   *
   * The two fields cannot be validated independently: a bookmark id under
   * `sourceType: "note"` is well-formed on its own and meaningless together, so
   * the pair is always resolved from the type outward. `none` carries no id at
   * all rather than an ignored one.
   */
  async function readSource(sourceType, sourceId) {
    if (sourceType === "none") {
      if (sourceId !== undefined && sourceId !== null && sourceId !== "") {
        throw new HttpError(400, "sourceId must be empty when sourceType is none");
      }
      return null;
    }

    if (sourceId === undefined || sourceId === null || sourceId === "") {
      throw new HttpError(400, `sourceId is required when sourceType is ${sourceType}`);
    }

    if (sourceType === "workspace") {
      // A path names a file this host never touches, so there is no authority
      // to consult and nothing to resolve.
      return readWorkspacePath(sourceId);
    }

    const spec = sourceType === "note"
      ? { pattern: CANONICAL_NOTE_ID_PATTERN, service: "acksNotebook", method: "existsNote", label: "Notebook", noun: "a Note" }
      : { pattern: CANONICAL_UUID_PATTERN, service: "acksBookmarks", method: "exists", label: "Bookmarks", noun: "a Bookmark" };

    if (typeof sourceId !== "string" || !spec.pattern.test(sourceId)) {
      throw new HttpError(400, `sourceId must be a canonical UUID when sourceType is ${sourceType}`);
    }
    const service = authority(spec.service);
    if (!service || typeof service[spec.method] !== "function") {
      throw new HttpError(503, `${spec.label} service is unavailable`);
    }
    if (!(await service[spec.method](sourceId))) {
      throw new HttpError(400, `sourceId does not reference ${spec.noun}`);
    }
    return sourceId;
  }

  /**
   * The authoritative answer to one question other domains may ask: does this
   * Resource id exist?
   *
   * Deliberately minimal. Exposing a getter or a list would let another domain
   * copy a Resource object, which is exactly what the reference contract
   * forbids — a domain owns only its own nullable resource id.
   *
   * An archived resource still exists: this plugin has no delete route, so an
   * accepted reference stays valid for the life of the record.
   *
   * A `referencesNote` reverse lookup briefly lived here, so Notebook could ask
   * whether a note was still pointed at before deleting it. It was removed with
   * the delete route it served: the answer was true when given and could be
   * false by the time the deletion committed, and keeping the method would
   * imply that two independent existence checks are a safe basis for one.
   */
  const resourceReferences = Object.freeze({
    async exists(id) {
      if (typeof id !== "string" || !UUID_PATTERN.test(id)) return false;
      const resources = await loadResources();
      return Object.prototype.hasOwnProperty.call(resources, id);
    },
  });
  ctx.reflect.provide("acksResources", resourceReferences);

  async function requireResource(id) {
    const resources = await loadResources();
    const record = resources[id];
    if (!record) throw new HttpError(404, "resource not found");
    return record;
  }

  async function createResource(body) {
    rejectServerOwnedFields(body);
    rejectUnknownFields(body, EDITABLE_FIELDS);

    const title = boundedText(body.title, "title", MAX_TITLE_CODE_POINTS);
    const sourceType = readSourceType(body.sourceType);
    const sourceId = await readSource(sourceType, body.sourceId);
    const areaId = await readAreaId(body.areaId);

    const resources = await loadResources();
    if (Object.keys(resources).length >= MAX_RESOURCES) {
      throw new HttpError(409, `resource limit of ${MAX_RESOURCES} reached`);
    }

    const now = Date.now();
    return writeResource({
      id: randomUUID(),
      title,
      summary: readSummary(body.summary),
      kind: readKind(body.kind),
      status: readStatus(body.status),
      areaId,
      sourceType,
      sourceId,
      tags: readTags(body.tags),
      lifecycle: "active",
      revision: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
  }

  async function editResource(id, body) {
    rejectServerOwnedFields(body);
    rejectUnknownFields(body, EDITABLE_FIELDS.concat(["expectedRevision"]));
    const expectedRevision = readExpectedRevision(body.expectedRevision);

    const supplied = EDITABLE_FIELDS.filter((field) => body[field] !== undefined);
    if (supplied.length === 0) {
      throw new HttpError(400, "at least one editable field is required");
    }

    const record = await requireResource(id);
    assertRevisionMatches(record, expectedRevision);

    const next = { ...record, tags: [...record.tags] };
    if (body.title !== undefined) next.title = boundedText(body.title, "title", MAX_TITLE_CODE_POINTS);
    if (body.summary !== undefined) next.summary = readSummary(body.summary);
    if (body.kind !== undefined) next.kind = readKind(body.kind);
    if (body.status !== undefined) next.status = readStatus(body.status);
    if (body.tags !== undefined) next.tags = readTags(body.tags);
    // Validated only when supplied, so an unrelated edit never needs the
    // authority and never invents a reference on a legacy record.
    if (body.areaId !== undefined) next.areaId = await readAreaId(body.areaId);
    else next.areaId = record.areaId ?? null;

    // The source pair moves together.
    //
    // Changing the type alone must not silently reinterpret the stored id under
    // the new type. Shapes overlap — a UUID is also a syntactically valid
    // relative path — so re-resolving would quietly turn a note reference into a
    // workspace path that names a file nobody meant. A type change therefore
    // requires the caller to state the id it goes with; only `none`, which
    // clears the id outright, needs nothing.
    if (body.sourceType !== undefined || body.sourceId !== undefined) {
      const sourceType = body.sourceType !== undefined ? readSourceType(body.sourceType) : record.sourceType;
      if (sourceType !== record.sourceType && sourceType !== "none" && body.sourceId === undefined) {
        throw new HttpError(400, "changing sourceType requires the matching sourceId");
      }
      // Moving to `none` clears the id outright. Passing the stored id through
      // would trip the "none carries no id" rule on a caller who is doing
      // exactly the right thing.
      const sourceId = sourceType === "none"
        ? null
        : (body.sourceId !== undefined ? body.sourceId : record.sourceId);
      next.sourceType = sourceType;
      next.sourceId = await readSource(sourceType, sourceId);
    }

    // Lifecycle is never changed by an edit.
    next.lifecycle = record.lifecycle;
    next.revision = record.revision + 1;
    next.updatedAt = Date.now();
    return writeResource(next);
  }

  async function transition(id, action, body) {
    // A lifecycle body carries exactly one field. Accepting and ignoring
    // anything else is what the previous audit rejected.
    rejectServerOwnedFields(body);
    rejectUnknownFields(body, ["expectedRevision"]);
    const expectedRevision = readExpectedRevision(body.expectedRevision);

    const record = await requireResource(id);
    assertRevisionMatches(record, expectedRevision);

    const next = { ...record, tags: [...record.tags] };
    if (action === "archive") {
      if (record.lifecycle !== "active") throw new HttpError(409, "resource is already archived");
      next.lifecycle = "archived";
      next.archivedAt = Date.now();
    } else if (action === "restore") {
      if (record.lifecycle !== "archived") throw new HttpError(409, "only an archived resource can be restored");
      next.lifecycle = "active";
      next.archivedAt = null;
    } else {
      throw new HttpError(404, "unknown action");
    }

    // Status, the area link and the source are independent of the archive
    // lifecycle and are preserved.
    next.status = record.status;
    next.areaId = record.areaId ?? null;
    next.sourceType = record.sourceType;
    next.sourceId = record.sourceId ?? null;
    next.revision = record.revision + 1;
    next.updatedAt = Date.now();
    return writeResource(next);
  }

  async function route(method, sub, req, res) {
    if (sub === "/state") {
      if (method !== "GET") throw new HttpError(405, "method not allowed");
      const resources = await loadResources();
      ok(res, {
        schemaVersion: SCHEMA_VERSION,
        resources: Object.values(resources)
          .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
          .map(presentResource),
      });
      return;
    }

    if (sub === "/resources") {
      if (method !== "POST") throw new HttpError(405, "method not allowed");
      const body = await readBody(req);
      const record = await serialize(() => createResource(body));
      ok(res, { resource: presentResource(record) });
      return;
    }

    const detail = /^\/resources\/([^/]+)$/u.exec(sub);
    if (detail) {
      if (method !== "PATCH") throw new HttpError(405, "method not allowed");
      const id = decodeId(detail[1]);
      const body = await readBody(req);
      const record = await serialize(() => editResource(id, body));
      ok(res, { resource: presentResource(record) });
      return;
    }

    const action = /^\/resources\/([^/]+)\/(archive|restore)$/u.exec(sub);
    if (action) {
      if (method !== "POST") throw new HttpError(405, "method not allowed");
      const id = decodeId(action[1]);
      const body = await readBody(req);
      const record = await serialize(() => transition(id, action[2], body));
      ok(res, { resource: presentResource(record) });
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
        ctx.logger?.warn?.(`dsh-resources: request failed: ${error?.stack ?? error}`);
        fail(res, 500, "internal server error");
      }
    },
  }), "dsh-resources: api");
}

export { apply, inject, name };
