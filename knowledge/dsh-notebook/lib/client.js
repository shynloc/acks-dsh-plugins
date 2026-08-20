/**
 * dsh-notebook — client plugin.
 *
 * Registers a nav button in `sidebar.footer.action` (below the workspace) and
 * temporarily shadows only the `conversation` center column while the notebook
 * is active. The native DSH sidebar remains mounted and usable.
 */
window.__ModuleLoader__.load({
  id: "dsh-notebook",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var UI = require("@deepseek-ai/dsh-client-ui-primitives");
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useRef = React.useRef;
    var Fragment = React.Fragment;
    var MarkdownText = UI.MarkdownText;

    function nativeIcon(Component, props) {
      return h(Component, Object.assign({ "aria-hidden": true }, props || {}));
    }

    function svgIcon(name, size) {
      var common = {
        width: size || 16, height: size || 16, viewBox: "0 0 24 24", fill: "none",
        stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
        "aria-hidden": true, focusable: "false",
      };
      var shapes = {
        grid: [h("rect", { key: 1, x: 4, y: 4, width: 6, height: 6, rx: 1 }), h("rect", { key: 2, x: 14, y: 4, width: 6, height: 6, rx: 1 }), h("rect", { key: 3, x: 4, y: 14, width: 6, height: 6, rx: 1 }), h("rect", { key: 4, x: 14, y: 14, width: 6, height: 6, rx: 1 })],
        list: [h("path", { key: 1, d: "M9 6h11M9 12h11M9 18h11" }), h("path", { key: 2, d: "M4 6h.01M4 12h.01M4 18h.01" })],
        masonry: [h("rect", { key: 1, x: 4, y: 4, width: 6, height: 9, rx: 1 }), h("rect", { key: 2, x: 14, y: 4, width: 6, height: 5, rx: 1 }), h("rect", { key: 3, x: 4, y: 17, width: 6, height: 3, rx: 1 }), h("rect", { key: 4, x: 14, y: 13, width: 6, height: 7, rx: 1 })],
        bold: [h("path", { key: 1, d: "M7 4h6a4 4 0 0 1 0 8H7z" }), h("path", { key: 2, d: "M7 12h7a4 4 0 0 1 0 8H7z" })],
        italic: [h("path", { key: 1, d: "M10 4h8M6 20h8M14 4 10 20" })],
        underline: [h("path", { key: 1, d: "M7 4v7a5 5 0 0 0 10 0V4M5 20h14" })],
        quote: [h("path", { key: 1, d: "M6 7h5v5H7a4 4 0 0 0-4 4M15 7h5v5h-4a4 4 0 0 0-4 4" })],
        ordered: [h("path", { key: 1, d: "M10 6h10M10 12h10M10 18h10" }), h("path", { key: 2, d: "M4 5h1v3M4 11h2l-2 3h2M4 17h2l-2 3h2" })],
        unordered: [h("path", { key: 1, d: "M10 6h10M10 12h10M10 18h10" }), h("circle", { key: 2, cx: 5, cy: 6, r: 1 }), h("circle", { key: 3, cx: 5, cy: 12, r: 1 }), h("circle", { key: 4, cx: 5, cy: 18, r: 1 })],
        task: [h("rect", { key: 1, x: 3, y: 4, width: 5, height: 5, rx: 1 }), h("path", { key: 2, d: "m4.5 6.5 1 1 2-2M11 6.5h10M3 13h5v5H3zM11 15.5h10" })],
        image: [h("rect", { key: 1, x: 3, y: 4, width: 18, height: 16, rx: 2 }), h("circle", { key: 2, cx: 8.5, cy: 9, r: 1.5 }), h("path", { key: 3, d: "m4 17 5-5 4 4 2-2 5 5" })],
        table: [h("rect", { key: 1, x: 3, y: 4, width: 18, height: 16, rx: 1 }), h("path", { key: 2, d: "M3 10h18M3 15h18M9 4v16M15 4v16" })],
        rule: [h("path", { key: 1, d: "M4 12h16" })],
        eye: [h("path", { key: 1, d: "M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6" }), h("circle", { key: 2, cx: 12, cy: 12, r: 2.5 })],
        split: [h("rect", { key: 1, x: 3, y: 4, width: 18, height: 16, rx: 2 }), h("path", { key: 2, d: "M12 4v16" })],
        check: [h("path", { key: 1, d: "m5 12 4 4L19 6" })],
      };
      return h("svg", common, shapes[name] || shapes.rule);
    }

    // ── Cross-slot store (nav button ⇄ overlay) ──────────────────────────────
    var store = {
      open: false,
      listeners: [],
      mountSurface: null,
      surfaceDispose: null,
      subscribe: function (fn) {
        this.listeners.push(fn);
        var self = this;
        return function () {
          var i = self.listeners.indexOf(fn);
          if (i >= 0) self.listeners.splice(i, 1);
        };
      },
      setOpen: function (v) {
        if (this.open !== v) {
          this.open = v;
          if (v) this.activateSurface();
          else this.deactivateSurface();
          this.emit();
        }
      },
      toggle: function () {
        this.setOpen(!this.open);
      },
      emit: function () {
        this.listeners.slice().forEach(function (fn) { fn(); });
      },
      activateSurface: function () {
        if (this.open && this.mountSurface && !this.surfaceDispose) {
          this.surfaceDispose = this.mountSurface();
        }
      },
      deactivateSurface: function () {
        if (this.surfaceDispose) {
          var dispose = this.surfaceDispose;
          this.surfaceDispose = null;
          dispose();
        }
      },
      bindSurface: function (mount) {
        var self = this;
        self.mountSurface = mount;
        self.activateSurface();
        return function () {
          self.deactivateSurface();
          if (self.mountSurface === mount) self.mountSurface = null;
        };
      },
    };

    // Drag payload (module-scoped so cards and drop targets share it).
    var dragNoteId = null;

    // ── API helper ───────────────────────────────────────────────────────────
    // ── Cross-domain references ─────────────────────────────────────────────
    //
    // A note owns two nullable ids and no copy of either record. Both resolve
    // for display through the owner's own list, so a rename needs no
    // propagation here and nothing about a referenced record ever becomes an
    // anchor — even when its title happens to look like a URL.

    var REFERENCE_SOURCES = [
      {
        key: "projects", path: "/api/projects/state", collection: "projects",
        titleKey: "title", field: "projectId", label: "关联项目",
        none: "未关联项目", unknown: "未知项目", prefix: "项目：",
        failure: "无法读取项目列表，暂时只能保存未关联笔记。"
      },
      {
        key: "areas", path: "/api/areas/state", collection: "areas",
        titleKey: "name", field: "areaId", label: "关联领域",
        none: "未关联领域", unknown: "未知领域", prefix: "领域：",
        failure: "无法读取领域列表，暂时只能保存未关联笔记。"
      }
    ];

    function referenceTitle(source, record) {
      var title = record[source.titleKey];
      return record.lifecycle === "archived" ? title + "（已归档）" : title;
    }

    /**
     * A reference resolves through its owner's list. A value that no longer
     * matches is stated plainly rather than rendered blank or as a raw id.
     */
    function referenceLabel(references, source, id) {
      if (!id) return null;
      var records = references[source.key] || [];
      for (var index = 0; index < records.length; index += 1) {
        if (records[index].id === id) return referenceTitle(source, records[index]);
      }
      return source.unknown;
    }

    function referenceOptions(references, source, currentId) {
      var options = [h("option", { key: "none", value: "" }, source.none)];
      var seen = {};
      (references[source.key] || []).forEach(function (record) {
        // Only active records are offered for a new link; an existing link to
        // an archived one stays selectable so it can be seen and removed.
        if (record.lifecycle !== "active" && record.id !== currentId) return;
        seen[record.id] = true;
        options.push(h("option", { key: record.id, value: record.id }, referenceTitle(source, record)));
      });
      if (currentId && !seen[currentId]) {
        options.push(h("option", { key: currentId, value: currentId }, source.unknown));
      }
      return options;
    }

    function api(method, path, body) {
      var opts = {
        method: method,
        credentials: "same-origin",
        headers: { accept: "application/json" },
      };
      if (body !== undefined) {
        opts.headers["content-type"] = "application/json";
        opts.body = JSON.stringify(body);
      }
      return fetch(path, opts).then(function (response) {
        return response.json().catch(function () {
          throw new Error("服务器返回了无法识别的响应");
        }).then(function (payload) {
          if (!response.ok || !payload || payload.ok !== true) {
            throw new Error(payload && payload.error ? payload.error : "请求失败（HTTP " + response.status + "）");
          }
          return payload;
        });
      });
    }

    function resourcePath(kind, id, suffix) {
      return "/api/notebook/" + kind + "/" + encodeURIComponent(String(id)) + (suffix || "");
    }

    // ── Theme variables (match the shipped theme, light + dark) ──────────────
    var C = {
      bgBase: "var(--dsw-alias-bg-base, #fff)",
      bg1: "var(--dsw-alias-bg-layer-1, #fff)",
      bg2: "var(--dsw-alias-bg-layer-2, #fafafa)",
      bg3: "var(--dsw-alias-bg-layer-3, #f5f5f5)",
      border1: "var(--dsw-alias-border-l1, #eee)",
      border2: "var(--dsw-alias-border-l2, #d0d0d0)",
      text1: "var(--dsw-alias-label-primary, #1a1a1a)",
      text2: "var(--dsw-alias-label-secondary, #555)",
      text3: "var(--dsw-alias-label-tertiary, #888)",
      caption: "var(--dsw-alias-label-caption, #aaa)",
      accent: "var(--dsw-alias-state-business-primary, #4a6cf7)",
      danger: "var(--dsw-alias-state-error-primary, #d32f2f)",
      hover: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04))",
      mono: "var(--dsw-font-mono, monospace)",
      font: "var(--dsw-font-family, inherit)",
    };

    var NOTE_COLORS = [
      ["none", "#e5e7eb"],
      ["red", "#f87171"],
      ["orange", "#fb923c"],
      ["yellow", "#facc15"],
      ["green", "#4ade80"],
      ["blue", "#60a5fa"],
      ["purple", "#c084fc"],
    ];

    var TAG_PALETTE = ["#6B7280", "#3b82f6", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899", "#14b8a6"];

    var TEMPLATES = [
      { name: "空白笔记", content: "" },
      { name: "会议纪要", content: "# 会议纪要\n\n## 时间\n\n## 参会人\n\n## 议题\n\n## 结论与待办\n\n- [ ] " },
      { name: "周报", content: "# 周报\n\n## 本周完成\n\n## 下周计划\n\n## 风险与求助\n" },
      { name: "学习笔记", content: "# 学习笔记\n\n## 主题\n\n## 要点\n\n## 疑问\n" },
    ];

    // ── Helpers ──────────────────────────────────────────────────────────────
    function plainPreview(content) {
      return String(content || "")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/<\/?u>/giu, "")
        .replace(/`(.+?)`/g, "$1")
        .replace(/\[(.+?)\]\(.+?\)/g, "$1")
        .replace(/\n+/g, " ")
        .trim()
        .slice(0, 160);
    }

    function formatDate(ts) {
      var d = new Date(ts);
      var now = new Date();
      if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      }
      if (d.getFullYear() === now.getFullYear()) {
        return (d.getMonth() + 1) + "/" + d.getDate();
      }
      return d.getFullYear() + "/" + (d.getMonth() + 1) + "/" + d.getDate();
    }

    function noteColorHex(color) {
      for (var i = 0; i < NOTE_COLORS.length; i++) {
        if (NOTE_COLORS[i][0] === color) return NOTE_COLORS[i][1];
      }
      return "#e5e7eb";
    }

    function tagById(tags, id) {
      for (var i = 0; i < tags.length; i++) if (tags[i].id === id) return tags[i];
      return null;
    }

    function contentBlocksText(blocks) {
      return (blocks || []).map(function (block) {
        if (block && block.type === "text" && typeof block.text === "string") return block.text;
        if (block && (block.type === "image" || block.type === "image_url")) return "[图片]";
        return "";
      }).filter(Boolean).join("\n\n").trim();
    }

    function assistantBlocksText(blocks) {
      return (blocks || []).map(function (block) {
        if (block && block.kind === "text" && typeof block.text === "string") return block.text;
        if (block && block.kind === "image") return "[图片]";
        return "";
      }).filter(Boolean).join("\n\n").trim();
    }

    function firstMeaningfulLine(text) {
      var line = String(text || "").split(/\r?\n/u).map(function (value) {
        return value.replace(/^\s*(?:#{1,6}|>|[-*+]\s|\d+[.)]\s)\s*/u, "").trim();
      }).filter(Boolean)[0] || "DSH 对话摘录";
      return line.slice(0, 120);
    }

    function conversationExcerpt(snapshot, messageId) {
      var nodes = snapshot && Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
      var assistantIndex = -1;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i] && nodes[i].kind === "assistant" && nodes[i].messageId === messageId) assistantIndex = i;
      }
      if (assistantIndex < 0) return null;
      var assistant = nodes[assistantIndex];
      var user = null;
      for (var cursor = assistantIndex - 1; cursor >= 0; cursor--) {
        if (nodes[cursor] && (nodes[cursor].kind === "user" || nodes[cursor].kind === "steering")) {
          user = nodes[cursor];
          break;
        }
      }
      var userText = user ? contentBlocksText(user.content) : "";
      var assistantText = assistantBlocksText(assistant.blocks);
      if (!assistantText) return null;
      return {
        title: firstMeaningfulLine(userText || assistantText),
        content: (userText ? "## 用户\n\n" + userText + "\n\n" : "") + "## DeepSeek\n\n" + assistantText,
      };
    }

    function escapeKatexText(value) {
      return String(value).replace(/([\\{}$&#_%])/gu, "\\$1").replace(/\^/gu, "\\textasciicircum{}").replace(/~/gu, "\\textasciitilde{}");
    }

    function markdownForPreview(value) {
      return String(value || "").replace(/<u>([^<>\n]{1,2000})<\/u>/giu, function (_match, text) {
        return "$\\underline{\\text{" + escapeKatexText(text) + "}}$";
      });
    }

    // ── Shared styles ────────────────────────────────────────────────────────
    var btnStyle = function (variant) {
      var base = {
        height: 30, padding: "0 12px", borderRadius: 8, cursor: "pointer",
        border: "1px solid " + C.border2, background: "transparent",
        color: C.text2, fontSize: 12, fontFamily: C.font, display: "inline-flex",
        alignItems: "center", gap: 5,
      };
      if (variant === "primary") return Object.assign({}, base, { background: C.accent, color: "#fff", border: "none" });
      if (variant === "danger") return Object.assign({}, base, { color: C.danger, borderColor: C.danger });
      if (variant === "ghost") return Object.assign({}, base, { border: "none", background: "transparent" });
      return base;
    };

    var inputStyle = {
      width: "100%", boxSizing: "border-box", height: 32, padding: "0 10px",
      borderRadius: 8, border: "1px solid " + C.border2, background: C.bg1,
      color: C.text1, font: "inherit", fontSize: 13, outline: "none",
    };

    var iconBtnStyle = {
      width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent",
      color: C.text2, cursor: "pointer", fontSize: 14, display: "inline-flex",
      alignItems: "center", justifyContent: "center",
    };

    // ── Nav button (sidebar.footer.action) ───────────────────────────────────
    function NotebookNavButton(props) {
      var [open, setOpen] = useState(store.open);
      var currentSession = props.useSessions
        ? props.useSessions(function (state) { return state.current; })
        : undefined;
      var previousSession = useRef(currentSession);
      useEffect(function () { return store.subscribe(function () { setOpen(store.open); }); }, []);
      useEffect(function () {
        if (previousSession.current !== currentSession) {
          previousSession.current = currentSession;
          if (store.open) store.setOpen(false);
        }
      }, [currentSession]);
      var wide = props.wide !== false;
      return h("button", {
        type: "button",
        title: "笔记本",
        onClick: function () { store.toggle(); },
        style: {
          display: "flex", alignItems: "center", justifyContent: "flex-start",
          gap: 8, width: wide ? "100%" : 36, height: 36, boxSizing: "border-box",
          padding: wide ? "0 10px" : "0", border: "none", borderRadius: 8,
          background: open ? C.hover : "transparent", color: open ? C.accent : C.text2,
          cursor: "pointer", fontSize: 13, fontFamily: C.font,
        },
      },
        nativeIcon(UI.IconListPenOutline16),
        wide ? h("span", null, "笔记本") : null,
      );
    }

    // ── Notebook center-column page ──────────────────────────────────────────
    function NotebookPage(props) {
      var [data, setData] = useState({ categories: [], notes: [], tags: [] });
      var [loading, setLoading] = useState(true);
      var [error, setError] = useState(null);
      var [viewMode, setViewMode] = useState("card");
      var [activeCategory, setActiveCategory] = useState(null);
      var [activeTag, setActiveTag] = useState(null);
      var [searchQuery, setSearchQuery] = useState("");
      var [sortBy, setSortBy] = useState("updated");
      var [editing, setEditing] = useState(null); // note object | {isNew:true,...}
      var [showTemplates, setShowTemplates] = useState(false);
      var [deleting, setDeleting] = useState(null);
      var [textDialog, setTextDialog] = useState(null);
      var [confirmDialog, setConfirmDialog] = useState(null);
      var [actionError, setActionError] = useState(null);
      // Reference choices are a separate concern from the Notebook load: an
      // outage in either owner must never put the page into an error state, and
      // each owner fails on its own.
      var [references, setReferences] = useState({
        projects: [], areas: [], errors: { projects: null, areas: null }
      });
      var [startingChatId, setStartingChatId] = useState(null);
      var [compact, setCompact] = useState(function () { return window.innerWidth < 760; });
      var sessionList = props.useSessions ? props.useSessions(function (state) { return state; }) : null;

      useEffect(function () {
        setLoading(true);
        setError(null);
        api("GET", "/api/notebook/state")
          .then(function (r) {
            if (r.ok) setData({ categories: r.categories || [], notes: r.notes || [], tags: r.tags || [] });
            else setError(r.error || "加载失败");
          })
          .catch(function (e) { setError(e.message); })
          .finally(function () { setLoading(false); });

        Promise.all(REFERENCE_SOURCES.map(function (source) {
          return api("GET", source.path).then(
            function (payload) {
              return { key: source.key, value: payload[source.collection] || [], error: null };
            },
            function () { return { key: source.key, value: [], error: source.failure }; }
          );
        })).then(function (results) {
          var next = { projects: [], areas: [], errors: { projects: null, areas: null } };
          results.forEach(function (result) {
            next[result.key] = result.value;
            next.errors[result.key] = result.error;
          });
          setReferences(next);
        });
      }, []);

      useEffect(function () {
        function onKey(e) {
          if (e.key !== "Escape") return;
          if (textDialog) setTextDialog(null);
          else if (confirmDialog) setConfirmDialog(null);
          else if (deleting) setDeleting(null);
          else if (showTemplates) setShowTemplates(false);
          else if (editing) setEditing(null);
          else close();
        }
        window.addEventListener("keydown", onKey);
        return function () { window.removeEventListener("keydown", onKey); };
      }, [textDialog, confirmDialog, deleting, showTemplates, editing]);

      useEffect(function () {
        function onResize() { setCompact(window.innerWidth < 760); }
        window.addEventListener("resize", onResize);
        return function () { window.removeEventListener("resize", onResize); };
      }, []);

      // Leaving the notebook means "close the standalone surface" on its own,
      // but "go back to AI Works" when Work OS is hosting it.
      function leaveSurface() {
        if (props.workOs && typeof props.workOs.showAiWorks === "function") props.workOs.showAiWorks();
        else store.setOpen(false);
      }

      function close() {
        leaveSurface();
        setEditing(null);
        setShowTemplates(false);
        setDeleting(null);
        setTextDialog(null);
        setConfirmDialog(null);
        setActionError(null);
      }

      function refresh() {
        return api("GET", "/api/notebook/state").then(function (r) {
          if (r.ok) setData({ categories: r.categories || [], notes: r.notes || [], tags: r.tags || [] });
          return r;
        });
      }

      function newNote() {
        setEditing({ isNew: true, title: "", content: "", categoryId: activeCategory, color: "none", tagIds: [] });
      }

      function openNote(note) { setEditing(note); }

      /**
       * States a note's references as plain text. A reference that no longer
       * resolves is named plainly rather than dropped, so a note never appears
       * unfiled just because its owner is unreachable.
       */
      function referenceChips(note) {
        return REFERENCE_SOURCES.map(function (source) {
          var label = referenceLabel(references, source, note[source.field]);
          if (!label) return null;
          return h("span", {
            key: source.key,
            style: { padding: "1px 6px", borderRadius: 4, background: C.bg3, color: C.text3 }
          }, source.prefix + label);
        });
      }

      function runAction(promise) {
        setActionError(null);
        return promise.catch(function (error) {
          setActionError(error && error.message ? error.message : "操作失败");
          return null;
        });
      }

      function startAiConversation(note) {
        if (!props.sessions || startingChatId !== null) return;
        setActionError(null);
        setStartingChatId(note.id);
        var current = sessionList && sessionList.current ? sessionList.byId[sessionList.current] : null;
        var createOptions = current && current.cwd ? { cwd: current.cwd } : {};
        var prompt = "以下内容来自我的 DSH 笔记本。请将它作为本次新会话的背景上下文；先确认已载入，然后等待我继续提出任务。\n\n# "
          + (note.title || "无标题") + "\n\n" + (note.content || "（空笔记）");
        props.sessions.create(createOptions).then(function (sessionId) {
          var binding = props.sessions.binding(sessionId);
          if (!binding || !binding.session) throw new Error("新会话已创建，但暂时无法取得会话连接");
          var title = "笔记：" + (note.title || "无标题");
          var rename = binding.session.rename(title.slice(0, 120)).catch(function () { return null; });
          return rename.then(function () {
            return binding.session.prompt([{ type: "text", text: prompt }], "queue");
          }).then(function (result) {
            if (!result || result.ok !== true) {
              throw new Error(result && result.error && result.error.message ? result.error.message : "笔记上下文发送失败");
            }
            leaveSurface();
            props.sessions.open(sessionId);
          });
        }).catch(function (error) {
          setActionError(error && error.message ? error.message : "创建 AI 会话失败");
        }).finally(function () {
          setStartingChatId(null);
        });
      }

      // filtered + sorted notes
      var filtered = data.notes.filter(function (n) {
        // An archived note still exists and is still a valid reference target;
        // it simply belongs in 知识存档 rather than in the working list.
        if ((n.status || "active") === "archived") return false;
        if (activeCategory !== null && n.categoryId !== activeCategory) return false;
        if (activeTag !== null && (n.tagIds || []).indexOf(activeTag) === -1) return false;
        if (searchQuery.trim()) {
          var q = searchQuery.trim().toLowerCase();
          var hit = String(n.title || "").toLowerCase().indexOf(q) !== -1 ||
            String(n.content || "").toLowerCase().indexOf(q) !== -1;
          if (!hit) return false;
        }
        return true;
      });
      filtered = filtered.slice().sort(function (a, b) {
        if (sortBy === "created") return b.createdAt - a.createdAt;
        if (sortBy === "title") return String(a.title).localeCompare(String(b.title), "zh-CN");
        return b.updatedAt - a.updatedAt;
      });

      // ── render helpers ────────────────────────────────────────────────────
      function renderViewToggle(mode, label, icon) {
        return h("button", {
          key: mode, title: label, onClick: function () { setViewMode(mode); },
          style: {
            height: 28, width: 32, border: "1px solid " + C.border2, borderRadius: 6,
            background: viewMode === mode ? C.accent : "transparent",
            color: viewMode === mode ? "#fff" : C.text2, cursor: "pointer", fontSize: 13,
          },
        }, icon);
      }

      function renderNoteCard(note) {
        return h("div", {
          key: note.id, draggable: true,
          onDragStart: function (e) { dragNoteId = note.id; e.dataTransfer.effectAllowed = "move"; },
          onDragEnd: function () { dragNoteId = null; },
          "data-notebook-action": "open-note",
          onClick: function () { openNote(note); },
          style: {
            background: C.bg2, border: "1px solid " + C.border1, borderRadius: 10,
            padding: 12, cursor: "pointer", breakInside: "avoid", marginBottom: 10,
            borderLeft: note.color && note.color !== "none" ? "3px solid " + noteColorHex(note.color) : "1px solid " + C.border1,
          },
        },
          h("div", { style: { display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 6 } },
            h("div", { style: { flex: 1, fontWeight: 600, fontSize: 13, color: C.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
              note.title || "无标题"),
            (note.tagIds || []).slice(0, 2).map(function (tid) {
              var t = tagById(data.tags, tid);
              return t ? h("span", { key: tid, style: { fontSize: 10, padding: "1px 6px", borderRadius: 999, background: t.color + "22", color: t.color, whiteSpace: "nowrap" } }, t.name) : null;
            }),
          ),
          h("div", { style: { fontSize: 12, color: C.text3, lineHeight: 1.5, marginBottom: 8, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } },
            plainPreview(note.content) || "（空）"),
          h("div", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.caption } },
            h("span", null, formatDate(note.updatedAt)),
            note.wordCount ? h("span", null, "· " + note.wordCount + "字") : null,
            referenceChips(note),
            h("span", { style: { marginLeft: "auto", padding: "1px 6px", borderRadius: 4, background: C.bg3, color: C.text3 } },
              (function () { var c = null; data.categories.forEach(function (x) { if (x.id === note.categoryId) c = x; }); return c ? c.name : "未分类"; })()),
            h("button", {
              type: "button", title: "用此笔记新建 AI 会话", "aria-label": "用此笔记新建 AI 会话",
              disabled: startingChatId !== null,
              onClick: function (event) { event.stopPropagation(); startAiConversation(note); },
              style: Object.assign({}, btnStyle("ghost"), { height: 24, padding: "0 6px", fontSize: 11, color: C.accent }),
            }, nativeIcon(UI.IconNewChatOutline16), startingChatId === note.id ? "启动中…" : "AI 会话"),
          ),
        );
      }

      function renderNoteRow(note) {
        return h("div", {
          key: note.id, draggable: true,
          onDragStart: function (e) { dragNoteId = note.id; e.dataTransfer.effectAllowed = "move"; },
          onDragEnd: function () { dragNoteId = null; },
          "data-notebook-action": "open-note",
          onClick: function () { openNote(note); },
          style: {
            display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
            borderBottom: "1px solid " + C.border1, background: C.bg2, cursor: "pointer",
            borderLeft: note.color && note.color !== "none" ? "3px solid " + noteColorHex(note.color) : "3px solid transparent",
          },
        },
          h("div", { style: { flex: 1, minWidth: 0 } },
            h("div", { style: { display: "flex", alignItems: "center", gap: 6 } },
              h("span", { style: { fontWeight: 600, fontSize: 13, color: C.text1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, note.title || "无标题"),
              (note.tagIds || []).slice(0, 2).map(function (tid) {
                var t = tagById(data.tags, tid);
                return t ? h("span", { key: tid, style: { fontSize: 10, padding: "0 5px", borderRadius: 999, background: t.color + "22", color: t.color } }, t.name) : null;
              }),
            ),
            h("div", { style: { fontSize: 12, color: C.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
              plainPreview(note.content)),
          ),
          h("span", { style: { fontSize: 11, color: C.caption, whiteSpace: "nowrap" } }, formatDate(note.updatedAt)),
          h("button", {
            type: "button", title: "用此笔记新建 AI 会话", "aria-label": "用此笔记新建 AI 会话",
            disabled: startingChatId !== null,
            onClick: function (event) { event.stopPropagation(); startAiConversation(note); },
            style: Object.assign({}, btnStyle("ghost"), { height: 26, padding: "0 6px", fontSize: 11, color: C.accent }),
          }, nativeIcon(UI.IconNewChatOutline16), startingChatId === note.id ? "启动中…" : "AI 会话"),
          h("button", { onClick: function (e) { e.stopPropagation(); setDeleting(note); }, style: iconBtnStyle, title: "归档", "aria-label": "归档" }, nativeIcon(UI.IconArchiveOutline16 || UI.IconTrashOutline16)),
        );
      }

      function renderCategoryRow(cat) {
        var active = activeCategory === cat.id;
        return h("div", {
          key: cat.id,
          onClick: function () { setActiveCategory(cat.id); setActiveTag(null); },
          onDragOver: function (e) { e.preventDefault(); e.stopPropagation(); },
          onDrop: function (e) {
            e.preventDefault(); e.stopPropagation();
            if (dragNoteId) {
              runAction(api("PATCH", resourcePath("notes", dragNoteId), { categoryId: cat.id }).then(refresh));
              dragNoteId = null;
            }
          },
          title: "拖拽笔记到这里移动",
          style: {
            display: "flex", alignItems: "center", gap: 6, padding: "6px 8px",
            borderRadius: 8, cursor: "pointer", fontSize: 13,
            background: active ? C.hover : "transparent", color: active ? C.accent : C.text2,
          },
        },
          nativeIcon(UI.IconFolderClose16),
          h("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, cat.name),
          h("span", { style: { fontSize: 11, color: C.caption } },
            String(data.notes.filter(function (n) {
              return n.categoryId === cat.id && (n.status || "active") !== "archived";
            }).length)),
          h("button", {
            onClick: function (e) {
              e.stopPropagation();
              setTextDialog({
                title: "重命名笔记本",
                initialValue: cat.name,
                submitLabel: "保存",
                onSubmit: function (value) {
                  return api("PATCH", resourcePath("categories", cat.id), { name: value }).then(refresh);
                },
              });
            }, style: iconBtnStyle, title: "重命名",
          }, nativeIcon(UI.IconEditOutline16)),
          h("button", {
            onClick: function (e) {
              e.stopPropagation();
              setConfirmDialog({
                title: "删除笔记本",
                message: "删除「" + cat.name + "」？其中的笔记会变为未分类。",
                onConfirm: function () {
                  return api("DELETE", resourcePath("categories", cat.id)).then(function () {
                    if (activeCategory === cat.id) setActiveCategory(null);
                    return refresh();
                  });
                },
              });
            }, style: iconBtnStyle, title: "删除",
          }, nativeIcon(UI.IconCloseOutline16)),
        );
      }

      function renderTagRow(tag) {
        return h("div", {
          key: tag.id, onClick: function () { setActiveTag(activeTag === tag.id ? null : tag.id); setActiveCategory(null); },
          style: {
            display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 8,
            cursor: "pointer", fontSize: 12, background: activeTag === tag.id ? C.hover : "transparent",
            color: activeTag === tag.id ? C.accent : C.text2,
          },
        },
          h("span", { style: { width: 8, height: 8, borderRadius: "50%", background: tag.color, flexShrink: 0 } }),
          h("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, tag.name),
          h("button", {
            onClick: function (e) {
              e.stopPropagation();
              setConfirmDialog({
                title: "删除标签",
                message: "删除标签「" + tag.name + "」？笔记内容不会被删除。",
                onConfirm: function () { return api("DELETE", resourcePath("tags", tag.id)).then(refresh); },
              });
            },
            style: iconBtnStyle, title: "删除标签",
          }, nativeIcon(UI.IconCloseOutline16)),
        );
      }

      return h("div", {
        // This surface implements layered Escape itself (dialog, then editor,
        // then leave), so the Work OS host must not also act on Escape and
        // navigate away while a nested dialog is still open.
        "data-acks-owns-escape": props.workOs ? "" : undefined,
        style: {
          position: "relative", flex: 1, width: "100%", minWidth: 0, minHeight: 0,
          background: C.bgBase, display: "flex", flexDirection: "column", overflow: "hidden",
          color: C.text1, fontFamily: C.font,
        },
      },
        // ── Top bar ────────────────────────────────────────────────────────
        h("div", { style: { display: "flex", alignItems: "center", flexWrap: compact ? "wrap" : "nowrap", gap: compact ? 6 : 10, padding: compact ? "8px 10px" : "10px 16px", borderBottom: "1px solid " + C.border1, flexShrink: 0 } },
          h("span", { style: { fontWeight: 700, fontSize: 15, display: "inline-flex", alignItems: "center", gap: 7 } }, nativeIcon(UI.IconListPenOutline16), "笔记本"),
          h("div", { style: { flex: compact ? "1 1 calc(100% - 96px)" : 1, minWidth: compact ? 150 : 180, maxWidth: 420, display: "flex", alignItems: "center", gap: 6, background: C.bg3, borderRadius: 8, padding: "0 10px", height: 32 } },
            h("span", { style: { color: C.caption, display: "inline-flex" } }, nativeIcon(UI.IconSearchOutline16)),
            h("input", {
              value: searchQuery, placeholder: "搜索笔记…",
              onChange: function (e) { setSearchQuery(e.target.value); },
              style: { flex: 1, border: "none", background: "transparent", color: C.text1, fontSize: 13, outline: "none", font: "inherit" },
            }),
          ),
          h("div", { style: { display: "flex", gap: 4 } },
            renderViewToggle("card", "卡片", svgIcon("grid", 15)),
            renderViewToggle("list", "列表", svgIcon("list", 15)),
            renderViewToggle("masonry", "瀑布流", svgIcon("masonry", 15)),
          ),
          h("select", { value: sortBy, onChange: function (e) { setSortBy(e.target.value); }, style: { height: 30, borderRadius: 8, border: "1px solid " + C.border2, background: C.bg1, color: C.text2, fontSize: 12, padding: "0 6px", font: "inherit" } },
            h("option", { value: "updated" }, "最近修改"),
            h("option", { value: "created" }, "创建时间"),
            h("option", { value: "title" }, "标题"),
          ),
          h("button", { onClick: function () { setShowTemplates(true); }, style: btnStyle(), title: "从模板新建" }, nativeIcon(UI.IconSparkle16), "模板"),
          h("button", { onClick: newNote, "data-notebook-action": "new-note", style: btnStyle("primary") }, nativeIcon(UI.IconPlusOutline16), "新建笔记"),
          // Under Work OS the host header already provides "返回 AI Works", so
          // this standalone affordance would be a second, differently worded
          // back button for the same action. Escape still leaves either way.
          props.workOs ? null : h("button", { onClick: close, style: btnStyle("ghost"), title: "返回 DSH 对话 (Esc)" }, nativeIcon(UI.IconChevronLeftOutline14), compact ? "对话" : "返回对话"),
        ),

        actionError ? h("div", {
          role: "alert",
          style: { padding: "7px 12px", background: "rgba(211,47,47,0.1)", color: C.danger, fontSize: 12, borderBottom: "1px solid " + C.border1 },
        }, actionError) : null,

        // ── Body ───────────────────────────────────────────────────────────
        h("div", { style: { flex: 1, display: "flex", flexDirection: compact ? "column" : "row", minHeight: 0 } },
          // left sidebar
          h("div", { style: { width: compact ? "auto" : 200, maxHeight: compact ? 190 : "none", flexShrink: 0, borderRight: compact ? "none" : "1px solid " + C.border1, borderBottom: compact ? "1px solid " + C.border1 : "none", padding: compact ? 8 : 12, overflowY: "auto", background: C.bg1 } },
            h("button", {
              onClick: function () { setActiveCategory(null); setActiveTag(null); },
              onDragOver: function (e) { e.preventDefault(); },
              onDrop: function (e) {
                e.preventDefault();
                if (dragNoteId) {
                  runAction(api("PATCH", resourcePath("notes", dragNoteId), { categoryId: null }).then(refresh));
                  dragNoteId = null;
                }
              },
              style: {
                display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "6px 8px",
                borderRadius: 8, border: "none", background: activeCategory === null && activeTag === null ? C.hover : "transparent",
                color: activeCategory === null && activeTag === null ? C.accent : C.text1,
                cursor: "pointer", fontSize: 13, fontFamily: C.font, fontWeight: 600,
              },
            },
              nativeIcon(UI.IconListPenOutline16), h("span", { style: { flex: 1, textAlign: "left" } }, "全部笔记"),
              h("span", { style: { fontSize: 11, color: C.caption } }, String(data.notes.filter(function (n) {
                return (n.status || "active") !== "archived";
              }).length)),
            ),

            h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", margin: "12px 4px 6px" } },
              h("span", { style: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: C.caption } }, "笔记本"),
              h("button", {
                onClick: function () {
                  setTextDialog({
                    title: "新建笔记本",
                    initialValue: "",
                    submitLabel: "创建",
                    onSubmit: function (value) { return api("POST", "/api/notebook/categories", { name: value }).then(refresh); },
                  });
                }, style: Object.assign({}, iconBtnStyle, { width: 22, height: 22, fontSize: 16 }),
                title: "新建笔记本",
              }, nativeIcon(UI.IconPlusOutline16)),
            ),
            h("div", null, data.categories.map(renderCategoryRow)),

            h("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", margin: "12px 4px 6px" } },
              h("span", { style: { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: C.caption } }, "标签"),
              h("button", {
                onClick: function () {
                  setTextDialog({
                    title: "新建标签",
                    initialValue: "",
                    submitLabel: "创建",
                    onSubmit: function (value) {
                      var color = TAG_PALETTE[Math.floor(Math.random() * TAG_PALETTE.length)];
                      return api("POST", "/api/notebook/tags", { name: value, color: color }).then(refresh);
                    },
                  });
                }, style: Object.assign({}, iconBtnStyle, { width: 22, height: 22, fontSize: 16 }),
                title: "新建标签",
              }, nativeIcon(UI.IconPlusOutline16)),
            ),
            h("div", null, data.tags.map(renderTagRow)),
          ),

          // note list
          h("div", { style: { flex: 1, overflowY: "auto", padding: compact ? 10 : 16, minWidth: 0 } },
            loading ? h("div", { style: { textAlign: "center", padding: 60, color: C.text3, fontSize: 13 } }, "加载中…")
              : error ? h("div", { style: { textAlign: "center", padding: 60, color: C.danger, fontSize: 13 } }, "错误：" + error)
              : h(Fragment, null,
                h("div", { style: { fontSize: 12, color: C.text3, marginBottom: 10 } }, "共 " + filtered.length + " 篇笔记"),
                filtered.length === 0
                  ? h("div", { style: { textAlign: "center", padding: 60, color: C.text3, fontSize: 13 } },
                    "暂无笔记", h("br"), h("span", { style: { fontSize: 12 } }, "点击「+ 新建笔记」或「模板」开始"))
                  : viewMode === "list"
                    ? h("div", { style: { border: "1px solid " + C.border1, borderRadius: 10, overflow: "hidden" } }, filtered.map(renderNoteRow))
                    : viewMode === "masonry"
                      ? h("div", { style: { columnCount: compact ? 1 : 3, columnGap: 10, columnFill: "balance" } }, filtered.map(renderNoteCard))
                      : h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 } }, filtered.map(function (n) { return h("div", { key: n.id }, renderNoteCard(n)); })),
              ),
          ),
        ),

        // ── Editor ──────────────────────────────────────────────────────────
        editing ? h(EditorModal, {
          note: editing, categories: data.categories, tags: data.tags, references: references,
          onClose: function () { setEditing(null); },
          onSave: function (payload, isNew) {
            var p = isNew
              ? api("POST", "/api/notebook/notes", payload)
              : api("PATCH", resourcePath("notes", editing.id), payload);
            return p.then(function () { setEditing(null); return refresh(); });
          },
          compact: compact,
        }) : null,

        // ── Templates ───────────────────────────────────────────────────────
        showTemplates ? h(TemplateModal, {
          onClose: function () { setShowTemplates(false); },
          onPick: function (tpl) {
            setShowTemplates(false);
            setEditing({ isNew: true, title: tpl.name === "空白笔记" ? "" : tpl.name, content: tpl.content, categoryId: activeCategory, color: "none", tagIds: [] });
          },
        }) : null,

        // ── Delete confirm ──────────────────────────────────────────────────
        deleting ? h(DeleteConfirm, {
          note: deleting,
          onCancel: function () { setDeleting(null); },
          onConfirm: function () {
            // Archiving, not deleting. The note keeps its content and its id,
            // so a Resource that points at it stays pointing at something,
            // and 知识存档 can put it back.
            return api("POST", resourcePath("notes", deleting.id) + "/archive", {}).then(function () {
              setDeleting(null);
              return refresh();
            });
          },
        }) : null,

        textDialog ? h(TextInputModal, {
          title: textDialog.title,
          initialValue: textDialog.initialValue,
          submitLabel: textDialog.submitLabel,
          onCancel: function () { setTextDialog(null); },
          onSubmit: function (value) {
            return textDialog.onSubmit(value).then(function () { setTextDialog(null); });
          },
        }) : null,

        confirmDialog ? h(ActionConfirm, {
          title: confirmDialog.title,
          message: confirmDialog.message,
          onCancel: function () { setConfirmDialog(null); },
          onConfirm: function () {
            return confirmDialog.onConfirm().then(function () { setConfirmDialog(null); });
          },
        }) : null,
      );
    }

    // ── Markdown editor modal ────────────────────────────────────────────────
    function EditorModal(props) {
      var note = props.note || {};
      var [title, setTitle] = useState(note.title || "");
      var [content, setContent] = useState(note.content || "");
      var [categoryId, setCategoryId] = useState(note.categoryId ?? null);
      var [projectId, setProjectId] = useState(note.projectId ?? null);
      var [areaId, setAreaId] = useState(note.areaId ?? null);
      var [color, setColor] = useState(note.color || "none");
      var [tagIds, setTagIds] = useState(note.tagIds || []);
      var [editorMode, setEditorMode] = useState(props.compact ? "edit" : "split");
      var [versions, setVersions] = useState([]);
      var [showVersions, setShowVersions] = useState(false);
      var [saving, setSaving] = useState(false);
      var [saveError, setSaveError] = useState(null);
      var textareaRef = useRef(null);
      var isNew = !!note.isNew;
      var compact = !!props.compact;

      useEffect(function () {
        if (!isNew && note.id) {
          api("GET", resourcePath("notes", note.id, "/versions")).then(function (r) {
            if (r.ok) setVersions(r.versions || []);
          }).catch(function (error) { setSaveError(error.message || "历史版本加载失败"); });
        }
      }, []);

      useEffect(function () {
        if (compact && editorMode === "split") setEditorMode("edit");
      }, [compact, editorMode]);

      var references = props.references || { projects: [], areas: [], errors: {} };
      var selectStyle = {
        height: 30, borderRadius: 8, border: "1px solid " + C.border2,
        background: C.bg1, color: C.text2, fontSize: 12, font: "inherit"
      };

      /**
       * One selector plus the bounded warning that belongs to its own owner.
       * The warning is rendered beside the selector it explains, so an outage in
       * one owner never looks like a failure of the notebook.
       */
      function referenceField(source, currentId, onChange) {
        var selectProps = {
          key: source.key, value: currentId || "", "aria-label": source.label,
          onChange: onChange, style: selectStyle
        };
        selectProps["data-notebook-" + (source.key === "projects" ? "project" : "area") + "-input"] = "";

        var warning = references.errors ? references.errors[source.key] : null;
        var select = h("select", selectProps, referenceOptions(references, source, currentId));
        if (!warning) return select;

        var warningProps = {
          key: source.key + "-warning", role: "status", "aria-live": "polite",
          style: { fontSize: 11, color: C.text3 }
        };
        warningProps["data-notebook-" + (source.key === "projects" ? "project" : "area") + "-warning"] = "";
        return h(Fragment, { key: source.key }, select, h("span", warningProps, warning));
      }

      function toggleTag(tid) {
        setTagIds(function (prev) {
          if (prev.indexOf(tid) >= 0) return prev.filter(function (t) { return t !== tid; });
          return prev.concat([tid]);
        });
      }

      function save() {
        setSaving(true);
        setSaveError(null);
        // Only the ids travel. No Project title or Area name is copied into a
        // note payload, and an unset reference is an explicit null.
        var payload = {
          title: title, content: content, categoryId: categoryId, color: color, tagIds: tagIds,
          projectId: projectId || null, areaId: areaId || null
        };
        props.onSave(payload, isNew).then(function () { setSaving(false); }).catch(function (error) {
          setSaving(false);
          setSaveError(error && error.message ? error.message : "保存失败");
        });
      }

      function restoreVersion(v) {
        setTitle(v.title);
        setContent(v.content);
      }

      function commitEdit(next, selectionStart, selectionEnd) {
        setContent(next);
        window.setTimeout(function () {
          var textarea = textareaRef.current;
          if (!textarea) return;
          textarea.focus();
          textarea.setSelectionRange(selectionStart, selectionEnd);
        }, 0);
      }

      function selection() {
        var textarea = textareaRef.current;
        return textarea ? { start: textarea.selectionStart, end: textarea.selectionEnd } : { start: content.length, end: content.length };
      }

      function wrapSelection(before, after, placeholder) {
        var range = selection();
        var selected = content.slice(range.start, range.end);
        var body = selected || placeholder;
        var next = content.slice(0, range.start) + before + body + after + content.slice(range.end);
        var bodyStart = range.start + before.length;
        commitEdit(next, bodyStart, bodyStart + body.length);
      }

      function prefixSelectedLines(prefixer) {
        var range = selection();
        var lineStart = content.lastIndexOf("\n", Math.max(0, range.start - 1)) + 1;
        var lineEndIndex = content.indexOf("\n", range.end);
        var lineEnd = lineEndIndex < 0 ? content.length : lineEndIndex;
        var block = content.slice(lineStart, lineEnd);
        var lines = block.split("\n");
        var replaced = lines.map(function (line, index) { return prefixer(line, index); }).join("\n");
        var next = content.slice(0, lineStart) + replaced + content.slice(lineEnd);
        commitEdit(next, lineStart, lineStart + replaced.length);
      }

      function heading(level) {
        prefixSelectedLines(function (line) { return "#".repeat(level) + " " + line.replace(/^#{1,6}\s+/u, ""); });
      }

      function insertLink(image) {
        var range = selection();
        var selected = content.slice(range.start, range.end);
        var label = selected || (image ? "图片说明" : "链接文字");
        var prefix = image ? "![" : "[";
        var url = image ? "https://example.com/image.png" : "https://example.com";
        var inserted = prefix + label + "](" + url + ")";
        var next = content.slice(0, range.start) + inserted + content.slice(range.end);
        var urlStart = range.start + prefix.length + label.length + 2;
        commitEdit(next, urlStart, urlStart + url.length);
      }

      function insertCodeBlock() {
        var range = selection();
        var selected = content.slice(range.start, range.end) || "在此输入代码";
        var inserted = "```text\n" + selected + "\n```";
        var next = content.slice(0, range.start) + inserted + content.slice(range.end);
        commitEdit(next, range.start + 8, range.start + 8 + selected.length);
      }

      function insertBlock(block) {
        var range = selection();
        var before = range.start > 0 && content.charAt(range.start - 1) !== "\n" ? "\n" : "";
        var after = range.end < content.length && content.charAt(range.end) !== "\n" ? "\n" : "";
        var inserted = before + block + after;
        var next = content.slice(0, range.start) + inserted + content.slice(range.end);
        commitEdit(next, range.start + before.length, range.start + before.length + block.length);
      }

      function toolButton(label, icon, action, active) {
        return h("button", {
          type: "button", title: label, "aria-label": label, onClick: action,
          style: Object.assign({}, iconBtnStyle, {
            flex: "0 0 auto", border: "1px solid " + (active ? C.accent : C.border1),
            background: active ? C.hover : C.bg1, color: active ? C.accent : C.text2,
          }),
        }, icon);
      }

      function modeButton(mode, label, icon) {
        return h("button", {
          key: mode, type: "button", title: label, "aria-label": label,
          onClick: function () { setEditorMode(mode); },
          style: Object.assign({}, btnStyle(editorMode === mode ? "primary" : undefined), { height: 28, padding: "0 8px" }),
        }, icon, compact ? null : label);
      }

      var showEditor = editorMode !== "preview";
      var showPreview = editorMode !== "edit";

      return h("div", {
        style: { position: "absolute", inset: 0, zIndex: 10, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: compact ? 0 : 20 },
        onClick: function () { props.onClose(); },
      },
        h("div", {
          role: "dialog", "aria-modal": true, "aria-label": isNew ? "新建笔记" : "编辑笔记",
          onClick: function (e) { e.stopPropagation(); },
          style: { width: "100%", maxWidth: compact ? "none" : 1180, height: compact ? "100%" : "90vh", background: C.bgBase, borderRadius: compact ? 0 : 14, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 64px rgba(0,0,0,0.3)" },
        },
          h("div", { style: { display: "flex", alignItems: "center", flexWrap: compact ? "wrap" : "nowrap", gap: compact ? 6 : 10, padding: compact ? "8px 10px" : "10px 16px", borderBottom: "1px solid " + C.border1, flexShrink: 0 } },
            h("input", {
              value: title, placeholder: "笔记标题…", maxLength: 200, onChange: function (e) { setTitle(e.target.value); },
              style: { flex: "1 1 240px", minWidth: 160, border: "none", background: "transparent", fontSize: 17, fontWeight: 600, color: C.text1, outline: "none", font: "inherit" },
            }),
            h("select", { value: categoryId ?? "", "aria-label": "所属笔记本", onChange: function (e) { setCategoryId(e.target.value || null); }, style: selectStyle },
              h("option", { value: "" }, "未分类"),
              props.categories.map(function (c) { return h("option", { key: c.id, value: c.id }, c.name); }),
            ),
            referenceField(REFERENCE_SOURCES[0], projectId, function (e) { setProjectId(e.target.value || null); }),
            referenceField(REFERENCE_SOURCES[1], areaId, function (e) { setAreaId(e.target.value || null); }),
            h("div", { style: { display: "flex", gap: 4 } }, NOTE_COLORS.map(function (pair) {
              return h("button", {
                key: pair[0], type: "button", title: "标记颜色：" + pair[0], "aria-label": "标记颜色：" + pair[0], onClick: function () { setColor(pair[0]); },
                style: { width: 16, height: 16, borderRadius: "50%", border: color === pair[0] ? "2px solid " + C.text1 : "2px solid transparent", background: pair[1], cursor: "pointer", padding: 0 },
              });
            })),
            !isNew ? h("button", { onClick: function () { setShowVersions(!showVersions); }, style: btnStyle(), title: "历史版本" }, nativeIcon(UI.IconArchiveOutline20), "版本") : null,
            h("button", { onClick: function () { props.onClose(); }, style: iconBtnStyle, title: "关闭", "aria-label": "关闭" }, nativeIcon(UI.IconCloseOutline16)),
          ),

          h("div", { style: { display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderBottom: "1px solid " + C.border1, background: C.bg2, overflowX: "auto", flexShrink: 0 } },
            h("select", {
              defaultValue: "", title: "标题层级", "aria-label": "标题层级",
              onChange: function (event) { if (event.target.value) heading(Number(event.target.value)); event.target.value = ""; },
              style: { height: 28, flex: "0 0 auto", borderRadius: 6, border: "1px solid " + C.border1, background: C.bg1, color: C.text2, font: "inherit", fontSize: 12 },
            }, h("option", { value: "" }, "标题"), h("option", { value: "1" }, "H1"), h("option", { value: "2" }, "H2"), h("option", { value: "3" }, "H3")),
            toolButton("粗体", svgIcon("bold", 16), function () { wrapSelection("**", "**", "粗体文字"); }),
            toolButton("斜体", svgIcon("italic", 16), function () { wrapSelection("*", "*", "斜体文字"); }),
            toolButton("下划线", svgIcon("underline", 16), function () { wrapSelection("<u>", "</u>", "下划线文字"); }),
            toolButton("引用", svgIcon("quote", 16), function () { prefixSelectedLines(function (line) { return "> " + line.replace(/^>\s?/u, ""); }); }),
            toolButton("无序列表", svgIcon("unordered", 16), function () { prefixSelectedLines(function (line) { return "- " + line.replace(/^[-*+]\s+/u, ""); }); }),
            toolButton("有序列表", svgIcon("ordered", 16), function () { prefixSelectedLines(function (line, index) { return (index + 1) + ". " + line.replace(/^\d+[.)]\s+/u, ""); }); }),
            toolButton("任务列表", svgIcon("task", 16), function () { prefixSelectedLines(function (line) { return "- [ ] " + line.replace(/^[-*+]\s+(?:\[[ xX]\]\s+)?/u, ""); }); }),
            toolButton("行内代码", nativeIcon(UI.IconCodeOutline16), function () { wrapSelection("`", "`", "代码"); }),
            toolButton("代码块", nativeIcon(UI.IconDataOutline16), insertCodeBlock),
            toolButton("链接", nativeIcon(UI.IconLinkOutline16), function () { insertLink(false); }),
            toolButton("网络图片", svgIcon("image", 16), function () { insertLink(true); }),
            toolButton("表格", svgIcon("table", 16), function () { insertBlock("| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |"); }),
            toolButton("分隔线", svgIcon("rule", 16), function () { insertBlock("---"); }),
            h("span", { style: { width: 1, height: 20, background: C.border2, flex: "0 0 auto", margin: "0 2px" } }),
            modeButton("edit", "编辑", nativeIcon(UI.IconEditOutline16)),
            compact ? null : modeButton("split", "分栏", svgIcon("split", 15)),
            modeButton("preview", "预览", svgIcon("eye", 15)),
          ),

          h("div", { style: { flex: 1, display: "flex", flexDirection: compact ? "column" : "row", minHeight: 0 } },
            h("div", { style: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } },
              h("div", { style: { display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 12px", alignItems: "center", borderBottom: "1px solid " + C.border1 } },
                h("span", { style: { fontSize: 12, color: C.caption } }, "标签："),
                props.tags.map(function (tag) {
                  var on = tagIds.indexOf(tag.id) >= 0;
                  return h("button", {
                    key: tag.id, onClick: function () { toggleTag(tag.id); },
                    style: { fontSize: 11, padding: "2px 8px", borderRadius: 999, cursor: "pointer", border: "1px solid " + (on ? tag.color : C.border2), background: on ? tag.color + "22" : "transparent", color: on ? tag.color : C.text2 },
                  }, tag.name);
                }),
                props.tags.length === 0 ? h("span", { style: { fontSize: 12, color: C.caption } }, "（在左侧创建标签）") : null,
                h("span", { style: { marginLeft: "auto", fontSize: 11, color: C.caption } }, content.length.toLocaleString("zh-CN") + " 字符"),
              ),
              h("div", { style: { flex: 1, display: "flex", minHeight: 0, padding: compact ? 8 : 12, gap: 10 } },
                showEditor ? h("textarea", {
                  ref: textareaRef, value: content, maxLength: 500000, placeholder: "用 Markdown 书写…", onChange: function (e) { setContent(e.target.value); },
                  spellCheck: false,
                  style: { flex: 1, minWidth: 0, resize: "none", borderRadius: 10, border: "1px solid " + C.border2, padding: 14, fontSize: 13, lineHeight: 1.7, color: C.text1, background: C.bg1, fontFamily: C.mono, outline: "none" },
                }) : null,
                showPreview ? h("div", {
                  role: "region", "aria-label": "Markdown 预览",
                  style: { flex: 1, minWidth: 0, overflowY: "auto", fontSize: 13, lineHeight: 1.7, color: C.text1, background: C.bg2, borderRadius: 10, padding: 16, border: "1px solid " + C.border1 },
                }, content ? h(MarkdownText, { text: markdownForPreview(content), streaming: false, codeLabels: { copyLabel: "复制", copiedLabel: "已复制" } }) : h("span", { style: { color: C.caption } }, "（暂无可预览内容）")) : null,
              ),
            ),
            showVersions ? h("div", { style: { width: compact ? "auto" : 220, maxHeight: compact ? 160 : "none", flexShrink: 0, borderLeft: compact ? "none" : "1px solid " + C.border1, borderTop: compact ? "1px solid " + C.border1 : "none", padding: 12, overflowY: "auto", background: C.bg1 } },
              h("div", { style: { fontSize: 11, fontWeight: 700, color: C.caption, textTransform: "uppercase", marginBottom: 8 } }, "历史版本"),
              versions.length === 0 ? h("div", { style: { fontSize: 12, color: C.caption } }, "暂无历史版本") : null,
              versions.map(function (version) {
                return h("button", {
                  type: "button", key: version.id, onClick: function () { restoreVersion(version); },
                  style: { display: "block", width: "100%", textAlign: "left", padding: "8px", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, color: C.text2, borderBottom: "1px solid " + C.border1, background: "transparent" },
                }, h("div", { style: { color: C.text3, fontSize: 11 } }, formatDate(version.savedAt)), h("div", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, version.title || "无标题"), h("div", { style: { fontSize: 11, color: C.accent } }, "恢复到此版本"));
              }),
            ) : null,
          ),

          h("div", { style: { display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, padding: compact ? "9px 10px" : "12px 16px", borderTop: "1px solid " + C.border1, flexShrink: 0 } },
            saveError ? h("span", { role: "alert", style: { marginRight: "auto", color: C.danger, fontSize: 12 } }, saveError) : null,
            h("button", { onClick: function () { props.onClose(); }, style: btnStyle() }, "取消"),
            h("button", { onClick: save, disabled: saving, "data-notebook-action": "save", style: btnStyle("primary") }, saving ? "保存中…" : "保存"),
          ),
        ),
      );
    }

    // ── Template modal ──────────────────────────────────────────────────────
    function TemplateModal(props) {
      return h("div", {
        style: { position: "absolute", inset: 0, zIndex: 10, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
        onClick: function () { props.onClose(); },
      },
        h("div", {
          onClick: function (e) { e.stopPropagation(); },
          style: { width: 420, background: C.bgBase, borderRadius: 14, padding: 20, boxShadow: "0 24px 64px rgba(0,0,0,0.3)" },
        },
          h("div", { style: { fontWeight: 700, fontSize: 15, marginBottom: 14 } }, "从模板新建"),
          TEMPLATES.map(function (tpl) {
            return h("button", {
              key: tpl.name, onClick: function () { props.onPick(tpl); },
              style: {
                display: "block", width: "100%", textAlign: "left", padding: "10px 12px",
                marginBottom: 6, borderRadius: 8, border: "1px solid " + C.border1,
                background: C.bg2, color: C.text1, cursor: "pointer", fontSize: 13, fontFamily: C.font,
              },
            },
              h("span", { style: { fontWeight: 600 } }, tpl.name),
              h("span", { style: { display: "block", fontSize: 11, color: C.caption, marginTop: 2 } }, plainPreview(tpl.content) || "（空白）"),
            );
          }),
        ),
      );
    }

    // ── Delete confirm ──────────────────────────────────────────────────────
    function DeleteConfirm(props) {
      var note = props.note;
      var [saving, setSaving] = useState(false);
      var [modalError, setModalError] = useState(null);

      function confirm() {
        setSaving(true);
        setModalError(null);
        props.onConfirm().catch(function (error) {
          setSaving(false);
          setModalError(error && error.message ? error.message : "归档失败");
        });
      }

      return h("div", {
        style: { position: "absolute", inset: 0, zIndex: 20, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
        onClick: function () { props.onCancel(); },
      },
        h("div", {
          onClick: function (e) { e.stopPropagation(); },
          style: { width: 320, background: C.bgBase, borderRadius: 14, padding: 20, boxShadow: "0 24px 64px rgba(0,0,0,0.3)" },
        },
          h("div", { style: { fontWeight: 700, fontSize: 15, marginBottom: 8 } }, "归档笔记"),
          h("div", { style: { fontSize: 13, color: C.text2, marginBottom: 18 } }, "「" + (note.title || "无标题") + "」将移入存档，可在「知识存档」中恢复。"),
          modalError ? h("div", { role: "alert", style: { color: C.danger, fontSize: 12, marginBottom: 10 } }, modalError) : null,
          h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
            h("button", { disabled: saving, onClick: function () { props.onCancel(); }, style: btnStyle() }, "取消"),
            h("button", { disabled: saving, onClick: confirm, style: btnStyle("danger") }, saving ? "归档中…" : "归档"),
          ),
        ),
      );
    }

    function TextInputModal(props) {
      var [value, setValue] = useState(props.initialValue || "");
      var [saving, setSaving] = useState(false);
      var [modalError, setModalError] = useState(null);

      function submit() {
        var normalized = value.trim();
        if (!normalized) {
          setModalError("名称不能为空");
          return;
        }
        if (normalized.length > 80) {
          setModalError("名称不能超过 80 个字符");
          return;
        }
        setSaving(true);
        setModalError(null);
        props.onSubmit(normalized).catch(function (error) {
          setSaving(false);
          setModalError(error && error.message ? error.message : "操作失败");
        });
      }

      return h("div", {
        style: { position: "absolute", inset: 0, zIndex: 30, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
        onClick: props.onCancel,
      },
        h("div", {
          role: "dialog", "aria-modal": true, "aria-label": props.title,
          onClick: function (event) { event.stopPropagation(); },
          style: { width: "100%", maxWidth: 380, background: C.bgBase, borderRadius: 14, padding: 18, boxShadow: "0 24px 64px rgba(0,0,0,0.3)" },
        },
          h("div", { style: { fontWeight: 700, fontSize: 15, marginBottom: 12 } }, props.title),
          h("input", {
            autoFocus: true,
            maxLength: 80,
            value: value,
            onChange: function (event) { setValue(event.target.value); },
            onKeyDown: function (event) {
              if (event.key === "Enter") submit();
              if (event.key === "Escape") props.onCancel();
            },
            style: inputStyle,
          }),
          modalError ? h("div", { role: "alert", style: { color: C.danger, fontSize: 12, marginTop: 8 } }, modalError) : null,
          h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 } },
            h("button", { type: "button", disabled: saving, onClick: props.onCancel, style: btnStyle() }, "取消"),
            h("button", { type: "button", disabled: saving, onClick: submit, style: btnStyle("primary") }, saving ? "处理中…" : (props.submitLabel || "确定")),
          ),
        ),
      );
    }

    function ActionConfirm(props) {
      var [saving, setSaving] = useState(false);
      var [modalError, setModalError] = useState(null);

      function confirm() {
        setSaving(true);
        setModalError(null);
        props.onConfirm().catch(function (error) {
          setSaving(false);
          setModalError(error && error.message ? error.message : "操作失败");
        });
      }

      return h("div", {
        style: { position: "absolute", inset: 0, zIndex: 30, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
        onClick: props.onCancel,
      },
        h("div", {
          role: "alertdialog", "aria-modal": true, "aria-label": props.title,
          onClick: function (event) { event.stopPropagation(); },
          style: { width: "100%", maxWidth: 380, background: C.bgBase, borderRadius: 14, padding: 18, boxShadow: "0 24px 64px rgba(0,0,0,0.3)" },
        },
          h("div", { style: { fontWeight: 700, fontSize: 15, marginBottom: 8 } }, props.title),
          h("div", { style: { fontSize: 13, color: C.text2, lineHeight: 1.6 } }, props.message),
          modalError ? h("div", { role: "alert", style: { color: C.danger, fontSize: 12, marginTop: 8 } }, modalError) : null,
          h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 } },
            h("button", { type: "button", disabled: saving, onClick: props.onCancel, style: btnStyle() }, "取消"),
            h("button", { type: "button", disabled: saving, onClick: confirm, style: btnStyle("danger") }, saving ? "处理中…" : "删除"),
          ),
        ),
      );
    }

    function SaveToNotebookAction(props) {
      var snapshot = props.useSession ? props.useSession(function (state) { return state; }) : null;
      var sessionTitle = props.useSessions ? props.useSessions(function (state) {
        var row = state.byId && state.byId[props.sessionId];
        return row ? (row.displayTitle || row.title || "DSH 会话") : "DSH 会话";
      }) : "DSH 会话";
      var [status, setStatus] = useState("idle");
      var excerpt = conversationExcerpt(snapshot, props.messageId);

      useEffect(function () { setStatus("idle"); }, [props.messageId]);

      function saveExcerpt() {
        if (!excerpt || status === "saving") return;
        setStatus("saving");
        api("POST", "/api/notebook/notes", {
          title: excerpt.title,
          content: excerpt.content,
          categoryId: null,
          color: "none",
          tagIds: [],
          source: { kind: "dsh-assistant", sessionId: props.sessionId, messageId: props.messageId },
        }).then(function () {
          setStatus("saved");
        }).catch(function () {
          setStatus("error");
        });
      }

      var label = status === "saving" ? "正在存入笔记本"
        : status === "saved" ? "已存入笔记本"
          : status === "error" ? "存入失败，点击重试"
            : "将这轮对话存入笔记本";
      return h("button", {
        type: "button", title: label + " · " + sessionTitle, "aria-label": label,
        disabled: !excerpt || status === "saving" || status === "saved",
        onClick: saveExcerpt,
        style: {
          width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center",
          border: "none", borderRadius: 6, padding: 0, cursor: status === "saved" ? "default" : "pointer",
          background: "transparent", color: status === "error" ? C.danger : status === "saved" ? "var(--dsw-alias-state-success-primary, #159447)" : C.text3,
        },
      }, status === "saved" ? svgIcon("check", 16) : nativeIcon(UI.IconListPenOutline16));
    }

    // ── Work OS integration ─────────────────────────────────────────────────
    //
    // The notebook runs in one of two exclusive modes:
    //
    //   work-os     Work OS hosts the notebook as the `knowledge.notebook`
    //               destination. Work OS owns the entry point and the center
    //               column, so this plugin registers neither a sidebar button
    //               nor a `conversation` slot of its own.
    //   standalone  No Work OS on the page. The original native sidebar button
    //               and center-column shadowing behaviour is used unchanged.
    //
    // Work OS is deliberately the last enabled bundle, so it does not exist yet
    // when this plugin initializes. The mode therefore cannot be decided
    // synchronously: the registration is queued for Work OS to drain, and a
    // bounded wait decides standalone if Work OS never arrives. Every surface is
    // gated on that decision so the two modes can never both be live.
    var WORK_OS_API_KEY = "__ACKS_WORK_OS__";
    var WORK_OS_PENDING_KEY = "__ACKS_WORK_OS_PENDING__";
    var WORK_OS_WAIT_MS = 4000;

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
        },
      };
    }

    // Mirrors store.bindSurface: mount lazily, and only while the condition
    // holds, so a slot is never registered in the mode that must not own it.
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

    function bindWorkOsDestination(ctx, gate) {
      var destinationDispose = null;
      var queueEntry = null;
      var timerId = null;

      function renderDestination(api) {
        return function NotebookDestination(props) {
          return h(NotebookPage, Object.assign({}, props, {
            sessions: ctx.sessions,
            workOs: api,
          }));
        };
      }

      function adopt(api) {
        if (gate.isDecided() || !api || typeof api.registerDestination !== "function") return;
        try {
          destinationDispose = api.registerDestination({
            id: "knowledge.notebook",
            sectionId: "knowledge",
            label: "Notebook",
            localized: "笔记本",
            order: 10,
            icon: UI.IconListPenOutline16,
            render: renderDestination(api),
          });
        } catch (error) {
          // A rejected registration must strand nothing: fall back instead.
          destinationDispose = null;
        }
        stopWaiting();
        gate.decide(!!destinationDispose);
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
        if (destinationDispose) {
          var dispose = destinationDispose;
          destinationDispose = null;
          dispose();
        }
      };
    }

    // ── Plugin entry ────────────────────────────────────────────────────────
    function apply(ctx) {
      var slots = ctx.slots;
      if (!slots) return;

      var gate = createModeGate();

      slots.inject("sidebar.footer.action", function () {
        return bindWhenStandalone(gate, function () {
          return slots.register(
            { name: "sidebar.footer.action", id: "notebook", order: 100, label: function () { return "笔记本"; } },
            NotebookNavButton,
          );
        });
      });

      slots.inject("conversation", function () {
        // The Work OS handshake lives here so its cleanup is owned by the same
        // slot lifecycle that owns the standalone center surface.
        var releaseWorkOs = bindWorkOsDestination(ctx, gate);
        var releaseStandalone = bindWhenStandalone(gate, function () {
          return store.bindSurface(function () {
            return slots.register(
              { name: "conversation", priority: -100, label: function () { return "笔记本"; } },
              function NotebookSurface(props) { return h(NotebookPage, Object.assign({}, props, { sessions: ctx.sessions })); },
            );
          });
        });
        return function () {
          releaseStandalone();
          releaseWorkOs();
        };
      });

      // Capture belongs to the conversation, not to either notebook surface, so
      // it is registered identically in both modes.
      slots.inject("conversation.chat.assistant-actions", function () {
        return slots.register(
          { name: "conversation.chat.assistant-actions", id: "notebook-save", order: 20, label: function () { return "存入笔记本"; } },
          SaveToNotebookAction,
        );
      });
    }

    exports.apply = apply;
    exports.inject = ["slots", "sessions"];
    return module.exports;
  },
});
