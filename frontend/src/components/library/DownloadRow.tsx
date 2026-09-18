import { useState, useEffect } from 'react'
import type { Download } from '../../types/media'
import { formatSize, formatSpeed, formatEta } from '../../utils/format'
import { useToast } from '../../hooks/useToast'
import GhostButton from '../shared/GhostButton'

export default function DownloadRow({ dl, onDeleted }: { dl: Download; onDeleted: () => void }) {
  const [delState, setDelState]     = useState<'idle' | 'confirm' | 'deleting'>('idle')
  const [pauseBusy, setPauseBusy]   = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (delState !== 'confirm') return
    const t = setTimeout(() => setDelState('idle'), 3000)
    return () => clearTimeout(t)
  }, [delState])

  async function handleDelete() {
    if (delState === 'idle') { setDelState('confirm'); return }
    setDelState('deleting')
    try {
      const res = await fetch('/api/media/queue/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: dl.hash }),
      })
      if (!res.ok) throw new Error()
      toast.show('removed')
      onDeleted()
    } catch {
      toast.show('remove failed', 'error')
      setDelState('idle')
    }
  }

  async function handlePauseToggle() {
    const action = dl.state === 'paused' ? 'resume' : 'pause'
    setPauseBusy(true)
    try {
      const res = await fetch(`/api/torrents/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: dl.hash }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error()
      onDeleted()
    } catch {
      toast.show(`${action} failed`, 'error')
    } finally {
      setPauseBusy(false)
    }
  }

  async function handleStopSeeding() {
    setPauseBusy(true)
    try {
      const res = await fetch('/api/torrents/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: dl.hash }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error()
      toast.show('seeding stopped')
      onDeleted()
    } catch {
      toast.show('stop seeding failed', 'error')
    } finally {
      setPauseBusy(false)
    }
  }

  const pct = Math.round(dl.progress * 100)
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px dashed var(--border)' }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text)', wordBreak: 'break-word', flex: 1 }}>
          {dl.name}
        </div>
        {dl.state === 'seeding' ? (
          <GhostButton onClick={handleStopSeeding} disabled={pauseBusy} variant="success">
            <i>{pauseBusy ? '...' : 'stop seeding'}</i>
          </GhostButton>
        ) : (
          <>
            <GhostButton onClick={handlePauseToggle} disabled={pauseBusy}>
              <i>{pauseBusy ? '...' : dl.state === 'paused' ? 'resume' : 'pause'}</i>
            </GhostButton>
            <GhostButton onClick={handleDelete} disabled={delState === 'deleting'} variant="danger">
              <i>{delState === 'confirm' ? 'sure?' : delState === 'deleting' ? '...' : 'delete'}</i>
            </GhostButton>
          </>
        )}
      </div>
      <div style={{ height: '3px', background: 'var(--border)', marginBottom: '5px' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', transition: 'width 0.5s' }} />
      </div>
      <div style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', gap: '10px', flexWrap: 'wrap', fontStyle: 'italic' }}>
        <span>{pct}%</span>
        <span>{formatSize(dl.size)}</span>
        {dl.seeders > 0 && <span>{dl.seeders} seeds</span>}
        {dl.dlspeed > 0 && <span>↓ {formatSpeed(dl.dlspeed)}</span>}
        {dl.eta >= 0 && <span>eta {formatEta(dl.eta)}</span>}
      </div>
    </div>
  )
}
