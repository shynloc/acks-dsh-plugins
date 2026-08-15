# dsh-theme-jintao-retro

DeepSeek Harness **复古硬件皮肤主题**：Native 组件的象牙色控制台外观，在不修改上游 DSH 包、不替换事件处理器的前提下实现。

## 功能

- **复古掌机外观**：象牙色控制台 + 品牌 PDA 造型
- **独立栅格资源**：会话卡带、六枚 deck 键、五枚 composer 键、模型选择器与发送键，均带凸起/按下状态
- **原生节点保留**：原始会话树、侧边栏动作、权限/模型/上下文控件与发送按钮保持可点击

## 架构

- `console-chassis-static.webp`：仅包含非交互的外壳、边框、屏幕玻璃与空挂载槽
- 运行时通过 `data-jrt-role` 钩子为原生节点打标签，实现外观覆盖

## 安装

```bash
ln -sf "$(pwd)" "$DSH_HOME/profiles/web/node_modules/dsh-theme-jintao-retro"

# 在 $DSH_HOME/profiles/web/package.json 注册
#   dependencies:  "dsh-theme-jintao-retro": "file:/绝对路径/creative/dsh-theme-jintao-retro"
#   dsh.profile.bundles: 添加 "dsh-theme-jintao-retro"
```

## 使用

1. 重启 web profile
2. 在 **设置 → 通用 → 外观** 选择对应主题

## 目录结构

```
dsh-theme-jintao-retro/
├── package.json
├── cordis.patch.yml
├── assets/       # 栅格皮肤资源
└── lib/
    ├── index.js    # host 半边
    └── client.js   # 浏览器半边：皮肤挂载与角色标记
```
