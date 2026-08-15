/** Browser settings card for the xAI official Grok Imagine plugin. */
window.__ModuleLoader__.load({
  id: "dsh-xai-imagine",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var h = React.createElement;
    var useEffect = React.useEffect;
    var useState = React.useState;
    var API_KEY_REF = "XAI_API_KEY";

    function button(label, props) {
      return h("button", Object.assign({ type: "button" }, props, { style: Object.assign({ height: 32, padding: "0 14px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l2, #d0d0d0)", background: "transparent", color: "var(--dsw-alias-label-secondary, #555)", cursor: "pointer", fontSize: 13 }, props && props.style) }), label);
    }

    function messageOf(response, fallback) {
      return response && response.result && response.result.error && response.result.error.message ? response.result.error.message : fallback;
    }

    function Card(props) {
      var [draft, setDraft] = useState("");
      var [state, setState] = useState(null);
      var [saving, setSaving] = useState(false);
      var [notice, setNotice] = useState("");
      function refresh() { return props.describeCredential().then(function (value) { setState(value); return value; }); }
      useEffect(function () { var active = true; refresh().catch(function () { if (active) setNotice("无法读取凭据状态"); }); return function () { active = false; }; }, []);
      function mutate(action, success) {
        setSaving(true); setNotice("");
        return action().then(refresh).then(function () { setNotice(success); return true; }).catch(function (error) { setNotice("操作失败：" + (error && error.message ? error.message : String(error))); return false; }).finally(function () { setSaving(false); });
      }
      function save() {
        var value = draft.trim();
        if (!value) { setNotice("请输入 xAI API Key"); return; }
        mutate(function () { return props.setCredential(value); }, "xAI API Key 已安全保存").then(function (saved) { if (saved) setDraft(""); });
      }
      var writable = state ? state.writable : false;
      var configured = Boolean(state && state.configured);
      return h("li", { style: { padding: "12px 0" } },
        h("div", { style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 4 } },
          h("span", { style: { fontSize: 13, fontWeight: 600 } }, "xAI Grok Imagine Image 2.0"),
          h("span", { style: { borderRadius: 999, padding: "1px 8px", fontSize: 11, background: configured ? "#e6f4ea" : "#fff4e5", color: configured ? "#1e7e34" : "#9a6700" } }, configured ? "官方 Key 已配置" : "官方 Key 未配置")),
        h("p", { style: { margin: "0 0 12px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" } }, "提供 generate_xai_image 与 edit_xai_image 工具，固定直连 https://api.x.ai/v1，不经过 OpenAI 中转站。图片默认写入 /workspace/images/。"),
        h("label", { htmlFor: "xai-imagine-api-key", style: { display: "block", marginBottom: 4, fontSize: 13, fontWeight: 500 } }, "xAI API Key" + (configured ? "（输入新值可替换）" : "")),
        h("input", { id: "xai-imagine-api-key", type: "password", autoComplete: "new-password", disabled: saving || !writable, placeholder: configured ? "••••••••（已配置）" : "xai-...", value: draft, onChange: function (event) { setDraft(event.target.value); }, style: { width: "100%", boxSizing: "border-box", height: 34, padding: "0 12px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l2, #d0d0d0)", background: "var(--dsw-alias-bg-layer-3, #fff)", color: "var(--dsw-alias-label-primary, #1a1a1a)", font: "inherit", fontSize: 13 } }),
        h("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8 } },
          button(saving ? "处理中..." : "保存 xAI API Key", { disabled: saving || !writable, onClick: save, style: { background: "var(--dsw-alias-brand-primary, #4a6cf7)", color: "#fff", border: "none" } }),
          configured ? button("清除 xAI API Key", { disabled: saving || !writable, onClick: function () { mutate(props.unsetCredential, "xAI API Key 已清除"); } }) : null,
          notice ? h("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #555)" } }, notice) : null));
    }

    function apply(ctx) {
      var api = ctx.get("connection").api;
      function describeCredential() { return api.credentials.describe({ refs: [API_KEY_REF] }).then(function (response) { if (!response.result.ok) throw new Error(messageOf(response, "凭据状态读取失败")); var value = (response.result.value.credentials || {})[API_KEY_REF]; return { configured: Boolean(value && value.configured), writable: value ? value.writable === true : true }; }); }
      function setCredential(value) { return api.credentials.set({ ref: API_KEY_REF, value: value }).then(function (response) { if (!response.result.ok) throw new Error(messageOf(response, "凭据写入被拒绝")); }); }
      function unsetCredential() { return api.credentials.unset({ ref: API_KEY_REF }).then(function (response) { if (!response.result.ok) throw new Error(messageOf(response, "凭据清除被拒绝")); }); }
      ctx.slots.inject("settings.plugin.item", function () { return ctx.slots.register({ name: "settings.plugin.item", id: "dsh-xai-imagine", order: 32, inject: function () { return { describeCredential: describeCredential, setCredential: setCredential, unsetCredential: unsetCredential }; } }, Card); });
    }
    exports.apply = apply;
    exports.inject = ["slots", "connection"];
    return module.exports;
  }
});
