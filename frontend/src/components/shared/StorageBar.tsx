import { useState, useEffect } from 'react'
import type { StorageInfo } from '../../types/status'
import { formatBytes } from '../../utils/format'
import { StatBar } from './StatBar'

const STORAGE_POLL_MS = 30_000

export default function StorageBar() {
  const [storage, setStorage] = useState<StorageInfo | null>(null)

  useEffect(() => {
    async function fetchStorage() {
      try {
        const res = await fetch('/api/status/storage')
        if (!res.ok) return
        const data = await res.json()
        if (typeof data.used === 'number' && typeof data.total === 'number') setStorage(data)
      } catch {}
    }
    fetchStorage()
    const id = setInterval(fetchStorage, STORAGE_POLL_MS)
    return () => clearInterval(id)
  }, [])

  if (!storage) return null

  return (
    <div style={{ marginBottom: '20px', maxWidth: '320px' }}>
      <StatBar
        label="storage"
        fraction={storage.total > 0 ? storage.used / storage.total : 0}
        text={`${formatBytes(storage.used)} / ${formatBytes(storage.total)}`}
      />
    </div>
  )
}
