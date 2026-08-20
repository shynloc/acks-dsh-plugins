/**
 * 文件管理面板抽屉插件 - DSH File Panel Drawer
 *
 * 在 DSH 顶部导航栏（对话、轨迹 之后）添加「文件」按钮
 * 点击后从右侧滑出文件管理面板
 */
window.__ModuleLoader__.load({
  id: "dsh-file-drawer",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    // ── 配置 ──
    var PANEL_WIDTH = 420;
    // ⬇️ 修改为你自己的文件面板地址（本地 / 反代 / 域名均可）
    var PANEL_URL = "http://localhost:8080";
    var ANIMATION_DURATION = 300;

    // ── 注入样式 ──
    var style = document.createElement("style");
    style.textContent = [
      /* 导航栏按钮 */
      "#dsh-file-nav-btn {",
      "  display: inline-flex;",
      "  align-items: center;",
      "  gap: 6px;",
      "  padding: 6px 14px;",
      "  border-radius: 8px;",
      "  border: none;",
      "  background: transparent;",
      "  color: var(--dsw-alias-label-secondary, #666);",
      "  cursor: pointer;",
      "  font-size: 14px;",
      "  font-weight: 500;",
      "  font-family: inherit;",
      "  transition: all 0.15s ease;",
      "  user-select: none;",
      "  -webkit-user-select: none;",
      "  white-space: nowrap;",
      "}",
      "#dsh-file-nav-btn:hover {",
      "  background: var(--dsw-alias-bg-layer-2, #f0f0f0);",
      "  color: var(--dsw-alias-label-primary, #1a1a1a);",
      "}",
      "#dsh-file-nav-btn.is-active {",
      "  background: var(--dsw-alias-brand-primary, #4a6cf7);",
      "  color: #fff;",
      "}",
      "",
      /* 背景遮罩 */
      "#dsh-file-drawer-backdrop {",
      "  position: fixed;",
      "  top: 0; left: 0; right: 0; bottom: 0;",
      "  background: rgba(0,0,0,0.2);",
      "  z-index: 9997;",
      "  opacity: 0;",
      "  pointer-events: none;",
      "  transition: opacity " + ANIMATION_DURATION + "ms ease;",
      "}",
      "#dsh-file-drawer-backdrop.is-open {",
      "  opacity: 1;",
      "  pointer-events: auto;",
      "}",
      "",
      /* 抽屉面板 */
      "#dsh-file-drawer-panel {",
      "  position: fixed;",
      "  top: 0; right: 0; bottom: 0;",
      "  width: " + PANEL_WIDTH + "px;",
      "  z-index: 9999;",
      "  transform: translateX(100%);",
      "  transition: transform " + ANIMATION_DURATION + "ms cubic-bezier(0.4, 0, 0.2, 1);",
      "  display: flex;",
      "  flex-direction: column;",
      "  background: var(--dsw-alias-bg-layer-1, #fff);",
      "  border-left: 1px solid var(--dsw-alias-border-l1, #e0e0e0);",
      "  box-shadow: -4px 0 24px rgba(0,0,0,0.12);",
      "}",
      "#dsh-file-drawer-panel.is-open {",
      "  transform: translateX(0);",
      "}",
      "",
      /* 头部 */
      "#dsh-file-drawer-header {",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: space-between;",
      "  padding: 12px 16px;",
      "  border-bottom: 1px solid var(--dsw-alias-border-l1, #e0e0e0);",
      "  background: var(--dsw-alias-bg-layer-2, #f8f8f8);",
      "  flex-shrink: 0;",
      "}",
      "#dsh-file-drawer-title {",
      "  display: flex;",
      "  align-items: center;",
      "  gap: 8px;",
      "  font-size: 14px;",
      "  font-weight: 600;",
      "  color: var(--dsw-alias-label-primary, #1a1a1a);",
      "}",
      "#dsh-file-drawer-close {",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  width: 28px;",
      "  height: 28px;",
      "  border-radius: 6px;",
      "  border: none;",
      "  background: transparent;",
      "  color: var(--dsw-alias-label-secondary, #666);",
      "  cursor: pointer;",
      "  font-size: 16px;",
      "  transition: background 0.15s;",
      "}",
      "#dsh-file-drawer-close:hover {",
      "  background: var(--dsw-alias-bg-layer-3, #eee);",
      "}",
      "",
      /* iframe 容器 */
      "#dsh-file-drawer-iframe-wrap {",
      "  flex: 1;",
      "  overflow: hidden;",
      "  position: relative;",
      "}",
      "#dsh-file-drawer-iframe {",
      "  width: 100%;",
      "  height: 100%;",
      "  border: none;",
      "  background: #0d1117;",
      "}",
    ].join("\n");
    document.head.appendChild(style);

    // ── 创建抽屉 DOM ──
    // 背景遮罩
    var backdrop = document.createElement("div");
    backdrop.id = "dsh-file-drawer-backdrop";

    // 抽屉面板
    var drawer = document.createElement("div");
    drawer.id = "dsh-file-drawer-panel";

    // 头部
    var header = document.createElement("div");
    header.id = "dsh-file-drawer-header";

    var headerTitle = document.createElement("div");
    headerTitle.id = "dsh-file-drawer-title";
    headerTitle.innerHTML = '<span>🦊</span><span>文件管理面板</span>';

    var closeBtn = document.createElement("button");
    closeBtn.id = "dsh-file-drawer-close";
    closeBtn.textContent = "✕";
    closeBtn.title = "关闭 (Escape)";

    header.appendChild(headerTitle);
    header.appendChild(closeBtn);

    // iframe 容器
    var iframeWrap = document.createElement("div");
    iframeWrap.id = "dsh-file-drawer-iframe-wrap";

    var iframe = document.createElement("iframe");
    iframe.id = "dsh-file-drawer-iframe";
    iframe.title = "文件管理面板";
    iframe.setAttribute("sandbox", "allow-same-origin allow-scripts allow-popups allow-forms");
    iframe.setAttribute("loading", "lazy");
    iframeWrap.appendChild(iframe);

    drawer.appendChild(header);
    drawer.appendChild(iframeWrap);

    // 添加到 DOM
    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);

    // ── 状态 ──
    var isOpen = false;
    var isLoaded = false;
    var navBtn = null;

    // ── 动作 ──
    function openDrawer() {
      isOpen = true;
      backdrop.classList.add("is-open");
      drawer.classList.add("is-open");
      if (navBtn) navBtn.classList.add("is-active");

      // 延迟加载 iframe
      if (!isLoaded) {
        iframe.src = PANEL_URL;
        isLoaded = true;
      }
    }

    function closeDrawer() {
      isOpen = false;
      backdrop.classList.remove("is-open");
      drawer.classList.remove("is-open");
      if (navBtn) navBtn.classList.remove("is-active");
    }

    function toggleDrawer() {
      if (isOpen) {
        closeDrawer();
      } else {
        openDrawer();
      }
    }

    // ── 事件绑定 ──
    closeBtn.addEventListener("click", closeDrawer);
    backdrop.addEventListener("click", closeDrawer);

    // Escape 键关闭
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape" && isOpen) {
        closeDrawer();
      }
    });

    // ── 查找导航栏并添加按钮 ──
    function findNavAndAddButton() {
      // 查找包含"轨迹"文本的按钮/链接
      var allElements = document.querySelectorAll("button, a, [role='button'], span, div");
      var targetBtn = null;

      for (var i = 0; i < allElements.length; i++) {
        var el = allElements[i];
        var text = el.textContent.trim();
        // 查找"轨迹"按钮（通常在"对话"之后）
        if (text === "轨迹" || text === "历史" || text === "History" || text === "Tracks") {
          // 确保是导航栏中的元素（不是页面内容）
          var parent = el.closest("nav, header, [class*='nav'], [class*='header'], [class*='tab']");
          if (parent || el.offsetHeight < 50) {
            targetBtn = el;
            break;
          }
        }
      }

      if (targetBtn && !document.getElementById("dsh-file-nav-btn")) {
        // 创建文件按钮
        navBtn = document.createElement("button");
        navBtn.id = "dsh-file-nav-btn";
        navBtn.innerHTML = '<span>📂</span><span>文件</span>';
        navBtn.title = "文件管理面板";
        navBtn.addEventListener("click", toggleDrawer);

        // 插入到目标按钮之后
        if (targetBtn.nextSibling) {
          targetBtn.parentNode.insertBefore(navBtn, targetBtn.nextSibling);
        } else {
          targetBtn.parentNode.appendChild(navBtn);
        }

        return true;
      }
      return false;
    }

    // 尝试立即添加，如果失败则等待 DOM 更新
    if (!findNavAndAddButton()) {
      // 使用 MutationObserver 监听 DOM 变化
      var observer = new MutationObserver(function(mutations) {
        if (findNavAndAddButton()) {
          observer.disconnect();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      // 10秒后停止尝试
      setTimeout(function() {
        observer.disconnect();
      }, 10000);
    }

    // ── 插件入口 ──
    function apply(ctx) {
      ctx.effect(function() {
        return function() {
          // 清理
          backdrop.remove();
          drawer.remove();
          style.remove();
          if (navBtn) navBtn.remove();
        };
      }, "dsh-file-drawer: cleanup");
    }

    exports.apply = apply;
    exports.inject = [];
    return module.exports;
  }
});
