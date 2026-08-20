/**
 * dsh-knowledge-archives — client plugin.
 *
 * One read-only aggregate over every domain that owns archived records, and
 * nothing more.
 *
 * This plugin is not an authority. It stores nothing, publishes no service and
 * has no endpoint of its own — the host half is deliberately empty. It reads
 * each owner's existing same-origin state route, filters for that owner's own
 * spelling of "archived", and restores a record by calling the owner's own
 * restore endpoint with the owner's own contract.
 *
 * The two spellings are real and must not be flattened: Agenda, Bookmarks and
 * Notebook mark an archived record with `status`, and their lifecycle bodies
 * must be empty; Projects, Areas and Resources use `lifecycle` and require an
 * `expectedRevision`. Sending a revision where none is accepted is a 400, and
 * omitting one where it is required would let a stale restore win — so the
 * adapter carries each owner's shape rather than a lowest common denominator.
 *
 * Notebook was absent at first, because it had no reversible archive and there
 * was nothing here to restore. It has one now, and no delete route at all, so
 * it is an owner like any other.
 *
 * Nothing rendered here is ever an anchor. A bookmark URL belongs to Bookmarks;
 * in an aggregate it is text.
 */
window.__ModuleLoader__.load({
  id: "dsh-knowledge-archives",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var UI = require("@deepseek-ai/dsh-client-ui-primitives");
    var h = React.createElement;

    var WORK_OS_API_KEY = "__ACKS_WORK_OS__";
    var WORK_OS_PENDING_KEY = "__ACKS_WORK_OS_PENDING__";
    var WORK_OS_WAIT_MS = 4000;
    var DESTINATION_ID = "knowledge.archives";
    var STYLE_ID = "dsh-archives-style";

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
      archive: pickIcon("IconArchiveOutline16", "IconFolderOutline16", "IconListPenOutline16"),
      restore: pickIcon("IconRefreshOutline16", "IconUndoOutline16"),
      refresh: pickIcon("IconRefreshOutline16", "IconUndoOutline16")
    };

    // ── The owners ──────────────────────────────────────────────────────────
    //
    // Each entry is one domain's complete contract. Adding a domain here is the
    // only change a new archived-record owner should need, and every difference
    // between owners is data rather than a branch buried in the renderer.

    var SOURCES = [
      {
        key: "tasks",
        label: "待办事项",
        statePath: "/api/agenda/state",
        collection: "tasks",
        titleKey: "title",
        responseKey: "task",
        // Agenda marks its lifecycle with `status` and refuses a non-empty body.
        archivedBy: "status",
        revisioned: false,
        restorePath: function (id) { return "/api/agenda/tasks/" + encodeURIComponent(id) + "/restore"; },
        failure: "无法读取待办事项。"
      },
      {
        key: "bookmarks",
        label: "书签",
        statePath: "/api/bookmarks/state",
        collection: "bookmarks",
        titleKey: "title",
        responseKey: "bookmark",
        archivedBy: "status",
        revisioned: false,
        restorePath: function (id) { return "/api/bookmarks/bookmarks/" + encodeURIComponent(id) + "/restore"; },
        failure: "无法读取书签。"
      },
      {
        key: "projects",
        label: "项目",
        statePath: "/api/projects/state",
        collection: "projects",
        titleKey: "title",
        responseKey: "project",
        // Projects, Areas and Resources are revisioned: a restore must name the
        // revision it was rendered from, or a stale write could win.
        archivedBy: "lifecycle",
        revisioned: true,
        restorePath: function (id) { return "/api/projects/projects/" + encodeURIComponent(id) + "/restore"; },
        failure: "无法读取项目。"
      },
      {
        key: "areas",
        label: "领域",
        statePath: "/api/areas/state",
        collection: "areas",
        titleKey: "name",
        responseKey: "area",
        archivedBy: "lifecycle",
        revisioned: true,
        restorePath: function (id) { return "/api/areas/areas/" + encodeURIComponent(id) + "/restore"; },
        failure: "无法读取领域。"
      },
      {
        key: "notes",
        label: "笔记",
        statePath: "/api/notebook/state",
        collection: "notes",
        titleKey: "title",
        responseKey: "note",
        // Notebook archives with `status` and takes no body, like Agenda and
        // Bookmarks. It joined this list only once archiving became reversible:
        // a domain that hard-deletes has nothing for an archive to restore.
        archivedBy: "status",
        revisioned: false,
        restorePath: function (id) { return "/api/notebook/notes/" + encodeURIComponent(id) + "/restore"; },
        failure: "无法读取笔记。"
      },
      {
        key: "resources",
        label: "资源",
        statePath: "/api/resources/state",
        collection: "resources",
        titleKey: "title",
        responseKey: "resource",
        archivedBy: "lifecycle",
        revisioned: true,
        restorePath: function (id) { return "/api/resources/resources/" + encodeURIComponent(id) + "/restore"; },
        failure: "无法读取资源。"
      }
    ];

    function sourceByKey(key) {
      for (var index = 0; index < SOURCES.length; index += 1) {
        if (SOURCES[index].key === key) return SOURCES[index];
      }
      return null;
    }

    function isArchived(source, record) {
      return record && record[source.archivedBy] === "archived";
    }

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
      return fetch(path, options).then(function (response) {
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

    function formatDay(value) {
      // The owners store epoch milliseconds. A day bucket is enough for an
      // archive filter and avoids a time zone argument in the UI.
      //
      // A missing value has to return empty rather than fall through to zero.
      // `new Date(0)` is a perfectly valid date, so the old guard could never
      // fire: a record whose owner never set `archivedAt` rendered as
      // "存档于 1970-01-01", which reads as a fact and is not one. Returning
      // empty here is what makes the "未知日期" fallback reachable, keeps the
      // record out of a since-filter that cannot judge it, and leaves it
      // sorted last — one answer for all three, because they are all the same
      // question: we do not know when this was archived.
      var epochMs = Number(value);
      if (value === null || value === undefined || !isFinite(epochMs) || epochMs <= 0) return "";
      var date = new Date(epochMs);
      if (!isFinite(date.getTime())) return "";
      var month = String(date.getMonth() + 1);
      var day = String(date.getDate());
      return date.getFullYear() + "-"
        + (month.length < 2 ? "0" + month : month) + "-"
        + (day.length < 2 ? "0" + day : day);
    }

    // ── Store ───────────────────────────────────────────────────────────────
    //
    // One slice per owner, each loading and failing on its own. A projection
    // that hid four healthy sources because a fifth was down would be worse
    // than no aggregate at all.

    function createArchivesStore() {
      var state = {
        records: {},
        errors: {},
        loading: {},
        loadedOnce: false,
        actionError: null,
        pending: {},
        search: "",
        sourceFilter: "all",
        sinceFilter: ""
      };
      SOURCES.forEach(function (source) {
        state.records[source.key] = [];
        state.errors[source.key] = null;
        state.loading[source.key] = false;
      });

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

      /** Replaces one key inside a per-source map without mutating the old one. */
      function patchMap(name, key, value) {
        var next = {};
        for (var existing in state[name]) {
          if (Object.prototype.hasOwnProperty.call(state[name], existing)) next[existing] = state[name][existing];
        }
        next[key] = value;
        var changes = {};
        changes[name] = next;
        patch(changes);
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

      /** Loads one owner. Settled alone, so its outcome cannot affect another. */
      function loadSource(source) {
        patchMap("loading", source.key, true);
        return request("GET", source.statePath).then(
          function (payload) {
            var records = Array.isArray(payload[source.collection]) ? payload[source.collection] : [];
            patchMap("records", source.key, records.filter(function (record) {
              return isArchived(source, record);
            }));
            patchMap("errors", source.key, null);
          },
          function () {
            // The record set is emptied so a stale list cannot be mistaken for
            // a current one while its own group reports the failure.
            patchMap("records", source.key, []);
            patchMap("errors", source.key, source.failure);
          }
        ).then(function () {
          patchMap("loading", source.key, false);
        });
      }

      function load() {
        if (disposed) return Promise.resolve();
        loadStarted = true;
        patch({ actionError: null });
        return Promise.all(SOURCES.map(loadSource)).then(function () {
          patch({ loadedOnce: true });
        });
      }

      function ensureLoaded() {
        if (loadStarted) return Promise.resolve();
        return load();
      }

      /**
       * Restores one record through its owner.
       *
       * The body is the owner's contract, not this plugin's: a revisioned owner
       * is sent the revision the card was rendered from, and a non-revisioned
       * one is sent an empty body it will reject if it carries anything.
       *
       * The server response decides the outcome. On success the record leaves
       * the projection because the owner said it is no longer archived — never
       * because this plugin assumed the call worked.
       */
      function restore(sourceKey, record) {
        var source = sourceByKey(sourceKey);
        if (!source) return Promise.resolve(null);
        var pendingKey = sourceKey + ":" + record.id;
        if (state.pending[pendingKey]) return Promise.resolve(null);

        var body = source.revisioned ? { expectedRevision: record.revision } : {};
        setPending(pendingKey, true);
        return request("POST", source.restorePath(record.id), body).then(
          function (payload) {
            setPending(pendingKey, false);
            var returned = payload && payload[source.responseKey];
            if (returned && isArchived(source, returned)) {
              // The owner says it is still archived, so it stays listed.
              patchMap("records", sourceKey, state.records[sourceKey].map(function (entry) {
                return entry.id === returned.id ? returned : entry;
              }));
              return payload;
            }
            patchMap("records", sourceKey, state.records[sourceKey].filter(function (entry) {
              return entry.id !== record.id;
            }));
            patch({ actionError: null });
            return payload;
          },
          function (error) {
            setPending(pendingKey, false);
            patch({ actionError: error.message || "恢复失败" });
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
        refresh: function () { return load(); },
        setSearch: function (value) { patch({ search: value }); },
        setSourceFilter: function (value) { patch({ sourceFilter: value }); },
        setSinceFilter: function (value) { patch({ sinceFilter: value }); },
        restore: restore,
        dispose: function () {
          disposed = true;
          listeners.length = 0;
        }
      };
    }

    /**
     * Flattens every owner's archived records into one list.
     *
     * Ordering is newest-archived first with a deterministic tie-break, so a
     * reload cannot reshuffle two records archived in the same millisecond.
     */
    function visibleEntries(state) {
      var needle = String(state.search || "").trim().toLowerCase();
      var since = state.sinceFilter ? String(state.sinceFilter) : "";
      var entries = [];

      SOURCES.forEach(function (source) {
        if (state.sourceFilter !== "all" && state.sourceFilter !== source.key) return;
        state.records[source.key].forEach(function (record) {
          var title = String(record[source.titleKey] || "");
          if (needle.length > 0 && title.toLowerCase().indexOf(needle) < 0) return;
          var day = formatDay(record.archivedAt);
          if (since && day && day < since) return;
          entries.push({ source: source, record: record, title: title, day: day });
        });
      });

      return entries.sort(function (left, right) {
        var byTime = (right.record.archivedAt || 0) - (left.record.archivedAt || 0);
        if (byTime !== 0) return byTime;
        if (left.source.key !== right.source.key) return left.source.key < right.source.key ? -1 : 1;
        return left.record.id < right.record.id ? -1 : left.record.id > right.record.id ? 1 : 0;
      });
    }

    // ── Presentation ────────────────────────────────────────────────────────

    var STYLE_TEXT = [
      ".dsh-archives-root{display:flex;flex-direction:column;gap:12px;height:100%;",
      "padding:16px;box-sizing:border-box;overflow:auto;font-size:14px;",
      "color:var(--dsw-alias-label-primary,#111315)}",
      ".dsh-archives-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
      ".dsh-archives-input{height:32px;padding:0 10px;border-radius:8px;box-sizing:border-box;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.18));",
      "background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit}",
      ".dsh-archives-input[data-archives-search]{flex:1 1 200px}",
      ".dsh-archives-chip{height:28px;padding:0 10px;border-radius:999px;cursor:pointer;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.18));",
      "background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;font-size:12px}",
      ".dsh-archives-chip[aria-pressed='true']{border-color:var(--acks-work-os-orange,#ff6b1a);",
      "background:var(--acks-work-os-orange,#ff6b1a);color:#fff}",
      ".dsh-archives-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}",
      ".dsh-archives-item{display:flex;gap:12px;align-items:flex-start;width:100%;padding:10px 12px;",
      "border-radius:10px;box-sizing:border-box;text-align:left;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12));",
      "background:var(--dsw-alias-bg-layer-1,#fff)}",
      ".dsh-archives-title{font-weight:600;word-break:break-word}",
      ".dsh-archives-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;font-size:12px;",
      "color:var(--dsw-alias-label-secondary,#444);overflow-wrap:anywhere}",
      ".dsh-archives-badge{padding:0 6px;border-radius:999px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.18))}",
      ".dsh-archives-note{padding:24px 8px;text-align:center;",
      "color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-archives-error{margin:0 0 10px;padding:8px 12px;border-radius:8px;font-size:13px;",
      "border:1px solid rgba(212,83,14,.4);background:rgba(255,107,26,.08);",
      "color:var(--acks-work-os-orange-deep,#d4530e)}",
      ".dsh-archives-action{height:28px;padding:0 10px;border-radius:8px;cursor:pointer;",
      "display:inline-flex;align-items:center;gap:4px;margin-left:auto;flex:0 0 auto;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.18));",
      "background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;font-size:12px}",
      ".dsh-archives-action[disabled]{opacity:.6;cursor:default}",
      "@media (max-width:720px){.dsh-archives-item{flex-direction:column}",
      ".dsh-archives-action{margin-left:0}}"
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

    /** One archived record, labelled with the domain that still owns it. */
    function entryRow(store, state, entry) {
      var source = entry.source;
      var record = entry.record;
      var pendingKey = source.key + ":" + record.id;
      var pending = store.isPending(pendingKey);

      var meta = [
        h("span", { key: "source", className: "dsh-archives-badge" }, source.label),
        h("span", { key: "archived" }, "存档于 " + (entry.day || "未知日期"))
      ];
      // A bookmark URL is the owner's; here it is text, never an anchor.
      if (record.url) meta.push(h("span", { key: "url" }, record.url));
      if (source.revisioned) meta.push(h("span", { key: "revision" }, "修订 " + record.revision));

      return h("li", {
        key: source.key + ":" + record.id,
        className: "dsh-archives-item",
        "data-archives-item": record.id,
        "data-archives-source": source.key
      }, [
        h("div", { key: "copy", style: { minWidth: 0, flex: 1 } }, [
          h("div", { key: "title", className: "dsh-archives-title" }, entry.title || "无标题"),
          h("div", { key: "meta", className: "dsh-archives-meta" }, meta)
        ]),
        h("button", {
          key: "restore",
          type: "button",
          className: "dsh-archives-action",
          "data-archives-action": "restore",
          "data-archives-restore": source.key + ":" + record.id,
          "aria-label": "恢复" + source.label + "「" + (entry.title || "无标题") + "」",
          disabled: pending,
          onClick: function () { store.restore(source.key, record); }
        }, [
          h(ICONS.restore, { key: "icon", size: 16, "aria-hidden": true }),
          pending ? "恢复中…" : "恢复"
        ])
      ]);
    }

    function ArchivesSurface(props) {
      var store = props.store;
      var setRevision = React.useState(0)[1];

      React.useEffect(function () {
        return store.subscribe(function () {
          setRevision(function (value) { return value + 1; });
        });
      }, []);

      React.useEffect(function () {
        store.ensureLoaded();
      }, []);

      var state = store.getState();
      var entries = visibleEntries(state);
      var loadingAny = SOURCES.some(function (source) { return state.loading[source.key]; });

      var filters = [
        h("input", {
          key: "search",
          className: "dsh-archives-input",
          "data-archives-search": "",
          type: "search",
          value: state.search,
          "aria-label": "搜索已存档记录",
          placeholder: "搜索标题…",
          onChange: function (event) { store.setSearch(event.target.value); }
        }),
        h("input", {
          key: "since",
          className: "dsh-archives-input",
          "data-archives-since": "",
          type: "date",
          value: state.sinceFilter,
          "aria-label": "只看该日期之后存档的记录",
          onChange: function (event) { store.setSinceFilter(event.target.value); }
        })
      ].concat([{ key: "all", label: "全部来源" }].concat(SOURCES).map(function (source) {
        return h("button", {
          key: "source-" + source.key,
          type: "button",
          className: "dsh-archives-chip",
          "data-archives-source-filter": source.key,
          "aria-pressed": state.sourceFilter === source.key,
          onClick: function () { store.setSourceFilter(source.key); }
        }, source.label);
      })).concat([
        h("button", {
          key: "refresh",
          type: "button",
          className: "dsh-archives-chip",
          "data-archives-action": "refresh",
          onClick: function () { store.refresh(); }
        }, "刷新")
      ]);

      // Each owner reports its own failure, beside the others' results.
      var failures = SOURCES.filter(function (source) { return state.errors[source.key]; })
        .map(function (source) {
          return h("p", {
            key: "error-" + source.key,
            className: "dsh-archives-error",
            "data-archives-error": source.key,
            role: "status",
            "aria-live": "polite"
          }, state.errors[source.key]);
        });

      var body;
      if (!state.loadedOnce && loadingAny) {
        body = h("p", { className: "dsh-archives-note" }, "载入中…");
      } else if (entries.length === 0) {
        body = h("p", { className: "dsh-archives-note" },
          state.search || state.sourceFilter !== "all" || state.sinceFilter
            ? "没有匹配的存档记录。"
            : "暂无存档记录。");
      } else {
        body = h("ul", { className: "dsh-archives-list", "data-archives-list": "" },
          entries.map(function (entry) { return entryRow(store, state, entry); }));
      }

      return h("div", { className: "dsh-archives-root", "data-archives-view": "list" }, [
        h("div", { key: "filters", className: "dsh-archives-bar" }, filters),
        h("div", {
          key: "status",
          "data-archives-status": "",
          role: "status",
          "aria-live": "polite"
        }, state.actionError
          ? h("p", { className: "dsh-archives-error" }, state.actionError)
          : null),
        failures.length ? h("div", { key: "failures" }, failures) : null,
        h("div", { key: "body" }, body)
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
            label: "Archives",
            localized: "归档",
            order: 30,
            icon: ICONS.archive,
            render: function ArchivesDestination(destinationProps) {
              return h(ArchivesSurface, {
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

    function ArchivesNavButton(surface) {
      return function AreasNav() {
        return h("button", {
          type: "button",
          title: "Areas | 领域",
          "aria-label": "Areas | 领域",
          "aria-pressed": surface.isOpen(),
          onClick: function () { surface.toggle(); }
        }, h(ICONS.archive, { size: 16, "aria-hidden": true }));
      };
    }

    function apply(ctx) {
      var slots = ctx.slots;
      if (!slots) return;

      var gate = createModeGate();
      var store = createArchivesStore();
      var surface = createStandaloneSurface();
      var releaseStyles = ensureStyles();

      slots.inject("sidebar.footer.action", function () {
        return bindWhenStandalone(gate, function () {
          return slots.register(
            { name: "sidebar.footer.action", id: "archives", order: 160, label: function () { return "Archives"; } },
            ArchivesNavButton(surface)
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
              { name: "conversation", priority: -100, label: function () { return "Archives"; } },
              function ArchivesStandaloneSurface() {
                return h(ArchivesSurface, { store: store });
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
