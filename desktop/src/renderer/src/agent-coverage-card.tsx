import { useMemo, useState } from 'react'
import { ArrowUpRight, Eye, Users } from 'lucide-react'
import { Button } from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'
import { SearchField } from './search-field'
import type { WorkbenchSnapshot } from '../../shared/desktop-contract'

type AgentFilter = 'all' | 'found' | 'not-found' | 'unverified' | 'focused'

export function AgentCoverageCard({
  focusedAgents,
  onManageAgents,
  onOpenAccess,
  snapshot,
}: {
  focusedAgents: string[]
  onManageAgents: () => void
  onOpenAccess: (id: string) => void
  snapshot: WorkbenchSnapshot
}) {
  const { number, t } = useI18n()
  const [filter, setFilter] = useState<AgentFilter>('all')
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const focused = useMemo(() => new Set(focusedAgents), [focusedAgents])
  const agents = useMemo(
    () =>
      [...snapshot.agentCoverage].sort(
        (left, right) =>
          Number(focused.has(right.name)) - Number(focused.has(left.name)) ||
          Number(right.program.status === 'found') -
            Number(left.program.status === 'found') ||
          left.name.localeCompare(right.name)
      ),
    [snapshot.agentCoverage, focused]
  )
  const visibleAgents = agents.filter(
    (agent) =>
      (filter === 'all' ||
        (filter === 'focused'
          ? focused.has(agent.name)
          : agent.program.status === filter)) &&
      `${agent.name} ${agent.path}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase())
  )
  const absentFocused = focusedAgents.filter(
    (name) => !agents.some((agent) => agent.name === name)
  )
  const filters: AgentFilter[] = [
    'all',
    'found',
    'not-found',
    'unverified',
    'focused',
  ]
  const counts: Record<AgentFilter, number> = {
    all: agents.length,
    found: agents.filter((agent) => agent.program.status === 'found').length,
    'not-found': agents.filter((agent) => agent.program.status === 'not-found')
      .length,
    unverified: agents.filter((agent) => agent.program.status === 'unverified')
      .length,
    focused: agents.filter((agent) => focused.has(agent.name)).length,
  }
  return (
    <section className="workbench-agent-panel">
      <header className="workbench-section-heading">
        <Users />
        <div>
          <h2>{t('desktop.workbench.agents.title')}</h2>
          <p>{t('desktop.workbench.agents.description')}</p>
        </div>
        <Button onClick={onManageAgents} size="sm" variant="ghost">
          <Eye />
          {t('desktop.workbench.coverage.manage')}
        </Button>
      </header>
      <div className="workbench-agent-toolbar">
        <div
          className="workbench-agent-filters"
          aria-label={t('desktop.workbench.agents.filters')}
        >
          {filters.map((item) => (
            <button
              aria-pressed={filter === item}
              key={item}
              onClick={() => {
                setFilter(item)
                setShowAll(false)
              }}
              type="button"
            >
              {t(`desktop.workbench.agents.filter.${item}`)}
              <span>{number(counts[item])}</span>
            </button>
          ))}
        </div>
        <SearchField
          className="workbench-agent-search"
          label={t('desktop.workbench.agents.search')}
          onChange={(value) => {
            setQuery(value)
            setShowAll(false)
          }}
          onClear={() => {
            setQuery('')
            setShowAll(false)
          }}
          value={query}
        />
      </div>
      {absentFocused.length && (filter === 'all' || filter === 'focused') ? (
        <p className="workbench-agent-absent">
          {t('desktop.workbench.agents.absent', {
            names: absentFocused.join(', '),
          })}
        </p>
      ) : null}
      <div className="workbench-agent-columns" aria-hidden="true">
        <span>Agent</span>
        <span>{t('desktop.workbench.agents.program')}</span>
        <span>{t('desktop.workbench.agents.shared')}</span>
        <span />
      </div>
      <div className="workbench-agent-list">
        {(showAll ? visibleAgents : visibleAgents.slice(0, 6)).map((agent) => {
          const missing = agent.missingSkillNames.length
          return (
            <div className="workbench-agent" key={agent.id}>
              <button
                className="workbench-agent-row"
                onClick={() => onOpenAccess(agent.id)}
                type="button"
              >
                <span className="workbench-agent-name">
                  <strong>
                    {focused.has(agent.name) ? <Eye /> : null}
                    {agent.name}
                  </strong>
                  <small>
                    {agent.readsSharedDirectory
                      ? t('desktop.workbench.agents.directRead')
                      : t('desktop.workbench.agents.localRead')}
                  </small>
                </span>
                <span>
                  <span
                    className={`workbench-program-status is-${agent.program.status}`}
                  >
                    <i />
                    {t(
                      `desktop.workbench.agents.status.${agent.program.status}`
                    )}
                  </span>
                </span>
                <span className="workbench-agent-coverage">
                  <strong>
                    {snapshot.stats.sharedSkills
                      ? `${number(agent.availableSkills)} / ${number(snapshot.stats.sharedSkills)}`
                      : '—'}
                  </strong>
                  <small>
                    {snapshot.stats.sharedSkills
                      ? missing
                        ? t('desktop.workbench.agents.missingCount', {
                            count: number(missing),
                          })
                        : t('desktop.workbench.agents.complete')
                      : t('desktop.workbench.coverage.noSharedSkills')}
                  </small>
                  {agent.exclusiveSkills > 0 ? (
                    <small title={t('desktop.workbench.agents.exclusive')}>
                      {t('desktop.workbench.agents.additionalLocal', {
                        count: number(agent.exclusiveSkills),
                      })}
                    </small>
                  ) : null}
                </span>
                <span className="workbench-agent-manage">
                  {t('desktop.agentAccess.workspace.manage')}
                  <ArrowUpRight />
                </span>
              </button>
            </div>
          )
        })}
        {!visibleAgents.length ? (
          <div className="workbench-agent-empty">
            {t('desktop.workbench.agents.empty')}
          </div>
        ) : null}
      </div>
      {visibleAgents.length > 6 ? (
        <button
          className="workbench-agents-more"
          onClick={() => setShowAll((value) => !value)}
          type="button"
        >
          {showAll
            ? t('desktop.workbench.agents.showLess')
            : t('desktop.workbench.agents.showMore', {
                count: number(visibleAgents.length - 6),
              })}
        </button>
      ) : null}
      <footer className="workbench-agent-footnote">
        {t('desktop.workbench.agents.limit')}
        <details className="workbench-search-scope">
          <summary>{t('desktop.workbench.programSearch.title')}</summary>
          <p>
            {t(
              `desktop.workbench.programSearch.${snapshot.programSearch.source}`
            )}
          </p>
          <code>{snapshot.programSearch.paths.join('\n')}</code>
        </details>
      </footer>
    </section>
  )
}
