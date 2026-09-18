import { useState, useEffect } from 'react'
import type { LibraryMovie, LibraryShow } from '../../types/media'
import { formatSize, fmtSeason } from '../../utils/format'
import { useToast } from '../../hooks/useToast'
import ModalShell from '../ModalShell'
import SeasonSearchModal from './SeasonSearchModal'

type EpisodeInfo = { id: number; ep: number; title: string; hasFile: boolean; fileId: number | null }
type ShareState  = 'idle' | 'sharing' | 'copied' | 'error'

async function doShare(body: Record<string, unknown>, set: (s: ShareState) => void) {
  set('sharing')
  try {
    const res = await fetch('/api/media/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error()
    const { url } = await res.json()
    await navigator.clipboard.writeText(url)
    set('copied')
    setTimeout(() => set('idle'), 2000)
  } catch {
    set('error')
    setTimeout(() => set('idle'), 2000)
  }
}

function shareLabel(s: ShareState) {
  return s === 'sharing' ? '...' : s === 'copied' ? 'link copied!' : s === 'error' ? 'failed' : 'share'
}

export default function LibraryModal({ item, type, shareEnabled, onClose, onDeleted, onOpenSearch }: {
  item: LibraryMovie | LibraryShow
  type: 'movie' | 'show'
  shareEnabled: boolean
  onClose: () => void
  onDeleted: () => void
  onOpenSearch: () => void
}) {
  const [confirming, setConfirming]     = useState(false)
  const [deleting, setDeleting]         = useState(false)
  const [seasonPicker, setSeasonPicker] = useState<number | null>(null)
  const [shareState, setShareState]     = useState<ShareState>('idle')
  const [selectedSeason, setSelectedSeason]     = useState<number | null>(null)
  const [episodesBySeason, setEpisodesBySeason] = useState<Record<number, EpisodeInfo[]> | null>(null)
  const [epLoading, setEpLoading]   = useState(false)
  const [deletingEp, setDeletingEp] = useState<Set<number>>(new Set())

  const toast = useToast()
  const movie = type === 'movie' ? item as LibraryMovie : null
  const show  = type === 'show'  ? item as LibraryShow  : null

  useEffect(() => {
    if (!show) return
    const first = show.seasons.find(s => s.episodeFileCount > 0) ?? show.seasons[0]
    setSelectedSeason(first?.seasonNumber ?? null)
    setEpLoading(true)
    fetch(`/api/media/show-episodes?seriesId=${show.id}`)
      .then(r => r.json())
      .then(data => setEpisodesBySeason(data))
      .catch(() => {})
      .finally(() => setEpLoading(false))
  }, [show?.id])

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch('/api/media/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id: item.id, title: item.title }),
      })
      const data = await res.json()
      if (data.success) { toast.show('deleted'); onDeleted() }
      else throw new Error(data.message)
    } catch {
      toast.show('delete failed', 'error')
      setDeleting(false)
    }
  }

  async function handleDeleteEpisode(ep: EpisodeInfo) {
    if (!ep.fileId) return
    setDeletingEp(s => new Set(s).add(ep.id))
    try {
      const res = await fetch('/api/media/delete-episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: ep.fileId }),
      })
      const data = await res.json()
      if (data.success) {
        setEpisodesBySeason(prev => {
          if (!prev) return prev
          const updated = { ...prev }
          for (const sn of Object.keys(updated)) {
            updated[+sn] = updated[+sn].map(e =>
              e.id === ep.id ? { ...e, hasFile: false, fileId: null } : e
            )
          }
          return updated
        })
        toast.show('episode deleted')
      } else throw new Error()
    } catch {
      toast.show('delete failed', 'error')
    }
    setDeletingEp(s => { const n = new Set(s); n.delete(ep.id); return n })
  }

  const selectedSeasonStat = show?.seasons.find(s => s.seasonNumber === selectedSeason)
  const selectedEpisodes   = selectedSeason !== null ? (episodesBySeason?.[selectedSeason] ?? null) : null

  return (
    <>
    <ModalShell onClose={() => { if (!deleting) onClose() }} width={520}>
      {/* header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 20px', borderBottom: '1px dashed var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0, marginRight: '12px' }}>
          <span style={{ fontSize: '14px', color: 'var(--text)' }}>{item.title}</span>
          <span style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>{item.year}</span>
        </div>
        <button onClick={onClose} aria-label="close" className="btn-close">×</button>
      </div>

      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {/* movie */}
        {movie && (
          <>
            {movie.hasFile && movie.fileName && (
              <div style={{ marginBottom: '8px', flexShrink: 0 }}>
                <div className="meta" style={{ letterSpacing: '0.1em', marginBottom: '2px' }}>file</div>
                <div style={{ fontSize: '12px', color: 'var(--text)', wordBreak: 'break-all' }}>{movie.fileName}</div>
              </div>
            )}
            {movie.hasFile && movie.fileSize && (
              <div style={{ marginBottom: '20px', flexShrink: 0 }}>
                <div className="meta" style={{ letterSpacing: '0.1em', marginBottom: '2px' }}>size</div>
                <div style={{ fontSize: '12px', color: 'var(--text)' }}>{formatSize(movie.fileSize)}</div>
              </div>
            )}
            {!movie.hasFile && (
              <div className="meta" style={{ marginBottom: '20px', flexShrink: 0 }}>not yet downloaded</div>
            )}
          </>
        )}

        {/* show — season tabs (fixed) + episode list (scrollable) */}
        {show && show.seasons.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, marginBottom: '12px' }}>
            <div style={{ display: 'flex', border: '1px dashed var(--border)', marginBottom: '14px', flexShrink: 0 }}>
              {show.seasons.map((ss, i) => (
                <button
                  key={ss.seasonNumber}
                  onClick={() => setSelectedSeason(ss.seasonNumber)}
                  style={{
                    flex: 1, background: 'none', border: 'none',
                    borderRight: i < show.seasons.length - 1 ? '1px dashed var(--border)' : 'none',
                    padding: '8px 4px', textAlign: 'center',
                    fontSize: '11px', fontStyle: 'italic', letterSpacing: '0.1em',
                    color: selectedSeason === ss.seasonNumber ? 'var(--accent)' : 'var(--muted)',
                  }}
                >
                  {fmtSeason(ss.seasonNumber)}
                </button>
              ))}
            </div>

            <div style={{ overflow: 'auto', flex: 1, paddingRight: '8px' }}>
              {selectedSeason !== null && (
                epLoading ? (
                  <span className="meta">loading...</span>
                ) : selectedEpisodes ? (
                  selectedEpisodes.map(ep => (
                    <div key={ep.id} className="row" style={{ padding: '5px 0', borderBottom: '1px dashed var(--border)' }}>
                      <span style={{
                        fontSize: '12px', color: ep.hasFile ? 'var(--text)' : 'var(--muted)',
                        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '12px',
                      }}>
                        {ep.ep}. {ep.title}
                      </span>
                      <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
                        {ep.hasFile && ep.fileId && (
                          <button onClick={() => handleDeleteEpisode(ep)} disabled={deletingEp.has(ep.id)}
                            className="modal-btn modal-btn--danger" style={{ minHeight: 'auto', padding: 0 }}>
                            {deletingEp.has(ep.id) ? '...' : 'del'}
                          </button>
                        )}
                        {!ep.hasFile && (
                          <button onClick={() => setSeasonPicker(selectedSeason)}
                            className="modal-btn modal-btn--danger" style={{ minHeight: 'auto', padding: 0 }}>
                            re
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <span className="meta">
                    {selectedSeasonStat?.episodeFileCount ?? 0} / {selectedSeasonStat?.totalEpisodeCount ?? 0} episodes
                  </span>
                )
              )}
            </div>
          </div>
        )}

        {/* actions — always visible */}
        <div style={{ flexShrink: 0, paddingTop: '4px' }}>
          {confirming ? (
            <>
              <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '12px', fontStyle: 'italic' }}>delete all files?</div>
              <div className="modal-actions">
                {deleting ? (
                  <span style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>deleting...</span>
                ) : (
                  <>
                    <button onClick={handleDelete} className="modal-btn modal-btn--danger">confirm</button>
                    <button onClick={() => setConfirming(false)} className="modal-btn">cancel</button>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="row">
              <button onClick={() => setConfirming(true)} className="modal-btn modal-btn--danger">delete</button>
              <button onClick={onOpenSearch} className="modal-btn modal-btn--white">search</button>
              {shareEnabled && movie?.hasFile && movie.folderPath && (
                <button onClick={() => doShare({ path: movie!.folderPath, poster: movie!.poster }, setShareState)}
                  disabled={shareState === 'sharing'} className="modal-btn modal-btn--warn">
                  {shareLabel(shareState)}
                </button>
              )}
              {shareEnabled && show?.folderPath && (
                <button onClick={() => doShare({ path: show!.folderPath, poster: show!.poster }, setShareState)}
                  disabled={shareState === 'sharing'} className="modal-btn modal-btn--warn">
                  {shareLabel(shareState)}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </ModalShell>

    {show && seasonPicker !== null && (
      <SeasonSearchModal
        show={show}
        seasonNumber={seasonPicker}
        onClose={() => setSeasonPicker(null)}
        onDone={() => setSeasonPicker(null)}
      />
    )}
    </>
  )
}
