# ACKS DSH Plugins

> 一套开箱即用的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件合集，覆盖 AI Agent 能力扩展、创意视觉、知识管理与服务集成。

<p align="center">
  <img src="https://img.shields.io/badge/plugins-20-blue?style=for-the-badge" alt="plugins">
  <img src="https://img.shields.io/badge/platform-DeepSeek%20Harness-4a6cf7?style=for-the-badge" alt="platform">
  <img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="license">
  <img src="https://img.shields.io/badge/AI%20Agent-2-8b5cf6?style=for-the-badge" alt="ai-agent">
  <img src="https://img.shields.io/badge/Creative-6-f97316?style=for-the-badge" alt="creative">
  <img src="https://img.shields.io/badge/Knowledge-7-3b82f6?style=for-the-badge" alt="knowledge">
  <img src="https://img.shields.io/badge/Service-5-10b981?style=for-the-badge" alt="service">
</p>

---

## 📊 Dashboard

| 指标 | 数量 |
|------|:----:|
| **插件总数** | **20** |
| ├─ 🤖 AI Agent | 2 |
| ├─ 🎨 Creative | 6 |
| ├─ 📚 Knowledge | 7 |
| └─ 🔧 Service | 5 |

---

## 🗂️ 分类

| 分类 | 图标 | 说明 | 目录 |
|------|:----:|------|------|
| **AI Agent** | 🤖 | 与 agent 开发、AI 模型使用相关的插件（模型接入、视觉理解、工具集等） | [`ai-agent/`](ai-agent/) |
| **Creative** | 🎨 | 与创意、视觉、内容创作相关的插件（生图、编辑、主题、卡片等） | [`creative/`](creative/) |
| **Knowledge** | 📚 | 与知识库、信息管理、任务/项目管理相关的插件 | [`knowledge/`](knowledge/) |
| **Service** | 🔧 | 与服务相关的插件（文件管理、GitHub、视频、MCP 管理等） | [`service/`](service/) |

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

#### [dsh-card-printer](creative/dsh-card-printer/) — 离线卡片工作室

原生离线卡片设计工具，支持有界文本卡片、有限调色板、SVG 预览和本地 Canvas 导出。无远程资源、无模型调用、无网络请求。

- **特性**：纯本地运行、SVG 矢量预览、Canvas PNG 导出

#### [dsh-watermarker](creative/dsh-watermarker/) — 浏览器本地水印工具

浏览器本地栅格水印工具，图片不离开浏览器，仅数字和文本预设会持久化。

- **特性**：图片不上传、纯本地处理、支持文字/数字水印预设

---

### 📚 Knowledge

#### [dsh-notebook](knowledge/dsh-notebook/) — 笔记本

原生笔记本插件，支持 Markdown 编辑/预览、对话捕获、AI 上下文传递、分类管理、版本历史、全文搜索和模板。

- **特性**：SVG 原生控件、对话一键存入笔记本、编辑/分屏/预览三模式、版本历史（最多 50 快照）

#### [dsh-agenda](knowledge/dsh-agenda/) — 议程管理

原生日程模块：日历视图、任务管理、回顾和可逆归档，覆盖完整的任务生命周期。

- **特性**：日历 + 任务双视图、可逆归档、标签过滤

#### [dsh-projects](knowledge/dsh-projects/) — 项目管理

原生项目工作区：权威的、版本感知的项目记录，支持阶段、日期、标签和可逆归档。

- **特性**：项目阶段管理、日期追踪、标签系统

#### [dsh-areas](knowledge/dsh-areas/) — 领域管理

原生领域工作区：针对持续性职责的权威版本感知记录。

- **特性**：领域/职责分区、关联引用

#### [dsh-resources](knowledge/dsh-resources/) — 资源管理

原生资源工作区：权威的版本感知记录，用于可复用的策划资产或主题，通过 id 引用而不会被拉取。

- **特性**：资源策展、id 引用机制

#### [dsh-bookmarks](knowledge/dsh-bookmarks/) — 书签管理

原生书签管理器：标题、HTTP(S) URL、备注、标签、阅读状态、搜索和可逆归档。只存链接，不抓取内容。

- **特性**：标签分类、阅读状态追踪、全文搜索

#### [dsh-knowledge-archives](knowledge/dsh-knowledge-archives/) — 知识归档

统一归档投影：对所有拥有归档记录的领域的只读聚合，通过各领域自己的端点恢复。无独立存储，无归档权限。

- **特性**：跨领域统一归档视图、通过原属端点恢复

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

#### [dsh-video](service/dsh-video/) — 视频内嵌播放

在对话中内嵌可播放/可下载的 MP4/WebM 视频文件。

- **特性**：inline 播放、路径安全校验、200 MiB 大小限制

#### [dsh-file-drawer](service/dsh-file-drawer/) — 文件管理面板抽屉

在 DSH 顶部导航栏添加「📂 文件」按钮，点击后从右侧滑出文件管理面板。通过 iframe 嵌入，需要自行部署文件面板服务。

- **特性**：抽屉式面板、导航栏按钮、快捷键关闭、iframe 沙箱隔离
- **配置**：详见 [插件 README](service/dsh-file-drawer/README.md)（含反向代理/端口/域名配置教程）

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

## 📝 更新日志

### 2026-08-20

- 🆕 新增 11 个插件：`dsh-agenda`、`dsh-areas`、`dsh-bookmarks`、`dsh-card-printer`、`dsh-file-drawer`、`dsh-knowledge-archives`、`dsh-notebook`、`dsh-projects`、`dsh-resources`、`dsh-video`、`dsh-watermarker`
- 📦 更新全部 9 个已有插件到最新版本
- 📚 Knowledge 分类从 0 扩充到 7 个插件

---

## 📄 目录结构

```
acks-dsh-plugins/
├── ai-agent/
│   ├── mimo-vision/              # 视觉理解 / OCR / 视频理解
│   └── dsh-skill-panel/          # Skills 面板
├── creative/
│   ├── dsh-imagegen/             # 生图（OpenAI Images）
│   ├── dsh-xai-imagine/          # xAI 生图 / 编辑
│   ├── dsh-theme-warm/           # 暖色护眼主题
│   ├── dsh-theme-jintao-retro/   # 复古硬件皮肤主题
│   ├── dsh-card-printer/         # 离线卡片工作室
│   └── dsh-watermarker/          # 浏览器本地水印工具
├── knowledge/
│   ├── dsh-notebook/             # 笔记本
│   ├── dsh-agenda/               # 议程管理
│   ├── dsh-projects/             # 项目管理
│   ├── dsh-areas/                # 领域管理
│   ├── dsh-resources/            # 资源管理
│   ├── dsh-bookmarks/            # 书签管理
│   └── dsh-knowledge-archives/   # 知识归档
└── service/
    ├── dsh-github/               # GitHub 集成
    ├── dsh-mcp-panel/            # MCP 服务器面板
    ├── dsh-restart-web/          # 重启 Web 服务
    ├── dsh-video/                # 视频内嵌播放
    └── dsh-file-drawer/          # 文件管理面板抽屉
```

---

## 📝 License

MIT © [ACKS STUIO](https://acks.com.cn)
