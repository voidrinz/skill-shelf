import { useState } from 'react'
import { Download, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'
import { hasAppUpdate, useAppUpdate } from './app-update-context'

export function AppUpdateStatus() {
  const { t, number } = useI18n()
  const { state } = useAppUpdate()
  const status =
    state?.status === 'disabled'
      ? (state.reason ?? 'unconfigured')
      : (state?.status ?? 'loading')

  return (
    <div
      className="app-update-status"
      data-update-available={hasAppUpdate(state)}
    >
      <span role="status">
        {t(`desktop.appUpdate.${status}`, {
          version: state?.version ?? '',
          percent: number(Math.round(state?.percent ?? 0)),
        })}
      </span>
      {state?.status === 'downloading' ? (
        <progress
          aria-label={t('desktop.appUpdate.progress')}
          max={100}
          value={state.percent ?? 0}
        />
      ) : null}
    </div>
  )
}

export function AppUpdateControls() {
  const { t } = useI18n()
  const { state, setState } = useAppUpdate()
  const [pending, setPending] = useState(false)

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
        version: state?.version ?? null,
        percent: null,
        checkedAt: null,
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Button
      className="app-update-action"
      disabled={busy || state?.status === 'disabled'}
      onClick={() => void runAction()}
      size="sm"
      title={
        action === 'openDownload'
          ? t('desktop.appUpdate.openDownload')
          : undefined
      }
      variant={hasAppUpdate(state) ? 'default' : 'outline'}
    >
      {busy ? (
        <LoaderCircle className="animate-spin" />
      ) : action === 'download' || action === 'openDownload' ? (
        <Download />
      ) : (
        <RefreshCw />
      )}
      {action === 'download' || action === 'openDownload'
        ? t('desktop.appUpdate.updateTo', { version: state?.version ?? '' })
        : busy && state?.status === 'downloading'
          ? t('desktop.appUpdate.updating')
          : t(`desktop.appUpdate.${action}`)}
    </Button>
  )
}
