import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

import { detectMediaType, MAX_VIDEO_BYTES } from "./media.js";
import { parseRange } from "./range.js";

export const VIDEO_ROUTE = "/plugins/dsh-video/media";

const ID_PATTERN = /^[a-f0-9]{64}$/u;
const HEADER_BYTES = 4096;
const OPEN_NOFOLLOW = Number.isInteger(constants.O_NOFOLLOW) ? constants.O_NOFOLLOW : 0;

function plain(res, status, headers = {}) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...headers });
  res.end();
}

async function openStoredVideo(storeDir, id, maxBytes) {
  const handle = await open(join(storeDir, id), constants.O_RDONLY | OPEN_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0 || info.size > maxBytes) throw new Error("invalid stored video");
    const header = Buffer.alloc(Math.min(info.size, HEADER_BYTES));
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const mediaType = detectMediaType(header.subarray(0, bytesRead));
    if (mediaType === null) throw new Error("invalid stored video container");
    return { handle, size: info.size, mediaType };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

export function createVideoHandler(options = {}) {
  const storeDir = options.storeDir;
  const maxBytes = options.maxBytes ?? MAX_VIDEO_BYTES;
  if (typeof storeDir !== "string" || storeDir === "") throw new Error("video store directory is not configured");

  return async function videoHandler(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      plain(res, 405, { Allow: "GET, HEAD" });
      return;
    }

    let pathname;
    try {
      pathname = new URL(req.url ?? "/", "http://dsh.invalid").pathname;
    } catch {
      plain(res, 404);
      return;
    }
    const suffix = pathname.slice(VIDEO_ROUTE.length);
    const match = /^\/([a-f0-9]{64})$/u.exec(suffix);
    if (!pathname.startsWith(VIDEO_ROUTE) || match === null || !ID_PATTERN.test(match[1])) {
      plain(res, 404);
      return;
    }

    let stored;
    try {
      stored = await openStoredVideo(storeDir, match[1], maxBytes);
    } catch {
      plain(res, 404);
      return;
    }

    const selection = parseRange(req.headers.range, stored.size);
    if (selection.status === 416) {
      await stored.handle.close().catch(() => {});
      plain(res, 416, {
        "accept-ranges": "bytes",
        "content-range": `bytes */${stored.size}`,
        "x-content-type-options": "nosniff",
      });
      return;
    }

    const headers = {
      "content-type": stored.mediaType,
      "content-length": selection.length,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-disposition": "inline",
    };
    if (selection.status === 206) {
      headers["content-range"] = `bytes ${selection.start}-${selection.end}/${stored.size}`;
    }
    res.writeHead(selection.status, headers);
    if (req.method === "HEAD") {
      await stored.handle.close().catch(() => {});
      res.end();
      return;
    }

    try {
      const stream = stored.handle.createReadStream({
        start: selection.start,
        end: selection.end,
        autoClose: true,
      });
      await pipeline(stream, res);
    } catch {
      await stored.handle.close().catch(() => {});
      if (!res.destroyed) res.destroy();
    }
  };
}
