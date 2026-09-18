import { useState, useEffect, useMemo } from 'react'
import type { SearchResult, Release } from '../../types/media'
import { fmtSeason } from '../../utils/format'
import { useToast } from '../../hooks/useToast'
import ModalShell from '../ModalShell'
import ReleaseRow from './ReleaseRow'

function isEpisodeRelease(title: string): boolean {
  return /S\d{2}E\d{2}/i.test(title)
}

function matchesSeason(title: string, season: number): boolean {
  const pad = String(season).padStart(2, '0')
  if (new RegExp(`S${pad}(?!\\d)`, 'i').test(title)) return true
  const range = title.match(/S(\d{2})-S(\d{2})/i)
  if (range) return season >= parseInt(range[1], 10) && season <= parseInt(range[2], 10)
  return false
}

type Mode = 'intent' | 'releases'
type SelectedSeasons = 'all' | number[]

export default function SearchModal({ result, onClose }: { result: SearchResult; onClose: () => void }) {
  const [mode, setMode]             = useState<Mode>('intent')
  const [releases, setReleases]     = useState<Release[] | null>(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [grabStates, setGrabStates] = useState<Record<string, 'idle' | 'grabbing' | 'grabbed' | 'error'>>({})
  const [selectedSeasons, setSelectedSeasons] = useState<SelectedSeasons>('all')
  const [autoGrabState, setAutoGrabState]     = useState<'idle' | 'grabbing' | 'grabbed' | 'error'>('idle')
  // Browsing releases may have silently added this movie/series to radarr/sonarr (unmonitored,
  // just so its own interactive search endpoint has something to search against). If the user
  // never actually grabs anything, that phantom entry gets cleaned up on close.
  const [resolvedArrId, setResolvedArrId] = useState<number | null>(result.inLibrary ? result.id : null)
  const [addedFresh, setAddedFresh]       = useState(false)
  const [grabbedAny, setGrabbedAny]       = useState(false)
  const toast = useToast()

  const seasons = result.type === 'show' ? (result.seasons ?? []) : []

  const seasonKey = selectedSeasons === 'all'
    ? 'all'
    : [...selectedSeasons].sort((a, b) => a - b).join(',')

  function toggleSeason(s: number | 'all') {
    if (s === 'all') {
      setSelectedSeasons('all')
    } else if (selectedSeasons === 'all') {
      setSelectedSeasons([s])
    } else {
      const next = selectedSeasons.includes(s)
        ? selectedSeasons.filter(n => n !== s)
        : [...selectedSeasons, s]
      setSelectedSeasons(next.length === 0 ? 'all' : next)
    }
    setAutoGrabState('idle')
  }

  function isSeasonSelected(s: number | 'all') {
    return s === 'all' ? selectedSeasons === 'all' : selectedSeasons !== 'all' && selectedSeasons.includes(s)
  }

  useEffect(() => {
    if (mode !== 'releases') return
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        let arrId = resolvedArrId
        if (arrId === null) {
          const resolveBody: Record<string, unknown> = { type: result.type, title: result.title }
          if (result.type === 'movie') resolveBody.tmdbId = result.tmdbId
          else resolveBody.tvdbId = result.tvdbId
          const resolveRes = await fetch('/api/media/resolve-arr-id', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(resolveBody),
          })
          if (!resolveRes.ok) {
            const b = await resolveRes.json().catch(() => ({}))
            throw new Error(b.error ?? `${resolveRes.status}`)
          }
          const resolveData = await resolveRes.json()
          if (cancelled) {
            // Modal already closed by the time this fast call landed — clean up right away
            // instead of waiting on the unmount effect, which already ran with stale state.
            if (resolveData.addedFresh) {
              const payload = JSON.stringify({ type: result.type, id: resolveData.arrId, title: result.title })
              if (navigator.sendBeacon) navigator.sendBeacon('/api/media/delete', new Blob([payload], { type: 'application/json' }))
              else fetch('/api/media/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {})
            }
            return
          }
          arrId = resolveData.arrId
          setResolvedArrId(arrId)
          if (resolveData.addedFresh) setAddedFresh(true)
        }

        const params = new URLSearchParams({ type: result.type, arrId: String(arrId) })
        if (result.type === 'show' && selectedSeasons !== 'all' && selectedSeasons.length === 1) {
          params.set('season', String(selectedSeasons[0]))
        }
        const res = await fetch(`/api/media/releases?${params}`)
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `${res.status}`)
        }
        const data = await res.json()
        if (!cancelled) setReleases(data.releases)
      } catch (err) {
        if (!cancelled) setError(String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [mode, result.title, result.type, seasonKey]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleGrab(release: Release) {
    if (resolvedArrId === null) return
    setGrabStates(s => ({ ...s, [release.guid]: 'grabbing' }))
    try {
      const body: Record<string, unknown> = {
        type: result.type, arrId: resolvedArrId,
        releaseTitle: release.title, guid: release.guid,
        downloadUrl: release.downloadUrl, magnetUrl: release.magnetUrl,
        publishDate: release.publishDate, indexerId: release.indexerId,
      }
      if (result.type === 'show' && selectedSeasons !== 'all' && selectedSeasons.length === 1) {
        body.selectedSeason = selectedSeasons[0]
      }
      const res  = await fetch('/api/media/grab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      const ok   = data.success === true
      setGrabStates(s => ({ ...s, [release.guid]: ok ? 'grabbed' : 'error' }))
      if (ok) setGrabbedAny(true)
      toast.show(ok ? 'grabbed' : `grab failed${data.message ? ': ' + data.message : ''}`, ok ? 'success' : 'error')
    } catch {
      setGrabStates(s => ({ ...s, [release.guid]: 'error' }))
      toast.show('grab failed', 'error')
    }
  }

  async function handleAutoGrab() {
    setAutoGrabState('grabbing')
    try {
      // If browsing releases already added this movie/series (unmonitored), tell autograb
      // it's "in library" so it looks it up by tmdbId/tvdbId instead of trying to re-add it.
      const body: Record<string, unknown> = {
        type: result.type, title: result.title, inLibrary: result.inLibrary || addedFresh,
      }
      if (result.type === 'movie') {
        body.tmdbId = result.tmdbId
      } else {
        body.tvdbId = result.tvdbId
        body.seasons = selectedSeasons === 'all' ? (result.seasons ?? []) : selectedSeasons
      }
      const res  = await fetch('/api/media/autograb', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      setAutoGrabState(data.success ? 'grabbed' : 'error')
      if (data.success) setGrabbedAny(true)
      toast.show(data.success ? 'queued for download' : 'autograb failed', data.success ? 'success' : 'error')
      if (data.success) setTimeout(onClose, 600)
    } catch {
      setAutoGrabState('error')
      toast.show('autograb failed', 'error')
    }
  }

  // Cleanup runs on unmount (covers the explicit close button/backdrop, and navigating away
  // within the app) and on pagehide via sendBeacon (covers closing the tab or reloading,
  // where a normal fetch can get cancelled mid-flight before it reaches the server).
  useEffect(() => {
    function cleanupPhantomEntry() {
      if (!addedFresh || resolvedArrId === null || grabbedAny) return
      const payload = JSON.stringify({ type: result.type, id: resolvedArrId, title: result.title })
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/media/delete', new Blob([payload], { type: 'application/json' }))
      } else {
        fetch('/api/media/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {})
      }
    }
    window.addEventListener('pagehide', cleanupPhantomEntry)
    return () => {
      window.removeEventListener('pagehide', cleanupPhantomEntry)
      cleanupPhantomEntry()
    }
  }, [addedFresh, resolvedArrId, grabbedAny, result.type, result.title])

  const visibleReleases = useMemo(() => {
    if (!releases) return []
    return releases.filter(rel =>
      selectedSeasons === 'all'
        ? !isEpisodeRelease(rel.title)
        : selectedSeasons.some(s => matchesSeason(rel.title, s))
    )
  }, [releases, selectedSeasons])

  const seasonPills = seasons.length > 0 && (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
      {(['all', ...seasons] as const).map(s => {
        const sel = isSeasonSelected(s as number | 'all')
        return (
          <button
            key={s}
            onClick={() => toggleSeason(s as number | 'all')}
            style={{
              fontSize: '10px', letterSpacing: '0.15em', padding: '5px 12px',
              background: 'none',
              border: sel ? '1px dashed var(--accent)' : '1px dashed var(--border)',
              color: sel ? 'var(--white)' : 'var(--muted)',
              cursor: 'pointer', fontFamily: 'var(--font)',
              minHeight: '32px',
            }}
          >
            {s === 'all' ? 'all' : fmtSeason(s as number)}
          </button>
        )
      })}
    </div>
  )

  const noReleasesMsg = selectedSeasons === 'all'
    ? 'no releases found'
    : `no releases found for ${(selectedSeasons as number[]).map(s => fmtSeason(s)).join(', ')}`

  if (mode === 'intent') {
    return (
      <ModalShell onClose={onClose} width={360}>
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="row">
            <div>
              <div style={{ fontSize: '14px', color: 'var(--text)' }}>{result.title}</div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic', marginTop: '2px' }}>{result.year}</div>
            </div>
            <button onClick={onClose} className="btn-close" aria-label="close">×</button>
          </div>

          {seasonPills}

          <div className="row">
            <button
              onClick={handleAutoGrab}
              disabled={autoGrabState === 'grabbing' || autoGrabState === 'grabbed'}
              className="modal-btn modal-btn--danger"
            >
              {autoGrabState === 'idle'     ? 'auto'   :
               autoGrabState === 'grabbing' ? '...'    :
               autoGrabState === 'grabbed'  ? 'queued' : 'failed'}
            </button>
            <button onClick={() => setMode('releases')} className="modal-btn modal-btn--danger">
              manual
            </button>
          </div>
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell onClose={onClose} width={740}>
      <div className="row" style={{ padding: '14px 20px', borderBottom: '1px dashed var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '14px', color: 'var(--text)' }}>{result.title}</span>
          <span style={{ fontSize: '12px', color: 'var(--muted)', fontStyle: 'italic' }}>{result.year}</span>
          {result.inLibrary && <span style={{ fontSize: '11px', color: 'var(--muted)', letterSpacing: '0.15em', fontStyle: 'italic' }}>in library</span>}
        </div>
        <button onClick={onClose} aria-label="close" className="btn-close">×</button>
      </div>

      {seasons.length > 0 && (
        <div style={{ padding: '10px 20px', borderBottom: '1px dashed var(--border)', flexShrink: 0 }}>
          {seasonPills}
        </div>
      )}

      <div style={{ overflow: 'auto', flex: 1, padding: '0 20px' }}>
        {loading && <p style={{ fontSize: '12px', color: 'var(--muted)', textAlign: 'center', margin: '40px 0', fontStyle: 'italic' }}>searching releases<span className="dots"><span>.</span><span>.</span><span>.</span></span></p>}
        {!loading && error && <p style={{ fontSize: '12px', color: 'var(--accent)', margin: '40px 0', fontStyle: 'italic' }}>fetch error — {error}</p>}
        {!loading && !error && visibleReleases.length === 0 && (
          <p style={{ fontSize: '12px', color: 'var(--muted)', margin: '40px 0', fontStyle: 'italic' }}>{noReleasesMsg}</p>
        )}
        {!loading && visibleReleases.map(rel => (
          <ReleaseRow
            key={rel.guid}
            release={rel}
            onGrab={() => handleGrab(rel)}
            grabState={grabStates[rel.guid] ?? 'idle'}
            mediaType={result.type}
          />
        ))}
      </div>
    </ModalShell>
  )
}
