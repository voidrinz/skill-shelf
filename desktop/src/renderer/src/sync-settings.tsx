import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Cloud,
  FileJson,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Switch,
  toast,
} from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'
import type {
  SyncApplyResult,
  SyncConflict,
  SyncPreview,
  WebDavStatus,
} from '../../shared/sync-contract'
import { aiProviderRegistry } from '../../shared/desktop-contract'
import { AI_LANGUAGE_OPTIONS } from './ai-language-options'

type SyncResult = SyncApplyResult
const emptyWebDav: WebDavStatus = {
  url: '',
  username: '',
  hasPassword: false,
  passwordNeedsReentry: false,
}

export function SyncSettings({
  onApplied,
}: {
  onApplied: (result: SyncResult) => void
}) {
  const { t, date } = useI18n()
  const [saved, setSaved] = useState<WebDavStatus>(emptyWebDav)
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [syncPassword, setSyncPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [connectionUnavailable, setConnectionUnavailable] = useState(false)
  const [passwordInvalid, setPasswordInvalid] = useState(false)
  const syncPasswordRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<SyncPreview | null>(null)
  const [resolutions, setResolutions] = useState<
    Record<string, 'local' | 'incoming'>
  >({})
  const [includePreferences, setIncludePreferences] = useState(false)
  const [includeAiPreferences, setIncludeAiPreferences] = useState(false)
  const previewRef = useRef<SyncPreview | null>(null)
  const mounted = useRef(true)
  previewRef.current = preview
  const dirty =
    url !== saved.url || username !== saved.username || Boolean(password)
  const needsPassword =
    saved.passwordNeedsReentry &&
    url === saved.url &&
    username === saved.username
  const ready =
    Boolean(saved.url) &&
    !saved.passwordNeedsReentry &&
    !connectionUnavailable &&
    !dirty &&
    !busy

  function applySettings(next: WebDavStatus) {
    setConnectionUnavailable(false)
    setSaved(next)
    setUrl(next.url)
    setUsername(next.username)
    setPassword('')
  }

  async function run(action: string, operation: () => Promise<void>) {
    if (busy) return
    setBusy(action)
    setPasswordInvalid(false)
    try {
      await operation()
    } catch (caught) {
      if (mounted.current) {
        if (action === 'load') {
          setConnectionUnavailable(true)
          toast.error(t('desktop.sync.error.loadConnection'), {
            duration: 6000,
          })
        } else {
          toast.error(syncError(caught, t), { duration: 6000 })
          if (isSyncPasswordError(caught)) {
            setPasswordInvalid(true)
          }
        }
      }
    } finally {
      if (mounted.current) setBusy(null)
    }
  }

  useEffect(() => {
    if (passwordInvalid && !busy) syncPasswordRef.current?.focus()
  }, [passwordInvalid, busy])

  useEffect(() => {
    mounted.current = true
    let active = true
    setBusy('load')
    void window.skillShelf
      .getWebDavSettings()
      .then(
        (next) => {
          if (active) applySettings(next)
        },
        () => {
          if (active) {
            setConnectionUnavailable(true)
            toast.error(t('desktop.sync.error.loadConnection'), {
              duration: 6000,
            })
          }
        }
      )
      .finally(() => {
        if (active) setBusy(null)
      })
    return () => {
      active = false
      mounted.current = false
      if (previewRef.current)
        void window.skillShelf
          .discardSyncPreview(previewRef.current.id)
          .catch(() => {})
    }
  }, [])

  async function showPreview(next: SyncPreview | null) {
    if (!next) return
    if (!mounted.current) {
      await window.skillShelf.discardSyncPreview(next.id)
      return
    }
    setPreview(next)
    setResolutions({})
    setIncludePreferences(false)
    setIncludeAiPreferences(Boolean(next.aiPreferences))
  }

  async function closePreview() {
    if (!preview || busy) return
    await run('discard', async () => {
      await window.skillShelf.discardSyncPreview(preview.id)
      setPreview(null)
    })
  }

  const label = (action: string, text: string, icon: ReactNode) => (
    <>
      {busy === action ? <LoaderCircle className="animate-spin" /> : icon}
      {text}
    </>
  )
  const unresolved =
    preview?.conflicts.filter((conflict) => !resolutions[conflict.id]).length ??
    0
  const aiLanguage = preview?.aiPreferences?.targetLanguage ?? ''
  const aiLanguageOption = AI_LANGUAGE_OPTIONS.find(
    (option) => option.id === aiLanguage
  )
  const aiLanguageName = aiLanguageOption ? t(aiLanguageOption.key) : aiLanguage
  const aiSettingsLabel = preview?.aiConnections?.length
    ? preview.mode === 'upload'
      ? 'desktop.sync.uploadAiConfiguration'
      : 'desktop.sync.importAiConfiguration'
    : preview?.mode === 'upload'
      ? 'desktop.sync.uploadAiPreferences'
      : 'desktop.sync.importAiPreferences'

  return (
    <div className="settings-page sync-settings">
      <header className="settings-page-header">
        <h2>{t('desktop.sync.title')}</h2>
      </header>
      <p className="settings-page-description">
        {t('desktop.sync.description')}
      </p>
      <div className="sync-scope-note">
        <strong>{t('desktop.sync.scopeTitle')}</strong>
        <p>{t('desktop.sync.scopeDescription')}</p>
        <p>{t('desktop.sync.matchingDescription')}</p>
      </div>
      <section className="settings-section">
        <h3>{t('desktop.sync.encryptionTitle')}</h3>
        <div className="setting-rows">
          <div className="setting-row sync-encryption-row">
            <div>
              <label htmlFor="sync-encryption-password">
                <strong>{t('desktop.sync.encryptionPassword')}</strong>
              </label>
              <small id="sync-encryption-hint">
                {t('desktop.sync.encryptionHint')}
              </small>
            </div>
            <Input
              ref={syncPasswordRef}
              id="sync-encryption-password"
              aria-describedby="sync-encryption-hint"
              aria-invalid={passwordInvalid || undefined}
              placeholder={t('desktop.sync.encryptionPlaceholder')}
              className="setting-input"
              type="password"
              value={syncPassword}
              disabled={Boolean(busy)}
              maxLength={1024}
              onChange={(event) => {
                setSyncPassword(event.target.value)
                setPasswordInvalid(false)
              }}
              autoComplete="off"
            />
          </div>
        </div>
      </section>
      <section className="settings-section">
        <h3>{t('desktop.sync.files')}</h3>
        <div className="setting-rows sync-method">
          <FileJson aria-hidden="true" />
          <div>
            <strong>{t('desktop.sync.filesTitle')}</strong>
            <p>{t('desktop.sync.filesDescription')}</p>
          </div>
          <div className="sync-actions">
            <Button
              disabled={Boolean(busy)}
              size="sm"
              variant="outline"
              onClick={() =>
                void run('export', async () => {
                  if (
                    await window.skillShelf.exportSyncData(
                      syncPassword || undefined
                    )
                  )
                    toast.success(t('desktop.sync.exported'))
                })
              }
            >
              {label('export', t('desktop.sync.export'), <ArrowUpFromLine />)}
            </Button>
            <Button
              disabled={Boolean(busy)}
              size="sm"
              variant="outline"
              onClick={() =>
                void run('import', async () =>
                  showPreview(
                    await window.skillShelf.importSyncData(
                      syncPassword || undefined
                    )
                  )
                )
              }
            >
              {label('import', t('desktop.sync.import'), <ArrowDownToLine />)}
            </Button>
          </div>
        </div>
      </section>
      <section className="settings-section">
        <h3>WebDAV</h3>
        <div className="setting-rows sync-webdav">
          <div className="sync-method-heading">
            <Cloud aria-hidden="true" />
            <div>
              <strong>{t('desktop.sync.webdavTitle')}</strong>
              <p>{t('desktop.sync.webdavDescription')}</p>
            </div>
          </div>
          <form
            className="sync-webdav-form"
            onSubmit={(event) => {
              event.preventDefault()
              void run('save', async () => {
                applySettings(
                  await window.skillShelf.saveWebDavSettings({
                    url,
                    username,
                    ...(password ? { password } : {}),
                  })
                )
                toast.success(t('desktop.sync.saved'))
              })
            }}
          >
            <label className="sync-url-field">
              <span>{t('desktop.sync.url')}</span>
              <Input
                value={url}
                disabled={Boolean(busy)}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://dav.example.com/SkillShelf/"
                autoComplete="off"
                spellCheck={false}
              />
              <small>{t('desktop.sync.urlHint')}</small>
            </label>
            <label>
              <span>{t('desktop.sync.username')}</span>
              <Input
                value={username}
                disabled={Boolean(busy)}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              <span>{t('desktop.sync.password')}</span>
              <Input
                type="password"
                aria-label={t('desktop.sync.password')}
                aria-describedby="webdav-password-hint"
                value={password}
                disabled={Boolean(busy)}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={
                  saved.hasPassword ? t('desktop.sync.passwordSaved') : ''
                }
                autoComplete="new-password"
              />
              <small id="webdav-password-hint">
                {t(
                  needsPassword
                    ? 'desktop.sync.passwordReentry'
                    : 'desktop.sync.passwordHint'
                )}
              </small>
            </label>
            <div className="sync-actions sync-save-actions">
              <Button
                disabled={
                  Boolean(busy) ||
                  !url.trim() ||
                  !dirty ||
                  (needsPassword && !password)
                }
                type="submit"
                size="sm"
              >
                {label('save', t('desktop.sync.save'), null)}
              </Button>
              <Button
                disabled={Boolean(busy)}
                size="sm"
                variant="ghost"
                onClick={() =>
                  void run('load', async () => {
                    applySettings(await window.skillShelf.getWebDavSettings())
                    toast.success(t('desktop.sync.reloaded'))
                  })
                }
              >
                {label('load', t('desktop.sync.reloadSettings'), <RefreshCw />)}
              </Button>
            </div>
          </form>
          <div className="sync-webdav-actions">
            <Button
              disabled={!ready}
              size="sm"
              variant="outline"
              onClick={() =>
                void run('test', async () => {
                  await window.skillShelf.testWebDavConnection()
                  toast.success(t('desktop.sync.connected'))
                })
              }
            >
              {label('test', t('desktop.sync.test'), <RefreshCw />)}
            </Button>
            <Button
              disabled={!ready}
              size="sm"
              variant="outline"
              onClick={() =>
                void run('push', async () =>
                  showPreview(
                    await window.skillShelf.pushWebDavSync(
                      syncPassword || undefined
                    )
                  )
                )
              }
            >
              {label('push', t('desktop.sync.push'), <ArrowUpFromLine />)}
            </Button>
            <Button
              disabled={!ready}
              size="sm"
              variant="outline"
              onClick={() =>
                void run('pull', async () =>
                  showPreview(
                    await window.skillShelf.pullWebDavSync(
                      syncPassword || undefined
                    )
                  )
                )
              }
            >
              {label('pull', t('desktop.sync.pull'), <ArrowDownToLine />)}
            </Button>
            {dirty ? <small>{t('desktop.sync.saveFirst')}</small> : null}
          </div>
        </div>
      </section>
      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open) void closePreview()
        }}
      >
        <DialogContent
          className="sync-preview-dialog"
          closeLabel={t('common.close')}
          onInteractOutside={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest('[data-slot="toaster"]')
            )
              event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t(
                preview?.mode === 'upload'
                  ? 'desktop.sync.uploadPreview'
                  : 'desktop.sync.importPreview'
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                preview?.mode === 'upload'
                  ? 'desktop.sync.uploadPreviewDescription'
                  : 'desktop.sync.importPreviewDescription'
              )}
            </DialogDescription>
          </DialogHeader>
          {preview ? (
            <>
              <div className="sync-preview-scroll">
                <p className="sync-preview-date">
                  {t('desktop.sync.snapshotDate', {
                    date: date(preview.exportedAt, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                  })}
                </p>
                <div className="sync-preview-stats">
                  <span>
                    <strong>{preview.matched}</strong>
                    {t('desktop.sync.matched')}
                  </span>
                  <span>
                    <strong>
                      {preview.mode === 'upload'
                        ? preview.localOnly
                        : preview.changed}
                    </strong>
                    {t(
                      preview.mode === 'upload'
                        ? 'desktop.sync.uploadNew'
                        : 'desktop.sync.changed'
                    )}
                  </span>
                  <span>
                    <strong>{preview.skipped}</strong>
                    {t(
                      preview.mode === 'upload'
                        ? 'desktop.sync.retained'
                        : 'desktop.sync.skipped'
                    )}
                  </span>
                  <span>
                    <strong>{preview.conflicts.length}</strong>
                    {t('desktop.sync.conflicts')}
                  </span>
                </div>
                {preview.packs && preview.packs.total > 0 ? (
                  <p className="sync-warning">
                    {t('desktop.sync.packsSummary', {
                      count: preview.packs.total,
                      changed: preview.packs.changed,
                      matched: preview.packs.matchedMembers,
                    })}
                  </p>
                ) : null}
                {preview.packs?.skippedMembers.length ? (
                  <details className="sync-skipped-list">
                    <summary>
                      {t(
                        preview.mode === 'upload'
                          ? 'desktop.sync.packMembersRetained'
                          : 'desktop.sync.packMembersSkipped',
                        { count: preview.packs.skippedMembers.length }
                      )}
                    </summary>
                    <ul>
                      {preview.packs.skippedMembers.map((member, index) => (
                        <li key={index}>
                          <strong>
                            {member.packName} · {member.skillName}
                          </strong>
                          <span>{t(`desktop.sync.skip.${member.reason}`)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {preview.staleTranslations ? (
                  <p className="sync-warning">
                    {t('desktop.sync.staleTranslations', {
                      count: preview.staleTranslations,
                    })}
                  </p>
                ) : null}
                {preview.skippedSkills.length ? (
                  <details className="sync-skipped-list">
                    <summary>
                      {t(
                        preview.mode === 'upload'
                          ? 'desktop.sync.retainedDetails'
                          : 'desktop.sync.skippedDetails'
                      )}
                    </summary>
                    <ul>
                      {preview.skippedSkills.map((skill, index) => (
                        <li key={index}>
                          <strong>{skill.name}</strong>
                          <span>{t(`desktop.sync.skip.${skill.reason}`)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {preview.conflicts.length ? (
                  <section className="sync-conflicts">
                    <div className="sync-conflicts-heading">
                      <h3>{t('desktop.sync.chooseConflicts')}</h3>
                      <div>
                        <Button
                          disabled={Boolean(busy)}
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setResolutions(
                              Object.fromEntries(
                                preview.conflicts.map((conflict) => [
                                  conflict.id,
                                  'local',
                                ])
                              )
                            )
                          }
                        >
                          {t('desktop.sync.allLocal')}
                        </Button>
                        <Button
                          disabled={Boolean(busy)}
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setResolutions(
                              Object.fromEntries(
                                preview.conflicts.map((conflict) => [
                                  conflict.id,
                                  'incoming',
                                ])
                              )
                            )
                          }
                        >
                          {t('desktop.sync.allIncoming')}
                        </Button>
                      </div>
                    </div>
                    {preview.conflicts.map((conflict) => (
                      <div className="sync-conflict" key={conflict.id}>
                        <strong>
                          {conflict.skillName}
                          <span>{fieldLabel(conflict, t)}</span>
                        </strong>
                        <div className="sync-conflict-values">
                          <div>
                            <small>{t('desktop.sync.local')}</small>
                            <p>{conflict.local || t('desktop.sync.empty')}</p>
                          </div>
                          <div>
                            <small>{t('desktop.sync.incoming')}</small>
                            <p>
                              {conflict.incoming || t('desktop.sync.empty')}
                            </p>
                          </div>
                        </div>
                        <select
                          disabled={Boolean(busy)}
                          aria-label={t('desktop.sync.resolveField', {
                            skill: conflict.skillName,
                            field: fieldLabel(conflict, t),
                          })}
                          value={resolutions[conflict.id] ?? ''}
                          onChange={(event) =>
                            setResolutions((current) => ({
                              ...current,
                              [conflict.id]: event.target.value as
                                'local' | 'incoming',
                            }))
                          }
                        >
                          <option value="" disabled>
                            {t('desktop.sync.choose')}
                          </option>
                          <option value="local">
                            {t('desktop.sync.keepLocal')}
                          </option>
                          <option value="incoming">
                            {t('desktop.sync.useIncoming')}
                          </option>
                        </select>
                      </div>
                    ))}
                  </section>
                ) : null}
                <label className="sync-preferences">
                  <Switch
                    aria-label={t(
                      preview.mode === 'upload'
                        ? 'desktop.sync.uploadPreferences'
                        : 'desktop.sync.importPreferences'
                    )}
                    checked={includePreferences}
                    disabled={Boolean(busy)}
                    onCheckedChange={setIncludePreferences}
                  />
                  <div>
                    <strong>
                      {t(
                        preview.mode === 'upload'
                          ? 'desktop.sync.uploadPreferences'
                          : 'desktop.sync.importPreferences'
                      )}
                    </strong>
                    <p>{t('desktop.sync.preferencesDescription')}</p>
                  </div>
                </label>
                {preview.aiPreferences ? (
                  <label className="sync-preferences">
                    <Switch
                      aria-label={t(aiSettingsLabel)}
                      checked={includeAiPreferences}
                      disabled={Boolean(busy)}
                      onCheckedChange={setIncludeAiPreferences}
                    />
                    <div>
                      <strong>{t(aiSettingsLabel)}</strong>
                      <p>
                        {t(
                          preview.aiConnections?.length
                            ? 'desktop.sync.aiConfigurationDescription'
                            : 'desktop.sync.aiPreferencesDescription'
                        )}
                      </p>
                      {preview.aiConnections?.map((connection) => (
                        <p key={connection.provider}>
                          {t('desktop.sync.aiConnectionSummary', {
                            provider:
                              aiProviderRegistry.find(
                                (provider) =>
                                  provider.id === connection.provider
                              )?.displayName ?? connection.provider,
                            key: t(
                              connection.hasApiKey
                                ? 'desktop.sync.aiKeyPresent'
                                : 'desktop.sync.aiKeyAbsent'
                            ),
                            state: t(
                              connection.enabled
                                ? 'desktop.sync.aiConnectionEnabled'
                                : 'desktop.sync.aiConnectionDisabled'
                            ),
                          })}
                        </p>
                      ))}
                      <p>
                        {t('desktop.sync.aiDefaults', {
                          language: aiLanguageName,
                          chat: preview.aiPreferences.models.chat.model,
                          writing: preview.aiPreferences.models.writing.model,
                          analysis: preview.aiPreferences.models.analysis.model,
                        })}
                      </p>
                    </div>
                  </label>
                ) : null}
                {preview.mode === 'import' && !preview.matched ? (
                  <p className="sync-warning">{t('desktop.sync.noMatches')}</p>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  disabled={Boolean(busy)}
                  variant="outline"
                  onClick={() => void closePreview()}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  disabled={
                    Boolean(busy) ||
                    unresolved > 0 ||
                    (preview.mode === 'import' &&
                      preview.changed === 0 &&
                      !preview.packs?.changed &&
                      !includePreferences &&
                      !includeAiPreferences)
                  }
                  onClick={() =>
                    void run('apply', async () => {
                      const result = await window.skillShelf.applySyncData({
                        previewId: preview.id,
                        resolutions,
                        includePreferences,
                        includeAiPreferences,
                      })
                      onApplied(result)
                      setPreview(null)
                      toast.success(
                        t(
                          preview.mode === 'upload'
                            ? 'desktop.sync.uploaded'
                            : 'desktop.sync.imported'
                        )
                      )
                    })
                  }
                >
                  {label(
                    'apply',
                    t(
                      preview.mode === 'upload'
                        ? 'desktop.sync.confirmUpload'
                        : 'desktop.sync.confirmImport'
                    ),
                    null
                  )}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

type Translate = ReturnType<typeof useI18n>['t']
function isSyncPasswordError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /sync encryption password|Sync decryption failed/i.test(message)
}

function fieldLabel(conflict: SyncConflict, t: Translate) {
  if (conflict.field === 'pack-description')
    return t('desktop.sync.fieldPackDescription')
  if (conflict.field.startsWith('description:'))
    return t('desktop.sync.fieldDescription', {
      language: conflict.field.slice(12),
    })
  if (conflict.field.startsWith('translation:'))
    return t('desktop.sync.fieldTranslation', {
      language: conflict.field.slice(12),
    })
  return t(
    conflict.field === 'folder'
      ? 'desktop.sync.fieldFolder'
      : conflict.field === 'position'
        ? 'desktop.sync.fieldPosition'
        : 'desktop.sync.fieldTags'
  )
}
function syncError(error: unknown, t: Translate) {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('Sync decryption failed'))
    return t('desktop.sync.error.decryption')
  if (
    message.includes('sync encryption password') ||
    message.includes('Sync encryption password')
  )
    return t('desktop.sync.error.encryptionPassword')
  if (message.includes('rollback failed'))
    return t('desktop.sync.error.rollback')
  if (message.includes('Invalid sync document'))
    return t('desktop.sync.error.document')
  if (message.includes('preview is outdated'))
    return t('desktop.sync.error.outdated')
  if (message.includes('conflicts need')) return t('desktop.sync.error.choices')
  if (message.includes('ambiguous Skills'))
    return t('desktop.sync.error.ambiguous')
  if (message.includes('Sync WebDAV password required'))
    return t('desktop.sync.passwordReentry')
  if (message.includes('credentials'))
    return t('desktop.sync.error.credentials')
  if (message.includes('Invalid sync WebDAV URL'))
    return t('desktop.sync.error.url')
  if (message.includes('HTTP 401') || message.includes('HTTP 403'))
    return t('desktop.sync.error.auth')
  if (message.includes('HTTP 412') || message.includes('HTTP 409'))
    return t('desktop.sync.error.remoteChanged')
  if (message.includes('HTTP 404')) return t('desktop.sync.error.folder')
  if (message.includes('requires an ETag')) return t('desktop.sync.error.etag')
  if (message.includes('has no data')) return t('desktop.sync.error.noData')
  if (message.includes('timeout')) return t('desktop.sync.error.timeout')
  if (message.includes('network error')) return t('desktop.sync.error.network')
  if (message.includes('not configured'))
    return t('desktop.sync.error.notConfigured')
  return t('desktop.sync.error.default')
}
