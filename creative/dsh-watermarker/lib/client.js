/**
 * dsh-watermarker — client plugin.
 *
 * A watermark composer that runs entirely in the browser. The base image, the
 * optional logo and the output **never leave this page**: nothing is uploaded,
 * nothing is fetched, and the host stores only numbers and a short string.
 *
 * Two properties carry the safety of this plugin:
 *
 *  1. **Validation happens before decoding.** A file's type, byte size and
 *     pixel count are checked before `createImageBitmap` is called, so a hostile
 *     or malformed file is refused rather than handed to the decoder. SVG is
 *     rejected outright: it is a document, not a raster, and can carry script
 *     and external references.
 *  2. **Every handle is released exactly once.** An image bitmap, an object URL
 *     and a canvas are all retained resources; replacing an image or disposing
 *     the plugin frees them, and a test asserts the counts.
 *
 * Geometry is pure. Placement, tiling, rotation and the export dimensions are
 * computed by functions that take numbers and return numbers, so they are
 * tested directly rather than through a canvas.
 */
window.__ModuleLoader__.load({
  id: "dsh-watermarker",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var UI = require("@deepseek-ai/dsh-client-ui-primitives");
    var h = React.createElement;

    var WORK_OS_API_KEY = "__ACKS_WORK_OS__";
    var WORK_OS_PENDING_KEY = "__ACKS_WORK_OS_PENDING__";
    var WORK_OS_WAIT_MS = 4000;
    var DESTINATION_ID = "creative.watermarker";
    var API_PREFIX = "/api/watermarker";
    var STYLE_ID = "dsh-watermarker-style";

    function pickIcon() {
      for (var index = 0; index < arguments.length; index += 1) {
        var candidate = UI[arguments[index]];
        if (typeof candidate === "function") return candidate;
      }
      return function FallbackIcon(props) {
        return h("svg", {
          width: (props && props.size) || 16,
          height: (props && props.size) || 16,
          viewBox: "0 0 16 16",
          "aria-hidden": true,
          focusable: "false"
        });
      };
    }

    var ICONS = {
      mark: pickIcon("IconImageOutline16", "IconFileOutline16", "IconListPenOutline16"),
      download: pickIcon("IconDownloadOutline16", "IconArrowDownOutline16", "IconFileOutline16"),
      reset: pickIcon("IconRefreshOutline16", "IconUndoOutline16"),
      preset: pickIcon("IconBookmarkOutline16", "IconFolderOutline16", "IconListPenOutline16"),
      remove: pickIcon("IconTrashOutline16", "IconCloseOutline16")
    };

    // ── Limits ──────────────────────────────────────────────────────────────
    //
    // Checked before a decoder ever sees the bytes. The pixel caps matter as
    // much as the byte caps: a small file can decode to an enormous bitmap, and
    // that is the shape of a decompression-bomb.

    var LIMITS = {
      base: { bytes: 25 * 1024 * 1024, pixels: 40 * 1000 * 1000, label: "底图" },
      logo: { bytes: 10 * 1024 * 1024, pixels: 16 * 1000 * 1000, label: "水印图片" }
    };
    // v1 accepts these three and nothing else. SVG is a document rather than a
    // raster and can carry script; GIF is animated and would silently lose every
    // frame but one.
    var ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
    var ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(",");
    var MAX_TEXT = 200;
    // Enough for a PNG IHDR, a VP8X/VP8/VP8L WebP header, and a JPEG's leading
    // marker segments up to the start-of-frame.
    var HEADER_BYTES = 64 * 1024;

    var PLACEMENTS = [
      "top-left", "top-center", "top-right",
      "middle-left", "center", "middle-right",
      "bottom-left", "bottom-center", "bottom-right",
      "tiled"
    ];
    var PLACEMENT_LABELS = {
      "top-left": "左上", "top-center": "上中", "top-right": "右上",
      "middle-left": "左中", "center": "居中", "middle-right": "右中",
      "bottom-left": "左下", "bottom-center": "下中", "bottom-right": "右下",
      "tiled": "平铺"
    };
    var FORMATS = ["png", "jpeg", "webp"];
    var FORMAT_LABELS = { png: "PNG", jpeg: "JPEG", webp: "WebP" };
    var FORMAT_MIME = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" };

    var BOUNDS = {
      opacity: { min: 5, max: 100 },
      scale: { min: 2, max: 60 },
      rotation: { min: -180, max: 180 },
      margin: { min: 0, max: 40 },
      tileGap: { min: 5, max: 100 },
      quality: { min: 40, max: 100 }
    };

    var FONT_STACK = "'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif";

    function clamp(value, bounds) {
      var number = Math.round(Number(value));
      if (!isFinite(number)) return bounds.min;
      if (number < bounds.min) return bounds.min;
      if (number > bounds.max) return bounds.max;
      return number;
    }

    // ── Validation ──────────────────────────────────────────────────────────

    /**
     * Checks a file before any decode is attempted.
     *
     * Returns null when acceptable, or a message to show. The MIME type is
     * taken from the File, which the browser derives from the picker — it is
     * not a security boundary on its own, which is why the pixel cap below runs
     * after decoding as well.
     */
    function fileRejection(file, kind) {
      var limit = LIMITS[kind];
      if (!file) return "请选择一个文件。";
      var type = String(file.type || "").toLowerCase();
      if (ACCEPTED_TYPES.indexOf(type) < 0) {
        return limit.label + "只支持 PNG、JPEG 或 WebP。";
      }
      if (typeof file.size === "number" && file.size > limit.bytes) {
        return limit.label + "超过 " + Math.round(limit.bytes / (1024 * 1024)) + " MB 上限。";
      }
      return null;
    }

    /**
     * Checks the decoded dimensions.
     *
     * A file can be small and still decode to a bitmap larger than the cap, so
     * this runs after decoding and before the bitmap is retained.
     */
    function pixelRejection(width, height, kind) {
      var limit = LIMITS[kind];
      var pixels = Number(width) * Number(height);
      if (!isFinite(pixels) || pixels <= 0) return limit.label + "无法解码。";
      if (pixels > limit.pixels) {
        return limit.label + "超过 " + Math.round(limit.pixels / 1000000) + " 百万像素上限。";
      }
      return null;
    }

    /**
     * The true format, from the magic bytes.
     *
     * `File.type` is the picker's guess from the extension and the caller can
     * set it to anything; `createImageBitmap` ignores it entirely and sniffs
     * the content. So the declared type is not a format authority — these bytes
     * are. GIF is recognised specifically so it can be *named* in the refusal
     * rather than falling into the anonymous "unknown" case.
     */
    function sniffFormat(bytes) {
      if (!bytes || bytes.length < 4) return null;
      var b = bytes;
      if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
        && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
      if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
      if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
        && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
      if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "gif";
      return null;
    }

    /**
     * Dimensions from the header, without decoding.
     *
     * This is what actually bounds a decompression bomb: a 400-megapixel PNG
     * has a header of a few dozen bytes, so the byte cap cannot see it and a
     * post-decode check only fires once the browser has already allocated the
     * pixels. Returns null when the header cannot be read, which is itself a
     * refusal — an unparsable header means the decode cannot be bounded.
     *
     * Every read is bounds-checked; a truncated file returns null rather than
     * reading past its end.
     */
    function headerDimensions(bytes) {
      var format = sniffFormat(bytes);
      var b = bytes;

      if (format === "png") {
        // IHDR must be the first chunk: 8 signature + 4 length + 4 type.
        if (b.length < 24) return null;
        if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
        return {
          width: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0,
          height: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0
        };
      }

      if (format === "jpeg") {
        // Walk the marker segments to the start-of-frame. Bounded by the file
        // length and by a segment count, so a malformed file cannot spin.
        var offset = 2;
        var guard = 0;
        while (offset + 9 < b.length && guard < 256) {
          guard += 1;
          if (b[offset] !== 0xff) return null;
          var marker = b[offset + 1];
          // SOF0..SOF15, excluding the non-frame markers DHT/JPG/DAC.
          if (marker >= 0xc0 && marker <= 0xcf
            && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return {
              height: (b[offset + 5] << 8) | b[offset + 6],
              width: (b[offset + 7] << 8) | b[offset + 8]
            };
          }
          var length = (b[offset + 2] << 8) | b[offset + 3];
          if (length < 2) return null;
          offset += 2 + length;
        }
        return null;
      }

      if (format === "webp") {
        if (b.length >= 30 && b[12] === 0x56 && b[13] === 0x50 && b[14] === 0x38 && b[15] === 0x58) {
          // VP8X stores canvas size as 24-bit little-endian, minus one.
          return {
            width: ((b[24] | (b[25] << 8) | (b[26] << 16)) >>> 0) + 1,
            height: ((b[27] | (b[28] << 8) | (b[29] << 16)) >>> 0) + 1
          };
        }
        if (b.length >= 30 && b[12] === 0x56 && b[13] === 0x50 && b[14] === 0x38 && b[15] === 0x20) {
          // Lossy VP8: dimensions live after the start code, 14 bits each.
          return {
            width: ((b[26] | (b[27] << 8)) & 0x3fff),
            height: ((b[28] | (b[29] << 8)) & 0x3fff)
          };
        }
        if (b.length >= 25 && b[12] === 0x56 && b[13] === 0x50 && b[14] === 0x38 && b[15] === 0x4c) {
          // Lossless VP8L: 14 bits each, minus one, starting after the signature.
          var bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
          return {
            width: (bits & 0x3fff) + 1,
            height: ((bits >>> 14) & 0x3fff) + 1
          };
        }
        return null;
      }

      return null;
    }

    /**
     * The pre-decode gate: the file's real format and its declared size.
     *
     * Runs on the first bytes of the file, before `createImageBitmap` is given
     * anything. A file only reaches the decoder if its magic bytes name an
     * accepted raster format, its declared type agrees with those bytes, and
     * its header dimensions are within the cap.
     */
    function headerRejection(bytes, declaredType, kind) {
      var limit = LIMITS[kind];
      var format = sniffFormat(bytes);

      if (format === null || format === "gif") {
        return limit.label + "只支持 PNG、JPEG 或 WebP。";
      }
      // The declared type must agree with the bytes. A disagreement means the
      // file is not what it claims, and accepting it would make the declared
      // type meaningless rather than merely redundant.
      if (FORMAT_MIME[format] !== String(declaredType || "").toLowerCase()) {
        return limit.label + "的类型与内容不一致。";
      }

      var size = headerDimensions(bytes);
      if (!size) return limit.label + "的文件头无法解析。";

      var pixels = size.width * size.height;
      if (!isFinite(pixels) || pixels <= 0) return limit.label + "无法解码。";
      if (pixels > limit.pixels) {
        return limit.label + "超过 " + Math.round(limit.pixels / 1000000) + " 百万像素上限。";
      }
      return null;
    }

    /**
     * The post-decode gate, kept as defence in depth.
     *
     * The header is a claim too. If the decoder produces something larger than
     * the header promised, or over the cap outright, the bitmap is refused and
     * closed rather than trusted.
     */
    function decodedRejection(width, height, expected, kind) {
      var limit = LIMITS[kind];
      var pixels = Number(width) * Number(height);
      if (!isFinite(pixels) || pixels <= 0) return limit.label + "无法解码。";
      if (pixels > limit.pixels) {
        return limit.label + "超过 " + Math.round(limit.pixels / 1000000) + " 百万像素上限。";
      }
      if (expected && (Number(width) !== Number(expected.width) || Number(height) !== Number(expected.height))) {
        return limit.label + "的实际尺寸与文件头不一致。";
      }
      return null;
    }

    // ── Geometry ────────────────────────────────────────────────────────────
    //
    // Pure: numbers in, numbers out. Nothing here touches a canvas, an image or
    // the DOM, so every case below is tested directly.

    /**
     * The anchor point for a single watermark, in image pixels.
     *
     * Margin is a percentage of the shorter edge, so the same setting looks the
     * same on a landscape and a portrait image.
     */
    function placementPoint(placement, imageWidth, imageHeight, marginPercent) {
      var margin = (Math.min(imageWidth, imageHeight) * clamp(marginPercent, BOUNDS.margin)) / 100;
      var left = margin;
      var right = imageWidth - margin;
      var top = margin;
      var bottom = imageHeight - margin;
      var centerX = imageWidth / 2;
      var centerY = imageHeight / 2;

      var horizontal = { left: left, center: centerX, right: right };
      var vertical = { top: top, middle: centerY, bottom: bottom };

      if (placement === "center") return { x: centerX, y: centerY };
      var parts = String(placement).split("-");
      var y = vertical[parts[0]];
      var x = parts[1] === "center" ? centerX : horizontal[parts[1]];
      if (x === undefined || y === undefined) return { x: centerX, y: centerY };
      return { x: x, y: y };
    }

    /**
     * The watermark's drawn size, as a fraction of the image width.
     *
     * Scaling to the image rather than to absolute pixels is what makes one
     * preset look the same on a 1080p and a 4K photo.
     */
    function watermarkSize(imageWidth, scalePercent, aspectRatio) {
      var width = (imageWidth * clamp(scalePercent, BOUNDS.scale)) / 100;
      var ratio = Number(aspectRatio);
      if (!isFinite(ratio) || ratio <= 0) ratio = 1;
      return { width: width, height: width * ratio };
    }

    /**
     * Every anchor point for a tiled watermark.
     *
     * The gap is a percentage of the watermark's own width, so tiles stay
     * proportionally spaced at any scale. The grid is inset by half a step and
     * extended one step past each edge, so a rotated tile still covers the
     * corners instead of leaving them bare.
     */
    function tilePoints(imageWidth, imageHeight, markWidth, markHeight, gapPercent) {
      var gap = (markWidth * clamp(gapPercent, BOUNDS.tileGap)) / 100;
      var stepX = Math.max(1, markWidth + gap);
      var stepY = Math.max(1, markHeight + gap);
      // Counts are computed rather than accumulated, so the loop terminates for
      // any step and the last centre is guaranteed to fall *past* each edge.
      // A centre landing exactly on the edge is not enough: a rotated mark
      // sweeps a larger radius than its half-width and would leave a sliver of
      // the corner bare.
      var startX = -stepX / 2;
      var startY = -stepY / 2;
      // The last centre must be strictly past the far edge, so the index count
      // is floor(span / step) + 2 rather than a ceil: with an exact division a
      // ceil lands the final centre *on* the edge, which is the case that
      // leaves a rotated corner bare.
      var countX = Math.floor((imageWidth - startX) / stepX) + 2;
      var countY = Math.floor((imageHeight - startY) / stepY) + 2;
      var points = [];
      for (var row = 0; row < countY; row += 1) {
        for (var column = 0; column < countX; column += 1) {
          points.push({ x: startX + column * stepX, y: startY + row * stepY });
        }
      }
      return points;
    }

    /**
     * The output canvas dimensions.
     *
     * `ratio` multiplies the raster for a high-DPI export; the drawing stays in
     * image coordinates because the context is transformed instead. The result
     * is clamped so an export cannot exceed the decode cap either.
     */
    function outputDimensions(imageWidth, imageHeight, ratio) {
      var scale = Number(ratio);
      if (!isFinite(scale) || scale < 1) scale = 1;
      if (scale > 4) scale = 4;
      var pixels = imageWidth * imageHeight * scale * scale;
      var cap = LIMITS.base.pixels;
      if (pixels > cap) {
        // Fall back to the largest whole-ish scale that fits rather than
        // refusing the export outright.
        scale = Math.max(1, Math.sqrt(cap / (imageWidth * imageHeight)));
      }
      return {
        scale: scale,
        width: Math.max(1, Math.round(imageWidth * scale)),
        height: Math.max(1, Math.round(imageHeight * scale))
      };
    }

    /** Degrees to radians, for the canvas rotate call. */
    function radians(degrees) {
      return (clamp(degrees, BOUNDS.rotation) * Math.PI) / 180;
    }

    /** Bounds an export filename to a safe, predictable shape. */
    function exportFilename(sourceName, format) {
      var base = String(sourceName || "watermarked")
        .replace(/\.[a-z0-9]+$/iu, "")
        .replace(/[\u0000-\u001f\u007f]/gu, "")
        .replace(/[\\/:*?"<>|]/gu, "")
        .replace(/\s+/gu, "-")
        .replace(/^[.-]+/u, "")
        .slice(0, 48);
      if (!base) base = "watermarked";
      return base + "-wm." + (format === "jpeg" ? "jpg" : format);
    }

    // ── Transport ───────────────────────────────────────────────────────────

    function request(method, path, body) {
      var options = {
        method: method,
        credentials: "same-origin",
        headers: { accept: "application/json" }
      };
      if (body !== undefined) {
        options.headers["content-type"] = "application/json";
        options.body = JSON.stringify(body);
      }
      return fetch(API_PREFIX + path, options).then(function (response) {
        return response.json().then(
          function (payload) {
            if (!response.ok || !payload || payload.ok !== true) {
              var error = new Error((payload && payload.error) || "请求失败");
              error.status = response.status;
              throw error;
            }
            return payload;
          },
          function () {
            throw new Error("服务器返回了无法解析的响应");
          }
        );
      });
    }

    function defaultSettings() {
      return {
        text: "",
        placement: "bottom-right",
        opacity: 55,
        scale: 18,
        rotation: 0,
        margin: 5,
        tileGap: 30,
        format: "png",
        quality: 92
      };
    }

    /** Only numbers and one short string ever travel to the host. */
    function settingsBody(settings) {
      return {
        text: String(settings.text || ""),
        placement: settings.placement,
        opacity: clamp(settings.opacity, BOUNDS.opacity),
        scale: clamp(settings.scale, BOUNDS.scale),
        rotation: clamp(settings.rotation, BOUNDS.rotation),
        margin: clamp(settings.margin, BOUNDS.margin),
        tileGap: clamp(settings.tileGap, BOUNDS.tileGap),
        format: settings.format,
        quality: clamp(settings.quality, BOUNDS.quality)
      };
    }

    function createWatermarkerStore() {
      var state = {
        phase: "loading",
        error: null,
        actionError: null,
        notice: null,
        fileError: null,
        pending: {},
        settings: defaultSettings(),
        presets: [],
        presetName: "",
        // Metadata only. The bitmaps themselves are held outside React state so
        // a render can never retain one.
        base: null,
        logo: null
      };

      var listeners = [];
      var disposed = false;
      var loadStarted = false;

      // Every retained handle. A bitmap and an object URL are resources, not
      // values, so they are tracked explicitly and released exactly once.
      var bitmaps = { base: null, logo: null };
      var objectUrls = [];
      // One counter per slot. Any select, clear or dispose bumps it, which is
      // how an in-flight decode learns it has been superseded.
      var generations = { base: 0, logo: 0 };
      // The encoder is asynchronous too. `canvas.toBlob` can call back long
      // after disposal, and its callback is what creates the object URL and
      // clicks the anchor, so it needs the same invalidation the decodes have.
      var exportGeneration = 0;

      function bumpGeneration(slot) {
        generations[slot] += 1;
        return generations[slot];
      }

      /**
       * Reads only the first bytes of a file.
       *
       * Enough for every header this plugin parses, and deliberately not the
       * whole file: the point of the pre-decode gate is to decide without
       * loading the image.
       */
      function readHeaderBytes(file) {
        var head = typeof file.slice === "function" ? file.slice(0, HEADER_BYTES) : file;
        if (typeof head.arrayBuffer === "function") {
          return head.arrayBuffer().then(function (buffer) { return new Uint8Array(buffer); });
        }
        if (typeof FileReader === "function") {
          return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(new Uint8Array(reader.result)); };
            reader.onerror = function () { reject(new Error("read failed")); };
            reader.readAsArrayBuffer(head);
          });
        }
        return Promise.reject(new Error("no reader"));
      }

      function emit() {
        listeners.slice().forEach(function (listener) {
          try { listener(); } catch (error) { /* one bad subscriber must not stop the rest */ }
        });
      }

      function patch(changes) {
        if (disposed) return;
        for (var key in changes) {
          if (Object.prototype.hasOwnProperty.call(changes, key)) state[key] = changes[key];
        }
        emit();
      }

      function setPending(key, value) {
        var next = {};
        for (var existing in state.pending) {
          if (Object.prototype.hasOwnProperty.call(state.pending, existing)) next[existing] = state.pending[existing];
        }
        if (value) next[key] = true;
        else delete next[key];
        patch({ pending: next });
      }

      /** Releases one slot's bitmap, if any. Safe to call twice. */
      function releaseBitmap(slot) {
        var bitmap = bitmaps[slot];
        if (!bitmap) return;
        bitmaps[slot] = null;
        if (typeof bitmap.close === "function") {
          try { bitmap.close(); } catch (error) { /* already closed */ }
        }
      }

      function releaseUrl(url) {
        var index = objectUrls.indexOf(url);
        if (index < 0) return;
        objectUrls.splice(index, 1);
        try { URL.revokeObjectURL(url); } catch (error) { /* already gone */ }
      }

      function load() {
        if (disposed) return Promise.resolve();
        loadStarted = true;
        patch({ phase: "loading", error: null });
        return request("GET", "/state").then(
          function (payload) {
            patch({
              phase: "ready",
              settings: Object.assign(defaultSettings(), payload.settings || {}),
              presets: payload.presets || [],
              error: null
            });
          },
          function (error) {
            patch({ phase: "error", error: error.message || "加载失败" });
          }
        );
      }

      function ensureLoaded() {
        if (loadStarted) return Promise.resolve();
        return load();
      }

      function run(key, work) {
        if (state.pending[key]) return Promise.resolve(null);
        setPending(key, true);
        return work().then(
          function (payload) {
            setPending(key, false);
            return payload;
          },
          function (error) {
            setPending(key, false);
            patch({ actionError: error.message || "操作失败", notice: null });
            return null;
          }
        );
      }

      /**
         * Validates, decodes and retains one image.
         *
         * The order is the safety property, and the Codex audit corrected it:
         *
         *   1. byte cap and declared type — cheap, on the File alone;
         *   2. **read the first bytes** and decide the real format from the
         *      magic numbers, because `File.type` is caller-controlled and the
         *      decoder ignores it anyway;
         *   3. **read the dimensions from the header** and apply the pixel cap
         *      *before* the decoder is handed anything — this is what bounds a
         *      decompression bomb, since a 400-megapixel PNG has a header of a
         *      few dozen bytes;
         *   4. decode, then re-check the dimensions against the header;
         *   5. only then retain the bitmap.
         *
         * Every step is guarded by a generation token. Selecting, clearing or
         * disposing invalidates whatever is in flight, so a slow decode that
         * resolves after the user moved on closes its bitmap instead of
         * reviving a stale preview or leaking a handle.
         */
      function selectImage(slot, file) {
        // A new selection always supersedes whatever is in flight for this slot.
        var generation = bumpGeneration(slot);

        function stale() {
          return disposed || generations[slot] !== generation;
        }

        /** Applies a refusal, unless something newer already superseded it. */
        function refuse(message) {
          if (stale()) return null;
          releaseBitmap(slot);
          var cleared = {};
          cleared[slot] = null;
          cleared.fileError = message;
          patch(cleared);
          return null;
        }

        var rejection = fileRejection(file, slot);
        if (rejection) return Promise.resolve(refuse(rejection));

        if (typeof createImageBitmap !== "function") {
          patch({ fileError: "此浏览器不支持图片解码。" });
          return Promise.resolve(null);
        }

        // The header is enough to decide: only the first bytes are read, never
        // the whole file.
        return readHeaderBytes(file).then(function (bytes) {
          if (stale()) return null;
          if (!bytes) return refuse(LIMITS[slot].label + "无法读取。");

          var headerError = headerRejection(bytes, file.type, slot);
          if (headerError) return refuse(headerError);
          var expected = headerDimensions(bytes);

          return createImageBitmap(file).then(function (bitmap) {
            // Anything that happened while the decoder was working wins: the
            // bitmap we were just handed is no longer wanted, so close it here
            // rather than letting it outlive the store.
            if (stale()) {
              if (typeof bitmap.close === "function") bitmap.close();
              return null;
            }

            var decodedError = decodedRejection(bitmap.width, bitmap.height, expected, slot);
            if (decodedError) {
              if (typeof bitmap.close === "function") bitmap.close();
              return refuse(decodedError);
            }

            releaseBitmap(slot);
            bitmaps[slot] = bitmap;
            var next = {};
            next[slot] = {
              name: String(file.name || ""),
              type: String(file.type || ""),
              width: bitmap.width,
              height: bitmap.height,
              bytes: Number(file.size) || 0
            };
            next.fileError = null;
            next.notice = null;
            patch(next);
            return next[slot];
          }, function () {
            return refuse(LIMITS[slot].label + "无法解码，请换一张图片。");
          });
        }, function () {
          return refuse(LIMITS[slot].label + "无法读取。");
        });
      }

      function clearImage(slot) {
        // Clearing supersedes an in-flight decode too, so a slow image cannot
        // reappear after the user removed it.
        bumpGeneration(slot);
        releaseBitmap(slot);
        var cleared = {};
        cleared[slot] = null;
        cleared.fileError = null;
        patch(cleared);
      }

      /**
       * Draws the base image and its watermarks onto a context.
       *
       * Shared by the preview and the export so the two cannot disagree. The
       * context is transformed once for the output scale; every coordinate
       * below is in image pixels.
       */
      function compose(context, output) {
        var base = bitmaps.base;
        if (!base) return false;
        var settings = state.settings;

        context.setTransform(output.scale, 0, 0, output.scale, 0, 0);
        context.clearRect(0, 0, state.base.width, state.base.height);
        context.drawImage(base, 0, 0, state.base.width, state.base.height);

        var logo = bitmaps.logo;
        var hasText = String(settings.text || "").trim().length > 0;
        if (!logo && !hasText) return true;

        var ratio = logo && logo.width ? logo.height / logo.width : 1;
        var size = watermarkSize(state.base.width, settings.scale, logo ? ratio : 0.35);
        var angle = radians(settings.rotation);

        // Text is laid out by the font, not by the proportional box: a long
        // string at a given size is far wider than `size.width`. Tiling on the
        // box would overlap every mark, so the drawn width is measured and used
        // as the tile step instead.
        var fontSize = Math.max(8, Math.round(size.height));
        var stepWidth = size.width;
        var stepHeight = size.height;
        if (!logo) {
          context.font = "700 " + fontSize + "px " + FONT_STACK;
          var measured = context.measureText(settings.text);
          stepWidth = Math.max(size.width, (measured && measured.width) || size.width);
          stepHeight = Math.max(size.height, fontSize);
        }

        var points;
        if (settings.placement === "tiled") {
          points = tilePoints(state.base.width, state.base.height, stepWidth, stepHeight, settings.tileGap);
        } else {
          points = [placementPoint(settings.placement, state.base.width, state.base.height, settings.margin)];
        }

        context.save();
        context.globalAlpha = clamp(settings.opacity, BOUNDS.opacity) / 100;
        points.forEach(function (point) {
          context.save();
          // Translate to the anchor and rotate there, so a watermark turns
          // about its own centre rather than about the image origin.
          context.translate(point.x, point.y);
          context.rotate(angle);
          if (logo) {
            context.drawImage(logo, -size.width / 2, -size.height / 2, size.width, size.height);
          } else {
            context.font = "700 " + fontSize + "px " + FONT_STACK;
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillStyle = "#ffffff";
            context.strokeStyle = "rgba(0,0,0,0.35)";
            context.lineWidth = Math.max(1, fontSize / 16);
            // A stroke behind the fill keeps text legible on both a light and
            // a dark photo without asking the user to pick a colour.
            context.strokeText(settings.text, 0, 0);
            context.fillText(settings.text, 0, 0);
          }
          context.restore();
        });
        context.restore();
        return true;
      }

      return {
        getState: function () { return state; },
        isPending: function (key) { return !!state.pending[key]; },
        hasBitmap: function (slot) { return !!bitmaps[slot]; },
        outstandingUrls: function () { return objectUrls.length; },
        subscribe: function (listener) {
          listeners.push(listener);
          var released = false;
          return function () {
            if (released) return;
            released = true;
            var index = listeners.indexOf(listener);
            if (index >= 0) listeners.splice(index, 1);
          };
        },
        load: load,
        ensureLoaded: ensureLoaded,
        compose: compose,
        selectImage: selectImage,
        clearImage: clearImage,
        setSetting: function (key, value) {
          var next = {};
          for (var existing in state.settings) {
            if (Object.prototype.hasOwnProperty.call(state.settings, existing)) {
              next[existing] = state.settings[existing];
            }
          }
          next[key] = BOUNDS[key] ? clamp(value, BOUNDS[key]) : value;
          patch({ settings: next, notice: null, actionError: null });
        },
        reset: function () {
          patch({ settings: defaultSettings(), notice: "已恢复默认设置。", actionError: null });
        },
        setPresetName: function (value) { patch({ presetName: value }); },
        saveSettings: function () {
          return run("settings", function () {
            return request("PUT", "/settings", settingsBody(state.settings));
          }).then(function (payload) {
            if (payload) {
              patch({ settings: Object.assign(defaultSettings(), payload.settings), notice: "设置已保存。" });
            }
            return payload;
          });
        },
        savePreset: function () {
          var presetName = String(state.presetName || "").trim();
          if (presetName.length === 0) {
            patch({ actionError: "请为预设命名。" });
            return Promise.resolve(null);
          }
          return run("preset", function () {
            return request("POST", "/presets", { name: presetName, settings: settingsBody(state.settings) });
          }).then(function (payload) {
            if (payload) {
              patch({
                presets: [payload.preset].concat(state.presets),
                presetName: "",
                notice: "预设已保存。"
              });
            }
            return payload;
          });
        },
        applyPreset: function (preset) {
          patch({
            settings: Object.assign(defaultSettings(), preset.settings),
            notice: "已载入预设「" + preset.name + "」。",
            actionError: null
          });
        },
        deletePreset: function (preset) {
          return run(preset.id + ":delete", function () {
            return request("DELETE", "/presets/" + encodeURIComponent(preset.id));
          }).then(function (payload) {
            if (payload) {
              patch({
                presets: state.presets.filter(function (entry) { return entry.id !== preset.id; })
              });
            }
            return payload;
          });
        },
        /**
         * Renders at full size and hands the file to the user.
         *
         * The canvas is local to this call and dropped immediately, and the
         * object URL is released as soon as the click has been dispatched, so
         * a long session accumulates neither.
         */
        exportImage: function () {
          if (!state.base || !bitmaps.base) {
            patch({ actionError: "请先选择底图。" });
            return Promise.resolve(null);
          }
          var generation = (exportGeneration += 1);
          return run("export", function () {
            var output = outputDimensions(state.base.width, state.base.height, 1);
            var canvas = document.createElement("canvas");
            canvas.width = output.width;
            canvas.height = output.height;
            var context = canvas.getContext && canvas.getContext("2d");
            if (!context) return Promise.reject(new Error("此浏览器无法创建导出画布。"));
            compose(context, output);

            var format = state.settings.format;
            var quality = clamp(state.settings.quality, BOUNDS.quality) / 100;
            return new Promise(function (resolve, reject) {
              if (typeof canvas.toBlob !== "function") {
                reject(new Error("此浏览器不支持导出。"));
                return;
              }
              canvas.toBlob(function (blob) {
                // Anything that happened while the encoder was working wins.
                // Resolving without a payload leaves the caller's `.then` to
                // skip its notice, so a disposed store is neither written to
                // nor handed a file nobody asked for any more.
                if (disposed || exportGeneration !== generation) {
                  resolve(null);
                  return;
                }
                if (!blob) {
                  reject(new Error("导出失败。"));
                  return;
                }
                var url = URL.createObjectURL(blob);
                objectUrls.push(url);
                var anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = exportFilename(state.base.name, format);
                anchor.rel = "noopener";
                anchor.click();
                window.setTimeout(function () { releaseUrl(url); }, 0);
                resolve({ ok: true });
              }, FORMAT_MIME[format] || "image/png", quality);
            });
          }).then(function (payload) {
            if (payload) patch({ notice: "已导出。" });
            return payload;
          });
        },
        dispose: function () {
          disposed = true;
          listeners.length = 0;
          // Invalidate anything still decoding, so a promise that resolves
          // after this point closes its bitmap instead of writing it into a
          // store nobody will read again.
          bumpGeneration("base");
          bumpGeneration("logo");
          exportGeneration += 1;
          releaseBitmap("base");
          releaseBitmap("logo");
          objectUrls.splice(0).forEach(function (url) {
            try { URL.revokeObjectURL(url); } catch (error) { /* already gone */ }
          });
        }
      };
    }

    // ── Presentation ────────────────────────────────────────────────────────

    var STYLE_TEXT = [
      ".dsh-watermarker-root{display:flex;gap:16px;flex-wrap:wrap;height:100%;",
      "padding:16px;box-sizing:border-box;overflow:auto;font-size:14px;",
      "color:var(--dsw-alias-label-primary,#111315)}",
      ".dsh-watermarker-column{flex:1 1 300px;min-width:0;display:flex;flex-direction:column;gap:10px}",
      ".dsh-watermarker-stage{flex:1 1 360px;min-width:0;display:flex;flex-direction:column;gap:10px}",
      ".dsh-watermarker-field{display:flex;flex-direction:column;gap:4px}",
      ".dsh-watermarker-label{font-size:12px;color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-watermarker-input{padding:6px 10px;border-radius:8px;box-sizing:border-box;width:100%;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.18));",
      "background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit}",
      ".dsh-watermarker-row{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}",
      ".dsh-watermarker-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;max-width:180px}",
      ".dsh-watermarker-chip{height:28px;padding:0 10px;border-radius:999px;cursor:pointer;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.18));",
      "background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;font-size:12px}",
      // Selection is marked by border, weight and a check glyph, not by colour
      // alone, so it survives a monochrome or high-contrast rendering.
      ".dsh-watermarker-chip[aria-pressed='true']{border-color:var(--acks-work-os-orange,#ff6b1a);",
      "border-width:2px;font-weight:700;background:var(--acks-work-os-orange,#ff6b1a);color:#fff}",
      ".dsh-watermarker-chip:focus-visible,.dsh-watermarker-primary:focus-visible,",
      ".dsh-watermarker-action:focus-visible,.dsh-watermarker-input:focus-visible{",
      "outline:2px solid var(--acks-work-os-orange,#ff6b1a);outline-offset:2px}",
      ".dsh-watermarker-primary{height:30px;padding:0 12px;border-radius:8px;cursor:pointer;",
      "display:inline-flex;align-items:center;gap:4px;border:1px solid transparent;",
      "background:var(--acks-work-os-orange,#ff6b1a);color:#fff;font:inherit;font-size:13px}",
      ".dsh-watermarker-primary[disabled]{opacity:.6;cursor:default}",
      ".dsh-watermarker-action{height:30px;padding:0 12px;border-radius:8px;cursor:pointer;",
      "display:inline-flex;align-items:center;gap:4px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.18));",
      "background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;font-size:13px}",
      ".dsh-watermarker-action[disabled]{opacity:.6;cursor:default}",
      // width with an auto height keeps the canvas box exactly proportional at
      // every viewport, so a resize never distorts the preview.
      ".dsh-watermarker-canvas{width:100%;height:auto;display:block;border-radius:10px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12));",
      "background:var(--dsw-alias-bg-layer-2,#f3f3f3)}",
      ".dsh-watermarker-note{font-size:12px;color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-watermarker-error{margin:0;padding:8px 12px;border-radius:8px;font-size:13px;",
      "border:1px solid rgba(212,83,14,.4);background:rgba(255,107,26,.08);",
      "color:var(--acks-work-os-orange-deep,#d4530e)}",
      ".dsh-watermarker-list{list-style:none;margin:0;padding:0;display:flex;",
      "flex-direction:column;gap:6px}",
      ".dsh-watermarker-preset{display:flex;gap:8px;align-items:center;padding:6px 10px;",
      "border-radius:8px;border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12))}",
      // A column container must not be allowed to wrap: it would break into
      // side-by-side columns and push the stage off-screen.
      "@media (max-width:720px){.dsh-watermarker-root{flex-direction:column;flex-wrap:nowrap}}",
      "@media (prefers-reduced-motion:reduce){.dsh-watermarker-canvas{transition:none}",
      ".dsh-watermarker-chip{transition:none}}"
    ].join("");

    function ensureStyles() {
      if (typeof document === "undefined" || !document.head) return function () {};
      if (document.getElementById(STYLE_ID)) return function () {};
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = STYLE_TEXT;
      document.head.appendChild(style);
      return function () {
        if (style.parentNode) style.parentNode.removeChild(style);
      };
    }

    function field(label, key, control) {
      return h("label", { key: key, className: "dsh-watermarker-field" }, [
        h("span", { key: "label", className: "dsh-watermarker-label" }, label),
        control
      ]);
    }

    function slider(store, settings, key, label, suffix) {
      var bounds = BOUNDS[key];
      var props = {
        className: "dsh-watermarker-input",
        type: "range",
        min: bounds.min,
        max: bounds.max,
        step: 1,
        value: settings[key],
        "aria-label": label,
        "aria-valuemin": bounds.min,
        "aria-valuemax": bounds.max,
        "aria-valuenow": settings[key],
        onChange: function (event) { store.setSetting(key, event.target.value); }
      };
      props["data-watermarker-" + key + "-input"] = "";
      return field(label + "：" + settings[key] + (suffix || ""), key, h("input", props));
    }

    /** One file input, its constraints stated in text rather than only in the picker. */
    function imagePicker(store, state, slot, label) {
      var chosen = state[slot];
      var limit = LIMITS[slot];
      var inputProps = {
        className: "dsh-watermarker-input",
        type: "file",
        accept: ACCEPT_ATTRIBUTE,
        "aria-label": label,
        "aria-describedby": "dsh-watermarker-" + slot + "-hint",
        onChange: function (event) {
          var files = event.target && event.target.files;
          if (files && files.length) store.selectImage(slot, files[0]);
        }
      };
      inputProps["data-watermarker-" + slot + "-input"] = "";

      var children = [
        h("span", { key: "label", className: "dsh-watermarker-label" }, label),
        h("input", inputProps),
        h("span", {
          key: "hint",
          id: "dsh-watermarker-" + slot + "-hint",
          className: "dsh-watermarker-note"
        }, "PNG / JPEG / WebP，最大 " + Math.round(limit.bytes / (1024 * 1024))
          + " MB、" + Math.round(limit.pixels / 1000000) + " 百万像素")
      ];
      if (chosen) {
        children.push(h("span", {
          key: "chosen",
          className: "dsh-watermarker-note"
        }, chosen.name + "（" + chosen.width + "×" + chosen.height + "）"));
        var clearProps = {
          key: "clear",
          type: "button",
          className: "dsh-watermarker-action",
          "aria-label": "移除" + label,
          onClick: function () { store.clearImage(slot); }
        };
        clearProps["data-watermarker-action"] = "clear-" + slot;
        children.push(h("button", clearProps, [
          h(ICONS.remove, { key: "icon", size: 16, "aria-hidden": true }), "移除"
        ]));
      }

      return h("div", { key: slot, className: "dsh-watermarker-field" }, children);
    }

    function WatermarkerSurface(props) {
      var store = props.store;
      var setRevision = React.useState(0)[1];
      var canvasRef = React.useRef(null);

      React.useEffect(function () {
        return store.subscribe(function () {
          setRevision(function (value) { return value + 1; });
        });
      }, []);

      React.useEffect(function () {
        store.ensureLoaded();
      }, []);

      var state = store.getState();

      // The preview is drawn after every render, from the same compose() the
      // export uses, so the two can never disagree about what the card is.
      React.useEffect(function () {
        var canvas = canvasRef.current;
        if (!canvas || !state.base) return;
        var context = canvas.getContext && canvas.getContext("2d");
        if (!context) return;
        canvas.width = state.base.width;
        canvas.height = state.base.height;
        store.compose(context, { scale: 1, width: state.base.width, height: state.base.height });
      });

      if (state.phase === "loading") {
        return h("div", { className: "dsh-watermarker-root", "data-watermarker-view": "loading" },
          h("p", { className: "dsh-watermarker-note" }, "载入中…"));
      }
      if (state.phase === "error") {
        return h("div", { className: "dsh-watermarker-root", "data-watermarker-view": "error" }, [
          h("p", { key: "message", className: "dsh-watermarker-error" }, "加载失败：" + state.error),
          h("button", {
            key: "retry",
            type: "button",
            className: "dsh-watermarker-primary",
            "data-watermarker-action": "retry",
            onClick: function () { store.load(); }
          }, "重试")
        ]);
      }

      var settings = state.settings;

      var editor = h("div", { key: "editor", className: "dsh-watermarker-column" }, [
        imagePicker(store, state, "base", "底图"),
        imagePicker(store, state, "logo", "水印图片（可选）"),
        field("水印文字", "text", h("input", {
          className: "dsh-watermarker-input",
          "data-watermarker-text-input": "",
          type: "text",
          value: settings.text,
          maxLength: MAX_TEXT,
          placeholder: state.logo ? "已选择水印图片" : "输入水印文字",
          "aria-label": "水印文字",
          disabled: !!state.logo,
          onChange: function (event) { store.setSetting("text", event.target.value); }
        })),
        h("div", { key: "placement", className: "dsh-watermarker-field" }, [
          h("span", { key: "label", className: "dsh-watermarker-label" }, "位置"),
          h("div", {
            key: "grid",
            className: "dsh-watermarker-grid",
            role: "group",
            "aria-label": "水印位置"
          }, PLACEMENTS.map(function (placement) {
            var props = {
              key: placement,
              type: "button",
              className: "dsh-watermarker-chip",
              "aria-pressed": settings.placement === placement,
              "aria-label": PLACEMENT_LABELS[placement],
              onClick: function () { store.setSetting("placement", placement); }
            };
            props["data-watermarker-placement-option"] = placement;
            // Selection is carried by aria-pressed plus a heavier border and
            // weight in CSS. No glyph is used: a check mark is an interface
            // icon, and this plugin draws its icons rather than typing them.
            return h("button", props, PLACEMENT_LABELS[placement]);
          }))
        ]),
        slider(store, settings, "opacity", "不透明度", "%"),
        slider(store, settings, "scale", "大小", "%"),
        slider(store, settings, "rotation", "旋转", "°"),
        settings.placement === "tiled"
          ? slider(store, settings, "tileGap", "平铺间距", "%")
          : slider(store, settings, "margin", "边距", "%")
      ]);

      // Both branches carry the same key because they are one slot in the
      // stage, not two siblings: React must swap them, and a key that differs
      // per branch is a key that can collide with a real sibling.
      var presetList = state.presets.length === 0
        ? h("p", { key: "preset-list", className: "dsh-watermarker-note" }, "暂无预设。")
        : h("ul", { key: "preset-list", className: "dsh-watermarker-list", "data-watermarker-presets": "" },
          state.presets.map(function (preset) {
            return h("li", {
              key: preset.id,
              className: "dsh-watermarker-preset",
              "data-watermarker-preset": preset.id
            }, [
              h("span", { key: "name", style: { flex: 1, minWidth: 0 } }, preset.name),
              h("button", {
                key: "apply",
                type: "button",
                className: "dsh-watermarker-action",
                "data-watermarker-action": "apply-preset",
                "aria-label": "载入预设「" + preset.name + "」",
                onClick: function () { store.applyPreset(preset); }
              }, "载入"),
              h("button", {
                key: "delete",
                type: "button",
                className: "dsh-watermarker-action",
                "data-watermarker-action": "delete-preset",
                "aria-label": "删除预设「" + preset.name + "」",
                disabled: store.isPending(preset.id + ":delete"),
                onClick: function () { store.deletePreset(preset); }
              }, "删除")
            ]);
          }));

      var stage = h("div", { key: "stage", className: "dsh-watermarker-stage" }, [
        state.base
          ? h("canvas", {
            key: "preview",
            ref: canvasRef,
            className: "dsh-watermarker-canvas",
            "data-watermarker-canvas": "",
            role: "img",
            "aria-label": "水印预览"
          })
          : h("p", {
            key: "preview",
            className: "dsh-watermarker-note",
            "data-watermarker-empty": ""
          }, "选择底图后在此预览。"),
        h("div", {
          key: "file-status",
          "data-watermarker-file-status": "",
          role: "status",
          "aria-live": "polite"
        }, state.fileError
          ? h("p", { className: "dsh-watermarker-error" }, state.fileError)
          : null),
        h("div", { key: "format", className: "dsh-watermarker-row" }, [
          field("格式", "format", h("select", {
            className: "dsh-watermarker-input",
            "data-watermarker-format-input": "",
            value: settings.format,
            "aria-label": "导出格式",
            onChange: function (event) { store.setSetting("format", event.target.value); }
          }, FORMATS.map(function (value) {
            return h("option", { key: value, value: value }, FORMAT_LABELS[value]);
          }))),
          settings.format === "png" ? null : slider(store, settings, "quality", "质量", "%")
        ]),
        h("div", { key: "actions", className: "dsh-watermarker-row" }, [
          h("button", {
            key: "export",
            type: "button",
            className: "dsh-watermarker-primary",
            "data-watermarker-action": "export",
            disabled: !state.base || store.isPending("export"),
            onClick: function () { store.exportImage(); }
          }, [h(ICONS.download, { key: "icon", size: 16, "aria-hidden": true }),
            store.isPending("export") ? "导出中…" : "导出图片"]),
          h("button", {
            key: "save",
            type: "button",
            className: "dsh-watermarker-action",
            "data-watermarker-action": "save-settings",
            disabled: store.isPending("settings"),
            onClick: function () { store.saveSettings(); }
          }, "保存设置"),
          h("button", {
            key: "reset",
            type: "button",
            className: "dsh-watermarker-action",
            "data-watermarker-action": "reset",
            onClick: function () { store.reset(); }
          }, [h(ICONS.reset, { key: "icon", size: 16, "aria-hidden": true }), "重置"])
        ]),
        h("div", { key: "presets", className: "dsh-watermarker-row" }, [
          h("input", {
            key: "name",
            className: "dsh-watermarker-input",
            "data-watermarker-preset-name": "",
            type: "text",
            value: state.presetName,
            maxLength: 60,
            placeholder: "预设名称",
            "aria-label": "预设名称",
            style: { flex: "1 1 140px" },
            onChange: function (event) { store.setPresetName(event.target.value); }
          }),
          h("button", {
            key: "save-preset",
            type: "button",
            className: "dsh-watermarker-action",
            "data-watermarker-action": "save-preset",
            disabled: store.isPending("preset"),
            onClick: function () { store.savePreset(); }
          }, [h(ICONS.preset, { key: "icon", size: 16, "aria-hidden": true }), "存为预设"])
        ]),
        presetList,
        h("div", {
          key: "status",
          "data-watermarker-status": "",
          role: "status",
          "aria-live": "polite"
        }, state.actionError
          ? h("p", { className: "dsh-watermarker-error" }, state.actionError)
          : (state.notice ? h("p", { className: "dsh-watermarker-note" }, state.notice) : null))
      ]);

      return h("div", {
        className: "dsh-watermarker-root",
        "data-watermarker-view": "editor"
      }, [editor, stage]);
    }

    // ── Mode gate ───────────────────────────────────────────────────────────

    function createModeGate() {
      var decided = false;
      var workOs = false;
      var listeners = [];
      return {
        isDecided: function () { return decided; },
        isWorkOs: function () { return workOs; },
        decide: function (value) {
          if (decided) return false;
          decided = true;
          workOs = !!value;
          listeners.slice().forEach(function (fn) { fn(); });
          return true;
        },
        subscribe: function (fn) {
          listeners.push(fn);
          var released = false;
          return function () {
            if (released) return;
            released = true;
            var index = listeners.indexOf(fn);
            if (index >= 0) listeners.splice(index, 1);
          };
        }
      };
    }

    // Mounts lazily, and only while standalone holds, so a slot is never
    // registered in the mode that must not own it.
    function bindWhenStandalone(gate, mount) {
      var dispose = null;
      function sync() {
        var active = gate.isDecided() && !gate.isWorkOs();
        if (active && !dispose) {
          dispose = mount();
        } else if (!active && dispose) {
          var current = dispose;
          dispose = null;
          current();
        }
      }
      var unsubscribe = gate.subscribe(sync);
      sync();
      return function () {
        unsubscribe();
        if (dispose) {
          var current = dispose;
          dispose = null;
          current();
        }
      };
    }

    function bindWorkOsDestination(gate, store) {
      var disposeDestination = null;
      var queueEntry = null;
      var timerId = null;

      function adopt(api) {
        if (gate.isDecided() || !api || typeof api.registerDestination !== "function") return;
        try {
          disposeDestination = api.registerDestination({
            id: DESTINATION_ID,
            sectionId: "creative",
            label: "Watermarker",
            localized: "水印工坊",
            order: 30,
            icon: ICONS.mark,
            render: function WatermarkerDestination(destinationProps) {
              return h(WatermarkerSurface, {
                store: store,
                destinationId: destinationProps && destinationProps.destinationId
              });
            }
          });
        } catch (error) {
          // A refused registration must strand nothing: fall back instead.
          disposeDestination = null;
        }
        stopWaiting();
        gate.decide(!!disposeDestination);
      }

      function stopWaiting() {
        if (timerId !== null && typeof window.clearTimeout === "function") {
          window.clearTimeout(timerId);
        }
        timerId = null;
        if (queueEntry) {
          var queue = window[WORK_OS_PENDING_KEY];
          if (queue && typeof queue.indexOf === "function") {
            var index = queue.indexOf(queueEntry);
            if (index >= 0) queue.splice(index, 1);
          }
          queueEntry = null;
        }
      }

      if (window[WORK_OS_API_KEY]) {
        adopt(window[WORK_OS_API_KEY]);
      } else {
        queueEntry = function (api) { adopt(api); };
        window[WORK_OS_PENDING_KEY] = window[WORK_OS_PENDING_KEY] || [];
        window[WORK_OS_PENDING_KEY].push(queueEntry);
        if (typeof window.setTimeout === "function") {
          timerId = window.setTimeout(function () {
            timerId = null;
            stopWaiting();
            gate.decide(false);
          }, WORK_OS_WAIT_MS);
        } else {
          stopWaiting();
          gate.decide(false);
        }
      }

      return function () {
        stopWaiting();
        if (disposeDestination) {
          var dispose = disposeDestination;
          disposeDestination = null;
          dispose();
        }
      };
    }

    // ── Standalone surface ──────────────────────────────────────────────────
    //
    // The centre registration exists only while the surface is open. Registering
    // it permanently would shadow the native conversation forever, and a nav
    // button toggling state nothing subscribes to would do nothing at all.

    function createStandaloneSurface() {
      var open = false;
      var listeners = [];

      function emit() {
        listeners.slice().forEach(function (fn) { fn(); });
      }

      function setOpen(value) {
        var next = !!value;
        if (next === open) return;
        open = next;
        emit();
      }

      return {
        isOpen: function () { return open; },
        toggle: function () { setOpen(!open); },
        setOpen: setOpen,
        subscribe: function (fn) {
          listeners.push(fn);
          var released = false;
          return function () {
            if (released) return;
            released = true;
            var index = listeners.indexOf(fn);
            if (index >= 0) listeners.splice(index, 1);
          };
        },
        bindSurface: function (mount) {
          var dispose = null;
          function sync() {
            if (open && !dispose) {
              dispose = mount();
            } else if (!open && dispose) {
              var current = dispose;
              dispose = null;
              current();
            }
          }
          var unsubscribe = this.subscribe(sync);
          sync();
          return function () {
            unsubscribe();
            if (dispose) {
              var current = dispose;
              dispose = null;
              current();
            }
          };
        }
      };
    }

    function WatermarkerNavButton(surface) {
      return function AreasNav() {
        return h("button", {
          type: "button",
          title: "Areas | 领域",
          "aria-label": "Areas | 领域",
          "aria-pressed": surface.isOpen(),
          onClick: function () { surface.toggle(); }
        }, h(ICONS.mark, { size: 16, "aria-hidden": true }));
      };
    }

    function apply(ctx) {
      var slots = ctx.slots;
      if (!slots) return;

      var gate = createModeGate();
      var store = createWatermarkerStore();
      var surface = createStandaloneSurface();
      var releaseStyles = ensureStyles();

      slots.inject("sidebar.footer.action", function () {
        return bindWhenStandalone(gate, function () {
          return slots.register(
            { name: "sidebar.footer.action", id: "watermarker", order: 180, label: function () { return "Watermarker"; } },
            WatermarkerNavButton(surface)
          );
        });
      });

      slots.inject("conversation", function () {
        // The Work OS handshake lives here so its cleanup is owned by the same
        // slot lifecycle that owns the standalone centre surface.
        var releaseWorkOs = bindWorkOsDestination(gate, store);
        var releaseStandalone = bindWhenStandalone(gate, function () {
          return surface.bindSurface(function () {
            return slots.register(
              { name: "conversation", priority: -100, label: function () { return "Watermarker"; } },
              function WatermarkerStandaloneSurface() {
                return h(WatermarkerSurface, { store: store });
              }
            );
          });
        });
        return function () {
          releaseStandalone();
          releaseWorkOs();
          store.dispose();
          releaseStyles();
        };
      });
    }

    exports.apply = apply;
    // Pure, side-effect-free helpers, exposed so the geometry can be tested
    // as numbers in and numbers out rather than through a canvas. Nothing at
    // runtime reads this: the plugin uses the closure bindings directly.
    exports.geometry = {
      fileRejection: fileRejection,
      pixelRejection: pixelRejection,
      sniffFormat: sniffFormat,
      headerDimensions: headerDimensions,
      headerRejection: headerRejection,
      decodedRejection: decodedRejection,
      placementPoint: placementPoint,
      watermarkSize: watermarkSize,
      tilePoints: tilePoints,
      outputDimensions: outputDimensions,
      radians: radians,
      exportFilename: exportFilename
    };
    exports.inject = ["slots"];
    return module.exports;
  }
});
