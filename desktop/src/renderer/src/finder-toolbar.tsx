import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@skill-shelf/ui'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpDown,
  Boxes,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Columns3,
  FolderPlus,
  HardDrive,
  Grid2X2,
  List as ListIcon,
} from 'lucide-react'
import type {
  ShelfGroup,
  FinderSortKey,
  FinderSortDirection,
  LibraryViewMode,
} from '../../shared/desktop-contract'
import { useI18n } from '@skill-shelf/i18n/react'
export function FinderToolbar({
  rootTitle,
  breadcrumbs,
  finderNavigation,
  navigateFinder,
  openFolder,
  viewMode,
  changeCurrentFinderViewMode,
  filtering,
  finderUsesGroups,
  finderGroupBy,
  finderSortBy,
  finderSortDirection,
  changeCurrentFinderGroup,
  changeCurrentFinderSort,
  changeCurrentFinderSortDirection,
  cleanUpCurrentFolder,
  openCreateFolder,
  itemCount,
}: {
  rootTitle: string
  breadcrumbs: ShelfGroup[]
  finderNavigation: { index: number; entries: (string | null)[] }
  navigateFinder: (action: { type: 'back' | 'forward' }) => void
  openFolder: (id: string | null) => void
  viewMode: LibraryViewMode
  changeCurrentFinderViewMode: (mode: LibraryViewMode) => void
  filtering: boolean
  finderUsesGroups: boolean
  finderGroupBy: FinderSortKey
  finderSortBy: FinderSortKey | 'none'
  finderSortDirection: FinderSortDirection
  changeCurrentFinderGroup: (key: FinderSortKey | 'none') => void
  changeCurrentFinderSort: (key: FinderSortKey | 'none') => void
  changeCurrentFinderSortDirection: (direction: FinderSortDirection) => void
  cleanUpCurrentFolder: (key: FinderSortKey | 'position') => void
  openCreateFolder: () => void
  itemCount: number
}) {
  const { t } = useI18n()
  const finderSortOptions: Array<[FinderSortKey, string]> = [
    ['name', t('desktop.folders.arrangementName')],
    ['kind', t('desktop.folders.arrangementKind')],
    ['source', t('desktop.folders.arrangementSource')],
    ['update-status', t('desktop.folders.arrangementUpdateStatus')],
    ['tags', t('desktop.folders.arrangementTags')],
  ]
  const activeSortLabel =
    finderSortBy === 'none'
      ? t('desktop.folders.arrangementNone')
      : finderSortOptions.find(([key]) => key === finderSortBy)?.[1]
  return (
    <div className="finder-navigation">
      <div
        aria-label={t('desktop.folders.history')}
        className="finder-history-controls"
        role="group"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={t('desktop.folders.back')}
              disabled={finderNavigation.index === 0}
              onClick={() => navigateFinder({ type: 'back' })}
              type="button"
            >
              <ArrowLeft />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t('desktop.folders.back')}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              aria-label={t('desktop.folders.forward')}
              disabled={
                finderNavigation.index === finderNavigation.entries.length - 1
              }
              onClick={() => navigateFinder({ type: 'forward' })}
              type="button"
            >
              <ArrowRight />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {t('desktop.folders.forward')}
          </TooltipContent>
        </Tooltip>
      </div>
      <nav aria-label={t('desktop.folders.location')}>
        <button onClick={() => openFolder(null)} type="button">
          <HardDrive />
          {rootTitle}
        </button>
        {breadcrumbs.map((folder) => (
          <span key={folder.id}>
            <ChevronRight />
            <button onClick={() => openFolder(folder.id)} type="button">
              {folder.name}
            </button>
          </span>
        ))}
      </nav>
      <div
        aria-label={t('desktop.library.viewMode')}
        className="library-view-switcher finder-view-switcher"
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
                onClick={() => changeCurrentFinderViewMode(mode)}
                type="button"
              >
                <Icon />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className="finder-sort-trigger"
            disabled={filtering}
            size="xs"
            variant="ghost"
          >
            <Boxes />
            {t('desktop.folders.groupBy')}
            <span className="finder-sort-current">
              {finderUsesGroups
                ? finderSortOptions.find(
                    ([value]) => value === finderGroupBy
                  )?.[1]
                : t('desktop.folders.arrangementNone')}
            </span>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="finder-sort-menu">
          <DropdownMenuLabel>{t('desktop.folders.groupBy')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            onValueChange={(value) =>
              changeCurrentFinderGroup(value as FinderSortKey | 'none')
            }
            value={finderUsesGroups ? finderGroupBy : 'none'}
          >
            <DropdownMenuRadioItem value="none">
              {t('desktop.folders.arrangementNone')}
            </DropdownMenuRadioItem>
            <DropdownMenuSeparator />
            {finderSortOptions.map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            className="finder-sort-trigger"
            disabled={filtering}
            size="xs"
            variant="ghost"
          >
            <ArrowUpDown />
            {t('desktop.folders.sort')}
            <span className="finder-sort-current">{activeSortLabel}</span>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="finder-sort-menu">
          <DropdownMenuLabel>
            {t('desktop.folders.arrangeBy')}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            onValueChange={(value) =>
              changeCurrentFinderSort(value as FinderSortKey | 'none')
            }
            value={finderSortBy}
          >
            {viewMode === 'canvas' ? (
              <DropdownMenuRadioItem value="none">
                {t('desktop.folders.arrangementNone')}
              </DropdownMenuRadioItem>
            ) : null}
            {finderSortOptions.map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {finderSortBy !== 'none' ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                onValueChange={(value) =>
                  changeCurrentFinderSortDirection(value as FinderSortDirection)
                }
                value={finderSortDirection}
              >
                <DropdownMenuRadioItem value="descending">
                  <ChevronDown />
                  {t('desktop.folders.sortDescending')}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="ascending">
                  <ChevronUp />
                  {t('desktop.folders.sortAscending')}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </>
          ) : null}
          {viewMode === 'canvas' ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={
                  finderUsesGroups || finderSortBy !== 'none' || itemCount < 2
                }
                onSelect={() => cleanUpCurrentFolder('position')}
              >
                <Grid2X2 />
                {t('desktop.folders.cleanUp')}
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  disabled={
                    finderUsesGroups || finderSortBy !== 'none' || itemCount < 2
                  }
                >
                  <ArrowDown />
                  {t('desktop.folders.cleanUpBy')}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {finderSortOptions.map(([value, label]) => (
                    <DropdownMenuItem
                      key={value}
                      onSelect={() => cleanUpCurrentFolder(value)}
                    >
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button onClick={() => openCreateFolder()} size="xs" variant="ghost">
        <FolderPlus />
        {t('desktop.folders.new')}
      </Button>
    </div>
  )
}
