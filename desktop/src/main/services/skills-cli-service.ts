import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type {
  AddSkillInput,
  MarketplaceSkill,
  OperationResult,
} from '../../shared/desktop-contract'
import {
  buildAddSkillArguments,
  formatSkillsCliCommand,
  SKILLS_CLI_VERSION,
} from '../../shared/skills-cli-command'

export { SKILLS_CLI_VERSION }
const COMMAND_TIMEOUT_MS = 120_000
const require = createRequire(import.meta.url)

export interface CliInstalledSkill {
  agents: string[]
  name: string
  path: string
  scope: 'global' | 'project'
  source?: string
  sourceType?: string
  sourceUrl?: string
}

interface CliExecutionResult {
  code: number | null
  stderr: string
  stdout: string
  timedOut: boolean
}

export class SkillsCliService {
  async listGlobal(): Promise<CliInstalledSkill[]> {
    const result = await this.run(['list', '--global', '--json'], homedir())
    if (result.code !== 0) {
      throw new Error(
        normalizeCliError(result, 'Could not read installed skills')
      )
    }

    return parseInstalledSkills(result.stdout)
  }

  async listProject(projectPath: string): Promise<CliInstalledSkill[]> {
    const result = await this.run(['list', '--json'], projectPath)
    if (result.code !== 0) {
      throw new Error(
        normalizeCliError(result, 'Could not read project skills')
      )
    }
    return parseInstalledSkills(result.stdout).filter(
      (skill) => skill.scope === 'project'
    )
  }

  async add(
    input: AddSkillInput,
    projectPath?: string
  ): Promise<OperationResult> {
    const args = buildAddSkillArguments({
      agents: input.agents,
      source: input.source,
      targetScope: input.target.scope,
    })

    return this.toOperationResult(
      await this.run(args, projectPath ?? homedir()),
      formatSkillsCliCommand(args),
      'Skill installed',
      'Installation failed'
    )
  }

  async remove(
    skillName: string,
    scope: 'global' | 'project',
    projectPath?: string
  ): Promise<OperationResult> {
    const name = normalizeSkillName(skillName)
    const args = ['remove', name]
    if (scope === 'global') args.push('--global')
    args.push('--yes')
    return this.toOperationResult(
      await this.run(args, projectPath ?? homedir()),
      formatSkillsCliCommand(args),
      `${name} removed`,
      `Could not remove ${name}`
    )
  }

  async update(
    skillName: string,
    scope: 'global' | 'project',
    projectPath?: string
  ): Promise<OperationResult> {
    const name = normalizeSkillName(skillName)
    const args = ['update', name]
    if (scope === 'global') args.push('--global')
    args.push('--yes')
    return this.toOperationResult(
      await this.run(args, projectPath ?? homedir()),
      formatSkillsCliCommand(args),
      `${name} updated`,
      `Could not update ${name}`
    )
  }

  async search(query: string): Promise<MarketplaceSkill[]> {
    const normalizedQuery = query.trim().slice(0, 100)
    if (normalizedQuery.length < 2) return []
    const result = await this.run(['find', normalizedQuery], homedir())
    if (result.code !== 0) {
      throw new Error(normalizeCliError(result, 'Could not search skills.sh'))
    }
    return parseMarketplaceSkills(result.stdout)
  }

  private toOperationResult(
    result: CliExecutionResult,
    command: string,
    successMessage: string,
    fallbackError: string
  ): OperationResult {
    if (result.code === 0) {
      return {
        command,
        message: successMessage,
        outputLines: operationOutputLines(result),
        success: true,
      }
    }
    return {
      command,
      message: normalizeCliError(result, fallbackError),
      outputLines: operationOutputLines(result),
      success: false,
    }
  }

  private async run(
    args: string[],
    workingDirectory: string
  ): Promise<CliExecutionResult> {
    const cliPath = resolveCliPath()

    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      const child = spawn(process.execPath, [cliPath, ...args], {
        cwd: workingDirectory,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })

      const finalize = (result: CliExecutionResult) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        resolve(result)
      }

      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        finalize({ code: null, stderr, stdout, timedOut: true })
      }, COMMAND_TIMEOUT_MS)

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.once('error', (error) => {
        finalize({
          code: null,
          stderr: `${stderr}\n${error.message}`.trim(),
          stdout,
          timedOut: false,
        })
      })
      child.once('close', (code) => {
        finalize({ code, stderr, stdout, timedOut: false })
      })
    })
  }
}

export function parseMarketplaceSkills(output: string): MarketplaceSkill[] {
  const lines = stripAnsi(output)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const results: MarketplaceSkill[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(
      /^([a-z0-9_.-]+\/[a-z0-9_.-]+)@([^\s]+)(?:\s+([\d.]+[KMB]?)\s+installs)?$/i
    )
    if (!match) continue
    const [, repo, name, formattedCount] = match
    if (!repo || !name) continue
    const urlMatch = lines[index + 1]?.match(
      /^[└├]\s*(https:\/\/skills\.sh\/\S+)$/
    )
    results.push({
      ...(formattedCount
        ? { installCount: parseFormattedCount(formattedCount) }
        : {}),
      name,
      rank: results.length + 1,
      repo,
      url: urlMatch?.[1] ?? `https://skills.sh/${repo}/${name}`,
    })
  }

  return results
}

export function parseInstalledSkills(output: string): CliInstalledSkill[] {
  const parsed = JSON.parse(stripAnsi(output)) as unknown
  if (!Array.isArray(parsed))
    throw new Error('Skills CLI returned invalid data')

  return parsed.filter((value): value is CliInstalledSkill => {
    if (!value || typeof value !== 'object') return false
    const skill = value as Partial<CliInstalledSkill>
    return (
      typeof skill.name === 'string' &&
      typeof skill.path === 'string' &&
      (skill.scope === 'global' || skill.scope === 'project') &&
      Array.isArray(skill.agents) &&
      skill.agents.every((agent) => typeof agent === 'string')
    )
  })
}

function resolveCliPath(): string {
  const packageJsonPath = require.resolve('skills/package.json')
  return join(dirname(packageJsonPath), 'bin', 'cli.mjs')
}

function normalizeSkillName(value: string): string {
  const name = value.trim()
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(name)) {
    throw new Error('Invalid skill name')
  }
  return name
}

function normalizeCliError(
  result: CliExecutionResult,
  fallback: string
): string {
  if (result.timedOut) return 'The skills command timed out. Try again.'
  const message = stripAnsi(result.stderr || result.stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-2)
    .join(' ')
  return message || fallback
}

function operationOutputLines(result: CliExecutionResult): string[] {
  return stripAnsi(`${result.stdout}\n${result.stderr}`)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-24)
}

function parseFormattedCount(value: string): number {
  const match = value.match(/^([\d.]+)([KMB])?$/i)
  if (!match) return 0
  const multiplier =
    match[2]?.toUpperCase() === 'B'
      ? 1_000_000_000
      : match[2]?.toUpperCase() === 'M'
        ? 1_000_000
        : match[2]?.toUpperCase() === 'K'
          ? 1_000
          : 1
  return Math.round(Number(match[1]) * multiplier)
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}
