/**
 * Skills Panel client plugin for DeepSeek Harness.
 *
 * Adds a Skills section in Settings, below Agent Presets,
 * showing all registered skills with their descriptions and content.
 */
window.__ModuleLoader__.load({
  id: "dsh-skill-panel",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;

    // ── Styles ────────────────────────────────────────────────────────────
    var sectionStyle = {
      display: "flex", flexDirection: "column", width: "100%"
    };
    var introStyle = {
      fontSize: 13, color: "var(--dsw-alias-label-tertiary, #888)",
      marginBottom: 16, lineHeight: 1.5
    };
    var cardStyle = {
      border: "1px solid var(--dsw-alias-border-l2, #eee)",
      borderRadius: 10, marginBottom: 10, overflow: "hidden",
      background: "var(--dsw-alias-bg-layer-2, #fafafa)"
    };
    var cardHeaderStyle = {
      display: "flex", alignItems: "center", gap: 8,
      padding: "10px 14px", cursor: "pointer",
      background: "transparent", border: "none", width: "100%",
      textAlign: "left", font: "inherit",
      color: "var(--dsw-alias-label-primary, #1a1a1a)"
    };
    var skillNameStyle = {
      fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary, #1a1a1a)",
      fontFamily: "var(--dsw-font-mono, monospace)"
    };
    var skillDescStyle = {
      fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)",
      marginLeft: "auto", textAlign: "right", flex: 1,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
    };
    var badgeStyle = function(bg, fg) {
      return {
        display: "inline-block", borderRadius: 999, padding: "1px 8px",
        fontSize: 10, fontWeight: 500, background: bg, color: fg,
        flex: "none"
      };
    };
    var contentStyle = {
      padding: "0 14px 14px", whiteSpace: "pre-wrap",
      fontFamily: "var(--dsw-font-mono, monospace)",
      fontSize: 12, lineHeight: 1.6,
      color: "var(--dsw-alias-label-secondary, #555)",
      maxHeight: 300, overflow: "auto",
      borderTop: "1px solid var(--dsw-alias-border-l2, #eee)",
      paddingTop: 10
    };
    var emptyStyle = {
      textAlign: "center", padding: "40px 20px",
      color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 14
    };
    var loadingStyle = {
      textAlign: "center", padding: "40px 20px",
      color: "var(--dsw-alias-label-tertiary, #888)", fontSize: 13
    };
    var metaRowStyle = {
      display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4
    };
    var metaLabelStyle = {
      fontSize: 11, color: "var(--dsw-alias-label-caption, #aaa)", fontWeight: 500,
      textTransform: "uppercase", letterSpacing: "0.04em"
    };
    var metaValueStyle = {
      fontSize: 11, color: "var(--dsw-alias-label-tertiary, #888)"
    };
    var searchInputStyle = {
      width: "100%", boxSizing: "border-box", height: 34,
      padding: "0 12px", borderRadius: 8,
      border: "1px solid var(--dsw-alias-border-l2, #d0d0d0)",
      background: "var(--dsw-alias-bg-layer-3, #fff)",
      color: "var(--dsw-alias-label-primary, #1a1a1a)",
      font: "inherit", fontSize: 13, marginBottom: 12,
      outline: "none"
    };
    var countStyle = {
      fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)", marginBottom: 8
    };
    var navStyle = {
      fontSize: 13, fontWeight: 500, color: "var(--dsw-alias-label-primary, #1a1a1a)"
    };

    // ── Skill Card Component ──────────────────────────────────────────────
    function SkillCard({ skill }) {
      var [open, setOpen] = useState(false);
      var [content, setContent] = useState(null);
      var [loading, setLoading] = useState(false);

      function toggle() {
        if (!open && !content && !loading) {
          setLoading(true);
          fetch("/api/skill-panel/skills/" + skill.name)
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.ok && data.skill) setContent(data.skill.content || "(no content)");
              else setContent("(failed to load)");
            })
            .catch(function() { setContent("(network error)"); })
            .finally(function() { setLoading(false); });
        }
        setOpen(!open);
      }

      var invocable = skill.invocation || {};
      var isModel = invocable.modelInvocable !== false;
      var isUser = invocable.userInvocable !== false;

      return h("div", { style: cardStyle },
        h("button", { style: cardHeaderStyle, onClick: toggle },
          h("span", { style: { fontSize: "14px" } }, open ? "▼" : "▶"),
          h("span", { style: skillNameStyle }, skill.name),
          skill.source ? h("span", { style: badgeStyle("var(--dsw-alias-bg-layer-3, #f0f0f0)", "var(--dsw-alias-label-tertiary, #888)") }, skill.source) : null,
          h("span", { style: skillDescStyle }, skill.description || "")
        ),
        open ? h("div", { style: { padding: "0 14px 14px" } },
          h("div", { style: metaRowStyle },
            h("span", { style: metaLabelStyle }, "Provider"),
            h("span", { style: metaValueStyle }, skill.provider || "unknown"),
            h("span", { style: Object.assign({}, metaLabelStyle, { marginLeft: 8 }) }, "Model"),
            h("span", { style: badgeStyle(isModel ? "#e6f4ea" : "#fff4e5", isModel ? "#1e7e34" : "#9a6700") }, isModel ? "✓" : "✗"),
            h("span", { style: Object.assign({}, metaLabelStyle, { marginLeft: 4 }) }, "User"),
            h("span", { style: badgeStyle(isUser ? "#e6f4ea" : "#fff4e5", isUser ? "#1e7e34" : "#9a6700") }, isUser ? "✓" : "✗")
          ),
          skill.whenToUse ? h("div", { style: { fontSize: 12, color: "var(--dsw-alias-label-tertiary, #888)", marginBottom: 8, fontStyle: "italic" } }, "When to use: " + skill.whenToUse) : null,
          loading ? h("div", { style: loadingStyle }, "Loading content...") :
            content !== null ? h("pre", { style: contentStyle }, content) : null
        ) : null
      );
    }

    // ── Skills Section Component ──────────────────────────────────────────
    function SkillsSection() {
      var [skills, setSkills] = useState([]);
      var [loading, setLoading] = useState(true);
      var [error, setError] = useState(null);
      var [filter, setFilter] = useState("");

      useEffect(function() {
        fetch("/api/skill-panel/skills")
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data.ok) setSkills(data.skills || []);
            else setError(data.error || "Failed to load skills");
          })
          .catch(function(err) { setError(err.message); })
          .finally(function() { setLoading(false); });
      }, []);

      var filtered = filter
        ? skills.filter(function(s) {
            var q = filter.toLowerCase();
            return s.name.toLowerCase().indexOf(q) !== -1 ||
              (s.description || "").toLowerCase().indexOf(q) !== -1;
          })
        : skills;

      return h("div", { style: sectionStyle },
        h("p", { style: introStyle },
          "Skills are reusable instruction sets that extend agent capabilities. ",
          "Place skill files in ", h("code", null, "~/.dsh/skills/"), " or ",
          h("code", null, "~/.agents/skills/"), " (Markdown with YAML frontmatter)."
        ),
        h("input", {
          style: searchInputStyle,
          type: "text",
          placeholder: "Search skills by name or description...",
          value: filter,
          onChange: function(e) { setFilter(e.target.value); }
        }),
        loading ? h("div", { style: loadingStyle }, "Loading skills...") :
          error ? h("div", { style: Object.assign({}, emptyStyle, { color: "var(--dsw-alias-state-error-primary, #d32f2f)" }) }, "Error: " + error) :
            skills.length === 0 ? h("div", { style: emptyStyle },
              "No skills installed yet.",
              h("br"),
              h("span", { style: { fontSize: 12 } }, "Add .md skill files to ~/.dsh/skills/ to get started.")
            ) :
              h(React.Fragment, null,
                h("div", { style: countStyle },
                  filtered.length + " skill" + (filtered.length !== 1 ? "s" : "") +
                  (filter ? " (filtered from " + skills.length + ")" : "")
                ),
                filtered.map(function(skill) {
                  return h(SkillCard, { key: skill.name, skill: skill });
                })
              )
      );
    }

    // ── Plugin Entry ──────────────────────────────────────────────────────
    function apply(ctx) {
      // Register Skills section in Settings, below Agent Presets (order 20)
      ctx.slots.inject("settings.section", function() {
        return ctx.slots.register({
          name: "settings.section",
          id: "skills",
          order: 25,
          label: function() { return "Skills"; },
          inject: function() { return {}; }
        }, SkillsSection);
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  }
});
