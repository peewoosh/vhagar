export default function GhostButton({ onClick, disabled, variant, children }: {
  onClick: () => void
  disabled?: boolean
  variant?: 'danger' | 'warn' | 'success'
  children: React.ReactNode
}) {
  const cls = ['modal-btn', variant ? `modal-btn--${variant}` : ''].filter(Boolean).join(' ')
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cls}
    >
      {children}
    </button>
  )
}
