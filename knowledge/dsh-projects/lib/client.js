/**
 * dsh-projects — client plugin.
 *
 * Publishes the `knowledge.projects` Work OS destination through browser
 * contract v1, and falls back to one reversible standalone DSH surface when
 * Work OS is absent. Buildless: no JSX, no bundler, no import statements.
 *
 * All project content renders as React text. Nothing stored is ever turned into
 * a URL, an anchor or markup, so a damaged or migrated storage record cannot
 * become an executable link.
 *
 * Work OS is deliberately the last enabled bundle, so it does not exist when
 * this plugin initializes. The mode therefore cannot be decided synchronously:
 * the registration is queued for Work OS to drain, and a bounded wait selects
 * standalone if Work OS never arrives. Both surfaces are gated on that one
 * decision, so only ever one Projects root exists.
 */
window.__ModuleLoader__.load({
  id: "dsh-projects",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var UI = require("@deepseek-ai/dsh-client-ui-primitives");
    var h = React.createElement;

    var WORK_OS_API_KEY = "__ACKS_WORK_OS__";
    var WORK_OS_PENDING_KEY = "__ACKS_WORK_OS_PENDING__";
    var WORK_OS_WAIT_MS = 4000;
    var DESTINATION_ID = "knowledge.projects";

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
      project: pickIcon("IconProjectOutline16", "IconFolderOutline16", "IconListPenOutline16"),
      edit: pickIcon("IconEditOutline16", "IconListPenOutline16"),
      archive: pickIcon("IconArchiveOutline16", "IconTrashOutline16"),
      restore: pickIcon("IconRefreshOutline16", "IconUndoOutline16"),
      reload: pickIcon("IconRefreshOutline16", "IconUndoOutline16")
    };

    var API_PREFIX = "/api/projects";
    var STYLE_ID = "dsh-projects-style";

    var PHASES = ["planned", "active", "on_hold", "completed"];
    var PHASE_LABELS = { planned: "计划中", active: "进行中", on_hold: "暂缓", completed: "已完成" };

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

    function projectPath(id, action) {
      return "/projects/" + encodeURIComponent(id) + (action ? "/" + action : "");
    }

    // ── Store ───────────────────────────────────────────────────────────────

    function emptyDraft() {
      return { title: "", objective: "", phase: "planned", startDate: "", endDate: "", tags: "", areaId: "" };
    }

    function parseTags(value) {
      return String(value || "")
        .split(/[,，\s]+/u)
        .map(function (tag) { return tag.trim(); })
        .filter(function (tag) { return tag.length > 0; });
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

    function validateDraft(draft) {
      if (String(draft.title || "").trim().length === 0) return "请输入标题";
      var start = String(draft.startDate || "");
      var end = String(draft.endDate || "");
      // Both are zero-padded YYYY-MM-DD, so a lexical comparison is a date one.
      if (start && end && end < start) return "结束日期不能早于开始日期";
      return null;
    }

    function draftBody(draft) {
      var body = {
        title: String(draft.title || "").trim(),
        objective: draft.objective || "",
        phase: draft.phase,
        tags: parseTags(draft.tags)
      };
      body.startDate = draft.startDate ? draft.startDate : null;
      body.endDate = draft.endDate ? draft.endDate : null;
      // Only the id travels. No Area name, purpose or revision is ever copied
      // into a Project payload.
      body.areaId = draft.areaId ? draft.areaId : null;
      return body;
    }

    function createProjectsStore() {
      var state = {
        phase: "loading",
        projects: [],
        error: null,
        actionError: null,
        staleId: null,
        validation: null,
        pending: {},
        search: "",
        phaseFilter: "all",
        showArchived: false,
        selectedId: null,
        draft: emptyDraft(),
        editingId: null,
        editDraft: emptyDraft(),
        // Area choices are a separate concern from the Projects load: an outage
        // there must never put the list into an error state.
        areas: [],
        areasError: null,
        // A read-only projection of three other domains. It is deliberately its
        // own state slice: a failure here must never blank the Project detail,
        // and nothing read here is ever written back or copied into a Project.
        related: {
          tasks: [], bookmarks: [], notes: [],
          errors: { tasks: null, bookmarks: null, notes: null },
          loadedFor: null
        }
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

      function applyProject(record) {
        var replaced = false;
        var projects = state.projects.map(function (existing) {
          if (existing.id !== record.id) return existing;
          replaced = true;
          return record;
        });
        if (!replaced) projects = [record].concat(projects);
        patch({ projects: projects, actionError: null, staleId: null });
      }

      function load() {
        if (disposed) return Promise.resolve();
        var resolvingStale = state.staleId !== null;
        loadStarted = true;
        patch({ phase: "loading", error: null });
        return request("GET", "/state").then(
          function (payload) {
            var changes = {
              phase: "ready",
              projects: payload.projects || [],
              error: null,
              actionError: null,
              staleId: null
            };
            if (resolvingStale) {
              changes.editingId = null;
              changes.validation = null;
            }
            patch(changes);
          },
          function (error) {
            patch({ phase: "error", error: error.message || "加载失败" });
          }
        );
      }

      var areasLoadStarted = false;

      /**
       * Reads the Area list for the selector. It is settled on its own, so an
       * Areas outage leaves the whole Projects destination usable and only
       * costs the ability to create a *new* link.
       */
      function loadAreas() {
        if (disposed || areasLoadStarted) return Promise.resolve();
        areasLoadStarted = true;
        return readCollection("/api/areas/state", "areas").then(
          function (areas) { patch({ areas: areas, areasError: null }); },
          function () { patch({ areas: [], areasError: "无法读取领域列表，暂时只能创建未关联项目。" }); }
        );
      }

      // Mounting again must not re-request state.
      function ensureLoaded() {
        loadAreas();
        if (loadStarted) return Promise.resolve();
        return load();
      }


      function readCollection(path, key) {
        return fetch(path, {
          method: "GET",
          credentials: "same-origin",
          headers: { accept: "application/json" }
        }).then(function (response) {
          return response.json().then(function (payload) {
            if (!response.ok || !payload || payload.ok !== true) throw new Error("读取失败");
            return Array.isArray(payload[key]) ? payload[key] : [];
          });
        });
      }

      /**
       * Reads both source domains for the selected project. Each source is
       * settled independently, so one outage leaves the other and the Project
       * detail fully visible.
       */
      function loadRelated(projectId, options) {
        if (disposed || !projectId) return Promise.resolve();
        var force = options && options.force;
        if (!force && state.related.loadedFor === projectId) return Promise.resolve();
        patch({
          related: {
            tasks: state.related.tasks,
            bookmarks: state.related.bookmarks,
            notes: state.related.notes,
            errors: { tasks: null, bookmarks: null, notes: null },
            loadedFor: projectId
          }
        });
        return Promise.all([
          readCollection("/api/agenda/state", "tasks").then(
            function (tasks) { return { key: "tasks", value: tasks, error: null }; },
            function () { return { key: "tasks", value: [], error: "无法读取待办事项。" }; }
          ),
          readCollection("/api/bookmarks/state", "bookmarks").then(
            function (bookmarks) { return { key: "bookmarks", value: bookmarks, error: null }; },
            function () { return { key: "bookmarks", value: [], error: "无法读取书签。" }; }
          ),
          readCollection("/api/notebook/state", "notes").then(
            function (notes) { return { key: "notes", value: notes, error: null }; },
            function () { return { key: "notes", value: [], error: "无法读取笔记。" }; }
          )
        ]).then(function (results) {
          var next = {
            tasks: state.related.tasks,
            bookmarks: state.related.bookmarks,
            notes: state.related.notes,
            errors: { tasks: null, bookmarks: null, notes: null },
            loadedFor: projectId
          };
          results.forEach(function (result) {
            next[result.key] = result.value;
            next.errors[result.key] = result.error;
          });
          patch({ related: next });
        });
      }

      function run(key, work, options) {
        var settings = options || {};
        if (state.pending[key]) return Promise.resolve(null);
        setPending(key, true);
        return work().then(
          function (payload) {
            setPending(key, false);
            if (payload && payload.project) applyProject(payload.project);
            return payload;
          },
          function (error) {
            setPending(key, false);
            // A 409 means someone else advanced the revision. Never overwrite
            // local state optimistically: offer a reload instead.
            patch({
              actionError: error.message || "操作失败",
              staleId: error.status === 409 ? (settings.id || null) : null
            });
            return null;
          }
        );
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
        setPhaseFilter: function (value) { patch({ phaseFilter: value }); },
        setShowArchived: function (value) { patch({ showArchived: !!value, editingId: null }); },
        select: function (id) {
          patch({ selectedId: id, actionError: null, staleId: null });
          loadRelated(id);
        },
        refreshRelated: function () { return loadRelated(state.selectedId, { force: true }); },
        clearSelection: function () { patch({ selectedId: null }); },
        setDraft: function (changes) { patch({ draft: mergeDraft(state.draft, changes), validation: null }); },
        createProject: function () {
          var problem = validateDraft(state.draft);
          if (problem) {
            patch({ validation: problem });
            return Promise.resolve(null);
          }
          var body = draftBody(state.draft);
          return run("create", function () {
            return request("POST", "/projects", body);
          }).then(function (payload) {
            if (payload) patch({ draft: emptyDraft(), validation: null });
            return payload;
          });
        },
        startEdit: function (record) {
          patch({
            editingId: record.id,
            actionError: null,
            staleId: null,
            validation: null,
            editDraft: {
              title: record.title,
              objective: record.objective,
              phase: record.phase,
              startDate: record.startDate || "",
              endDate: record.endDate || "",
              tags: record.tags.join(", "),
              areaId: record.areaId || ""
            }
          });
        },
        setEditDraft: function (changes) { patch({ editDraft: mergeDraft(state.editDraft, changes), validation: null }); },
        cancelEdit: function () { patch({ editingId: null, validation: null, actionError: null }); },
        saveEdit: function (record) {
          if (!record) return Promise.resolve(null);
          var problem = validateDraft(state.editDraft);
          if (problem) {
            patch({ validation: problem });
            return Promise.resolve(null);
          }
          var body = draftBody(state.editDraft);
          // The revision currently rendered is what the server is asked to
          // match; the client never guesses a newer one.
          body.expectedRevision = record.revision;
          return run(record.id + ":edit", function () {
            return request("PATCH", projectPath(record.id), body);
          }, { id: record.id }).then(function (payload) {
            if (payload) patch({ editingId: null, validation: null });
            return payload;
          });
        },
        transition: function (record, action) {
          return run(record.id + ":" + action, function () {
            return request("POST", projectPath(record.id, action), { expectedRevision: record.revision });
          }, { id: record.id });
        },
        dispose: function () {
          disposed = true;
          listeners.length = 0;
        }
      };
    }

    // ── Styles ──────────────────────────────────────────────────────────────

    var STYLE_TEXT = [
      ".dsh-projects-root{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;overflow:hidden;",
      "color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-base,#f7f4ec);font-size:14px}",
      ".dsh-projects-root *{box-sizing:border-box}",
      ".dsh-projects-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0;padding:10px 16px;",
      "border-bottom:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12))}",
      ".dsh-projects-body{flex:1;min-height:0;overflow:auto;padding:12px 16px 20px;display:flex;gap:16px;",
      "align-items:flex-start}",
      ".dsh-projects-column{flex:1 1 0;min-width:0}",
      ".dsh-projects-form{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;padding:10px 16px;",
      "border-bottom:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12))}",
      ".dsh-projects-input{font:inherit;padding:6px 10px;border-radius:8px;min-width:0;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.2));background:var(--dsw-alias-bg-layer-1,#fff);color:inherit}",
      ".dsh-projects-input[data-projects-title-input]{flex:1 1 200px}",
      ".dsh-projects-input[data-projects-objective-input]{flex:1 1 100%;min-height:52px;resize:vertical}",
      ".dsh-projects-input[data-projects-search]{flex:1 1 200px}",
      ".dsh-projects-primary{cursor:pointer;font:inherit;padding:6px 14px;border-radius:8px;border:0;",
      "color:#fff;background:var(--acks-work-os-orange,#ff6b1a)}",
      ".dsh-projects-primary:disabled{opacity:.72;cursor:default}",
      ".dsh-projects-chip{cursor:pointer;font:inherit;font-size:13px;padding:5px 10px;border-radius:999px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.16));background:transparent;color:inherit}",
      ".dsh-projects-chip[aria-pressed='true']{color:#fff;background:var(--acks-work-os-orange,#ff6b1a);",
      "border-color:var(--acks-work-os-orange,#ff6b1a)}",
      ".dsh-projects-chip:focus-visible,.dsh-projects-primary:focus-visible,.dsh-projects-item:focus-visible{",
      "outline:2px solid var(--acks-work-os-orange-deep,#d4530e);outline-offset:2px}",
      ".dsh-projects-item{display:block;width:100%;text-align:left;cursor:pointer;font:inherit;",
      "padding:10px 12px;margin-bottom:8px;border-radius:10px;color:inherit;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12));background:var(--dsw-alias-bg-layer-1,#fff)}",
      ".dsh-projects-item[aria-current='true']{border-color:var(--acks-work-os-orange,#ff6b1a);",
      "box-shadow:inset 0 0 0 1px var(--acks-work-os-orange,#ff6b1a)}",
      ".dsh-projects-title{font-weight:600;word-break:break-word}",
      ".dsh-projects-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;font-size:12px;",
      "color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-projects-tag{padding:0 6px;border-radius:999px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.18))}",
      ".dsh-projects-detail{padding:12px;border-radius:10px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12));background:var(--dsw-alias-bg-layer-1,#fff)}",
      ".dsh-projects-objective{margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;",
      "color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-projects-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}",
      ".dsh-projects-note{padding:24px 8px;text-align:center;color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-projects-error{margin:0 0 10px;padding:8px 12px;border-radius:8px;font-size:13px;",
      "border:1px solid rgba(212,83,14,.4);background:rgba(255,107,26,.08);color:var(--acks-work-os-orange-deep,#d4530e)}",
      "@media (max-width:720px){.dsh-projects-body{flex-direction:column}.dsh-projects-column{width:100%}}"
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

    function statusRegion(state) {
      var messages = [];
      if (state.validation) messages.push(state.validation);
      if (state.actionError) messages.push(state.actionError);
      return h("div", {
        className: "dsh-projects-status",
        "data-projects-validation": "",
        role: "status",
        "aria-live": "polite"
      }, messages.length ? h("p", { className: "dsh-projects-error" }, messages.join("；")) : null);
    }

    /**
     * A reference resolves through the Area list. A value that no longer
     * matches is stated plainly rather than rendered blank or as a raw id, and
     * an Area name never becomes an anchor even when it looks like a URL.
     */
    function areaLabel(state, id) {
      if (!id) return null;
      for (var index = 0; index < state.areas.length; index += 1) {
        if (state.areas[index].id === id) {
          var found = state.areas[index];
          return found.lifecycle === "archived" ? found.name + "（已归档）" : found.name;
        }
      }
      return "未知领域";
    }

    function areaOptions(state, currentId) {
      var options = [h("option", { key: "none", value: "" }, "未关联领域")];
      var seen = {};
      state.areas.forEach(function (record) {
        // Only active areas are offered for a new link; an existing link to an
        // archived one stays selectable so it can be seen and removed.
        if (record.lifecycle !== "active" && record.id !== currentId) return;
        seen[record.id] = true;
        options.push(h("option", { key: record.id, value: record.id },
          record.lifecycle === "archived" ? record.name + "（已归档）" : record.name));
      });
      if (currentId && !seen[currentId]) {
        options.push(h("option", { key: currentId, value: currentId }, "未知领域"));
      }
      return options;
    }

    function fieldInputs(state, draft, onChange, prefix) {
      return [
        h("input", {
          key: "title",
          className: "dsh-projects-input",
          "data-projects-title-input": prefix,
          type: "text",
          value: draft.title,
          "aria-label": "项目标题",
          placeholder: "项目标题",
          maxLength: 200,
          onChange: function (event) { onChange({ title: event.target.value }); }
        }),
        h("select", {
          key: "phase",
          className: "dsh-projects-input",
          "data-projects-phase-input": prefix,
          value: draft.phase,
          "aria-label": "阶段",
          onChange: function (event) { onChange({ phase: event.target.value }); }
        }, PHASES.map(function (value) {
          return h("option", { key: value, value: value }, PHASE_LABELS[value]);
        })),
        h("input", {
          key: "start",
          className: "dsh-projects-input",
          "data-projects-start-input": prefix,
          type: "date",
          value: draft.startDate,
          "aria-label": "开始日期",
          onChange: function (event) { onChange({ startDate: event.target.value }); }
        }),
        h("input", {
          key: "end",
          className: "dsh-projects-input",
          "data-projects-end-input": prefix,
          type: "date",
          value: draft.endDate,
          "aria-label": "结束日期",
          onChange: function (event) { onChange({ endDate: event.target.value }); }
        }),
        h("input", {
          key: "tags",
          className: "dsh-projects-input",
          "data-projects-tags-input": prefix,
          type: "text",
          value: draft.tags,
          "aria-label": "标签，使用逗号或空格分隔",
          placeholder: "标签（逗号分隔）",
          onChange: function (event) { onChange({ tags: event.target.value }); }
        }),
        h("textarea", {
          key: "objective",
          className: "dsh-projects-input",
          "data-projects-objective-input": prefix,
          value: draft.objective,
          "aria-label": "目标",
          placeholder: "目标（纯文本）",
          maxLength: 20000,
          onChange: function (event) { onChange({ objective: event.target.value }); }
        }),
        h("select", {
          key: "area",
          className: "dsh-projects-input",
          "data-projects-area-input": prefix,
          value: draft.areaId || "",
          "aria-label": "关联领域",
          onChange: function (event) { onChange({ areaId: event.target.value }); }
        }, areaOptions(state, draft.areaId)),
        state.areasError
          ? h("span", {
            key: "area-warning",
            className: "dsh-projects-meta",
            "data-projects-area-warning": "",
            role: "status",
            "aria-live": "polite"
          }, state.areasError)
          : null
      ];
    }

    function createForm(store, state) {
      return h("form", {
        className: "dsh-projects-form",
        "data-projects-form": "",
        onSubmit: function (event) {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          store.createProject();
        }
      }, fieldInputs(state, state.draft, function (changes) { store.setDraft(changes); }, "create").concat([
        h("button", {
          key: "submit",
          type: "submit",
          className: "dsh-projects-primary",
          "data-projects-action": "create",
          disabled: store.isPending("create")
        }, store.isPending("create") ? "保存中…" : "新建项目")
      ]));
    }

    function loadFrame(store, state, body) {
      if (state.phase === "loading") {
        return h("p", { className: "dsh-projects-note" }, "载入中…");
      }
      if (state.phase === "error") {
        return h("div", { className: "dsh-projects-note" }, [
          h("p", { key: "message", className: "dsh-projects-error" }, "加载失败：" + state.error),
          h("button", {
            key: "retry",
            type: "button",
            className: "dsh-projects-primary",
            "data-projects-action": "retry",
            onClick: function () { store.load(); }
          }, "重试")
        ]);
      }
      return body();
    }

    function matchesSearch(record, needle) {
      if (needle.length === 0) return true;
      return [record.title, record.objective]
        .concat(record.tags)
        .join(" ")
        .toLowerCase()
        .indexOf(needle) >= 0;
    }

    function visibleProjects(state) {
      var needle = String(state.search || "").trim().toLowerCase();
      return state.projects.filter(function (record) {
        var wanted = state.showArchived ? "archived" : "active";
        if (record.lifecycle !== wanted) return false;
        if (state.phaseFilter !== "all" && record.phase !== state.phaseFilter) return false;
        return matchesSearch(record, needle);
      }).sort(function (left, right) {
        if (state.showArchived) return (right.archivedAt || 0) - (left.archivedAt || 0);
        // Newest updated first, with a deterministic id tie-break.
        return right.updatedAt - left.updatedAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      });
    }

    function projectRow(store, state, record) {
      var meta = [
        h("span", { key: "phase" }, PHASE_LABELS[record.phase] || record.phase),
        h("span", { key: "revision" }, "修订 " + record.revision)
      ];
      if (record.startDate) meta.push(h("span", { key: "start" }, record.startDate));
      if (record.endDate) meta.push(h("span", { key: "end" }, record.endDate));
      record.tags.forEach(function (tag) {
        meta.push(h("span", { key: "tag-" + tag, className: "dsh-projects-tag" }, tag));
      });

      return h("li", { key: record.id }, h("button", {
        type: "button",
        className: "dsh-projects-item",
        "data-projects-item": record.id,
        "data-projects-action": "select",
        "aria-current": state.selectedId === record.id,
        onClick: function () { store.select(record.id); }
      }, [
        h("div", { key: "title", className: "dsh-projects-title" }, record.title),
        h("div", { key: "meta", className: "dsh-projects-meta" }, meta)
      ]));
    }

    var TASK_STATUS_LABELS = { open: "待办", completed: "已完成", archived: "已存档" };
    var READING_LABELS = { unread: "未读", reading: "阅读中", read: "已读" };

    /**
     * A read-only projection of Agenda and Bookmarks for the selected Project.
     *
     * Projects stores nothing from either source and offers no action on them:
     * every value is text, and a related bookmark URL is deliberately not an
     * anchor here, because link affordances belong to the domain that owns the
     * record.
     */
    function relatedPanel(store, state, record) {
      var related = state.related;
      var mine = function (entry) { return entry && entry.projectId === record.id; };
      var tasks = related.tasks.filter(mine);
      var bookmarks = related.bookmarks.filter(mine);
      var notes = related.notes.filter(mine);
      var isArchived = function (entry) { return entry.status === "archived"; };

      function taskLine(entry) {
        var parts = [TASK_STATUS_LABELS[entry.status] || entry.status];
        if (entry.dueDate) parts.push(entry.dueDate);
        return h("li", { key: entry.id, className: "dsh-projects-meta" }, [
          h("span", { key: "title" }, entry.title),
          h("span", { key: "meta" }, parts.join(" · "))
        ]);
      }

      function bookmarkLine(entry) {
        return h("li", { key: entry.id, className: "dsh-projects-meta" }, [
          h("span", { key: "title" }, entry.title),
          h("span", { key: "state" }, READING_LABELS[entry.readingState] || entry.readingState),
          // Text, never an anchor: Projects does not own this link.
          h("span", { key: "url" }, entry.url)
        ]);
      }

      // A note is projected by title and size only. The Markdown body belongs
      // to Notebook and is deliberately not mirrored here.
      function noteLine(entry) {
        return h("li", { key: entry.id, className: "dsh-projects-meta" }, [
          h("span", { key: "title" }, entry.title),
          h("span", { key: "words" }, String(entry.wordCount || 0) + " 词")
        ]);
      }

      function group(key, label, entries, render, emptyText) {
        return h("section", { key: key, className: "dsh-projects-section" }, [
          h("h3", { key: "title", style: { margin: "0 0 6px", fontSize: 13 } }, [
            label,
            h("span", { key: "count", "data-projects-related-count": key }, String(entries.length))
          ]),
          related.errors[key]
            ? h("p", {
              key: "error",
              className: "dsh-projects-error",
              "data-projects-related-error": key,
              role: "status",
              "aria-live": "polite"
            }, related.errors[key])
            : null,
          entries.length === 0
            ? h("p", { key: "empty", className: "dsh-projects-meta" }, emptyText)
            : h("ul", { key: "list", style: { listStyle: "none", margin: 0, padding: 0 } },
              entries.map(render))
        ]);
      }

      var archivedTasks = tasks.filter(isArchived);
      var archivedBookmarks = bookmarks.filter(isArchived);

      return h("section", {
        className: "dsh-projects-detail",
        "data-projects-related": record.id,
        "aria-label": "关联工作"
      }, [
        h("div", { key: "head", className: "dsh-projects-actions" }, [
          h("strong", { key: "title" }, "关联工作"),
          h("button", {
            key: "refresh",
            type: "button",
            className: "dsh-projects-chip",
            "data-projects-action": "refresh-related",
            onClick: function () { store.refreshRelated(); }
          }, "刷新")
        ]),
        group("tasks", "待办事项 ", tasks.filter(function (entry) { return !isArchived(entry); }),
          taskLine, "暂无关联待办。"),
        group("bookmarks", "书签 ", bookmarks.filter(function (entry) { return !isArchived(entry); }),
          bookmarkLine, "暂无关联书签。"),
        // Notebook has no reversible archive lifecycle, so every related note
        // is a live one and none can appear in the archived group below.
        group("notes", "笔记 ", notes, noteLine, "暂无关联笔记。"),
        archivedTasks.length + archivedBookmarks.length > 0
          ? h("section", {
            key: "archived",
            className: "dsh-projects-section",
            "data-projects-related-archived": record.id
          }, [
            h("h3", { key: "title", style: { margin: "0 0 6px", fontSize: 13 } }, "已存档的关联工作"),
            h("ul", { key: "list", style: { listStyle: "none", margin: 0, padding: 0 } },
              archivedTasks.map(taskLine).concat(archivedBookmarks.map(bookmarkLine)))
          ])
          : null
      ]);
    }

    function detailPanel(store, state, record) {
      if (state.editingId === record.id) return editorPanel(store, state, record);

      var rows = [
        ["阶段", PHASE_LABELS[record.phase] || record.phase],
        ["领域", areaLabel(state, record.areaId) || "未关联"],
        ["开始日期", record.startDate || "未设置"],
        ["结束日期", record.endDate || "未设置"],
        ["标签", record.tags.length ? record.tags.join("、") : "无"],
        ["修订", String(record.revision)],
        ["创建于", String(record.createdAt)],
        ["更新于", String(record.updatedAt)]
      ];
      if (record.lifecycle === "archived") rows.push(["存档于", String(record.archivedAt)]);

      var actions = [
        h("button", {
          key: "edit",
          type: "button",
          className: "dsh-projects-chip",
          "data-projects-action": "edit",
          onClick: function () { store.startEdit(record); }
        }, "编辑")
      ];
      if (record.lifecycle === "archived") {
        actions.push(h("button", {
          key: "restore",
          type: "button",
          className: "dsh-projects-chip",
          "data-projects-action": "restore",
          disabled: store.isPending(record.id + ":restore"),
          onClick: function () { store.transition(record, "restore"); }
        }, "恢复"));
      } else {
        actions.push(h("button", {
          key: "archive",
          type: "button",
          className: "dsh-projects-chip",
          "data-projects-action": "archive",
          disabled: store.isPending(record.id + ":archive"),
          onClick: function () { store.transition(record, "archive"); }
        }, "存档"));
      }
      // A stale write is recoverable by reloading, never by overwriting.
      if (state.staleId === record.id) {
        actions.push(h("button", {
          key: "reload",
          type: "button",
          className: "dsh-projects-primary",
          "data-projects-action": "reload",
          onClick: function () { store.load(); }
        }, "重新载入"));
      }

      return h("section", {
        className: "dsh-projects-detail",
        "data-projects-detail": record.id,
        "aria-label": "项目详情"
      }, [
        h("h2", { key: "title", className: "dsh-projects-title", style: { margin: 0 } }, record.title),
        record.objective
          ? h("p", { key: "objective", className: "dsh-projects-objective" }, record.objective)
          : null,
        h("dl", { key: "rows", style: { margin: "10px 0 0" } }, rows.map(function (row) {
          return h("div", { key: row[0], className: "dsh-projects-meta" }, [
            h("dt", { key: "k", style: { fontWeight: 600 } }, row[0]),
            h("dd", { key: "v", style: { margin: 0 } }, row[1])
          ]);
        })),
        h("div", { key: "actions", className: "dsh-projects-actions" }, actions)
      ]);
    }

    function editorPanel(store, state, record) {
      var pending = store.isPending(record.id + ":edit");
      return h("section", {
        className: "dsh-projects-detail",
        "data-projects-detail": record.id,
        "aria-label": "编辑项目"
      }, h("form", {
        "data-projects-edit-form": record.id,
        onSubmit: function (event) {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          store.saveEdit(record);
        }
      }, fieldInputs(state, state.editDraft, function (changes) { store.setEditDraft(changes); }, "edit").concat([
        h("div", { key: "actions", className: "dsh-projects-actions" }, [
          h("button", {
            key: "save",
            type: "submit",
            className: "dsh-projects-primary",
            "data-projects-action": "save",
            disabled: pending
          }, pending ? "保存中…" : "保存"),
          h("button", {
            key: "cancel",
            type: "button",
            className: "dsh-projects-chip",
            "data-projects-action": "cancel",
            onClick: function () { store.cancelEdit(); }
          }, "取消"),
          state.staleId === record.id
            ? h("button", {
              key: "reload",
              type: "button",
              className: "dsh-projects-chip",
              "data-projects-action": "reload",
              onClick: function () { store.load(); }
            }, "重新载入")
            : null
        ])
      ])));
    }

    function ProjectsSurface(props) {
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
      var visible = visibleProjects(state);
      // A selection that has left the visible set must not keep a detail panel
      // open over a record the list no longer contains.
      var selected = null;
      for (var index = 0; index < visible.length; index += 1) {
        if (visible[index].id === state.selectedId) selected = visible[index];
      }

      var filters = [
        h("input", {
          key: "search",
          className: "dsh-projects-input",
          "data-projects-search": "",
          type: "search",
          value: state.search,
          "aria-label": "搜索项目",
          placeholder: "搜索标题、目标或标签…",
          onChange: function (event) { store.setSearch(event.target.value); }
        })
      ].concat(["all"].concat(PHASES).map(function (value) {
        return h("button", {
          key: "phase-" + value,
          type: "button",
          className: "dsh-projects-chip",
          "data-projects-phase-filter": value,
          "aria-pressed": state.phaseFilter === value,
          onClick: function () { store.setPhaseFilter(value); }
        }, value === "all" ? "全部" : PHASE_LABELS[value]);
      })).concat([
        h("button", {
          key: "archived",
          type: "button",
          className: "dsh-projects-chip",
          "data-projects-archived-filter": "",
          "aria-pressed": state.showArchived,
          onClick: function () { store.setShowArchived(!state.showArchived); }
        }, state.showArchived ? "查看未存档" : "查看存档")
      ]);

      var emptyText = state.showArchived
        ? "暂无存档项目。"
        : (state.search || state.phaseFilter !== "all" ? "没有匹配的项目。" : "暂无项目。");

      return h("div", { className: "dsh-projects-root", "data-projects-view": "list" }, [
        h("div", { key: "filters", className: "dsh-projects-bar" }, filters),
        createForm(store, state),
        h("div", { key: "body", className: "dsh-projects-body" }, [
          h("div", { key: "list", className: "dsh-projects-column" }, [
            statusRegion(state),
            loadFrame(store, state, function () {
              return h("ul", {
                className: "dsh-projects-list",
                "data-projects-list": "",
                style: { listStyle: "none", margin: 0, padding: 0 }
              }, visible.length === 0
                ? [h("li", { key: "empty", className: "dsh-projects-note" }, emptyText)]
                : visible.map(function (record) { return projectRow(store, state, record); }));
            })
          ]),
          selected
            ? h("div", { key: "detail", className: "dsh-projects-column" }, [
              detailPanel(store, state, selected),
              relatedPanel(store, state, selected)
            ])
            : null
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
            label: "Projects",
            localized: "项目",
            order: 30,
            icon: ICONS.project,
            render: function ProjectsDestination(destinationProps) {
              return h(ProjectsSurface, {
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

    function ProjectsNavButton(surface) {
      return function ProjectsNav() {
        return h("button", {
          type: "button",
          title: "Projects | 项目",
          "aria-label": "Projects | 项目",
          "aria-pressed": surface.isOpen(),
          onClick: function () { surface.toggle(); }
        }, h(ICONS.project, { size: 16, "aria-hidden": true }));
      };
    }

    function apply(ctx) {
      var slots = ctx.slots;
      if (!slots) return;

      var gate = createModeGate();
      var store = createProjectsStore();
      var surface = createStandaloneSurface();
      var releaseStyles = ensureStyles();

      slots.inject("sidebar.footer.action", function () {
        return bindWhenStandalone(gate, function () {
          return slots.register(
            { name: "sidebar.footer.action", id: "projects", order: 130, label: function () { return "Projects"; } },
            ProjectsNavButton(surface)
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
              { name: "conversation", priority: -100, label: function () { return "Projects"; } },
              function ProjectsStandaloneSurface() {
                return h(ProjectsSurface, { store: store });
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
