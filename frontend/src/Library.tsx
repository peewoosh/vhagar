import { useState, useEffect, useRef, useMemo } from 'react'
import Fuse from 'fuse.js'
import { useToast } from './hooks/useToast'
import type { SearchResult, LibraryMovie, LibraryShow, Download, QueueItem } from './types/media'
import PosterCard from './components/library/PosterCard'
import SearchModal from './components/library/SearchModal'
import LibraryModal from './components/library/LibraryModal'
import QueueRow from './components/library/QueueRow'
import DownloadRow from './components/library/DownloadRow'
import StorageText from './components/shared/StorageText'

type TypeFilter = 'movie' | 'show'


const searchCache = new Map<string, { results: SearchResult[]; ts: number }>()

const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000
const DOWNLOADS_POLL_MS   = 5_000
const QUEUE_POLL_MS       = 30_000
const LIB_CACHE_KEY       = 'vhagar_library'
const LIB_CACHE_VERSION   = 4

const POSTER_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
  gap: '12px',
}

function readCache(): { movies: LibraryMovie[]; shows: LibraryShow[] } | null {
  try {
    const raw = localStorage.getItem(LIB_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?._v !== LIB_CACHE_VERSION) { localStorage.removeItem(LIB_CACHE_KEY); return null }
    return parsed
  } catch { return null }
}

function writeCache(data: { movies: LibraryMovie[]; shows: LibraryShow[] }) {
  try { localStorage.setItem(LIB_CACHE_KEY, JSON.stringify({ ...data, _v: LIB_CACHE_VERSION })) } catch {}
}

export default function Library() {
  const [query, setQuery]             = useState('')
  const [typeFilter, setTypeFilter]   = useState<TypeFilter>('movie')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching]     = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)

  const [library, setLibrary]               = useState<{ movies: LibraryMovie[]; shows: LibraryShow[] } | null>(() => readCache())
  const [libraryLoading, setLibraryLoading] = useState<boolean>(() => readCache() === null)
  const [libraryError, setLibraryError]     = useState(false)

  const [downloads, setDownloads]         = useState<Download[]>([])
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  const [queue, setQueue]                 = useState<QueueItem[]>([])
  const [missingSubs, setMissingSubs]     = useState<{ movies: Set<number>; shows: Set<number> }>({ movies: new Set(), shows: new Set() })
  const [shareEnabled, setShareEnabled]   = useState(false)
  const prevDownloadStates                = useRef<Map<string, Download['state']> | null>(null)

  const toast = useToast()

  const [selectedSearch, setSelectedSearch]   = useState<SearchResult | null>(null)
  const [selectedLibItem, setSelectedLibItem] = useState<{ item: LibraryMovie | LibraryShow; type: 'movie' | 'show' } | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef    = useRef<AbortController | null>(null)

  async function fetchLibrary() {
    try {
      const res = await fetch('/api/media/library')
      if (!res.ok) throw new Error()
      const data = await res.json()
      writeCache(data)
      setLibrary(data)
      setLibraryError(false)
    } catch {
      setLibraryError(true)
    } finally {
      setLibraryLoading(false)
    }
  }

  async function fetchShareEnabled() {
    try {
      const res = await fetch('/api/media/share')
      if (!res.ok) return
      const data = await res.json()
      setShareEnabled(!!data.enabled)
    } catch {}
  }

  async function fetchSubtitles() {
    try {
      const res = await fetch('/api/media/subtitles')
      if (!res.ok) return
      const data = await res.json()
      setMissingSubs({ movies: new Set(data.movies), shows: new Set(data.shows) })
    } catch {}
  }

  async function fetchQueue() {
    try {
      const res = await fetch('/api/media/queue')
      if (!res.ok) return
      const data = await res.json()
      setQueue(data.queue ?? [])
    } catch {}
  }

  async function fetchDownloads() {
    try {
      const res = await fetch('/api/torrents')
      if (!res.ok) return
      const data = await res.json()
      const relevant = (data.torrents as Array<{
        hash: string; name: string; progress: number; dlspeed: number
        seeders: number; eta: number; size: number; state: string
      }>).filter(t => t.state === 'downloading' || t.state === 'paused' || t.state === 'seeding')

      setDownloads(relevant.map(t => ({
        hash: t.hash, name: t.name, progress: t.progress,
        dlspeed: t.dlspeed, seeders: t.seeders, eta: t.eta, size: t.size,
        state: t.state as Download['state'],
      })))

      const newStates = new Map(relevant.map(t => [t.hash, t.state as Download['state']]))
      if (prevDownloadStates.current !== null) {
        const justFinished = [...newStates].filter(([hash, state]) =>
          state === 'seeding' && prevDownloadStates.current!.get(hash) !== 'seeding' && prevDownloadStates.current!.has(hash)
        )
        if (justFinished.length > 0) {
          toast.show(justFinished.length === 1 ? 'download complete' : `${justFinished.length} downloads complete`)
          fetch('/api/media/jellyfin/scan', { method: 'POST' }).catch(() => {})
          fetchLibrary()
          fetchQueue()
        }
      }
      prevDownloadStates.current = newStates
    } catch {}
  }

  useEffect(() => {
    fetchLibrary()
    fetchDownloads()
    fetchQueue()
    fetchSubtitles()
    fetchShareEnabled()
    const dlId    = setInterval(fetchDownloads, DOWNLOADS_POLL_MS)
    const queueId = setInterval(fetchQueue, QUEUE_POLL_MS)
    return () => { clearInterval(dlId); clearInterval(queueId) }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setSelectedSearch(null); setSelectedLibItem(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    function dismissKeyboard() {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    }
    window.addEventListener('touchmove', dismissKeyboard, { passive: true })
    return () => window.removeEventListener('touchmove', dismissKeyboard)
  }, [])

  async function doSearch(q: string) {
    const key = q.trim().toLowerCase()
    if (!key) return
    const hit = searchCache.get(key)
    if (hit && Date.now() - hit.ts < SEARCH_CACHE_TTL_MS) {
      setSearchResults(hit.results); setHasSearched(true); return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setSearching(true); setSearchError(null); setHasSearched(true)
    try {
      const res = await fetch(`/api/media/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
      if (!res.ok) {
        let msg = `${res.status}`
        try { const j = await res.json(); if (j?.error) msg = j.error } catch {}
        throw new Error(msg)
      }
      const data = await res.json()
      searchCache.set(key, { results: data.results, ts: Date.now() })
      setSearchResults(data.results)
      setSearchError(null)
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return
      setSearchError(String(err)); setSearchResults([])
    } finally {
      if (!controller.signal.aborted) setSearching(false)
    }
  }

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.trim().length >= 2) {
      debounceRef.current = setTimeout(() => doSearch(val), 350)
    } else {
      setSearchResults([]); setHasSearched(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      doSearch(query)
    }
  }

  const movieFuse = useMemo(() => new Fuse(library?.movies ?? [], { keys: ['title'], threshold: 0.35 }), [library?.movies])
  const showFuse  = useMemo(() => new Fuse(library?.shows  ?? [], { keys: ['title'], threshold: 0.35 }), [library?.shows])

  const isSearchMode   = query.trim().length > 0
  const visibleResults = searchResults.filter(r => r.type === typeFilter)
  const localMatches   = isSearchMode
    ? (typeFilter === 'movie' ? movieFuse.search(query).map(r => r.item) : showFuse.search(query).map(r => r.item))
    : []

  return (
    <div>
      {/* search bar + type filter */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          {(['movie', 'show'] as TypeFilter[]).map(t => (
            <button
              key={t}
              onClick={() => { setTypeFilter(t); setQuery(''); setSearchResults([]); setHasSearched(false); setSearchError(null) }}
              style={{
                fontSize: '12px', letterSpacing: '0.15em',
                color: typeFilter === t ? 'var(--white)' : 'var(--muted)',
                background: 'none',
                border: typeFilter === t ? '1px dashed var(--accent)' : '1px dashed var(--border)',
                padding: '0 14px', cursor: 'pointer',
                height: '34px', display: 'flex', alignItems: 'center',
                minWidth: '60px', justifyContent: 'center',
              }}
            >
              {t === 'movie' ? 'films' : 'tv'}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={query}
          onChange={handleQueryChange}
          onKeyDown={handleKeyDown}
          className="search-input"
          style={{
            flex: 1, background: 'var(--surface)', border: '1px dashed var(--border)',
            color: 'var(--text)', fontFamily: 'var(--font)', padding: '0 12px', outline: 'none',
            height: '34px',
          }}
        />
      </div>

      <div style={{ marginBottom: '20px' }}><StorageText /></div>

      {isSearchMode ? (
        <div>
          {localMatches.length > 0 && (
            <section style={{ marginBottom: '32px' }}>
              <div className="section-label">in your library</div>
              <div style={POSTER_GRID}>
                {localMatches.map(item => (
                  <PosterCard
                    key={item.id}
                    title={item.title}
                    year={item.year}
                    poster={item.poster}
                    onClick={() => setSelectedLibItem({ item, type: typeFilter })}
                  />
                ))}
              </div>
            </section>
          )}
          {searching && <p style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic', marginBottom: '16px' }}>searching<span className="dots"><span>.</span><span>.</span><span>.</span></span></p>}
          {!searching && searchError && <p style={{ fontSize: '12px', color: 'var(--accent)', fontStyle: 'italic' }}>fetch error — {searchError}</p>}
          {!searching && hasSearched && !searchError && visibleResults.length === 0 && localMatches.length === 0 && (
            <p style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>
              {`no ${typeFilter === 'movie' ? 'movies' : 'shows'} found for "${query}"`}
            </p>
          )}
          {visibleResults.length > 0 && (
            <section>
              <div className="section-label">results</div>
              <div style={POSTER_GRID}>
                {visibleResults.map(result => (
                  <PosterCard
                    key={`${result.type}-${result.tmdbId ?? result.tvdbId ?? result.title}`}
                    title={result.title}
                    year={result.year}
                    poster={result.poster ?? null}
                    overlay={result.inLibrary ? (
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.7)', fontSize: '8px', color: 'var(--muted)', letterSpacing: '0.2em', textAlign: 'center', padding: '5px', fontStyle: 'italic' }}>
                        in library
                      </div>
                    ) : undefined}
                    onClick={() => setSelectedSearch(result)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div>
          {/* active downloads + arr queue */}
          {(downloads.length > 0 || queue.length > 0) && (() => {
            const dlHashes      = new Set(downloads.map(d => d.hash.toUpperCase()))
            const filteredQueue = queue.filter(item =>
              !item.downloadId || !dlHashes.has(item.downloadId.toUpperCase())
            )

            // Dedup: Sonarr creates one queue entry per episode; collapse to one row per download
            const groupedIds = new Map<string, number[]>()
            const dedupedQueue: QueueItem[] = []
            for (const item of filteredQueue) {
              const key = item.downloadId ?? `${item.type}-${item.title}-${item.seasonNumber ?? ''}`
              if (!groupedIds.has(key)) {
                groupedIds.set(key, [item.id])
                dedupedQueue.push(item)
              } else {
                groupedIds.get(key)!.push(item.id)
              }
            }

            const total = downloads.length + dedupedQueue.length
            return (
              <section style={{ marginBottom: '32px' }}>
                <button
                  onClick={() => setDownloadsOpen(o => !o)}
                  style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'var(--font)', cursor: 'pointer', marginBottom: downloadsOpen ? '10px' : 0 }}
                >
                  <span className="meta" style={{ letterSpacing: '0.3em' }}>
                    {downloadsOpen ? '▾' : '▸'} {total} active
                  </span>
                </button>
                {downloadsOpen && (
                  <>
                    {downloads.map(dl => <DownloadRow key={dl.hash} dl={dl} onDeleted={fetchDownloads} />)}
                    {dedupedQueue.map(item => (
                      <QueueRow
                        key={`${item.type}-${item.id}`}
                        item={item}
                        onImport={async () => {
                          await fetch('/api/media/queue/import', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ type: item.type, seriesId: item.seriesId, movieId: item.movieId }),
                          })
                          toast.show('import triggered')
                          setTimeout(fetchQueue, 3000)
                        }}
                        onRemove={async () => {
                          const key = item.downloadId ?? `${item.type}-${item.title}-${item.seasonNumber ?? ''}`
                          const ids = groupedIds.get(key) ?? [item.id]
                          if (item.downloadId) {
                            await fetch('/api/media/queue/delete', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ hash: item.downloadId }),
                            })
                          } else {
                            await Promise.all(ids.map(arrId =>
                              fetch('/api/media/queue/delete', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ arrId, type: item.type }),
                              })
                            ))
                          }
                          fetchQueue()
                          fetchDownloads()
                        }}
                      />
                    ))}
                  </>
                )}
              </section>
            )
          })()}

          {typeFilter === 'movie' && (
            <section>
              <div className="section-label">films</div>
              {libraryLoading && <p style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>loading...</p>}
              {libraryError  && <p style={{ fontSize: '12px', color: 'var(--accent)', fontStyle: 'italic' }}>fetch error</p>}
              {!libraryLoading && !libraryError && library?.movies.length === 0 && (
                <p style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>no films in library</p>
              )}
              {library && library.movies.length > 0 && (
                <div style={POSTER_GRID}>
                  {library.movies.map(m => (
                    <PosterCard
                      key={m.id}
                      title={m.title}
                      year={m.year}
                      poster={m.poster}
                      missingSubtitles={missingSubs.movies.has(m.id)}
                      pending={!m.hasFile}
                      onClick={() => setSelectedLibItem({ item: m, type: 'movie' })}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {typeFilter === 'show' && (
            <section>
              <div className="section-label">tv</div>
              {libraryLoading && <p style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>loading...</p>}
              {libraryError  && <p style={{ fontSize: '12px', color: 'var(--accent)', fontStyle: 'italic' }}>fetch error</p>}
              {!libraryLoading && !libraryError && library?.shows.length === 0 && (
                <p style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>no shows in library</p>
              )}
              {library && library.shows.length > 0 && (
                <div style={POSTER_GRID}>
                  {library.shows.map(s => {
                    const showPending = s.seasons.every(ss => ss.episodeFileCount === 0)
                    return (
                      <PosterCard
                        key={s.id}
                        title={s.title}
                        year={s.year}
                        poster={s.poster}
                        missingSubtitles={missingSubs.shows.has(s.id)}
                        pending={showPending}
                        onClick={() => setSelectedLibItem({ item: s, type: 'show' })}
                      />
                    )
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {selectedSearch && (
        <SearchModal result={selectedSearch} onClose={() => setSelectedSearch(null)} />
      )}
      {selectedLibItem && (
        <LibraryModal
          item={selectedLibItem.item}
          type={selectedLibItem.type}
          shareEnabled={shareEnabled}
          onClose={() => setSelectedLibItem(null)}
          onDeleted={() => { setSelectedLibItem(null); fetchLibrary() }}
          onOpenSearch={() => {
            const { item, type } = selectedLibItem
            setSelectedLibItem(null)
            if (type === 'movie') {
              const m = item as LibraryMovie
              setSelectedSearch({ id: m.id, title: m.title, year: m.year, inLibrary: true, type: 'movie', tmdbId: m.tmdbId, poster: m.poster })
            } else {
              const s = item as LibraryShow
              setSelectedSearch({ id: s.id, title: s.title, year: s.year, inLibrary: true, type: 'show', tvdbId: s.tvdbId, poster: s.poster, seasons: s.seasons.map(ss => ss.seasonNumber) })
            }
          }}
        />
      )}
    </div>
  )
}
