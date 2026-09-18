import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { hasError: boolean; error: string }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: '' }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error: error.message }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', fontFamily: 'var(--font)', color: 'var(--muted)', fontSize: '11px', fontStyle: 'italic' }}>
          <div style={{ color: 'var(--accent)', marginBottom: '8px', fontStyle: 'normal' }}>something went wrong</div>
          <div>{this.state.error}</div>
        </div>
      )
    }
    return this.props.children
  }
}
