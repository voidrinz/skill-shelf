import { createContext, useContext, type ReactNode } from 'react'
import {
  FinderCanvasItem,
  type FinderCanvasItemKey,
  type FinderCanvasDragItem,
} from './finder-canvas-item'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  ArrowDown,
  ArrowUpDown,
  ArrowUpRight,
  Boxes,
  Braces,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleArrowUp,
  CircleCheck,
  CircleDashed,
  CircleQuestionMark,
  CircleX,
  Columns3,
  Folder,
  FolderInput,
  FolderPlus,
  FolderOpen,
  HardDrive,
  Info,
  Grid2X2,
  Languages,
  List as ListIcon,
  Link2,
  LoaderCircle,
  PackagePlus,
  PencilLine,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import {
  Badge,
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'
import type {
  CanvasPosition,
  FinderSortDirection,
  FinderSortKey,
  InstalledSkill,
  LibraryViewMode,
  SkillUpdateCheck,
  SkillUpdateStatus,
  ShelfGroup,
  ShelfScopeKey,
} from '../../shared/desktop-contract'
import { MouseHoverCard } from './mouse-hover-card'
import {
  finderRectanglesIntersect,
  getFinderCanvasGroupLayout,
  getFinderDraggedSkillKeys,
  getFinderCanvasGridPosition,
  getFinderSelectionSkillIds,
  getFinderSelectionRange,
  getNearestAvailableFinderGridPosition,
  groupFinderItems,
  isFinderPlainSelection,
  normalizeFinderRectangle,
  resolveFinderContextSelection,
  resolveFinderSelection,
  sortFinderItems,
  type FinderSelectionMode,
} from './finder-interactions'
import {
  getSkillDescription,
  resolveSkillDescription,
} from './skill-description'
import { isSkillUpdateCheckFresh } from './skill-update-policy'

export const FinderActionsContext = createContext<{
  rootLabel?: string
  skillDecoration?: (id: string) => ReactNode
  openSkillFolder?: (id: string) => void
  skillActions?: (id: string, selectedIds: string[]) => ReactNode
  folderActions?: (folder: ShelfGroup, selectedIds: string[]) => ReactNode
} | null>(null)

export function FinderCanvas({
  alignToGrid,
  allFolders,
  allSkills,
  busyAction,
  currentFolderId,
  filtering,
  folders,
  groupBy,
  onAlignToGridChange,
  onCloseSelection,
  onCleanUp,
  onCreateFolder,
  onEnterFolder,
  onFolderMove,
  onGroupChange,
  onImportSkills,
  onRenameFolder,
  onRemoveSkill,
  onSelectSkill,
  onSkillMove,
  onSortChange,
  onSortDirectionChange,
  onTranslateSkills,
  onUpdateSkill,
  onViewModeChange,
  scopeKey,
  selectedId,
  skills,
  sortBy,
  sortDirection,
  useGroups,
}: {
  alignToGrid: boolean
  allFolders: ShelfGroup[]
  allSkills: InstalledSkill[]
  busyAction: string | null
  currentFolderId: string | null
  filtering: boolean
  folders: ShelfGroup[]
  groupBy: FinderSortKey
  onAlignToGridChange: (alignToGrid: boolean) => void
  onCloseSelection: () => void
  onCleanUp: (mode: FinderSortKey | 'position') => void
  onCreateFolder: (position: CanvasPosition) => void
  onEnterFolder: (folderId: string) => void
  onFolderMove: (
    folder: ShelfGroup,
    parentId: string | null,
    position: CanvasPosition
  ) => void
  onGroupChange: (groupBy: FinderSortKey | 'none') => void
  onImportSkills: (skillIds: string[]) => void
  onRenameFolder: (folder: ShelfGroup) => void
  onRemoveSkill: (skill: InstalledSkill) => void
  onSelectSkill: (skillId: string) => void
  onSkillMove: (
    skill: InstalledSkill,
    folderId: string | null,
    position: CanvasPosition
  ) => void
  onSortChange: (sortBy: FinderSortKey | 'none') => void
  onSortDirectionChange: (direction: FinderSortDirection) => void
  onTranslateSkills: (skillIds: string[]) => void
  onUpdateSkill: (skillId: string) => void
  onViewModeChange: (viewMode: LibraryViewMode) => void
  scopeKey: ShelfScopeKey
  selectedId: string | null
  skills: InstalledSkill[]
  sortBy: FinderSortKey | 'none'
  sortDirection: FinderSortDirection
  useGroups: boolean
}) {
  const actions = useContext(FinderActionsContext)
  const { locale, t } = useI18n()
  const sortOptions: Array<[FinderSortKey, string]> = [
    ['name', t('desktop.folders.arrangementName')],
    ['kind', t('desktop.folders.arrangementKind')],
    ['source', t('desktop.folders.arrangementSource')],
    ['update-status', t('desktop.folders.arrangementUpdateStatus')],
    ['tags', t('desktop.folders.arrangementTags')],
  ]
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const canvasSurfaceRef = useRef<HTMLDivElement | null>(null)
  const contextPosition = useRef<CanvasPosition>({ x: 28, y: 28 })
  const positionCache = useRef(new Map<string, CanvasPosition>())
  const selectionLayerRef = useRef<SVGSVGElement | null>(null)
  const selectionRectRef = useRef<SVGRectElement | null>(null)
  const [selectedItemKeys, setSelectedItemKeys] = useState<
    Set<FinderCanvasItemKey>
  >(new Set())
  const [viewportWidth, setViewportWidth] = useState(980)
  const selectedItemKeysRef = useRef(selectedItemKeys)
  selectedItemKeysRef.current = selectedItemKeys
  const boxSelectionRef = useRef<{
    active: boolean
    base: Set<FinderCanvasItemKey>
    lastSelection: Set<FinderCanvasItemKey>
    mode: FinderSelectionMode
    pointerId: number
    start: CanvasPosition
  } | null>(null)
  const unorderedItems = [
    ...folders.map((folder) => ({
      folder,
      id: folder.id,
      key: `folder:${folder.id}` as const,
      kind: 'folder' as const,
      name: folder.name,
      position: folder.position,
    })),
    ...skills.map((skill) => ({
      id: skill.id,
      key: `skill:${skill.id}` as const,
      kind: 'skill' as const,
      name: skill.name,
      position: skill.position,
      source: skill.source ?? skill.sourceType,
      skill,
      tags: skill.tags,
      updateStatus: skill.updateCheck.status,
    })),
  ]
  const items =
    sortBy !== 'none' && !useGroups
      ? sortFinderItems(unorderedItems, sortBy, sortDirection, locale)
      : unorderedItems
  const orderedFolders = items.flatMap((item) =>
    item.kind === 'folder' ? [item.folder] : []
  )
  const orderedSkills = items.flatMap((item) =>
    item.kind === 'skill' ? [item.skill] : []
  )
  const occupiedPositions = items.flatMap((item) =>
    item.position ? [item.position] : []
  )
  const finderGroupSections: Array<{
    count: number
    key: string
    y: number
  }> = []
  const groupedPositions = new Map<FinderCanvasItemKey, CanvasPosition>()
  if (useGroups) {
    let groupTop = 18
    for (const { items: groupItems, key } of groupFinderItems(
      unorderedItems,
      groupBy,
      locale,
      sortBy === 'none' ? 'name' : sortBy,
      sortDirection
    )) {
      const layout = getFinderCanvasGroupLayout(
        groupItems.length,
        viewportWidth
      )
      finderGroupSections.push({
        count: groupItems.length,
        key,
        y: groupTop,
      })
      groupItems.forEach((item, index) => {
        const position = layout.positions[index]!
        groupedPositions.set(item.key, {
          x: position.x,
          y: groupTop + position.y,
        })
      })
      groupTop += layout.height
    }
  }
  const positionedItems = items.map((item, index) => {
    const groupedPosition = groupedPositions.get(item.key)
    if (groupedPosition) return { ...item, position: groupedPosition }
    if (sortBy !== 'none' || filtering) {
      return {
        ...item,
        position: getFinderCanvasGridPosition(index, viewportWidth),
      }
    }
    const cacheKey = `${currentFolderId ?? 'root'}:${item.kind}:${item.id}`
    if (item.position) {
      positionCache.current.set(cacheKey, item.position)
      return { ...item, position: item.position }
    }
    const cached = positionCache.current.get(cacheKey)
    if (cached) {
      occupiedPositions.push(cached)
      return { ...item, position: cached }
    }
    const position = getNextAvailableCanvasPosition(occupiedPositions)
    occupiedPositions.push(position)
    positionCache.current.set(cacheKey, position)
    return { ...item, position }
  })
  const resolvedPositions = new Map(
    positionedItems.map((item) => [item.key, item.position])
  )
  const contentWidth = useGroups
    ? '100%'
    : Math.max(980, ...positionedItems.map((item) => item.position.x + 150))
  const contentHeight = Math.max(
    620,
    ...positionedItems.map((item) => item.position.y + 150)
  )
  const selectionLocationKey = `${scopeKey}:${currentFolderId ?? 'root'}`
  const previousSelectionLocation = useRef(selectionLocationKey)
  const visibleItemKeySignature = positionedItems
    .map((item) => item.key)
    .sort()
    .join('|')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const syncWidth = () => {
      const nextWidth = canvas.clientWidth
      if (nextWidth > 0) {
        setViewportWidth((current) =>
          current === nextWidth ? current : nextWidth
        )
      }
    }
    syncWidth()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(syncWidth)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  function commitSelection(next: Set<FinderCanvasItemKey>) {
    const current = selectedItemKeysRef.current
    if (
      current.size === next.size &&
      [...current].every((key) => next.has(key))
    ) {
      return
    }
    selectedItemKeysRef.current = next
    setSelectedItemKeys(next)
  }

  useEffect(() => {
    if (previousSelectionLocation.current === selectionLocationKey) return
    previousSelectionLocation.current = selectionLocationKey
    commitSelection(new Set())
    onCloseSelection()
  }, [selectionLocationKey])

  useEffect(() => {
    const visibleKeys = new Set(positionedItems.map((item) => item.key))
    const next = new Set(
      [...selectedItemKeysRef.current].filter((key) => visibleKeys.has(key))
    )
    commitSelection(next)
  }, [visibleItemKeySignature])

  useEffect(() => {
    if (!selectedId || !skills.some((skill) => skill.id === selectedId)) return
    commitSelection(new Set([`skill:${selectedId}` as const]))
  }, [selectedId])

  function getSelectionMode(event: {
    ctrlKey: boolean
    metaKey: boolean
    shiftKey: boolean
  }): FinderSelectionMode {
    if (event.metaKey || event.ctrlKey) return 'toggle'
    if (event.shiftKey) return 'add'
    return 'replace'
  }

  function selectCanvasItem(
    key: FinderCanvasItemKey,
    kind: 'folder' | 'skill',
    event: ReactMouseEvent<HTMLDivElement>
  ) {
    const mode = getSelectionMode(event)
    const next = resolveFinderSelection(
      selectedItemKeysRef.current,
      [key],
      mode
    ) as Set<FinderCanvasItemKey>
    commitSelection(next)
    if (mode === 'replace' && kind === 'skill') {
      onSelectSkill(key.slice('skill:'.length))
    } else {
      onCloseSelection()
    }
  }

  function openSkillDetails(skillId: string) {
    commitSelection(new Set([`skill:${skillId}` as const]))
    onSelectSkill(skillId)
  }

  function toCanvasPosition(
    event: ReactPointerEvent<HTMLDivElement>
  ): CanvasPosition {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    }
  }

  function clearTransientBoxSelection() {
    const surface = canvasSurfaceRef.current
    surface
      ?.querySelectorAll<HTMLElement>('[data-finder-item-key]')
      .forEach((item) => item.removeAttribute('data-box-selected'))
    selectionLayerRef.current?.removeAttribute('data-active')
    selectionRectRef.current?.setAttribute('width', '0')
    selectionRectRef.current?.setAttribute('height', '0')
  }

  function showTransientBoxSelection(next: Set<FinderCanvasItemKey>) {
    canvasSurfaceRef.current
      ?.querySelectorAll<HTMLElement>('[data-finder-item-key]')
      .forEach((item) => {
        const key = item.dataset.finderItemKey as
          FinderCanvasItemKey | undefined
        item.dataset.boxSelected = key && next.has(key) ? 'true' : 'false'
      })
  }

  function handleBoxPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return
    if ((event.target as HTMLElement).closest('[data-finder-item-key]')) return
    const mode = getSelectionMode(event)
    const base =
      mode === 'replace'
        ? new Set<FinderCanvasItemKey>()
        : new Set(selectedItemKeysRef.current)
    boxSelectionRef.current = {
      active: false,
      base,
      lastSelection: base,
      mode,
      pointerId: event.pointerId,
      start: toCanvasPosition(event),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function handleBoxPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = boxSelectionRef.current
    const surface = canvasSurfaceRef.current
    const rectElement = selectionRectRef.current
    if (
      !drag ||
      !surface ||
      !rectElement ||
      drag.pointerId !== event.pointerId
    ) {
      return
    }
    const point = toCanvasPosition(event)
    if (
      !drag.active &&
      Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < 4
    ) {
      return
    }
    drag.active = true
    const selectionRect = normalizeFinderRectangle(drag.start, point)
    rectElement.setAttribute('x', String(selectionRect.x))
    rectElement.setAttribute('y', String(selectionRect.y))
    rectElement.setAttribute('width', String(selectionRect.width))
    rectElement.setAttribute('height', String(selectionRect.height))
    selectionLayerRef.current?.setAttribute('data-active', 'true')
    const surfaceBounds = surface.getBoundingClientRect()
    const candidates: FinderCanvasItemKey[] = []
    surface
      .querySelectorAll<HTMLElement>('[data-finder-item-key]')
      .forEach((item) => {
        const bounds = item.getBoundingClientRect()
        if (
          finderRectanglesIntersect(selectionRect, {
            height: bounds.height,
            width: bounds.width,
            x: bounds.left - surfaceBounds.left,
            y: bounds.top - surfaceBounds.top,
          })
        ) {
          candidates.push(item.dataset.finderItemKey as FinderCanvasItemKey)
        }
      })
    drag.lastSelection = resolveFinderSelection(
      drag.base,
      candidates,
      drag.mode
    ) as Set<FinderCanvasItemKey>
    showTransientBoxSelection(drag.lastSelection)
    event.preventDefault()
  }

  function handleBoxPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = boxSelectionRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    boxSelectionRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag.active) {
      commitSelection(drag.lastSelection)
      onCloseSelection()
    } else if (drag.mode === 'replace') {
      commitSelection(new Set())
      onCloseSelection()
    }
    clearTransientBoxSelection()
  }

  function handleBoxPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = boxSelectionRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    boxSelectionRef.current = null
    clearTransientBoxSelection()
  }

  function moveCanvasItems(
    folderId: string | null,
    movedItems: FinderCanvasDragItem[]
  ) {
    if (filtering) return false
    const movingKeys = new Set(movedItems.map((item) => item.key))
    const movableItems = movedItems.filter(
      (item) => item.key !== `folder:${folderId}`
    )
    if (movableItems.length === 0) return false

    const applyMove = (
      item: FinderCanvasDragItem,
      parentId: string | null,
      position: CanvasPosition
    ) => {
      if (item.key.startsWith('skill:')) {
        const skill = allSkills.find(
          (candidate) => `skill:${candidate.id}` === item.key
        )
        if (skill) onSkillMove(skill, parentId, position)
        return
      }
      const folder = allFolders.find(
        (candidate) => `folder:${candidate.id}` === item.key
      )
      if (folder) onFolderMove(folder, parentId, position)
    }

    if (folderId) {
      const occupiedPositions = [
        ...allSkills
          .filter(
            (skill) =>
              skill.groupId === folderId && !movingKeys.has(`skill:${skill.id}`)
          )
          .flatMap((skill) => (skill.position ? [skill.position] : [])),
        ...allFolders
          .filter(
            (folder) =>
              folder.parentId === folderId &&
              !movingKeys.has(`folder:${folder.id}`)
          )
          .flatMap((folder) => (folder.position ? [folder.position] : [])),
      ]
      for (const item of movableItems) {
        const position = getNextAvailableCanvasPosition(occupiedPositions)
        occupiedPositions.push(position)
        applyMove(item, folderId, position)
      }
      commitSelection(new Set())
      onCloseSelection()
      return true
    }

    if (useGroups || sortBy !== 'none') return false

    const occupiedPositions = positionedItems
      .filter((item) => !movingKeys.has(item.key))
      .map((item) => item.position)
    for (const item of movableItems) {
      const position = alignToGrid
        ? getNearestAvailableFinderGridPosition(
            item.position,
            occupiedPositions
          )
        : item.position
      occupiedPositions.push(position)
      applyMove(item, currentFolderId, position)
    }
    const nextSelection = new Set(movableItems.map((item) => item.key))
    commitSelection(nextSelection)
    const onlyKey = movableItems.length === 1 ? movableItems[0]?.key : null
    if (onlyKey !== `skill:${selectedId}`) onCloseSelection()
    return true
  }

  function getDragItems(key: FinderCanvasItemKey): FinderCanvasDragItem[] {
    const selected = selectedItemKeys.has(key)
      ? selectedItemKeys
      : new Set([key])
    return positionedItems
      .filter((item) => selected.has(item.key))
      .map((item) => ({ key: item.key, position: item.position }))
  }

  function beginCanvasDrag(dragItems: FinderCanvasDragItem[]) {
    const nextSelection = new Set(dragItems.map((item) => item.key))
    commitSelection(nextSelection)
    const onlyKey = dragItems.length === 1 ? dragItems[0]?.key : null
    if (onlyKey !== `skill:${selectedId}`) onCloseSelection()
  }

  function selectContextItem(itemKey: FinderCanvasItemKey) {
    const next = resolveFinderContextSelection(
      selectedItemKeysRef.current,
      itemKey
    ) as Set<FinderCanvasItemKey>
    commitSelection(next)
    const onlyKey = next.size === 1 ? [...next][0] : null
    if (onlyKey !== `skill:${selectedId}`) onCloseSelection()
  }

  function getContextSkillIds() {
    return getFinderSelectionSkillIds(
      selectedItemKeysRef.current,
      allFolders,
      allSkills
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          aria-label={t('desktop.library.finderCanvas')}
          className="finder-canvas-scroll"
          onContextMenu={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect()
            contextPosition.current = {
              x: Math.max(
                12,
                event.clientX - bounds.left + event.currentTarget.scrollLeft
              ),
              y: Math.max(
                12,
                event.clientY - bounds.top + event.currentTarget.scrollTop
              ),
            }
          }}
          ref={canvasRef}
          role="region"
        >
          <div
            className="finder-canvas"
            onPointerCancel={handleBoxPointerCancel}
            onPointerDown={handleBoxPointerDown}
            onPointerMove={handleBoxPointerMove}
            onPointerUp={handleBoxPointerUp}
            ref={canvasSurfaceRef}
            data-grouped={useGroups || undefined}
            style={{ height: contentHeight, minWidth: contentWidth }}
          >
            {finderGroupSections.map((section) => (
              <div
                className="finder-group-heading"
                key={section.key}
                style={{ transform: `translate3d(28px, ${section.y}px, 0)` }}
              >
                <strong>{getFinderGroupLabel(section.key, groupBy, t)}</strong>
                <span>{section.count}</span>
              </div>
            ))}
            {orderedFolders.map((folder, index) => {
              const itemKey = `folder:${folder.id}` as const
              const position =
                resolvedPositions.get(itemKey) ??
                getDefaultCanvasPosition(index)
              return (
                <ContextMenu key={folder.id}>
                  <FinderCanvasItem
                    canvasRef={canvasRef}
                    draggable={!filtering}
                    dragItems={getDragItems(itemKey)}
                    itemKey={itemKey}
                    kind="folder"
                    onDrop={moveCanvasItems}
                    onDragStart={beginCanvasDrag}
                    onOpen={() => onEnterFolder(folder.id)}
                    onContextSelect={() => selectContextItem(itemKey)}
                    onSelect={(event) =>
                      selectCanvasItem(itemKey, 'folder', event)
                    }
                    position={position}
                    selected={selectedItemKeys.has(itemKey)}
                  >
                    <button
                      className="finder-icon-button"
                      data-finder-folder-id={folder.id}
                      style={
                        { '--folder-color': folder.color } as CSSProperties
                      }
                      type="button"
                    >
                      <span className="finder-folder-icon">
                        <Folder />
                      </span>
                      <span title={folder.name}>{folder.name}</span>
                    </button>
                  </FinderCanvasItem>
                  <ContextMenuContent
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <ContextMenuLabel>
                      {selectedItemKeys.size > 1
                        ? t('desktop.library.selectedItems', {
                            count: selectedItemKeys.size,
                          })
                        : folder.name}
                    </ContextMenuLabel>
                    {selectedItemKeys.size === 1 ? (
                      <ContextMenuItem onSelect={() => onRenameFolder(folder)}>
                        <PencilLine />
                        {t('desktop.folders.rename')}
                      </ContextMenuItem>
                    ) : null}
                    {actions?.folderActions ? (
                      actions.folderActions(folder, getContextSkillIds())
                    ) : (
                      <>
                        <ContextMenuItem
                          disabled={getContextSkillIds().length === 0}
                          onSelect={() =>
                            onTranslateSkills(getContextSkillIds())
                          }
                        >
                          <Languages />
                          {selectedItemKeys.size > 1
                            ? t('desktop.library.translateSelection')
                            : t('desktop.library.translateFolder')}
                        </ContextMenuItem>
                        <ContextMenuItem
                          disabled={getContextSkillIds().length === 0}
                          onSelect={() => onImportSkills(getContextSkillIds())}
                        >
                          <PackagePlus />
                          {selectedItemKeys.size > 1
                            ? t('desktop.library.importSelectionToPacks')
                            : t('desktop.library.importFolderToPacks')}
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              )
            })}
            {orderedSkills.map((skill, index) => {
              const positionIndex = orderedFolders.length + index
              const updating = busyAction === `update:${skill.id}`
              const itemKey = `skill:${skill.id}` as const
              const position =
                resolvedPositions.get(itemKey) ??
                getDefaultCanvasPosition(positionIndex)
              return (
                <ContextMenu key={skill.id}>
                  <FinderCanvasItem
                    canvasRef={canvasRef}
                    draggable={!filtering}
                    dragItems={getDragItems(itemKey)}
                    itemKey={itemKey}
                    kind="skill"
                    onDrop={moveCanvasItems}
                    onDragStart={beginCanvasDrag}
                    onContextSelect={() => selectContextItem(itemKey)}
                    onSelect={(event) =>
                      selectCanvasItem(itemKey, 'skill', event)
                    }
                    position={position}
                    selected={selectedItemKeys.has(itemKey)}
                  >
                    <div className="finder-skill-tile">
                      <button
                        aria-label={t('desktop.library.viewDetailsNamed', {
                          name: skill.name,
                        })}
                        className="finder-icon-button"
                        type="button"
                      >
                        <span className="finder-skill-icon">
                          <Boxes />
                          <SkillUpdateIndicator check={skill.updateCheck} />
                          {actions?.skillDecoration?.(skill.id)}
                          {skill.installKind === 'symlink' ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="finder-skill-link-indicator">
                                  <Link2 />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t('desktop.library.installSymlink')}
                              </TooltipContent>
                            </Tooltip>
                          ) : null}
                        </span>
                        <span>{skill.name}</span>
                      </button>
                      <SkillInfoHoverCard
                        className="finder-skill-info"
                        skill={skill}
                      />
                    </div>
                  </FinderCanvasItem>
                  <ContextMenuContent
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <ContextMenuLabel>
                      {selectedItemKeys.size > 1
                        ? t('desktop.library.selectedItems', {
                            count: selectedItemKeys.size,
                          })
                        : skill.name}
                    </ContextMenuLabel>
                    {actions?.skillActions ? (
                      actions.skillActions(skill.id, getContextSkillIds())
                    ) : (
                      <>
                        {selectedItemKeys.size === 1 ? (
                          <>
                            <ContextMenuItem
                              onSelect={() => openSkillDetails(skill.id)}
                            >
                              <Info />
                              {t('desktop.library.viewDetails')}
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() =>
                                actions?.openSkillFolder
                                  ? actions.openSkillFolder(skill.id)
                                  : void window.skillShelf.openSkillFolder(
                                      skill.id
                                    )
                              }
                            >
                              <FolderOpen />
                              {t('common.openFolder')}
                            </ContextMenuItem>
                          </>
                        ) : null}
                        <ContextMenuItem
                          onSelect={() =>
                            onTranslateSkills(getContextSkillIds())
                          }
                        >
                          <Languages />
                          {selectedItemKeys.size > 1
                            ? t('desktop.library.translateSelection')
                            : t('desktop.library.translateDescription')}
                        </ContextMenuItem>
                        <ContextMenuItem
                          onSelect={() => onImportSkills(getContextSkillIds())}
                        >
                          <PackagePlus />
                          {selectedItemKeys.size > 1
                            ? t('desktop.library.importSelectionToPacks')
                            : t('desktop.library.importToPacks')}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        {selectedItemKeys.size === 1 ? (
                          <>
                            <ContextMenuItem
                              disabled={Boolean(busyAction)}
                              onSelect={() => onUpdateSkill(skill.id)}
                            >
                              {updating ? (
                                <LoaderCircle className="animate-spin" />
                              ) : (
                                <RefreshCw />
                              )}
                              {t('desktop.inspector.update')}
                            </ContextMenuItem>
                            <ContextMenuItem
                              className="skill-context-menu-destructive"
                              onSelect={() => onRemoveSkill(skill)}
                            >
                              <Trash2 />
                              {t('desktop.inspector.remove')}
                            </ContextMenuItem>
                          </>
                        ) : null}
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              )
            })}
            <svg
              aria-hidden="true"
              className="finder-selection-layer"
              ref={selectionLayerRef}
            >
              <rect
                className="finder-selection-rect"
                height="0"
                ref={selectionRectRef}
                width="0"
              />
            </svg>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{t('desktop.folders.canvasMenu')}</ContextMenuLabel>
        <ContextMenuItem
          onSelect={() => onCreateFolder(contextPosition.current)}
        >
          <FolderPlus />
          {t('desktop.folders.new')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Grid2X2 />
            {t('desktop.folders.view')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              onValueChange={(value) =>
                onViewModeChange(value as LibraryViewMode)
              }
              value="canvas"
            >
              {(
                [
                  ['canvas', Grid2X2, t('desktop.library.viewCanvas')],
                  ['list', ListIcon, t('desktop.library.viewList')],
                  ['columns', Columns3, t('desktop.library.viewColumns')],
                ] as const
              ).map(([mode, Icon, label]) => (
                <ContextMenuRadioItem key={mode} value={mode}>
                  <Icon />
                  {label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
            <ContextMenuSeparator />
            <ContextMenuCheckboxItem
              checked={alignToGrid}
              disabled={filtering || useGroups || sortBy !== 'none'}
              icon={<Grid2X2 />}
              onSelect={() => onAlignToGridChange(!alignToGrid)}
            >
              {t('desktop.folders.alignToGrid')}
            </ContextMenuCheckboxItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuCheckboxItem
          checked={useGroups}
          icon={<Boxes />}
          onSelect={() => onGroupChange(useGroups ? 'none' : groupBy)}
        >
          {t('desktop.folders.useGroups')}
        </ContextMenuCheckboxItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Boxes />
            {t('desktop.folders.groupBy')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              onValueChange={(value) =>
                onGroupChange(value as FinderSortKey | 'none')
              }
              value={useGroups ? groupBy : 'none'}
            >
              <ContextMenuRadioItem value="none">
                {t('desktop.folders.arrangementNone')}
              </ContextMenuRadioItem>
              <ContextMenuSeparator />
              {sortOptions.map(([value, label]) => (
                <ContextMenuRadioItem key={value} value={value}>
                  {label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <ArrowUpDown />
            {t('desktop.folders.arrangeBy')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              onValueChange={(value) =>
                onSortChange(value as FinderSortKey | 'none')
              }
              value={sortBy}
            >
              <ContextMenuRadioItem value="none">
                {t('desktop.folders.arrangementNone')}
              </ContextMenuRadioItem>
              <ContextMenuSeparator />
              {sortOptions.map(([value, label]) => (
                <ContextMenuRadioItem key={value} value={value}>
                  {label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
            {sortBy !== 'none' ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuRadioGroup
                  onValueChange={(value) =>
                    onSortDirectionChange(value as FinderSortDirection)
                  }
                  value={sortDirection}
                >
                  <ContextMenuRadioItem value="descending">
                    <ChevronDown />
                    {t('desktop.folders.sortDescending')}
                  </ContextMenuRadioItem>
                  <ContextMenuRadioItem value="ascending">
                    <ChevronUp />
                    {t('desktop.folders.sortAscending')}
                  </ContextMenuRadioItem>
                </ContextMenuRadioGroup>
              </>
            ) : null}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem
          disabled={
            filtering || useGroups || sortBy !== 'none' || items.length < 2
          }
          onSelect={() => onCleanUp('position')}
        >
          <Grid2X2 />
          {t('desktop.folders.cleanUp')}
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger
            disabled={
              filtering || useGroups || sortBy !== 'none' || items.length < 2
            }
          >
            <ArrowDown />
            {t('desktop.folders.cleanUpBy')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {sortOptions.map(([value, label]) => (
              <ContextMenuItem key={value} onSelect={() => onCleanUp(value)}>
                {label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function FinderListView({
  allFolders,
  allSkills,
  busyAction,
  contextSkills,
  currentFolderId,
  filtering,
  folders,
  groupBy,
  groups,
  onCloseSelection,
  onCreateFolder,
  onEnterFolder,
  onGroupChange,
  onImportSkills,
  onMoveSkill,
  onRenameFolder,
  onRemoveSkill,
  onSelectSkill,
  onSortChange,
  onSortDirectionChange,
  onTranslateSkills,
  onUpdateSkill,
  onViewModeChange,
  selectedId,
  resultsLabel,
  skills,
  sortBy,
  sortDirection,
  useGroups,
  viewMode,
}: {
  allFolders: ShelfGroup[]
  allSkills: InstalledSkill[]
  busyAction: string | null
  contextSkills: InstalledSkill[]
  currentFolderId: string | null
  filtering: boolean
  folders: ShelfGroup[]
  groupBy: FinderSortKey
  groups: ShelfGroup[]
  onCloseSelection: () => void
  onCreateFolder: () => void
  onEnterFolder: (folderId: string) => void
  onGroupChange: (groupBy: FinderSortKey | 'none') => void
  onImportSkills: (skillIds: string[]) => void
  onMoveSkill: (
    skill: InstalledSkill,
    folderId: string | null,
    position: CanvasPosition
  ) => void
  onRenameFolder: (folder: ShelfGroup) => void
  onRemoveSkill: (skill: InstalledSkill) => void
  onSelectSkill: (skillId: string) => void
  onSortChange: (sortBy: FinderSortKey | 'none') => void
  onSortDirectionChange: (direction: FinderSortDirection) => void
  onTranslateSkills: (skillIds: string[]) => void
  onUpdateSkill: (skillId: string) => void
  onViewModeChange: (viewMode: LibraryViewMode) => void
  selectedId: string | null
  resultsLabel: string
  skills: InstalledSkill[]
  sortBy: FinderSortKey | 'none'
  sortDirection: FinderSortDirection
  useGroups: boolean
  viewMode: LibraryViewMode
}) {
  const actions = useContext(FinderActionsContext)
  const { locale, t } = useI18n()
  const listViewRef = useRef<HTMLDivElement | null>(null)
  const selectionLayerRef = useRef<SVGSVGElement | null>(null)
  const selectionRectRef = useRef<SVGRectElement | null>(null)
  const [selectedItemKeys, setSelectedItemKeys] = useState<
    Set<FinderCanvasItemKey>
  >(
    new Set(
      selectedId ? ([`skill:${selectedId}`] as FinderCanvasItemKey[]) : []
    )
  )
  const selectedItemKeysRef = useRef(selectedItemKeys)
  selectedItemKeysRef.current = selectedItemKeys
  const selectionAnchorRef = useRef<FinderCanvasItemKey | null>(
    selectedId ? `skill:${selectedId}` : null
  )
  const draggedSkillKeysRef = useRef<FinderCanvasItemKey[]>([])
  const [draggedSkillKeys, setDraggedSkillKeys] = useState<
    Set<FinderCanvasItemKey>
  >(() => new Set())
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null)
  const boxSelectionRef = useRef<{
    active: boolean
    base: Set<FinderCanvasItemKey>
    lastSelection: Set<FinderCanvasItemKey>
    mode: FinderSelectionMode
    pointerId: number
    start: CanvasPosition
  } | null>(null)
  const sortOptions: Array<[FinderSortKey, string]> = [
    ['name', t('desktop.folders.arrangementName')],
    ['kind', t('desktop.folders.arrangementKind')],
    ['source', t('desktop.folders.arrangementSource')],
    ['update-status', t('desktop.folders.arrangementUpdateStatus')],
    ['tags', t('desktop.folders.arrangementTags')],
  ]
  function createItems(
    folderItems: ShelfGroup[],
    skillItems: InstalledSkill[]
  ) {
    return [
      ...folderItems.map((folder) => ({
        folder,
        key: `folder:${folder.id}`,
        kind: 'folder' as const,
        name: folder.name,
      })),
      ...skillItems.map((skill) => ({
        key: `skill:${skill.id}`,
        kind: 'skill' as const,
        name: skill.name,
        skill,
        source: skill.source ?? skill.sourceType,
        tags: skill.tags,
        updateStatus: skill.updateCheck.status,
      })),
    ]
  }
  const items = createItems(folders, skills)
  const listSortKey = sortBy === 'none' ? 'name' : sortBy
  const orderedItems = sortFinderItems(
    items,
    listSortKey,
    sortDirection,
    locale
  )
  const groupedItems = useGroups
    ? groupFinderItems(
        orderedItems,
        groupBy,
        locale,
        listSortKey,
        sortDirection
      )
    : [{ items: orderedItems, key: 'all' }]
  const columnLocations = filtering
    ? [currentFolderId]
    : [
        null,
        ...getFolderBreadcrumbs(currentFolderId, allFolders).map(
          (folder) => folder.id
        ),
      ]
  const columnGroups = columnLocations.map((folderId) => {
    const columnItems = filtering
      ? items
      : createItems(
          allFolders.filter((folder) => folder.parentId === folderId),
          allSkills.filter((skill) => skill.groupId === folderId)
        )
    const orderedColumnItems = sortFinderItems(
      columnItems,
      listSortKey,
      sortDirection,
      locale
    )
    return {
      folderId,
      groups: useGroups
        ? groupFinderItems(
            orderedColumnItems,
            groupBy,
            locale,
            listSortKey,
            sortDirection
          )
        : [{ items: orderedColumnItems, key: 'all' }],
      label: filtering
        ? resultsLabel
        : folderId === null
          ? (actions?.rootLabel ?? t('desktop.folders.all'))
          : (allFolders.find((folder) => folder.id === folderId)?.name ?? ''),
    }
  })
  const renderedItemKeys = Array.from(
    new Set(
      (viewMode === 'columns'
        ? columnGroups.flatMap((column) =>
            column.groups.flatMap((section) =>
              section.items.map((item) => item.key)
            )
          )
        : groupedItems.flatMap((section) =>
            section.items.map((item) => item.key)
          )) as FinderCanvasItemKey[]
    )
  )
  const renderedItemKeySignature = renderedItemKeys.join('|')

  useEffect(() => {
    const visibleKeys = new Set(renderedItemKeys)
    const next = new Set(
      [...selectedItemKeysRef.current].filter((key) => visibleKeys.has(key))
    )
    commitSelection(next)
    if (
      selectionAnchorRef.current &&
      !visibleKeys.has(selectionAnchorRef.current)
    ) {
      selectionAnchorRef.current = null
    }
  }, [renderedItemKeySignature])

  useEffect(() => {
    if (!selectedId) return
    const key = `skill:${selectedId}` as const
    if (
      !renderedItemKeys.includes(key) ||
      selectedItemKeysRef.current.has(key)
    ) {
      return
    }
    selectionAnchorRef.current = key
    commitSelection(new Set([key]))
  }, [selectedId, renderedItemKeySignature])

  function commitSelection(next: Set<FinderCanvasItemKey>) {
    const current = selectedItemKeysRef.current
    if (
      current.size === next.size &&
      [...current].every((key) => next.has(key))
    ) {
      return
    }
    selectedItemKeysRef.current = next
    setSelectedItemKeys(next)
  }

  function getSelectionMode(event: {
    ctrlKey: boolean
    metaKey: boolean
    shiftKey: boolean
  }): FinderSelectionMode {
    if (event.metaKey || event.ctrlKey) return 'toggle'
    if (event.shiftKey) return 'add'
    return 'replace'
  }

  function selectListItem(
    item: (typeof orderedItems)[number],
    orderedKeys: FinderCanvasItemKey[],
    event: ReactMouseEvent<HTMLElement>
  ) {
    const key = item.key as FinderCanvasItemKey
    const extendsRange = event.shiftKey
    const candidates = extendsRange
      ? (getFinderSelectionRange(
          orderedKeys,
          selectionAnchorRef.current,
          key
        ) as FinderCanvasItemKey[])
      : [key]
    const mode = extendsRange
      ? event.metaKey || event.ctrlKey
        ? 'add'
        : 'replace'
      : getSelectionMode(event)
    const next = resolveFinderSelection(
      selectedItemKeysRef.current,
      candidates,
      mode
    ) as Set<FinderCanvasItemKey>
    commitSelection(next)
    if (!extendsRange) selectionAnchorRef.current = key

    if (
      item.kind === 'skill' &&
      next.has(key) &&
      isFinderPlainSelection(event)
    ) {
      onSelectSkill(item.skill.id)
    } else {
      onCloseSelection()
    }
  }

  function selectContextItem(itemKey: FinderCanvasItemKey) {
    const next = resolveFinderContextSelection(
      selectedItemKeysRef.current,
      itemKey
    ) as Set<FinderCanvasItemKey>
    commitSelection(next)
    selectionAnchorRef.current = itemKey
    const onlyKey = next.size === 1 ? [...next][0] : null
    if (onlyKey !== `skill:${selectedId}`) onCloseSelection()
  }

  function getContextSkillIds() {
    return getFinderSelectionSkillIds(
      selectedItemKeysRef.current,
      allFolders,
      contextSkills
    )
  }

  function beginSkillDrag(
    event: ReactDragEvent<HTMLElement>,
    itemKey: FinderCanvasItemKey
  ) {
    if (viewMode !== 'columns') {
      event.preventDefault()
      return
    }
    const keys = getFinderDraggedSkillKeys(
      selectedItemKeysRef.current,
      itemKey
    ) as FinderCanvasItemKey[]
    draggedSkillKeysRef.current = keys
    setDraggedSkillKeys(new Set(keys))
    if (!selectedItemKeysRef.current.has(itemKey)) {
      selectionAnchorRef.current = itemKey
      commitSelection(new Set(keys))
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', keys.join('\n'))
    onCloseSelection()
  }

  function finishSkillDrag() {
    draggedSkillKeysRef.current = []
    setDraggedSkillKeys(new Set())
    setDropTargetKey(null)
  }

  function moveDraggedSkillsToFolder(folderId: string | null) {
    const movingIds = new Set(
      draggedSkillKeysRef.current.map((key) => key.slice('skill:'.length))
    )
    const movingSkills = allSkills.filter(
      (skill) => movingIds.has(skill.id) && skill.groupId !== folderId
    )
    if (movingSkills.length === 0) return

    const targetItems = [
      ...allFolders.filter((folder) => folder.parentId === folderId),
      ...allSkills.filter(
        (skill) => skill.groupId === folderId && !movingIds.has(skill.id)
      ),
    ]
    const occupiedPositions = targetItems.map(
      (item, index) => item.position ?? getDefaultCanvasPosition(index)
    )
    for (const skill of movingSkills) {
      const position = getNextAvailableCanvasPosition(occupiedPositions)
      occupiedPositions.push(position)
      onMoveSkill(skill, folderId, position)
    }
  }

  function handleSkillDragOver(
    event: ReactDragEvent<HTMLElement>,
    targetKey: string
  ) {
    if (draggedSkillKeysRef.current.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropTargetKey(targetKey)
  }

  function handleSkillDragLeave(
    event: ReactDragEvent<HTMLElement>,
    targetKey: string
  ) {
    if (
      event.relatedTarget &&
      event.currentTarget.contains(event.relatedTarget as Node)
    ) {
      return
    }
    setDropTargetKey((current) => (current === targetKey ? null : current))
  }

  function handleSkillDrop(
    event: ReactDragEvent<HTMLElement>,
    folderId: string | null
  ) {
    if (draggedSkillKeysRef.current.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    moveDraggedSkillsToFolder(folderId)
    finishSkillDrag()
  }

  function clearTransientBoxSelection() {
    listViewRef.current
      ?.querySelectorAll<HTMLElement>('[data-finder-item-key]')
      .forEach((item) => item.removeAttribute('data-box-selected'))
    selectionLayerRef.current?.removeAttribute('data-active')
    selectionRectRef.current?.setAttribute('width', '0')
    selectionRectRef.current?.setAttribute('height', '0')
  }

  function showTransientBoxSelection(next: Set<FinderCanvasItemKey>) {
    listViewRef.current
      ?.querySelectorAll<HTMLElement>('[data-finder-item-key]')
      .forEach((item) => {
        const key = item.dataset.finderItemKey as
          FinderCanvasItemKey | undefined
        item.dataset.boxSelected = key && next.has(key) ? 'true' : 'false'
      })
  }

  function handleBoxPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return
    if (
      (event.target as HTMLElement).closest(
        '[data-finder-item-key], button, [role="menuitem"]'
      )
    ) {
      return
    }
    const mode = getSelectionMode(event)
    const base =
      mode === 'replace'
        ? new Set<FinderCanvasItemKey>()
        : new Set(selectedItemKeysRef.current)
    boxSelectionRef.current = {
      active: false,
      base,
      lastSelection: base,
      mode,
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
    }
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function handleBoxPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = boxSelectionRef.current
    const view = listViewRef.current
    const rectElement = selectionRectRef.current
    if (!drag || !view || !rectElement || drag.pointerId !== event.pointerId) {
      return
    }
    const point = { x: event.clientX, y: event.clientY }
    if (
      !drag.active &&
      Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < 4
    ) {
      return
    }
    drag.active = true
    const selectionRect = normalizeFinderRectangle(drag.start, point)
    rectElement.setAttribute('x', String(selectionRect.x))
    rectElement.setAttribute('y', String(selectionRect.y))
    rectElement.setAttribute('width', String(selectionRect.width))
    rectElement.setAttribute('height', String(selectionRect.height))
    selectionLayerRef.current?.setAttribute('data-active', 'true')
    const candidates: FinderCanvasItemKey[] = []
    view
      .querySelectorAll<HTMLElement>('[data-finder-item-key]')
      .forEach((item) => {
        const bounds = item.getBoundingClientRect()
        if (
          finderRectanglesIntersect(selectionRect, {
            height: bounds.height,
            width: bounds.width,
            x: bounds.left,
            y: bounds.top,
          })
        ) {
          candidates.push(item.dataset.finderItemKey as FinderCanvasItemKey)
        }
      })
    drag.lastSelection = resolveFinderSelection(
      drag.base,
      candidates,
      drag.mode
    ) as Set<FinderCanvasItemKey>
    showTransientBoxSelection(drag.lastSelection)
    event.preventDefault()
  }

  function handleBoxPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = boxSelectionRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    boxSelectionRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag.active) {
      commitSelection(drag.lastSelection)
      selectionAnchorRef.current = null
      onCloseSelection()
    } else if (drag.mode === 'replace') {
      commitSelection(new Set())
      selectionAnchorRef.current = null
      onCloseSelection()
    }
    clearTransientBoxSelection()
  }

  function handleBoxPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = boxSelectionRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    boxSelectionRef.current = null
    clearTransientBoxSelection()
  }

  function handleListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      commitSelection(new Set(renderedItemKeys))
      selectionAnchorRef.current = renderedItemKeys.at(-1) ?? null
      onCloseSelection()
      return
    }
    if (event.key === 'Escape' && selectedItemKeysRef.current.size > 0) {
      event.preventDefault()
      commitSelection(new Set())
      selectionAnchorRef.current = null
      onCloseSelection()
    }
  }

  function sortFromListHeader(next: FinderSortKey) {
    if (listSortKey === next) {
      onSortDirectionChange(
        sortDirection === 'ascending' ? 'descending' : 'ascending'
      )
      return
    }
    onSortChange(next)
  }

  function renderItem(
    item: (typeof orderedItems)[number],
    selectionOrder: FinderCanvasItemKey[]
  ) {
    const itemKey = item.key as FinderCanvasItemKey
    if (item.kind === 'folder') {
      const folder = item.folder
      return (
        <ContextMenu key={folder.id}>
          <ContextMenuTrigger asChild>
            <button
              aria-selected={selectedItemKeys.has(itemKey)}
              className={cn(
                'finder-list-folder',
                selectedItemKeys.has(itemKey) && 'is-selected'
              )}
              data-drop-target={
                dropTargetKey === `folder:${folder.id}` ? 'true' : undefined
              }
              data-finder-item-key={itemKey}
              data-finder-item-kind="folder"
              onDragLeave={(event) =>
                handleSkillDragLeave(event, `folder:${folder.id}`)
              }
              onDragOver={(event) =>
                handleSkillDragOver(event, `folder:${folder.id}`)
              }
              onDrop={(event) => handleSkillDrop(event, folder.id)}
              onContextMenu={(event) => {
                event.stopPropagation()
                selectContextItem(itemKey)
              }}
              onClick={(event) => {
                selectListItem(item, selectionOrder, event)
                if (viewMode === 'columns' && isFinderPlainSelection(event)) {
                  onEnterFolder(folder.id)
                }
              }}
              onDoubleClick={(event) => {
                if (viewMode === 'list' && isFinderPlainSelection(event)) {
                  onEnterFolder(folder.id)
                }
              }}
              type="button"
            >
              <Folder style={{ color: folder.color }} />
              <strong>{folder.name}</strong>
              <span>{t('desktop.folders.folder')}</span>
              <ChevronRight />
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuLabel>
              {selectedItemKeys.size > 1
                ? t('desktop.library.selectedItems', {
                    count: selectedItemKeys.size,
                  })
                : folder.name}
            </ContextMenuLabel>
            {selectedItemKeys.size === 1 ? (
              <ContextMenuItem onSelect={() => onRenameFolder(folder)}>
                <PencilLine />
                {t('desktop.folders.rename')}
              </ContextMenuItem>
            ) : null}
            {actions?.folderActions ? (
              actions.folderActions(folder, getContextSkillIds())
            ) : (
              <>
                <ContextMenuItem
                  disabled={getContextSkillIds().length === 0}
                  onSelect={() => onTranslateSkills(getContextSkillIds())}
                >
                  <Languages />
                  {selectedItemKeys.size > 1
                    ? t('desktop.library.translateSelection')
                    : t('desktop.library.translateFolder')}
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={getContextSkillIds().length === 0}
                  onSelect={() => onImportSkills(getContextSkillIds())}
                >
                  <PackagePlus />
                  {selectedItemKeys.size > 1
                    ? t('desktop.library.importSelectionToPacks')
                    : t('desktop.library.importFolderToPacks')}
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
      )
    }

    const skill = item.skill
    return (
      <SkillRow
        busyAction={busyAction}
        draggable={viewMode === 'columns' && !filtering}
        dragging={draggedSkillKeys.has(itemKey)}
        group={groups.find((group) => group.id === skill.groupId)}
        groups={groups}
        itemKey={itemKey}
        key={skill.id}
        moving={false}
        contextSelectionCount={selectedItemKeys.size}
        contextSkillIds={getContextSkillIds()}
        onDragEnd={finishSkillDrag}
        onDragStart={(event) => beginSkillDrag(event, itemKey)}
        onMove={(folderId) => {
          const occupiedPositions = [
            ...allFolders.filter((folder) => folder.parentId === folderId),
            ...allSkills.filter(
              (candidate) =>
                candidate.groupId === folderId && candidate.id !== skill.id
            ),
          ].map(
            (candidate, index) =>
              candidate.position ?? getDefaultCanvasPosition(index)
          )
          onMoveSkill(
            skill,
            folderId,
            getNextAvailableCanvasPosition(occupiedPositions)
          )
        }}
        onContextSelect={() => selectContextItem(itemKey)}
        onImportToPacks={() => onImportSkills(getContextSkillIds())}
        onRemove={() => onRemoveSkill(skill)}
        onSelect={(event) => {
          if (event) {
            selectListItem(item, selectionOrder, event)
            return
          }
          selectionAnchorRef.current = itemKey
          commitSelection(new Set([itemKey]))
          onSelectSkill(skill.id)
        }}
        onUpdate={() => onUpdateSkill(skill.id)}
        onTranslate={() => onTranslateSkills(getContextSkillIds())}
        selected={selectedItemKeys.has(itemKey)}
        skill={skill}
      />
    )
  }

  function renderGroups(sections: typeof groupedItems, keyPrefix: string) {
    const selectionOrder = sections.flatMap((section) =>
      section.items.map((item) => item.key as FinderCanvasItemKey)
    )
    return sections.map(({ items: groupItems, key }) => (
      <section className="finder-list-group" key={`${keyPrefix}:${key}`}>
        {useGroups ? (
          <div className="finder-list-group-heading">
            <strong>{getFinderGroupLabel(key, groupBy, t)}</strong>
            <span>{groupItems.length}</span>
          </div>
        ) : null}
        {groupItems.map((item) => renderItem(item, selectionOrder))}
      </section>
    ))
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="finder-list-view"
          data-view={viewMode}
          onKeyDown={handleListKeyDown}
          onPointerCancel={handleBoxPointerCancel}
          onPointerDown={handleBoxPointerDown}
          onPointerMove={handleBoxPointerMove}
          onPointerUp={handleBoxPointerUp}
          ref={listViewRef}
          role="list"
          tabIndex={0}
        >
          {viewMode === 'list' ? (
            <div className="finder-list-header" role="row">
              {(
                [
                  ['name', t('desktop.folders.arrangementName')],
                  ['source', t('desktop.folders.arrangementSource')],
                  [
                    'update-status',
                    t('desktop.folders.arrangementUpdateStatus'),
                  ],
                ] as const
              ).map(([value, label]) => (
                <button
                  aria-pressed={listSortKey === value}
                  key={value}
                  onClick={() => sortFromListHeader(value)}
                  type="button"
                >
                  {label}
                  {listSortKey === value ? (
                    sortDirection === 'ascending' ? (
                      <ChevronUp />
                    ) : (
                      <ChevronDown />
                    )
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          {viewMode === 'columns'
            ? columnGroups.map((column, index) => (
                <section
                  className="finder-column-panel"
                  data-current={index === columnGroups.length - 1}
                  data-drop-target={
                    dropTargetKey === `column:${column.folderId ?? 'root'}`
                      ? 'true'
                      : undefined
                  }
                  key={column.folderId ?? 'root'}
                  onDragLeave={(event) =>
                    handleSkillDragLeave(
                      event,
                      `column:${column.folderId ?? 'root'}`
                    )
                  }
                  onDragOver={(event) =>
                    handleSkillDragOver(
                      event,
                      `column:${column.folderId ?? 'root'}`
                    )
                  }
                  onDrop={(event) => handleSkillDrop(event, column.folderId)}
                >
                  <header>
                    {filtering ? <ListIcon /> : <FolderOpen />}
                    <span>{column.label}</span>
                  </header>
                  <div>
                    {renderGroups(column.groups, column.folderId ?? 'root')}
                  </div>
                </section>
              ))
            : renderGroups(groupedItems, 'list')}
          <svg
            aria-hidden="true"
            className="finder-list-selection-layer"
            ref={selectionLayerRef}
          >
            <rect
              className="finder-selection-rect"
              height="0"
              ref={selectionRectRef}
              width="0"
            />
          </svg>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{t('desktop.folders.canvasMenu')}</ContextMenuLabel>
        <ContextMenuItem onSelect={onCreateFolder}>
          <FolderPlus />
          {t('desktop.folders.new')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Grid2X2 />
            {t('desktop.folders.view')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              onValueChange={(value) =>
                onViewModeChange(value as LibraryViewMode)
              }
              value={viewMode}
            >
              {(
                [
                  ['canvas', Grid2X2, t('desktop.library.viewCanvas')],
                  ['list', ListIcon, t('desktop.library.viewList')],
                  ['columns', Columns3, t('desktop.library.viewColumns')],
                ] as const
              ).map(([mode, Icon, label]) => (
                <ContextMenuRadioItem key={mode} value={mode}>
                  <Icon />
                  {label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuCheckboxItem
          checked={useGroups}
          icon={<Boxes />}
          onSelect={() => onGroupChange(useGroups ? 'none' : groupBy)}
        >
          {t('desktop.folders.useGroups')}
        </ContextMenuCheckboxItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Boxes />
            {t('desktop.folders.groupBy')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              onValueChange={(value) =>
                onGroupChange(value as FinderSortKey | 'none')
              }
              value={useGroups ? groupBy : 'none'}
            >
              <ContextMenuRadioItem value="none">
                {t('desktop.folders.arrangementNone')}
              </ContextMenuRadioItem>
              <ContextMenuSeparator />
              {sortOptions.map(([value, label]) => (
                <ContextMenuRadioItem key={value} value={value}>
                  {label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <ArrowUpDown />
            {t('desktop.folders.arrangeBy')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              onValueChange={(value) => onSortChange(value as FinderSortKey)}
              value={listSortKey}
            >
              {sortOptions.map(([value, label]) => (
                <ContextMenuRadioItem key={value} value={value}>
                  {label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
            <ContextMenuSeparator />
            <ContextMenuRadioGroup
              onValueChange={(value) =>
                onSortDirectionChange(value as FinderSortDirection)
              }
              value={sortDirection}
            >
              <ContextMenuRadioItem value="descending">
                <ChevronDown />
                {t('desktop.folders.sortDescending')}
              </ContextMenuRadioItem>
              <ContextMenuRadioItem value="ascending">
                <ChevronUp />
                {t('desktop.folders.sortAscending')}
              </ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function SkillInfoHoverCard({
  className,
  skill,
}: {
  className?: string
  skill: InstalledSkill
}) {
  const { locale, t } = useI18n()
  const actions = useContext(FinderActionsContext)
  const resolvedDescription = resolveSkillDescription(skill, locale)
  const description =
    resolvedDescription.content.trim() || t('desktop.library.noDescription')
  const descriptionSource = {
    'ai-description': {
      icon: Sparkles,
      label: t('desktop.inspector.descriptionSourceAiGenerated'),
    },
    'ai-translation': {
      icon: Languages,
      label: t('desktop.inspector.descriptionSourceAiTranslation'),
    },
    original: {
      icon: Braces,
      label: t('desktop.inspector.descriptionSourceOriginal'),
    },
    'source-copy': {
      icon: HardDrive,
      label: t('desktop.inspector.descriptionSourceCopy'),
    },
  }[resolvedDescription.source]
  const DescriptionSourceIcon = descriptionSource.icon
  const scopeLabel =
    actions?.rootLabel ??
    (skill.scope === 'global'
      ? t('desktop.library.globalScope')
      : (skill.projectName ?? t('desktop.library.projectScope')))
  const statusLabel = getSkillUpdateStatusLabel(skill.updateCheck.status, t)

  return (
    <MouseHoverCard
      content={
        <>
          <div className="skill-hover-card-heading">
            <span aria-hidden="true">
              <Boxes />
            </span>
            <div>
              <strong>{skill.name}</strong>
              <small title={skill.source ?? skill.path}>
                {skill.source ?? t('desktop.library.localSkill')}
              </small>
            </div>
          </div>
          <div className="skill-hover-card-description">
            <div className="skill-hover-card-description-source">
              <span data-source={resolvedDescription.source}>
                <DescriptionSourceIcon />
                {descriptionSource.label}
              </span>
              {resolvedDescription.staleTranslation ? (
                <span data-state="stale">
                  <CircleAlert />
                  {t('desktop.inspector.descriptionTranslationStale')}
                </span>
              ) : null}
            </div>
            <p>{description}</p>
          </div>
          <div className="skill-hover-card-facts">
            {!actions?.skillActions ? (
              <span data-status={skill.updateCheck.status}>
                <SkillUpdateGlyph status={skill.updateCheck.status} />
                {statusLabel}
              </span>
            ) : null}
            <span>
              <HardDrive />
              {scopeLabel}
            </span>
            <span title={skill.linkTarget}>
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
          {skill.tags.length > 0 ? (
            <div className="skill-hover-card-tags">
              {skill.tags.slice(0, 4).map((tag) => (
                <span key={tag}>#{tag}</span>
              ))}
              {skill.tags.length > 4 ? (
                <span>+{skill.tags.length - 4}</span>
              ) : null}
            </div>
          ) : null}
        </>
      }
      contentProps={{
        align: 'end',
        className: 'skill-hover-card',
        collisionPadding: 12,
        side: 'top',
        sideOffset: 8,
      }}
      openDelay={320}
    >
      <button
        aria-label={t('desktop.library.previewInfoNamed', {
          name: skill.name,
        })}
        className={cn('skill-row-quick-button skill-info-trigger', className)}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        type="button"
      >
        <Info />
      </button>
    </MouseHoverCard>
  )
}

export function SkillRow({
  busyAction,
  contextSelectionCount = 1,
  contextSkillIds = [],
  draggable = true,
  dragging,
  group,
  groups,
  itemKey,
  moving,
  onDragEnd,
  onDragStart,
  onContextSelect,
  onImportToPacks,
  onMove,
  onRemove,
  onSelect,
  onTranslate,
  onUpdate,
  selected,
  skill,
}: {
  busyAction: string | null
  contextSelectionCount?: number
  contextSkillIds?: string[]
  draggable?: boolean
  dragging: boolean
  group?: ShelfGroup
  groups: ShelfGroup[]
  itemKey?: FinderCanvasItemKey
  moving: boolean
  onDragEnd: () => void
  onDragStart: (event: ReactDragEvent<HTMLElement>) => void
  onContextSelect?: () => void
  onImportToPacks?: () => void
  onMove: (folderId: string | null) => void
  onRemove: () => void
  onSelect: (event?: ReactMouseEvent<HTMLButtonElement>) => void
  onTranslate?: () => void
  onUpdate: () => void
  selected: boolean
  skill: InstalledSkill
}) {
  const actions = useContext(FinderActionsContext)
  const { locale, t } = useI18n()
  const updating = busyAction === `update:${skill.id}`
  const removing = busyAction === `remove:${skill.id}`
  const updateCheckFresh = isSkillUpdateCheckFresh(skill.updateCheck)
  const updateDisabled =
    Boolean(busyAction) ||
    (updateCheckFresh && skill.updateCheck.status !== 'update-available')
  const updateLabel = updateCheckFresh
    ? t('desktop.library.updateNamed', { name: skill.name })
    : t('desktop.library.checkAndUpdateNamed', { name: skill.name })
  const displayedUpdateLabel = updating
    ? t('desktop.library.updatingNamed', { name: skill.name })
    : updateLabel

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <article
          aria-busy={moving}
          aria-selected={itemKey ? selected : undefined}
          className={cn(
            'skill-row',
            selected && 'is-selected',
            dragging && 'is-dragging',
            moving && 'is-moving'
          )}
          data-finder-item-key={itemKey}
          data-finder-item-kind={itemKey ? 'skill' : undefined}
          draggable={draggable && !moving}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          onContextMenu={(event) => {
            event.stopPropagation()
            onContextSelect?.()
          }}
          role="listitem"
        >
          <button
            aria-label={t('desktop.library.viewDetailsNamed', {
              name: skill.name,
            })}
            className="skill-row-open"
            onClick={onSelect}
            type="button"
          >
            <span className="skill-row-copy">
              <span className="skill-row-title">
                <SkillUpdateIndicator check={skill.updateCheck} />
                {actions?.skillDecoration?.(skill.id)}
                <strong>{skill.name}</strong>
                {skill.installKind === 'symlink' ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="skill-title-link-indicator"
                        title={skill.linkTarget}
                      >
                        <Link2 />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t('desktop.library.installSymlink')}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                {group ? (
                  <Badge className="group-badge" variant="secondary">
                    {group.name}
                  </Badge>
                ) : null}
              </span>
              <span className="skill-row-description">
                {getSkillDescription(skill, locale) ||
                  t('desktop.library.noDescription')}
              </span>
              <span className="skill-row-meta">
                <span className="skill-scope-label">
                  {actions?.rootLabel ??
                    (skill.scope === 'global'
                      ? t('desktop.library.globalScope')
                      : (skill.projectName ??
                        t('desktop.library.projectScope')))}
                </span>
                <span className="skill-source-label">
                  {skill.source ?? t('desktop.library.localSkill')}
                </span>
                <span
                  className="skill-install-kind-label"
                  data-kind={skill.installKind}
                  title={skill.linkTarget}
                >
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
                {skill.tags.slice(0, 3).map((tag) => (
                  <span className="skill-tag-label" key={tag}>
                    #{tag}
                  </span>
                ))}
              </span>
            </span>
            <ChevronRight className="skill-row-chevron" />
          </button>
          <div className="skill-row-quick-actions">
            <SkillInfoHoverCard skill={skill} />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={t('desktop.library.openFolderNamed', {
                    name: skill.name,
                  })}
                  className="skill-row-quick-button"
                  onClick={() =>
                    actions?.openSkillFolder
                      ? actions.openSkillFolder(skill.id)
                      : void window.skillShelf.openSkillFolder(skill.id)
                  }
                  type="button"
                >
                  <FolderOpen />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {t('common.openFolder')}
              </TooltipContent>
            </Tooltip>
            {!actions?.skillActions ? (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-busy={updating}
                      aria-label={displayedUpdateLabel}
                      className="skill-row-quick-button"
                      disabled={updateDisabled}
                      onClick={onUpdate}
                      type="button"
                    >
                      {updating ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <RefreshCw />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {displayedUpdateLabel}
                  </TooltipContent>
                </Tooltip>
              </>
            ) : null}
          </div>
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>
          {contextSelectionCount > 1
            ? t('desktop.library.selectedItems', {
                count: contextSelectionCount,
              })
            : skill.name}
        </ContextMenuLabel>
        {contextSelectionCount === 1 ? (
          <>
            <ContextMenuItem onSelect={() => onSelect()}>
              <Info />
              {t('desktop.library.viewDetails')}
            </ContextMenuItem>
            <ContextMenuItem
              onSelect={() =>
                actions?.openSkillFolder
                  ? actions.openSkillFolder(skill.id)
                  : void window.skillShelf.openSkillFolder(skill.id)
              }
            >
              <FolderOpen />
              {t('common.openFolder')}
            </ContextMenuItem>
            {skill.sourceUrl ? (
              <ContextMenuItem
                onSelect={() =>
                  void window.skillShelf.openSkillSource(skill.id)
                }
              >
                <ArrowUpRight />
                {t('common.source')}
              </ContextMenuItem>
            ) : null}
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <FolderInput />
                {t('desktop.folders.moveTo')}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuCheckboxItem
                  checked={skill.groupId === null}
                  icon={<FolderOpen />}
                  onCheckedChange={() => onMove(null)}
                >
                  {t('desktop.folders.unfiled')}
                </ContextMenuCheckboxItem>
                {groups.map((folder) => (
                  <ContextMenuCheckboxItem
                    checked={skill.groupId === folder.id}
                    icon={<Folder />}
                    key={folder.id}
                    onCheckedChange={() => onMove(folder.id)}
                  >
                    {folder.name}
                  </ContextMenuCheckboxItem>
                ))}
                {groups.length === 0 ? (
                  <ContextMenuLabel>
                    {t('desktop.folders.empty')}
                  </ContextMenuLabel>
                ) : null}
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        ) : null}
        {actions?.skillActions ? (
          actions.skillActions(skill.id, contextSkillIds)
        ) : (
          <>
            {onTranslate ? (
              <ContextMenuItem onSelect={onTranslate}>
                <Languages />
                {contextSelectionCount > 1
                  ? t('desktop.library.translateSelection')
                  : t('desktop.library.translateDescription')}
              </ContextMenuItem>
            ) : null}
            {onImportToPacks ? (
              <ContextMenuItem onSelect={onImportToPacks}>
                <PackagePlus />
                {contextSelectionCount > 1
                  ? t('desktop.library.importSelectionToPacks')
                  : t('desktop.library.importToPacks')}
              </ContextMenuItem>
            ) : null}
            <ContextMenuSeparator />
            {contextSelectionCount === 1 ? (
              <>
                <ContextMenuItem disabled={updateDisabled} onSelect={onUpdate}>
                  {updating ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <RefreshCw />
                  )}
                  {updating
                    ? t('desktop.library.updating')
                    : t('desktop.inspector.update')}
                </ContextMenuItem>
                <ContextMenuItem
                  className="skill-context-menu-destructive"
                  disabled={removing}
                  onSelect={onRemove}
                >
                  <Trash2 />
                  {t('desktop.inspector.remove')}
                </ContextMenuItem>
              </>
            ) : null}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function SkillUpdateIndicator({ check }: { check: SkillUpdateCheck }) {
  const { locale, t } = useI18n()
  const actions = useContext(FinderActionsContext)
  if (actions?.skillActions) return null
  const statusLabel = getSkillUpdateStatusLabel(check.status, t)
  const reasonLabel = getSkillUpdateReasonLabel(check.reason, t)
  const stale = check.status !== 'unchecked' && !isSkillUpdateCheckFresh(check)
  const checkedAt = check.checkedAt
    ? new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        day: 'numeric',
      }).format(new Date(check.checkedAt))
    : null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={statusLabel}
          className="skill-update-indicator"
          data-stale={stale ? 'true' : undefined}
          data-status={check.status}
          role="img"
        >
          <SkillUpdateGlyph status={check.status} />
        </span>
      </TooltipTrigger>
      <TooltipContent className="skill-update-tooltip" side="top">
        <strong>{statusLabel}</strong>
        <span>{reasonLabel}</span>
        {stale ? (
          <small data-state="stale">
            {t('desktop.library.updateResultStale')}
          </small>
        ) : null}
        {checkedAt ? (
          <small>
            {t('desktop.library.updateCheckedAt', { time: checkedAt })}
          </small>
        ) : null}
      </TooltipContent>
    </Tooltip>
  )
}

export function SkillUpdateGlyph({ status }: { status: SkillUpdateStatus }) {
  if (status === 'current') return <CircleCheck />
  if (status === 'update-available') return <CircleArrowUp />
  if (status === 'missing') return <CircleX />
  if (status === 'unavailable') return <CircleQuestionMark />
  return <CircleDashed />
}

export function getFolderBreadcrumbs(
  folderId: string | null,
  folders: ShelfGroup[]
): ShelfGroup[] {
  const breadcrumbs: ShelfGroup[] = []
  const visited = new Set<string>()
  let currentId = folderId
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const folder = folders.find((item) => item.id === currentId)
    if (!folder) break
    breadcrumbs.unshift(folder)
    currentId = folder.parentId
  }
  return breadcrumbs
}

export function getDefaultCanvasPosition(index: number): CanvasPosition {
  return {
    x: 28 + (index % 7) * 124,
    y: 24 + Math.floor(index / 7) * 122,
  }
}

export function getNextAvailableCanvasPosition(
  occupiedPositions: CanvasPosition[]
): CanvasPosition {
  let index = 0
  while (index < 10_000) {
    const candidate = getDefaultCanvasPosition(index)
    const occupied = occupiedPositions.some(
      (position) =>
        Math.abs(position.x - candidate.x) < 108 &&
        Math.abs(position.y - candidate.y) < 102
    )
    if (!occupied) return candidate
    index += 1
  }
  return getDefaultCanvasPosition(occupiedPositions.length)
}

export function getSkillUpdateStatusLabel(
  status: SkillUpdateStatus,
  t: ReturnType<typeof useI18n>['t']
) {
  if (status === 'current') return t('desktop.library.updateStatusCurrent')
  if (status === 'update-available') {
    return t('desktop.library.updateStatusAvailable')
  }
  if (status === 'missing') return t('desktop.library.updateStatusMissing')
  if (status === 'unavailable') {
    return t('desktop.library.updateStatusUnavailable')
  }
  return t('desktop.library.updateStatusUnchecked')
}

export function getFinderGroupLabel(
  key: string,
  groupBy: FinderSortKey,
  t: ReturnType<typeof useI18n>['t']
) {
  if (groupBy === 'kind') {
    return key === 'folder'
      ? t('desktop.folders.groupFolders')
      : t('desktop.folders.groupSkills')
  }
  if (groupBy === 'source' && key === 'unknown') {
    return t('desktop.folders.groupUnknown')
  }
  if (groupBy === 'tags' && key === 'untagged') {
    return t('desktop.folders.groupUntagged')
  }
  if (groupBy === 'update-status') {
    if (key === 'folder') return t('desktop.folders.groupFolders')
    if (
      key === 'current' ||
      key === 'missing' ||
      key === 'unavailable' ||
      key === 'unchecked' ||
      key === 'update-available'
    ) {
      return getSkillUpdateStatusLabel(key, t)
    }
  }
  return key
}

export function getSkillUpdateReasonLabel(
  reason: SkillUpdateCheck['reason'],
  t: ReturnType<typeof useI18n>['t']
) {
  if (reason === 'up-to-date') {
    return t('desktop.library.updateReasonCurrent')
  }
  if (reason === 'remote-changed') {
    return t('desktop.library.updateReasonAvailable')
  }
  if (reason === 'remote-missing') {
    return t('desktop.library.updateReasonMissing')
  }
  if (reason === 'local-source') {
    return t('desktop.library.updateReasonLocal')
  }
  if (reason === 'untracked') {
    return t('desktop.library.updateReasonUntracked')
  }
  if (reason === 'unsupported-source') {
    return t('desktop.library.updateReasonUnsupported')
  }
  if (reason === 'source-unavailable') {
    return t('desktop.library.updateReasonSourceUnavailable')
  }
  if (reason === 'network-error') {
    return t('desktop.library.updateReasonNetwork')
  }
  return t('desktop.library.updateReasonUnchecked')
}
