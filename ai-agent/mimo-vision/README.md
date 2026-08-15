# mimo-vision

为 DeepSeek Harness 增加小米 **MiMo V2.5** 多模态理解能力：图片描述、OCR 文字识别、多图比较与视频理解。

## 功能

| 工具 | 用途 |
|------|------|
| `analyze_image` | 描述图片、回答图片问题、OCR 提取文字、多图对比 |
| `analyze_video` | 描述视频内容或回答视频相关问题 |

**媒体来源支持**：

- `/workspace` 内的本地文件（解析符号链接后仍必须位于工作区，防越权）
- 公网 HTTPS URL（URL 直接交给 MiMo，不由 DSH 宿主下载）

**计费模式**：支持按量付费（pay-as-you-go）与 Token Plan Base URL 两种接入。

## 安装

```bash
# 链接到 profile
ln -sf "$(pwd)" "$DSH_HOME/profiles/web/node_modules/mimo-vision"

# 在 $DSH_HOME/profiles/web/package.json 注册
#   dependencies:  "mimo-vision": "file:/绝对路径/ai-agent/mimo-vision"
#   dsh.profile.bundles: 添加 "mimo-vision"
```

## 使用

1. 重启 web profile（或使用 `dsh-restart-web` 的重启按钮）
2. 在 **设置 → 插件 → mimo-vision** 卡片配置 `MIMO_API_KEY` 与 `MIMO_BASE_URL`
3. 在对话中直接让 agent「描述这张图」「识别图中文字」或「对比这两张截图」即可

## 凭据

| 字段 | 说明 |
|------|------|
| `MIMO_API_KEY` | 小米 MiMo API Key |
| `MIMO_BASE_URL` | API 端点（如 `https://token-plan-cn.xiaomimimo.com/v1`） |

## 目录结构

```
mimo-vision/
├── package.json
├── cordis.patch.yml
└── lib/
    ├── index.js    # host 半边：注册 analyze_image / analyze_video 工具
    └── client.js   # 浏览器半边：凭据设置卡片
```
