import { Hono } from 'hono'
import { config } from '../../config'
import { radarrFetch, sonarrFetch, ARR_QUEUE_PAGE, removeFromArrQueue } from './client'
import { parseJsonBody, fail } from '../../utils'

const router = new Hono()

router.get('/queue', async (c) => {
  type QueueRecord = {
    id: number; title: string; status: string
    trackedDownloadStatus: string; trackedDownloadState: string
    statusMessages: { title: string; messages: string[] }[]
    downloadId?: string; seasonNumber?: number
    seriesId?: number; movieId?: number
  }

  const toItems = (records: QueueRecord[], type: 'movie' | 'show') =>
    records.map(r => ({
      id:            r.id,
      title:         r.title,
      status:        r.status,
      trackedStatus: r.trackedDownloadStatus,
      trackedState:  r.trackedDownloadState,
      messages:      r.statusMessages.flatMap(m => m.messages),
      downloadId:    r.downloadId ?? null,
      type,
      seasonNumber:  type === 'show' ? (r.seasonNumber ?? null) : undefined,
      seriesId:      type === 'show' ? (r.seriesId ?? null) : undefined,
      movieId:       type === 'movie' ? (r.movieId ?? null) : undefined,
    }))

  const [radarrRes, sonarrRes] = await Promise.allSettled([
    radarrFetch<{ records: QueueRecord[] }>(`/api/v3/queue?pageSize=${ARR_QUEUE_PAGE}`),
    sonarrFetch<{ records: QueueRecord[] }>(`/api/v3/queue?pageSize=${ARR_QUEUE_PAGE}`),
  ])

  const radarrItems = radarrRes.status === 'fulfilled' ? toItems(radarrRes.value.records, 'movie') : []
  const sonarrItems = sonarrRes.status === 'fulfilled' ? toItems(sonarrRes.value.records, 'show')  : []

  return c.json({ queue: [...radarrItems, ...sonarrItems] })
})

router.post('/queue/delete', async (c) => {
  const body = await parseJsonBody<{ hash?: string; arrId?: number; type?: 'movie' | 'show' }>(c)
  if (body instanceof Response) return body

  if (body.arrId && body.type) {
    try {
      const base = body.type === 'movie' ? config.radarr.url : config.sonarr.url
      const key  = body.type === 'movie' ? config.radarr.apiKey : config.sonarr.apiKey
      await fetch(
        `${base}/api/v3/queue/${body.arrId}?removeFromClient=true&blocklist=false&skipRedownload=false`,
        { method: 'DELETE', headers: { 'X-Api-Key': key } }
      )
    } catch { /* best effort */ }
    return c.json({ success: true })
  }

  const hash      = body.hash ?? ''
  const upperHash = hash.toUpperCase()

  try {
    if (await removeFromArrQueue(radarrFetch, config.radarr.url, config.radarr.apiKey, upperHash))
      return c.json({ success: true })
  } catch { /* best effort */ }

  try {
    if (await removeFromArrQueue(sonarrFetch, config.sonarr.url, config.sonarr.apiKey, upperHash))
      return c.json({ success: true })
  } catch { /* best effort */ }

  // Fallback: hash not in arr queue, delete from qBit directly
  try {
    const loginRes = await fetch(`${config.qbit.url}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: config.qbit.username, password: config.qbit.password }),
    })
    const setCookie = loginRes.headers.get('set-cookie')
    if (setCookie) {
      const cookie = setCookie.split(';')[0]
      await fetch(`${config.qbit.url}/api/v2/torrents/delete`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ hashes: hash, deleteFiles: 'true' }),
      })
    }
  } catch { /* best effort */ }

  return c.json({ success: true })
})

router.post('/queue/import', async (c) => {
  const body = await parseJsonBody<{ type?: 'movie' | 'show'; seriesId?: number; movieId?: number }>(c)
  if (body instanceof Response) return body

  try {
    if (body.type === 'movie') {
      const cmd: Record<string, unknown> = { name: 'RefreshMovie' }
      if (body.movieId) cmd.movieIds = [body.movieId]
      await radarrFetch('/api/v3/command', { method: 'POST', body: JSON.stringify(cmd) })
    } else {
      const cmd: Record<string, unknown> = { name: 'RefreshSeries' }
      if (body.seriesId) cmd.seriesId = body.seriesId
      await sonarrFetch('/api/v3/command', { method: 'POST', body: JSON.stringify(cmd) })
    }
    return c.json({ success: true })
  } catch (err) {
    return fail(c, err)
  }
})

router.post('/jellyfin/scan', async (c) => {
  if (!config.jellyfin.url) return c.json({ success: false, message: 'jellyfin not configured' }, 400)
  try {
    await fetch(`${config.jellyfin.url}/Library/Refresh`, {
      method: 'POST',
      headers: { 'X-Emby-Token': config.jellyfin.apiKey },
    })
    return c.json({ success: true })
  } catch (err) {
    return fail(c, err)
  }
})

export default router
