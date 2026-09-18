import type { Release } from '../../types/media'
import { formatSize } from '../../utils/format'
import GhostButton from '../shared/GhostButton'

function seederColor(s: number, l: number): string {
  if (s === 0) return 'var(--accent)'
  if (s < 5 || s < l) return 'var(--amber)'
  return 'var(--green)'
}

function isMultiSeasonPack(title: string): boolean {
  return /S\d{2}[-+]S\d{2}/i.test(title) || /complete.series/i.test(title)
}

export default function ReleaseRow({ release, onGrab, grabState, mediaType }: {
  release: Release
  onGrab: () => void
  grabState: 'idle' | 'grabbing' | 'grabbed' | 'error'
  mediaType: 'movie' | 'show'
}) {
  const sc   = seederColor(release.seeders, release.leechers)
  const warn = mediaType === 'show' && isMultiSeasonPack(release.title)

  return (
    <div
      onClick={grabState === 'idle' ? onGrab : undefined}
      style={{
        padding: '10px 8px', borderBottom: '1px dashed var(--border)',
        opacity: release.approved ? 1 : 0.45,
        cursor: grabState === 'idle' ? 'pointer' : 'default',
        margin: '0 -8px',
        background: grabState === 'grabbed' ? 'var(--green-dim)' :
                    grabState === 'error'   ? 'var(--red-dim)'   : 'transparent',
      }}
    >
      <div style={{ fontSize: '12px', color: 'var(--text)', wordBreak: 'break-word', marginBottom: '6px', lineHeight: 1.5, textAlign: 'center' }}>
        {release.title}
        {warn && (
          <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--amber)', border: '1px dashed var(--amber)', padding: '1px 5px', whiteSpace: 'nowrap' }}>
            multi-season
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <span style={{ fontSize: '11px', color: sc, border: `1px dashed ${sc}`, padding: '2px 5px', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {release.seeders}/{release.leechers}
        </span>
        <span style={{ fontSize: '12px', color: 'var(--muted)', flexShrink: 0, whiteSpace: 'nowrap', fontStyle: 'italic' }}>
          {formatSize(release.size)}
        </span>
        <span style={{ fontSize: '11px', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: 'italic' }}>
          {grabState === 'grabbing' ? '...' : release.indexer}
        </span>
      </div>
    </div>
  )
}
