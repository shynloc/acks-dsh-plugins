# dsh-imagegen

DeepSeek Harness **生图插件**：注册 `generate_image` 工具，调用 OpenAI Images API（默认 `gpt-image-2`）生成图片，写入工作区，并在图像模型对话中直接显示。

## 功能

- **工具**：`generate_image`（文生图）
- **输出**：图片写入工作区，支持在图像模型的对话中预览显示
- **设置卡片**：提供 API Key / Base URL 配置入口

## 安装

```bash
ln -sf "$(pwd)" "$DSH_HOME/profiles/web/node_modules/dsh-imagegen"

# 在 $DSH_HOME/profiles/web/package.json 注册
#   dependencies:  "dsh-imagegen": "file:/绝对路径/creative/dsh-imagegen"
#   dsh.profile.bundles: 添加 "dsh-imagegen"
```

## 使用

1. 重启 web profile
2. 在 **设置 → 插件 → dsh-imagegen** 卡片配置 `IMAGEGEN_API_KEY` 与 `IMAGEGEN_BASE_URL`
3. 在对话中让 agent「生成一张 … 的图片」

## 凭据

| 字段 | 说明 |
|------|------|
| `IMAGEGEN_API_KEY` | OpenAI Images 兼容 API Key |
| `IMAGEGEN_BASE_URL` | API Base URL |

## 目录结构

```
dsh-imagegen/
├── package.json
├── cordis.patch.yml
└── lib/
    ├── index.js    # host 半边：注册 generate_image 工具
    ├── client.js   # 浏览器半边：设置卡片
    └── types/      # 类型声明
```
