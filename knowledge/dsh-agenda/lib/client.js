/**
 * dsh-agenda — client plugin.
 *
 * Publishes four Work OS destinations (calendar, tasks, review, archive) through
 * browser contract v1, and falls back to one standalone DSH surface when Work OS
 * is absent. Buildless: no JSX, no bundler, no import statements.
 *
 * Work OS is deliberately the last enabled bundle, so it does not exist when
 * this plugin initializes. The mode therefore cannot be decided synchronously:
 * the registration is queued for Work OS to drain, and a bounded wait selects
 * standalone if Work OS never arrives. Both surfaces are gated on that one
 * decision, so only ever one Agenda root exists.
 *
 * Calendar, Review and Archive are projections of one store and one write path;
 * the host record is always authoritative, and the client never invents an id,
 * a status or a timestamp.
 */
window.__ModuleLoader__.load({
  id: "dsh-agenda",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var UI = require("@deepseek-ai/dsh-client-ui-primitives");
    var h = React.createElement;

    var WORK_OS_API_KEY = "__ACKS_WORK_OS__";
    var WORK_OS_PENDING_KEY = "__ACKS_WORK_OS_PENDING__";
    var WORK_OS_WAIT_MS = 4000;
    var API_PREFIX = "/api/agenda";
    var STYLE_ID = "dsh-agenda-style";

    var PRIORITY_LABELS = { low: "低", normal: "普通", high: "高" };
    var STATUS_LABELS = { open: "待办", completed: "已完成", archived: "已存档" };

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
      calendar: pickIcon("IconCalendarOutline16", "IconClockOutline16", "IconChecklistOutline14"),
      tasks: pickIcon("IconChecklistOutline14", "IconListPenOutline16"),
      review: pickIcon("IconRefreshOutline16", "IconChecklistOutline14"),
      archive: pickIcon("IconArchiveOutline16", "IconTrashOutline16", "IconChecklistOutline14"),
      edit: pickIcon("IconEditOutline16", "IconPenOutline16", "IconListPenOutline16"),
      complete: pickIcon("IconCheckOutline16", "IconCheckmarkOutline16"),
      reopen: pickIcon("IconRefreshOutline16", "IconUndoOutline16"),
      restore: pickIcon("IconRefreshOutline16", "IconUndoOutline16"),
      previous: pickIcon("IconChevronLeftOutline14", "IconChevronLeftOutline16"),
      next: pickIcon("IconChevronRightOutline14", "IconChevronRightOutline16"),
      add: pickIcon("IconPlusOutline16", "IconAddOutline16")
    };

    // ── Local date helpers ──────────────────────────────────────────────────
    //
    // Every key is built from local calendar components. Slicing an ISO string
    // would silently shift the day for anyone east or west of UTC.

    function pad(value) {
      return value < 10 ? "0" + value : String(value);
    }

    function dateKey(date) {
      return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
    }

    function todayKey() {
      return dateKey(new Date());
    }

    function addDays(key, amount) {
      var parts = key.split("-");
      var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      date.setDate(date.getDate() + amount);
      return dateKey(date);
    }

    function formatDue(record) {
      if (!record.dueDate) return "未安排";
      return record.dueTime ? record.dueDate + " " + record.dueTime : record.dueDate;
    }

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

    function taskPath(id, action) {
      return "/tasks/" + encodeURIComponent(id) + (action ? "/" + action : "");
    }

    // ── Store ───────────────────────────────────────────────────────────────
    //
    // One store per plugin instance. Components read through to it at render
    // time and use local state only as a re-render trigger, so a projection can
    // never disagree with the task list it is derived from.

    function emptyDraft() {
      return { title: "", notes: "", dueDate: "", dueTime: "", priority: "normal", projectId: "" };
    }

    function createAgendaStore() {
      var state = {
        phase: "loading",
        tasks: [],
        error: null,
        actionError: null,
        validation: null,
        pending: {},
        filter: "all",
        search: "",
        // Project choices are a separate concern from Agenda's own load: a
        // Projects outage must never put the task list into an error state.
        projects: [],
        projectsError: null,
        draft: emptyDraft(),
        editingId: null,
        editDraft: null,
        selectedDate: todayKey(),
        visibleMonth: todayKey().slice(0, 7)
      };
      var listeners = [];
      var disposed = false;

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

      function applyTask(record) {
        var replaced = false;
        var tasks = state.tasks.map(function (existing) {
          if (existing.id !== record.id) return existing;
          replaced = true;
          return record;
        });
        if (!replaced) tasks = tasks.concat([record]);
        patch({ tasks: tasks, actionError: null });
      }

      var loadStarted = false;

      function load() {
        if (disposed) return Promise.resolve();
        loadStarted = true;
        patch({ phase: "loading", error: null });
        return request("GET", "/state").then(
          function (payload) {
            patch({ phase: "ready", tasks: payload.tasks || [], error: null });
          },
          function (error) {
            patch({ phase: "error", error: error.message || "加载失败" });
          }
        );
      }

      var projectsLoadStarted = false;

      function loadProjects() {
        if (disposed || projectsLoadStarted) return Promise.resolve();
        projectsLoadStarted = true;
        return fetch("/api/projects/state", {
          method: "GET",
          credentials: "same-origin",
          headers: { accept: "application/json" }
        }).then(function (response) {
          return response.json().then(function (payload) {
            if (!response.ok || !payload || payload.ok !== true) throw new Error("项目读取失败");
            return payload;
          });
        }).then(
          function (payload) {
            patch({ projects: Array.isArray(payload.projects) ? payload.projects : [], projectsError: null });
          },
          function () {
            // Bounded and local: Agenda stays usable without project choices.
            patch({ projects: [], projectsError: "无法读取项目列表，暂时只能创建未关联任务。" });
          }
        );
      }

      // Mounting a second destination must not re-request state: all four are
      // projections of this one store, and every render would otherwise start
      // another load.
      function ensureLoaded() {
        loadProjects();
        if (loadStarted) return Promise.resolve();
        return load();
      }

      function run(key, work) {
        if (state.pending[key]) return Promise.resolve();
        setPending(key, true);
        return work().then(
          function (payload) {
            setPending(key, false);
            if (payload && payload.task) applyTask(payload.task);
            return payload;
          },
          function (error) {
            setPending(key, false);
            patch({ actionError: error.message || "操作失败" });
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
        setFilter: function (filter) { patch({ filter: filter }); },
        setSearch: function (value) { patch({ search: value }); },
        setDraft: function (changes) {
          var draft = {};
          for (var key in state.draft) {
            if (Object.prototype.hasOwnProperty.call(state.draft, key)) draft[key] = state.draft[key];
          }
          for (var change in changes) {
            if (Object.prototype.hasOwnProperty.call(changes, change)) draft[change] = changes[change];
          }
          patch({ draft: draft, validation: null });
        },
        beginEdit: function (record) {
          patch({
            editingId: record.id,
            editDraft: {
              projectId: record.projectId || "",
              title: record.title,
              notes: record.notes || "",
              dueDate: record.dueDate || "",
              dueTime: record.dueTime || "",
              priority: record.priority || "normal",
              orderIndex: String(record.orderIndex)
            },
            validation: null,
            actionError: null
          });
        },
        setEditDraft: function (changes) {
          if (!state.editDraft) return;
          var draft = {};
          for (var key in state.editDraft) {
            if (Object.prototype.hasOwnProperty.call(state.editDraft, key)) draft[key] = state.editDraft[key];
          }
          for (var change in changes) {
            if (Object.prototype.hasOwnProperty.call(changes, change)) draft[change] = changes[change];
          }
          patch({ editDraft: draft, validation: null });
        },
        cancelEdit: function () {
          patch({ editingId: null, editDraft: null, validation: null });
        },
        selectDate: function (key) { patch({ selectedDate: key, visibleMonth: key.slice(0, 7) }); },
        setVisibleMonth: function (month) { patch({ visibleMonth: month }); },
        createTask: function (defaults) {
          var draft = state.draft;
          var fallback = defaults || {};
          var title = String(draft.title || "").trim();
          if (title.length === 0) {
            patch({ validation: "请输入标题" });
            return Promise.resolve();
          }
          var body = { title: title, priority: draft.priority };
          body.projectId = draft.projectId ? draft.projectId : null;
          if (draft.notes) body.notes = draft.notes;
          var dueDate = draft.dueDate || fallback.dueDate || "";
          if (dueDate) {
            body.dueDate = dueDate;
            if (draft.dueTime) body.dueTime = draft.dueTime;
          }
          return run("create", function () {
            return request("POST", "/tasks", body);
          }).then(function (payload) {
            if (payload) patch({ draft: emptyDraft(), validation: null });
          });
        },
        transition: function (id, action) {
          return run(id + ":" + action, function () {
            return request("POST", taskPath(id, action), {});
          });
        },
        saveEdit: function () {
          var id = state.editingId;
          var draft = state.editDraft;
          if (!id || !draft) return Promise.resolve();
          var title = String(draft.title || "").trim();
          if (title.length === 0) {
            patch({ validation: "请输入标题" });
            return Promise.resolve();
          }
          var orderIndex = Number(draft.orderIndex);
          if (!Number.isInteger(orderIndex) || orderIndex < 0 || orderIndex > 1000000) {
            patch({ validation: "排序必须是 0 到 1000000 的整数" });
            return Promise.resolve();
          }
          var dueDate = draft.dueDate || null;
          var changes = {
            title: title,
            notes: String(draft.notes || ""),
            dueDate: dueDate,
            dueTime: dueDate && draft.dueTime ? draft.dueTime : null,
            priority: draft.priority,
            orderIndex: orderIndex,
            projectId: draft.projectId ? draft.projectId : null
          };
          return run(id + ":edit", function () {
            return request("PATCH", taskPath(id), changes);
          }).then(function (payload) {
            if (payload) patch({ editingId: null, editDraft: null, validation: null });
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
    // Every rule is scoped under .dsh-agenda-root. The plugin never writes a
    // global body style.

    var STYLE_TEXT = [
      ".dsh-agenda-root{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;overflow:hidden;",
      "color:var(--dsw-alias-label-primary,#1a1a1a);background:var(--dsw-alias-bg-base,#f7f4ec);font-size:14px}",
      ".dsh-agenda-root *{box-sizing:border-box}",
      ".dsh-agenda-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex-shrink:0;padding:10px 16px;",
      "border-bottom:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12))}",
      ".dsh-agenda-body{flex:1;min-height:0;overflow:auto;padding:12px 16px 20px}",
      ".dsh-agenda-filter{cursor:pointer;font:inherit;font-size:13px;padding:5px 10px;border-radius:999px;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.16));background:transparent;color:inherit}",
      ".dsh-agenda-filter[aria-pressed='true']{color:#fff;background:var(--acks-work-os-orange,#ff6b1a);",
      "border-color:var(--acks-work-os-orange,#ff6b1a)}",
      ".dsh-agenda-filter:focus-visible,.dsh-agenda-icon:focus-visible,.dsh-agenda-day:focus-visible{",
      "outline:2px solid var(--acks-work-os-orange-deep,#d4530e);outline-offset:2px}",
      ".dsh-agenda-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 16px;",
      "border-bottom:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12))}",
      ".dsh-agenda-input{font:inherit;padding:6px 10px;border-radius:8px;min-width:0;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.2));background:var(--dsw-alias-bg-layer-1,#fff);color:inherit}",
      ".dsh-agenda-input[data-agenda-title-input]{flex:1 1 220px}",
      ".dsh-agenda-textarea{font:inherit;line-height:1.45;resize:vertical;min-height:34px;max-height:120px;",
      "padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.2));",
      "background:var(--dsw-alias-bg-layer-1,#fff);color:inherit}",
      ".dsh-agenda-form>.dsh-agenda-textarea{flex:1 1 100%;width:100%}",
      ".dsh-agenda-edit-form{display:grid;grid-template-columns:minmax(180px,2fr) minmax(180px,2fr) auto auto auto auto;",
      "gap:8px;align-items:start;width:100%}",
      ".dsh-agenda-edit-form>.dsh-agenda-textarea{grid-column:1/-1;width:100%}",
      ".dsh-agenda-edit-actions{display:flex;gap:6px;align-items:center}",
      ".dsh-agenda-primary{cursor:pointer;font:inherit;padding:6px 14px;border-radius:8px;border:0;",
      "color:#fff;background:var(--acks-work-os-orange,#ff6b1a)}",
      ".dsh-agenda-primary:disabled{opacity:.72;cursor:default}",
      ".dsh-agenda-item{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;margin-bottom:8px;",
      "border-radius:10px;border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.12));",
      "background:var(--dsw-alias-bg-layer-1,#fff)}",
      ".dsh-agenda-item[data-status='completed'] .dsh-agenda-title{text-decoration:line-through;opacity:.72}",
      ".dsh-agenda-title{font-weight:600;word-break:break-word}",
      ".dsh-agenda-notes{margin:4px 0 0;white-space:pre-wrap;word-break:break-word;line-height:1.5;",
      "color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-agenda-meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:3px;font-size:12px;",
      "color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-agenda-actions{display:flex;gap:4px;margin-left:auto;flex-shrink:0}",
      ".dsh-agenda-icon{cursor:pointer;display:inline-flex;align-items:center;justify-content:center;",
      "width:30px;height:30px;border-radius:8px;border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.16));",
      "background:transparent;color:inherit}",
      ".dsh-agenda-icon:disabled{opacity:.5;cursor:default}",
      ".dsh-agenda-note{padding:24px 8px;text-align:center;color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-agenda-error{margin:0 0 10px;padding:8px 12px;border-radius:8px;font-size:13px;",
      "border:1px solid rgba(212,83,14,.4);background:rgba(255,107,26,.08);color:var(--acks-work-os-orange-deep,#d4530e)}",
      ".dsh-agenda-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}",
      ".dsh-agenda-weekday{padding:4px 0;text-align:center;font-size:12px;",
      "color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-agenda-day{cursor:pointer;font:inherit;min-height:56px;padding:4px;border-radius:8px;text-align:left;",
      "border:1px solid var(--dsw-alias-line-1,rgba(17,19,21,.1));background:var(--dsw-alias-bg-layer-1,#fff);color:inherit}",
      ".dsh-agenda-day[data-outside='true']{opacity:.45}",
      ".dsh-agenda-day[aria-pressed='true']{border-color:var(--acks-work-os-orange,#ff6b1a);",
      "box-shadow:inset 0 0 0 1px var(--acks-work-os-orange,#ff6b1a)}",
      ".dsh-agenda-day[data-today='true'] .dsh-agenda-daynumber{font-weight:700;",
      "color:var(--acks-work-os-orange-deep,#d4530e)}",
      ".dsh-agenda-daycount{display:block;font-size:11px;color:var(--dsw-alias-label-secondary,#444)}",
      ".dsh-agenda-columns{display:flex;gap:16px;align-items:flex-start}",
      ".dsh-agenda-columns>*{flex:1;min-width:0}",
      ".dsh-agenda-section{margin-bottom:18px}",
      ".dsh-agenda-section h2{margin:0 0 8px;font-size:14px}",
      "@media (max-width:860px){.dsh-agenda-columns{flex-direction:column}",
      ".dsh-agenda-edit-form{grid-template-columns:1fr 1fr}.dsh-agenda-edit-form>.dsh-agenda-textarea{grid-column:1/-1}}"
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

    // ── Shared presentation ─────────────────────────────────────────────────

    function iconButton(options) {
      return h("button", {
        key: options.key,
        type: "button",
        className: "dsh-agenda-icon",
        "data-agenda-action": options.action,
        "aria-label": options.label,
        title: options.label,
        disabled: !!options.disabled,
        onClick: options.onClick
      }, h(options.icon, { size: 16, "aria-hidden": true }));
    }

    function taskRow(store, record, options) {
      var settings = options || {};
      var state = store.getState();
      if (state.editingId === record.id && state.editDraft) {
        return h("li", {
          key: record.id,
          className: "dsh-agenda-item",
          "data-agenda-task": record.id,
          "data-status": record.status
        }, editForm(store, state, record));
      }
      var actions = [];

      if (record.status !== "archived") {
        actions.push(iconButton({
          key: "edit",
          action: "edit",
          label: "编辑「" + record.title + "」",
          icon: ICONS.edit,
          disabled: store.isPending(record.id + ":edit"),
          onClick: function () { store.beginEdit(record); }
        }));
      }

      if (record.status === "open") {
        actions.push(iconButton({
          key: "complete",
          action: "complete",
          label: "完成「" + record.title + "」",
          icon: ICONS.complete,
          disabled: store.isPending(record.id + ":complete"),
          onClick: function () { store.transition(record.id, "complete"); }
        }));
      }
      if (record.status === "completed") {
        actions.push(iconButton({
          key: "reopen",
          action: "reopen",
          label: "重新打开「" + record.title + "」",
          icon: ICONS.reopen,
          disabled: store.isPending(record.id + ":reopen"),
          onClick: function () { store.transition(record.id, "reopen"); }
        }));
      }
      if (record.status === "archived") {
        actions.push(iconButton({
          key: "restore",
          action: "restore",
          label: "恢复「" + record.title + "」",
          icon: ICONS.restore,
          disabled: store.isPending(record.id + ":restore"),
          onClick: function () { store.transition(record.id, "restore"); }
        }));
      } else if (!settings.hideArchive) {
        actions.push(iconButton({
          key: "archive",
          action: "archive",
          label: "存档「" + record.title + "」",
          icon: ICONS.archive,
          disabled: store.isPending(record.id + ":archive"),
          onClick: function () { store.transition(record.id, "archive"); }
        }));
      }

      var meta = [
        h("span", { key: "status" }, STATUS_LABELS[record.status] || record.status),
        h("span", { key: "due" }, formatDue(record)),
        h("span", { key: "priority" }, "优先级：" + (PRIORITY_LABELS[record.priority] || record.priority))
      ];
      if (record.status === "archived" && record.archivedFrom) {
        meta.push(h("span", { key: "from" }, "存档前：" + (STATUS_LABELS[record.archivedFrom] || record.archivedFrom)));
      }
      var linkLabel = settings.state ? projectLabel(settings.state, record.projectId) : null;
      if (linkLabel) meta.push(h("span", { key: "project" }, "项目：" + linkLabel));

      return h("li", {
        key: record.id,
        className: "dsh-agenda-item",
        "data-agenda-task": record.id,
        "data-status": record.status
      }, [
        h("div", { key: "copy", style: { minWidth: 0, flex: 1 } }, [
          h("div", { key: "title", className: "dsh-agenda-title" }, record.title),
          record.notes ? h("p", { key: "notes", className: "dsh-agenda-notes" }, record.notes) : null,
          h("div", { key: "meta", className: "dsh-agenda-meta" }, meta)
        ]),
        h("div", { key: "actions", className: "dsh-agenda-actions" }, actions)
      ]);
    }

    function editForm(store, state, record) {
      var draft = state.editDraft;
      var pending = store.isPending(record.id + ":edit");
      return h("form", {
        className: "dsh-agenda-edit-form",
        "data-agenda-edit-form": record.id,
        onSubmit: function (event) {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          store.saveEdit();
        }
      }, [
        h("input", {
          key: "title", className: "dsh-agenda-input", type: "text", value: draft.title,
          "data-agenda-edit-title": "", "aria-label": "编辑任务标题", maxLength: 200,
          onChange: function (event) { store.setEditDraft({ title: event.target.value }); }
        }),
        h("textarea", {
          key: "notes", className: "dsh-agenda-textarea", value: draft.notes,
          "data-agenda-edit-notes": "", "aria-label": "编辑任务备注", maxLength: 20000,
          onChange: function (event) { store.setEditDraft({ notes: event.target.value }); }
        }),
        h("input", {
          key: "date", className: "dsh-agenda-input", type: "date", value: draft.dueDate,
          "data-agenda-edit-date": "", "aria-label": "编辑截止日期",
          onChange: function (event) { store.setEditDraft({ dueDate: event.target.value }); }
        }),
        h("input", {
          key: "time", className: "dsh-agenda-input", type: "time", value: draft.dueTime,
          "data-agenda-edit-time": "", "aria-label": "编辑截止时间",
          onChange: function (event) { store.setEditDraft({ dueTime: event.target.value }); }
        }),
        h("select", {
          key: "priority", className: "dsh-agenda-input", value: draft.priority,
          "data-agenda-edit-priority": "", "aria-label": "编辑优先级",
          onChange: function (event) { store.setEditDraft({ priority: event.target.value }); }
        }, ["low", "normal", "high"].map(function (value) {
          return h("option", { key: value, value: value }, PRIORITY_LABELS[value]);
        })),
        h("input", {
          key: "order", className: "dsh-agenda-input", type: "number", min: 0, max: 1000000,
          step: 1, value: draft.orderIndex, "data-agenda-edit-order": "", "aria-label": "编辑排序",
          onChange: function (event) { store.setEditDraft({ orderIndex: event.target.value }); }
        }),
        h("div", { key: "actions", className: "dsh-agenda-edit-actions" }, [
          h("button", {
            key: "save", type: "submit", className: "dsh-agenda-primary",
            "data-agenda-action": "save-edit", disabled: pending
          }, pending ? "保存中…" : "保存"),
          h("button", {
            key: "cancel", type: "button", className: "dsh-agenda-filter",
            "data-agenda-action": "cancel-edit", disabled: pending,
            onClick: function () { store.cancelEdit(); }
          }, "取消")
        ])
      ]);
    }

    function taskList(store, records, emptyText, options) {
      if (records.length === 0) {
        return h("p", { className: "dsh-agenda-note" }, emptyText);
      }
      return h("ul", {
        className: "dsh-agenda-list",
        style: { listStyle: "none", margin: 0, padding: 0 }
      }, records.map(function (record) { return taskRow(store, record, options); }));
    }

    function statusRegion(state) {
      var messages = [];
      if (state.validation) messages.push(state.validation);
      if (state.actionError) messages.push(state.actionError);
      return h("div", {
        className: "dsh-agenda-status",
        "data-agenda-validation": "",
        role: "status",
        "aria-live": "polite"
      }, messages.length ? h("p", { className: "dsh-agenda-error" }, messages.join("；")) : null);
    }

    // A reference resolves through the project list; a value that no longer
    // matches is stated plainly rather than hidden or turned into a link.
    function findProject(state, id) {
      if (!id) return null;
      for (var index = 0; index < state.projects.length; index += 1) {
        if (state.projects[index].id === id) return state.projects[index];
      }
      return null;
    }

    function projectLabel(state, id) {
      if (!id) return null;
      var found = findProject(state, id);
      if (!found) return "未知项目";
      return found.lifecycle === "archived" ? found.title + "（已归档）" : found.title;
    }

    function projectOptions(state, currentId) {
      var options = [h("option", { key: "none", value: "" }, "未关联项目")];
      var seen = {};
      state.projects.forEach(function (record) {
        // Only active projects are offered for a new link; an existing link to
        // an archived project stays selectable so it can be seen and removed.
        if (record.lifecycle !== "active" && record.id !== currentId) return;
        seen[record.id] = true;
        options.push(h("option", { key: record.id, value: record.id },
          record.lifecycle === "archived" ? record.title + "（已归档）" : record.title));
      });
      if (currentId && !seen[currentId]) {
        options.push(h("option", { key: currentId, value: currentId }, "未知项目"));
      }
      return options;
    }

    function projectSelector(state, value, prefix, onChange) {
      var nodes = [
        h("select", {
          key: "project",
          className: "dsh-agenda-input",
          "data-agenda-project-input": prefix,
          value: value || "",
          "aria-label": "关联项目",
          onChange: function (event) { onChange(event.target.value); }
        }, projectOptions(state, value))
      ];
      if (state.projectsError) {
        nodes.push(h("span", {
          key: "warning",
          className: "dsh-agenda-meta",
          "data-agenda-project-warning": "",
          role: "status",
          "aria-live": "polite"
        }, state.projectsError));
      }
      return nodes;
    }

    function createForm(store, state, presetDate) {
      return h("form", {
        className: "dsh-agenda-form",
        "data-agenda-form": "",
        onSubmit: function (event) {
          if (event && typeof event.preventDefault === "function") event.preventDefault();
          store.createTask({ dueDate: presetDate });
        }
      }, [
        h("input", {
          key: "title",
          className: "dsh-agenda-input",
          "data-agenda-title-input": "",
          type: "text",
          value: state.draft.title,
          "aria-label": "任务标题",
          placeholder: "添加任务…",
          maxLength: 200,
          onChange: function (event) { store.setDraft({ title: event.target.value }); }
        }),
        h("input", {
          key: "date",
          className: "dsh-agenda-input",
          "data-agenda-date-input": "",
          type: "date",
          value: state.draft.dueDate || presetDate || "",
          "aria-label": "截止日期",
          onChange: function (event) { store.setDraft({ dueDate: event.target.value }); }
        }),
        h("input", {
          key: "time",
          className: "dsh-agenda-input",
          "data-agenda-time-input": "",
          type: "time",
          value: state.draft.dueTime,
          "aria-label": "截止时间",
          onChange: function (event) { store.setDraft({ dueTime: event.target.value }); }
        }),
        h("select", {
          key: "priority",
          className: "dsh-agenda-input",
          "data-agenda-priority-input": "",
          value: state.draft.priority,
          "aria-label": "优先级",
          onChange: function (event) { store.setDraft({ priority: event.target.value }); }
        }, ["low", "normal", "high"].map(function (value) {
          return h("option", { key: value, value: value }, PRIORITY_LABELS[value]);
        })),
      ].concat(projectSelector(state, state.draft.projectId, "create", function (value) {
        store.setDraft({ projectId: value });
      })).concat([
        h("button", {
          key: "submit",
          type: "submit",
          className: "dsh-agenda-primary",
          "data-agenda-action": "create",
          disabled: store.isPending("create")
        }, store.isPending("create") ? "添加中…" : "添加任务"),
        h("textarea", {
          key: "notes",
          className: "dsh-agenda-textarea",
          "data-agenda-create-notes": "",
          value: state.draft.notes,
          "aria-label": "任务备注",
          placeholder: "备注（可选）",
          maxLength: 20000,
          onChange: function (event) { store.setDraft({ notes: event.target.value }); }
        })
      ]));
    }

    function loadFrame(store, state, body) {
      if (state.phase === "loading") {
        return h("p", { className: "dsh-agenda-note" }, "载入中…");
      }
      if (state.phase === "error") {
        return h("div", { className: "dsh-agenda-note" }, [
          h("p", { key: "message", className: "dsh-agenda-error" }, "加载失败：" + state.error),
          h("button", {
            key: "retry",
            type: "button",
            className: "dsh-agenda-primary",
            "data-agenda-action": "retry",
            onClick: function () { store.load(); }
          }, "重试")
        ]);
      }
      return body();
    }

    // ── Filters ─────────────────────────────────────────────────────────────

    var FILTERS = [
      { id: "all", label: "全部" },
      { id: "today", label: "今天" },
      { id: "upcoming", label: "即将到来" },
      { id: "overdue", label: "已逾期" },
      { id: "unscheduled", label: "未安排" }
    ];

    function matchesSearch(state, record, needle) {
      if (needle.length === 0) return true;
      var haystack = [record.title, record.notes, projectLabel(state, record.projectId) || ""]
        .join(" ")
        .toLowerCase();
      return haystack.indexOf(needle) >= 0;
    }

    function matchesFilter(record, filter, today) {
      if (filter === "all") return true;
      if (filter === "unscheduled") return record.dueDate === null;
      if (record.dueDate === null) return false;
      if (filter === "today") return record.dueDate === today;
      if (filter === "overdue") return record.dueDate < today && record.status === "open";
      if (filter === "upcoming") return record.dueDate > today;
      return true;
    }

    function activeTasks(state) {
      return state.tasks.filter(function (record) { return record.status !== "archived"; });
    }

    function sortTasks(records) {
      return records.slice().sort(function (left, right) {
        if (left.status !== right.status) return left.status === "open" ? -1 : 1;
        if (left.dueDate !== right.dueDate) {
          if (left.dueDate === null) return 1;
          if (right.dueDate === null) return -1;
          return left.dueDate < right.dueDate ? -1 : 1;
        }
        return left.orderIndex - right.orderIndex;
      });
    }

    // ── Views ───────────────────────────────────────────────────────────────

    function TasksView(store, state) {
      var today = todayKey();
      var needle = String(state.search || "").trim().toLowerCase();
      var visible = sortTasks(activeTasks(state).filter(function (record) {
        if (!matchesSearch(state, record, needle)) return false;
        return matchesFilter(record, state.filter, today);
      }));

      return h("div", { className: "dsh-agenda-root", "data-agenda-view": "tasks" }, [
        h("div", { key: "filters", className: "dsh-agenda-bar", role: "group", "aria-label": "任务筛选" },
          [h("input", {
            key: "search",
            className: "dsh-agenda-input",
            "data-agenda-search": "",
            type: "search",
            value: state.search,
            "aria-label": "搜索任务",
            placeholder: "搜索标题、备注或项目…",
            onChange: function (event) { store.setSearch(event.target.value); }
          })].concat(FILTERS.map(function (filter) {
            return h("button", {
              key: filter.id,
              type: "button",
              className: "dsh-agenda-filter",
              "data-agenda-filter": filter.id,
              "aria-pressed": state.filter === filter.id,
              onClick: function () { store.setFilter(filter.id); }
            }, filter.label);
          }))),
        createForm(store, state),
        h("div", { key: "body", className: "dsh-agenda-body" }, [
          statusRegion(state),
          loadFrame(store, state, function () {
            return taskList(store, visible, "暂无任务。", { state: state });
          })
        ])
      ]);
    }

    // ── Calendar ────────────────────────────────────────────────────────────

    var WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

    function monthStart(month) {
      var parts = month.split("-");
      return new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    }

    function shiftMonth(month, amount) {
      var start = monthStart(month);
      start.setMonth(start.getMonth() + amount);
      return dateKey(start).slice(0, 7);
    }

    /**
     * A fixed 6x7 Monday-first grid, so the calendar never reflows between
     * months. getDay() returns 0 for Sunday, which is shifted to 6 here.
     */
    function monthGrid(month) {
      var start = monthStart(month);
      var offset = (start.getDay() + 6) % 7;
      var cursor = new Date(start.getFullYear(), start.getMonth(), 1 - offset);
      var cells = [];
      for (var index = 0; index < 42; index += 1) {
        cells.push({
          key: dateKey(cursor),
          inMonth: cursor.getMonth() === start.getMonth()
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      return cells;
    }

    function countsByDate(state) {
      var counts = {};
      activeTasks(state).forEach(function (record) {
        if (!record.dueDate) return;
        if (!counts[record.dueDate]) counts[record.dueDate] = { open: 0, completed: 0 };
        if (record.status === "completed") counts[record.dueDate].completed += 1;
        else counts[record.dueDate].open += 1;
      });
      return counts;
    }

    function CalendarView(store, state) {
      var today = todayKey();
      var month = state.visibleMonth;
      var counts = countsByDate(state);
      var selected = state.selectedDate;
      var dayTasks = sortTasks(activeTasks(state).filter(function (record) {
        return record.dueDate === selected;
      }));

      var header = h("div", { key: "header", className: "dsh-agenda-bar" }, [
        iconButton({
          key: "previous",
          action: "previous-month",
          label: "上个月",
          icon: ICONS.previous,
          onClick: function () { store.setVisibleMonth(shiftMonth(month, -1)); }
        }),
        h("strong", { key: "label", "data-agenda-month": month }, month),
        iconButton({
          key: "next",
          action: "next-month",
          label: "下个月",
          icon: ICONS.next,
          onClick: function () { store.setVisibleMonth(shiftMonth(month, 1)); }
        }),
        h("button", {
          key: "today",
          type: "button",
          className: "dsh-agenda-filter",
          "data-agenda-action": "today",
          onClick: function () { store.selectDate(todayKey()); }
        }, "今天")
      ]);

      var grid = h("div", { key: "grid", className: "dsh-agenda-grid", role: "grid", "aria-label": month + " 月历" },
        WEEKDAYS.map(function (weekday, index) {
          return h("div", {
            key: "weekday-" + index,
            className: "dsh-agenda-weekday",
            "data-agenda-weekday": String(index + 1)
          }, weekday);
        }).concat(monthGrid(month).map(function (cell) {
          var count = counts[cell.key] || { open: 0, completed: 0 };
          var summary = count.open + " 个待办，" + count.completed + " 个已完成";
          return h("button", {
            key: cell.key,
            type: "button",
            className: "dsh-agenda-day",
            "data-agenda-day": cell.key,
            "data-outside": cell.inMonth ? "false" : "true",
            "data-today": cell.key === today ? "true" : "false",
            "aria-pressed": cell.key === selected,
            "aria-label": cell.key + "，" + summary,
            onClick: function () { store.selectDate(cell.key); }
          }, [
            h("span", { key: "number", className: "dsh-agenda-daynumber" }, String(Number(cell.key.slice(8)))),
            count.open + count.completed > 0
              ? h("span", { key: "count", className: "dsh-agenda-daycount" },
                String(count.open) + " 待办 / " + String(count.completed) + " 完成")
              : null
          ]);
        })));

      var pane = h("div", { key: "pane", "data-agenda-day-pane": selected }, [
        h("h2", { key: "title", style: { margin: "0 0 8px", fontSize: 14 } }, selected),
        taskList(store, dayTasks, "这一天暂无安排。", { state: state })
      ]);

      return h("div", { className: "dsh-agenda-root", "data-agenda-view": "calendar" }, [
        header,
        createForm(store, state, selected),
        h("div", { key: "body", className: "dsh-agenda-body" }, [
          statusRegion(state),
          loadFrame(store, state, function () {
            return h("div", { className: "dsh-agenda-columns" }, [grid, pane]);
          })
        ])
      ]);
    }

    // ── Review ──────────────────────────────────────────────────────────────
    //
    // A derived read model over the same records: no review table, snapshot or
    // second storage unit. Buckets are disjoint by construction — today has its
    // own bucket, so the seven-day window opens tomorrow.

    var RECENT_COMPLETION_DAYS = 7;

    var BUCKETS = [
      { id: "overdue", label: "已逾期", empty: "没有逾期任务。" },
      { id: "today", label: "今天", empty: "今天暂无安排。" },
      { id: "next-seven-days", label: "未来七天", empty: "未来七天暂无安排。" },
      { id: "unscheduled", label: "未安排", empty: "暂无未安排任务。" },
      { id: "recently-completed", label: "最近完成", empty: "最近七天暂无完成记录。" }
    ];

    function reviewBuckets(state) {
      var today = todayKey();
      var tomorrow = addDays(today, 1);
      var horizon = addDays(today, RECENT_COMPLETION_DAYS);
      // A completion is "recent" by local calendar day, not by a rolling
      // millisecond window, so a task finished late yesterday still counts.
      var earliestCompletion = addDays(today, -(RECENT_COMPLETION_DAYS - 1));

      var result = {
        overdue: [], today: [], "next-seven-days": [], unscheduled: [], "recently-completed": []
      };

      activeTasks(state).forEach(function (record) {
        if (record.status === "completed") {
          if (record.completedAt && dateKey(new Date(record.completedAt)) >= earliestCompletion) {
            result["recently-completed"].push(record);
          }
          return;
        }
        if (!record.dueDate) {
          result.unscheduled.push(record);
          return;
        }
        if (record.dueDate < today) result.overdue.push(record);
        else if (record.dueDate === today) result.today.push(record);
        else if (record.dueDate >= tomorrow && record.dueDate <= horizon) result["next-seven-days"].push(record);
      });

      result["recently-completed"].sort(function (left, right) {
        return (right.completedAt || 0) - (left.completedAt || 0);
      });
      return result;
    }

    function ReviewView(store, state) {
      var buckets = reviewBuckets(state);

      var summary = h("div", { key: "summary", className: "dsh-agenda-bar" },
        BUCKETS.map(function (bucket) {
          var count = buckets[bucket.id].length;
          return h("span", {
            key: bucket.id,
            className: "dsh-agenda-filter",
            "data-agenda-summary": bucket.id,
            "aria-label": bucket.label + "：" + count + " 项"
          }, bucket.label + " " + count);
        }));

      return h("div", { className: "dsh-agenda-root", "data-agenda-view": "review" }, [
        summary,
        h("div", { key: "body", className: "dsh-agenda-body" }, [
          statusRegion(state),
          loadFrame(store, state, function () {
            return h("div", null, BUCKETS.map(function (bucket) {
              return h("section", {
                key: bucket.id,
                className: "dsh-agenda-section",
                "data-agenda-bucket": bucket.id
              }, [
                h("h2", { key: "title" }, bucket.label + "（" + buckets[bucket.id].length + "）"),
                taskList(store, sortTasks(buckets[bucket.id]), bucket.empty, { state: state })
              ]);
            }));
          })
        ])
      ]);
    }

    // ── Archive ─────────────────────────────────────────────────────────────

    function ArchiveView(store, state) {
      var archived = state.tasks.filter(function (record) {
        return record.status === "archived";
      }).sort(function (left, right) {
        return (right.archivedAt || 0) - (left.archivedAt || 0);
      });

      return h("div", { className: "dsh-agenda-root", "data-agenda-view": "archive" }, [
        h("div", { key: "bar", className: "dsh-agenda-bar" }, [
          h("strong", { key: "title" }, "存档"),
          h("span", { key: "count", className: "dsh-agenda-meta" }, archived.length + " 项")
        ]),
        h("div", { key: "body", className: "dsh-agenda-body" }, [
          statusRegion(state),
          loadFrame(store, state, function () {
            // Archiving is reversible, so restore is the only action here and no
            // destructive confirmation is needed. There is no delete route.
            return taskList(store, archived, "暂无存档任务。", { state: state });
          })
        ])
      ]);
    }

    function AgendaSurface(props) {
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
      if (props.view === "tasks") return TasksView(store, state);
      if (props.view === "calendar") return CalendarView(store, state);
      if (props.view === "review") return ReviewView(store, state);
      if (props.view === "archive") return ArchiveView(store, state);
      return h("div", { className: "dsh-agenda-root", "data-agenda-view": props.view });
    }

    // ── Destinations ────────────────────────────────────────────────────────

    var DESTINATIONS = [
      { id: "agenda.calendar", order: 10, label: "Calendar", localized: "日历", icon: ICONS.calendar, view: "calendar" },
      { id: "agenda.tasks", order: 20, label: "Tasks", localized: "待办事项", icon: ICONS.tasks, view: "tasks" },
      { id: "agenda.review", order: 30, label: "Review", localized: "回顾", icon: ICONS.review, view: "review" },
      { id: "agenda.archive", order: 40, label: "Archive", localized: "存档", icon: ICONS.archive, view: "archive" }
    ];

    function renderView(store, view) {
      return function AgendaDestination(destinationProps) {
        return h(AgendaSurface, {
          store: store,
          view: view,
          destinationId: destinationProps && destinationProps.destinationId
        });
      };
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

    function bindWorkOsDestinations(gate, store) {
      var disposers = [];
      var queueEntry = null;
      var timerId = null;

      function releaseDestinations() {
        var pending = disposers.splice(0);
        for (var index = 0; index < pending.length; index += 1) {
          try {
            pending[index]();
          } catch (error) {
            // A failing disposer must not prevent the others running.
          }
        }
      }

      function adopt(api) {
        if (gate.isDecided() || !api || typeof api.registerDestination !== "function") return;
        var registered = true;
        for (var index = 0; index < DESTINATIONS.length; index += 1) {
          var destination = DESTINATIONS[index];
          try {
            disposers.push(api.registerDestination({
              id: destination.id,
              sectionId: "agenda",
              label: destination.label,
              localized: destination.localized,
              order: destination.order,
              icon: destination.icon,
              render: renderView(store, destination.view)
            }));
          } catch (error) {
            // All or nothing: a partially published section would leave dead
            // entries in the rail, so release what succeeded and fall back.
            registered = false;
            break;
          }
        }
        if (!registered) releaseDestinations();
        stopWaiting();
        gate.decide(registered);
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
        releaseDestinations();
      };
    }

    // ── Standalone surface ──────────────────────────────────────────────────

    function createStandaloneStore() {
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
        toggle: function () {
          setOpen(!open);
        },
        setOpen: setOpen,
        subscribe: function (fn) {
          listeners.push(fn);
          return function () {
            var index = listeners.indexOf(fn);
            if (index >= 0) listeners.splice(index, 1);
          };
        },
        bindSurface: function (mount) {
          var dispose = null;
          function sync() {
            if (open && !dispose) dispose = mount();
            else if (!open && dispose) {
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

    function AgendaNavButton(surface) {
      return function AgendaNav() {
        var opened = React.useState(surface.isOpen());
        var open = opened[0];
        var setOpen = opened[1];
        React.useEffect(function () {
          return surface.subscribe(function () { setOpen(surface.isOpen()); });
        }, []);
        return h("button", {
          type: "button",
          title: "Agenda | 时间管理",
          "aria-label": "Agenda | 时间管理",
          "aria-pressed": open,
          onClick: function () { surface.toggle(); }
        }, h(ICONS.tasks, { size: 16, "aria-hidden": true }));
      };
    }

    function apply(ctx) {
      var slots = ctx.slots;
      if (!slots) return;

      var gate = createModeGate();
      var store = createAgendaStore();
      var surface = createStandaloneStore();
      var releaseStyles = ensureStyles();

      slots.inject("sidebar.footer.action", function () {
        return bindWhenStandalone(gate, function () {
          return slots.register(
            { name: "sidebar.footer.action", id: "agenda", order: 110, label: function () { return "Agenda"; } },
            AgendaNavButton(surface)
          );
        });
      });

      slots.inject("conversation", function () {
        // The Work OS handshake lives here so its cleanup is owned by the same
        // slot lifecycle that owns the standalone centre surface.
        var releaseWorkOs = bindWorkOsDestinations(gate, store);
        var releaseStandalone = bindWhenStandalone(gate, function () {
          return surface.bindSurface(function () {
            return slots.register(
              { name: "conversation", priority: -100, label: function () { return "Agenda"; } },
              function AgendaStandaloneSurface() {
                return h(AgendaSurface, { store: store, view: "tasks" });
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
