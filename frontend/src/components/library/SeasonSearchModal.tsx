import { useState } from 'react'
import type { LibraryShow } from '../../types/media'
import { fmtSeason } from '../../utils/format'
import { useToast } from '../../hooks/useToast'
import ModalShell from '../ModalShell'

interface MissingEpisode {
  id: number
  episodeNumber: number
}

type Mode = 'intent' | 'episodes'

export default function SeasonSearchModal({ show, seasonNumber, onClose, onDone }: {
  show: LibraryShow
  seasonNumber: number
  onClose: () => void
  onDone: () => void
}) {
  const [mode, setMode]           = useState<Mode>('intent')
  const [episodes, setEpisodes]   = useState<MissingEpisode[]>([])
  const [loading, setLoading]     = useState(false)
  const [selected, setSelected]   = useState<Set<number>>(new Set())
  const [searching, setSearching] = useState(false)
  const toast = useToast()

  function enterEpisodes() {
    setMode('episodes')
    setLoading(true)
    fetch(`/api/media/episodes?seriesId=${show.id}&season=${seasonNumber}`)
      .then(r => r.json())
      .then((data: MissingEpisode[]) => { setEpisodes(data); setLoading(false) })
      .catch(() => { toast.show('failed to load episodes', 'error'); setLoading(false) })
  }

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleFullSeason() {
    setSearching(true)
    try {
      const res = await fetch('/api/media/autograb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'show', title: show.title, tvdbId: show.tvdbId, inLibrary: true, seasons: [seasonNumber] }),
      })
      const data = await res.json()
      if (data.success) { toast.show(`${fmtSeason(seasonNumber)} queued`, 'success'); onDone() }
      else throw new Error(data.message)
    } catch {
      toast.show('search failed', 'error')
      setSearching(false)
    }
  }

  async function handleEpisodeSearch() {
    if (selected.size === 0) return
    setSearching(true)
    try {
      const res = await fetch('/api/media/episode-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeIds: [...selected] }),
      })
      const data = await res.json()
      if (data.success) {
        toast.show(`${selected.size} episode${selected.size > 1 ? 's' : ''} queued`, 'success')
        onDone()
      } else throw new Error(data.message)
    } catch {
      toast.show('search failed', 'error')
      setSearching(false)
    }
  }

  const header = (
    <div className="row" style={{ padding: '14px 20px', borderBottom: '1px dashed var(--border)', flexShrink: 0 }}>
      <span style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic', letterSpacing: '0.1em' }}>
        {fmtSeason(seasonNumber)}
      </span>
      <button onClick={onClose} className="btn-close" aria-label="close">×</button>
    </div>
  )

  if (mode === 'intent') {
    return (
      <ModalShell onClose={onClose} width={360}>
        {header}
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button onClick={handleFullSeason} disabled={searching} className="modal-btn">
            {searching ? '...' : 'auto'}
          </button>
          <button onClick={enterEpisodes} disabled={searching} className="modal-btn">
            pick episodes
          </button>
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell onClose={onClose} width={360}>
      {header}
      <div style={{ padding: '20px', flex: 1, overflow: 'auto' }}>
        {loading ? (
          <span style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>loading...</span>
        ) : episodes.length === 0 ? (
          <span style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>no missing episodes</span>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {episodes.map(ep => {
              const sel = selected.has(ep.id)
              return (
                <button
                  key={ep.id}
                  onClick={() => toggle(ep.id)}
                  style={{
                    fontSize: '10px', letterSpacing: '0.1em', padding: '5px 10px',
                    background: sel ? 'var(--accent)' : 'none',
                    border: `1px dashed ${sel ? 'rgba(255,255,255,0.2)' : 'var(--border)'}`,
                    color: sel ? 'var(--white)' : 'var(--muted)',
                    cursor: 'pointer', fontFamily: 'var(--font)', fontStyle: 'italic',
                    minHeight: '32px',
                  }}
                >
                  e{String(ep.episodeNumber).padStart(2, '0')}
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="row" style={{ padding: '14px 20px', borderTop: '1px dashed var(--border)', flexShrink: 0 }}>
        <button onClick={handleFullSeason} disabled={searching} className="modal-btn">
          full season
        </button>
        <button
          onClick={handleEpisodeSearch}
          disabled={searching || selected.size === 0}
          className="modal-btn"
          style={{ opacity: selected.size > 0 ? 1 : 0.35 }}
        >
          {selected.size > 0 ? `search selected (${selected.size})` : 'search selected'}
        </button>
      </div>
    </ModalShell>
  )
}
