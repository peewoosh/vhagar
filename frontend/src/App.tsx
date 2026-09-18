import Library from './Library'
import { ToastProvider } from './hooks/useToast'
import { ErrorBoundary } from './components/ErrorBoundary'

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <main className="main-content">
          <ErrorBoundary><Library /></ErrorBoundary>
        </main>
      </ToastProvider>
    </ErrorBoundary>
  )
}
