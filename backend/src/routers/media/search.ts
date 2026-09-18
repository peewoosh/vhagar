import { Hono } from 'hono'
import { config } from '../../config'
import { radarrFetch, sonarrFetch, getRadarrRoot, getSonarrRoot } from './client'
import { withTimeout } from '../../utils'

const router = new Hono()

router.get('/search', async (c) => {
  const q = c.req.query('q')
  if (!q) return c.json({ error: 'missing q' }, 400)

  type RadarrItem = {
    id: number; title: string; year: number; overview: string; tmdbId: number
    images: { coverType: string; remoteUrl: string }[]
  }
  type SonarrItem = {
    id: number; title: string; year: number; overview: string; tvdbId: number
    images: { coverType: string; remoteUrl: string }[]
    seasons: { seasonNumber: number }[]
  }

  const [moviesRes, showsRes] = await Promise.allSettled([
    radarrFetch<RadarrItem[]>(`/api/v3/movie/lookup?term=${encodeURIComponent(q)}`),
    sonarrFetch<SonarrItem[]>(`/api/v3/series/lookup?term=${encodeURIComponent(q)}`),
  ])

  if (moviesRes.status === 'rejected' && showsRes.status === 'rejected') {
    return c.json({ error: 'search unavailable — radarr and sonarr unreachable' }, 502)
  }

  const movies = moviesRes.status === 'fulfilled' ? moviesRes.value : []
  const shows  = showsRes.status  === 'fulfilled' ? showsRes.value  : []

  const movieResults = movies.map(item => ({
    id:        item.id > 0 ? item.id : null,
    title:     item.title,
    year:      item.year,
    inLibrary: item.id > 0,
    type:      'movie' as const,
    tmdbId:    item.tmdbId,
    poster:    item.images?.find(img => img.coverType === 'poster')?.remoteUrl ?? null,
  }))

  const showResults = shows.map(item => ({
    id:        item.id > 0 ? item.id : null,
    title:     item.title,
    year:      item.year,
    inLibrary: item.id > 0,
    type:      'show' as const,
    tvdbId:    item.tvdbId,
    poster:    item.images?.find(img => img.coverType === 'poster')?.remoteUrl ?? null,
    seasons:   item.seasons
                 ?.filter(s => s.seasonNumber > 0)
                 .map(s => s.seasonNumber)
                 .sort((a, b) => a - b) ?? [],
  }))

  const all = [...movieResults, ...showResults].sort((a, b) => {
    if (a.inLibrary && !b.inLibrary) return -1
    if (!a.inLibrary && b.inLibrary) return 1
    return 0
  })

  return c.json({ results: all })
})

// Fast: ensure the movie/series exists in radarr/sonarr (unmonitored, no search) and return
// its id. Split out from /releases so the frontend learns arrId/addedFresh in milliseconds,
// not after the slow indexer search below finishes — otherwise closing the modal mid-search
// races the "was this added fresh" state and leaks a phantom unmonitored entry.
router.post('/resolve-arr-id', async (c) => {
  const body = await c.req.json<{
    type: 'movie' | 'show'; title: string; tmdbId?: number; tvdbId?: number; arrId?: number
  }>()
  if (body.arrId) return c.json({ arrId: body.arrId, addedFresh: false })

  try {
    if (body.type === 'movie') {
      if (!body.tmdbId) return c.json({ error: 'missing tmdbId' }, 400)
      const rootFolderPath = await getRadarrRoot()
      const added = await radarrFetch<{ id: number }>('/api/v3/movie', {
        method: 'POST',
        body: JSON.stringify({
          tmdbId: body.tmdbId, title: body.title,
          qualityProfileId: config.arr.qualityProfileId, rootFolderPath, monitored: false,
          addOptions: { searchForMovie: false },
        }),
      })
      return c.json({ arrId: added.id, addedFresh: true })
    } else {
      if (!body.tvdbId) return c.json({ error: 'missing tvdbId' }, 400)
      const rootFolderPath = await getSonarrRoot()
      type SonarrLookupItem = { seasons: { seasonNumber: number }[] }
      const lookup = await sonarrFetch<SonarrLookupItem[]>(`/api/v3/series/lookup?term=tvdb:${body.tvdbId}`)
      const allSeasons = lookup[0]?.seasons ?? []
      const series = await sonarrFetch<{ id: number }>('/api/v3/series', {
        method: 'POST',
        body: JSON.stringify({
          tvdbId: body.tvdbId, title: body.title,
          qualityProfileId: config.arr.qualityProfileId, languageProfileId: config.arr.languageProfileId,
          rootFolderPath, monitored: false, seasonFolder: true,
          seasons: allSeasons.map(s => ({ seasonNumber: s.seasonNumber, monitored: false })),
          addOptions: { searchForMissingEpisodes: false },
        }),
      })
      return c.json({ arrId: series.id, addedFresh: true })
    }
  } catch (err) {
    return c.json({ error: String(err) }, 502)
  }
})

// Releases are searched through Radarr's/Sonarr's own interactive search (/api/v3/release),
// not Prowlarr directly — their /release/push endpoint only actually forwards a grab to the
// download client for releases that came from their own search cache. A Prowlarr-native guid
// gets scored (approved, no rejections) but silently never queued.
router.get('/releases', async (c) => {
  const type   = c.req.query('type') as 'movie' | 'show'
  const season = c.req.query('season')
  const arrIdQ = c.req.query('arrId')
  if (!arrIdQ) return c.json({ error: 'missing arrId' }, 400)
  const arrId = parseInt(arrIdQ, 10)

  type ArrRelease = {
    guid: string; title: string; size: number; seeders?: number; leechers?: number
    indexer: string; indexerId: number; downloadUrl?: string; magnetUrl?: string; publishDate: string
    languages?: { id: number; name: string }[]
    approved?: boolean; rejections?: string[]
  }

  try {
    const path = type === 'movie'
      ? `/api/v3/release?movieId=${arrId}`
      : `/api/v3/release?seriesId=${arrId}${season ? `&seasonNumber=${encodeURIComponent(season)}` : ''}`
    const fetchFn = type === 'movie' ? radarrFetch : sonarrFetch

    const data = await withTimeout(80_000, signal => fetchFn<ArrRelease[]>(path, { signal }))

    return c.json({
      releases: data.map(r => ({
        guid: r.guid, title: r.title, size: r.size,
        seeders: r.seeders ?? 0, leechers: r.leechers ?? 0,
        language: r.languages?.[0]?.name ?? null,
        indexer: r.indexer, indexerId: r.indexerId,
        downloadUrl: r.downloadUrl ?? null, magnetUrl: r.magnetUrl ?? null,
        publishDate: r.publishDate,
        approved: r.approved ?? (r.rejections?.length === 0),
      })).sort((a, b) => b.seeders - a.seeders)
    })
  } catch (err) {
    return c.json({ error: `release search unavailable: ${err}` }, 502)
  }
})

export default router
