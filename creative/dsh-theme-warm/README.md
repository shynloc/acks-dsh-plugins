# dsh-theme-warm

DeepSeek Harness **暖色护眼主题**插件：注册一个暖色主题，并在通用设置里复刻官方外观选择行（浅色 / 深色 / 跟随系统 / 暖色）。

## 功能

- **暖色主题**：护眼配色，适合夜间或长时间使用
- **外观选择**：在通用设置中新增「暖色」选项，与官方浅色/深色/跟随系统并列
- **零依赖**：纯浏览器能力，依赖官方主题扩展点（`ctx.theme.register` + `settings.general.item` 槽），无需复制/修改官方 UI 代码，无需构建工具链

## 安装

```bash
ln -sf "$(pwd)" "$DSH_HOME/profiles/web/node_modules/dsh-theme-warm"

# 在 $DSH_HOME/profiles/web/package.json 注册
#   dependencies:  "dsh-theme-warm": "file:/绝对路径/creative/dsh-theme-warm"
#   dsh.profile.bundles: 添加 "dsh-theme-warm"
```

## 使用

1. 重启 web profile
2. 打开 **设置 → 通用 → 外观**，选择「暖色」

## 目录结构

```
dsh-theme-warm/
├── package.json
├── cordis.patch.yml
└── lib/
    ├── index.js    # host 半边：空 apply（纯浏览器能力）
    └── client.js   # 浏览器半边：注册暖色主题 + 外观选择行
```
