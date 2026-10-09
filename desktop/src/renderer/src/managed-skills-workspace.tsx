import { SearchField, preserveSearchOnEscape } from './search-field'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  Archive,
  ArrowUpRight,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  FolderCheck,
  FolderInput,
  FolderOpen,
  HardDrive,
  Grid2X2,
  Link2,
  List as ListIcon,
  LoaderCircle,
  PackageOpen,
  PanelLeftClose,
  PencilLine,
  Plus,
  Rocket,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  toast,
} from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'
import { FileBrowserSkeleton, SkillsSkeleton } from './loading-skeletons'

import type {
  AgentInstallRegistrySnapshot,
  CatalogSnapshot,
  InstalledSkill,
  ManagedSkill,
  ManagedSkillDeployment,
  ManagedSkillDeploymentTarget,
  ManagedSkillInstallMode,
  ManagedSkillsSnapshot,
  SkillPack,
} from '../../shared/desktop-contract'
import {
  DEFAULT_SKILL_DRAWER_WIDTH,
  MAX_SKILL_DRAWER_WIDTH,
  MIN_SKILL_DRAWER_WIDTH,
} from '../../shared/desktop-contract'
import {
  getEffectiveInstallAgentIds,
  getInstallAgentGroups,
  getSelectedAdditionalAgentIds,
} from './install-agent-selection'
import { getLocalizedErrorMessage } from './localized-error'
import { useLibraryScopeResize } from './use-library-scope-resize'

const SkillFilesPanel = lazy(() => import('./skill-files-panel'))
const MANAGED_INSPECTOR_WIDTH_KEY = 'skill-shelf:managed-inspector-width'
const MANAGED_SCOPE_WIDTH_KEY = 'skill-shelf:managed-scope-width:v1'
const MANAGED_SCOPE_COLLAPSED_KEY = 'skill-shelf:managed-scope-collapsed:v1'
const DRAWER_KEYBOARD_STEP = 24

export default function ManagedSkillsWorkspace({
  catalog,
  onCatalogRefresh,
}: {
  catalog: CatalogSnapshot | null
  onCatalogRefresh: () => Promise<void>
}) {
  const { date, t } = useI18n()
  const [snapshot, setSnapshot] = useState<ManagedSkillsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [agentRegistry, setAgentRegistry] =
    useState<AgentInstallRegistrySnapshot | null>(null)
  const [agentRegistryError, setAgentRegistryError] = useState<string | null>(
    null
  )
  const [drawerContainer, setDrawerContainer] = useState<HTMLDivElement | null>(
    null
  )
  const [scopeCollapsed, setScopeCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(MANAGED_SCOPE_COLLAPSED_KEY) === 'true'
    } catch {
      return false
    }
  })
  const scopeResize = useLibraryScopeResize(
    scopeCollapsed,
    MANAGED_SCOPE_WIDTH_KEY
  )
  const scopePanelId = useId()
  const scopeToggleFocusRef = useRef(false)
  const setWorkspace = useCallback(
    (node: HTMLDivElement | null) => {
      scopeResize.workspaceRef.current = node
      setDrawerContainer(node)
    },
    [scopeResize.workspaceRef]
  )
  useEffect(() => {
    if (!scopeToggleFocusRef.current) return
    scopeToggleFocusRef.current = false
    scopeResize.workspaceRef.current
      ?.querySelector<HTMLButtonElement>(
        scopeCollapsed ? '.finder-scope-restore' : '.scope-panel-collapse'
      )
      ?.focus({ preventScroll: true })
  }, [scopeCollapsed, scopeResize.workspaceRef])
  const [inspectingSkillId, setInspectingSkillId] = useState<string | null>(
    null
  )
  const [inspectorFocus, setInspectorFocus] = useState<'info' | 'relations'>(
    'info'
  )
  const [selectedPackId, setSelectedPackId] = useState<string>('all')
  const [viewMode, setViewMode] = useState<'icons' | 'list'>(() => {
    const saved = window.localStorage.getItem('skill-shelf:managed-view')
    return saved === 'list' ? 'list' : 'icons'
  })
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [editingPack, setEditingPack] = useState<SkillPack | 'new' | null>(null)
  const [deployingSkill, setDeployingSkill] = useState<ManagedSkill | null>(
    null
  )
  const [deletingSkill, setDeletingSkill] = useState<ManagedSkill | null>(null)

  useEffect(() => {
    let active = true
    void window.skillShelf
      .getManagedSkills()
      .then((next) => {
        if (active) setSnapshot(next)
      })
      .catch((caught: unknown) => {
        if (active) setError(getLocalizedErrorMessage(caught, t))
      })
    return () => {
      active = false
    }
  }, [t])

  useEffect(() => {
    let active = true
    void window.skillShelf
      .getAgentInstallRegistry()
      .then((next) => {
        if (active) setAgentRegistry(next)
      })
      .catch((caught: unknown) => {
        if (active) setAgentRegistryError(getLocalizedErrorMessage(caught, t))
      })
    return () => {
      active = false
    }
  }, [t])

  const packSkills = useMemo(() => {
    if (!snapshot) return []
    if (selectedPackId === 'all') return snapshot.skills
    const pack = snapshot.packs.find((item) => item.id === selectedPackId)
    const ids = new Set(pack?.skillIds ?? [])
    return snapshot.skills.filter((skill) => ids.has(skill.id))
  }, [selectedPackId, snapshot])
  const visibleSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    if (!normalizedQuery) return packSkills
    return packSkills.filter((skill) =>
      [skill.name, skill.description]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    )
  }, [packSkills, query])
  const selectedPack = snapshot?.packs.find(
    (pack) => pack.id === selectedPackId
  )
  const inspectingSkill = snapshot?.skills.find(
    (skill) => skill.id === inspectingSkillId
  )

  function inspectSkill(
    skill: ManagedSkill,
    focus: 'info' | 'relations' = 'info'
  ) {
    setInspectorFocus(focus)
    setInspectingSkillId(skill.id)
  }

  async function importSkills(skillIds: string[]) {
    if (skillIds.length === 0 || busy) return
    setBusy(true)
    try {
      setSnapshot(await window.skillShelf.importManagedSkills(skillIds))
      setImportOpen(false)
      toast.success(t('desktop.managed.imported', { count: skillIds.length }))
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setBusy(false)
    }
  }

  async function savePack(input: {
    description: string
    id?: string
    name: string
    skillIds: string[]
  }) {
    setBusy(true)
    try {
      setSnapshot(await window.skillShelf.saveSkillPack(input))
      setEditingPack(null)
      toast.success(t('desktop.managed.packSaved'))
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setBusy(false)
    }
  }

  async function deletePack(pack: SkillPack) {
    if (busy) return
    setBusy(true)
    try {
      setSnapshot(await window.skillShelf.deleteSkillPack(pack.id))
      setSelectedPackId('all')
      toast.success(t('desktop.managed.packDeleted'))
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setBusy(false)
    }
  }

  async function deploySkill(
    skill: ManagedSkill,
    target: ManagedSkillDeploymentTarget,
    mode: ManagedSkillInstallMode
  ) {
    setBusy(true)
    try {
      setSnapshot(
        await window.skillShelf.deployManagedSkill({
          mode,
          skillId: skill.id,
          target,
        })
      )
      setDeployingSkill(null)
      if (target.kind !== 'custom') await onCatalogRefresh()
      toast.success(t('desktop.managed.deployed'))
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setBusy(false)
    }
  }

  async function removeDeployment(skill: ManagedSkill, deploymentId: string) {
    if (busy) return
    setBusy(true)
    try {
      setSnapshot(
        await window.skillShelf.removeManagedDeployment({
          deploymentId,
          skillId: skill.id,
        })
      )
      await onCatalogRefresh()
      toast.success(t('desktop.managed.deploymentRemoved'))
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setBusy(false)
    }
  }

  async function deleteSkill(skill: ManagedSkill) {
    if (busy) return
    setBusy(true)
    try {
      setSnapshot(await window.skillShelf.deleteManagedSkill(skill.id))
      setDeletingSkill(null)
      toast.success(t('desktop.managed.deleted'))
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setBusy(false)
    }
  }

  async function openManagedSkillFolder(skillId: string) {
    try {
      await window.skillShelf.openManagedSkillFolder(skillId)
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setQuery(queryDraft.trim())
  }

  function changeViewMode(mode: 'icons' | 'list') {
    setViewMode(mode)
    window.localStorage.setItem('skill-shelf:managed-view', mode)
  }

  function changeScopeCollapsed(collapsed: boolean, restoreFocus: boolean) {
    scopeToggleFocusRef.current = restoreFocus
    setScopeCollapsed(collapsed)
    try {
      window.localStorage.setItem(
        MANAGED_SCOPE_COLLAPSED_KEY,
        String(collapsed)
      )
    } catch {
      // Sidebar controls remain available when local storage is disabled.
    }
  }

  return (
    <div
      className="library-workspace finder-library-workspace managed-workspace"
      data-scope-collapsed={scopeCollapsed}
      ref={setWorkspace}
      style={scopeResize.style}
    >
      {scopeCollapsed ? (
        <button
          aria-controls={scopePanelId}
          aria-expanded="false"
          aria-label={t('desktop.managed.expandScope')}
          className="scope-panel-rail finder-scope-restore"
          onClick={(event) => changeScopeCollapsed(false, event.detail === 0)}
          type="button"
        >
          <ChevronRight aria-hidden="true" />
        </button>
      ) : null}
      <aside
        className="library-scope-panel managed-pack-sidebar"
        id={scopePanelId}
      >
        {!scopeCollapsed ? (
          <div
            aria-controls={scopePanelId}
            aria-label={t('desktop.managed.resizeScope')}
            aria-orientation="vertical"
            aria-valuemax={scopeResize.bounds.max}
            aria-valuemin={scopeResize.bounds.min}
            aria-valuenow={scopeResize.width}
            className="skill-drawer-resize-handle scope-panel-resize-handle"
            onDoubleClick={scopeResize.resetWidth}
            onKeyDown={scopeResize.handleKeyDown}
            onPointerDown={scopeResize.handlePointerDown}
            role="separator"
            tabIndex={0}
            title={t('desktop.library.resizeScopeHint')}
          >
            <span />
          </div>
        ) : null}
        <header className="scope-panel-header">
          <div className="scope-panel-title">
            <span>{t('desktop.managed.packs')}</span>
            <Button
              aria-controls={scopePanelId}
              aria-expanded="true"
              aria-label={t('desktop.managed.collapseScope')}
              className="scope-panel-collapse"
              onClick={(event) =>
                changeScopeCollapsed(true, event.detail === 0)
              }
              size="xs"
              variant="ghost"
            >
              <PanelLeftClose />
              {t('desktop.library.collapseScopeAction')}
            </Button>
          </div>
          <p>{t('desktop.managed.sidebarDescription')}</p>
        </header>
        <div className="scope-filter-list">
          <button
            className={cn(selectedPackId === 'all' && 'is-active')}
            onClick={() => setSelectedPackId('all')}
            type="button"
          >
            <span className="scope-filter-icon is-global">
              <Archive />
            </span>
            <span>
              <strong>{t('desktop.managed.allSkills')}</strong>
              <small>{t('desktop.managed.independentCopies')}</small>
            </span>
            <b>{snapshot?.skills.length ?? 0}</b>
          </button>
        </div>
        <section className="scope-projects managed-pack-section">
          <header>
            <div>
              <strong>{t('desktop.managed.myPacks')}</strong>
              <span>{snapshot?.packs.length ?? 0}</span>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={t('desktop.managed.newPack')}
                  onClick={() => setEditingPack('new')}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Plus />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('desktop.managed.newPack')}</TooltipContent>
            </Tooltip>
          </header>
          <div className="scope-filter-list managed-pack-list">
            {(snapshot?.packs ?? []).map((pack) => (
              <button
                className={cn(selectedPackId === pack.id && 'is-active')}
                key={pack.id}
                onClick={() => setSelectedPackId(pack.id)}
                type="button"
              >
                <span className="scope-filter-icon">
                  <Boxes />
                </span>
                <span>
                  <strong>{pack.name}</strong>
                  <small>
                    {pack.description || t('desktop.managed.packDescription')}
                  </small>
                </span>
                <b>{pack.skillIds.length}</b>
              </button>
            ))}
          </div>
        </section>
        <div className="managed-sidebar-actions">
          <Button
            onClick={() => setImportOpen(true)}
            size="sm"
            variant="outline"
          >
            <FolderInput />
            {t('desktop.managed.import')}
          </Button>
        </div>
      </aside>

      <section className="library-pane finder-library-pane managed-content">
        <PageHeader
          actions={
            <>
              <Button
                onClick={() => setEditingPack('new')}
                size="sm"
                variant="outline"
              >
                <Boxes />
                {t('desktop.managed.newPack')}
              </Button>
              <Button onClick={() => setImportOpen(true)} size="sm">
                <FolderInput />
                {t('desktop.managed.import')}
              </Button>
            </>
          }
          className="library-page-header finder-page-header"
          description={
            selectedPack?.description || t('desktop.managed.description')
          }
          eyebrow={t('desktop.managed.eyebrow')}
          title={selectedPack?.name ?? t('desktop.managed.title')}
        />

        <div className="finder-navigation managed-navigation">
          <nav aria-label={t('desktop.managed.location')}>
            <button onClick={() => setSelectedPackId('all')} type="button">
              <Archive />
              {t('desktop.managed.packs')}
            </button>
            {selectedPack ? (
              <span>
                <ChevronRight />
                <button type="button">{selectedPack.name}</button>
              </span>
            ) : null}
          </nav>
          <div
            aria-label={t('desktop.library.viewMode')}
            className="library-view-switcher finder-view-switcher"
            role="group"
          >
            {(
              [
                ['icons', Grid2X2, t('desktop.library.viewCanvas')],
                ['list', ListIcon, t('desktop.library.viewList')],
              ] as const
            ).map(([mode, Icon, label]) => (
              <Tooltip key={mode}>
                <TooltipTrigger asChild>
                  <button
                    aria-label={label}
                    aria-pressed={viewMode === mode}
                    onClick={() => changeViewMode(mode)}
                    type="button"
                  >
                    <Icon />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
          {selectedPack ? (
            <div className="managed-pack-actions">
              <Button
                onClick={() => setEditingPack(selectedPack)}
                size="xs"
                variant="ghost"
              >
                <PencilLine />
                {t('desktop.managed.editPack')}
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={t('desktop.managed.delete')}
                    disabled={busy}
                    onClick={() => void deletePack(selectedPack)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t('desktop.managed.delete')}
                </TooltipContent>
              </Tooltip>
            </div>
          ) : null}
        </div>

        <div className="library-toolbar finder-toolbar managed-toolbar">
          <form className="search-control" onSubmit={submitSearch}>
            <SearchField
              appliedValue={query}
              clearLabel={t('desktop.managed.clearSearch')}
              label={t('desktop.managed.search')}
              onChange={setQueryDraft}
              onClear={() => {
                setQuery('')
                setQueryDraft('')
              }}
              placeholder={t('desktop.managed.searchPlaceholder')}
              value={queryDraft}
            />
            <Button size="sm" type="submit" variant="outline">
              <Search />
              {t('common.filter')}
            </Button>
          </form>
          <div className="library-toolbar-meta">
            <Badge variant="outline">
              {t('desktop.managed.skillCount', {
                count: visibleSkills.length,
              })}
            </Badge>
          </div>
        </div>

        <div className="finder-content managed-finder-content">
          {error ? (
            <div className="managed-state is-error">
              <strong>{error}</strong>
              <Button onClick={() => window.location.reload()} size="sm">
                {t('common.tryAgain')}
              </Button>
            </div>
          ) : !snapshot ? (
            <SkillsSkeleton layout="managed" view={viewMode} />
          ) : visibleSkills.length === 0 ? (
            <div className="managed-state">
              <span>
                <PackageOpen />
              </span>
              <strong>
                {query
                  ? t('desktop.managed.noSearchResults')
                  : t('desktop.managed.emptyTitle')}
              </strong>
              <p>
                {query
                  ? t('desktop.managed.noSearchResultsDescription')
                  : t('desktop.managed.emptyDescription')}
              </p>
              {query ? (
                <Button
                  onClick={() => {
                    setQuery('')
                    setQueryDraft('')
                  }}
                  size="sm"
                  variant="outline"
                >
                  <X />
                  {t('desktop.managed.clearSearch')}
                </Button>
              ) : (
                <Button onClick={() => setImportOpen(true)} size="sm">
                  <FolderInput />
                  {t('desktop.managed.import')}
                </Button>
              )}
            </div>
          ) : viewMode === 'icons' ? (
            <div className="managed-icon-view">
              {visibleSkills.map((skill) => (
                <article className="managed-icon-item" key={skill.id}>
                  <button
                    className="managed-icon-primary"
                    onClick={() => inspectSkill(skill)}
                    onDoubleClick={() => void openManagedSkillFolder(skill.id)}
                    type="button"
                  >
                    <span className="finder-skill-icon">
                      <Boxes />
                      <ManagedSymlinkIndicator skill={skill} />
                    </span>
                    <strong>{skill.name}</strong>
                  </button>
                  <ManagedSkillQuickActions
                    onDelete={() => setDeletingSkill(skill)}
                    onDeploy={() => setDeployingSkill(skill)}
                    onOpenFolder={() => void openManagedSkillFolder(skill.id)}
                  />
                </article>
              ))}
            </div>
          ) : (
            <div className="managed-list-view">
              <div className="managed-list-header" role="row">
                <span>{t('desktop.managed.columnName')}</span>
                <span>{t('desktop.managed.columnDescription')}</span>
                <span>{t('desktop.managed.columnPacks')}</span>
                <span>{t('desktop.managed.columnProjects')}</span>
                <span aria-hidden="true" />
              </div>
              {visibleSkills.map((skill) => (
                <article className="managed-list-row" key={skill.id}>
                  <button
                    className="managed-list-name"
                    onClick={() => inspectSkill(skill)}
                    onDoubleClick={() => void openManagedSkillFolder(skill.id)}
                    type="button"
                  >
                    <span className="managed-list-icon">
                      <Boxes />
                    </span>
                    <span>
                      <strong>{skill.name}</strong>
                      <small>
                        {t(
                          skill.sourceScope === 'global'
                            ? 'desktop.managed.sourceGlobal'
                            : 'desktop.managed.sourceProject'
                        )}
                        {' · '}
                        {date(skill.importedAt, {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </small>
                    </span>
                  </button>
                  <p>
                    {skill.description || t('desktop.managed.noDescription')}
                  </p>
                  <div className="managed-list-packs">
                    {snapshot.packs
                      .filter((pack) => pack.skillIds.includes(skill.id))
                      .map((pack) => (
                        <Badge key={pack.id} variant="secondary">
                          {pack.name}
                        </Badge>
                      ))}
                  </div>
                  <ManagedSymlinkIndicator skill={skill} variant="list" />
                  <ManagedSkillQuickActions
                    onDelete={() => setDeletingSkill(skill)}
                    onDeploy={() => setDeployingSkill(skill)}
                    onOpenFolder={() => void openManagedSkillFolder(skill.id)}
                  />
                </article>
              ))}
            </div>
          )}
        </div>
      </section>

      {importOpen && snapshot ? (
        <ImportSkillsDialog
          busy={busy}
          candidates={catalog?.skills ?? []}
          managed={snapshot}
          onImport={(ids) => void importSkills(ids)}
          onOpenChange={setImportOpen}
        />
      ) : null}
      {editingPack && snapshot ? (
        <PackDialog
          busy={busy}
          managed={snapshot}
          onOpenChange={(open) => {
            if (!open) setEditingPack(null)
          }}
          onSave={(input) => void savePack(input)}
          pack={editingPack === 'new' ? null : editingPack}
        />
      ) : null}
      {deployingSkill ? (
        <DeployDialog
          agentRegistry={agentRegistry}
          agentRegistryError={agentRegistryError}
          busy={busy}
          catalog={catalog}
          onDeploy={(target, mode) =>
            void deploySkill(deployingSkill, target, mode)
          }
          onOpenChange={(open) => {
            if (!open) setDeployingSkill(null)
          }}
          skill={deployingSkill}
        />
      ) : null}
      {inspectingSkill ? (
        <ManagedSkillInspector
          busy={busy}
          drawerContainer={drawerContainer}
          focus={inspectorFocus}
          onClose={() => setInspectingSkillId(null)}
          onDeploy={() => setDeployingSkill(inspectingSkill)}
          onOpenDeployment={(deployment) =>
            void window.skillShelf
              .openManagedDeploymentFolder({
                deploymentId: deployment.id,
                skillId: inspectingSkill.id,
              })
              .catch((caught: unknown) =>
                toast.error(getLocalizedErrorMessage(caught, t))
              )
          }
          onOpenFolder={() => void openManagedSkillFolder(inspectingSkill.id)}
          onRemoveDeployment={(deploymentId) =>
            void removeDeployment(inspectingSkill, deploymentId)
          }
          packs={(snapshot?.packs ?? []).filter((pack) =>
            pack.skillIds.includes(inspectingSkill.id)
          )}
          skill={inspectingSkill}
        />
      ) : null}
      {deletingSkill ? (
        <Dialog
          onOpenChange={(open) => {
            if (!open) setDeletingSkill(null)
          }}
          open
        >
          <DialogContent closeLabel={t('common.close')}>
            <DialogHeader>
              <DialogTitle>{t('desktop.managed.deleteTitle')}</DialogTitle>
              <DialogDescription>
                {t('desktop.managed.deleteDescription', {
                  name: deletingSkill.name,
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setDeletingSkill(null)} variant="outline">
                {t('common.cancel')}
              </Button>
              <Button
                disabled={busy}
                onClick={() => void deleteSkill(deletingSkill)}
                variant="destructive"
              >
                {busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                {t('desktop.managed.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}

function ManagedSkillQuickActions({
  onDelete,
  onDeploy,
  onOpenFolder,
}: {
  onDelete: () => void
  onDeploy: () => void
  onOpenFolder: () => void
}) {
  const { t } = useI18n()

  return (
    <div className="managed-skill-actions">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={t('desktop.managed.deploy')}
            onClick={onDeploy}
            type="button"
          >
            <Rocket />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t('desktop.managed.deploy')}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={t('common.openFolder')}
            onClick={onOpenFolder}
            type="button"
          >
            <FolderOpen />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t('common.openFolder')}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={t('desktop.managed.delete')}
            onClick={onDelete}
            type="button"
          >
            <Trash2 />
          </button>
        </TooltipTrigger>
        <TooltipContent>{t('desktop.managed.delete')}</TooltipContent>
      </Tooltip>
    </div>
  )
}

function ManagedSymlinkIndicator({
  skill,
  variant = 'icon',
}: {
  skill: ManagedSkill
  variant?: 'icon' | 'list'
}) {
  const { t } = useI18n()
  const linkCount = skill.deployments.filter(
    (deployment) => deployment.mode === 'symlink'
  ).length
  const label = linkCount
    ? t('desktop.managed.linkedLocationCount', { count: linkCount })
    : t('desktop.managed.noLinkedLocations')

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-disabled={!linkCount}
          aria-label={label}
          className={cn(
            'managed-symlink-indicator',
            linkCount && 'has-links',
            variant === 'list' && 'is-list'
          )}
          role="img"
        >
          <Link2 />
          {linkCount && variant === 'list' ? (
            <span aria-hidden="true" className="managed-symlink-count">
              {linkCount}
            </span>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function ManagedSkillInspector({
  busy,
  drawerContainer,
  focus,
  onClose,
  onDeploy,
  onOpenDeployment,
  onOpenFolder,
  onRemoveDeployment,
  packs,
  skill,
}: {
  busy: boolean
  drawerContainer: HTMLElement | null
  focus: 'info' | 'relations'
  onClose: () => void
  onDeploy: () => void
  onOpenDeployment: (deployment: ManagedSkillDeployment) => void
  onOpenFolder: () => void
  onRemoveDeployment: (deploymentId: string) => void
  packs: SkillPack[]
  skill: ManagedSkill
}) {
  const { date, t } = useI18n()
  const [activeTab, setActiveTab] = useState('info')
  const [drawerWidth, setDrawerWidth] = useState(() =>
    readManagedInspectorWidth()
  )
  const inspectorRef = useRef<HTMLDivElement | null>(null)
  const inspectorScrollRef = useRef<HTMLDivElement | null>(null)
  const relationsRef = useRef<HTMLElement | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)
  const symlinkDeployments = skill.deployments.filter(
    (deployment) => deployment.mode === 'symlink'
  )
  const copyCount = skill.deployments.length - symlinkDeployments.length

  useEffect(() => {
    setActiveTab('info')
    if (focus !== 'relations') return
    const frame = window.requestAnimationFrame(() => {
      const scrollContainer = inspectorScrollRef.current
      const relations = relationsRef.current
      if (!scrollContainer || !relations) return
      const targetTop =
        relations.getBoundingClientRect().top -
        scrollContainer.getBoundingClientRect().top +
        scrollContainer.scrollTop -
        18
      scrollContainer.scrollTop = Math.max(0, targetTop)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focus, skill.id])

  useEffect(() => {
    const syncWidth = () => {
      setDrawerWidth((current) =>
        clampManagedInspectorWidth(current, drawerContainer)
      )
    }
    syncWidth()
    if (!drawerContainer || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncWidth)
      return () => window.removeEventListener('resize', syncWidth)
    }
    const observer = new ResizeObserver(syncWidth)
    observer.observe(drawerContainer)
    return () => observer.disconnect()
  }, [drawerContainer])

  useEffect(
    () => () => {
      resizeCleanupRef.current?.()
    },
    []
  )

  function commitDrawerWidth(width: number) {
    const nextWidth = clampManagedInspectorWidth(width, drawerContainer)
    setDrawerWidth(nextWidth)
    window.localStorage.setItem(MANAGED_INSPECTOR_WIDTH_KEY, String(nextWidth))
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const panel = inspectorRef.current
    if (!panel) return
    event.preventDefault()
    resizeCleanupRef.current?.()
    const startX = event.clientX
    const startWidth = panel.getBoundingClientRect().width
    let latestWidth = startWidth
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    panel.dataset.resizing = 'true'
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    const move = (pointerEvent: PointerEvent) => {
      latestWidth = clampManagedInspectorWidth(
        startWidth + startX - pointerEvent.clientX,
        drawerContainer
      )
      panel.style.width = `${latestWidth}px`
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      delete panel.dataset.resizing
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      resizeCleanupRef.current = null
    }
    const finish = () => {
      cleanup()
      commitDrawerWidth(latestWidth)
    }
    resizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('pointercancel', finish, { once: true })
  }

  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    let nextWidth: number | null = null
    if (event.key === 'ArrowLeft') {
      nextWidth = drawerWidth + DRAWER_KEYBOARD_STEP
    } else if (event.key === 'ArrowRight') {
      nextWidth = drawerWidth - DRAWER_KEYBOARD_STEP
    } else if (event.key === 'Home') {
      nextWidth = MIN_SKILL_DRAWER_WIDTH
    } else if (event.key === 'End') {
      nextWidth = MAX_SKILL_DRAWER_WIDTH
    }
    if (nextWidth === null) return
    event.preventDefault()
    commitDrawerWidth(nextWidth)
  }

  const drawerBounds = getManagedInspectorBounds(drawerContainer)

  return (
    <Sheet
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open
    >
      <SheetContent
        className="skill-inspector skill-sheet-content managed-skill-inspector"
        closeLabel={t('common.close')}
        onFocusOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          const target = event.target
          if (
            drawerContainer &&
            target instanceof Node &&
            !drawerContainer.contains(target)
          ) {
            event.preventDefault()
          }
        }}
        overlayClassName="skill-sheet-overlay"
        overlayMode="scoped"
        portalContainer={drawerContainer}
        ref={inspectorRef}
        style={{ width: drawerWidth }}
      >
        <div
          aria-label={t('desktop.inspector.resize')}
          aria-orientation="vertical"
          aria-valuemax={drawerBounds.max}
          aria-valuemin={drawerBounds.min}
          aria-valuenow={drawerWidth}
          className="skill-drawer-resize-handle"
          onKeyDown={handleResizeKeyDown}
          onPointerDown={handleResizePointerDown}
          role="separator"
          tabIndex={0}
        >
          <span aria-hidden="true" />
        </div>
        <div className="inspector-header">
          <div className="inspector-kicker">
            <span>
              <Boxes />
            </span>
            {t('desktop.managed.inspectorKicker')}
          </div>
          <SheetTitle>{skill.name}</SheetTitle>
          <SheetDescription className="sr-only">
            {skill.description || t('desktop.managed.noDescription')}
          </SheetDescription>
          <div className="inspector-actions">
            <Button onClick={onOpenFolder} size="sm" variant="outline">
              <FolderOpen />
              {t('common.openFolder')}
            </Button>
            <Button onClick={onDeploy} size="sm" variant="ghost">
              <Rocket />
              {t('desktop.managed.deploy')}
            </Button>
          </div>
        </div>
        <Tabs
          className="skill-detail-tabs"
          onValueChange={setActiveTab}
          value={activeTab}
        >
          <div className="skill-detail-tab-bar">
            <TabsList className="skill-detail-tab-list">
              <TabsTrigger value="info">
                {t('desktop.inspector.info')}
              </TabsTrigger>
              <TabsTrigger value="files">
                {t('desktop.inspector.files')}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent
            className="inspector-scroll"
            ref={inspectorScrollRef}
            value="info"
          >
            <section className="managed-inspector-section">
              <h3>
                <FileText />
                {t('desktop.managed.descriptionLabel')}
              </h3>
              <div className="managed-inspector-description">
                {skill.description || t('desktop.managed.noDescription')}
              </div>
            </section>
            <section className="managed-inspector-section">
              <h3>
                <Boxes />
                {t('desktop.managed.packMembership')}
              </h3>
              <div className="managed-inspector-packs">
                {packs.length ? (
                  packs.map((pack) => (
                    <Badge key={pack.id} variant="secondary">
                      {pack.name}
                    </Badge>
                  ))
                ) : (
                  <span>{t('desktop.managed.noPackMembership')}</span>
                )}
              </div>
            </section>
            <section
              className="managed-inspector-section managed-relations-section"
              ref={relationsRef}
            >
              <h3>
                <Link2 />
                {t('desktop.managed.linkRelations')}
                <Badge variant="outline">{symlinkDeployments.length}</Badge>
              </h3>
              {symlinkDeployments.length ? (
                <div className="managed-relation-list">
                  {symlinkDeployments.map((deployment) => (
                    <article key={deployment.id}>
                      <header>
                        <span>
                          <Link2 />
                        </span>
                        <div>
                          <strong>{deployment.targetName}</strong>
                          <small>
                            {deployment.agentName ??
                              getManagedTargetKindLabel(deployment, t)}
                          </small>
                        </div>
                        <Button
                          aria-label={t('desktop.managed.openLinkedLocation')}
                          onClick={() => onOpenDeployment(deployment)}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <ArrowUpRight />
                        </Button>
                      </header>
                      <dl>
                        <div>
                          <dt>{t('desktop.managed.linkedSkillPath')}</dt>
                          <dd>
                            <code>{deployment.targetPath}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>{t('desktop.managed.packSourcePath')}</dt>
                          <dd>
                            <code>{skill.managedPath}</code>
                          </dd>
                        </div>
                      </dl>
                      <footer>
                        <span>
                          {t('desktop.managed.linkedAt', {
                            date: date(deployment.installedAt, {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            }),
                          })}
                        </span>
                        <Button
                          disabled={busy}
                          onClick={() => onRemoveDeployment(deployment.id)}
                          size="xs"
                          variant="ghost"
                        >
                          <X />
                          {t('desktop.managed.removeLink')}
                        </Button>
                      </footer>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="managed-relations-empty">
                  <Link2 />
                  <div>
                    <strong>{t('desktop.managed.noLinkRelations')}</strong>
                    <p>{t('desktop.managed.noLinkRelationsDescription')}</p>
                  </div>
                </div>
              )}
              {copyCount ? (
                <div className="managed-copy-note">
                  <Copy />
                  <span>
                    {t('desktop.managed.independentCopyCount', {
                      count: copyCount,
                    })}
                    <small>{t('desktop.managed.copyNotLinked')}</small>
                  </span>
                </div>
              ) : null}
            </section>
            <section className="managed-inspector-section">
              <h3>
                <BookOpen />
                {t('desktop.managed.localRecord')}
              </h3>
              <div className="managed-record-paths">
                <div>
                  <span>{t('desktop.managed.managedPath')}</span>
                  <code>{skill.managedPath}</code>
                </div>
                <div>
                  <span>{t('desktop.managed.importSourcePath')}</span>
                  <code>{skill.sourcePath}</code>
                </div>
              </div>
            </section>
          </TabsContent>
          <TabsContent className="skill-files-tab" value="files">
            <Suspense fallback={<FileBrowserSkeleton />}>
              <SkillFilesPanel skillId={skill.id} />
            </Suspense>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

function ImportSkillsDialog({
  busy,
  candidates,
  managed,
  onImport,
  onOpenChange,
}: {
  busy: boolean
  candidates: InstalledSkill[]
  managed: ManagedSkillsSnapshot
  onImport: (skillIds: string[]) => void
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const managedSourceIds = useMemo(
    () => new Set(managed.skills.map((skill) => skill.sourceSkillId)),
    [managed.skills]
  )
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'all' | 'global' | 'project'>('all')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const availableSkills = useMemo(
    () => candidates.filter((skill) => !managedSourceIds.has(skill.id)),
    [candidates, managedSourceIds]
  )
  const filteredSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return availableSkills.filter((skill) => {
      if (scope !== 'all' && skill.scope !== scope) return false
      if (!normalizedQuery) return true
      return [skill.name, skill.description, skill.projectName, skill.source]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    })
  }, [availableSkills, query, scope])

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setQuery(queryDraft.trim())
  }

  function toggle(skillId: string) {
    setSelectedIds((current) =>
      current.includes(skillId)
        ? current.filter((id) => id !== skillId)
        : [...current, skillId]
    )
  }

  function selectVisible() {
    setSelectedIds((current) => [
      ...new Set([...current, ...filteredSkills.map((skill) => skill.id)]),
    ])
  }

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent
        className="managed-dialog"
        closeLabel={t('common.close')}
        onEscapeKeyDown={preserveSearchOnEscape}
      >
        <DialogHeader>
          <DialogTitle>{t('desktop.managed.importTitle')}</DialogTitle>
          <DialogDescription>
            {t('desktop.managed.importDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="managed-import-controls">
          <form className="managed-import-search" onSubmit={submitSearch}>
            <SearchField
              appliedValue={query}
              label={t('desktop.managed.searchInstalled')}
              onChange={setQueryDraft}
              onClear={() => {
                setQueryDraft('')
                setQuery('')
              }}
              placeholder={t('desktop.managed.searchInstalledPlaceholder')}
              value={queryDraft}
            />
            <Button size="sm" type="submit" variant="outline">
              <Search />
              {t('common.search')}
            </Button>
          </form>
          <Select
            onValueChange={(value) =>
              setScope(value as 'all' | 'global' | 'project')
            }
            value={scope}
          >
            <SelectTrigger aria-label={t('desktop.managed.scopeFilter')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t('desktop.managed.scopeAll')}
              </SelectItem>
              <SelectItem value="global">
                {t('desktop.managed.scopeGlobal')}
              </SelectItem>
              <SelectItem value="project">
                {t('desktop.managed.scopeProject')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="managed-import-summary">
          <span>
            {t('desktop.managed.importAvailable', {
              count: filteredSkills.length,
            })}
            {' · '}
            {t('desktop.managed.importSelectedCount', {
              count: selectedIds.length,
            })}
          </span>
          <div>
            <Button
              disabled={filteredSkills.length === 0}
              onClick={selectVisible}
              size="xs"
              variant="ghost"
            >
              {t('desktop.managed.selectResults')}
            </Button>
            <Button
              disabled={selectedIds.length === 0}
              onClick={() => setSelectedIds([])}
              size="xs"
              variant="ghost"
            >
              {t('desktop.managed.clearSelection')}
            </Button>
          </div>
        </div>
        <div className="managed-selection-list is-import-list">
          {availableSkills.length === 0 ? (
            <p>{t('desktop.managed.noImportCandidates')}</p>
          ) : filteredSkills.length === 0 ? (
            <p>{t('desktop.managed.noImportMatches')}</p>
          ) : (
            filteredSkills.map((skill) => (
              <button
                aria-pressed={selectedIds.includes(skill.id)}
                className={cn(
                  'managed-selection-row',
                  selectedIds.includes(skill.id) && 'is-selected'
                )}
                key={skill.id}
                onClick={() => toggle(skill.id)}
                type="button"
              >
                <span>{selectedIds.includes(skill.id) ? <Check /> : null}</span>
                <div>
                  <strong>{skill.name}</strong>
                  <small>
                    {skill.projectName ?? t('desktop.managed.sourceGlobal')}
                  </small>
                </div>
              </button>
            ))
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button
            disabled={busy || selectedIds.length === 0}
            onClick={() => onImport(selectedIds)}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <FolderInput />}
            {t('desktop.managed.importSelected', {
              count: selectedIds.length,
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PackDialog({
  busy,
  managed,
  onOpenChange,
  onSave,
  pack,
}: {
  busy: boolean
  managed: ManagedSkillsSnapshot
  onOpenChange: (open: boolean) => void
  onSave: (input: {
    description: string
    id?: string
    name: string
    skillIds: string[]
  }) => void
  pack: SkillPack | null
}) {
  const { t } = useI18n()
  const [name, setName] = useState(pack?.name ?? '')
  const [description, setDescription] = useState(pack?.description ?? '')
  const [skillIds, setSkillIds] = useState<string[]>(pack?.skillIds ?? [])

  function toggle(skillId: string) {
    setSkillIds((current) =>
      current.includes(skillId)
        ? current.filter((id) => id !== skillId)
        : [...current, skillId]
    )
  }

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent className="managed-dialog" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {pack
              ? t('desktop.managed.editPack')
              : t('desktop.managed.newPack')}
          </DialogTitle>
          <DialogDescription>
            {t('desktop.managed.packDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="managed-pack-form">
          <label>
            <span>{t('desktop.managed.packName')}</span>
            <Input
              maxLength={64}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
          <label>
            <span>{t('desktop.managed.packNote')}</span>
            <Textarea
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              value={description}
            />
          </label>
          <span>{t('desktop.managed.packSkills')}</span>
          <div className="managed-selection-list is-compact">
            {managed.skills.map((skill) => (
              <button
                aria-pressed={skillIds.includes(skill.id)}
                className={cn(
                  'managed-selection-row',
                  skillIds.includes(skill.id) && 'is-selected'
                )}
                key={skill.id}
                onClick={() => toggle(skill.id)}
                type="button"
              >
                <span>{skillIds.includes(skill.id) ? <Check /> : null}</span>
                <div>
                  <strong>{skill.name}</strong>
                  <small>{skill.description}</small>
                </div>
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button
            disabled={busy || !name.trim()}
            onClick={() =>
              onSave({
                description,
                ...(pack ? { id: pack.id } : {}),
                name,
                skillIds,
              })
            }
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <Check />}
            {t('desktop.managed.savePack')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeployDialog({
  agentRegistry,
  agentRegistryError,
  busy,
  catalog,
  onDeploy,
  onOpenChange,
  skill,
}: {
  agentRegistry: AgentInstallRegistrySnapshot | null
  agentRegistryError: string | null
  busy: boolean
  catalog: CatalogSnapshot | null
  onDeploy: (
    target: ManagedSkillDeploymentTarget,
    mode: ManagedSkillInstallMode
  ) => void
  onOpenChange: (open: boolean) => void
  skill: ManagedSkill
}) {
  const { t } = useI18n()
  const availableProjects = catalog?.projects ?? []
  const globalAvailable = !skill.deployments.some(
    (deployment) => deployment.targetKind === 'global'
  )
  const [targetValue, setTargetValue] = useState(
    globalAvailable
      ? 'global'
      : availableProjects[0]
        ? `project:${availableProjects[0].id}`
        : 'project-directory'
  )
  const [projectDirectory, setProjectDirectory] = useState<{
    name: string
    path: string
  } | null>(null)
  const [customDirectory, setCustomDirectory] = useState<{
    name: string
    path: string
  } | null>(null)
  const [mode, setMode] = useState<ManagedSkillInstallMode>('copy')
  const [agentIds, setAgentIds] = useState<string[]>([])
  const [agentQueryDraft, setAgentQueryDraft] = useState('')
  const [agentQuery, setAgentQuery] = useState('')
  const selectedProject = targetValue.startsWith('project:')
    ? availableProjects.find(
        (project) => project.id === targetValue.slice('project:'.length)
      )
    : undefined
  const projectRootPath = selectedProject?.path ?? projectDirectory?.path
  const isProjectTarget = Boolean(
    selectedProject || targetValue === 'project-directory'
  )
  const agentGroups = useMemo(
    () => getInstallAgentGroups(agentRegistry, 'project'),
    [agentRegistry]
  )
  const selectedAdditionalAgentIds = getSelectedAdditionalAgentIds(
    agentGroups,
    agentIds
  )
  const effectiveAgentIds = getEffectiveInstallAgentIds(agentGroups, agentIds)
  const normalizedAgentQuery = agentQuery.trim().toLocaleLowerCase()
  const visibleAgents = agentGroups.additional.filter(
    (agent) =>
      !normalizedAgentQuery ||
      agent.name.toLocaleLowerCase().includes(normalizedAgentQuery) ||
      agent.id.toLocaleLowerCase().includes(normalizedAgentQuery)
  )
  const target: ManagedSkillDeploymentTarget | null =
    targetValue === 'global'
      ? { kind: 'global' }
      : selectedProject
        ? {
            agentIds: effectiveAgentIds,
            kind: 'project',
            projectId: selectedProject.id,
          }
        : targetValue === 'project-directory' && projectDirectory
          ? {
              agentIds: effectiveAgentIds,
              directoryPath: projectDirectory.path,
              kind: 'project-directory',
            }
          : targetValue === 'custom' && customDirectory
            ? { directoryPath: customDirectory.path, kind: 'custom' }
            : null
  const targetPreviews = useMemo(() => {
    if (targetValue === 'global') {
      return [
        {
          label: t('desktop.install.universal'),
          path: `~/.agents/skills/${skill.name}`,
        },
      ]
    }
    if (targetValue === 'custom' && customDirectory) {
      return [
        {
          label: t('desktop.managed.targetKind.custom'),
          path: `${trimTrailingSlash(customDirectory.path)}/${skill.name}`,
        },
      ]
    }
    if (!isProjectTarget || !projectRootPath || !agentRegistry) return []
    const selectedAgents = effectiveAgentIds
      .map((agentId) =>
        agentRegistry.agents.find((agent) => agent.id === agentId)
      )
      .filter((agent) => agent !== undefined)
    const seenDirectories = new Set<string>()
    return selectedAgents.flatMap((agent) => {
      if (seenDirectories.has(agent.projectSkillDirectory)) return []
      seenDirectories.add(agent.projectSkillDirectory)
      return [
        {
          label: agent.name,
          path: `${trimTrailingSlash(projectRootPath)}/${agent.projectSkillDirectory}/${skill.name}`,
        },
      ]
    })
  }, [
    agentRegistry,
    customDirectory,
    effectiveAgentIds,
    isProjectTarget,
    projectRootPath,
    skill.name,
    t,
    targetValue,
  ])

  async function chooseDirectory(purpose: 'project-root' | 'skill-parent') {
    try {
      const selection =
        await window.skillShelf.selectManagedDeploymentFolder(purpose)
      if (!selection) return
      if (purpose === 'project-root') {
        setProjectDirectory(selection)
        setTargetValue('project-directory')
      } else {
        setCustomDirectory(selection)
        setTargetValue('custom')
      }
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    }
  }

  function toggleAgent(agentId: string) {
    setAgentIds((current) =>
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId]
    )
  }

  function applyAgentSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    event.stopPropagation()
    setAgentQuery(agentQueryDraft.trim())
  }

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent
        className="managed-deploy-dialog"
        closeLabel={t('common.close')}
      >
        <DialogHeader>
          <DialogTitle>{t('desktop.managed.deployTitle')}</DialogTitle>
          <DialogDescription>
            {t('desktop.managed.deployDescription', { name: skill.name })}
          </DialogDescription>
        </DialogHeader>
        <div className="managed-deploy-form">
          <label>
            <span>{t('desktop.managed.target')}</span>
            <Select
              onValueChange={(value) => {
                setTargetValue(value)
                if (value === 'project-directory' && !projectDirectory) {
                  void chooseDirectory('project-root')
                } else if (value === 'custom' && !customDirectory) {
                  void chooseDirectory('skill-parent')
                }
              }}
              value={targetValue}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('desktop.managed.chooseTarget')} />
              </SelectTrigger>
              <SelectContent>
                {globalAvailable ? (
                  <SelectGroup>
                    <SelectLabel>
                      {t('desktop.managed.targetCommon')}
                    </SelectLabel>
                    <SelectItem value="global">
                      <span className="managed-deploy-option">
                        <HardDrive />
                        <span>{t('desktop.managed.targetGlobal')}</span>
                      </span>
                    </SelectItem>
                  </SelectGroup>
                ) : null}
                {globalAvailable && availableProjects.length > 0 ? (
                  <SelectSeparator />
                ) : null}
                {availableProjects.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel>
                      {t('desktop.managed.targetProjects')}
                    </SelectLabel>
                    {availableProjects.map((project) => (
                      <SelectItem
                        key={project.id}
                        value={`project:${project.id}`}
                      >
                        <span className="managed-deploy-option">
                          <FolderOpen />
                          <span>{project.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
                {globalAvailable || availableProjects.length > 0 ? (
                  <SelectSeparator />
                ) : null}
                <SelectGroup>
                  <SelectLabel>{t('desktop.managed.targetLocal')}</SelectLabel>
                  <SelectItem value="project-directory">
                    <span className="managed-deploy-option">
                      <FolderCheck />
                      <span>{t('desktop.managed.targetProjectDirectory')}</span>
                    </span>
                  </SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectItem value="custom">
                  <span className="managed-deploy-option">
                    <FolderInput />
                    <span>{t('desktop.managed.targetCustomAdvanced')}</span>
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <div className="managed-deploy-target-path">
            <div>
              {targetValue === 'global' ? <HardDrive /> : <FolderOpen />}
              <span>
                <b>
                  {targetValue === 'global'
                    ? t('desktop.managed.targetKind.global')
                    : (selectedProject?.name ??
                      (targetValue === 'project-directory'
                        ? projectDirectory?.name
                        : customDirectory?.name) ??
                      t('desktop.managed.noFolderSelected'))}
                </b>
                {targetValue === 'global' ? (
                  <code>~/.agents/skills</code>
                ) : projectRootPath && isProjectTarget ? (
                  <code>{projectRootPath}</code>
                ) : customDirectory ? (
                  <code>{customDirectory.path}</code>
                ) : null}
              </span>
            </div>
            {targetValue === 'project-directory' || targetValue === 'custom' ? (
              <Button
                onClick={() =>
                  void chooseDirectory(
                    targetValue === 'project-directory'
                      ? 'project-root'
                      : 'skill-parent'
                  )
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <FolderOpen />
                {t(
                  (
                    targetValue === 'project-directory'
                      ? projectDirectory
                      : customDirectory
                  )
                    ? 'desktop.managed.chooseAnotherFolder'
                    : 'desktop.managed.chooseFolder'
                )}
              </Button>
            ) : null}
          </div>
          {isProjectTarget ? (
            <label>
              <span>{t('desktop.install.chooseAgents')}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="managed-agent-trigger"
                    disabled={!agentRegistry}
                    variant="outline"
                  >
                    <FolderCheck />
                    <span>
                      <strong>{t('desktop.install.universal')}</strong>
                      <small>
                        {selectedAdditionalAgentIds.length
                          ? t('desktop.install.additionalSelected', {
                              count: selectedAdditionalAgentIds.length,
                            })
                          : t('desktop.install.universalAlwaysIncluded')}
                      </small>
                    </span>
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="agent-select-menu managed-agent-menu"
                  collisionPadding={12}
                  onEscapeKeyDown={preserveSearchOnEscape}
                >
                  <DropdownMenuLabel className="agent-select-label">
                    <span>{t('desktop.install.chooseAgents')}</span>
                  </DropdownMenuLabel>
                  <div className="agent-universal-target">
                    <div>
                      <span>
                        <FolderCheck />
                      </span>
                      <div>
                        <strong>{t('desktop.install.universal')}</strong>
                        <code>.agents/skills</code>
                      </div>
                      <small>
                        <Check />
                        {t('desktop.install.universalAlwaysIncluded')}
                      </small>
                    </div>
                    <p>
                      {t('desktop.install.universalDescription', {
                        count: agentGroups.universal.length,
                      })}
                    </p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="agent-additional-label">
                    <span>{t('desktop.install.additionalAgents')}</span>
                    <small>
                      {t('desktop.install.additionalAgentCount', {
                        count: agentGroups.additional.length,
                      })}
                    </small>
                  </DropdownMenuLabel>
                  <form
                    className="agent-select-search"
                    onKeyDown={(event) => event.stopPropagation()}
                    onSubmit={applyAgentSearch}
                  >
                    <SearchField
                      appliedValue={agentQuery}
                      clearLabel={t('desktop.install.clearAgentSearch')}
                      label={t('desktop.install.searchAgents')}
                      onChange={setAgentQueryDraft}
                      onClear={() => {
                        setAgentQuery('')
                        setAgentQueryDraft('')
                      }}
                      placeholder={t('desktop.install.searchAgents')}
                      value={agentQueryDraft}
                    />
                    <Button
                      size="icon-sm"
                      title={t('common.search')}
                      type="submit"
                    >
                      <Search />
                    </Button>
                  </form>
                  <div className="agent-select-options">
                    {visibleAgents.map((agent) => (
                      <DropdownMenuCheckboxItem
                        checked={selectedAdditionalAgentIds.includes(agent.id)}
                        key={agent.id}
                        onCheckedChange={() => toggleAgent(agent.id)}
                        onSelect={(event) => event.preventDefault()}
                      >
                        <span className="agent-select-option">
                          <strong>{agent.name}</strong>
                          <code>{agent.projectSkillDirectory}</code>
                        </span>
                      </DropdownMenuCheckboxItem>
                    ))}
                    {visibleAgents.length === 0 ? (
                      <p className="agent-select-empty">
                        {t('desktop.install.noMatchingAgents')}
                      </p>
                    ) : null}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
              {agentRegistryError ? (
                <small className="managed-deploy-error">
                  {agentRegistryError}
                </small>
              ) : null}
            </label>
          ) : null}
          {targetPreviews.length ? (
            <div className="managed-target-preview">
              <span>{t('desktop.managed.finalPaths')}</span>
              <div>
                {targetPreviews.map((preview) => (
                  <div key={preview.path}>
                    <b>{preview.label}</b>
                    <code>{preview.path}</code>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <label>
            <span>{t('desktop.managed.installMode')}</span>
            <Select
              onValueChange={(value) =>
                setMode(value as ManagedSkillInstallMode)
              }
              value={mode}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="copy">
                  {t('desktop.managed.modeCopy')}
                </SelectItem>
                <SelectItem value="symlink">
                  {t('desktop.managed.modeSymlink')}
                </SelectItem>
              </SelectContent>
            </Select>
          </label>
          <p>
            {t(
              mode === 'copy'
                ? 'desktop.managed.modeCopyDescription'
                : 'desktop.managed.modeSymlinkDescription'
            )}
          </p>
          <p>
            {t(
              isProjectTarget
                ? 'desktop.managed.projectRootDescription'
                : targetValue === 'custom'
                  ? 'desktop.managed.targetFolderDescription'
                  : 'desktop.managed.globalTargetDescription'
            )}
          </p>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button
            disabled={busy || !target || (isProjectTarget && !agentRegistry)}
            onClick={() => target && onDeploy(target, mode)}
          >
            {busy ? <LoaderCircle className="animate-spin" /> : <Rocket />}
            {t('desktop.managed.deploy')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function trimTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/, '')
}

function readManagedInspectorWidth(): number {
  const saved = Number(window.localStorage.getItem(MANAGED_INSPECTOR_WIDTH_KEY))
  return Number.isFinite(saved) && saved > 0
    ? saved
    : DEFAULT_SKILL_DRAWER_WIDTH
}

function getManagedInspectorBounds(container: HTMLElement | null) {
  const available = Math.max(
    320,
    (container?.clientWidth ?? window.innerWidth) - 20
  )
  const max = Math.min(MAX_SKILL_DRAWER_WIDTH, available)
  return { max, min: Math.min(MIN_SKILL_DRAWER_WIDTH, max) }
}

function clampManagedInspectorWidth(
  width: number,
  container: HTMLElement | null
): number {
  const bounds = getManagedInspectorBounds(container)
  return Math.min(bounds.max, Math.max(bounds.min, width))
}

function getManagedTargetKindLabel(
  deployment: ManagedSkillDeployment,
  t: ReturnType<typeof useI18n>['t']
): string {
  if (deployment.targetKind === 'global') {
    return t('desktop.managed.targetKind.global')
  }
  if (
    deployment.targetKind === 'project' ||
    deployment.targetKind === 'project-directory'
  ) {
    return t('desktop.managed.targetKind.project')
  }
  return t('desktop.managed.targetKind.custom')
}
