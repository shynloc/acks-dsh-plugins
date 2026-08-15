/**
 * mimo-vision — Xiaomi MiMo multimodal understanding plugin for DeepSeek Harness.
 *
 * Registers two agent tools backed by the MiMo V2.5 API
 * (https://api.xiaomimimo.com/v1, OpenAI-compatible chat completions):
 *
 *  - analyze_image  : describe / answer questions about / OCR / compare images
 *  - analyze_video  : describe videos via the MiMo video_url input channel
 *
 * The API key and optional OpenAI-compatible base URL are resolved from DSH's
 * credential service under MIMO_API_KEY and MIMO_BASE_URL.
 *
 * @module mimo-vision
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Cordis plugin short name. */
const name = "mimo-vision";

/** Services required before this plugin activates. */
const inject = ["tools", "credentials"];

/** Credential reference carrying the MiMo API key. */
const API_KEY_REF = credentialRef("MIMO_API_KEY");

/** Credential reference carrying an optional OpenAI-compatible API root. */
const BASE_URL_REF = credentialRef("MIMO_BASE_URL");

/** Default OpenAI-compatible base URL for the MiMo API. */
const DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1";

/**
 * Default model for multimodal understanding. mimo-v2.5 is the officially
 * documented image/video understanding model.
 */
const DEFAULT_MODEL = "mimo-v2.5";

/** Base64 data URL must stay below MiMo's documented 50 MB limit. */
const MAX_BASE64_BYTES = 50 * 1024 * 1024;

/** Upper bound on images per call; the API caps by context length. */
const MAX_IMAGES = 8;

/** Timeout for the MiMo API request itself. */
const API_TIMEOUT_MS = 120_000;

/** Maximum JSON response body accepted from the configured API endpoint. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** Files visible to the tool must remain under this dedicated workspace. */
const WORKSPACE_ROOT = process.env.MIMO_VISION_WORKSPACE_ROOT || "/workspace";

/** Extension -> MIME map for Base64 data URLs. */
const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
};

/** Default question per detail level (used when the caller passes none). */
function defaultQuestion(detail, kind) {
  const noun = kind === "video" ? "视频" : "图片";
  switch (detail) {
    case "brief":
      return `请用一两句话简洁描述这个${noun}的内容。`;
    case "ocr":
      return `请提取${noun}中的所有文字内容，按阅读顺序原样输出，不要添加额外说明。`;
    default:
      return `请详细描述这个${noun}的内容，包括主体、场景、颜色、文字等细节。`;
  }
}

/** Guess a MIME type from a filename or URL. */
function guessMediaType(source) {
  const clean = source.split("?")[0].split("#")[0].toLowerCase();
  for (const [ext, mime] of Object.entries(MIME_BY_EXT)) {
    if (clean.endsWith(ext)) return mime;
  }
  return "image/png";
}

/** Whether a source is a remote http(s) URL. */
function isHttpUrl(source) {
  return /^https?:\/\//i.test(source);
}

/**
 * Validate a public media URL without fetching it from the DSH host. MiMo
 * accepts URLs directly, which avoids turning this tool into an SSRF client.
 * @param source - public media URL.
 * @returns canonical URL passed to MiMo.
 */
function validateRemoteUrl(source) {
  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error("无效的媒体 URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("远程媒体 URL 必须使用 https://");
  }
  if (url.username || url.password) {
    throw new Error("远程媒体 URL 不得包含用户名或密码");
  }
  return url.href;
}

/** Whether a canonical file path is contained by the canonical workspace. */
function isInside(root, target) {
  const child = relative(root, target);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

/**
 * Resolve a local source to a workspace-confined Base64 data URL, or pass a
 * public HTTPS URL through for MiMo to fetch itself.
 * @param source - local workspace path or public HTTPS URL.
 */
async function resolveSource(source) {
  if (isHttpUrl(source)) return validateRemoteUrl(source);
  const root = await realpath(WORKSPACE_ROOT);
  const candidate = isAbsolute(source) ? source : resolve(root, source);
  let canonical;
  try {
    canonical = await realpath(candidate);
  } catch (err) {
    throw new Error(`无法读取本地文件 "${source}"：${err.message}（请确认路径在可访问的工作区内）`);
  }
  if (!isInside(root, canonical)) {
    throw new Error(`拒绝读取工作区之外的文件 "${source}"`);
  }
  const info = await stat(canonical);
  if (!info.isFile()) {
    throw new Error(`本地媒体不是普通文件 "${source}"`);
  }
  const mediaType = guessMediaType(canonical);
  const encodedLength = Math.ceil(info.size / 3) * 4 + `data:${mediaType};base64,`.length;
  if (encodedLength > MAX_BASE64_BYTES) {
    throw new Error(
      `本地文件 Base64 编码后超过 50MB 限制: ${source}（原始 ${(info.size / 1024 / 1024).toFixed(1)}MB）`
    );
  }
  let buf;
  try {
    buf = await readFile(canonical);
  } catch (err) {
    throw new Error(`无法读取本地文件 "${source}"：${err.message}（请确认路径在可访问的工作区内）`);
  }
  return toDataUrl(buf, mediaType);
}

/** Build a Base64 data URL for the MiMo API. */
function toDataUrl(buf, mediaType) {
  return `data:${mediaType};base64,${buf.toString("base64")}`;
}

/** Resolve the API key from DSH's credential plane. */
async function resolveApiKey(ctx) {
  const credential = await ctx.credentials.resolve(API_KEY_REF);
  if (credential && typeof credential.value === "string" && credential.value.length > 0) return credential.value;
  throw new Error(
    "未配置 MiMo API Key：请在插件设置中配置 MIMO_API_KEY"
  );
}

/**
 * Canonicalize and constrain the API destination. A configurable API root is
 * required for Token Plan, but it must not turn the plugin into a generic SSRF
 * client. Only Xiaomi's documented OpenAI-compatible API hosts are accepted.
 */
function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("MiMo Base URL 无效：请输入完整的 https:// 地址");
  }
  const hostname = url.hostname.toLowerCase();
  const isPayAsYouGo = hostname === "api.xiaomimimo.com";
  const isTokenPlan = /^token-plan-[a-z0-9-]+\.xiaomimimo\.com$/.test(hostname);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (url.protocol !== "https:") {
    throw new Error("MiMo Base URL 必须使用 https://");
  }
  if (url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("MiMo Base URL 不得包含用户信息或非标准端口");
  }
  if (url.search || url.hash) {
    throw new Error("MiMo Base URL 不得包含查询参数或片段");
  }
  if ((!isPayAsYouGo && !isTokenPlan) || pathname !== "/v1") {
    throw new Error(
      "MiMo Base URL 仅支持 https://api.xiaomimimo.com/v1 或 https://token-plan-*.xiaomimimo.com/v1"
    );
  }
  return `https://${hostname}/v1`;
}

/** Resolve the API destination, requiring an explicit URL for Token Plan. */
async function resolveBaseUrl(ctx, apiKey) {
  const credential = await ctx.credentials.resolve(BASE_URL_REF);
  const configured = credential && typeof credential.value === "string" ? credential.value.trim() : "";
  if (configured) return normalizeBaseUrl(configured);
  if (apiKey.trim().toLowerCase().startsWith("tp-")) {
    throw new Error(
      "检测到 Token Plan API Key（tp-），请在 mimo-vision 插件设置中配置套餐页面提供的 Base URL"
    );
  }
  return DEFAULT_BASE_URL;
}

/** Parse a bounded JSON response without buffering an unbounded body. */
async function readJsonCapped(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("MiMo API 返回内容过大");
  }
  if (response.body === null) return {};
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error("MiMo API 返回内容过大");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(joined));
  } catch {
    return {};
  }
}

/**
 * Call the MiMo chat completions endpoint.
 * @param apiKey - MiMo API key.
 * @param baseUrl - resolved API base URL (OpenAI-compatible root).
 * @param payload - request body (model, messages, ...).
 * @param signal - optional AbortSignal.
 * @returns parsed JSON body.
 */
async function callMimo(apiKey, baseUrl, payload, signal) {
  const timeout = AbortSignal.timeout(API_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: requestSignal,
    });
  } catch (err) {
    throw new Error(`MiMo API 请求失败（网络错误）: ${err.message}`);
  }
  const body = await readJsonCapped(res);
  if (!res.ok) {
    const detail = body?.error?.message || `HTTP ${res.status}`;
    throw new Error(`MiMo API 调用失败: ${detail}`);
  }
  const message = body?.choices?.[0]?.message;
  if (!message || typeof message.content !== "string") {
    throw new Error("MiMo API 返回异常：缺少 choices[0].message.content");
  }
  return {
    content: message.content,
    reasoning: typeof message.reasoning_content === "string" ? message.reasoning_content : undefined,
    usage: body.usage ?? undefined,
  };
}

/**
 * Shared execute path for image/video understanding.
 * @param ctx - Cordis context.
 * @param args - tool arguments ({ sources, mediaKind, question, detail }).
 * @param exec - tool run context (signal).
 */
async function runUnderstanding(ctx, args, exec) {
  const apiKey = await resolveApiKey(ctx);
  const model = DEFAULT_MODEL;
  const baseUrl = await resolveBaseUrl(ctx, apiKey);

  const sources = args.sources;
  const kind = args.mediaKind; // "image" | "video"
  if (sources.length === 0) {
    throw new Error(`请提供至少一个${kind === "video" ? "视频" : "图片"}（本地路径或公网 URL）`);
  }
  if (sources.length > MAX_IMAGES) {
    throw new Error(`一次最多支持 ${MAX_IMAGES} 个${kind === "video" ? "视频" : "图片"}，当前 ${sources.length} 个`);
  }

  // Load and encode every source.
  const parts = [];
  for (const source of sources) {
    const url = await resolveSource(source);
    if (kind === "video") {
      parts.push({ type: "video_url", video_url: { url }, fps: 2, media_resolution: "default" });
    } else {
      parts.push({ type: "image_url", image_url: { url } });
    }
  }

  const question = args.question || defaultQuestion(args.detail, kind);
  parts.push({ type: "text", text: question });

  const result = await callMimo(
    apiKey,
    baseUrl,
    {
      model,
      messages: [
        {
          role: "system",
          content:
            `You are MiMo, an AI assistant developed by Xiaomi. Today is date: ${new Date().toISOString().slice(0, 10)}. ` +
            "Answer the user's question about the provided media accurately and in the language the user used.",
        },
        { role: "user", content: parts },
      ],
      max_completion_tokens: 2048,
    },
    exec.signal
  );

  return {
    content: result.content,
    ...(result.reasoning ? { reasoning: result.reasoning } : {}),
    ...(result.usage ? { usage: result.usage } : {}),
  };
}

/** Plugin entry: register the two tools. */
function apply(ctx) {
  ctx.tools.register(
    defineTool({
      name: "analyze_image",
      description:
        "Understand an image using Xiaomi MiMo V2.5. Accepts one or more files confined to /workspace, or public HTTPS image URLs. Use it to describe content, answer image questions, extract text (OCR), or compare images.",
      parameters: {
        images: {
          type: "array",
          required: true,
          description:
            "One or more images: files under /workspace (e.g. /workspace/photo.png) or public HTTPS URLs. Multiple images are compared together.",
          items: { type: "string" },
        },
        question: {
          type: "string",
          description:
            "Optional question about the image(s), e.g. \"What text is on the sign?\" or \"Compare these two screenshots.\" Defaults to a description prompt based on detail.",
        },
        detail: {
          type: "string",
          enum: ["brief", "detailed", "ocr"],
          description:
            "Output style when no question is given: brief (one-two sentences), detailed (full description), ocr (extract all text verbatim). Defaults to detailed.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            content: { type: "string", required: true },
            reasoning: { type: "string" },
            usage: { type: "object", additionalProperties: true },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: typeof value === "object" && value !== null && "content" in value ? value.content : JSON.stringify(value),
          },
        ],
      },
      async execute(args, exec) {
        return runUnderstanding(ctx, { sources: args.images, mediaKind: "image", question: args.question, detail: args.detail }, exec);
      },
    })
  );

  ctx.tools.register(
    defineTool({
      name: "analyze_video",
      description:
        "Understand a video using Xiaomi MiMo V2.5. Accepts one file confined to /workspace, or a public HTTPS video URL. Use it to describe video content or answer questions about it.",
      parameters: {
        video: {
          type: "string",
          required: true,
          description: "Video source: a file under /workspace (e.g. /workspace/clip.mp4) or a public HTTPS URL.",
        },
        question: {
          type: "string",
          description:
            "Optional question about the video, e.g. \"What is happening in this video?\" Defaults to a description prompt based on detail.",
        },
        detail: {
          type: "string",
          enum: ["brief", "detailed"],
          description: "Output style when no question is given: brief or detailed. Defaults to detailed.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            content: { type: "string", required: true },
            reasoning: { type: "string" },
            usage: { type: "object", additionalProperties: true },
          },
        },
        render: (_args, value) => [
          {
            type: "text",
            text: typeof value === "object" && value !== null && "content" in value ? value.content : JSON.stringify(value),
          },
        ],
      },
      async execute(args, exec) {
        return runUnderstanding(ctx, { sources: [args.video], mediaKind: "video", question: args.question, detail: args.detail }, exec);
      },
    })
  );
}

export { apply, inject, name };
