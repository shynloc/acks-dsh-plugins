/**
 * dsh-notebook — host plugin.
 *
 * Registers a same-origin JSON API under `/api/notebook` and persists data in
 * the DSH JSON storage backend. The browser half lives in `./client`.
 */
import { createHash, randomUUID } from "node:crypto";

const name = "dsh-notebook";
const inject = ["webServer", "storage"];

const PREFIX = "/api/notebook";
const UNIT_NAME = "notebook";
const UNIT_VERSION = 1;
const TABLES = ["categories", "notes", "tags", "note_versions"];
const NOTE_COLORS = new Set(["none", "red", "orange", "yellow", "green", "blue", "purple"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
// A cross-domain reference is lowercase and carries no surrounding whitespace:
// storage keys are lowercase, so accepting another spelling would let two
// strings name one note. Version 5 stays allowed because a conversation import
// derives its id by hash rather than at random.
const REFERENCE_NOTE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
// A reference this plugin *makes* names a randomly generated record in another
// domain, so it is a lowercase version-4 UUID.
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/iu;

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_NOTE_TITLE_CHARS = 200;
const MAX_NOTE_CONTENT_CHARS = 500_000;
const MAX_NAME_CHARS = 80;
const MAX_SEARCH_CHARS = 200;
const MAX_SOURCE_ID_CHARS = 200;
const MAX_TAGS_PER_NOTE = 32;
const MAX_VERSIONS_PER_NOTE = 50;
const MAX_ORDER_INDEX = 1_000_000;
const SOURCE_ID_PATTERN = /^[a-z0-9._:-]+$/iu;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/**
 * Same-origin check, matching the audited guard in the hardened MCP panel.
 *
 * Sec-Fetch-Site is authoritative when the browser sends it ("none" covers a
 * user-typed URL). Otherwise a missing Origin is a non-browser or same-origin
 * caller, and a present Origin must agree with Host. An unparsable Origin, or
 * an Origin with no Host to compare against, is rejected.
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

function countWords(text) {
  const value = String(text ?? "");
  const chinese = (value.match(/[\u4e00-\u9fa5]/gu) ?? []).length;
  const english = (value.match(/\b[a-zA-Z]+\b/gu) ?? []).length;
  return chinese + english;
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

function boundedString(value, field, maximum, options = {}) {
  if (typeof value !== "string") throw new HttpError(400, `${field} must be a string`);
  const normalized = options.trim === false ? value : value.trim();
  if (!options.allowEmpty && normalized.length === 0) throw new HttpError(400, `${field} must be non-empty`);
  if (normalized.length > maximum) throw new HttpError(400, `${field} is too long`);
  return normalized;
}

function orderIndex(value) {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_ORDER_INDEX) {
    throw new HttpError(400, "orderIndex must be a bounded integer");
  }
  return value;
}

function noteSource(value) {
  const source = requireObject(value);
  if (source.kind !== "dsh-assistant") throw new HttpError(400, "source kind is invalid");
  const sessionId = boundedString(source.sessionId, "source.sessionId", MAX_SOURCE_ID_CHARS);
  const messageId = boundedString(source.messageId, "source.messageId", MAX_SOURCE_ID_CHARS);
  if (!SOURCE_ID_PATTERN.test(sessionId) || !SOURCE_ID_PATTERN.test(messageId)) {
    throw new HttpError(400, "source identity is invalid");
  }
  return { kind: "dsh-assistant", sessionId, messageId };
}

function sourceNoteId(source) {
  const hex = createHash("sha256").update(`${source.kind}\0${source.sessionId}\0${source.messageId}`, "utf8").digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Validates one nullable reference to a record owned by another domain.
 *
 * The note owns only the id. No Project title, Area name or revision is copied
 * in, so a rename never has to propagate and the two records cannot disagree.
 *
 * The two references are independent: a note filed under an Area need not
 * belong to a Project, so each is validated by its own owner and neither
 * implies the other.
 *
 * Each authority is an optional capability rather than a required injection, so
 * a standalone Notebook stays usable for unlinked notes and one absent service
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
async function reference(value, service, field, authority) {
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

/**
 * Normalizes a stored note for the wire. An absent reference property is a note
 * written before links existed, and presents as null rather than being migrated
 * on read.
 */
function presentNote(record) {
  // The lifecycle fields default here rather than in a migration: a note
  // written before Notebook had an archive is active, and saying so at the
  // boundary means no stored record has to be rewritten to be readable.
  return {
    ...record,
    projectId: record.projectId ?? null,
    areaId: record.areaId ?? null,
    status: record.status ?? "active",
    archivedFrom: record.archivedFrom ?? null,
    archivedAt: record.archivedAt ?? null,
  };
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

export function apply(ctx) {
  let unitPromise = null;

  function unit() {
    if (unitPromise === null) {
      const pending = Promise.resolve(ctx.storage.backend.get("json").kv.open({
        name: UNIT_NAME,
        version: UNIT_VERSION,
        tables: TABLES,
        hasGlobal: false,
      }));
      unitPromise = pending;
      pending.catch(() => {
        if (unitPromise === pending) unitPromise = null;
      });
    }
    return unitPromise;
  }

  async function loadAll() {
    return (await unit()).loadAll();
  }

  async function loadTable(table) {
    const snapshot = await loadAll();
    return Object.values(snapshot.tables[table] ?? {});
  }

  async function getRecord(table, key) {
    const snapshot = await loadAll();
    return (snapshot.tables[table] ?? {})[key];
  }

  async function put(table, key, value) {
    await (await unit()).putRecord(table, key, value);
  }

  async function del(table, key) {
    await (await unit()).deleteRecord(table, key);
  }

  /**
   * The authoritative answer to one question other domains may ask: does this
   * Note id exist?
   *
   * Deliberately minimal, matching acksProjects, acksAreas and acksBookmarks.
   * Returning a note would let another domain copy its title or Markdown body,
   * which is exactly what the reference contract forbids — a domain owns only
   * its own nullable note id.
   *
   * Notebook has no delete route, so an accepted reference stays valid for the
   * life of the record — the same guarantee Bookmarks and Resources give. An
   * archived note still exists and still answers true here, because archiving
   * is a lifecycle state rather than a removal.
   */
  const noteReferences = Object.freeze({
    async existsNote(id) {
      if (typeof id !== "string" || !REFERENCE_NOTE_ID_PATTERN.test(id)) return false;
      return (await getRecord("notes", id)) !== undefined;
    },
  });
  ctx.reflect.provide("acksNotebook", noteReferences);

  async function categoryReference(value, field = "categoryId") {
    if (value === null) return null;
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new HttpError(400, `${field} is invalid`);
    if (!(await getRecord("categories", value))) throw new HttpError(400, `${field} does not exist`);
    return value;
  }

  async function tagReferences(value) {
    if (!Array.isArray(value)) throw new HttpError(400, "tagIds must be an array");
    const ids = [...new Set(value)];
    if (ids.length > MAX_TAGS_PER_NOTE) throw new HttpError(400, "too many tags");
    const tags = new Set((await loadTable("tags")).map((tag) => tag.id));
    for (const id of ids) {
      if (typeof id !== "string" || !UUID_PATTERN.test(id) || !tags.has(id)) {
        throw new HttpError(400, "tagIds contains an unknown tag");
      }
    }
    return ids;
  }

  async function assertNoCategoryCycle(id, parentId) {
    let cursor = parentId;
    const visited = new Set([id]);
    while (cursor !== null) {
      if (visited.has(cursor)) throw new HttpError(400, "category hierarchy would contain a cycle");
      visited.add(cursor);
      const parent = await getRecord("categories", cursor);
      cursor = parent?.parentId ?? null;
    }
  }

  async function trimVersions(noteId) {
    const versions = (await loadTable("note_versions"))
      .filter((version) => version.noteId === noteId)
      .sort((a, b) => Number(b.savedAt) - Number(a.savedAt));
    for (const version of versions.slice(MAX_VERSIONS_PER_NOTE)) await del("note_versions", version.id);
  }

  async function route(method, sub, req, res) {
    if (method === "GET" && sub === "/state") {
      const snapshot = await loadAll();
      return ok(res, {
        categories: Object.values(snapshot.tables.categories ?? {}),
        notes: Object.values(snapshot.tables.notes ?? {}).map(presentNote),
        tags: Object.values(snapshot.tables.tags ?? {}),
      });
    }

    if (method === "GET" && sub === "/search") {
      const query = new URL(req.url ?? "/", "http://localhost").searchParams.get("q") ?? "";
      const needle = boundedString(query, "q", MAX_SEARCH_CHARS, { allowEmpty: true }).toLowerCase();
      const notes = (await loadTable("notes")).map(presentNote);
      if (!needle) return ok(res, { notes });
      return ok(res, {
        notes: notes.filter((note) => String(note.title ?? "").toLowerCase().includes(needle)
          || String(note.content ?? "").toLowerCase().includes(needle)),
      });
    }

    if (sub === "/categories" && method === "POST") {
      const body = await readBody(req);
      const category = {
        id: randomUUID(),
        name: boundedString(body.name, "name", MAX_NAME_CHARS),
        parentId: body.parentId === undefined ? null : await categoryReference(body.parentId, "parentId"),
        orderIndex: body.orderIndex === undefined ? 0 : orderIndex(body.orderIndex),
        createdAt: Date.now(),
      };
      await put("categories", category.id, category);
      return ok(res, { category });
    }

    const categoryMatch = sub.match(/^\/categories\/([^/]+)$/u);
    if (categoryMatch) {
      const id = decodeId(categoryMatch[1]);
      const existing = await getRecord("categories", id);
      if (method === "PATCH") {
        if (!existing) throw new HttpError(404, "category not found");
        const body = await readBody(req);
        const patch = { ...existing };
        if (body.name !== undefined) patch.name = boundedString(body.name, "name", MAX_NAME_CHARS);
        if (body.parentId !== undefined) {
          patch.parentId = await categoryReference(body.parentId, "parentId");
          await assertNoCategoryCycle(id, patch.parentId);
        }
        if (body.orderIndex !== undefined) patch.orderIndex = orderIndex(body.orderIndex);
        await put("categories", id, patch);
        return ok(res, { category: patch });
      }
      if (method === "DELETE") {
        if (!existing) throw new HttpError(404, "category not found");
        await del("categories", id);
        for (const category of await loadTable("categories")) {
          if (category.parentId === id) await put("categories", category.id, { ...category, parentId: null });
        }
        for (const note of await loadTable("notes")) {
          if (note.categoryId === id) await put("notes", note.id, { ...note, categoryId: null });
        }
        return ok(res);
      }
    }

    if (sub === "/notes" && method === "POST") {
      const body = await readBody(req);
      // Both references are resolved before anything is looked up or written,
      // so a rejected link is a deterministic 400/503 and never a half-applied
      // create.
      const projectId = await reference(body.projectId, ctx.reflect.get("acksProjects"), "projectId", "Projects");
      const areaId = await reference(body.areaId, ctx.reflect.get("acksAreas"), "areaId", "Areas");
      const source = body.source === undefined ? undefined : noteSource(body.source);
      if (source !== undefined) {
        const imported = (await loadTable("notes")).find((note) => note.source?.kind === source.kind
          && note.source.sessionId === source.sessionId
          && note.source.messageId === source.messageId);
        if (imported) return ok(res, { note: presentNote(imported), created: false });
      }
      const content = body.content === undefined ? ""
        : boundedString(body.content, "content", MAX_NOTE_CONTENT_CHARS, { allowEmpty: true, trim: false });
      const title = body.title === undefined || String(body.title).trim() === "" ? "无标题"
        : boundedString(body.title, "title", MAX_NOTE_TITLE_CHARS);
      if (body.color !== undefined && !NOTE_COLORS.has(body.color)) throw new HttpError(400, "color is invalid");
      const timestamp = Date.now();
      const note = {
        id: source === undefined ? randomUUID() : sourceNoteId(source),
        title,
        content,
        categoryId: body.categoryId === undefined ? null : await categoryReference(body.categoryId),
        color: body.color ?? "none",
        wordCount: countWords(content),
        tagIds: body.tagIds === undefined ? [] : await tagReferences(body.tagIds),
        projectId,
        areaId,
        ...(source === undefined ? {} : { source }),
        status: "active",
        archivedFrom: null,
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await put("notes", note.id, note);
      return ok(res, { note: presentNote(note), created: true });
    }

    const noteMatch = sub.match(/^\/notes\/([^/]+)$/u);
    if (noteMatch) {
      const id = decodeId(noteMatch[1]);
      const existing = await getRecord("notes", id);
      if (method === "GET") {
        if (!existing) throw new HttpError(404, "note not found");
        return ok(res, { note: presentNote(existing) });
      }
      if (method === "PATCH") {
        if (!existing) throw new HttpError(404, "note not found");
        const body = await readBody(req);
        const patch = { ...existing, updatedAt: Date.now() };

        // Every field is validated before the first write. Resolving a
        // reference after the version snapshot would let a rejected edit leave
        // an orphan version behind for a note that never changed.
        if (body.title !== undefined) {
          patch.title = String(body.title).trim() === "" ? "无标题"
            : boundedString(body.title, "title", MAX_NOTE_TITLE_CHARS);
        }
        if (body.content !== undefined) {
          patch.content = boundedString(body.content, "content", MAX_NOTE_CONTENT_CHARS, { allowEmpty: true, trim: false });
          patch.wordCount = countWords(patch.content);
        }
        if (body.categoryId !== undefined) patch.categoryId = await categoryReference(body.categoryId);
        if (body.color !== undefined) {
          if (!NOTE_COLORS.has(body.color)) throw new HttpError(400, "color is invalid");
          patch.color = body.color;
        }
        if (body.tagIds !== undefined) patch.tagIds = await tagReferences(body.tagIds);
        // Validated only when supplied, so an unrelated edit never needs the
        // authority and never invents a reference on a legacy note.
        if (body.projectId !== undefined) {
          patch.projectId = await reference(body.projectId, ctx.reflect.get("acksProjects"), "projectId", "Projects");
        } else patch.projectId = existing.projectId ?? null;
        if (body.areaId !== undefined) {
          patch.areaId = await reference(body.areaId, ctx.reflect.get("acksAreas"), "areaId", "Areas");
        } else patch.areaId = existing.areaId ?? null;

        // A version is a snapshot of authorship. Filing a note under a Project
        // or an Area is metadata, so only a changed Markdown body snapshots
        // one; a link-only change writes no content version.
        if (patch.content !== existing.content) {
          const savedAt = Date.now();
          const versionId = `${id}:${savedAt}:${randomUUID()}`;
          await put("note_versions", versionId, {
            id: versionId,
            noteId: id,
            title: existing.title,
            content: existing.content,
            savedAt,
          });
          await trimVersions(id);
        }
        await put("notes", id, patch);
        return ok(res, { note: presentNote(patch) });
      }
      if (method === "DELETE") {
        // Refused explicitly rather than left to fall through as a 404: the
        // note is there, and saying "not found" about a note that exists would
        // be a lie the caller could act on.
        throw new HttpError(405, "notes are archived, not deleted");
      }

      // There is deliberately no permanent deletion.
      //
      // The previous attempt asked Resources whether anything referenced the
      // note and then deleted it. Those are two steps with no lock between
      // them, and Resources validates its own reference the same way — check
      // `existsNote`, then persist. A Resource can therefore be accepted
      // against a note that is deleted before the Resource is written, and the
      // audit's probe produced exactly that: two 200s and a dangling
      // reference. Requiring Resources to be reachable only turned an unknown
      // answer into a 503; it never made a true answer stay true.
      //
      // Two boolean existence checks cannot give that guarantee. It needs one
      // authority holding a lock across both writes, which is a larger design
      // than this milestone, and nothing needs it yet: archiving is reversible
      // and 知识存档 restores. So the lifecycle ends at archive, and an
      // unsupported method falls through to the same refusal as any other.
    }

    const lifecycleMatch = sub.match(/^\/notes\/([^/]+)\/(archive|restore)$/u);
    if (lifecycleMatch && method === "POST") {
      const id = decodeId(lifecycleMatch[1]);
      const action = lifecycleMatch[2];
      const body = await readBody(req);
      // The action is the URL, so a body could only disagree with it.
      if (Object.keys(requireObject(body)).length > 0) {
        throw new HttpError(400, "archive and restore bodies must be empty");
      }
      const existing = await getRecord("notes", id);
      if (!existing) throw new HttpError(404, "note not found");
      const status = existing.status ?? "active";
      const next = { ...existing, updatedAt: Date.now() };
      if (action === "archive") {
        if (status !== "active") throw new HttpError(409, "note is already archived");
        next.status = "archived";
        next.archivedFrom = status;
        next.archivedAt = Date.now();
      } else {
        if (status !== "archived") throw new HttpError(409, "only an archived note can be restored");
        next.status = next.archivedFrom ?? "active";
        next.archivedFrom = null;
        next.archivedAt = null;
      }
      await put("notes", id, next);
      return ok(res, { note: presentNote(next) });
    }

    const versionsMatch = sub.match(/^\/notes\/([^/]+)\/versions$/u);
    if (versionsMatch && method === "GET") {
      const id = decodeId(versionsMatch[1]);
      if (!(await getRecord("notes", id))) throw new HttpError(404, "note not found");
      const versions = (await loadTable("note_versions"))
        .filter((version) => version.noteId === id)
        .sort((a, b) => Number(b.savedAt) - Number(a.savedAt));
      return ok(res, { versions });
    }

    if (sub === "/tags" && method === "POST") {
      const body = await readBody(req);
      const tag = {
        id: randomUUID(),
        name: boundedString(body.name, "name", MAX_NAME_CHARS),
        color: body.color === undefined ? "#6B7280" : boundedString(body.color, "color", 7),
        createdAt: Date.now(),
      };
      if (!HEX_COLOR_PATTERN.test(tag.color)) throw new HttpError(400, "color must be a six-digit hex value");
      await put("tags", tag.id, tag);
      return ok(res, { tag });
    }

    const tagMatch = sub.match(/^\/tags\/([^/]+)$/u);
    if (tagMatch && method === "DELETE") {
      const id = decodeId(tagMatch[1]);
      if (!(await getRecord("tags", id))) throw new HttpError(404, "tag not found");
      await del("tags", id);
      for (const note of await loadTable("notes")) {
        if ((note.tagIds ?? []).includes(id)) {
          await put("notes", note.id, { ...note, tagIds: note.tagIds.filter((tagId) => tagId !== id) });
        }
      }
      return ok(res);
    }

    throw new HttpError(404, "not found");
  }

  ctx.effect(() => () => {
    const pending = unitPromise;
    unitPromise = null;
    if (pending) {
      void pending.then((opened) => opened.close?.()).catch((error) => {
        ctx.logger?.warn?.(`dsh-notebook: failed to close storage: ${error?.message ?? error}`);
      });
    }
  }, "dsh-notebook: storage lifecycle");

  ctx.effect(() => ctx.webServer.register({
    kind: "prefix",
    path: PREFIX,
    async handler(req, res) {
      try {
        const method = String(req.method ?? "GET").toUpperCase();
        // Reject a cross-origin mutation before parsing or routing, so an
        // untrusted caller cannot reach body validation or storage at all.
        // Reads stay available: no ACAO header is sent, so a cross-origin
        // caller cannot read the response.
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
        ctx.logger?.warn?.(`dsh-notebook: request failed: ${error?.stack ?? error}`);
        fail(res, 500, "internal server error");
      }
    },
  }), "dsh-notebook: api");
}

export { inject, name };
