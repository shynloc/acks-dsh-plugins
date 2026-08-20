/**
 * dsh-card-printer — client plugin.
 *
 * An offline card studio: bounded text in, an SVG preview on screen, and a PNG
 * or SVG file handed to the user. Nothing leaves the browser.
 *
 * The load-bearing safety property is that **user text never becomes markup**.
 * Every glyph is placed as an SVG `<text>` node or drawn with Canvas
 * `fillText`; there is no serialization step, no `foreignObject`, no
 * `innerHTML` and no HTML import. A card therefore cannot carry a script, and
 * an export cannot rasterise one.
 *
 * Layout is a pure function of the draft and a text-measuring callback, so the
 * preview and the export share one geometry rather than two that drift. The
 * preview scales through an SVG `viewBox`, which means resizing the window
 * changes how large the card looks and never what the card *is*: circles stay
 * circular, margins stay proportional, and the exported coordinate system is
 * the authored one at any viewport.
 */
window.__ModuleLoader__.load({
  id: "dsh-card-printer",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var UI = require("@deepseek-ai/dsh-client-ui-primitives");
    var h = React.createElement;

    var WORK_OS_API_KEY = "__ACKS_WORK_OS__";
    var WORK_OS_PENDING_KEY = "__ACKS_WORK_OS_PENDING__";
    var WORK_OS_WAIT_MS = 4000;
    var DESTINATION_ID = "creative.card-printer";
    var API_PREFIX = "/api/card-printer";
    var STYLE_ID = "dsh-card-printer-style";

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
      card: pickIcon("IconImageOutline16", "IconFileOutline16", "IconListPenOutline16"),
      save: pickIcon("IconCheckOutline16", "IconSaveOutline16", "IconListPenOutline16"),
      download: pickIcon("IconDownloadOutline16", "IconArrowDownOutline16", "IconFileOutline16"),
      preset: pickIcon("IconBookmarkOutline16", "IconFolderOutline16", "IconListPenOutline16"),
      remove: pickIcon("IconTrashOutline16", "IconCloseOutline16")
    };

    // ── The frozen contract ─────────────────────────────────────────────────
    //
    // Sizes are the authored output coordinate system. The preview scales, the
    // export multiplies, and neither changes these numbers.

    var CARD_PRESETS = {
      square: { label: "方形 1080×1080", width: 1080, height: 1080 },
      portrait: { label: "竖版 1080×1350", width: 1080, height: 1350 },
      landscape: { label: "横版 1200×630", width: 1200, height: 630 }
    };
    var PRESET_KEYS = ["square", "portrait", "landscape"];

    // A finite table of colour roles. There is no colour input anywhere: a
    // palette name is the only way to choose colours, which is what lets the
    // host validate a stored draft completely.
    var PALETTES = {
      ink: { label: "墨", background: "#12151a", text: "#f5f7fa", accent: "#ff6b1a", muted: "#98a2b3" },
      sand: { label: "砂", background: "#f5efe6", text: "#2b2620", accent: "#c2703d", muted: "#7a6f62" },
      forest: { label: "林", background: "#12211a", text: "#eaf3ee", accent: "#4caf7d", muted: "#8fa89b" },
      dusk: { label: "暮", background: "#1b1730", text: "#f0ecff", accent: "#8b7cf6", muted: "#a49cc4" },
      mono: { label: "素", background: "#ffffff", text: "#111315", accent: "#111315", muted: "#6b7280" }
    };
    var PALETTE_KEYS = ["ink", "sand", "forest", "dusk", "mono"];

    var ALIGNMENTS = { left: "左对齐", center: "居中" };
    var ALIGNMENT_KEYS = ["left", "center"];

    // A local stack only. A remote font would be a network request and would
    // make an export depend on something outside the machine.
    var FONT_STACK = "'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif";

    var BOUNDS = {
      titleSize: { min: 24, max: 120 },
      bodySize: { min: 14, max: 72 },
      padding: { min: 24, max: 200 }
    };

    var LIMITS = { title: 120, body: 2000, footer: 80, presetName: 60 };

    function clamp(value, bounds) {
      var number = Math.round(Number(value));
      if (!isFinite(number)) return bounds.min;
      if (number < bounds.min) return bounds.min;
      if (number > bounds.max) return bounds.max;
      return number;
    }

    // ── Geometry ────────────────────────────────────────────────────────────
    //
    // Pure functions of the draft and a measuring callback. The preview passes
    // an approximate measurer and the export passes the Canvas one, so the two
    // agree by construction instead of by coincidence.

    /**
     * Splits a line into wrappable tokens.
     *
     * Latin text breaks on spaces, but CJK has none — so a run of CJK is broken
     * per character. Without this a Chinese paragraph would be one enormous
     * token and would overflow the card instead of wrapping.
     */
    function tokenize(line) {
      var tokens = [];
      var buffer = "";
      var characters = Array.from(String(line));
      for (var index = 0; index < characters.length; index += 1) {
        var character = characters[index];
        var isCjk = /[⺀-鿿豈-﫿＀-￯]/u.test(character);
        var isSpace = /\s/u.test(character);
        if (isCjk || isSpace) {
          if (buffer) { tokens.push(buffer); buffer = ""; }
          if (isCjk) tokens.push(character);
          else tokens.push(" ");
        } else {
          buffer += character;
        }
      }
      if (buffer) tokens.push(buffer);
      return tokens;
    }

    /**
     * Greedy wrap to a maximum width.
     *
     * Explicit newlines are paragraph breaks and are always honoured; a token
     * wider than the whole line is placed on its own rather than dropped, so no
     * input can make text disappear.
     */
    function wrapText(text, maxWidth, measure) {
      var lines = [];
      String(text == null ? "" : text).split("\n").forEach(function (paragraph) {
        if (paragraph.length === 0) { lines.push(""); return; }
        var current = "";
        tokenize(paragraph).forEach(function (token) {
          if (token === " " && current === "") return;
          var candidate = current + token;
          if (current !== "" && measure(candidate) > maxWidth) {
            lines.push(current.replace(/\s+$/u, ""));
            current = token === " " ? "" : token;
          } else {
            current = candidate;
          }
        });
        lines.push(current.replace(/\s+$/u, ""));
      });
      return lines;
    }

    /**
     * Lays a draft out in the authored coordinate system.
     *
     * Everything downstream — preview and export alike — consumes this, so a
     * card looks the same on screen and in the file.
     */
    function layoutCard(draft, measure) {
      var preset = CARD_PRESETS[draft.preset] || CARD_PRESETS.square;
      var palette = PALETTES[draft.palette] || PALETTES.ink;
      var padding = clamp(draft.padding, BOUNDS.padding);
      var titleSize = clamp(draft.titleSize, BOUNDS.titleSize);
      var bodySize = clamp(draft.bodySize, BOUNDS.bodySize);
      var contentWidth = Math.max(1, preset.width - padding * 2);

      var titleLines = draft.title ? wrapText(draft.title, contentWidth, function (value) {
        return measure(value, titleSize, 700);
      }) : [];
      var bodyLines = draft.body ? wrapText(draft.body, contentWidth, function (value) {
        return measure(value, bodySize, 400);
      }) : [];

      var titleLeading = Math.round(titleSize * 1.25);
      var bodyLeading = Math.round(bodySize * 1.6);
      var accentHeight = Math.max(3, Math.round(titleSize * 0.09));
      var anchor = draft.align === "center" ? "middle" : "start";
      var x = draft.align === "center" ? Math.round(preset.width / 2) : padding;

      var cursor = padding + titleSize;
      var title = titleLines.map(function (line, index) {
        return { text: line, x: x, y: cursor + index * titleLeading };
      });
      if (titleLines.length) cursor += (titleLines.length - 1) * titleLeading + Math.round(titleSize * 0.6);

      var rule = null;
      if (titleLines.length && bodyLines.length) {
        rule = {
          x: draft.align === "center" ? Math.round((preset.width - contentWidth * 0.18) / 2) : padding,
          y: cursor,
          width: Math.round(contentWidth * 0.18),
          height: accentHeight
        };
        cursor += accentHeight + Math.round(bodySize * 1.2);
      }

      var body = bodyLines.map(function (line, index) {
        return { text: line, x: x, y: cursor + index * bodyLeading };
      });

      return {
        width: preset.width,
        height: preset.height,
        palette: palette,
        padding: padding,
        titleSize: titleSize,
        bodySize: bodySize,
        anchor: anchor,
        title: title,
        rule: rule,
        body: body,
        footer: draft.footer
          ? { text: draft.footer, x: x, y: preset.height - padding, size: Math.max(12, Math.round(bodySize * 0.62)) }
          : null,
        // A card that cannot fit its text is still exported; the overflow flag
        // lets the editor warn instead of silently cropping.
        overflows: body.length > 0
          && (body[body.length - 1].y + bodyLeading) > (preset.height - padding * 1.4)
      };
    }

    /**
     * A deterministic width estimate, used for the preview and for tests.
     *
     * It is intentionally approximate: the preview only needs to break lines
     * plausibly, and the export re-measures with the real Canvas metrics.
     */
    function estimateWidth(text, size, weight) {
      var total = 0;
      Array.from(String(text)).forEach(function (character) {
        if (/[⺀-鿿豈-﫿＀-￯]/u.test(character)) total += size;
        else if (/\s/u.test(character)) total += size * 0.28;
        else if (/[iIl1.,;:'!|]/u.test(character)) total += size * 0.3;
        else if (/[A-Z@#%&W]/u.test(character)) total += size * 0.68;
        else total += size * 0.54;
      });
      return weight >= 700 ? total * 1.04 : total;
    }

    /** Bounds an export filename to a safe, predictable shape. */
    function exportFilename(title, extension) {
      var base = String(title || "card")
        .replace(/[\u0000-\u001f\u007f]/gu, "")
        .replace(/[\\/:*?"<>|]/gu, "")
        .replace(/\s+/gu, "-")
        .replace(/^[.-]+/u, "")
        .slice(0, 48);
      if (!base) base = "card";
      return base + "." + extension;
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

    function emptyDraft() {
      return {
        title: "", body: "", footer: "",
        preset: "square", palette: "ink", align: "left",
        titleSize: 64, bodySize: 32, padding: 72
      };
    }

    /** Strips anything the host does not accept, so a save cannot 400 on shape. */
    function draftBody(draft) {
      return {
        title: draft.title || "",
        body: draft.body || "",
        footer: draft.footer || "",
        preset: draft.preset,
        palette: draft.palette,
        align: draft.align,
        titleSize: clamp(draft.titleSize, BOUNDS.titleSize),
        bodySize: clamp(draft.bodySize, BOUNDS.bodySize),
        padding: clamp(draft.padding, BOUNDS.padding)
      };
    }

    function createCardStore() {
      var state = {
        phase: "loading",
        error: null,
        actionError: null,
        notice: null,
        pending: {},
        draft: emptyDraft(),
        presets: [],
        presetName: ""
      };
      var listeners = [];
      var disposed = false;
      var loadStarted = false;
      // Every object URL this plugin creates, so disposal can release them all.
      var objectUrls = [];

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

      function load() {
        if (disposed) return Promise.resolve();
        loadStarted = true;
        patch({ phase: "loading", error: null });
        return request("GET", "/state").then(
          function (payload) {
            patch({
              phase: "ready",
              draft: Object.assign(emptyDraft(), payload.draft || {}),
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
       * Hands a rendered card to the user.
       *
       * The object URL is revoked as soon as the click has been dispatched, so
       * a long session cannot accumulate blobs; the anchor is never added to
       * the document, so nothing user-supplied ever becomes a live link.
       */
      function deliver(blob, filename) {
        if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
        var url = URL.createObjectURL(blob);
        objectUrls.push(url);
        var anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.rel = "noopener";
        anchor.click();
        // Release on the next turn so the browser has taken the blob. Membership
        // is checked first: disposal may already have freed this URL, and
        // revoking twice would mean the release is not exactly-once.
        window.setTimeout(function () {
          var index = objectUrls.indexOf(url);
          if (index < 0) return;
          objectUrls.splice(index, 1);
          URL.revokeObjectURL(url);
        }, 0);
        return true;
      }

      return {
        getState: function () { return state; },
        isPending: function (key) { return !!state.pending[key]; },
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
        setDraft: function (changes) {
          var next = {};
          for (var key in state.draft) {
            if (Object.prototype.hasOwnProperty.call(state.draft, key)) next[key] = state.draft[key];
          }
          for (var change in changes) {
            if (Object.prototype.hasOwnProperty.call(changes, change)) next[change] = changes[change];
          }
          patch({ draft: next, notice: null, actionError: null });
        },
        setPresetName: function (value) { patch({ presetName: value }); },
        saveDraft: function () {
          return run("save", function () {
            return request("PUT", "/draft", draftBody(state.draft));
          }).then(function (payload) {
            if (payload) {
              patch({ draft: Object.assign(emptyDraft(), payload.draft), notice: "草稿已保存。" });
            }
            return payload;
          });
        },
        savePreset: function () {
          var name = String(state.presetName || "").trim();
          if (name.length === 0) {
            patch({ actionError: "请为预设命名。" });
            return Promise.resolve(null);
          }
          return run("preset", function () {
            return request("POST", "/presets", { name: name, draft: draftBody(state.draft) });
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
            draft: Object.assign(emptyDraft(), preset.draft),
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
                presets: state.presets.filter(function (entry) { return entry.id !== preset.id; }),
                notice: null
              });
            }
            return payload;
          });
        },
        exportCard: function (format) {
          var draft = state.draft;
          return run("export:" + format, function () {
            return Promise.resolve().then(function () {
              if (format === "svg") {
                var markup = renderSvgMarkup(layoutCard(draft, estimateWidth));
                if (!deliver(new Blob([markup], { type: "image/svg+xml" }), exportFilename(draft.title, "svg"))) {
                  throw new Error("此浏览器不支持导出。");
                }
                return { ok: true };
              }
              return exportPng(draft).then(function (blob) {
                if (!deliver(blob, exportFilename(draft.title, "png"))) {
                  throw new Error("此浏览器不支持导出。");
                }
                return { ok: true };
              });
            });
          }).then(function (payload) {
            if (payload) patch({ notice: "已导出。" });
            return payload;
          });
        },
        dispose: function () {
          disposed = true;
          listeners.length = 0;
          // Anything still outstanding is released exactly once.
          objectUrls.splice(0).forEach(function (url) {
            try { URL.revokeObjectURL(url); } catch (error) { /* already gone */ }
          });
        }
      };
    }

    // ── Rendering ───────────────────────────────────────────────────────────
    //
    // Two renderers over one layout: React SVG nodes for the preview, and
    // Canvas drawing calls for the export. Neither ever serializes user text
    // into markup that the page will parse.

    /** Escapes text for the standalone SVG file. Only used for a downloaded blob. */
    function escapeXml(value) {
      return String(value == null ? "" : value)
        .replace(/&/gu, "&amp;")
        .replace(/</gu, "&lt;")
        .replace(/>/gu, "&gt;")
        .replace(/"/gu, "&quot;")
        .replace(/'/gu, "&apos;");
    }

    /**
     * Builds a standalone SVG document.
     *
     * This string is only ever put into a Blob and handed to the user — it is
     * never assigned to innerHTML or inserted into this page, so the escaping
     * above protects the *file*, not this document.
     */
    function renderSvgMarkup(layout) {
      var parts = [];
      parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + layout.width
        + '" height="' + layout.height + '" viewBox="0 0 ' + layout.width + " " + layout.height + '">');
      parts.push('<rect width="' + layout.width + '" height="' + layout.height
        + '" fill="' + layout.palette.background + '"/>');
      layout.title.forEach(function (line) {
        parts.push('<text x="' + line.x + '" y="' + line.y + '" fill="' + layout.palette.text
          + '" font-family="' + escapeXml(FONT_STACK) + '" font-size="' + layout.titleSize
          + '" font-weight="700" text-anchor="' + layout.anchor + '">' + escapeXml(line.text) + "</text>");
      });
      if (layout.rule) {
        parts.push('<rect x="' + layout.rule.x + '" y="' + layout.rule.y + '" width="' + layout.rule.width
          + '" height="' + layout.rule.height + '" fill="' + layout.palette.accent + '"/>');
      }
      layout.body.forEach(function (line) {
        parts.push('<text x="' + line.x + '" y="' + line.y + '" fill="' + layout.palette.text
          + '" font-family="' + escapeXml(FONT_STACK) + '" font-size="' + layout.bodySize
          + '" text-anchor="' + layout.anchor + '">' + escapeXml(line.text) + "</text>");
      });
      if (layout.footer) {
        parts.push('<text x="' + layout.footer.x + '" y="' + layout.footer.y + '" fill="'
          + layout.palette.muted + '" font-family="' + escapeXml(FONT_STACK) + '" font-size="'
          + layout.footer.size + '" text-anchor="' + layout.anchor + '">'
          + escapeXml(layout.footer.text) + "</text>");
      }
      parts.push("</svg>");
      return parts.join("");
    }

    /**
     * Draws the card onto a Canvas and resolves a PNG blob.
     *
     * Text is measured with the real Canvas metrics and re-laid out, so the
     * exported file wraps exactly as the font actually renders rather than as
     * the preview estimated. `scale` multiplies the raster only: the authored
     * coordinate system is untouched.
     */
    function exportPng(draft, scale) {
      var ratio = scale || 2;
      var canvas = document.createElement("canvas");
      var context = canvas.getContext && canvas.getContext("2d");
      if (!context) return Promise.reject(new Error("此浏览器不支持导出。"));

      function measure(text, size, weight) {
        context.font = (weight >= 700 ? "700 " : "400 ") + size + "px " + FONT_STACK;
        return context.measureText(String(text)).width;
      }

      var layout = layoutCard(draft, measure);
      canvas.width = Math.round(layout.width * ratio);
      canvas.height = Math.round(layout.height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      context.fillStyle = layout.palette.background;
      context.fillRect(0, 0, layout.width, layout.height);
      context.textAlign = layout.anchor === "middle" ? "center" : "left";
      context.textBaseline = "alphabetic";

      context.fillStyle = layout.palette.text;
      layout.title.forEach(function (line) {
        context.font = "700 " + layout.titleSize + "px " + FONT_STACK;
        context.fillText(line.text, line.x, line.y);
      });
      if (layout.rule) {
        context.fillStyle = layout.palette.accent;
        context.fillRect(layout.rule.x, layout.rule.y, layout.rule.width, layout.rule.height);
      }
      context.fillStyle = layout.palette.text;
      layout.body.forEach(function (line) {
        context.font = "400 " + layout.bodySize + "px " + FONT_STACK;
        context.fillText(line.text, line.x, line.y);
      });
      if (layout.footer) {
        context.fillStyle = layout.palette.muted;
        context.font = "400 " + layout.footer.size + "px " + FONT_STACK;
        context.fillText(layout.footer.text, layout.footer.x, layout.footer.y);
      }

      return new Promise(function (resolve, reject) {
        if (typeof canvas.toBlob === "function") {
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error("导出失败。"));
          }, "image/png");
          return;
        }
        reject(new Error("此浏览器不支持导出。"));
      });
    }

    /**
     * The on-screen preview.
     *
     * `viewBox` plus a percentage width is what makes the preview scale
     * proportionally: the browser fits the authored coordinate system into
     * whatever space the destination has, so a narrow window shrinks the card
     * rather than reflowing it. Every glyph is a `<text>` node.
     */
    function cardPreview(layout) {
      var children = [
        h("rect", {
          key: "bg", x: 0, y: 0, width: layout.width, height: layout.height,
          fill: layout.palette.background
        })
      ];
      layout.title.forEach(function (line, index) {
        children.push(h("text", {
          key: "title-" + index, x: line.x, y: line.y,
          fill: layout.palette.text, fontFamily: FONT_STACK,
          fontSize: layout.titleSize, fontWeight: 700, textAnchor: layout.anchor
        }, line.text));
      });
      if (layout.rule) {
        children.push(h("rect", {
          key: "rule", x: layout.rule.x, y: layout.rule.y,
          width: layout.rule.width, height: layout.rule.height, fill: layout.palette.accent
        }));
      }
      layout.body.forEach(function (line, index) {
        children.push(h("text", {
          key: "body-" + index, x: line.x, y: line.y,
          fill: layout.palette.text, fontFamily: FONT_STACK,
          fontSize: layout.bodySize, textAnchor: layout.anchor
        }, line.text));
      });
      if (layout.footer) {
        children.push(h("text", {
          key: "footer", x: layout.footer.x, y: layout.footer.y,
          fill: layout.palette.muted, fontFamily: FONT_STACK,
          fontSize: layout.footer.size, textAnchor: layout.anchor
        }, layout.footer.text));
      }

      return h("svg", {
        className: "dsh-card-printer-preview",
        "data-card-printer-preview": "",
        viewBox: "0 0 " + layout.width + " " + layout.height,
        preserveAspectRatio: "xMidYMid meet",
        role: "img",
        "aria-label": "卡片预览"
      }, children);
    }

    // ── Presentation ────────────────────────────────────────────────────────

    var STYLE_TEXT = [
      ".dsh-card-printer-root{display:flex;gap:16px;flex-wrap:wrap;height:100%;",
      "padding:16px;box-sizing:border-box;overflow:auto;font-size:14px;",
      "color:var(--dsw-alias-label-primary,#111315)}",
      ".dsh-card-printer-column{flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:10px}",
      ".dsh-card-printer-stage{flex:1 1 380px;min-width:0;display:flex;flex-direction:column;gap:10px}",
      ".dsh-card-printer-input{padding:6px 10px;border-radius:8px;box-sizing:border-box;width:100%;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.18));",
      "background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit}",
      ".dsh-card-printer-input[data-card-printer-body-input]{min-height:120px;resize:vertical}",
      ".dsh-card-printer-field{display:flex;flex-direction:column;gap:4px}",
      ".dsh-card-printer-label{font-size:12px;color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-card-printer-row{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end}",
      ".dsh-card-printer-chip{height:28px;padding:0 10px;border-radius:999px;cursor:pointer;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.18));",
      "background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;font-size:12px}",
      ".dsh-card-printer-chip[aria-pressed='true']{border-color:var(--acks-work-os-orange,#ff6b1a);",
      "background:var(--acks-work-os-orange,#ff6b1a);color:#fff}",
      ".dsh-card-printer-primary{height:30px;padding:0 12px;border-radius:8px;cursor:pointer;",
      "display:inline-flex;align-items:center;gap:4px;border:1px solid transparent;",
      "background:var(--acks-work-os-orange,#ff6b1a);color:#fff;font:inherit;font-size:13px}",
      ".dsh-card-printer-primary[disabled]{opacity:.6;cursor:default}",
      ".dsh-card-printer-action{height:30px;padding:0 12px;border-radius:8px;cursor:pointer;",
      "display:inline-flex;align-items:center;gap:4px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.18));",
      "background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;font-size:13px}",
      ".dsh-card-printer-action[disabled]{opacity:.6;cursor:default}",
      // The preview fits the authored coordinate system into whatever width is
      // available, so resizing never distorts the card.
      // No max-height: clamping the height while the width fills leaves the
      // element box wider than the card, so the drawing letterboxes inside it.
      // With width and an auto height the box is exactly proportional at every
      // viewport, and the stage column scrolls when a tall preset needs it.
      ".dsh-card-printer-preview{width:100%;height:auto;border-radius:10px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12));display:block}",
      ".dsh-card-printer-note{font-size:12px;color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-card-printer-error{margin:0;padding:8px 12px;border-radius:8px;font-size:13px;",
      "border:1px solid rgba(212,83,14,.4);background:rgba(255,107,26,.08);",
      "color:var(--acks-work-os-orange-deep,#d4530e)}",
      ".dsh-card-printer-preset{display:flex;gap:8px;align-items:center;padding:6px 10px;",
      "border-radius:8px;border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12))}",
      ".dsh-card-printer-list{list-style:none;margin:0;padding:0;display:flex;",
      "flex-direction:column;gap:6px}",
      // flex-wrap must be cleared with the direction change. A *column*
      // container that is allowed to wrap breaks into side-by-side columns
      // when its content is taller than the box, which pushed the preview
      // entirely off-screen to the right at 390.
      "@media (max-width:720px){.dsh-card-printer-root{flex-direction:column;flex-wrap:nowrap}}",
      "@media (prefers-reduced-motion:reduce){.dsh-card-printer-preview{transition:none}}"
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

    function field(label, attribute, control) {
      return h("label", { key: attribute, className: "dsh-card-printer-field" }, [
        h("span", { key: "label", className: "dsh-card-printer-label" }, label),
        control
      ]);
    }

    function chipRow(store, state, name, attribute, keys, labels, current) {
      return h("div", {
        key: name,
        className: "dsh-card-printer-row",
        role: "group",
        "aria-label": name
      }, keys.map(function (key) {
        var props = {
          key: key,
          type: "button",
          className: "dsh-card-printer-chip",
          "aria-pressed": current === key,
          onClick: function () {
            var changes = {};
            changes[attribute] = key;
            store.setDraft(changes);
          }
        };
        props["data-card-printer-" + attribute + "-option"] = key;
        return h("button", props, labels[key]);
      }));
    }

    function numberField(store, draft, attribute, label) {
      var bounds = BOUNDS[attribute];
      var props = {
        className: "dsh-card-printer-input",
        type: "number",
        min: bounds.min,
        max: bounds.max,
        step: 1,
        value: draft[attribute],
        "aria-label": label,
        onChange: function (event) {
          var changes = {};
          changes[attribute] = clamp(event.target.value, bounds);
          store.setDraft(changes);
        }
      };
      props["data-card-printer-" + attribute + "-input"] = "";
      return field(label, attribute, h("input", props));
    }

    function CardPrinterSurface(props) {
      var store = props.store;
      var setRevision = React.useState(0)[1];

      React.useEffect(function () {
        return store.subscribe(function () {
          setRevision(function (value) { return value + 1; });
        });
      }, []);

      React.useEffect(function () {
        store.ensureLoaded();
      }, []);

      var state = store.getState();

      if (state.phase === "loading") {
        return h("div", { className: "dsh-card-printer-root", "data-card-printer-view": "loading" },
          h("p", { className: "dsh-card-printer-note" }, "载入中…"));
      }
      if (state.phase === "error") {
        return h("div", { className: "dsh-card-printer-root", "data-card-printer-view": "error" }, [
          h("p", { key: "message", className: "dsh-card-printer-error" }, "加载失败：" + state.error),
          h("button", {
            key: "retry",
            type: "button",
            className: "dsh-card-printer-primary",
            "data-card-printer-action": "retry",
            onClick: function () { store.load(); }
          }, "重试")
        ]);
      }

      var draft = state.draft;
      var layout = layoutCard(draft, estimateWidth);

      var editor = h("div", { key: "editor", className: "dsh-card-printer-column" }, [
        field("标题", "title", h("input", {
          className: "dsh-card-printer-input",
          "data-card-printer-title-input": "",
          type: "text",
          value: draft.title,
          maxLength: LIMITS.title,
          "aria-label": "卡片标题",
          onChange: function (event) { store.setDraft({ title: event.target.value }); }
        })),
        field("正文", "body", h("textarea", {
          className: "dsh-card-printer-input",
          "data-card-printer-body-input": "",
          value: draft.body,
          maxLength: LIMITS.body,
          "aria-label": "卡片正文",
          onChange: function (event) { store.setDraft({ body: event.target.value }); }
        })),
        field("脚注", "footer", h("input", {
          className: "dsh-card-printer-input",
          "data-card-printer-footer-input": "",
          type: "text",
          value: draft.footer,
          maxLength: LIMITS.footer,
          "aria-label": "卡片脚注",
          onChange: function (event) { store.setDraft({ footer: event.target.value }); }
        })),
        chipRow(store, state, "尺寸", "preset", PRESET_KEYS,
          (function () {
            var labels = {};
            PRESET_KEYS.forEach(function (key) { labels[key] = CARD_PRESETS[key].label; });
            return labels;
          })(), draft.preset),
        chipRow(store, state, "配色", "palette", PALETTE_KEYS,
          (function () {
            var labels = {};
            PALETTE_KEYS.forEach(function (key) { labels[key] = PALETTES[key].label; });
            return labels;
          })(), draft.palette),
        chipRow(store, state, "对齐", "align", ALIGNMENT_KEYS, ALIGNMENTS, draft.align),
        h("div", { key: "numbers", className: "dsh-card-printer-row" }, [
          numberField(store, draft, "titleSize", "标题字号"),
          numberField(store, draft, "bodySize", "正文字号"),
          numberField(store, draft, "padding", "边距")
        ])
      ]);

      var presetList = state.presets.length === 0
        ? h("p", { key: "empty", className: "dsh-card-printer-note" }, "暂无预设。")
        : h("ul", { key: "list", className: "dsh-card-printer-list", "data-card-printer-presets": "" },
          state.presets.map(function (preset) {
            return h("li", {
              key: preset.id,
              className: "dsh-card-printer-preset",
              "data-card-printer-preset": preset.id
            }, [
              h("span", { key: "name", style: { flex: 1, minWidth: 0 } }, preset.name),
              h("button", {
                key: "apply",
                type: "button",
                className: "dsh-card-printer-action",
                "data-card-printer-action": "apply-preset",
                "aria-label": "载入预设「" + preset.name + "」",
                onClick: function () { store.applyPreset(preset); }
              }, "载入"),
              h("button", {
                key: "delete",
                type: "button",
                className: "dsh-card-printer-action",
                "data-card-printer-action": "delete-preset",
                "aria-label": "删除预设「" + preset.name + "」",
                disabled: store.isPending(preset.id + ":delete"),
                onClick: function () { store.deletePreset(preset); }
              }, [h(ICONS.remove, { key: "icon", size: 16, "aria-hidden": true }), "删除"])
            ]);
          }));

      var stage = h("div", { key: "stage", className: "dsh-card-printer-stage" }, [
        cardPreview(layout),
        layout.overflows
          ? h("p", {
            key: "overflow",
            className: "dsh-card-printer-note",
            "data-card-printer-overflow": "",
            role: "status",
            "aria-live": "polite"
          }, "正文超出卡片高度，导出时会被裁切。")
          : null,
        h("div", { key: "actions", className: "dsh-card-printer-row" }, [
          h("button", {
            key: "save",
            type: "button",
            className: "dsh-card-printer-primary",
            "data-card-printer-action": "save",
            disabled: store.isPending("save"),
            onClick: function () { store.saveDraft(); }
          }, [h(ICONS.save, { key: "icon", size: 16, "aria-hidden": true }),
            store.isPending("save") ? "保存中…" : "保存草稿"]),
          h("button", {
            key: "png",
            type: "button",
            className: "dsh-card-printer-action",
            "data-card-printer-action": "export-png",
            disabled: store.isPending("export:png"),
            onClick: function () { store.exportCard("png"); }
          }, [h(ICONS.download, { key: "icon", size: 16, "aria-hidden": true }), "导出 PNG"]),
          h("button", {
            key: "svg",
            type: "button",
            className: "dsh-card-printer-action",
            "data-card-printer-action": "export-svg",
            disabled: store.isPending("export:svg"),
            onClick: function () { store.exportCard("svg"); }
          }, [h(ICONS.download, { key: "icon", size: 16, "aria-hidden": true }), "导出 SVG"])
        ]),
        h("div", { key: "presets", className: "dsh-card-printer-row" }, [
          h("input", {
            key: "name",
            className: "dsh-card-printer-input",
            "data-card-printer-preset-name": "",
            type: "text",
            value: state.presetName,
            maxLength: LIMITS.presetName,
            placeholder: "预设名称",
            "aria-label": "预设名称",
            style: { flex: "1 1 140px" },
            onChange: function (event) { store.setPresetName(event.target.value); }
          }),
          h("button", {
            key: "save-preset",
            type: "button",
            className: "dsh-card-printer-action",
            "data-card-printer-action": "save-preset",
            disabled: store.isPending("preset"),
            onClick: function () { store.savePreset(); }
          }, [h(ICONS.preset, { key: "icon", size: 16, "aria-hidden": true }), "存为预设"])
        ]),
        presetList,
        h("div", {
          key: "status",
          "data-card-printer-status": "",
          role: "status",
          "aria-live": "polite"
        }, state.actionError
          ? h("p", { className: "dsh-card-printer-error" }, state.actionError)
          : (state.notice ? h("p", { className: "dsh-card-printer-note" }, state.notice) : null))
      ]);

      return h("div", {
        className: "dsh-card-printer-root",
        "data-card-printer-view": "editor"
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
            label: "Card Printer",
            localized: "卡片工坊",
            order: 30,
            icon: ICONS.card,
            render: function CardPrinterDestination(destinationProps) {
              return h(CardPrinterSurface, {
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

    function CardPrinterNavButton(surface) {
      return function AreasNav() {
        return h("button", {
          type: "button",
          title: "Areas | 领域",
          "aria-label": "Areas | 领域",
          "aria-pressed": surface.isOpen(),
          onClick: function () { surface.toggle(); }
        }, h(ICONS.card, { size: 16, "aria-hidden": true }));
      };
    }

    function apply(ctx) {
      var slots = ctx.slots;
      if (!slots) return;

      var gate = createModeGate();
      var store = createCardStore();
      var surface = createStandaloneSurface();
      var releaseStyles = ensureStyles();

      slots.inject("sidebar.footer.action", function () {
        return bindWhenStandalone(gate, function () {
          return slots.register(
            { name: "sidebar.footer.action", id: "card-printer", order: 170, label: function () { return "Card Printer"; } },
            CardPrinterNavButton(surface)
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
              { name: "conversation", priority: -100, label: function () { return "Card Printer"; } },
              function CardPrinterStandaloneSurface() {
                return h(CardPrinterSurface, { store: store });
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
    exports.inject = ["slots"];
    return module.exports;
  }
});
