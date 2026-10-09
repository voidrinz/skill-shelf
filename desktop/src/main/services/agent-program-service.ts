import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, delimiter, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import type {
  AgentProgramDetection,
  WorkbenchSnapshot,
} from '../../shared/desktop-contract'
import type { AgentRegistryEntry } from './agent-registry'

const execute = promisify(execFile)

// Explicit names avoid treating a similarly named shell command as an Agent.
const programs: Record<string, { commands?: string[]; apps?: string[] }> = {
  amp: { commands: ['amp'] },
  antigravity: { commands: ['antigravity'], apps: ['Antigravity'] },
  'antigravity-cli': { commands: ['agy'] },
  'autohand-code': { commands: ['autohand'] },
  'claude-code': { commands: ['claude'] },
  openclaw: { commands: ['openclaw', 'clawdbot', 'moltbot'] },
  codex: { commands: ['codex'], apps: ['Codex'] },
  'command-code': { commands: ['command-code'] },
  crush: { commands: ['crush'] },
  cursor: { commands: ['cursor', 'cursor-agent'], apps: ['Cursor'] },
  deepagents: { commands: ['deepagents'] },
  devin: { commands: ['devin'] },
  dexto: { commands: ['dexto'] },
  droid: { commands: ['droid'] },
  'gemini-cli': { commands: ['gemini'] },
  'github-copilot': { commands: ['copilot'] },
  goose: { commands: ['goose'], apps: ['Goose'] },
  'hermes-agent': { commands: ['hermes'] },
  'kimi-code-cli': { commands: ['kimi'] },
  'kiro-cli': { commands: ['kiro-cli'] },
  'minimax-code': { apps: ['MiniMax Code'] },
  'mistral-vibe': { commands: ['vibe'] },
  mux: { commands: ['mux'], apps: ['Mux'] },
  opencode: { commands: ['opencode'], apps: ['OpenCode'] },
  openhands: { commands: ['openhands'] },
  pi: { commands: ['pi'] },
  'qwen-code': { commands: ['qwen'] },
  trae: { commands: ['trae'], apps: ['Trae'] },
  'trae-cn': { apps: ['Trae CN'] },
  warp: { apps: ['Warp'] },
  windsurf: { commands: ['windsurf'], apps: ['Windsurf'] },
  zed: { commands: ['zed'], apps: ['Zed'] },
  zcode: { apps: ['ZCode'] },
}

export interface AgentProgramScan {
  agents: Map<string, AgentProgramDetection>
  search: WorkbenchSnapshot['programSearch']
}

export interface AgentProgramProvider {
  scan(registry: AgentRegistryEntry[]): Promise<AgentProgramScan>
}

interface ProgramEnvironment {
  applicationDirectories?: string[]
  environment?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  // Tests inject a PATH so they never run the user's shell or inspect apps.
  resolveSearch?: () => Promise<WorkbenchSnapshot['programSearch']>
}

export class AgentProgramService implements AgentProgramProvider {
  constructor(private readonly options: ProgramEnvironment = {}) {}

  async scan(registry: AgentRegistryEntry[]): Promise<AgentProgramScan> {
    const platform = this.options.platform ?? process.platform
    const environment = this.options.environment ?? process.env
    const search = await (this.options.resolveSearch
      ? this.options.resolveSearch()
      : resolveProgramSearch(environment, platform))
    const appDirectories =
      this.options.applicationDirectories ??
      (platform === 'darwin'
        ? ['/Applications', join(homedir(), 'Applications')]
        : [])
    const appPaths = (
      await Promise.all(
        appDirectories.map(async (directory) => {
          try {
            return (await readdir(directory))
              .filter((name) => name.endsWith('.app'))
              .map((name) => join(directory, name))
          } catch {
            return []
          }
        })
      )
    ).flat()
    const extensions =
      platform === 'win32'
        ? [
            '',
            ...(environment.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
              .split(';')
              .flatMap((extension) => [
                extension.toLowerCase(),
                extension.toUpperCase(),
              ]),
          ]
        : ['']
    const agents = await Promise.all(
      registry.map(async (agent) => {
        const probe = programs[agent.id]
        const commands = probe?.commands ?? []
        const applications = platform === 'darwin' ? (probe?.apps ?? []) : []
        const evidence: AgentProgramDetection['evidence'] = []
        await Promise.all(
          commands.map(async (command) => {
            for (const directory of search.paths) {
              for (const extension of extensions) {
                const path = join(directory, command + extension)
                try {
                  if (!(await stat(path)).isFile()) continue
                  await access(
                    path,
                    platform === 'win32' ? constants.F_OK : constants.X_OK
                  )
                  evidence.push({ kind: 'command', path })
                  return
                } catch {
                  /* Continue searching after a stale symlink or inaccessible file. */
                }
              }
            }
          })
        )
        await Promise.all(
          appPaths
            .filter((path) => applications.includes(basename(path, '.app')))
            .map(async (path) => {
              try {
                await access(join(path, 'Contents', 'Info.plist'))
                const executables = await readdir(
                  join(path, 'Contents', 'MacOS')
                )
                // A stale .app directory alone is not installation evidence.
                let found = false
                for (const executable of executables) {
                  const binary = join(path, 'Contents', 'MacOS', executable)
                  if (!(await stat(binary)).isFile()) continue
                  await access(binary, constants.X_OK)
                  found = true
                  break
                }
                if (!found) return
                evidence.push({ kind: 'application', path })
              } catch {
                /* An incomplete bundle is not a detected program. */
              }
            })
        )
        evidence.sort((left, right) => left.path.localeCompare(right.path))
        return [
          agent.id,
          {
            status: evidence.length
              ? 'found'
              : commands.length || applications.length
                ? 'not-found'
                : 'unverified',
            evidence,
            commands,
            applications,
          } satisfies AgentProgramDetection,
        ] as const
      })
    )
    return { agents: new Map(agents), search }
  }
}

export async function resolveProgramSearch(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Promise<WorkbenchSnapshot['programSearch']> {
  const paths = (value: string) => [
    ...new Set(value.split(delimiter).filter((path) => isAbsolute(path))),
  ]
  const fallback = {
    source: 'process' as const,
    paths: paths(environment.PATH ?? ''),
  }
  const shell = environment.SHELL
  if (
    platform === 'win32' ||
    !shell ||
    !isAbsolute(shell) ||
    !['zsh', 'bash', 'sh'].includes(basename(shell))
  )
    return fallback
  try {
    const { stdout } = await execute(
      shell,
      ['-ilc', 'printf "\\0SKILL_SHELF_PATH\\0%s\\0" "$PATH"'],
      {
        env: environment,
        timeout: 2500,
        maxBuffer: 256 * 1024,
      }
    )
    const value = stdout.split('\0SKILL_SHELF_PATH\0')[1]?.split('\0')[0]
    return value
      ? {
          source: 'login-shell',
          paths: [...new Set([...paths(value), ...fallback.paths])],
        }
      : fallback
  } catch {
    return fallback
  }
}
