import type {
  ApplySyncInput,
  SyncPreview,
  WebDavInput,
  WebDavStatus,
} from './sync-contract'

export const desktopIpcChannels = {
  syncExport: 'sync:export',
  syncImport: 'sync:import',
  syncApply: 'sync:apply',
  syncDiscard: 'sync:discard',
  syncWebDavGet: 'sync:webdav-get',
  syncWebDavSave: 'sync:webdav-save',
  syncWebDavTest: 'sync:webdav-test',
  syncWebDavPull: 'sync:webdav-pull',
  syncWebDavPush: 'sync:webdav-push',
  appUpdateGet: 'app-update:get',
  appUpdateCheck: 'app-update:check',
  appUpdateDownload: 'app-update:download',
  appUpdateInstall: 'app-update:install',
  appUpdateChanged: 'app-update:changed',
  agentInstallRegistryGet: 'agent-install-registry:get',
  aiDescriptionSave: 'ai:description-save',
  aiTranslationSave: 'ai:translation-save',
  aiProviderSettingsClear: 'ai:provider-settings-clear',
  aiProviderSettingsGet: 'ai:provider-settings-get',
  aiDataRestore: 'ai:data-restore',
  aiProviderSettingsSave: 'ai:provider-settings-save',
  aiProviderVerify: 'ai:provider-verify',
  aiChatRun: 'ai:chat-run',
  aiConversationDelete: 'ai:conversation-delete',
  aiConversationGet: 'ai:conversation-get',
  aiConversationList: 'ai:conversation-list',
  aiConversationSave: 'ai:conversation-save',
  aiSkillRun: 'ai:skill-run',
  catalogGet: 'catalog:get',
  catalogScanUpdates: 'catalog:scan-updates',
  catalogScanUpdatesProgress: 'catalog:scan-updates-progress',
  catalogTrackSkills: 'catalog:track-skills',
  groupCreate: 'group:create',
  groupSave: 'group:save',
  organizationSave: 'organization:save',
  discoverySnapshotGet: 'discovery:snapshot-get',
  discoveryOfficialCreatorGet: 'discovery:official-creator-get',
  discoveryOfficialRepositoryGet: 'discovery:official-repository-get',
  discoverySkillInstallCommandGet: 'discovery:skill-install-command-get',
  discoveryTopicGet: 'discovery:topic-get',
  marketplaceAuditGet: 'marketplace:audit-get',
  marketplaceSearch: 'marketplace:search',
  managedDeploymentRemove: 'managed:deployment-remove',
  managedDeploymentOpenFolder: 'managed:deployment-open-folder',
  managedDeploymentFolderSelect: 'managed:deployment-folder-select',
  managedSkillDelete: 'managed:skill-delete',
  managedSkillDeploy: 'managed:skill-deploy',
  managedSkillImport: 'managed:skill-import',
  managedSkillImportCandidates: 'managed:skill-import-candidates',
  managedSkillOpenFolder: 'managed:skill-open-folder',
  managedSkillsGet: 'managed:skills-get',
  managedSkillPackDelete: 'managed:pack-delete',
  managedSkillPackSave: 'managed:pack-save',
  projectAdd: 'project:add',
  projectRemove: 'project:remove',
  dataOpenFolder: 'data:open-folder',
  runtimeGet: 'runtime:get',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  skillAdd: 'skill:add',
  skillFilesGet: 'skill:files-get',
  skillFileRead: 'skill:file-read',
  skillOpenFolder: 'skill:open-folder',
  skillOpenSource: 'skill:open-source',
  skillRemove: 'skill:remove',
  skillUpdate: 'skill:update',
  terminalClose: 'terminal:close',
  terminalCreate: 'terminal:create',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit',
  terminalResize: 'terminal:resize',
  terminalWrite: 'terminal:write',
  websiteOpen: 'website:open',
  websiteOpenDiscovery: 'website:open-discovery',
  workbenchGet: 'workbench:get',
  workbenchOpenDirectory: 'workbench:open-directory',
  workbenchChanged: 'workbench:changed',
  trayAction: 'tray:action',
  trayReady: 'tray:ready',
} as const

export type DesktopView =
  'discover' | 'library' | 'managed' | 'settings' | 'workbench'
export type TrayAction = DesktopView | 'scan-updates'

export const trayIpcChannels = {
  getState: 'tray:state-get',
  stateChanged: 'tray:state-changed',
  scan: 'tray:scan',
  openMain: 'tray:open-main',
  hide: 'tray:hide',
  quit: 'tray:quit',
} as const

export interface TraySummary {
  activeAgents: number
  brokenLinks: number
  projects: number
  scannedAt: string
  totalSkills: number
  updates: number
}

export interface TrayState {
  appName: string
  isDevelopment: boolean
  language: DesktopSettings['language']
  scanning: boolean
  summary: TraySummary | null
  systemLocale: string
  theme: DesktopSettings['theme']
}

export interface SkillShelfTrayApi {
  getState(): Promise<TrayState>
  scanEnvironment(): Promise<TrayState>
  openMain(action: TrayAction): Promise<void>
  hide(): Promise<void>
  quit(): Promise<void>
  onStateChanged(listener: (state: TrayState) => void): () => void
}

export interface ShelfGroup {
  color: string
  id: string
  name: string
  parentId: string | null
  position: CanvasPosition | null
  scopeKey: ShelfScopeKey
}

export interface CanvasPosition {
  x: number
  y: number
}

export type ShelfScopeKey = 'global' | `project:${string}`

export interface SkillOrganization {
  descriptions: Record<string, string>
  groupId: string | null
  position: CanvasPosition | null
  tags: string[]
  translations: Record<string, SkillDescriptionTranslation>
}

export interface SkillDescriptionTranslation {
  content: string
  method?: SkillDescriptionTranslationMethod
  sourceDescription: string
  translatedAt: string
}

export type SkillDescriptionTranslationMethod = 'ai' | 'source-copy'

export type SkillUpdateStatus =
  'current' | 'missing' | 'unavailable' | 'unchecked' | 'update-available'

export type SkillUpdateReason =
  | 'local-source'
  | 'network-error'
  | 'not-scanned'
  | 'remote-changed'
  | 'remote-missing'
  | 'source-unavailable'
  | 'unsupported-source'
  | 'up-to-date'
  | 'untracked'

export interface SkillUpdateCheck {
  checkedAt?: string
  reason: SkillUpdateReason
  status: SkillUpdateStatus
}

export interface SkillUpdateScanProgress {
  check: SkillUpdateCheck
  completed: number
  requestId: string
  skillId: string
  total: number
}

export interface InstalledSkill extends SkillOrganization {
  agents: string[]
  description: string
  id: string
  installKind: SkillInstallKind
  linkTarget?: string
  name: string
  path: string
  projectId?: string
  projectName?: string
  scope: 'global' | 'project'
  source?: string
  sourceType?: string
  sourceUrl?: string
  updateCheck: SkillUpdateCheck
}

export type SkillInstallKind = 'directory' | 'symlink' | 'unknown'

export interface ShelfProject {
  addedAt: string
  id: string
  name: string
  path: string
}

export interface CatalogProject extends ShelfProject {
  scanError?: string
  skillCount: number
}

export interface CatalogSnapshot {
  cliVersion: string
  externalScannedAt?: string
  externalSkills: InstalledSkill[]
  groups: ShelfGroup[]
  projects: CatalogProject[]
  scannedAt: string
  skills: InstalledSkill[]
}

export interface WorkbenchStats {
  detectedAgents: number
  directoryAgents: number
  directoryOnlyAgents: number
  exclusiveSkills: number
  linkedSkills: number
  sharedSkills: number
  // Readable global inventory deduplicated by name; coverage uses sharedSkills.
  totalSkills: number
}

export interface SymlinkIssue {
  agentNames: string[]
  path: string
  skillName: string
  status: 'broken' | 'inaccessible' | 'missing-document'
}

export interface SymlinkHealthSnapshot {
  broken: number
  direct: number
  inaccessible: number
  issues: SymlinkIssue[]
  missingDocuments: number
  valid: number
}

export interface AgentProgramDetection {
  status: 'found' | 'not-found' | 'unverified'
  evidence: Array<{ kind: 'command' | 'application'; path: string }>
  commands: string[]
  applications: string[]
}

export interface WorkbenchSkillFile {
  kind: 'copy' | 'symlink'
  name: string
  path: string
}

export interface AgentCoverageEntry {
  availableSkills: number
  directSkills: number
  exclusiveSkills: number
  id: string
  linkedSkills: number
  name: string
  path: string
  ratio: number
  directoryExists: boolean
  configurationPaths: string[]
  program: AgentProgramDetection
  readsSharedDirectory: boolean
  localSkills: WorkbenchSkillFile[]
  missingSkillNames: string[]
  exclusiveSkillNames: string[]
  // Shared availability not already counted as a local link or copy.
  sharedSkills: number
}

export interface WorkbenchSnapshot {
  agentCoverage: AgentCoverageEntry[]
  registry: {
    agentCount: number
    agents: Array<{
      id: string
      name: string
    }>
    cliVersion: string
    source: 'skills-cli'
  }
  scannedAt: string
  sharedDirectory: { exists: boolean; path: string; skillNames: string[] }
  programSearch: { source: 'login-shell' | 'process'; paths: string[] }
  stats: WorkbenchStats
  symlinkHealth: SymlinkHealthSnapshot
  untrackedSkills: InstalledSkill[]
}

export interface WorkbenchScanResult {
  catalog: CatalogSnapshot
  snapshot: WorkbenchSnapshot
}

export interface AgentInstallOption {
  id: string
  name: string
  projectSkillDirectory: string
  scopes: Array<'global' | 'project'>
}

export interface AgentInstallRegistrySnapshot {
  agents: AgentInstallOption[]
  cliVersion: string
  source: 'skills-cli'
  universal: {
    agentIds: string[]
    directory: string
    hiddenAgentIds: string[]
  }
}

export interface SkillFileEntry {
  children?: SkillFileEntry[]
  kind: 'directory' | 'file'
  name: string
  path: string
  size?: number
}

export interface SkillFileTree {
  entries: SkillFileEntry[]
  fileCount: number
  truncated: boolean
}

export interface SkillFileContent {
  content?: string
  language: string
  name: string
  path: string
  previewKind: 'binary' | 'text' | 'too-large'
  size: number
}

export type SkillInstallTarget =
  { scope: 'global' } | { projectId: string; scope: 'project' }

export interface AddSkillInput {
  agents: string[]
  source: string
  target: SkillInstallTarget
}

export interface SaveOrganizationInput {
  groupId: string | null
  position?: CanvasPosition | null
  skillId: string
  tags: string[]
}

export interface SaveSkillDescriptionInput {
  description: string
  language: string
  skillId: string
}

export interface SaveSkillTranslationInput {
  content: string
  language: string
  method: SkillDescriptionTranslationMethod
  skillId: string
  sourceDescription: string
}

export interface CreateGroupInput {
  color: string
  name: string
  parentId: string | null
  position: CanvasPosition
  scopeKey: ShelfScopeKey
}

export interface SaveGroupInput {
  folderId: string
  name?: string
  parentId?: string | null
  position?: CanvasPosition
}

export interface OperationResult {
  command?: string
  message: string
  outputLines?: string[]
  success: boolean
}

export interface MarketplaceSkill {
  installCount?: number
  name: string
  rank: number
  repo: string
  url: string
}

export type DiscoverySection = 'home' | 'official' | 'topics'
export type DiscoveryLeaderboard = 'all' | 'hot' | 'trending'

export interface DiscoverySkill {
  description?: string
  displayRepo: string
  installCount?: number
  installLabel?: string
  name: string
  rank?: number
  repo: string
  url: string
  weeklyInstalls?: number[]
}

export interface DiscoverySkillInstallCommand {
  command: string
  repository: string
  skill: string
  sourceUrl: string
}

export interface DiscoverySkillCollection {
  id: DiscoveryLeaderboard
  skills: DiscoverySkill[]
  total?: number
}

export interface DiscoveryTopic {
  description: string
  skillCount: number
  slug: string
  title: string
  url: string
}

export interface DiscoveryOfficialSource {
  creator: string
  imageUrl?: string
  repo: string
  repoCount: number
  skillCount: number
  url: string
}

export interface DiscoveryOfficialRepository {
  creator: string
  installCount?: number
  installLabel?: string
  name: string
  skillCount: number
  skillPreview: string[]
  url: string
}

interface DiscoverySnapshotBase {
  fetchedAt: string
  sourceUrl: string
  stale: boolean
  warning?: 'refresh-failed'
}

export interface DiscoveryHomeSnapshot extends DiscoverySnapshotBase {
  collections: DiscoverySkillCollection[]
  section: 'home'
}

export interface DiscoveryTopicsSnapshot extends DiscoverySnapshotBase {
  section: 'topics'
  topics: DiscoveryTopic[]
}

export interface DiscoveryOfficialSnapshot extends DiscoverySnapshotBase {
  section: 'official'
  sources: DiscoveryOfficialSource[]
}

export type DiscoverySnapshot =
  DiscoveryHomeSnapshot | DiscoveryOfficialSnapshot | DiscoveryTopicsSnapshot

export interface DiscoveryTopicDetail extends DiscoverySnapshotBase {
  description: string
  skills: DiscoverySkill[]
  slug: string
  title: string
}

export interface DiscoveryOfficialCreatorDetail extends DiscoverySnapshotBase {
  creator: string
  installCount?: number
  installLabel?: string
  repositories: DiscoveryOfficialRepository[]
  repoCount: number
  skillCount: number
}

export interface DiscoveryOfficialRepositoryDetail extends DiscoverySnapshotBase {
  creator: string
  installCount?: number
  installLabel?: string
  repository: string
  skills: DiscoverySkill[]
}

export interface MarketplaceAudit {
  auditedAt: string
  categories: string[]
  provider: string
  riskLevel?: string
  slug: string
  status: string
  summary: string
}

export interface MarketplaceAuditSnapshot {
  audits: MarketplaceAudit[]
  id: string
  slug: string
  source: string
}

export type ManagedSkillInstallMode = 'copy' | 'symlink'

export type ManagedSkillDeploymentTarget =
  | { kind: 'global' }
  | { agentIds: string[]; kind: 'project'; projectId: string }
  | { agentIds: string[]; directoryPath: string; kind: 'project-directory' }
  | { directoryPath: string; kind: 'custom' }

export type ManagedSkillDeploymentTargetKind =
  ManagedSkillDeploymentTarget['kind']

export interface ManagedSkillDeployment {
  agentId?: string
  agentName?: string
  id: string
  installedAt: string
  mode: ManagedSkillInstallMode
  projectId?: string
  projectRootPath?: string
  targetDirectory: string
  targetKind: ManagedSkillDeploymentTargetKind
  targetName: string
  targetPath: string
}

export interface ManagedDeploymentFolderSelection {
  name: string
  path: string
}

export type ManagedDeploymentFolderPurpose = 'project-root' | 'skill-parent'

export interface ManagedSkill {
  deployments: ManagedSkillDeployment[]
  description: string
  id: string
  importedAt: string
  managedPath: string
  name: string
  sourcePath: string
  sourceScope: 'global' | 'project'
  sourceSkillId: string
  updatedAt: string
}

export interface SkillPack {
  createdAt: string
  description: string
  id: string
  name: string
  skillIds: string[]
  updatedAt: string
}

export interface ManagedSkillsSnapshot {
  packs: SkillPack[]
  skills: ManagedSkill[]
}

export interface SaveSkillPackInput {
  description: string
  id?: string
  name: string
  skillIds: string[]
}

export interface DeployManagedSkillInput {
  mode: ManagedSkillInstallMode
  skillId: string
  target: ManagedSkillDeploymentTarget
}

export interface RemoveManagedDeploymentInput {
  deploymentId: string
  skillId: string
}

export type AppTheme = 'dark' | 'light' | 'system'
export type AppDensity = 'comfortable' | 'compact'
export type AppLanguage = 'en' | 'system' | 'zh-CN'
export type LibraryViewMode = 'canvas' | 'columns' | 'list'
export type FinderSortKey =
  'kind' | 'name' | 'source' | 'tags' | 'update-status'
export type FinderSortDirection = 'ascending' | 'descending'
export interface FinderViewOptions {
  alignToGrid: boolean
  groupBy: FinderSortKey
  sortBy: FinderSortKey | 'none'
  sortDirection: FinderSortDirection
  useGroups: boolean
  viewMode: LibraryViewMode
}
export const DEFAULT_SKILL_DRAWER_WIDTH = 680
export const MIN_SKILL_DRAWER_WIDTH = 480
export const MAX_SKILL_DRAWER_WIDTH = 960
export const DEFAULT_UTILITY_PANEL_WIDTH = 380
export const MIN_UTILITY_PANEL_WIDTH = 320
export const MAX_UTILITY_PANEL_WIDTH = 720
export const DEFAULT_TERMINAL_PANEL_HEIGHT = 280
export const MIN_TERMINAL_PANEL_HEIGHT = 160
export const MAX_TERMINAL_PANEL_HEIGHT = 640

export interface DesktopSettings {
  defaultAgents: string[]
  density: AppDensity
  finderViewOptions: Record<string, FinderViewOptions>
  focusedAgents: string[]
  language: AppLanguage
  libraryViewMode: LibraryViewMode
  launchAtLogin: boolean
  sidebarCollapsed: boolean
  skillDrawerWidth: number
  terminalPanelHeight: number
  theme: AppTheme
  utilityPanelWidth: number
}

export type UpdateDesktopSettingsInput = Partial<DesktopSettings>

export type AiProviderId = 'deepseek'
export type AiContextMode = 'relevant-text' | 'skill-md'
export type AiSkillAction = 'analyze' | 'ask' | 'summarize' | 'translate'

export interface AiProviderModelInput {
  description?: string
  displayName: string
  id: string
  shortName?: string
}

export type AiModelVerificationState =
  'available' | 'unavailable' | 'unverified'

export interface AiProviderModelStatus extends AiProviderModelInput {
  provider: AiProviderId
  verification: AiModelVerificationState
  verifiedAt: string | null
  verificationMessage: string | null
}

export interface AiModelSelection {
  model: string
  provider: AiProviderId
}

export interface AiModelRoleSettings {
  analysis: AiModelSelection
  chat: AiModelSelection
  writing: AiModelSelection
}

export const aiProviderRegistry = [
  {
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
    baseUrl: 'https://api.deepseek.com',
    description: 'DeepSeek OpenAI-compatible API',
    displayName: 'DeepSeek',
    id: 'deepseek',
    models: [
      {
        description:
          'Faster responses for everyday chat and lightweight tasks.',
        displayName: 'DeepSeek V4 Flash',
        id: 'deepseek-v4-flash',
        shortName: 'V4 Flash',
      },
      {
        description:
          'More complete reasoning for complex analysis and long tasks.',
        displayName: 'DeepSeek V4 Pro',
        id: 'deepseek-v4-pro',
        shortName: 'V4 Pro',
      },
    ],
  },
] as const satisfies ReadonlyArray<{
  apiKeyUrl: string | null
  baseUrl: string
  description: string
  displayName: string
  id: AiProviderId
  models: ReadonlyArray<AiProviderModelInput>
}>

export const aiProviderPresets = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  },
} as const satisfies Record<AiProviderId, { baseUrl: string; model: string }>

export const defaultAiModelRoleSettings: AiModelRoleSettings = {
  analysis: { model: 'deepseek-v4-pro', provider: 'deepseek' },
  chat: { model: 'deepseek-v4-flash', provider: 'deepseek' },
  writing: { model: 'deepseek-v4-flash', provider: 'deepseek' },
}

export interface AiProviderConnectionStatus {
  availableModels: AiProviderModelStatus[]
  baseUrl: string
  configured: boolean
  enabled: boolean
  hasApiKey: boolean
  provider: AiProviderId
  updatedAt: string | null
}

export interface AiProviderSettingsStatus {
  availableModels: AiProviderModelStatus[]
  baseUrl: string
  configured: boolean
  contextMode: AiContextMode
  enabled: boolean
  hasApiKey: boolean
  model: string
  models: AiModelRoleSettings
  provider: AiProviderId
  connections: AiProviderConnectionStatus[]
  localStorageAvailable: boolean
  legacyDataAvailable: boolean
  targetLanguage: string
  updatedAt: string | null
}

export interface AiProviderSettingsInput {
  apiKey?: string
  availableModels?: AiProviderModelInput[]
  contextMode?: AiContextMode
  enabled?: boolean
  model: string
  models?: AiModelRoleSettings
  provider: AiProviderId
  targetLanguage?: string
}

export interface AiProviderVerificationInput {
  modelId: string
  provider: AiProviderId
}

export interface AiSkillRequest {
  action: AiSkillAction
  language?: string
  prompt?: string
  skillId: string
  sourceText?: string
}

export interface AiSkillResult {
  action: AiSkillAction
  content: string
  contextFiles: string[]
  generatedAt: string
  model: string
  provider: AiProviderId
  truncated: boolean
}

export interface AiChatHistoryMessage {
  content: string
  role: 'assistant' | 'user'
}

export interface AiConversationMessage extends AiChatHistoryMessage {}

export interface AiConversationSummary {
  createdAt: string
  id: string
  messageCount: number
  preview: string
  skillId?: string
  skillName?: string
  title: string
  updatedAt: string
}

export interface AiConversation extends AiConversationSummary {
  messages: AiConversationMessage[]
}

export interface SaveAiConversationInput {
  id: string
  messages: AiConversationMessage[]
  skillId?: string
  skillName?: string
}

export interface DeleteAiConversationResult {
  deleted: boolean
  id: string
}

export interface AiChatRequest {
  history: AiChatHistoryMessage[]
  language: string
  model?: AiModelSelection
  prompt: string
  skillId?: string
}

export interface AiChatResult {
  content: string
  contextFiles: string[]
  generatedAt: string
  model: string
  provider: AiProviderId
  skillId?: string
  truncated: boolean
}

export interface DesktopRuntimeInfo {
  appName: string
  appVersion: string
  arch: string
  channel: 'development' | 'production'
  isPackaged: boolean
  platform: string
  shelfFilePath: string
  systemLocale: string
  userDataPath: string
}

export interface AppUpdateState {
  installMode: 'manual' | 'automatic'
  status:
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'current'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'error'
  reason?: 'development' | 'unconfigured' | 'unsupported-install'
  version: string | null
  percent: number | null
  checkedAt: string | null
}

export interface TerminalCreateInput {
  cols: number
  projectId?: string
  rows: number
  sessionId: string
}

export interface TerminalSessionInfo {
  cwd: string
  sessionId: string
  shell: string
}

export interface TerminalWriteInput {
  data: string
  sessionId: string
}

export interface TerminalResizeInput {
  cols: number
  rows: number
  sessionId: string
}

export interface TerminalDataEvent {
  data: string
  sessionId: string
}

export interface TerminalExitEvent {
  exitCode: number
  sessionId: string
  signal?: number
}

export interface SkillShelfDesktopApi {
  exportSyncData(): Promise<boolean>
  importSyncData(): Promise<SyncPreview | null>
  applySyncData(
    input: ApplySyncInput
  ): Promise<{ catalog: CatalogSnapshot; settings: DesktopSettings }>
  discardSyncPreview(previewId: string): Promise<void>
  getWebDavSettings(): Promise<WebDavStatus>
  saveWebDavSettings(input: WebDavInput): Promise<WebDavStatus>
  testWebDavConnection(): Promise<void>
  pullWebDavSync(): Promise<SyncPreview>
  pushWebDavSync(): Promise<SyncPreview>
  getAppUpdate(): Promise<AppUpdateState>
  checkAppUpdate(): Promise<AppUpdateState>
  downloadAppUpdate(): Promise<AppUpdateState>
  installAppUpdate(): Promise<void>
  onAppUpdateChanged(listener: (state: AppUpdateState) => void): () => void
  onTrayAction(listener: (action: TrayAction) => void): () => void
  readyForTrayActions(): Promise<void>
  onWorkbenchChanged(
    listener: (result: WorkbenchScanResult) => void
  ): () => void
  addSkill(input: AddSkillInput): Promise<OperationResult>
  addProject(): Promise<CatalogSnapshot | null>
  clearAiProviderSettings(
    provider: AiProviderId
  ): Promise<AiProviderSettingsStatus>
  createGroup(input: CreateGroupInput): Promise<CatalogSnapshot>
  getAgentInstallRegistry(): Promise<AgentInstallRegistrySnapshot>
  getAiProviderSettings(): Promise<AiProviderSettingsStatus>
  restorePreviousAiData(): Promise<AiProviderSettingsStatus>
  getAiConversation(id: string): Promise<AiConversation | null>
  listAiConversations(): Promise<AiConversationSummary[]>
  getCatalog(): Promise<CatalogSnapshot>
  getDiscoverySnapshot(
    section: DiscoverySection,
    force?: boolean
  ): Promise<DiscoverySnapshot>
  getDiscoveryOfficialCreator(
    creator: string,
    force?: boolean
  ): Promise<DiscoveryOfficialCreatorDetail>
  getDiscoveryOfficialRepository(
    creator: string,
    repository: string,
    force?: boolean
  ): Promise<DiscoveryOfficialRepositoryDetail>
  getDiscoverySkillInstallCommand(
    sourceUrl: string
  ): Promise<DiscoverySkillInstallCommand>
  getDiscoveryTopic(
    slug: string,
    force?: boolean
  ): Promise<DiscoveryTopicDetail>
  getRuntimeInfo(): Promise<DesktopRuntimeInfo>
  getSettings(): Promise<DesktopSettings>
  getMarketplaceAudit(
    repo: string,
    skillName: string
  ): Promise<MarketplaceAuditSnapshot>
  getManagedSkills(): Promise<ManagedSkillsSnapshot>
  getManagedSkillImportCandidates(): Promise<InstalledSkill[]>
  getSkillFiles(skillId: string): Promise<SkillFileTree>
  searchMarketplace(query: string): Promise<MarketplaceSkill[]>
  openDataFolder(): Promise<void>
  openSkillFolder(skillId: string): Promise<void>
  openSkillSource(skillId: string): Promise<void>
  openWebsite(): Promise<void>
  openDiscoveryWebsite(url: string): Promise<void>
  openManagedSkillFolder(skillId: string): Promise<void>
  openManagedDeploymentFolder(
    input: RemoveManagedDeploymentInput
  ): Promise<void>
  selectManagedDeploymentFolder(
    purpose: ManagedDeploymentFolderPurpose
  ): Promise<ManagedDeploymentFolderSelection | null>
  saveGroup(input: SaveGroupInput): Promise<CatalogSnapshot>
  scanSkillUpdates(requestId?: string): Promise<CatalogSnapshot>
  onSkillUpdateScanProgress(
    listener: (progress: SkillUpdateScanProgress) => void
  ): () => void
  trackSkills(skillIds: string[]): Promise<CatalogSnapshot>
  readSkillFile(
    skillId: string,
    relativePath: string
  ): Promise<SkillFileContent>
  removeProject(projectId: string): Promise<CatalogSnapshot>
  removeManagedDeployment(
    input: RemoveManagedDeploymentInput
  ): Promise<ManagedSkillsSnapshot>
  deleteManagedSkill(skillId: string): Promise<ManagedSkillsSnapshot>
  deleteSkillPack(packId: string): Promise<ManagedSkillsSnapshot>
  deployManagedSkill(
    input: DeployManagedSkillInput
  ): Promise<ManagedSkillsSnapshot>
  importManagedSkills(skillIds: string[]): Promise<ManagedSkillsSnapshot>
  removeSkill(skillId: string): Promise<OperationResult>
  deleteAiConversation(id: string): Promise<DeleteAiConversationResult>
  runAiChat(input: AiChatRequest): Promise<AiChatResult>
  runAiSkillAction(input: AiSkillRequest): Promise<AiSkillResult>
  saveAiProviderSettings(
    input: AiProviderSettingsInput
  ): Promise<AiProviderSettingsStatus>
  saveAiConversation(input: SaveAiConversationInput): Promise<AiConversation>
  saveSkillDescription(
    input: SaveSkillDescriptionInput
  ): Promise<CatalogSnapshot>
  saveSkillTranslation(
    input: SaveSkillTranslationInput
  ): Promise<CatalogSnapshot>
  saveOrganization(input: SaveOrganizationInput): Promise<CatalogSnapshot>
  saveSkillPack(input: SaveSkillPackInput): Promise<ManagedSkillsSnapshot>
  createTerminal(input: TerminalCreateInput): Promise<TerminalSessionInfo>
  closeTerminal(sessionId: string): Promise<void>
  onTerminalData(listener: (event: TerminalDataEvent) => void): () => void
  onTerminalExit(listener: (event: TerminalExitEvent) => void): () => void
  resizeTerminal(input: TerminalResizeInput): Promise<void>
  writeTerminal(input: TerminalWriteInput): Promise<void>
  updateSkill(skillId: string): Promise<OperationResult>
  updateSettings(input: UpdateDesktopSettingsInput): Promise<DesktopSettings>
  verifyAiProvider(
    input: AiProviderVerificationInput
  ): Promise<AiProviderSettingsStatus>
  getWorkbench(): Promise<WorkbenchScanResult>
  openWorkbenchDirectory(agentId: string): Promise<void>
}
