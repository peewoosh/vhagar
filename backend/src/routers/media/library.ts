import { Hono } from 'hono'
import { config } from '../../config'
import { radarrFetch, sonarrFetch } from './client'
import { fail } from '../../utils'

const router = new Hono()

router.get('/library', async (c) => {
  type RadarrMovie = {
    id: number; title: string; year: number; tmdbId: number; hasFile: boolean; path: string
    movieFile?: { size: number; relativePath: string }
    images: { coverType: string; remoteUrl: string }[]
  }
  type SonarrSeries = {
    id: number; title: string; year: number; tvdbId: number; path: string
    images: { coverType: string; remoteUrl: string }[]
    seasons: { seasonNumber: number; statistics?: { episodeFileCount: number; totalEpisodeCount: number } }[]
    statistics?: { episodeFileCount: number; totalEpisodeCount: number }
  }

  const [moviesRes, showsRes] = await Promise.allSettled([
    radarrFetch<RadarrMovie[]>('/api/v3/movie'),
    sonarrFetch<SonarrSeries[]>('/api/v3/series'),
  ])

  const movies: RadarrMovie[] = moviesRes.status === 'fulfilled' ? moviesRes.value : []
  const shows: SonarrSeries[] = showsRes.status  === 'fulfilled' ? showsRes.value  : []

  return c.json({
    movies: movies
      .filter(m => m.hasFile)
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(m => ({
        id:       m.id,
        title:    m.title,
        year:     m.year,
        tmdbId:   m.tmdbId,
        poster:   m.images?.find(img => img.coverType === 'poster')?.remoteUrl ?? null,
        hasFile:  m.hasFile,
        fileSize: m.movieFile?.size ?? null,
        fileName: m.movieFile?.relativePath?.split('/').pop() ?? null,
        folderPath: m.hasFile ? m.path : null,
      })),
    shows: shows
      .filter(s =>
        (s.statistics?.episodeFileCount ?? 0) > 0 ||
        s.seasons.some(ss => (ss.statistics?.episodeFileCount ?? 0) > 0)
      )
      .sort((a, b) => a.title.localeCompare(b.title))
      .map(s => {
        const nonSpecial = s.seasons.filter(ss => ss.seasonNumber > 0)
        return {
          id:           s.id,
          title:        s.title,
          year:         s.year,
          tvdbId:       s.tvdbId,
          poster:       s.images?.find(img => img.coverType === 'poster')?.remoteUrl ?? null,
          folderPath:   s.path ?? null,
          totalSeasons: nonSpecial.length,
          seasons:      nonSpecial.map(ss => ({
            seasonNumber:      ss.seasonNumber,
            episodeFileCount:  ss.statistics?.episodeFileCount  ?? 0,
            totalEpisodeCount: ss.statistics?.totalEpisodeCount ?? 0,
          })),
        }
      }),
  })
})

router.get('/episodes', async (c) => {
  try {
    const seriesId = Number(c.req.query('seriesId'))
    const season   = Number(c.req.query('season'))
    type SonarrEpisode = { id: number; episodeNumber: number; hasFile: boolean }
    const episodes = await sonarrFetch<SonarrEpisode[]>(
      `/api/v3/episode?seriesId=${seriesId}&seasonNumber=${season}`
    )
    return c.json(
      episodes
        .filter(e => !e.hasFile)
        .map(e => ({ id: e.id, episodeNumber: e.episodeNumber }))
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
    )
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

router.get('/show-episodes', async (c) => {
  try {
    const seriesId = Number(c.req.query('seriesId'))
    if (!seriesId) return c.json({ error: 'missing seriesId' }, 400)
    type SonarrEpisode = { id: number; episodeNumber: number; seasonNumber: number; title: string; hasFile: boolean; episodeFileId?: number }
    const episodes = await sonarrFetch<SonarrEpisode[]>(`/api/v3/episode?seriesId=${seriesId}`)
    const grouped: Record<number, Array<{ id: number; ep: number; title: string; hasFile: boolean; fileId: number | null }>> = {}
    for (const e of episodes.filter(e => e.seasonNumber > 0)) {
      if (!grouped[e.seasonNumber]) grouped[e.seasonNumber] = []
      grouped[e.seasonNumber].push({ id: e.id, ep: e.episodeNumber, title: e.title, hasFile: e.hasFile, fileId: e.episodeFileId ?? null })
    }
    for (const arr of Object.values(grouped)) arr.sort((a, b) => a.ep - b.ep)
    return c.json(grouped)
  } catch (err) {
    return c.json({ error: String(err) }, 500)
  }
})

router.get('/subtitles', async (c) => {
  if (!config.bazarr.url || !config.bazarr.apiKey) return c.json({ movies: [], shows: [] })

  type BazarrMovie  = { radarrId: number; missing_subtitles: { code2: string }[] }
  type BazarrSeries = { sonarrSeriesId: number; episodeMissingCount: number }

  const headers = { 'X-Api-Key': config.bazarr.apiKey }
  const [moviesRes, seriesRes] = await Promise.allSettled([
    fetch(`${config.bazarr.url}/api/movies?start=0&length=-1`, { headers }).then(r => r.json()),
    fetch(`${config.bazarr.url}/api/series?start=0&length=-1`, { headers }).then(r => r.json()),
  ])

  const movies = moviesRes.status === 'fulfilled'
    ? (moviesRes.value.data as BazarrMovie[] ?? []).filter(m => m.missing_subtitles?.length > 0).map(m => m.radarrId)
    : []

  const shows = seriesRes.status === 'fulfilled'
    ? (seriesRes.value.data as BazarrSeries[] ?? []).filter(s => s.episodeMissingCount > 0).map(s => s.sonarrSeriesId)
    : []

  return c.json({ movies, shows })
})

router.post('/delete-episode', async (c) => {
  try {
    const { fileId } = await c.req.json<{ fileId: number }>()
    const res = await fetch(
      `${config.sonarr.url}/api/v3/episodefile/${fileId}`,
      { method: 'DELETE', headers: { 'X-Api-Key': config.sonarr.apiKey } }
    )
    if (!res.ok) throw new Error(`sonarr ${res.status}`)
    return c.json({ success: true })
  } catch (err) {
    return fail(c, err)
  }
})

router.post('/delete', async (c) => {
  try {
  const { type, id } = await c.req.json<{ type: 'movie' | 'show'; id: number; title: string }>()
    if (type === 'movie') {
      const res = await fetch(
        `${config.radarr.url}/api/v3/movie/${id}?deleteFiles=true&addImportExclusion=false`,
        { method: 'DELETE', headers: { 'X-Api-Key': config.radarr.apiKey } }
      )
      if (!res.ok) throw new Error(`radarr ${res.status}`)
    } else {
      const res = await fetch(
        `${config.sonarr.url}/api/v3/series/${id}?deleteFiles=true`,
        { method: 'DELETE', headers: { 'X-Api-Key': config.sonarr.apiKey } }
      )
      if (!res.ok) throw new Error(`sonarr ${res.status}`)
    }
    return c.json({ success: true })
  } catch (err) {
    return fail(c, err)
  }
})

export default router
