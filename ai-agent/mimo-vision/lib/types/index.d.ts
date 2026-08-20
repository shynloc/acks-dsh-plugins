/**
 * Type declarations for mimo-vision.
 * The plugin is a Cordis plugin: default export shape is the plugin object
 * ({ name, inject, apply }).
 */

export interface AnalyzeImageArgs {
  /** One or more workspace-local file paths or public HTTPS image URLs. */
  images: string[];
  /** Optional question about the image(s). */
  question?: string;
  /** Output style when no question is given: brief | detailed | ocr. */
  detail?: "brief" | "detailed" | "ocr";
}

export interface AnalyzeVideoArgs {
  /** Workspace-local file path or public HTTPS video URL. */
  video: string;
  /** Optional question about the video. */
  question?: string;
  /** Output style when no question is given: brief | detailed. */
  detail?: "brief" | "detailed";
}

export interface MimoResult {
  /** The model's answer text. */
  content: string;
  /** Optional chain-of-thought from the model. */
  reasoning?: string;
  /** Token usage from the API response, when present. */
  usage?: Record<string, unknown>;
}

declare const plugin: {
  name: string;
  inject: string[];
  apply(ctx: unknown): void;
};

export default plugin;
