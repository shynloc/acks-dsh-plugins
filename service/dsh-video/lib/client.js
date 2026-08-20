/** Browser-side native player for the read_video keyed tool slot. */
window.__ModuleLoader__.load({
  id: "dsh-video",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var h = React.createElement;
    var MAX_VIDEO_BYTES = 200 * 1024 * 1024;
    var HASH = /^[a-f0-9]{64}$/;
    var BAD_NAME = /[\u0000-\u001f\u007f/\\]/;

    var cardStyle = {
      width: "min(100%, 760px)",
      boxSizing: "border-box",
      border: "1px solid var(--dsw-alias-border-l2, #d5d5d5)",
      borderRadius: 12,
      padding: 12,
      background: "var(--dsw-alias-bg-layer-2, #fafafa)",
      color: "var(--dsw-alias-label-primary, #1f1f1f)",
    };
    var headerStyle = {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 10,
      fontSize: 13,
    };
    var nameStyle = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 };
    var metaStyle = { flex: "none", color: "var(--dsw-alias-label-tertiary, #777)", fontSize: 12 };
    var videoStyle = { display: "block", width: "100%", maxHeight: "480px", borderRadius: 8, background: "#000" };
    var downloadStyle = {
      display: "inline-flex",
      alignItems: "center",
      marginTop: 10,
      minHeight: 30,
      padding: "0 12px",
      border: "1px solid var(--dsw-alias-border-l2, #d0d0d0)",
      borderRadius: 8,
      color: "var(--dsw-alias-label-primary, #1f1f1f)",
      textDecoration: "none",
      fontSize: 13,
    };
    var stateStyle = {
      padding: "8px 10px",
      borderRadius: 8,
      background: "var(--dsw-alias-bg-layer-2, #fafafa)",
      color: "var(--dsw-alias-label-secondary, #555)",
      fontSize: 13,
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    };

    function validateVideoMeta(meta) {
      if (typeof meta !== "object" || meta === null || meta.kind !== "dsh-video" || meta.version !== 1) return null;
      var video = meta.video;
      if (typeof video !== "object" || video === null) return null;
      if (typeof video.id !== "string" || !HASH.test(video.id)) return null;
      if (video.mediaType !== "video/mp4" && video.mediaType !== "video/webm") return null;
      if (!Number.isSafeInteger(video.bytes) || video.bytes <= 0 || video.bytes > MAX_VIDEO_BYTES) return null;
      if (typeof video.name !== "string" || video.name.length < 1 || video.name.length > 180 || BAD_NAME.test(video.name)) return null;
      return { id: video.id, mediaType: video.mediaType, bytes: video.bytes, name: video.name };
    }

    function resultText(block) {
      if (!block || !Array.isArray(block.content)) return "";
      return block.content.filter(function (part) { return part && part.type === "text" && typeof part.text === "string"; })
        .map(function (part) { return part.text; }).join("\n").slice(0, 4000);
    }

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KiB";
      return (bytes / (1024 * 1024)).toFixed(1) + " MiB";
    }

    function VideoToolCard(props) {
      var block = props.block;
      if (!block || !("kind" in block)) {
        return h("div", { style: stateStyle, role: "status" }, "正在准备视频…");
      }
      var text = resultText(block);
      if (block.isError) {
        return h("div", { style: Object.assign({}, stateStyle, { color: "var(--dsw-alias-state-error-primary, #b42318)" }), role: "alert" }, text || "视频读取失败");
      }
      var video = validateVideoMeta(block.meta);
      if (video === null) {
        return h("div", { style: stateStyle }, text || "视频结果缺少可验证的播放信息");
      }
      var url = "/plugins/dsh-video/media/" + video.id;
      return h("section", { style: cardStyle, "aria-label": "视频：" + video.name },
        h("div", { style: headerStyle },
          h("span", { style: nameStyle, title: video.name }, video.name),
          h("span", { style: metaStyle }, video.mediaType.replace("video/", "").toUpperCase() + " · " + formatBytes(video.bytes))
        ),
        h("video", { style: videoStyle, controls: true, preload: "metadata", playsInline: true },
          h("source", { src: url, type: video.mediaType }),
          "当前浏览器无法播放此视频。"
        ),
        h("a", { style: downloadStyle, href: url, download: video.name }, "下载视频")
      );
    }

    function apply(ctx) {
      ctx.slots.inject("tool.call.toolview", function () {
        return ctx.slots.register({ name: "tool.call.toolview", key: "read_video" }, VideoToolCard);
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    exports.VideoToolCard = VideoToolCard;
    exports.validateVideoMeta = validateVideoMeta;
    return module.exports;
  },
});
