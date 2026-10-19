import { Component, type ReactNode } from 'react'
import { sendErrorReport } from '../lib/errorReports'

// 0.7.3: if a screen breaks, a friendly "Something went wrong" instead of a blank window, and an
// error report (if they're on) so it can be fixed.

export default class ErrorBoundary extends Component<
  { children: ReactNode; where: string },
  { broken: boolean }
> {
  state = { broken: false }

  static getDerivedStateFromError(): { broken: boolean } {
    return { broken: true }
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }): void {
    const e = error as { message?: string; stack?: string; name?: string }
    sendErrorReport(
      {
        name: e?.name,
        message: e?.message ?? String(error),
        stack: `${e?.stack ?? ''}\n--- component\n${(info.componentStack ?? '').trim().split('\n').slice(0, 8).join('\n')}`
      },
      this.props.where
    )
  }

  render(): ReactNode {
    if (!this.state.broken) return this.props.children
    return (
      <div className="app-broken" role="alert">
        <div className="app-broken-card">
          <h1>Something went wrong</h1>
          <p>Glofly hit a problem showing this screen. Reloading usually fixes it.</p>
          <button
            type="button"
            className="small-button small-button--primary"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
