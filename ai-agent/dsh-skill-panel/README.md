# dsh-skill-panel

在 DeepSeek Harness 设置页新增 **Skills** 标签页，浏览、搜索并查看已安装的 Agent Skills。

> 背景：Harness 的 skill 机制没有独立的「面板」——skill 只在被模型调用时以内联卡片形式出现。本插件补上了「可浏览的 Skills 面板」。

## 功能

- **技能列表**：展示所有已注册的 skills（名称、来源、描述）
- **搜索过滤**：按名称或描述快速定位
- **展开详情**：查看完整技能内容、Provider、Model/User 调用权限
- **REST API**：`GET /api/skill-panel/skills` 与 `GET /api/skill-panel/skills/:name`

## 技能来源

扫描以下目录下的 Markdown 技能文件（YAML frontmatter 描述 + 正文指令）：

- `~/.dsh/skills/`
- `~/.agents/skills/`

## 安装

```bash
ln -sf "$(pwd)" "$DSH_HOME/profiles/web/node_modules/dsh-skill-panel"

# 在 $DSH_HOME/profiles/web/package.json 注册
#   dependencies:  "dsh-skill-panel": "file:/绝对路径/ai-agent/dsh-skill-panel"
#   dsh.profile.bundles: 添加 "dsh-skill-panel"
```

> 需在 profile 的 `cordis.patch.yml` 中启用 `skill-filesystem` 扫描器：
> ```yaml
> - id: skill-filesystem
>   disabled: false
>   config:
>     includeDefaultRoots: true
> ```

## 使用

1. 重启 web profile
2. 打开 **设置 → Skills**
3. 浏览、搜索，点击技能卡片展开查看内容

## 目录结构

```
dsh-skill-panel/
├── package.json
├── cordis.patch.yml
└── lib/
    ├── index.js    # host 半边：/api/skill-panel REST 路由
    └── client.js   # 浏览器半边：Settings → Skills 面板
```
