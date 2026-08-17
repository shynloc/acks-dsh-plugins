/**
 * MCP servers panel plugin for DeepSeek Harness.
 *
 * Manages MCP server configuration in the web profile's cordis.patch.yml,
 * exposes CRUD + live status over /api/mcp-panel, and relies on the
 * runProfile HMR watcher to hot-reload mcp-client entries after writes.
 *
 * @module dsh-mcp-panel
 */
import yaml from "js-yaml";
import { readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const name = "dsh-mcp-panel";
const inject = ["tools", "loader"];

const API_PREFIX = "/api/mcp-panel";
const MCP_CLIENT_NAME = "@deepseek-ai/dsh-mcp-client";
const BEGIN_MARKER = "# === BEGIN MCP SERVERS (managed by dsh-mcp-panel) ===";
const END_MARKER = "# === END MCP SERVERS ===";
const MAX_BODY_BYTES = 256 * 1024;

const FIBER_STATE = { PENDING: 0, LOADING: 1, ACTIVE: 2, FAILED: 3, DISPOSED: 4, UNLOADING: 5 };
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/** Absolute path of the web profile's user patch file. */
function patchFile() {
  return join(process.env.DSH_HOME || join(homedir(), ".dsh"), "profiles", "web", "cordis.patch.yml");
}

/** Validate a submitted MCP server config (mirrors mcp-client's Config essentials). */
function validateMcpConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("config is required");
  const serverName = config.serverName;
  if (typeof serverName !== "string" || !SERVER_NAME_PATTERN.test(serverName)) {
    throw new Error(`serverName must match ${SERVER_NAME_PATTERN} (got "${serverName}")`);
  }
  if (config.transport === "stdio") {
    if (typeof config.command !== "string" || config.command.trim() === "") throw new Error("stdio transport requires a non-empty command");
  } else if (config.transport === "streamable-http") {
    if (typeof config.url !== "string" || config.url.trim() === "") throw new Error("streamable-http transport requires a non-empty url");
  } else {
    throw new Error('transport must be "stdio" or "streamable-http"');
  }
  return config;
}

/** Parse cordis.patch.yml into a plain JS array (missing file = empty list). */
async function readPatchList() {
  let content;
  try {
    content = await readFile(patchFile(), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const parsed = yaml.load(content);
  return Array.isArray(parsed) ? parsed : [];
}

/** Collect every mcp-client entry from a parsed patch list (top level and insert blocks). */
function collectMcpEntries(patchList) {
  const found = [];
  for (const patch of patchList) {
    if (!patch || typeof patch !== "object") continue;
    if (Array.isArray(patch.insert)) {
      for (const entry of patch.insert) {
        if (entry && entry.name === MCP_CLIENT_NAME) found.push(entry);
      }
    }
    if (patch.name === MCP_CLIENT_NAME) found.push(patch);
  }
  return found;
}

/**
 * Rebuild the file text with the managed MCP block replaced by the given
 * entries. Everything outside the BEGIN/END markers is preserved verbatim
 * (comments and hand-edited patches survive).
 */
function renderPatchedContent(original, mcpEntries) {
  const beginIdx = original.indexOf(BEGIN_MARKER);
  const endIdx = original.indexOf(END_MARKER);

  let before = original;
  let after = "";
  if (beginIdx !== -1 && endIdx !== -1) {
    before = original.slice(0, beginIdx);
    after = original.slice(endIdx + END_MARKER.length);
  }

  const parts = [];
  parts.push(before.replace(/\s+$/, ""));

  if (mcpEntries.length > 0) {
    const block = yaml.dump([{ insert: mcpEntries }], { lineWidth: -1, noRefs: true });
    parts.push("");
    parts.push(BEGIN_MARKER);
    parts.push(block.trimEnd());
    parts.push(END_MARKER);
  }

  if (after.trim() !== "") {
    parts.push("");
    parts.push(after.replace(/^\s+/, ""));
  }

  return parts.join("\n") + "\n";
}

/** Atomically write the patch file (tmp + rename). */
async function writePatchFile(content) {
  const file = patchFile();
  const tmp = `${file}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

/** Serialize one MCP server summary with live status + tool count. */
function serializeServer(ctx, entry) {
  const cfg = entry.config || {};
  const serverName = cfg.serverName;
  const toolCount = countMcpTools(ctx, serverName);
  const status = mcpStatus(ctx, serverName, toolCount);
  return {
    id: entry.id,
    serverName,
    transport: cfg.transport,
    command: cfg.command,
    args: cfg.args,
    env: cfg.env,
    cwd: cfg.cwd,
    url: cfg.url,
    headers: cfg.headers,
    toolCallTimeoutMs: cfg.toolCallTimeoutMs,
    failOnStartupError: cfg.failOnStartupError,
    reconnect: cfg.reconnect,
    status,
    toolCount
  };
}

/** Count tools registered for one MCP server (public name prefix `mcp__<serverName>__`). */
function countMcpTools(ctx, serverName) {
  const prefix = `mcp__${serverName}__`;
  try {
    return ctx.tools.schemas().filter((schema) => schema.name.startsWith(prefix)).length;
  } catch {
    return 0;
  }
}

/** Derive a connection status from the mcp-client fiber state and tool count. */
function mcpStatus(ctx, serverName, toolCount) {
  if (toolCount > 0) return "connected";
  let state;
  try {
    for (const entry of ctx.loader.entries()) {
      if (entry.options?.name === MCP_CLIENT_NAME && entry.options?.config?.serverName === serverName) {
        state = entry.fiber?.state;
        break;
      }
    }
  } catch {
    state = undefined;
  }
  if (state === FIBER_STATE.FAILED) return "error";
  if (state === undefined) return "configured";
  return "connecting";
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(payload);
}

function isSameOrigin(req) {
  const site = req.headers["sec-fetch-site"];
  if (typeof site === "string") return site === "same-origin" || site === "none";
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const host = req.headers.host;
  if (host === undefined) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("invalid JSON body");
  }
}

function apply(ctx) {
  ctx.inject(["webServer"], (httpCtx) => {
    httpCtx.effect(() => httpCtx.webServer.register({
      kind: "prefix",
      path: API_PREFIX,
      async handler(req, res) {
        if (["POST", "PUT", "DELETE"].includes(req.method) && !isSameOrigin(req)) {
          json(res, 403, { ok: false, error: "cross-origin request rejected" });
          return;
        }

        const pathname = new URL(req.url ?? "/", "http://x").pathname;
        const sub = pathname.slice(API_PREFIX.length) || "/";

        try {
          // GET /api/mcp-panel/servers — list with live status
          if ((sub === "/servers" || sub === "/servers/") && req.method === "GET") {
            const patchList = await readPatchList();
            const entries = collectMcpEntries(patchList);
            json(res, 200, { ok: true, servers: entries.map((entry) => serializeServer(httpCtx, entry)) });
            return;
          }

          // POST /api/mcp-panel/servers — add
          if ((sub === "/servers" || sub === "/servers/") && req.method === "POST") {
            const body = await readBody(req);
            const config = validateMcpConfig(body.config);
            const patchList = await readPatchList();
            const entries = collectMcpEntries(patchList);
            if (entries.some((entry) => entry.config?.serverName === config.serverName)) {
              json(res, 409, { ok: false, error: `serverName "${config.serverName}" already exists` });
              return;
            }
            entries.push({ id: `mcp-panel-${config.serverName}`, name: MCP_CLIENT_NAME, config });
            const original = await readFile(patchFile(), "utf8").catch(() => "");
            await writePatchFile(renderPatchedContent(original, entries));
            json(res, 200, { ok: true, serverName: config.serverName });
            return;
          }

          // PUT /api/mcp-panel/servers/:name — update
          const putMatch = sub.match(/^\/servers\/([A-Za-z0-9_-]{1,32})$/);
          if (putMatch && req.method === "PUT") {
            const target = putMatch[1];
            const body = await readBody(req);
            const config = validateMcpConfig(body.config);
            const patchList = await readPatchList();
            const entries = collectMcpEntries(patchList);
            const index = entries.findIndex((entry) => entry.config?.serverName === target);
            if (index === -1) {
              json(res, 404, { ok: false, error: `server "${target}" not found` });
              return;
            }
            entries[index] = { id: `mcp-panel-${config.serverName}`, name: MCP_CLIENT_NAME, config };
            const original = await readFile(patchFile(), "utf8").catch(() => "");
            await writePatchFile(renderPatchedContent(original, entries));
            json(res, 200, { ok: true, serverName: config.serverName });
            return;
          }

          // DELETE /api/mcp-panel/servers/:name — remove
          const deleteMatch = sub.match(/^\/servers\/([A-Za-z0-9_-]{1,32})$/);
          if (deleteMatch && req.method === "DELETE") {
            const target = deleteMatch[1];
            const patchList = await readPatchList();
            const entries = collectMcpEntries(patchList);
            const next = entries.filter((entry) => entry.config?.serverName !== target);
            if (next.length === entries.length) {
              json(res, 404, { ok: false, error: `server "${target}" not found` });
              return;
            }
            const original = await readFile(patchFile(), "utf8").catch(() => "");
            await writePatchFile(renderPatchedContent(original, next));
            json(res, 200, { ok: true });
            return;
          }

          json(res, 404, { ok: false, error: "not found" });
        } catch (error) {
          ctx.logger?.warn?.(`mcp-panel API error: ${error.message}`);
          const status = error.message === "invalid JSON body"
            ? 400
            : error.message === "request body too large" ? 413 : 500;
          json(res, status, { ok: false, error: error.message });
        }
      }
    }), "dsh-mcp-panel: API route");
  });
}

export { apply, inject, isSameOrigin, name };
