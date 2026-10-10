import { FinderFolderDialog } from './finder-folder-dialog'
import { FinderToolbar } from './finder-toolbar'
import {
  FinderCanvas,
  FinderListView,
  SkillRow,
  SkillUpdateGlyph,
  getDefaultCanvasPosition,
  getFolderBreadcrumbs,
  getSkillUpdateStatusLabel,
} from './finder-views'

import { SearchField, preserveSearchOnEscape } from './search-field'
import { AboutAppCard } from './about-app-card'
import { AgentCoverageCard } from './agent-coverage-card'
import { WorkbenchOverview, WorkbenchFileChecks } from './workbench-overview'
import {
  DiscoverySkeleton,
  FileBrowserSkeleton,
  PacksWorkspaceSkeleton,
  SkillsSkeleton,
  WorkbenchSkeleton,
} from './loading-skeletons'
import { SyncSettings } from './sync-settings'
import { ProjectInstructionsButton } from './project-instructions'
import { WorkspaceBoundary } from './workspace-boundary'
import { hasAppUpdate, useAppUpdate } from './app-update-context'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Bot,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleArrowUp,
  CircleCheck,
  CircleQuestionMark,
  Columns3,
  Compass,
  Eye,
  Folder,
  FolderCode,
  FolderInput,
  FolderPlus,
  FolderOpen,
  Gauge,
  Globe2,
  HardDrive,
  Info,
  Grid2X2,
  Keyboard,
  Library,
  List as ListIcon,
  Link2,
  LoaderCircle,
  ListTodo,
  MousePointerClick,
  PackagePlus,
  Palette,
  PanelBottom,
  PanelLeft,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import {
  Badge,
  Brand,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Kbd,
  KbdGroup,
  NavItem,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ThemeProvider,
  ThemeToggle,
  Toaster,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
  toast,
  type NavItemProps,
} from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'

import { isLikelyIncompleteTranslation } from '../../shared/translation-completeness'
import type {
  AiProviderId,
  AiModelRoleSettings,
  AiModelSelection,
  AiProviderModelInput,
  AiProviderModelStatus,
  AiProviderSettingsStatus,
  CanvasPosition,
  CatalogSnapshot,
  DesktopRuntimeInfo,
  DesktopSettings,
  DesktopView,
  TrayAction,
  FinderSortDirection,
  FinderSortKey,
  FinderViewOptions,
  InstalledSkill,
  LibraryViewMode,
  SkillUpdateCheck,
  SkillUpdateStatus,
  ShelfGroup,
  ShelfScopeKey,
  UpdateDesktopSettingsInput,
  WorkbenchSnapshot,
} from '../../shared/desktop-contract'
import {
  DEFAULT_SKILL_DRAWER_WIDTH,
  DEFAULT_TERMINAL_PANEL_HEIGHT,
  DEFAULT_UTILITY_PANEL_WIDTH,
  MAX_SKILL_DRAWER_WIDTH,
  MIN_SKILL_DRAWER_WIDTH,
  aiProviderRegistry,
  defaultAiModelRoleSettings,
} from '../../shared/desktop-contract'
import { getLocalizedErrorMessage } from './localized-error'

import { useLibraryScopeResize } from './use-library-scope-resize'
import { AI_LANGUAGE_OPTIONS } from './ai-language-options'
import { isDescriptionClearlyInTargetLanguage } from './description-language'
import {
  getFinderCanvasGridPosition,
  getNearestAvailableFinderGridPosition,
  initialFinderNavigation,
  reduceFinderNavigation,
  sortFinderItems,
  sortFinderItemsByCanvasPosition,
} from './finder-interactions'
import {
  createLatestAsyncQueue,
  type LatestAsyncQueue,
} from './latest-async-queue'
import {
  getSkillDescription,
  getStoredSkillTranslation,
} from './skill-description'
import SkillDescriptionPanel from './skill-description-panel'
import {
  getUpdateScanState,
  isSkillUpdateCheckFresh,
} from './skill-update-policy'
import TaskQueuePanel from './task-queue-panel'
import {
  clampTerminalPanelHeight,
  getTerminalPanelHeightBounds,
} from './terminal-panel-layout'
import {
  isTaskQueueTaskActive,
  updateTaskQueueItem,
  updateTaskQueueTask,
  type TaskQueueTask,
} from './task-queue'
import {
  clampUtilityPanelWidth,
  getUtilityPanelWidthBounds,
  toggleUtilityPanel,
  type UtilityPanelMode,
} from './utility-panel'

const AGENT_OPTIONS = [
  { id: '*', label: '' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'gemini-cli', label: 'Gemini CLI' },
  { id: 'opencode', label: 'OpenCode' },
]

const SKILL_DRAG_MIME = 'application/x-skill-shelf-skill'
const LIBRARY_SCOPE_COLLAPSED_STORAGE_KEY =
  'skill-shelf:library-scope-collapsed'

const SKILL_DRAWER_WORKSPACE_CLEARANCE = 20
const SKILL_DRAWER_KEYBOARD_STEP = 24
const UTILITY_PANEL_KEYBOARD_STEP = 24
const TERMINAL_PANEL_KEYBOARD_STEP = 24

function getSkillDrawerWidthBounds(containerWidth = window.innerWidth) {
  const availableWidth = Math.max(
    0,
    containerWidth - SKILL_DRAWER_WORKSPACE_CLEARANCE
  )
  const max = Math.min(MAX_SKILL_DRAWER_WIDTH, availableWidth)
  return {
    min: Math.min(MIN_SKILL_DRAWER_WIDTH, max),
    max,
  }
}

function clampSkillDrawerWidth(
  width: number,
  containerWidth = window.innerWidth
) {
  const bounds = getSkillDrawerWidthBounds(containerWidth)
  const safeWidth = Number.isFinite(width) ? width : DEFAULT_SKILL_DRAWER_WIDTH
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, safeWidth)))
}

function getSkillDrawerContainerWidth(container: HTMLElement | null) {
  const width = container?.clientWidth ?? 0
  return width > 0 ? width : window.innerWidth
}

type ProductView = DesktopView
type LibraryFilter = 'scope:global' | `project:${string}`
type LibraryFolderFilter = 'folder:all' | 'folder:unfiled' | `folder:${string}`
type SkillUpdateFilter = SkillUpdateStatus
type Translate = ReturnType<typeof useI18n>['t']
type TaskQueueJob =
  | { kind: 'scan-updates'; notify: boolean; taskId: string }
  | {
      kind: 'translate-descriptions'
      force?: boolean
      language: string
      skillIds: string[]
      taskId: string
    }
type SettingsSection =
  | 'about'
  | 'ai-behavior'
  | 'ai-models'
  | 'ai-provider'
  | 'appearance'
  | 'general'
  | 'shortcuts'
  | 'skills-cli'
  | 'sync'

const AiSkillPanel = lazy(() => import('./ai-skill-panel'))
const DiscoverWorkspace = lazy(() => import('./discover-workspace'))
const ManagedSkillsWorkspace = lazy(() => import('./managed-skills-workspace'))
const SkillFilesPanel = lazy(() => import('./skill-files-panel'))
const TerminalPanel = lazy(() => import('./terminal-panel'))

export function App() {
  const { locale, setLocalePreference, setSystemLocale, t } = useI18n()
  const tRef = useRef(t)
  tRef.current = t
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null)
  const catalogSnapshotRef = useRef<CatalogSnapshot | null>(null)
  const [runtime, setRuntime] = useState<DesktopRuntimeInfo | null>(null)
  const [settings, setSettings] = useState<DesktopSettings | null>(null)
  const settingsRef = useRef<DesktopSettings | null>(null)
  settingsRef.current = settings
  const settingsUpdateQueueRef = useRef<LatestAsyncQueue<
    UpdateDesktopSettingsInput,
    DesktopSettings
  > | null>(null)
  if (!settingsUpdateQueueRef.current) {
    settingsUpdateQueueRef.current = createLatestAsyncQueue((input) =>
      window.skillShelf.updateSettings(input)
    )
  }
  const [workbenchSnapshot, setWorkbenchSnapshot] =
    useState<WorkbenchSnapshot | null>(null)
  const [aiSettings, setAiSettings] = useState<AiProviderSettingsStatus | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ProductView>('workbench')
  const settingsReturnViewRef =
    useRef<Exclude<ProductView, 'settings'>>('workbench')
  const [filter, setFilter] = useState<LibraryFilter>('scope:global')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [aiPanelLoaded, setAiPanelLoaded] = useState(false)
  const [utilityPanel, setUtilityPanel] = useState<UtilityPanelMode>(null)
  const [utilityPanelWidth, setUtilityPanelWidth] = useState(
    DEFAULT_UTILITY_PANEL_WIDTH
  )
  const [terminalPanelHeight, setTerminalPanelHeight] = useState(
    DEFAULT_TERMINAL_PANEL_HEIGHT
  )
  const [terminalPanelLoaded, setTerminalPanelLoaded] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const aiPanelOpen = utilityPanel === 'ai'
  const taskQueueOpen = utilityPanel === 'queue'
  const [taskQueueTasks, setTaskQueueTasks] = useState<TaskQueueTask[]>([])
  const taskQueueTasksRef = useRef<TaskQueueTask[]>([])
  const taskQueueJobsRef = useRef<TaskQueueJob[]>([])
  const taskQueueRunningRef = useRef(false)
  const [aiContextSkillId, setAiContextSkillId] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const workspaceSidebarCollapsed = view !== 'settings' && sidebarCollapsed
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [bulkUpdateProgress, setBulkUpdateProgress] = useState<{
    completed: number
    total: number
  } | null>(null)
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>('general')
  const desktopBodyRef = useRef<HTMLDivElement | null>(null)
  const desktopShellRef = useRef<HTMLDivElement | null>(null)
  const desktopMainRef = useRef<HTMLElement | null>(null)
  const terminalPanelRef = useRef<HTMLDivElement | null>(null)
  const terminalResizeCleanupRef = useRef<(() => void) | null>(null)
  const utilityPanelRef = useRef<HTMLElement | null>(null)
  const utilityResizeCleanupRef = useRef<(() => void) | null>(null)

  const applyCatalog = useCallback((next: CatalogSnapshot) => {
    catalogSnapshotRef.current = next
    setCatalog(next)
    setSelectedId((current) =>
      current && next.skills.some((skill) => skill.id === current)
        ? current
        : null
    )
  }, [])

  const loadCatalog = useCallback(async () => {
    setError(null)
    try {
      applyCatalog(await window.skillShelf.getCatalog())
    } catch (caught) {
      setError(getLocalizedErrorMessage(caught, tRef.current))
    }
  }, [applyCatalog])

  function replaceTaskQueueTask(
    taskId: string,
    update: (task: TaskQueueTask) => TaskQueueTask
  ) {
    setTaskQueueTasks((current) => {
      const next = updateTaskQueueTask(current, taskId, update)
      taskQueueTasksRef.current = next
      return next
    })
  }

  function updateQueueItem(
    taskId: string,
    itemId: string,
    update: Parameters<typeof updateTaskQueueItem>[2]
  ) {
    replaceTaskQueueTask(taskId, (task) =>
      updateTaskQueueItem(task, itemId, update)
    )
  }

  function enqueueTask(task: TaskQueueTask, job: TaskQueueJob) {
    taskQueueTasksRef.current = [task, ...taskQueueTasksRef.current]
    setTaskQueueTasks(taskQueueTasksRef.current)
    taskQueueJobsRef.current.push(job)
    setUtilityPanel('queue')
    toast.success(tRef.current('desktop.queue.added'))
    void drainTaskQueue()
  }

  async function drainTaskQueue() {
    if (taskQueueRunningRef.current) return
    taskQueueRunningRef.current = true
    try {
      let job = taskQueueJobsRef.current.shift()
      while (job) {
        replaceTaskQueueTask(job.taskId, (task) => ({
          ...task,
          status: 'running',
        }))
        if (job.kind === 'scan-updates') await runUpdateScanJob(job)
        else await runTranslationJob(job)
        job = taskQueueJobsRef.current.shift()
      }
    } finally {
      taskQueueRunningRef.current = false
    }
  }

  async function runUpdateScanJob(
    job: Extract<TaskQueueJob, { kind: 'scan-updates' }>
  ) {
    let failed = 0
    const unsubscribe = window.skillShelf.onSkillUpdateScanProgress(
      (progress) => {
        if (progress.requestId !== job.taskId) return
        const itemFailed = progress.check.reason === 'network-error'
        if (itemFailed) failed += 1
        updateQueueItem(job.taskId, progress.skillId, (item) => ({
          ...item,
          detail: getUpdateScanQueueDetail(progress.check, tRef.current),
          status: itemFailed ? 'failed' : 'completed',
        }))
      }
    )
    try {
      const nextCatalog = await window.skillShelf.scanSkillUpdates(job.taskId)
      applyCatalog(nextCatalog)
      replaceTaskQueueTask(job.taskId, (task) => ({
        ...task,
        finishedAt: new Date().toISOString(),
        status: failed > 0 ? 'partial' : 'completed',
      }))
      if (job.notify) showUpdateScanToast(nextCatalog, tRef.current)
    } catch (caught) {
      const message = getLocalizedErrorMessage(caught, tRef.current)
      replaceTaskQueueTask(job.taskId, (task) => ({
        ...task,
        finishedAt: new Date().toISOString(),
        items: task.items.map((item) =>
          item.status === 'queued' || item.status === 'running'
            ? { ...item, detail: message, status: 'failed' }
            : item
        ),
        status: 'failed',
      }))
      toast.error(message)
    } finally {
      unsubscribe()
    }
  }

  async function runTranslationJob(
    job: Extract<TaskQueueJob, { kind: 'translate-descriptions' }>
  ) {
    let copied = 0
    let failed = 0
    let skipped = 0
    let translated = 0
    for (const skillId of job.skillIds) {
      const skill = catalogSnapshotRef.current?.skills.find(
        (candidate) => candidate.id === skillId
      )
      const sourceDescription = skill?.description.trim() ?? ''
      if (!skill || !sourceDescription) {
        skipped += 1
        updateQueueItem(job.taskId, skillId, (item) => ({
          ...item,
          detail: tRef.current('desktop.queue.translation.noDescription'),
          status: 'skipped',
        }))
        continue
      }
      const stored = getStoredSkillTranslation(skill, job.language)
      if (
        !job.force &&
        stored?.sourceDescription === sourceDescription &&
        !isLikelyIncompleteTranslation(sourceDescription, stored.content)
      ) {
        skipped += 1
        updateQueueItem(job.taskId, skillId, (item) => ({
          ...item,
          detail: tRef.current('desktop.queue.translation.cached'),
          status: 'skipped',
        }))
        continue
      }

      updateQueueItem(job.taskId, skillId, (item) => ({
        ...item,
        status: 'running',
      }))
      try {
        if (
          isDescriptionClearlyInTargetLanguage(sourceDescription, job.language)
        ) {
          const nextCatalog = await window.skillShelf.saveSkillTranslation({
            content: sourceDescription,
            language: job.language,
            method: 'source-copy',
            skillId,
            sourceDescription,
          })
          applyCatalog(nextCatalog)
          copied += 1
          updateQueueItem(job.taskId, skillId, (item) => ({
            ...item,
            detail: tRef.current('desktop.queue.translation.sourceCopied'),
            status: 'completed',
          }))
          continue
        }

        const result = await window.skillShelf.runAiSkillAction({
          action: 'translate',
          language: job.language,
          skillId,
          sourceText: sourceDescription,
        })
        const nextCatalog = await window.skillShelf.saveSkillTranslation({
          content: result.content,
          language: job.language,
          method:
            result.content.trim() === sourceDescription ? 'source-copy' : 'ai',
          skillId,
          sourceDescription,
        })
        applyCatalog(nextCatalog)
        const sourceWasKept = result.content.trim() === sourceDescription
        if (sourceWasKept) copied += 1
        else translated += 1
        updateQueueItem(job.taskId, skillId, (item) => ({
          ...item,
          detail: tRef.current(
            sourceWasKept
              ? 'desktop.queue.translation.sourceCopied'
              : 'desktop.queue.translation.saved'
          ),
          status: 'completed',
        }))
      } catch (caught) {
        failed += 1
        updateQueueItem(job.taskId, skillId, (item) => ({
          ...item,
          detail: getLocalizedErrorMessage(caught, tRef.current),
          status: 'failed',
        }))
      }
    }

    replaceTaskQueueTask(job.taskId, (task) => ({
      ...task,
      finishedAt: new Date().toISOString(),
      status:
        failed > 0
          ? translated > 0 || copied > 0 || skipped > 0
            ? 'partial'
            : 'failed'
          : 'completed',
    }))
    const message = tRef.current('desktop.queue.translationSummary', {
      copied,
      failed,
      skipped,
      translated,
    })
    if (failed > 0) toast.warning(message)
    else toast.success(message)
  }

  function scanSkillUpdates(notify = true) {
    const existing = taskQueueTasksRef.current.find(
      (task) => task.kind === 'scan-updates' && isTaskQueueTaskActive(task)
    )
    if (existing) {
      setUtilityPanel('queue')
      return
    }
    const currentCatalog = catalogSnapshotRef.current
    if (!currentCatalog) return
    const taskId = crypto.randomUUID()
    const task: TaskQueueTask = {
      createdAt: new Date().toISOString(),
      id: taskId,
      items: currentCatalog.skills.map((skill) => ({
        id: skill.id,
        label: skill.name,
        status: 'queued',
      })),
      kind: 'scan-updates',
      status: 'queued',
      title: tRef.current('desktop.queue.scanTitle'),
    }
    enqueueTask(task, { kind: 'scan-updates', notify, taskId })
  }

  function translateSkills(
    skillIds: string[],
    language?: string,
    force = false
  ) {
    const uniqueSkillIds = [...new Set(skillIds)].filter((skillId) =>
      catalogSnapshotRef.current?.skills.some((skill) => skill.id === skillId)
    )
    if (uniqueSkillIds.length === 0) return false
    const targetLanguage = language ?? aiSettings?.targetLanguage ?? locale
    const requiresAi = uniqueSkillIds.some((skillId) => {
      const sourceDescription =
        catalogSnapshotRef.current?.skills
          .find((skill) => skill.id === skillId)
          ?.description.trim() ?? ''
      return (
        Boolean(sourceDescription) &&
        !isDescriptionClearlyInTargetLanguage(sourceDescription, targetLanguage)
      )
    })
    if (requiresAi && (!aiSettings?.configured || !aiSettings.enabled)) {
      toast.error(tRef.current('desktop.inspector.translationSetup'))
      openAiSettings()
      return false
    }
    const languageOption = AI_LANGUAGE_OPTIONS.find(
      (option) => option.id === targetLanguage
    )
    const languageName = languageOption
      ? tRef.current(languageOption.key)
      : targetLanguage
    const taskId = crypto.randomUUID()
    const task: TaskQueueTask = {
      createdAt: new Date().toISOString(),
      id: taskId,
      items: uniqueSkillIds.map((skillId) => ({
        id: skillId,
        label:
          catalogSnapshotRef.current?.skills.find(
            (skill) => skill.id === skillId
          )?.name ?? skillId,
        status: 'queued',
      })),
      kind: 'translate-descriptions',
      status: 'queued',
      title: tRef.current('desktop.queue.translationTitle', {
        language: languageName,
      }),
    }
    enqueueTask(task, {
      kind: 'translate-descriptions',
      force,
      language: targetLanguage,
      skillIds: uniqueSkillIds,
      taskId,
    })
    return true
  }

  async function importSkillsToPacks(skillIds: string[]) {
    const uniqueSkillIds = [...new Set(skillIds)].filter((skillId) =>
      catalogSnapshotRef.current?.skills.some((skill) => skill.id === skillId)
    )
    if (uniqueSkillIds.length === 0) return
    try {
      const managed = await window.skillShelf.getManagedSkills()
      const importedSourceIds = new Set(
        managed.skills.map((skill) => skill.sourceSkillId)
      )
      const pendingSkillIds = uniqueSkillIds.filter(
        (skillId) => !importedSourceIds.has(skillId)
      )
      if (pendingSkillIds.length === 0) {
        toast.success(tRef.current('desktop.managed.alreadyImported'))
        return
      }
      await window.skillShelf.importManagedSkills(pendingSkillIds)
      toast.success(
        tRef.current('desktop.managed.imported', {
          count: pendingSkillIds.length,
        })
      )
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, tRef.current))
    }
  }

  useEffect(() => {
    let active = true
    void Promise.all([
      window.skillShelf.getCatalog(),
      window.skillShelf.getRuntimeInfo(),
      window.skillShelf.getSettings(),
      window.skillShelf.getAiProviderSettings(),
    ])
      .then(([nextCatalog, nextRuntime, nextSettings, nextAiSettings]) => {
        if (!active) return
        applyCatalog(nextCatalog)
        setRuntime(nextRuntime)
        settingsRef.current = nextSettings
        setSettings(nextSettings)
        setAiSettings(nextAiSettings)
        setSidebarCollapsed(nextSettings.sidebarCollapsed)
        setSystemLocale(nextRuntime.systemLocale)
        setLocalePreference(nextSettings.language)
      })
      .catch((caught) => {
        if (active) setError(getLocalizedErrorMessage(caught, tRef.current))
      })
    return () => {
      active = false
    }
  }, [applyCatalog, setLocalePreference, setSystemLocale])

  useEffect(() => {
    if (!utilityPanel) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setUtilityPanel(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [utilityPanel])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.shiftKey || event.key.toLowerCase() !== 'j') {
        return
      }
      const primaryModifierPressed =
        runtime?.platform === 'darwin' ? event.metaKey : event.ctrlKey
      if (!primaryModifierPressed) return
      event.preventDefault()
      setTerminalPanelLoaded(true)
      setTerminalOpen((current) => !current)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [runtime?.platform])

  useEffect(() => {
    const syncWidth = () => {
      setUtilityPanelWidth(
        clampUtilityPanelWidth(
          settings?.utilityPanelWidth ?? DEFAULT_UTILITY_PANEL_WIDTH,
          desktopBodyRef.current?.clientWidth ?? window.innerWidth,
          workspaceSidebarCollapsed
        )
      )
    }

    syncWidth()
    const container = desktopBodyRef.current
    if (!container || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncWidth)
      return () => window.removeEventListener('resize', syncWidth)
    }

    const observer = new ResizeObserver(syncWidth)
    observer.observe(container)
    return () => observer.disconnect()
  }, [settings?.utilityPanelWidth, workspaceSidebarCollapsed])

  useEffect(() => {
    const syncHeight = () => {
      setTerminalPanelHeight(
        clampTerminalPanelHeight(
          settings?.terminalPanelHeight ?? DEFAULT_TERMINAL_PANEL_HEIGHT,
          window.innerHeight
        )
      )
    }
    syncHeight()
    window.addEventListener('resize', syncHeight)
    return () => window.removeEventListener('resize', syncHeight)
  }, [settings?.terminalPanelHeight])

  useEffect(
    () => () => {
      utilityResizeCleanupRef.current?.()
      terminalResizeCleanupRef.current?.()
    },
    []
  )

  useEffect(() => {
    document.documentElement.dataset.density =
      settings?.density ?? 'comfortable'
  }, [settings?.density])

  function applySettingsSnapshot(next: DesktopSettings) {
    settingsRef.current = next
    setSettings(next)
  }

  function updateSettings(input: UpdateDesktopSettingsInput) {
    const current = settingsRef.current
    if (current) {
      const optimistic = { ...current, ...input }
      applySettingsSnapshot(optimistic)
      if (input.language) setLocalePreference(optimistic.language)
    }

    const job = settingsUpdateQueueRef.current!.enqueue(input)
    void job.result.then(
      (next) => {
        if (!job.isLatest()) return
        applySettingsSnapshot(next)
        if (input.language) setLocalePreference(next.language)
      },
      async (caught) => {
        toast.error(getLocalizedErrorMessage(caught, t))
        if (!job.isLatest()) return
        try {
          const next = await window.skillShelf.getSettings()
          if (!job.isLatest()) return
          applySettingsSnapshot(next)
          setLocalePreference(next.language)
        } catch (reloadError) {
          toast.error(getLocalizedErrorMessage(reloadError, t))
        }
      }
    )
  }

  async function runSkillAction(action: 'remove' | 'update', skillId: string) {
    if (busyAction) return
    let currentCatalog = catalog
    let skill = currentCatalog?.skills.find((item) => item.id === skillId)
    const skillName = skill?.name ?? skillId
    setBusyAction(
      action === 'update' &&
        (!skill || !isSkillUpdateCheckFresh(skill.updateCheck))
        ? 'refresh'
        : `${action}:${skillId}`
    )
    try {
      if (
        action === 'update' &&
        (!skill || !isSkillUpdateCheckFresh(skill.updateCheck))
      ) {
        currentCatalog = await window.skillShelf.scanSkillUpdates()
        applyCatalog(currentCatalog)
        skill = currentCatalog.skills.find((item) => item.id === skillId)
      }
      if (
        action === 'update' &&
        skill?.updateCheck.status !== 'update-available'
      ) {
        toast.success(
          t('desktop.operations.noUpdateAvailable', { name: skillName })
        )
        return
      }
      if (action === 'update') setBusyAction(`update:${skillId}`)
      const result =
        action === 'remove'
          ? await window.skillShelf.removeSkill(skillId)
          : await window.skillShelf.updateSkill(skillId)
      if (!result.success) {
        toast.error(getLocalizedErrorMessage(result.message, t))
        return
      }
      toast.success(
        action === 'remove'
          ? t('desktop.operations.removed', { name: skillName })
          : t('desktop.operations.updated', { name: skillName })
      )
      await loadCatalog()
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setBusyAction(null)
    }
  }

  async function updateAvailableSkills() {
    if (!catalog || busyAction) return
    setBusyAction('update-all')
    setBulkUpdateProgress({ completed: 0, total: 0 })
    try {
      const updates = getLibraryScopeSkills(catalog.skills, filter).filter(
        (skill) => skill.updateCheck.status === 'update-available'
      )
      if (updates.length === 0) {
        toast.success(t('desktop.operations.noUpdatesAvailable'))
        return
      }

      let completed = 0
      let failed = 0
      setBulkUpdateProgress({ completed, total: updates.length })
      for (const skill of updates) {
        try {
          const result = await window.skillShelf.updateSkill(skill.id)
          if (!result.success) failed += 1
        } catch {
          failed += 1
        }
        completed += 1
        setBulkUpdateProgress({ completed, total: updates.length })
      }

      await loadCatalog()
      const updated = updates.length - failed
      if (failed > 0) {
        toast.error(
          t('desktop.operations.bulkUpdatePartial', { failed, updated })
        )
      } else {
        toast.success(t('desktop.operations.bulkUpdated', { count: updated }))
      }
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setBulkUpdateProgress(null)
      setBusyAction(null)
    }
  }

  function navigateToView(nextView: ProductView) {
    if (nextView === 'settings') {
      if (view !== 'settings') settingsReturnViewRef.current = view
      setUtilityPanel(null)
    }
    if (nextView === 'library') setFilter('scope:global')
    setView(nextView)
  }

  const trayActionHandlerRef = useRef<(action: TrayAction) => void>(() => {})
  trayActionHandlerRef.current = (action) => {
    if (action === 'scan-updates') {
      navigateToView('library')
      void scanSkillUpdates()
    } else navigateToView(action)
  }
  const trayActionsReady = Boolean(catalog && settings)
  useEffect(() => {
    const unsubscribe = window.skillShelf.onTrayAction((action) =>
      trayActionHandlerRef.current(action)
    )
    if (trayActionsReady)
      void window.skillShelf.readyForTrayActions().catch(() => {})
    return unsubscribe
  }, [trayActionsReady])

  useEffect(
    () =>
      window.skillShelf.onWorkbenchChanged((result) => {
        applyCatalog(result.catalog)
        setWorkbenchSnapshot(result.snapshot)
      }),
    [applyCatalog]
  )

  function returnFromSettings() {
    setUtilityPanel(null)
    setView(settingsReturnViewRef.current)
  }

  const selectedSkill =
    catalog?.skills.find((skill) => skill.id === selectedId) ?? null
  const aiContextSkill =
    catalog?.skills.find((skill) => skill.id === aiContextSkillId) ?? null

  function toggleAiPanel() {
    if (!aiPanelOpen) {
      setAiPanelLoaded(true)
      if (selectedId) setAiContextSkillId(selectedId)
    }
    setUtilityPanel((current) => toggleUtilityPanel(current, 'ai'))
  }

  function openAiSettings() {
    setSettingsSection('ai-provider')
    navigateToView('settings')
  }

  function toggleSidebar() {
    const nextCollapsed = !sidebarCollapsed
    setSidebarCollapsed(nextCollapsed)
    void updateSettings({ sidebarCollapsed: nextCollapsed })
  }

  function toggleTerminalPanel() {
    setTerminalPanelLoaded(true)
    setTerminalOpen((current) => !current)
  }

  function commitTerminalPanelHeight(height: number) {
    const nextHeight = clampTerminalPanelHeight(height, window.innerHeight)
    setTerminalPanelHeight(nextHeight)
    void updateSettings({ terminalPanelHeight: nextHeight })
  }

  function handleTerminalResizePointerDown(
    event: ReactPointerEvent<HTMLDivElement>
  ) {
    if (event.button !== 0) return
    const shell = desktopShellRef.current
    const panel = terminalPanelRef.current
    if (!shell || !panel) return

    event.preventDefault()
    terminalResizeCleanupRef.current?.()
    const startY = event.clientY
    const startHeight = panel.getBoundingClientRect().height
    let latestHeight = startHeight
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    shell.dataset.terminalResizing = 'true'
    panel.dataset.resizing = 'true'
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'

    const move = (pointerEvent: PointerEvent) => {
      latestHeight = clampTerminalPanelHeight(
        startHeight + startY - pointerEvent.clientY,
        window.innerHeight
      )
      shell.style.setProperty('--terminal-panel-height', `${latestHeight}px`)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      delete shell.dataset.terminalResizing
      delete panel.dataset.resizing
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      terminalResizeCleanupRef.current = null
    }
    const finish = () => {
      cleanup()
      commitTerminalPanelHeight(latestHeight)
    }

    terminalResizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('pointercancel', finish, { once: true })
  }

  function handleTerminalResizeKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>
  ) {
    const bounds = getTerminalPanelHeightBounds(window.innerHeight)
    let nextHeight: number | null = null
    if (event.key === 'ArrowUp') {
      nextHeight = terminalPanelHeight + TERMINAL_PANEL_KEYBOARD_STEP
    } else if (event.key === 'ArrowDown') {
      nextHeight = terminalPanelHeight - TERMINAL_PANEL_KEYBOARD_STEP
    } else if (event.key === 'Home') {
      nextHeight = bounds.min
    } else if (event.key === 'End') {
      nextHeight = bounds.max
    }
    if (nextHeight === null) return
    event.preventDefault()
    commitTerminalPanelHeight(nextHeight)
  }

  function commitUtilityPanelWidth(width: number) {
    const nextWidth = clampUtilityPanelWidth(
      width,
      desktopBodyRef.current?.clientWidth ?? window.innerWidth,
      workspaceSidebarCollapsed
    )
    setUtilityPanelWidth(nextWidth)
    void updateSettings({ utilityPanelWidth: nextWidth })
  }

  function handleUtilityResizePointerDown(
    event: ReactPointerEvent<HTMLDivElement>
  ) {
    if (event.button !== 0) return
    const body = desktopBodyRef.current
    const panel = utilityPanelRef.current
    if (!body || !panel) return

    event.preventDefault()
    utilityResizeCleanupRef.current?.()
    const startX = event.clientX
    const startWidth = panel.getBoundingClientRect().width
    let latestWidth = startWidth
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    panel.dataset.resizing = 'true'
    body.dataset.utilityResizing = 'true'
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    const move = (pointerEvent: PointerEvent) => {
      latestWidth = clampUtilityPanelWidth(
        startWidth + startX - pointerEvent.clientX,
        body.clientWidth,
        workspaceSidebarCollapsed
      )
      body.style.setProperty('--utility-panel-width', `${latestWidth}px`)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      delete panel.dataset.resizing
      delete body.dataset.utilityResizing
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      utilityResizeCleanupRef.current = null
    }
    const finish = () => {
      cleanup()
      commitUtilityPanelWidth(latestWidth)
    }

    utilityResizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('pointercancel', finish, { once: true })
  }

  function handleUtilityResizeKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>
  ) {
    const bounds = getUtilityPanelWidthBounds(
      desktopBodyRef.current?.clientWidth ?? window.innerWidth,
      workspaceSidebarCollapsed
    )
    let nextWidth: number | null = null
    if (event.key === 'ArrowLeft') {
      nextWidth = utilityPanelWidth + UTILITY_PANEL_KEYBOARD_STEP
    } else if (event.key === 'ArrowRight') {
      nextWidth = utilityPanelWidth - UTILITY_PANEL_KEYBOARD_STEP
    } else if (event.key === 'Home') {
      nextWidth = bounds.min
    } else if (event.key === 'End') {
      nextWidth = bounds.max
    }
    if (nextWidth === null) return
    event.preventDefault()
    commitUtilityPanelWidth(nextWidth)
  }

  function changeFinderViewOptions(
    locationKey: string,
    options: FinderViewOptions
  ) {
    const finderViewOptions = {
      ...(settingsRef.current?.finderViewOptions ?? {}),
      [locationKey]: options,
    }
    void updateSettings({ finderViewOptions })
  }

  const activeTaskCount = taskQueueTasks.filter(isTaskQueueTaskActive).length
  const updateScanRunning = taskQueueTasks.some(
    (task) => task.kind === 'scan-updates' && task.status === 'running'
  )
  const translatingSkillIds = new Set(
    taskQueueTasks
      .filter(
        (task) =>
          task.kind === 'translate-descriptions' && isTaskQueueTaskActive(task)
      )
      .flatMap((task) =>
        task.items
          .filter(
            (item) => item.status === 'queued' || item.status === 'running'
          )
          .map((item) => item.id)
      )
  )
  const utilityPanelBounds = getUtilityPanelWidthBounds(
    desktopBodyRef.current?.clientWidth ?? window.innerWidth,
    workspaceSidebarCollapsed
  )
  const terminalPanelBounds = getTerminalPanelHeightBounds(window.innerHeight)
  const terminalProjectId =
    view === 'library' && filter.startsWith('project:')
      ? filter.slice('project:'.length)
      : undefined

  return (
    <ThemeProvider
      onThemeChange={(theme) => void updateSettings({ theme })}
      theme={settings?.theme ?? 'system'}
    >
      <TooltipProvider delayDuration={250}>
        <div
          className="desktop-shell"
          data-terminal-open={terminalOpen}
          ref={desktopShellRef}
          style={
            {
              '--terminal-panel-height': `${terminalPanelHeight}px`,
            } as CSSProperties
          }
        >
          <StatusBar
            activeTaskCount={activeTaskCount}
            aiOpen={aiPanelOpen}
            busy={Boolean(busyAction)}
            onAiToggle={toggleAiPanel}
            onRefresh={() => void scanSkillUpdates()}
            onTaskQueueToggle={() =>
              setUtilityPanel((current) => toggleUtilityPanel(current, 'queue'))
            }
            onSidebarToggle={toggleSidebar}
            onSettingsBack={returnFromSettings}
            onTerminalToggle={toggleTerminalPanel}
            refreshing={updateScanRunning}
            runtime={runtime}
            sidebarCollapsed={sidebarCollapsed}
            taskQueueOpen={taskQueueOpen}
            terminalOpen={terminalOpen}
            view={view}
          />
          <div
            className="desktop-body"
            data-ai-open={aiPanelOpen || taskQueueOpen}
            data-sidebar-collapsed={sidebarCollapsed}
            data-view={view}
            ref={desktopBodyRef}
            style={
              {
                '--utility-panel-width': `${utilityPanelWidth}px`,
              } as CSSProperties
            }
          >
            {view !== 'settings' ? (
              <PrimarySidebar
                catalog={catalog}
                collapsed={sidebarCollapsed}
                onViewChange={navigateToView}
                view={view}
              />
            ) : null}
            <main className="desktop-main" ref={desktopMainRef}>
              <WorkspaceBoundary
                key={view}
                loading={
                  view === 'managed' ? (
                    <PacksWorkspaceSkeleton />
                  ) : (
                    <DiscoverySkeleton section="home" />
                  )
                }
              >
                {view === 'library' ? (
                  <FinderLibraryWorkspace
                    aiSettings={aiSettings}
                    bulkUpdateProgress={bulkUpdateProgress}
                    busyAction={busyAction}
                    catalog={catalog}
                    drawerContainer={desktopMainRef.current}
                    drawerWidth={
                      settings?.skillDrawerWidth ?? DEFAULT_SKILL_DRAWER_WIDTH
                    }
                    error={error}
                    filter={filter}
                    finderViewOptions={settings?.finderViewOptions ?? {}}
                    focusedAgents={settings?.focusedAgents ?? []}
                    onAdd={() => setView('discover')}
                    onCatalogChange={applyCatalog}
                    onCloseSelection={() => setSelectedId(null)}
                    onFilterChange={setFilter}
                    onFinderViewOptionsChange={changeFinderViewOptions}
                    onImportSkills={importSkillsToPacks}
                    onOpenAiSettings={openAiSettings}
                    onDrawerWidthChange={(skillDrawerWidth) =>
                      void updateSettings({ skillDrawerWidth })
                    }
                    onRemove={(name) => void runSkillAction('remove', name)}
                    onRetry={() => void loadCatalog()}
                    onRefresh={() => void scanSkillUpdates()}
                    onSelect={(skillId) => {
                      setSelectedId(skillId)
                      if (aiPanelOpen) setAiContextSkillId(skillId)
                    }}
                    onUpdate={(name) => void runSkillAction('update', name)}
                    onUpdateAvailable={() => void updateAvailableSkills()}
                    onTranslateSkills={translateSkills}
                    selectedId={selectedId}
                    selectedSkill={selectedSkill}
                    refreshing={updateScanRunning}
                    translatingSkillIds={translatingSkillIds}
                    defaultViewMode={settings?.libraryViewMode ?? 'canvas'}
                  />
                ) : view === 'discover' ? (
                  <DiscoverWorkspace
                    catalog={catalog}
                    defaultAgents={settings?.defaultAgents ?? ['*']}
                    onInstalled={async () => {
                      toast.success(t('desktop.operations.installed'))
                      await loadCatalog()
                    }}
                  />
                ) : view === 'managed' ? (
                  <ManagedSkillsWorkspace
                    catalog={catalog}
                    onCatalogRefresh={loadCatalog}
                  />
                ) : view === 'workbench' ? (
                  <WorkbenchWorkspace
                    focusedAgents={settings?.focusedAgents ?? []}
                    onCatalogChange={applyCatalog}
                    onManageAgents={() => {
                      setSettingsSection('skills-cli')
                      navigateToView('settings')
                    }}
                    onSnapshotChange={setWorkbenchSnapshot}
                    snapshot={workbenchSnapshot}
                  />
                ) : (
                  <SettingsWorkspace
                    aiSettings={aiSettings}
                    catalog={catalog}
                    onAiSettingsChange={setAiSettings}
                    onSectionChange={setSettingsSection}
                    onSettingsChange={(input) => void updateSettings(input)}
                    onSyncApplied={({
                      catalog: nextCatalog,
                      settings: nextSettings,
                      aiSettings: nextAiSettings,
                    }) => {
                      applyCatalog(nextCatalog)
                      applySettingsSnapshot(nextSettings)
                      setLocalePreference(nextSettings.language)
                      setSidebarCollapsed(nextSettings.sidebarCollapsed)
                      if (nextAiSettings) setAiSettings(nextAiSettings)
                    }}
                    onWorkbenchSnapshotChange={setWorkbenchSnapshot}
                    runtime={runtime}
                    section={settingsSection}
                    settings={settings}
                    workbenchSnapshot={workbenchSnapshot}
                  />
                )}
              </WorkspaceBoundary>
            </main>
            <aside
              aria-hidden={!utilityPanel}
              className={cn('utility-panel', utilityPanel && 'is-open')}
              inert={!utilityPanel}
              ref={utilityPanelRef}
            >
              <div
                aria-label={t('desktop.utilityPanel.resize')}
                aria-orientation="vertical"
                aria-valuemax={utilityPanelBounds.max}
                aria-valuemin={utilityPanelBounds.min}
                aria-valuenow={utilityPanelWidth}
                className="skill-drawer-resize-handle utility-panel-resize-handle"
                onKeyDown={handleUtilityResizeKeyDown}
                onPointerDown={handleUtilityResizePointerDown}
                role="separator"
                tabIndex={0}
              >
                <span aria-hidden="true" />
              </div>
              <div
                aria-hidden={!aiPanelOpen}
                className={cn(
                  'utility-panel-view ai-skill-panel',
                  aiPanelOpen && 'is-open'
                )}
                inert={!aiPanelOpen}
              >
                {aiPanelLoaded ? (
                  <Suspense
                    fallback={
                      <div className="ai-panel-loading">
                        <LoaderCircle className="animate-spin" />
                        {t('common.loading')}
                      </div>
                    }
                  >
                    <AiSkillPanel
                      onCatalogChange={applyCatalog}
                      onClearSkillContext={() => setAiContextSkillId(null)}
                      onClose={() => setUtilityPanel(null)}
                      onOpenSettings={openAiSettings}
                      onRestoreSkillContext={setAiContextSkillId}
                      settings={aiSettings}
                      skill={aiContextSkill}
                    />
                  </Suspense>
                ) : null}
              </div>
              <div
                aria-hidden={!taskQueueOpen}
                className={cn(
                  'utility-panel-view task-queue-panel',
                  taskQueueOpen && 'is-open'
                )}
                inert={!taskQueueOpen}
              >
                <TaskQueuePanel
                  onClearCompleted={() => {
                    setTaskQueueTasks((current) => {
                      const next = current.filter(isTaskQueueTaskActive)
                      taskQueueTasksRef.current = next
                      return next
                    })
                  }}
                  onClose={() => setUtilityPanel(null)}
                  tasks={taskQueueTasks}
                />
              </div>
            </aside>
          </div>
          <div
            aria-hidden={!terminalOpen}
            className="terminal-panel-shell"
            id="desktop-terminal-panel"
            inert={!terminalOpen}
            ref={terminalPanelRef}
          >
            <div
              aria-label={t('desktop.terminal.resize')}
              aria-orientation="horizontal"
              aria-valuemax={terminalPanelBounds.max}
              aria-valuemin={terminalPanelBounds.min}
              aria-valuenow={terminalPanelHeight}
              className="terminal-panel-resize-handle"
              onKeyDown={handleTerminalResizeKeyDown}
              onPointerDown={handleTerminalResizePointerDown}
              role="separator"
              tabIndex={0}
            >
              <span aria-hidden="true" />
            </div>
            {terminalPanelLoaded ? (
              <Suspense
                fallback={
                  <div className="terminal-panel-loading">
                    <LoaderCircle className="animate-spin" />
                    {t('common.loading')}
                  </div>
                }
              >
                <TerminalPanel
                  onClose={() => setTerminalOpen(false)}
                  open={terminalOpen}
                  projectId={terminalProjectId}
                />
              </Suspense>
            ) : null}
          </div>
        </div>
        <Toaster
          dismissLabel={t('toast.dismiss')}
          label={t('toast.notifications')}
        />
      </TooltipProvider>
    </ThemeProvider>
  )
}

function getUpdateScanQueueDetail(check: SkillUpdateCheck, t: Translate) {
  if (check.reason === 'network-error') {
    return t('desktop.queue.scan.failed')
  }
  if (check.status === 'current') return t('desktop.queue.scan.current')
  if (check.status === 'update-available') {
    return t('desktop.queue.scan.updateAvailable')
  }
  if (check.status === 'missing') return t('desktop.queue.scan.missing')
  return t('desktop.queue.scan.unavailable')
}

function showUpdateScanToast(catalog: CatalogSnapshot, t: Translate) {
  const updates = catalog.skills.filter(
    (skill) => skill.updateCheck.status === 'update-available'
  ).length
  const missing = catalog.skills.filter(
    (skill) => skill.updateCheck.status === 'missing'
  ).length
  const unavailable = catalog.skills.filter(
    (skill) => skill.updateCheck.status === 'unavailable'
  ).length
  const message = t('desktop.operations.updateScanComplete', {
    missing,
    unavailable,
    updates,
  })
  if (unavailable > 0) toast.warning(message)
  else toast.success(message)
}

function StatusBar({
  activeTaskCount,
  aiOpen,
  busy,
  onAiToggle,
  onRefresh,
  onSettingsBack,
  onSidebarToggle,
  onTaskQueueToggle,
  onTerminalToggle,
  refreshing,
  runtime,
  sidebarCollapsed,
  taskQueueOpen,
  terminalOpen,
  view,
}: {
  activeTaskCount: number
  aiOpen: boolean
  busy: boolean
  onAiToggle: () => void
  onRefresh: () => void
  onSettingsBack: () => void
  onSidebarToggle: () => void
  onTaskQueueToggle: () => void
  onTerminalToggle: () => void
  refreshing: boolean
  runtime: DesktopRuntimeInfo | null
  sidebarCollapsed: boolean
  taskQueueOpen: boolean
  terminalOpen: boolean
  view: ProductView
}) {
  const { t } = useI18n()
  const title =
    view === 'library'
      ? t('desktop.nav.library')
      : view === 'discover'
        ? t('desktop.status.discover')
        : view === 'managed'
          ? t('desktop.nav.managed')
          : view === 'workbench'
            ? t('desktop.nav.workbench')
            : t('desktop.nav.settings')

  return (
    <header
      className="desktop-status-bar drag-region"
      data-sidebar-collapsed={sidebarCollapsed}
    >
      <div className="status-sidebar-toggle no-drag">
        {view === 'settings' ? (
          <Button onClick={onSettingsBack} size="sm" variant="ghost">
            <ArrowLeft className="size-3.5" />
            {t('desktop.settings.back')}
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-controls="desktop-primary-navigation"
                aria-expanded={!sidebarCollapsed}
                aria-label={
                  sidebarCollapsed
                    ? t('desktop.status.expandSidebar')
                    : t('desktop.status.collapseSidebar')
                }
                className="size-7"
                onClick={onSidebarToggle}
                size="icon-sm"
                variant="ghost"
              >
                <PanelLeft className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {sidebarCollapsed
                ? t('desktop.status.expandSidebar')
                : t('desktop.status.collapseSidebar')}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <span className="status-title">
        {title}
        {runtime?.channel === 'development' ? (
          <span className="development-badge">Dev</span>
        ) : null}
      </span>
      <div className="status-actions no-drag">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('desktop.status.openQueue')}
              aria-pressed={taskQueueOpen}
              className={cn(
                'status-task-queue size-7',
                taskQueueOpen && 'is-active'
              )}
              onClick={onTaskQueueToggle}
              size="icon-sm"
              variant="ghost"
            >
              <ListTodo className="size-3.5" />
              {activeTaskCount > 0 ? (
                <span aria-hidden="true">{Math.min(activeTaskCount, 9)}</span>
              ) : null}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('desktop.status.openQueue')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('desktop.status.openAi')}
              aria-pressed={aiOpen}
              className={cn('size-7', aiOpen && 'is-active')}
              onClick={onAiToggle}
              size="icon-sm"
              variant="ghost"
            >
              <Bot className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('desktop.status.openAi')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-controls="desktop-terminal-panel"
              aria-expanded={terminalOpen}
              aria-label={t('desktop.status.toggleTerminal')}
              aria-pressed={terminalOpen}
              className={cn('size-7', terminalOpen && 'is-active')}
              onClick={onTerminalToggle}
              size="icon-sm"
              variant="ghost"
            >
              <PanelBottom className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <span className="status-shortcut-tooltip">
              {t('desktop.status.toggleTerminal')}
              <KbdGroup>
                <Kbd>{runtime?.platform === 'darwin' ? '⌘' : 'Ctrl'}</Kbd>
                <Kbd>J</Kbd>
              </KbdGroup>
            </span>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('desktop.status.refresh')}
              className="size-7"
              disabled={busy}
              onClick={onRefresh}
              size="icon-sm"
              variant="ghost"
            >
              <RefreshCw
                className={cn('size-3.5', refreshing && 'animate-spin')}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('desktop.status.refresh')}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  )
}

function PrimarySidebar({
  catalog,
  collapsed,
  onViewChange,
  view,
}: {
  catalog: CatalogSnapshot | null
  collapsed: boolean
  onViewChange: (view: ProductView) => void
  view: ProductView
}) {
  const { t } = useI18n()
  const { state: appUpdate } = useAppUpdate()
  const updateNotice = hasAppUpdate(appUpdate)
    ? t('desktop.appUpdate.notification', { version: appUpdate?.version ?? '' })
    : undefined
  return (
    <aside
      className="primary-sidebar"
      data-collapsed={collapsed}
      id="desktop-primary-navigation"
    >
      <div className="sidebar-brand">
        <Brand compact={collapsed} />
      </div>
      <nav aria-label={t('desktop.nav.main')} className="primary-navigation">
        <SidebarNavItem
          active={view === 'workbench'}
          collapsed={collapsed}
          icon={<Gauge />}
          label={t('desktop.nav.workbench')}
          onClick={() => onViewChange('workbench')}
        />
        <SidebarNavItem
          active={view === 'library'}
          collapsed={collapsed}
          icon={<Library />}
          label={t('desktop.nav.library')}
          onClick={() => onViewChange('library')}
          trailing={catalog?.skills.length}
        />
        <SidebarNavItem
          active={view === 'discover'}
          collapsed={collapsed}
          icon={<Compass />}
          label={t('desktop.nav.discover')}
          onClick={() => onViewChange('discover')}
        />
        <SidebarNavItem
          active={view === 'managed'}
          collapsed={collapsed}
          icon={<Boxes />}
          label={t('desktop.nav.managed')}
          onClick={() => onViewChange('managed')}
        />
      </nav>
      <nav
        aria-label={t('desktop.nav.applicationSettings')}
        className="sidebar-settings"
      >
        <SidebarNavItem
          active={view === 'settings'}
          collapsed={collapsed}
          icon={
            <span className="settings-entry-icon">
              <SettingsIcon />
              {updateNotice ? (
                <span aria-hidden="true" className="app-update-dot" />
              ) : null}
            </span>
          }
          label={t('desktop.nav.settings')}
          notice={updateNotice}
          onClick={() => onViewChange('settings')}
        />
      </nav>
    </aside>
  )
}

function SidebarNavItem({
  collapsed,
  label,
  className,
  notice,
  ...props
}: Omit<NavItemProps, 'children'> & {
  collapsed: boolean
  label: string
  notice?: string
}) {
  const item = (
    <NavItem
      aria-label={
        notice ? `${label} · ${notice}` : collapsed ? label : undefined
      }
      className={cn(className, collapsed && 'is-compact')}
      {...props}
    >
      {label}
    </NavItem>
  )

  if (!collapsed && !notice) return item
  return (
    <Tooltip>
      <TooltipTrigger asChild>{item}</TooltipTrigger>
      <TooltipContent side="right">
        {notice ? `${label} · ${notice}` : label}
      </TooltipContent>
    </Tooltip>
  )
}

function LibraryScopePanel({
  catalog,
  filter,
  onCatalogChange,
  onCollapse,
  onFilterChange,
  resizeHandle,
}: {
  catalog: CatalogSnapshot | null
  draggedSkillId?: string | null
  dropTarget?: LibraryFolderFilter | null
  filter: LibraryFilter
  folderFilter?: LibraryFolderFilter
  onCatalogChange: (catalog: CatalogSnapshot) => void
  onCollapse?: (event: ReactMouseEvent<HTMLButtonElement>) => void
  onCreateFolder?: () => void
  onDropSkill?: (skillId: string, folderId: string | null) => void
  onDropTargetChange?: (target: LibraryFolderFilter | null) => void
  onFilterChange: (filter: LibraryFilter) => void
  onFolderFilterChange?: (filter: LibraryFolderFilter) => void
  resizeHandle?: ReactNode
}) {
  const { plural, t } = useI18n()
  const [busy, setBusy] = useState<string | null>(null)
  const globalSkillCount =
    catalog?.skills.filter((skill) => skill.scope === 'global').length ?? 0

  async function addProject() {
    if (busy) return
    setBusy('add')
    try {
      const previousIds = new Set(
        (catalog?.projects ?? []).map((project) => project.id)
      )
      const nextCatalog = await window.skillShelf.addProject()
      if (!nextCatalog) return
      onCatalogChange(nextCatalog)
      const addedProject = nextCatalog.projects.find(
        (project) => !previousIds.has(project.id)
      )
      if (addedProject) onFilterChange(`project:${addedProject.id}`)
      toast.success(t('desktop.projects.added'))
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setBusy(null)
    }
  }

  async function removeProject(projectId: string) {
    if (busy) return
    setBusy(projectId)
    try {
      onCatalogChange(await window.skillShelf.removeProject(projectId))
      if (filter === `project:${projectId}`) onFilterChange('scope:global')
      toast.success(t('desktop.projects.removed'))
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setBusy(null)
    }
  }

  return (
    <aside className="library-scope-panel">
      {resizeHandle}
      <header className="scope-panel-header">
        <div className="scope-panel-title">
          <span>{t('desktop.library.scopeTitle')}</span>
          {onCollapse ? (
            <Button
              aria-label={t('desktop.library.collapseScope')}
              aria-expanded="true"
              className="scope-panel-collapse"
              onClick={onCollapse}
              size="xs"
              variant="ghost"
            >
              <PanelLeftClose />
              {t('desktop.library.collapseScopeAction')}
            </Button>
          ) : null}
        </div>
        <p>{t('desktop.library.scopeDescription')}</p>
      </header>

      <nav
        aria-label={t('desktop.library.scopeTitle')}
        className="scope-filter-list"
      >
        <button
          aria-current={filter === 'scope:global' ? 'page' : undefined}
          className={cn(filter === 'scope:global' && 'is-active')}
          onClick={() => onFilterChange('scope:global')}
          type="button"
        >
          <span className="scope-filter-icon is-global">
            <Globe2 />
          </span>
          <span>
            <strong>{t('desktop.library.global')}</strong>
            <small>{t('desktop.library.globalDirectory')}</small>
          </span>
          <b>{globalSkillCount}</b>
        </button>
      </nav>

      <section className="scope-projects">
        <header>
          <div>
            <strong>{t('desktop.projects.title')}</strong>
            <span>{catalog?.projects.length ?? 0}</span>
          </div>
          <Button
            aria-label={t('desktop.projects.add')}
            disabled={busy === 'add'}
            onClick={() => void addProject()}
            size="icon-sm"
            title={t('desktop.projects.add')}
            variant="ghost"
          >
            {busy === 'add' ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <FolderPlus />
            )}
          </Button>
        </header>
        <div className="scope-project-list">
          {(catalog?.projects ?? []).map((project) => {
            const active = filter === `project:${project.id}`
            return (
              <article
                className={cn('scope-project-item', active && 'is-active')}
                key={project.id}
              >
                <button
                  aria-current={active ? 'page' : undefined}
                  className="scope-project-target"
                  onClick={() => onFilterChange(`project:${project.id}`)}
                  type="button"
                >
                  <span
                    className={cn(
                      'scope-project-icon',
                      project.scanError && 'has-error'
                    )}
                  >
                    {project.scanError ? <CircleAlert /> : <FolderCode />}
                  </span>
                  <span className="scope-project-copy">
                    <span>
                      <strong>{project.name}</strong>
                      <small>
                        {project.scanError
                          ? t('desktop.projects.scanError')
                          : plural(
                              project.skillCount,
                              'count.skill.one',
                              'count.skill.other'
                            )}
                      </small>
                    </span>
                    <code title={project.path}>{project.path}</code>
                  </span>
                </button>
                <Button
                  aria-label={t('desktop.projects.remove', {
                    name: project.name,
                  })}
                  className="scope-project-remove"
                  disabled={busy === project.id}
                  onClick={() => void removeProject(project.id)}
                  size="icon-sm"
                  variant="ghost"
                >
                  {busy === project.id ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Trash2 />
                  )}
                </Button>
              </article>
            )
          })}
          {catalog && catalog.projects.length === 0 ? (
            <div className="scope-project-empty">
              <FolderPlus />
              <p>{t('desktop.library.projectEmpty')}</p>
              <Button
                disabled={busy === 'add'}
                onClick={() => void addProject()}
                size="xs"
                variant="outline"
              >
                {t('desktop.projects.add')}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      <p className="scope-panel-hint">{t('desktop.library.scopeOnlyHint')}</p>
    </aside>
  )
}

export function FinderLibraryWorkspace({
  aiSettings,
  bulkUpdateProgress,
  busyAction,
  catalog,
  defaultViewMode,
  drawerContainer,
  drawerWidth,
  error,
  filter,
  finderViewOptions,
  focusedAgents,
  onAdd,
  onCatalogChange,
  onCloseSelection,
  onDrawerWidthChange,
  onFilterChange,
  onFinderViewOptionsChange,
  onImportSkills,
  onOpenAiSettings,
  onRefresh,
  onRemove,
  onRetry,
  onSelect,
  onUpdate,
  onUpdateAvailable,
  onTranslateSkills,
  selectedId,
  selectedSkill,
  refreshing,
  translatingSkillIds,
}: {
  aiSettings: AiProviderSettingsStatus | null
  bulkUpdateProgress: { completed: number; total: number } | null
  busyAction: string | null
  catalog: CatalogSnapshot | null
  defaultViewMode: LibraryViewMode
  drawerContainer: HTMLElement | null
  drawerWidth: number
  error: string | null
  filter: LibraryFilter
  finderViewOptions: Record<string, FinderViewOptions>
  focusedAgents: string[]
  onAdd: () => void
  onCatalogChange: (catalog: CatalogSnapshot) => void
  onCloseSelection: () => void
  onDrawerWidthChange: (width: number) => void
  onFilterChange: (filter: LibraryFilter) => void
  onFinderViewOptionsChange: (
    locationKey: string,
    options: FinderViewOptions
  ) => void
  onImportSkills: (skillIds: string[]) => void
  onOpenAiSettings: () => void
  onRefresh: () => void
  onRemove: (skillId: string) => void
  onRetry: () => void
  onSelect: (skillId: string) => void
  onUpdate: (skillId: string) => void
  onUpdateAvailable: () => void
  onTranslateSkills: (
    skillIds: string[],
    language?: string,
    force?: boolean
  ) => boolean
  selectedId: string | null
  selectedSkill: InstalledSkill | null
  refreshing: boolean
  translatingSkillIds: ReadonlySet<string>
}) {
  const { locale, plural, t } = useI18n()
  const [scopeCollapsed, setScopeCollapsed] = useState(
    () =>
      window.localStorage.getItem(LIBRARY_SCOPE_COLLAPSED_STORAGE_KEY) ===
      'true'
  )
  const scopeResize = useLibraryScopeResize(scopeCollapsed)
  const scopeToggleFocusRef = useRef(false)
  useEffect(() => {
    if (!scopeToggleFocusRef.current) return
    scopeToggleFocusRef.current = false
    scopeResize.workspaceRef.current
      ?.querySelector<HTMLButtonElement>(
        scopeCollapsed ? '.finder-scope-restore' : '.scope-panel-collapse'
      )
      ?.focus({ preventScroll: true })
  }, [scopeCollapsed, scopeResize.workspaceRef])
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [updateFilter, setUpdateFilter] = useState<SkillUpdateFilter | null>(
    null
  )
  const [finderNavigation, navigateFinder] = useReducer(
    reduceFinderNavigation,
    initialFinderNavigation
  )
  const currentFolderId =
    finderNavigation.entries[finderNavigation.index] ?? null
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [createFolderPosition, setCreateFolderPosition] =
    useState<CanvasPosition>({ x: 28, y: 28 })
  const [folderToRename, setFolderToRename] = useState<ShelfGroup | null>(null)
  const [skillToRemove, setSkillToRemove] = useState<InstalledSkill | null>(
    null
  )
  const finderContentRef = useRef<HTMLDivElement | null>(null)
  const catalogRef = useRef(catalog)
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve())
  const persistenceVersion = useRef(0)
  catalogRef.current = catalog
  const scopeKey = getLibraryScopeKey(filter)
  const instructionProject = filter.startsWith('project:')
    ? catalog?.projects.find(
        (project) => project.id === filter.slice('project:'.length)
      )
    : undefined
  const finderLocationKey = `${scopeKey}:${currentFolderId ?? 'root'}`
  const currentFinderViewOptions = finderViewOptions[finderLocationKey] ?? {
    alignToGrid: false,
    groupBy: 'kind',
    sortBy: 'none',
    sortDirection: 'descending',
    useGroups: false,
    viewMode: defaultViewMode,
  }
  const {
    alignToGrid: finderAlignsToGrid,
    groupBy: finderGroupBy,
    sortBy: finderSortBy,
    sortDirection: finderSortDirection,
    useGroups: finderUsesGroups,
    viewMode,
  } = currentFinderViewOptions
  const scopeSkills = useMemo(
    () => getLibraryScopeSkills(catalog?.skills ?? [], filter),
    [catalog?.skills, filter]
  )
  const updateScanState = useMemo(
    () => getUpdateScanState(scopeSkills),
    [scopeSkills]
  )
  const scopeFolders = useMemo(
    () =>
      (catalog?.groups ?? []).filter((folder) => folder.scopeKey === scopeKey),
    [catalog?.groups, scopeKey]
  )
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filtering = Boolean(normalizedQuery || updateFilter)
  const matchingSkills = useMemo(
    () =>
      scopeSkills.filter((skill) => {
        if (updateFilter && skill.updateCheck.status !== updateFilter) {
          return false
        }
        if (!normalizedQuery) return true
        return [
          skill.name,
          getSkillDescription(skill, locale),
          skill.source,
          ...Object.values(skill.descriptions),
          ...skill.tags,
        ]
          .filter(Boolean)
          .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery))
      }),
    [locale, normalizedQuery, scopeSkills, updateFilter]
  )
  const currentFolderSkills = useMemo(
    () => scopeSkills.filter((skill) => skill.groupId === currentFolderId),
    [currentFolderId, scopeSkills]
  )
  const visibleSkills = filtering
    ? matchingSkills
    : matchingSkills.filter((skill) => skill.groupId === currentFolderId)
  const currentFolderFolders = scopeFolders.filter(
    (folder) => folder.parentId === currentFolderId
  )
  const visibleFolders = filtering ? [] : currentFolderFolders
  const activeSortKey =
    finderSortBy === 'none'
      ? viewMode === 'canvas'
        ? null
        : 'name'
      : finderSortBy
  const orderedListFolders = normalizedQuery
    ? visibleFolders
    : activeSortKey
      ? sortFinderItems(
          visibleFolders.map((folder) => ({
            folder,
            key: `folder:${folder.id}`,
            kind: 'folder' as const,
            name: folder.name,
          })),
          activeSortKey,
          finderSortDirection,
          locale
        ).map((item) => item.folder)
      : sortFinderItemsByCanvasPosition(visibleFolders)
  const orderedListSkills = normalizedQuery
    ? visibleSkills
    : activeSortKey
      ? sortFinderItems(
          visibleSkills.map((skill) => ({
            key: `skill:${skill.id}`,
            kind: 'skill' as const,
            name: skill.name,
            source: skill.source ?? skill.sourceType,
            skill,
            tags: skill.tags,
            updateStatus: skill.updateCheck.status,
          })),
          activeSortKey,
          finderSortDirection,
          locale
        ).map((item) => item.skill)
      : sortFinderItemsByCanvasPosition(visibleSkills)
  const breadcrumbs = getFolderBreadcrumbs(currentFolderId, scopeFolders)
  const updateStatusCounts = useMemo(
    () => getSkillUpdateStatusCounts(scopeSkills),
    [scopeSkills]
  )
  const availableUpdateCount = updateStatusCounts['update-available']
  const updatingAvailable = busyAction === 'update-all'
  useEffect(() => navigateFinder({ type: 'reset' }), [filter])
  useEffect(() => {
    if (
      currentFolderId &&
      !scopeFolders.some((folder) => folder.id === currentFolderId)
    ) {
      navigateFinder({ type: 'reset' })
    }
  }, [currentFolderId, scopeFolders])

  function openFolder(folderId: string | null) {
    const nextLocationKey = `${scopeKey}:${folderId ?? 'root'}`
    if (!finderViewOptions[nextLocationKey]) {
      onFinderViewOptionsChange(nextLocationKey, currentFinderViewOptions)
    }
    navigateFinder({ location: folderId, type: 'navigate' })
  }

  function applyLibrarySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setQuery(queryDraft.trim())
  }

  function clearLibrarySearch() {
    setQueryDraft('')
    setQuery('')
  }

  function openCreateFolder(position?: CanvasPosition) {
    setCreateFolderPosition(
      position ??
        getDefaultCanvasPosition(visibleFolders.length + visibleSkills.length)
    )
    setCreateFolderOpen(true)
  }

  function applyOptimisticCatalog(
    update: (current: CatalogSnapshot) => CatalogSnapshot
  ) {
    const current = catalogRef.current
    if (!current) return false
    const next = update(current)
    catalogRef.current = next
    onCatalogChange(next)
    return true
  }

  function queueFinderPersistence(operation: () => Promise<CatalogSnapshot>) {
    const version = ++persistenceVersion.current
    const task = persistenceQueue.current.then(operation)
    persistenceQueue.current = task.then(
      (snapshot) => {
        if (version !== persistenceVersion.current) return
        catalogRef.current = snapshot
        onCatalogChange(snapshot)
      },
      async (caught) => {
        toast.error(getLocalizedErrorMessage(caught, t))
        if (version !== persistenceVersion.current) return
        try {
          const snapshot = await window.skillShelf.getCatalog()
          catalogRef.current = snapshot
          onCatalogChange(snapshot)
        } catch (reloadError) {
          toast.error(getLocalizedErrorMessage(reloadError, t))
        }
      }
    )
    return task.then(
      () => true,
      () => false
    )
  }

  function moveSkill(
    skill: InstalledSkill,
    folderId: string | null,
    position: CanvasPosition
  ) {
    if (
      !applyOptimisticCatalog((current) => ({
        ...current,
        skills: current.skills.map((item) =>
          item.id === skill.id ? { ...item, groupId: folderId, position } : item
        ),
      }))
    )
      return
    queueFinderPersistence(() =>
      window.skillShelf.saveOrganization({
        groupId: folderId,
        position,
        skillId: skill.id,
        tags: skill.tags,
      })
    )
  }

  function moveFolder(
    folder: ShelfGroup,
    parentId: string | null,
    position: CanvasPosition
  ) {
    if (
      !applyOptimisticCatalog((current) => ({
        ...current,
        groups: current.groups.map((item) =>
          item.id === folder.id ? { ...item, parentId, position } : item
        ),
      }))
    )
      return
    queueFinderPersistence(() =>
      window.skillShelf.saveGroup({
        folderId: folder.id,
        parentId,
        position,
      })
    )
  }

  function getCurrentFolderCanvasItems() {
    return [
      ...currentFolderFolders.map((folder) => ({
        folder,
        key: `folder:${folder.id}`,
        kind: 'folder' as const,
        name: folder.name,
        position: folder.position,
      })),
      ...currentFolderSkills.map((skill) => ({
        key: `skill:${skill.id}`,
        kind: 'skill' as const,
        name: skill.name,
        position: skill.position,
        source: skill.source ?? skill.sourceType,
        skill,
        tags: skill.tags,
        updateStatus: skill.updateCheck.status,
      })),
    ]
  }

  function saveOrganizedItemPosition(
    item: ReturnType<typeof getCurrentFolderCanvasItems>[number],
    position: CanvasPosition
  ) {
    if (item.position?.x === position.x && item.position.y === position.y) {
      return
    }
    if (item.kind === 'folder') {
      moveFolder(item.folder, currentFolderId, position)
    } else {
      moveSkill(item.skill, currentFolderId, position)
    }
  }

  function cleanUpCurrentFolder(mode: FinderSortKey | 'position') {
    if (filtering) return
    const viewportWidth = finderContentRef.current?.clientWidth ?? 980
    const items = getCurrentFolderCanvasItems()
    const sortedItems =
      mode === 'position'
        ? sortFinderItemsByCanvasPosition(items)
        : sortFinderItems(items, mode, 'ascending', locale)
    sortedItems.forEach((item, index) => {
      const position = getFinderCanvasGridPosition(index, viewportWidth)
      saveOrganizedItemPosition(item, position)
    })
  }

  function snapCurrentFolderToGrid() {
    if (filtering) return
    const occupiedPositions: CanvasPosition[] = []
    sortFinderItemsByCanvasPosition(getCurrentFolderCanvasItems()).forEach(
      (item, index) => {
        const position = getNearestAvailableFinderGridPosition(
          item.position ?? getDefaultCanvasPosition(index),
          occupiedPositions
        )
        occupiedPositions.push(position)
        saveOrganizedItemPosition(item, position)
      }
    )
  }

  function changeCurrentFinderSort(next: FinderSortKey | 'none') {
    if (next === finderSortBy) return
    if (finderSortBy !== 'none' && next === 'none') {
      cleanUpCurrentFolder(finderSortBy)
    }
    onFinderViewOptionsChange(finderLocationKey, {
      ...currentFinderViewOptions,
      sortBy: next,
    })
  }

  function changeCurrentFinderSortDirection(next: FinderSortDirection) {
    if (next === finderSortDirection) return
    onFinderViewOptionsChange(finderLocationKey, {
      ...currentFinderViewOptions,
      sortDirection: next,
    })
  }

  function changeCurrentFinderGridAlignment(alignToGrid: boolean) {
    if (alignToGrid === finderAlignsToGrid) return
    if (alignToGrid) snapCurrentFolderToGrid()
    onFinderViewOptionsChange(finderLocationKey, {
      ...currentFinderViewOptions,
      alignToGrid,
    })
  }

  function changeCurrentFinderGroup(groupBy: FinderSortKey | 'none') {
    onFinderViewOptionsChange(finderLocationKey, {
      ...currentFinderViewOptions,
      groupBy: groupBy === 'none' ? finderGroupBy : groupBy,
      useGroups: groupBy !== 'none',
    })
  }

  function changeCurrentFinderViewMode(next: LibraryViewMode) {
    onFinderViewOptionsChange(finderLocationKey, {
      ...currentFinderViewOptions,
      sortBy:
        next !== 'canvas' && finderSortBy === 'none' ? 'name' : finderSortBy,
      viewMode: next,
    })
  }

  function changeScopeCollapsed(collapsed: boolean, restoreFocus = false) {
    scopeToggleFocusRef.current = restoreFocus
    setScopeCollapsed(collapsed)
    window.localStorage.setItem(
      LIBRARY_SCOPE_COLLAPSED_STORAGE_KEY,
      String(collapsed)
    )
  }

  async function renameFolder(folder: ShelfGroup, requestedName: string) {
    const name = requestedName.trim().slice(0, 48)
    if (!name) return false
    if (name === folder.name) return true
    const duplicate = scopeFolders.some(
      (candidate) =>
        candidate.id !== folder.id &&
        candidate.parentId === folder.parentId &&
        candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    )
    if (duplicate) {
      toast.error(t('desktop.errors.folderNameExists'))
      return false
    }
    if (
      !applyOptimisticCatalog((current) => ({
        ...current,
        groups: current.groups.map((candidate) =>
          candidate.id === folder.id ? { ...candidate, name } : candidate
        ),
      }))
    ) {
      return false
    }
    const saved = await queueFinderPersistence(() =>
      window.skillShelf.saveGroup({ folderId: folder.id, name })
    )
    if (saved) toast.success(t('desktop.folders.renamed'))
    return saved
  }

  return (
    <div
      className="library-workspace finder-library-workspace"
      data-scope-collapsed={scopeCollapsed}
      ref={scopeResize.workspaceRef}
      style={scopeResize.style}
    >
      {scopeCollapsed ? (
        <button
          aria-expanded="false"
          aria-label={t('desktop.library.expandScope')}
          className="scope-panel-rail finder-scope-restore"
          onClick={(event) => changeScopeCollapsed(false, event.detail === 0)}
          type="button"
        >
          <ChevronRight aria-hidden="true" />
        </button>
      ) : null}
      <LibraryScopePanel
        catalog={catalog}
        filter={filter}
        onCatalogChange={onCatalogChange}
        onCollapse={(event) => changeScopeCollapsed(true, event.detail === 0)}
        onFilterChange={onFilterChange}
        resizeHandle={
          !scopeCollapsed ? (
            <div
              aria-label={t('desktop.library.resizeScope')}
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
          ) : null
        }
      />
      <section className="library-pane finder-library-pane">
        <PageHeader
          actions={
            <>
              {instructionProject ? (
                <ProjectInstructionsButton
                  key={instructionProject.id}
                  project={instructionProject}
                />
              ) : null}
              <Button
                disabled={Boolean(busyAction) || !catalog}
                onClick={onRefresh}
                size="sm"
                variant="outline"
              >
                <RefreshCw className={cn(refreshing && 'animate-spin')} />
                {refreshing
                  ? t('desktop.library.scanningUpdates')
                  : t('desktop.library.scanUpdates')}
              </Button>
              <Button
                disabled={
                  !catalog ||
                  Boolean(busyAction) ||
                  availableUpdateCount === 0 ||
                  updateScanState !== 'fresh'
                }
                onClick={onUpdateAvailable}
                size="sm"
                variant="outline"
              >
                {updatingAvailable ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <CircleArrowUp />
                )}
                {updatingAvailable
                  ? bulkUpdateProgress?.total
                    ? t('desktop.library.updatingAvailableProgress', {
                        completed: bulkUpdateProgress.completed,
                        total: bulkUpdateProgress.total,
                      })
                    : t('desktop.library.preparingUpdates')
                  : updateScanState === 'missing'
                    ? t('desktop.library.scanBeforeUpdate')
                    : updateScanState === 'stale'
                      ? t('desktop.library.rescanBeforeUpdate')
                      : t('desktop.library.updateAvailableCount', {
                          count: availableUpdateCount,
                        })}
              </Button>
              <Button onClick={onAdd} size="sm">
                <PackagePlus />
                {t('desktop.library.add')}
              </Button>
            </>
          }
          className="library-page-header finder-page-header"
          description={
            <span className="library-page-description">
              <span>{t('desktop.library.finderDescription')}</span>
              <span className="library-page-tip">
                <Kbd>
                  <MousePointerClick />
                  {t('desktop.library.rightClickKey')}
                </Kbd>
                <span>{t('desktop.library.canvasRightClickHint')}</span>
              </span>
            </span>
          }
          eyebrow={t('desktop.library.eyebrow')}
          title={getScopeTitle(filter, catalog, t)}
        />
        <FinderToolbar
          rootTitle={getScopeTitle(filter, catalog, t)}
          breadcrumbs={breadcrumbs}
          finderNavigation={finderNavigation}
          navigateFinder={navigateFinder}
          openFolder={openFolder}
          viewMode={viewMode}
          changeCurrentFinderViewMode={changeCurrentFinderViewMode}
          filtering={Boolean(normalizedQuery)}
          finderUsesGroups={finderUsesGroups}
          finderGroupBy={finderGroupBy}
          finderSortBy={finderSortBy}
          finderSortDirection={finderSortDirection}
          changeCurrentFinderGroup={changeCurrentFinderGroup}
          changeCurrentFinderSort={changeCurrentFinderSort}
          changeCurrentFinderSortDirection={changeCurrentFinderSortDirection}
          cleanUpCurrentFolder={cleanUpCurrentFolder}
          openCreateFolder={openCreateFolder}
          itemCount={currentFolderFolders.length + currentFolderSkills.length}
        />
        <div className="library-toolbar finder-toolbar">
          <form className="search-control" onSubmit={applyLibrarySearch}>
            <SearchField
              appliedValue={query}
              clearLabel={t('desktop.library.clearSearch')}
              label={t('desktop.library.search')}
              onChange={setQueryDraft}
              onClear={clearLibrarySearch}
              placeholder={t('desktop.library.searchPlaceholder')}
              value={queryDraft}
            />
            <Button size="sm" type="submit" variant="outline">
              <Search />
              {t('common.filter')}
            </Button>
          </form>
          <div className="library-toolbar-meta">
            <span className="result-count">
              {plural(
                visibleSkills.length + visibleFolders.length,
                filtering ? 'count.skill.one' : 'count.item.one',
                filtering ? 'count.skill.other' : 'count.item.other'
              )}
            </span>
          </div>
          <div
            aria-label={t('desktop.library.updateLegend')}
            className="skill-update-legend"
          >
            {(
              [
                'current',
                'update-available',
                'missing',
                'unavailable',
                'unchecked',
              ] as const
            ).map((status) => (
              <SkillUpdateLegendItem
                active={updateFilter === status}
                count={updateStatusCounts[status]}
                key={status}
                onClick={() =>
                  setUpdateFilter((current) =>
                    current === status ? null : status
                  )
                }
                status={status}
              />
            ))}
          </div>
        </div>
        <div className="finder-content" ref={finderContentRef}>
          {!catalog && !error ? (
            <SkillsSkeleton view={normalizedQuery ? 'list' : viewMode} />
          ) : null}
          {error ? <ErrorState message={error} onRetry={onRetry} /> : null}
          {catalog &&
          visibleSkills.length + visibleFolders.length > 0 &&
          viewMode === 'canvas' &&
          !normalizedQuery ? (
            <FinderCanvas
              alignToGrid={finderAlignsToGrid}
              allFolders={scopeFolders}
              allSkills={scopeSkills}
              busyAction={busyAction}
              currentFolderId={currentFolderId}
              filtering={filtering}
              folders={visibleFolders}
              groupBy={finderGroupBy}
              onCloseSelection={onCloseSelection}
              onCleanUp={cleanUpCurrentFolder}
              onCreateFolder={openCreateFolder}
              onEnterFolder={openFolder}
              onFolderMove={(folder, parentId, position) =>
                moveFolder(folder, parentId, position)
              }
              onAlignToGridChange={changeCurrentFinderGridAlignment}
              onGroupChange={changeCurrentFinderGroup}
              onImportSkills={onImportSkills}
              onRenameFolder={setFolderToRename}
              onRemoveSkill={setSkillToRemove}
              onSelectSkill={onSelect}
              onSortChange={changeCurrentFinderSort}
              onSortDirectionChange={changeCurrentFinderSortDirection}
              onSkillMove={(skill, folderId, position) =>
                moveSkill(skill, folderId, position)
              }
              onTranslateSkills={onTranslateSkills}
              onUpdateSkill={onUpdate}
              onViewModeChange={changeCurrentFinderViewMode}
              scopeKey={scopeKey}
              selectedId={selectedId}
              skills={visibleSkills}
              sortBy={finderSortBy}
              sortDirection={finderSortDirection}
              useGroups={finderUsesGroups}
            />
          ) : catalog && visibleSkills.length + visibleFolders.length > 0 ? (
            <FinderListView
              allFolders={scopeFolders}
              allSkills={scopeSkills}
              busyAction={busyAction}
              contextSkills={scopeSkills}
              currentFolderId={currentFolderId}
              filtering={filtering}
              folders={orderedListFolders}
              groups={scopeFolders}
              groupBy={finderGroupBy}
              onCloseSelection={onCloseSelection}
              onEnterFolder={openFolder}
              onGroupChange={changeCurrentFinderGroup}
              onImportSkills={onImportSkills}
              onCreateFolder={() => openCreateFolder()}
              onMoveSkill={(skill, folderId, position) =>
                moveSkill(skill, folderId, position)
              }
              onRenameFolder={setFolderToRename}
              onRemoveSkill={setSkillToRemove}
              onSelectSkill={onSelect}
              onSortChange={changeCurrentFinderSort}
              onSortDirectionChange={changeCurrentFinderSortDirection}
              onTranslateSkills={onTranslateSkills}
              onUpdateSkill={onUpdate}
              onViewModeChange={changeCurrentFinderViewMode}
              selectedId={selectedId}
              resultsLabel={
                updateFilter
                  ? getSkillUpdateStatusLabel(updateFilter, t)
                  : t('desktop.library.filteredResults')
              }
              skills={orderedListSkills}
              sortBy={finderSortBy}
              sortDirection={finderSortDirection}
              useGroups={finderUsesGroups && !normalizedQuery}
              viewMode={viewMode}
            />
          ) : null}
          {catalog &&
          visibleSkills.length === 0 &&
          visibleFolders.length === 0 ? (
            <EmptyState
              folderEmpty={!query && !updateFilter}
              hasQuery={Boolean(query || updateFilter)}
              onAdd={onAdd}
            />
          ) : null}
        </div>
      </section>
      <Inspector
        aiSettings={aiSettings}
        busyAction={busyAction}
        drawerContainer={drawerContainer}
        drawerWidth={drawerWidth}
        focusedAgents={focusedAgents}
        groups={scopeFolders}
        onCatalogChange={onCatalogChange}
        onClose={onCloseSelection}
        onDrawerWidthChange={onDrawerWidthChange}
        onOpenAiSettings={onOpenAiSettings}
        onRemove={onRemove}
        onTranslateSkills={onTranslateSkills}
        onUpdate={onUpdate}
        skill={selectedSkill}
        translating={Boolean(
          selectedSkill && translatingSkillIds.has(selectedSkill.id)
        )}
      />
      <CreateFolderDialog
        onCreated={(nextCatalog, _folderId) => {
          onCatalogChange(nextCatalog)
        }}
        onOpenChange={setCreateFolderOpen}
        open={createFolderOpen}
        parentId={currentFolderId}
        position={createFolderPosition}
        scopeKey={scopeKey}
      />
      <RenameFolderDialog
        folder={folderToRename}
        onOpenChange={(open) => {
          if (!open) setFolderToRename(null)
        }}
        onRename={renameFolder}
      />
      <Dialog
        onOpenChange={(open) => {
          if (!open) setSkillToRemove(null)
        }}
        open={Boolean(skillToRemove)}
      >
        <DialogContent className="max-w-sm" closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>
              {t('desktop.inspector.removeQuestion', {
                name: skillToRemove?.name ?? '',
              })}
            </DialogTitle>
            <DialogDescription>
              {skillToRemove?.scope === 'project'
                ? t('desktop.inspector.removeProjectDescription')
                : t('desktop.inspector.removeDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setSkillToRemove(null)} variant="ghost">
              {t('common.cancel')}
            </Button>
            <Button
              disabled={busyAction === `remove:${skillToRemove?.id}`}
              onClick={() => {
                if (!skillToRemove) return
                onRemove(skillToRemove.id)
                setSkillToRemove(null)
              }}
              variant="destructive"
            >
              <Trash2 />
              {t('desktop.inspector.removeSkill')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function UntrackedSkillsDialog({
  busy,
  onOpenChange,
  onTrack,
  open,
  skills,
}: {
  busy: string | null
  onOpenChange: (open: boolean) => void
  onTrack: (skillIds: string[]) => void
  open: boolean
  skills: InstalledSkill[]
}) {
  const { t } = useI18n()
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="untracked-skills-dialog"
        closeLabel={t('common.close')}
      >
        <DialogHeader>
          <DialogTitle>
            {t('desktop.workbench.untracked.dialogTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('desktop.workbench.untracked.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="untracked-skills-list">
          {skills.length === 0 ? (
            <div className="untracked-skills-state">
              <CircleCheck />
              {t('desktop.workbench.untracked.empty')}
            </div>
          ) : (
            skills.map((skill) => (
              <article key={skill.id}>
                <span>
                  <strong>{skill.name}</strong>
                  <small title={skill.path}>{skill.path}</small>
                </span>
                <Button
                  disabled={Boolean(busy)}
                  onClick={() => onTrack([skill.id])}
                  size="xs"
                  variant="outline"
                >
                  {busy === skill.id ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Plus />
                  )}
                  {t('desktop.workbench.untracked.record')}
                </Button>
              </article>
            ))
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="ghost">
            {t('common.close')}
          </Button>
          <Button
            disabled={Boolean(busy) || skills.length === 0}
            onClick={() => onTrack(skills.map((skill) => skill.id))}
          >
            {busy === 'all' ? <LoaderCircle className="animate-spin" /> : null}
            {t('desktop.workbench.untracked.recordAll', {
              count: skills.length,
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LibraryWorkspace({
  aiSettings,
  bulkUpdateProgress,
  busyAction,
  catalog,
  drawerContainer,
  drawerWidth,
  error,
  filter,
  focusedAgents,
  onAdd,
  onCatalogChange,
  onCloseSelection,
  onDrawerWidthChange,
  onFilterChange,
  onOpenAiSettings,
  onRefresh,
  onRemove,
  onRetry,
  onSelect,
  onUpdate,
  onUpdateAvailable,
  onViewModeChange,
  selectedId,
  selectedSkill,
  refreshing,
  viewMode,
}: {
  aiSettings: AiProviderSettingsStatus | null
  bulkUpdateProgress: { completed: number; total: number } | null
  busyAction: string | null
  catalog: CatalogSnapshot | null
  drawerContainer: HTMLElement | null
  drawerWidth: number
  error: string | null
  filter: LibraryFilter
  focusedAgents: string[]
  onAdd: () => void
  onCatalogChange: (catalog: CatalogSnapshot) => void
  onCloseSelection: () => void
  onDrawerWidthChange: (width: number) => void
  onFilterChange: (filter: LibraryFilter) => void
  onOpenAiSettings: () => void
  onRefresh: () => void
  onRemove: (skillId: string) => void
  onRetry: () => void
  onSelect: (skillId: string) => void
  onUpdate: (skillId: string) => void
  onUpdateAvailable: () => void
  onViewModeChange: (viewMode: LibraryViewMode) => void
  selectedId: string | null
  selectedSkill: InstalledSkill | null
  refreshing: boolean
  viewMode: LibraryViewMode
}) {
  const { locale, plural, t } = useI18n()
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [updateFilter, setUpdateFilter] = useState<SkillUpdateFilter | null>(
    null
  )
  const [folderFilter, setFolderFilter] =
    useState<LibraryFolderFilter>('folder:all')
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [draggedSkillId, setDraggedSkillId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<LibraryFolderFilter | null>(null)
  const [movingSkillId, setMovingSkillId] = useState<string | null>(null)
  const [skillToRemove, setSkillToRemove] = useState<InstalledSkill | null>(
    null
  )
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const scopeSkills = useMemo(
    () => getLibraryScopeSkills(catalog?.skills ?? [], filter),
    [catalog?.skills, filter]
  )
  const updateScanState = useMemo(
    () => getUpdateScanState(scopeSkills),
    [scopeSkills]
  )
  const matchingScopeSkills = useMemo(
    () =>
      scopeSkills.filter((skill) => {
        if (updateFilter && skill.updateCheck.status !== updateFilter) {
          return false
        }
        if (!normalizedQuery) return true
        return [
          skill.name,
          getSkillDescription(skill, locale),
          skill.source,
          ...Object.values(skill.descriptions),
          ...skill.tags,
        ]
          .filter(Boolean)
          .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery))
      }),
    [locale, normalizedQuery, scopeSkills, updateFilter]
  )
  const visibleSkills = useMemo(
    () =>
      viewMode === 'columns'
        ? matchingScopeSkills
        : getFolderSkills(matchingScopeSkills, folderFilter),
    [folderFilter, matchingScopeSkills, viewMode]
  )
  const updateStatusCounts = useMemo(
    () => getSkillUpdateStatusCounts(scopeSkills),
    [scopeSkills]
  )
  const availableUpdateCount = updateStatusCounts['update-available']
  const updatingAvailable = busyAction === 'update-all'

  useEffect(() => {
    if (!folderFilter.startsWith('folder:')) return
    const folderId = folderFilter.slice('folder:'.length)
    if (folderId === 'all' || folderId === 'unfiled') return
    if (catalog?.groups.some((folder) => folder.id === folderId)) return
    setFolderFilter('folder:all')
  }, [catalog?.groups, folderFilter])

  async function moveSkillToFolder(skillId: string, folderId: string | null) {
    if (movingSkillId) return
    const skill = catalog?.skills.find((item) => item.id === skillId)
    if (!skill || skill.groupId === folderId) return
    setMovingSkillId(skillId)
    try {
      const nextCatalog = await window.skillShelf.saveOrganization({
        groupId: folderId,
        skillId,
        tags: skill.tags,
      })
      onCatalogChange(nextCatalog)
      if (folderId) {
        const folder = nextCatalog.groups.find((item) => item.id === folderId)
        toast.success(
          t('desktop.folders.moved', {
            folder: folder?.name ?? t('desktop.folders.folder'),
            name: skill.name,
          })
        )
      } else {
        toast.success(t('desktop.folders.movedUnfiled', { name: skill.name }))
      }
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setMovingSkillId(null)
      setDraggedSkillId(null)
      setDropTarget(null)
    }
  }

  function beginSkillDrag(event: ReactDragEvent<HTMLElement>, skillId: string) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(SKILL_DRAG_MIME, skillId)
    event.dataTransfer.setData('text/plain', skillId)
    setDraggedSkillId(skillId)
  }

  function finishSkillDrag() {
    setDraggedSkillId(null)
    setDropTarget(null)
  }

  function handleColumnDragOver(
    event: ReactDragEvent<HTMLElement>,
    target: LibraryFolderFilter
  ) {
    if (!draggedSkillId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget(target)
  }

  function handleColumnDragLeave(event: ReactDragEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget
    if (
      nextTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    ) {
      return
    }
    setDropTarget(null)
  }

  function handleColumnDrop(
    event: ReactDragEvent<HTMLElement>,
    target: LibraryFolderFilter
  ) {
    event.preventDefault()
    const skillId =
      draggedSkillId || event.dataTransfer.getData(SKILL_DRAG_MIME)
    setDropTarget(null)
    if (!skillId) return
    void moveSkillToFolder(
      skillId,
      target === 'folder:unfiled' ? null : target.slice('folder:'.length)
    )
  }

  const folderColumns = [
    {
      color: null,
      id: null,
      key: 'folder:unfiled' as const,
      name: t('desktop.folders.unfiled'),
      skills: matchingScopeSkills.filter((skill) => skill.groupId === null),
    },
    ...(catalog?.groups ?? []).map((folder) => ({
      color: folder.color,
      id: folder.id,
      key: `folder:${folder.id}` as LibraryFolderFilter,
      name: folder.name,
      skills: matchingScopeSkills.filter(
        (skill) => skill.groupId === folder.id
      ),
    })),
  ]

  function applyLibrarySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setQuery(queryDraft.trim())
  }

  function clearLibrarySearch() {
    setQueryDraft('')
    setQuery('')
  }

  return (
    <div className="library-workspace">
      <LibraryScopePanel
        catalog={catalog}
        draggedSkillId={draggedSkillId}
        dropTarget={dropTarget}
        filter={filter}
        folderFilter={folderFilter}
        onCatalogChange={onCatalogChange}
        onCreateFolder={() => setCreateFolderOpen(true)}
        onDropSkill={(skillId, folderId) =>
          void moveSkillToFolder(skillId, folderId)
        }
        onDropTargetChange={setDropTarget}
        onFilterChange={onFilterChange}
        onFolderFilterChange={setFolderFilter}
      />
      <section className="library-pane">
        <PageHeader
          actions={
            <>
              <Button
                onClick={() => setCreateFolderOpen(true)}
                size="sm"
                variant="outline"
              >
                <FolderPlus />
                {t('desktop.folders.new')}
              </Button>
              <Button
                disabled={Boolean(busyAction) || !catalog}
                onClick={onRefresh}
                size="sm"
                variant="outline"
              >
                <RefreshCw className={cn(refreshing && 'animate-spin')} />
                {refreshing
                  ? t('desktop.library.scanningUpdates')
                  : t('desktop.library.scanUpdates')}
              </Button>
              <Button
                disabled={
                  !catalog ||
                  Boolean(busyAction) ||
                  availableUpdateCount === 0 ||
                  updateScanState !== 'fresh'
                }
                onClick={onUpdateAvailable}
                size="sm"
                variant="outline"
              >
                {updatingAvailable ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <CircleArrowUp />
                )}
                {updatingAvailable
                  ? bulkUpdateProgress?.total
                    ? t('desktop.library.updatingAvailableProgress', {
                        completed: bulkUpdateProgress.completed,
                        total: bulkUpdateProgress.total,
                      })
                    : t('desktop.library.preparingUpdates')
                  : updateScanState === 'missing'
                    ? t('desktop.library.scanBeforeUpdate')
                    : updateScanState === 'stale'
                      ? t('desktop.library.rescanBeforeUpdate')
                      : t('desktop.library.updateAvailableCount', {
                          count: availableUpdateCount,
                        })}
              </Button>
              <Button onClick={onAdd} size="sm">
                <PackagePlus />
                {t('desktop.library.add')}
              </Button>
            </>
          }
          className="library-page-header"
          description={
            <span className="library-page-description">
              <span>{t('desktop.library.description')}</span>
              <span className="library-page-tip">
                <Kbd>
                  <MousePointerClick />
                  {t('desktop.library.rightClickKey')}
                </Kbd>
                <span>{t('desktop.library.rightClickHint')}</span>
              </span>
              <span className="library-page-tip">
                <FolderInput />
                <span>{t('desktop.folders.dragShortHint')}</span>
              </span>
            </span>
          }
          eyebrow={t('desktop.library.eyebrow')}
          title={getLibraryTitle(filter, folderFilter, viewMode, catalog, t)}
        />
        <div className="library-toolbar">
          <form className="search-control" onSubmit={applyLibrarySearch}>
            <SearchField
              appliedValue={query}
              clearLabel={t('desktop.library.clearSearch')}
              label={t('desktop.library.search')}
              onChange={setQueryDraft}
              onClear={clearLibrarySearch}
              placeholder={t('desktop.library.searchPlaceholder')}
              value={queryDraft}
            />
            <Button size="sm" type="submit" variant="outline">
              <Search />
              {t('common.filter')}
            </Button>
          </form>
          <div className="library-toolbar-meta">
            <span className="result-count">
              {plural(
                visibleSkills.length,
                'count.skill.one',
                'count.skill.other'
              )}
            </span>
            <div
              aria-label={t('desktop.library.viewMode')}
              className="library-view-switcher"
              role="group"
            >
              {(
                [
                  ['canvas', Grid2X2, t('desktop.library.viewCanvas')],
                  ['list', ListIcon, t('desktop.library.viewList')],
                  ['columns', Columns3, t('desktop.library.viewColumns')],
                ] as const
              ).map(([mode, Icon, label]) => (
                <Tooltip key={mode}>
                  <TooltipTrigger asChild>
                    <button
                      aria-label={label}
                      aria-pressed={viewMode === mode}
                      onClick={() => onViewModeChange(mode)}
                      type="button"
                    >
                      <Icon />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{label}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
          <div
            aria-label={t('desktop.library.updateLegend')}
            className="skill-update-legend"
          >
            {(
              [
                'current',
                'update-available',
                'missing',
                'unavailable',
                'unchecked',
              ] as const
            ).map((status) => (
              <SkillUpdateLegendItem
                active={updateFilter === status}
                count={updateStatusCounts[status]}
                key={status}
                onClick={() =>
                  setUpdateFilter((current) =>
                    current === status ? null : status
                  )
                }
                status={status}
              />
            ))}
          </div>
        </div>
        {viewMode === 'columns' && catalog && visibleSkills.length > 0 ? (
          <div
            aria-label={t('desktop.library.viewColumns')}
            className="skill-column-browser"
          >
            {folderColumns.map((column) => (
              <section
                className={cn(
                  'skill-folder-column',
                  folderFilter === column.key && 'is-active',
                  dropTarget === column.key && 'is-drop-target'
                )}
                key={column.key}
                onDragLeave={handleColumnDragLeave}
                onDragOver={(event) => handleColumnDragOver(event, column.key)}
                onDrop={(event) => handleColumnDrop(event, column.key)}
                style={
                  column.color
                    ? ({ '--folder-color': column.color } as CSSProperties)
                    : undefined
                }
              >
                <button
                  className="skill-folder-column-header"
                  onClick={() => setFolderFilter(column.key)}
                  type="button"
                >
                  {column.id ? <Folder /> : <FolderOpen />}
                  <span>{column.name}</span>
                  <b>{column.skills.length}</b>
                </button>
                <div className="skill-folder-column-list" role="list">
                  {column.skills.map((skill) => (
                    <SkillRow
                      busyAction={busyAction}
                      dragging={draggedSkillId === skill.id}
                      group={catalog.groups.find(
                        (group) => group.id === skill.groupId
                      )}
                      groups={catalog.groups}
                      key={skill.id}
                      moving={movingSkillId === skill.id}
                      onDragEnd={finishSkillDrag}
                      onDragStart={(event) => beginSkillDrag(event, skill.id)}
                      onMove={(folderId) =>
                        void moveSkillToFolder(skill.id, folderId)
                      }
                      onRemove={() => setSkillToRemove(skill)}
                      onSelect={() => onSelect(skill.id)}
                      onUpdate={() => onUpdate(skill.id)}
                      selected={selectedId === skill.id}
                      skill={skill}
                    />
                  ))}
                  {column.skills.length === 0 ? (
                    <div className="skill-folder-column-empty">
                      <FolderInput />
                      <span>{t('desktop.folders.dropHere')}</span>
                    </div>
                  ) : null}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="skill-list" data-view={viewMode} role="list">
            {!catalog && !error ? (
              <SkillsSkeleton layout="cards" view={viewMode} />
            ) : null}
            {error ? <ErrorState message={error} onRetry={onRetry} /> : null}
            {catalog && visibleSkills.length === 0 ? (
              <EmptyState
                folderEmpty={
                  !query &&
                  !updateFilter &&
                  folderFilter !== 'folder:all' &&
                  viewMode !== 'columns'
                }
                hasQuery={Boolean(query || updateFilter)}
                onAdd={onAdd}
              />
            ) : null}
            {visibleSkills.map((skill) => (
              <SkillRow
                busyAction={busyAction}
                dragging={draggedSkillId === skill.id}
                group={catalog?.groups.find(
                  (group) => group.id === skill.groupId
                )}
                groups={catalog?.groups ?? []}
                key={skill.id}
                moving={movingSkillId === skill.id}
                onDragEnd={finishSkillDrag}
                onDragStart={(event) => beginSkillDrag(event, skill.id)}
                onMove={(folderId) =>
                  void moveSkillToFolder(skill.id, folderId)
                }
                onRemove={() => setSkillToRemove(skill)}
                onSelect={() => onSelect(skill.id)}
                onUpdate={() => onUpdate(skill.id)}
                selected={selectedId === skill.id}
                skill={skill}
              />
            ))}
          </div>
        )}
      </section>
      <Inspector
        aiSettings={aiSettings}
        busyAction={busyAction}
        drawerContainer={drawerContainer}
        drawerWidth={drawerWidth}
        focusedAgents={focusedAgents}
        groups={catalog?.groups ?? []}
        onCatalogChange={onCatalogChange}
        onClose={onCloseSelection}
        onDrawerWidthChange={onDrawerWidthChange}
        onOpenAiSettings={onOpenAiSettings}
        onRemove={onRemove}
        onUpdate={onUpdate}
        skill={selectedSkill}
      />
      <CreateFolderDialog
        onCreated={(nextCatalog, folderId) => {
          onCatalogChange(nextCatalog)
          setFolderFilter(`folder:${folderId}`)
        }}
        onOpenChange={setCreateFolderOpen}
        open={createFolderOpen}
      />
      <Dialog
        onOpenChange={(open) => {
          if (!open) setSkillToRemove(null)
        }}
        open={Boolean(skillToRemove)}
      >
        <DialogContent className="max-w-sm" closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>
              {t('desktop.inspector.removeQuestion', {
                name: skillToRemove?.name ?? '',
              })}
            </DialogTitle>
            <DialogDescription>
              {skillToRemove?.scope === 'project'
                ? t('desktop.inspector.removeProjectDescription')
                : t('desktop.inspector.removeDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setSkillToRemove(null)} variant="ghost">
              {t('common.cancel')}
            </Button>
            <Button
              disabled={
                Boolean(skillToRemove) &&
                busyAction === `remove:${skillToRemove?.id}`
              }
              onClick={() => {
                if (!skillToRemove) return
                onRemove(skillToRemove.id)
                setSkillToRemove(null)
              }}
              variant="destructive"
            >
              <Trash2 />
              {t('desktop.inspector.removeSkill')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SkillUpdateLegendItem({
  active,
  count,
  onClick,
  status,
}: {
  active: boolean
  count: number
  onClick: () => void
  status: SkillUpdateStatus
}) {
  const { t } = useI18n()
  const label = getSkillUpdateStatusLabel(status, t)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-pressed={active}
          className="skill-update-legend-item"
          data-status={status}
          onClick={onClick}
          type="button"
        >
          <SkillUpdateGlyph status={status} />
          <span>{label}</span>
          <strong>{count}</strong>
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function Inspector({
  aiSettings,
  busyAction,
  drawerContainer,
  drawerWidth: storedDrawerWidth,
  focusedAgents,
  groups,
  onCatalogChange,
  onClose,
  onDrawerWidthChange,
  onOpenAiSettings,
  onRemove,
  onTranslateSkills,
  onUpdate,
  skill,
  translating = false,
}: {
  aiSettings: AiProviderSettingsStatus | null
  busyAction: string | null
  drawerContainer: HTMLElement | null
  drawerWidth: number
  focusedAgents: string[]
  groups: ShelfGroup[]
  onCatalogChange: (catalog: CatalogSnapshot) => void
  onClose: () => void
  onDrawerWidthChange: (width: number) => void
  onOpenAiSettings: () => void
  onRemove: (skillId: string) => void
  onTranslateSkills?: (
    skillIds: string[],
    language?: string,
    force?: boolean
  ) => boolean
  onUpdate: (skillId: string) => void
  skill: InstalledSkill | null
  translating?: boolean
}) {
  const { locale, t } = useI18n()
  const [tagDraft, setTagDraft] = useState('')
  const [removeOpen, setRemoveOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('info')
  const [showAllAgents, setShowAllAgents] = useState(false)
  const [drawerWidth, setDrawerWidth] = useState(() =>
    clampSkillDrawerWidth(
      storedDrawerWidth,
      getSkillDrawerContainerWidth(drawerContainer)
    )
  )
  const inspectorRef = useRef<HTMLDivElement | null>(null)
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const syncWidth = () => {
      setDrawerWidth(
        clampSkillDrawerWidth(
          storedDrawerWidth,
          getSkillDrawerContainerWidth(drawerContainer)
        )
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
  }, [drawerContainer, storedDrawerWidth])

  useEffect(
    () => () => {
      resizeCleanupRef.current?.()
    },
    []
  )

  useEffect(() => {
    setTagDraft('')
    setRemoveOpen(false)
    setActiveTab('info')
    setShowAllAgents(false)
  }, [skill?.id])

  if (!skill) return null

  const currentSkill = skill
  const focusedAgentNames = new Set(focusedAgents)
  const prioritizedAgents = [...skill.agents].sort((left, right) => {
    const focusDifference =
      Number(focusedAgentNames.has(right)) - Number(focusedAgentNames.has(left))
    return focusDifference || left.localeCompare(right)
  })
  const focusedInstalledAgents = prioritizedAgents.filter((agent) =>
    focusedAgentNames.has(agent)
  )
  const otherInstalledAgents = prioritizedAgents.filter(
    (agent) => !focusedAgentNames.has(agent)
  )
  const collapsedAgents = [
    ...focusedInstalledAgents,
    ...otherInstalledAgents.slice(
      0,
      Math.max(0, 4 - focusedInstalledAgents.length)
    ),
  ]
  const visibleAgents = showAllAgents ? prioritizedAgents : collapsedAgents
  const hiddenAgents = prioritizedAgents.filter(
    (agent) => !collapsedAgents.includes(agent)
  )

  async function saveOrganization(
    tags: string[],
    groupId = currentSkill.groupId
  ) {
    try {
      onCatalogChange(
        await window.skillShelf.saveOrganization({
          groupId,
          skillId: currentSkill.id,
          tags,
        })
      )
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    }
  }

  function addTag() {
    const tag = tagDraft.trim()
    if (!tag || currentSkill.tags.includes(tag)) return
    setTagDraft('')
    void saveOrganization([...currentSkill.tags, tag])
  }

  function commitDrawerWidth(width: number) {
    const nextWidth = clampSkillDrawerWidth(
      width,
      getSkillDrawerContainerWidth(drawerContainer)
    )
    setDrawerWidth(nextWidth)
    onDrawerWidthChange(nextWidth)
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
      latestWidth = clampSkillDrawerWidth(
        startWidth + startX - pointerEvent.clientX,
        getSkillDrawerContainerWidth(drawerContainer)
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
    const bounds = getSkillDrawerWidthBounds(
      getSkillDrawerContainerWidth(drawerContainer)
    )
    let nextWidth: number | null = null
    if (event.key === 'ArrowLeft') {
      nextWidth = drawerWidth + SKILL_DRAWER_KEYBOARD_STEP
    } else if (event.key === 'ArrowRight') {
      nextWidth = drawerWidth - SKILL_DRAWER_KEYBOARD_STEP
    } else if (event.key === 'Home') {
      nextWidth = bounds.min
    } else if (event.key === 'End') {
      nextWidth = bounds.max
    }
    if (nextWidth === null) return
    event.preventDefault()
    commitDrawerWidth(nextWidth)
  }

  const updating = busyAction === `update:${skill.id}`
  const removing = busyAction === `remove:${skill.id}`
  const updateCheckFresh = isSkillUpdateCheckFresh(skill.updateCheck)
  const updateDisabled =
    Boolean(busyAction) ||
    (updateCheckFresh && skill.updateCheck.status !== 'update-available')
  const drawerBounds = getSkillDrawerWidthBounds(
    getSkillDrawerContainerWidth(drawerContainer)
  )

  return (
    <Sheet
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open
    >
      <SheetContent
        className="skill-inspector skill-sheet-content"
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
        overlayMode="scoped"
        overlayClassName="skill-sheet-overlay"
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
              <BookOpen />
            </span>
            {t('desktop.inspector.installedSkill')}
          </div>
          <SheetTitle>{skill.name}</SheetTitle>
          <SheetDescription className="sr-only">
            {skill.description || t('desktop.inspector.noDescription')}
          </SheetDescription>
          <div className="inspector-actions">
            <Button
              onClick={() => void window.skillShelf.openSkillFolder(skill.id)}
              size="sm"
              variant="outline"
            >
              <FolderOpen />
              {t('common.openFolder')}
            </Button>
            {skill.sourceUrl ? (
              <Button
                onClick={() => void window.skillShelf.openSkillSource(skill.id)}
                size="sm"
                variant="ghost"
              >
                <ArrowUpRight />
                {t('common.source')}
              </Button>
            ) : null}
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
          <TabsContent className="inspector-scroll" value="info">
            <SkillDescriptionPanel
              key={`${skill.id}:${aiSettings?.targetLanguage ?? locale}`}
              onOpenAiSettings={onOpenAiSettings}
              onTranslate={(language, force) =>
                onTranslateSkills?.([skill.id], language, force) ?? false
              }
              settings={aiSettings}
              skill={skill}
              translating={translating}
            />
            <InspectorSection
              icon={<Boxes />}
              title={t('desktop.inspector.group')}
            >
              <Select
                onValueChange={(value) =>
                  void saveOrganization(
                    skill.tags,
                    value === 'none' ? null : value
                  )
                }
                value={skill.groupId ?? 'none'}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {t('desktop.inspector.ungrouped')}
                  </SelectItem>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </InspectorSection>
            <InspectorSection
              icon={<Tag />}
              title={t('desktop.inspector.tags')}
            >
              <div className="tag-editor">
                {skill.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                    <button
                      aria-label={t('desktop.inspector.removeTag', { tag })}
                      onClick={() =>
                        void saveOrganization(
                          skill.tags.filter((item) => item !== tag)
                        )
                      }
                      type="button"
                    >
                      <X />
                    </button>
                  </Badge>
                ))}
                <Input
                  aria-label={t('desktop.inspector.addTag')}
                  onBlur={addTag}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addTag()
                  }}
                  placeholder={
                    skill.tags.length
                      ? t('desktop.inspector.addAnotherTag')
                      : t('desktop.inspector.addTag')
                  }
                  value={tagDraft}
                />
              </div>
            </InspectorSection>
            <InspectorSection
              icon={<Users />}
              title={t('desktop.inspector.installedFor', {
                count: skill.agents.length,
              })}
            >
              <div className="agent-detail-list">
                {visibleAgents.map((agent) => (
                  <Badge
                    className={cn(
                      'agent-detail-badge',
                      focusedAgentNames.has(agent) && 'is-focused'
                    )}
                    key={agent}
                    variant="outline"
                  >
                    <i />
                    {agent}
                  </Badge>
                ))}
                {hiddenAgents.length > 0 && !showAllAgents ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        asChild
                        className="agent-detail-more"
                        variant="outline"
                      >
                        <button
                          aria-expanded={false}
                          onClick={() => setShowAllAgents(true)}
                          type="button"
                        >
                          +{hiddenAgents.length}
                          <ChevronDown />
                        </button>
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent className="agent-detail-more-tooltip">
                      {hiddenAgents.join(' · ')}
                    </TooltipContent>
                  </Tooltip>
                ) : hiddenAgents.length > 0 ? (
                  <Badge
                    asChild
                    className="agent-detail-more"
                    variant="outline"
                  >
                    <button
                      aria-expanded
                      onClick={() => setShowAllAgents(false)}
                      type="button"
                    >
                      {t('desktop.inspector.showLess')}
                      <ChevronUp />
                    </button>
                  </Badge>
                ) : null}
              </div>
            </InspectorSection>
            <div className="path-block">
              <div className="path-block-heading">
                <span>{t('desktop.inspector.localPath')}</span>
                <span data-kind={skill.installKind}>
                  {skill.installKind === 'symlink' ? (
                    <Link2 />
                  ) : skill.installKind === 'directory' ? (
                    <FolderOpen />
                  ) : (
                    <CircleQuestionMark />
                  )}
                  {skill.installKind === 'symlink'
                    ? t('desktop.library.installSymlink')
                    : skill.installKind === 'directory'
                      ? t('desktop.library.installDirectory')
                      : t('desktop.library.installUnknown')}
                </span>
              </div>
              <code>{skill.path}</code>
              {skill.installKind === 'symlink' && skill.linkTarget ? (
                <div className="path-block-target">
                  <span>{t('desktop.inspector.linkTarget')}</span>
                  <code>{skill.linkTarget}</code>
                </div>
              ) : null}
            </div>
          </TabsContent>
          <TabsContent className="skill-files-tab" value="files">
            <Suspense fallback={<FileBrowserSkeleton />}>
              <SkillFilesPanel skillId={skill.id} />
            </Suspense>
          </TabsContent>
        </Tabs>
        <div className="inspector-footer">
          <Button
            aria-busy={updating}
            disabled={updateDisabled}
            onClick={() => onUpdate(skill.id)}
            size="sm"
          >
            {updating ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            {updating
              ? t('desktop.library.updating')
              : updateCheckFresh
                ? t('desktop.inspector.update')
                : t('desktop.library.checkAndUpdate')}
          </Button>
          <Button onClick={() => setRemoveOpen(true)} size="sm" variant="ghost">
            <Trash2 />
            {t('desktop.inspector.remove')}
          </Button>
        </div>
        <Dialog onOpenChange={setRemoveOpen} open={removeOpen}>
          <DialogContent className="max-w-sm" closeLabel={t('common.close')}>
            <DialogHeader>
              <DialogTitle>
                {t('desktop.inspector.removeQuestion', { name: skill.name })}
              </DialogTitle>
              <DialogDescription>
                {skill.scope === 'global'
                  ? t('desktop.inspector.removeDescription')
                  : t('desktop.inspector.removeProjectDescription')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                disabled={removing}
                onClick={() => setRemoveOpen(false)}
                variant="ghost"
              >
                {t('common.cancel')}
              </Button>
              <Button
                disabled={removing}
                onClick={() => onRemove(skill.id)}
                variant="destructive"
              >
                {removing ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Trash2 />
                )}
                {t('desktop.inspector.removeSkill')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  )
}

function InspectorSection({
  children,
  icon,
  title,
}: {
  children: ReactNode
  icon: ReactNode
  title: string
}) {
  return (
    <section className="inspector-section">
      <h3>
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

function CreateFolderDialog({
  onCreated,
  onOpenChange,
  open,
  parentId = null,
  position = { x: 28, y: 28 },
  scopeKey = 'global',
}: {
  onCreated: (catalog: CatalogSnapshot, folderId: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  parentId?: string | null
  position?: CanvasPosition
  scopeKey?: ShelfScopeKey
}) {
  const { t } = useI18n()
  return (
    <FinderFolderDialog
      open={open}
      onOpenChange={onOpenChange}
      onSave={async (name, color) => {
        try {
          const catalog = await window.skillShelf.createGroup({
            name,
            color,
            parentId,
            position,
            scopeKey,
          })
          const folder = catalog.groups.find(
            (item) =>
              item.scopeKey === scopeKey &&
              item.parentId === parentId &&
              item.name.toLocaleLowerCase() === name.toLocaleLowerCase()
          )
          if (!folder) throw new Error('Created folder was not returned')
          onCreated(catalog, folder.id)
          toast.success(t('desktop.folders.created'))
          return true
        } catch (error) {
          toast.error(getLocalizedErrorMessage(error, t))
          return false
        }
      }}
    />
  )
}

function RenameFolderDialog({
  folder,
  onOpenChange,
  onRename,
}: {
  folder: ShelfGroup | null
  onOpenChange: (open: boolean) => void
  onRename: (folder: ShelfGroup, name: string) => Promise<boolean>
}) {
  return (
    <FinderFolderDialog
      open={!!folder}
      name={folder?.name}
      color={folder?.color}
      onOpenChange={onOpenChange}
      onSave={(name) =>
        folder ? onRename(folder, name) : Promise.resolve(false)
      }
    />
  )
}

export function WorkbenchWorkspace({
  focusedAgents,
  onCatalogChange,
  onManageAgents,
  onSnapshotChange,
  snapshot,
}: {
  focusedAgents: string[]
  onCatalogChange: (catalog: CatalogSnapshot) => void
  onManageAgents: () => void
  onSnapshotChange: (snapshot: WorkbenchSnapshot) => void
  snapshot: WorkbenchSnapshot | null
}) {
  const { date, number, t } = useI18n()
  const [loading, setLoading] = useState(!snapshot)
  const [error, setError] = useState<string | null>(null)
  const [untrackedOpen, setUntrackedOpen] = useState(false)
  const [untrackedBusy, setUntrackedBusy] = useState<string | null>(null)
  const initialScanStartedRef = useRef(false)

  const loadWorkbench = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.skillShelf.getWorkbench()
      onCatalogChange(result.catalog)
      onSnapshotChange(result.snapshot)
    } catch (caught) {
      setError(getLocalizedErrorMessage(caught, t))
    } finally {
      setLoading(false)
    }
  }, [onCatalogChange, onSnapshotChange, t])

  useEffect(() => {
    if (snapshot || initialScanStartedRef.current) return
    initialScanStartedRef.current = true
    void loadWorkbench()
  }, [loadWorkbench, snapshot])

  async function trackUntrackedSkills(skillIds: string[]) {
    if (loading || untrackedBusy || skillIds.length === 0) return
    setUntrackedBusy(skillIds.length === 1 ? skillIds[0]! : 'all')
    try {
      const nextCatalog = await window.skillShelf.trackSkills(skillIds)
      onCatalogChange(nextCatalog)
      if (snapshot) {
        onSnapshotChange({
          ...snapshot,
          untrackedSkills: nextCatalog.externalSkills,
        })
      }
      if (nextCatalog.externalSkills.length === 0) setUntrackedOpen(false)
      toast.success(
        t('desktop.workbench.untracked.recorded', { count: skillIds.length })
      )
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setUntrackedBusy(null)
    }
  }

  async function openDirectory(id: string) {
    try {
      await window.skillShelf.openWorkbenchDirectory(id)
    } catch (error) {
      toast.error(getLocalizedErrorMessage(error, t))
    }
  }

  return (
    <section className="workbench-workspace">
      <PageHeader
        actions={
          <Button
            disabled={loading}
            onClick={() => void loadWorkbench()}
            size="sm"
            variant="outline"
          >
            <RefreshCw className={cn(loading && 'animate-spin')} />
            {loading
              ? t('desktop.workbench.scanning')
              : t('desktop.workbench.refresh')}
          </Button>
        }
        className="workbench-page-header"
        description={t('desktop.workbench.description')}
        eyebrow={t('desktop.workbench.eyebrow')}
        title={t('desktop.workbench.title')}
      >
        {snapshot ? (
          <div className="workbench-scan-meta">
            <span className="status-dot" />
            {t('desktop.workbench.lastScanned', {
              time: date(snapshot.scannedAt, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }),
            })}
            <i />
            {t('desktop.workbench.localScan')}
          </div>
        ) : loading ? (
          <div
            aria-hidden="true"
            className="workbench-scan-meta skeleton-scan-meta"
          >
            <span className="skeleton-block" />
          </div>
        ) : null}
      </PageHeader>

      {loading && !snapshot ? <WorkbenchSkeleton /> : null}
      {error && !snapshot ? (
        <div className="workbench-error">
          <CircleAlert />
          <strong>{t('desktop.workbench.errorTitle')}</strong>
          <p>{error}</p>
          <Button onClick={() => void loadWorkbench()} size="sm">
            {t('common.tryAgain')}
          </Button>
        </div>
      ) : null}
      {snapshot ? (
        <div className={cn('workbench-board', loading && 'is-refreshing')}>
          {snapshot.untrackedSkills.length > 0 ? (
            <section className="workbench-untracked-notice">
              <span>
                <HardDrive />
              </span>
              <div>
                <strong>
                  {t('desktop.workbench.untracked.title', {
                    count: number(snapshot.untrackedSkills.length),
                  })}
                </strong>
                <small>{t('desktop.workbench.untracked.description')}</small>
              </div>
              <Button
                disabled={loading}
                onClick={() => setUntrackedOpen(true)}
                size="sm"
                variant="outline"
              >
                <PackagePlus />
                {t('desktop.workbench.untracked.action')}
              </Button>
            </section>
          ) : null}
          <WorkbenchOverview
            snapshot={snapshot}
            onOpenDirectory={openDirectory}
          />
          <AgentCoverageCard
            focusedAgents={focusedAgents}
            onManageAgents={onManageAgents}
            onOpenDirectory={openDirectory}
            snapshot={snapshot}
          />
          <WorkbenchFileChecks
            snapshot={snapshot}
            onOpenDirectory={openDirectory}
          />
        </div>
      ) : null}
      <UntrackedSkillsDialog
        busy={untrackedBusy ?? (loading ? 'scan' : null)}
        onOpenChange={setUntrackedOpen}
        onTrack={(skillIds) => void trackUntrackedSkills(skillIds)}
        open={untrackedOpen}
        skills={snapshot?.untrackedSkills ?? []}
      />
    </section>
  )
}

function SettingsWorkspace({
  aiSettings,
  catalog,
  onAiSettingsChange,
  onSectionChange,
  onSettingsChange,
  onSyncApplied,
  onWorkbenchSnapshotChange,
  runtime,
  section,
  settings,
  workbenchSnapshot,
}: {
  aiSettings: AiProviderSettingsStatus | null
  catalog: CatalogSnapshot | null
  onAiSettingsChange: (settings: AiProviderSettingsStatus) => void
  onSectionChange: (section: SettingsSection) => void
  onSettingsChange: (input: UpdateDesktopSettingsInput) => void
  onSyncApplied: (result: {
    catalog: CatalogSnapshot
    settings: DesktopSettings
    aiSettings?: AiProviderSettingsStatus
  }) => void
  onWorkbenchSnapshotChange: (snapshot: WorkbenchSnapshot) => void
  runtime: DesktopRuntimeInfo | null
  section: SettingsSection
  settings: DesktopSettings | null
  workbenchSnapshot: WorkbenchSnapshot | null
}) {
  const { t } = useI18n()
  const { state: appUpdate } = useAppUpdate()
  const updateNotice = hasAppUpdate(appUpdate)
    ? t('desktop.appUpdate.notification', { version: appUpdate?.version ?? '' })
    : undefined
  const applicationNavigation = [
    {
      id: 'general' as const,
      icon: SlidersHorizontal,
      label: t('desktop.settings.general'),
    },
    {
      id: 'appearance' as const,
      icon: Palette,
      label: t('desktop.settings.appearance'),
    },
    {
      id: 'shortcuts' as const,
      icon: Keyboard,
      label: t('desktop.settings.shortcuts'),
    },
    {
      id: 'skills-cli' as const,
      icon: HardDrive,
      label: t('desktop.settings.skillsCli'),
    },
    { id: 'sync' as const, icon: RefreshCw, label: t('desktop.sync.title') },
    { id: 'about' as const, icon: Info, label: t('desktop.settings.about') },
  ]
  const aiNavigation = [
    {
      id: 'ai-provider' as const,
      icon: Bot,
      label: t('desktop.settings.aiModelService'),
    },
    {
      id: 'ai-models' as const,
      icon: Boxes,
      label: t('desktop.settings.aiDefaultModels'),
    },
    {
      id: 'ai-behavior' as const,
      icon: Sparkles,
      label: t('desktop.settings.aiBehavior'),
    },
  ]

  return (
    <section className="settings-workspace">
      <nav
        aria-label={t('desktop.settings.categories')}
        className="settings-navigation"
      >
        <h1>{t('desktop.settings.title')}</h1>
        <p>{t('desktop.settings.app')}</p>
        {applicationNavigation.map((item) => {
          const notice = item.id === 'about' ? updateNotice : undefined
          const button = (
            <button
              aria-current={section === item.id ? 'page' : undefined}
              aria-label={notice ? `${item.label} · ${notice}` : undefined}
              key={item.id}
              onClick={() => onSectionChange(item.id)}
              type="button"
            >
              <item.icon />
              <span>{item.label}</span>
              {notice ? (
                <span
                  aria-hidden="true"
                  className="app-update-dot settings-update-dot"
                />
              ) : null}
            </button>
          )
          return notice ? (
            <Tooltip key={item.id}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="right">{notice}</TooltipContent>
            </Tooltip>
          ) : (
            button
          )
        })}
        <p className="settings-navigation-group">{t('desktop.settings.ai')}</p>
        {aiNavigation.map((item) => (
          <button
            aria-current={section === item.id ? 'page' : undefined}
            key={item.id}
            onClick={() => onSectionChange(item.id)}
            type="button"
          >
            <item.icon />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="settings-content">
        {section === 'general' ? (
          <GeneralSettings
            onChange={onSettingsChange}
            runtime={runtime}
            settings={settings}
          />
        ) : section === 'appearance' ? (
          <AppearanceSettings onChange={onSettingsChange} settings={settings} />
        ) : section === 'shortcuts' ? (
          <KeyboardShortcutsSettings runtime={runtime} />
        ) : section === 'skills-cli' ? (
          <SkillsSettings
            catalog={catalog}
            onChange={onSettingsChange}
            onWorkbenchSnapshotChange={onWorkbenchSnapshotChange}
            runtime={runtime}
            settings={settings}
            workbenchSnapshot={workbenchSnapshot}
          />
        ) : section === 'sync' ? (
          <SyncSettings onApplied={onSyncApplied} />
        ) : section === 'ai-provider' ? (
          <AiProviderSettingsPage
            onChange={onAiSettingsChange}
            settings={aiSettings}
          />
        ) : section === 'ai-models' ? (
          <AiDefaultModelsPage
            onChange={onAiSettingsChange}
            settings={aiSettings}
          />
        ) : section === 'ai-behavior' ? (
          <AiBehaviorSettingsPage
            onChange={onAiSettingsChange}
            settings={aiSettings}
          />
        ) : (
          <AboutSettings runtime={runtime} />
        )}
      </div>
    </section>
  )
}

function GeneralSettings({
  onChange,
  runtime,
  settings,
}: {
  onChange: (input: UpdateDesktopSettingsInput) => void
  runtime: DesktopRuntimeInfo | null
  settings: DesktopSettings | null
}) {
  const { t } = useI18n()
  return (
    <SettingsPage title={t('desktop.settings.general')}>
      <SettingsSection title={t('desktop.settings.startup')}>
        <SettingsRow
          description={t('desktop.settings.launchDescription')}
          label={t('desktop.settings.launch')}
        >
          <Switch
            aria-label={t('desktop.settings.launch')}
            checked={settings?.launchAtLogin ?? false}
            disabled={!runtime?.isPackaged || runtime.channel === 'development'}
            onCheckedChange={(launchAtLogin) => onChange({ launchAtLogin })}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  )
}

function AppearanceSettings({
  onChange,
  settings,
}: {
  onChange: (input: UpdateDesktopSettingsInput) => void
  settings: DesktopSettings | null
}) {
  const { t } = useI18n()
  return (
    <SettingsPage title={t('desktop.settings.appearance')}>
      <SettingsSection title={t('desktop.settings.interface')}>
        <SettingsRow
          description={t('desktop.settings.languageDescription')}
          label={t('desktop.settings.language')}
        >
          <Select
            onValueChange={(language) =>
              onChange({ language: language as DesktopSettings['language'] })
            }
            value={settings?.language ?? 'system'}
          >
            <SelectTrigger
              aria-label={t('desktop.settings.language')}
              className="setting-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t('language.system')}</SelectItem>
              <SelectItem value="en">{t('language.en')}</SelectItem>
              <SelectItem value="zh-CN">{t('language.zh-CN')}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          description={t('desktop.settings.themeDescription')}
          label={t('desktop.settings.theme')}
        >
          <ThemeToggle
            className="theme-setting"
            labels={{
              dark: t('theme.dark'),
              light: t('theme.light'),
              system: t('theme.system'),
            }}
            showLabel
          />
        </SettingsRow>
        <SettingsRow
          description={t('desktop.settings.densityDescription')}
          label={t('desktop.settings.density')}
        >
          <Tabs
            onValueChange={(density) =>
              onChange({ density: density as DesktopSettings['density'] })
            }
            value={settings?.density ?? 'comfortable'}
          >
            <TabsList>
              <TabsTrigger value="comfortable">
                {t('desktop.settings.comfortable')}
              </TabsTrigger>
              <TabsTrigger value="compact">
                {t('desktop.settings.compact')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  )
}

function KeyboardShortcutsSettings({
  runtime,
}: {
  runtime: DesktopRuntimeInfo | null
}) {
  const { t } = useI18n()
  const primaryModifier = runtime?.platform === 'darwin' ? '⌘' : 'Ctrl'

  return (
    <SettingsPage title={t('desktop.settings.shortcuts')}>
      <p className="shortcut-page-description">
        {t('desktop.settings.shortcutsDescription')}
      </p>
      <SettingsSection title={t('desktop.settings.shortcutAppPanels')}>
        <ShortcutRow
          description={t('desktop.settings.shortcutTerminalDescription')}
          keys={[primaryModifier, 'J']}
          label={t('desktop.settings.shortcutTerminal')}
        />
        <ShortcutRow
          description={t('desktop.settings.shortcutTerminalResizeDescription')}
          keys={['↑', '↓']}
          label={t('desktop.settings.shortcutTerminalResize')}
        />
      </SettingsSection>
      <SettingsSection title={t('desktop.settings.shortcutSkillBrowser')}>
        <ShortcutRow
          description={t('desktop.settings.shortcutSelectAllDescription')}
          keys={[primaryModifier, 'A']}
          label={t('desktop.settings.shortcutSelectAll')}
        />
        <ShortcutRow
          description={t('desktop.settings.shortcutRangeDescription')}
          keys={['Shift', t('desktop.settings.shortcutClick')]}
          label={t('desktop.settings.shortcutRange')}
        />
        <ShortcutRow
          description={t('desktop.settings.shortcutToggleDescription')}
          keys={[primaryModifier, t('desktop.settings.shortcutClick')]}
          label={t('desktop.settings.shortcutToggle')}
        />
        <ShortcutRow
          description={t('desktop.settings.shortcutClearDescription')}
          keys={['Esc']}
          label={t('desktop.settings.shortcutClear')}
        />
      </SettingsSection>
      <SettingsSection title={t('desktop.settings.shortcutAiAssistant')}>
        <ShortcutRow
          description={t('desktop.settings.shortcutSendDescription')}
          keys={['Enter']}
          label={t('desktop.settings.shortcutSend')}
        />
        <ShortcutRow
          description={t('desktop.settings.shortcutNewLineDescription')}
          keys={['Shift', 'Enter']}
          label={t('desktop.settings.shortcutNewLine')}
        />
        <ShortcutRow
          description={t('desktop.settings.shortcutCloseAiDescription')}
          keys={['Esc']}
          label={t('desktop.settings.shortcutCloseAi')}
        />
      </SettingsSection>
      <SettingsSection title={t('desktop.settings.shortcutDetailPanel')}>
        <ShortcutRow
          description={t('desktop.settings.shortcutResizeDescription')}
          keys={['←', '→']}
          label={t('desktop.settings.shortcutResize')}
        />
        <ShortcutRow
          description={t('desktop.settings.shortcutResizeBoundsDescription')}
          keys={['Home', 'End']}
          label={t('desktop.settings.shortcutResizeBounds')}
        />
      </SettingsSection>
    </SettingsPage>
  )
}

function ShortcutRow({
  description,
  keys,
  label,
}: {
  description: string
  keys: string[]
  label: string
}) {
  return (
    <SettingsRow description={description} label={label}>
      <KbdGroup className="shortcut-keys">
        {keys.map((key, index) => (
          <Kbd key={`${key}:${index}`}>{key}</Kbd>
        ))}
      </KbdGroup>
    </SettingsRow>
  )
}

function SkillsSettings({
  catalog,
  onChange,
  onWorkbenchSnapshotChange,
  runtime,
  settings,
  workbenchSnapshot,
}: {
  catalog: CatalogSnapshot | null
  onChange: (input: UpdateDesktopSettingsInput) => void
  onWorkbenchSnapshotChange: (snapshot: WorkbenchSnapshot) => void
  runtime: DesktopRuntimeInfo | null
  settings: DesktopSettings | null
  workbenchSnapshot: WorkbenchSnapshot | null
}) {
  const { number, t } = useI18n()
  const [agentDialogOpen, setAgentDialogOpen] = useState(false)
  const [agentQueryDraft, setAgentQueryDraft] = useState('')
  const [agentQuery, setAgentQuery] = useState('')
  const [registryLoading, setRegistryLoading] = useState(!workbenchSnapshot)
  const [registryError, setRegistryError] = useState(false)
  const roots = getSkillRoots(catalog?.skills ?? [])
  const focusedAgents = settings?.focusedAgents ?? []
  const focusedAgentSet = new Set(focusedAgents)
  const detectedAgentNames = new Set(
    workbenchSnapshot?.agentCoverage.map((agent) => agent.name) ?? []
  )
  const knownAgents = workbenchSnapshot?.registry.agents ?? []
  const normalizedAgentQuery = agentQuery.trim().toLocaleLowerCase()
  const visibleKnownAgents = knownAgents
    .filter(
      (agent) =>
        !normalizedAgentQuery ||
        agent.name.toLocaleLowerCase().includes(normalizedAgentQuery)
    )
    .sort((left, right) => {
      const focusedDifference =
        Number(focusedAgentSet.has(right.name)) -
        Number(focusedAgentSet.has(left.name))
      return focusedDifference || left.name.localeCompare(right.name)
    })
  const detectedAgents = visibleKnownAgents.filter((agent) =>
    detectedAgentNames.has(agent.name)
  )
  const otherAgents = visibleKnownAgents.filter(
    (agent) => !detectedAgentNames.has(agent.name)
  )

  useEffect(() => {
    if (workbenchSnapshot) {
      setRegistryLoading(false)
      setRegistryError(false)
      return
    }
    let active = true
    setRegistryLoading(true)
    setRegistryError(false)
    void window.skillShelf
      .getWorkbench()
      .then((result) => {
        if (active) onWorkbenchSnapshotChange(result.snapshot)
      })
      .catch(() => {
        if (active) setRegistryError(true)
      })
      .finally(() => {
        if (active) setRegistryLoading(false)
      })
    return () => {
      active = false
    }
  }, [onWorkbenchSnapshotChange, workbenchSnapshot])

  function toggleDefaultAgent(agentId: string) {
    const current = settings?.defaultAgents ?? ['*']
    if (agentId === '*') {
      onChange({ defaultAgents: ['*'] })
      return
    }
    const withoutAll = current.filter((id) => id !== '*')
    const next = withoutAll.includes(agentId)
      ? withoutAll.filter((id) => id !== agentId)
      : [...withoutAll, agentId]
    onChange({ defaultAgents: next.length ? next : ['*'] })
  }

  function toggleFocusedAgent(agentName: string) {
    if (focusedAgentSet.has(agentName)) {
      onChange({
        focusedAgents: focusedAgents.filter((name) => name !== agentName),
      })
      return
    }
    if (focusedAgents.length >= 12) return
    onChange({ focusedAgents: [...focusedAgents, agentName] })
  }

  function applyAgentSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAgentQuery(agentQueryDraft.trim())
  }

  function clearAgentSearch() {
    setAgentQueryDraft('')
    setAgentQuery('')
  }

  return (
    <SettingsPage
      status={
        catalog
          ? t('desktop.settings.cliReady')
          : t('desktop.settings.scanning')
      }
      title={t('desktop.settings.skillsCli')}
    >
      <SettingsSection title={t('desktop.settings.officialCli')}>
        <SettingsRow
          description={t('desktop.settings.detectedDescription', {
            count: catalog?.skills.length ?? 0,
          })}
          label={t('desktop.settings.detectedRoots')}
        >
          <div className="path-values">
            {roots.length ? (
              roots.map((root) => <code key={root}>{root}</code>)
            ) : (
              <span>{t('desktop.settings.noneYet')}</span>
            )}
          </div>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t('desktop.settings.defaultTargets')}>
        <div className="settings-agent-grid">
          {AGENT_OPTIONS.map((agent) => {
            const checked =
              settings?.defaultAgents.includes(agent.id) ?? agent.id === '*'
            return (
              <button
                aria-pressed={checked}
                className={cn(checked && 'is-selected')}
                key={agent.id}
                onClick={() => toggleDefaultAgent(agent.id)}
                type="button"
              >
                <span>{checked ? <Check /> : null}</span>
                {getAgentLabel(agent, t)}
              </button>
            )
          })}
        </div>
      </SettingsSection>
      <SettingsSection title={t('desktop.settings.focusedAgents')}>
        <SettingsRow
          description={t('desktop.settings.focusedAgentsDescription')}
          label={t('desktop.settings.focusedAgentsLabel')}
        >
          <div className="focused-agent-setting">
            <div className="focused-agent-summary">
              {focusedAgents.length ? (
                <>
                  {focusedAgents.slice(0, 3).map((agent) => (
                    <Badge key={agent} variant="secondary">
                      <Eye />
                      {agent}
                    </Badge>
                  ))}
                  {focusedAgents.length > 3 ? (
                    <Badge variant="outline">+{focusedAgents.length - 3}</Badge>
                  ) : null}
                </>
              ) : (
                <span>{t('desktop.settings.focusedAgentsAuto')}</span>
              )}
            </div>
            <Button
              disabled={registryLoading && knownAgents.length === 0}
              onClick={() => setAgentDialogOpen(true)}
              size="xs"
              variant="outline"
            >
              {registryLoading ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <SlidersHorizontal />
              )}
              {t('desktop.settings.manageAgents')}
            </Button>
          </div>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t('desktop.settings.data')}>
        <SettingsRow
          description={t('desktop.settings.localMetadataDescription')}
          label={t('desktop.settings.localMetadata')}
        >
          <div className="path-values">
            <code>{runtime?.shelfFilePath ?? t('common.loading')}</code>
            <Button
              onClick={() => void window.skillShelf.openDataFolder()}
              size="xs"
              variant="outline"
            >
              <FolderOpen />
              {t('common.openFolder')}
            </Button>
          </div>
        </SettingsRow>
      </SettingsSection>
      <Dialog
        onOpenChange={(open) => {
          setAgentDialogOpen(open)
          if (!open) clearAgentSearch()
        }}
        open={agentDialogOpen}
      >
        <DialogContent
          className="agent-focus-dialog"
          closeLabel={t('common.close')}
          onEscapeKeyDown={preserveSearchOnEscape}
        >
          <DialogHeader>
            <DialogTitle>{t('desktop.settings.focusedAgents')}</DialogTitle>
            <DialogDescription>
              {t('desktop.settings.focusedAgentsDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <form className="agent-focus-search" onSubmit={applyAgentSearch}>
            <SearchField
              appliedValue={agentQuery}
              className="agent-focus-search-field"
              autoFocus
              clearLabel={t('desktop.settings.clearAgentSearch')}
              label={t('desktop.settings.searchAgents')}
              onChange={setAgentQueryDraft}
              onClear={clearAgentSearch}
              placeholder={t('desktop.settings.searchAgents')}
              value={agentQueryDraft}
            />
            <Button size="sm" type="submit" variant="outline">
              <Search />
              {t('common.search')}
            </Button>
          </form>
          <div className="agent-focus-count">
            <span>
              {t('desktop.settings.focusedAgentsSelected', {
                count: number(focusedAgents.length),
              })}
            </span>
            {focusedAgents.length ? (
              <Button
                onClick={() => onChange({ focusedAgents: [] })}
                size="xs"
                variant="ghost"
              >
                {t('desktop.settings.clearFocusedAgents')}
              </Button>
            ) : null}
          </div>
          <div className="agent-focus-list">
            {registryError ? (
              <div className="agent-focus-empty">
                <CircleAlert />
                {t('desktop.settings.agentsUnavailable')}
              </div>
            ) : visibleKnownAgents.length ? (
              <>
                {detectedAgents.length ? (
                  <AgentFocusSection
                    agents={detectedAgents}
                    focusedAgentSet={focusedAgentSet}
                    label={t('desktop.settings.detectedAgents')}
                    limitReached={focusedAgents.length >= 12}
                    onToggle={toggleFocusedAgent}
                    statusLabel={t('desktop.settings.detectedOnThisMac')}
                  />
                ) : null}
                {otherAgents.length ? (
                  <AgentFocusSection
                    agents={otherAgents}
                    focusedAgentSet={focusedAgentSet}
                    label={t('desktop.settings.otherSupportedAgents')}
                    limitReached={focusedAgents.length >= 12}
                    onToggle={toggleFocusedAgent}
                    statusLabel={t('desktop.settings.supportedByCli')}
                  />
                ) : null}
              </>
            ) : (
              <div className="agent-focus-empty">
                <Search />
                {t('desktop.settings.noAgentResults')}
              </div>
            )}
          </div>
          <DialogFooter>
            <span className="agent-focus-limit">
              {t('desktop.settings.focusedAgentsLimit')}
            </span>
            <Button onClick={() => setAgentDialogOpen(false)} size="sm">
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  )
}

function AgentFocusSection({
  agents,
  focusedAgentSet,
  label,
  limitReached,
  onToggle,
  statusLabel,
}: {
  agents: Array<{ id: string; name: string }>
  focusedAgentSet: Set<string>
  label: string
  limitReached: boolean
  onToggle: (agentName: string) => void
  statusLabel: string
}) {
  return (
    <section className="agent-focus-section">
      <h4>{label}</h4>
      <div>
        {agents.map((agent) => {
          const selected = focusedAgentSet.has(agent.name)
          return (
            <button
              aria-pressed={selected}
              className={cn(selected && 'is-selected')}
              disabled={limitReached && !selected}
              key={agent.id}
              onClick={() => onToggle(agent.name)}
              type="button"
            >
              <span>{selected ? <Check /> : null}</span>
              <div>
                <strong>{agent.name}</strong>
                <small>{statusLabel}</small>
              </div>
              {selected ? <Eye /> : null}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function AiProviderSettingsPage({
  onChange,
  settings,
}: {
  onChange: (settings: AiProviderSettingsStatus) => void
  settings: AiProviderSettingsStatus | null
}) {
  const { t } = useI18n()
  const provider = aiProviderRegistry[0]
  const providerId = provider.id
  const connection = settings?.connections.find(
    (candidate) => candidate.provider === providerId
  )
  const [apiKey, setApiKey] = useState('')
  const [addingModel, setAddingModel] = useState(false)
  const [modelId, setModelId] = useState('')
  const [modelName, setModelName] = useState('')
  const [busy, setBusy] = useState<
    'clear' | 'models' | 'restore' | 'save' | 'toggle' | null
  >(null)
  const [verifyingModelId, setVerifyingModelId] = useState<string | null>(null)
  const availableModels =
    settings?.availableModels ??
    provider.models.map((model) => ({
      displayName: model.displayName,
      id: model.id,
      provider: providerId,
      verification: 'unverified' as const,
      verificationMessage: null,
      verifiedAt: null,
    }))

  useEffect(() => {
    setApiKey('')
    setAddingModel(false)
    setModelId('')
    setModelName('')
  }, [settings?.updatedAt])

  async function restorePreviousData() {
    setBusy('restore')
    try {
      onChange(await window.skillShelf.restorePreviousAiData())
      toast.success(t('desktop.settings.aiDataRestored'))
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
      onChange(await window.skillShelf.getAiProviderSettings())
    } finally {
      setBusy(null)
    }
  }

  async function saveConnection(event: FormEvent) {
    event.preventDefault()
    setBusy('save')
    try {
      const next = await window.skillShelf.saveAiProviderSettings({
        apiKey: apiKey.trim() || undefined,
        model:
          settings?.models.chat.model ?? defaultAiModelRoleSettings.chat.model,
        provider: providerId,
      })
      onChange(next)
      setApiKey('')
      toast.success(t('desktop.settings.aiSaved'))
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setBusy(null)
    }
  }

  async function setProviderEnabled(enabled: boolean) {
    if (!settings?.configured) return
    setBusy('toggle')
    try {
      const next = await window.skillShelf.saveAiProviderSettings({
        enabled,
        model: settings.models.chat.model,
        provider: providerId,
      })
      onChange(next)
      toast.success(
        t(
          enabled
            ? 'desktop.settings.aiProviderEnabledToast'
            : 'desktop.settings.aiProviderDisabledToast'
        )
      )
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setBusy(null)
    }
  }

  async function clearConfiguration() {
    setBusy('clear')
    try {
      onChange(await window.skillShelf.clearAiProviderSettings(providerId))
      setApiKey('')
      toast.success(t('desktop.settings.aiCleared'))
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setBusy(null)
    }
  }

  async function saveAvailableModels(
    models: AiProviderModelInput[],
    successMessage: string
  ) {
    setBusy('models')
    try {
      const next = await window.skillShelf.saveAiProviderSettings({
        availableModels: models,
        model:
          settings?.models.chat.model ?? defaultAiModelRoleSettings.chat.model,
        provider: providerId,
      })
      onChange(next)
      toast.success(successMessage)
      return true
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
      return false
    } finally {
      setBusy(null)
    }
  }

  async function addModel(event: FormEvent) {
    event.preventDefault()
    const id = modelId.trim()
    const displayName = modelName.trim() || id
    if (!id || availableModels.some((model) => model.id === id)) return
    const saved = await saveAvailableModels(
      [
        ...availableModels.map((model) => ({
          displayName: model.displayName,
          id: model.id,
        })),
        { displayName, id },
      ],
      t('desktop.settings.aiModelAdded', { model: displayName })
    )
    if (!saved) return
    setModelId('')
    setModelName('')
    setAddingModel(false)
  }

  async function removeModel(id: string) {
    if (availableModels.length <= 1) return
    const model = availableModels.find((candidate) => candidate.id === id)
    await saveAvailableModels(
      availableModels
        .filter((candidate) => candidate.id !== id)
        .map((candidate) => ({
          displayName: candidate.displayName,
          id: candidate.id,
        })),
      t('desktop.settings.aiModelRemoved', {
        model: model?.displayName ?? id,
      })
    )
  }

  async function verifyModel(model: AiProviderModelStatus) {
    setVerifyingModelId(model.id)
    try {
      const next = await window.skillShelf.verifyAiProvider({
        modelId: model.id,
        provider: providerId,
      })
      onChange(next)
      const result = next.availableModels.find(
        (candidate) => candidate.id === model.id
      )
      if (result?.verification === 'available') {
        toast.success(
          t('desktop.settings.aiVerified', { model: model.displayName })
        )
      } else {
        toast.error(
          getLocalizedErrorMessage(
            result?.verificationMessage ?? 'DeepSeek provider request failed',
            t
          )
        )
      }
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setVerifyingModelId(null)
    }
  }

  const providerState = connection?.enabled
    ? t('desktop.settings.aiProviderEnabled')
    : connection?.configured
      ? t('desktop.settings.aiProviderDisabled')
      : t('desktop.settings.aiNotConfigured')

  return (
    <div className="ai-provider-browser">
      <aside aria-label={t('desktop.settings.aiProviders')}>
        <p>{t('desktop.settings.aiProviders')}</p>
        <button aria-current="page" type="button">
          <span className="ai-provider-mark">
            <Sparkles />
          </span>
          <span>
            <strong>{provider.displayName}</strong>
            <small>{providerState}</small>
          </span>
          <i data-configured={connection?.enabled} />
        </button>
      </aside>
      <SettingsPage
        status={providerState}
        statusTone={connection?.enabled ? 'success' : 'muted'}
        title={provider.displayName}
      >
        {settings?.legacyDataAvailable ? (
          <div className="ai-settings-warning">
            <CircleAlert />
            <span>{t('desktop.settings.aiRestoreDescription')}</span>
            <Button
              disabled={Boolean(busy)}
              onClick={() => void restorePreviousData()}
              size="sm"
              type="button"
              variant="outline"
            >
              {busy === 'restore' ? (
                <LoaderCircle className="animate-spin" />
              ) : null}
              {t('desktop.settings.aiRestoreData')}
            </Button>
          </div>
        ) : null}
        {!settings?.localStorageAvailable ? (
          <div className="ai-settings-warning">
            <CircleAlert />
            <span>{t('desktop.settings.aiLocalStorageUnavailable')}</span>
          </div>
        ) : null}
        <form
          className="ai-provider-form"
          onSubmit={(event) => void saveConnection(event)}
        >
          <section className="ai-provider-section">
            <h3>{t('desktop.settings.aiServiceStatus')}</h3>
            <div className="setting-rows">
              <SettingsRow
                description={t('desktop.settings.aiEnabledDescription')}
                label={t('desktop.settings.aiEnableProvider', {
                  provider: provider.displayName,
                })}
              >
                <Switch
                  aria-label={t('desktop.settings.aiEnabled')}
                  checked={connection?.enabled ?? false}
                  disabled={!connection?.configured || Boolean(busy)}
                  onCheckedChange={(enabled) =>
                    void setProviderEnabled(enabled)
                  }
                />
              </SettingsRow>
            </div>
          </section>
          <section className="ai-provider-section">
            <h3>{t('desktop.settings.aiConnection')}</h3>
            <div className="setting-rows">
              <SettingsRow
                description={t('desktop.settings.aiApiKeyDescription')}
                label={t('desktop.settings.aiApiKey')}
              >
                <Input
                  autoComplete="off"
                  className="setting-input"
                  maxLength={512}
                  minLength={8}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    connection?.hasApiKey
                      ? t('desktop.settings.aiApiKeySaved')
                      : t('desktop.settings.aiApiKeyPlaceholder')
                  }
                  required={!connection?.hasApiKey}
                  type="password"
                  value={apiKey}
                />
              </SettingsRow>
            </div>
            <div className="ai-provider-actions">
              <a href={provider.apiKeyUrl} rel="noreferrer" target="_blank">
                {t('desktop.settings.aiGetApiKey')}
                <ArrowUpRight />
              </a>
              <div>
                {connection?.configured ? (
                  <Button
                    disabled={Boolean(busy)}
                    onClick={() => void clearConfiguration()}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 />
                    {t('desktop.settings.aiClear')}
                  </Button>
                ) : null}
                <Button
                  disabled={
                    Boolean(busy) ||
                    !settings?.localStorageAvailable ||
                    settings?.legacyDataAvailable
                  }
                  size="sm"
                  type="submit"
                >
                  {busy === 'save' ? (
                    <LoaderCircle className="animate-spin" />
                  ) : null}
                  {t('desktop.settings.aiSaveConnection')}
                </Button>
              </div>
            </div>
          </section>
        </form>
        <section className="ai-provider-section">
          <div className="ai-provider-section-heading">
            <div>
              <h3>{t('desktop.settings.aiModelList')}</h3>
              <p>{t('desktop.settings.aiModelListDescription')}</p>
            </div>
            <Button
              onClick={() => setAddingModel(true)}
              size="sm"
              variant="outline"
            >
              <Plus />
              {t('desktop.settings.aiAddModel')}
            </Button>
          </div>
          <div className="ai-provider-models">
            {availableModels.map((model) => (
              <div key={model.id}>
                <span>
                  <strong>{model.displayName}</strong>
                  <small>{model.id}</small>
                </span>
                <div>
                  <AiModelVerificationStatus model={model} />
                  <Button
                    disabled={
                      !connection?.configured ||
                      Boolean(busy) ||
                      verifyingModelId !== null
                    }
                    onClick={() => void verifyModel(model)}
                    size="sm"
                    variant="outline"
                  >
                    {verifyingModelId === model.id ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <ShieldCheck />
                    )}
                    {t('desktop.settings.aiVerify')}
                  </Button>
                  <Button
                    aria-label={t('desktop.settings.aiRemoveModel', {
                      model: model.displayName,
                    })}
                    disabled={
                      availableModels.length <= 1 ||
                      Boolean(busy) ||
                      verifyingModelId !== null
                    }
                    onClick={() => void removeModel(model.id)}
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
            {addingModel ? (
              <form
                className="ai-provider-model-add"
                onSubmit={(event) => void addModel(event)}
              >
                <label>
                  <span>{t('desktop.settings.aiModelId')}</span>
                  <Input
                    autoFocus
                    onChange={(event) => setModelId(event.target.value)}
                    placeholder="model-id"
                    value={modelId}
                  />
                </label>
                <label>
                  <span>{t('desktop.settings.aiModelName')}</span>
                  <Input
                    onChange={(event) => setModelName(event.target.value)}
                    placeholder={t('desktop.settings.aiModelNamePlaceholder')}
                    value={modelName}
                  />
                </label>
                <div>
                  <Button
                    onClick={() => setAddingModel(false)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    disabled={!modelId.trim() || Boolean(busy)}
                    size="sm"
                    type="submit"
                  >
                    {busy === 'models' ? (
                      <LoaderCircle className="animate-spin" />
                    ) : null}
                    {t('desktop.settings.aiAddModel')}
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        </section>
        <div className="privacy-card ai-privacy-card">
          <ShieldCheck />
          <div>
            <strong>{t('desktop.settings.aiPrivacyTitle')}</strong>
            <p>{t('desktop.settings.aiPrivacyDescription')}</p>
          </div>
        </div>
      </SettingsPage>
    </div>
  )
}

function AiModelVerificationStatus({
  model,
}: {
  model: AiProviderModelStatus
}) {
  const { t } = useI18n()
  if (model.verification === 'available') {
    return (
      <span className="ai-model-verification" data-state="available">
        <Check />
        {t('desktop.settings.aiModelAvailable')}
      </span>
    )
  }
  if (model.verification === 'unavailable') {
    return (
      <span
        className="ai-model-verification"
        data-state="unavailable"
        title={
          model.verificationMessage
            ? getLocalizedErrorMessage(model.verificationMessage, t)
            : undefined
        }
      >
        <CircleAlert />
        {t('desktop.settings.aiModelUnavailable')}
      </span>
    )
  }
  return (
    <span className="ai-model-verification" data-state="unverified">
      {t('desktop.settings.aiModelUnverified')}
    </span>
  )
}

function AiDefaultModelsPage({
  onChange,
  settings,
}: {
  onChange: (settings: AiProviderSettingsStatus) => void
  settings: AiProviderSettingsStatus | null
}) {
  const { t } = useI18n()
  const [models, setModels] = useState<AiModelRoleSettings>(
    settings?.models ?? defaultAiModelRoleSettings
  )
  const [saving, setSaving] = useState(false)
  const availableModels = useMemo(
    () =>
      (settings?.connections ?? []).flatMap((connection) =>
        connection.enabled
          ? connection.availableModels.map((model) => ({
              ...model,
              provider: connection.provider,
            }))
          : []
      ),
    [settings?.connections]
  )

  useEffect(() => {
    if (settings) setModels(settings.models)
  }, [settings])

  async function save() {
    if (!settings) return
    const chatConnection = settings.connections.find(
      (connection) => connection.provider === models.chat.provider
    )
    if (!chatConnection?.enabled) return
    setSaving(true)
    try {
      const next = await window.skillShelf.saveAiProviderSettings({
        availableModels: chatConnection.availableModels,
        model: models.chat.model,
        models,
        provider: models.chat.provider,
      })
      onChange(next)
      toast.success(t('desktop.settings.aiDefaultModelsSaved'))
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsPage title={t('desktop.settings.aiDefaultModels')}>
      {availableModels.length ? (
        <div className="setting-rows ai-model-role-list">
          <AiModelRoleRow
            availableModels={availableModels}
            description={t('desktop.settings.aiChatModelDescription')}
            label={t('desktop.settings.aiChatModel')}
            onChange={(selection) =>
              setModels((current) => ({ ...current, chat: selection }))
            }
            value={models.chat}
          />
          <AiModelRoleRow
            availableModels={availableModels}
            description={t('desktop.settings.aiAnalysisModelDescription')}
            label={t('desktop.settings.aiAnalysisModel')}
            onChange={(selection) =>
              setModels((current) => ({ ...current, analysis: selection }))
            }
            value={models.analysis}
          />
          <AiModelRoleRow
            availableModels={availableModels}
            description={t('desktop.settings.aiWritingModelDescription')}
            label={t('desktop.settings.aiWritingModel')}
            onChange={(selection) =>
              setModels((current) => ({ ...current, writing: selection }))
            }
            value={models.writing}
          />
        </div>
      ) : (
        <div className="ai-model-empty">
          <Boxes />
          <strong>{t('desktop.settings.aiNoModelsTitle')}</strong>
          <p>{t('desktop.settings.aiNoModelsDescription')}</p>
        </div>
      )}
      <div className="ai-settings-actions is-end">
        <Button
          disabled={!availableModels.length || saving}
          onClick={() => void save()}
          size="sm"
        >
          {saving ? <LoaderCircle className="animate-spin" /> : null}
          {t('desktop.settings.aiSaveDefaultModels')}
        </Button>
      </div>
    </SettingsPage>
  )
}

function AiModelRoleRow({
  availableModels,
  description,
  label,
  onChange,
  value,
}: {
  availableModels: Array<AiProviderModelInput & { provider: AiProviderId }>
  description: string
  label: string
  onChange: (selection: AiModelSelection) => void
  value: AiModelSelection
}) {
  return (
    <SettingsRow description={description} label={label}>
      <Select
        onValueChange={(next) => onChange(decodeModelSelection(next))}
        value={encodeModelSelection(value)}
      >
        <SelectTrigger className="ai-model-picker">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {availableModels.map((model) => (
            <SelectItem
              key={encodeModelSelection({
                model: model.id,
                provider: model.provider,
              })}
              value={encodeModelSelection({
                model: model.id,
                provider: model.provider,
              })}
            >
              <span className="ai-model-option">
                <strong>{model.displayName}</strong>
                <small>
                  {getProviderName(model.provider)} · {model.id}
                </small>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  )
}

function encodeModelSelection(selection: AiModelSelection): string {
  return `${selection.provider}:${selection.model}`
}

function decodeModelSelection(value: string): AiModelSelection {
  const separator = value.indexOf(':')
  return {
    model: value.slice(separator + 1),
    provider: value.slice(0, separator) as AiProviderId,
  }
}

function getProviderName(provider: AiProviderId): string {
  return (
    aiProviderRegistry.find((candidate) => candidate.id === provider)
      ?.displayName ?? provider
  )
}

function AiBehaviorSettingsPage({
  onChange,
  settings,
}: {
  onChange: (settings: AiProviderSettingsStatus) => void
  settings: AiProviderSettingsStatus | null
}) {
  const { t } = useI18n()
  const [targetLanguage, setTargetLanguage] = useState(
    settings?.targetLanguage ?? 'en'
  )
  const [contextMode, setContextMode] = useState(
    settings?.contextMode ?? 'relevant-text'
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!settings) return
    setTargetLanguage(settings.targetLanguage)
    setContextMode(settings.contextMode)
  }, [settings])

  async function save() {
    if (!settings) return
    setSaving(true)
    try {
      const next = await window.skillShelf.saveAiProviderSettings({
        contextMode,
        model: settings.model,
        provider: settings.provider,
        targetLanguage,
      })
      onChange(next)
      toast.success(t('desktop.settings.aiSaved'))
    } catch (caught) {
      toast.error(getLocalizedErrorMessage(caught, t))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsPage
      status={
        settings?.configured
          ? t('desktop.settings.aiReady')
          : t('desktop.settings.aiNotConfigured')
      }
      statusTone={settings?.configured ? 'success' : 'muted'}
      title={t('desktop.settings.aiBehavior')}
    >
      <p className="settings-page-description">
        {t('desktop.settings.aiBehaviorDescription')}
      </p>
      <SettingsSection title={t('desktop.settings.aiBehavior')}>
        <SettingsRow
          description={t('desktop.settings.aiDefaultLanguageDescription')}
          label={t('desktop.settings.aiDefaultLanguage')}
        >
          <Select onValueChange={setTargetLanguage} value={targetLanguage}>
            <SelectTrigger className="setting-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_LANGUAGE_OPTIONS.map((language) => (
                <SelectItem key={language.id} value={language.id}>
                  {t(language.key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          description={t('desktop.settings.aiContextDescription')}
          label={t('desktop.settings.aiContext')}
        >
          <Select
            onValueChange={(value) =>
              setContextMode(value as AiProviderSettingsStatus['contextMode'])
            }
            value={contextMode}
          >
            <SelectTrigger className="setting-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="skill-md">
                {t('desktop.settings.aiContextSkillMd')}
              </SelectItem>
              <SelectItem value="relevant-text">
                {t('desktop.settings.aiContextRelevant')}
              </SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>
      <div className="ai-settings-actions is-end">
        <Button
          disabled={!settings?.configured || saving}
          onClick={() => void save()}
          size="sm"
        >
          {saving ? <LoaderCircle className="animate-spin" /> : null}
          {t('desktop.settings.aiSave')}
        </Button>
      </div>
    </SettingsPage>
  )
}

function AboutSettings({ runtime }: { runtime: DesktopRuntimeInfo | null }) {
  const { t } = useI18n()
  return (
    <SettingsPage title={t('desktop.settings.about')}>
      <AboutAppCard runtime={runtime} />
      <SettingsSection title={t('desktop.about.dataBoundary')}>
        <div className="privacy-card">
          <ShieldCheck />
          <div>
            <strong>{t('desktop.about.privacyTitle')}</strong>
            <p>{t('desktop.about.privacyDescription')}</p>
          </div>
        </div>
      </SettingsSection>
      <div className="about-actions">
        <Button
          onClick={() => void window.skillShelf.openWebsite()}
          size="sm"
          variant="outline"
        >
          {t('desktop.about.visitSkills')}
          <ArrowUpRight />
        </Button>
      </div>
    </SettingsPage>
  )
}

function SettingsPage({
  children,
  status,
  statusTone = 'success',
  title,
}: {
  children: ReactNode
  status?: string
  statusTone?: 'muted' | 'success'
  title: string
}) {
  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <h2>{title}</h2>
        {status ? <span className={`is-${statusTone}`}>{status}</span> : null}
      </header>
      {children}
    </div>
  )
}

function SettingsSection({
  children,
  title,
}: {
  children: ReactNode
  title: string
}) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      <div className="setting-rows">{children}</div>
    </section>
  )
}

function SettingsRow({
  children,
  description,
  label,
}: {
  children: ReactNode
  description: string
  label: string
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        <small>{description}</small>
      </div>
      {children}
    </div>
  )
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="center-state">
      <span className="state-icon state-icon-error">
        <CircleAlert />
      </span>
      <strong>{t('desktop.library.errorTitle')}</strong>
      <p>{message}</p>
      <Button onClick={onRetry} size="sm">
        {t('common.tryAgain')}
      </Button>
    </div>
  )
}

function EmptyState({
  folderEmpty,
  hasQuery,
  onAdd,
}: {
  folderEmpty: boolean
  hasQuery: boolean
  onAdd: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="center-state">
      <span className="state-icon">
        {folderEmpty ? <FolderOpen /> : <Library />}
      </span>
      <strong>
        {folderEmpty
          ? t('desktop.folders.emptyTitle')
          : hasQuery
            ? t('desktop.library.noMatchesTitle')
            : t('desktop.library.emptyTitle')}
      </strong>
      <p>
        {folderEmpty
          ? t('desktop.folders.emptyDescription')
          : hasQuery
            ? t('desktop.library.noMatchesDescription')
            : t('desktop.library.emptyDescription')}
      </p>
      {!hasQuery && !folderEmpty ? (
        <Button onClick={onAdd} size="sm">
          <Plus />
          {t('desktop.library.addFirst')}
        </Button>
      ) : null}
    </div>
  )
}

function getLibraryTitle(
  filter: LibraryFilter,
  folderFilter: LibraryFolderFilter,
  viewMode: LibraryViewMode,
  catalog: CatalogSnapshot | null,
  t: ReturnType<typeof useI18n>['t']
) {
  const scopeTitle =
    filter === 'scope:global'
      ? t('desktop.library.global')
      : (catalog?.projects.find(
          (project) => project.id === filter.slice('project:'.length)
        )?.name ?? t('desktop.library.projectScope'))
  if (viewMode === 'columns' || folderFilter === 'folder:all') {
    return scopeTitle
  }
  if (folderFilter === 'folder:unfiled') return t('desktop.folders.unfiled')
  return (
    catalog?.groups.find(
      (folder) => folder.id === folderFilter.slice('folder:'.length)
    )?.name ?? scopeTitle
  )
}

function getLibraryScopeKey(filter: LibraryFilter): ShelfScopeKey {
  return filter === 'scope:global'
    ? 'global'
    : `project:${filter.slice('project:'.length)}`
}

function getScopeTitle(
  filter: LibraryFilter,
  catalog: CatalogSnapshot | null,
  t: ReturnType<typeof useI18n>['t']
) {
  if (filter === 'scope:global') return t('desktop.library.global')
  return (
    catalog?.projects.find(
      (project) => project.id === filter.slice('project:'.length)
    )?.name ?? t('desktop.library.projectScope')
  )
}

function getLibraryScopeSkills(
  skills: InstalledSkill[],
  filter: LibraryFilter
): InstalledSkill[] {
  if (filter === 'scope:global') {
    return skills.filter((skill) => skill.scope === 'global')
  }
  if (filter.startsWith('project:')) {
    const projectId = filter.slice('project:'.length)
    return skills.filter((skill) => skill.projectId === projectId)
  }
  return []
}

function getFolderSkills(
  skills: InstalledSkill[],
  filter: LibraryFolderFilter
): InstalledSkill[] {
  if (filter === 'folder:all') return skills
  if (filter === 'folder:unfiled') {
    return skills.filter((skill) => skill.groupId === null)
  }
  const folderId = filter.slice('folder:'.length)
  return skills.filter((skill) => skill.groupId === folderId)
}

function getSkillRoots(skills: InstalledSkill[]) {
  return Array.from(
    new Set(skills.map((skill) => skill.path.replace(/\/[^/]+$/, '')))
  ).sort()
}

function getAgentLabel(
  agent: (typeof AGENT_OPTIONS)[number],
  t: ReturnType<typeof useI18n>['t']
) {
  return agent.id === '*' ? t('desktop.install.allSupported') : agent.label
}

function getSkillUpdateStatusCounts(
  skills: InstalledSkill[]
): Record<SkillUpdateStatus, number> {
  const counts: Record<SkillUpdateStatus, number> = {
    current: 0,
    missing: 0,
    unavailable: 0,
    unchecked: 0,
    'update-available': 0,
  }
  for (const skill of skills) {
    counts[skill.updateCheck.status] += 1
  }
  return counts
}
