import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, unlink } from "node:fs/promises";
import { join } from "node:path";

import { detectMediaType, MAX_VIDEO_BYTES } from "./media.js";
import { resolveWorkspacePath } from "./security.js";

const COPY_BUFFER_BYTES = 64 * 1024;
const HEADER_BYTES = 4096;
const OPEN_NOFOLLOW = Number.isInteger(constants.O_NOFOLLOW) ? constants.O_NOFOLLOW : 0;

function abortError() {
  const error = new Error("video import aborted");
  error.name = "AbortError";
  return error;
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}

async function writeAll(handle, buffer, length) {
  let offset = 0;
  while (offset < length) {
    const result = await handle.write(buffer, offset, length - offset, null);
    if (result.bytesWritten <= 0) throw new Error("video store write made no progress");
    offset += result.bytesWritten;
  }
}

async function readHeader(handle, size) {
  const header = Buffer.alloc(Math.min(size, HEADER_BYTES));
  const { bytesRead } = await handle.read(header, 0, header.length, 0);
  return header.subarray(0, bytesRead);
}

async function verifyExistingObject(path, expected) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== expected.bytes) {
    throw new Error("existing video store object failed validation");
  }
  const handle = await open(path, "r");
  try {
    const header = await readHeader(handle, info.size);
    if (detectMediaType(header) !== expected.mediaType) {
      throw new Error("existing video store object has an invalid container");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let position = 0;
    while (position < info.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, info.size - position), position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (position !== info.size || hash.digest("hex") !== expected.id) {
      throw new Error("existing video store object failed its content hash");
    }
  } finally {
    await handle.close();
  }
}

export async function storeVideo(input, options = {}) {
  const workspaceRoot = options.workspaceRoot ?? process.env.DSH_VIDEO_WORKSPACE_ROOT ?? "/workspace";
  const storeDir = options.storeDir ?? process.env.DSH_VIDEO_STORE_DIR;
  const maxBytes = options.maxBytes ?? MAX_VIDEO_BYTES;
  const signal = options.signal;
  if (typeof storeDir !== "string" || storeDir === "") throw new Error("video store directory is not configured");

  await mkdir(storeDir, { recursive: true, mode: 0o700 });
  const storeInfo = await lstat(storeDir);
  if (!storeInfo.isDirectory() || storeInfo.isSymbolicLink()) throw new Error("video store path is not a private directory");
  await chmod(storeDir, 0o700);
  checkAbort(signal);

  const source = await resolveWorkspacePath(input, { workspaceRoot, maxBytes });
  checkAbort(signal);
  const sourceHandle = await open(source.realPath, constants.O_RDONLY | OPEN_NOFOLLOW);
  let temporaryHandle;
  let temporaryPath;
  try {
    const sourceInfo = await sourceHandle.stat();
    if (!sourceInfo.isFile()) throw new Error("video path is not a regular file");
    if (sourceInfo.size <= 0) throw new Error("video file is empty");
    if (sourceInfo.size > maxBytes) throw new Error("video file is too large; the limit is 200 MiB");

    const header = await readHeader(sourceHandle, sourceInfo.size);
    const detected = detectMediaType(header);
    if (detected === null || detected !== source.mediaType) {
      throw new Error(`video container does not match the ${source.mediaType} filename extension`);
    }

    checkAbort(signal);
    temporaryPath = join(storeDir, `.tmp-${process.pid}-${randomUUID()}`);
    temporaryHandle = await open(temporaryPath, "wx", 0o600);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    const copiedHeader = Buffer.alloc(HEADER_BYTES);
    let copiedHeaderBytes = 0;
    let total = 0;
    while (true) {
      checkAbort(signal);
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, total);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw new Error("video file grew beyond the 200 MiB limit while reading");
      if (copiedHeaderBytes < copiedHeader.length) {
        const take = Math.min(bytesRead, copiedHeader.length - copiedHeaderBytes);
        buffer.copy(copiedHeader, copiedHeaderBytes, 0, take);
        copiedHeaderBytes += take;
      }
      hash.update(buffer.subarray(0, bytesRead));
      await writeAll(temporaryHandle, buffer, bytesRead);
    }
    if (total === 0) throw new Error("video file is empty");
    if (detectMediaType(copiedHeader.subarray(0, copiedHeaderBytes)) !== source.mediaType) {
      throw new Error("video container changed while the file was being read");
    }
    await temporaryHandle.sync();
    await temporaryHandle.close();
    temporaryHandle = undefined;

    const id = hash.digest("hex");
    const finalPath = join(storeDir, id);
    try {
      await link(temporaryPath, finalPath);
      await chmod(finalPath, 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await verifyExistingObject(finalPath, { id, bytes: total, mediaType: detected });
    }
    await unlink(temporaryPath);
    temporaryPath = undefined;
    checkAbort(signal);

    return {
      path: source.displayPath,
      video: {
        id,
        mediaType: detected,
        bytes: total,
        name: source.name.slice(0, 180),
      },
    };
  } finally {
    if (temporaryHandle !== undefined) await temporaryHandle.close().catch(() => {});
    if (temporaryPath !== undefined) await unlink(temporaryPath).catch(() => {});
    await sourceHandle.close().catch(() => {});
  }
}
