/**
 * dsh-agenda — host plugin.
 *
 * Owns the Agenda task lifecycle: one bounded, same-origin JSON API over a
 * single revisioned DSH JSON storage unit. Calendar, Review and Archive are
 * projections of this one authoritative record set, not separate stores.
 *
 * Defensive posture mirrors the reviewed dsh-notebook host: same-origin
 * rejection before parsing, bounded bodies, host-side field and lifecycle
 * validation, generic 500s, and serialized writes.
 */

import { randomUUID } from "node:crypto";

const name = "dsh-agenda";
const inject = ["webServer", "storage"];

const PREFIX = "/api/agenda";
const UNIT_NAME = "agenda";
const UNIT_VERSION = 1;
const SCHEMA_VERSION = 1;
const TABLES = ["tasks"];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_BODY_BYTES = 128 * 1024;
const MAX_TASKS = 10_000;
const MAX_TITLE_CODE_POINTS = 200;
const MAX_NOTES_CHARS = 20_000;
const MAX_ORDER_INDEX = 1_000_000;

const PRIORITIES = new Set(["low", "normal", "high"]);
const STATUSES = new Set(["open", "completed", "archived"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u;
// Control characters have no place in a single-line title.
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;

// Fields a client may set. Everything else — id, status, timestamps — is the
// host's to decide.
const EDITABLE_FIELDS = ["title", "notes", "dueDate", "dueTime", "priority", "orderIndex", "projectId"];
// A canonical reference is lowercase: the authority stores lowercase keys, so
// accepting other casings would let two spellings name one Project.
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Same-origin check, matching the audited guard in the hardened MCP panel and
 * dsh-notebook. Sec-Fetch-Site is authoritative when the browser sends it
 * ("none" covers a user-typed URL); otherwise a missing Origin is a non-browser
 * or same-origin caller, and a present Origin must agree with Host.
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

function readTitle(value) {
  if (typeof value !== "string") throw new HttpError(400, "title must be a string");
  const trimmed = value.trim();
  if (CONTROL_PATTERN.test(trimmed)) throw new HttpError(400, "title contains control characters");
  // Code points, not UTF-16 units, so CJK and astral symbols agree with the UI.
  const length = [...trimmed].length;
  if (length === 0) throw new HttpError(400, "title must be non-empty");
  if (length > MAX_TITLE_CODE_POINTS) throw new HttpError(400, "title is too long");
  return trimmed;
}

function readNotes(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new HttpError(400, "notes must be a string");
  if (value.length > MAX_NOTES_CHARS) throw new HttpError(400, "notes are too long");
  return value;
}

/** Validates a real Gregorian calendar date, so 2026-02-29 is rejected. */
function readDueDate(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new HttpError(400, "dueDate must be a string");
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new HttpError(400, "dueDate must be YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) throw new HttpError(400, "dueDate is not a real date");
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) throw new HttpError(400, "dueDate is not a real date");
  return value;
}

function readDueTime(value, dueDate) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new HttpError(400, "dueTime must be a string");
  if (!TIME_PATTERN.test(value)) throw new HttpError(400, "dueTime must be HH:mm");
  if (dueDate === null) throw new HttpError(400, "dueTime requires a dueDate");
  return value;
}

function readPriority(value) {
  if (value === null || value === undefined) return "normal";
  if (typeof value !== "string" || !PRIORITIES.has(value)) {
    throw new HttpError(400, "priority must be low, normal or high");
  }
  return value;
}

function readOrderIndex(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_ORDER_INDEX) {
    throw new HttpError(400, "orderIndex must be a bounded integer");
  }
  return value;
}

function rejectServerOwnedFields(body) {
  for (const field of ["id", "status", "createdAt", "updatedAt", "completedAt", "archivedAt", "archivedFrom"]) {
    if (body[field] !== undefined) {
      throw new HttpError(400, `${field} is assigned by the server`);
    }
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
 * Validates a nullable reference to a Project owned by dsh-projects.
 *
 * The task owns only this id. No Project title, phase or revision is ever copied
 * in, so the two records cannot drift.
 *
 * acksProjects is an optional capability rather than a required injection, which
 * keeps a standalone Agenda usable for unlinked work. When it is missing, a
 * non-null link is refused with 503 instead of being stored as a dangling
 * reference; clearing a link needs no authority at all.
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
async function readProjectId(value, service) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !CANONICAL_UUID_PATTERN.test(value)) {
    throw new HttpError(400, "projectId must be a canonical UUID or null");
  }
  if (!service || typeof service.exists !== "function") {
    throw new HttpError(503, "Projects service is unavailable");
  }
  if (!(await service.exists(value))) {
    throw new HttpError(400, "projectId does not reference a Project");
  }
  return value;
}

function presentTask(record) {
  return {
    id: record.id,
    title: record.title,
    notes: record.notes,
    dueDate: record.dueDate,
    dueTime: record.dueTime,
    priority: record.priority,
    status: record.status,
    archivedFrom: record.archivedFrom,
    orderIndex: record.orderIndex,
    // An absent property is a record written before references existed.
    projectId: record.projectId ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
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
  }, "dsh-agenda: storage lifecycle");

  // One promise chain serializes every mutation. The tail is kept alive with a
  // caught continuation so a rejected operation cannot poison later writes,
  // while the caller still receives the original rejection.
  let queue = Promise.resolve();
  function serialize(operation) {
    const result = queue.then(operation);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function loadTasks() {
    const store = await unit();
    const snapshot = await store.loadAll();
    return snapshot?.tables?.tasks ?? {};
  }

  async function getTask(id) {
    const tasks = await loadTasks();
    const record = tasks[id];
    if (!record) throw new HttpError(404, "task not found");
    return record;
  }

  async function writeTask(record) {
    const store = await unit();
    await store.putRecord("tasks", record.id, record);
    return record;
  }

  async function createTask(body) {
    rejectServerOwnedFields(body);
    const dueDate = readDueDate(body.dueDate);
    const projectId = await readProjectId(body.projectId, ctx.reflect.get("acksProjects"));
    const now = Date.now();
    const tasks = await loadTasks();
    if (Object.keys(tasks).length >= MAX_TASKS) {
      throw new HttpError(409, `task limit of ${MAX_TASKS} reached`);
    }
    return writeTask({
      id: randomUUID(),
      title: readTitle(body.title),
      notes: readNotes(body.notes),
      dueDate,
      dueTime: readDueTime(body.dueTime, dueDate),
      priority: readPriority(body.priority),
      status: "open",
      archivedFrom: null,
      orderIndex: readOrderIndex(body.orderIndex, Object.keys(tasks).length),
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      archivedAt: null,
      projectId,
    });
  }

  async function editTask(id, body) {
    rejectServerOwnedFields(body);
    const record = await getTask(id);
    const next = { ...record };

    if (body.title !== undefined) next.title = readTitle(body.title);
    if (body.notes !== undefined) next.notes = readNotes(body.notes);
    if (body.dueDate !== undefined) next.dueDate = readDueDate(body.dueDate);
    // Clearing the date clears a time that would otherwise be orphaned.
    if (next.dueDate === null) next.dueTime = null;
    if (body.dueTime !== undefined) next.dueTime = readDueTime(body.dueTime, next.dueDate);
    if (body.priority !== undefined) next.priority = readPriority(body.priority);
    if (body.orderIndex !== undefined) next.orderIndex = readOrderIndex(body.orderIndex, record.orderIndex);
    // Validated only when supplied, so an unrelated edit never needs the
    // authority and never invents a reference on a legacy record.
    if (body.projectId !== undefined) next.projectId = await readProjectId(body.projectId, ctx.reflect.get("acksProjects"));
    else next.projectId = record.projectId ?? null;

    for (const field of Object.keys(body)) {
      if (!EDITABLE_FIELDS.includes(field)) throw new HttpError(400, `${field} is not editable`);
    }

    // Editing never changes lifecycle state.
    next.status = record.status;
    next.updatedAt = Date.now();
    return writeTask(next);
  }

  async function transition(id, action) {
    const record = await getTask(id);
    const next = { ...record, updatedAt: Date.now() };

    if (action === "complete") {
      if (record.status !== "open") throw new HttpError(409, "only an open task can be completed");
      next.status = "completed";
      next.completedAt = Date.now();
      next.archivedAt = null;
      next.archivedFrom = null;
    } else if (action === "reopen") {
      if (record.status !== "completed") throw new HttpError(409, "only a completed task can be reopened");
      next.status = "open";
      next.completedAt = null;
      next.archivedAt = null;
      next.archivedFrom = null;
    } else if (action === "archive") {
      if (record.status === "archived") throw new HttpError(409, "task is already archived");
      next.status = "archived";
      next.archivedFrom = record.status;
      next.archivedAt = Date.now();
    } else if (action === "restore") {
      if (record.status !== "archived") throw new HttpError(409, "only an archived task can be restored");
      next.status = record.archivedFrom === "completed" ? "completed" : "open";
      next.archivedFrom = null;
      next.archivedAt = null;
    } else {
      throw new HttpError(404, "unknown action");
    }

    return writeTask(next);
  }

  async function route(method, sub, req, res) {
    if (sub === "/state") {
      if (method !== "GET") throw new HttpError(405, "method not allowed");
      const tasks = await loadTasks();
      ok(res, {
        schemaVersion: SCHEMA_VERSION,
        tasks: Object.values(tasks)
          .sort((left, right) => left.orderIndex - right.orderIndex || left.createdAt - right.createdAt)
          .map(presentTask),
      });
      return;
    }

    if (sub === "/tasks") {
      if (method !== "POST") throw new HttpError(405, "method not allowed");
      const body = await readBody(req);
      const record = await serialize(() => createTask(body));
      ok(res, { task: presentTask(record) });
      return;
    }

    const detail = /^\/tasks\/([^/]+)$/u.exec(sub);
    if (detail) {
      if (method !== "PATCH") throw new HttpError(405, "method not allowed");
      const id = decodeId(detail[1]);
      const body = await readBody(req);
      const record = await serialize(() => editTask(id, body));
      ok(res, { task: presentTask(record) });
      return;
    }

    const action = /^\/tasks\/([^/]+)\/(complete|reopen|archive|restore)$/u.exec(sub);
    if (action) {
      if (method !== "POST") throw new HttpError(405, "method not allowed");
      const id = decodeId(action[1]);
      // A lifecycle body carries nothing. Parsing it and ignoring the contents
      // would let a caller believe it had changed a field it never changed —
      // the defect the Bookmarks audit rejected.
      const body = await readBody(req);
      if (Object.keys(body).length > 0) {
        throw new HttpError(400, "a lifecycle request body must be empty");
      }
      const record = await serialize(() => transition(id, action[2]));
      ok(res, { task: presentTask(record) });
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
        ctx.logger?.warn?.(`dsh-agenda: request failed: ${error?.stack ?? error}`);
        fail(res, 500, "internal server error");
      }
    },
  }), "dsh-agenda: api");
}

export { apply, inject, name };
