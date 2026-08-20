# dsh-watermarker

A watermark composer that runs entirely in the browser.

## The threat boundary

The base image, the optional logo and the output **never leave the page**.
Nothing is uploaded, nothing is fetched, and the host stores only numbers and
one short string.

That boundary holds by **omission rather than by filtering**: the host has no
upload route, no multipart parser, no binary body branch and no image field in
its schema, so there is no path by which a raster could arrive even by accident.
Tests assert the absence of each.

## Research notes — the user's ACKS-Watermarker

The interaction and algorithm ideas were studied from the user's public
`ACKS-Watermarker` repository (`app.js`). **That project was not modified,
deployed or vendored, and none of its code was copied here.**

### Adopted

- **Normalized placement**: anchors are computed as fractions of the image, so a
  preset means the same thing on any resolution.
- **Translate to the anchor, then rotate**, and draw at `-w/2, -h/2`, so a mark
  turns about its own centre rather than the image origin.
- **Size relative to the base width**, so one preset looks the same on a 1080p
  and a 4K photo.
- **Aspect-preserving logo draw** from the logo's own natural ratio.
- **`globalAlpha` with save/restore** around each mark.
- **A pixel check before allocating the export canvas.**

### Rejected

- **Google Fonts loaded from a remote host** — a network request, and this
  plugin must work offline.
- **`image/svg+xml` as an input type.** SVG is a document, not a raster: it can
  carry script and external references. GIF is refused too, because it is
  animated and a single-frame composite would silently discard the rest.
- **200 MB / 500 MB limits.** The caps here are far lower and are paired with
  pixel caps, which is what actually bounds memory.
- **Its inpainting/erase feature** — a much larger surface, out of scope for v1.
- **Its deployment shell** (Dockerfile, nginx, compose) and any iframe.

## Limits

| | Bytes | Pixels |
| --- | ---: | ---: |
| Base image | 25 MiB | 40 megapixels |
| Logo | 10 MiB | 16 megapixels |

Accepted input: **PNG, JPEG, WebP**. Output: the same three.
Watermark text: 200 code points.

**Order matters and is the point.** Type and byte size are checked *before*
`createImageBitmap` is called; the decoded dimensions are checked *before* the
bitmap is retained. A small file that decodes to an enormous bitmap — a
decompression bomb — is caught by the second check and closed immediately.

## Handles are released exactly once

An image bitmap, an object URL and a canvas are resources rather than values.
Replacing an image closes the one it replaced; clearing a slot closes it;
disposal closes both slots and revokes every outstanding URL; and the
release timer checks membership first, so a URL freed by disposal is not revoked
twice. Tests assert each count.

## Geometry is pure

Placement, sizing, tiling, rotation and the export dimensions are functions from
numbers to numbers, exposed on `exports.geometry` so they are tested directly
rather than through a canvas. The tile grid deliberately places centres *past*
every edge: a centre landing exactly on the edge leaves a rotated corner bare,
because a rotated mark sweeps a larger radius than its half-width.
