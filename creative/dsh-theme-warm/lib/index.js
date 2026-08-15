/**
 * dsh-theme-warm host half.
 *
 * Pure browser-side capability: this package contributes nothing host-side.
 * The row exists so the Loader can mount the package; the browser half rides
 * the exports["./client"] subpath, discovered from the package.json
 * `dsh.client` declaration. This mirrors `@deepseek-ai/dsh-cordis-client-runner`,
 * whose node half is the same empty apply.
 *
 * A production theme plugin that needs to PERSIST its own preference would
 * register a settings namespace here (like dsh-client-ui-theme does with
 * `ui-theme`):
 *
 *   import { settingsNamespace } from "@deepseek-ai/dsh-settings";
 *   import z from "@deepseek-ai/schemastery";
 *   ctx.inject(["settings"], (settingsCtx) => {
 *     settingsCtx.settings.register(
 *       settingsNamespace("theme-warm"),
 *       z.object({ preference: z.union(["light", "dark", "system", "warm"]).default("system") })
 *     );
 *   });
 *
 * and then bind it on the browser side with ctx.settingsScope.bind({ namespace })
 * — see the README for the full sketch.
 */
function apply() {}

export { apply };
