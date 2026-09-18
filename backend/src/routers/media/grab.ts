import { Hono } from 'hono'
import { config } from '../../config'
import { radarrFetch, sonarrFetch, getRadarrRoot, getSonarrRoot } from './client'
import { fail } from '../../utils'

const router = new Hono()

// Parse a single season number from a release title, e.g. "Show.S02.1080p" → 2.
// Returns null for multi-season packs ("S01-S03"), episode files ("S01E01"), or unknowns.
function parseSeasonNumber(title: string): number | null {
  if (/S\d{2}[-+]S\d{2}/i.test(title) || /(?<![A-Z])S(\d{2})S(\d{2})/i.test(title)) return null
  const ep = title.match(/S(\d{2})E\d{2}/i)
  if (ep) return parseInt(ep[1], 10)
  const sp = title.match(/S(\d{2})(?![E\d])/i)
  if (sp) return parseInt(sp[1], 10)
  return null
}

type PushDecision = { approved: boolean; rejected: boolean; rejections: string[]; movieRequested?: boolean }

type SonarrFullSeries = {
  id: number; tvdbId: number; title: string; year: number
  qualityProfileId: number; rootFolderPath: string
  monitored: boolean; seasonFolder: boolean; languageProfileId?: number
  seasons: { seasonNumber: number; monitored: boolean }[]
}

router.post('/grab', async (c) => {
  try {
    const body = await c.req.json<{
      type: 'movie' | 'show'
      arrId: number
      releaseTitle: string
      guid: string
      downloadUrl: string | null
      magnetUrl?: string | null
      publishDate: string
      indexerId: number
      selectedSeason?: number
    }>()

    const seasonNumber = body.type === 'show'
      ? (parseSeasonNumber(body.releaseTitle) ?? body.selectedSeason ?? null)
      : null

    // Releases were browsed through /media/releases, which may have added this movie/series
    // to the library unmonitored just to search. Ensure it (and the target season) is
    // monitored before pushing — release/push returns movieRequested:false otherwise.
    if (body.type === 'movie') {
      const movie = await radarrFetch<Record<string, unknown> & { monitored: boolean }>(`/api/v3/movie/${body.arrId}`)
      if (!movie.monitored) {
        await radarrFetch(`/api/v3/movie/${body.arrId}`, { method: 'PUT', body: JSON.stringify({ ...movie, monitored: true }) })
      }
    } else {
      const series = await sonarrFetch<SonarrFullSeries>(`/api/v3/series/${body.arrId}`)
      const targetSeason = seasonNumber !== null ? series.seasons.find(s => s.seasonNumber === seasonNumber) : null
      const needsUpdate = !series.monitored || (targetSeason && !targetSeason.monitored)
      if (needsUpdate) {
        await sonarrFetch(`/api/v3/series/${body.arrId}`, {
          method: 'PUT',
          body: JSON.stringify({
            ...series,
            monitored: true,
            seasons: series.seasons.map(s =>
              seasonNumber !== null
                ? (s.seasonNumber === seasonNumber ? { ...s, monitored: true } : s)
                : (s.seasonNumber > 0 ? { ...s, monitored: true } : s)
            ),
          }),
        })
      }
    }

    const push: Record<string, unknown> = {
      guid:        body.guid,
      title:       body.releaseTitle,
      downloadUrl: body.downloadUrl ?? undefined,
      magnetUrl:   body.magnetUrl   ?? undefined,
      protocol:    'Torrent',
      indexerId:   body.indexerId,
      publishDate: body.publishDate,
    }

    if (body.type === 'movie') {
      push.movieId = body.arrId
      console.log('[grab] radarr push payload:', JSON.stringify(push))
      const decisions = await radarrFetch<PushDecision[]>('/api/v3/release/push', { method: 'POST', body: JSON.stringify(push) })
      console.log('[grab] radarr decisions:', JSON.stringify(decisions))
      const rejected = decisions.find(d => d.rejected || !d.approved)
      if (rejected) throw new Error(rejected.rejections?.join(', ') || 'radarr rejected release')
      // movieRequested:false does NOT mean the grab failed — radarr still queues approved
      // releases asynchronously regardless of this flag (confirmed via radarr history/queue).
      // The one real case to handle here: the movie already has a file meeting quality
      // cutoff, so radarr won't replace it without the existing file being deleted first.
      const skipped = decisions.find(d => d.approved && d.movieRequested === false)
      if (skipped) {
        const movieDetail = await radarrFetch<{ movieFile?: { id: number } }>(`/api/v3/movie/${body.arrId}`)
        if (movieDetail.movieFile?.id) {
          console.log(`[grab] deleting existing movieFile ${movieDetail.movieFile.id} to allow re-grab`)
          await radarrFetch(`/api/v3/moviefile/${movieDetail.movieFile.id}`, { method: 'DELETE' })
          const decisions2 = await radarrFetch<PushDecision[]>('/api/v3/release/push', { method: 'POST', body: JSON.stringify(push) })
          console.log('[grab] radarr re-push decisions:', JSON.stringify(decisions2))
          const rejected2 = decisions2.find(d => d.rejected || !d.approved)
          if (rejected2) throw new Error(rejected2.rejections?.join(', ') || 'radarr rejected release on re-push')
        }
      }
    } else {
      push.seriesId = body.arrId
      if (seasonNumber !== null) push.seasonNumber = seasonNumber
      console.log('[grab] sonarr push payload:', JSON.stringify(push))
      const decisions = await sonarrFetch<PushDecision[]>('/api/v3/release/push', { method: 'POST', body: JSON.stringify(push) })
      console.log('[grab] sonarr decisions:', JSON.stringify(decisions))
      const rejected = decisions.find(d => d.rejected || !d.approved)
      if (rejected) throw new Error(rejected.rejections?.join(', ') || 'sonarr rejected release')
    }

    return c.json({ success: true })
  } catch (err) {
    return fail(c, err)
  }
})

router.post('/autograb', async (c) => {
  try {
    const body = await c.req.json<{
      type: 'movie' | 'show'
      title: string
      tmdbId?: number
      tvdbId?: number
      inLibrary: boolean
      seasons?: number[]
    }>()

    if (body.type === 'movie') {
      let movieId: number
      if (!body.inLibrary) {
        const rootFolderPath = await getRadarrRoot()
        const movie = await radarrFetch<{ id: number }>('/api/v3/movie', {
          method: 'POST',
          body: JSON.stringify({
            tmdbId: body.tmdbId, title: body.title,
            qualityProfileId: config.arr.qualityProfileId, rootFolderPath, monitored: true,
            addOptions: { searchForMovie: false },
          }),
        })
        movieId = movie.id
      } else {
        const movies = await radarrFetch<{ id: number; tmdbId: number }[]>('/api/v3/movie')
        const found = movies.find(m => m.tmdbId === body.tmdbId)
        if (!found) throw new Error('movie not found in radarr')
        movieId = found.id
      }
      await radarrFetch('/api/v3/command', {
        method: 'POST',
        body: JSON.stringify({ name: 'MoviesSearch', movieIds: [movieId] }),
      })
    } else {
      const seasons = body.seasons ?? []
      let seriesId: number

      if (!body.inLibrary) {
        const rootFolderPath = await getSonarrRoot()
        type SonarrLookupItem = { seasons: { seasonNumber: number }[] }
        const lookup = await sonarrFetch<SonarrLookupItem[]>(`/api/v3/series/lookup?term=tvdb:${body.tvdbId}`)
        const allSeasons = lookup[0]?.seasons ?? []
        const series = await sonarrFetch<{ id: number }>('/api/v3/series', {
          method: 'POST',
          body: JSON.stringify({
            tvdbId: body.tvdbId, title: body.title,
            qualityProfileId: config.arr.qualityProfileId, languageProfileId: config.arr.languageProfileId,
            rootFolderPath, monitored: true, seasonFolder: true,
            seasons: allSeasons.map(s => ({ seasonNumber: s.seasonNumber, monitored: seasons.includes(s.seasonNumber) })),
            addOptions: { searchForMissingEpisodes: true },
          }),
        })
        seriesId = series.id
      } else {
        const allSeries = await sonarrFetch<SonarrFullSeries[]>('/api/v3/series')
        const thisSeries = allSeries.find(s => s.tvdbId === body.tvdbId)
        if (!thisSeries) throw new Error('series not found in sonarr')
        seriesId = thisSeries.id
        await sonarrFetch(`/api/v3/series/${seriesId}`, {
          method: 'PUT',
          body: JSON.stringify({
            ...thisSeries,
            seasons: thisSeries.seasons.map(s => ({ ...s, monitored: s.monitored || seasons.includes(s.seasonNumber) })),
          }),
        })
        for (const sn of seasons) {
          await sonarrFetch('/api/v3/command', {
            method: 'POST',
            body: JSON.stringify({ name: 'SeasonSearch', seriesId, seasonNumber: sn }),
          })
        }
      }
    }

    return c.json({ success: true })
  } catch (err) {
    return fail(c, err)
  }
})

router.post('/episode-search', async (c) => {
  try {
    const { episodeIds } = await c.req.json<{ episodeIds: number[] }>()
    await sonarrFetch('/api/v3/command', {
      method: 'POST',
      body: JSON.stringify({ name: 'EpisodeSearch', episodeIds }),
    })
    return c.json({ success: true })
  } catch (err) {
    return fail(c, err)
  }
})

export default router
