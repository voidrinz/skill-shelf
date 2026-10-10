import { FinderFolderDialog } from './finder-folder-dialog'
import {
  useId,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { FolderOpen, Link2, PencilLine, Rocket, Trash2 } from 'lucide-react'
import {
  Button,
  ContextMenuItem,
  ContextMenuSeparator,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'
import type {
  CanvasPosition,
  FinderSortKey,
  FinderViewOptions,
  InstalledSkill,
  LibraryViewMode,
  ManagedSkill,
  SaveSkillPackInput,
  ShelfGroup,
  SkillPack,
  SkillPackGroup,
} from '../../shared/desktop-contract'
import { packFolderDescendants, packFolderPath } from '../../shared/pack-layout'
import {
  FinderActionsContext,
  FinderCanvas,
  FinderListView,
  getFolderBreadcrumbs,
} from './finder-views'
import { FinderToolbar } from './finder-toolbar'
import {
  getFinderCanvasGridPosition,
  getNearestAvailableFinderGridPosition,
  initialFinderNavigation,
  reduceFinderNavigation,
  sortFinderItems,
  sortFinderItemsByCanvasPosition,
} from './finder-interactions'

export function PackContents({
  pack,
  skills,
  query,
  busy,
  onSave,
  onInspect,
  onDeploy,
  onDelete,
  onOpenFolder,
  onFolderChange,
  onClearSearch,
  searchToolbar,
}: {
  searchToolbar?: ReactNode
  pack: SkillPack
  skills: ManagedSkill[]
  query: string
  busy: boolean
  onSave: (input: SaveSkillPackInput) => Promise<boolean>
  onInspect: (skill: ManagedSkill) => void
  onDeploy: (skill: ManagedSkill) => void
  onDelete: (skill: ManagedSkill) => void
  onOpenFolder: (skillId: string) => void
  onFolderChange: (folderId: string | null) => void
  onClearSearch: () => void
}) {
  const { locale, t } = useI18n()
  const [navigation, navigate] = useReducer(
    reduceFinderNavigation,
    initialFinderNavigation
  )
  const requestedFolderId = navigation.entries[navigation.index] ?? null
  const [draft, setDraft] = useState(pack)
  const draftRef = useRef(draft)
  const pending = useRef(false)
  const committedRef = useRef(pack)
  committedRef.current = pack
  const responders = useRef<Array<(value: boolean) => void>>([])
  const queue = useRef<Promise<void>>(Promise.resolve())
  const queued = useRef(false)
  const saveVersion = useRef(0)
  const [canvasRevision, setCanvasRevision] = useState(0)
  useEffect(() => {
    if (!pending.current) {
      draftRef.current = pack
      setDraft(pack)
    }
  }, [pack])
  function save(patch: Partial<SaveSkillPackInput>) {
    // Batch one drag's item updates and serialize saves to keep replies in order.
    draftRef.current = { ...draftRef.current, ...patch }
    setDraft(draftRef.current)
    pending.current = true
    const result = new Promise<boolean>((resolve) =>
      responders.current.push(resolve)
    )
    if (queued.current) return result
    queued.current = true
    queueMicrotask(() => {
      queued.current = false
      const next = draftRef.current
      const version = ++saveVersion.current
      const waiting = responders.current.splice(0)
      queue.current = queue.current.then(async () => {
        const success = await onSave(next)
        waiting.forEach((resolve) => resolve(success))
        if (success) committedRef.current = next
        if (version !== saveVersion.current) return
        pending.current = false
        if (!success) {
          draftRef.current = committedRef.current
          setDraft(committedRef.current)
          setCanvasRevision((value) => value + 1)
        }
      })
    })
    return result
  }
  const groups = draft.groups ?? []
  const folderId = groups.some((folder) => folder.id === requestedFolderId)
    ? requestedFolderId
    : null
  useLayoutEffect(() => onFolderChange(folderId), [folderId, onFolderChange])
  const [folderDialog, setFolderDialog] = useState<{
    folder?: SkillPackGroup
    position?: CanvasPosition
  } | null>(null)
  const [organizing, setOrganizing] = useState<ManagedSkill | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const location = folderId ?? 'root'
  const options: FinderViewOptions = draft.viewOptions?.[location] ?? {
    alignToGrid: false,
    groupBy: 'kind',
    useGroups: false,
    sortBy: draft.sort === 'manual' || !draft.sort ? 'none' : 'name',
    sortDirection: draft.sort === 'name-desc' ? 'descending' : 'ascending',
    viewMode: 'canvas',
  }
  function changeOptions(patch: Partial<FinderViewOptions>) {
    save({
      viewOptions: {
        ...draftRef.current.viewOptions,
        [location]: { ...options, ...patch },
      },
    })
  }
  const folders: ShelfGroup[] = groups.map((folder) => ({
    ...folder,
    color: folder.color ?? '#7b9ab8',
    parentId: folder.parentId ?? null,
    position: folder.position ?? null,
    scopeKey: 'global',
  }))
  const members: InstalledSkill[] = useMemo(
    () =>
      draft.skillIds.flatMap((id) => {
        const skill = skills.find((item) => item.id === id)
        if (!skill) return []
        const organization = draft.organization?.[id]
        return [
          {
            id,
            name: skill.name,
            description: skill.description,
            path: skill.managedPath,
            scope: 'global' as const,
            agents: [],
            installKind: 'directory' as const,
            source: skill.sourcePath,
            groupId: organization?.groupId ?? null,
            tags: organization?.tags ?? [],
            position: organization?.position ?? null,
            descriptions: {},
            translations: {},
            updateCheck: {
              status: 'unchecked' as const,
              reason: 'local-source' as const,
            },
          },
        ]
      }),
    [draft, skills]
  )
  const normalizedQuery = query.trim().toLocaleLowerCase(locale)
  const visibleFolders = folders.filter((folder) =>
    normalizedQuery
      ? folder.name.toLocaleLowerCase(locale).includes(normalizedQuery)
      : folder.parentId === folderId
  )
  const visibleSkills = members.filter((skill) =>
    normalizedQuery
      ? [skill.name, skill.description, ...skill.tags]
          .join(' ')
          .toLocaleLowerCase(locale)
          .includes(normalizedQuery)
      : skill.groupId === folderId
  )
  const openFolder = (id: string | null) =>
    navigate({ type: 'navigate', location: id })
  function moveSkill(
    skill: InstalledSkill,
    groupId: string | null,
    position: CanvasPosition
  ) {
    const current = draftRef.current
    save({
      organization: {
        ...current.organization,
        [skill.id]: {
          ...current.organization?.[skill.id],
          groupId,
          tags: current.organization?.[skill.id]?.tags ?? [],
          position,
        },
      },
    })
  }
  function moveFolder(
    folder: ShelfGroup,
    parentId: string | null,
    position: CanvasPosition
  ) {
    const current = draftRef.current
    if (
      parentId &&
      packFolderDescendants(current.groups ?? [], folder.id).has(parentId)
    )
      return
    if (
      (current.groups ?? []).some(
        (item) =>
          item.id !== folder.id &&
          (item.parentId ?? null) === parentId &&
          item.name.toLocaleLowerCase(locale) ===
            folder.name.toLocaleLowerCase(locale)
      )
    )
      return
    save({
      groups: (current.groups ?? []).map((item) =>
        item.id === folder.id ? { ...item, parentId, position } : item
      ),
    })
  }
  function cleanUp(mode: FinderSortKey | 'position') {
    const items = [
      ...visibleFolders.map((folder) => ({
        kind: 'folder' as const,
        folder,
        key: `folder:${folder.id}`,
        name: folder.name,
        position: folder.position,
      })),
      ...visibleSkills.map((skill) => ({
        kind: 'skill' as const,
        skill,
        key: `skill:${skill.id}`,
        name: skill.name,
        tags: skill.tags,
        source: skill.source,
        updateStatus: skill.updateCheck.status,
        position: skill.position,
      })),
    ]
    const ordered =
      mode === 'position'
        ? sortFinderItemsByCanvasPosition(items)
        : sortFinderItems(items, mode, 'ascending', locale)
    const positions = new Map(
      ordered.map((item, index) => [
        item.key,
        getFinderCanvasGridPosition(index, 800),
      ])
    )
    save({
      groups: groups.map((folder) =>
        positions.has(`folder:${folder.id}`)
          ? { ...folder, position: positions.get(`folder:${folder.id}`)! }
          : folder
      ),
      organization: {
        ...draft.organization,
        ...Object.fromEntries(
          visibleSkills.map((skill) => [
            skill.id,
            {
              ...draft.organization?.[skill.id],
              groupId: skill.groupId,
              tags: skill.tags,
              position: positions.get(`skill:${skill.id}`)!,
            },
          ])
        ),
      },
    })
  }
  function inspect(id: string) {
    const skill = skills.find((item) => item.id === id)
    if (skill) {
      setSelectedId(id)
      onInspect(skill)
    }
  }
  function deleteFolder(folder: ShelfGroup) {
    const descendants = packFolderDescendants(groups, folder.id)
    const parentId = folder.parentId
    save({
      groups: groups.filter((item) => !descendants.has(item.id)),
      organization: Object.fromEntries(
        Object.entries(draft.organization ?? {}).map(([id, value]) => [
          id,
          value.groupId && descendants.has(value.groupId)
            ? { ...value, groupId: parentId, position: null }
            : value,
        ])
      ),
    })
    if (folderId && descendants.has(folderId)) openFolder(parentId)
  }
  const actions = {
    rootLabel: pack.name,
    skillDecoration: (id: string) => {
      const links =
        skills
          .find((skill) => skill.id === id)
          ?.deployments.filter((deployment) => deployment.mode === 'symlink')
          .length ?? 0
      if (!links) return null
      const label = t('desktop.managed.linkedLocationCount', { count: links })
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="finder-skill-link-indicator"
              aria-label={label}
              role="img"
            >
              <Link2 />
            </span>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      )
    },
    openSkillFolder: onOpenFolder,
    skillActions: (id: string, selectedIds: string[]) => {
      if (selectedIds.length > 1) return null
      const skill = skills.find((item) => item.id === id)
      return skill ? (
        <>
          {options.viewMode === 'canvas' ? (
            <ContextMenuItem onSelect={() => inspect(id)}>
              {t('desktop.library.viewDetails')}
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem onSelect={() => setOrganizing(skill)}>
            <PencilLine />
            {t('desktop.managed.organizeSkill', { name: skill.name })}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onDeploy(skill)}>
            <Rocket />
            {t('desktop.managed.deploy')}
          </ContextMenuItem>
          {options.viewMode === 'canvas' ? (
            <ContextMenuItem onSelect={() => onOpenFolder(id)}>
              <FolderOpen />
              {t('common.openFolder')}
            </ContextMenuItem>
          ) : null}
          <ContextMenuSeparator />
          <ContextMenuItem
            className="skill-context-menu-destructive"
            onSelect={() => onDelete(skill)}
          >
            <Trash2 />
            {t('desktop.managed.delete')}
          </ContextMenuItem>
        </>
      ) : null
    },
    folderActions: (folder: ShelfGroup) => (
      <ContextMenuItem
        className="skill-context-menu-destructive"
        onSelect={() => deleteFolder(folder)}
      >
        <Trash2 />
        {t('desktop.managed.deleteFolder')}
      </ContextMenuItem>
    ),
  }
  const common = {
    allFolders: folders,
    allSkills: members,
    busyAction: busy ? 'managed' : null,
    currentFolderId: folderId,
    filtering: !!normalizedQuery,
    folders: visibleFolders,
    groupBy: options.groupBy,
    sortBy: options.sortBy,
    sortDirection: options.sortDirection,
    useGroups: options.useGroups && !normalizedQuery,
    selectedId,
    skills: visibleSkills,
    onCloseSelection: () => setSelectedId(null),
    onEnterFolder: openFolder,
    onGroupChange: (groupBy: FinderSortKey | 'none') =>
      changeOptions(
        groupBy === 'none' ? { useGroups: false } : { useGroups: true, groupBy }
      ),
    onSortChange: (sortBy: FinderSortKey | 'none') => changeOptions({ sortBy }),
    onSortDirectionChange: (
      sortDirection: FinderViewOptions['sortDirection']
    ) => changeOptions({ sortDirection }),
    onViewModeChange: (viewMode: LibraryViewMode) =>
      changeOptions({ viewMode }),
    onRenameFolder: (folder: ShelfGroup) => setFolderDialog({ folder }),
    onSelectSkill: inspect,
    onRemoveSkill: (skill: InstalledSkill) => {
      const managed = skills.find((item) => item.id === skill.id)
      if (managed) onDelete(managed)
    },
    onImportSkills: () => {},
    onTranslateSkills: () => {},
    onUpdateSkill: () => {},
  }
  return (
    <div className="pack-finder">
      <FinderToolbar
        rootTitle={pack.name}
        breadcrumbs={getFolderBreadcrumbs(folderId, folders)}
        finderNavigation={navigation}
        navigateFinder={navigate}
        openFolder={openFolder}
        viewMode={options.viewMode}
        changeCurrentFinderViewMode={common.onViewModeChange}
        filtering={!!normalizedQuery}
        finderUsesGroups={options.useGroups}
        finderGroupBy={options.groupBy}
        finderSortBy={options.sortBy}
        finderSortDirection={options.sortDirection}
        changeCurrentFinderGroup={common.onGroupChange}
        changeCurrentFinderSort={common.onSortChange}
        changeCurrentFinderSortDirection={common.onSortDirectionChange}
        cleanUpCurrentFolder={cleanUp}
        openCreateFolder={() => setFolderDialog({})}
        itemCount={visibleFolders.length + visibleSkills.length}
      />
      {searchToolbar}
      <div className="finder-content pack-finder-body">
        <FinderActionsContext value={actions}>
          {options.viewMode === 'canvas' && !normalizedQuery ? (
            <FinderCanvas
              key={canvasRevision}
              {...common}
              alignToGrid={options.alignToGrid}
              scopeKey="global"
              onAlignToGridChange={(alignToGrid) =>
                changeOptions({ alignToGrid })
              }
              onCleanUp={cleanUp}
              onCreateFolder={(position) => setFolderDialog({ position })}
              onFolderMove={moveFolder}
              onSkillMove={moveSkill}
            />
          ) : (
            <FinderListView
              {...common}
              contextSkills={members}
              groups={folders}
              onCreateFolder={() => setFolderDialog({})}
              onMoveSkill={moveSkill}
              resultsLabel={t('desktop.library.filteredResults')}
              viewMode={options.viewMode}
            />
          )}
        </FinderActionsContext>
        {visibleFolders.length + visibleSkills.length === 0 ? (
          <div className="managed-state">
            <strong>
              {t(
                normalizedQuery
                  ? 'desktop.managed.noSearchResults'
                  : 'desktop.managed.emptyTitle'
              )}
            </strong>
            {normalizedQuery ? (
              <Button onClick={onClearSearch}>
                {t('desktop.managed.clearSearch')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {folderDialog ? (
        <FinderFolderDialog
          open
          name={folderDialog.folder?.name}
          color={folderDialog.folder?.color}
          existingNames={groups
            .filter(
              (item) =>
                item.id !== folderDialog.folder?.id &&
                (item.parentId ?? null) ===
                  (folderDialog.folder
                    ? (folderDialog.folder.parentId ?? null)
                    : folderId)
            )
            .map((item) => item.name)}
          onOpenChange={(open) => {
            if (!open) setFolderDialog(null)
          }}
          onSave={async (name, color) => {
            const folder = folderDialog.folder
            const position =
              folderDialog.position ??
              getNearestAvailableFinderGridPosition(
                { x: 28, y: 24 },
                [...visibleFolders, ...visibleSkills].flatMap((item) =>
                  item.position ? [item.position] : []
                )
              )
            return save({
              groups: folder
                ? groups.map((item) =>
                    item.id === folder.id ? { ...item, name } : item
                  )
                : [
                    ...groups,
                    {
                      id: crypto.randomUUID(),
                      name,
                      color,
                      parentId: folderId,
                      position,
                    },
                  ],
            })
          }}
        />
      ) : null}
      {organizing ? (
        <PackSkillDialog
          key={organizing.id}
          pack={draft}
          skill={organizing}
          busy={busy}
          onClose={() => setOrganizing(null)}
          onSave={async (groupId, tags) => {
            const previous = draft.organization?.[organizing.id]
            save({
              organization: {
                ...draft.organization,
                [organizing.id]: {
                  ...previous,
                  groupId,
                  tags,
                  ...((previous?.groupId ?? null) !== groupId
                    ? { position: null }
                    : {}),
                },
              },
            })
            setOrganizing(null)
          }}
        />
      ) : null}
    </div>
  )
}

function PackSkillDialog({
  pack,
  skill,
  busy,
  onClose,
  onSave,
}: {
  pack: SkillPack
  skill: ManagedSkill
  busy: boolean
  onClose: () => void
  onSave: (groupId: string | null, tags: string[]) => Promise<void>
}) {
  const { t } = useI18n()
  const tagsHintId = useId()
  const [groupId, setGroupId] = useState(
    pack.organization?.[skill.id]?.groupId ?? 'ungrouped'
  )
  const [tagText, setTagText] = useState(
    (pack.organization?.[skill.id]?.tags ?? []).join(', ')
  )
  const tags = [
    ...new Set(
      tagText
        .split(/[,\uFF0C]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    ),
  ]
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="managed-dialog" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {t('desktop.managed.organizeSkill', { name: skill.name })}
          </DialogTitle>
          <DialogDescription>
            {t('desktop.managed.organizeDescription')}
          </DialogDescription>
        </DialogHeader>
        <label className="pack-field">
          <span>{t('desktop.managed.folder')}</span>
          <Select disabled={busy} value={groupId} onValueChange={setGroupId}>
            <SelectTrigger aria-label={t('desktop.managed.folder')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ungrouped">{pack.name}</SelectItem>
              {(pack.groups ?? []).map((group) => (
                <SelectItem value={group.id} key={group.id}>
                  {packFolderPath(pack.groups ?? [], group.id).join(' / ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="pack-field">
          <span>{t('desktop.managed.tags')}</span>
          <Input
            aria-label={t('desktop.managed.tags')}
            aria-describedby={tagsHintId}
            disabled={busy}
            maxLength={500}
            value={tagText}
            onChange={(event) => setTagText(event.target.value)}
          />
          <small id={tagsHintId}>{t('desktop.managed.tagsHint')}</small>
        </label>
        <DialogFooter>
          <Button disabled={busy} variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={
              busy || tags.length > 12 || tags.some((tag) => tag.length > 32)
            }
            onClick={() =>
              void onSave(groupId === 'ungrouped' ? null : groupId, tags)
            }
          >
            {t('desktop.managed.savePack')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
