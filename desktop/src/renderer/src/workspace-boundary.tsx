import { Component, Suspense, type ReactNode } from 'react'
import { CircleAlert, RefreshCw } from 'lucide-react'
import { Button } from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'

class WorkspaceErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function WorkspaceLoadError() {
  const { t } = useI18n()
  return (
    <div className="workspace-load-error" role="alert">
      <CircleAlert aria-hidden="true" />
      <h2>{t('desktop.workspace.loadErrorTitle')}</h2>
      <p>{t('desktop.workspace.loadErrorDescription')}</p>
      <Button
        onClick={() => window.location.reload()}
        size="sm"
        variant="outline"
      >
        <RefreshCw />
        {t('desktop.workspace.reload')}
      </Button>
    </div>
  )
}

export function WorkspaceBoundary({
  children,
  loading,
}: {
  children: ReactNode
  loading: ReactNode
}) {
  return (
    <WorkspaceErrorBoundary fallback={<WorkspaceLoadError />}>
      <Suspense fallback={loading}>{children}</Suspense>
    </WorkspaceErrorBoundary>
  )
}
