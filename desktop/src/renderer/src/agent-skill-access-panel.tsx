import { useEffect, useId, useRef, useState } from 'react'
import { FolderOpen, Link2, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button, cn } from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'
import type {
  AgentAccessAction,
  AgentAccessMode,
  AgentAccessPreview,
  AgentSkillAccessEntry,
  AgentSkillAccessSnapshot,
} from '../../shared/agent-access-contract'
import { SearchField } from './search-field'

type AccessError = 'loadError' | 'previewError' | 'applyError' | 'openError'
type BusyAction = 'preview' | 'apply' | 'open' | null

function notifyApplying(
  callback: ((applying: boolean) => void) | undefined,
  applying: boolean
) {
  try {
    callback?.(applying)
  } catch {
    // Workspace callbacks must not interrupt an in-flight filesystem operation.
  }
}

function discardPreview(id: string) {
  void Promise.resolve()
    .then(() => window.skillShelf.discardAgentSkillAccessPreview(id))
    .catch(() => {})
}

function RecoveryNotice({
  paths,
  fromSnapshot = false,
}: {
  paths: string[]
  fromSnapshot?: boolean
}) {
  const { t } = useI18n()
  if (!paths.length) return null
  return (
    <div className="agent-access-recovery" role="alert">
      <p>
        {t(
          fromSnapshot
            ? 'desktop.agentAccess.recoveryRetained'
            : 'desktop.agentAccess.recoveryHelp'
        )}
      </p>
      {paths.map((path) => (
        <code key={path}>{path}</code>
      ))}
    </div>
  )
}

function SkillAccessPaths({
  entry,
  disabled = false,
  onOpen,
}: {
  entry: AgentSkillAccessEntry
  disabled?: boolean
  onOpen?: (entry: AgentSkillAccessEntry, location: 'source' | 'target') => void
}) {
  const { t } = useI18n()
  return (
    <dl className="agent-access-entry-paths">
      {(['source', 'target'] as const).map((location) => (
        <div key={location}>
          <dt>{t(`desktop.agentAccess.${location}`)}</dt>
          <dd>
            <code>
              {location === 'source' ? entry.sourcePath : entry.targetPath}
            </code>
            {onOpen ? (
              <Button
                aria-label={t(
                  location === 'source'
                    ? 'desktop.agentAccess.openSource'
                    : 'desktop.agentAccess.openTarget',
                  { name: entry.name }
                )}
                disabled={
                  disabled ||
                  entry.status ===
                    (location === 'source' ? 'source-missing' : 'missing')
                }
                onClick={() => onOpen(entry, location)}
                size="icon-sm"
                variant="ghost"
              >
                <FolderOpen />
              </Button>
            ) : null}
          </dd>
        </div>
      ))}
      {entry.resolvedSourcePath &&
      entry.resolvedSourcePath !== entry.sourcePath ? (
        <div>
          <dt>{t('desktop.agentAccess.resolvedSource')}</dt>
          <dd>
            <code>{entry.resolvedSourcePath}</code>
          </dd>
        </div>
      ) : null}
      {entry.actualTargetPath ? (
        <div>
          <dt>{t('desktop.agentAccess.actualTarget')}</dt>
          <dd>
            <code>{entry.actualTargetPath}</code>
          </dd>
        </div>
      ) : null}
    </dl>
  )
}

export function AgentSkillAccessPanel({
  agentId,
  scannedAt,
  onChanged,
  onApplyingChange,
}: {
  agentId: string
  scannedAt: string
  onChanged?: () => void | Promise<void>
  onApplyingChange?: (applying: boolean) => void
}) {
  const { date, number, t } = useI18n()
  const [snapshot, setSnapshot] = useState<AgentSkillAccessSnapshot | null>(
    null
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<AccessError | null>(null)
  const [recoveryPaths, setRecoveryPaths] = useState<string[]>([])
  const [retainedRecoveryPaths, setRetainedRecoveryPaths] = useState<string[]>(
    []
  )
  const [accessUnverified, setAccessUnverified] = useState(false)
  const [revision, setRevision] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [inspectedName, setInspectedName] = useState<string | null>(null)
  const [mode, setMode] = useState<AgentAccessMode>('symlink')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'missing' | 'attention'>('all')
  const [busy, setBusy] = useState<BusyAction>(null)
  const [preview, setPreview] = useState<AgentAccessPreview | null>(null)
  const [applyFailed, setApplyFailed] = useState(false)
  const [applied, setApplied] = useState(false)
  const [now, setNow] = useState(Date.now())
  const generation = useRef(0)
  const lifecycle = useRef(0)
  const busyRef = useRef<BusyAction>(null)
  const previewRef = useRef<AgentAccessPreview | null>(null)
  const surfaceId = useId()
  const panelHeadingRef = useRef<HTMLHeadingElement>(null)
  const previewHeadingRef = useRef<HTMLHeadingElement>(null)
  const returnFocusId = useRef<string | null>(null)
  const wasPreview = useRef(false)

  function clearPreview() {
    if (busyRef.current === 'apply') return
    if (previewRef.current) discardPreview(previewRef.current.id)
    previewRef.current = null
    setPreview(null)
    setApplyFailed(false)
  }

  function acceptSnapshot(result: AgentSkillAccessSnapshot) {
    setSnapshot(result)
    setAccessUnverified(
      Boolean(
        result.notices?.some((notice) => notice.kind === 'refresh-failed')
      )
    )
    const retained = (result.notices ?? []).flatMap((notice) =>
      notice.kind === 'recovery-retained' ? [notice.path] : []
    )
    setRetainedRecoveryPaths([...new Set(retained)])
  }

  useEffect(() => {
    lifecycle.current++
    busyRef.current = null
    setBusy(null)
    setPreview(null)
    setApplyFailed(false)
    setRecoveryPaths([])
    setRetainedRecoveryPaths([])
    setAccessUnverified(false)
    setInspectedName(null)
    return () => {
      lifecycle.current++
      if (previewRef.current) discardPreview(previewRef.current.id)
      previewRef.current = null
    }
  }, [agentId])

  useEffect(() => {
    const request = ++generation.current
    const applying = busyRef.current === 'apply'
    if (!applying) {
      busyRef.current = null
      setBusy(null)
      setPreview(null)
      setApplyFailed(false)
    }
    setSnapshot(null)
    setLoading(true)
    setError(null)
    setApplied(false)
    setSelected([])
    void Promise.resolve()
      .then(() => window.skillShelf.getAgentSkillAccess(agentId))
      .then(
        (result) => {
          if (generation.current !== request) return
          acceptSnapshot(result)
          setLoading(false)
        },
        () => {
          if (generation.current !== request) return
          setError('loadError')
          setLoading(false)
        }
      )
    return () => {
      generation.current++
      if (busyRef.current !== 'apply') {
        if (previewRef.current) discardPreview(previewRef.current.id)
        previewRef.current = null
      }
    }
  }, [agentId, scannedAt, revision])

  useEffect(() => {
    if (!preview) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [preview])

  const showingPreview = Boolean(preview)
  useEffect(() => {
    if (showingPreview) {
      previewHeadingRef.current?.focus()
    } else if (wasPreview.current) {
      const trigger = returnFocusId.current
        ? document.getElementById(returnFocusId.current)
        : null
      const canFocus =
        trigger && !(trigger instanceof HTMLButtonElement && trigger.disabled)
      ;(canFocus ? trigger : panelHeadingRef.current)?.focus()
    }
    wasPreview.current = showingPreview
  }, [showingPreview])

  async function requestPreview(
    action: AgentAccessAction,
    skillNames: string[],
    accessMode: AgentAccessMode,
    triggerId: string
  ) {
    if (busyRef.current || loading || accessUnverified || !skillNames.length)
      return
    clearPreview()
    returnFocusId.current = triggerId
    busyRef.current = 'preview'
    setBusy('preview')
    setError(null)
    setApplied(false)
    const request = generation.current
    try {
      const result = await window.skillShelf.previewAgentSkillAccess({
        agentId,
        skillNames,
        action,
        mode: accessMode,
      })
      // The workspace may have closed or been rescanned while IPC was pending.
      if (generation.current !== request) {
        discardPreview(result.id)
        return
      }
      previewRef.current = result
      setPreview(result)
      setNow(Date.now())
    } catch {
      if (generation.current === request) setError('previewError')
    } finally {
      if (generation.current === request) {
        busyRef.current = null
        setBusy(null)
      }
    }
  }

  const expiresAt = preview ? Date.parse(preview.expiresAt) : NaN
  const expired = !Number.isFinite(expiresAt) || expiresAt <= now
  const blocked = preview?.entries.some(
    (entry) => entry.operation === 'blocked'
  )

  async function applyPreview() {
    if (
      busyRef.current ||
      !preview ||
      blocked ||
      applyFailed ||
      !preview.entries.length ||
      Date.parse(preview.expiresAt) <= Date.now() ||
      expired
    )
      return
    busyRef.current = 'apply'
    setBusy('apply')
    setError(null)
    const request = lifecycle.current
    const applyingCallback = onApplyingChange
    notifyApplying(applyingCallback, true)
    try {
      const result = await window.skillShelf.applyAgentSkillAccess(preview.id)
      // Refresh the parent even if this workspace closed during the write.
      void Promise.resolve()
        .then(() => onChanged?.())
        .catch(() => {})
      if (lifecycle.current !== request) return
      // Applying is authoritative even when the parent started a scan mid-write.
      generation.current++
      setLoading(false)
      previewRef.current = null
      setPreview(null)
      acceptSnapshot(result)
      setSelected([])
      setApplied(true)
    } catch (failure) {
      if (lifecycle.current === request) {
        setError('applyError')
        setApplyFailed(true)
        const message =
          failure instanceof Error ? failure.message : String(failure)
        const prefix = 'Agent access failed; recovery files retained at '
        const start = message.indexOf(prefix)
        const path =
          start === -1 ? '' : message.slice(start + prefix.length).trim()
        if (path)
          setRecoveryPaths((paths) =>
            paths.includes(path) ? paths : [...paths, path]
          )
      }
    } finally {
      notifyApplying(applyingCallback, false)
      if (lifecycle.current === request) {
        busyRef.current = null
        setBusy(null)
      }
    }
  }

  async function openFolder(
    entry: AgentSkillAccessEntry,
    location: 'source' | 'target'
  ) {
    if (busyRef.current) return
    busyRef.current = 'open'
    setBusy('open')
    setError(null)
    const request = generation.current
    try {
      await window.skillShelf.openAgentSkillAccessFolder({
        agentId,
        skillName: entry.name,
        location,
      })
    } catch {
      if (generation.current === request) setError('openError')
    } finally {
      if (generation.current === request) {
        busyRef.current = null
        setBusy(null)
      }
    }
  }

  const entries = snapshot?.entries ?? []
  const missing = entries.filter((entry) => entry.actions.includes('connect'))
  const visibleEntries = entries.filter(
    (entry) =>
      entry.name
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()) &&
      (snapshot?.readsSharedDirectory ||
        filter === 'all' ||
        (filter === 'missing'
          ? entry.status === 'missing'
          : [
              'copy-outdated',
              'copy-modified',
              'conflict',
              'broken',
              'source-missing',
              'unreadable',
            ].includes(entry.status)))
  )
  const directRead = snapshot?.readsSharedDirectory ?? false

  const inspected = entries.find((entry) => entry.name === inspectedName)
  const connectId = `${surfaceId}-connect`
  const inspectorId = `${surfaceId}-inspector`

  return (
    <section
      className="agent-access-panel"
      aria-label={t('desktop.agentAccess.title')}
      aria-busy={loading || Boolean(busy)}
    >
      <header className="agent-access-heading">
        <Link2 />
        <h3 ref={panelHeadingRef} tabIndex={-1}>
          {t('desktop.agentAccess.title')}
        </h3>
        <Button
          disabled={loading || Boolean(busy) || showingPreview}
          onClick={() => {
            clearPreview()
            setRevision((value) => value + 1)
          }}
          size="xs"
          variant="ghost"
        >
          <RefreshCw />
          {t('desktop.agentAccess.refresh')}
        </Button>
      </header>
      {snapshot ? (
        <dl className="agent-access-directories">
          <div>
            <dt>{t('desktop.agentAccess.sourceDirectory')}</dt>
            <dd>
              <code>{snapshot.sharedDirectory}</code>
            </dd>
          </div>
          <div>
            <dt>{t('desktop.agentAccess.targetDirectory')}</dt>
            <dd>
              <code>{snapshot.targetDirectory}</code>
            </dd>
          </div>
        </dl>
      ) : null}
      {loading ? (
        <p role="status">
          <LoaderCircle className="animate-spin" />{' '}
          {t('desktop.agentAccess.loading')}
        </p>
      ) : null}
      {error && !preview ? (
        <div className="agent-access-alert" role="alert">
          <p>{t(`desktop.agentAccess.${error}`)}</p>
          {error === 'loadError' ? (
            <Button
              onClick={() => setRevision((value) => value + 1)}
              size="xs"
              variant="outline"
            >
              {t('desktop.agentAccess.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {applied && !accessUnverified ? (
        <p className="agent-access-success" role="status">
          {t('desktop.agentAccess.applied')}
        </p>
      ) : null}
      {!preview ? (
        <>
          <RecoveryNotice paths={recoveryPaths} />
          <RecoveryNotice paths={retainedRecoveryPaths} fromSnapshot />
        </>
      ) : null}
      {accessUnverified ? (
        <p className="agent-access-warning" role="alert">
          {t('desktop.agentAccess.refreshFailed')}
        </p>
      ) : null}
      {preview ? (
        <section
          className="agent-access-preview-page"
          aria-labelledby={`${surfaceId}-preview-title`}
        >
          <header className="agent-access-preview-heading">
            <h3
              id={`${surfaceId}-preview-title`}
              ref={previewHeadingRef}
              tabIndex={-1}
            >
              {t('desktop.agentAccess.previewTitle')}
            </h3>
            <p>{t('desktop.agentAccess.previewDescription')}</p>
          </header>
          <p
            className={expired ? 'agent-access-warning' : 'agent-access-expiry'}
          >
            {expired
              ? t('desktop.agentAccess.expired')
              : t('desktop.agentAccess.expires', {
                  time: date(preview.expiresAt, {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  }),
                })}
          </p>
          {preview.action === 'disconnect' ? (
            <p>{t('desktop.agentAccess.disconnectHelp')}</p>
          ) : null}
          <ul className="agent-access-preview-entries">
            {preview.entries.map((entry) => (
              <li
                key={entry.name}
                className={entry.operation === 'blocked' ? 'is-blocked' : ''}
              >
                <div className="agent-access-entry-heading">
                  <strong>{entry.name}</strong>
                  <span>
                    {t(`desktop.agentAccess.operation.${entry.operation}`)}
                  </span>
                </div>
                <SkillAccessPaths entry={entry} />
                {entry.operation === 'blocked' ? (
                  <p>
                    {t(`desktop.agentAccess.status.${entry.status}`)}.{' '}
                    {t('desktop.agentAccess.blockedEntry')}
                  </p>
                ) : null}
                {entry.operation === 'forget' ? (
                  <p>{t('desktop.agentAccess.forgetHelp')}</p>
                ) : null}
              </li>
            ))}
          </ul>
          {preview.action !== 'disconnect' ? (
            <p>
              {t(
                preview.mode === 'symlink'
                  ? 'desktop.agentAccess.linkHelp'
                  : 'desktop.agentAccess.copyHelp'
              )}
            </p>
          ) : null}
          {blocked ? (
            <p className="agent-access-warning" role="alert">
              {t('desktop.agentAccess.blocked')}
            </p>
          ) : null}
          {error ? (
            <p className="agent-access-warning" role="alert">
              {t(`desktop.agentAccess.${error}`)}
            </p>
          ) : null}
          <RecoveryNotice paths={recoveryPaths} />
          <RecoveryNotice paths={retainedRecoveryPaths} fromSnapshot />
          <footer className="agent-access-preview-footer">
            <Button
              disabled={busy === 'apply'}
              onClick={clearPreview}
              variant="ghost"
            >
              {t('common.cancel')}
            </Button>
            <Button
              disabled={
                Boolean(busy) ||
                blocked ||
                expired ||
                applyFailed ||
                !preview.entries.length
              }
              onClick={() => void applyPreview()}
            >
              {busy === 'apply' ? (
                <LoaderCircle className="animate-spin" />
              ) : null}
              {t('desktop.agentAccess.confirm')}
            </Button>
          </footer>
        </section>
      ) : snapshot ? (
        <>
          {directRead ? (
            <p className="agent-access-explanation">
              {t('desktop.agentAccess.directRead')}
            </p>
          ) : null}
          <div className="agent-access-toolbar">
            <SearchField
              className="agent-access-search"
              label={t('desktop.agentAccess.search')}
              value={query}
              onChange={setQuery}
              onClear={() => setQuery('')}
            />
            {!directRead ? (
              <label className="agent-access-filter">
                {t('desktop.agentAccess.filterLabel')}
                <select
                  value={filter}
                  onChange={(event) =>
                    setFilter(event.target.value as typeof filter)
                  }
                >
                  {(['all', 'missing', 'attention'] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(`desktop.agentAccess.filter.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {!directRead ? (
            <div className="agent-access-connect">
              {missing.length ? (
                <Button
                  disabled={Boolean(busy)}
                  onClick={() => {
                    clearPreview()
                    setSelected(
                      selected.length === missing.length
                        ? []
                        : missing.map((entry) => entry.name)
                    )
                  }}
                  size="xs"
                  variant="ghost"
                >
                  {t(
                    selected.length === missing.length
                      ? 'desktop.agentAccess.clearSelection'
                      : 'desktop.agentAccess.selectMissing'
                  )}
                </Button>
              ) : null}
              <span>
                {t('desktop.agentAccess.selected', {
                  count: number(selected.length),
                })}
              </span>
              <div
                role="radiogroup"
                aria-label={t('desktop.agentAccess.modeLabel')}
              >
                {(['symlink', 'copy'] as const).map((value) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name={`${surfaceId}-mode`}
                      checked={mode === value}
                      disabled={Boolean(busy)}
                      onChange={() => {
                        clearPreview()
                        setMode(value)
                      }}
                    />
                    {t(`desktop.agentAccess.mode.${value}`)}
                  </label>
                ))}
              </div>
              <Button
                id={connectId}
                disabled={Boolean(busy) || accessUnverified || !selected.length}
                onClick={() =>
                  void requestPreview('connect', selected, mode, connectId)
                }
                size="sm"
              >
                {busy === 'preview' ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Link2 />
                )}
                {t('desktop.agentAccess.previewConnect')}
              </Button>
              <p className="agent-access-mode-hint">
                {t(`desktop.agentAccess.modeHint.${mode}`)}
              </p>
            </div>
          ) : null}
          <div className="agent-access-browser">
            <div className="agent-access-list-pane">
              <div className="agent-access-table-scroll">
                <table
                  className="agent-access-table"
                  aria-label={t('desktop.agentAccess.entries')}
                >
                  <thead>
                    <tr>
                      {!directRead ? (
                        <th className="agent-access-select-column">
                          <span className="sr-only">
                            {t('desktop.agentAccess.selectMissing')}
                          </span>
                        </th>
                      ) : null}
                      <th scope="col">Skill</th>
                      <th scope="col">{t('desktop.agentAccess.modeLabel')}</th>
                      <th scope="col">
                        {t('desktop.agentAccess.statusLabel')}
                      </th>
                      <th scope="col">
                        {t('desktop.agentAccess.ownershipLabel')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleEntries.map((entry) => (
                      <tr
                        key={entry.name}
                        className={
                          inspectedName === entry.name ? 'is-inspected' : ''
                        }
                      >
                        {!directRead ? (
                          <td className="agent-access-select-column">
                            {entry.actions.includes('connect') ? (
                              <input
                                type="checkbox"
                                aria-label={t(
                                  'desktop.agentAccess.selectSkill',
                                  { name: entry.name }
                                )}
                                checked={selected.includes(entry.name)}
                                disabled={Boolean(busy)}
                                onChange={(event) => {
                                  const checked = event.target.checked
                                  clearPreview()
                                  setSelected((current) =>
                                    checked
                                      ? [...current, entry.name]
                                      : current.filter(
                                          (name) => name !== entry.name
                                        )
                                  )
                                }}
                              />
                            ) : null}
                          </td>
                        ) : null}
                        <td data-label="Skill">
                          <button
                            className={cn(
                              'agent-access-name-button',
                              inspectedName === entry.name && 'is-active'
                            )}
                            type="button"
                            aria-label={t('desktop.agentAccess.inspectSkill', {
                              name: entry.name,
                            })}
                            aria-controls={inspectorId}
                            aria-pressed={inspectedName === entry.name}
                            onClick={() => setInspectedName(entry.name)}
                          >
                            {entry.name}
                          </button>
                        </td>
                        <td data-label={t('desktop.agentAccess.modeLabel')}>
                          {entry.mode
                            ? t(`desktop.agentAccess.mode.${entry.mode}`)
                            : '—'}
                        </td>
                        <td data-label={t('desktop.agentAccess.statusLabel')}>
                          <span
                            className={`agent-access-status is-${entry.status}`}
                          >
                            {t(`desktop.agentAccess.status.${entry.status}`)}
                          </span>
                        </td>
                        <td
                          data-label={t('desktop.agentAccess.ownershipLabel')}
                        >
                          <span
                            className={`agent-access-ownership is-${entry.ownership}`}
                          >
                            {t(
                              `desktop.agentAccess.ownershipShort.${entry.ownership}`
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!visibleEntries.length ? (
                <p>{t('desktop.agentAccess.empty')}</p>
              ) : null}
            </div>
            <section
              id={inspectorId}
              className="agent-access-inspector"
              aria-labelledby={`${surfaceId}-inspector-title`}
            >
              <header className="agent-access-inspector-heading">
                <h4 id={`${surfaceId}-inspector-title`}>
                  {t('desktop.agentAccess.inspectorTitle')}
                </h4>
                {inspected ? <strong>{inspected.name}</strong> : null}
              </header>
              {inspected ? (
                <>
                  <div className="agent-access-inspector-meta">
                    <span
                      className={`agent-access-status is-${inspected.status}`}
                    >
                      {t(`desktop.agentAccess.status.${inspected.status}`)}
                    </span>
                    <span>
                      {t(
                        `desktop.agentAccess.ownership.${inspected.ownership}`
                      )}
                    </span>
                    {inspected.mode ? (
                      <span>
                        {t(`desktop.agentAccess.mode.${inspected.mode}`)}
                      </span>
                    ) : null}
                  </div>
                  <SkillAccessPaths
                    entry={inspected}
                    disabled={Boolean(busy)}
                    onOpen={(entry, location) =>
                      void openFolder(entry, location)
                    }
                  />
                  {inspected.status === 'copy-modified' ? (
                    <p className="agent-access-warning">
                      {t('desktop.agentAccess.modifiedHelp')}
                    </p>
                  ) : null}
                  {inspected.ownership === 'external' &&
                  inspected.status !== 'missing' ? (
                    <p>{t('desktop.agentAccess.externalHelp')}</p>
                  ) : null}
                  {inspected.mode === 'symlink' ? (
                    <p>{t('desktop.agentAccess.linkHelp')}</p>
                  ) : inspected.mode === 'copy' ? (
                    <p>{t('desktop.agentAccess.copyHelp')}</p>
                  ) : null}
                  {!directRead &&
                  inspected.actions.some((action) => action !== 'connect') ? (
                    <div className="agent-access-entry-actions">
                      {inspected.actions
                        .filter((action) => action !== 'connect')
                        .map((action) => {
                          const triggerId = `${surfaceId}-${inspected.name}-${action}`
                          return (
                            <Button
                              key={action}
                              id={triggerId}
                              disabled={Boolean(busy) || accessUnverified}
                              onClick={() =>
                                void requestPreview(
                                  action,
                                  [inspected.name],
                                  inspected.mode === 'copy'
                                    ? 'copy'
                                    : 'symlink',
                                  triggerId
                                )
                              }
                              size="xs"
                              variant="outline"
                            >
                              {t(`desktop.agentAccess.action.${action}`)}
                            </Button>
                          )
                        })}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="agent-access-inspector-empty">
                  {t('desktop.agentAccess.inspectorEmpty')}
                </p>
              )}
            </section>
          </div>
          <p className="agent-access-limit">{t('desktop.agentAccess.limit')}</p>
        </>
      ) : null}
    </section>
  )
}
