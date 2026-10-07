import { contextBridge, ipcRenderer } from 'electron'
import type { GloflyApi, LoginRequest } from './api-types'

// The only things the UI can ask the main process to do. Each one is a named,
// specific action. The UI never gets general access to Electron or Node, so even
// if something malicious ran inside the window, it couldn't reach your files.
const glofly: GloflyApi = {
  auth: {
    login: (request: LoginRequest) => ipcRenderer.invoke('auth:login', request),
    logout: () => ipcRenderer.invoke('auth:logout')
  }
}

contextBridge.exposeInMainWorld('glofly', glofly)
