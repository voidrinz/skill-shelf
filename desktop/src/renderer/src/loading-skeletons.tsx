import { useState, type CSSProperties, type ReactNode } from 'react'
import { useI18n } from '@skill-shelf/i18n/react'
import { Button, cn, PageHeader } from '@skill-shelf/ui'
import { Download, FolderInput, PencilLine, Search, Trash2 } from 'lucide-react'
import type { DiscoverySection } from '../../shared/desktop-contract'
import { FinderToolbar } from './finder-toolbar'
import {
  MANAGED_SCOPE_COLLAPSED_STORAGE_KEY,
  MANAGED_SCOPE_WIDTH_STORAGE_KEY,
} from './library-scope-layout'
import { useLibraryScopeResize } from './use-library-scope-resize'

function Block({
  width = '100%',
  height = 10,
  className = '',
}: {
  width?: CSSProperties['width']
  height?: number
  className?: string
}) {
  return (
    <span className={`skeleton-block ${className}`} style={{ width, height }} />
  )
}

function LoadingLayout({
  children,
  className,
  label,
}: {
  children: ReactNode
  className: string
  label: string
}) {
  return (
    <div aria-label={label} className={className} role="status">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="skeleton-layout">
        {children}
      </div>
    </div>
  )
}

function Copy({ wide = false }: { wide?: boolean }) {
  return (
    <div className="skeleton-copy">
      <Block width={wide ? '72%' : '54%'} />
      <Block height={8} width={wide ? '92%' : '78%'} />
    </div>
  )
}

export function WorkbenchSkeleton() {
  const { t } = useI18n()
  return (
    <LoadingLayout
      className="workbench-board workbench-skeleton"
      label={t('desktop.workbench.scanning')}
    >
      <div className="workbench-inventory">
        <header>
          <Block height={18} width={18} />
          <Block width={120} height={13} />
          <Block width={62} />
        </header>
        <div className="workbench-inventory-locations">
          {[0, 1].map((index) => (
            <div
              className={index === 0 ? 'workbench-shared-location' : ''}
              key={index}
            >
              <div className="workbench-location-heading">
                <Block width={96} height={12} />
                <Block width={48} height={24} />
              </div>
              <div className="skeleton-location-copy">
                <Block width="66%" />
                <Block width="96%" />
                <Block width="84%" />
                <Block width="72%" height={8} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="workbench-agent-panel">
        <div className="workbench-section-heading">
          <Block width={18} height={18} />
          <Copy />
          <Block width={86} height={28} />
        </div>
        <div className="workbench-agent-toolbar">
          <div className="skeleton-filter-group">
            {[66, 88, 88, 76, 68].map((width, index) => (
              <Block height={28} key={index} width={width} />
            ))}
          </div>
          <div className="workbench-agent-search">
            <Block height={31} />
          </div>
        </div>
        <div className="workbench-agent-columns">
          {[64, 72, 64, 52, 12].map((width, index) => (
            <Block key={index} width={width} height={8} />
          ))}
        </div>
        {Array.from({ length: 6 }, (_, index) => (
          <div className="workbench-agent" key={index}>
            <div className="workbench-agent-row skeleton-agent-row">
              <Copy />
              <Block width={78} />
              <Copy />
              <Block width={28} />
              <Block width={12} />
            </div>
          </div>
        ))}
        <div className="skeleton-agent-footer">
          <Block width="70%" height={8} />
        </div>
      </div>
      <div className="workbench-file-checks skeleton-file-checks">
        <Block width={16} height={16} />
        <Block width="40%" />
        <Block width={12} />
      </div>
    </LoadingLayout>
  )
}

type SkillSkeletonView = 'canvas' | 'list' | 'columns' | 'icons'

export function PacksWorkspaceSkeleton() {
  const [collapsed] = useState(() => {
    try {
      return (
        window.localStorage.getItem(MANAGED_SCOPE_COLLAPSED_STORAGE_KEY) ===
        'true'
      )
    } catch {
      return false
    }
  })
  const resize = useLibraryScopeResize(
    collapsed,
    MANAGED_SCOPE_WIDTH_STORAGE_KEY
  )
  return (
    <div
      aria-busy="true"
      className="library-workspace finder-library-workspace managed-workspace packs-workspace-skeleton"
      data-scope-collapsed={collapsed}
      ref={resize.workspaceRef}
      style={resize.style}
    >
      {collapsed ? (
        <div aria-hidden="true" className="scope-panel-rail" />
      ) : null}
      <aside className="library-scope-panel managed-pack-sidebar">
        <PacksSidebarSkeleton />
      </aside>
      <section className="library-pane finder-library-pane managed-content">
        <PacksContentSkeleton />
      </section>
    </div>
  )
}

function SkeletonText({ children }: { children: ReactNode }) {
  return (
    <span className="packs-skeleton-text">
      <span>{children}</span>
      <Block width="80%" />
    </span>
  )
}

export function PacksSidebarSkeleton({
  collapseControl,
}: {
  collapseControl?: ReactNode
} = {}) {
  const { t } = useI18n()
  return (
    <div
      aria-hidden={collapseControl ? undefined : true}
      className="skeleton-layout"
    >
      <header className="scope-panel-header">
        <div className="scope-panel-title">
          <span aria-hidden="true">
            <SkeletonText>{t('desktop.managed.packs')}</SkeletonText>
          </span>
          {collapseControl ?? <Block width={46} height={21} />}
        </div>
        <p aria-hidden="true">
          <SkeletonText>{t('desktop.managed.sidebarDescription')}</SkeletonText>
        </p>
      </header>
      <section
        aria-hidden="true"
        className="scope-projects managed-pack-section"
      >
        <header>
          <div>
            <Block width={42} />
            <Block width={14} />
          </div>
          <Block width={24} height={24} />
        </header>
        <div className="scope-filter-list managed-pack-list">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="packs-skeleton-sidebar-row" key={index}>
              <Block width={24} height={24} />
              <Copy />
              <Block width={14} />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export function PacksContentSkeleton() {
  const { t } = useI18n()
  const idle = () => {}
  return (
    <LoadingLayout
      className="packs-content-skeleton"
      label={t('common.loading')}
    >
      <PageHeader
        className="library-page-header finder-page-header"
        eyebrow={<SkeletonText>{t('desktop.managed.eyebrow')}</SkeletonText>}
        title={<SkeletonText>Default</SkeletonText>}
        description={
          <SkeletonText>
            {t('desktop.managed.packWorkspaceDescription')}
          </SkeletonText>
        }
        actions={
          <div className="packs-skeleton-controls packs-skeleton-actions" inert>
            <div className="managed-pack-actions">
              <Button size="xs" variant="ghost" tabIndex={-1}>
                <Download />
                {t('desktop.managed.exportPack')}
              </Button>
              <Button size="xs" variant="ghost" tabIndex={-1}>
                <PencilLine />
                {t('desktop.managed.editPack')}
              </Button>
              <Button size="icon-sm" variant="ghost" tabIndex={-1}>
                <Trash2 />
              </Button>
            </div>
            <Button size="sm" tabIndex={-1}>
              <FolderInput />
              {t('desktop.managed.import')}
            </Button>
          </div>
        }
      />
      <div className="finder-content managed-finder-content">
        <div className="pack-finder">
          <div className="packs-skeleton-controls" inert>
            <FinderToolbar
              rootTitle="Default"
              breadcrumbs={[]}
              finderNavigation={{ index: 0, entries: [null] }}
              navigateFinder={idle}
              openFolder={idle}
              viewMode="canvas"
              changeCurrentFinderViewMode={idle}
              filtering={false}
              finderUsesGroups={false}
              finderGroupBy="kind"
              finderSortBy="none"
              finderSortDirection="descending"
              changeCurrentFinderGroup={idle}
              changeCurrentFinderSort={idle}
              changeCurrentFinderSortDirection={idle}
              cleanUpCurrentFolder={idle}
              openCreateFolder={idle}
              itemCount={0}
            />
          </div>
          <div className="library-toolbar finder-toolbar managed-toolbar">
            <div className="search-control">
              <Block height={36} />
              <div className="packs-skeleton-controls" inert>
                <Button size="sm" variant="outline" tabIndex={-1}>
                  <Search />
                  {t('common.filter')}
                </Button>
              </div>
            </div>
            <div className="library-toolbar-meta">
              <Block width={52} height={22} />
            </div>
          </div>
          <div className="finder-content pack-finder-body">
            <SkillsSkeleton view="canvas" />
          </div>
        </div>
      </div>
    </LoadingLayout>
  )
}

export function SkillsSkeleton({
  view,
  layout = 'finder',
}: {
  view: SkillSkeletonView
  layout?: 'finder' | 'managed' | 'cards'
}) {
  const { t } = useI18n()
  const icons = layout !== 'cards' && (view === 'canvas' || view === 'icons')
  return (
    <LoadingLayout
      className={`skills-skeleton is-${layout} is-${icons ? 'icons' : view}`}
      label={t(
        layout === 'managed' ? 'common.loading' : 'desktop.library.loading'
      )}
    >
      {icons ? (
        Array.from({ length: 12 }, (_, index) => (
          <div className="skeleton-skill-icon" key={index}>
            <Block
              width={layout === 'managed' ? 56 : 58}
              height={layout === 'managed' ? 56 : 58}
            />
            <Block width={index % 3 === 0 ? 68 : 88} height={9} />
          </div>
        ))
      ) : view === 'columns' ? (
        Array.from({ length: layout === 'cards' ? 3 : 1 }, (_, column) => (
          <div className="skeleton-skill-column" key={column}>
            <header>
              <Block width={110} height={9} />
            </header>
            {Array.from({ length: 6 }, (_, index) => (
              <SkillSkeletonRow cards={layout === 'cards'} key={index} />
            ))}
          </div>
        ))
      ) : (
        <>
          {layout !== 'cards' ? (
            <SkillSkeletonRow header managed={layout === 'managed'} />
          ) : null}
          {Array.from({ length: layout === 'cards' ? 6 : 10 }, (_, index) => (
            <SkillSkeletonRow
              cards={layout === 'cards' && view !== 'list'}
              managed={layout === 'managed'}
              key={index}
            />
          ))}
        </>
      )}
    </LoadingLayout>
  )
}

function SkillSkeletonRow({
  header = false,
  managed = false,
  cards = false,
}: {
  header?: boolean
  managed?: boolean
  cards?: boolean
}) {
  return (
    <div
      className={cn(
        'skeleton-skill-row',
        header && 'is-header',
        cards && 'is-card'
      )}
    >
      <Block width={header ? '45%' : '64%'} height={header ? 8 : 10} />
      <Block width="84%" height={8} />
      <Block width="58%" height={8} />
      {managed ? (
        <>
          <Block width="72%" height={8} />
          <Block width={56} height={22} />
        </>
      ) : null}
    </div>
  )
}

export function DiscoverySkeleton({
  section = 'skills',
}: {
  section?: DiscoverySection | 'skills' | 'repositories'
}) {
  const { t } = useI18n()
  const catalog =
    section === 'home' || section === 'topics' || section === 'official'
  return (
    <LoadingLayout
      className={`discovery-skeleton is-${section}`}
      label={t('desktop.discover.native.loading')}
    >
      {catalog && section !== 'topics' ? (
        <>
          <div className="discovery-filter-row">
            <Block width={section === 'home' ? 200 : 112} height={30} />
            <Block width={230} height={30} />
          </div>
          <div className="discovery-results-summary">
            <Block width={130} height={8} />
          </div>
        </>
      ) : null}
      {section === 'topics' ? (
        <div className="discovery-topics-layout">
          <nav>
            {Array.from({ length: 7 }, (_, index) => (
              <div className="skeleton-topic" key={index}>
                <Copy wide />
              </div>
            ))}
          </nav>
          <div className="discovery-topic-detail">
            <header>
              <Copy wide />
            </header>
            <DiscoverySkeletonRows />
          </div>
        </div>
      ) : (
        <DiscoverySkeletonRows
          kind={
            section === 'official'
              ? 'official'
              : section === 'repositories'
                ? 'repositories'
                : 'skills'
          }
        />
      )}
    </LoadingLayout>
  )
}

function DiscoverySkeletonRows({
  kind = 'skills',
}: {
  kind?: 'skills' | 'official' | 'repositories'
}) {
  return (
    <div className={`discovery-skeleton-rows is-${kind}`}>
      {Array.from({ length: kind === 'repositories' ? 6 : 12 }, (_, index) => (
        <div className="discovery-skeleton-row" key={index}>
          <Block
            width={kind === 'skills' ? 18 : 28}
            height={kind === 'skills' ? 9 : 28}
          />
          <Copy wide />
          <Block width={36} height={8} />
          <Block
            width={kind === 'skills' ? 52 : 24}
            height={kind === 'skills' ? 26 : 12}
          />
        </div>
      ))}
    </div>
  )
}

export function ProjectsSkeleton() {
  const { t } = useI18n()
  return (
    <LoadingLayout
      className="project-list projects-skeleton"
      label={t('common.loading')}
    >
      {Array.from({ length: 4 }, (_, index) => (
        <div className="project-row" key={index}>
          <Block width={36} height={36} />
          <div className="skeleton-copy">
            <Copy />
            <Block width="35%" height={8} />
          </div>
          <Block width={96} height={30} />
          <Block width={28} height={28} />
        </div>
      ))}
    </LoadingLayout>
  )
}

export function FileContentSkeleton() {
  const { t } = useI18n()
  return (
    <LoadingLayout
      className="file-content-skeleton"
      label={t('desktop.files.opening')}
    >
      <FileContentBlocks />
    </LoadingLayout>
  )
}

function FileContentBlocks() {
  return (
    <>
      {[52, 94, 86, 90, 64, 0, 88, 96, 76, 92].map((width, index) => (
        <Block width={`${width}%`} key={index} />
      ))}
    </>
  )
}

export function FileBrowserSkeleton() {
  const { t } = useI18n()
  return (
    <LoadingLayout
      className="skill-file-browser file-browser-skeleton"
      label={t('desktop.files.reading')}
    >
      <div className="skill-file-tree-pane">
        <div className="file-tree-heading">
          <Block width={72} height={8} />
        </div>
        <div className="skeleton-file-tree">
          {[88, 72, 96, 64, 80, 70].map((width, index) => (
            <div key={index} style={{ paddingLeft: index > 1 ? 12 : 0 }}>
              <Block width={13} height={13} />
              <Block width={`${width}%`} height={8} />
            </div>
          ))}
        </div>
      </div>
      <div className="skill-file-preview">
        <div className="file-preview-toolbar">
          <Block width={126} />
        </div>
        <div className="file-preview-content">
          <div className="file-content-skeleton">
            <FileContentBlocks />
          </div>
        </div>
      </div>
    </LoadingLayout>
  )
}
