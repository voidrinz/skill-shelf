import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Eye, FolderOpen, Terminal, Users } from 'lucide-react'
import { Button, cn } from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'
import type {
  AgentCoverageEntry,
  WorkbenchSkillFile,
  WorkbenchSnapshot,
} from '../../shared/desktop-contract'
import { AgentSkillAccessPanel } from './agent-skill-access-panel'
import { SearchField } from './search-field'

type WorkspaceView = 'shared' | 'local' | 'info'

export function AgentAccessWorkspace({
  snapshot,
  focusedAgents,
  initialAgentId,
  onBack,
  onChanged,
  onOpenDirectory,
}: {
  snapshot: WorkbenchSnapshot
  focusedAgents: string[]
  initialAgentId: string
  onBack: () => void
  onChanged: () => void | Promise<void>
  onOpenDirectory: (id: string) => void
}) {
  const { number, t } = useI18n()
  const [selectedId, setSelectedId] = useState(initialAgentId)
  const [view, setView] = useState<WorkspaceView>('shared')
  const [query, setQuery] = useState('')
  const [applying, setApplying] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const lastAgent = useRef<AgentCoverageEntry | null>(null)
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
  const currentAgent = agents.find((agent) => agent.id === selectedId)
  // Keep an in-flight panel mounted if a background scan removes its Agent.
  const agent =
    currentAgent ?? (applying ? lastAgent.current : (agents[0] ?? null))
  const visibleAgents = agents.filter((item) =>
    `${item.name} ${item.path}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase())
  )

  useEffect(() => {
    heading.current?.focus()
  }, [])
  useEffect(() => {
    if (currentAgent) lastAgent.current = currentAgent
  }, [currentAgent])
  useEffect(() => {
    if (!applying && agent?.id !== selectedId) {
      setSelectedId(agent?.id ?? '')
      setView('shared')
    }
  }, [agent?.id, applying, selectedId])

  const selectAgent = (id: string) => {
    if (applying || id === selectedId) return
    setSelectedId(id)
    setView('shared')
  }

  return (
    <section
      className="agent-access-workspace"
      aria-busy={applying}
      aria-label={t('desktop.agentAccess.workspace.title')}
    >
      <header className="agent-access-workspace-header">
        <Button
          disabled={applying}
          onClick={() => {
            if (!applying) onBack()
          }}
          size="sm"
          variant="ghost"
        >
          <ArrowLeft aria-hidden="true" />
          {t('desktop.agentAccess.workspace.back')}
        </Button>
        <div>
          <h2 ref={heading} tabIndex={-1}>
            <Users aria-hidden="true" />
            {t('desktop.agentAccess.workspace.title')}
          </h2>
          <p>{t('desktop.agentAccess.workspace.description')}</p>
        </div>
      </header>
      {applying ? (
        <p className="agent-access-workspace-pending" role="status">
          {t('desktop.agentAccess.workspace.applying')}
        </p>
      ) : null}
      <div className="agent-access-workspace-layout">
        <aside className="agent-access-sidebar">
          <SearchField
            label={t('desktop.workbench.agents.search')}
            onChange={setQuery}
            onClear={() => setQuery('')}
            value={query}
          />
          <nav
            className="agent-access-agent-list"
            aria-label={t('desktop.agentAccess.workspace.agentList')}
          >
            {visibleAgents.map((item) => (
              <button
                aria-label={item.name}
                aria-pressed={agent?.id === item.id}
                className={cn(
                  'agent-access-agent-button',
                  agent?.id === item.id && 'is-selected'
                )}
                disabled={applying}
                key={item.id}
                onClick={() => selectAgent(item.id)}
                type="button"
              >
                <strong>
                  {focused.has(item.name) ? <Eye aria-hidden="true" /> : null}
                  {item.name}
                </strong>
                <span
                  className={`workbench-program-status is-${item.program.status}`}
                >
                  <i />
                  {t(`desktop.workbench.agents.status.${item.program.status}`)}
                </span>
                <small>
                  {number(item.availableSkills)} /{' '}
                  {number(snapshot.stats.sharedSkills)}
                </small>
              </button>
            ))}
            {!visibleAgents.length ? (
              <p className="agent-access-empty">
                {t(
                  agents.length
                    ? 'desktop.workbench.agents.empty'
                    : 'desktop.agentAccess.workspace.noAgents'
                )}
              </p>
            ) : null}
          </nav>
        </aside>
        <div className="agent-access-main">
          {agent ? (
            <>
              <header className="agent-access-main-header">
                <div>
                  <h3>{agent.name}</h3>
                  <span
                    className={`workbench-program-status is-${agent.program.status}`}
                  >
                    <i />
                    {t(
                      `desktop.workbench.agents.status.${agent.program.status}`
                    )}
                  </span>
                  <p>
                    {t(
                      agent.readsSharedDirectory
                        ? 'desktop.workbench.agents.directRead'
                        : 'desktop.workbench.agents.localRead'
                    )}
                  </p>
                </div>
                <Button
                  disabled={!agent.directoryExists || applying}
                  onClick={() => onOpenDirectory(agent.id)}
                  size="sm"
                  variant="outline"
                >
                  <FolderOpen aria-hidden="true" />
                  {t('desktop.workbench.openDirectory')}
                </Button>
              </header>
              <nav
                className="agent-access-workspace-views"
                aria-label={t('desktop.agentAccess.workspace.viewLabel')}
              >
                {(['shared', 'local', 'info'] as const).map((item) => (
                  <button
                    aria-pressed={view === item}
                    disabled={applying}
                    key={item}
                    onClick={() => {
                      if (!applying) setView(item)
                    }}
                    type="button"
                  >
                    {t(`desktop.agentAccess.workspace.${item}`)}
                  </button>
                ))}
              </nav>
              <section
                className="agent-access-workspace-content"
                aria-label={t(`desktop.agentAccess.workspace.${view}`)}
              >
                {view === 'shared' ? (
                  <AgentSkillAccessPanel
                    key={agent.id}
                    agentId={agent.id}
                    scannedAt={snapshot.scannedAt}
                    onChanged={onChanged}
                    onApplyingChange={setApplying}
                  />
                ) : null}
                {view === 'local' ? (
                  <LocalFiles key={agent.id} agent={agent} />
                ) : null}
                {view === 'info' ? (
                  <AgentInfo key={agent.id} agent={agent} snapshot={snapshot} />
                ) : null}
              </section>
            </>
          ) : (
            <p className="agent-access-empty">
              {t('desktop.agentAccess.workspace.selectAgent')}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function LocalFiles({ agent }: { agent: AgentCoverageEntry }) {
  const { t } = useI18n()
  const exclusive = new Set(agent.exclusiveSkillNames)
  const extraExclusive = agent.exclusiveSkillNames.filter(
    (name) => !agent.localSkills.some((skill) => skill.name === name)
  )
  return (
    <>
      <p className="workbench-skill-list-note">
        {t('desktop.workbench.agents.tabDescription.local')}
      </p>
      <p className="agent-access-exclusive-note">
        {t('desktop.workbench.agents.tabDescription.exclusive')}
      </p>
      {agent.localSkills.length || extraExclusive.length ? (
        <ul className="agent-access-readonly-list">
          {agent.localSkills.map((skill) => {
            const actualTarget = (
              skill as WorkbenchSkillFile & { actualTargetPath?: string }
            ).actualTargetPath
            return (
              <li key={skill.path}>
                <div>
                  <strong>{skill.name}</strong>
                  <span>
                    {t(`desktop.workbench.agents.kind.${skill.kind}`)}
                  </span>
                  {exclusive.has(skill.name) ? (
                    <span className="agent-access-exclusive-marker">
                      {t('desktop.workbench.agents.exclusive')}
                    </span>
                  ) : null}
                </div>
                <code>{skill.path}</code>
                {actualTarget ? (
                  <dl>
                    <dt>{t('desktop.agentAccess.actualTarget')}</dt>
                    <dd>
                      <code>{actualTarget}</code>
                    </dd>
                  </dl>
                ) : null}
              </li>
            )
          })}
          {extraExclusive.map((name) => (
            <li key={name}>
              <div>
                <strong>{name}</strong>
                <span className="agent-access-exclusive-marker">
                  {t('desktop.workbench.agents.exclusive')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="agent-access-empty">
          {t('desktop.workbench.agents.tabEmpty.local')}
        </p>
      )}
    </>
  )
}

function AgentInfo({
  agent,
  snapshot,
}: {
  agent: AgentCoverageEntry
  snapshot: WorkbenchSnapshot
}) {
  const { t } = useI18n()
  const issues = snapshot.symlinkHealth.issues.filter((issue) =>
    issue.agentNames.includes(agent.name)
  )
  return (
    <div className="agent-access-info">
      <section className="agent-access-program-evidence">
        <h4>
          <Terminal aria-hidden="true" />
          {t('desktop.workbench.agents.programEvidence')}
        </h4>
        <p>
          {t(`desktop.workbench.agents.explanation.${agent.program.status}`)}
        </p>
        <dl>
          {agent.program.evidence.map((evidence) => (
            <div key={`${evidence.kind}:${evidence.path}`}>
              <dt>{t(`desktop.workbench.agents.evidence.${evidence.kind}`)}</dt>
              <dd>
                <code>{evidence.path}</code>
              </dd>
            </div>
          ))}
        </dl>
        {agent.program.commands.length ? (
          <p>
            {t('desktop.workbench.agents.checkedCommands', {
              commands: agent.program.commands.join(', '),
            })}
          </p>
        ) : null}
        {agent.program.applications.length ? (
          <p>
            {t('desktop.workbench.agents.checkedApps', {
              apps: agent.program.applications.join(', '),
            })}
          </p>
        ) : null}
      </section>
      <section className="agent-access-info-paths">
        <h4>
          <FolderOpen aria-hidden="true" />
          {t('desktop.workbench.agents.directory')}
        </h4>
        <code>{agent.path}</code>
        {!agent.directoryExists ? (
          <p>{t('desktop.workbench.agents.noDirectory')}</p>
        ) : null}
        {agent.readsSharedDirectory ? (
          <p>
            {t('desktop.workbench.agents.readsShared', {
              path: snapshot.sharedDirectory.path,
            })}
          </p>
        ) : null}
        {agent.configurationPaths.length ? (
          <p>
            {t('desktop.workbench.agents.configPaths', {
              paths: agent.configurationPaths.join(', '),
            })}
          </p>
        ) : null}
      </section>
      <section className="agent-access-info-search">
        <h4>{t('desktop.workbench.programSearch.title')}</h4>
        <p>
          {t(
            `desktop.workbench.programSearch.${snapshot.programSearch.source}`
          )}
        </p>
        {snapshot.programSearch.paths.map((path) => (
          <code key={path}>{path}</code>
        ))}
      </section>
      {issues.length ? (
        <section className="agent-access-info-issues">
          <h4>{t('desktop.workbench.files.title')}</h4>
          <ul className="agent-access-readonly-list">
            {issues.map((issue) => (
              <li key={issue.path}>
                <span>
                  {t(`desktop.workbench.files.status.${issue.status}`)}
                </span>
                <code>{issue.path}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="workbench-agent-footnote">
        {t('desktop.workbench.agents.limit')}
      </p>
    </div>
  )
}
