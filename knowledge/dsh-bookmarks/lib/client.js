/**
 * dsh-bookmarks — client plugin.
 *
 * Publishes the `knowledge.bookmarks` Work OS destination through browser
 * contract v1, and falls back to one reversible standalone DSH surface when
 * Work OS is absent. Buildless: no JSX, no bundler, no import statements.
 *
 * Work OS is deliberately the last enabled bundle, so it does not exist when
 * this plugin initializes. The mode therefore cannot be decided synchronously:
 * the registration is queued for Work OS to drain, and a bounded wait selects
 * standalone if Work OS never arrives. Both surfaces are gated on that one
 * decision, so only ever one Bookmarks root exists.
 */
window.__ModuleLoader__.load({
  id: "dsh-bookmarks",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var UI = require("@deepseek-ai/dsh-client-ui-primitives");
    var h = React.createElement;

    var WORK_OS_API_KEY = "__ACKS_WORK_OS__";
    var WORK_OS_PENDING_KEY = "__ACKS_WORK_OS_PENDING__";
    var WORK_OS_WAIT_MS = 4000;
    var DESTINATION_ID = "knowledge.bookmarks";

    // DSH primitive names vary by release; take the first that exists so a
    // missing icon degrades to a neutral one instead of crashing the render.
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
      bookmark: pickIcon("IconBookmarkOutline16", "IconLinkOutline16", "IconListPenOutline16"),
      open: pickIcon("IconExternalLinkOutline16", "IconLinkOutline16", "IconChevronRightOutline14"),
      edit: pickIcon("IconEditOutline16", "IconListPenOutline16"),
      archive: pickIcon("IconArchiveOutline16", "IconTrashOutline16"),
      restore: pickIcon("IconRefreshOutline16", "IconUndoOutline16"),
      search: pickIcon("IconSearchOutline16", "IconListPenOutline16")
    };

    var API_PREFIX = "/api/bookmarks";
    var STYLE_ID = "dsh-bookmarks-style";

    var READING_STATES = ["unread", "reading", "read"];
    var READING_LABELS = { unread: "未读", reading: "阅读中", read: "已读" };

    // ── API ─────────────────────────────────────────────────────────────────

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
              throw new Error((payload && payload.error) || "请求失败");
            }
            return payload;
          },
          function () {
            throw new Error("服务器返回了无法解析的响应");
          }
        );
      });
    }

    function bookmarkPath(id, action) {
      return "/bookmarks/" + encodeURIComponent(id) + (action ? "/" + action : "");
    }

    // Storage is local and host writes are validated, but a damaged or manually
    // edited storage file must not turn into an executable link in the browser.
    // Invalid values remain visible as text so the user can diagnose the record.
    function safeExternalHref(value) {
      if (typeof value !== "string" || typeof window.URL !== "function") return null;
      try {
        var parsed = new window.URL(value);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
        if (parsed.username || parsed.password) return null;
        return parsed.href;
      } catch (error) {
        return null;
      }
    }

    // ── Store ───────────────────────────────────────────────────────────────
    //
    // One store per plugin instance. Components read through to it at render
    // time and use local state only as a re-render trigger, so the list, search
    // and editor can never disagree.

    function emptyDraft() {
      return { title: "", url: "", notes: "", tags: "", readingState: "unread", projectId: "", areaId: "" };
    }

    function parseTags(value) {
      // Commas or whitespace; the host trims, de-duplicates and bounds them.
      return String(value || "")
        .split(/[,，\s]+/u)
        .map(function (tag) { return tag.trim(); })
        .filter(function (tag) { return tag.length > 0; });
    }

    function createBookmarksStore() {
      var state = {
        phase: "loading",
        bookmarks: [],
        error: null,
        actionError: null,
        validation: null,
        pending: {},
        search: "",
        stateFilter: "all",
        tagFilter: null,
        showArchived: false,
        // Reference choices are a separate concern from the Bookmarks load: an
        // outage in either owner must never put the list into an error state,
        // and each owner fails on its own.
        projects: [],
        projectsError: null,
        areas: [],
        areasError: null,
        draft: emptyDraft(),
        editingId: null,
        editDraft: emptyDraft()
      };
      var listeners = [];
      var disposed = false;
      var loadStarted = false;

      function emit() {
        var current = listeners.slice();
        for (var index = 0; index < current.length; index += 1) {
          try {
            current[index]();
          } catch (error) {
            // One bad subscriber must not stop the others updating.
          }
        }
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

      function applyBookmark(record) {
        var replaced = false;
        var bookmarks = state.bookmarks.map(function (existing) {
          if (existing.id !== record.id) return existing;
          replaced = true;
          return record;
        });
        if (!replaced) bookmarks = [record].concat(bookmarks);
        patch({ bookmarks: bookmarks, actionError: null });
      }

      function load() {
        if (disposed) return Promise.resolve();
        loadStarted = true;
        patch({ phase: "loading", error: null });
        return request("GET", "/state").then(
          function (payload) {
            patch({ phase: "ready", bookmarks: payload.bookmarks || [], error: null });
          },
          function (error) {
            patch({ phase: "error", error: error.message || "加载失败" });
          }
        );
      }

      var referenceLoadStarted = { projects: false, areas: false };

      /**
       * Reads one owner's list for its selector. Each owner is settled on its
       * own, so an outage in one leaves the other selector and the whole
       * Bookmarks list fully usable.
       */
      function loadReference(key, path, collection, failure) {
        if (disposed || referenceLoadStarted[key]) return Promise.resolve();
        referenceLoadStarted[key] = true;
        return fetch(path, {
          method: "GET",
          credentials: "same-origin",
          headers: { accept: "application/json" }
        }).then(function (response) {
          return response.json().then(function (payload) {
            if (!response.ok || !payload || payload.ok !== true) throw new Error("读取失败");
            return payload;
          });
        }).then(
          function (payload) {
            var changes = {};
            changes[key] = Array.isArray(payload[collection]) ? payload[collection] : [];
            changes[key + "Error"] = null;
            patch(changes);
          },
          function () {
            var changes = {};
            changes[key] = [];
            changes[key + "Error"] = failure;
            patch(changes);
          }
        );
      }

      function loadProjects() {
        return loadReference("projects", "/api/projects/state", "projects",
          "无法读取项目列表，暂时只能创建未关联书签。");
      }

      function loadAreas() {
        return loadReference("areas", "/api/areas/state", "areas",
          "无法读取领域列表，暂时只能创建未关联书签。");
      }

      // Mounting again must not re-request state.
      function ensureLoaded() {
        loadProjects();
        loadAreas();
        if (loadStarted) return Promise.resolve();
        return load();
      }

      function run(key, work) {
        if (state.pending[key]) return Promise.resolve(null);
        setPending(key, true);
        return work().then(
          function (payload) {
            setPending(key, false);
            if (payload && payload.bookmark) applyBookmark(payload.bookmark);
            return payload;
          },
          function (error) {
            setPending(key, false);
            patch({ actionError: error.message || "操作失败" });
            return null;
          }
        );
      }

      function draftBody(draft) {
        var body = {
          title: String(draft.title || "").trim(),
          url: String(draft.url || "").trim(),
          readingState: draft.readingState,
          projectId: draft.projectId ? draft.projectId : null,
          areaId: draft.areaId ? draft.areaId : null
        };
        if (draft.notes) body.notes = draft.notes;
        var tags = parseTags(draft.tags);
        if (tags.length > 0) body.tags = tags;
        return body;
      }

      function validateDraft(draft) {
        if (String(draft.title || "").trim().length === 0) return "请输入标题";
        if (String(draft.url || "").trim().length === 0) return "请输入网址";
        return null;
      }

      function mergeDraft(current, changes) {
        var next = {};
        for (var key in current) {
          if (Object.prototype.hasOwnProperty.call(current, key)) next[key] = current[key];
        }
        for (var change in changes) {
          if (Object.prototype.hasOwnProperty.call(changes, change)) next[change] = changes[change];
        }
        return next;
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
        setSearch: function (value) { patch({ search: value }); },
        setStateFilter: function (value) { patch({ stateFilter: value }); },
        setTagFilter: function (value) { patch({ tagFilter: state.tagFilter === value ? null : value }); },
        setShowArchived: function (value) { patch({ showArchived: !!value, editingId: null }); },
        setDraft: function (changes) {
          patch({ draft: mergeDraft(state.draft, changes), validation: null });
        },
        createBookmark: function () {
          var problem = validateDraft(state.draft);
          if (problem) {
            patch({ validation: problem });
            return Promise.resolve(null);
          }
          var body = draftBody(state.draft);
          return run("create", function () {
            return request("POST", "/bookmarks", body);
          }).then(function (payload) {
            // The draft survives a rejection so the user can correct it.
            if (payload) patch({ draft: emptyDraft(), validation: null });
            return payload;
          });
        },
        startEdit: function (record) {
          patch({
            editingId: record.id,
            actionError: null,
            validation: null,
            editDraft: {
              title: record.title,
              url: record.url,
              notes: record.notes,
              tags: record.tags.join(", "),
              readingState: record.readingState,
              projectId: record.projectId || "",
              areaId: record.areaId || ""
            }
          });
        },
        setEditDraft: function (changes) {
          patch({ editDraft: mergeDraft(state.editDraft, changes), validation: null });
        },
        cancelEdit: function () {
          patch({ editingId: null, validation: null, actionError: null });
        },
        saveEdit: function () {
          var id = state.editingId;
          if (!id) return Promise.resolve(null);
          var problem = validateDraft(state.editDraft);
          if (problem) {
            patch({ validation: problem });
            return Promise.resolve(null);
          }
          // notes and tags are sent even when emptied, so clearing them works.
          var body = draftBody(state.editDraft);
          body.notes = state.editDraft.notes || "";
          body.tags = parseTags(state.editDraft.tags);
          return run(id + ":edit", function () {
            return request("PATCH", bookmarkPath(id), body);
          }).then(function (payload) {
            // A failed save keeps the editor open with the reason visible.
            if (payload) patch({ editingId: null, validation: null });
            return payload;
          });
        },
        transition: function (id, action) {
          return run(id + ":" + action, function () {
            return request("POST", bookmarkPath(id, action), {});
          });
        },
        dispose: function () {
          disposed = true;
          listeners.length = 0;
        }
      };
    }

    // ── Styles ──────────────────────────────────────────────────────────────
    //
    // Every rule is scoped under .dsh-bookmarks-root. The plugin never writes a
    // global body style.

    var STYLE_TEXT = [
      ".dsh-bookmarks-root{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;overflow:hidden;",
      "color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-base,#f7f4ec);font-size:14px}",
      ".dsh-bookmarks-root *{box-sizing:border-box}",
      ".dsh-bookmarks-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0;padding:10px 16px;",
      "border-bottom:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12))}",
      ".dsh-bookmarks-body{flex:1;min-height:0;overflow:auto;padding:12px 16px 20px}",
      ".dsh-bookmarks-form{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;padding:10px 16px;",
      "border-bottom:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12))}",
      ".dsh-bookmarks-input{font:inherit;padding:6px 10px;border-radius:8px;min-width:0;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.2));background:var(--dsw-alias-bg-layer-1,#fff);color:inherit}",
      ".dsh-bookmarks-input[data-bookmarks-title-input]{flex:1 1 180px}",
      ".dsh-bookmarks-input[data-bookmarks-url-input]{flex:1 1 240px}",
      ".dsh-bookmarks-input[data-bookmarks-notes-input]{flex:1 1 100%;min-height:52px;resize:vertical}",
      ".dsh-bookmarks-input[data-bookmarks-search]{flex:1 1 200px}",
      ".dsh-bookmarks-primary{cursor:pointer;font:inherit;padding:6px 14px;border-radius:8px;border:0;",
      "color:#fff;background:var(--acks-work-os-orange,#ff6b1a)}",
      ".dsh-bookmarks-primary:disabled{opacity:.72;cursor:default}",
      ".dsh-bookmarks-chip{cursor:pointer;font:inherit;font-size:13px;padding:5px 10px;border-radius:999px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.16));background:transparent;color:inherit}",
      ".dsh-bookmarks-chip[aria-pressed='true']{color:#fff;background:var(--acks-work-os-orange,#ff6b1a);",
      "border-color:var(--acks-work-os-orange,#ff6b1a)}",
      ".dsh-bookmarks-chip:focus-visible,.dsh-bookmarks-icon:focus-visible,.dsh-bookmarks-primary:focus-visible{",
      "outline:2px solid var(--acks-work-os-orange-deep,#d4530e);outline-offset:2px}",
      ".dsh-bookmarks-item{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;margin-bottom:8px;",
      "border-radius:10px;border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12));",
      "background:var(--dsw-alias-bg-layer-1,#fff)}",
      ".dsh-bookmarks-title{font-weight:600;word-break:break-word}",
      ".dsh-bookmarks-url{display:inline-block;max-width:100%;overflow-wrap:anywhere;font-size:12px;",
      "color:var(--acks-work-os-orange-deep,#d4530e)}",
      ".dsh-bookmarks-notes{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;",
      "color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-bookmarks-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;font-size:12px;",
      "color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-bookmarks-tag{padding:0 6px;border-radius:999px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.18))}",
      ".dsh-bookmarks-actions{display:flex;gap:4px;margin-left:auto;flex-shrink:0}",
      ".dsh-bookmarks-icon{cursor:pointer;display:inline-flex;align-items:center;justify-content:center;",
      "width:30px;height:30px;border-radius:8px;border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.16));",
      "background:transparent;color:inherit}",
      ".dsh-bookmarks-icon:disabled{opacity:.5;cursor:default}",
      ".dsh-bookmarks-note{padding:24px 8px;text-align:center;color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-bookmarks-error{margin:0 0 10px;padding:8px 12px;border-radius:8px;font-size:13px;",
      "border:1px solid rgba(212,83,14,.4);background:rgba(255,107,26,.08);color:var(--acks-work-os-orange-deep,#d4530e)}",
      ".dsh-bookmarks-editor{flex:1;display:flex;flex-wrap:wrap;gap:8px}",
      "@media (max-width:640px){.dsh-bookmarks-form{padding:10px 12px}.dsh-bookmarks-body{padding:10px 12px 16px}}"
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

    // ── Presentation ────────────────────────────────────────────────────────

    function iconButton(options) {
      return h("button", {
        key: options.key,
        type: "button",
        className: "dsh-bookmarks-icon",
        "data-bookmarks-action": options.action,
        "aria-label": options.label,
        title: options.label,
        disabled: !!options.disabled,
        onClick: options.onClick
      }, h(options.icon, { size: 16, "aria-hidden": true }));
    }

    function statusRegion(state) {
      var messages = [];
      if (state.validation) messages.push(state.validation);
      if (state.actionError) messages.push(state.actionError);
      return h("div", {
        className: "dsh-bookmarks-status",
        "data-bookmarks-validation": "",
        role: "status",
        "aria-live": "polite"
      }, messages.length ? h("p", { className: "dsh-bookmarks-error" }, messages.join("；")) : null);
    }

    // ── References ──────────────────────────────────────────────────────────
    //
    // Bookmarks owns two nullable ids and no copy of either record. Both are
    // resolved for display through the owner's own list, so a rename needs no
    // propagation here.

    var REFERENCES = {
      projects: { titleKey: "title", none: "未关联项目", unknown: "未知项目", label: "关联项目" },
      areas: { titleKey: "name", none: "未关联领域", unknown: "未知领域", label: "关联领域" }
    };

    function referenceTitle(kind, record) {
      var title = record[REFERENCES[kind].titleKey];
      return record.lifecycle === "archived" ? title + "（已归档）" : title;
    }

    /**
     * A reference resolves through its owner's list. A value that no longer
     * matches is stated plainly rather than rendered blank or as a raw id, and
     * nothing about a referenced record ever becomes an anchor — even when its
     * title happens to look like a URL.
     */
    function referenceLabel(state, kind, id) {
      if (!id) return null;
      var records = state[kind];
      for (var index = 0; index < records.length; index += 1) {
        if (records[index].id === id) return referenceTitle(kind, records[index]);
      }
      return REFERENCES[kind].unknown;
    }

    function referenceOptions(state, kind, currentId) {
      var options = [h("option", { key: "none", value: "" }, REFERENCES[kind].none)];
      var seen = {};
      state[kind].forEach(function (record) {
        // Only active records are offered for a new link; an existing link to
        // an archived one stays selectable so it can be seen and removed.
        if (record.lifecycle !== "active" && record.id !== currentId) return;
        seen[record.id] = true;
        options.push(h("option", { key: record.id, value: record.id }, referenceTitle(kind, record)));
      });
      if (currentId && !seen[currentId]) {
        options.push(h("option", { key: currentId, value: currentId }, REFERENCES[kind].unknown));
      }
      return options;
    }

    /**
     * One selector plus the bounded warning that belongs to its own owner. The
     * warning is rendered beside the selector it explains, so an outage in one
     * owner never looks like a failure of the destination.
     */
    function referenceField(state, kind, currentId, prefix, onChange) {
      var inputAttribute = kind === "projects" ? "data-bookmarks-project-input" : "data-bookmarks-area-input";
      var warningAttribute = kind === "projects" ? "data-bookmarks-project-warning" : "data-bookmarks-area-warning";
      var selectProps = {
        key: kind,
        className: "dsh-bookmarks-input",
        value: currentId || "",
        "aria-label": REFERENCES[kind].label,
        onChange: onChange
      };
      selectProps[inputAttribute] = prefix;

      var warning = state[kind + "Error"];
      if (!warning) return [h("select", selectProps, referenceOptions(state, kind, currentId))];

      var warningProps = {
        key: kind + "-warning",
        className: "dsh-bookmarks-meta",
        role: "status",
        "aria-live": "polite"
      };
      warningProps[warningAttribute] = "";
      return [
        h("select", selectProps, referenceOptions(state, kind, currentId)),
        h("span", warningProps, warning)
      ];
    }

    function fieldInputs(state, draft, onChange, prefix) {
      return [
        h("input", {
          key: "title",
          className: "dsh-bookmarks-input",
          "data-bookmarks-title-input": prefix,
          type: "text",
          value: draft.title,
          "aria-label": "标题",
          placeholder: "标题",
          maxLength: 200,
          onChange: function (event) { onChange({ title: event.target.value }); }
        }),
        h("input", {
          key: "url",
          className: "dsh-bookmarks-input",
          "data-bookmarks-url-input": prefix,
          type: "url",
          value: draft.url,
          "aria-label": "网址",
          placeholder: "https://",
          maxLength: 2048,
          onChange: function (event) { onChange({ url: event.target.value }); }
        }),
        h("input", {
          key: "tags",
          className: "dsh-bookmarks-input",
          "data-bookmarks-tags-input": prefix,
          type: "text",
          value: draft.tags,
          "aria-label": "标签，使用逗号或空格分隔",
          placeholder: "标签（逗号分隔）",
          onChange: function (event) { onChange({ tags: event.target.value }); }
        }),
        h("select", {
          key: "state",
          className: "dsh-bookmarks-input",
          "data-bookmarks-state-input": prefix,
          value: draft.readingState,
          "aria-label": "阅读状态",
          onChange: function (event) { onChange({ readingState: event.target.value }); }
        }, READING_STATES.map(function (value) {
          return h("option", { key: value, value: value }, READING_LABELS[value]);
        })),
        referenceField(state, "projects", draft.projectId, prefix, function (event) {
          onChange({ projectId: event.target.value });
        }),
        referenceField(state, "areas", draft.areaId, prefix, function (event) {
          onChange({ areaId: event.target.value });
        }),
        h("textarea", {
          key: "notes",
          className: "dsh-bookmarks-input",
          "data-bookmarks-notes-input": prefix,
          value: draft.notes,
          "aria-label": "备注",
          placeholder: "备注（纯文本）",
          maxLength: 20000,
          onChange: function (event) { onChange({ notes: event.target.value }); }
        })
      ];
    }

    function createForm(store, state) {
      return h("form", {
        className: "dsh-bookmarks-form",
        "data-bookmarks-form": "",
        onSubmit: function (event) {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          store.createBookmark();
        }
      }, fieldInputs(state, state.draft, function (changes) { store.setDraft(changes); }, "create").concat([
        h("button", {
          key: "submit",
          type: "submit",
          className: "dsh-bookmarks-primary",
          "data-bookmarks-action": "create",
          disabled: store.isPending("create")
        }, store.isPending("create") ? "保存中…" : "添加书签")
      ]));
    }

    function loadFrame(store, state, body) {
      if (state.phase === "loading") {
        return h("p", { className: "dsh-bookmarks-note" }, "载入中…");
      }
      if (state.phase === "error") {
        return h("div", { className: "dsh-bookmarks-note" }, [
          h("p", { key: "message", className: "dsh-bookmarks-error" }, "加载失败：" + state.error),
          h("button", {
            key: "retry",
            type: "button",
            className: "dsh-bookmarks-primary",
            "data-bookmarks-action": "retry",
            onClick: function () { store.load(); }
          }, "重试")
        ]);
      }
      return body();
    }

    function matchesSearch(state, record, needle) {
      if (needle.length === 0) return true;
      var haystack = [
        record.title, record.url, record.notes,
        referenceLabel(state, "projects", record.projectId) || "",
        referenceLabel(state, "areas", record.areaId) || ""
      ]
        .concat(record.tags)
        .join(" ")
        .toLowerCase();
      return haystack.indexOf(needle) >= 0;
    }

    function visibleBookmarks(state) {
      var needle = String(state.search || "").trim().toLowerCase();
      return state.bookmarks.filter(function (record) {
        var wanted = state.showArchived ? "archived" : "active";
        if (record.status !== wanted) return false;
        if (state.stateFilter !== "all" && record.readingState !== state.stateFilter) return false;
        if (state.tagFilter && record.tags.indexOf(state.tagFilter) < 0) return false;
        return matchesSearch(state, record, needle);
      }).sort(function (left, right) {
        if (state.showArchived) return (right.archivedAt || 0) - (left.archivedAt || 0);
        return right.createdAt - left.createdAt;
      });
    }

    function knownTags(state) {
      var seen = [];
      state.bookmarks.forEach(function (record) {
        record.tags.forEach(function (tag) {
          if (seen.indexOf(tag) < 0) seen.push(tag);
        });
      });
      return seen;
    }

    function bookmarkRow(store, state, record) {
      if (state.editingId === record.id) return editorRow(store, state, record);

      var safeUrl = safeExternalHref(record.url);

      var actions = [
        iconButton({
          key: "edit",
          action: "edit",
          label: "编辑「" + record.title + "」",
          icon: ICONS.edit,
          onClick: function () { store.startEdit(record); }
        })
      ];
      if (record.status === "archived") {
        actions.push(iconButton({
          key: "restore",
          action: "restore",
          label: "恢复「" + record.title + "」",
          icon: ICONS.restore,
          disabled: store.isPending(record.id + ":restore"),
          onClick: function () { store.transition(record.id, "restore"); }
        }));
      } else {
        actions.push(iconButton({
          key: "archive",
          action: "archive",
          label: "存档「" + record.title + "」",
          icon: ICONS.archive,
          disabled: store.isPending(record.id + ":archive"),
          onClick: function () { store.transition(record.id, "archive"); }
        }));
      }

      var projectName = referenceLabel(state, "projects", record.projectId);
      var areaName = referenceLabel(state, "areas", record.areaId);
      var meta = [
        h("span", { key: "state" }, READING_LABELS[record.readingState] || record.readingState)
      ].concat(projectName ? [h("span", { key: "project" }, "项目：" + projectName)] : [])
        .concat(areaName ? [h("span", { key: "area" }, "领域：" + areaName)] : [])
        .concat(record.tags.map(function (tag) {
        return h("span", { key: "tag-" + tag, className: "dsh-bookmarks-tag" }, tag);
      }));
      if (record.status === "archived") meta.push(h("span", { key: "archived" }, "已存档"));

      return h("li", {
        key: record.id,
        className: "dsh-bookmarks-item",
        "data-bookmarks-item": record.id,
        "data-status": record.status
      }, [
        h("div", { key: "copy", style: { minWidth: 0, flex: 1 } }, [
          h("div", { key: "title", className: "dsh-bookmarks-title" }, record.title),
          // The href is a host-validated http(s) value; noopener/noreferrer keep
          // the opened page away from this one.
          safeUrl
            ? h("a", {
                key: "url",
                className: "dsh-bookmarks-url",
                href: safeUrl,
                target: "_blank",
                rel: "noopener noreferrer"
              }, record.url)
            : h("span", {
                key: "url",
                className: "dsh-bookmarks-url",
                "data-bookmarks-invalid-url": ""
              }, record.url),
          record.notes
            ? h("p", { key: "notes", className: "dsh-bookmarks-notes" }, record.notes)
            : null,
          h("div", { key: "meta", className: "dsh-bookmarks-meta" }, meta)
        ]),
        h("div", { key: "actions", className: "dsh-bookmarks-actions" }, actions)
      ]);
    }

    function editorRow(store, state, record) {
      var pending = store.isPending(record.id + ":edit");
      return h("li", {
        key: record.id,
        className: "dsh-bookmarks-item",
        "data-bookmarks-item": record.id,
        "data-bookmarks-editing": record.id
      }, [
        h("form", {
          key: "form",
          className: "dsh-bookmarks-editor",
          "data-bookmarks-edit-form": record.id,
          onSubmit: function (event) {
            if (event && typeof event.preventDefault === "function") event.preventDefault();
            store.saveEdit();
          }
        }, fieldInputs(state, state.editDraft, function (changes) { store.setEditDraft(changes); }, "edit").concat([
          h("button", {
            key: "save",
            type: "submit",
            className: "dsh-bookmarks-primary",
            "data-bookmarks-action": "save",
            disabled: pending
          }, pending ? "保存中…" : "保存"),
          h("button", {
            key: "cancel",
            type: "button",
            className: "dsh-bookmarks-chip",
            "data-bookmarks-action": "cancel",
            onClick: function () { store.cancelEdit(); }
          }, "取消")
        ]))
      ]);
    }

    function BookmarksSurface(props) {
      var store = props.store;
      var revision = React.useState(0);
      var setRevision = revision[1];

      React.useEffect(function () {
        return store.subscribe(function () {
          setRevision(function (value) { return value + 1; });
        });
      }, []);

      React.useEffect(function () {
        store.ensureLoaded();
      }, []);

      var state = store.getState();
      var visible = visibleBookmarks(state);

      var filters = [
        h("input", {
          key: "search",
          className: "dsh-bookmarks-input",
          "data-bookmarks-search": "",
          type: "search",
          value: state.search,
          "aria-label": "搜索书签",
          placeholder: "搜索标题、网址、备注或标签…",
          onChange: function (event) { store.setSearch(event.target.value); }
        })
      ].concat(["all"].concat(READING_STATES).map(function (value) {
        return h("button", {
          key: "state-" + value,
          type: "button",
          className: "dsh-bookmarks-chip",
          "data-bookmarks-state-filter": value,
          "aria-pressed": state.stateFilter === value,
          onClick: function () { store.setStateFilter(value); }
        }, value === "all" ? "全部" : READING_LABELS[value]);
      })).concat([
        h("button", {
          key: "archived",
          type: "button",
          className: "dsh-bookmarks-chip",
          "data-bookmarks-archived-filter": "",
          "aria-pressed": state.showArchived,
          onClick: function () { store.setShowArchived(!state.showArchived); }
        }, state.showArchived ? "查看未存档" : "查看存档")
      ]);

      var tags = knownTags(state);
      var tagRow = tags.length === 0 ? null : h("div", {
        key: "tags",
        className: "dsh-bookmarks-bar",
        role: "group",
        "aria-label": "标签筛选"
      }, tags.map(function (tag) {
        return h("button", {
          key: tag,
          type: "button",
          className: "dsh-bookmarks-chip",
          "data-bookmarks-tag-filter": tag,
          "aria-pressed": state.tagFilter === tag,
          onClick: function () { store.setTagFilter(tag); }
        }, tag);
      }));

      var emptyText = state.showArchived
        ? "暂无存档书签。"
        : (state.search || state.stateFilter !== "all" || state.tagFilter ? "没有匹配的书签。" : "暂无书签。");

      return h("div", { className: "dsh-bookmarks-root", "data-bookmarks-view": "list" }, [
        h("div", { key: "filters", className: "dsh-bookmarks-bar" }, filters),
        tagRow,
        createForm(store, state),
        h("div", { key: "body", className: "dsh-bookmarks-body" }, [
          statusRegion(state),
          loadFrame(store, state, function () {
            return h("ul", {
              className: "dsh-bookmarks-list",
              "data-bookmarks-list": "",
              style: { listStyle: "none", margin: 0, padding: 0 }
            }, visible.length === 0
              ? [h("li", { key: "empty", className: "dsh-bookmarks-note" }, emptyText)]
              : visible.map(function (record) { return bookmarkRow(store, state, record); }));
          })
        ])
      ]);
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
            sectionId: "knowledge",
            label: "Bookmarks",
            localized: "书签簿",
            order: 20,
            icon: ICONS.bookmark,
            render: function BookmarksDestination(destinationProps) {
              return h(BookmarksSurface, {
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

    function BookmarksNavButton(surface) {
      return function BookmarksNav() {
        return h("button", {
          type: "button",
          title: "Bookmarks | 书签簿",
          "aria-label": "Bookmarks | 书签簿",
          "aria-pressed": surface.isOpen(),
          onClick: function () { surface.toggle(); }
        }, h(ICONS.bookmark, { size: 16, "aria-hidden": true }));
      };
    }

    function apply(ctx) {
      var slots = ctx.slots;
      if (!slots) return;

      var gate = createModeGate();
      var store = createBookmarksStore();
      var surface = createStandaloneSurface();
      var releaseStyles = ensureStyles();

      slots.inject("sidebar.footer.action", function () {
        return bindWhenStandalone(gate, function () {
          return slots.register(
            { name: "sidebar.footer.action", id: "bookmarks", order: 120, label: function () { return "Bookmarks"; } },
            BookmarksNavButton(surface)
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
              { name: "conversation", priority: -100, label: function () { return "Bookmarks"; } },
              function BookmarksStandaloneSurface() {
                return h(BookmarksSurface, { store: store });
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
