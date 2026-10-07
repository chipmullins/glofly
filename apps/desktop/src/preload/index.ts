import { contextBridge, ipcRenderer } from 'electron'
import type { GloflyApi, LoginRequest, WindowTheme } from './api-types'

// The only things the UI can ask the main process to do. Each one is a named,
// specific action. The UI never gets general access to Electron or Node, so even
// if something malicious ran inside the window, it couldn't reach your files.
const glofly: GloflyApi = {
  platform: process.platform,
  auth: {
    login: (request: LoginRequest) => ipcRenderer.invoke('auth:login', request),
    restore: () => ipcRenderer.invoke('auth:restore'),
    logout: () => ipcRenderer.invoke('auth:logout')
  },
  window: {
    setTheme: (theme: WindowTheme) => ipcRenderer.send('window:theme', theme)
  }
}

contextBridge.exposeInMainWorld('glofly', glofly)
