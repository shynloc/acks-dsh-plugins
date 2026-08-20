/** Secure workspace-local MP4/WebM playback for DeepSeek Harness. */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { homedir } from "node:os";
import { join } from "node:path";

import { createVideoHandler, VIDEO_ROUTE } from "./http.js";
import { storeVideo } from "./store.js";

const name = "dsh-video";
const inject = ["tools"];
const STORE_DIR = process.env.DSH_VIDEO_STORE_DIR ?? join(homedir(), ".dsh", "videos");
const WORKSPACE_ROOT = process.env.DSH_VIDEO_WORKSPACE_ROOT ?? "/workspace";

function renderVideo(value) {
  return [{
    type: "text",
    text: JSON.stringify({
      type: "video",
      path: value.path,
      mediaType: value.video.mediaType,
      bytes: value.video.bytes,
      name: value.video.name,
    }),
  }];
}

function videoPresentation(value) {
  return {
    kind: "dsh-video",
    version: 1,
    video: {
      id: value.video.id,
      mediaType: value.video.mediaType,
      bytes: value.video.bytes,
      name: value.video.name,
    },
  };
}

function apply(ctx) {
  const handler = createVideoHandler({ storeDir: STORE_DIR });
  ctx.inject(["webServer"], (httpCtx) => {
    httpCtx.effect(() => httpCtx.webServer.register({
      kind: "prefix",
      path: VIDEO_ROUTE,
      handler,
    }), "dsh-video: media route");
  });

  ctx.tools.register(defineTool({
    name: "read_video",
    description: "Display an MP4 or WebM file from /workspace as a playable, downloadable video in the conversation. Remote URLs and paths outside /workspace are rejected. Maximum size: 200 MiB.",
    parameters: {
      file_path: {
        type: "string",
        required: true,
        description: "An MP4/WebM path inside /workspace, for example /workspace/videos/demo.mp4.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", required: true },
          video: {
            type: "object",
            required: true,
            additionalProperties: false,
            properties: {
              id: { type: "string", required: true },
              mediaType: { type: "string", required: true, enum: ["video/mp4", "video/webm"] },
              bytes: { type: "integer", required: true },
              name: { type: "string", required: true },
            },
          },
        },
      },
      render: (_args, value) => renderVideo(value),
      presentationMeta: (_args, value) => videoPresentation(value),
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return storeVideo(args.file_path, {
        workspaceRoot: WORKSPACE_ROOT,
        storeDir: STORE_DIR,
        signal: exec.signal,
      });
    },
    presentCall(args) {
      const path = typeof args?.file_path === "string" ? args.file_path : "video";
      return {
        card: "generic",
        kind: "read",
        title: "Read video",
        rawInput: path,
        locations: [{ path }],
      };
    },
  }));
}

export { apply, inject, name };

