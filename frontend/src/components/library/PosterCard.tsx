export default function PosterCard({ title, year, poster, overlay, onClick, missingSubtitles, pending }: {
  title: string
  year: number
  poster: string | null
  overlay?: React.ReactNode
  missingSubtitles?: boolean
  pending?: boolean
  onClick: () => void
}) {
  return (
    <div onClick={onClick} style={{ cursor: 'pointer', opacity: pending ? 0.5 : 1 }}>
      <div style={{
        width: '100%', aspectRatio: '2 / 3',
        background: 'var(--surface)', border: '1px dashed var(--border)',
        overflow: 'hidden', position: 'relative',
      }}>
        {poster ? (
          <img src={poster} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '28px', color: 'var(--muted)',
          }}>
            {title.charAt(0).toUpperCase()}
          </div>
        )}
        {overlay}
        {missingSubtitles && (
          <div style={{
            position: 'absolute', top: 4, right: 4,
            fontSize: '9px', color: 'var(--amber)', letterSpacing: '0.08em', fontStyle: 'italic',
            background: 'rgba(0,0,0,0.75)', padding: '2px 4px',
          }}>
            no sub
          </div>
        )}
      </div>
      <div style={{ paddingTop: '6px' }}>
        <div style={{ fontSize: '12px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px', fontStyle: 'italic' }}>{year}</div>
      </div>
    </div>
  )
}
