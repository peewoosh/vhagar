import { Hono } from 'hono'
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'fs'
import { join, resolve, basename, extname } from 'path'
import { randomBytes, createHash } from 'crypto'
import { spawn } from 'child_process'
import { getCookie, setCookie } from 'hono/cookie'
import { share as cfg } from '../../config'

const AUTH_COOKIE = 'share_auth'
const VIDEO_EXTS  = new Set(['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.wmv'])

function cookieHash() {
  return createHash('sha256').update(cfg.password).digest('hex')
}

function authed(c: Parameters<typeof getCookie>[0]): boolean {
  if (!cfg.password) return true
  return getCookie(c, AUTH_COOKIE) === cookieHash()
}

function fmtSize(b: number) {
  return b >= 1e9 ? `${(b / 1e9).toFixed(2)} gb` : `${(b / 1e6).toFixed(0)} mb`
}

function fmtEpisodeName(filename: string): string {
  const noExt = filename.replace(/\.[^.]+$/, '')
  const m = noExt.match(/[Ss](\d{2})[Ee](\d{2})\s*[-–]\s*(.+?)(?:\s*[\[(].+)?$/)
  if (m) return `S${m[1]}E${m[2]} · ${m[3].trim()}`
  return noExt
}

function passwordPage(token: string, error = false) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>protected</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0d0d0d;color:#aaa;font-family:monospace;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .wrap{width:280px}
  .label{font-size:10px;color:#444;letter-spacing:0.1em;margin-bottom:8px}
  input{display:block;width:100%;padding:10px 12px;background:transparent;border:1px dashed #333;color:#fff;font-family:monospace;font-size:12px;outline:none;margin-bottom:10px}
  input:focus{border-color:#666}
  button{display:block;width:100%;padding:10px 12px;background:transparent;border:1px dashed #444;color:#aaa;font-family:monospace;font-size:12px;cursor:pointer;letter-spacing:0.05em}
  button:hover{border-color:#888;color:#fff}
  .err{font-size:10px;color:#c0392b;font-style:italic;margin-bottom:10px}
</style>
</head>
<body>
<div class="wrap">
  <div class="label">password required</div>
  ${error ? '<div class="err">incorrect password</div>' : ''}
  <form method="POST" action="/f/${token}">
    <input type="password" name="pw" autofocus placeholder="password">
    <button type="submit">enter</button>
  </form>
</div>
</body>
</html>`
}

type ShareEntry = { path: string; name: string; expires: string; poster?: string }

function loadLinks(): Record<string, ShareEntry> {
  const file = join(cfg.dataDir, 'shares.json')
  if (!existsSync(file)) return {}
  try { return JSON.parse(readFileSync(file, 'utf-8')) } catch { return {} }
}

function saveLinks(links: Record<string, ShareEntry>) {
  mkdirSync(cfg.dataDir, { recursive: true })
  writeFileSync(join(cfg.dataDir, 'shares.json'), JSON.stringify(links, null, 2))
}

function purgeExpired(links: Record<string, ShareEntry>) {
  const now = new Date().toISOString()
  return Object.fromEntries(Object.entries(links).filter(([, v]) => v.expires > now))
}

function isAllowed(p: string) {
  const m = resolve(cfg.moviesRoot)
  const t = resolve(cfg.tvRoot)
  return p.startsWith(m + '/') || p.startsWith(t + '/')
}

export const createRouter = new Hono()

createRouter.get('/share', (c) => c.json({ enabled: !!cfg.baseUrl }))

createRouter.post('/share', async (c) => {
  if (!cfg.baseUrl) return c.json({ error: 'share not configured' }, 404)

  type Body = { path?: string; poster?: string; season?: number; name?: string }
  let body: Body = {}
  try { body = await c.req.json<Body>() } catch {}
  const raw  = (body.path ?? '').trim()
  if (!raw) return c.json({ error: 'path required' }, 400)

  let full = raw.startsWith('/') ? resolve(raw) : resolve(cfg.moviesRoot, raw)
  if (!isAllowed(full)) return c.json({ error: 'invalid path' }, 400)

  if (body.season !== undefined) {
    const padded = String(body.season).padStart(2, '0')
    let seasonDir: string | undefined
    try {
      seasonDir = readdirSync(full).find(d => {
        const dl = d.toLowerCase()
        return dl === `season ${padded}` || dl === `season ${body.season}`
      })
    } catch {
      return c.json({ error: 'not found' }, 404)
    }
    if (!seasonDir) return c.json({ error: 'season folder not found' }, 404)
    full = join(full, seasonDir)
  }

  try {
    if (!statSync(full).isDirectory()) return c.json({ error: 'not a directory' }, 400)
  } catch {
    return c.json({ error: 'not found' }, 404)
  }

  const token   = randomBytes(12).toString('base64url')
  const expires = new Date(Date.now() + cfg.expiryDays * 86_400_000).toISOString()
  const links   = purgeExpired(loadLinks())
  links[token]  = { path: full, name: body.name ?? basename(full), expires, poster: body.poster ?? undefined }
  saveLinks(links)

  return c.json({ url: `${cfg.baseUrl}/f/${token}` })
})

export const serveRouter = new Hono()

serveRouter.post('/:token', async (c) => {
  const token = c.req.param('token')
  const body  = await c.req.parseBody()
  if (body['pw'] === cfg.password) {
    setCookie(c, AUTH_COOKIE, cookieHash(), { path: '/', httpOnly: true, sameSite: 'Lax' })
    return c.redirect(`/f/${token}`, 302)
  }
  return c.html(passwordPage(token, true))
})

serveRouter.get('/:token', async (c) => {
  const token = c.req.param('token')
  if (!authed(c)) return c.html(passwordPage(token))

  const links = purgeExpired(loadLinks())
  saveLinks(links)

  const entry = links[token]
  if (!entry) return c.text('not found', 404)
  if (!isAllowed(entry.path)) return c.text('forbidden', 403)

  type FileInfo = { name: string; size: number }
  let allFiles: FileInfo[] = []
  try {
    allFiles = readdirSync(entry.path)
      .filter(f => !f.startsWith('.'))
      .map(f => {
        try { return { name: f, size: statSync(join(entry.path, f)).size } } catch { return null }
      })
      .filter(Boolean) as FileInfo[]
  } catch {}

  const videoFiles = allFiles.filter(f => VIDEO_EXTS.has(extname(f.name).toLowerCase()))
  const isShow     = videoFiles.length > 1 && videoFiles.some(f => /[Ss]\d{2}[Ee]\d{2}/.test(f.name))
  const totalSize  = allFiles.reduce((s, f) => s + f.size, 0)
  const expires    = new Date(entry.expires).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  const posterHtml = entry.poster
    ? `<img class="poster" src="${entry.poster}" alt="">`
    : ''

  const CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0d0d0d;color:#aaa;font-family:monospace;min-height:100vh}
  .wrap{max-width:480px;margin:0 auto;padding:24px 16px}
  .poster{width:100%;aspect-ratio:2/3;object-fit:cover;display:block;margin-bottom:16px;border:1px dashed #2a2a2a}
  .title{font-size:13px;color:#fff;margin-bottom:4px}
  .meta{font-size:10px;color:#444;font-style:italic;margin-bottom:20px;letter-spacing:0.05em}
  .dl-btn{display:block;width:100%;padding:11px 14px;background:transparent;border:1px dashed #444;color:#aaa;font-family:monospace;font-size:12px;text-align:center;text-decoration:none;cursor:pointer;letter-spacing:0.05em;margin-bottom:8px}
  .dl-btn:hover{border-color:#888;color:#fff}
  .ep-list{border:1px dashed #2a2a2a;margin-bottom:12px}
  .ep-row{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-bottom:1px dashed #1e1e1e;gap:12px}
  .ep-row:last-child{border-bottom:none}
  .ep-name{font-size:11px;color:#ccc;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ep-right{display:flex;align-items:center;gap:10px;flex-shrink:0}
  .ep-size{font-size:10px;color:#444;font-style:italic}
  .ep-dl{font-size:10px;color:#666;text-decoration:none;letter-spacing:0.05em}
  .ep-dl:hover{color:#fff}
  `

  if (isShow) {
    const sorted = [...videoFiles].sort((a, b) => a.name.localeCompare(b.name))
    const rowsHtml = sorted.map(f => `
    <div class="ep-row">
      <span class="ep-name">${fmtEpisodeName(f.name)}</span>
      <div class="ep-right">
        <span class="ep-size">${fmtSize(f.size)}</span>
        <a class="ep-dl" href="/f/${token}/file/${encodeURIComponent(f.name)}" download="${f.name}">dl</a>
      </div>
    </div>`).join('')

    return c.html(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${entry.name}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  ${posterHtml}
  <div class="title">${entry.name}</div>
  <div class="meta">${sorted.length} episode${sorted.length !== 1 ? 's' : ''} · ${fmtSize(totalSize)} · expires ${expires}</div>
  <div class="ep-list">${rowsHtml}</div>
  <a class="dl-btn" href="/f/${token}/download">download all</a>
</div>
</body>
</html>`)
  }

  return c.html(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${entry.name}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  ${posterHtml}
  <div class="title">${entry.name}</div>
  <div class="meta">${allFiles.length} file${allFiles.length !== 1 ? 's' : ''} · ${fmtSize(totalSize)} · expires ${expires}</div>
  <a class="dl-btn" href="/f/${token}/download">download</a>
</div>
</body>
</html>`)
})

serveRouter.get('/:token/file/:filename', async (c) => {
  const token    = c.req.param('token')
  const filename = c.req.param('filename')
  if (!authed(c)) return c.redirect(`/f/${token}`, 302)

  const links = purgeExpired(loadLinks())
  const entry = links[token]
  if (!entry) return c.text('not found', 404)
  if (!isAllowed(entry.path)) return c.text('forbidden', 403)

  const safe = basename(filename)
  const full = join(entry.path, safe)
  if (!full.startsWith(entry.path + '/')) return c.text('forbidden', 403)

  try {
    statSync(full)
  } catch {
    return c.text('not found', 404)
  }

  const encoded = encodeURIComponent(safe)
  return new Response(Bun.file(full), {
    headers: {
      'Content-Disposition': `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`,
    },
  })
})

serveRouter.get('/:token/download', async (c) => {
  const token = c.req.param('token')
  if (!authed(c)) return c.redirect(`/f/${token}`, 302)

  const links = purgeExpired(loadLinks())

  const entry = links[token]
  if (!entry) return c.text('not found', 404)
  if (!isAllowed(entry.path)) return c.text('forbidden', 403)

  let files: string[] = []
  try { files = readdirSync(entry.path).filter(f => !f.startsWith('.')) }
  catch { return c.text('not found', 404) }

  let totalSize = 0
  for (const f of files) {
    try { totalSize += statSync(join(entry.path, f)).size + 100 } catch {}
  }
  totalSize += 22

  const zipName = `${entry.name}.zip`
  const encoded = encodeURIComponent(zipName)
  c.header('Content-Disposition', `attachment; filename="${zipName}"; filename*=UTF-8''${encoded}`)
  c.header('Content-Type', 'application/zip')
  c.header('Content-Length', String(totalSize))

  const proc = spawn('zip', ['-0', '-r', '-', '.'], { cwd: entry.path })

  const stream = new ReadableStream({
    start(controller) {
      proc.stdout.on('data', chunk => controller.enqueue(chunk))
      proc.stdout.on('end', () => controller.close())
      proc.stdout.on('error', err => controller.error(err))
    },
    cancel() { proc.kill() },
  })

  return new Response(stream)
})
