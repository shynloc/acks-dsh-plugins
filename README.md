# ACKS DSH Plugins

> 一套开箱即用的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件合集，覆盖 AI Agent 能力扩展、创意视觉、知识管理与服务集成。

<p align="center">
  <img src="https://img.shields.io/badge/plugins-9-blue?style=for-the-badge" alt="plugins">
  <img src="https://img.shields.io/badge/platform-DeepSeek%20Harness-4a6cf7?style=for-the-badge" alt="platform">
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="license">
  <img src="https://img.shields.io/badge/AI%20Agent-2-8b5cf6?style=for-the-badge" alt="ai-agent">
  <img src="https://img.shields.io/badge/Creative-4-f97316?style=for-the-badge" alt="creative">
  <img src="https://img.shields.io/badge/Knowledge-0-6b7280?style=for-the-badge" alt="knowledge">
  <img src="https://img.shields.io/badge/Service-3-10b981?style=for-the-badge" alt="service">
</p>

---

## 📊 Dashboard

| 指标 | 数量 |
|------|:----:|
| **插件总数** | **9** |
| ├─ 🤖 AI Agent | 2 |
| ├─ 🎨 Creative | 4 |
| ├─ 📚 Knowledge | 0 |
| └─ 🔧 Service | 3 |

---

## 🗂️ 分类

| 分类 | 图标 | 说明 | 目录 |
|------|:----:|------|------|
| **AI Agent** | 🤖 | 与 agent 开发、AI 模型使用相关的插件（模型接入、视觉理解、工具集等） | [`ai-agent/`](ai-agent/) |
| **Creative** | 🎨 | 与创意、视觉、内容创作相关的插件（生图、编辑、主题等） | [`creative/`](creative/) |
| **Knowledge** | 📚 | 与知识库、信息管理、任务/项目管理相关的插件 | [`knowledge/`](knowledge/) |
| **Service** | 🔧 | 与服务相关的插件（网站构建、服务器远程、外部服务集成等） | [`service/`](service/) |

---

## 📦 插件列表

### 🤖 AI Agent

#### [mimo-vision](ai-agent/mimo-vision/) — 视觉理解 / OCR / 视频理解

接入小米 MiMo V2.5 多模态模型，为 Harness 增加图片理解、OCR 文字识别、多图比较与视频理解能力。

- **工具**：`analyze_image`（描述/问答/OCR/多图比较）、`analyze_video`（视频理解）
- **来源**：`/workspace` 本地文件或公网 HTTPS URL
- **凭据**：`MIMO_API_KEY` + `MIMO_BASE_URL`（支持按量付费 / Token Plan）

#### [dsh-skill-panel](ai-agent/dsh-skill-panel/) — Skills 面板

在设置页新增 **Skills** 标签页，浏览、搜索并查看已安装的 Agent Skills 内容。

- **功能**：技能列表、名称/描述搜索、展开查看完整技能内容与调用权限
- **来源**：扫描 `~/.dsh/skills/` 与 `~/.agents/skills/` 下的 Markdown 技能文件

---

### 🎨 Creative

#### [dsh-imagegen](creative/dsh-imagegen/) — 生图插件（OpenAI Images）

注册 `generate_image` 工具，调用 OpenAI Images API（默认 `gpt-image-2`）生成图片并写入工作区，可在图像模型对话中直接显示。

- **工具**：`generate_image`
- **凭据**：`IMAGEGEN_API_KEY` + `IMAGEGEN_BASE_URL`

#### [dsh-xai-imagine](creative/dsh-xai-imagine/) — xAI 生图 / 编辑

注册 `generate_xai_image` 与 `edit_xai_image` 工具，直连 xAI 官方 `api.x.ai`（Grok Imagine Image 2.0），不经过中转站。

- **工具**：`generate_xai_image`（文生图，1–4 张）、`edit_xai_image`（图生图/编辑）
- **凭据**：`XAI_API_KEY`

#### [dsh-theme-warm](creative/dsh-theme-warm/) — 暖色护眼主题

注册一个暖色（护眼）主题，并在通用设置里复刻官方外观选择行（浅色 / 深色 / 跟随系统 / 暖色）。

- **无依赖**：纯浏览器能力，无需构建工具链

#### [dsh-theme-jintao-retro](creative/dsh-theme-jintao-retro/) — 复古硬件皮肤主题

Native 组件的复古掌机硬件皮肤，在不修改上游 DSH 包的前提下实现象牙色控制台外观。

- **特性**：独立栅格资源、凸起/按下状态、原生可点击节点保留

---

### 🔧 Service

#### [dsh-github](service/dsh-github/) — GitHub 集成

注册 33 个 `github_*` 工具，直连 `api.github.com`，覆盖仓库、Issue、PR、文件、Release、搜索与 Git 数据的完整读写能力。

- **能力**：创建公开/私有仓库、读写文件（自动 base64）、发 Release、管理 Issue/PR、代码搜索
- **凭据**：`GITHUB_TOKEN`（Personal Access Token）+ 可选 `GITHUB_DEFAULT_REPO`（默认仓库）

#### [dsh-mcp-panel](service/dsh-mcp-panel/) — MCP 服务器面板

在设置页新增 **MCP** 标签页，配置、查看状态并管理 MCP 服务器。

- **功能**：服务器 CRUD（stdio / streamable-http）、实时连接状态、工具数量统计
- **热重载**：配置写回 `cordis.patch.yml` 后自动热加载，无需手动重启

#### [dsh-restart-web](service/dsh-restart-web/) — 重启 Web 服务

在设置页（通用）提供「重启 Web 服务」按钮，两步确认后优雅退出进程树，由外部监督者（容器 / systemd / pm2）拉起后新插件生效。

- **场景**：安装插件后无需命令行即可重启生效

---

## 🚀 安装与启用

### 前置条件

- 已安装 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh` CLI）
- Node.js 运行时

### 方式一：克隆 + 手动链接（推荐，无需 pnpm）

```bash
# 1. 克隆插件库
git clone https://github.com/shynloc/acks-dsh-plugins.git

# 2. 链接插件到 web profile 的 node_modules（以 dsh-github 为例）
ln -sf "$(pwd)/acks-dsh-plugins/service/dsh-github" \
       "$DSH_HOME/profiles/web/node_modules/dsh-github"

# 3. 在 $DSH_HOME/profiles/web/package.json 中注册
#    dependencies 里添加：  "dsh-github": "file:/绝对路径/acks-dsh-plugins/service/dsh-github"
#    dsh.profile.bundles 里添加： "dsh-github"
```

### 方式二：`dsh plugin` 命令

```bash
dsh plugin --profile web add ./acks-dsh-plugins/service/dsh-github
```

> 部分插件需要第三方 npm 依赖（如 `js-yaml`），若运行报 `Cannot find package`，请按插件目录 README 中的「依赖链接」说明，将依赖 symlink 到插件目录的 `node_modules` 下。

### 启用

安装完成后，二选一重启使其生效：

1. 命令行重启 web profile；
2. 若已安装 [`dsh-restart-web`](service/dsh-restart-web/)，在 **设置 → 通用** 点击「重启 Web 服务」。

### 配置凭据

多数插件需要 API Key，安装后到 **设置 → 插件** 找到对应卡片填入（如 `GITHUB_TOKEN`、`XAI_API_KEY`、`MIMO_API_KEY`）。

---

## 📄 目录结构

```
acks-dsh-plugins/
├── ai-agent/
│   ├── mimo-vision/          # 视觉理解 / OCR / 视频理解
│   └── dsh-skill-panel/      # Skills 面板
├── creative/
│   ├── dsh-imagegen/         # 生图（OpenAI Images）
│   ├── dsh-xai-imagine/      # xAI 生图 / 编辑
│   ├── dsh-theme-warm/       # 暖色护眼主题
│   └── dsh-theme-jintao-retro/ # 复古硬件皮肤主题
├── knowledge/                # （暂无插件）
└── service/
    ├── dsh-github/           # GitHub 集成
    ├── dsh-mcp-panel/        # MCP 服务器面板
    └── dsh-restart-web/      # 重启 Web 服务
```

---

## 📝 License

MIT © [ACKS STUIO](https://jintaoblog.com)
