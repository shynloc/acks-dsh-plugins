/**
 * dsh-areas — client plugin.
 *
 * Publishes the `knowledge.areas` Work OS destination through browser
 * contract v1, and falls back to one reversible standalone DSH surface when
 * Work OS is absent. Buildless: no JSX, no bundler, no import statements.
 *
 * All area content renders as React text. Nothing stored is ever turned into
 * a URL, an anchor or markup, so a damaged or migrated storage record cannot
 * become an executable link.
 *
 * Work OS is deliberately the last enabled bundle, so it does not exist when
 * this plugin initializes. The mode therefore cannot be decided synchronously:
 * the registration is queued for Work OS to drain, and a bounded wait selects
 * standalone if Work OS never arrives. Both surfaces are gated on that one
 * decision, so only ever one Areas root exists.
 */
window.__ModuleLoader__.load({
  id: "dsh-areas",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var UI = require("@deepseek-ai/dsh-client-ui-primitives");
    var h = React.createElement;

    var WORK_OS_API_KEY = "__ACKS_WORK_OS__";
    var WORK_OS_PENDING_KEY = "__ACKS_WORK_OS_PENDING__";
    var WORK_OS_WAIT_MS = 4000;
    var DESTINATION_ID = "knowledge.areas";

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
      area: pickIcon("IconAreaOutline16", "IconFolderOutline16", "IconListPenOutline16"),
      edit: pickIcon("IconEditOutline16", "IconListPenOutline16"),
      archive: pickIcon("IconArchiveOutline16", "IconTrashOutline16"),
      restore: pickIcon("IconRefreshOutline16", "IconUndoOutline16"),
      reload: pickIcon("IconRefreshOutline16", "IconUndoOutline16")
    };

    var API_PREFIX = "/api/areas";
    var STYLE_ID = "dsh-areas-style";

    var STATUSES = ["active", "paused"];
    var STATUS_LABELS = { active: "进行中", paused: "暂停" };
    var CADENCES = ["none", "weekly", "monthly", "quarterly"];
    var CADENCE_LABELS = { none: "不定期", weekly: "每周", monthly: "每月", quarterly: "每季度" };

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

    function areaPath(id, action) {
      return "/areas/" + encodeURIComponent(id) + (action ? "/" + action : "");
    }

    // ── Store ───────────────────────────────────────────────────────────────

    function emptyDraft() {
      return { name: "", purpose: "", status: "active", reviewCadence: "none", tags: "" };
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
      if (String(draft.name || "").trim().length === 0) return "请输入名称";
      return null;
    }

    function draftBody(draft) {
      return {
        name: String(draft.name || "").trim(),
        purpose: draft.purpose || "",
        status: draft.status,
        reviewCadence: draft.reviewCadence,
        tags: parseTags(draft.tags)
      };
    }

    function createAreasStore() {
      var state = {
        phase: "loading",
        areas: [],
        error: null,
        actionError: null,
        staleId: null,
        validation: null,
        pending: {},
        search: "",
        statusFilter: "all",
        cadenceFilter: "all",
        tagFilter: null,
        showArchived: false,
        selectedId: null,
        draft: emptyDraft(),
        editingId: null,
        editDraft: emptyDraft(),
        // A read-only projection of three other domains. It is deliberately its
        // own state slice: a failure here must never blank the Area detail, and
        // nothing read here is ever written back or copied into an Area.
        //
        // Agenda is deliberately absent. A task reaches an Area through its
        // Project, so projecting tasks here would invent a second path that
        // could contradict the first.
        related: {
          projects: [], bookmarks: [], notes: [], resources: [],
          errors: { projects: null, bookmarks: null, notes: null, resources: null },
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

      function applyArea(record) {
        var replaced = false;
        var areas = state.areas.map(function (existing) {
          if (existing.id !== record.id) return existing;
          replaced = true;
          return record;
        });
        if (!replaced) areas = [record].concat(areas);
        patch({ areas: areas, actionError: null, staleId: null });
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
              areas: payload.areas || [],
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

      function ensureLoaded() {
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

      var RELATED_SOURCES = [
        { key: "projects", path: "/api/projects/state", collection: "projects", failure: "无法读取项目。" },
        { key: "bookmarks", path: "/api/bookmarks/state", collection: "bookmarks", failure: "无法读取书签。" },
        { key: "notes", path: "/api/notebook/state", collection: "notes", failure: "无法读取笔记。" },
        { key: "resources", path: "/api/resources/state", collection: "resources", failure: "无法读取资源。" }
      ];

      /**
       * Reads every source domain for the selected Area. Each source is settled
       * independently, so one outage leaves the others and the Area detail
       * fully visible.
       */
      function loadRelated(areaId, options) {
        if (disposed || !areaId) return Promise.resolve();
        var force = options && options.force;
        if (!force && state.related.loadedFor === areaId) return Promise.resolve();

        function blank(loadedFor) {
          return {
            projects: state.related.projects,
            bookmarks: state.related.bookmarks,
            notes: state.related.notes,
            resources: state.related.resources,
            errors: { projects: null, bookmarks: null, notes: null, resources: null },
            loadedFor: loadedFor
          };
        }
        patch({ related: blank(areaId) });

        return Promise.all(RELATED_SOURCES.map(function (source) {
          return readCollection(source.path, source.collection).then(
            function (records) { return { key: source.key, value: records, error: null }; },
            function () { return { key: source.key, value: [], error: source.failure }; }
          );
        })).then(function (results) {
          var next = blank(areaId);
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
            if (payload && payload.area) applyArea(payload.area);
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
        setStatusFilter: function (value) { patch({ statusFilter: value }); },
        setCadenceFilter: function (value) { patch({ cadenceFilter: value }); },
        setTagFilter: function (value) { patch({ tagFilter: state.tagFilter === value ? null : value }); },
        setShowArchived: function (value) { patch({ showArchived: !!value, editingId: null }); },
        select: function (id) {
          patch({ selectedId: id, actionError: null, staleId: null });
          loadRelated(id);
        },
        refreshRelated: function () { return loadRelated(state.selectedId, { force: true }); },
        clearSelection: function () { patch({ selectedId: null }); },
        setDraft: function (changes) { patch({ draft: mergeDraft(state.draft, changes), validation: null }); },
        createArea: function () {
          var problem = validateDraft(state.draft);
          if (problem) {
            patch({ validation: problem });
            return Promise.resolve(null);
          }
          var body = draftBody(state.draft);
          return run("create", function () {
            return request("POST", "/areas", body);
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
              name: record.name,
              purpose: record.purpose,
              status: record.status,
              reviewCadence: record.reviewCadence,
              tags: record.tags.join(", ")
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
            return request("PATCH", areaPath(record.id), body);
          }, { id: record.id }).then(function (payload) {
            if (payload) patch({ editingId: null, validation: null });
            return payload;
          });
        },
        transition: function (record, action) {
          return run(record.id + ":" + action, function () {
            return request("POST", areaPath(record.id, action), { expectedRevision: record.revision });
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
      ".dsh-areas-root{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;overflow:hidden;",
      "color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-base,#f7f4ec);font-size:14px}",
      ".dsh-areas-root *{box-sizing:border-box}",
      ".dsh-areas-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0;padding:10px 16px;",
      "border-bottom:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12))}",
      ".dsh-areas-body{flex:1;min-height:0;overflow:auto;padding:12px 16px 20px;display:flex;gap:16px;",
      "align-items:flex-start}",
      ".dsh-areas-column{flex:1 1 0;min-width:0}",
      ".dsh-areas-form{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;padding:10px 16px;",
      "border-bottom:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12))}",
      ".dsh-areas-input{font:inherit;padding:6px 10px;border-radius:8px;min-width:0;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.2));background:var(--dsw-alias-bg-layer-1,#fff);color:inherit}",
      ".dsh-areas-input[data-areas-name-input]{flex:1 1 200px}",
      ".dsh-areas-input[data-areas-purpose-input]{flex:1 1 100%;min-height:52px;resize:vertical}",
      ".dsh-areas-input[data-areas-search]{flex:1 1 200px}",
      ".dsh-areas-primary{cursor:pointer;font:inherit;padding:6px 14px;border-radius:8px;border:0;",
      "color:#fff;background:var(--acks-work-os-orange,#ff6b1a)}",
      ".dsh-areas-primary:disabled{opacity:.72;cursor:default}",
      ".dsh-areas-chip{cursor:pointer;font:inherit;font-size:13px;padding:5px 10px;border-radius:999px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.16));background:transparent;color:inherit}",
      ".dsh-areas-chip[aria-pressed='true']{color:#fff;background:var(--acks-work-os-orange,#ff6b1a);",
      "border-color:var(--acks-work-os-orange,#ff6b1a)}",
      ".dsh-areas-chip:focus-visible,.dsh-areas-primary:focus-visible,.dsh-areas-item:focus-visible{",
      "outline:2px solid var(--acks-work-os-orange-deep,#d4530e);outline-offset:2px}",
      ".dsh-areas-item{display:block;width:100%;text-align:left;cursor:pointer;font:inherit;",
      "padding:10px 12px;margin-bottom:8px;border-radius:10px;color:inherit;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12));background:var(--dsw-alias-bg-layer-1,#fff)}",
      ".dsh-areas-item[aria-current='true']{border-color:var(--acks-work-os-orange,#ff6b1a);",
      "box-shadow:inset 0 0 0 1px var(--acks-work-os-orange,#ff6b1a)}",
      ".dsh-areas-title{font-weight:600;word-break:break-word}",
      ".dsh-areas-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;font-size:12px;",
      "color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-areas-tag{padding:0 6px;border-radius:999px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.18))}",
      ".dsh-areas-detail{padding:12px;border-radius:10px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12));background:var(--dsw-alias-bg-layer-1,#fff)}",
      ".dsh-areas-purpose{margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;",
      "color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-areas-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}",
      ".dsh-areas-note{padding:24px 8px;text-align:center;color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-areas-section{margin-top:12px}",
      ".dsh-areas-section:first-of-type{margin-top:0}",
      ".dsh-areas-error{margin:0 0 10px;padding:8px 12px;border-radius:8px;font-size:13px;",
      "border:1px solid rgba(212,83,14,.4);background:rgba(255,107,26,.08);color:var(--acks-work-os-orange-deep,#d4530e)}",
      "@media (max-width:720px){.dsh-areas-body{flex-direction:column}.dsh-areas-column{width:100%}}"
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
        className: "dsh-areas-status",
        "data-areas-validation": "",
        role: "status",
        "aria-live": "polite"
      }, messages.length ? h("p", { className: "dsh-areas-error" }, messages.join("；")) : null);
    }

    function fieldInputs(draft, onChange, prefix) {
      return [
        h("input", {
          key: "name",
          className: "dsh-areas-input",
          "data-areas-name-input": prefix,
          type: "text",
          value: draft.name,
          "aria-label": "领域名称",
          placeholder: "领域名称",
          maxLength: 120,
          onChange: function (event) { onChange({ name: event.target.value }); }
        }),
        h("select", {
          key: "status",
          className: "dsh-areas-input",
          "data-areas-status-input": prefix,
          value: draft.status,
          "aria-label": "状态",
          onChange: function (event) { onChange({ status: event.target.value }); }
        }, STATUSES.map(function (value) {
          return h("option", { key: value, value: value }, STATUS_LABELS[value]);
        })),
        h("select", {
          key: "cadence",
          className: "dsh-areas-input",
          "data-areas-cadence-input": prefix,
          value: draft.reviewCadence,
          "aria-label": "回顾频率",
          onChange: function (event) { onChange({ reviewCadence: event.target.value }); }
        }, CADENCES.map(function (value) {
          return h("option", { key: value, value: value }, CADENCE_LABELS[value]);
        })),
        h("input", {
          key: "tags",
          className: "dsh-areas-input",
          "data-areas-tags-input": prefix,
          type: "text",
          value: draft.tags,
          "aria-label": "标签，使用逗号或空格分隔",
          placeholder: "标签（逗号分隔）",
          onChange: function (event) { onChange({ tags: event.target.value }); }
        }),
        h("textarea", {
          key: "purpose",
          className: "dsh-areas-input",
          "data-areas-purpose-input": prefix,
          value: draft.purpose,
          "aria-label": "职责说明",
          placeholder: "这个领域要长期维持什么？",
          maxLength: 4000,
          onChange: function (event) { onChange({ purpose: event.target.value }); }
        })
      ];
    }

    function createForm(store, state) {
      return h("form", {
        className: "dsh-areas-form",
        "data-areas-form": "",
        onSubmit: function (event) {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          store.createArea();
        }
      }, fieldInputs(state.draft, function (changes) { store.setDraft(changes); }, "create").concat([
        h("button", {
          key: "submit",
          type: "submit",
          className: "dsh-areas-primary",
          "data-areas-action": "create",
          disabled: store.isPending("create")
        }, store.isPending("create") ? "保存中…" : "新建领域")
      ]));
    }

    function loadFrame(store, state, body) {
      if (state.phase === "loading") {
        return h("p", { className: "dsh-areas-note" }, "载入中…");
      }
      if (state.phase === "error") {
        return h("div", { className: "dsh-areas-note" }, [
          h("p", { key: "message", className: "dsh-areas-error" }, "加载失败：" + state.error),
          h("button", {
            key: "retry",
            type: "button",
            className: "dsh-areas-primary",
            "data-areas-action": "retry",
            onClick: function () { store.load(); }
          }, "重试")
        ]);
      }
      return body();
    }

    function matchesSearch(record, needle) {
      if (needle.length === 0) return true;
      return [record.name, record.purpose]
        .concat(record.tags)
        .join(" ")
        .toLowerCase()
        .indexOf(needle) >= 0;
    }

    function visibleAreas(state) {
      var needle = String(state.search || "").trim().toLowerCase();
      return state.areas.filter(function (record) {
        var wanted = state.showArchived ? "archived" : "active";
        if (record.lifecycle !== wanted) return false;
        if (state.statusFilter !== "all" && record.status !== state.statusFilter) return false;
        if (state.cadenceFilter !== "all" && record.reviewCadence !== state.cadenceFilter) return false;
        if (state.tagFilter && record.tags.indexOf(state.tagFilter) < 0) return false;
        return matchesSearch(record, needle);
      }).sort(function (left, right) {
        if (state.showArchived) return (right.archivedAt || 0) - (left.archivedAt || 0);
        // Newest updated first, with a deterministic id tie-break.
        return right.updatedAt - left.updatedAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      });
    }

    function areaRow(store, state, record) {
      var meta = [
        h("span", { key: "status" }, STATUS_LABELS[record.status] || record.status),
        h("span", { key: "cadence" }, "回顾：" + (CADENCE_LABELS[record.reviewCadence] || record.reviewCadence)),
        h("span", { key: "revision" }, "修订 " + record.revision)
      ];
      record.tags.forEach(function (tag) {
        meta.push(h("span", { key: "tag-" + tag, className: "dsh-areas-tag" }, tag));
      });

      return h("li", { key: record.id }, h("button", {
        type: "button",
        className: "dsh-areas-item",
        "data-areas-item": record.id,
        "data-areas-action": "select",
        "aria-current": state.selectedId === record.id,
        onClick: function () { store.select(record.id); }
      }, [
        h("div", { key: "name", className: "dsh-areas-title" }, record.name),
        h("div", { key: "meta", className: "dsh-areas-meta" }, meta)
      ]));
    }

    var PHASE_LABELS = { planned: "计划中", active: "进行中", on_hold: "暂缓", completed: "已完成" };
    var READING_LABELS = { unread: "未读", reading: "阅读中", read: "已读" };

    /**
     * A read-only projection of Projects, Bookmarks and Notes for the selected
     * Area.
     *
     * Areas stores nothing from any source and offers no action on them: every
     * value is text, a related bookmark URL is deliberately not an anchor here
     * because link affordances belong to the domain that owns the record, and a
     * note's Markdown body is never mirrored. Refresh is explicit; there is no
     * global event bus.
     */
    function relatedPanel(store, state, record) {
      var related = state.related;
      var mine = function (entry) { return entry && entry.areaId === record.id; };
      var projects = related.projects.filter(mine);
      var bookmarks = related.bookmarks.filter(mine);
      var notes = related.notes.filter(mine);
      var resources = related.resources.filter(mine);
      // Each owner spells its archive lifecycle its own way; Notebook has none.
      var isArchived = function (entry) {
        return entry.lifecycle === "archived" || entry.status === "archived";
      };
      var live = function (entry) { return !isArchived(entry); };

      function projectLine(entry) {
        return h("li", { key: entry.id, className: "dsh-areas-meta" }, [
          h("span", { key: "title" }, entry.title),
          h("span", { key: "phase" }, PHASE_LABELS[entry.phase] || entry.phase)
        ]);
      }

      function bookmarkLine(entry) {
        return h("li", { key: entry.id, className: "dsh-areas-meta" }, [
          h("span", { key: "title" }, entry.title),
          h("span", { key: "state" }, READING_LABELS[entry.readingState] || entry.readingState),
          // Text, never an anchor: Areas does not own this link.
          h("span", { key: "url" }, entry.url)
        ]);
      }

      function noteLine(entry) {
        return h("li", { key: entry.id, className: "dsh-areas-meta" }, [
          h("span", { key: "title" }, entry.title),
          h("span", { key: "words" }, String(entry.wordCount || 0) + " 词")
        ]);
      }

      var RESOURCE_KIND_LABELS = {
        reference: "参考", template: "模板", media: "素材",
        tool: "工具", dataset: "数据集", other: "其他"
      };

      // A resource is projected by title and kind. Its summary belongs to
      // Resources, and its source is never turned into a link here.
      function resourceLine(entry) {
        return h("li", { key: entry.id, className: "dsh-areas-meta" }, [
          h("span", { key: "title" }, entry.title),
          h("span", { key: "kind" }, RESOURCE_KIND_LABELS[entry.kind] || entry.kind)
        ]);
      }

      function group(key, label, entries, render, emptyText) {
        return h("section", { key: key, className: "dsh-areas-section" }, [
          h("h3", { key: "title", style: { margin: "0 0 6px", fontSize: 13 } }, [
            label,
            h("span", { key: "count", "data-areas-related-count": key }, String(entries.length))
          ]),
          related.errors[key]
            ? h("p", {
              key: "error",
              className: "dsh-areas-error",
              "data-areas-related-error": key,
              role: "status",
              "aria-live": "polite"
            }, related.errors[key])
            : null,
          entries.length === 0
            ? h("p", { key: "empty", className: "dsh-areas-meta" }, emptyText)
            : h("ul", { key: "list", style: { listStyle: "none", margin: 0, padding: 0 } },
              entries.map(render))
        ]);
      }

      var archivedProjects = projects.filter(isArchived);
      var archivedBookmarks = bookmarks.filter(isArchived);
      var archivedResources = resources.filter(isArchived);

      return h("section", {
        className: "dsh-areas-detail",
        "data-areas-related": record.id,
        "aria-label": "关联工作"
      }, [
        h("div", { key: "head", className: "dsh-areas-actions" }, [
          h("strong", { key: "title" }, "关联工作"),
          h("button", {
            key: "refresh",
            type: "button",
            className: "dsh-areas-chip",
            "data-areas-action": "refresh-related",
            onClick: function () { store.refreshRelated(); }
          }, "刷新")
        ]),
        group("projects", "项目 ", projects.filter(live), projectLine, "暂无关联项目。"),
        group("bookmarks", "书签 ", bookmarks.filter(live), bookmarkLine, "暂无关联书签。"),
        // Notebook has no reversible archive lifecycle, so every related note
        // is a live one and none can appear in the archived group below.
        group("notes", "笔记 ", notes, noteLine, "暂无关联笔记。"),
        group("resources", "资源 ", resources.filter(live), resourceLine, "暂无关联资源。"),
        archivedProjects.length + archivedBookmarks.length + archivedResources.length > 0
          ? h("section", {
            key: "archived",
            className: "dsh-areas-section",
            "data-areas-related-archived": record.id
          }, [
            h("h3", { key: "title", style: { margin: "0 0 6px", fontSize: 13 } }, "已存档的关联工作"),
            h("ul", { key: "list", style: { listStyle: "none", margin: 0, padding: 0 } },
              archivedProjects.map(projectLine)
                .concat(archivedBookmarks.map(bookmarkLine))
                .concat(archivedResources.map(resourceLine)))
          ])
          : null
      ]);
    }

    function detailPanel(store, state, record) {
      if (state.editingId === record.id) return editorPanel(store, state, record);

      var rows = [
        ["状态", STATUS_LABELS[record.status] || record.status],
        ["回顾频率", CADENCE_LABELS[record.reviewCadence] || record.reviewCadence],
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
          className: "dsh-areas-chip",
          "data-areas-action": "edit",
          onClick: function () { store.startEdit(record); }
        }, "编辑")
      ];
      if (record.lifecycle === "archived") {
        actions.push(h("button", {
          key: "restore",
          type: "button",
          className: "dsh-areas-chip",
          "data-areas-action": "restore",
          disabled: store.isPending(record.id + ":restore"),
          onClick: function () { store.transition(record, "restore"); }
        }, "恢复"));
      } else {
        actions.push(h("button", {
          key: "archive",
          type: "button",
          className: "dsh-areas-chip",
          "data-areas-action": "archive",
          disabled: store.isPending(record.id + ":archive"),
          onClick: function () { store.transition(record, "archive"); }
        }, "存档"));
      }
      // A stale write is recoverable by reloading, never by overwriting.
      if (state.staleId === record.id) {
        actions.push(h("button", {
          key: "reload",
          type: "button",
          className: "dsh-areas-primary",
          "data-areas-action": "reload",
          onClick: function () { store.load(); }
        }, "重新载入"));
      }

      return h("section", {
        className: "dsh-areas-detail",
        "data-areas-detail": record.id,
        "aria-label": "领域详情"
      }, [
        h("h2", { key: "name", className: "dsh-areas-title", style: { margin: 0 } }, record.name),
        record.purpose
          ? h("p", { key: "purpose", className: "dsh-areas-purpose" }, record.purpose)
          : null,
        h("dl", { key: "rows", style: { margin: "10px 0 0" } }, rows.map(function (row) {
          return h("div", { key: row[0], className: "dsh-areas-meta" }, [
            h("dt", { key: "k", style: { fontWeight: 600 } }, row[0]),
            h("dd", { key: "v", style: { margin: 0 } }, row[1])
          ]);
        })),
        h("div", { key: "actions", className: "dsh-areas-actions" }, actions)
      ]);
    }

    function editorPanel(store, state, record) {
      var pending = store.isPending(record.id + ":edit");
      return h("section", {
        className: "dsh-areas-detail",
        "data-areas-detail": record.id,
        "aria-label": "编辑领域"
      }, h("form", {
        "data-areas-edit-form": record.id,
        onSubmit: function (event) {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          store.saveEdit(record);
        }
      }, fieldInputs(state.editDraft, function (changes) { store.setEditDraft(changes); }, "edit").concat([
        h("div", { key: "actions", className: "dsh-areas-actions" }, [
          h("button", {
            key: "save",
            type: "submit",
            className: "dsh-areas-primary",
            "data-areas-action": "save",
            disabled: pending
          }, pending ? "保存中…" : "保存"),
          h("button", {
            key: "cancel",
            type: "button",
            className: "dsh-areas-chip",
            "data-areas-action": "cancel",
            onClick: function () { store.cancelEdit(); }
          }, "取消"),
          state.staleId === record.id
            ? h("button", {
              key: "reload",
              type: "button",
              className: "dsh-areas-chip",
              "data-areas-action": "reload",
              onClick: function () { store.load(); }
            }, "重新载入")
            : null
        ])
      ])));
    }

    function AreasSurface(props) {
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
      var visible = visibleAreas(state);
      // A selection that has left the visible set must not keep a detail panel
      // open over a record the list no longer contains.
      var selected = null;
      for (var index = 0; index < visible.length; index += 1) {
        if (visible[index].id === state.selectedId) selected = visible[index];
      }

      var filters = [
        h("input", {
          key: "search",
          className: "dsh-areas-input",
          "data-areas-search": "",
          type: "search",
          value: state.search,
          "aria-label": "搜索领域",
          placeholder: "搜索名称、职责或标签…",
          onChange: function (event) { store.setSearch(event.target.value); }
        })
      ].concat(["all"].concat(STATUSES).map(function (value) {
        return h("button", {
          key: "status-" + value,
          type: "button",
          className: "dsh-areas-chip",
          "data-areas-status-filter": value,
          "aria-pressed": state.statusFilter === value,
          onClick: function () { store.setStatusFilter(value); }
        }, value === "all" ? "全部" : STATUS_LABELS[value]);
      })).concat(["all"].concat(CADENCES).map(function (value) {
        return h("button", {
          key: "cadence-" + value,
          type: "button",
          className: "dsh-areas-chip",
          "data-areas-cadence-filter": value,
          "aria-pressed": state.cadenceFilter === value,
          onClick: function () { store.setCadenceFilter(value); }
        }, value === "all" ? "全部频率" : CADENCE_LABELS[value]);
      })).concat([
        h("button", {
          key: "archived",
          type: "button",
          className: "dsh-areas-chip",
          "data-areas-archived-filter": "",
          "aria-pressed": state.showArchived,
          onClick: function () { store.setShowArchived(!state.showArchived); }
        }, state.showArchived ? "查看未存档" : "查看存档")
      ]);

      var knownTags = [];
      state.areas.forEach(function (record) {
        record.tags.forEach(function (tag) {
          if (knownTags.indexOf(tag) < 0) knownTags.push(tag);
        });
      });
      var tagRow = knownTags.length === 0 ? null : h("div", {
        key: "tags",
        className: "dsh-areas-bar",
        role: "group",
        "aria-label": "标签筛选"
      }, knownTags.map(function (tag) {
        return h("button", {
          key: tag,
          type: "button",
          className: "dsh-areas-chip",
          "data-areas-tag-filter": tag,
          "aria-pressed": state.tagFilter === tag,
          onClick: function () { store.setTagFilter(tag); }
        }, tag);
      }));

      var emptyText = state.showArchived
        ? "暂无存档领域。"
        : (state.search || state.statusFilter !== "all" || state.cadenceFilter !== "all" || state.tagFilter
          ? "没有匹配的领域。"
          : "暂无领域。");

      return h("div", { className: "dsh-areas-root", "data-areas-view": "list" }, [
        h("div", { key: "filters", className: "dsh-areas-bar" }, filters),
        tagRow,
        createForm(store, state),
        h("div", { key: "body", className: "dsh-areas-body" }, [
          h("div", { key: "list", className: "dsh-areas-column" }, [
            statusRegion(state),
            loadFrame(store, state, function () {
              return h("ul", {
                className: "dsh-areas-list",
                "data-areas-list": "",
                style: { listStyle: "none", margin: 0, padding: 0 }
              }, visible.length === 0
                ? [h("li", { key: "empty", className: "dsh-areas-note" }, emptyText)]
                : visible.map(function (record) { return areaRow(store, state, record); }));
            })
          ]),
          selected
            ? h("div", { key: "detail", className: "dsh-areas-column" }, [
              h("div", { key: "detail-panel" }, detailPanel(store, state, selected)),
              h("div", { key: "related-panel" }, relatedPanel(store, state, selected))
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
            label: "Areas",
            localized: "领域",
            order: 30,
            icon: ICONS.area,
            render: function AreasDestination(destinationProps) {
              return h(AreasSurface, {
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

    function AreasNavButton(surface) {
      return function AreasNav() {
        return h("button", {
          type: "button",
          title: "Areas | 领域",
          "aria-label": "Areas | 领域",
          "aria-pressed": surface.isOpen(),
          onClick: function () { surface.toggle(); }
        }, h(ICONS.area, { size: 16, "aria-hidden": true }));
      };
    }

    function apply(ctx) {
      var slots = ctx.slots;
      if (!slots) return;

      var gate = createModeGate();
      var store = createAreasStore();
      var surface = createStandaloneSurface();
      var releaseStyles = ensureStyles();

      slots.inject("sidebar.footer.action", function () {
        return bindWhenStandalone(gate, function () {
          return slots.register(
            { name: "sidebar.footer.action", id: "areas", order: 140, label: function () { return "Areas"; } },
            AreasNavButton(surface)
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
              { name: "conversation", priority: -100, label: function () { return "Areas"; } },
              function AreasStandaloneSurface() {
                return h(AreasSurface, { store: store });
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
