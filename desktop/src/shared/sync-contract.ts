import type {
  AiContextMode,
  AiModelRoleSettings,
  AiProviderId,
  AiProviderModelInput,
  AiProviderSettingsStatus,
  CatalogSnapshot,
  CanvasPosition,
  DesktopSettings,
  FinderViewOptions,
  SkillDescriptionTranslation,
} from './desktop-contract'

export const portableSettingKeys = [
  'language',
  'theme',
  'density',
  'libraryViewMode',
  'defaultAgents',
  'focusedAgents',
  'sidebarCollapsed',
] as const
export type PortableSettings = Pick<
  DesktopSettings,
  (typeof portableSettingKeys)[number]
>

export interface SyncFolder {
  name: string
  color: string
  position: CanvasPosition | null
  viewOptions?: FinderViewOptions
}

export interface SyncSkill {
  name: string
  identity: string | null
  scope: 'global' | 'project'
  projectName?: string
  tags: string[]
  folder: SyncFolder[]
  position: CanvasPosition | null
  descriptions: Record<string, string>
  translations: Record<string, SkillDescriptionTranslation>
}

export interface SyncDocument {
  format: 'skill-shelf-metadata'
  version: 1 | 2 | 3
  exportedAt: string
  skills: SyncSkill[]
  preferences: Partial<PortableSettings>
  packs?: SyncPack[]
  aiPreferences?: PortableAiPreferences
  aiConnections?: EncryptedAiConnections
}

export interface PortableAiConnection {
  provider: AiProviderId
  apiKey: string | null
  enabled: boolean
}

export interface EncryptedAiConnections {
  cipher: 'aes-256-gcm'
  kdf: 'scrypt'
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

export interface SyncAiConnectionPreview {
  provider: AiProviderId
  hasApiKey: boolean
  enabled: boolean
}

export interface PortableAiPreferences {
  availableModels: Partial<Record<AiProviderId, AiProviderModelInput[]>>
  contextMode: AiContextMode
  models: AiModelRoleSettings
  targetLanguage: string
}

export interface SyncPackMember {
  name: string
  identity: string | null
  fingerprint: string | null
}

export interface SyncPack {
  name: string
  description: string
  skills: SyncPackMember[]
}

export interface SyncPackPreview {
  total: number
  changed: number
  matchedMembers: number
  skippedMembers: Array<{
    packName: string
    skillName: string
    reason: 'not-found' | 'ambiguous' | 'no-identity'
  }>
}

export interface SyncConflict {
  id: string
  skillName: string
  field: string
  local: string
  incoming: string
}

export interface SyncPreview {
  mode: 'import' | 'upload'
  id: string
  exportedAt: string
  matched: number
  skipped: number
  changed: number
  unchanged: number
  localOnly: number
  staleTranslations: number
  conflicts: SyncConflict[]
  skippedSkills: Array<{
    name: string
    reason: 'not-found' | 'ambiguous' | 'no-identity'
  }>
  preferences: Partial<PortableSettings>
  packs?: SyncPackPreview
  aiPreferences?: PortableAiPreferences
  aiConnections?: SyncAiConnectionPreview[]
}

export interface ApplySyncInput {
  previewId: string
  resolutions: Record<string, 'local' | 'incoming'>
  includePreferences: boolean
  includeAiPreferences?: boolean
}

export interface SyncApplyResult {
  catalog: CatalogSnapshot
  settings: DesktopSettings
  aiSettings?: AiProviderSettingsStatus
}

export interface WebDavInput {
  url: string
  username: string
  password?: string
}

export interface WebDavStatus {
  url: string
  username: string
  hasPassword: boolean
  passwordNeedsReentry: boolean
}
