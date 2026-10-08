import { useEffect, useState } from 'react'
import { Download, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'
import type { AppUpdateState } from '../../shared/desktop-contract'

export function AppUpdateControls() {
  const { t, number } = useI18n()
  const [state, setState] = useState<AppUpdateState | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let active = true
    let receivedEvent = false
    const unsubscribe = window.skillShelf.onAppUpdateChanged((next) => {
      receivedEvent = true
      if (active) setState(next)
    })
    void window.skillShelf
      .getAppUpdate()
      .then((next) => {
        if (active && !receivedEvent) setState(next)
      })
      .catch(() => {
        if (active)
          setState({
            installMode: 'manual',
            status: 'error',
            version: null,
            percent: null,
            checkedAt: null,
          })
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const busy =
    pending ||
    !state ||
    state.status === 'checking' ||
    state.status === 'downloading'
  const action =
    state?.status === 'downloaded'
      ? 'restart'
      : state?.status === 'available'
        ? state.installMode === 'manual'
          ? 'openDownload'
          : 'download'
        : 'check'
  const status =
    state?.status === 'disabled'
      ? (state.reason ?? 'unconfigured')
      : (state?.status ?? 'loading')
  const description = t(`desktop.appUpdate.${status}`, {
    version: state?.version ?? '',
    percent: number(Math.round(state?.percent ?? 0)),
  })

  async function runAction() {
    setPending(true)
    try {
      if (action === 'restart') await window.skillShelf.installAppUpdate()
      else
        setState(
          await (action === 'download' || action === 'openDownload'
            ? window.skillShelf.downloadAppUpdate()
            : window.skillShelf.checkAppUpdate())
        )
    } catch {
      setState({
        installMode: state?.installMode ?? 'manual',
        status: 'error',
        version: null,
        percent: null,
        checkedAt: null,
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="app-update-controls">
      <span className="app-update-status" role="status">
        {description}
      </span>
      {state?.status === 'downloading' ? (
        <progress
          aria-label={t('desktop.appUpdate.progress')}
          max={100}
          value={state.percent ?? 0}
        />
      ) : null}
      <Button
        disabled={busy || state?.status === 'disabled'}
        onClick={() => void runAction()}
        size="sm"
        variant="outline"
      >
        {busy ? (
          <LoaderCircle className="animate-spin" />
        ) : action === 'download' || action === 'openDownload' ? (
          <Download />
        ) : (
          <RefreshCw />
        )}
        {t(`desktop.appUpdate.${action}`)}
      </Button>
    </div>
  )
}
