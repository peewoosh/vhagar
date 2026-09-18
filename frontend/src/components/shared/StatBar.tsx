export function StatBar({ label, fraction, text }: { label: string; fraction: number; text: string }) {
  const pct = Math.min(100, Math.max(0, fraction * 100))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
      <span style={{ fontSize: '9px', color: 'var(--muted)', width: '20px', flexShrink: 0, fontStyle: 'italic' }}>{label}</span>
      <span className="bar-track" style={{ flex: 1, width: 'auto' }}>
        <span className="bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span style={{ fontSize: '9px', color: 'var(--text)', flexShrink: 0, textAlign: 'right', width: '36px' }}>{text}</span>
    </div>
  )
}

export function InlineBar({ label, fraction, text }: { label: string; fraction: number; text: string }) {
  const pct = Math.min(100, Math.max(0, fraction * 100))
  return (
    <div className="inline-bar">
      <span className="inline-bar-label">{label}</span>
      <span className="bar-track inline-bar-track">
        <span className="bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="inline-bar-text">{text}</span>
    </div>
  )
}
