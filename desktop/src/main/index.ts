import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} from 'electron'
import type { OpenDialogOptions } from 'electron'
import electronUpdater from 'electron-updater'
import {
  loadMessages,
  resolveLocalePreference,
  translate,
} from '@skill-shelf/i18n'

import type {
  AddSkillInput,
  AiChatRequest,
  AiProviderId,
  AiProviderSettingsInput,
  AiProviderVerificationInput,
  AiSkillRequest,
  CreateGroupInput,
  DeployManagedSkillInput,
  ManagedDeploymentFolderPurpose,
  ManagedSkillDeploymentTarget,
  RemoveManagedDeploymentInput,
  SaveAiConversationInput,
  SaveGroupInput,
  SaveOrganizationInput,
  SaveSkillDescriptionInput,
  SaveSkillTranslationInput,
  SaveSkillPackInput,
  TerminalCreateInput,
  TerminalResizeInput,
  TerminalWriteInput,
  UpdateDesktopSettingsInput,
  TrayAction,
} from '../shared/desktop-contract'
import {
  MAX_SKILL_DRAWER_WIDTH,
  MAX_TERMINAL_PANEL_HEIGHT,
  MAX_UTILITY_PANEL_WIDTH,
  MIN_SKILL_DRAWER_WIDTH,
  MIN_TERMINAL_PANEL_HEIGHT,
  MIN_UTILITY_PANEL_WIDTH,
  desktopIpcChannels,
} from '../shared/desktop-contract'
import { AiConversationService } from './services/ai-conversation-service'
import { AiProviderService } from './services/ai-provider-service'
import {
  AGENT_REGISTRY_SOURCE,
  getAgentInstallRegistry,
  getProjectAgentInstallTargets,
  getUniversalInstallTarget,
} from './services/agent-registry'
import { CatalogService } from './services/catalog-service'
import { DiscoveryService } from './services/discovery-service'
import { ShelfStore } from './services/shelf-store'
import { SkillsApiService } from './services/skills-api-service'
import { listSkillFiles, readSkillFile } from './services/skill-file-service'
import {
  ManagedSkillService,
  type ManagedSkillDeploymentDestination,
} from './services/managed-skill-service'
import { SkillsCliService } from './services/skills-cli-service'
import { SkillAiService } from './services/skill-ai-service'
import { TerminalService } from './services/terminal-service'
import { WorkbenchService } from './services/workbench-service'
import { TrayController } from './tray-controller'
import { AppUpdateService } from './services/app-update-service'

let mainWindow: BrowserWindow | null = null
let trayController: TrayController | null = null
let appUpdates: AppUpdateService | null = null
let updateInstallPromptOpen = false
let quitting = false
let rendererReady = false
let pendingTrayAction: TrayAction | null = null
const terminal = new TerminalService()

function showMainWindow(action?: TrayAction) {
  if (action) pendingTrayAction = action
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
  const window = mainWindow!
  if (window.isMinimized()) window.restore()
  const reveal = () => {
    if (window.isDestroyed() || quitting) return
    window.show()
    window.focus()
  }
  if (window.webContents.isLoading())
    window.webContents.once('did-finish-load', reveal)
  else reveal()
  deliverTrayAction()
}

function deliverTrayAction() {
  if (
    !rendererReady ||
    !pendingTrayAction ||
    !mainWindow ||
    mainWindow.isDestroyed()
  )
    return
  mainWindow.webContents.send(desktopIpcChannels.trayAction, pendingTrayAction)
  pendingTrayAction = null
}

function getAppIconPath() {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(import.meta.dirname, '../../build/icon.png')
}

function createMainWindow() {
  const window = new BrowserWindow({
    backgroundColor: '#f2f2f0',
    height: 800,
    icon: getAppIconPath(),
    minHeight: 640,
    minWidth: 980,
    show: false,
    title: 'Skill Shelf',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: 15 },
    width: 1260,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      webSecurity: true,
    },
  })

  window.once('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (!quitting && trayController && !trayController.isDisposed) {
      event.preventDefault()
      window.hide()
    }
  })
  window.webContents.on('did-start-loading', () => {
    rendererReady = false
  })
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = null
    rendererReady = false
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (isRendererUrl(url)) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  mainWindow = window
}

function registerIpc(
  aiConversations: AiConversationService,
  aiProvider: AiProviderService,
  aiSkills: SkillAiService,
  api: SkillsApiService,
  catalog: CatalogService,
  discovery: DiscoveryService,
  cli: SkillsCliService,
  managedSkills: ManagedSkillService,
  store: ShelfStore,
  shelfFilePath: string,
  terminalService: TerminalService,
  workbench: WorkbenchService
) {
  const updateHandler = (channel: string, action: () => unknown) =>
    ipcMain.handle(channel, (event) => {
      if (
        !mainWindow ||
        event.sender !== mainWindow.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame
      )
        throw new Error('Invalid desktop sender')
      return action()
    })
  updateHandler(desktopIpcChannels.appUpdateGet, () => appUpdates!.getState())
  updateHandler(desktopIpcChannels.appUpdateCheck, () => appUpdates!.check())
  updateHandler(desktopIpcChannels.appUpdateDownload, () =>
    appUpdates!.download()
  )
  updateHandler(desktopIpcChannels.appUpdateInstall, async () => {
    if (
      updateInstallPromptOpen ||
      appUpdates?.getState().status !== 'downloaded' ||
      !mainWindow
    )
      return
    updateInstallPromptOpen = true
    try {
      const settings = await store.getSettings()
      const messages = await loadMessages(
        resolveLocalePreference(settings.language, app.getLocale())
      )
      const answer = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        title: translate(messages, 'desktop.appUpdate.restart'),
        message: translate(messages, 'desktop.appUpdate.restartMessage'),
        detail: translate(messages, 'desktop.appUpdate.restartDetail'),
        buttons: [
          translate(messages, 'common.cancel'),
          translate(messages, 'desktop.appUpdate.restart'),
        ],
        defaultId: 0,
        cancelId: 0,
      })
      if (answer.response === 1)
        setImmediate(() => {
          if (appUpdates?.getState().status === 'downloaded')
            appUpdates.install()
        })
    } finally {
      updateInstallPromptOpen = false
    }
  })
  ipcMain.handle(desktopIpcChannels.trayReady, (event) => {
    if (
      !mainWindow ||
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      throw new Error('Invalid desktop sender')
    rendererReady = true
    deliverTrayAction()
  })
  ipcMain.handle(desktopIpcChannels.agentInstallRegistryGet, () => ({
    agents: getAgentInstallRegistry(),
    cliVersion: AGENT_REGISTRY_SOURCE.version,
    source: 'skills-cli' as const,
    universal: getUniversalInstallTarget(),
  }))
  ipcMain.handle(desktopIpcChannels.aiProviderSettingsGet, () =>
    aiProvider.getSettingsStatus()
  )
  ipcMain.handle(
    desktopIpcChannels.aiProviderSettingsSave,
    (_event, input: unknown) =>
      aiProvider.saveSettings(assertAiProviderSettingsInput(input))
  )
  ipcMain.handle(
    desktopIpcChannels.aiProviderSettingsClear,
    (_event, provider) => aiProvider.clearSettings(assertAiProviderId(provider))
  )
  ipcMain.handle(desktopIpcChannels.aiProviderVerify, (_event, input) =>
    aiProvider.verify(assertAiProviderVerificationInput(input))
  )
  ipcMain.handle(desktopIpcChannels.aiChatRun, (_event, input: unknown) =>
    aiSkills.chat(assertAiChatRequest(input))
  )
  ipcMain.handle(desktopIpcChannels.aiConversationList, () =>
    aiConversations.list()
  )
  ipcMain.handle(desktopIpcChannels.aiConversationGet, (_event, id: unknown) =>
    aiConversations.get(assertConversationId(id))
  )
  ipcMain.handle(
    desktopIpcChannels.aiConversationSave,
    (_event, input: unknown) =>
      aiConversations.save(assertSaveAiConversationInput(input))
  )
  ipcMain.handle(
    desktopIpcChannels.aiConversationDelete,
    (_event, id: unknown) => aiConversations.delete(assertConversationId(id))
  )
  ipcMain.handle(desktopIpcChannels.aiSkillRun, (_event, input: unknown) =>
    aiSkills.run(assertAiSkillRequest(input))
  )
  ipcMain.handle(
    desktopIpcChannels.aiDescriptionSave,
    async (_event, input: unknown) => {
      const description = assertSkillDescriptionInput(input)
      const skill = await catalog.findInstalledSkill(description.skillId)
      if (!skill) throw new Error('Skill is no longer installed')
      return catalog.saveSkillDescription(description)
    }
  )
  ipcMain.handle(
    desktopIpcChannels.aiTranslationSave,
    async (_event, input: unknown) => {
      const translation = assertSkillTranslationInput(input)
      const skill = await catalog.findInstalledSkill(translation.skillId)
      if (!skill) throw new Error('Skill is no longer installed')
      if (skill.description.trim() !== translation.sourceDescription.trim()) {
        throw new Error(
          'Skill description changed before translation was saved'
        )
      }
      return catalog.saveSkillTranslation(translation)
    }
  )
  ipcMain.handle(desktopIpcChannels.catalogGet, async () => {
    const result = await catalog.getCatalog()
    trayController?.updateCatalog(result)
    return result
  })
  ipcMain.handle(
    desktopIpcChannels.discoverySnapshotGet,
    (_event, section: unknown, force: unknown) => {
      if (!['home', 'official', 'topics'].includes(String(section))) {
        throw new Error('Invalid discovery section')
      }
      if (force !== undefined && typeof force !== 'boolean') {
        throw new Error('Invalid discovery refresh option')
      }
      return discovery.getSnapshot(
        section as 'home' | 'official' | 'topics',
        force ?? false
      )
    }
  )
  ipcMain.handle(
    desktopIpcChannels.discoveryOfficialCreatorGet,
    (_event, creator: unknown, force: unknown) => {
      if (typeof creator !== 'string') {
        throw new Error('Invalid discovery creator')
      }
      if (force !== undefined && typeof force !== 'boolean') {
        throw new Error('Invalid discovery refresh option')
      }
      return discovery.getOfficialCreator(creator, force ?? false)
    }
  )
  ipcMain.handle(
    desktopIpcChannels.discoveryOfficialRepositoryGet,
    (_event, creator: unknown, repository: unknown, force: unknown) => {
      if (typeof creator !== 'string' || typeof repository !== 'string') {
        throw new Error('Invalid discovery repository')
      }
      if (force !== undefined && typeof force !== 'boolean') {
        throw new Error('Invalid discovery refresh option')
      }
      return discovery.getOfficialRepository(
        creator,
        repository,
        force ?? false
      )
    }
  )
  ipcMain.handle(
    desktopIpcChannels.discoveryTopicGet,
    (_event, slug: unknown, force: unknown) => {
      if (typeof slug !== 'string') throw new Error('Invalid discovery topic')
      if (force !== undefined && typeof force !== 'boolean') {
        throw new Error('Invalid discovery refresh option')
      }
      return discovery.getTopic(slug, force ?? false)
    }
  )
  ipcMain.handle(
    desktopIpcChannels.discoverySkillInstallCommandGet,
    (_event, sourceUrl: unknown) => {
      if (typeof sourceUrl !== 'string') {
        throw new Error('Invalid skills.sh Skill URL')
      }
      return discovery.getSkillInstallCommand(sourceUrl)
    }
  )
  ipcMain.handle(
    desktopIpcChannels.catalogScanUpdates,
    async (event, requestId: unknown) => {
      if (requestId !== undefined && typeof requestId !== 'string') {
        throw new Error('Invalid update scan request')
      }
      const result = await catalog.scanSkillUpdates(
        requestId
          ? (progress) => {
              if (event.sender.isDestroyed()) return
              event.sender.send(desktopIpcChannels.catalogScanUpdatesProgress, {
                ...progress,
                requestId,
              })
            }
          : undefined
      )
      trayController?.updateCatalog(result)
      return result
    }
  )
  ipcMain.handle(
    desktopIpcChannels.catalogTrackSkills,
    (_event, skillIds: unknown) => catalog.trackSkills(assertSkillIds(skillIds))
  )
  ipcMain.handle(desktopIpcChannels.settingsGet, () => store.getSettings())
  ipcMain.handle(
    desktopIpcChannels.settingsUpdate,
    async (_event, input: unknown) => {
      const settings = await store.updateSettings(assertSettingsInput(input))
      applyLaunchAtLogin(settings.launchAtLogin)
      void trayController?.notify()
      return settings
    }
  )
  ipcMain.handle(desktopIpcChannels.runtimeGet, () => ({
    appVersion: app.getVersion(),
    arch: process.arch,
    isPackaged: app.isPackaged,
    platform: process.platform,
    shelfFilePath,
    systemLocale: app.getLocale(),
    userDataPath: app.getPath('userData'),
  }))
  ipcMain.handle(desktopIpcChannels.dataOpenFolder, async () => {
    const error = await shell.openPath(app.getPath('userData'))
    if (error) throw new Error(error)
  })
  ipcMain.handle(desktopIpcChannels.groupCreate, (_event, input: unknown) =>
    catalog.createGroup(assertCreateGroupInput(input))
  )
  ipcMain.handle(desktopIpcChannels.groupSave, (_event, input: unknown) =>
    catalog.saveGroup(assertSaveGroupInput(input))
  )
  ipcMain.handle(desktopIpcChannels.projectAdd, async () => {
    const options: OpenDialogOptions = {
      properties: ['openDirectory'],
      title: 'Add project to Skill Shelf',
    }
    const selection = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    const projectPath = selection.filePaths[0]
    if (selection.canceled || !projectPath) return null
    const result = await catalog.addProject(projectPath)
    trayController?.updateCatalog(result)
    return result
  })
  ipcMain.handle(
    desktopIpcChannels.managedDeploymentFolderSelect,
    async (_event, value: unknown) => {
      const purpose = assertManagedDeploymentFolderPurpose(value)
      const chinese = app.getLocale().toLowerCase().startsWith('zh')
      const options: OpenDialogOptions = {
        properties: ['openDirectory', 'createDirectory'],
        title:
          purpose === 'project-root'
            ? chinese
              ? '选择项目根目录'
              : 'Choose a project root'
            : chinese
              ? '选择 Skill 的父目录'
              : 'Choose a parent folder for the Skill',
      }
      const selection = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      const directoryPath = selection.filePaths[0]
      if (selection.canceled || !directoryPath) return null
      return {
        name: basename(directoryPath) || directoryPath,
        path: resolve(directoryPath),
      }
    }
  )
  ipcMain.handle(
    desktopIpcChannels.projectRemove,
    async (_event, projectId: unknown) => {
      await store.removeProject(assertIdentifier(projectId, 'project'))
      const result = await catalog.getCatalog()
      trayController?.updateCatalog(result)
      return result
    }
  )
  ipcMain.handle(
    desktopIpcChannels.organizationSave,
    (_event, input: unknown) =>
      catalog.saveOrganization(assertOrganizationInput(input))
  )
  ipcMain.handle(
    desktopIpcChannels.skillAdd,
    async (_event, input: unknown) => {
      const installInput = assertAddSkillInput(input)
      const installedBefore = await catalog.captureInstalledSkillIds()
      if (installInput.target.scope === 'global') {
        const result = await cli.add(installInput)
        if (result.success) await catalog.trackSkillsAddedSince(installedBefore)
        return result
      }
      const projectId = installInput.target.projectId
      const snapshot = await catalog.getCatalog()
      const project = snapshot.projects.find(
        (candidate) => candidate.id === projectId
      )
      if (!project) throw new Error('Project is no longer available')
      const result = await cli.add(installInput, project.path)
      if (result.success) await catalog.trackSkillsAddedSince(installedBefore)
      return result
    }
  )
  ipcMain.handle(
    desktopIpcChannels.skillRemove,
    async (_event, skillId: unknown) => {
      const skill = await catalog.findInstalledSkill(
        assertIdentifier(skillId, 'skill')
      )
      if (!skill) throw new Error('Skill is no longer installed')
      const projectPath = skill.projectId
        ? (await catalog.findProject(skill.projectId))?.path
        : undefined
      if (skill.scope === 'project' && !projectPath) {
        throw new Error('Project is no longer available')
      }
      const result = await cli.remove(skill.name, skill.scope, projectPath)
      if (result.success) await catalog.untrackSkill(skill.id)
      return result
    }
  )
  ipcMain.handle(
    desktopIpcChannels.skillUpdate,
    async (_event, skillId: unknown) => {
      const skill = await catalog.findInstalledSkill(
        assertIdentifier(skillId, 'skill')
      )
      if (!skill) throw new Error('Skill is no longer installed')
      const projectPath = skill.projectId
        ? (await catalog.findProject(skill.projectId))?.path
        : undefined
      if (skill.scope === 'project' && !projectPath) {
        throw new Error('Project is no longer available')
      }
      const result = await cli.update(skill.name, skill.scope, projectPath)
      if (result.success) await catalog.markSkillUpdated(skill.id)
      return result
    }
  )
  ipcMain.handle(
    desktopIpcChannels.marketplaceAuditGet,
    (_event, source: unknown, skillName: unknown) => {
      if (typeof source !== 'string' || typeof skillName !== 'string') {
        throw new Error('Invalid skills.sh audit identifier')
      }
      return api.getAudit(source, skillName)
    }
  )
  ipcMain.handle(
    desktopIpcChannels.marketplaceSearch,
    (_event, query: unknown) => {
      if (typeof query !== 'string') throw new Error('Invalid search query')
      return cli.search(query)
    }
  )
  ipcMain.handle(desktopIpcChannels.managedSkillsGet, () =>
    managedSkills.snapshot()
  )
  ipcMain.handle(desktopIpcChannels.managedSkillImportCandidates, () =>
    catalog.getInstalledSkillsForImport()
  )
  ipcMain.handle(
    desktopIpcChannels.managedSkillOpenFolder,
    async (_event, skillId: unknown) => {
      const path = await managedSkills.getSkillPath(
        assertIdentifier(skillId, 'skill')
      )
      const error = await shell.openPath(path)
      if (error) throw new Error(error)
    }
  )
  ipcMain.handle(
    desktopIpcChannels.managedDeploymentOpenFolder,
    async (_event, value: unknown) => {
      const input = assertRemoveManagedDeploymentInput(value)
      const skill = managedSkills
        .snapshot()
        .skills.find((item) => item.id === input.skillId)
      const deployment = skill?.deployments.find(
        (item) => item.id === input.deploymentId
      )
      if (!deployment) throw new Error('Deployment is no longer available')
      shell.showItemInFolder(deployment.targetPath)
    }
  )
  ipcMain.handle(
    desktopIpcChannels.managedSkillImport,
    async (_event, skillIds: unknown) => {
      const ids = assertSkillIds(skillIds)
      const installed = await catalog.getInstalledSkillsForImport()
      const skills = ids.map((skillId) => {
        const skill = installed.find((candidate) => candidate.id === skillId)
        if (!skill)
          throw new Error('One or more Skills are no longer installed')
        return {
          description: skill.description,
          name: skill.name,
          path: skill.path,
          scope: skill.scope,
          skillId: skill.id,
        }
      })
      return managedSkills.importSkills(skills)
    }
  )
  ipcMain.handle(
    desktopIpcChannels.managedSkillDelete,
    (_event, skillId: unknown) =>
      managedSkills.deleteSkill(assertIdentifier(skillId, 'skill'))
  )
  ipcMain.handle(
    desktopIpcChannels.managedSkillPackSave,
    (_event, input: unknown) =>
      managedSkills.savePack(assertSaveSkillPackInput(input))
  )
  ipcMain.handle(
    desktopIpcChannels.managedSkillPackDelete,
    (_event, packId: unknown) =>
      managedSkills.deletePack(assertIdentifier(packId, 'skill'))
  )
  ipcMain.handle(
    desktopIpcChannels.managedSkillDeploy,
    async (_event, value: unknown) => {
      const input = assertDeployManagedSkillInput(value)
      const destinations = await resolveManagedSkillDestinations(input, catalog)
      const installedBefore =
        input.target.kind === 'custom'
          ? null
          : await catalog.captureInstalledSkillIds()
      const snapshot = await managedSkills.deploy(input, destinations)
      if (installedBefore) {
        await catalog.trackSkillsAddedSince(installedBefore)
      }
      return snapshot
    }
  )
  ipcMain.handle(
    desktopIpcChannels.managedDeploymentRemove,
    async (_event, value: unknown) => {
      const input = assertRemoveManagedDeploymentInput(value)
      const skill = managedSkills
        .snapshot()
        .skills.find((item) => item.id === input.skillId)
      const deployment = skill?.deployments.find(
        (item) => item.id === input.deploymentId
      )
      if (!deployment) throw new Error('Deployment is no longer available')
      return managedSkills.removeDeployment(input)
    }
  )
  ipcMain.handle(
    desktopIpcChannels.skillFilesGet,
    async (_event, skillId: unknown) => {
      const id = assertIdentifier(skillId, 'skill')
      const installed = await catalog.findInstalledSkill(id)
      const skillPath =
        installed?.path ?? (await managedSkills.getSkillPath(id))
      return listSkillFiles(skillPath)
    }
  )
  ipcMain.handle(
    desktopIpcChannels.skillFileRead,
    async (_event, skillId: unknown, relativePath: unknown) => {
      const id = assertIdentifier(skillId, 'skill')
      const installed = await catalog.findInstalledSkill(id)
      const skillPath =
        installed?.path ?? (await managedSkills.getSkillPath(id))
      return readSkillFile(skillPath, assertRelativeFilePath(relativePath))
    }
  )
  ipcMain.handle(
    desktopIpcChannels.skillOpenFolder,
    async (_event, skillId: unknown) => {
      const skill = await catalog.findInstalledSkill(
        assertIdentifier(skillId, 'skill')
      )
      if (!skill) throw new Error('Skill is no longer installed')
      const error = await shell.openPath(skill.path)
      if (error) throw new Error(error)
    }
  )
  ipcMain.handle(
    desktopIpcChannels.skillOpenSource,
    async (_event, skillId: unknown) => {
      const skill = await catalog.findInstalledSkill(
        assertIdentifier(skillId, 'skill')
      )
      if (!skill?.sourceUrl || !isSafeExternalUrl(skill.sourceUrl)) {
        throw new Error('This skill does not have a source URL')
      }
      await shell.openExternal(skill.sourceUrl)
    }
  )
  ipcMain.handle(desktopIpcChannels.websiteOpen, () =>
    shell.openExternal('https://skills.sh')
  )
  ipcMain.handle(
    desktopIpcChannels.websiteOpenDiscovery,
    (_event, url: unknown) => {
      if (typeof url !== 'string' || !isAllowedDiscoveryUrl(url)) {
        throw new Error('This address is outside skills.sh')
      }
      return shell.openExternal(url)
    }
  )
  ipcMain.handle(desktopIpcChannels.workbenchGet, async () => {
    const result = await workbench.getSnapshot()
    trayController?.updateWorkbench(result)
    return result
  })
  ipcMain.handle(
    desktopIpcChannels.terminalCreate,
    async (event, input: unknown) => {
      const request = assertTerminalCreateInput(input)
      const project = request.projectId
        ? await catalog.findProject(request.projectId)
        : null
      if (request.projectId && !project) throw new Error('Project not found')
      return terminalService.create(
        event.sender,
        request,
        project?.path ?? app.getPath('home')
      )
    }
  )
  ipcMain.handle(desktopIpcChannels.terminalWrite, (event, input: unknown) => {
    const request = assertTerminalWriteInput(input)
    terminalService.write(event.sender.id, request.sessionId, request.data)
  })
  ipcMain.handle(desktopIpcChannels.terminalResize, (event, input: unknown) => {
    const request = assertTerminalResizeInput(input)
    terminalService.resize(
      event.sender.id,
      request.sessionId,
      request.cols,
      request.rows
    )
  })
  ipcMain.handle(
    desktopIpcChannels.terminalClose,
    (event, sessionId: unknown) =>
      terminalService.close(event.sender.id, assertTerminalSessionId(sessionId))
  )
}

function assertAddSkillInput(value: unknown): AddSkillInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const input = value as Partial<AddSkillInput>
  if (
    typeof input.source !== 'string' ||
    !Array.isArray(input.agents) ||
    !input.target ||
    typeof input.target !== 'object'
  ) {
    throw new Error('Invalid input')
  }
  if (!input.agents.every((agent) => typeof agent === 'string')) {
    throw new Error('Invalid agents')
  }
  const target = input.target as Partial<AddSkillInput['target']> & {
    projectId?: unknown
  }
  if (
    target.scope !== 'global' &&
    !(
      target.scope === 'project' &&
      typeof target.projectId === 'string' &&
      target.projectId
    )
  ) {
    throw new Error('Invalid install target')
  }
  return {
    agents: input.agents,
    source: input.source,
    target:
      target.scope === 'global'
        ? { scope: 'global' }
        : { projectId: target.projectId as string, scope: 'project' },
  }
}

function assertAiChatRequest(value: unknown): AiChatRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const input = value as Partial<AiChatRequest>
  if (
    typeof input.prompt !== 'string' ||
    typeof input.language !== 'string' ||
    (input.model !== undefined && !isAiModelSelection(input.model)) ||
    (input.skillId !== undefined && typeof input.skillId !== 'string') ||
    !Array.isArray(input.history) ||
    input.history.length > 20 ||
    !input.history.every(
      (message) =>
        message &&
        (message.role === 'assistant' || message.role === 'user') &&
        typeof message.content === 'string'
    )
  ) {
    throw new Error('Invalid AI chat request')
  }
  return input as AiChatRequest
}

function assertSaveAiConversationInput(
  value: unknown
): SaveAiConversationInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const input = value as Partial<SaveAiConversationInput>
  if (
    typeof input.id !== 'string' ||
    !Array.isArray(input.messages) ||
    (input.skillId !== undefined && typeof input.skillId !== 'string') ||
    (input.skillName !== undefined && typeof input.skillName !== 'string')
  ) {
    throw new Error('Invalid AI conversation')
  }
  return input as SaveAiConversationInput
}

function assertSaveSkillPackInput(value: unknown): SaveSkillPackInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const input = value as Partial<SaveSkillPackInput>
  if (
    typeof input.name !== 'string' ||
    typeof input.description !== 'string' ||
    (input.id !== undefined && typeof input.id !== 'string') ||
    !Array.isArray(input.skillIds) ||
    !input.skillIds.every((id) => typeof id === 'string')
  ) {
    throw new Error('Invalid Pack')
  }
  return input as SaveSkillPackInput
}

function assertDeployManagedSkillInput(
  value: unknown
): DeployManagedSkillInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const input = value as Partial<DeployManagedSkillInput>
  const target = input.target as
    Partial<ManagedSkillDeploymentTarget> | undefined
  if (
    typeof input.skillId !== 'string' ||
    !target ||
    (input.mode !== 'copy' && input.mode !== 'symlink')
  ) {
    throw new Error('Invalid managed Skill deployment')
  }
  if (
    target.kind === 'global' ||
    (target.kind === 'project' &&
      typeof target.projectId === 'string' &&
      isAgentIdList(target.agentIds)) ||
    (target.kind === 'project-directory' &&
      typeof target.directoryPath === 'string' &&
      target.directoryPath.length <= 4096 &&
      isAbsolute(target.directoryPath) &&
      isAgentIdList(target.agentIds)) ||
    (target.kind === 'custom' &&
      typeof target.directoryPath === 'string' &&
      target.directoryPath.length <= 4096 &&
      isAbsolute(target.directoryPath))
  ) {
    return input as DeployManagedSkillInput
  }
  throw new Error('Invalid managed Skill deployment target')
}

async function resolveManagedSkillDestinations(
  input: DeployManagedSkillInput,
  catalog: CatalogService
): Promise<ManagedSkillDeploymentDestination[]> {
  if (input.target.kind === 'global') {
    return [
      {
        directoryPath: join(homedir(), '.agents', 'skills'),
        kind: 'global',
        name: 'Global',
      },
    ]
  }
  if (input.target.kind === 'custom') {
    const directoryPath = resolve(input.target.directoryPath)
    return [
      {
        directoryPath,
        kind: 'custom',
        name: basename(directoryPath) || directoryPath,
      },
    ]
  }

  if (input.target.kind === 'project-directory') {
    const rootPath = resolve(input.target.directoryPath)
    return resolveProjectDeploymentDestinations({
      agentIds: input.target.agentIds,
      kind: 'project-directory',
      name: basename(rootPath) || rootPath,
      rootPath,
    })
  }

  const project = await catalog.findProject(input.target.projectId)
  if (!project) throw new Error('Project is no longer available')
  return resolveProjectDeploymentDestinations({
    agentIds: input.target.agentIds,
    kind: 'project',
    name: project.name,
    projectId: project.id,
    rootPath: project.path,
  })
}

function resolveProjectDeploymentDestinations({
  agentIds,
  kind,
  name,
  projectId,
  rootPath,
}: {
  agentIds: string[]
  kind: 'project' | 'project-directory'
  name: string
  projectId?: string
  rootPath: string
}): ManagedSkillDeploymentDestination[] {
  return getProjectAgentInstallTargets(agentIds).map((target) => ({
    ...target,
    kind,
    name,
    ...(kind === 'project' && projectId ? { projectId } : {}),
    rootPath,
  }))
}

function isAgentIdList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every((id) => typeof id === 'string' && id.length <= 128)
  )
}

function assertManagedDeploymentFolderPurpose(
  value: unknown
): ManagedDeploymentFolderPurpose {
  if (value === 'project-root' || value === 'skill-parent') return value
  throw new Error('Invalid managed deployment folder purpose')
}

function assertRemoveManagedDeploymentInput(
  value: unknown
): RemoveManagedDeploymentInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const input = value as Partial<RemoveManagedDeploymentInput>
  if (
    typeof input.skillId !== 'string' ||
    typeof input.deploymentId !== 'string'
  ) {
    throw new Error('Invalid managed Skill deployment')
  }
  return input as RemoveManagedDeploymentInput
}

function assertConversationId(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Invalid AI conversation identifier')
  }
  return value
}

function isAiModelSelection(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const selection = value as Record<string, unknown>
  return (
    typeof selection.model === 'string' && selection.provider === 'deepseek'
  )
}

function assertAiProviderSettingsInput(
  value: unknown
): AiProviderSettingsInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const input = value as Partial<AiProviderSettingsInput>
  if (
    input.provider !== 'deepseek' ||
    typeof input.model !== 'string' ||
    (input.enabled !== undefined && typeof input.enabled !== 'boolean') ||
    (input.contextMode !== undefined &&
      !['relevant-text', 'skill-md'].includes(String(input.contextMode))) ||
    (input.targetLanguage !== undefined &&
      typeof input.targetLanguage !== 'string') ||
    (input.apiKey !== undefined && typeof input.apiKey !== 'string') ||
    (input.availableModels !== undefined &&
      (!Array.isArray(input.availableModels) ||
        !input.availableModels.every(
          (model) =>
            model &&
            typeof model.id === 'string' &&
            typeof model.displayName === 'string'
        ))) ||
    (input.models !== undefined && !isAiModelRoleSettings(input.models))
  ) {
    throw new Error('Invalid AI provider settings')
  }
  return input as AiProviderSettingsInput
}

function assertAiProviderId(value: unknown): AiProviderId {
  if (value !== 'deepseek') {
    throw new Error('Invalid AI provider')
  }
  return value
}

function assertAiProviderVerificationInput(
  value: unknown
): AiProviderVerificationInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const input = value as Partial<AiProviderVerificationInput>
  if (typeof input.modelId !== 'string') {
    throw new Error('Invalid AI provider verification')
  }
  return {
    modelId: input.modelId,
    provider: assertAiProviderId(input.provider),
  }
}

function isAiModelRoleSettings(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const models = value as Record<string, unknown>
  return ['analysis', 'chat', 'writing'].every((role) => {
    const selection = models[role]
    return isAiModelSelection(selection)
  })
}

function assertAiSkillRequest(value: unknown): AiSkillRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const input = value as Partial<AiSkillRequest>
  if (
    !['analyze', 'ask', 'summarize', 'translate'].includes(
      String(input.action)
    ) ||
    typeof input.skillId !== 'string' ||
    (input.language !== undefined && typeof input.language !== 'string') ||
    (input.prompt !== undefined && typeof input.prompt !== 'string') ||
    (input.sourceText !== undefined && typeof input.sourceText !== 'string')
  ) {
    throw new Error('Invalid AI skill request')
  }
  return input as AiSkillRequest
}

function assertSkillDescriptionInput(
  value: unknown
): SaveSkillDescriptionInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const input = value as Partial<SaveSkillDescriptionInput>
  if (
    typeof input.skillId !== 'string' ||
    typeof input.language !== 'string' ||
    typeof input.description !== 'string'
  ) {
    throw new Error('Invalid skill description')
  }
  return input as SaveSkillDescriptionInput
}

function assertSkillTranslationInput(
  value: unknown
): SaveSkillTranslationInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const input = value as Partial<SaveSkillTranslationInput>
  if (
    typeof input.skillId !== 'string' ||
    typeof input.language !== 'string' ||
    typeof input.content !== 'string' ||
    !['ai', 'source-copy'].includes(String(input.method)) ||
    typeof input.sourceDescription !== 'string'
  ) {
    throw new Error('Invalid skill translation')
  }
  return input as SaveSkillTranslationInput
}

function assertCreateGroupInput(value: unknown): CreateGroupInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const input = value as Partial<CreateGroupInput>
  if (
    typeof input.name !== 'string' ||
    typeof input.color !== 'string' ||
    !(typeof input.parentId === 'string' || input.parentId === null) ||
    !isShelfScopeKey(input.scopeKey) ||
    !isCanvasPosition(input.position)
  ) {
    throw new Error('Invalid input')
  }
  return {
    color: input.color,
    name: input.name,
    parentId: input.parentId,
    position: input.position,
    scopeKey: input.scopeKey,
  }
}

function assertSaveGroupInput(value: unknown): SaveGroupInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const input = value as Partial<SaveGroupInput>
  if (
    typeof input.folderId !== 'string' ||
    (input.name !== undefined && typeof input.name !== 'string') ||
    (input.parentId !== undefined &&
      !(typeof input.parentId === 'string' || input.parentId === null)) ||
    (input.position !== undefined && !isCanvasPosition(input.position))
  ) {
    throw new Error('Invalid folder update')
  }
  return input as SaveGroupInput
}

function assertOrganizationInput(value: unknown): SaveOrganizationInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const input = value as Partial<SaveOrganizationInput>
  if (
    typeof input.skillId !== 'string' ||
    !Array.isArray(input.tags) ||
    !input.tags.every((tag) => typeof tag === 'string') ||
    !(typeof input.groupId === 'string' || input.groupId === null) ||
    (input.position !== undefined &&
      input.position !== null &&
      !isCanvasPosition(input.position))
  ) {
    throw new Error('Invalid input')
  }
  return {
    groupId: input.groupId,
    ...(input.position !== undefined ? { position: input.position } : {}),
    skillId: input.skillId,
    tags: input.tags,
  }
}

function assertSkillIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 500 ||
    !value.every(
      (skillId) =>
        typeof skillId === 'string' &&
        skillId.length > 0 &&
        skillId.length <= 512
    )
  ) {
    throw new Error('Invalid Skill identifiers')
  }
  return Array.from(new Set(value))
}

function isCanvasPosition(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') return false
  const position = value as { x?: unknown; y?: unknown }
  return (
    typeof position.x === 'number' &&
    Number.isFinite(position.x) &&
    typeof position.y === 'number' &&
    Number.isFinite(position.y)
  )
}

function isShelfScopeKey(
  value: unknown
): value is CreateGroupInput['scopeKey'] {
  return (
    value === 'global' ||
    (typeof value === 'string' && value.startsWith('project:'))
  )
}

function assertIdentifier(value: unknown, kind: 'project' | 'skill'): string {
  if (typeof value !== 'string' || !value || value.length > 512) {
    throw new Error(`Invalid ${kind} identifier`)
  }
  return value
}

function assertRelativeFilePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\0')) {
    throw new Error('Invalid skill file path')
  }
  return value
}

function assertTerminalCreateInput(value: unknown): TerminalCreateInput {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid terminal request')
  }
  const input = value as Partial<TerminalCreateInput>
  const sessionId = assertTerminalSessionId(input.sessionId)
  const { cols, rows } = assertTerminalSize(input.cols, input.rows)
  if (
    input.projectId !== undefined &&
    (typeof input.projectId !== 'string' || input.projectId.length > 512)
  ) {
    throw new Error('Invalid terminal project')
  }
  return {
    cols,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    rows,
    sessionId,
  }
}

function assertTerminalWriteInput(value: unknown): TerminalWriteInput {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid terminal input')
  }
  const input = value as Partial<TerminalWriteInput>
  if (typeof input.data !== 'string' || input.data.length > 131_072) {
    throw new Error('Invalid terminal input')
  }
  return {
    data: input.data,
    sessionId: assertTerminalSessionId(input.sessionId),
  }
}

function assertTerminalResizeInput(value: unknown): TerminalResizeInput {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid terminal size')
  }
  const input = value as Partial<TerminalResizeInput>
  const { cols, rows } = assertTerminalSize(input.cols, input.rows)
  return {
    cols,
    rows,
    sessionId: assertTerminalSessionId(input.sessionId),
  }
}

function assertTerminalSessionId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > 80 ||
    !/^[a-zA-Z0-9-]+$/.test(value)
  ) {
    throw new Error('Invalid terminal session')
  }
  return value
}

function assertTerminalSize(cols: unknown, rows: unknown) {
  if (
    typeof cols !== 'number' ||
    !Number.isInteger(cols) ||
    cols < 2 ||
    cols > 500 ||
    typeof rows !== 'number' ||
    !Number.isInteger(rows) ||
    rows < 1 ||
    rows > 300
  ) {
    throw new Error('Invalid terminal size')
  }
  return { cols, rows }
}

function assertSettingsInput(value: unknown): UpdateDesktopSettingsInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const input = value as UpdateDesktopSettingsInput
  const result: UpdateDesktopSettingsInput = {}

  if (input.theme !== undefined) {
    if (!['dark', 'light', 'system'].includes(input.theme)) {
      throw new Error('Invalid theme')
    }
    result.theme = input.theme
  }
  if (input.density !== undefined) {
    if (!['comfortable', 'compact'].includes(input.density)) {
      throw new Error('Invalid density')
    }
    result.density = input.density
  }
  if (input.language !== undefined) {
    if (!['en', 'system', 'zh-CN'].includes(input.language)) {
      throw new Error('Invalid language')
    }
    result.language = input.language
  }
  if (input.libraryViewMode !== undefined) {
    if (!['canvas', 'columns', 'list'].includes(input.libraryViewMode)) {
      throw new Error('Invalid library view mode')
    }
    result.libraryViewMode = input.libraryViewMode
  }
  if (input.finderViewOptions !== undefined) {
    if (
      !input.finderViewOptions ||
      typeof input.finderViewOptions !== 'object' ||
      Array.isArray(input.finderViewOptions) ||
      Object.keys(input.finderViewOptions).length > 512 ||
      !Object.entries(input.finderViewOptions).every(
        ([location, options]) =>
          location.length > 0 &&
          location.length <= 512 &&
          options &&
          typeof options === 'object' &&
          typeof options.alignToGrid === 'boolean' &&
          typeof options.useGroups === 'boolean' &&
          ['canvas', 'columns', 'list'].includes(options.viewMode) &&
          ['kind', 'name', 'source', 'tags', 'update-status'].includes(
            options.groupBy
          ) &&
          ['kind', 'name', 'none', 'source', 'tags', 'update-status'].includes(
            options.sortBy
          ) &&
          ['ascending', 'descending'].includes(options.sortDirection)
      )
    ) {
      throw new Error('Invalid Finder view settings')
    }
    result.finderViewOptions = structuredClone(input.finderViewOptions)
  }
  if (input.launchAtLogin !== undefined) {
    if (typeof input.launchAtLogin !== 'boolean') {
      throw new Error('Invalid launch setting')
    }
    result.launchAtLogin = input.launchAtLogin
  }
  if (input.sidebarCollapsed !== undefined) {
    if (typeof input.sidebarCollapsed !== 'boolean') {
      throw new Error('Invalid sidebar setting')
    }
    result.sidebarCollapsed = input.sidebarCollapsed
  }
  if (input.skillDrawerWidth !== undefined) {
    if (
      typeof input.skillDrawerWidth !== 'number' ||
      !Number.isFinite(input.skillDrawerWidth) ||
      input.skillDrawerWidth < MIN_SKILL_DRAWER_WIDTH ||
      input.skillDrawerWidth > MAX_SKILL_DRAWER_WIDTH
    ) {
      throw new Error('Invalid skill drawer width')
    }
    result.skillDrawerWidth = Math.round(input.skillDrawerWidth)
  }
  if (input.utilityPanelWidth !== undefined) {
    if (
      typeof input.utilityPanelWidth !== 'number' ||
      !Number.isFinite(input.utilityPanelWidth) ||
      input.utilityPanelWidth < MIN_UTILITY_PANEL_WIDTH ||
      input.utilityPanelWidth > MAX_UTILITY_PANEL_WIDTH
    ) {
      throw new Error('Invalid utility panel width')
    }
    result.utilityPanelWidth = Math.round(input.utilityPanelWidth)
  }
  if (input.terminalPanelHeight !== undefined) {
    if (
      typeof input.terminalPanelHeight !== 'number' ||
      !Number.isFinite(input.terminalPanelHeight) ||
      input.terminalPanelHeight < MIN_TERMINAL_PANEL_HEIGHT ||
      input.terminalPanelHeight > MAX_TERMINAL_PANEL_HEIGHT
    ) {
      throw new Error('Invalid terminal panel height')
    }
    result.terminalPanelHeight = Math.round(input.terminalPanelHeight)
  }
  if (input.defaultAgents !== undefined) {
    if (
      !Array.isArray(input.defaultAgents) ||
      input.defaultAgents.length === 0 ||
      !input.defaultAgents.every((agent) => typeof agent === 'string')
    ) {
      throw new Error('Invalid default agents')
    }
    result.defaultAgents = input.defaultAgents
  }
  if (input.focusedAgents !== undefined) {
    if (
      !Array.isArray(input.focusedAgents) ||
      input.focusedAgents.length > 12 ||
      !input.focusedAgents.every(
        (agent) =>
          typeof agent === 'string' &&
          agent.trim().length > 0 &&
          agent.length <= 80
      )
    ) {
      throw new Error('Invalid focused agents')
    }
    result.focusedAgents = Array.from(
      new Set(input.focusedAgents.map((agent) => agent.trim()))
    )
  }
  return result
}

function applyLaunchAtLogin(enabled: boolean) {
  if (!app.isPackaged) return
  if (app.getLoginItemSettings().openAtLogin === enabled) return
  app.setLoginItemSettings({ openAtLogin: enabled })
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
  } catch {
    return false
  }
}

function isAllowedDiscoveryUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'skills.sh' || url.hostname === 'www.skills.sh')
    )
  } catch {
    return false
  }
}

function isRendererUrl(value: string): boolean {
  if (process.env.ELECTRON_RENDERER_URL) {
    return value.startsWith(process.env.ELECTRON_RENDERER_URL)
  }
  return value.startsWith('file:')
}

app.setName('Skill Shelf')

const instanceLock = app.requestSingleInstanceLock()
if (!instanceLock) app.quit()
app.on('second-instance', () => trayController && showMainWindow())

if (instanceLock)
  app.whenReady().then(async () => {
    if (process.platform === 'darwin' && !app.isPackaged) {
      app.dock?.setIcon(getAppIconPath())
    }

    const cli = new SkillsCliService()
    const shelfFilePath = join(app.getPath('userData'), 'shelf.json')
    const aiProvider = new AiProviderService({
      encryptionStorage: {
        decryptString: (value) => safeStorage.decryptString(value),
        encryptString: (value) => safeStorage.encryptString(value),
        isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      },
      settingsPath: join(app.getPath('userData'), 'ai-provider.json'),
    })
    await aiProvider.initialize()
    const aiConversations = new AiConversationService(
      join(app.getPath('userData'), 'ai-conversations.json'),
      {
        decryptString: (value) => safeStorage.decryptString(value),
        encryptString: (value) => safeStorage.encryptString(value),
        isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      }
    )
    await aiConversations.initialize()
    const store = new ShelfStore(shelfFilePath)
    const settings = await store.getSettings()
    applyLaunchAtLogin(settings.launchAtLogin)
    const catalog = new CatalogService(cli, store)
    const discovery = new DiscoveryService(
      join(app.getPath('userData'), 'discovery-cache.json')
    )
    const managedSkills = new ManagedSkillService(
      join(app.getPath('userData'), 'managed-skills'),
      join(app.getPath('userData'), 'managed-skills.json')
    )
    await managedSkills.initialize()
    const workbench = new WorkbenchService(catalog)
    appUpdates = new AppUpdateService(
      electronUpdater.autoUpdater,
      (state) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send(
            desktopIpcChannels.appUpdateChanged,
            state
          )
      },
      {
        arch: process.arch,
        ...(process.platform === 'darwin'
          ? {
              openDownloadPage: () =>
                shell.openExternal(
                  'https://github.com/voidrinz/skill-shelf-releases/releases/latest'
                ),
            }
          : {}),
        disabledReason: !app.isPackaged
          ? 'development'
          : !existsSync(join(process.resourcesPath, 'app-update.yml'))
            ? 'unconfigured'
            : !['darwin', 'win32', 'linux'].includes(process.platform) ||
                !['arm64', 'x64'].includes(process.arch) ||
                (process.platform === 'linux' && !process.env.APPIMAGE)
              ? 'unsupported-install'
              : undefined,
      }
    )
    registerIpc(
      aiConversations,
      aiProvider,
      new SkillAiService(catalog, aiProvider),
      new SkillsApiService(),
      catalog,
      discovery,
      cli,
      managedSkills,
      store,
      shelfFilePath,
      terminal,
      workbench
    )
    trayController = new TrayController({
      getSettings: () => store.getSettings(),
      scanEnvironment: () => workbench.getSnapshot(),
      onScan: (result) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send(
            desktopIpcChannels.workbenchChanged,
            result
          )
      },
      openMain: showMainWindow,
    })
    createMainWindow()
    appUpdates.start()

    app.on('activate', () => {
      if (!trayController?.isPanelOpen) showMainWindow()
    })
  })

app.on('window-all-closed', () => {
  if (!trayController && process.platform !== 'darwin') app.quit()
})

function prepareForQuit() {
  quitting = true
  terminal.closeAll()
  trayController?.destroy()
  trayController = null
}

app.on('before-quit', () => {
  prepareForQuit()
  appUpdates?.dispose()
})

// The updater emits this before closing windows, including on macOS.
// Keep the tray intact if installation fails before the app actually quits.
autoUpdater.on('before-quit-for-update', prepareForQuit)
