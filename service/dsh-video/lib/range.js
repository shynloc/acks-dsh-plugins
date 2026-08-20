export function parseRange(header, size) {
  if (!Number.isSafeInteger(size) || size <= 0) return { status: 416 };
  if (header === undefined || header === null || header === "") {
    return { status: 200, start: 0, end: size - 1, length: size };
  }
  if (typeof header !== "string" || header.includes(",")) return { status: 416 };
  const match = /^bytes=(\d*)-(\d*)$/iu.exec(header.trim());
  if (match === null) return { status: 416 };

  const startText = match[1];
  const endText = match[2];
  if (startText === "" && endText === "") return { status: 416 };

  let start;
  let end;
  if (startText === "") {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { status: 416 };
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(startText);
    if (!Number.isSafeInteger(start) || start < 0 || start >= size) return { status: 416 };
    if (endText === "") {
      end = size - 1;
    } else {
      end = Number(endText);
      if (!Number.isSafeInteger(end) || end < start) return { status: 416 };
      end = Math.min(end, size - 1);
    }
  }
  return { status: 206, start, end, length: end - start + 1 };
}

