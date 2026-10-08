import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  CircleDot,
  Command,
  FolderCheck,
  LoaderCircle,
  PackagePlus,
  Search,
  TerminalSquare,
  X,
} from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
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
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from '@skill-shelf/ui'
import { useI18n } from '@skill-shelf/i18n/react'

import type {
  AgentInstallRegistrySnapshot,
  CatalogSnapshot,
  OperationResult,
  SkillInstallTarget,
} from '../../shared/desktop-contract'
import {
  buildAddSkillArguments,
  formatSkillsCliCommand,
} from '../../shared/skills-cli-command'
import { getLocalizedErrorMessage } from './localized-error'
import DiscoveryCatalogPanel from './discovery-catalog-panel'
import {
  getEffectiveInstallAgentIds,
  getInstallAgentGroups,
  getSelectedAdditionalAgentIds,
} from './install-agent-selection'

type DiscoverTab = 'home' | 'official' | 'topics'

interface InstallRequest {
  sourceStatus: InstallSourceStatus
  source: string
}

type InstallSourceStatus = 'resolving' | 'scraped' | 'terminal-fallback'

export default function DiscoverWorkspace({
  catalog,
  defaultAgents,
  onInstalled,
}: {
  catalog: CatalogSnapshot | null
  defaultAgents: string[]
  onInstalled: () => Promise<void>
}) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<DiscoverTab>('home')
  const [installRequest, setInstallRequest] = useState<InstallRequest | null>(
    null
  )
  const [agentRegistry, setAgentRegistry] =
    useState<AgentInstallRegistrySnapshot | null>(null)
  const [agentRegistryError, setAgentRegistryError] = useState<string | null>(
    null
  )
  const [agentRegistryLoading, setAgentRegistryLoading] = useState(false)
  const installResolutionId = useRef(0)

  function openInstallDialog(source: string) {
    const resolutionId = ++installResolutionId.current
    setInstallRequest({ source: '', sourceStatus: 'resolving' })
    void window.skillShelf
      .getDiscoverySkillInstallCommand(source)
      .then((result) => {
        if (installResolutionId.current !== resolutionId) return
        setInstallRequest({
          source: result.command,
          sourceStatus: 'scraped',
        })
      })
      .catch(() => {
        if (installResolutionId.current !== resolutionId) return
        setInstallRequest({ source: '', sourceStatus: 'terminal-fallback' })
      })

    if (!agentRegistry && !agentRegistryLoading) {
      setAgentRegistryError(null)
      setAgentRegistryLoading(true)
      void window.skillShelf
        .getAgentInstallRegistry()
        .then(setAgentRegistry)
        .catch((caught: unknown) => {
          setAgentRegistryError(getLocalizedErrorMessage(caught, t))
        })
        .finally(() => setAgentRegistryLoading(false))
    }
  }

  return (
    <section className="discover-workspace">
      <PageHeader
        actions={
          <Button
            onClick={() => void window.skillShelf.openWebsite()}
            size="sm"
            variant="outline"
          >
            {t('desktop.discover.browse')}
            <ArrowUpRight />
          </Button>
        }
        className="discover-page-header"
        description={t('desktop.discover.description')}
        eyebrow={t('desktop.discover.eyebrow')}
        title={t('desktop.discover.title')}
      />
      <Tabs
        className="discover-tabs"
        onValueChange={(value) => setActiveTab(value as DiscoverTab)}
        value={activeTab}
      >
        <TabsList aria-label={t('desktop.discover.sections')}>
          <TabsTrigger value="home">{t('desktop.discover.home')}</TabsTrigger>
          <TabsTrigger value="topics">
            {t('desktop.discover.topics')}
          </TabsTrigger>
          <TabsTrigger value="official">
            {t('desktop.discover.official')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="discover-native-layout">
        <DiscoveryCatalogPanel
          catalog={catalog}
          onInstall={openInstallDialog}
          section={activeTab}
        />
      </div>
      {installRequest ? (
        <InstallDialog
          agentRegistry={agentRegistry}
          agentRegistryError={agentRegistryError}
          agentRegistryLoading={agentRegistryLoading}
          catalog={catalog}
          defaultAgents={defaultAgents}
          onInstalled={onInstalled}
          onOpenChange={(open) => {
            if (!open) {
              installResolutionId.current += 1
              setInstallRequest(null)
            }
          }}
          source={installRequest.source}
          sourceStatus={installRequest.sourceStatus}
        />
      ) : null}
    </section>
  )
}

function InstallDialog({
  agentRegistry,
  agentRegistryError,
  agentRegistryLoading,
  catalog,
  defaultAgents,
  onInstalled,
  onOpenChange,
  source,
  sourceStatus,
}: {
  agentRegistry: AgentInstallRegistrySnapshot | null
  agentRegistryError: string | null
  agentRegistryLoading: boolean
  catalog: CatalogSnapshot | null
  defaultAgents: string[]
  onInstalled: () => Promise<void>
  onOpenChange: (open: boolean) => void
  source: string
  sourceStatus: InstallSourceStatus
}) {
  const { t } = useI18n()
  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent
        className="install-dialog max-w-2xl gap-0 overflow-hidden p-0 sm:p-0"
        closeLabel={t('common.close')}
      >
        <DialogHeader className="install-dialog-header">
          <span>
            <TerminalSquare />
          </span>
          <div>
            <DialogTitle>{t('desktop.installDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('desktop.install.runDescription')}
            </DialogDescription>
          </div>
          <b>
            {agentRegistry
              ? `CLI v${agentRegistry.cliVersion}`
              : agentRegistryError
                ? t('desktop.install.registryUnavailable')
                : t('desktop.install.registryLoading')}
          </b>
        </DialogHeader>
        <InstallTimeline
          agentRegistry={agentRegistry}
          agentRegistryError={agentRegistryError}
          agentRegistryLoading={agentRegistryLoading}
          catalog={catalog}
          defaultAgents={defaultAgents}
          initialSource={source}
          onInstalled={onInstalled}
          sourceStatus={sourceStatus}
        />
      </DialogContent>
    </Dialog>
  )
}

function InstallTimeline({
  agentRegistry,
  agentRegistryError,
  agentRegistryLoading,
  catalog,
  defaultAgents,
  initialSource,
  onInstalled,
  sourceStatus,
}: {
  agentRegistry: AgentInstallRegistrySnapshot | null
  agentRegistryError: string | null
  agentRegistryLoading: boolean
  catalog: CatalogSnapshot | null
  defaultAgents: string[]
  initialSource: string
  onInstalled: () => Promise<void>
  sourceStatus: InstallSourceStatus
}) {
  const { t } = useI18n()
  const [agents, setAgents] = useState(defaultAgents)
  const [agentQueryDraft, setAgentQueryDraft] = useState('')
  const [agentQuery, setAgentQuery] = useState('')
  const [source, setSource] = useState(initialSource)
  const [target, setTarget] = useState<SkillInstallTarget>({ scope: 'global' })
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<OperationResult | null>(null)
  useEffect(() => {
    setSource(initialSource)
    setResult(null)
  }, [initialSource])
  const selectedProject =
    target.scope === 'project'
      ? catalog?.projects.find((project) => project.id === target.projectId)
      : null
  const agentGroups = useMemo(
    () => getInstallAgentGroups(agentRegistry, target.scope),
    [agentRegistry, target.scope]
  )
  const availableAgents = agentGroups.additional
  const totalAgentCount =
    agentRegistry?.agents.filter((agent) => agent.scopes.includes(target.scope))
      .length ?? 0
  const normalizedAgentQuery = agentQuery.trim().toLocaleLowerCase()
  const visibleAgents = useMemo(
    () =>
      normalizedAgentQuery
        ? availableAgents.filter(
            (agent) =>
              agent.name.toLocaleLowerCase().includes(normalizedAgentQuery) ||
              agent.id.toLocaleLowerCase().includes(normalizedAgentQuery)
          )
        : availableAgents,
    [availableAgents, normalizedAgentQuery]
  )
  const selectedAdditionalAgents = getSelectedAdditionalAgentIds(
    agentGroups,
    agents
  )
  const effectiveAgents = getEffectiveInstallAgentIds(agentGroups, agents)
  const universalAgentNames = agentGroups.universal.map((agent) => agent.name)
  const visibleUniversalAgentNames = universalAgentNames.slice(0, 6)
  const hiddenUniversalAgentCount = Math.max(
    0,
    universalAgentNames.length - visibleUniversalAgentNames.length
  )
  const command = useMemo(() => {
    if (!source.trim()) return t('desktop.install.commandUnavailable')
    try {
      return formatSkillsCliCommand(
        buildAddSkillArguments({
          agents: effectiveAgents,
          source,
          targetScope: target.scope,
        })
      )
    } catch {
      return t('desktop.install.commandUnavailable')
    }
  }, [effectiveAgents, source, t, target.scope])

  function toggleAgent(agentId: string) {
    setResult(null)
    setAgents((current) => {
      const selected = getSelectedAdditionalAgentIds(agentGroups, current)
      return selected.includes(agentId)
        ? selected.filter((id) => id !== agentId)
        : [...selected, agentId]
    })
  }

  function changeTarget(value: string) {
    const nextTarget: SkillInstallTarget = value.startsWith('project:')
      ? { projectId: value.slice('project:'.length), scope: 'project' }
      : { scope: 'global' }
    const nextAdditionalAgentIds = new Set(
      getInstallAgentGroups(agentRegistry, nextTarget.scope).additional.map(
        (agent) => agent.id
      )
    )
    setTarget(nextTarget)
    setResult(null)
    setAgents((current) =>
      current.filter((agent) => nextAdditionalAgentIds.has(agent))
    )
  }

  function applyAgentSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    event.stopPropagation()
    setAgentQuery(agentQueryDraft.trim())
  }

  function clearAgentSearch() {
    setAgentQueryDraft('')
    setAgentQuery('')
  }

  async function install() {
    if (
      sourceStatus !== 'scraped' ||
      !source.trim() ||
      !agentRegistry ||
      running
    ) {
      return
    }
    setRunning(true)
    setResult(null)
    try {
      const operation = await window.skillShelf.addSkill({
        agents: effectiveAgents,
        source,
        target,
      })
      setResult(operation)
      if (operation.success) await onInstalled()
    } catch (caught) {
      setResult({
        message: getLocalizedErrorMessage(caught, t),
        success: false,
      })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="install-dialog-body">
      <ol className="install-timeline">
        <TimelineStep
          active={!source.trim()}
          done={Boolean(source.trim())}
          error={sourceStatus === 'terminal-fallback'}
          index="01"
          title={t('desktop.install.resolveSource')}
        >
          <Input
            aria-label={t('desktop.install.source')}
            disabled={sourceStatus !== 'scraped'}
            placeholder={t('desktop.install.sourceUnavailable')}
            readOnly
            value={source}
          />
          {sourceStatus === 'resolving' ? (
            <small aria-live="polite" className="timeline-source-status">
              <LoaderCircle className="animate-spin" />
              {t('desktop.install.sourceResolving')}
            </small>
          ) : sourceStatus === 'terminal-fallback' ? (
            <small className="timeline-source-warning" role="alert">
              <CircleAlert />
              {t('desktop.install.sourceManualFallback')}
            </small>
          ) : sourceStatus === 'scraped' ? (
            <small className="timeline-source-status">
              <Check />
              {t('desktop.install.sourceScraped')}
            </small>
          ) : null}
        </TimelineStep>
        <TimelineStep
          done={sourceStatus === 'scraped'}
          index="02"
          title={t('desktop.install.chooseScope')}
        >
          <Select
            onValueChange={changeTarget}
            value={
              target.scope === 'global'
                ? 'global'
                : `project:${target.projectId}`
            }
          >
            <SelectTrigger
              aria-label={t('desktop.install.chooseScope')}
              className="install-select-trigger"
              disabled={sourceStatus !== 'scraped'}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">
                {t('desktop.install.global')}
              </SelectItem>
              {(catalog?.projects ?? []).map((project) => (
                <SelectItem key={project.id} value={`project:${project.id}`}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {target.scope === 'project' ? (
            <small className="timeline-hint">
              {selectedProject?.path ?? t('desktop.projects.missing')}
            </small>
          ) : null}
        </TimelineStep>
        <TimelineStep
          done={sourceStatus === 'scraped' && Boolean(agentRegistry)}
          index="03"
          title={t('desktop.install.chooseAgents')}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t('desktop.install.chooseAgents')}
                className="agent-select-trigger"
                disabled={
                  sourceStatus !== 'scraped' ||
                  !agentRegistry ||
                  agentRegistryLoading
                }
                variant="outline"
              >
                {agentRegistryLoading ? (
                  <LoaderCircle className="animate-spin" />
                ) : null}
                <span>
                  <strong>
                    {t('desktop.install.universal')}
                    {selectedAdditionalAgents.length
                      ? ` +${selectedAdditionalAgents.length}`
                      : ''}
                  </strong>
                  <small>
                    {selectedAdditionalAgents.length
                      ? t('desktop.install.additionalSelected', {
                          count: selectedAdditionalAgents.length,
                        })
                      : t('desktop.install.universalAlwaysIncluded')}
                  </small>
                </span>
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="agent-select-menu">
              <DropdownMenuLabel className="agent-select-label">
                <span>{t('desktop.install.chooseAgents')}</span>
                <small>
                  skills CLI v{agentRegistry?.cliVersion} ·{' '}
                  {t('desktop.install.agentCount', {
                    count: totalAgentCount,
                  })}
                </small>
              </DropdownMenuLabel>
              <div className="agent-universal-target">
                <div>
                  <span>
                    <FolderCheck />
                  </span>
                  <div>
                    <strong>{t('desktop.install.universal')}</strong>
                    <code>
                      {agentRegistry?.universal?.directory ?? '.agents/skills'}
                    </code>
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
                <div className="agent-universal-compatibility">
                  {visibleUniversalAgentNames.map((name) => (
                    <span key={name}>{name}</span>
                  ))}
                  {hiddenUniversalAgentCount ? (
                    <span>+{hiddenUniversalAgentCount}</span>
                  ) : null}
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="agent-additional-label">
                <span>{t('desktop.install.additionalAgents')}</span>
                <small>
                  {t('desktop.install.additionalAgentCount', {
                    count: availableAgents.length,
                  })}
                </small>
              </DropdownMenuLabel>
              <form
                className="agent-select-search"
                onKeyDown={(event) => event.stopPropagation()}
                onSubmit={applyAgentSearch}
              >
                <div>
                  <Search />
                  <Input
                    aria-label={t('desktop.install.searchAgents')}
                    onChange={(event) => setAgentQueryDraft(event.target.value)}
                    placeholder={t('desktop.install.searchAgents')}
                    type="search"
                    value={agentQueryDraft}
                  />
                  {agentQueryDraft ? (
                    <button
                      aria-label={t('desktop.install.clearAgentSearch')}
                      onClick={clearAgentSearch}
                      type="button"
                    >
                      <X />
                    </button>
                  ) : null}
                </div>
                <Button size="icon-sm" title={t('common.search')} type="submit">
                  <Search />
                </Button>
              </form>
              <div className="agent-select-options">
                {visibleAgents.map((agent) => (
                  <DropdownMenuCheckboxItem
                    checked={selectedAdditionalAgents.includes(agent.id)}
                    key={agent.id}
                    onCheckedChange={() => toggleAgent(agent.id)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    <span className="agent-select-option">
                      <strong>{agent.name}</strong>
                      <code>{agent.id}</code>
                    </span>
                    {agent.scopes.length === 1 ? (
                      <small className="agent-scope-note">
                        {t('desktop.install.projectOnly')}
                      </small>
                    ) : null}
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
            <small className="timeline-error">{agentRegistryError}</small>
          ) : null}
        </TimelineStep>
        <TimelineStep
          active={
            Boolean(source.trim()) &&
            Boolean(agentRegistry) &&
            !result &&
            !running
          }
          done={Boolean(result?.success)}
          index="04"
          title={t('desktop.install.execute')}
        >
          <div className="install-command">
            <Command />
            <code>{command}</code>
          </div>
          <Button
            disabled={
              sourceStatus !== 'scraped' ||
              !source.trim() ||
              !agentRegistry ||
              running
            }
            onClick={() => void install()}
            size="sm"
          >
            {running ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <PackagePlus />
            )}
            {running
              ? t('desktop.install.installing')
              : t('desktop.install.skill')}
          </Button>
        </TimelineStep>
        {running || result ? (
          <TimelineStep
            active={running}
            done={Boolean(result?.success)}
            error={result ? !result.success : false}
            index="05"
            title={
              running
                ? t('desktop.install.cliRunning')
                : result?.success
                  ? t('desktop.install.complete')
                  : t('desktop.install.failed')
            }
          >
            {running ? (
              <p className="timeline-running">
                <LoaderCircle className="animate-spin" />
                {t('desktop.install.waitingForCli')}
              </p>
            ) : result ? (
              <div className="install-output">
                <strong>{result.message}</strong>
                {result.outputLines?.map((line, index) => (
                  <code key={`${index}:${line}`}>{line}</code>
                ))}
              </div>
            ) : null}
          </TimelineStep>
        ) : null}
      </ol>
    </div>
  )
}

function TimelineStep({
  active = false,
  children,
  done = false,
  error = false,
  index,
  title,
}: {
  active?: boolean
  children: React.ReactNode
  done?: boolean
  error?: boolean
  index: string
  title: string
}) {
  return (
    <li
      className={cn(
        'timeline-step',
        active && 'is-active',
        done && 'is-done',
        error && 'is-error'
      )}
    >
      <span className="timeline-node">
        {done ? <Check /> : error ? <CircleAlert /> : <CircleDot />}
      </span>
      <header>
        <b>{index}</b>
        <strong>{title}</strong>
      </header>
      <div className="timeline-step-content">{children}</div>
    </li>
  )
}
