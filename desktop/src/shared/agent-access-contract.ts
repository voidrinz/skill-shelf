export type AgentAccessMode = 'symlink' | 'copy'
export type AgentAccessAction = 'connect' | 'update' | 'repair' | 'disconnect'
export type AgentAccessStatus =
  | 'shared'
  | 'missing'
  | 'linked'
  | 'copy-current'
  | 'copy-outdated'
  | 'copy-modified'
  | 'conflict'
  | 'broken'
  | 'source-missing'
  | 'unreadable'

export interface AgentSkillAccessEntry {
  name: string
  sourcePath: string
  resolvedSourcePath?: string
  targetPath: string
  actualTargetPath?: string
  mode: AgentAccessMode | 'shared' | null
  ownership: 'managed' | 'external' | 'shared'
  status: AgentAccessStatus
  actions: AgentAccessAction[]
}

export interface AgentSkillAccessSnapshot {
  agentId: string
  agentName: string
  sharedDirectory: string
  targetDirectory: string
  readsSharedDirectory: boolean
  scannedAt: string
  entries: AgentSkillAccessEntry[]
  notices?: Array<
    { kind: 'recovery-retained'; path: string } | { kind: 'refresh-failed' }
  >
}

export interface PreviewAgentAccessInput {
  agentId: string
  skillNames: string[]
  action: AgentAccessAction
  mode: AgentAccessMode
}

export type AgentAccessOperation =
  | 'create-link'
  | 'create-copy'
  | 'update-copy'
  | 'repair-link'
  | 'remove-link'
  | 'remove-copy'
  | 'forget'
  | 'blocked'

export interface AgentAccessPreview {
  id: string
  agentId: string
  action: AgentAccessAction
  mode: AgentAccessMode
  expiresAt: string
  entries: Array<AgentSkillAccessEntry & { operation: AgentAccessOperation }>
}
