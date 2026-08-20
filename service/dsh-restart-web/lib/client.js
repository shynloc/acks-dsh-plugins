/**
 * dsh-restart-web browser half — 设置页里的「重启 Web 服务」按钮。
 *
 * 交互：两步确认（第一次点击进入确认态，第二次触发），触发后按钮置为
 * 「正在重启…」。fetch 用 keepalive，即使页面随后断开请求也能送达。
 * 重启是进程级动作：页面必然断开，等监督者把服务拉起后刷新即可，
 * 新安装的插件（比如 dsh-theme-warm 的暖色主题）随之生效。
 *
 * 与 dsh-theme-warm 同构：settings.general.item 槽 + locale 注册，
 * 手写 __ModuleLoader__.load 格式，无构建。
 */
window.__ModuleLoader__.load({
  id: "dsh-restart-web",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var h = React.createElement;

    var NS = "settings.restart-web";
    var RESTART_PATH = "/api/restart-web";

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
    var captionStyle = {
      color: "var(--dsw-alias-label-tertiary)",
      fontSize: 12,
      lineHeight: "18px",
      margin: 0
    };
    var buttonStyle = {
      boxSizing: "border-box",
      height: 32,
      padding: "0 14px",
      fontSize: 13,
      borderRadius: 8,
      border: "1px solid var(--dsw-alias-state-error-primary)",
      background: "transparent",
      color: "var(--dsw-alias-state-error-primary)",
      cursor: "pointer",
      font: "inherit",
      alignSelf: "flex-start"
    };
    var buttonArmedStyle = {
      background: "var(--dsw-alias-state-error-primary)",
      color: "#fff",
      border: "none"
    };

    /** phase: idle → armed（再点一次确认）→ restarting → sent（已触发） */
    function RestartRow(props) {
      var t = props.t;
      var state = React.useState("idle");
      var phase = state[0];
      var setPhase = state[1];
      function onClick() {
        if (phase === "idle") {
          setPhase("armed");
          return;
        }
        if (phase === "armed") {
          setPhase("restarting");
          fetch(RESTART_PATH, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
            keepalive: true
          }).then(function () {
            setPhase("sent");
          }).catch(function () {
            // 服务端可能来不及回 200 就断开连接——同样视为已触发
            setPhase("sent");
          });
        }
      }
      var label = phase === "idle" ? t("restart")
        : phase === "armed" ? t("confirm")
        : phase === "restarting" ? t("restarting")
        : t("sent");
      var disabled = phase === "restarting" || phase === "sent";
      return h("div", { style: groupStyle },
        h("div", { style: titleStyle }, t("title")),
        h("p", { style: captionStyle }, t("caption")),
        h("button", {
          type: "button",
          onClick: onClick,
          disabled: disabled,
          style: Object.assign({}, buttonStyle, phase === "armed" ? buttonArmedStyle : {})
        }, label));
    }

    var zh = {
      "title": "重启 Web 服务",
      "caption": "重启后当前页面会断开，请稍等片刻后刷新重新连接。新安装的插件（如自定义主题）将在重启后加载。若服务没有自动恢复，请手动重新运行 dsh web。",
      "restart": "重启 Web 服务",
      "confirm": "确认重启？再点一次",
      "restarting": "正在重启…",
      "sent": "已触发重启，页面即将断开"
    };
    var en = {
      "title": "Restart Web Service",
      "caption": "The page will disconnect; refresh after a moment. Newly installed plugins (e.g. custom themes) load after the restart. If the service does not come back automatically, start dsh web again.",
      "restart": "Restart Web Service",
      "confirm": "Confirm restart? Click again",
      "restarting": "Restarting…",
      "sent": "Restart triggered — page will disconnect"
    };

    function apply(ctx) {
      ctx.slots.inject("settings.general.item", function () {
        return ctx.slots.register({
          name: "settings.general.item",
          id: "restart-web",
          order: 90,
          locale: NS
        }, RestartRow);
      });
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en });
      }, "dsh-restart-web: row dictionaries");
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale"];
    return module.exports;
  }
});
