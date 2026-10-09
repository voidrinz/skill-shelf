import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'

export function createSyncIpcHandler(
  getMainWindow: () => BrowserWindow | null
) {
  let busy = false
  return (
      action: (input: unknown) => Promise<unknown> | unknown,
      { readOnly = false }: { readOnly?: boolean } = {}
    ) =>
    async (event: IpcMainInvokeEvent, input: unknown) => {
      const window = getMainWindow()
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error('Invalid desktop sender')
      // Reading local settings must not contend with synchronization operations.
      if (readOnly) return action(input)
      if (busy) throw new Error('Sync operation is busy')
      busy = true
      try {
        return await action(input)
      } finally {
        busy = false
      }
    }
}
