import { extname } from "node:path";

export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const VIDEO_MEDIA_TYPES = Object.freeze(["video/mp4", "video/webm"]);

const EXTENSION_MEDIA_TYPES = new Map([
  [".mp4", "video/mp4"],
  [".webm", "video/webm"],
]);

const WEBM_DOCTYPE = Buffer.from("webm", "ascii");

export function expectedMediaType(filePath) {
  return EXTENSION_MEDIA_TYPES.get(extname(filePath).toLowerCase()) ?? null;
}

export function detectMediaType(header) {
  if (!Buffer.isBuffer(header) && !(header instanceof Uint8Array)) return null;
  if (
    header.length >= 12
    && header[4] === 0x66
    && header[5] === 0x74
    && header[6] === 0x79
    && header[7] === 0x70
  ) {
    return "video/mp4";
  }
  if (
    header.length >= 4
    && header[0] === 0x1a
    && header[1] === 0x45
    && header[2] === 0xdf
    && header[3] === 0xa3
    && Buffer.from(header).indexOf(WEBM_DOCTYPE) !== -1
  ) {
    return "video/webm";
  }
  return null;
}

