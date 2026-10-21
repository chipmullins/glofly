import { contextBridge, ipcRenderer } from 'electron'
import type { ControlApi } from './types'

// The only things the Control window can ask the main process to do. No general access to
// Electron, Node or the network: the window can't even see the admin session token.

const control: ControlApi = {
  platform: process.platform,
  serverUrl: process.argv.find((a) => a.startsWith('--control-server='))?.slice(17) ?? '',
  signIn: {
    password: (username, password) => ipcRenderer.invoke('signin:password', username, password),
    code: (kind, value) => ipcRenderer.invoke('signin:code', kind, value),
    signOut: () => ipcRenderer.invoke('signin:signout')
  },
  call: (method, path, body) => ipcRenderer.invoke('control:call', method, path, body),
  exportAudit: () => ipcRenderer.invoke('control:export-audit'),
  copy: (text) => ipcRenderer.invoke('control:copy', text),
  openExternal: (url) => ipcRenderer.invoke('control:open-external', url),
  setScreen: (screen) => ipcRenderer.send('control:screen', screen),
  reportError: (report) => ipcRenderer.send('control:report-error', report),
  notify: (alert) => ipcRenderer.send('control:notify', alert),
  onOpenPage: (callback) => {
    const listener = (_event: unknown, page: string): void => callback(page)
    ipcRenderer.on('control:open-page', listener)
    return () => ipcRenderer.removeListener('control:open-page', listener)
  },
  onSignedOut: (callback) => {
    const listener = (_event: unknown, reason: 'expired' | 'ended'): void => callback(reason)
    ipcRenderer.on('control:signed-out', listener)
    return () => ipcRenderer.removeListener('control:signed-out', listener)
  }
}

contextBridge.exposeInMainWorld('control', control)
