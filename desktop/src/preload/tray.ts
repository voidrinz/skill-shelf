import { ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  trayIpcChannels,
  type SkillShelfTrayApi,
  type TrayState,
} from '../shared/desktop-contract'

export const trayApi: SkillShelfTrayApi = {
  getState: () => ipcRenderer.invoke(trayIpcChannels.getState),
  scanEnvironment: () => ipcRenderer.invoke(trayIpcChannels.scan),
  openMain: (action) => ipcRenderer.invoke(trayIpcChannels.openMain, action),
  hide: () => ipcRenderer.invoke(trayIpcChannels.hide),
  quit: () => ipcRenderer.invoke(trayIpcChannels.quit),
  onStateChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, state: TrayState) =>
      listener(state)
    ipcRenderer.on(trayIpcChannels.stateChanged, handler)
    return () =>
      ipcRenderer.removeListener(trayIpcChannels.stateChanged, handler)
  },
}
