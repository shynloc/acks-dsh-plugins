/**
 * dsh-restart-web host half.
 *
 * Registers one exact HTTP route, POST /api/restart-web, on the webServer
 * service. The webserver matches the exact table before the gateway's /api
 * prefix route, so this path is ours alone. The handler answers 200, then
 * requests the launcher-provided `appExit` service — the same exit request
 * dsh-headless uses — which runs the graceful process shutdown
 * (dispose the whole cordis tree, then process.exitCode).
 *
 * 监督模型（重要）：
 *  - 本插件只负责“优雅退出进程”。退出之后由谁把服务拉起来，取决于部署：
 *    容器（docker restart:always / compose restart）、systemd、pm2、
 *    或一个 while/retry 包装脚本。
 *  - 若没有监督者，点按钮 = 服务优雅停机，需要手动重新启动 `dsh web`。
 *  - 在容器里不要用“spawn 一个 detached 子进程自重启”的方案：容器主进程
 *    （docker-init）随 node 退出后容器停止，detached 孙进程也会被一并清掉。
 *
 * 安全守卫：拒绝跨站请求（CSRF）。浏览器跨源 fetch 会带 sec-fetch-site:
 * cross-site，这里只放行 same-origin/none；非浏览器客户端（curl）不带
 * 这些头，按 Origin 与 Host 比对兜底。
 */
const RESTART_PATH = "/api/restart-web";
/** 响应写完后稍等再退出，确保浏览器收到 200 而不是连接重置。 */
const EXIT_DELAY_MS = 500;

/**
 * Whether a request may trigger a process restart.
 * @param req - node IncomingMessage.
 * @returns true for same-origin browser requests and non-browser clients without a cross-site context.
 */
function isSameOrigin(req) {
	const site = req.headers["sec-fetch-site"];
	if (typeof site === "string") return site === "same-origin" || site === "none";
	const origin = req.headers.origin;
	if (origin === undefined) return true;
	const host = req.headers.host;
	if (host === undefined) return false;
	try {
		return new URL(origin).host === host;
	} catch {
		return false;
	}
}

function apply(ctx) {
	const exit = ctx.get("appExit");
	if (exit === void 0) {
		throw new Error("dsh-restart-web: the launcher must provide ctx.appExit before the tree mounts");
	}
	ctx.inject(["webServer"], (httpCtx) => {
		httpCtx.effect(() => {
			const disposeRoute = httpCtx.webServer.register({
				kind: "exact",
				path: RESTART_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") {
						res.writeHead(405, { "content-type": "application/json" });
						res.end(JSON.stringify({ ok: false, error: "method-not-allowed" }));
						return;
					}
					if (!isSameOrigin(req)) {
						res.writeHead(403, { "content-type": "application/json" });
						res.end(JSON.stringify({ ok: false, error: "cross-origin" }));
						return;
					}
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({ ok: true }));
					setTimeout(() => exit(0), EXIT_DELAY_MS);
				}
			});
			return disposeRoute;
		}, "dsh-restart-web: restart route");
	});
}

export { RESTART_PATH, apply, isSameOrigin };
