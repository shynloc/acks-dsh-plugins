/**
 * dsh-theme-warm browser half — 自定义主题插件示例。
 *
 * 演示两条官方主题扩展点：
 *
 *  1) ctx.theme.register()  注册一个名为 `warm` 的第三方主题（浅色暖色调），
 *     然后通过 ctx.theme.setTheme("warm") 切换（下方外观行提供入口）。
 *
 *  2) 复刻 @deepseek-ai/dsh-client-ui-theme 的外观选择行（AppearanceRow）：
 *     注入 `settings.general.item` 槽，在 通用设置 里提供
 *     浅色 / 深色 / 跟随系统 / 暖色 四个选项，选择状态实时跟随
 *     `theme/change` 事件（store 同步，与官方行同款写法）。
 *
 * 另一条扩展点（本文件未启用，见下方 WARM_TINT 注释块）：
 *  3) ctx.theme.overrideTokens(source, tokens)  给当前激活主题叠一层
 *     token 覆盖（深浅两套值、永远生效、与偏好选择无关）——适合做
 *     “始终开启的护眼暖色滤镜”。
 *
 * 上游设计边界（dsh-client-ui-theme README 原话）：
 *  - “Third-party themes are an extension point, not a product”；
 *  - 第三方主题 id 是进程内扩展：刷新后回到内置偏好（默认跟随系统），
 *    不写入 ui-theme 的 settings schema（只接受 light/dark/system）。
 *    持久化升级路径见 README「持久化」一节（自定义 settings 命名空间）。
 *
 * 手写格式说明：这是 dsh.client 包的浏览器半边，格式为
 * window.__ModuleLoader__.load({ id, factory })，factory 收到的 require
 * 解析共享模块表（react、@deepseek-ai/* 运行时等），无需任何构建工具链。
 * 与 /workspace/mimo-vision-plugin/lib/client.js 完全同构。
 */
window.__ModuleLoader__.load({
  id: "dsh-theme-warm",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var h = React.createElement;
    var _runtime = require("@deepseek-ai/dsh-client-runtime/client");
    var _primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    var IconLight = _primitives.IconLightOutline16;
    var IconDark = _primitives.IconDarkOutline16;
    var IconSystem = _primitives.IconFollowsystemOutline16;

    /** 注册的主题 id（`system` 是内置偏好，不可用作注册 id）。 */
    var THEME_ID = "warm";
    /** 外观行文案命名空间（settings.theme-warm，与 ui-theme 的 settings.theme 互不冲突）。 */
    var NS = "settings.theme-warm";

    // ── 暖色主题 token（register 的主题用单值；colorScheme: "light"）────────
    // 只覆盖语义层别名变量（--dsw-alias-* / --dsw-specific-*），未覆盖的
    // token 继续用基础色板。官方明确“没有完整性校验”，部分覆盖是合法的。
    var WARM_TOKENS = {
      "--dsw-alias-bg-base": "#FBF5E9",
      "--dsw-alias-bg-layer-1": "#F6EDDC",
      "--dsw-alias-bg-layer-2": "#F0E4CC",
      "--dsw-alias-bg-layer-3": "#EADCC0",
      "--dsw-alias-bg-overlay": "#D6C7A8",
      "--dsw-alias-border-l1": "rgba(122, 92, 46, 0.10)",
      "--dsw-alias-border-l2": "rgba(122, 92, 46, 0.18)",
      "--dsw-alias-label-primary": "#3B3226",
      "--dsw-alias-label-secondary": "#6B5D47",
      "--dsw-alias-label-tertiary": "#8C7B60",
      "--dsw-alias-brand-primary": "#A9714B",
      "--dsw-alias-state-error-primary": "#C0392B",
      "--dsw-alias-state-success-primary": "#2E7D5B",
      "--dsw-alias-state-warn-primary": "#B97A2E",
      "--dsw-specific-sidebar-fill": "#F3EAD6"
    };

    // ── 备选扩展点（默认关闭）：始终生效的暖色覆盖层，深浅两套 ────────────
    // 启用方式：把 apply() 里 `theme.register(...)` 那段换成
    //   theme.overrideTokens("dsh-theme-warm.tint", WARM_TINT)
    // 它会与当前激活主题（浅/深都行）叠加，刷新后依然生效（覆盖层随插件加载重放）。
    // var WARM_TINT = {
    //   "--dsw-alias-bg-base":     { light: "#FBF5E9", dark: "#191511" },
    //   "--dsw-alias-bg-layer-1":  { light: "#F6EDDC", dark: "#211B15" },
    //   "--dsw-alias-bg-layer-2":  { light: "#F0E4CC", dark: "#282117" },
    //   "--dsw-alias-label-primary":   { light: "#3B3226", dark: "#EDE3D2" },
    //   "--dsw-alias-label-secondary": { light: "#6B5D47", dark: "#C4B49A" },
    //   "--dsw-alias-label-tertiary":  { light: "#8C7B60", dark: "#9C8B72" },
    //   "--dsw-alias-brand-primary":   { light: "#A9714B", dark: "#D8A25E" },
    //   "--dsw-alias-border-l1":   { light: "rgba(122,92,46,0.10)", dark: "rgba(255,220,160,0.07)" },
    //   "--dsw-alias-border-l2":   { light: "rgba(122,92,46,0.18)", dark: "rgba(255,220,160,0.14)" },
    //   "--dsw-specific-sidebar-fill": { light: "#F3EAD6", dark: "#1D1812" }
    // };

    // ── 外观行的选择 store（复刻 ui-theme 的 settings-store 写法）───────────
    function createRowStore() {
      return _runtime.defineStore({
        init: () => ({ preference: "system", revision: -1 }),
        actions: {
          sync(d, preference, revision) {
            if (revision <= d.revision) return;
            d.preference = preference;
            d.revision = revision;
          }
        }
      });
    }

    // ── 外观行组件：浅色 / 深色 / 跟随系统 / 暖色 四个 cube ──────────────────
    // 样式逐条对照官方 AppearanceRow.module.css（themeCube / selected）。
    var groupStyle = {
      borderBottom: "1px solid var(--dsw-alias-border-l2)",
      flexDirection: "column",
      gap: 8,
      padding: "16px 0",
      display: "flex"
    };
    var titleStyle = {
      color: "var(--dsw-alias-label-primary)",
      fontSize: 14,
      fontWeight: 400,
      lineHeight: "22px"
    };
    var cubeRowStyle = {
      flexWrap: "wrap",
      alignItems: "stretch",
      gap: 8,
      display: "flex"
    };
    var cubeStyle = {
      boxSizing: "border-box",
      border: "1px solid var(--dsw-alias-border-l2)",
      font: "inherit",
      color: "var(--dsw-alias-label-primary)",
      cursor: "pointer",
      background: "0 0",
      borderRadius: 16,
      flexDirection: "column",
      flex: "180px",
      justifyContent: "center",
      alignItems: "center",
      gap: 4,
      padding: "20px 32px",
      fontSize: 14,
      lineHeight: "22px",
      display: "flex"
    };
    var cubeSelectedStyle = {
      background: "var(--dsw-alias-bg-module-platform)",
      borderColor: "var(--dsw-static-neutral-bluish-400)"
    };

    /** 暖色 cube 的图标：一个暖色渐变圆点（官方没有对应图标，自绘一个）。 */
    function WarmDot() {
      return h("span", {
        style: {
          width: 16,
          height: 16,
          borderRadius: 8,
          display: "inline-block",
          background: "linear-gradient(135deg, #F0D9A8 0%, #C08A4E 100%)"
        }
      });
    }

    var CUBES = [
      { id: "light", labelKey: "appearance.light", Icon: IconLight },
      { id: "dark", labelKey: "appearance.dark", Icon: IconDark },
      { id: "system", labelKey: "appearance.system", Icon: IconSystem },
      { id: THEME_ID, labelKey: "appearance.warm", Icon: null }
    ];

    function AppearanceRow(props) {
      var t = props.t;
      var useStore = props.useStore;
      var setTheme = props.setTheme;
      var preference = useStore(function (s) { return s.preference; });
      return h("div", { style: groupStyle },
        h("div", { style: titleStyle }, t("appearance.title")),
        h("div", { style: cubeRowStyle }, CUBES.map(function (cube) {
          var selected = preference === cube.id;
          var style = Object.assign({}, cubeStyle, selected ? cubeSelectedStyle : {});
          return h("button", {
            key: cube.id,
            type: "button",
            style: style,
            "aria-pressed": selected,
            onClick: function () { setTheme(cube.id); }
          }, cube.Icon ? h(cube.Icon, {}) : h(WarmDot, {}), t(cube.labelKey));
        }))
      );
    }

    // ── 文案（zh 为键源，en 补齐，与官方行同一做法）────────────────────────
    var zh = {
      "appearance.title": "暖色主题",
      "appearance.light": "浅色",
      "appearance.dark": "深色",
      "appearance.system": "跟随系统",
      "appearance.warm": "暖色"
    };
    var en = {
      "appearance.title": "Warm Theme",
      "appearance.light": "Light",
      "appearance.dark": "Dark",
      "appearance.system": "System",
      "appearance.warm": "Warm"
    };

    // ── 插件入口 ─────────────────────────────────────────────────────────────
    function apply(ctx) {
      var theme = ctx.theme;

      // 1) 注册第三方主题（返回 disposer；若激活中主题被卸载会回退到默认偏好）
      var disposeTheme = theme.register({
        id: THEME_ID,
        colorScheme: "light",
        tokens: WARM_TOKENS
      });

      // 2) 外观选择行：注册到 settings.general.item 槽（官方“外观”行 id=appearance
      //    order=10，本行 id=appearance-warm order=20，排在它下面）。
      var store = createRowStore();
      var bound;
      function sync(snapshot) {
        if (bound) bound.sync(snapshot.preference, snapshot.revision);
      }
      var off = ctx.on("theme/change", sync);
      ctx.slots.inject("settings.general.item", function () {
        return ctx.slots.register({
          name: "settings.general.item",
          id: "appearance-warm",
          order: 20,
          store: store,
          locale: NS,
          inject: function (actions) {
            bound = actions;
            sync(theme.getTheme());
            return { setTheme: function (id) { theme.setTheme(id); } };
          }
        }, AppearanceRow);
      });

      // 3) 文案注册
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "dsh-theme-warm: appearance row dictionaries");

      // 4) 卸载清理：事件监听 + 主题注册（卸载时自动回退）
      ctx.effect(function () {
        return function () {
          off();
          disposeTheme();
        };
      }, "dsh-theme-warm: cleanup");
    }

    exports.apply = apply;
    exports.inject = ["slots", "theme", "locale"];
    return module.exports;
  }
});
