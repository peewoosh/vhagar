export interface SearchResult {
  id: number | null
  title: string
  year: number
  inLibrary: boolean
  type: 'movie' | 'show'
  tmdbId?: number
  tvdbId?: number
  poster?: string | null
  seasons?: number[]
}

export interface Release {
  guid: string
  title: string
  size: number
  seeders: number
  leechers: number
  indexer: string
  indexerId: number
  downloadUrl: string | null
  magnetUrl:   string | null
  publishDate: string
  approved: boolean
}

export interface SeasonStat {
  seasonNumber: number
  episodeFileCount: number
  totalEpisodeCount: number
}

export interface LibraryMovie {
  id: number
  title: string
  year: number
  tmdbId: number
  poster: string | null
  hasFile: boolean
  fileSize: number | null
  fileName: string | null
  folderPath: string | null
}

export interface LibraryShow {
  id: number
  title: string
  year: number
  tvdbId: number
  poster: string | null
  folderPath: string | null
  totalSeasons: number
  seasons: SeasonStat[]
}

export interface QueueItem {
  id: number
  title: string
  status: string
  trackedStatus: string
  trackedState: string
  messages: string[]
  downloadId: string | null
  type: 'movie' | 'show'
  seasonNumber?: number | null
  seriesId?: number | null
  movieId?: number | null
}

export interface Download {
  hash: string
  name: string
  progress: number
  dlspeed: number
  seeders: number
  eta: number
  size: number
  state: 'downloading' | 'paused' | 'seeding'
}
