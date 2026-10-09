import {
  access,
  readdir,
  readFile,
  readlink,
  realpath,
  stat,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import type {
  AgentCoverageEntry,
  AgentProgramDetection,
  CatalogSnapshot,
  SymlinkHealthSnapshot,
  SymlinkIssue,
  WorkbenchScanResult,
  WorkbenchSnapshot,
  WorkbenchSkillFile,
} from '../../shared/desktop-contract'
import {
  AGENT_REGISTRY_SOURCE,
  getAgentRegistry,
  getUniversalInstallTarget,
  type AgentRegistryEntry,
} from './agent-registry'
import { parseSkillDocument } from './skill-document'
import {
  AgentProgramService,
  type AgentProgramProvider,
} from './agent-program-service'

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
  missingDocuments: number
  skills: WorkbenchSkillFile[]
  valid: number
}

interface ObservedAgent {
  directory: string
  directoryExists: boolean
  configurationPaths: string[]
  directoryKey: string
  program: AgentProgramDetection
  registry: AgentRegistryEntry
}

export class WorkbenchService {
  private pendingScan: Promise<WorkbenchScanResult> | null = null

  constructor(
    private readonly catalog: CatalogProvider,
    private readonly registry = getAgentRegistry(),
    private readonly sharedSkillDirectory = join(
      homedir(),
      '.agents',
      'skills'
    ),
    private readonly programs: AgentProgramProvider = new AgentProgramService()
  ) {}

  async getDirectoryPath(id: string): Promise<string> {
    const agent = this.registry.find((entry) => entry.id === id)
    if (id !== 'shared' && !agent) throw new Error('Unknown Agent directory')
    const path =
      id === 'shared'
        ? this.sharedSkillDirectory
        : await selectExistingSkillDirectory(agent!.skillDirectories)
    if (!path || !(await directoryExists(path)))
      throw new Error('Directory not found')
    return path
  }

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
    // Only the canonical shared directory defines cross-Agent coverage.
    const [sharedScan, sharedDirectoryKey, programScan] = await Promise.all([
      scanSkillDirectory(
        this.sharedSkillDirectory,
        new Set(globalSkills.map((skill) => skill.name))
      ),
      canonicalPath(this.sharedSkillDirectory),
      this.programs.scan(this.registry),
    ])
    const sharedSkillNames = new Set([
      ...sharedScan.directSkillNames,
      ...sharedScan.linkedSkillNames,
    ])
    const observedAgents = (
      await Promise.all(
        this.registry.map(async (registry): Promise<ObservedAgent | null> => {
          const directory = await selectExistingSkillDirectory(
            registry.skillDirectories
          )
          const configurationPaths = (
            await Promise.all(
              registry.detectionPaths.map(async (path) =>
                (await directoryExists(path)) ? path : null
              )
            )
          ).filter((path): path is string => path !== null)
          const program = programScan.agents.get(registry.id) ?? {
            status: 'unverified',
            evidence: [],
            commands: [],
            applications: [],
          }
          if (
            !directory &&
            configurationPaths.length === 0 &&
            program.status !== 'found'
          )
            return null
          const expectedDirectory = directory ?? registry.skillDirectories[0]!
          const directoryKey = await canonicalPath(expectedDirectory)

          // Universal-source Agents read ~/.agents/skills directly. That source
          // is inventory, not an Agent-owned installation directory.
          if (directoryKey === sharedDirectoryKey && program.status !== 'found')
            return null
          return {
            directory: expectedDirectory,
            directoryExists: directory !== null,
            configurationPaths,
            directoryKey,
            program,
            registry,
          }
        })
      )
    ).filter((agent): agent is ObservedAgent => agent !== null)

    const agentsByDirectory = new Map<
      string,
      { agentNames: string[]; directory: string }
    >()
    for (const agent of observedAgents) {
      if (!agent.directoryExists || agent.directoryKey === sharedDirectoryKey)
        continue
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
                scan: await scanSkillDirectory(
                  directory,
                  new Set([
                    ...sharedSkillNames,
                    ...globalSkills.map((skill) => skill.name),
                  ])
                ),
              },
            ] as const
        )
      )
    )
    const symlinkHealth = combineHealth(
      new Map([
        ...scans,
        [
          sharedDirectoryKey,
          {
            agentNames: [],
            directory: this.sharedSkillDirectory,
            scan: sharedScan,
          },
        ],
      ])
    )
    const agentCoverage = buildCoverage(sharedSkillNames, observedAgents, scans)
    const globalSkillNames = new Set([
      ...sharedSkillNames,
      ...agentCoverage.flatMap((agent) =>
        agent.localSkills.map((skill) => skill.name)
      ),
    ])

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
        sharedDirectory: {
          exists: await directoryExists(this.sharedSkillDirectory),
          path: this.sharedSkillDirectory,
          skillNames: [...sharedSkillNames].sort(),
        },
        programSearch: programScan.search,
        stats: {
          detectedAgents: observedAgents.filter(
            (agent) => agent.program.status === 'found'
          ).length,
          directoryAgents: observedAgents.filter(
            (agent) =>
              agent.directoryExists && agent.directoryKey !== sharedDirectoryKey
          ).length,
          directoryOnlyAgents: observedAgents.filter(
            (agent) => agent.program.status === 'not-found'
          ).length,
          exclusiveSkills: globalSkillNames.size - sharedSkillNames.size,
          linkedSkills: countDeployedSkills(sharedSkillNames, scans),
          sharedSkills: sharedSkillNames.size,
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

async function scanSkillDirectory(
  directory: string,
  expectedSkillNames: Set<string>
): Promise<DirectoryScan> {
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
        if (!entry.isDirectory() && !entry.isSymbolicLink()) return emptyScan()
        const path = join(directory, entry.name)
        const scan = emptyScan()
        const linked = entry.isSymbolicLink()
        if (linked) {
          const status = await inspectSymlink(path)
          if (status !== 'valid')
            return {
              ...scan,
              [status]: 1,
              issues: [{ path, skillName: entry.name, status }],
            }
          scan.valid = 1
        }
        try {
          const name = parseSkillDocument(
            await readFile(join(path, 'SKILL.md'), 'utf8'),
            entry.name
          ).name
          if (linked) scan.linkedSkillNames.add(name)
          else {
            scan.directSkillNames.add(name)
            scan.direct = 1
          }
          scan.skills.push({ kind: linked ? 'symlink' : 'copy', name, path })
        } catch (error) {
          const status = isMissingPathError(error)
            ? 'missing-document'
            : 'inaccessible'
          // Helper and runtime folders are not failed Skills merely because they lack SKILL.md.
          if (
            status === 'missing-document' &&
            !expectedSkillNames.has(entry.name)
          )
            return scan
          if (status === 'missing-document') scan.missingDocuments = 1
          else scan.inaccessible = 1
          scan.issues.push({ path, skillName: entry.name, status })
        }
        return scan
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
    missingDocuments: 0,
    skills: [],
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
    missingDocuments: left.missingDocuments + right.missingDocuments,
    skills: [...left.skills, ...right.skills],
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
    missingDocuments: 0,
    valid: 0,
  }
  for (const { agentNames, scan } of scans.values()) {
    health.broken += scan.broken
    health.direct += scan.direct
    health.inaccessible += scan.inaccessible
    health.valid += scan.valid
    health.missingDocuments += scan.missingDocuments
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
  sharedSkillNames: Set<string>,
  observedAgents: ObservedAgent[],
  scans: Map<
    string,
    { agentNames: string[]; directory: string; scan: DirectoryScan }
  >
): AgentCoverageEntry[] {
  const sharedReaders = new Set<string>(getUniversalInstallTarget().agentIds)

  return observedAgents
    .map(
      ({
        directory,
        directoryKey,
        directoryExists,
        configurationPaths,
        program,
        registry,
      }) => {
        const scan = scans.get(directoryKey)?.scan ?? emptyScan()
        const readsSharedDirectory = sharedReaders.has(registry.id)
        const localNames = new Set([
          ...scan.linkedSkillNames,
          ...scan.directSkillNames,
        ])
        const knownNames = new Set([
          ...(readsSharedDirectory ? sharedSkillNames : []),
          ...localNames,
        ])
        const availableSkills = countMatchingNames(knownNames, sharedSkillNames)
        const linkedSkills = countMatchingNames(
          scan.linkedSkillNames,
          sharedSkillNames
        )
        const directSkills = countMatchingNames(
          new Set(
            [...scan.directSkillNames].filter(
              (name) => !scan.linkedSkillNames.has(name)
            )
          ),
          sharedSkillNames
        )
        const sharedSkills =
          availableSkills - countMatchingNames(localNames, sharedSkillNames)
        const exclusiveSkills = knownNames.size - availableSkills
        return {
          availableSkills,
          directSkills,
          directoryExists,
          configurationPaths,
          program,
          readsSharedDirectory,
          localSkills: [...scan.skills].sort((left, right) =>
            left.name.localeCompare(right.name)
          ),
          missingSkillNames: [...sharedSkillNames]
            .filter((name) => !knownNames.has(name))
            .sort(),
          exclusiveSkillNames: [...knownNames]
            .filter((name) => !sharedSkillNames.has(name))
            .sort(),
          exclusiveSkills,
          id: registry.id,
          linkedSkills,
          name: registry.name,
          path: directory,
          ratio:
            sharedSkillNames.size > 0
              ? availableSkills / sharedSkillNames.size
              : 0,
          sharedSkills,
        }
      }
    )
    .sort(
      (left, right) =>
        right.availableSkills - left.availableSkills ||
        left.name.localeCompare(right.name)
    )
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
