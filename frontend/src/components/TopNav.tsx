import { useState, useEffect } from 'react'
import type { ServicesData } from '../types/status'
import StatusDot from './shared/StatusDot'

const SERVICES_POLL_MS = 30_000

export default function TopNav() {
  const [services, setServices] = useState<ServicesData | null>(null)

  useEffect(() => {
    async function fetchServices() {
      try {
        const res = await fetch('/api/status/services')
        if (!res.ok) return
        setServices(await res.json())
      } catch {}
    }
    fetchServices()
    const id = setInterval(fetchServices, SERVICES_POLL_MS)
    return () => clearInterval(id)
  }, [])

  const entries = services ? Object.entries(services.services) : []

  return (
    <nav className="topnav">
      <div className="topnav-left" />
      <div className="topnav-center">
        <span className="ui-text topnav-link topnav-link--active">library</span>
      </div>
      <div className="topnav-right" style={{ flexWrap: 'wrap', gap: '8px' }}>
        {entries.map(([name, info]) => (
          <span key={name} title={`${name} — ${info.status.toLowerCase()}`}>
            <StatusDot status={info.status} />
          </span>
        ))}
      </div>
    </nav>
  )
}
