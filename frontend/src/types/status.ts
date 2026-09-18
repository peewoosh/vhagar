export type ServiceStatus = 'UP' | 'DOWN' | 'UNKNOWN'

export interface ServiceInfo {
  status: ServiceStatus
  latency_ms: number | null
  url: string
}

export interface ServicesData {
  services: Record<string, ServiceInfo>
}

export interface StorageInfo {
  used: number
  total: number
}
