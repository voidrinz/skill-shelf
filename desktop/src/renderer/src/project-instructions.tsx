import { useEffect, useState } from 'react'
import {
  BookOpen,
  Check,
  Link2,
  LoaderCircle,
  RefreshCw,
  Save,
} from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'
import type {
  CatalogProject,
  ProjectInstructionName,
  ProjectInstructions,
} from '../../shared/desktop-contract'

const emptyDrafts = { 'AGENTS.md': '', 'CLAUDE.md': '' }

export function ProjectInstructionsButton({
  project,
}: {
  project: CatalogProject
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <BookOpen />
        {t('desktop.instructions.action')}
      </Button>
      {open ? (
        <ProjectInstructionsEditor
          project={project}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

export function ProjectInstructionsEditor({
  project,
  onClose,
}: {
  project: CatalogProject
  onClose: () => void
}) {
  const { t } = useI18n()
  const [snapshot, setSnapshot] = useState<ProjectInstructions | null>(null)
  const [drafts, setDrafts] = useState(emptyDrafts)
  const [selected, setSelected] = useState<ProjectInstructionName>('AGENTS.md')
  const [busy, setBusy] = useState('load')
  const [error, setError] = useState<string | null>(null)
  const [discard, setDiscard] = useState(false)
  const dirty = Boolean(
    snapshot &&
    (drafts['AGENTS.md'] !== snapshot.files['AGENTS.md'].content ||
      drafts['CLAUDE.md'] !== snapshot.files['CLAUDE.md'].content)
  )
  const current = snapshot?.files[selected]
  const currentDirty = Boolean(current && current.content !== drafts[selected])

  function accept(next: ProjectInstructions) {
    setSnapshot(next)
    setDrafts({
      'AGENTS.md': next.files['AGENTS.md'].content,
      'CLAUDE.md': next.files['CLAUDE.md'].content,
    })
  }

  function message(caught: unknown) {
    const value = caught instanceof Error ? caught.message : String(caught)
    if (value.includes('changed externally'))
      return t('desktop.instructions.error.conflict')
    if (value.includes('must be saved first'))
      return t('desktop.instructions.saveFirst')
    if (value.includes('read-only')) return t('desktop.instructions.readOnly')
    if (value.includes('no longer available'))
      return t('desktop.instructions.error.missing')
    return t('desktop.instructions.error.operation')
  }

  useEffect(() => {
    let active = true
    window.skillShelf
      .getProjectInstructions(project.id)
      .then((next) => {
        if (active) accept(next)
      })
      .catch((caught) => {
        if (active) setError(message(caught))
      })
      .finally(() => {
        if (active) setBusy('')
      })
    return () => {
      active = false
    }
  }, [project.id])

  async function reload() {
    if (dirty || busy) return
    setBusy('load')
    setError(null)
    try {
      accept(await window.skillShelf.getProjectInstructions(project.id))
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy('')
    }
  }

  async function save() {
    if (!current || current.readOnly || busy) return
    setBusy('save')
    setError(null)
    try {
      const next = await window.skillShelf.saveProjectInstruction({
        projectId: project.id,
        name: selected,
        content: drafts[selected],
        expectedRevision: current.revision,
      })
      setSnapshot(next)
      // Saving one tab must not discard an unsaved draft in the other tab.
      setDrafts((previous) => ({
        ...previous,
        [selected]: next.files[selected].content,
      }))
      toast.success(t('desktop.instructions.saved', { name: selected }))
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy('')
    }
  }

  async function connect() {
    if (!snapshot || dirty || busy) return
    setBusy('connect')
    setError(null)
    try {
      accept(
        await window.skillShelf.connectProjectClaude({
          projectId: project.id,
          expectedRevision: snapshot.files['CLAUDE.md'].revision,
        })
      )
      toast.success(t('desktop.instructions.connected'))
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy('')
    }
  }

  function close() {
    if (busy) return
    if (dirty) setDiscard(true)
    else onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) close()
      }}
    >
      <DialogContent
        className="project-instructions-dialog"
        closeLabel={t('common.close')}
        onInteractOutside={(event) => {
          if (
            busy ||
            (event.target instanceof Element &&
              event.target.closest('[data-slot="toaster"]'))
          )
            event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t('desktop.instructions.title', { name: project.name })}
          </DialogTitle>
          <DialogDescription>
            {t('desktop.instructions.description')}
          </DialogDescription>
        </DialogHeader>
        <code className="project-instructions-path" title={project.path}>
          {project.path}
        </code>
        {error ? (
          <p className="project-instructions-error" role="alert">
            {error}
          </p>
        ) : null}
        <section className="project-instructions-bridge">
          <div>
            <strong>{t('desktop.instructions.claude')}</strong>
            <p>
              {snapshot?.claudeUsesAgents
                ? t('desktop.instructions.linked')
                : t('desktop.instructions.bridgeDescription')}
            </p>
          </div>
          {snapshot?.claudeUsesAgents ? (
            <span className="project-instructions-linked">
              <Check />
              {t('desktop.instructions.linkedStatus')}
            </span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void connect()}
              disabled={
                Boolean(busy) ||
                dirty ||
                !snapshot?.files['AGENTS.md'].content.trim() ||
                snapshot.files['CLAUDE.md'].readOnly
              }
            >
              {busy === 'connect' ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Link2 />
              )}
              {t('desktop.instructions.connect')}
            </Button>
          )}
        </section>
        <Tabs
          className="project-instructions-tabs"
          value={selected}
          onValueChange={(name) => setSelected(name as ProjectInstructionName)}
        >
          <div className="project-instructions-files">
            <TabsList aria-label={t('desktop.instructions.files')}>
              <TabsTrigger value="AGENTS.md" disabled={Boolean(busy)}>
                AGENTS.md
              </TabsTrigger>
              <TabsTrigger value="CLAUDE.md" disabled={Boolean(busy)}>
                CLAUDE.md
              </TabsTrigger>
            </TabsList>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={Boolean(busy) || dirty}
              aria-label={t('desktop.instructions.reload')}
              onClick={() => void reload()}
            >
              <RefreshCw />
            </Button>
          </div>
          <TabsContent
            value={selected}
            className="project-instructions-tab-content"
          >
            <p className="project-instructions-file-hint">
              {!current
                ? busy === 'load'
                  ? t('desktop.instructions.loading')
                  : ''
                : current.readOnly
                  ? t('desktop.instructions.readOnly')
                  : current.exists
                    ? t('desktop.instructions.existing')
                    : t('desktop.instructions.newFile')}
            </p>
            <textarea
              className="project-instructions-editor"
              aria-label={t('desktop.instructions.editor', { name: selected })}
              value={drafts[selected]}
              disabled={Boolean(busy) || !current}
              readOnly={current?.readOnly}
              onChange={(event) => {
                setDiscard(false)
                setDrafts((previous) => ({
                  ...previous,
                  [selected]: event.target.value,
                }))
              }}
              spellCheck={false}
              placeholder={
                selected === 'AGENTS.md'
                  ? t('desktop.instructions.placeholder')
                  : '@AGENTS.md'
              }
            />
          </TabsContent>
        </Tabs>
        {discard ? (
          <p role="alert" className="project-instructions-error">
            {t('desktop.instructions.discardDescription')}
          </p>
        ) : null}
        <DialogFooter>
          {discard ? (
            <>
              <Button variant="ghost" onClick={() => setDiscard(false)}>
                {t('desktop.instructions.keepEditing')}
              </Button>
              <Button variant="destructive" onClick={onClose}>
                {t('desktop.instructions.discard')}
              </Button>
            </>
          ) : (
            <>
              <span className="project-instructions-unsaved">
                {dirty
                  ? t('desktop.instructions.unsaved')
                  : snapshot
                    ? t('desktop.instructions.savedOnDisk')
                    : ''}
              </span>
              <Button variant="ghost" disabled={Boolean(busy)} onClick={close}>
                {t('common.close')}
              </Button>
              <Button
                disabled={
                  Boolean(busy) ||
                  !current ||
                  current.readOnly ||
                  (!currentDirty && current.exists)
                }
                onClick={() => void save()}
              >
                {busy === 'save' ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Save />
                )}
                {t('desktop.instructions.save', { name: selected })}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
