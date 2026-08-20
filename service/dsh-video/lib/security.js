import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

import { expectedMediaType, MAX_VIDEO_BYTES } from "./media.js";

const MAX_PATH_CHARS = 4096;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const REMOTE_URL = /^[a-z][a-z0-9+.-]*:\/\//iu;
const FILE_URL = /^file:/iu;

function isContained(root, target) {
  const child = relative(root, target);
  return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
}

export async function resolveWorkspacePath(input, options = {}) {
  const workspaceRoot = options.workspaceRoot ?? process.env.DSH_VIDEO_WORKSPACE_ROOT ?? "/workspace";
  const maxBytes = options.maxBytes ?? MAX_VIDEO_BYTES;
  if (typeof input !== "string") throw new Error("video path must be a string");
  const value = input.trim();
  if (value === "") throw new Error("video path must not be empty");
  if (value.length > MAX_PATH_CHARS) throw new Error("video path is too long");
  if (CONTROL_CHARACTERS.test(value)) throw new Error("video path contains invalid control characters");
  if (REMOTE_URL.test(value) || FILE_URL.test(value)) throw new Error("video URL inputs are not allowed; use a file inside /workspace");

  const mediaType = expectedMediaType(value);
  if (mediaType === null) throw new Error("read_video only accepts MP4/WebM files");

  const root = await realpath(workspaceRoot);
  const candidate = isAbsolute(value) ? resolve(value) : resolve(root, value);
  let target;
  try {
    target = await realpath(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`video file was not found: ${value}`);
    throw error;
  }
  if (!isContained(root, target)) throw new Error("video path resolves outside the workspace");

  const info = await stat(target);
  if (!info.isFile()) throw new Error("video path is not a regular file");
  if (info.size <= 0) throw new Error("video file is empty");
  if (info.size > maxBytes) throw new Error("video file is too large; the limit is 200 MiB");

  return {
    realPath: target,
    displayPath: target,
    name: basename(target),
    mediaType,
    bytes: info.size,
  };
}

