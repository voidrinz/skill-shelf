import { useMemo, useState } from 'react'
import { ChevronDown, Eye, FolderOpen, Terminal, Users } from 'lucide-react'
import { Button, cn } from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'
import { SearchField } from './search-field'
import type {
  AgentCoverageEntry,
  WorkbenchSnapshot,
} from '../../shared/desktop-contract'

type AgentFilter = 'all' | 'found' | 'not-found' | 'unverified' | 'focused'
type SkillTab = 'missing' | 'exclusive' | 'local'

export function AgentCoverageCard({
  focusedAgents,
  onManageAgents,
  onOpenDirectory,
  snapshot,
}: {
  focusedAgents: string[]
  onManageAgents: () => void
  onOpenDirectory: (id: string) => void
  snapshot: WorkbenchSnapshot
}) {
  const { number, t } = useI18n()
  const [filter, setFilter] = useState<AgentFilter>('all')
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [skillTab, setSkillTab] = useState<SkillTab>('missing')
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
        <span>{t('desktop.workbench.agents.exclusive')}</span>
        <span />
      </div>
      <div className="workbench-agent-list">
        {(showAll ? visibleAgents : visibleAgents.slice(0, 6)).map((agent) => {
          const expanded = expandedId === agent.id
          const missing = agent.missingSkillNames.length
          return (
            <div
              className={cn('workbench-agent', expanded && 'is-expanded')}
              key={agent.id}
            >
              <button
                aria-controls={`agent-detail-${agent.id}`}
                aria-expanded={expanded}
                className="workbench-agent-row"
                onClick={() => {
                  setExpandedId(expanded ? null : agent.id)
                  setSkillTab(
                    missing
                      ? 'missing'
                      : agent.exclusiveSkills
                        ? 'exclusive'
                        : 'local'
                  )
                }}
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
                </span>
                <span
                  className="workbench-agent-exclusive"
                  data-label={t('desktop.workbench.agents.exclusive')}
                >
                  <span className="sr-only">
                    {t('desktop.workbench.agents.exclusive')}{' '}
                  </span>
                  {number(agent.exclusiveSkills)}
                </span>
                <ChevronDown />
              </button>
              {expanded ? (
                <AgentDetail
                  agent={agent}
                  onOpenDirectory={onOpenDirectory}
                  onSkillTabChange={setSkillTab}
                  skillTab={skillTab}
                  snapshot={snapshot}
                />
              ) : null}
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

function AgentDetail({
  agent,
  onOpenDirectory,
  onSkillTabChange,
  skillTab,
  snapshot,
}: {
  agent: AgentCoverageEntry
  onOpenDirectory: (id: string) => void
  onSkillTabChange: (tab: SkillTab) => void
  skillTab: SkillTab
  snapshot: WorkbenchSnapshot
}) {
  const { number, t } = useI18n()
  const tabs: Array<{ key: SkillTab; count: number }> = [
    { key: 'missing', count: agent.missingSkillNames.length },
    { key: 'exclusive', count: agent.exclusiveSkills },
    { key: 'local', count: agent.localSkills.length },
  ]
  const names =
    skillTab === 'missing'
      ? agent.missingSkillNames
      : skillTab === 'exclusive'
        ? agent.exclusiveSkillNames
        : agent.localSkills.map((skill) => skill.name)
  const issues = snapshot.symlinkHealth.issues.filter((issue) =>
    issue.agentNames.includes(agent.name)
  )
  return (
    <div className="workbench-agent-detail" id={`agent-detail-${agent.id}`}>
      <div className="workbench-agent-evidence">
        <div>
          <h3>
            <Terminal />
            {t('desktop.workbench.agents.programEvidence')}
          </h3>
          {agent.program.evidence.length ? (
            agent.program.evidence.map((evidence) => (
              <div
                className="workbench-evidence-path"
                key={`${evidence.kind}:${evidence.path}`}
              >
                <span>
                  {t(`desktop.workbench.agents.evidence.${evidence.kind}`)}
                </span>
                <code>{evidence.path}</code>
              </div>
            ))
          ) : (
            <p>
              {t(
                `desktop.workbench.agents.explanation.${agent.program.status}`
              )}
            </p>
          )}
          {agent.program.commands.length ? (
            <small>
              {t('desktop.workbench.agents.checkedCommands', {
                commands: agent.program.commands.join(', '),
              })}
            </small>
          ) : null}
          {agent.program.applications.length ? (
            <small>
              {t('desktop.workbench.agents.checkedApps', {
                apps: agent.program.applications.join(', '),
              })}
            </small>
          ) : null}
        </div>
        <div>
          <h3>
            <FolderOpen />
            {t('desktop.workbench.agents.directory')}
          </h3>
          <div className="workbench-directory-path">
            <code>{agent.path}</code>
            <Button
              disabled={!agent.directoryExists}
              onClick={() => onOpenDirectory(agent.id)}
              size="xs"
              variant="outline"
            >
              <FolderOpen />
              {t('desktop.workbench.openDirectory')}
            </Button>
          </div>
          <p>
            {agent.directoryExists
              ? t('desktop.workbench.agents.localKinds', {
                  linked: number(agent.linkedSkills),
                  direct: number(agent.directSkills),
                })
              : t('desktop.workbench.agents.noDirectory')}
          </p>
          {agent.readsSharedDirectory ? (
            <small>
              {t('desktop.workbench.agents.readsShared', {
                path: snapshot.sharedDirectory.path,
              })}
            </small>
          ) : null}
          {agent.configurationPaths.length ? (
            <small>
              {t('desktop.workbench.agents.configPaths', {
                paths: agent.configurationPaths.join(', '),
              })}
            </small>
          ) : null}
        </div>
      </div>
      <div
        className="workbench-skill-tabs"
        aria-label={t('desktop.workbench.agents.skillLists')}
      >
        {tabs.map(({ key, count }) => (
          <button
            aria-pressed={skillTab === key}
            key={key}
            onClick={() => onSkillTabChange(key)}
            type="button"
          >
            {t(`desktop.workbench.agents.tab.${key}`)}
            <span>{number(count)}</span>
          </button>
        ))}
      </div>
      <p className="workbench-skill-list-note">
        {t(`desktop.workbench.agents.tabDescription.${skillTab}`)}
      </p>
      {names.length ? (
        <ul className="workbench-skill-names">
          {names.map((name, index) => {
            const local =
              skillTab === 'local'
                ? agent.localSkills[index]
                : agent.localSkills.find((skill) => skill.name === name)
            return (
              <li key={local?.path ?? name}>
                <strong>{name}</strong>
                {local ? (
                  <>
                    <span>
                      {t(`desktop.workbench.agents.kind.${local.kind}`)}
                    </span>
                    <code title={local.path}>{local.path}</code>
                  </>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="workbench-skill-empty">
          {t(`desktop.workbench.agents.tabEmpty.${skillTab}`)}
        </p>
      )}
      {issues.length ? (
        <div className="workbench-agent-file-issues">
          {issues.map((issue) => (
            <p key={issue.path}>
              <span>{t(`desktop.workbench.files.status.${issue.status}`)}</span>
              <code>{issue.path}</code>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
