/** Browser settings card for the GitHub plugin (token + default repo). */
window.__ModuleLoader__.load({
  id: "dsh-github",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var h = React.createElement;
    var useEffect = React.useEffect;
    var useState = React.useState;
    var TOKEN_REF = "GITHUB_TOKEN";
    var DEFAULT_REPO_REF = "GITHUB_DEFAULT_REPO";

    function button(label, props) {
      return h("button", Object.assign({ type: "button" }, props, { style: Object.assign({ height: 32, padding: "0 14px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l2, #d0d0d0)", background: "transparent", color: "var(--dsw-alias-label-secondary, #555)", cursor: "pointer", fontSize: 13 }, props && props.style) }), label);
    }

    function Card(props) {
      var [tokenDraft, setTokenDraft] = useState("");
      var [repoDraft, setRepoDraft] = useState("");
      var [state, setState] = useState(null);
      var [saving, setSaving] = useState(false);
      var [notice, setNotice] = useState("");

      function refresh() {
        return props.describeCredential().then(function (value) { setState(value); return value; });
      }
      useEffect(function () { var active = true; refresh().catch(function () { if (active) setNotice("无法读取凭据状态"); }); return function () { active = false; }; }, []);

      function mutate(action, success) {
        setSaving(true); setNotice("");
        return action().then(refresh).then(function () { setNotice(success); return true; }).catch(function (error) { setNotice("操作失败：" + (error && error.message ? error.message : String(error))); return false; }).finally(function () { setSaving(false); });
      }

      function saveToken() {
        var value = tokenDraft.trim();
        if (!value) { setNotice("请输入 GitHub Token"); return; }
        mutate(function () { return props.setToken(value); }, "GitHub Token 已保存").then(function (saved) { if (saved) setTokenDraft(""); });
      }
      function saveRepo() {
        var value = repoDraft.trim();
        if (!value) { setNotice("请输入默认仓库（owner/repo）"); return; }
        if (!/^[^/\s]+\/[^/\s]+$/.test(value)) { setNotice("格式应为 owner/repo"); return; }
        mutate(function () { return props.setDefaultRepo(value); }, "默认仓库已保存").then(function (saved) { if (saved) setRepoDraft(""); });
      }

      var writable = state ? state.writable : false;
      var tokenConfigured = Boolean(state && state.tokenConfigured);
      var repoConfigured = Boolean(state && state.repoConfigured);
      var defaultRepo = state ? state.defaultRepo : "";

      return h("li", { style: { padding: "12px 0" } },
        h("div", { style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 4 } },
          h("span", { style: { fontSize: 13, fontWeight: 600 } }, "GitHub"),
          h("span", { style: { borderRadius: 999, padding: "1px 8px", fontSize: 11, background: tokenConfigured ? "#e6f4ea" : "#fff4e5", color: tokenConfigured ? "#1e7e34" : "#9a6700" } }, tokenConfigured ? "Token 已配置" : "Token 未配置")),
        h("p", { style: { margin: "0 0 12px", fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)" } }, "提供 github_* 系列工具（仓库、issue、PR、文件、release、搜索等），直连 api.github.com。需 GitHub Personal Access Token（repo + workflow 权限）。"),

        h("label", { htmlFor: "github-token", style: { display: "block", marginBottom: 4, fontSize: 13, fontWeight: 500 } }, "GitHub Token" + (tokenConfigured ? "（输入新值可替换）" : "")),
        h("input", { id: "github-token", type: "password", autoComplete: "new-password", disabled: saving || !writable, placeholder: tokenConfigured ? "••••••••（已配置）" : "ghp_...", value: tokenDraft, onChange: function (event) { setTokenDraft(event.target.value); }, style: { width: "100%", boxSizing: "border-box", height: 34, padding: "0 12px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l2, #d0d0d0)", background: "var(--dsw-alias-bg-layer-3, #fff)", color: "var(--dsw-alias-label-primary, #1a1a1a)", font: "inherit", fontSize: 13 } }),
        h("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 16 } },
          button(saving ? "处理中..." : "保存 Token", { disabled: saving || !writable, onClick: saveToken, style: { background: "var(--dsw-alias-brand-primary, #4a6cf7)", color: "#fff", border: "none" } }),
          tokenConfigured ? button("清除 Token", { disabled: saving || !writable, onClick: function () { mutate(props.unsetToken, "Token 已清除"); } }) : null),

        h("label", { htmlFor: "github-default-repo", style: { display: "block", marginBottom: 4, fontSize: 13, fontWeight: 500 } }, "默认仓库（owner/repo，可选）"),
        h("input", { id: "github-default-repo", type: "text", disabled: saving || !writable, placeholder: repoConfigured ? defaultRepo : "例如 octocat/Hello-World", value: repoDraft, onChange: function (event) { setRepoDraft(event.target.value); }, style: { width: "100%", boxSizing: "border-box", height: 34, padding: "0 12px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l2, #d0d0d0)", background: "var(--dsw-alias-bg-layer-3, #fff)", color: "var(--dsw-alias-label-primary, #1a1a1a)", font: "inherit", fontSize: 13 } }),
        h("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8 } },
          button(saving ? "处理中..." : "保存默认仓库", { disabled: saving || !writable, onClick: saveRepo, style: { background: "var(--dsw-alias-brand-primary, #4a6cf7)", color: "#fff", border: "none" } }),
          repoConfigured ? button("清除默认仓库", { disabled: saving || !writable, onClick: function () { mutate(props.unsetDefaultRepo, "默认仓库已清除"); } }) : null,
          notice ? h("span", { style: { fontSize: 12, color: "var(--dsw-alias-label-secondary, #555)" } }, notice) : null));
    }

    function apply(ctx) {
      var api = ctx.get("connection").api;
      function readCreds(response) {
        if (!response.result.ok) throw new Error("凭据状态读取失败");
        var creds = response.result.value.credentials || {};
        var token = creds[TOKEN_REF];
        var repo = creds[DEFAULT_REPO_REF];
        return {
          writable: (token ? token.writable === true : true) && (repo ? repo.writable === true : true),
          tokenConfigured: Boolean(token && token.configured),
          repoConfigured: Boolean(repo && repo.configured),
          defaultRepo: repo && typeof repo.value === "string" ? repo.value : ""
        };
      }
      function describeCredential() {
        return api.credentials.describe({ refs: [TOKEN_REF, DEFAULT_REPO_REF] }).then(readCreds);
      }
      function setToken(value) { return api.credentials.set({ ref: TOKEN_REF, value: value }).then(function (response) { if (!response.result.ok) throw new Error("凭据写入被拒绝"); }); }
      function unsetToken() { return api.credentials.unset({ ref: TOKEN_REF }).then(function (response) { if (!response.result.ok) throw new Error("凭据清除被拒绝"); }); }
      function setDefaultRepo(value) { return api.credentials.set({ ref: DEFAULT_REPO_REF, value: value }).then(function (response) { if (!response.result.ok) throw new Error("凭据写入被拒绝"); }); }
      function unsetDefaultRepo() { return api.credentials.unset({ ref: DEFAULT_REPO_REF }).then(function (response) { if (!response.result.ok) throw new Error("凭据清除被拒绝"); }); }

      ctx.slots.inject("settings.plugin.item", function () {
        return ctx.slots.register({
          name: "settings.plugin.item",
          key: "dsh-github",
          id: "dsh-github",
          order: 33,
          inject: function () { return { describeCredential: describeCredential, setToken: setToken, unsetToken: unsetToken, setDefaultRepo: setDefaultRepo, unsetDefaultRepo: unsetDefaultRepo }; }
        }, Card);
      });
    }
    exports.apply = apply;
    exports.inject = ["slots", "connection"];
    return module.exports;
  }
});
