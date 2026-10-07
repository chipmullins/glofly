import { contextBridge, ipcRenderer } from 'electron'
import type { GloflyApi, LoginRequest, RegisterRequest, WindowTheme } from './api-types'

// The only things the UI can ask the main process to do. Each one is a named,
// specific action. The UI never gets general access to Electron or Node, so even
// if something malicious ran inside the window, it couldn't reach your files.
const glofly: GloflyApi = {
  platform: process.platform,
  auth: {
    login: (request: LoginRequest) => ipcRenderer.invoke('auth:login', request),
    register: (request: RegisterRequest) => ipcRenderer.invoke('auth:register', request),
    checkUsername: (username: string) => ipcRenderer.invoke('auth:check-username', username),
    restore: () => ipcRenderer.invoke('auth:restore'),
    logout: () => ipcRenderer.invoke('auth:logout')
  },
  friends: {
    list: () => ipcRenderer.invoke('friends:list'),
    search: (query: string) => ipcRenderer.invoke('friends:search', query),
    sendRequest: (username: string) => ipcRenderer.invoke('friends:send-request', username),
    accept: (userId: string) => ipcRenderer.invoke('friends:accept', userId),
    removeRequest: (userId: string) => ipcRenderer.invoke('friends:remove-request', userId),
    remove: (userId: string) => ipcRenderer.invoke('friends:remove', userId),
    block: (userId: string) => ipcRenderer.invoke('friends:block', userId),
    unblock: (userId: string) => ipcRenderer.invoke('friends:unblock', userId)
  },
  window: {
    setTheme: (theme: WindowTheme) => ipcRenderer.send('window:theme', theme)
  }
}

contextBridge.exposeInMainWorld('glofly', glofly)
