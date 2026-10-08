import { access, readdir, readlink, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import type {
  AgentCoverageEntry,
  CatalogSnapshot,
  SymlinkHealthSnapshot,
  SymlinkIssue,
  WorkbenchScanResult,
  WorkbenchSnapshot,
} from '../../shared/desktop-contract'
import {
  AGENT_REGISTRY_SOURCE,
  getAgentRegistry,
  type AgentRegistryEntry,
} from './agent-registry'

interface CatalogProvider {
  scanExternalSkills(): Promise<CatalogSnapshot>
}

interface DirectoryScan {
  broken: number
  direct: number
  directSkillNames: Set<string>
  inaccessible: number
  issues: Omit<SymlinkIssue, 'agentNames'>[]
  linkedSkillNames: Set<string>
  valid: number
}

interface ActiveAgent {
  directory: string
  directoryKey: string
  registry: AgentRegistryEntry
}

export class WorkbenchService {
  private pendingScan: Promise<WorkbenchScanResult> | null = null

  constructor(
    private readonly catalog: CatalogProvider,
    private readonly registry = getAgentRegistry()
  ) {}

  getSnapshot(): Promise<WorkbenchScanResult> {
    if (!this.pendingScan)
      this.pendingScan = this.scan().finally(() => {
        this.pendingScan = null
      })
    return this.pendingScan
  }

  private async scan(): Promise<WorkbenchScanResult> {
    const catalog = await this.catalog.scanExternalSkills()
    const installedSkills = [...catalog.skills, ...catalog.externalSkills]
    const globalSkills = installedSkills.filter(
      (skill) => skill.scope === 'global'
    )
    const globalSkillNames = new Set(globalSkills.map((skill) => skill.name))
    const sourceDirectoryKeys = new Set(
      await Promise.all(
        globalSkills.map((skill) => canonicalPath(dirname(skill.path)))
      )
    )
    const activeAgents = (
      await Promise.all(
        this.registry.map(async (registry): Promise<ActiveAgent | null> => {
          const directory = await selectExistingSkillDirectory(
            registry.skillDirectories
          )
          if (!directory) return null
          const directoryKey = await canonicalPath(directory)

          // Universal-source Agents read ~/.agents/skills directly. That source
          // is inventory, not an Agent-owned installation directory.
          if (sourceDirectoryKeys.has(directoryKey)) return null
          return {
            directory,
            directoryKey,
            registry,
          }
        })
      )
    ).filter((agent): agent is ActiveAgent => agent !== null)

    const agentsByDirectory = new Map<
      string,
      { agentNames: string[]; directory: string }
    >()
    for (const agent of activeAgents) {
      const group = agentsByDirectory.get(agent.directoryKey) ?? {
        agentNames: [],
        directory: agent.directory,
      }
      group.agentNames.push(agent.registry.name)
      agentsByDirectory.set(agent.directoryKey, group)
    }

    const scans = new Map(
      await Promise.all(
        [...agentsByDirectory].map(
          async ([directoryKey, { agentNames, directory }]) =>
            [
              directoryKey,
              {
                agentNames,
                directory,
                scan: await scanSkillDirectory(directory),
              },
            ] as const
        )
      )
    )
    const symlinkHealth = combineHealth(scans)
    const agentCoverage = buildCoverage(globalSkills, activeAgents, scans)

    return {
      catalog,
      snapshot: {
        agentCoverage,
        registry: {
          agentCount: this.registry.length,
          agents: this.registry.map(({ id, name }) => ({ id, name })),
          cliVersion: AGENT_REGISTRY_SOURCE.version,
          source: 'skills-cli',
        },
        scannedAt: new Date().toISOString(),
        stats: {
          activeAgents: activeAgents.length,
          linkedSkills: countDeployedSkills(globalSkillNames, scans),
          totalSkills: globalSkillNames.size,
        },
        symlinkHealth,
        untrackedSkills: catalog.externalSkills,
      },
    }
  }
}

async function selectExistingSkillDirectory(
  directories: string[]
): Promise<string | null> {
  for (const directory of directories) {
    if (await directoryExists(directory)) return directory
  }
  return null
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function scanSkillDirectory(directory: string): Promise<DirectoryScan> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return emptyScan()
    return {
      ...emptyScan(),
      inaccessible: 1,
      issues: [
        {
          path: directory,
          skillName: basename(directory),
          status: 'inaccessible',
        },
      ],
    }
  }

  const results = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith('.'))
      .map(async (entry): Promise<DirectoryScan> => {
        const entryPath = join(directory, entry.name)
        if (entry.isSymbolicLink()) {
          const status = await inspectSymlink(entryPath)
          if (status === 'valid') {
            const scan = emptyScan()
            scan.linkedSkillNames.add(entry.name)
            scan.valid = 1
            return scan
          }
          return {
            ...emptyScan(),
            [status]: 1,
            issues: [{ path: entryPath, skillName: entry.name, status }],
          }
        }

        if (entry.isDirectory()) {
          try {
            await access(join(entryPath, 'SKILL.md'))
            const scan = emptyScan()
            scan.direct = 1
            scan.directSkillNames.add(entry.name)
            return scan
          } catch {
            return emptyScan()
          }
        }
        return emptyScan()
      })
  )

  return results.reduce(mergeScan, emptyScan())
}

async function inspectSymlink(
  linkPath: string
): Promise<'broken' | 'inaccessible' | 'valid'> {
  try {
    const rawTarget = await readlink(linkPath)
    const target = isAbsolute(rawTarget)
      ? resolve(rawTarget)
      : resolve(await realpath(dirname(linkPath)), rawTarget)
    try {
      await access(target)
      return 'valid'
    } catch (error) {
      return isMissingPathError(error) ? 'broken' : 'inaccessible'
    }
  } catch (error) {
    return isMissingPathError(error) ? 'broken' : 'inaccessible'
  }
}

function isMissingPathError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  return error.code === 'ENOENT' || error.code === 'ENOTDIR'
}

function emptyScan(): DirectoryScan {
  return {
    broken: 0,
    direct: 0,
    directSkillNames: new Set(),
    inaccessible: 0,
    issues: [],
    linkedSkillNames: new Set(),
    valid: 0,
  }
}

function mergeScan(left: DirectoryScan, right: DirectoryScan): DirectoryScan {
  return {
    broken: left.broken + right.broken,
    direct: left.direct + right.direct,
    directSkillNames: new Set([
      ...left.directSkillNames,
      ...right.directSkillNames,
    ]),
    inaccessible: left.inaccessible + right.inaccessible,
    issues: [...left.issues, ...right.issues],
    linkedSkillNames: new Set([
      ...left.linkedSkillNames,
      ...right.linkedSkillNames,
    ]),
    valid: left.valid + right.valid,
  }
}

function combineHealth(
  scans: Map<
    string,
    { agentNames: string[]; directory: string; scan: DirectoryScan }
  >
): SymlinkHealthSnapshot {
  const health: SymlinkHealthSnapshot = {
    broken: 0,
    direct: 0,
    inaccessible: 0,
    issues: [],
    valid: 0,
  }
  for (const { agentNames, scan } of scans.values()) {
    health.broken += scan.broken
    health.direct += scan.direct
    health.inaccessible += scan.inaccessible
    health.valid += scan.valid
    health.issues.push(
      ...scan.issues.map((issue) => ({ ...issue, agentNames }))
    )
  }
  health.issues.sort((left, right) =>
    left.skillName.localeCompare(right.skillName)
  )
  return health
}

function buildCoverage(
  globalSkills: CatalogSnapshot['skills'],
  activeAgents: ActiveAgent[],
  scans: Map<
    string,
    { agentNames: string[]; directory: string; scan: DirectoryScan }
  >
): AgentCoverageEntry[] {
  const globalSkillNames = new Set(globalSkills.map((skill) => skill.name))
  const availableSkillsByAgent = buildAvailableSkillsByAgent(globalSkills)

  return activeAgents
    .map(({ directory, directoryKey, registry }) => {
      const scan = scans.get(directoryKey)?.scan ?? emptyScan()
      const linkedSkills = countMatchingNames(
        scan.linkedSkillNames,
        globalSkillNames
      )
      const directSkills = countMatchingNames(
        scan.directSkillNames,
        globalSkillNames
      )
      const availableSkillNames = new Set([
        ...(availableSkillsByAgent.get(normalizeAgentKey(registry.name)) ?? []),
        ...(availableSkillsByAgent.get(normalizeAgentKey(registry.id)) ?? []),
        ...[...scan.linkedSkillNames, ...scan.directSkillNames].filter((name) =>
          globalSkillNames.has(name)
        ),
      ])
      const availableSkills = availableSkillNames.size
      return {
        availableSkills,
        directSkills,
        id: registry.id,
        linkedSkills,
        name: registry.name,
        path: directory,
        ratio:
          globalSkillNames.size > 0
            ? Math.min(1, availableSkills / globalSkillNames.size)
            : 0,
      }
    })
    .sort(
      (left, right) =>
        right.availableSkills - left.availableSkills ||
        left.name.localeCompare(right.name)
    )
}

function buildAvailableSkillsByAgent(
  globalSkills: CatalogSnapshot['skills']
): Map<string, Set<string>> {
  const availableSkills = new Map<string, Set<string>>()
  for (const skill of globalSkills) {
    for (const agent of skill.agents) {
      const key = normalizeAgentKey(agent)
      const names = availableSkills.get(key) ?? new Set<string>()
      names.add(skill.name)
      availableSkills.set(key, names)
    }
  }
  return availableSkills
}

function normalizeAgentKey(value: string): string {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '')
}

function countDeployedSkills(
  globalSkillNames: Set<string>,
  scans: Map<
    string,
    { agentNames: string[]; directory: string; scan: DirectoryScan }
  >
): number {
  const deployed = new Set<string>()
  for (const { scan } of scans.values()) {
    for (const name of [...scan.linkedSkillNames, ...scan.directSkillNames]) {
      if (globalSkillNames.has(name)) deployed.add(name)
    }
  }
  return deployed.size
}

function countMatchingNames(names: Set<string>, allowed: Set<string>): number {
  let count = 0
  for (const name of names) {
    if (allowed.has(name)) count += 1
  }
  return count
}
