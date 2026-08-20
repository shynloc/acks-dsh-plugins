/** Host-half type surface for dsh-imagegen. @module dsh-imagegen */

/** Cordis plugin short name. */
export declare const name: string;

/** Services required before this plugin activates. */
export declare const inject: string[];

/** Cordis plugin entry: registers the `generate_image` tool. */
export declare function apply(ctx: unknown): void;
