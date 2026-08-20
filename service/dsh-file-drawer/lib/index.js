/**
 * 文件管理面板抽屉插件 - 服务端
 *
 * 主要逻辑在客户端，服务端仅做注册
 * 文件面板服务由独立的 server.js 提供
 */

const name = "dsh-file-panel";
const inject = [];

function apply(ctx) {
  // 服务端暂无额外逻辑
  // 文件面板 API 由独立服务 (port 3200) 提供
  ctx.logger?.info?.("dsh-file-panel plugin loaded (client-side drawer)");
}

export { apply, inject, name };
