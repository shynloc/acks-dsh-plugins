# dsh-restart-web

DeepSeek Harness **重启 Web 服务**插件：在设置页（通用）提供「重启 Web 服务」按钮，两步确认后优雅退出进程树，由外部监督者拉起后新插件生效。

## 功能

- **一键重启**：浏览器按钮 → `POST /api/restart-web` → host 端调用 `appExit` 优雅退出
- **两步确认**：防止误触
- **同源守卫**：`sec-fetch-site` / Origin↔Host 比对，拦截跨站 CSRF

## 场景

安装插件后无需命令行即可重启生效——在设置里点两下，新插件（如主题、工具）随之加载。进程由外部监督者（容器 restart 策略 / systemd / pm2 等）拉起。

## 安装

```bash
ln -sf "$(pwd)" "$DSH_HOME/profiles/web/node_modules/dsh-restart-web"

# 在 $DSH_HOME/profiles/web/package.json 注册
#   dependencies:  "dsh-restart-web": "file:/绝对路径/service/dsh-restart-web"
#   dsh.profile.bundles: 添加 "dsh-restart-web"
```

## 使用

1. 重启 web profile
2. 打开 **设置 → 通用**，点击「重启 Web 服务」并确认

## 目录结构

```
dsh-restart-web/
├── package.json
├── cordis.patch.yml
└── lib/
    ├── index.js    # host 半边：/api/restart-web 路由 + appExit
    └── client.js   # 浏览器半边：重启按钮
```
