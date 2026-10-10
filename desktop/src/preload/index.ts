import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import type { SkillShelfDesktopApi } from '../shared/desktop-contract'
import { desktopIpcChannels } from '../shared/desktop-contract'
import { trayApi } from './tray'

const desktopApi: SkillShelfDesktopApi = {
  exportSyncData: () => ipcRenderer.invoke(desktopIpcChannels.syncExport),
  exportSkillPack: (packId) =>
    ipcRenderer.invoke(desktopIpcChannels.managedSkillPackExport, packId),
  importSyncData: (password, retry) =>
    ipcRenderer.invoke(desktopIpcChannels.syncImport, { password, retry }),
  cancelSyncImport: () =>
    ipcRenderer.invoke(desktopIpcChannels.syncImportCancel),
  applySyncData: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.syncApply, input),
  discardSyncPreview: (id) =>
    ipcRenderer.invoke(desktopIpcChannels.syncDiscard, id),
  getWebDavSettings: () => ipcRenderer.invoke(desktopIpcChannels.syncWebDavGet),
  saveWebDavSettings: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.syncWebDavSave, input),
  testWebDavConnection: () =>
    ipcRenderer.invoke(desktopIpcChannels.syncWebDavTest),
  pullWebDavSync: (password) =>
    ipcRenderer.invoke(desktopIpcChannels.syncWebDavPull, password),
  pushWebDavSync: (password) =>
    ipcRenderer.invoke(desktopIpcChannels.syncWebDavPush, password),
  listWebDavSnapshots: () =>
    ipcRenderer.invoke(desktopIpcChannels.syncWebDavList),
  previewWebDavSnapshot: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.syncWebDavPreview, input),
  getAppUpdate: () => ipcRenderer.invoke(desktopIpcChannels.appUpdateGet),
  checkAppUpdate: () => ipcRenderer.invoke(desktopIpcChannels.appUpdateCheck),
  downloadAppUpdate: () =>
    ipcRenderer.invoke(desktopIpcChannels.appUpdateDownload),
  installAppUpdate: () =>
    ipcRenderer.invoke(desktopIpcChannels.appUpdateInstall),
  onAppUpdateChanged: (listener) => {
    const handler = (
      _event: IpcRendererEvent,
      state: Parameters<typeof listener>[0]
    ) => listener(state)
    ipcRenderer.on(desktopIpcChannels.appUpdateChanged, handler)
    return () =>
      ipcRenderer.removeListener(desktopIpcChannels.appUpdateChanged, handler)
  },
  onTrayAction: (listener) => {
    const handler = (
      _event: IpcRendererEvent,
      action: Parameters<typeof listener>[0]
    ) => listener(action)
    ipcRenderer.on(desktopIpcChannels.trayAction, handler)
    return () =>
      ipcRenderer.removeListener(desktopIpcChannels.trayAction, handler)
  },
  readyForTrayActions: () => ipcRenderer.invoke(desktopIpcChannels.trayReady),
  onWorkbenchChanged: (listener) => {
    const handler = (
      _event: IpcRendererEvent,
      result: Parameters<typeof listener>[0]
    ) => listener(result)
    ipcRenderer.on(desktopIpcChannels.workbenchChanged, handler)
    return () =>
      ipcRenderer.removeListener(desktopIpcChannels.workbenchChanged, handler)
  },
  addSkill: (input) => ipcRenderer.invoke(desktopIpcChannels.skillAdd, input),
  addProject: () => ipcRenderer.invoke(desktopIpcChannels.projectAdd),
  getProjectInstructions: (projectId) =>
    ipcRenderer.invoke(desktopIpcChannels.projectInstructionsGet, projectId),
  saveProjectInstruction: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.projectInstructionsSave, input),
  connectProjectClaude: (input) =>
    ipcRenderer.invoke(
      desktopIpcChannels.projectInstructionsConnectClaude,
      input
    ),
  clearAiProviderSettings: (provider) =>
    ipcRenderer.invoke(desktopIpcChannels.aiProviderSettingsClear, provider),
  deleteAiConversation: (id) =>
    ipcRenderer.invoke(desktopIpcChannels.aiConversationDelete, id),
  createGroup: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.groupCreate, input),
  getAgentInstallRegistry: () =>
    ipcRenderer.invoke(desktopIpcChannels.agentInstallRegistryGet),
  getCatalog: () => ipcRenderer.invoke(desktopIpcChannels.catalogGet),
  getDiscoverySnapshot: (section, force) =>
    ipcRenderer.invoke(desktopIpcChannels.discoverySnapshotGet, section, force),
  getDiscoveryOfficialCreator: (creator, force) =>
    ipcRenderer.invoke(
      desktopIpcChannels.discoveryOfficialCreatorGet,
      creator,
      force
    ),
  getDiscoveryOfficialRepository: (creator, repository, force) =>
    ipcRenderer.invoke(
      desktopIpcChannels.discoveryOfficialRepositoryGet,
      creator,
      repository,
      force
    ),
  getDiscoveryTopic: (slug, force) =>
    ipcRenderer.invoke(desktopIpcChannels.discoveryTopicGet, slug, force),
  getDiscoverySkillInstallCommand: (sourceUrl) =>
    ipcRenderer.invoke(
      desktopIpcChannels.discoverySkillInstallCommandGet,
      sourceUrl
    ),
  restorePreviousAiData: () =>
    ipcRenderer.invoke(desktopIpcChannels.aiDataRestore),
  getAiProviderSettings: () =>
    ipcRenderer.invoke(desktopIpcChannels.aiProviderSettingsGet),
  getAiConversation: (id) =>
    ipcRenderer.invoke(desktopIpcChannels.aiConversationGet, id),
  listAiConversations: () =>
    ipcRenderer.invoke(desktopIpcChannels.aiConversationList),
  getRuntimeInfo: () => ipcRenderer.invoke(desktopIpcChannels.runtimeGet),
  getSettings: () => ipcRenderer.invoke(desktopIpcChannels.settingsGet),
  getMarketplaceAudit: (repo, skillName) =>
    ipcRenderer.invoke(desktopIpcChannels.marketplaceAuditGet, repo, skillName),
  getManagedSkills: () =>
    ipcRenderer.invoke(desktopIpcChannels.managedSkillsGet),
  getManagedSkillImportCandidates: () =>
    ipcRenderer.invoke(desktopIpcChannels.managedSkillImportCandidates),
  getWorkbench: () => ipcRenderer.invoke(desktopIpcChannels.workbenchGet),
  openWorkbenchDirectory: (agentId) =>
    ipcRenderer.invoke(desktopIpcChannels.workbenchOpenDirectory, agentId),
  getSkillFiles: (skillId) =>
    ipcRenderer.invoke(desktopIpcChannels.skillFilesGet, skillId),
  searchMarketplace: (query) =>
    ipcRenderer.invoke(desktopIpcChannels.marketplaceSearch, query),
  openDataFolder: () => ipcRenderer.invoke(desktopIpcChannels.dataOpenFolder),
  openSkillFolder: (skillId) =>
    ipcRenderer.invoke(desktopIpcChannels.skillOpenFolder, skillId),
  openSkillSource: (skillId) =>
    ipcRenderer.invoke(desktopIpcChannels.skillOpenSource, skillId),
  openWebsite: () => ipcRenderer.invoke(desktopIpcChannels.websiteOpen),
  openAppLink: (link) =>
    ipcRenderer.invoke(desktopIpcChannels.appLinkOpen, link),
  openDiscoveryWebsite: (url) =>
    ipcRenderer.invoke(desktopIpcChannels.websiteOpenDiscovery, url),
  openManagedSkillFolder: (skillId) =>
    ipcRenderer.invoke(desktopIpcChannels.managedSkillOpenFolder, skillId),
  openManagedDeploymentFolder: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.managedDeploymentOpenFolder, input),
  selectManagedDeploymentFolder: (purpose) =>
    ipcRenderer.invoke(
      desktopIpcChannels.managedDeploymentFolderSelect,
      purpose
    ),
  saveGroup: (input) => ipcRenderer.invoke(desktopIpcChannels.groupSave, input),
  scanSkillUpdates: (requestId) =>
    ipcRenderer.invoke(desktopIpcChannels.catalogScanUpdates, requestId),
  onSkillUpdateScanProgress: (listener) => {
    const handler = (
      _event: IpcRendererEvent,
      progress: Parameters<typeof listener>[0]
    ) => listener(progress)
    ipcRenderer.on(desktopIpcChannels.catalogScanUpdatesProgress, handler)
    return () =>
      ipcRenderer.removeListener(
        desktopIpcChannels.catalogScanUpdatesProgress,
        handler
      )
  },
  trackSkills: (skillIds) =>
    ipcRenderer.invoke(desktopIpcChannels.catalogTrackSkills, skillIds),
  readSkillFile: (skillId, relativePath) =>
    ipcRenderer.invoke(desktopIpcChannels.skillFileRead, skillId, relativePath),
  removeProject: (projectId) =>
    ipcRenderer.invoke(desktopIpcChannels.projectRemove, projectId),
  removeManagedDeployment: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.managedDeploymentRemove, input),
  deleteManagedSkill: (skillId) =>
    ipcRenderer.invoke(desktopIpcChannels.managedSkillDelete, skillId),
  deleteSkillPack: (packId) =>
    ipcRenderer.invoke(desktopIpcChannels.managedSkillPackDelete, packId),
  deployManagedSkill: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.managedSkillDeploy, input),
  importManagedSkills: (skillIds, packId, folderId) =>
    ipcRenderer.invoke(
      desktopIpcChannels.managedSkillImport,
      skillIds,
      packId,
      folderId
    ),
  removeSkill: (skillId) =>
    ipcRenderer.invoke(desktopIpcChannels.skillRemove, skillId),
  runAiChat: (input) => ipcRenderer.invoke(desktopIpcChannels.aiChatRun, input),
  runAiSkillAction: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.aiSkillRun, input),
  saveAiProviderSettings: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.aiProviderSettingsSave, input),
  saveAiConversation: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.aiConversationSave, input),
  saveSkillDescription: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.aiDescriptionSave, input),
  saveSkillTranslation: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.aiTranslationSave, input),
  saveOrganization: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.organizationSave, input),
  saveSkillPack: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.managedSkillPackSave, input),
  createTerminal: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.terminalCreate, input),
  closeTerminal: (sessionId) =>
    ipcRenderer.invoke(desktopIpcChannels.terminalClose, sessionId),
  onTerminalData: (listener) => {
    const handler = (
      _event: IpcRendererEvent,
      data: Parameters<typeof listener>[0]
    ) => listener(data)
    ipcRenderer.on(desktopIpcChannels.terminalData, handler)
    return () =>
      ipcRenderer.removeListener(desktopIpcChannels.terminalData, handler)
  },
  onTerminalExit: (listener) => {
    const handler = (
      _event: IpcRendererEvent,
      data: Parameters<typeof listener>[0]
    ) => listener(data)
    ipcRenderer.on(desktopIpcChannels.terminalExit, handler)
    return () =>
      ipcRenderer.removeListener(desktopIpcChannels.terminalExit, handler)
  },
  resizeTerminal: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.terminalResize, input),
  writeTerminal: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.terminalWrite, input),
  updateSkill: (skillId) =>
    ipcRenderer.invoke(desktopIpcChannels.skillUpdate, skillId),
  updateSettings: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.settingsUpdate, input),
  verifyAiProvider: (input) =>
    ipcRenderer.invoke(desktopIpcChannels.aiProviderVerify, input),
}

if (process.argv.includes('--skill-shelf-tray')) {
  contextBridge.exposeInMainWorld('skillShelfTray', trayApi)
} else {
  contextBridge.exposeInMainWorld('skillShelf', desktopApi)
}
