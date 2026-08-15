import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-theme-jintao-retro'
export const inject = ['webServer']

const ASSET_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const ASSETS = new Map([
  ['console-chassis-static.webp', 'image/webp'],
  ['session-cartridge-up.webp', 'image/webp'],
  ['session-cartridge-active.webp', 'image/webp'],
  ['deck-key-up.webp', 'image/webp'],
  ['deck-key-down-v2.webp', 'image/webp'],
  ['composer-key-up.webp', 'image/webp'],
  ['composer-key-down.webp', 'image/webp'],
  ['model-selector-up.webp', 'image/webp'],
  ['model-selector-down-v2.webp', 'image/webp'],
  ['send-key-up.webp', 'image/webp'],
  ['send-key-down.webp', 'image/webp'],
  ['approval-card-frame.webp', 'image/webp'],
  ['question-card-frame.webp', 'image/webp'],
  ['plan-card-frame.webp', 'image/webp'],
  ['modal-panel.webp', 'image/webp'],
  ['modal-panel-frame.webp', 'image/webp'],
  ['menu-panel.webp', 'image/webp'],
  ['toast-panel.webp', 'image/webp'],
  ['mobile-pda-branded.webp', 'image/webp'],
])

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/jintao-retro-assets',
    async handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }

      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
      const name = pathname.slice('/jintao-retro-assets/'.length)
      const contentType = ASSETS.get(name)
      if (contentType === undefined || name.includes('/') || name.includes('\\')) {
        res.writeHead(404)
        res.end()
        return
      }

      try {
        const body = await readFile(join(ASSET_ROOT, name))
        res.writeHead(200, {
          'content-type': contentType,
          'content-length': String(body.byteLength),
          'cache-control': 'public, max-age=86400',
        })
        if (req.method === 'HEAD') res.end()
        else res.end(body)
      } catch {
        res.writeHead(404)
        res.end()
      }
    },
  }), 'dsh-theme-jintao-retro: raster asset route')
}
