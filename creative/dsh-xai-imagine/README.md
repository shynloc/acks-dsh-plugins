# dsh-xai-imagine

DeepSeek Harness **xAI 生图 / 编辑插件**：注册 `generate_xai_image` 与 `edit_xai_image` 工具，直连 xAI 官方 `https://api.x.ai/v1`（Grok Imagine Image 2.0），不经过任何 OpenAI 兼容中转站。

## 功能

| 工具 | 用途 |
|------|------|
| `generate_xai_image` | 文生图，1–4 张，支持 1:1 / 16:9 / 9:16 等比例、1k/2k 分辨率 |
| `edit_xai_image` | 图生图 / 图片编辑（接受 HTTPS URL、base64 data URI 或工作区文件路径） |

- **输出**：图片写入 `/workspace/images/`，并返回预览 URL，可在对话中 Markdown 展示
- **安全**：编辑原图必须位于工作区内，网络下载强制 HTTPS

## 安装

```bash
ln -sf "$(pwd)" "$DSH_HOME/profiles/web/node_modules/dsh-xai-imagine"

# 在 $DSH_HOME/profiles/web/package.json 注册
#   dependencies:  "dsh-xai-imagine": "file:/绝对路径/creative/dsh-xai-imagine"
#   dsh.profile.bundles: 添加 "dsh-xai-imagine"
```

## 使用

1. 重启 web profile
2. 在 **设置 → 插件 → xAI Grok Imagine** 卡片配置 `XAI_API_KEY`
3. 在对话中让 agent「生成 …」或「编辑这张图 …」

## 凭据

| 字段 | 说明 |
|------|------|
| `XAI_API_KEY` | xAI 官方 API Key |

## 目录结构

```
dsh-xai-imagine/
├── package.json
├── cordis.patch.yml
└── lib/
    ├── index.js    # host 半边：注册生成/编辑工具 + 预览路由
    ├── client.js   # 浏览器半边：设置卡片
    └── types/      # 类型声明
```
