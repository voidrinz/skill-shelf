import type {
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
  version: 1
  exportedAt: string
  skills: SyncSkill[]
  preferences: Partial<PortableSettings>
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
}

export interface ApplySyncInput {
  previewId: string
  resolutions: Record<string, 'local' | 'incoming'>
  includePreferences: boolean
}

export interface WebDavInput {
  url: string
  username: string
  password?: string
  rememberPassword: boolean
}

export interface WebDavStatus {
  url: string
  username: string
  hasPassword: boolean
  rememberPassword: boolean
}
