import type {
  AgentInstallOption,
  AgentInstallRegistrySnapshot,
} from '../../shared/desktop-contract'

type InstallScope = 'global' | 'project'

const UNIVERSAL_AGENT_IDS = [
  'amp',
  'antigravity',
  'antigravity-cli',
  'cline',
  'codex',
  'cursor',
  'deepagents',
  'dexto',
  'firebender',
  'gemini-cli',
  'github-copilot',
  'kimi-code-cli',
  'loaf',
  'opencode',
  'promptscript',
  'warp',
  'zed',
]

const HIDDEN_UNIVERSAL_AGENT_IDS = ['replit', 'universal']

export interface InstallAgentGroups {
  additional: AgentInstallOption[]
  universal: AgentInstallOption[]
}

export function getInstallAgentGroups(
  registry: AgentInstallRegistrySnapshot | null,
  scope: InstallScope
): InstallAgentGroups {
  if (!registry) return { additional: [], universal: [] }

  // Main and renderer can briefly run different builds during Electron HMR.
  const universal = registry.universal ?? {
    agentIds: UNIVERSAL_AGENT_IDS,
    directory: '.agents/skills',
    hiddenAgentIds: HIDDEN_UNIVERSAL_AGENT_IDS,
  }
  const universalAgentIds = new Set([
    ...universal.agentIds,
    ...universal.hiddenAgentIds,
  ])
  const availableAgents = registry.agents.filter((agent) =>
    agent.scopes.includes(scope)
  )

  return {
    additional: availableAgents.filter(
      (agent) => !universalAgentIds.has(agent.id)
    ),
    universal: availableAgents.filter((agent) =>
      universal.agentIds.includes(agent.id)
    ),
  }
}

export function getSelectedAdditionalAgentIds(
  groups: InstallAgentGroups,
  selectedAgentIds: string[]
): string[] {
  const additionalAgentIds = new Set(groups.additional.map((agent) => agent.id))
  return Array.from(
    new Set(selectedAgentIds.filter((id) => additionalAgentIds.has(id)))
  )
}

export function getEffectiveInstallAgentIds(
  groups: InstallAgentGroups,
  selectedAgentIds: string[]
): string[] {
  const additionalAgentIds = getSelectedAdditionalAgentIds(
    groups,
    selectedAgentIds
  )
  return groups.universal.length > 0
    ? ['universal', ...additionalAgentIds]
    : additionalAgentIds
}
