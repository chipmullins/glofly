import { contextBridge, ipcRenderer } from 'electron'
import type {
  AccentChoice,
  AppSettingsChanges,
  Attachment,
  GloflyApi,
  GameState,
  GloflyEvent,
  LoginRequest,
  MyStatus,
  PhotoType,
  PrivacySettings,
  ProfileChanges,
  RegisterRequest,
  ShowNotification,
  WindowTheme
} from './api-types'

// The only things the UI can ask the main process to do. Each one is a named,
// specific action. The UI never gets general access to Electron or Node, so even
// if something malicious ran inside the window, it couldn't reach your files.
/** The accent the main process passed at launch (--glofly-accent=…), so the first frame is right. */
function accentFromArgs(): AccentChoice {
  const arg = process.argv.find((a) => a.startsWith('--glofly-accent='))?.split('=')[1]
  return arg === 'red' || arg === 'lagoon' || arg === 'violet' ? arg : 'orange'
}

const glofly: GloflyApi = {
  platform: process.platform,
  auth: {
    login: (request: LoginRequest) => ipcRenderer.invoke('auth:login', request),
    register: (request: RegisterRequest) => ipcRenderer.invoke('auth:register', request),
    checkUsername: (username: string) => ipcRenderer.invoke('auth:check-username', username),
    signupMode: () => ipcRenderer.invoke('auth:signup-mode'),
    restore: () => ipcRenderer.invoke('auth:restore'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    forgotPassword: (identifier: string) => ipcRenderer.invoke('auth:forgot-password', identifier)
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
  app: {
    getSettings: () => ipcRenderer.invoke('app:get-settings'),
    setSettings: (changes: AppSettingsChanges) => ipcRenderer.invoke('app:set-settings', changes),
    openPrivacySettings: (pane: 'microphone' | 'camera' | 'screen') =>
      ipcRenderer.send('app:open-privacy-settings', pane),
    initialAppearance: {
      accent: accentFromArgs(),
      dark: process.argv.includes('--glofly-dark')
    }
  },
  account: {
    get: () => ipcRenderer.invoke('account:get'),
    changePassword: (currentPassword: string, newPassword: string, signOutOthers: boolean) =>
      ipcRenderer.invoke('account:change-password', currentPassword, newPassword, signOutOthers),
    delete: (password: string) => ipcRenderer.invoke('account:delete', password),
    resendVerification: () => ipcRenderer.invoke('account:resend-verification'),
    changeEmail: (newEmail: string, password: string) =>
      ipcRenderer.invoke('account:change-email', newEmail, password),
    cancelEmailChange: () => ipcRenderer.invoke('account:cancel-email-change'),
    sessions: () => ipcRenderer.invoke('account:sessions'),
    signOutDevice: (sessionId: string) => ipcRenderer.invoke('account:sign-out-device', sessionId),
    signOutOtherDevices: () => ipcRenderer.invoke('account:sign-out-other-devices')
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
    createGroup: (userIds: string[], name: string | null) =>
      ipcRenderer.invoke('conversations:create-group', userIds, name),
    renameGroup: (conversationId: string, name: string | null) =>
      ipcRenderer.invoke('conversations:rename-group', conversationId, name),
    addMembers: (conversationId: string, userIds: string[]) =>
      ipcRenderer.invoke('conversations:add-members', conversationId, userIds),
    removeMember: (conversationId: string, userId: string) =>
      ipcRenderer.invoke('conversations:remove-member', conversationId, userId),
    messages: (conversationId: string, beforeMessageId?: string) =>
      ipcRenderer.invoke('conversations:messages', conversationId, beforeMessageId),
    search: (query: string, conversationId?: string, beforeMessageId?: string) =>
      ipcRenderer.invoke('conversations:search', query, conversationId, beforeMessageId),
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
    pin: (conversationId: string, pinned: boolean) =>
      ipcRenderer.invoke('conversations:pin', conversationId, pinned),
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
  calls: {
    start: (conversationId: string, video: boolean) =>
      ipcRenderer.invoke('calls:start', conversationId, video),
    active: () => ipcRenderer.invoke('calls:active'),
    answer: (callId: string) => ipcRenderer.invoke('calls:answer', callId),
    join: (callId: string) => ipcRenderer.invoke('calls:join', callId),
    ring: (callId: string, userIds: string[]) => ipcRenderer.invoke('calls:ring', callId, userIds),
    decline: (callId: string) => ipcRenderer.invoke('calls:decline', callId),
    leave: (callId: string) => ipcRenderer.invoke('calls:leave', callId),
    screenSources: () => ipcRenderer.invoke('calls:screen-sources'),
    chooseScreen: (sourceId: string) => ipcRenderer.invoke('calls:choose-screen', sourceId),
    screenAccess: () => ipcRenderer.invoke('calls:screen-access')
  },
  notifications: {
    show: (notification: ShowNotification) => ipcRenderer.send('notifications:show', notification),
    clear: (key: string) => ipcRenderer.send('notifications:clear', key),
    badge: (count: number, image: string | null) =>
      ipcRenderer.send('notifications:badge', count, image)
  },
  onEvent: (listener: (event: GloflyEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: GloflyEvent): void => listener(event)
    ipcRenderer.on('glofly:event', handler)
    return () => ipcRenderer.removeListener('glofly:event', handler)
  },
  games: {
    state: () => ipcRenderer.invoke('games:state'),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('games:set-enabled', enabled),
    hide: (name: string, hide: boolean) => ipcRenderer.invoke('games:hide', name, hide),
    add: (exe: string, name: string) => ipcRenderer.invoke('games:add', exe, name),
    remove: (exe: string) => ipcRenderer.invoke('games:remove', exe),
    running: () => ipcRenderer.invoke('games:running'),
    noticeShown: () => ipcRenderer.send('games:notice-shown'),
    onChange: (listener: (state: GameState) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, state: GameState): void => listener(state)
      ipcRenderer.on('games:changed', handler)
      return () => ipcRenderer.removeListener('games:changed', handler)
    }
  },
  updates: {
    status: () => ipcRenderer.invoke('updates:status'),
    onReady: (listener: (version: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, version: unknown): void => {
        if (typeof version === 'string') listener(version)
      }
      ipcRenderer.on('updates:ready', handler)
      return () => ipcRenderer.removeListener('updates:ready', handler)
    },
    restart: () => ipcRenderer.send('updates:restart')
  },
  window: {
    setTheme: (theme: WindowTheme) => ipcRenderer.send('window:theme', theme),
    attention: () => ipcRenderer.send('window:attention')
  }
}

contextBridge.exposeInMainWorld('glofly', glofly)
