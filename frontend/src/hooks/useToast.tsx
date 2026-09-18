import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

interface ToastItem { id: number; message: string; variant: 'success' | 'error' }
interface ToastCtx  { show: (message: string, variant?: 'success' | 'error') => void }

const ToastContext = createContext<ToastCtx>({ show: () => {} })
let uid = 0

export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<ToastItem[]>([])
  const current = queue[0] ?? null

  const show = useCallback((message: string, variant: 'success' | 'error' = 'success') => {
    setQueue(q => [...q, { id: ++uid, message, variant }])
  }, [])

  useEffect(() => {
    if (!current) return
    const id = current.id
    const timer = setTimeout(() => setQueue(q => q.filter(t => t.id !== id)), 3000)
    return () => clearTimeout(timer)
  }, [current])

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {current && (
        <div style={{
          position: 'fixed', bottom: '16px', right: '16px',
          zIndex: 1000,
          background: 'var(--surface)',
          border: '1px dashed var(--border)',
          borderLeft: '2px solid var(--accent)',
          padding: '10px 14px',
          fontSize: '11px',
          fontFamily: 'var(--font)',
          color: current.variant === 'error' ? 'var(--accent)' : 'var(--text)',
          letterSpacing: '0.05em',
          maxWidth: '300px',
          minWidth: '180px',
        }}>
          {current.message}
        </div>
      )}
    </ToastContext.Provider>
  )
}
