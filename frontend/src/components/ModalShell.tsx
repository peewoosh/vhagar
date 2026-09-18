export default function ModalShell({ onClose, width = 520, children }: {
  onClose: () => void
  width?: number | string
  children: React.ReactNode
}) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '16px' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--bg)', border: '1px dashed var(--border)', width, maxWidth: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
