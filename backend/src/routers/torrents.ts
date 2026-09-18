import { Hono } from 'hono'
import { config } from '../config'
import { fetchWithTimeout } from '../utils'

const router = new Hono()

type TorrentState = 'downloading' | 'seeding' | 'completed' | 'paused' | 'stopped' | 'stalled' | 'checking' | 'error' | 'unknown'

// ── qBittorrent session ───────────────────────────────────────────────────────

let qbitCookie: string | null = null

async function qbitLogin() {
  const res = await fetchWithTimeout(`${config.qbit.url}/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: config.qbit.username, password: config.qbit.password }),
  }, 5000)
  const setCookie = res.headers.get('set-cookie')
  if (!setCookie) throw new Error('qbit login failed: no session cookie')
  qbitCookie = setCookie.split(';')[0]
}

async function qbitRequest(path: string, init?: RequestInit): Promise<Response> {
  if (!qbitCookie) await qbitLogin()
  let res = await fetch(`${config.qbit.url}${path}`, {
    ...init,
    headers: { Cookie: qbitCookie!, ...(init?.headers ?? {}) },
  })
  if (res.status === 403) {
    // session expired — re-auth and retry once
    qbitCookie = null
    await qbitLogin()
    res = await fetch(`${config.qbit.url}${path}`, {
      ...init,
      headers: { Cookie: qbitCookie!, ...(init?.headers ?? {}) },
    })
  }
  return res
}

async function qbitFetch<T>(path: string): Promise<T> {
  const res = await qbitRequest(path)
  if (!res.ok) throw new Error(`qbit ${res.status}: ${await res.text()}`)
  return res.json()
}

async function qbitPost(path: string, body: URLSearchParams): Promise<boolean> {
  const res = await qbitRequest(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  return res.ok
}

// ── State mapping ─────────────────────────────────────────────────────────────

function mapState(raw: string): TorrentState {
  switch (raw) {
    case 'downloading':
    case 'stalledDL':
    case 'forcedDL':
    case 'metaDL':
    case 'queuedDL':
      return 'downloading'
    case 'uploading':
    case 'stalledUP':
    case 'forcedUP':
      return 'seeding'
    case 'queuedUP':
    case 'completed':
      return 'completed'
    case 'pausedDL':
    case 'stoppedDL':
      return 'paused'
    case 'pausedUP':
    case 'stoppedUP':
      return 'stopped'
    case 'checkingDL':
    case 'checkingUP':
    case 'checkingResumeData':
    case 'moving':
      return 'checking'
    case 'error':
    case 'missingFiles':
      return 'error'
    default:
      return 'unknown'
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/', async (c) => {
  type QbitTorrent = {
    hash: string; name: string; size: number; downloaded: number
    progress: number; state: string; dlspeed: number; upspeed: number
    num_seeds: number; eta: number; category: string
  }

  const data = await qbitFetch<QbitTorrent[]>('/api/v2/torrents/info')
  return c.json({
    torrents: data.map(t => ({
      hash:       t.hash,
      name:       t.name,
      size:       t.size,
      downloaded: t.downloaded,
      progress:   t.progress,
      state:      mapState(t.state),
      dlspeed:    t.dlspeed  ?? 0,
      upspeed:    t.upspeed  ?? 0,
      seeders:    t.num_seeds ?? 0,
      eta:        (t.eta < 0 || t.eta >= 8640000) ? -1 : t.eta,
      category:   t.category ?? '',
    }))
  })
})

router.post('/pause', async (c) => {
  const { hash } = await c.req.json<{ hash: string }>()
  const ok = await qbitPost('/api/v2/torrents/stop', new URLSearchParams({ hashes: hash }))
  return c.json({ success: ok })
})

router.post('/resume', async (c) => {
  const { hash } = await c.req.json<{ hash: string }>()
  const ok = await qbitPost('/api/v2/torrents/start', new URLSearchParams({ hashes: hash }))
  return c.json({ success: ok })
})

router.post('/delete', async (c) => {
  const { hash, deleteFiles } = await c.req.json<{ hash: string; deleteFiles: boolean }>()
  const ok = await qbitPost('/api/v2/torrents/delete', new URLSearchParams({
    hashes: hash,
    deleteFiles: String(deleteFiles),
  }))
  return c.json({ success: ok })
})

router.post('/stop-seeding', async (c) => {
  type QbitTorrent = { hash: string; state: string }
  const data = await qbitFetch<QbitTorrent[]>('/api/v2/torrents/info')
  const seedingHashes = data
    .filter(t => mapState(t.state) === 'seeding')
    .map(t => t.hash)

  if (seedingHashes.length === 0) return c.json({ success: true })

  const ok = await qbitPost('/api/v2/torrents/stop', new URLSearchParams({
    hashes: seedingHashes.join('|'),
  }))
  return c.json({ success: ok })
})

export default router
