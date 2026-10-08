import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

import { SKILLS_CLI_VERSION } from './skills-cli-service'

import type { AgentInstallOption } from '../../shared/desktop-contract'

export const AGENT_REGISTRY_SOURCE = {
  package: 'skills',
  version: SKILLS_CLI_VERSION,
} as const

export interface AgentRegistryEntry {
  detectionPaths: string[]
  id: string
  name: string
  skillDirectories: string[]
}

const PROJECT_ONLY_INSTALL_AGENTS: AgentInstallOption[] = [
  {
    id: 'eve',
    name: 'Eve',
    projectSkillDirectory: 'agent/skills',
    scopes: ['project'],
  },
  {
    id: 'promptscript',
    name: 'PromptScript',
    projectSkillDirectory: '.agents/skills',
    scopes: ['project'],
  },
]

const SHARED_INSTALL_AGENTS: AgentInstallOption[] = [
  {
    id: 'universal',
    name: 'Universal',
    projectSkillDirectory: '.agents/skills',
    scopes: ['global', 'project'],
  },
]

// Project-relative destinations are pinned to the same bundled CLI registry
// as the Agent names and scopes exposed by this module.
const PROJECT_SKILL_DIRECTORIES: Record<string, string> = {
  'aider-desk': '.aider-desk/skills',
  amp: '.agents/skills',
  antigravity: '.agents/skills',
  'antigravity-cli': '.agents/skills',
  astrbot: 'data/skills',
  'autohand-code': '.autohand/skills',
  augment: '.augment/skills',
  bob: '.bob/skills',
  'claude-code': '.claude/skills',
  openclaw: 'skills',
  cline: '.agents/skills',
  'codearts-agent': '.codeartsdoer/skills',
  codebuddy: '.codebuddy/skills',
  codemaker: '.codemaker/skills',
  codestudio: '.codestudio/skills',
  codex: '.agents/skills',
  'command-code': '.commandcode/skills',
  continue: '.continue/skills',
  cortex: '.cortex/skills',
  crush: '.crush/skills',
  cursor: '.agents/skills',
  deepagents: '.agents/skills',
  devin: '.devin/skills',
  dexto: '.agents/skills',
  droid: '.factory/skills',
  firebender: '.agents/skills',
  forgecode: '.forge/skills',
  'gemini-cli': '.agents/skills',
  'github-copilot': '.agents/skills',
  goose: '.goose/skills',
  grok: '.grok/skills',
  'hermes-agent': '.hermes/skills',
  'inference-sh': '.inferencesh/skills',
  jazz: '.jazz/skills',
  junie: '.junie/skills',
  'iflow-cli': '.iflow/skills',
  kilo: '.kilocode/skills',
  kimchi: '.kimchi/skills',
  'kimi-code-cli': '.agents/skills',
  'kiro-cli': '.kiro/skills',
  kode: '.kode/skills',
  lingma: '.lingma/skills',
  loaf: '.agents/skills',
  mcpjam: '.mcpjam/skills',
  'minimax-code': '.minimax/skills',
  'mistral-vibe': '.vibe/skills',
  moxby: '.moxby/skills',
  mux: '.mux/skills',
  opencode: '.agents/skills',
  openhands: '.openhands/skills',
  ona: '.ona/skills',
  pi: '.pi/skills',
  'posit-assistant': '.posit/assistant/skills',
  qoder: '.qoder/skills',
  'qoder-cn': '.qoder/skills',
  'qwen-code': '.qwen/skills',
  replit: '.agents/skills',
  reasonix: '.reasonix/skills',
  rovodev: '.rovodev/skills',
  roo: '.roo/skills',
  'tabnine-cli': '.tabnine/agent/skills',
  terramind: '.terramind/skills',
  tinycloud: '.tinycloud/skills',
  trae: '.trae/skills',
  'trae-cn': '.trae/skills',
  warp: '.agents/skills',
  windsurf: '.windsurf/skills',
  zed: '.agents/skills',
  zcode: '.zcode/skills',
  zencoder: '.zencoder/skills',
  zenflow: '.zencoder/skills',
  neovate: '.neovate/skills',
  pochi: '.pochi/skills',
  adal: '.adal/skills',
}

// Mirrors the CLI's locked "Universal (.agents/skills)" section. These
// Agents share the canonical project directory and are always selected there.
const UNIVERSAL_INSTALL_AGENT_IDS = [
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
] as const

const HIDDEN_UNIVERSAL_INSTALL_AGENT_IDS = ['replit', 'universal'] as const

interface RegistryEnvironment {
  configDir?: string
  environment?: NodeJS.ProcessEnv
  homeDir?: string
}

/**
 * Snapshot of Agent-owned Skill scan paths for the bundled official CLI.
 * Agents that install into the universal ~/.agents/skills source are scanned
 * through their dedicated directories so source inventory is not reported as
 * an Agent-local installation.
 */
export function getAgentRegistry({
  configDir,
  environment = process.env,
  homeDir = homedir(),
}: RegistryEnvironment = {}): AgentRegistryEntry[] {
  const configHome = resolve(
    configDir ?? environment.XDG_CONFIG_HOME?.trim() ?? join(homeDir, '.config')
  )
  const fromHome = (...parts: string[]) => join(homeDir, ...parts)
  const fromConfig = (...parts: string[]) => join(configHome, ...parts)
  const environmentRoot = (name: string, fallback: string) => {
    const value = environment[name]?.trim()
    if (!value) return fromHome(fallback)
    return isAbsolute(value) ? resolve(value) : resolve(homeDir, value)
  }
  const entry = (
    id: string,
    name: string,
    skillDirectory: string,
    detectionPaths: string[] = []
  ): AgentRegistryEntry => ({
    detectionPaths,
    id,
    name,
    skillDirectories: [skillDirectory],
  })

  const claudeHome = environmentRoot('CLAUDE_CONFIG_DIR', '.claude')
  const codexHome = environmentRoot('CODEX_HOME', '.codex')
  const autohandHome = environmentRoot('AUTOHAND_HOME', '.autohand')
  const grokHome = environmentRoot('GROK_HOME', '.grok')
  const hermesHome = environmentRoot('HERMES_HOME', '.hermes')
  const vibeHome = environmentRoot('VIBE_HOME', '.vibe')

  return [
    entry('aider-desk', 'AiderDesk', fromHome('.aider-desk', 'skills'), [
      fromHome('.aider-desk'),
    ]),
    entry('amp', 'Amp', fromConfig('agents', 'skills'), [fromConfig('amp')]),
    entry(
      'antigravity',
      'Antigravity',
      fromHome('.gemini', 'antigravity', 'skills'),
      [fromHome('.gemini', 'antigravity')]
    ),
    entry(
      'antigravity-cli',
      'Antigravity CLI',
      fromHome('.gemini', 'antigravity-cli', 'skills'),
      [fromHome('.gemini', 'antigravity-cli')]
    ),
    entry('astrbot', 'AstrBot', fromHome('.astrbot', 'data', 'skills'), [
      fromHome('.astrbot'),
    ]),
    entry('autohand-code', 'Autohand Code CLI', join(autohandHome, 'skills'), [
      autohandHome,
    ]),
    entry('augment', 'Augment', fromHome('.augment', 'skills'), [
      fromHome('.augment'),
    ]),
    entry('bob', 'IBM Bob', fromHome('.bob', 'skills'), [fromHome('.bob')]),
    entry('claude-code', 'Claude Code', join(claudeHome, 'skills'), [
      claudeHome,
    ]),
    {
      detectionPaths: [
        fromHome('.openclaw'),
        fromHome('.clawdbot'),
        fromHome('.moltbot'),
      ],
      id: 'openclaw',
      name: 'OpenClaw',
      skillDirectories: [
        fromHome('.openclaw', 'skills'),
        fromHome('.clawdbot', 'skills'),
        fromHome('.moltbot', 'skills'),
      ],
    },
    entry('cline', 'Cline', fromHome('.cline', 'skills'), [fromHome('.cline')]),
    entry(
      'codearts-agent',
      'CodeArts Agent',
      fromHome('.codeartsdoer', 'skills'),
      [fromHome('.codeartsdoer')]
    ),
    entry('codebuddy', 'CodeBuddy', fromHome('.codebuddy', 'skills'), [
      fromHome('.codebuddy'),
    ]),
    entry('codemaker', 'Codemaker', fromHome('.codemaker', 'skills'), [
      fromHome('.codemaker'),
    ]),
    entry('codestudio', 'Code Studio', fromHome('.codestudio', 'skills'), [
      fromHome('.codestudio'),
    ]),
    entry('codex', 'Codex', join(codexHome, 'skills'), [codexHome]),
    entry('command-code', 'Command Code', fromHome('.commandcode', 'skills'), [
      fromHome('.commandcode'),
    ]),
    entry('continue', 'Continue', fromHome('.continue', 'skills'), [
      fromHome('.continue'),
    ]),
    entry('cortex', 'Cortex Code', fromHome('.snowflake', 'cortex', 'skills'), [
      fromHome('.snowflake', 'cortex'),
    ]),
    entry('crush', 'Crush', fromConfig('crush', 'skills'), [
      fromConfig('crush'),
    ]),
    entry('cursor', 'Cursor', fromHome('.cursor', 'skills'), [
      fromHome('.cursor'),
    ]),
    entry(
      'deepagents',
      'Deep Agents',
      fromHome('.deepagents', 'agent', 'skills'),
      [fromHome('.deepagents')]
    ),
    entry('devin', 'Devin for Terminal', fromConfig('devin', 'skills'), [
      fromConfig('devin'),
    ]),
    entry('dexto', 'Dexto', fromHome('.dexto', 'skills'), [fromHome('.dexto')]),
    entry('droid', 'Droid', fromHome('.factory', 'skills'), [
      fromHome('.factory'),
    ]),
    entry('firebender', 'Firebender', fromHome('.firebender', 'skills'), [
      fromHome('.firebender'),
    ]),
    entry('forgecode', 'ForgeCode', fromHome('.forge', 'skills'), [
      fromHome('.forge'),
    ]),
    entry('gemini-cli', 'Gemini CLI', fromHome('.gemini', 'skills'), [
      fromHome('.gemini'),
    ]),
    entry('github-copilot', 'GitHub Copilot', fromHome('.copilot', 'skills'), [
      fromHome('.copilot'),
    ]),
    entry('goose', 'Goose', fromConfig('goose', 'skills'), [
      fromConfig('goose'),
    ]),
    entry('grok', 'Grok Build', join(grokHome, 'skills'), [grokHome]),
    entry('hermes-agent', 'Hermes Agent', join(hermesHome, 'skills'), [
      hermesHome,
    ]),
    entry('inference-sh', 'inference.sh', fromHome('.inferencesh', 'skills'), [
      fromHome('.inferencesh'),
    ]),
    entry('jazz', 'Jazz', fromHome('.jazz', 'skills'), [fromHome('.jazz')]),
    entry('junie', 'Junie', fromHome('.junie', 'skills'), [fromHome('.junie')]),
    entry('iflow-cli', 'iFlow CLI', fromHome('.iflow', 'skills'), [
      fromHome('.iflow'),
    ]),
    entry('kilo', 'Kilo Code', fromHome('.kilocode', 'skills'), [
      fromHome('.kilocode'),
    ]),
    entry('kimchi', 'Kimchi', fromConfig('kimchi', 'harness', 'skills'), [
      fromConfig('kimchi'),
    ]),
    entry('kimi-code-cli', 'Kimi Code CLI', fromHome('.kimi', 'skills'), [
      fromHome('.kimi-code'),
      fromHome('.kimi'),
    ]),
    entry('kiro-cli', 'Kiro CLI', fromHome('.kiro', 'skills'), [
      fromHome('.kiro'),
    ]),
    entry('kode', 'Kode', fromHome('.kode', 'skills'), [fromHome('.kode')]),
    entry('lingma', 'Lingma', fromHome('.lingma', 'skills'), [
      fromHome('.lingma'),
    ]),
    entry('loaf', 'Loaf', fromHome('.loaf', 'skills'), [fromHome('.loaf')]),
    entry('mcpjam', 'MCPJam', fromHome('.mcpjam', 'skills'), [
      fromHome('.mcpjam'),
    ]),
    entry('minimax-code', 'MiniMax Code', fromHome('.minimax', 'skills'), [
      fromHome('.minimax'),
      '/Applications/MiniMax Code.app',
    ]),
    entry('mistral-vibe', 'Mistral Vibe', join(vibeHome, 'skills'), [vibeHome]),
    entry('moxby', 'Moxby', fromHome('.moxby', 'skills'), [fromHome('.moxby')]),
    entry('mux', 'Mux', fromHome('.mux', 'skills'), [fromHome('.mux')]),
    entry('opencode', 'OpenCode', fromConfig('opencode', 'skills'), [
      fromConfig('opencode'),
    ]),
    entry('openhands', 'OpenHands', fromHome('.openhands', 'skills'), [
      fromHome('.openhands'),
    ]),
    entry('ona', 'Ona', fromHome('.ona', 'skills'), [fromHome('.ona')]),
    entry('pi', 'Pi', fromHome('.pi', 'agent', 'skills'), [
      fromHome('.pi', 'agent'),
    ]),
    entry(
      'posit-assistant',
      'Posit Assistant',
      fromHome('.posit', 'assistant', 'skills'),
      [fromHome('.posit', 'assistant'), fromHome('.positai')]
    ),
    entry('qoder', 'Qoder', fromHome('.qoder', 'skills'), [fromHome('.qoder')]),
    entry('qoder-cn', 'Qoder CN', fromHome('.qoder-cn', 'skills'), [
      fromHome('.qoder-cn'),
    ]),
    entry('qwen-code', 'Qwen Code', fromHome('.qwen', 'skills'), [
      fromHome('.qwen'),
    ]),
    entry('replit', 'Replit', fromConfig('agents', 'skills')),
    entry('reasonix', 'Reasonix', fromHome('.reasonix', 'skills'), [
      fromHome('.reasonix'),
    ]),
    entry('rovodev', 'Rovo Dev', fromHome('.rovodev', 'skills'), [
      fromHome('.rovodev'),
    ]),
    entry('roo', 'Roo Code', fromHome('.roo', 'skills'), [fromHome('.roo')]),
    entry(
      'tabnine-cli',
      'Tabnine CLI',
      fromHome('.tabnine', 'agent', 'skills'),
      [fromHome('.tabnine')]
    ),
    entry('terramind', 'Terramind', fromHome('.terramind', 'skills'), [
      fromHome('.terramind'),
    ]),
    entry('tinycloud', 'Tinycloud', fromHome('.tinycloud', 'skills'), [
      fromHome('.tinycloud'),
    ]),
    entry('trae', 'Trae', fromHome('.trae', 'skills'), [fromHome('.trae')]),
    entry('trae-cn', 'Trae CN', fromHome('.trae-cn', 'skills'), [
      fromHome('.trae-cn'),
    ]),
    entry('warp', 'Warp', fromHome('.warp', 'skills'), [fromHome('.warp')]),
    entry('windsurf', 'Windsurf', fromHome('.codeium', 'windsurf', 'skills'), [
      fromHome('.codeium', 'windsurf'),
    ]),
    entry('zed', 'Zed', fromHome('.zed', 'skills'), [
      fromConfig('zed'),
      ...(environment.APPDATA?.trim()
        ? [join(environment.APPDATA.trim(), 'Zed')]
        : []),
      ...(environment.FLATPAK_XDG_CONFIG_HOME?.trim()
        ? [join(environment.FLATPAK_XDG_CONFIG_HOME.trim(), 'zed')]
        : []),
    ]),
    entry('zcode', 'ZCode', fromHome('.zcode', 'skills'), [
      fromHome('.zcode'),
      '/Applications/ZCode.app',
    ]),
    entry('zencoder', 'Zencoder', fromHome('.zencoder', 'skills'), [
      fromHome('.zencoder'),
    ]),
    entry('zenflow', 'Zenflow', fromHome('.zencoder', 'skills'), [
      fromHome('.zencoder'),
    ]),
    entry('neovate', 'Neovate', fromHome('.neovate', 'skills'), [
      fromHome('.neovate'),
    ]),
    entry('pochi', 'Pochi', fromHome('.pochi', 'skills'), [fromHome('.pochi')]),
    entry('adal', 'AdaL', fromHome('.adal', 'skills'), [fromHome('.adal')]),
  ]
}

export function getAgentInstallRegistry(): AgentInstallOption[] {
  return [
    ...getAgentRegistry().map(({ id, name }) => ({
      id,
      name,
      projectSkillDirectory: PROJECT_SKILL_DIRECTORIES[id]!,
      scopes: ['global', 'project'] as Array<'global' | 'project'>,
    })),
    ...PROJECT_ONLY_INSTALL_AGENTS,
    ...SHARED_INSTALL_AGENTS,
  ].sort((left, right) => left.name.localeCompare(right.name))
}

export function getProjectAgentInstallTargets(agentIds: string[]) {
  const agents = new Map(
    getAgentInstallRegistry().map((agent) => [agent.id, agent])
  )
  const destinations = new Map<
    string,
    { agentId: string; agentName: string; directoryPath: string }
  >()

  for (const agentId of Array.from(new Set(['universal', ...agentIds]))) {
    const agent = agents.get(agentId)
    if (!agent || !agent.scopes.includes('project')) {
      throw new Error('One or more Agent deployment targets are unavailable')
    }
    if (!destinations.has(agent.projectSkillDirectory)) {
      destinations.set(agent.projectSkillDirectory, {
        agentId,
        agentName: agent.name,
        directoryPath: agent.projectSkillDirectory,
      })
    }
  }

  return [...destinations.values()]
}

export function getUniversalInstallTarget() {
  const installAgentIds = new Set(
    getAgentInstallRegistry().map((agent) => agent.id)
  )
  return {
    agentIds: UNIVERSAL_INSTALL_AGENT_IDS.filter((id) =>
      installAgentIds.has(id)
    ),
    directory: '.agents/skills',
    hiddenAgentIds: HIDDEN_UNIVERSAL_INSTALL_AGENT_IDS.filter((id) =>
      installAgentIds.has(id)
    ),
  }
}
