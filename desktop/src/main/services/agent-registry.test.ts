import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import {
  AGENT_REGISTRY_SOURCE,
  getAgentInstallRegistry,
  getAgentRegistry,
  getProjectAgentInstallTargets,
  getUniversalInstallTarget,
} from './agent-registry'

const require = createRequire(import.meta.url)

describe('agent registry snapshot', () => {
  it('stays pinned to the bundled skills CLI version', async () => {
    const packageJson = JSON.parse(
      await readFile(require.resolve('skills/package.json'), 'utf8')
    ) as { version: string }

    expect(AGENT_REGISTRY_SOURCE.version).toBe(packageJson.version)
  })

  it('exposes every install target declared by the bundled CLI', async () => {
    const packageJson = JSON.parse(
      await readFile(require.resolve('skills/package.json'), 'utf8')
    ) as { keywords: string[] }
    const nonAgentKeywords = new Set([
      'agent-skills',
      'ai-agents',
      'cli',
      'skills',
    ])
    const officialAgentIds = packageJson.keywords.filter(
      (keyword) => !nonAgentKeywords.has(keyword)
    )
    const installAgents = getAgentInstallRegistry()

    expect(installAgents.map((agent) => agent.id).sort()).toEqual(
      officialAgentIds.sort()
    )
    expect(
      installAgents.filter((agent) => !agent.scopes.includes('global'))
    ).toEqual([
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
    ])
    expect(
      installAgents.every((agent) => agent.projectSkillDirectory.length > 0)
    ).toBe(true)
  })

  it('keeps Command Code aligned with the official global path', () => {
    const registry = getAgentRegistry({
      configDir: '/test/config',
      environment: {},
      homeDir: '/test/home',
    })
    const commandCode = registry.find((agent) => agent.id === 'command-code')

    expect(commandCode).toMatchObject({
      name: 'Command Code',
      skillDirectories: ['/test/home/.commandcode/skills'],
    })
    expect(new Set(registry.map((agent) => agent.id)).size).toBe(
      registry.length
    )
  })

  it('mirrors the CLI Universal group separately from additional Agents', () => {
    const universal = getUniversalInstallTarget()

    expect(universal.directory).toBe('.agents/skills')
    expect(universal.agentIds).toEqual([
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
    ])
    expect(universal.hiddenAgentIds).toEqual(['replit', 'universal'])
  })

  it('resolves Universal and additional project targets without duplicates', () => {
    expect(
      getProjectAgentInstallTargets(['codex', 'claude-code', 'cursor'])
    ).toEqual([
      {
        agentId: 'universal',
        agentName: 'Universal',
        directoryPath: '.agents/skills',
      },
      {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        directoryPath: '.claude/skills',
      },
    ])
  })

  it('scans universal-source Agents through dedicated directories', () => {
    const registry = getAgentRegistry({
      configDir: '/test/config',
      environment: {},
      homeDir: '/test/home',
    })
    const scanPaths = new Map(
      registry.map((agent) => [agent.id, agent.skillDirectories])
    )

    expect(scanPaths.get('cline')).toEqual(['/test/home/.cline/skills'])
    expect(scanPaths.get('dexto')).toEqual(['/test/home/.dexto/skills'])
    expect(scanPaths.get('kimi-code-cli')).toEqual(['/test/home/.kimi/skills'])
    expect(scanPaths.get('loaf')).toEqual(['/test/home/.loaf/skills'])
    expect(scanPaths.get('warp')).toEqual(['/test/home/.warp/skills'])
    expect(scanPaths.get('zed')).toEqual(['/test/home/.zed/skills'])
  })
})
