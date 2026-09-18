import TopNav from './components/TopNav'
import Library from './Library'
import { ToastProvider } from './hooks/useToast'
import { ErrorBoundary } from './components/ErrorBoundary'

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <TopNav />
        <main className="main-content">
          <ErrorBoundary><Library /></ErrorBoundary>
        </main>
      </ToastProvider>
    </ErrorBoundary>
  )
}
