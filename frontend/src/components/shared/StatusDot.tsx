import type { ServiceStatus } from '../../types/status'

export default function StatusDot({ status }: { status: ServiceStatus }) {
  const cls =
    status === 'UP'   ? 'status-dot status-dot--up' :
    status === 'DOWN' ? 'status-dot status-dot--down' :
                        'status-dot status-dot--unknown'
  return <span className={cls} />
}
