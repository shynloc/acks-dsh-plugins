/**
 * MCP servers panel client plugin for DeepSeek Harness.
 *
 * Adds a "MCP" section in Settings (below Skills) with server CRUD,
 * connection status, and per-server tool counts.
 */
window.__ModuleLoader__.load({
  id: "dsh-mcp-panel",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;

    // ── Styles ────────────────────────────────────────────────────────────
    var sectionStyle = { display: "flex", flexDirection: "column", width: "100%" };
    var introStyle = { fontSize: 13, color: "var(--dsw-alias-label-tertiary, #888)", marginBottom: 16, lineHeight: 1.5 };
    var cardStyle = { border: "1px solid var(--dsw-alias-border-l2, #eee)", borderRadius: 10, marginBottom: 10, padding: 14, background: "var(--dsw-alias-bg-layer-2, #fafafa)" };
    var cardHeaderRow = { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 };
    var serverNameStyle = { fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary, #1a1a1a)", fontFamily: "var(--dsw-font-mono, monospace)" };
    var transportBadge = function(bg, fg) { return { display: "inline-block", borderRadius: 999, padding: "1px 8px", fontSize: 10, fontWeight: 500, background: bg, color: fg, flex: "none" }; };
    var statusBadge = function(status) {
      var map = {
        connected: ["#e6f4ea", "#1e7e34", "connected"],
        connecting: ["#fff4e5", "#9a6700", "connecting"],
        error: ["#fdecea", "#c62828", "error"],
        configured: ["#f0f0f0", "#888", "configured"]
      };
      var s = map[status] || map.configured;
      return { display: "inline-block", borderRadius: 999, padding: "1px 8px", fontSize: 10, fontWeight: 500, background: s[0], color: s[1], flex: "none" };
    };
    var metaRow = { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 };
    var metaLabel = { fontSize: 11, color: "var(--dsw-alias-label-caption, #aaa)", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" };
    var metaValue = { fontSize: 11, color: "var(--dsw-alias-label-tertiary, #888)", fontFamily: "var(--dsw-font-mono, monospace)" };
    var btnStyle = function(variant) {
      var base = { height: 28, padding: "0 12px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #d0d0d0)", background: "transparent", color: "var(--dsw-alias-label-secondary, #555)", cursor: "pointer", fontSize: 12 };
      if (variant === "primary") return Object.assign({}, base, { background: "var(--dsw-alias-brand-primary, #4a6cf7)", color: "#fff", border: "none" });
      if (variant === "danger") return Object.assign({}, base, { color: "#c62828", borderColor: "#f0c0c0" });
      return base;
    };
    var emptyStyle = { textAlign: "center", padding: "40px 20px", color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 14 };
    var loadingStyle = { textAlign: "center", padding: "40px 20px", color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 13 };
    var formStyle = { border: "1px solid var(--dsw-alias-border-l2, #eee)", borderRadius: 10, padding: 14, marginBottom: 14, background: "var(--dsw-alias-bg-layer-3, #fff)" };
    var fieldStyle = { display: "block", marginBottom: 10 };
    var labelStyle = { display: "block", marginBottom: 4, fontSize: 12, fontWeight: 500, color: "var(--dsw-alias-label-secondary, #555)" };
    var inputStyle = { width: "100%", boxSizing: "border-box", height: 32, padding: "0 10px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-l2, #d0d0d0)", background: "var(--dsw-alias-bg-layer-3, #fff)", color: "var(--dsw-alias-label-primary, #1a1a1a)", font: "inherit", fontSize: 13, outline: "none" };
    var textareaStyle = Object.assign({}, inputStyle, { height: 60, padding: "8px 10px", resize: "vertical", fontFamily: "var(--dsw-font-mono, monospace)" });
    var noticeStyle = { fontSize: 12, marginLeft: 8, color: "var(--dsw-alias-label-secondary, #555)" };

    function api(method, path, body) {
      var opts = { method: method, headers: {} };
      if (body !== undefined) {
        opts.headers["content-type"] = "application/json";
        opts.body = JSON.stringify(body);
      }
      return fetch(path, opts).then(function(r) { return r.json(); });
    }

    // ── Server Card ───────────────────────────────────────────────────────
    function ServerCard({ server, onEdit, onDelete, deleting }) {
      var detail = server.transport === "stdio"
        ? [server.command, (server.args || []).join(" ")].filter(Boolean).join(" ")
        : server.url || "";
      return h("div", { style: cardStyle },
        h("div", { style: cardHeaderRow },
          h("span", { style: serverNameStyle }, server.serverName),
          server.transport ? h("span", { style: transportBadge("#eef1ff", "#3f51b5") }, server.transport) : null,
          h("span", { style: statusBadge(server.status) }, server.status),
          h("span", { style: Object.assign({}, metaLabel, { marginLeft: "auto" }) }, server.toolCount + " tools"),
          h("button", { style: btnStyle(), onClick: function() { onEdit(server); } }, "编辑"),
          h("button", { style: btnStyle("danger"), disabled: deleting, onClick: function() { onDelete(server.serverName); } }, deleting ? "删除中..." : "删除")
        ),
        detail ? h("div", { style: metaRow },
          h("span", { style: metaLabel }, server.transport === "stdio" ? "command" : "url"),
          h("span", { style: metaValue }, detail)
        ) : null
      );
    }

    // ── Server Form ───────────────────────────────────────────────────────
    function ServerForm({ initial, onCancel, onSaved }) {
      var editing = Boolean(initial);
      var [form, setForm] = useState(initial ? initialToForm(initial) : {
        serverName: "", transport: "stdio", command: "", args: "", url: "", headers: "", toolCallTimeoutMs: ""
      });
      var [saving, setSaving] = useState(false);
      var [notice, setNotice] = useState("");

      function initialToForm(s) {
        return {
          serverName: s.serverName || "",
          transport: s.transport || "stdio",
          command: s.command || "",
          args: (s.args || []).join(" "),
          url: s.url || "",
          headers: s.headers ? JSON.stringify(s.headers) : "",
          toolCallTimeoutMs: s.toolCallTimeoutMs !== undefined ? String(s.toolCallTimeoutMs) : ""
        };
      }

      function set(key, value) { setForm(Object.assign({}, form, { [key]: value })); }

      function buildConfig() {
        var config = { serverName: form.serverName.trim(), transport: form.transport };
        if (form.transport === "stdio") {
          config.command = form.command.trim();
          config.args = form.args.trim() ? form.args.trim().split(/\s+/) : [];
          if (form.toolCallTimeoutMs) config.toolCallTimeoutMs = Number(form.toolCallTimeoutMs);
        } else {
          config.url = form.url.trim();
          config.headers = form.headers.trim() ? JSON.parse(form.headers.trim()) : {};
          if (form.toolCallTimeoutMs) config.toolCallTimeoutMs = Number(form.toolCallTimeoutMs);
        }
        return config;
      }

      function submit() {
        setSaving(true); setNotice("");
        var config;
        try { config = buildConfig(); } catch (e) { setNotice("配置错误: " + e.message); setSaving(false); return; }
        var method = editing ? "PUT" : "POST";
        var path = editing ? "/api/mcp-panel/servers/" + initial.serverName : "/api/mcp-panel/servers";
        api(method, path, { config: config }).then(function(res) {
          if (res.ok) { onSaved(); } else { setNotice(res.error || "操作失败"); }
        }).catch(function(e) { setNotice(e.message); }).finally(function() { setSaving(false); });
      }

      return h("div", { style: formStyle },
        h("div", { style: { fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--dsw-alias-label-primary, #1a1a1a)" } }, editing ? "编辑 MCP 服务器" : "添加 MCP 服务器"),
        h("label", { style: fieldStyle },
          h("span", { style: labelStyle }, "serverName（唯一命名空间）"),
          h("input", { style: inputStyle, value: form.serverName, disabled: editing, onChange: function(e) { set("serverName", e.target.value); }, placeholder: "github" })
        ),
        h("label", { style: fieldStyle },
          h("span", { style: labelStyle }, "传输方式"),
          h("select", { style: inputStyle, value: form.transport, onChange: function(e) { set("transport", e.target.value); } },
            h("option", { value: "stdio" }, "stdio（本地进程）"),
            h("option", { value: "streamable-http" }, "streamable-http（远程 URL）")
          )
        ),
        form.transport === "stdio" ?
          h(React.Fragment, null,
            h("label", { style: fieldStyle },
              h("span", { style: labelStyle }, "command"),
              h("input", { style: inputStyle, value: form.command, onChange: function(e) { set("command", e.target.value); }, placeholder: "npx" })
            ),
            h("label", { style: fieldStyle },
              h("span", { style: labelStyle }, "args（空格分隔）"),
              h("input", { style: inputStyle, value: form.args, onChange: function(e) { set("args", e.target.value); }, placeholder: "-y @modelcontextprotocol/server-github" })
            )
          ) :
          h(React.Fragment, null,
            h("label", { style: fieldStyle },
              h("span", { style: labelStyle }, "url"),
              h("input", { style: inputStyle, value: form.url, onChange: function(e) { set("url", e.target.value); }, placeholder: "http://localhost:9000/mcp" })
            ),
            h("label", { style: fieldStyle },
              h("span", { style: labelStyle }, "headers（JSON 对象，可选）"),
              h("textarea", { style: textareaStyle, value: form.headers, onChange: function(e) { set("headers", e.target.value); }, placeholder: '{"Authorization": "Bearer ..."}' })
            )
          ),
        h("label", { style: fieldStyle },
          h("span", { style: labelStyle }, "工具调用超时（毫秒，可选，默认 60000）"),
          h("input", { style: inputStyle, type: "number", value: form.toolCallTimeoutMs, onChange: function(e) { set("toolCallTimeoutMs", e.target.value); }, placeholder: "60000" })
        ),
        h("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
          h("button", { style: btnStyle("primary"), disabled: saving, onClick: submit }, saving ? "保存中..." : "保存"),
          h("button", { style: btnStyle(), onClick: onCancel }, "取消"),
          notice ? h("span", { style: Object.assign({}, noticeStyle, { color: "var(--dsw-alias-state-error-primary, #c62828)" }) }, notice) : null
        )
      );
    }

    // ── Section ───────────────────────────────────────────────────────────
    function McpSection() {
      var [servers, setServers] = useState([]);
      var [loading, setLoading] = useState(true);
      var [error, setError] = useState(null);
      var [editing, setEditing] = useState(null);
      var [adding, setAdding] = useState(false);
      var [deleting, setDeleting] = useState("");

      function load() {
        setLoading(true);
        api("GET", "/api/mcp-panel/servers").then(function(res) {
          if (res.ok) setServers(res.servers || []);
          else setError(res.error || "加载失败");
        }).catch(function(e) { setError(e.message); }).finally(function() { setLoading(false); });
      }
      useEffect(load, []);

      function onDelete(serverName) {
        setDeleting(serverName);
        api("DELETE", "/api/mcp-panel/servers/" + serverName).then(function(res) {
          if (res.ok) load(); else setError(res.error || "删除失败");
        }).catch(function(e) { setError(e.message); }).finally(function() { setDeleting(""); });
      }

      return h("div", { style: sectionStyle },
        h("p", { style: introStyle },
          "MCP（Model Context Protocol）服务器为智能体提供外部工具。配置后自动热加载，工具以 ",
          h("code", null, "mcp__<serverName>__<toolName>"), " 的形式注册到会话。"
        ),
        h("div", { style: { marginBottom: 12 } },
          h("button", { style: btnStyle("primary"), onClick: function() { setAdding(true); setEditing(null); } }, "+ 添加 MCP 服务器"),
          h("button", { style: Object.assign({}, btnStyle(), { marginLeft: 8 }), onClick: load }, "刷新状态")
        ),
        adding ? h(ServerForm, { onCancel: function() { setAdding(false); }, onSaved: function() { setAdding(false); setEditing(null); load(); } }) : null,
        editing ? h(ServerForm, { initial: editing, onCancel: function() { setEditing(null); }, onSaved: function() { setEditing(null); load(); } }) : null,
        loading ? h("div", { style: loadingStyle }, "加载中...") :
          error ? h("div", { style: Object.assign({}, emptyStyle, { color: "var(--dsw-alias-state-error-primary, #c62828)" }) }, "错误: " + error) :
            servers.length === 0 ? h("div", { style: emptyStyle },
              "尚未配置 MCP 服务器。",
              h("br"),
              h("span", { style: { fontSize: 12 } }, "点击「添加 MCP 服务器」开始。")
            ) :
              servers.map(function(server) {
                return h(ServerCard, { key: server.serverName, server: server, deleting: deleting === server.serverName, onEdit: function(s) { setEditing(s); setAdding(false); }, onDelete: onDelete });
              })
      );
    }

    // ── Plugin Entry ──────────────────────────────────────────────────────
    function apply(ctx) {
      ctx.slots.inject("settings.section", function() {
        return ctx.slots.register({
          name: "settings.section",
          id: "mcp",
          order: 26,
          label: function() { return "MCP"; },
          inject: function() { return {}; }
        }, McpSection);
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
