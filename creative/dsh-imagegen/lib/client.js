/**
 * dsh-imagegen browser half.
 *
 * Registers one card inside the official configurable-plugins slot. API Key
 * and Base URL are write-only through DSH's credential plane; neither value
 * enters browser storage or a settings response.
 */
window.__ModuleLoader__.load({
  id: "dsh-imagegen",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var useEffect = React.useEffect;
    var useState = React.useState;
    var h = React.createElement;
    var API_KEY_REF = "IMAGEGEN_API_KEY";
    var BASE_URL_REF = "IMAGEGEN_BASE_URL";
    var DEFAULT_BASE_URL = "https://api.openai.com/v1";
    var BASE_URL_PRESETS = [
      "https://api.openai.com/v1"
    ];

    function input(props) {
      var style = {
        border: "1px solid var(--dsw-alias-border-l2, #d0d0d0)",
        background: "var(--dsw-alias-bg-layer-3, #fff)",
        height: 34,
        font: "inherit",
        color: "var(--dsw-alias-label-primary, #1a1a1a)",
        borderRadius: 8,
        padding: "0 12px",
        fontSize: 13,
        width: "100%",
        boxSizing: "border-box"
      };
      return h("input", Object.assign({}, props, { style: Object.assign(style, props && props.style) }));
    }

    function button(text, props) {
      var style = {
        height: 32,
        padding: "0 14px",
        fontSize: 13,
        borderRadius: 8,
        border: "1px solid var(--dsw-alias-border-l2, #d0d0d0)",
        background: "transparent",
        color: "var(--dsw-alias-label-secondary, #555)",
        cursor: "pointer"
      };
      return h("button", Object.assign({ type: "button" }, props, {
        style: Object.assign(style, props && props.style)
      }), text);
    }

    function messageOf(result, fallback) {
      return result && result.result && result.result.error && result.result.error.message
        ? result.result.error.message
        : fallback;
    }

    function normalizeBaseUrl(value) {
      var url;
      try {
        url = new URL(value.trim());
      } catch (_) {
        throw new Error("Base URL 无效，请输入完整的 https:// 地址");
      }
      var pathname = url.pathname.replace(/\/+$/, "");
      if (url.protocol !== "https:") throw new Error("Base URL 必须使用 https://");
      if (url.username || url.password) throw new Error("Base URL 不得包含用户名或密码");
      if (url.search || url.hash) throw new Error("Base URL 不得包含查询参数或片段");
      if (pathname !== "/v1") throw new Error("Base URL 必须以 /v1 结尾（例如 https://api.openai.com/v1）");
      var port = url.port ? ":" + url.port : "";
      return "https://" + url.hostname + port + "/v1";
    }

    function statusBadge(text, good) {
      return h("span", {
        style: {
          borderRadius: 999,
          padding: "1px 8px",
          fontSize: 11,
          background: good ? "#e6f4ea" : "#fff4e5",
          color: good ? "#1e7e34" : "#9a6700"
        }
      }, text);
    }

    function ImagegenCard(props) {
      var [keyDraft, setKeyDraft] = useState("");
      var [baseUrlDraft, setBaseUrlDraft] = useState("");
      var [view, setView] = useState(null);
      var [saving, setSaving] = useState(false);
      var [notice, setNotice] = useState("");

      function refresh() {
        return props.describeCredentials().then(function (next) {
          setView(next);
          return next;
        });
      }

      useEffect(function () {
        var active = true;
        props.describeCredentials().then(function (next) {
          if (active) setView(next);
        }).catch(function () {
          if (active) setNotice("无法读取凭据状态");
        });
        return function () { active = false; };
      }, []);

      function runMutation(action, successMessage) {
        setSaving(true);
        setNotice("");
        return action().then(refresh).then(function () {
          setNotice(successMessage);
          return true;
        }).catch(function (error) {
          setNotice("操作失败：" + (error && error.message ? error.message : String(error)));
          return false;
        }).finally(function () { setSaving(false); });
      }

      function onSaveKey() {
        var value = keyDraft.trim();
        if (!value) {
          setNotice("请输入 API Key");
          return;
        }
        runMutation(function () { return props.setCredential(API_KEY_REF, value); }, "API Key 已安全保存").then(function (saved) {
          if (saved) setKeyDraft("");
        });
      }

      function onSaveBaseUrl() {
        var value;
        try {
          value = normalizeBaseUrl(baseUrlDraft);
        } catch (error) {
          setNotice(error.message);
          return;
        }
        runMutation(function () { return props.setCredential(BASE_URL_REF, value); }, "Base URL 已保存（不会回显）").then(function (saved) {
          if (saved) setBaseUrlDraft("");
        });
      }

      function onClear(ref, message) {
        runMutation(function () { return props.unsetCredential(ref); }, message);
      }

      var keyView = view && view.apiKey;
      var baseView = view && view.baseUrl;
      var keyWritable = keyView ? keyView.writable : false;
      var baseWritable = baseView ? baseView.writable : false;

      return h("li", { style: { padding: "12px 0" } },
        h("div", { style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 4 } },
          h("span", { style: { fontSize: 13, fontWeight: 600 } }, "dsh-imagegen（OpenAI 生图）"),
          statusBadge(keyView && keyView.configured ? "API Key 已配置" : "API Key 未配置", Boolean(keyView && keyView.configured)),
          statusBadge(baseView && baseView.configured ? "Base URL 已配置" : "使用 OpenAI 默认地址", true)),
        h("p", { style: { margin: "0 0 12px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" } },
          "为对话提供 generate_image 工具，默认使用 gpt-image-2 模型生图，图片写入工作区 /workspace/images/。两个值均通过 DSH 凭据服务写入并且不会回显。"),

        h("label", { htmlFor: "imagegen-api-key", style: { fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 } },
          "API Key" + (keyView && keyView.configured ? "（输入新值可替换）" : "")),
        input({
          id: "imagegen-api-key",
          type: "password",
          autoComplete: "new-password",
          disabled: saving || !keyWritable,
          placeholder: keyView && keyView.configured ? "••••••••（已配置）" : "sk-...",
          value: keyDraft,
          onChange: function (event) { setKeyDraft(event.target.value); }
        }),
        h("div", { style: { display: "flex", gap: 8, alignItems: "center", marginTop: 8, marginBottom: 14 } },
          button(saving ? "处理中…" : "保存 API Key", {
            disabled: saving || !keyWritable,
            onClick: onSaveKey,
            style: { background: "var(--dsw-alias-brand-primary, #4a6cf7)", color: "#fff", border: "none" }
          }),
          keyView && keyView.configured
            ? button("清除 API Key", { disabled: saving || !keyWritable, onClick: function () { onClear(API_KEY_REF, "API Key 已清除"); } })
            : null),

        h("label", { htmlFor: "imagegen-base-url", style: { fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 } },
          "Base URL" + (baseView && baseView.configured ? "（输入新值可替换）" : "（未配置时使用 OpenAI 默认地址）")),
        input({
          id: "imagegen-base-url",
          type: "url",
          list: "imagegen-base-url-presets",
          autoComplete: "off",
          spellCheck: false,
          disabled: saving || !baseWritable,
          placeholder: baseView && baseView.configured ? "已配置；输入新 URL 可替换" : DEFAULT_BASE_URL,
          value: baseUrlDraft,
          onChange: function (event) { setBaseUrlDraft(event.target.value); }
        }),
        h("datalist", { id: "imagegen-base-url-presets" },
          BASE_URL_PRESETS.map(function (url) { return h("option", { key: url, value: url }); })),
        h("p", { style: { margin: "5px 0 8px", fontSize: 11, color: "var(--dsw-alias-label-tertiary, #888)" } },
          "也支持任意 OpenAI 兼容网关（如 Azure OpenAI 的 /v1 端点、硅基流动等），需以 /v1 结尾。"),
        h("div", { style: { display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" } },
          button(saving ? "处理中…" : "保存 Base URL", {
            disabled: saving || !baseWritable,
            onClick: onSaveBaseUrl,
            style: { background: "var(--dsw-alias-brand-primary, #4a6cf7)", color: "#fff", border: "none" }
          }),
          baseView && baseView.configured
            ? button("清除 Base URL", { disabled: saving || !baseWritable, onClick: function () { onClear(BASE_URL_REF, "Base URL 已清除；将恢复 OpenAI 默认地址"); } })
            : null,
          notice ? h("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #555)" } }, notice) : null));
    }

    function apply(ctx) {
      var api = ctx.get("connection").api;

      function describeCredentials() {
        return api.credentials.describe({ refs: [API_KEY_REF, BASE_URL_REF] }).then(function (response) {
          if (!response.result.ok) throw new Error(messageOf(response, "凭据状态读取失败"));
          var credentials = response.result.value.credentials || {};
          var key = credentials[API_KEY_REF];
          var base = credentials[BASE_URL_REF];
          return {
            apiKey: { configured: Boolean(key && key.configured), writable: key ? key.writable === true : true },
            baseUrl: { configured: Boolean(base && base.configured), writable: base ? base.writable === true : true }
          };
        });
      }

      function setCredential(ref, value) {
        return api.credentials.set({ ref: ref, value: value }).then(function (response) {
          if (!response.result.ok) throw new Error(messageOf(response, "凭据写入被拒绝"));
        });
      }

      function unsetCredential(ref) {
        return api.credentials.unset({ ref: ref }).then(function (response) {
          if (!response.result.ok) throw new Error(messageOf(response, "凭据清除被拒绝"));
        });
      }

      ctx.slots.inject("settings.plugin.item", function () {
        return ctx.slots.register({
          name: "settings.plugin.item",
          key: "dsh-imagegen",
          id: "dsh-imagegen",
          order: 31,
          inject: function () {
            return {
              describeCredentials: describeCredentials,
              setCredential: setCredential,
              unsetCredential: unsetCredential
            };
          }
        }, ImagegenCard);
      });
    }

    exports.apply = apply;
    exports.inject = ["slots", "connection"];
    return module.exports;
  }
});
