import { contextBridge, ipcRenderer } from 'electron'
import type {
  Attachment,
  GloflyApi,
  GloflyEvent,
  LoginRequest,
  MyStatus,
  PhotoType,
  PrivacySettings,
  ProfileChanges,
  RegisterRequest,
  WindowTheme
} from './api-types'

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
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (changes: Partial<PrivacySettings>) => ipcRenderer.invoke('settings:set', changes)
  },
  status: {
    get: () => ipcRenderer.invoke('status:get'),
    set: (changes: Partial<MyStatus>) => ipcRenderer.invoke('status:set', changes)
  },
  profile: {
    getMine: () => ipcRenderer.invoke('profile:get-mine'),
    get: (userId: string) => ipcRenderer.invoke('profile:get', userId),
    update: (changes: ProfileChanges) => ipcRenderer.invoke('profile:update', changes),
    setPhoto: (data: ArrayBuffer, type: PhotoType) =>
      ipcRenderer.invoke('profile:set-photo', data, type),
    removePhoto: () => ipcRenderer.invoke('profile:remove-photo')
  },
  conversations: {
    list: () => ipcRenderer.invoke('conversations:list'),
    openDm: (userId: string) => ipcRenderer.invoke('conversations:open-dm', userId),
    messages: (conversationId: string, beforeMessageId?: string) =>
      ipcRenderer.invoke('conversations:messages', conversationId, beforeMessageId),
    send: (conversationId: string, body: string, replyToId?: string, attachmentIds?: string[]) =>
      ipcRenderer.invoke('conversations:send', conversationId, body, replyToId, attachmentIds),
    upload: (conversationId: string, data: ArrayBuffer, name: string) =>
      ipcRenderer.invoke('conversations:upload', conversationId, data, name),
    removeUpload: (conversationId: string, attachmentId: string) =>
      ipcRenderer.invoke('conversations:remove-upload', conversationId, attachmentId),
    edit: (conversationId: string, messageId: string, body: string) =>
      ipcRenderer.invoke('conversations:edit', conversationId, messageId, body),
    remove: (conversationId: string, messageId: string) =>
      ipcRenderer.invoke('conversations:remove', conversationId, messageId),
    react: (conversationId: string, messageId: string, emoji: string, on: boolean) =>
      ipcRenderer.invoke('conversations:react', conversationId, messageId, emoji, on),
    markRead: (conversationId: string) => ipcRenderer.invoke('conversations:read', conversationId),
    typing: (conversationId: string) => ipcRenderer.send('conversations:typing', conversationId)
  },
  files: {
    save: (conversationId: string, attachment: Attachment) =>
      ipcRenderer.invoke(
        'files:save',
        conversationId,
        attachment.id,
        attachment.kind,
        attachment.name
      ),
    showInFolder: (path: string) => ipcRenderer.send('files:show-in-folder', path)
  },
  onEvent: (listener: (event: GloflyEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: GloflyEvent): void => listener(event)
    ipcRenderer.on('glofly:event', handler)
    return () => ipcRenderer.removeListener('glofly:event', handler)
  },
  window: {
    setTheme: (theme: WindowTheme) => ipcRenderer.send('window:theme', theme)
  }
}

contextBridge.exposeInMainWorld('glofly', glofly)
