# dsh-github

DeepSeek Harness **GitHub 集成插件**：注册 33 个 `github_*` 工具，直连 `https://api.github.com`，覆盖仓库、Issue、PR、文件、Release、搜索与 Git 数据的完整读写能力。

## 功能

| 类别 | 工具 |
|------|------|
| 仓库 | `github_create_repository`（公开/私有）、`github_get_repository`、`github_update_repository`、`github_delete_repository`、`github_list_my_repositories`、`github_list_user_repositories` |
| Issue | `github_list_issues`、`github_get_issue`、`github_create_issue`、`github_update_issue`、`github_comment_on_issue`、`github_list_issue_comments` |
| PR | `github_list_pull_requests`、`github_get_pull_request`、`github_create_pull_request`、`github_merge_pull_request` |
| 文件 | `github_get_file_contents`（自动解码 base64）、`github_list_directory_contents`、`github_create_or_update_file`、`github_delete_file` |
| Release | `github_list_releases`、`github_get_latest_release`、`github_get_release`、`github_create_release`、`github_delete_release` |
| 搜索 | `github_search_repositories`、`github_search_code`、`github_search_issues` |
| Git 数据 | `github_list_commits`、`github_get_commit`、`github_list_branches`、`github_list_tags` |
| 身份 | `github_get_authenticated_user` |

## 安装

```bash
ln -sf "$(pwd)" "$DSH_HOME/profiles/web/node_modules/dsh-github"

# 在 $DSH_HOME/profiles/web/package.json 注册
#   dependencies:  "dsh-github": "file:/绝对路径/service/dsh-github"
#   dsh.profile.bundles: 添加 "dsh-github"

# 依赖链接（@deepseek-ai 包）
mkdir -p node_modules/@deepseek-ai
ln -sf /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools node_modules/@deepseek-ai/dsh-tools
ln -sf /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-credentials node_modules/@deepseek-ai/dsh-credentials
```

## 使用

1. 重启 web profile
2. 在 **设置 → 插件 → GitHub** 卡片配置 `GITHUB_TOKEN`（Personal Access Token，私有仓库需 `repo` scope）
3. 可选配置 `GITHUB_DEFAULT_REPO`（`owner/repo`），之后 issue/PR/文件/release 类工具可省略 owner/repo
4. 在对话中直接让 agent「创建仓库」「写 README」「发 release」等

## 凭据

| 字段 | 说明 |
|------|------|
| `GITHUB_TOKEN` | GitHub Personal Access Token |
| `GITHUB_DEFAULT_REPO` | 默认仓库，格式 `owner/repo`（可选） |

## 故障诊断

- `0.1.2` 修复了仓库级工具未等待异步请求构造器的问题。旧版本会把
  `Promise` 当成请求描述，最终访问错误的 `api.github.comundefined` 主机，
  因而只显示笼统的 `fetch failed`。
- 新版本会保留安全的网络故障类型（例如 DNS 主机名解析或连接超时），但
  不会把 Token 写入错误信息。
- HTTP 401/403/404 和限流响应仍按 GitHub API 状态码返回，便于区分 Token、
  权限、仓库可见性与传输层问题。

## 目录结构

```
dsh-github/
├── package.json
├── cordis.patch.yml
└── lib/
    ├── index.js    # host 半边：注册 33 个 github_* 工具
    └── client.js   # 浏览器半边：凭据设置卡片
```
