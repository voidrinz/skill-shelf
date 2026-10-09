import { SearchField } from './search-field'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  FolderGit2,
  LoaderCircle,
  PackagePlus,
  RefreshCw,
  Search,
} from 'lucide-react'
import {
  Badge,
  Button,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'
import { DiscoverySkeleton } from './loading-skeletons'

import type {
  CatalogSnapshot,
  DiscoveryHomeSnapshot,
  DiscoveryLeaderboard,
  DiscoveryOfficialCreatorDetail,
  DiscoveryOfficialRepository,
  DiscoveryOfficialRepositoryDetail,
  DiscoveryOfficialSnapshot,
  DiscoveryOfficialSource,
  DiscoverySection,
  DiscoverySkill,
  DiscoverySnapshot,
  DiscoveryTopicDetail,
  DiscoveryTopicsSnapshot,
} from '../../shared/desktop-contract'

const DISCOVERY_PAGE_SIZE = 36

export default function DiscoveryCatalogPanel({
  catalog,
  onInstall,
  section,
}: {
  catalog: CatalogSnapshot | null
  onInstall: (source: string) => void
  section: DiscoverySection
}) {
  const { date, t } = useI18n()
  const [snapshot, setSnapshot] = useState<DiscoverySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)
  const requestId = useRef(0)

  const loadSnapshot = useCallback(
    async (force: boolean) => {
      const currentRequest = ++requestId.current
      if (force) setRefreshing(true)
      else setLoading(true)
      setFailed(false)
      try {
        const next = await window.skillShelf.getDiscoverySnapshot(
          section,
          force
        )
        if (requestId.current === currentRequest) setSnapshot(next)
      } catch {
        if (requestId.current === currentRequest) setFailed(true)
      } finally {
        if (requestId.current === currentRequest) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [section]
  )

  useEffect(() => {
    setSnapshot(null)
    void loadSnapshot(false)
    return () => {
      requestId.current += 1
    }
  }, [loadSnapshot])

  if (failed && !snapshot && !loading && !refreshing) {
    return <DiscoveryFailure onRetry={() => void loadSnapshot(true)} />
  }

  return (
    <section className="discovery-catalog-panel">
      <header className="discovery-data-toolbar">
        <div className="discovery-data-heading">
          <strong>{t(`desktop.discover.native.${section}.title`)}</strong>
          <span>{t(`desktop.discover.native.${section}.description`)}</span>
        </div>
        <div className="discovery-data-status">
          {snapshot ? (
            <span>
              {snapshot.stale
                ? t('desktop.discover.native.cached')
                : t('desktop.discover.native.updated', {
                    time: date(snapshot.fetchedAt, {
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  })}
            </span>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('desktop.discover.native.refresh')}
                disabled={loading || refreshing}
                onClick={() => void loadSnapshot(true)}
                size="icon-sm"
                variant="ghost"
              >
                <RefreshCw className={cn(refreshing && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t('desktop.discover.native.refresh')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('desktop.discover.native.openSource')}
                disabled={!snapshot}
                onClick={() =>
                  snapshot
                    ? void window.skillShelf.openDiscoveryWebsite(
                        snapshot.sourceUrl
                      )
                    : undefined
                }
                size="icon-sm"
                variant="ghost"
              >
                <ArrowUpRight />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t('desktop.discover.native.openSource')}
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      {snapshot?.warning ? (
        <div className="discovery-cache-warning" role="status">
          <CircleAlert />
          {t('desktop.discover.native.refreshFailed')}
        </div>
      ) : null}

      {!snapshot && (loading || refreshing) ? (
        <DiscoverySkeleton section={section} />
      ) : snapshot?.section === 'home' ? (
        <HomeDiscovery
          catalog={catalog}
          onInstall={onInstall}
          snapshot={snapshot}
        />
      ) : snapshot?.section === 'topics' ? (
        <TopicsDiscovery
          catalog={catalog}
          onInstall={onInstall}
          snapshot={snapshot}
        />
      ) : snapshot?.section === 'official' ? (
        <OfficialDiscovery
          catalog={catalog}
          onInstall={onInstall}
          snapshot={snapshot}
        />
      ) : null}
    </section>
  )
}

function HomeDiscovery({
  catalog,
  onInstall,
  snapshot,
}: {
  catalog: CatalogSnapshot | null
  onInstall: (source: string) => void
  snapshot: DiscoveryHomeSnapshot
}) {
  const { t } = useI18n()
  const [leaderboard, setLeaderboard] =
    useState<DiscoveryLeaderboard>('trending')
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(DISCOVERY_PAGE_SIZE)
  const scrollRootRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const collection =
    snapshot.collections.find((item) => item.id === leaderboard) ??
    snapshot.collections[0]
  const skills = useMemo(() => {
    const normalized = query.toLocaleLowerCase()
    if (!normalized) return collection?.skills ?? []
    return (collection?.skills ?? []).filter(
      (skill) =>
        skill.name.toLocaleLowerCase().includes(normalized) ||
        skill.displayRepo.toLocaleLowerCase().includes(normalized)
    )
  }, [collection, query])
  const visibleSkills = skills.slice(0, visibleCount)
  const hasMore = visibleSkills.length < skills.length

  useEffect(() => {
    setVisibleCount(DISCOVERY_PAGE_SIZE)
    scrollRootRef.current?.scrollTo({ top: 0 })
  }, [leaderboard, query, snapshot.fetchedAt])

  useEffect(() => {
    const target = loadMoreRef.current
    const root = scrollRootRef.current
    if (!target || !root || !hasMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setVisibleCount((current) =>
          Math.min(skills.length, current + DISCOVERY_PAGE_SIZE)
        )
      },
      { root, rootMargin: '240px 0px', threshold: 0.01 }
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, skills.length, visibleCount])

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setQuery(queryDraft.trim())
  }

  return (
    <div className="discovery-native-content" ref={scrollRootRef}>
      <div className="discovery-filter-row">
        <div
          aria-label={t('desktop.discover.native.leaderboards')}
          className="discovery-leaderboard-switcher"
          role="group"
        >
          {(['trending', 'hot', 'all'] as const).map((value) => (
            <button
              aria-pressed={leaderboard === value}
              className={cn(leaderboard === value && 'is-active')}
              key={value}
              onClick={() => setLeaderboard(value)}
              type="button"
            >
              {t(`desktop.discover.native.leaderboard.${value}`)}
            </button>
          ))}
        </div>
        <DiscoverySearch
          appliedValue={query}
          onChange={setQueryDraft}
          onClear={() => {
            setQueryDraft('')
            setQuery('')
          }}
          onSubmit={applySearch}
          placeholder={t('desktop.discover.native.filterSkills')}
          value={queryDraft}
        />
      </div>
      <div className="discovery-results-summary">
        <span>
          {t('desktop.discover.native.skillsProgress', {
            shown: visibleSkills.length,
            total: skills.length,
          })}
        </span>
        {collection?.total ? (
          <span>
            {t('desktop.discover.native.directoryTotal', {
              count: collection.total,
            })}
          </span>
        ) : null}
      </div>
      {skills.length ? (
        <>
          <div className="discovery-skill-list">
            {visibleSkills.map((skill) => (
              <DiscoverySkillCard
                installed={isSkillInstalled(catalog, skill)}
                key={`${leaderboard}:${skill.url}`}
                onInstall={onInstall}
                skill={skill}
              />
            ))}
          </div>
          <div className="discovery-load-more" ref={loadMoreRef}>
            {hasMore ? (
              <Button
                onClick={() =>
                  setVisibleCount((current) =>
                    Math.min(skills.length, current + DISCOVERY_PAGE_SIZE)
                  )
                }
                size="sm"
                variant="ghost"
              >
                {t('desktop.discover.native.loadMore')}
              </Button>
            ) : (
              <span>{t('desktop.discover.native.endOfList')}</span>
            )}
          </div>
        </>
      ) : (
        <DiscoveryEmpty label={t('desktop.discover.native.noFilteredSkills')} />
      )}
    </div>
  )
}

function TopicsDiscovery({
  catalog,
  onInstall,
  snapshot,
}: {
  catalog: CatalogSnapshot | null
  onInstall: (source: string) => void
  snapshot: DiscoveryTopicsSnapshot
}) {
  const { t } = useI18n()
  const [selectedSlug, setSelectedSlug] = useState(
    () => snapshot.topics[0]?.slug ?? ''
  )
  const [details, setDetails] = useState<Record<string, DiscoveryTopicDetail>>(
    {}
  )
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null)
  const [failedSlug, setFailedSlug] = useState<string | null>(null)
  const selectedTopic = snapshot.topics.find(
    (topic) => topic.slug === selectedSlug
  )
  const detail = details[selectedSlug]

  const loadTopic = useCallback(async (slug: string, force: boolean) => {
    setLoadingSlug(slug)
    setFailedSlug(null)
    try {
      const next = await window.skillShelf.getDiscoveryTopic(slug, force)
      setDetails((current) => ({ ...current, [slug]: next }))
    } catch {
      setFailedSlug(slug)
    } finally {
      setLoadingSlug((current) => (current === slug ? null : current))
    }
  }, [])

  useEffect(() => {
    if (!selectedSlug || details[selectedSlug]) return
    void loadTopic(selectedSlug, false)
  }, [details, loadTopic, selectedSlug])

  useEffect(() => {
    if (snapshot.topics.some((topic) => topic.slug === selectedSlug)) return
    setSelectedSlug(snapshot.topics[0]?.slug ?? '')
  }, [selectedSlug, snapshot.topics])

  return (
    <div className="discovery-topics-layout">
      <nav aria-label={t('desktop.discover.topics')}>
        {snapshot.topics.map((topic) => (
          <button
            aria-current={selectedSlug === topic.slug ? 'page' : undefined}
            className={cn(selectedSlug === topic.slug && 'is-active')}
            key={topic.slug}
            onClick={() => setSelectedSlug(topic.slug)}
            type="button"
          >
            <span>
              <strong>{topic.title}</strong>
              <small>{topic.description}</small>
            </span>
            <b>{topic.skillCount}</b>
          </button>
        ))}
      </nav>
      <section className="discovery-topic-detail">
        <header>
          <div>
            <strong>{detail?.title ?? selectedTopic?.title}</strong>
            <p>{detail?.description ?? selectedTopic?.description}</p>
          </div>
          {selectedTopic ? (
            <div>
              <Button
                aria-label={t('desktop.discover.native.refreshTopic')}
                disabled={loadingSlug === selectedSlug}
                onClick={() => void loadTopic(selectedSlug, true)}
                size="icon-sm"
                variant="ghost"
              >
                <RefreshCw
                  className={cn(loadingSlug === selectedSlug && 'animate-spin')}
                />
              </Button>
              <Button
                onClick={() =>
                  void window.skillShelf.openDiscoveryWebsite(selectedTopic.url)
                }
                size="xs"
                variant="ghost"
              >
                {t('desktop.discover.native.openSource')}
                <ArrowUpRight />
              </Button>
            </div>
          ) : null}
        </header>
        {loadingSlug === selectedSlug && !detail ? (
          <DiscoverySkeleton />
        ) : failedSlug === selectedSlug && !detail ? (
          <DiscoveryFailure
            compact
            onRetry={() => void loadTopic(selectedSlug, true)}
          />
        ) : detail?.skills.length ? (
          <div className="discovery-topic-skills">
            {detail.skills.map((skill) => (
              <DiscoverySkillCard
                installed={isSkillInstalled(catalog, skill)}
                key={skill.url}
                onInstall={onInstall}
                skill={skill}
              />
            ))}
          </div>
        ) : null}
        {detail?.warning ? (
          <div className="discovery-cache-warning" role="status">
            <CircleAlert />
            {t('desktop.discover.native.refreshFailed')}
          </div>
        ) : null}
      </section>
    </div>
  )
}

function OfficialDiscovery({
  catalog,
  onInstall,
  snapshot,
}: {
  catalog: CatalogSnapshot | null
  onInstall: (source: string) => void
  snapshot: DiscoveryOfficialSnapshot
}) {
  const { t } = useI18n()
  const [queryDraft, setQueryDraft] = useState('')
  const [query, setQuery] = useState('')
  const [selectedCreator, setSelectedCreator] = useState<string | null>(null)
  const [selectedRepository, setSelectedRepository] = useState<string | null>(
    null
  )
  const [creatorDetails, setCreatorDetails] = useState<
    Record<string, DiscoveryOfficialCreatorDetail>
  >({})
  const [repositoryDetails, setRepositoryDetails] = useState<
    Record<string, DiscoveryOfficialRepositoryDetail>
  >({})
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const source = snapshot.sources.find(
    (item) => item.creator === selectedCreator
  )
  const creatorDetail = selectedCreator
    ? creatorDetails[selectedCreator]
    : undefined
  const repositoryKey =
    selectedCreator && selectedRepository
      ? `${selectedCreator}/${selectedRepository}`
      : null
  const repositoryDetail = repositoryKey
    ? repositoryDetails[repositoryKey]
    : undefined
  const sources = useMemo(() => {
    const normalized = query.toLocaleLowerCase()
    if (!normalized) return snapshot.sources
    return snapshot.sources.filter(
      (item) =>
        item.creator.toLocaleLowerCase().includes(normalized) ||
        item.repo.toLocaleLowerCase().includes(normalized)
    )
  }, [query, snapshot.sources])

  const loadCreator = useCallback(async (creator: string, force: boolean) => {
    const key = `creator:${creator}`
    setLoadingKey(key)
    setFailedKey(null)
    try {
      const next = await window.skillShelf.getDiscoveryOfficialCreator(
        creator,
        force
      )
      setCreatorDetails((current) => ({ ...current, [creator]: next }))
    } catch {
      setFailedKey(key)
    } finally {
      setLoadingKey((current) => (current === key ? null : current))
    }
  }, [])

  const loadRepository = useCallback(
    async (creator: string, repository: string, force: boolean) => {
      const path = `${creator}/${repository}`
      const key = `repository:${path}`
      setLoadingKey(key)
      setFailedKey(null)
      try {
        const next = await window.skillShelf.getDiscoveryOfficialRepository(
          creator,
          repository,
          force
        )
        setRepositoryDetails((current) => ({ ...current, [path]: next }))
      } catch {
        setFailedKey(key)
      } finally {
        setLoadingKey((current) => (current === key ? null : current))
      }
    },
    []
  )

  useEffect(() => {
    if (!selectedCreator || creatorDetails[selectedCreator]) return
    void loadCreator(selectedCreator, false)
  }, [creatorDetails, loadCreator, selectedCreator])

  useEffect(() => {
    if (
      !selectedCreator ||
      !selectedRepository ||
      repositoryDetails[`${selectedCreator}/${selectedRepository}`]
    ) {
      return
    }
    void loadRepository(selectedCreator, selectedRepository, false)
  }, [loadRepository, repositoryDetails, selectedCreator, selectedRepository])

  useEffect(() => {
    if (
      !selectedCreator ||
      snapshot.sources.some((item) => item.creator === selectedCreator)
    ) {
      return
    }
    setSelectedCreator(null)
    setSelectedRepository(null)
  }, [selectedCreator, snapshot.sources])

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setQuery(queryDraft.trim())
  }

  if (selectedCreator && selectedRepository) {
    const key = `repository:${selectedCreator}/${selectedRepository}`
    return (
      <OfficialRepositoryView
        catalog={catalog}
        detail={repositoryDetail}
        failed={failedKey === key}
        loading={loadingKey === key}
        onBack={() => setSelectedRepository(null)}
        onRoot={() => {
          setSelectedCreator(null)
          setSelectedRepository(null)
        }}
        onInstall={onInstall}
        onRefresh={() =>
          void loadRepository(selectedCreator, selectedRepository, true)
        }
        repository={selectedRepository}
        source={source}
      />
    )
  }

  if (selectedCreator) {
    const key = `creator:${selectedCreator}`
    return (
      <OfficialCreatorView
        detail={creatorDetail}
        failed={failedKey === key}
        loading={loadingKey === key}
        onBack={() => {
          setSelectedCreator(null)
          setSelectedRepository(null)
        }}
        onRefresh={() => void loadCreator(selectedCreator, true)}
        onSelectRepository={(repository) =>
          setSelectedRepository(repository.name)
        }
        source={source}
      />
    )
  }

  return (
    <div className="discovery-native-content">
      <div className="discovery-filter-row is-official">
        <div className="discovery-results-summary">
          <span>
            {t('desktop.discover.native.officialCount', {
              count: sources.length,
            })}
          </span>
        </div>
        <DiscoverySearch
          appliedValue={query}
          onChange={setQueryDraft}
          onClear={() => {
            setQueryDraft('')
            setQuery('')
          }}
          onSubmit={applySearch}
          placeholder={t('desktop.discover.native.filterOfficial')}
          value={queryDraft}
        />
      </div>
      {sources.length ? (
        <div className="discovery-official-list">
          {sources.map((item) => (
            <button
              className="discovery-official-row"
              key={item.url}
              onClick={() => {
                setSelectedCreator(item.creator)
                setSelectedRepository(null)
              }}
              type="button"
            >
              <OfficialAvatar source={item} />
              <span className="discovery-official-copy">
                <strong>{item.creator}</strong>
                <small>{item.repo}</small>
              </span>
              <span className="discovery-official-metrics">
                <span>
                  <b>{item.repoCount}</b>
                  {t('desktop.discover.native.repos')}
                </span>
                <span>
                  <b>{item.skillCount}</b>
                  {t('desktop.discover.native.skills')}
                </span>
              </span>
              <ChevronRight />
            </button>
          ))}
        </div>
      ) : (
        <DiscoveryEmpty label={t('desktop.discover.native.noOfficial')} />
      )}
    </div>
  )
}

function OfficialCreatorView({
  detail,
  failed,
  loading,
  onBack,
  onRefresh,
  onSelectRepository,
  source,
}: {
  detail?: DiscoveryOfficialCreatorDetail
  failed: boolean
  loading: boolean
  onBack: () => void
  onRefresh: () => void
  onSelectRepository: (repository: DiscoveryOfficialRepository) => void
  source?: DiscoveryOfficialSource
}) {
  const { number, t } = useI18n()
  return (
    <div className="discovery-drilldown">
      <DiscoveryBreadcrumb
        onBack={onBack}
        segments={[source?.creator ?? detail?.creator ?? '']}
      />
      <header className="discovery-official-detail-header">
        {source ? <OfficialAvatar large source={source} /> : null}
        <div>
          <h3>{source?.creator ?? detail?.creator}</h3>
          <p>{t('desktop.discover.native.creatorDescription')}</p>
        </div>
        {detail ? (
          <dl>
            <div>
              <dt>{t('desktop.discover.native.repos')}</dt>
              <dd>{number(detail.repoCount)}</dd>
            </div>
            <div>
              <dt>{t('desktop.discover.native.skills')}</dt>
              <dd>{number(detail.skillCount)}</dd>
            </div>
            {detail.installCount !== undefined ? (
              <div>
                <dt>{t('desktop.discover.native.totalInstalls')}</dt>
                <dd>{detail.installLabel ?? number(detail.installCount)}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <Button
          aria-label={t('desktop.discover.native.refreshCreator')}
          disabled={loading}
          onClick={onRefresh}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshCw className={cn(loading && 'animate-spin')} />
        </Button>
      </header>
      {loading && !detail ? (
        <DiscoverySkeleton section="repositories" />
      ) : failed && !detail ? (
        <DiscoveryFailure compact onRetry={onRefresh} />
      ) : detail ? (
        <div className="discovery-repository-list">
          {detail.repositories.map((repository) => (
            <button
              key={repository.url}
              onClick={() => onSelectRepository(repository)}
              type="button"
            >
              <span className="discovery-repository-icon">
                <FolderGit2 />
              </span>
              <span>
                <strong>{repository.name}</strong>
                <small>
                  {repository.skillPreview.length
                    ? repository.skillPreview.join(', ')
                    : t('desktop.discover.native.repositoryFallback')}
                </small>
              </span>
              <span>
                <b>{repository.skillCount}</b>
                {t('desktop.discover.native.skills')}
              </span>
              <span>{repository.installLabel ?? ''}</span>
              <ChevronRight />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function OfficialRepositoryView({
  catalog,
  detail,
  failed,
  loading,
  onBack,
  onInstall,
  onRefresh,
  onRoot,
  repository,
  source,
}: {
  catalog: CatalogSnapshot | null
  detail?: DiscoveryOfficialRepositoryDetail
  failed: boolean
  loading: boolean
  onBack: () => void
  onInstall: (source: string) => void
  onRefresh: () => void
  onRoot: () => void
  repository: string
  source?: DiscoveryOfficialSource
}) {
  const { number, t } = useI18n()
  return (
    <div className="discovery-drilldown">
      <DiscoveryBreadcrumb
        onBack={onBack}
        onRoot={onRoot}
        segments={[source?.creator ?? detail?.creator ?? '', repository]}
      />
      <header className="discovery-repository-detail-header">
        <span className="discovery-repository-icon is-large">
          <FolderGit2 />
        </span>
        <div>
          <h3>
            {source?.creator ?? detail?.creator}/{repository}
          </h3>
          <p>
            {detail
              ? t('desktop.discover.native.repositorySummary', {
                  count: detail.skills.length,
                })
              : t('desktop.discover.native.repositoryLoading')}
          </p>
        </div>
        {detail?.installCount !== undefined ? (
          <Badge variant="secondary">
            {t('desktop.discover.installs', {
              count: detail.installLabel ?? number(detail.installCount),
            })}
          </Badge>
        ) : null}
        <Button
          aria-label={t('desktop.discover.native.refreshRepository')}
          disabled={loading}
          onClick={onRefresh}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshCw className={cn(loading && 'animate-spin')} />
        </Button>
      </header>
      {loading && !detail ? (
        <DiscoverySkeleton />
      ) : failed && !detail ? (
        <DiscoveryFailure compact onRetry={onRefresh} />
      ) : detail ? (
        <div className="discovery-repository-skills">
          {detail.skills.map((skill) => (
            <DiscoverySkillCard
              installed={isSkillInstalled(catalog, skill)}
              key={skill.url}
              onInstall={onInstall}
              skill={skill}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function DiscoveryBreadcrumb({
  onBack,
  onRoot = onBack,
  segments,
}: {
  onBack: () => void
  onRoot?: () => void
  segments: string[]
}) {
  const { t } = useI18n()
  return (
    <nav
      aria-label={t('desktop.discover.native.breadcrumb')}
      className="discovery-breadcrumb"
    >
      <button onClick={onRoot} type="button">
        <ArrowLeft />
        {t('desktop.discover.official')}
      </button>
      {segments.filter(Boolean).map((segment, index, values) => (
        <span key={`${segment}:${index}`}>
          <ChevronRight />
          {index < values.length - 1 ? (
            <button onClick={onBack} type="button">
              {segment}
            </button>
          ) : (
            <b>{segment}</b>
          )}
        </span>
      ))}
    </nav>
  )
}

function OfficialAvatar({
  large = false,
  source,
}: {
  large?: boolean
  source: DiscoveryOfficialSource
}) {
  return (
    <span
      aria-hidden="true"
      className={cn('discovery-official-avatar', large && 'is-large')}
    >
      <span>{source.creator.slice(0, 2).toUpperCase()}</span>
      {source.imageUrl ? (
        <img
          alt=""
          loading="lazy"
          onError={(event) => {
            event.currentTarget.hidden = true
          }}
          src={source.imageUrl}
        />
      ) : null}
    </span>
  )
}

function DiscoverySkillCard({
  installed,
  onInstall,
  skill,
}: {
  installed: boolean
  onInstall: (source: string) => void
  skill: DiscoverySkill
}) {
  const { number, t } = useI18n()
  return (
    <article
      className={cn(
        'discovery-skill-card',
        skill.rank === undefined && 'is-unranked'
      )}
    >
      {skill.rank !== undefined ? (
        <span className="discovery-skill-rank">
          {String(skill.rank).padStart(2, '0')}
        </span>
      ) : null}
      <div className="discovery-skill-copy">
        <strong title={skill.name}>{skill.name}</strong>
        <small title={skill.displayRepo}>{skill.displayRepo}</small>
        {skill.description ? <p>{skill.description}</p> : null}
      </div>
      <span className="discovery-skill-installs">
        {skill.installCount !== undefined
          ? t('desktop.discover.installs', {
              count: skill.installLabel ?? number(skill.installCount),
            })
          : null}
      </span>
      <div className="discovery-skill-actions">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={t('desktop.discover.native.openSource')}
              onClick={() =>
                void window.skillShelf.openDiscoveryWebsite(skill.url)
              }
              size="icon-sm"
              variant="ghost"
            >
              <ArrowUpRight />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t('desktop.discover.native.openSource')}
          </TooltipContent>
        </Tooltip>
        <Button
          disabled={installed}
          onClick={() => onInstall(skill.url)}
          size="xs"
          variant={installed ? 'secondary' : 'default'}
        >
          {installed ? <Check /> : <PackagePlus />}
          {installed
            ? t('desktop.install.installed')
            : t('desktop.install.skill')}
        </Button>
      </div>
    </article>
  )
}

function DiscoverySearch({
  appliedValue,
  onChange,
  onClear,
  onSubmit,
  placeholder,
  value,
}: {
  appliedValue: string
  onChange: (value: string) => void
  onClear: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  placeholder: string
  value: string
}) {
  const { t } = useI18n()
  return (
    <form className="discovery-native-search" onSubmit={onSubmit}>
      <SearchField
        appliedValue={appliedValue}
        clearLabel={t('desktop.discover.clearSearch')}
        label={placeholder}
        onChange={onChange}
        onClear={onClear}
        placeholder={placeholder}
        value={value}
      />
      <Button size="sm" type="submit">
        <Search />
        {t('common.search')}
      </Button>
    </form>
  )
}

function DiscoveryFailure({
  compact = false,
  onRetry,
}: {
  compact?: boolean
  onRetry: () => void
}) {
  const { t } = useI18n()
  return (
    <div
      className={cn('discovery-native-failure', compact && 'is-compact')}
      role="alert"
    >
      <CircleAlert />
      <div>
        <strong>{t('desktop.discover.native.failed')}</strong>
        <span>{t('desktop.discover.native.failedDescription')}</span>
      </div>
      <Button onClick={onRetry} size="sm" variant="outline">
        <RefreshCw />
        {t('common.tryAgain')}
      </Button>
    </div>
  )
}

function DiscoveryEmpty({ label }: { label: string }) {
  return (
    <div className="discovery-native-empty">
      <Search />
      <span>{label}</span>
    </div>
  )
}

function isSkillInstalled(
  catalog: CatalogSnapshot | null,
  skill: DiscoverySkill
) {
  const skillSlug = new URL(skill.url).pathname
    .split('/')
    .filter(Boolean)
    .at(-1)
  return (catalog?.skills ?? []).some(
    (installed) =>
      [skill.name, skillSlug]
        .filter(Boolean)
        .some(
          (name) =>
            installed.name.toLocaleLowerCase() === name?.toLocaleLowerCase()
        ) &&
      Boolean(
        installed.source
          ?.toLocaleLowerCase()
          .includes(skill.repo.toLocaleLowerCase())
      )
  )
}
