import { contextBridge, ipcRenderer } from 'electron'
import type {
  AccentChoice,
  AppSettingsChanges,
  Attachment,
  ChatGameKind,
  ChatGameMove,
  ConstellationMethod,
  ErrorReport,
  TwoStepMethod,
  FireflyEmoji,
  GloflyApi,
  GameState,
  GloflyEvent,
  LoginRequest,
  MuteDuration,
  MyStatusChanges,
  PhotoType,
  PrivacySettings,
  ProfileChanges,
  RegisterRequest,
  ReportRequest,
  SendOptions,
  ShowNotification,
  VoiceInfo,
  WatchControl,
  WatchControlAction,
  WatchReaction,
  WindowTheme
} from './api-types'

// The only things the UI can ask the main process to do. Each one is a named,
// specific action. The UI never gets general access to Electron or Node, so even
// if something malicious ran inside the window, it couldn't reach your files.
/** The accent the main process passed at launch (--glofly-accent=…), so the first frame is right. */
function accentFromArgs(): AccentChoice {
  const arg = process.argv.find((a) => a.startsWith('--glofly-accent='))?.split('=')[1]
  return arg === 'red' ||
    arg === 'lagoon' ||
    arg === 'violet' ||
    arg === 'blossom' ||
    arg === 'graphite'
    ? arg
    : 'orange'
}

/** Listens on one channel until the returned function is called. */
function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const glofly: GloflyApi = {
  platform: process.platform,
  overlay: {
    info: () => ipcRenderer.invoke('overlay:info'),
    set: (changes) => ipcRenderer.invoke('overlay:set', changes),
    preview: (on) => ipcRenderer.send('overlay:preview', on),
    close: () => ipcRenderer.send('overlay:close'),
    command: (command) => ipcRenderer.send('overlay:command', command),
    sendVoice: (voice) => ipcRenderer.send('overlay:voice', voice),
    onCommand: (listener) => listen('overlay:command', listener),
    onState: (listener) => listen('overlay:state', listener),
    onVoice: (listener) => listen('overlay:voice', listener),
    onToast: (listener) => listen('overlay:toast', listener),
    onClearToast: (listener) => listen('overlay:clear-toast', listener),
    onSettings: (listener) => listen('overlay:settings', listener),
    onProblem: (listener) => listen('overlay:problem', listener)
  },
  auth: {
    login: (request: LoginRequest) => ipcRenderer.invoke('auth:login', request),
    loginCode: (challenge: string, code: string) =>
      ipcRenderer.invoke('auth:login-code', challenge, code),
    loginResend: (challenge: string, method?: TwoStepMethod) =>
      ipcRenderer.invoke('auth:login-resend', challenge, method),
    qrStart: (keepSignedIn: boolean) => ipcRenderer.invoke('auth:qr-start', keepSignedIn),
    qrPoll: (id: string, secret: string) => ipcRenderer.invoke('auth:qr-poll', id, secret),
    register: (request: RegisterRequest) => ipcRenderer.invoke('auth:register', request),
    checkUsername: (username: string) => ipcRenderer.invoke('auth:check-username', username),
    signupMode: () => ipcRenderer.invoke('auth:signup-mode'),
    restore: () => ipcRenderer.invoke('auth:restore'),
    me: () => ipcRenderer.invoke('auth:me'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    forgotPassword: (identifier: string) => ipcRenderer.invoke('auth:forgot-password', identifier),
    friendLinkInfo: (code: string) => ipcRenderer.invoke('auth:friend-link-info', code)
  },
  friends: {
    list: () => ipcRenderer.invoke('friends:list'),
    search: (query: string) => ipcRenderer.invoke('friends:search', query),
    sendRequest: (username: string) => ipcRenderer.invoke('friends:send-request', username),
    accept: (userId: string) => ipcRenderer.invoke('friends:accept', userId),
    removeRequest: (userId: string) => ipcRenderer.invoke('friends:remove-request', userId),
    remove: (userId: string) => ipcRenderer.invoke('friends:remove', userId),
    block: (userId: string) => ipcRenderer.invoke('friends:block', userId),
    unblock: (userId: string) => ipcRenderer.invoke('friends:unblock', userId),
    setOnlineAlert: (userId: string, on: boolean) =>
      ipcRenderer.invoke('friends:set-online-alert', userId, on),
    invite: (email: string) => ipcRenderer.invoke('friends:invite', email),
    myLink: () => ipcRenderer.invoke('friends:my-link'),
    resetLink: () => ipcRenderer.invoke('friends:reset-link'),
    previewLink: (code: string) => ipcRenderer.invoke('friends:preview-link', code),
    acceptLink: (code: string) => ipcRenderer.invoke('friends:accept-link', code)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (changes: Partial<PrivacySettings>) => ipcRenderer.invoke('settings:set', changes)
  },
  app: {
    getSettings: () => ipcRenderer.invoke('app:get-settings'),
    setSettings: (changes: AppSettingsChanges) => ipcRenderer.invoke('app:set-settings', changes),
    openPrivacySettings: (pane: 'microphone' | 'camera' | 'screen' | 'accessibility') =>
      ipcRenderer.send('app:open-privacy-settings', pane),
    initialAppearance: {
      accent: accentFromArgs(),
      dark: process.argv.includes('--glofly-dark')
    },
    launchedHidden: process.argv.includes('--glofly-hidden'),
    goodbyeDone: () => ipcRenderer.send('app:goodbye-done')
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
  tools: {
    request: (method: ConstellationMethod, path: string, body?: unknown) =>
      ipcRenderer.invoke('tools:request', method, path, body)
  },
  reportError: (report: ErrorReport) => ipcRenderer.send('errors:report', report),
  setErrorReports: (on: boolean) => ipcRenderer.send('errors:enabled', on),
  status: {
    get: () => ipcRenderer.invoke('status:get'),
    set: (changes: MyStatusChanges) => ipcRenderer.invoke('status:set', changes)
  },
  profile: {
    getMine: () => ipcRenderer.invoke('profile:get-mine'),
    get: (userId: string) => ipcRenderer.invoke('profile:get', userId),
    update: (changes: ProfileChanges) => ipcRenderer.invoke('profile:update', changes),
    setPhoto: (data: ArrayBuffer, type: PhotoType) =>
      ipcRenderer.invoke('profile:set-photo', data, type),
    removePhoto: () => ipcRenderer.invoke('profile:remove-photo'),
    setNickname: (userId: string, nickname: string | null) =>
      ipcRenderer.invoke('profile:set-nickname', userId, nickname)
  },
  conversations: {
    list: () => ipcRenderer.invoke('conversations:list'),
    openDm: (userId: string) => ipcRenderer.invoke('conversations:open-dm', userId),
    createGroup: (userIds: string[], name: string | null) =>
      ipcRenderer.invoke('conversations:create-group', userIds, name),
    setGroupPhoto: (conversationId: string, data: ArrayBuffer, type: PhotoType) =>
      ipcRenderer.invoke('conversations:set-group-photo', conversationId, data, type),
    removeGroupPhoto: (conversationId: string) =>
      ipcRenderer.invoke('conversations:remove-group-photo', conversationId),
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
    send: (
      conversationId: string,
      body: string,
      replyToId?: string,
      attachmentIds?: string[],
      options?: SendOptions
    ) =>
      ipcRenderer.invoke(
        'conversations:send',
        conversationId,
        body,
        replyToId,
        attachmentIds,
        options
      ),
    upload: (conversationId: string, data: ArrayBuffer, name: string, voice?: VoiceInfo) =>
      ipcRenderer.invoke('conversations:upload', conversationId, data, name, voice),
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
    orderGroups: (ids: string[]) => ipcRenderer.invoke('conversations:orderGroups', ids),
    orderPins: (ids: string[]) => ipcRenderer.invoke('conversations:orderPins', ids),
    mute: (conversationId: string, duration: MuteDuration | null) =>
      ipcRenderer.invoke('conversations:mute', conversationId, duration),
    close: (conversationId: string, closed: boolean) =>
      ipcRenderer.invoke('conversations:close', conversationId, closed),
    typing: (conversationId: string) => ipcRenderer.send('conversations:typing', conversationId)
  },
  social: {
    get: () => ipcRenderer.invoke('social:get'),
    hang: (userIds: string[] | null) => ipcRenderer.invoke('social:hang', userIds),
    stopHang: () => ipcRenderer.invoke('social:stop-hang'),
    shareBirthday: (share: boolean) => ipcRenderer.invoke('social:birthday', share),
    year: () => ipcRenderer.invoke('social:year')
  },
  stickers: {
    list: () => ipcRenderer.invoke('stickers:list'),
    make: (data: ArrayBuffer) => ipcRenderer.invoke('stickers:make', data),
    remove: (id: string) => ipcRenderer.invoke('stickers:remove', id),
    send: (id: string, conversationId: string, replyToId?: string) =>
      ipcRenderer.invoke('stickers:send', id, conversationId, replyToId)
  },
  broadcasts: {
    start: (title: string | null, notify?: boolean) =>
      ipcRenderer.invoke('broadcasts:start', title, notify),
    stop: () => ipcRenderer.invoke('broadcasts:stop'),
    mine: () => ipcRenderer.invoke('broadcasts:mine'),
    watch: (userId: string) => ipcRenderer.invoke('broadcasts:watch', userId)
  },
  chat: {
    gifs: (query: string, offset?: number) => ipcRenderer.invoke('chat:gifs', query, offset),
    sendGif: (conversationId: string, gifId: string, replyToId?: string) =>
      ipcRenderer.invoke('chat:send-gif', conversationId, gifId, replyToId),
    removePreview: (conversationId: string, messageId: string) =>
      ipcRenderer.invoke('chat:remove-preview', conversationId, messageId),
    createPoll: (conversationId: string, question: string, options: string[], multi: boolean) =>
      ipcRenderer.invoke('chat:create-poll', conversationId, question, options, multi),
    vote: (conversationId: string, messageId: string, options: number[]) =>
      ipcRenderer.invoke('chat:vote', conversationId, messageId, options),
    closePoll: (conversationId: string, messageId: string) =>
      ipcRenderer.invoke('chat:close-poll', conversationId, messageId),
    startGame: (conversationId: string, kind: ChatGameKind) =>
      ipcRenderer.invoke('chat:start-game', conversationId, kind),
    move: (conversationId: string, messageId: string, move: ChatGameMove) =>
      ipcRenderer.invoke('chat:move', conversationId, messageId, move),
    fireflies: (conversationId: string, emoji: FireflyEmoji) =>
      ipcRenderer.invoke('chat:fireflies', conversationId, emoji)
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
    start: (conversationId: string, video: boolean, ring?: string[]) =>
      ipcRenderer.invoke('calls:start', conversationId, video, ring),
    active: () => ipcRenderer.invoke('calls:active'),
    answer: (callId: string) => ipcRenderer.invoke('calls:answer', callId),
    join: (callId: string) => ipcRenderer.invoke('calls:join', callId),
    ring: (callId: string, userIds: string[]) => ipcRenderer.invoke('calls:ring', callId, userIds),
    add: (callId: string, userIds: string[]) => ipcRenderer.invoke('calls:add', callId, userIds),
    stay: (callId: string) => ipcRenderer.invoke('calls:stay', callId),
    decline: (callId: string) => ipcRenderer.invoke('calls:decline', callId),
    leave: (callId: string) => ipcRenderer.invoke('calls:leave', callId),
    screenSources: () => ipcRenderer.invoke('calls:screen-sources'),
    chooseScreen: (sourceId: string, sound?: boolean) =>
      ipcRenderer.invoke('calls:choose-screen', sourceId, sound),
    screenAccess: () => ipcRenderer.invoke('calls:screen-access'),
    screenSound: {
      support: () => ipcRenderer.invoke('screen-sound:support'),
      start: (sourceId: string) => ipcRenderer.invoke('screen-sound:start', sourceId),
      stop: () => ipcRenderer.invoke('screen-sound:stop'),
      onChunk: (callback: (pcm: Uint8Array) => void) => {
        const listener = (_e: Electron.IpcRendererEvent, pcm: unknown): void => {
          if (pcm instanceof Uint8Array) callback(pcm)
        }
        ipcRenderer.on('screen-sound:chunk', listener)
        return () => {
          ipcRenderer.removeListener('screen-sound:chunk', listener)
        }
      },
      onEnded: (callback: () => void) => {
        const listener = (): void => callback()
        ipcRenderer.on('screen-sound:ended', listener)
        return () => {
          ipcRenderer.removeListener('screen-sound:ended', listener)
        }
      }
    }
  },
  watch: {
    playerUrl: () => ipcRenderer.invoke('watch:player-url'),
    get: (callId: string) => ipcRenderer.invoke('watch:get', callId),
    preview: (link: string) => ipcRenderer.invoke('watch:preview', link),
    start: (callId: string, link: string, control?: WatchControl) =>
      ipcRenderer.invoke('watch:start', callId, link, control),
    control: (callId: string, action: WatchControlAction, to?: number) =>
      ipcRenderer.invoke('watch:control', callId, action, to),
    settings: (callId: string, control: WatchControl) =>
      ipcRenderer.invoke('watch:settings', callId, control),
    report: (callId: string, videoId: string, durationSec: number, title?: string) =>
      ipcRenderer.invoke('watch:report', callId, videoId, durationSec, title),
    react: (callId: string, reaction: WatchReaction) =>
      ipcRenderer.invoke('watch:react', callId, reaction),
    stop: (callId: string) => ipcRenderer.invoke('watch:stop', callId)
  },
  ptt: {
    start: (choice: string) => ipcRenderer.invoke('ptt:start', choice),
    stop: () => ipcRenderer.send('ptt:stop')
  },
  notifications: {
    show: (notification: ShowNotification) => ipcRenderer.send('notifications:show', notification),
    clear: (key: string) => ipcRenderer.send('notifications:clear', key),
    badge: (count: number, image: string | null) =>
      ipcRenderer.send('notifications:badge', count, image),
    test: (welcome?: boolean) => ipcRenderer.invoke('notifications:test', welcome === true),
    openSettings: () => ipcRenderer.send('notifications:open-settings')
  },
  shortcuts: {
    take: () => ipcRenderer.invoke('shortcuts:take')
  },
  links: {
    take: () => ipcRenderer.invoke('links:take')
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
  reports: {
    send: (request: ReportRequest) => ipcRenderer.invoke('reports:send', request)
  },
  constellations: {
    request: (method: ConstellationMethod, path: string, body?: unknown) =>
      ipcRenderer.invoke('constellations:request', method, path, body ?? null),
    setIcon: (
      constellationId: string,
      data: ArrayBuffer,
      type: PhotoType,
      which?: 'icon' | 'banner'
    ) => ipcRenderer.invoke('constellations:set-icon', constellationId, data, type, which ?? 'icon')
  },
  notices: {
    list: () => ipcRenderer.invoke('notices:list'),
    seen: (noticeId: string) => ipcRenderer.invoke('notices:seen', noticeId),
    reply: (noticeId: string, body: string) => ipcRenderer.invoke('notices:reply', noticeId, body)
  },
  appStatus: {
    updateRequired: () => ipcRenderer.invoke('app:update-required'),
    paused: () => ipcRenderer.invoke('app:paused'),
    checkPaused: () => ipcRenderer.invoke('app:check-paused')
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
    restart: () => ipcRenderer.send('updates:restart'),
    checkNow: () => ipcRenderer.invoke('updates:check-now')
  },
  window: {
    setTheme: (theme: WindowTheme) => ipcRenderer.send('window:theme', theme),
    setTitleBarColor: (color: string, symbolColor: string) =>
      ipcRenderer.send('window:titlebar-color', color, symbolColor),
    attention: () => ipcRenderer.send('window:attention')
  }
}

contextBridge.exposeInMainWorld('glofly', glofly)
