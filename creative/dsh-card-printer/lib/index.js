/**
 * dsh-card-printer — host plugin.
 *
 * Persists one bounded card draft and a small set of named presets, and nothing
 * else. Composition, preview and export all happen in the browser; this host
 * never renders, rasterises, fetches or writes an image.
 *
 * Every stored field is an enum or a bounded number or bounded text. There is
 * deliberately no font URL, background URL, colour string, CSS field or HTML
 * field, so a stored draft can be fully validated here and can never carry
 * markup to the client. That is what makes the export path safe: there is no
 * value in storage that could become a script or a remote request.
 *
 * Defensive posture mirrors the reviewed hosts in this repository.
 */

import { randomUUID } from "node:crypto";

const name = "dsh-card-printer";
const inject = ["webServer", "storage"];

const PREFIX = "/api/card-printer";
// The runtime's storage unit names must match /^[a-z][a-z0-9_]*$/ — no
// hyphens. The plugin, its route and its storage file all read "card printer",
// but the unit itself has to spell it with an underscore, so the file on disk
// is card_printer.json.
const UNIT_NAME = "card_printer";
const UNIT_VERSION = 1;
const SCHEMA_VERSION = 1;
const DRAFT_VERSION = 1;
const TABLES = ["presets"];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const MAX_BODY_BYTES = 128 * 1024;
const MAX_PRESETS = 50;
const MAX_PRESET_NAME_CODE_POINTS = 60;
const MAX_TITLE_CODE_POINTS = 120;
const MAX_BODY_CODE_POINTS = 2_000;
const MAX_FOOTER_CODE_POINTS = 80;

const PRESETS = new Set(["square", "portrait", "landscape"]);
const PALETTES = new Set(["ink", "sand", "forest", "dusk", "mono"]);
const ALIGNMENTS = new Set(["left", "center"]);

// Bounded numeric ranges. The client clamps too, but the host is the authority:
// a value outside these cannot be stored, so a hand-edited storage file cannot
// produce a card the editor could never have made.
const NUMBER_BOUNDS = {
  titleSize: { min: 24, max: 120, fallback: 64 },
  bodySize: { min: 14, max: 72, fallback: 32 },
  padding: { min: 24, max: 200, fallback: 72 },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
// A card body is authored text, so the three whitespace controls are allowed
// through it and nothing else is.
const BODY_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

const DRAFT_FIELDS = [
  "title", "body", "footer", "preset", "palette", "align", "titleSize", "bodySize", "padding",
];

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
 * Bounded text that may be empty. A card legitimately has no footer, so an
 * empty string is a value rather than a validation failure.
 *
 * Control characters are checked on the exact caller string, before trimming,
 * because trimming first would silently accept a leading newline.
 */
function boundedText(value, field, maxCodePoints, options = {}) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new HttpError(400, `${field} must be a string`);
  const pattern = options.multiline ? BODY_CONTROL_PATTERN : CONTROL_PATTERN;
  if (pattern.test(value)) throw new HttpError(400, `${field} contains control characters`);
  const normalized = options.multiline ? value : value.trim();
  if ([...normalized].length > maxCodePoints) throw new HttpError(400, `${field} is too long`);
  return normalized;
}

function readEnum(value, field, allowed, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new HttpError(400, `${field} must be one of ${[...allowed].join(", ")}`);
  }
  return value;
}

/**
 * A bounded integer. Out-of-range is refused rather than clamped: silently
 * storing a different number than the caller sent is how a client and a host
 * drift apart about what the card looks like.
 */
function readBoundedNumber(value, field) {
  const bounds = NUMBER_BOUNDS[field];
  if (value === null || value === undefined) return bounds.fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HttpError(400, `${field} must be an integer`);
  }
  if (value < bounds.min || value > bounds.max) {
    throw new HttpError(400, `${field} must be between ${bounds.min} and ${bounds.max}`);
  }
  return value;
}

function rejectUnknownFields(body, allowed) {
  for (const field of Object.keys(body)) {
    if (!allowed.includes(field)) throw new HttpError(400, `${field} is not editable`);
  }
}

/**
 * Validates a whole draft.
 *
 * `version` is server-owned: a client that could set it could claim an older
 * shape and skip a future migration.
 */
function readDraft(value) {
  const body = requireObject(value);
  if (body.version !== undefined) throw new HttpError(400, "version is assigned by the server");
  rejectUnknownFields(body, DRAFT_FIELDS);
  return {
    version: DRAFT_VERSION,
    title: boundedText(body.title, "title", MAX_TITLE_CODE_POINTS),
    body: boundedText(body.body, "body", MAX_BODY_CODE_POINTS, { multiline: true }),
    footer: boundedText(body.footer, "footer", MAX_FOOTER_CODE_POINTS),
    preset: readEnum(body.preset, "preset", PRESETS, "square"),
    palette: readEnum(body.palette, "palette", PALETTES, "ink"),
    align: readEnum(body.align, "align", ALIGNMENTS, "left"),
    titleSize: readBoundedNumber(body.titleSize, "titleSize"),
    bodySize: readBoundedNumber(body.bodySize, "bodySize"),
    padding: readBoundedNumber(body.padding, "padding"),
  };
}

function emptyDraft() {
  return {
    version: DRAFT_VERSION,
    title: "",
    body: "",
    footer: "",
    preset: "square",
    palette: "ink",
    align: "left",
    titleSize: NUMBER_BOUNDS.titleSize.fallback,
    bodySize: NUMBER_BOUNDS.bodySize.fallback,
    padding: NUMBER_BOUNDS.padding.fallback,
  };
}

/**
 * Normalizes whatever is on disk into a valid draft.
 *
 * A storage file is not a trusted input: it can be hand-edited, restored from a
 * backup or written by an older version. Anything that does not validate falls
 * back to the default rather than reaching the client.
 */
function presentDraft(stored) {
  if (!stored || typeof stored !== "object") return emptyDraft();
  const safe = emptyDraft();
  for (const field of DRAFT_FIELDS) {
    try {
      const single = {};
      single[field] = stored[field];
      const validated = readDraft(single);
      safe[field] = validated[field];
    } catch {
      // Keep the default for this field and carry on with the rest.
    }
  }
  return safe;
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

function presentPreset(record) {
  return {
    id: record.id,
    name: record.name,
    draft: presentDraft(record.draft),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
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
        hasGlobal: true,
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
  }, "dsh-card-printer: storage lifecycle");

  // One promise chain serializes every mutation, so a draft save and a preset
  // write cannot interleave into a half-applied storage file.
  let queue = Promise.resolve();
  function serialize(operation) {
    const result = queue.then(operation);
    queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function loadState() {
    const store = await unit();
    const snapshot = await store.loadAll();
    return {
      draft: presentDraft(snapshot?.global?.draft),
      presets: snapshot?.tables?.presets ?? {},
    };
  }

  async function saveDraft(body) {
    const draft = readDraft(body);
    const store = await unit();
    await store.setGlobal({ draft });
    return draft;
  }

  async function createPreset(body) {
    rejectUnknownFields(body, ["name", "draft"]);
    const name_ = boundedText(body.name, "name", MAX_PRESET_NAME_CODE_POINTS);
    if (name_.length === 0) throw new HttpError(400, "name must be non-empty");
    const draft = readDraft(body.draft ?? {});

    const state = await loadState();
    if (Object.keys(state.presets).length >= MAX_PRESETS) {
      throw new HttpError(409, `preset limit of ${MAX_PRESETS} reached`);
    }

    const now = Date.now();
    const record = { id: randomUUID(), name: name_, draft, createdAt: now, updatedAt: now };
    const store = await unit();
    await store.putRecord("presets", record.id, record);
    return record;
  }

  async function deletePreset(id) {
    const state = await loadState();
    if (!state.presets[id]) throw new HttpError(404, "preset not found");
    const store = await unit();
    await store.deleteRecord("presets", id);
  }

  async function route(method, sub, req, res) {
    if (sub === "/state") {
      if (method !== "GET") throw new HttpError(405, "method not allowed");
      const state = await loadState();
      ok(res, {
        schemaVersion: SCHEMA_VERSION,
        draft: state.draft,
        presets: Object.values(state.presets)
          .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
          .map(presentPreset),
      });
      return;
    }

    if (sub === "/draft") {
      if (method !== "PUT") throw new HttpError(405, "method not allowed");
      const body = await readBody(req);
      const draft = await serialize(() => saveDraft(body));
      ok(res, { draft });
      return;
    }

    if (sub === "/presets") {
      if (method !== "POST") throw new HttpError(405, "method not allowed");
      const body = await readBody(req);
      const record = await serialize(() => createPreset(body));
      ok(res, { preset: presentPreset(record) });
      return;
    }

    const detail = /^\/presets\/([^/]+)$/u.exec(sub);
    if (detail) {
      // A named preset is a convenience, not a record of work, so deleting one
      // is the one destructive operation this repository allows — and it is
      // scoped to this plugin's own storage.
      if (method !== "DELETE") throw new HttpError(405, "method not allowed");
      const id = decodeId(detail[1]);
      await serialize(() => deletePreset(id));
      ok(res);
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
        ctx.logger?.warn?.(`dsh-card-printer: request failed: ${error?.stack ?? error}`);
        fail(res, 500, "internal server error");
      }
    },
  }), "dsh-card-printer: api");
}

export { apply, inject, name };
