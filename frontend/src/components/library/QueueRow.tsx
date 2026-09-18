import type { QueueItem } from '../../types/media'
import { fmtSeason } from '../../utils/format'
import GhostButton from '../shared/GhostButton'

export default function QueueRow({ item, onRemove, onImport }: { item: QueueItem; onRemove: () => void; onImport: () => void }) {
  const isError   = item.trackedStatus === 'error'
  const isWarning = item.trackedStatus === 'warning'
  const color = isError ? 'var(--accent)' : isWarning ? 'var(--amber)' : 'var(--muted)'
  const isPending = item.trackedState === 'importPending'

  return (
    <div style={{ padding: '10px 0', borderBottom: '1px dashed var(--border)' }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: '8px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: '12px', color: 'var(--text)', wordBreak: 'break-word' }}>
            {item.title}
            {item.seasonNumber != null && (
              <span style={{ fontSize: '11px', color: 'var(--muted)', marginLeft: '6px', fontStyle: 'italic' }}>
                {fmtSeason(item.seasonNumber!)}
              </span>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', color, fontStyle: 'italic' }}>{item.trackedState}</span>
          {isPending && <GhostButton onClick={onImport} variant="warn"><i>import</i></GhostButton>}
          <GhostButton onClick={onRemove} variant="danger"><i>delete</i></GhostButton>
        </div>
      </div>
      {item.messages.map((msg, i) => (
        <div key={i} style={{ fontSize: '11px', color, fontStyle: 'italic', marginTop: '4px', paddingLeft: '2px' }}>
          {msg}
        </div>
      ))}
    </div>
  )
}
