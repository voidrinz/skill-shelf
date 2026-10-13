import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { expect, it, vi } from 'vitest'
import { desktopIpcChannels } from '../shared/desktop-contract'
import type { AgentAccessService } from './services/agent-access-service'
import { registerAgentAccessIpc } from './agent-access-ipc'

function setup() {
  const handlers = new Map<
    string,
    (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>
  >()
  const contents = { mainFrame: {} }
  const window = { webContents: contents } as unknown as BrowserWindow
  const event = {
    sender: contents,
    senderFrame: contents.mainFrame,
  } as unknown as IpcMainInvokeEvent
  const service = {
    getSnapshot: vi.fn().mockResolvedValue({ agentId: 'claude-code' }),
    preview: vi.fn().mockResolvedValue({ id: 'preview' }),
    apply: vi.fn().mockResolvedValue({ agentId: 'claude-code' }),
    discard: vi.fn().mockResolvedValue(undefined),
    getFolderPath: vi.fn().mockResolvedValue('/safe/skill'),
  }
  const openPath = vi.fn().mockResolvedValue('')
  const onChanged = vi.fn().mockResolvedValue(undefined)
  registerAgentAccessIpc({
    ipc: {
      handle: (
        channel: string,
        handler: (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>
      ) => handlers.set(channel, handler),
    } as unknown as Pick<IpcMain, 'handle'>,
    service: service as unknown as AgentAccessService,
    getMainWindow: () => window,
    openPath,
    onChanged,
  })
  return {
    service,
    openPath,
    onChanged,
    event,
    invoke: (channel: string, input: unknown, sender = event) =>
      handlers.get(channel)!(sender, input),
  }
}

it('authorizes only the main desktop frame for every access endpoint', async () => {
  const { invoke, event, service, openPath } = setup()
  const channels = [
    desktopIpcChannels.agentAccessGet,
    desktopIpcChannels.agentAccessPreview,
    desktopIpcChannels.agentAccessApply,
    desktopIpcChannels.agentAccessDiscard,
    desktopIpcChannels.agentAccessOpenFolder,
  ]
  for (const channel of channels) {
    await expect(
      invoke(channel, 'claude-code', {
        ...event,
        sender: {},
      } as IpcMainInvokeEvent)
    ).rejects.toThrow('Invalid desktop sender')
    await expect(
      invoke(channel, 'claude-code', {
        ...event,
        senderFrame: {},
      } as IpcMainInvokeEvent)
    ).rejects.toThrow('Invalid desktop sender')
  }
  expect(service.getSnapshot).not.toHaveBeenCalled()
  expect(service.preview).not.toHaveBeenCalled()
  expect(service.apply).not.toHaveBeenCalled()
  expect(service.discard).not.toHaveBeenCalled()
  expect(service.getFolderPath).not.toHaveBeenCalled()
  expect(openPath).not.toHaveBeenCalled()
})

it('validates preview requests and never accepts caller-supplied filesystem paths', async () => {
  const { invoke, service } = setup()
  for (const input of [
    null,
    [],
    {},
    { agentId: 'claude-code', skillNames: [], action: 'connect', mode: 'copy' },
    {
      agentId: 'claude-code',
      skillNames: ['alpha'],
      action: 'delete',
      mode: 'copy',
    },
  ]) {
    await expect(
      invoke(desktopIpcChannels.agentAccessPreview, input)
    ).rejects.toThrow('Invalid Agent access input')
  }
  const input = {
    agentId: 'claude-code',
    skillNames: ['alpha'],
    action: 'connect',
    mode: 'symlink',
    sourcePath: '/untrusted',
  }
  await invoke(desktopIpcChannels.agentAccessPreview, input)
  expect(service.preview).toHaveBeenCalledWith({
    agentId: 'claude-code',
    skillNames: ['alpha'],
    action: 'connect',
    mode: 'symlink',
  })
})

it('refreshes coverage only after successful mutations', async () => {
  const { invoke, service, onChanged } = setup()
  await invoke(desktopIpcChannels.agentAccessGet, 'claude-code')
  await invoke(desktopIpcChannels.agentAccessDiscard, 'preview')
  expect(onChanged).not.toHaveBeenCalled()
  await invoke(desktopIpcChannels.agentAccessApply, 'preview')
  expect(service.apply).toHaveBeenCalledWith('preview')
  expect(onChanged).toHaveBeenCalledOnce()
  service.apply.mockRejectedValueOnce(new Error('stale'))
  await expect(
    invoke(desktopIpcChannels.agentAccessApply, 'stale-preview')
  ).rejects.toThrow('stale')
  expect(onChanged).toHaveBeenCalledOnce()
})

it('does not report a committed mutation as failed if coverage refresh fails', async () => {
  const { invoke, onChanged } = setup()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    onChanged.mockRejectedValueOnce(new Error('scan failed'))
    await expect(
      invoke(desktopIpcChannels.agentAccessApply, 'preview')
    ).resolves.toEqual({ agentId: 'claude-code' })
    expect(warn).toHaveBeenCalledOnce()
  } finally {
    warn.mockRestore()
  }
})

it('opens only a service-validated folder and propagates native errors', async () => {
  const { invoke, service, openPath } = setup()
  await expect(
    invoke(desktopIpcChannels.agentAccessOpenFolder, {
      agentId: 'claude-code',
      skillName: 'alpha',
      location: 'arbitrary',
      path: '/untrusted',
    })
  ).rejects.toThrow('Invalid Agent access input')
  await invoke(desktopIpcChannels.agentAccessOpenFolder, {
    agentId: 'claude-code',
    skillName: 'alpha',
    location: 'source',
    path: '/untrusted',
  })
  expect(service.getFolderPath).toHaveBeenCalledWith({
    agentId: 'claude-code',
    skillName: 'alpha',
    location: 'source',
  })
  expect(openPath).toHaveBeenCalledWith('/safe/skill')
  openPath.mockResolvedValueOnce('Folder could not be opened')
  await expect(
    invoke(desktopIpcChannels.agentAccessOpenFolder, {
      agentId: 'claude-code',
      skillName: 'alpha',
      location: 'target',
    })
  ).rejects.toThrow('Folder could not be opened')
})
