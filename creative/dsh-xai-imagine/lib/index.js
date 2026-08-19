/**
 * xAI Grok Imagine Image 2.0 plugin for DeepSeek Harness.
 *
 * This intentionally targets only xAI's official endpoint, api.x.ai, to make
 * credential and transport failures independent of OpenAI-compatible proxies.
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import Schema from "@deepseek-ai/schemastery";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const name = "dsh-xai-imagine";
const inject = ["tools", "credentials", "attachments"];
const API_KEY_REF = credentialRef("XAI_API_KEY");
const API_ROOT = "https://api.x.ai/v1";
const MODEL = "grok-imagine-image-2.0";
const WORKSPACE_ROOT = process.env.XAI_IMAGINE_WORKSPACE_ROOT || "/workspace";
const DEFAULT_OUTPUT_DIR = "images";
const MAX_IMAGES = 4;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const API_TIMEOUT_MS = 300_000;
const PREVIEW_PATH = "/api/xai-imagine/images";
const PREVIEW_TTL_MS = 15 * 60_000;
const ASPECT_RATIOS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20"];
const MIME_BY_EXTENSION = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

function isInside(root, target) {
  const child = relative(root, target);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

async function resolveApiKey(ctx) {
  const credential = await ctx.credentials.resolve(API_KEY_REF);
  if (credential && typeof credential.value === "string" && credential.value.trim()) return credential.value;
  throw new Error("未配置 xAI API Key：请在插件设置中配置 XAI_API_KEY");
}

async function readJsonCapped(response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("xAI API 返回内容过大");
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
      if (total > MAX_RESPONSE_BYTES) throw new Error("xAI API 返回内容过大");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))));
  } catch {
    return {};
  }
}

function requestSignal(signal) {
  const timeout = AbortSignal.timeout(API_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function callXai(apiKey, path, payload, signal) {
  let response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      signal: requestSignal(signal),
    });
  } catch (error) {
    throw new Error(`xAI 官方 API 请求失败（网络错误）: ${error.message}`);
  }
  const body = await readJsonCapped(response);
  if (!response.ok) {
    const error = body?.error ?? {};
    const message = typeof error.message === "string" ? error.message : `HTTP ${response.status}`;
    const code = typeof error.code === "string" ? ` (${error.code})` : "";
    throw new Error(`xAI Grok Imagine 调用失败: ${message}${code}`);
  }
  return body;
}

async function fetchRemoteImage(url, signal) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("xAI API 返回了无效的图片 URL"); }
  if (parsed.protocol !== "https:") throw new Error("xAI API 返回的图片 URL 必须使用 https://");
  let response;
  try { response = await fetch(parsed.href, { signal }); } catch (error) { throw new Error(`下载 xAI 图片失败（网络错误）: ${error.message}`); }
  if (!response.ok) throw new Error(`下载 xAI 图片失败: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("生成的图片超过 32MB 限制");
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0] || "image/jpeg";
  return { bytes, mediaType };
}

function imageFromResponse(item) {
  if (item && typeof item.b64_json === "string" && item.b64_json) {
    const bytes = Buffer.from(item.b64_json, "base64");
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error("生成的图片超过 32MB 限制");
    return { bytes, mediaType: "image/jpeg" };
  }
  throw new Error("xAI API 返回异常：data 项缺少 b64_json");
}

function publicOrigin() {
  const configured = process.env.DSH_PUBLIC_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const at = process.argv.indexOf("--trusted-host");
  const host = at === -1 ? undefined : process.argv[at + 1];
  if (host) return `https://${host}`;
  return process.env.DSH_WEB_URL?.replace(/\/+$/, "") || "http://127.0.0.1:3080";
}

function createPreview(previews, bytes, mediaType) {
  const token = randomBytes(24).toString("base64url");
  previews.set(token, { bytes, mediaType, expiresAt: Date.now() + PREVIEW_TTL_MS });
  return `${publicOrigin()}${PREVIEW_PATH}/${token}`;
}

function imageSize(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
      const length = bytes.readUInt16BE(i + 2);
      if (length < 2) return null;
      i += length + 2;
    }
  }
  return null;
}

async function resolveOutputDir(dir) {
  const root = await realpath(WORKSPACE_ROOT);
  const candidate = isAbsolute(dir) ? dir : resolve(root, dir);
  await mkdir(candidate, { recursive: true });
  const canonical = await realpath(candidate);
  if (!isInside(root, canonical)) throw new Error(`输出目录必须在工作区 ${root} 之内`);
  return canonical;
}

function slugify(value) {
  const stem = String(value ?? "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 32);
  return stem || "xai-image";
}

function extensionFor(mediaType) {
  if (mediaType === "image/png") return "png";
  if (mediaType === "image/webp") return "webp";
  return "jpg";
}

async function routeSupportsImages(ctx, exec) {
  try {
    const llm = ctx.get("llm");
    const agent = exec.agent;
    if (!llm || !agent) return false;
    const routed = agent.session?.requestHeader?.()?.config;
    const info = await llm.resolveModelInfo(routed?.provider ?? agent.options?.provider, routed?.model ?? agent.options?.model, exec.signal);
    return info.inputModalities?.includes("image") === true;
  } catch { return false; }
}

function renderContent(value) {
  const images = Array.isArray(value?.images) ? value.images : [];
  const blocks = [{ type: "text", text: `xAI Grok Imagine generated ${images.length} image${images.length === 1 ? "" : "s"} (model=${value.model}, aspect_ratio=${value.aspectRatio}, resolution=${value.resolution}, quality=${value.quality}).` }];
  for (const image of images) {
    const dimensions = image.width !== undefined && image.height !== undefined ? `, ${image.width}x${image.height}px` : "";
    blocks.push({ type: "text", text: `<path>${image.path}</path>\n<type>image</type>\n<content>${image.mediaType}${dimensions}, ${image.bytes} bytes</content>\n<preview_url>${image.previewUrl}</preview_url>\nDisplay this image in the user-facing reply with Markdown: ![Generated xAI image](${image.previewUrl})` });
    if (image.attachmentId) blocks.push({ type: "image", attachment: { attachmentId: AttachmentId(image.attachmentId), mediaType: image.mediaType, bytes: image.bytes, width: image.width, height: image.height, ...(image.name ? { name: image.name } : {}) } });
  }
  return blocks;
}

async function saveResponseImages(ctx, previews, args, exec, payload, body) {
  const items = Array.isArray(body?.data) ? body.data : [];
  if (!items.length) throw new Error("xAI API 返回异常：缺少 data 数组");
  const outputDir = await resolveOutputDir(args.output_dir || DEFAULT_OUTPUT_DIR);
  const imageCapable = await routeSupportsImages(ctx, exec);
  const attachments = ctx.get("attachments");
  const stamp = Date.now().toString(36);
  const images = [];
  for (let i = 0; i < items.length; i += 1) {
    const output = imageFromResponse(items[i]);
    const size = imageSize(output.bytes);
    const fileName = `${slugify(args.prompt)}-${stamp}-${i + 1}.${extensionFor(output.mediaType)}`;
    const path = resolve(outputDir, fileName);
    await writeFile(path, output.bytes);
    const image = { path, previewUrl: createPreview(previews, output.bytes, output.mediaType), mediaType: output.mediaType, bytes: output.bytes.length, name: fileName };
    if (size) Object.assign(image, size);
    if (imageCapable && attachments) {
      const ref = await attachments.saveImage({ data: output.bytes, mediaType: output.mediaType, name: fileName });
      Object.assign(image, { attachmentId: ref.attachmentId, mediaType: ref.mediaType, bytes: ref.bytes, width: ref.width, height: ref.height, name: ref.name });
    }
    images.push(image);
  }
  const value = { model: MODEL, prompt: args.prompt, aspectRatio: payload.aspect_ratio ?? "auto", resolution: payload.resolution ?? "1k", quality: payload.quality ?? "medium", images };
  if (exec.parent !== undefined && imageCapable && typeof exec.deferContext === "function") exec.deferContext(createUserMessage({ content: renderContent(value), source: { kind: "plugin", plugin: name } }));
  return value;
}

async function localImageDataUri(input) {
  const root = await realpath(WORKSPACE_ROOT);
  const candidate = isAbsolute(input) ? input : resolve(root, input);
  let canonical;
  try { canonical = await realpath(candidate); } catch { throw new Error(`无法读取本地图片: ${input}`); }
  if (!isInside(root, canonical)) throw new Error(`编辑原图必须在工作区 ${root} 之内`);
  const bytes = await readFile(canonical);
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error("编辑原图超过 32MB 限制");
  const mediaType = MIME_BY_EXTENSION[extname(canonical).toLowerCase()];
  if (!mediaType) throw new Error("编辑原图仅支持 PNG、JPEG、WebP 或 GIF");
  return `data:${mediaType};base64,${bytes.toString("base64")}`;
}

async function sourceImageValue(input) {
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(input)) return input;
  if (/^https:\/\//i.test(input)) return input;
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) throw new Error("编辑原图 URL 必须使用 https://，或提供工作区文件路径 / data URI");
  return localImageDataUri(input);
}

function outputSchema() {
  return { type: "object", additionalProperties: false, properties: {
    model: { type: "string", required: true }, prompt: { type: "string", required: true }, aspectRatio: { type: "string", required: true }, resolution: { type: "string", required: true }, quality: { type: "string", required: true },
    images: { type: "array", required: true, items: { type: "object", additionalProperties: false, properties: { path: { type: "string", required: true }, previewUrl: { type: "string", required: true }, mediaType: { type: "string", required: true }, bytes: { type: "integer", required: true }, width: { type: "integer" }, height: { type: "integer" }, name: { type: "string" }, attachmentId: { type: "string" } } } }
  } };
}

function generationPayload(args) {
  return { model: MODEL, prompt: args.prompt, n: Math.min(Math.max(Number.isInteger(args.n) ? args.n : 1, 1), MAX_IMAGES), aspect_ratio: ASPECT_RATIOS.includes(args.aspect_ratio) ? args.aspect_ratio : "auto", resolution: args.resolution === "2k" ? "2k" : "1k", quality: args.quality === "low" ? "low" : "medium", response_format: "b64_json" };
}

function apply(ctx) {
  ctx.inject(["settings"], function (settingsCtx) {
    settingsCtx.settings.register("dsh-xai-imagine", Schema.object({}));
  });

  const previews = new Map();
  ctx.inject(["webServer"], (httpCtx) => {
    httpCtx.effect(() => httpCtx.webServer.register({
      kind: "prefix",
      path: PREVIEW_PATH,
      handler(req, res) {
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405, { Allow: "GET, HEAD" });
          res.end();
          return;
        }
        const now = Date.now();
        for (const [token, entry] of previews) if (entry.expiresAt <= now) previews.delete(token);
        const pathname = new URL(req.url ?? "/", "http://x").pathname;
        const token = pathname.slice(`${PREVIEW_PATH}/`.length);
        if (!/^[A-Za-z0-9_-]{32}$/.test(token)) {
          res.writeHead(404);
          res.end();
          return;
        }
        const preview = previews.get(token);
        if (!preview) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, {
          "content-type": preview.mediaType,
          "content-length": preview.bytes.length,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        });
        if (req.method === "GET") res.end(preview.bytes);
        else res.end();
      },
    }), "dsh-xai-imagine: preview route");
  });

  ctx.tools.register(defineTool({
    name: "generate_xai_image",
    description: "Generate images with xAI's official Grok Imagine Image 2.0 API. This tool always calls https://api.x.ai/v1 directly, never an OpenAI-compatible relay. Images are saved under /workspace/images by default. Requires XAI_API_KEY.",
    parameters: { prompt: { type: "string", required: true, description: "Detailed image prompt, including subject, composition, style, lighting, and exact text where needed." }, n: { type: "integer", description: "Number of variations, 1-4; defaults to 1." }, aspect_ratio: { type: "string", enum: ASPECT_RATIOS, description: "Output aspect ratio; defaults to auto." }, resolution: { type: "string", enum: ["1k", "2k"], description: "Output resolution; defaults to 1k." }, quality: { type: "string", enum: ["low", "medium"], description: "Rendering quality; defaults to medium." }, output_dir: { type: "string", description: "Workspace subdirectory for output files; defaults to images." } },
    output: { schema: outputSchema(), render: (_args, value) => renderContent(value) },
    async execute(args, exec) { const payload = generationPayload(args); return saveResponseImages(ctx, previews, args, exec, payload, await callXai(await resolveApiKey(ctx), "/images/generations", payload, exec.signal)); },
    presentCall(args) { return { card: "generic", kind: "other", title: `xAI Imagine: ${String(args.prompt).slice(0, 60)}`, locations: [{ path: args.output_dir || DEFAULT_OUTPUT_DIR }] }; }
  }));

  ctx.tools.register(defineTool({
    name: "edit_xai_image",
    description: "Edit an existing image with xAI's official Grok Imagine Image 2.0 API. `image` may be an HTTPS image URL, a base64 data URI, or a PNG/JPEG/WebP/GIF file inside the workspace. This sends xAI's JSON /images/edits contract, not OpenAI multipart form data. Requires XAI_API_KEY.",
    parameters: { prompt: { type: "string", required: true, description: "Describe the requested edit precisely." }, image: { type: "string", required: true, description: "HTTPS image URL, base64 data URI, or workspace-local source image path." }, aspect_ratio: { type: "string", enum: ASPECT_RATIOS, description: "Output aspect ratio; defaults to auto." }, resolution: { type: "string", enum: ["1k", "2k"], description: "Output resolution; defaults to 1k." }, quality: { type: "string", enum: ["low", "medium"], description: "Rendering quality; defaults to medium." }, output_dir: { type: "string", description: "Workspace subdirectory for output files; defaults to images." } },
    output: { schema: outputSchema(), render: (_args, value) => renderContent(value) },
    async execute(args, exec) { const payload = { ...generationPayload(args), image: { url: await sourceImageValue(args.image), type: "image_url" } }; delete payload.n; return saveResponseImages(ctx, previews, args, exec, payload, await callXai(await resolveApiKey(ctx), "/images/edits", payload, exec.signal)); },
    presentCall(args) { return { card: "generic", kind: "other", title: `xAI Imagine edit: ${String(args.prompt).slice(0, 60)}`, locations: [{ path: args.image }, { path: args.output_dir || DEFAULT_OUTPUT_DIR }] }; }
  }));
}

export { apply, inject, name };
