/**
 * dsh-bookmarks — host plugin.
 *
 * Owns the bookmark record set: one bounded, same-origin JSON API over a single
 * revisioned DSH JSON storage unit.
 *
 * This module stores links and never requests them. It performs no fetch, no DNS
 * resolution, no socket work and no filesystem access, so it introduces no SSRF
 * or remote-content parsing surface. Any future snapshot or metadata feature
 * belongs to its own milestone with its own threat review.
 *
 * Defensive posture mirrors the reviewed dsh-notebook and dsh-agenda hosts:
 * same-origin rejection before parsing, bounded bodies, host-side validation,
 * generic 500s, and serialized writes.
 */

import { randomUUID } from "node:crypto";

const name = "dsh-bookmarks";
const inject = ["webServer", "storage"];

const PREFIX = "/api/bookmarks";
const UNIT_NAME = "bookmarks";
const UNIT_VERSION = 1;
const SCHEMA_VERSION = 1;
const TABLES = ["bookmarks"];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_BODY_BYTES = 128 * 1024;
const MAX_BOOKMARKS = 5_000;
const MAX_TITLE_CODE_POINTS = 200;
const MAX_NOTES_CHARS = 20_000;
const MAX_URL_CHARS = 2048;
const MAX_TAGS = 20;
const MAX_TAG_CODE_POINTS = 40;

const READING_STATES = new Set(["unread", "reading", "read"]);
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;

// Fields a client may set. Everything else — id, status, canonicalUrl and every
// timestamp — is the host's to decide.
const EDITABLE_FIELDS = ["title", "url", "notes", "tags", "readingState", "projectId", "areaId"];
// A canonical reference is lowercase: the authority stores lowercase keys, so
// accepting other casings would let two spellings name one Project.
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SERVER_OWNED_FIELDS = [
  "id", "status", "canonicalUrl", "createdAt", "updatedAt", "archivedAt", "archivedFrom",
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Same-origin check, matching the audited guard in the hardened MCP panel,
 * dsh-notebook and dsh-agenda. Sec-Fetch-Site is authoritative when the browser
 * sends it ("none" covers a user-typed URL); otherwise a missing Origin is a
 * non-browser or same-origin caller, and a present Origin must agree with Host.
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

function boundedText(value, field, maxCodePoints) {
  if (typeof value !== "string") throw new HttpError(400, `${field} must be a string`);
  const trimmed = value.trim();
  if (CONTROL_PATTERN.test(trimmed)) throw new HttpError(400, `${field} contains control characters`);
  // Code points, not UTF-16 units, so CJK and astral symbols agree with the UI.
  const length = [...trimmed].length;
  if (length === 0) throw new HttpError(400, `${field} must be non-empty`);
  if (length > maxCodePoints) throw new HttpError(400, `${field} is too long`);
  return trimmed;
}

function readNotes(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new HttpError(400, "notes must be a string");
  if (value.length > MAX_NOTES_CHARS) throw new HttpError(400, "notes are too long");
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

function readReadingState(value) {
  if (value === null || value === undefined) return "unread";
  if (typeof value !== "string" || !READING_STATES.has(value)) {
    throw new HttpError(400, "readingState must be unread, reading or read");
  }
  return value;
}

/**
 * Normalizes an absolute HTTP(S) URL into a deterministic equality key.
 *
 * Scheme and host are lowercased by `URL`, a default port is dropped and the
 * fragment is removed. Path and query are left exactly as given, because
 * reordering query parameters or changing path case can address a different
 * resource on a real server.
 *
 * A loopback or private-network address is accepted: nothing here ever requests
 * the URL, so it carries no SSRF risk. That must be re-evaluated by any future
 * milestone that fetches.
 */
function normalizeUrl(value) {
  if (typeof value !== "string") throw new HttpError(400, "url must be a string");
  // Check the caller's exact value before trimming. Otherwise a leading LF or
  // trailing TAB is silently removed and evades the explicit control policy.
  if (CONTROL_PATTERN.test(value)) throw new HttpError(400, "url contains control characters");
  const raw = value.trim();
  if (raw.length === 0) throw new HttpError(400, "url must be non-empty");
  if (raw.length > MAX_URL_CHARS) throw new HttpError(400, "url is too long");

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HttpError(400, "url must be an absolute http(s) URL");
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new HttpError(400, "url must use http or https");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new HttpError(400, "url must not contain credentials");
  }
  if (parsed.hostname === "") throw new HttpError(400, "url must have a host");

  parsed.hash = "";
  const normalized = parsed.toString();
  if (normalized.length > MAX_URL_CHARS) throw new HttpError(400, "url is too long");
  return normalized;
}

function rejectServerOwnedFields(body) {
  for (const field of SERVER_OWNED_FIELDS) {
    if (body[field] !== undefined) {
      throw new HttpError(400, `${field} is assigned by the server`);
    }
  }
}

function rejectUnknownFields(body) {
  for (const field of Object.keys(body)) {
    if (!EDITABLE_FIELDS.includes(field)) throw new HttpError(400, `${field} is not editable`);
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


/**
 * Validates one nullable reference to a record owned by another domain.
 *
 * The bookmark owns only the id. No Project title, Area name or revision is
 * copied in, and neither reference plays any part in URL canonicalization or
 * duplicate detection — the canonical URL alone decides whether two bookmarks
 * are the same resource.
 *
 * The two references are independent: a bookmark filed under an Area need not
 * belong to a Project, so each is validated by its own owner and neither
 * implies the other.
 *
 * Each authority is an optional capability rather than a required injection, so
 * a standalone Bookmarks stays usable for unlinked work and one absent service
 * never disables the other. While a service is missing, a non-null link to it is
 * refused with 503 instead of stored as a dangling reference; clearing a link
 * needs no authority.
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
async function readReference(value, service, field, authority) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !CANONICAL_UUID_PATTERN.test(value)) {
    throw new HttpError(400, `${field} must be a canonical UUID or null`);
  }
  if (!service || typeof service.exists !== "function") {
    throw new HttpError(503, `${authority} service is unavailable`);
  }
  if (!(await service.exists(value))) {
    throw new HttpError(400, `${field} does not reference ${authority === "Areas" ? "an Area" : "a Project"}`);
  }
  return value;
}

function presentBookmark(record) {
  return {
    id: record.id,
    title: record.title,
    url: record.url,
    canonicalUrl: record.canonicalUrl,
    notes: record.notes,
    tags: [...record.tags],
    readingState: record.readingState,
    // An absent property is a record written before references existed.
    projectId: record.projectId ?? null,
    areaId: record.areaId ?? null,
    status: record.status,
    archivedFrom: record.archivedFrom,
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
  }, "dsh-bookmarks: storage lifecycle");

  // One promise chain serializes every mutation, which is also what makes the
  // duplicate-URL check race-free. The tail keeps a caught continuation so a
  // rejected operation cannot poison later writes, while the caller still
  // receives the original rejection.
  let queue = Promise.resolve();
  function serialize(operation) {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function loadBookmarks() {
    const store = await unit();
    const snapshot = await store.loadAll();
    return snapshot?.tables?.bookmarks ?? {};
  }

  async function getBookmark(id) {
    const bookmarks = await loadBookmarks();
    const record = bookmarks[id];
    if (!record) throw new HttpError(404, "bookmark not found");
    return record;
  }

  async function writeBookmark(record) {
    const store = await unit();
    await store.putRecord("bookmarks", record.id, record);
    return record;
  }

  /**
   * The authoritative answer to one question other domains may ask: does this
   * Bookmark id exist?
   *
   * Deliberately minimal, matching acksProjects and acksAreas. A getter or a
   * list would let another domain copy a Bookmark — including its URL — which
   * is exactly what the reference contract forbids; a domain owns only its own
   * nullable bookmark id.
   *
   * An archived bookmark still exists: this plugin has no delete route, so an
   * accepted reference stays valid for the life of the record and archiving
   * never cascades into another domain.
   */
  const bookmarkReferences = Object.freeze({
    async exists(id) {
      if (typeof id !== "string" || !UUID_PATTERN.test(id)) return false;
      const bookmarks = await loadBookmarks();
      return Object.prototype.hasOwnProperty.call(bookmarks, id);
    },
  });
  ctx.reflect.provide("acksBookmarks", bookmarkReferences);

  /**
   * Uniqueness spans archived records too: releasing the key on archive would
   * let a restore collide with a bookmark created in the meantime.
   */
  function assertCanonicalUrlFree(bookmarks, canonicalUrl, exceptId) {
    for (const record of Object.values(bookmarks)) {
      if (record.canonicalUrl === canonicalUrl && record.id !== exceptId) {
        throw new HttpError(409, "a bookmark with this URL already exists");
      }
    }
  }

  async function createBookmark(body) {
    rejectServerOwnedFields(body);
    rejectUnknownFields(body);
    const url = normalizeUrl(body.url);
    const projectId = await readReference(body.projectId, ctx.reflect.get("acksProjects"), "projectId", "Projects");
    const areaId = await readReference(body.areaId, ctx.reflect.get("acksAreas"), "areaId", "Areas");
    const bookmarks = await loadBookmarks();
    if (Object.keys(bookmarks).length >= MAX_BOOKMARKS) {
      throw new HttpError(409, `bookmark limit of ${MAX_BOOKMARKS} reached`);
    }
    assertCanonicalUrlFree(bookmarks, url, null);

    const now = Date.now();
    return writeBookmark({
      id: randomUUID(),
      title: boundedText(body.title, "title", MAX_TITLE_CODE_POINTS),
      url,
      canonicalUrl: url,
      notes: readNotes(body.notes),
      tags: readTags(body.tags),
      readingState: readReadingState(body.readingState),
      status: "active",
      archivedFrom: null,
      projectId,
      areaId,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    });
  }

  async function editBookmark(id, body) {
    rejectServerOwnedFields(body);
    rejectUnknownFields(body);
    const bookmarks = await loadBookmarks();
    const record = bookmarks[id];
    if (!record) throw new HttpError(404, "bookmark not found");

    const next = { ...record, tags: [...record.tags] };
    if (body.title !== undefined) next.title = boundedText(body.title, "title", MAX_TITLE_CODE_POINTS);
    if (body.notes !== undefined) next.notes = readNotes(body.notes);
    if (body.tags !== undefined) next.tags = readTags(body.tags);
    if (body.readingState !== undefined) next.readingState = readReadingState(body.readingState);
    // Validated only when supplied, so an unrelated edit never needs the
    // authority and never invents a reference on a legacy record.
    if (body.projectId !== undefined) {
      next.projectId = await readReference(body.projectId, ctx.reflect.get("acksProjects"), "projectId", "Projects");
    } else next.projectId = record.projectId ?? null;
    if (body.areaId !== undefined) {
      next.areaId = await readReference(body.areaId, ctx.reflect.get("acksAreas"), "areaId", "Areas");
    } else next.areaId = record.areaId ?? null;
    if (body.url !== undefined) {
      const url = normalizeUrl(body.url);
      // Re-normalizing to the record's own key is not a collision.
      assertCanonicalUrlFree(bookmarks, url, record.id);
      next.url = url;
      next.canonicalUrl = url;
    }

    // Editing never changes lifecycle state.
    next.status = record.status;
    next.updatedAt = Date.now();
    return writeBookmark(next);
  }

  async function transition(id, action) {
    const record = await getBookmark(id);
    // The spread preserves both references: archiving never unlinks a bookmark
    // from its Project or Area.
    const next = { ...record, tags: [...record.tags], updatedAt: Date.now() };

    if (action === "archive") {
      if (record.status !== "active") throw new HttpError(409, "bookmark is already archived");
      next.status = "archived";
      next.archivedFrom = record.status;
      next.archivedAt = Date.now();
    } else if (action === "restore") {
      if (record.status !== "archived") throw new HttpError(409, "only an archived bookmark can be restored");
      next.status = "active";
      next.archivedFrom = null;
      next.archivedAt = null;
    } else {
      throw new HttpError(404, "unknown action");
    }

    return writeBookmark(next);
  }

  async function route(method, sub, req, res) {
    if (sub === "/state") {
      if (method !== "GET") throw new HttpError(405, "method not allowed");
      const bookmarks = await loadBookmarks();
      ok(res, {
        schemaVersion: SCHEMA_VERSION,
        bookmarks: Object.values(bookmarks)
          .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
          .map(presentBookmark),
      });
      return;
    }

    if (sub === "/bookmarks") {
      if (method !== "POST") throw new HttpError(405, "method not allowed");
      const body = await readBody(req);
      const record = await serialize(() => createBookmark(body));
      ok(res, { bookmark: presentBookmark(record) });
      return;
    }

    const detail = /^\/bookmarks\/([^/]+)$/u.exec(sub);
    if (detail) {
      if (method !== "PATCH") throw new HttpError(405, "method not allowed");
      const id = decodeId(detail[1]);
      const body = await readBody(req);
      const record = await serialize(() => editBookmark(id, body));
      ok(res, { bookmark: presentBookmark(record) });
      return;
    }

    const action = /^\/bookmarks\/([^/]+)\/(archive|restore)$/u.exec(sub);
    if (action) {
      if (method !== "POST") throw new HttpError(405, "method not allowed");
      const id = decodeId(action[1]);
      const body = await readBody(req);
      rejectServerOwnedFields(body);
      if (Object.keys(body).length > 0) {
        throw new HttpError(400, "archive and restore bodies must be empty");
      }
      const record = await serialize(() => transition(id, action[2]));
      ok(res, { bookmark: presentBookmark(record) });
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
        ctx.logger?.warn?.(`dsh-bookmarks: request failed: ${error?.stack ?? error}`);
        fail(res, 500, "internal server error");
      }
    },
  }), "dsh-bookmarks: api");
}

export { apply, inject, name };
