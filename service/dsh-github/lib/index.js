/**
 * GitHub plugin for DeepSeek Harness.
 *
 * Registers a comprehensive set of GitHub REST API tools under `github_*`
 * names, backed by a GITHUB_TOKEN credential. Supports an optional default
 * repository (owner/repo) so repo-scoped tools can omit owner/repo.
 *
 * @module dsh-github
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import Schema from "@deepseek-ai/schemastery";

const name = "dsh-github";
const inject = ["tools", "credentials"];

const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";
const TOKEN_REF = credentialRef("GITHUB_TOKEN");
const DEFAULT_REPO_REF = credentialRef("GITHUB_DEFAULT_REPO");
const API_TIMEOUT_MS = 60_000;
const MAX_TEXT_BYTES = 120_000;

const GH_OUTPUT_SCHEMA = { type: "json" };

// ── helpers ───────────────────────────────────────────────────────────────

function requestSignal(signal) {
  const timeout = AbortSignal.timeout(API_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function resolveToken(ctx) {
  const credential = await ctx.credentials.resolve(TOKEN_REF);
  if (credential && typeof credential.value === "string" && credential.value.trim()) return credential.value;
  throw new Error("未配置 GitHub Token：请在插件设置中配置 GITHUB_TOKEN（Settings → GitHub）");
}

/** Resolve owner/repo from explicit args or the configured default repository. */
async function resolveRepo(ctx, args) {
  const owner = args.owner;
  const repo = args.repo;
  if (owner && repo) return { owner, repo };
  const credential = await ctx.credentials.resolve(DEFAULT_REPO_REF);
  const value = credential?.value;
  if (typeof value === "string") {
    const [o, r] = value.split("/", 2);
    if (o && r) return { owner: o, repo: r };
  }
  throw new Error("缺少 owner/repo：请显式传入，或在插件设置中配置默认仓库（格式 owner/repo）");
}

/** Core GitHub REST request. Throws a friendly error on non-2xx. */
async function ghRequest(ctx, method, path, body, signal) {
  const token = await resolveToken(ctx);
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    Authorization: `Bearer ${token}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: requestSignal(signal),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const message = data?.message || `HTTP ${response.status}`;
    const errors = Array.isArray(data?.errors) ? data.errors.map((e) => e.message).join("; ") : "";
    throw new Error(`GitHub API 错误 (${response.status}): ${message}${errors ? ` — ${errors}` : ""}`);
  }
  return data;
}

function truncateText(text) {
  if (typeof text !== "string") return text;
  const bytes = Buffer.byteLength(text);
  if (bytes <= MAX_TEXT_BYTES) return text;
  return `${text.slice(0, MAX_TEXT_BYTES)}\n…[truncated ${bytes - MAX_TEXT_BYTES} bytes]`;
}

function renderJson(_args, value) {
  const text = value === null || value === undefined ? "(no content)" : JSON.stringify(value, null, 2);
  return [{ type: "text", text: truncateText(text) }];
}

function encodeBase64(text) {
  return Buffer.from(String(text ?? ""), "utf8").toString("base64");
}

// ── tool registration helper ──────────────────────────────────────────────

function registerGhTool(ctx, { name, description, parameters, build }) {
  ctx.tools.register(defineTool({
    name,
    description,
    parameters,
    output: { schema: GH_OUTPUT_SCHEMA, render: renderJson },
    async execute(args, exec) {
      const { method, path, body, transform } = build(args);
      const result = await ghRequest(ctx, method, path, body, exec.signal);
      return transform ? transform(result) : result;
    },
  }));
}

// ── common parameter shapes ───────────────────────────────────────────────

function repoParams(extra = {}) {
  return {
    owner: { type: "string", description: "仓库 owner（省略则用默认仓库）" },
    repo: { type: "string", description: "仓库名（省略则用默认仓库）" },
    ...extra,
  };
}

// ── plugin ────────────────────────────────────────────────────────────────

async function apply(ctx) {
  ctx.inject(["settings"], function (settingsCtx) {
    settingsCtx.settings.register("dsh-github", Schema.object({}));
  });

  // ── repositories ─────────────────────────────────────────────────────────
  registerGhTool(ctx, {
    name: "github_create_repository",
    description: "为当前用户创建一个 GitHub 仓库（可指定公开/私有、自动初始化 README、许可证等）。",
    parameters: {
      name: { type: "string", required: true, description: "仓库名" },
      description: { type: "string", description: "仓库描述" },
      private: { type: "boolean", description: "是否私有仓库，默认 false（公开）" },
      auto_init: { type: "boolean", description: "是否自动创建初始提交（含 README），默认 false" },
      license_template: { type: "string", description: "许可证模板，如 mit、apache-2.0、gpl-3.0" },
      gitignore_template: { type: "string", description: ".gitignore 模板，如 Node、Python" },
    },
    build: (args) => ({
      method: "POST",
      path: "/user/repos",
      body: {
        name: args.name,
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.private !== undefined ? { private: args.private } : {}),
        ...(args.auto_init !== undefined ? { auto_init: args.auto_init } : {}),
        ...(args.license_template ? { license_template: args.license_template } : {}),
        ...(args.gitignore_template ? { gitignore_template: args.gitignore_template } : {}),
      },
    }),
  });

  registerGhTool(ctx, {
    name: "github_get_repository",
    description: "获取一个 GitHub 仓库的详细信息。",
    parameters: repoParams(),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return { method: "GET", path: `/repos/${owner}/${repo}` };
    },
  });

  registerGhTool(ctx, {
    name: "github_update_repository",
    description: "更新一个 GitHub 仓库的设置（名称、描述、可见性、默认分支等）。",
    parameters: repoParams({
      name: { type: "string", description: "新仓库名（可选，重命名）" },
      description: { type: "string", description: "新描述" },
      private: { type: "boolean", description: "可见性：true 私有 / false 公开" },
      default_branch: { type: "string", description: "默认分支名" },
    }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      const body = {};
      for (const key of ["name", "description", "private", "default_branch"]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      return { method: "PATCH", path: `/repos/${owner}/${repo}`, body };
    },
  });

  registerGhTool(ctx, {
    name: "github_delete_repository",
    description: "删除一个 GitHub 仓库（危险操作，不可恢复）。",
    parameters: repoParams(),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return { method: "DELETE", path: `/repos/${owner}/${repo}` };
    },
  });

  registerGhTool(ctx, {
    name: "github_list_my_repositories",
    description: "列出当前已认证用户自己的仓库。",
    parameters: {
      visibility: { type: "string", enum: ["all", "public", "private"], description: "按可见性过滤" },
      per_page: { type: "integer", description: "每页数量，默认 30" },
    },
    build: (args) => ({
      method: "GET",
      path: `/user/repos?visibility=${args.visibility || "all"}&per_page=${args.per_page || 30}`,
    }),
  });

  registerGhTool(ctx, {
    name: "github_list_user_repositories",
    description: "列出某个 GitHub 用户的公开仓库。",
    parameters: {
      username: { type: "string", required: true, description: "用户名" },
      per_page: { type: "integer", description: "每页数量，默认 30" },
    },
    build: (args) => ({
      method: "GET",
      path: `/users/${args.username}/repos?per_page=${args.per_page || 30}`,
    }),
  });

  registerGhTool(ctx, {
    name: "github_get_authenticated_user",
    description: "获取当前已认证 GitHub 用户的信息（可用于确认 token 是否有效）。",
    parameters: {},
    build: () => ({ method: "GET", path: "/user" }),
  });

  // ── issues ───────────────────────────────────────────────────────────────
  registerGhTool(ctx, {
    name: "github_list_issues",
    description: "列出一个仓库的 issues。",
    parameters: repoParams({
      state: { type: "string", enum: ["open", "closed", "all"], description: "状态，默认 open" },
      labels: { type: "string", description: "按标签过滤（逗号分隔）" },
      per_page: { type: "integer", description: "每页数量，默认 30" },
    }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      const params = new URLSearchParams({ state: args.state || "open", per_page: String(args.per_page || 30) });
      if (args.labels) params.set("labels", args.labels);
      return { method: "GET", path: `/repos/${owner}/${repo}/issues?${params}` };
    },
  });

  registerGhTool(ctx, {
    name: "github_get_issue",
    description: "获取一个 issue 的详细信息。",
    parameters: repoParams({ issue_number: { type: "integer", required: true, description: "issue 编号" } }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return { method: "GET", path: `/repos/${owner}/${repo}/issues/${args.issue_number}` };
    },
  });

  registerGhTool(ctx, {
    name: "github_create_issue",
    description: "在仓库中创建一个 issue。",
    parameters: repoParams({
      title: { type: "string", required: true, description: "issue 标题" },
      body: { type: "string", description: "issue 正文（Markdown）" },
      labels: { type: "array", items: { type: "string" }, description: "标签列表" },
      assignees: { type: "array", items: { type: "string" }, description: "指派用户列表" },
    }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return {
        method: "POST",
        path: `/repos/${owner}/${repo}/issues`,
        body: {
          title: args.title,
          ...(args.body !== undefined ? { body: args.body } : {}),
          ...(args.labels ? { labels: args.labels } : {}),
          ...(args.assignees ? { assignees: args.assignees } : {}),
        },
      };
    },
  });

  registerGhTool(ctx, {
    name: "github_update_issue",
    description: "更新一个 issue（标题、正文、状态、标签等）。",
    parameters: repoParams({
      issue_number: { type: "integer", required: true, description: "issue 编号" },
      title: { type: "string", description: "新标题" },
      body: { type: "string", description: "新正文" },
      state: { type: "string", enum: ["open", "closed"], description: "状态" },
      labels: { type: "array", items: { type: "string" }, description: "标签列表" },
    }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      const body = {};
      for (const key of ["title", "body", "state", "labels"]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      return { method: "PATCH", path: `/repos/${owner}/${repo}/issues/${args.issue_number}`, body };
    },
  });

  registerGhTool(ctx, {
    name: "github_comment_on_issue",
    description: "在一个 issue 上发表评论。",
    parameters: repoParams({
      issue_number: { type: "integer", required: true, description: "issue 编号" },
      body: { type: "string", required: true, description: "评论内容（Markdown）" },
    }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return { method: "POST", path: `/repos/${owner}/${repo}/issues/${args.issue_number}/comments`, body: { body: args.body } };
    },
  });

  registerGhTool(ctx, {
    name: "github_list_issue_comments",
    description: "列出一个 issue 的所有评论。",
    parameters: repoParams({ issue_number: { type: "integer", required: true, description: "issue 编号" } }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return { method: "GET", path: `/repos/${owner}/${repo}/issues/${args.issue_number}/comments` };
    },
  });

  // ── pull requests ────────────────────────────────────────────────────────
  registerGhTool(ctx, {
    name: "github_list_pull_requests",
    description: "列出一个仓库的 pull requests。",
    parameters: repoParams({
      state: { type: "string", enum: ["open", "closed", "all"], description: "状态，默认 open" },
      per_page: { type: "integer", description: "每页数量，默认 30" },
    }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return { method: "GET", path: `/repos/${owner}/${repo}/pulls?state=${args.state || "open"}&per_page=${args.per_page || 30}` };
    },
  });

  registerGhTool(ctx, {
    name: "github_get_pull_request",
    description: "获取一个 pull request 的详细信息。",
    parameters: repoParams({ pull_number: { type: "integer", required: true, description: "PR 编号" } }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return { method: "GET", path: `/repos/${owner}/${repo}/pulls/${args.pull_number}` };
    },
  });

  registerGhTool(ctx, {
    name: "github_create_pull_request",
    description: "创建一个 pull request（head 分支合并到 base 分支）。",
    parameters: repoParams({
      title: { type: "string", required: true, description: "PR 标题" },
      head: { type: "string", required: true, description: "源分支名（含 owner 则用 owner:branch 格式）" },
      base: { type: "string", required: true, description: "目标分支名" },
      body: { type: "string", description: "PR 描述（Markdown）" },
      draft: { type: "boolean", description: "是否草稿 PR" },
    }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return {
        method: "POST",
        path: `/repos/${owner}/${repo}/pulls`,
        body: {
          title: args.title,
          head: args.head,
          base: args.base,
          ...(args.body !== undefined ? { body: args.body } : {}),
          ...(args.draft !== undefined ? { draft: args.draft } : {}),
        },
      };
    },
  });

  registerGhTool(ctx, {
    name: "github_merge_pull_request",
    description: "合并一个 pull request。",
    parameters: repoParams({
      pull_number: { type: "integer", required: true, description: "PR 编号" },
      merge_method: { type: "string", enum: ["merge", "squash", "rebase"], description: "合并方式，默认 merge" },
      commit_title: { type: "string", description: "合并提交标题" },
    }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return {
        method: "PUT",
        path: `/repos/${owner}/${repo}/pulls/${args.pull_number}/merge`,
        body: {
          ...(args.merge_method ? { merge_method: args.merge_method } : {}),
          ...(args.commit_title ? { commit_title: args.commit_title } : {}),
        },
      };
    },
  });

  // ── file contents ────────────────────────────────────────────────────────
  registerGhTool(ctx, {
    name: "github_get_file_contents",
    description: "读取仓库中一个文件的内容（自动解码 base64，返回可读文本）。",
    parameters: repoParams({
      path: { type: "string", required: true, description: "文件路径，如 README.md 或 src/index.js" },
      ref: { type: "string", description: "分支/标签/commit SHA，默认默认分支" },
    }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      const ref = args.ref ? `?ref=${encodeURIComponent(args.ref)}` : "";
      return {
        method: "GET",
        path: `/repos/${owner}/${repo}/contents/${args.path}${ref}`,
        transform: (data) => {
          if (Array.isArray(data)) return data;
          return {
            path: data.path,
            sha: data.sha,
            size: data.size,
            encoding: data.encoding,
            content: data.content, // raw base64
            text: data.encoding === "base64" && data.content ? Buffer.from(data.content, "base64").toString("utf8") : data.content,
            download_url: data.download_url,
          };
        },
      };
    },
  });

  registerGhTool(ctx, {
    name: "github_list_directory_contents",
    description: "列出一个目录下的文件和子目录。",
    parameters: repoParams({
      path: { type: "string", description: "目录路径，空表示仓库根目录" },
      ref: { type: "string", description: "分支/标签/commit SHA" },
    }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      const p = args.path ? `/${args.path}` : "";
      const ref = args.ref ? `?ref=${encodeURIComponent(args.ref)}` : "";
      return { method: "GET", path: `/repos/${owner}/${repo}/contents${p}${ref}` };
    },
  });

  registerGhTool(ctx, {
    name: "github_create_or_update_file",
    description: "在仓库中创建或更新一个文件（内容自动 base64 编码，需提供 commit message）。",
    parameters: repoParams({
      path: { type: "string", required: true, description: "文件路径，如 README.md" },
      content: { type: "string", required: true, description: "文件内容（文本）" },
      message: { type: "string", required: true, description: "commit message" },
      branch: { type: "string", description: "目标分支，默认默认分支" },
      sha: { type: "string", description: "更新已有文件时需提供其当前 sha（先读后写）" },
    }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return {
        method: "PUT",
        path: `/repos/${owner}/${repo}/contents/${args.path}`,
        body: {
          message: args.message,
          content: encodeBase64(args.content),
          ...(args.branch ? { branch: args.branch } : {}),
          ...(args.sha ? { sha: args.sha } : {}),
        },
      };
    },
  });

  registerGhTool(ctx, {
    name: "github_delete_file",
    description: "删除仓库中的一个文件。",
    parameters: repoParams({
      path: { type: "string", required: true, description: "文件路径" },
      message: { type: "string", required: true, description: "commit message" },
      sha: { type: "string", required: true, description: "文件当前 sha（先读后写）" },
      branch: { type: "string", description: "目标分支" },
    }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return {
        method: "DELETE",
        path: `/repos/${owner}/${repo}/contents/${args.path}`,
        body: {
          message: args.message,
          sha: args.sha,
          ...(args.branch ? { branch: args.branch } : {}),
        },
      };
    },
  });

  // ── releases ─────────────────────────────────────────────────────────────
  registerGhTool(ctx, {
    name: "github_list_releases",
    description: "列出一个仓库的 releases。",
    parameters: repoParams({ per_page: { type: "integer", description: "每页数量，默认 30" } }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return { method: "GET", path: `/repos/${owner}/${repo}/releases?per_page=${args.per_page || 30}` };
    },
  });

  registerGhTool(ctx, {
    name: "github_get_latest_release",
    description: "获取一个仓库最新的 release。",
    parameters: repoParams(),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return { method: "GET", path: `/repos/${owner}/${repo}/releases/latest` };
    },
  });

  registerGhTool(ctx, {
    name: "github_get_release",
    description: "获取一个 release 的详细信息。",
    parameters: repoParams({ release_id: { type: "integer", required: true, description: "release id" } }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return { method: "GET", path: `/repos/${owner}/${repo}/releases/${args.release_id}` };
    },
  });

  registerGhTool(ctx, {
    name: "github_create_release",
    description: "在仓库中创建一个 release（可发布二进制资产或源代码包）。",
    parameters: repoParams({
      tag_name: { type: "string", required: true, description: "tag 名，如 v1.0.0" },
      name: { type: "string", description: "release 标题，默认用 tag_name" },
      body: { type: "string", description: "release 说明（Markdown）" },
      draft: { type: "boolean", description: "是否草稿，默认 false" },
      prerelease: { type: "boolean", description: "是否预发布，默认 false" },
      target_commitish: { type: "string", description: "目标 commitish，默认默认分支" },
    }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return {
        method: "POST",
        path: `/repos/${owner}/${repo}/releases`,
        body: {
          tag_name: args.tag_name,
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.body !== undefined ? { body: args.body } : {}),
          ...(args.draft !== undefined ? { draft: args.draft } : {}),
          ...(args.prerelease !== undefined ? { prerelease: args.prerelease } : {}),
          ...(args.target_commitish ? { target_commitish: args.target_commitish } : {}),
        },
      };
    },
  });

  registerGhTool(ctx, {
    name: "github_delete_release",
    description: "删除一个 release（不删除 tag）。",
    parameters: repoParams({ release_id: { type: "integer", required: true, description: "release id" } }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return { method: "DELETE", path: `/repos/${owner}/${repo}/releases/${args.release_id}` };
    },
  });

  // ── search ───────────────────────────────────────────────────────────────
  registerGhTool(ctx, {
    name: "github_search_repositories",
    description: "在 GitHub 上搜索仓库。",
    parameters: {
      q: { type: "string", required: true, description: "搜索关键词，可用限定符如 language:python stars:>100" },
      per_page: { type: "integer", description: "每页数量，默认 20" },
    },
    build: (args) => ({
      method: "GET",
      path: `/search/repositories?q=${encodeURIComponent(args.q)}&per_page=${args.per_page || 20}`,
    }),
  });

  registerGhTool(ctx, {
    name: "github_search_code",
    description: "在 GitHub 上搜索代码。",
    parameters: {
      q: { type: "string", required: true, description: "搜索关键词，可用限定符如 repo:owner/repo language:js" },
      per_page: { type: "integer", description: "每页数量，默认 20" },
    },
    build: (args) => ({
      method: "GET",
      path: `/search/code?q=${encodeURIComponent(args.q)}&per_page=${args.per_page || 20}`,
    }),
  });

  registerGhTool(ctx, {
    name: "github_search_issues",
    description: "在 GitHub 上搜索 issues 和 pull requests。",
    parameters: {
      q: { type: "string", required: true, description: "搜索关键词，可用限定符如 repo:owner/repo is:issue is:open" },
      per_page: { type: "integer", description: "每页数量，默认 20" },
    },
    build: (args) => ({
      method: "GET",
      path: `/search/issues?q=${encodeURIComponent(args.q)}&per_page=${args.per_page || 20}`,
    }),
  });

  // ── git data ─────────────────────────────────────────────────────────────
  registerGhTool(ctx, {
    name: "github_list_commits",
    description: "列出一个仓库的提交历史。",
    parameters: repoParams({
      sha: { type: "string", description: "分支或 commit SHA，默认默认分支" },
      per_page: { type: "integer", description: "每页数量，默认 30" },
    }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      const sha = args.sha ? `?sha=${encodeURIComponent(args.sha)}&per_page=${args.per_page || 30}` : `?per_page=${args.per_page || 30}`;
      return { method: "GET", path: `/repos/${owner}/${repo}/commits${sha}` };
    },
  });

  registerGhTool(ctx, {
    name: "github_get_commit",
    description: "获取一个 commit 的详细信息。",
    parameters: repoParams({ ref: { type: "string", required: true, description: "commit SHA 或分支/标签名" } }),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return { method: "GET", path: `/repos/${owner}/${repo}/commits/${args.ref}` };
    },
  });

  registerGhTool(ctx, {
    name: "github_list_branches",
    description: "列出一个仓库的分支。",
    parameters: repoParams(),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return { method: "GET", path: `/repos/${owner}/${repo}/branches` };
    },
  });

  registerGhTool(ctx, {
    name: "github_list_tags",
    description: "列出一个仓库的 tags。",
    parameters: repoParams(),
    build: async (args) => {
      const { owner, repo } = await resolveRepo(ctx, args);
      return { method: "GET", path: `/repos/${owner}/${repo}/tags` };
    },
  });
}

export { apply, inject, name };
