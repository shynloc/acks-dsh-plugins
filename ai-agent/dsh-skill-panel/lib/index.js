/**
 * Skills Panel plugin for DeepSeek Harness.
 *
 * Exposes a REST API endpoint at /api/skill-panel/skills that returns
 * the list of all registered skills, and a /api/skill-panel/skills/:name
 * endpoint that returns the full skill content.
 *
 * @module dsh-skill-panel
 */
const name = "dsh-skill-panel";
const inject = ["skills"];

const API_PREFIX = "/api/skill-panel";

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(payload);
}

function apply(ctx) {
  ctx.inject(["webServer"], (httpCtx) => {
    httpCtx.effect(() => httpCtx.webServer.register({
      kind: "prefix",
      path: API_PREFIX,
      async handler(req, res) {
        // CORS preflight
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, OPTIONS",
            "access-control-allow-headers": "content-type",
          });
          res.end();
          return;
        }

        if (req.method !== "GET") {
          jsonResponse(res, 405, { error: "Method not allowed" });
          return;
        }

        const pathname = new URL(req.url ?? "/", "http://x").pathname;
        const sub = pathname.slice(API_PREFIX.length) || "/";

        try {
          // GET /api/skill-panel/skills - list all skills
          if (sub === "/skills" || sub === "/skills/") {
            const skills = await httpCtx.skills.list();
            jsonResponse(res, 200, { ok: true, skills });
            return;
          }

          // GET /api/skill-panel/skills/:name - get full skill content
          const skillMatch = sub.match(/^\/skills\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);
          if (skillMatch) {
            const skillName = skillMatch[1];
            const skill = await httpCtx.skills.get(skillName);
            if (!skill) {
              jsonResponse(res, 404, { ok: false, error: `Skill "${skillName}" not found` });
              return;
            }
            jsonResponse(res, 200, { ok: true, skill });
            return;
          }

          // GET /api/skill-panel/ - info endpoint
          if (sub === "/" || sub === "") {
            jsonResponse(res, 200, {
              ok: true,
              name: "dsh-skill-panel",
              version: "0.1.0",
              endpoints: [
                "GET /api/skill-panel/skills - list all skills",
                "GET /api/skill-panel/skills/:name - get skill details",
              ],
            });
            return;
          }

          jsonResponse(res, 404, { ok: false, error: "Not found" });
        } catch (error) {
          ctx.logger?.warn?.(`skill-panel API error: ${error.message}`);
          jsonResponse(res, 500, { ok: false, error: error.message });
        }
      },
    }), "dsh-skill-panel: API route");
  });
}

export { apply, inject, name };
