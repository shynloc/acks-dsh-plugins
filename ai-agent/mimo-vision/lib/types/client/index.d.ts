/**
 * Type declarations for the mimo-vision browser half (API Key/Base URL card).
 * The runtime artifact is a ModuleLoader closure-factory bundle; these types
 * describe its exported plugin shape for bundler/type consumers.
 */

declare const clientPlugin: {
  name: string;
  inject: string[];
  apply(ctx: unknown): void;
};

export default clientPlugin;
