/**
 * dsh-imagegen — OpenAI image-generation plugin for DeepSeek Harness.
 *
 * Registers one agent tool, `generate_image`, backed by the OpenAI Images API
 * (`POST /v1/images/generations`). The default model is `gpt-image-2`, which
 * supports text-to-image with tunable size/quality/format. `dall-e-3` and
 * `dall-e-2` are also accepted with a compatible parameter mapping.
 *
 * The API key and optional OpenAI-compatible base URL are resolved from DSH's
 * credential service under IMAGENEG_API_KEY / IMAGENEG_BASE_URL.
 *
 * Output contract follows the platform's `read_image` pattern: every image is
 * durably committed through the attachment service and written to the
 * workspace. An image content block is emitted ONLY while the current model
 * route declares image input (text-only routes — e.g. the DeepSeek adapter —
 * reject image content and must receive a text-only result instead). On a
 * text-only route the tool still writes the files and returns their paths, so
 * generation works regardless of the model's vision capability.
 *
 * @module dsh-imagegen
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import Schema from "@deepseek-ai/schemastery";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Cordis plugin short name. */
const name = "dsh-imagegen";

/** Services required before this plugin activates. */
const inject = ["tools", "credentials", "attachments"];

/** Credential reference carrying the OpenAI API key. */
const API_KEY_REF = credentialRef("IMAGEGEN_API_KEY");

/** Credential reference carrying an optional OpenAI-compatible API root. */
const BASE_URL_REF = credentialRef("IMAGEGEN_BASE_URL");

/** Default OpenAI-compatible base URL. */
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/** Default image model (latest GPT Image model per OpenAI docs). */
const DEFAULT_MODEL = "gpt-image-2";

/** Dedicated workspace the tool may write generated files into. */
const WORKSPACE_ROOT = process.env.IMAGEGEN_WORKSPACE_ROOT || "/workspace";

/** Default workspace subdirectory for generated images. */
const DEFAULT_OUTPUT_DIR = "images";

/** Upper bound on images per call (gpt-image supports up to 4; dall-e-3 = 1). */
const MAX_IMAGES = 4;

/** Timeout for the generation request (complex prompts can take ~2 minutes). */
const API_TIMEOUT_MS = 300_000;

/** Maximum JSON response body accepted from the API endpoint. */
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

/** Maximum encoded bytes accepted for one generated image. */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

/** Supported output formats and their attachment media types. */
const FORMAT_MIME = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** All accepted models: GPT Image family plus the legacy DALL·E pair. */
const MODEL_ENUM = [
  "gpt-image-2",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
  "dall-e-3",
  "dall-e-2",
];

/** Supported sizes: GPT Image "any resolution" plus the legacy DALL·E sizes. */
const SIZE_ENUM = [
  "auto",
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "2048x2048",
  "2048x1152",
  "1792x1024",
  "1024x1792",
];

/** Whether a canonical path is strictly inside (or equal to) the root. */
function isInside(root, target) {
  const child = relative(root, target);
  if (child === "") return true;
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

/** Resolve the API key from DSH's credential plane. */
async function resolveApiKey(ctx) {
  const credential = await ctx.credentials.resolve(API_KEY_REF);
  if (credential && typeof credential.value === "string" && credential.value.length > 0) {
    return credential.value;
  }
  throw new Error("未配置 OpenAI API Key：请在插件设置中配置 IMAGEGEN_API_KEY");
}

/**
 * Canonicalize and constrain the API destination. Any OpenAI-compatible HTTPS
 * root ending in `/v1` is accepted; the value is a developer-configured
 * credential, never model-controlled input.
 */
function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Base URL 无效：请输入完整的 https:// 地址");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  if (url.protocol !== "https:") {
    throw new Error("Base URL 必须使用 https://");
  }
  if (url.username || url.password) {
    throw new Error("Base URL 不得包含用户名或密码");
  }
  if (url.search || url.hash) {
    throw new Error("Base URL 不得包含查询参数或片段");
  }
  if (pathname !== "/v1") {
    throw new Error("Base URL 必须以 /v1 结尾（例如 https://api.openai.com/v1）");
  }
  const port = url.port ? `:${url.port}` : "";
  return `https://${url.hostname}${port}/v1`;
}

/** Resolve the API destination, defaulting to OpenAI when unset. */
async function resolveBaseUrl(ctx) {
  const credential = await ctx.credentials.resolve(BASE_URL_REF);
  const configured = credential && typeof credential.value === "string" ? credential.value.trim() : "";
  if (configured) return normalizeBaseUrl(configured);
  return DEFAULT_BASE_URL;
}

/** Parse a bounded JSON response without buffering an unbounded body. */
async function readJsonCapped(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("图像 API 返回内容过大");
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
      if (total > MAX_RESPONSE_BYTES) throw new Error("图像 API 返回内容过大");
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

/** Fetch a remote image URL (returned by the API) with a byte cap. */
async function fetchRemoteImage(url, signal) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("图像 API 返回了无效的图片 URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("图像 API 返回的图片 URL 必须使用 https://");
  }
  let res;
  try {
    res = await fetch(parsed.href, { signal });
  } catch (err) {
    throw new Error(`下载生成图片失败（网络错误）: ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`下载生成图片失败: HTTP ${res.status}`);
  }
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
    await res.body?.cancel();
    throw new Error("生成的图片超过 32MB 限制");
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error("生成的图片超过 32MB 限制");
  }
  return buf;
}

/** Decode one `data[]` item into encoded bytes (b64_json preferred). */
async function resolveImageBytes(item, signal) {
  if (typeof item === "object" && item !== null) {
    if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
      return Buffer.from(item.b64_json, "base64");
    }
    if (typeof item.url === "string" && item.url.length > 0) {
      return fetchRemoteImage(item.url, signal);
    }
  }
  throw new Error("图像 API 返回异常：data 项缺少 b64_json / url");
}

/**
 * Read intrinsic pixel dimensions from PNG/JPEG/WebP bytes. Best-effort: the
 * attachment service stays authoritative; this only decorates the text
 * envelope on routes that never commit to the attachment store.
 */
function imageSize(data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  // PNG: 8-byte signature, then IHDR (width/height big-endian at 16/20).
  if (u8.length > 24 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    return { width: u8.readUInt32BE(16), height: u8.readUInt32BE(20) };
  }
  // JPEG: scan for a SOFn marker (C0-CF except C4/C8/CC).
  if (u8.length > 4 && u8[0] === 0xff && u8[1] === 0xd8) {
    let i = 2;
    while (i + 9 < u8.length) {
      if (u8[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = u8[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: u8.readUInt16BE(i + 5), width: u8.readUInt16BE(i + 7) };
      }
      i += 2 + u8.readUInt16BE(i + 2);
    }
    return null;
  }
  // WebP: RIFF....WEBP header with a VP8 /VP8L /VP8X chunk.
  if (
    u8.length > 30 &&
    u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 &&
    u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50
  ) {
    if (u8[12] === 0x56 && u8[13] === 0x50 && u8[14] === 0x38 && u8[15] === 0x20) {
      return { width: u8.readUInt16LE(26) & 0x3fff, height: u8.readUInt16LE(28) & 0x3fff };
    }
    if (u8[12] === 0x56 && u8[13] === 0x50 && u8[14] === 0x38 && u8[15] === 0x4c) {
      const bits = u8.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (u8[12] === 0x56 && u8[13] === 0x50 && u8[14] === 0x38 && u8[15] === 0x58) {
      return { width: u8.readUInt32LE(24) + 1, height: u8.readUInt32LE(28) + 1 };
    }
    return null;
  }
  return null;
}

/** Clamp the requested count to the model's documented maximum. */
function clampN(model, n) {
  const count = Number.isInteger(n) ? n : 1;
  if (model === "dall-e-3") return 1;
  return Math.min(Math.max(count, 1), MAX_IMAGES);
}

/**
 * Build the wire payload, translating the tool's unified parameters into the
 * model family's actual request surface.
 */
function buildPayload(args) {
  const model = args.model || DEFAULT_MODEL;
  const isGptImage = /^gpt-image/.test(model);
  const size = SIZE_ENUM.includes(args.size) ? args.size : "auto";
  const format = FORMAT_MIME[args.output_format] ? args.output_format : "png";
  const n = clampN(model, args.n ?? 1);

  const payload = {
    model,
    prompt: args.prompt,
    n,
  };

  if (isGptImage) {
    payload.output_format = format;
    payload.size = size;
    payload.quality = args.quality === "auto" || args.quality === "low" || args.quality === "high"
      ? args.quality
      : "medium";
    payload.moderation = args.moderation === "low" ? "low" : "auto";
    if (args.seed != null && Number.isInteger(args.seed)) payload.seed = args.seed;
  } else {
    // Legacy DALL·E: always base64 PNG output; no output_format/moderation/seed.
    payload.response_format = "b64_json";
    payload.size = size === "auto" ? "1024x1024" : size;
    if (model === "dall-e-3") {
      payload.quality = args.quality === "high" ? "hd" : "standard";
    }
  }

  return payload;
}

/**
 * Call the OpenAI Images generations endpoint.
 * @returns parsed JSON body.
 */
async function callImagesApi(apiKey, baseUrl, payload, signal) {
  const timeout = AbortSignal.timeout(API_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res;
  try {
    res = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: requestSignal,
    });
  } catch (err) {
    throw new Error(`图像 API 请求失败（网络错误）: ${err.message}`);
  }
  const body = await readJsonCapped(res);
  if (!res.ok) {
    const err = body?.error ?? {};
    const code = typeof err.code === "string" ? err.code : undefined;
    const message = typeof err.message === "string" ? err.message : `HTTP ${res.status}`;
    if (code === "moderation_blocked") {
      const md = err.moderation_details ?? {};
      const stage = typeof md.moderation_stage === "string" ? md.moderation_stage : "unknown";
      const categories = Array.isArray(md.categories) ? md.categories.join("、") : "";
      throw new Error(
        `请求被内容安全策略拦截（moderation_blocked，stage=${stage}${categories ? `，类别：${categories}` : ""}）。请修改提示词后重试。`
      );
    }
    if (err.type === "image_generation_user_error" || code !== undefined) {
      throw new Error(`图像生成失败: ${message}${code ? ` (${code})` : ""}`);
    }
    throw new Error(`图像 API 调用失败: ${message}`);
  }
  return body;
}

/**
 * Whether the current model route declares image input. Returns false instead
 * of throwing — generation is still useful on text-only routes (files are
 * written regardless; only the image content block is withheld).
 */
async function routeSupportsImages(ctx, exec) {
  try {
    const llm = ctx.get("llm");
    const agent = exec.agent;
    if (!llm || !agent) return false;
    const routed = agent.session?.requestHeader?.()?.config;
    const provider = routed?.provider ?? agent.options?.provider;
    const model = routed?.model ?? agent.options?.model;
    if (provider === undefined || model === undefined) return false;
    const info = await llm.resolveModelInfo(provider, model, exec.signal);
    return info.inputModalities !== undefined && info.inputModalities.includes("image");
  } catch {
    return false;
  }
}

/** Resolve and create the workspace-confined output directory. */
async function resolveOutputDir(dir) {
  const root = await realpath(WORKSPACE_ROOT);
  const candidate = isAbsolute(dir) ? dir : resolve(root, dir);
  await mkdir(candidate, { recursive: true });
  const canonical = await realpath(candidate);
  if (!isInside(root, canonical)) {
    throw new Error(`输出目录必须在工作区 ${root} 之内`);
  }
  return canonical;
}

/** Compact a prompt into a filesystem-safe filename stem. */
function slugify(prompt) {
  const stem = String(prompt ?? "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 32);
  return stem || "image";
}

/**
 * Render the canonical value into model-facing content blocks: a summary line,
 * one `<path>` envelope per image, and an image block per attachment when the
 * value carries one.
 */
function renderContent(value) {
  const list = value && Array.isArray(value.images) ? value.images : [];
  const blocks = [];
  blocks.push({
    type: "text",
    text: `Generated ${list.length} image${list.length === 1 ? "" : "s"} with model ${value.model} (size=${value.size}, quality=${value.quality}, format=${value.format}).`,
  });
  for (const img of list) {
    const dim = img.width !== undefined && img.height !== undefined ? `, ${img.width}x${img.height}px` : "";
    blocks.push({
      type: "text",
      text: `<path>${img.path}</path>\n<type>image</type>\n<content>${img.mediaType}${dim}, ${img.bytes} bytes</content>`,
    });
    if (typeof img.attachmentId === "string" && img.attachmentId.length > 0) {
      blocks.push({
        type: "image",
        attachment: {
          attachmentId: AttachmentId(img.attachmentId),
          mediaType: img.mediaType,
          bytes: img.bytes,
          width: img.width,
          height: img.height,
          ...(img.name !== undefined ? { name: img.name } : {}),
        },
      });
    }
  }
  return blocks;
}

/**
 * Shared execute path.
 * @param ctx - Cordis context.
 * @param args - tool arguments ({ prompt, model, size, quality, n, output_format, moderation, seed, output_dir }).
 * @param exec - tool run context (signal, agent, parent).
 */
async function runGeneration(ctx, args, exec) {
  const apiKey = await resolveApiKey(ctx);
  const baseUrl = await resolveBaseUrl(ctx);
  const payload = buildPayload(args);

  const body = await callImagesApi(apiKey, baseUrl, payload, exec.signal);
  const items = Array.isArray(body?.data) ? body.data : [];
  if (items.length === 0) {
    throw new Error("图像 API 返回异常：缺少 data 数组");
  }

  const format = payload.output_format ?? "png";
  const mediaType = FORMAT_MIME[format] ?? "image/png";
  const outDir = await resolveOutputDir(args.output_dir || DEFAULT_OUTPUT_DIR);

  const imageCapable = await routeSupportsImages(ctx, exec);
  const attachments = ctx.get("attachments");

  const slug = slugify(args.prompt);
  const stamp = Date.now().toString(36);
  const images = [];

  for (let i = 0; i < items.length; i++) {
    const bytes = await resolveImageBytes(items[i], exec.signal);
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new Error(`生成的第 ${i + 1} 张图片超过 32MB 限制`);
    }
    const size = imageSize(bytes);
    const fileName = `${slug}-${stamp}-${i + 1}.${format}`;
    const filePath = resolve(outDir, fileName);
    await writeFile(filePath, bytes);

    const entry = {
      path: filePath,
      mediaType,
      bytes: bytes.length,
      name: fileName,
    };
    if (size) {
      entry.width = size.width;
      entry.height = size.height;
    }

    // Commit through the attachment service only while the route can carry
    // image content; the attachment ref is authoritative for dimensions.
    if (imageCapable && attachments) {
      const ref = await attachments.saveImage({ data: bytes, mediaType, name: fileName });
      entry.attachmentId = ref.attachmentId;
      entry.mediaType = ref.mediaType;
      entry.bytes = ref.bytes;
      entry.width = ref.width;
      entry.height = ref.height;
      entry.name = ref.name;
    }

    images.push(entry);
  }

  const value = {
    model: payload.model,
    prompt: args.prompt,
    size: payload.size,
    quality: payload.quality ?? "medium",
    format,
    images,
  };

  // Nested dispatch ferries the image back to the parent as a user message
  // (the same contract `read_image` uses); top-level results already carry the
  // image block through their own content.
  if (exec.parent !== undefined && imageCapable) {
    exec.deferContext(
      createUserMessage({
        content: renderContent(value),
        source: { kind: "plugin", plugin: "dsh-imagegen" },
      })
    );
  }

  return value;
}

/** Plugin entry: register the `generate_image` tool. */
function apply(ctx) {
  ctx.inject(["settings"], function (settingsCtx) {
    settingsCtx.settings.register("dsh-imagegen", Schema.object({}));
  });

  ctx.tools.register(
    defineTool({
      name: "generate_image",
      description:
        "Generate one or more images from a text prompt using OpenAI's image models (default gpt-image-2). " +
        "Images are written into the workspace (default /workspace/images/) and returned with their absolute paths. " +
        "Supports tunable size, quality, output format, and seed. Requires IMAGEGEN_API_KEY to be configured.",
      parameters: {
        prompt: {
          type: "string",
          required: true,
          description:
            "The text prompt describing the image to generate. Be specific about subject, style, composition, lighting, and any in-image text (quote exact copy).",
        },
        model: {
          type: "string",
          enum: MODEL_ENUM,
          description: "Image model. Defaults to gpt-image-2.",
        },
        size: {
          type: "string",
          enum: SIZE_ENUM,
          description:
            "Output size. gpt-image models accept auto or any WxH (multiples of 16, ratio <= 3:1); dall-e-3 accepts 1024x1024/1792x1024/1024x1792; dall-e-2 accepts 1024x1024. Defaults to auto (gpt-image) or 1024x1024.",
        },
        quality: {
          type: "string",
          enum: ["auto", "low", "medium", "high"],
          description:
            "Rendering quality (low is fastest, high is best). Defaults to medium. dall-e-3 maps low/medium->standard and high->hd.",
        },
        n: {
          type: "integer",
          description: "Number of images to generate (1-4; dall-e-3 always 1). Defaults to 1.",
        },
        output_format: {
          type: "string",
          enum: ["png", "jpeg", "webp"],
          description: "Output file format. Defaults to png. jpeg is faster than png.",
        },
        moderation: {
          type: "string",
          enum: ["auto", "low"],
          description: "Content moderation strictness for gpt-image models. Defaults to auto.",
        },
        seed: {
          type: "integer",
          description: "Optional seed for reproducible results (gpt-image models only).",
        },
        output_dir: {
          type: "string",
          description: "Workspace subdirectory to save files into. Defaults to images (i.e. /workspace/images/).",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            model: { type: "string", required: true },
            prompt: { type: "string", required: true },
            size: { type: "string", required: true },
            quality: { type: "string", required: true },
            format: { type: "string", required: true },
            images: {
              type: "array",
              required: true,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  path: { type: "string", required: true },
                  mediaType: { type: "string", required: true },
                  bytes: { type: "integer", required: true },
                  width: { type: "integer" },
                  height: { type: "integer" },
                  name: { type: "string" },
                  attachmentId: { type: "string" },
                },
              },
            },
          },
        },
        render: (_args, value) => renderContent(value),
      },
      async execute(args, exec) {
        return runGeneration(ctx, args, exec);
      },
      presentCall(args) {
        return {
          card: "generic",
          kind: "other",
          title: `Generate image: ${String(args.prompt ?? "").slice(0, 60)}`,
          locations: [{ path: args.output_dir || DEFAULT_OUTPUT_DIR }],
        };
      },
    })
  );
}

export { apply, inject, name };
