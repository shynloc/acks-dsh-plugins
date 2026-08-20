/**
 * dsh-watermarker — host plugin.
 *
 * Persists watermark **presets** and nothing else: a name, some text, and a set
 * of bounded numbers and enums. No image ever reaches this host — not the base
 * photo, not the logo, not the output. Decoding, compositing and export happen
 * entirely in the browser.
 *
 * That is the threat boundary, and it is enforced by omission rather than by
 * filtering: there is no upload route, no multipart parser, no binary body and
 * no image field in the schema, so there is no path by which a raster could
 * arrive. A test asserts the absence of each.
 *
 * Defensive posture mirrors the reviewed hosts in this repository.
 */

import { randomUUID } from "node:crypto";

const name = "dsh-watermarker";
const inject = ["webServer", "storage"];

const PREFIX = "/api/watermarker";
const UNIT_NAME = "watermarker";
const UNIT_VERSION = 1;
const SCHEMA_VERSION = 1;
const PRESET_VERSION = 1;
const TABLES = ["presets"];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// A preset is a handful of numbers and one short string, so the body limit is
// deliberately far below anything that could carry an image.
const MAX_BODY_BYTES = 32 * 1024;
const MAX_PRESETS = 50;
const MAX_NAME_CODE_POINTS = 60;
const MAX_TEXT_CODE_POINTS = 200;

const PLACEMENTS = new Set([
  "top-left", "top-center", "top-right",
  "middle-left", "center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right",
  "tiled",
]);
const FORMATS = new Set(["png", "jpeg", "webp"]);

// Every numeric control, with the range the host will accept. The client clamps
// the same ranges, but this is the authority: a preset outside them cannot be
// stored, so a hand-edited file cannot describe a watermark the UI could not.
const NUMBER_BOUNDS = {
  opacity: { min: 5, max: 100, fallback: 55 },
  scale: { min: 2, max: 60, fallback: 18 },
  rotation: { min: -180, max: 180, fallback: 0 },
  margin: { min: 0, max: 40, fallback: 5 },
  tileGap: { min: 5, max: 100, fallback: 30 },
  quality: { min: 40, max: 100, fallback: 92 },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;

const SETTING_FIELDS = [
  "text", "placement", "opacity", "scale", "rotation", "margin", "tileGap", "format", "quality",
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

function boundedText(value, field, maxCodePoints, options = {}) {
  if (value === null || value === undefined) {
    // The required check must precede the empty default, or a *missing* field
    // silently becomes an empty one and the requirement is never enforced.
    if (options.required) throw new HttpError(400, `${field} must be non-empty`);
    return "";
  }
  if (typeof value !== "string") throw new HttpError(400, `${field} must be a string`);
  if (CONTROL_PATTERN.test(value)) throw new HttpError(400, `${field} contains control characters`);
  const trimmed = value.trim();
  if (options.required && trimmed.length === 0) throw new HttpError(400, `${field} must be non-empty`);
  if ([...trimmed].length > maxCodePoints) throw new HttpError(400, `${field} is too long`);
  return trimmed;
}

function readEnum(value, field, allowed, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new HttpError(400, `${field} must be one of ${[...allowed].join(", ")}`);
  }
  return value;
}

/**
 * A bounded integer, refused rather than clamped when out of range.
 *
 * The client clamps before sending, so an out-of-range value here means the
 * caller is not the editor — and silently storing a different number than was
 * sent would hide that.
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

function readSettings(value) {
  const body = requireObject(value ?? {});
  rejectUnknownFields(body, SETTING_FIELDS);
  return {
    text: boundedText(body.text, "text", MAX_TEXT_CODE_POINTS),
    placement: readEnum(body.placement, "placement", PLACEMENTS, "bottom-right"),
    opacity: readBoundedNumber(body.opacity, "opacity"),
    scale: readBoundedNumber(body.scale, "scale"),
    rotation: readBoundedNumber(body.rotation, "rotation"),
    margin: readBoundedNumber(body.margin, "margin"),
    tileGap: readBoundedNumber(body.tileGap, "tileGap"),
    format: readEnum(body.format, "format", FORMATS, "png"),
    quality: readBoundedNumber(body.quality, "quality"),
  };
}

function defaultSettings() {
  return readSettings({});
}

/**
 * Normalizes a stored preset. A storage file can be hand-edited or written by
 * an older version, so each field falls back independently rather than
 * reaching the client unvalidated.
 */
function presentSettings(stored) {
  if (!stored || typeof stored !== "object") return defaultSettings();
  const safe = defaultSettings();
  for (const field of SETTING_FIELDS) {
    try {
      const single = {};
      single[field] = stored[field];
      safe[field] = readSettings(single)[field];
    } catch {
      // Keep the default for this field and carry on with the rest.
    }
  }
  return safe;
}

function readBody(req) {
  const mediaType = String(req.headers?.["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
  // JSON only. There is deliberately no multipart or octet-stream branch: an
  // image has no way to arrive here even as an accident.
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
    version: PRESET_VERSION,
    name: record.name,
    settings: presentSettings(record.settings),
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
  }, "dsh-watermarker: storage lifecycle");

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
      settings: presentSettings(snapshot?.global?.settings),
      presets: snapshot?.tables?.presets ?? {},
    };
  }

  async function saveSettings(body) {
    const settings = readSettings(body);
    const store = await unit();
    await store.setGlobal({ settings });
    return settings;
  }

  async function createPreset(body) {
    rejectUnknownFields(body, ["name", "settings"]);
    const presetName = boundedText(body.name, "name", MAX_NAME_CODE_POINTS, { required: true });
    const settings = readSettings(body.settings ?? {});

    const state = await loadState();
    if (Object.keys(state.presets).length >= MAX_PRESETS) {
      throw new HttpError(409, `preset limit of ${MAX_PRESETS} reached`);
    }

    const now = Date.now();
    const record = {
      id: randomUUID(), version: PRESET_VERSION, name: presetName, settings,
      createdAt: now, updatedAt: now,
    };
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
        settings: state.settings,
        presets: Object.values(state.presets)
          .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
          .map(presentPreset),
      });
      return;
    }

    if (sub === "/settings") {
      if (method !== "PUT") throw new HttpError(405, "method not allowed");
      const body = await readBody(req);
      const settings = await serialize(() => saveSettings(body));
      ok(res, { settings });
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
        ctx.logger?.warn?.(`dsh-watermarker: request failed: ${error?.stack ?? error}`);
        fail(res, 500, "internal server error");
      }
    },
  }), "dsh-watermarker: api");
}

export { apply, inject, name };
