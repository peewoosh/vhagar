export function fmtSeason(n: number): string {
  return `s${String(n).padStart(2, '0')}`
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} gb`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} mb`
  return `${(bytes / 1024).toFixed(0)} kb`
}

export function formatSpeed(bps: number): string {
  if (bps >= 1024 ** 3) return `${(bps / 1024 ** 3).toFixed(2)} gb/s`
  if (bps >= 1024 ** 2) return `${(bps / 1024 ** 2).toFixed(1)} mb/s`
  if (bps >= 1024)      return `${(bps / 1024).toFixed(0)} kb/s`
  return `${bps} b/s`
}

export function formatEta(secs: number): string {
  if (secs < 0) return '∞'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${secs}s`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}gb`
  return `${Math.round(bytes / 1024 ** 2)}mb`
}

export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  if (h < 24) return `${h}h ${rm}m`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return `${d}d ${rh}h`
}
