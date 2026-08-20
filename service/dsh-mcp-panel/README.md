# dsh-mcp-panel

DeepSeek Harness **MCP 服务器面板**：在设置页新增 **MCP** 标签页，配置、查看状态并管理 MCP（Model Context Protocol）服务器。

## 功能

- **服务器 CRUD**：添加 / 编辑 / 删除 MCP 服务器（支持 `stdio` 本地进程与 `streamable-http` 远程 URL 两种传输）
- **实时状态**：连接状态（`connected` / `connecting` / `error`）+ 每台服务器的工具数量统计
- **热重载**：配置写回 web profile 的 `cordis.patch.yml` 后，runProfile 的 HMR 监听器自动热加载 `mcp-client` 实例，无需手动重启
- **REST API**：`GET/POST/PUT/DELETE /api/mcp-panel/servers`

## 安装

```bash
ln -sf "$(pwd)" "$DSH_HOME/profiles/web/node_modules/dsh-mcp-panel"

# 在 $DSH_HOME/profiles/web/package.json 注册
#   dependencies:  "dsh-mcp-panel": "file:/绝对路径/service/dsh-mcp-panel"
#   dsh.profile.bundles: 添加 "dsh-mcp-panel"

# 依赖链接（js-yaml）
mkdir -p node_modules
ln -sf /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/js-yaml node_modules/js-yaml
```

## 使用

1. 重启 web profile
2. 打开 **设置 → MCP**
3. 点击「添加 MCP 服务器」，填入 `serverName`、传输方式与 `command`/`url`
4. 保存后自动热加载，MCP 工具以 `mcp__<serverName>__<toolName>` 形式注册

## 目录结构

```
dsh-mcp-panel/
├── package.json
├── cordis.patch.yml
└── lib/
    ├── index.js    # host 半边：REST API + cordis.patch.yml 读写
    └── client.js   # 浏览器半边：Settings → MCP 面板
```
