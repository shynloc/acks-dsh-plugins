import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../service/dsh-github/lib/index.js", import.meta.url);

async function loadPlugin() {
  let source = await readFile(sourceUrl, "utf8");
  source = source
    .replace(
      'import { defineTool } from "@deepseek-ai/dsh-tools";',
      "const defineTool = (definition) => definition;",
    )
    .replace(
      'import { credentialRef } from "@deepseek-ai/dsh-credentials";',
      "const credentialRef = (ref) => ref;",
    )
    .replace(
      'import Schema from "@deepseek-ai/schemastery";',
      "const Schema = { object: (shape) => shape };",
    );
  const encoded = Buffer.from(source).toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}`);
}

async function registeredTools() {
  const plugin = await loadPlugin();
  const tools = new Map();
  await plugin.apply({
    credentials: {
      resolve: async () => ({ value: "test-token" }),
    },
    inject: () => {},
    tools: {
      register: (tool) => tools.set(tool.name, tool),
    },
  });
  return tools;
}

function jsonResponse(value) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(value),
  };
}

test("repo-scoped tools await their asynchronous request builder", async () => {
  const tools = await registeredTools();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return jsonResponse({ full_name: "shynloc/acks-dsh-plugins" });
  };

  try {
    const tool = tools.get("github_get_repository");
    const result = await tool.execute(
      { owner: "shynloc", repo: "acks-dsh-plugins" },
      { signal: new AbortController().signal },
    );

    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://api.github.com/repos/shynloc/acks-dsh-plugins",
    );
    assert.equal(requests[0].options.method, "GET");
    assert.equal(result.full_name, "shynloc/acks-dsh-plugins");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an asynchronous builder's transform runs after the GitHub response", async () => {
  const tools = await registeredTools();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(
      url,
      "https://api.github.com/repos/shynloc/acks-dsh-plugins/contents/README.md",
    );
    return jsonResponse({
      path: "README.md",
      sha: "abc123",
      size: 5,
      encoding: "base64",
      content: Buffer.from("hello").toString("base64"),
      download_url: null,
    });
  };

  try {
    const tool = tools.get("github_get_file_contents");
    const result = await tool.execute(
      { owner: "shynloc", repo: "acks-dsh-plugins", path: "README.md" },
      { signal: new AbortController().signal },
    );
    assert.equal(result.text, "hello");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("network failures retain a safe transport cause instead of only fetch failed", async () => {
  const tools = await registeredTools();
  const originalFetch = globalThis.fetch;
  const cause = Object.assign(new Error("getaddrinfo ENOTFOUND"), {
    code: "ENOTFOUND",
    hostname: "api.github.com",
  });
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed", { cause });
  };

  try {
    const tool = tools.get("github_get_authenticated_user");
    await assert.rejects(
      tool.execute({}, { signal: new AbortController().signal }),
      /GitHub 网络请求失败.*ENOTFOUND.*api\.github\.com/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

