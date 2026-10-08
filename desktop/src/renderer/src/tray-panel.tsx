import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  CircleAlert,
  Compass,
  LibraryBig,
  LoaderCircle,
  PackageOpen,
  Power,
  RefreshCw,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react'
import { useI18n } from '@skill-shelf/i18n/react'
import { Brand, ThemeProvider } from '@skill-shelf/ui'
import type { TrayAction, TrayState } from '../../shared/desktop-contract'

const shortcuts = [
  { action: 'library', icon: LibraryBig, key: 'skills' },
  { action: 'discover', icon: Compass, key: 'discover' },
  { action: 'managed', icon: PackageOpen, key: 'packs' },
  { action: 'settings', icon: Settings, key: 'settings' },
] as const

export function TrayPanel() {
  const { t, number, date, setLocalePreference, setSystemLocale } = useI18n()
  const [state, setState] = useState<TrayState | null>(null)
  const [error, setError] = useState(false)
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    let active = true
    const update = (next: TrayState) => {
      if (active) setState(next)
    }
    const unsubscribe = window.skillShelfTray.onStateChanged(update)
    void window.skillShelfTray
      .getState()
      .then(async (next) => {
        update(next)
        if (!next.summary && active)
          update(await window.skillShelfTray.scanEnvironment())
      })
      .catch(() => {
        if (active) setError(true)
      })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void window.skillShelfTray.hide()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      active = false
      unsubscribe()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    if (!state) return
    setSystemLocale(state.systemLocale)
    setLocalePreference(state.language)
  }, [
    state?.language,
    state?.systemLocale,
    setLocalePreference,
    setSystemLocale,
  ])

  async function scan() {
    setError(false)
    try {
      setState(await window.skillShelfTray.scanEnvironment())
    } catch {
      setError(true)
    }
  }

  async function openMain(action: TrayAction) {
    setOpening(true)
    try {
      await window.skillShelfTray.openMain(action)
    } catch {
      setError(true)
    } finally {
      setOpening(false)
    }
  }

  const summary = state?.summary
  const scanning = !state || state.scanning
  const issues = summary?.brokenLinks ?? 0

  return (
    <ThemeProvider theme={state?.theme ?? 'system'}>
      <main className="tray-panel" aria-label={t('desktop.tray.title')}>
        <header className="tray-header">
          <Brand />
          <button
            className="tray-icon-button"
            aria-label={t('desktop.tray.close')}
            onClick={() => void window.skillShelfTray.hide()}
            type="button"
          >
            <X size={16} />
          </button>
        </header>
        <section
          className="tray-overview"
          aria-label={t('desktop.tray.overview')}
        >
          <div className="tray-section-label">
            <span>{t('desktop.tray.overview')}</span>
            <span className="tray-local">
              <span />
              {t('desktop.tray.local')}
            </span>
          </div>
          <div className="tray-stats" aria-busy={scanning}>
            {(
              [
                ['skills', summary?.totalSkills],
                ['agents', summary?.activeAgents],
                ['projects', summary?.projects],
              ] as const
            ).map(([key, value]) => (
              <div key={key}>
                <strong>{value === undefined ? '—' : number(value)}</strong>
                <span>{t(`desktop.tray.stats.${key}`)}</span>
              </div>
            ))}
          </div>
          <button
            className={`tray-health ${issues ? 'has-issues' : ''}`}
            onClick={() => void openMain('workbench')}
            disabled={opening}
            type="button"
          >
            {issues ? <CircleAlert size={16} /> : <ShieldCheck size={16} />}
            <span>
              {!summary
                ? t('desktop.tray.loading')
                : issues
                  ? t('desktop.tray.issues', { count: number(issues) })
                  : t('desktop.tray.healthy')}
            </span>
            <ArrowUpRight size={14} />
          </button>
        </section>
        <section
          className="tray-shortcuts"
          aria-label={t('desktop.tray.shortcuts')}
        >
          {shortcuts.map(({ action, icon: Icon, key }) => (
            <button
              key={action}
              onClick={() => void openMain(action)}
              disabled={opening}
              type="button"
            >
              <Icon size={18} strokeWidth={1.7} />
              <span>
                <strong>{t(`desktop.tray.${key}`)}</strong>
                <small>{t(`desktop.tray.${key}Hint`)}</small>
              </span>
              <ArrowUpRight size={13} />
            </button>
          ))}
        </section>
        <section
          className="tray-operations"
          aria-label={t('desktop.tray.operations')}
        >
          <button onClick={() => void scan()} disabled={scanning} type="button">
            {scanning ? (
              <LoaderCircle size={15} className="tray-spin" />
            ) : (
              <RefreshCw size={15} />
            )}
            <span>
              {t(scanning ? 'desktop.tray.scanning' : 'desktop.tray.scan')}
            </span>
          </button>
          <button
            onClick={() => void openMain('scan-updates')}
            disabled={opening}
            type="button"
          >
            <ArrowUpRight size={15} />
            <span>{t('desktop.tray.checkUpdates')}</span>
            {summary && summary.updates > 0 ? (
              <span className="tray-count">{number(summary.updates)}</span>
            ) : null}
          </button>
        </section>
        {error ? (
          <p className="tray-error" role="alert">
            {t('desktop.tray.error')}
            <button onClick={() => void scan()} type="button">
              {t('desktop.tray.retry')}
            </button>
          </p>
        ) : (
          <p className="tray-last-scan" aria-live="polite">
            {summary
              ? t('desktop.tray.lastScan', {
                  time: date(summary.scannedAt, {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })
              : t('desktop.tray.firstScan')}
          </p>
        )}
        <footer className="tray-footer">
          <button
            className="tray-open"
            onClick={() => void openMain('workbench')}
            disabled={opening}
            type="button"
          >
            {t('desktop.tray.open')}
            <ArrowUpRight size={15} />
          </button>
          <button
            className="tray-quit"
            aria-label={t('desktop.tray.quit')}
            title={t('desktop.tray.quit')}
            onClick={() => void window.skillShelfTray.quit()}
            type="button"
          >
            <Power size={16} />
          </button>
        </footer>
      </main>
    </ThemeProvider>
  )
}
