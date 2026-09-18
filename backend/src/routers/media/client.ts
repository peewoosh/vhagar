import { config } from '../../config'

function makeArrFetch(baseUrl: string, apiKey: string, name: string) {
  return async function<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
    if (!res.ok) throw new Error(`${name} ${res.status}: ${await res.text()}`)
    return res.json()
  }
}

export const radarrFetch = makeArrFetch(config.radarr.url, config.radarr.apiKey, 'radarr')
export const sonarrFetch = makeArrFetch(config.sonarr.url, config.sonarr.apiKey, 'sonarr')

export const ARR_QUEUE_PAGE = 200

export async function removeFromArrQueue(
  fetchFn: <T>(path: string, init?: RequestInit) => Promise<T>,
  baseUrl: string,
  apiKey: string,
  upperHash: string
): Promise<boolean> {
  type QueueRecord = { id: number; downloadId?: string }
  const data  = await fetchFn<{ records: QueueRecord[] }>(`/api/v3/queue?pageSize=${ARR_QUEUE_PAGE}`)
  const items = data.records.filter(r => r.downloadId?.toUpperCase() === upperHash)
  if (!items.length) return false
  await Promise.all(items.map(item =>
    fetch(
      `${baseUrl}/api/v3/queue/${item.id}?removeFromClient=true&blocklist=false&skipRedownload=false`,
      { method: 'DELETE', headers: { 'X-Api-Key': apiKey } }
    )
  ))
  return true
}

let radarrRoot: string | null = null
let sonarrRoot: string | null = null

export async function getRadarrRoot(): Promise<string> {
  if (radarrRoot) return radarrRoot
  const folders = await radarrFetch<{ path: string }[]>('/api/v3/rootfolder')
  if (!folders.length) throw new Error('radarr has no root folders configured')
  radarrRoot = folders[0].path
  return radarrRoot
}

export async function getSonarrRoot(): Promise<string> {
  if (sonarrRoot) return sonarrRoot
  const folders = await sonarrFetch<{ path: string }[]>('/api/v3/rootfolder')
  if (!folders.length) throw new Error('sonarr has no root folders configured')
  sonarrRoot = folders[0].path
  return sonarrRoot
}
