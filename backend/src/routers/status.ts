import { Hono } from 'hono'
import { statfsSync } from 'fs'
import { config } from '../config'
import { fetchWithTimeout } from '../utils'

const router = new Hono()

// ── Service pings ─────────────────────────────────────────────────────────────

async function ping(url: string, headers: Record<string, string> = {}): Promise<{ httpStatus: number | null; latency_ms: number }> {
  const start = Date.now()
  try {
    const res = await fetchWithTimeout(url, { headers }, 3000)
    return { httpStatus: res.status, latency_ms: Date.now() - start }
  } catch {
    return { httpStatus: null, latency_ms: Date.now() - start }
  }
}

async function checkService(
  configured: boolean,
  url: string,
  headers: Record<string, string> = {},
  acceptCodes: number[] = []
): Promise<{ status: 'UP' | 'DOWN' | 'UNKNOWN'; latency_ms: number | null }> {
  if (!configured) return { status: 'UNKNOWN', latency_ms: null }
  const { httpStatus, latency_ms } = await ping(url, headers)
  const ok = httpStatus !== null && (
    acceptCodes.length > 0 ? acceptCodes.includes(httpStatus) : httpStatus >= 200 && httpStatus < 300
  )
  return { status: ok ? 'UP' : 'DOWN', latency_ms: ok ? latency_ms : null }
}

// ── Fetch functions ───────────────────────────────────────────────────────────

async function fetchServices() {
  const { radarr, sonarr, prowlarr, bazarr, qbit, jellyfin, go2rtc, filebrowser, pareekenterprises, gradientmotion, ytdlp } = config
  const results = await Promise.all([
    checkService(!!radarr.url && !!radarr.apiKey, `${radarr.url}/api/v3/system/status`, { 'X-Api-Key': radarr.apiKey })
      .then(r => ['radarr', { ...r, url: radarr.url }] as const),
    checkService(!!sonarr.url && !!sonarr.apiKey, `${sonarr.url}/api/v3/system/status`, { 'X-Api-Key': sonarr.apiKey })
      .then(r => ['sonarr', { ...r, url: sonarr.url }] as const),
    checkService(!!prowlarr.url && !!prowlarr.apiKey, `${prowlarr.url}/api/v1/system/status`, { 'X-Api-Key': prowlarr.apiKey })
      .then(r => ['prowlarr', { ...r, url: prowlarr.url }] as const),
    checkService(!!bazarr.url && !!bazarr.apiKey, `${bazarr.url}/api/v1/system/status`, { 'X-Api-Key': bazarr.apiKey })
      .then(r => ['bazarr', { ...r, url: bazarr.url }] as const),
    checkService(!!qbit.url, `${qbit.url}/api/v2/app/version`)
      .then(r => ['qbittorrent', { ...r, url: qbit.url }] as const),
    checkService(!!jellyfin.url, `${jellyfin.url}/health`)
      .then(r => ['jellyfin', { ...r, url: jellyfin.url }] as const),
    checkService(!!go2rtc.url, `${go2rtc.url}/api`)
      .then(r => ['go2rtc', { ...r, url: go2rtc.url }] as const),
    checkService(!!filebrowser.url, filebrowser.url)
      .then(r => ['filebrowser', { ...r, url: filebrowser.url }] as const),
    checkService(!!pareekenterprises.url, pareekenterprises.url)
      .then(r => ['pareekenterprises', { ...r, url: pareekenterprises.url }] as const),
    checkService(!!gradientmotion.url, gradientmotion.url)
      .then(r => ['gradientmotion', { ...r, url: gradientmotion.url }] as const),
    checkService(!!ytdlp.url, ytdlp.url, {}, [200, 405])
      .then(r => ['yt-dlp', { ...r, url: ytdlp.url }] as const),
  ])
  return { services: Object.fromEntries(results), checked_at: new Date().toISOString() }
}

function fetchStorage() {
  const stat  = statfsSync(config.storagePath)
  const total = stat.bsize * stat.blocks
  const free  = stat.bsize * stat.bfree
  return { used: total - free, total }
}

// ── Cache + refresh factory ───────────────────────────────────────────────────

function makeRefresher<T>(name: string, fetcher: () => Promise<T>) {
  let cache: T | null = null
  let flight: Promise<void> | null = null
  function refresh(): Promise<void> {
    if (flight) return flight
    flight = Promise.resolve()
      .then(fetcher)
      .then(d => { cache = d })
      .catch(err => process.stderr.write(`[status] ${name} refresh failed: ${err}\n`))
      .finally(() => { flight = null })
    return flight
  }
  return { refresh, get: () => cache }
}

const svc     = makeRefresher('services', fetchServices)
const storage = makeRefresher('storage',  async () => fetchStorage())

void svc.refresh()
void storage.refresh()

setInterval(svc.refresh,     30_000)
setInterval(storage.refresh, 30_000)

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/services', async (c) => {
  if (!svc.get()) await svc.refresh()
  return c.json(svc.get() ?? { error: 'unavailable' })
})

router.get('/storage', async (c) => {
  if (!storage.get()) await storage.refresh()
  return c.json(storage.get() ?? { error: 'unavailable' })
})

export default router
