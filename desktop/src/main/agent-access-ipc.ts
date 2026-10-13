import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { desktopIpcChannels } from '../shared/desktop-contract'
import type { PreviewAgentAccessInput } from '../shared/agent-access-contract'
import type { AgentAccessService } from './services/agent-access-service'

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256)
    throw new Error('Invalid Agent access input')
  return value
}

function previewInput(value: unknown): PreviewAgentAccessInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid Agent access input')
  const input = value as Partial<PreviewAgentAccessInput>
  if (
    !Array.isArray(input.skillNames) ||
    !input.skillNames.length ||
    input.skillNames.length > 500 ||
    !['connect', 'update', 'repair', 'disconnect'].includes(
      input.action ?? ''
    ) ||
    !['copy', 'symlink'].includes(input.mode ?? '')
  )
    throw new Error('Invalid Agent access input')
  return {
    agentId: identifier(input.agentId),
    skillNames: input.skillNames.map(identifier),
    action: input.action!,
    mode: input.mode!,
  }
}

export function registerAgentAccessIpc({
  ipc,
  service,
  getMainWindow,
  openPath,
  onChanged,
}: {
  ipc: Pick<IpcMain, 'handle'>
  service: Pick<
    AgentAccessService,
    'getSnapshot' | 'preview' | 'apply' | 'discard' | 'getFolderPath'
  >
  getMainWindow: () => BrowserWindow | null
  openPath: (path: string) => Promise<string>
  onChanged: () => Promise<void>
}) {
  const handle =
    (action: (input: unknown) => Promise<unknown>) =>
    async (event: IpcMainInvokeEvent, input: unknown) => {
      const window = getMainWindow()
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error('Invalid desktop sender')
      return action(input)
    }

  ipc.handle(
    desktopIpcChannels.agentAccessGet,
    handle((input) => service.getSnapshot(identifier(input)))
  )
  ipc.handle(
    desktopIpcChannels.agentAccessPreview,
    handle((input) => service.preview(previewInput(input)))
  )
  ipc.handle(
    desktopIpcChannels.agentAccessApply,
    handle(async (input) => {
      const snapshot = await service.apply(identifier(input))
      // A catalog scan failure does not undo an already committed file operation.
      try {
        await onChanged()
      } catch (error) {
        console.warn(
          'Could not refresh Agent coverage after access change',
          error
        )
      }
      return snapshot
    })
  )
  ipc.handle(
    desktopIpcChannels.agentAccessDiscard,
    handle((input) => service.discard(identifier(input)))
  )
  ipc.handle(
    desktopIpcChannels.agentAccessOpenFolder,
    handle(async (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid Agent access input')
      const input = value as Record<string, unknown>
      if (input.location !== 'source' && input.location !== 'target')
        throw new Error('Invalid Agent access input')
      const path = await service.getFolderPath({
        agentId: identifier(input.agentId),
        skillName: identifier(input.skillName),
        location: input.location,
      })
      const error = await openPath(path)
      if (error) throw new Error(error)
    })
  )
}
