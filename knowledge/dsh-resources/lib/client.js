/**
 * dsh-resources — client plugin.
 *
 * Publishes the `knowledge.resources` Work OS destination through browser
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
  id: "dsh-resources",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var UI = require("@deepseek-ai/dsh-client-ui-primitives");
    var h = React.createElement;

    var WORK_OS_API_KEY = "__ACKS_WORK_OS__";
    var WORK_OS_PENDING_KEY = "__ACKS_WORK_OS_PENDING__";
    var WORK_OS_WAIT_MS = 4000;
    var DESTINATION_ID = "knowledge.resources";

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
      resource: pickIcon("IconBookOutline16", "IconFolderOutline16", "IconListPenOutline16"),
      copy: pickIcon("IconCopyOutline16", "IconFileOutline16", "IconListPenOutline16"),
      edit: pickIcon("IconEditOutline16", "IconListPenOutline16"),
      archive: pickIcon("IconArchiveOutline16", "IconTrashOutline16"),
      restore: pickIcon("IconRefreshOutline16", "IconUndoOutline16"),
      reload: pickIcon("IconRefreshOutline16", "IconUndoOutline16")
    };

    var API_PREFIX = "/api/resources";
    var STYLE_ID = "dsh-resources-style";

    var KINDS = ["reference", "template", "media", "tool", "dataset", "other"];
    var KIND_LABELS = {
      reference: "参考", template: "模板", media: "素材",
      tool: "工具", dataset: "数据集", other: "其他"
    };
    var STATUSES = ["active", "dormant"];
    var STATUS_LABELS = { active: "在用", dormant: "休眠" };
    var SOURCE_TYPES = ["none", "note", "bookmark", "workspace"];
    var SOURCE_LABELS = { none: "无来源", note: "笔记", bookmark: "书签", workspace: "工作区文件" };

    // Each owner the source selectors read, and how an unresolved reference is
    // named. A Resource never resolves a source itself: it shows what the owner
    // reports, and says so plainly when the owner cannot be read.
    var SOURCE_OWNERS = {
      note: {
        path: "/api/notebook/state", collection: "notes", titleKey: "title",
        unknown: "未知笔记", label: "来源笔记",
        failure: "无法读取笔记列表，暂时只能选择其他来源。"
      },
      bookmark: {
        path: "/api/bookmarks/state", collection: "bookmarks", titleKey: "title",
        unknown: "未知书签", label: "来源书签",
        failure: "无法读取书签列表，暂时只能选择其他来源。"
      }
    };

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

    function resourcePath(id, action) {
      return "/resources/" + encodeURIComponent(id) + (action ? "/" + action : "");
    }

    // ── Store ───────────────────────────────────────────────────────────────

    function emptyDraft() {
      return {
        title: "", summary: "", kind: "reference", status: "active",
        areaId: "", sourceType: "none", sourceId: "", tags: ""
      };
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
      if (draft.sourceType !== "none" && String(draft.sourceId || "").trim().length === 0) {
        return "请选择或填写来源";
      }
      return null;
    }

    function draftBody(draft) {
      // Only ids travel. No Area name, note title or bookmark URL is copied
      // into a Resource payload, and `none` clears the source id outright.
      return {
        title: String(draft.title || "").trim(),
        summary: draft.summary || "",
        kind: draft.kind,
        status: draft.status,
        areaId: draft.areaId ? draft.areaId : null,
        sourceType: draft.sourceType,
        sourceId: draft.sourceType === "none" ? null : String(draft.sourceId || "").trim(),
        tags: parseTags(draft.tags)
      };
    }

    function createResourcesStore() {
      var state = {
        phase: "loading",
        resources: [],
        error: null,
        actionError: null,
        staleId: null,
        validation: null,
        pending: {},
        search: "",
        kindFilter: "all",
        statusFilter: "all",
        sourceFilter: "all",
        areaFilter: "",
        tagFilter: null,
        showArchived: false,
        selectedId: null,
        draft: emptyDraft(),
        editingId: null,
        editDraft: emptyDraft(),
        // Reference choices are a separate concern from the Resources load: an
        // outage in any owner must never put the list into an error state, and
        // each owner fails on its own.
        areas: [],
        areasError: null,
        notes: [],
        noteError: null,
        bookmarks: [],
        bookmarkError: null
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

      function applyResource(record) {
        var replaced = false;
        var resources = state.resources.map(function (existing) {
          if (existing.id !== record.id) return existing;
          replaced = true;
          return record;
        });
        if (!replaced) resources = [record].concat(resources);
        patch({ resources: resources, actionError: null, staleId: null });
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
              resources: payload.resources || [],
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

      var referenceLoadStarted = false;

      /**
       * Reads the three owners a Resource may reference. Each is settled on its
       * own, so one outage costs only the ability to make a *new* link of that
       * kind and never blanks the destination.
       */
      function loadReferences() {
        if (disposed || referenceLoadStarted) return Promise.resolve();
        referenceLoadStarted = true;
        return Promise.all([
          readCollection("/api/areas/state", "areas").then(
            function (records) { patch({ areas: records, areasError: null }); },
            function () {
              patch({ areas: [], areasError: "无法读取领域列表，暂时只能创建未关联资源。" });
            }
          ),
          readCollection(SOURCE_OWNERS.note.path, SOURCE_OWNERS.note.collection).then(
            function (records) { patch({ notes: records, noteError: null }); },
            function () { patch({ notes: [], noteError: SOURCE_OWNERS.note.failure }); }
          ),
          readCollection(SOURCE_OWNERS.bookmark.path, SOURCE_OWNERS.bookmark.collection).then(
            function (records) { patch({ bookmarks: records, bookmarkError: null }); },
            function () { patch({ bookmarks: [], bookmarkError: SOURCE_OWNERS.bookmark.failure }); }
          )
        ]);
      }

      function ensureLoaded() {
        loadReferences();
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


      function run(key, work, options) {
        var settings = options || {};
        if (state.pending[key]) return Promise.resolve(null);
        setPending(key, true);
        return work().then(
          function (payload) {
            setPending(key, false);
            if (payload && payload.resource) applyResource(payload.resource);
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
        setKindFilter: function (value) { patch({ kindFilter: value }); },
        setSourceFilter: function (value) { patch({ sourceFilter: value }); },
        setAreaFilter: function (value) { patch({ areaFilter: value }); },
        setTagFilter: function (value) { patch({ tagFilter: state.tagFilter === value ? null : value }); },
        setShowArchived: function (value) { patch({ showArchived: !!value, editingId: null }); },
        select: function (id) { patch({ selectedId: id, actionError: null, staleId: null }); },
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
              title: record.title,
              summary: record.summary,
              kind: record.kind,
              status: record.status,
              areaId: record.areaId || "",
              sourceType: record.sourceType,
              sourceId: record.sourceId || "",
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
            return request("PATCH", resourcePath(record.id), body);
          }, { id: record.id }).then(function (payload) {
            if (payload) patch({ editingId: null, validation: null });
            return payload;
          });
        },
        transition: function (record, action) {
          return run(record.id + ":" + action, function () {
            return request("POST", resourcePath(record.id, action), { expectedRevision: record.revision });
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
      ".dsh-resources-root{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;overflow:hidden;",
      "color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-base,#f7f4ec);font-size:14px}",
      ".dsh-resources-root *{box-sizing:border-box}",
      ".dsh-resources-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0;padding:10px 16px;",
      "border-bottom:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12))}",
      ".dsh-resources-body{flex:1;min-height:0;overflow:auto;padding:12px 16px 20px;display:flex;gap:16px;",
      "align-items:flex-start}",
      ".dsh-resources-column{flex:1 1 0;min-width:0}",
      ".dsh-resources-form{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;padding:10px 16px;",
      "border-bottom:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12))}",
      ".dsh-resources-input{font:inherit;padding:6px 10px;border-radius:8px;min-width:0;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.2));background:var(--dsw-alias-bg-layer-1,#fff);color:inherit}",
      ".dsh-resources-input[data-resources-title-input]{flex:1 1 200px}",
      ".dsh-resources-input[data-resources-summary-input]{flex:1 1 100%;min-height:52px;resize:vertical}",
      ".dsh-resources-input[data-resources-search]{flex:1 1 200px}",
      ".dsh-resources-primary{cursor:pointer;font:inherit;padding:6px 14px;border-radius:8px;border:0;",
      "color:#fff;background:var(--acks-work-os-orange,#ff6b1a)}",
      ".dsh-resources-primary:disabled{opacity:.72;cursor:default}",
      ".dsh-resources-chip{cursor:pointer;font:inherit;font-size:13px;padding:5px 10px;border-radius:999px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.16));background:transparent;color:inherit}",
      ".dsh-resources-chip[aria-pressed='true']{color:#fff;background:var(--acks-work-os-orange,#ff6b1a);",
      "border-color:var(--acks-work-os-orange,#ff6b1a)}",
      ".dsh-resources-chip:focus-visible,.dsh-resources-primary:focus-visible,.dsh-resources-item:focus-visible{",
      "outline:2px solid var(--acks-work-os-orange-deep,#d4530e);outline-offset:2px}",
      ".dsh-resources-item{display:block;width:100%;text-align:left;cursor:pointer;font:inherit;",
      "padding:10px 12px;margin-bottom:8px;border-radius:10px;color:inherit;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12));background:var(--dsw-alias-bg-layer-1,#fff)}",
      ".dsh-resources-item[aria-current='true']{border-color:var(--acks-work-os-orange,#ff6b1a);",
      "box-shadow:inset 0 0 0 1px var(--acks-work-os-orange,#ff6b1a)}",
      ".dsh-resources-title{font-weight:600;word-break:break-word}",
      ".dsh-resources-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;font-size:12px;",
      "color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-resources-tag{padding:0 6px;border-radius:999px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.18))}",
      ".dsh-resources-detail{padding:12px;border-radius:10px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12));background:var(--dsw-alias-bg-layer-1,#fff)}",
      ".dsh-resources-summary{margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;",
      "color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-resources-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}",
      ".dsh-resources-note{padding:24px 8px;text-align:center;color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-resources-section{margin-top:12px}",
      ".dsh-resources-section:first-of-type{margin-top:0}",
      ".dsh-resources-error{margin:0 0 10px;padding:8px 12px;border-radius:8px;font-size:13px;",
      "border:1px solid rgba(212,83,14,.4);background:rgba(255,107,26,.08);color:var(--acks-work-os-orange-deep,#d4530e)}",
      "@media (max-width:720px){.dsh-resources-body{flex-direction:column}.dsh-resources-column{width:100%}}"
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
        className: "dsh-resources-status",
        "data-resources-validation": "",
        role: "status",
        "aria-live": "polite"
      }, messages.length ? h("p", { className: "dsh-resources-error" }, messages.join("；")) : null);
    }

    // ── References ──────────────────────────────────────────────────────────
    //
    // A Resource owns ids and no copy of any referenced record. Each resolves
    // for display through its owner's own list, so a rename needs no
    // propagation here, and a value that no longer resolves is stated plainly
    // rather than rendered blank or as a raw id.

    function referenceTitle(record, titleKey) {
      var title = record[titleKey];
      var archived = record.lifecycle === "archived" || record.status === "archived";
      return archived ? title + "（已归档）" : title;
    }

    function areaLabel(state, id) {
      if (!id) return null;
      for (var index = 0; index < state.areas.length; index += 1) {
        if (state.areas[index].id === id) return referenceTitle(state.areas[index], "name");
      }
      return "未知领域";
    }

    function sourceRecords(state, sourceType) {
      if (sourceType === "note") return state.notes;
      if (sourceType === "bookmark") return state.bookmarks;
      return [];
    }

    /**
     * Names a resource's source. A workspace path is its own label — the string
     * is shown as text and never turned into a link or a file URL.
     */
    function sourceLabel(state, record) {
      if (record.sourceType === "none" || !record.sourceId) return null;
      if (record.sourceType === "workspace") return record.sourceId;
      var owner = SOURCE_OWNERS[record.sourceType];
      var records = sourceRecords(state, record.sourceType);
      for (var index = 0; index < records.length; index += 1) {
        if (records[index].id === record.sourceId) return referenceTitle(records[index], owner.titleKey);
      }
      return owner.unknown;
    }

    function referenceOptions(records, currentId, titleKey, noneText, unknownText) {
      var options = [h("option", { key: "none", value: "" }, noneText)];
      var seen = {};
      records.forEach(function (record) {
        // Only live records are offered for a new link; an existing link to an
        // archived one stays selectable so it can be seen and removed.
        var archived = record.lifecycle === "archived" || record.status === "archived";
        if (archived && record.id !== currentId) return;
        seen[record.id] = true;
        options.push(h("option", { key: record.id, value: record.id }, referenceTitle(record, titleKey)));
      });
      if (currentId && !seen[currentId]) {
        options.push(h("option", { key: currentId, value: currentId }, unknownText));
      }
      return options;
    }

    /** The id control follows the chosen type: a picker, a path, or nothing. */
    function sourceIdField(state, draft, onChange, prefix) {
      if (draft.sourceType === "none") return null;

      if (draft.sourceType === "workspace") {
        return h("input", {
          key: "source-id",
          className: "dsh-resources-input",
          "data-resources-source-id-input": prefix,
          type: "text",
          value: draft.sourceId,
          "aria-label": "工作区相对路径",
          placeholder: "docs/design/spec.md",
          maxLength: 1024,
          onChange: function (event) { onChange({ sourceId: event.target.value }); }
        });
      }

      var owner = SOURCE_OWNERS[draft.sourceType];
      return h("select", {
        key: "source-id",
        className: "dsh-resources-input",
        "data-resources-source-id-input": prefix,
        value: draft.sourceId || "",
        "aria-label": owner.label,
        onChange: function (event) { onChange({ sourceId: event.target.value }); }
      }, referenceOptions(
        sourceRecords(state, draft.sourceType), draft.sourceId, owner.titleKey,
        "请选择" + owner.label, owner.unknown
      ));
    }

    function sourceWarning(state, draft) {
      if (draft.sourceType === "note") return state.noteError;
      if (draft.sourceType === "bookmark") return state.bookmarkError;
      return null;
    }

    function fieldInputs(state, draft, onChange, prefix) {
      var warning = sourceWarning(state, draft);
      return [
        h("input", {
          key: "title",
          className: "dsh-resources-input",
          "data-resources-title-input": prefix,
          type: "text",
          value: draft.title,
          "aria-label": "资源标题",
          placeholder: "资源标题",
          maxLength: 160,
          onChange: function (event) { onChange({ title: event.target.value }); }
        }),
        h("select", {
          key: "kind",
          className: "dsh-resources-input",
          "data-resources-kind-input": prefix,
          value: draft.kind,
          "aria-label": "类型",
          onChange: function (event) { onChange({ kind: event.target.value }); }
        }, KINDS.map(function (value) {
          return h("option", { key: value, value: value }, KIND_LABELS[value]);
        })),
        h("select", {
          key: "status",
          className: "dsh-resources-input",
          "data-resources-status-input": prefix,
          value: draft.status,
          "aria-label": "状态",
          onChange: function (event) { onChange({ status: event.target.value }); }
        }, STATUSES.map(function (value) {
          return h("option", { key: value, value: value }, STATUS_LABELS[value]);
        })),
        h("select", {
          key: "area",
          className: "dsh-resources-input",
          "data-resources-area-input": prefix,
          value: draft.areaId || "",
          "aria-label": "关联领域",
          onChange: function (event) { onChange({ areaId: event.target.value }); }
        }, referenceOptions(state.areas, draft.areaId, "name", "未关联领域", "未知领域")),
        state.areasError
          ? h("span", {
            key: "area-warning",
            className: "dsh-resources-meta",
            "data-resources-area-warning": "",
            role: "status",
            "aria-live": "polite"
          }, state.areasError)
          : null,
        h("select", {
          key: "source-type",
          className: "dsh-resources-input",
          "data-resources-source-type-input": prefix,
          value: draft.sourceType,
          "aria-label": "来源类型",
          // Changing the type clears the id it no longer describes. The shapes
          // overlap — a UUID is also a valid relative path — so carrying the old
          // id over would silently mean a different thing.
          onChange: function (event) { onChange({ sourceType: event.target.value, sourceId: "" }); }
        }, SOURCE_TYPES.map(function (value) {
          return h("option", { key: value, value: value }, SOURCE_LABELS[value]);
        })),
        sourceIdField(state, draft, onChange, prefix),
        warning
          ? h("span", {
            key: "source-warning",
            className: "dsh-resources-meta",
            "data-resources-source-warning": "",
            role: "status",
            "aria-live": "polite"
          }, warning)
          : null,
        h("input", {
          key: "tags",
          className: "dsh-resources-input",
          "data-resources-tags-input": prefix,
          type: "text",
          value: draft.tags,
          "aria-label": "标签，使用逗号或空格分隔",
          placeholder: "标签（逗号分隔）",
          onChange: function (event) { onChange({ tags: event.target.value }); }
        }),
        h("textarea", {
          key: "summary",
          className: "dsh-resources-input",
          "data-resources-summary-input": prefix,
          value: draft.summary,
          "aria-label": "说明",
          placeholder: "这个资源是什么，什么时候该用它？",
          maxLength: 8000,
          onChange: function (event) { onChange({ summary: event.target.value }); }
        })
      ];
    }

    function createForm(store, state) {
      return h("form", {
        className: "dsh-resources-form",
        "data-resources-form": "",
        onSubmit: function (event) {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          store.createArea();
        }
      }, fieldInputs(state, state.draft, function (changes) { store.setDraft(changes); }, "create").concat([
        h("button", {
          key: "submit",
          type: "submit",
          className: "dsh-resources-primary",
          "data-resources-action": "create",
          disabled: store.isPending("create")
        }, store.isPending("create") ? "保存中…" : "新建资源")
      ]));
    }

    function loadFrame(store, state, body) {
      if (state.phase === "loading") {
        return h("p", { className: "dsh-resources-note" }, "载入中…");
      }
      if (state.phase === "error") {
        return h("div", { className: "dsh-resources-note" }, [
          h("p", { key: "message", className: "dsh-resources-error" }, "加载失败：" + state.error),
          h("button", {
            key: "retry",
            type: "button",
            className: "dsh-resources-primary",
            "data-resources-action": "retry",
            onClick: function () { store.load(); }
          }, "重试")
        ]);
      }
      return body();
    }

    function matchesSearch(state, record, needle) {
      if (needle.length === 0) return true;
      // A referenced name is searchable through the reference, never by
      // copying it into the record.
      return [record.title, record.summary, areaLabel(state, record.areaId) || "", sourceLabel(state, record) || ""]
        .concat(record.tags)
        .join(" ")
        .toLowerCase()
        .indexOf(needle) >= 0;
    }

    function visibleResources(state) {
      var needle = String(state.search || "").trim().toLowerCase();
      return state.resources.filter(function (record) {
        var wanted = state.showArchived ? "archived" : "active";
        if (record.lifecycle !== wanted) return false;
        if (state.kindFilter !== "all" && record.kind !== state.kindFilter) return false;
        if (state.statusFilter !== "all" && record.status !== state.statusFilter) return false;
        if (state.sourceFilter !== "all" && record.sourceType !== state.sourceFilter) return false;
        if (state.areaFilter && record.areaId !== state.areaFilter) return false;
        if (state.tagFilter && record.tags.indexOf(state.tagFilter) < 0) return false;
        return matchesSearch(state, record, needle);
      }).sort(function (left, right) {
        if (state.showArchived) return (right.archivedAt || 0) - (left.archivedAt || 0);
        // Newest updated first, with a deterministic id tie-break.
        return right.updatedAt - left.updatedAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      });
    }

    function resourceRow(store, state, record) {
      var meta = [
        h("span", { key: "kind" }, KIND_LABELS[record.kind] || record.kind),
        h("span", { key: "status" }, STATUS_LABELS[record.status] || record.status)
      ];
      var area = areaLabel(state, record.areaId);
      if (area) meta.push(h("span", { key: "area" }, "领域：" + area));
      var source = sourceLabel(state, record);
      // Text, never an anchor: a workspace path is a path and a bookmark link
      // belongs to Bookmarks.
      if (source) meta.push(h("span", { key: "source" }, SOURCE_LABELS[record.sourceType] + "：" + source));
      meta.push(h("span", { key: "revision" }, "修订 " + record.revision));
      record.tags.forEach(function (tag) {
        meta.push(h("span", { key: "tag-" + tag, className: "dsh-resources-tag" }, tag));
      });

      return h("li", { key: record.id }, h("button", {
        type: "button",
        className: "dsh-resources-item",
        "data-resources-item": record.id,
        "data-resources-action": "select",
        "aria-current": state.selectedId === record.id,
        onClick: function () { store.select(record.id); }
      }, [
        h("div", { key: "title", className: "dsh-resources-title" }, record.title),
        h("div", { key: "meta", className: "dsh-resources-meta" }, meta)

      ]));
    }

    function detailPanel(store, state, record) {
      if (state.editingId === record.id) return editorPanel(store, state, record);

      var source = sourceLabel(state, record);
      var rows = [
        ["类型", KIND_LABELS[record.kind] || record.kind],
        ["状态", STATUS_LABELS[record.status] || record.status],
        ["领域", areaLabel(state, record.areaId) || "未关联"],
        ["来源", record.sourceType === "none" ? "无" : SOURCE_LABELS[record.sourceType] + "：" + source],
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
          className: "dsh-resources-chip",
          "data-resources-action": "edit",
          onClick: function () { store.startEdit(record); }
        }, "编辑")
      ];

      // A workspace source is handed back as text and nothing more. There is
      // deliberately no open, no reveal and no file URL: this plugin stores the
      // path and never resolves it, and the browser has no business reaching
      // into the workspace either.
      if (record.sourceType === "workspace" && record.sourceId) {
        actions.push(h("button", {
          key: "copy-source",
          type: "button",
          className: "dsh-resources-chip",
          "data-resources-action": "copy-source",
          "aria-label": "复制工作区路径",
          onClick: function () {
            var clipboard = window.navigator && window.navigator.clipboard;
            if (clipboard && typeof clipboard.writeText === "function") {
              clipboard.writeText(record.sourceId).catch(function () {});
            }
          }
        }, [h(ICONS.copy, { key: "icon", size: 16, "aria-hidden": true }), "复制路径"]));
      }

      if (record.lifecycle === "archived") {
        actions.push(h("button", {
          key: "restore",
          type: "button",
          className: "dsh-resources-chip",
          "data-resources-action": "restore",
          disabled: store.isPending(record.id + ":restore"),
          onClick: function () { store.transition(record, "restore"); }
        }, "恢复"));
      } else {
        actions.push(h("button", {
          key: "archive",
          type: "button",
          className: "dsh-resources-chip",
          "data-resources-action": "archive",
          disabled: store.isPending(record.id + ":archive"),
          onClick: function () { store.transition(record, "archive"); }
        }, "存档"));
      }
      // A stale write is recoverable by reloading, never by overwriting.
      if (state.staleId === record.id) {
        actions.push(h("button", {
          key: "reload",
          type: "button",
          className: "dsh-resources-primary",
          "data-resources-action": "reload",
          onClick: function () { store.load(); }
        }, "重新载入"));
      }

      return h("section", {
        className: "dsh-resources-detail",
        "data-resources-detail": record.id,
        "aria-label": "资源详情"
      }, [
        h("h2", { key: "title", className: "dsh-resources-title", style: { margin: 0 } }, record.title),
        record.summary
          ? h("p", { key: "summary", className: "dsh-resources-summary" }, record.summary)
          : null,
        h("dl", { key: "rows", style: { margin: "10px 0 0" } }, rows.map(function (row) {
          return h("div", { key: row[0], className: "dsh-resources-meta" }, [
            h("dt", { key: "k", style: { fontWeight: 600 } }, row[0]),
            h("dd", { key: "v", style: { margin: 0 } }, row[1])
          ]);
        })),
        h("div", { key: "actions", className: "dsh-resources-actions" }, actions)
      ]);
    }

    function editorPanel(store, state, record) {
      var pending = store.isPending(record.id + ":edit");
      return h("section", {
        className: "dsh-resources-detail",
        "data-resources-detail": record.id,
        "aria-label": "编辑资源"
      }, h("form", {
        "data-resources-edit-form": record.id,
        onSubmit: function (event) {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          store.saveEdit(record);
        }
      }, fieldInputs(state, state.editDraft, function (changes) { store.setEditDraft(changes); }, "edit").concat([
        h("div", { key: "actions", className: "dsh-resources-actions" }, [
          h("button", {
            key: "save",
            type: "submit",
            className: "dsh-resources-primary",
            "data-resources-action": "save",
            disabled: pending
          }, pending ? "保存中…" : "保存"),
          h("button", {
            key: "cancel",
            type: "button",
            className: "dsh-resources-chip",
            "data-resources-action": "cancel",
            onClick: function () { store.cancelEdit(); }
          }, "取消"),
          state.staleId === record.id
            ? h("button", {
              key: "reload",
              type: "button",
              className: "dsh-resources-chip",
              "data-resources-action": "reload",
              onClick: function () { store.load(); }
            }, "重新载入")
            : null
        ])
      ])));
    }

    function ResourcesSurface(props) {
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
      var visible = visibleResources(state);
      // A selection that has left the visible set must not keep a detail panel
      // open over a record the list no longer contains.
      var selected = null;
      for (var index = 0; index < visible.length; index += 1) {
        if (visible[index].id === state.selectedId) selected = visible[index];
      }

      var filters = [
        h("input", {
          key: "search",
          className: "dsh-resources-input",
          "data-resources-search": "",
          type: "search",
          value: state.search,
          "aria-label": "搜索资源",
          placeholder: "搜索标题、说明、来源或标签…",
          onChange: function (event) { store.setSearch(event.target.value); }
        })
      ].concat(["all"].concat(KINDS).map(function (value) {
        return h("button", {
          key: "kind-" + value,
          type: "button",
          className: "dsh-resources-chip",
          "data-resources-kind-filter": value,
          "aria-pressed": state.kindFilter === value,
          onClick: function () { store.setKindFilter(value); }
        }, value === "all" ? "全部类型" : KIND_LABELS[value]);
      })).concat(["all"].concat(STATUSES).map(function (value) {
        return h("button", {
          key: "status-" + value,
          type: "button",
          className: "dsh-resources-chip",
          "data-resources-status-filter": value,
          "aria-pressed": state.statusFilter === value,
          onClick: function () { store.setStatusFilter(value); }
        }, value === "all" ? "全部状态" : STATUS_LABELS[value]);
      })).concat(["all"].concat(SOURCE_TYPES).map(function (value) {
        return h("button", {
          key: "source-" + value,
          type: "button",
          className: "dsh-resources-chip",
          "data-resources-source-filter": value,
          "aria-pressed": state.sourceFilter === value,
          onClick: function () { store.setSourceFilter(value); }
        }, value === "all" ? "全部来源" : SOURCE_LABELS[value]);
      })).concat([
        h("select", {
          key: "area-filter",
          className: "dsh-resources-input",
          "data-resources-area-filter": "",
          value: state.areaFilter,
          "aria-label": "按领域筛选",
          onChange: function (event) { store.setAreaFilter(event.target.value); }
        }, referenceOptions(state.areas, state.areaFilter, "name", "全部领域", "未知领域")),
        h("button", {
          key: "archived",
          type: "button",
          className: "dsh-resources-chip",
          "data-resources-archived-filter": "",
          "aria-pressed": state.showArchived,
          onClick: function () { store.setShowArchived(!state.showArchived); }
        }, state.showArchived ? "查看未存档" : "查看存档")
      ]);

      var knownTags = [];
      state.resources.forEach(function (record) {
        record.tags.forEach(function (tag) {
          if (knownTags.indexOf(tag) < 0) knownTags.push(tag);
        });
      });

      var tagRow = knownTags.length === 0 ? null : h("div", {
        key: "tags",
        className: "dsh-resources-bar",
        role: "group",
        "aria-label": "标签筛选"
      }, knownTags.map(function (tag) {
        return h("button", {
          key: tag,
          type: "button",
          className: "dsh-resources-chip",
          "data-resources-tag-filter": tag,
          "aria-pressed": state.tagFilter === tag,
          onClick: function () { store.setTagFilter(tag); }
        }, tag);
      }));

      var emptyText = state.showArchived
        ? "暂无存档资源。"
        : (state.search || state.kindFilter !== "all" || state.statusFilter !== "all"
          || state.sourceFilter !== "all" || state.areaFilter || state.tagFilter
          ? "没有匹配的资源。"
          : "暂无资源。");

      return h("div", { className: "dsh-resources-root", "data-resources-view": "list" }, [
        h("div", { key: "filters", className: "dsh-resources-bar" }, filters),
        tagRow,
        createForm(store, state),
        h("div", { key: "body", className: "dsh-resources-body" }, [
          h("div", { key: "list", className: "dsh-resources-column" }, [
            statusRegion(state),
            loadFrame(store, state, function () {
              return h("ul", {
                className: "dsh-resources-list",
                "data-resources-list": "",
                style: { listStyle: "none", margin: 0, padding: 0 }
              }, visible.length === 0
                ? [h("li", { key: "empty", className: "dsh-resources-note" }, emptyText)]
                : visible.map(function (record) { return resourceRow(store, state, record); }));
            })
          ]),
          selected
            ? h("div", { key: "detail", className: "dsh-resources-column" }, [
              h("div", { key: "detail-panel" }, detailPanel(store, state, selected))
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
            label: "Resources",
            localized: "资源",
            order: 30,
            icon: ICONS.resource,
            render: function ResourcesDestination(destinationProps) {
              return h(ResourcesSurface, {
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

    function ResourcesNavButton(surface) {
      return function AreasNav() {
        return h("button", {
          type: "button",
          title: "Areas | 领域",
          "aria-label": "Areas | 领域",
          "aria-pressed": surface.isOpen(),
          onClick: function () { surface.toggle(); }
        }, h(ICONS.resource, { size: 16, "aria-hidden": true }));
      };
    }

    function apply(ctx) {
      var slots = ctx.slots;
      if (!slots) return;

      var gate = createModeGate();
      var store = createResourcesStore();
      var surface = createStandaloneSurface();
      var releaseStyles = ensureStyles();

      slots.inject("sidebar.footer.action", function () {
        return bindWhenStandalone(gate, function () {
          return slots.register(
            { name: "sidebar.footer.action", id: "resources", order: 150, label: function () { return "Resources"; } },
            ResourcesNavButton(surface)
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
              { name: "conversation", priority: -100, label: function () { return "Resources"; } },
              function ResourcesStandaloneSurface() {
                return h(ResourcesSurface, { store: store });
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
