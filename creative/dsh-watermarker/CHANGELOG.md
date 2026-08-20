# dsh-watermarker

Changes that a consumer of this package would notice. Entries cover releases
only; work that happened while a version was being built is not a change to it.

## 0.1.1

- Fixed: the accepted format is decided by the file's magic bytes, not by
  `File.type`. The declared type is the picker's guess from the extension,
  the caller can set it to anything, and `createImageBitmap` ignores it —
  real Edge decodes a GIF declared `image/png`. A declared type that
  disagrees with the bytes is refused.
- Fixed: image dimensions are read from the header and capped **before**
  anything reaches the decoder. A 20000x20000 PNG has a header of a few dozen
  bytes, so no byte cap can see it, and the previous post-decode check only
  fired once the browser had already allocated the pixels. That check remains
  as defence in depth against a header that lies.
- Fixed: each image slot and the encoder carry a generation token. A decode or
  encode that resolves after the user cleared the slot, chose another file, or
  left closes its bitmap and creates no object URL or download, instead of
  reviving a stale preview or acting after teardown.
- Fixed: a second selection made while one is decoding is honoured. It was
  previously dropped with no preview and no message.
- Fixed: the preview and its placeholder are mutually exclusive. Both were
  present in the real DOM because two sibling elements shared a React key,
  which reconciles the wrong pair and orphans a node.
- Fixed: the same-origin fallback compares the origin's scheme, not only its
  host.
