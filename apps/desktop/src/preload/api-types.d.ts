// The functions the Glofly UI can call in the main process.
// Shared by the main process, the preload bridge and the React app.
//
// The server's shapes (users, messages, calls, chats...) live in @glofly/shared
// (packages/shared/src/types.ts), shared with the server and the mobile app. This file adds the
// desktop-only ones and re-exports the shared ones, so imports from here keep working.

export type * from '@glofly/shared/types'
import type {
  AccountDetails,
  ActiveCall,
  Announcement,
  ApiResult,
  Attachment,
  CallJoin,
  ConversationSummary,
  ForgotPasswordResult,
  FriendLists,
  LoginRequest,
  LoginResult,
  Message,
  MessagePage,
  MessageSearchPage,
  MuteDuration,
  MyStatus,
  PhotoType,
  PrivacySettings,
  Profile,
  ProfileChanges,
  RegisterRequest,
  RegisterResult,
  ReportRequest,
  SearchResult,
  ServerEvent,
  SignedInDevice,
  SignedInUser,
  SignupMode,
  TeamNotice,
  UpdateRequired,
  UsernameCheck,
  VoiceInfo
} from '@glofly/shared/types'

/** A game you added yourself in Settings → Activity: its program (lowercase .exe) and name. */
export type CustomGame = { exe: string; name: string }
/** A program with a window open, offered by "Add a game". */
export type RunningProgram = { exe: string; title: string }

/** Settings → Activity, and what Glofly sees you playing on this computer. */
export type GameState = {
  /** Game detection works on this computer (Windows) */
  supported: boolean
  /** "Show what I'm playing" */
  enabled: boolean
  /** The game friends see right now (null if none, or sharing is off) */
  current: string | null
  /** The game detected, even while sharing is off */
  detected: string | null
  custom: CustomGame[]
  /** Games never shown, by name */
  hidden: string[]
  /** The one-time "your friends can see this" note has been shown */
  noticeShown: boolean
}

/** A screen or window that can be shared, with a small picture of it. */
export type ScreenSource = {
  id: string
  name: string
  kind: 'screen' | 'window'
  /** data: URL */
  thumbnail: string
  /** data: URL of the app's icon (windows only) */
  icon: string | null
}

export type AppSettingsChanges = Partial<
  Pick<AppSettings, 'closeToTray' | 'openAtLogin' | 'theme' | 'accent' | 'textSize'>
> & { sounds?: Partial<SoundSettings>; notifications?: Partial<NotificationSettings> }

/** Settings → Notifications & sounds: Windows notifications */
export type NotificationSettings = {
  /** "Desktop notifications" */
  enabled: boolean
  /** "Show message preview": off shows "New message" instead of the text */
  preview: boolean
}

/** A Windows notification, built by the window and shown by the main process. */
export type ShowNotification = {
  /** One notification per key: a new one replaces the old (a chat's id, or "call:<id>") */
  key: string
  /** The chat it's about: clicking it opens this chat (null: the Friends page, e.g. a request) */
  conversationId: string | null
  title: string
  body: string
  /** A round picture of the person (PNG data: URL), or null for the Glofly icon */
  icon: string | null
  /** Calls stay until answered or dismissed */
  call?: boolean
}

/** Short sounds for alerts and call moments, and longer ones that loop while a call rings. */
export type AlertSound =
  | 'chime'
  | 'hello'
  | 'glowOn'
  | 'glowOff'
  | 'blinkIn'
  | 'blinkOut'
  | 'goodnight'
  | 'sparkTrail'
  | 'dewdrop'
  | 'starfall'
  | 'pebble'
  /** 0.2.2: from the "no answer" round, offered for any short sound */
  | 'pluck'
  | 'fade'
  | 'none'
/** Ringing sounds (they loop). 0.2.2 adds the in- and out- sets; ring and jingle are Chip's originals. */
export type CallSound = 'ring' | 'jingle' | OutgoingSound | IncomingSound | 'none'
export type OutgoingSound =
  | 'synthArp'
  | 'lantern'
  | 'fireflyOut'
  | 'marimbaOut'
  | 'glassOut'
  | 'breathe'
  | 'kalimbaOut'
  | 'evening'
  | 'pixel'
  | 'vibesOut'
  | 'musicBox'
  | 'nightDrive'
  | 'steelOut'
  | 'digital'
export type IncomingSound =
  | 'fireflyDance'
  | 'glowBells'
  | 'marimbaRing'
  | 'kalimbaRing'
  | 'glassChimes'
  | 'classic'
  | 'electro'
  | 'chiptune'
  | 'groove'
  | 'steelDrums'
  | 'vibesRing'
  | 'digitalBells'

/** Settings → Notifications & sounds */
export type SoundSettings = {
  /** "Notification sounds": off mutes every Glofly sound at once */
  enabled: boolean
  /** "Silence everything in Do Not Disturb" */
  dndSilence: boolean
  /** "Volume": how loud every Glofly sound plays, 0–100 */
  volume: number
  /** "Ringtone & jingle volume": the ringtone and outgoing call jingle, 0–100 */
  callVolume: number
  message: AlertSound
  friendRequest: AlertSound
  /** A friend you asked about comes online (0.3.0; older saved settings don't have it) */
  friendOnline?: AlertSound
  login: AlertSound
  /** You log out */
  logout: AlertSound
  /** You're in a call with someone (they answered, or you answered or joined) */
  callConnected: AlertSound
  /** You leave a call, or it ends */
  callEnded: AlertSound
  /** Someone else joins the group call you're in */
  memberJoined: AlertSound
  /** Someone else leaves the group call you're in */
  memberLeft: AlertSound
  /** Plays when someone calls you (with calls) */
  ringtone: CallSound
  /** Plays while you wait for someone to answer (with calls) */
  outgoing: CallSound
}

export type ThemeChoice = 'light' | 'dark' | 'system'
export type AccentChoice = 'orange' | 'red' | 'lagoon' | 'violet'
export type TextSize = 'small' | 'default' | 'large' | 'larger'

/** Settings → General → Appearance and App. Kept on this computer, not on the server. */
export type AppSettings = {
  /** e.g. "0.1.0" */
  version: string
  theme: ThemeChoice
  accent: AccentChoice
  textSize: TextSize
  sounds: SoundSettings
  notifications: NotificationSettings
  /** Closing the window keeps Glofly running in the system tray. */
  closeToTray: boolean
  /** Open Glofly when the computer starts. */
  openAtLogin: boolean
  /** False while developing: only the installed app can start with Windows. */
  startupAvailable: boolean
}

/** Live updates: the server's, plus a few from this computer. */
export type GloflyEvent =
  | ServerEvent
  /** Push to talk: the chosen key went down or came up */
  | { type: 'ptt'; down: boolean }
  | { type: 'connection'; connected: boolean }
  | { type: 'session:expired' }
  | { type: 'appearance'; accent: AccentChoice; dark: boolean }
  /** A Windows notification was clicked (Glofly is already brought to the front). */
  | { type: 'notification:click'; conversationId: string | null }

/** Which screen is showing, so the window buttons can match its colors. */
export type WindowTheme = 'login' | 'app'

export type GloflyApi = {
  /** 'win32' on Windows, 'darwin' on Mac, 'linux' on Linux */
  platform: string
  auth: {
    login: (request: LoginRequest) => Promise<LoginResult>
    /** Creates an account and signs it in (kept signed in). */
    register: (request: RegisterRequest) => Promise<RegisterResult>
    /** Live "Available" check. Null if the server can't be reached. */
    checkUsername: (username: string) => Promise<UsernameCheck | null>
    /** Open, invite only or closed (Glofly Control → Sign-ups). Null if the server can't be reached. */
    signupMode: () => Promise<SignupMode | null>
    /** Signs back in with a saved "Keep me signed in" session. Null if there isn't a valid one. */
    restore: () => Promise<SignedInUser | null>
    logout: () => Promise<void>
    /** Emails a reset link if the username or email belongs to an account. */
    forgotPassword: (identifier: string) => Promise<ForgotPasswordResult>
  }
  friends: {
    list: () => Promise<ApiResult<FriendLists>>
    search: (query: string) => Promise<ApiResult<SearchResult[]>>
    /** If they already sent you a request, this accepts it (status 'accepted'). */
    sendRequest: (username: string) => Promise<ApiResult<{ status: 'pending' | 'accepted' }>>
    accept: (userId: string) => Promise<ApiResult<null>>
    /** Declines a request to you, or cancels one you sent. */
    removeRequest: (userId: string) => Promise<ApiResult<null>>
    remove: (userId: string) => Promise<ApiResult<null>>
    block: (userId: string) => Promise<ApiResult<null>>
    unblock: (userId: string) => Promise<ApiResult<null>>
    /** "Notify me when they come online" for a friend (0.3.0) */
    setOnlineAlert: (userId: string, on: boolean) => Promise<ApiResult<{ on: boolean }>>
    /** "Invite your friends": emails them a link to join Glofly (0.3.0) */
    invite: (email: string) => Promise<ApiResult<null>>
  }
  settings: {
    get: () => Promise<ApiResult<PrivacySettings>>
    set: (changes: Partial<PrivacySettings>) => Promise<ApiResult<PrivacySettings>>
  }
  app: {
    getSettings: () => Promise<AppSettings>
    setSettings: (changes: AppSettingsChanges) => Promise<AppSettings>
    /** Mac: opens System Settings → Privacy & Security at that list (does nothing on Windows). */
    openPrivacySettings: (pane: 'microphone' | 'camera' | 'screen' | 'accessibility') => void
    /** Theme and accent at startup, known before anything is drawn (so nothing flashes). */
    initialAppearance: { accent: AccentChoice; dark: boolean }
  }
  account: {
    get: () => Promise<ApiResult<AccountDetails>>
    /** This device stays signed in; with signOutOthers, every other device is signed out. */
    changePassword: (
      currentPassword: string,
      newPassword: string,
      signOutOthers: boolean
    ) => Promise<ApiResult<{ signedOut: number }>>
    /** Signs out everywhere. The account is removed for good after 30 days unless restored. */
    delete: (password: string) => Promise<ApiResult<{ deleteAfter: string }>>
    /** Sends the "Confirm your email" link again. */
    resendVerification: () => Promise<ApiResult<{ ok: true }>>
    /** Sends a confirm link to the new address; the email changes once it's clicked. */
    changeEmail: (
      newEmail: string,
      password: string
    ) => Promise<ApiResult<{ pendingEmail: string }>>
    cancelEmailChange: () => Promise<ApiResult<{ ok: true }>>
    /** Every device signed in to this account, this one first. */
    sessions: () => Promise<ApiResult<{ sessions: SignedInDevice[] }>>
    /** Signs one other device out right away. */
    signOutDevice: (sessionId: string) => Promise<ApiResult<{ ok: true }>>
    /** Signs out every device except this one. */
    signOutOtherDevices: () => Promise<ApiResult<{ signedOut: number }>>
  }
  status: {
    get: () => Promise<ApiResult<MyStatus>>
    /** Change your status and/or custom status (empty text clears it). */
    set: (changes: Partial<MyStatus>) => Promise<ApiResult<MyStatus>>
  }
  profile: {
    /** Your own profile, for Edit profile. */
    getMine: () => Promise<ApiResult<Profile>>
    /** Someone's profile card. */
    get: (userId: string) => Promise<ApiResult<Profile>>
    update: (changes: ProfileChanges) => Promise<ApiResult<Profile>>
    /** Uploads a new profile photo (up to 8 MB). The server crops it and removes hidden photo data. */
    setPhoto: (data: ArrayBuffer, type: PhotoType) => Promise<ApiResult<{ avatarVersion: string }>>
    removePhoto: () => Promise<ApiResult<{ avatarVersion: null }>>
    /** Your own name for someone, only you see it (null removes it). */
    setNickname: (
      userId: string,
      nickname: string | null
    ) => Promise<ApiResult<{ userId: string; nickname: string | null }>>
  }
  conversations: {
    list: () => Promise<ApiResult<ConversationSummary[]>>
    /** Opens (or creates) the DM with a friend. */
    openDm: (userId: string) => Promise<ApiResult<ConversationSummary>>
    /** Starts a group with at least two friends (up to 25 people, including you). */
    createGroup: (userIds: string[], name: string | null) => Promise<ApiResult<ConversationSummary>>
    /** Anyone in the group can rename it. Null or empty clears the name. */
    /** Sets the group photo (anyone in the group can; a line in the chat says so). */
    setGroupPhoto: (
      conversationId: string,
      data: ArrayBuffer,
      type: PhotoType
    ) => Promise<ApiResult<{ photoVersion: string }>>
    /** Back to the members' faces. */
    removeGroupPhoto: (conversationId: string) => Promise<ApiResult<{ photoVersion: null }>>
    renameGroup: (
      conversationId: string,
      name: string | null
    ) => Promise<ApiResult<ConversationSummary>>
    /** Anyone in the group can add their friends. */
    addMembers: (
      conversationId: string,
      userIds: string[]
    ) => Promise<ApiResult<ConversationSummary>>
    /** Your own id leaves the group; anyone else's removes them (only whoever made it). */
    removeMember: (conversationId: string, userId: string) => Promise<ApiResult<null>>
    /** Newest page, or the page before `beforeMessageId`. Oldest first. */
    messages: (conversationId: string, beforeMessageId?: string) => Promise<ApiResult<MessagePage>>
    /** Messages containing these words (2+ characters), in one chat or all of them. */
    search: (
      query: string,
      conversationId?: string,
      beforeMessageId?: string
    ) => Promise<ApiResult<MessageSearchPage>>
    /** `body` can be empty when sending photos or files. */
    send: (
      conversationId: string,
      body: string,
      replyToId?: string,
      attachmentIds?: string[]
    ) => Promise<ApiResult<Message>>
    /** Uploads a photo or file (up to 25 MB) to send with the next message. */
    upload: (
      conversationId: string,
      data: ArrayBuffer,
      name: string,
      /** A voice message recorded in Glofly (Opus, up to 5 minutes) */
      voice?: VoiceInfo
    ) => Promise<ApiResult<Attachment>>
    /** Removes an upload that hasn't been sent. */
    removeUpload: (conversationId: string, attachmentId: string) => Promise<ApiResult<null>>
    edit: (conversationId: string, messageId: string, body: string) => Promise<ApiResult<Message>>
    remove: (conversationId: string, messageId: string) => Promise<ApiResult<Message>>
    react: (
      conversationId: string,
      messageId: string,
      emoji: string,
      on: boolean
    ) => Promise<ApiResult<Message>>
    markRead: (conversationId: string) => Promise<ApiResult<null>>
    /** Pins a chat to the top of the sidebar (up to 10, saved on your account), or unpins it. */
    pin: (conversationId: string, pinned: boolean) => Promise<ApiResult<null>>
    /** Your order for the Groups page (saved on your account). */
    orderGroups: (ids: string[]) => Promise<ApiResult<null>>
    /** Saves my order for the pinned chats (every pinned chat's id, top first). */
    orderPins: (ids: string[]) => Promise<ApiResult<null>>
    /** Mutes a chat for a while or until turned back on; null unmutes. */
    mute: (
      conversationId: string,
      duration: MuteDuration | null
    ) => Promise<ApiResult<{ mutedUntil: string | null }>>
    /** Closes a chat in the sidebar (history kept; comes back with a new message), or reopens it. */
    close: (conversationId: string, closed: boolean) => Promise<ApiResult<null>>
    typing: (conversationId: string) => void
  }
  files: {
    /** Asks where to save, then saves it there. Null if the person cancelled. */
    save: (
      conversationId: string,
      attachment: Attachment
    ) => Promise<ApiResult<{ path: string } | null>>
    /** Shows a file Glofly just saved in File Explorer. */
    showInFolder: (path: string) => void
  }
  calls: {
    /** Calls a friend. Returns the pass to join the call's room right away (it rings meanwhile). */
    start: (conversationId: string, video: boolean) => Promise<ApiResult<CallJoin>>
    /** Ringing and ongoing calls in your chats (to show an incoming call after a restart). */
    active: () => Promise<ApiResult<ActiveCall[]>>
    answer: (callId: string) => Promise<ApiResult<CallJoin>>
    /** Joins a group call that's going on, or gets back into yours (restart, moving devices). */
    join: (callId: string) => Promise<ApiResult<CallJoin>>
    /** Group calls: rings people in the group who aren't in the call. */
    ring: (callId: string, userIds: string[]) => Promise<ApiResult<null>>
    decline: (callId: string) => Promise<ApiResult<null>>
    /** Hangs up (or cancels the call while it's still ringing). */
    leave: (callId: string) => Promise<ApiResult<null>>
    /** Screens and windows that can be shared. */
    screenSources: () => Promise<ScreenSource[]>
    /** Picks what the next screen share shows (the share itself starts in the call). */
    chooseScreen: (sourceId: string) => Promise<boolean>
    /**
     * Mac: whether macOS allows Glofly to record the screen (System Settings → Privacy &
     * Security → Screen & System Audio Recording). Always "granted" on Windows.
     */
    screenAccess: () => Promise<'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'>
  }
  ptt: {
    /**
     * Push to talk: starts listening for the chosen key or mouse button ("key:Backquote",
     * "mouse:4") during a call, even with another app in front. Holding it sends
     * { type: 'ptt', down } events. "permission": Mac needs Glofly allowed under Accessibility.
     */
    start: (choice: string) => Promise<'ok' | 'permission' | 'unavailable'>
    stop: () => void
  }
  notifications: {
    show: (notification: ShowNotification) => void
    /** Takes a chat's (or call's) notification away, e.g. once you've read the chat. */
    clear: (key: string) => void
    /** The unread count on the taskbar icon; `image` is the badge drawn by the window. */
    badge: (count: number, image: string | null) => void
  }
  /** Subscribe to live updates. Returns a function that unsubscribes. */
  onEvent: (listener: (event: GloflyEvent) => void) => () => void
  /** "Playing Guild Wars 2": game detection and Settings → Activity (this computer). */
  games: {
    state: () => Promise<GameState>
    setEnabled: (enabled: boolean) => Promise<GameState>
    hide: (name: string, hide: boolean) => Promise<GameState>
    add: (exe: string, name: string) => Promise<GameState | null>
    remove: (exe: string) => Promise<GameState>
    /** Programs with a window open, for "Add a game" */
    running: () => Promise<RunningProgram[]>
    noticeShown: () => void
    onChange: (listener: (state: GameState) => void) => () => void
  }
  /** Report a message or a person to the Glofly team. */
  reports: {
    send: (request: ReportRequest) => Promise<ApiResult<{ ok: true; alreadyReported?: boolean }>>
  }
  /** Messages from the Glofly team, and the announcement banner. */
  notices: {
    list: () => Promise<ApiResult<{ notices: TeamNotice[]; announcement: Announcement | null }>>
    /** "I understand" */
    seen: (noticeId: string) => Promise<ApiResult<null>>
  }
  /** Set when the server needs a newer Glofly (checked at startup). */
  appStatus: {
    updateRequired: () => Promise<UpdateRequired | null>
  }
  /** New versions of Glofly (installed app only). */
  updates: {
    /** The version downloaded and waiting for a restart, or null. */
    status: () => Promise<string | null>
    /** Called when a new version has finished downloading. Returns a function that unsubscribes. */
    onReady: (listener: (version: string) => void) => () => void
    /** Closes Glofly, installs the new version and opens it again. */
    restart: () => void
    /** Looks for a new version right away. 'unavailable': this copy can't update itself. */
    checkNow: () => Promise<'checking' | 'unavailable'>
  }
  window: {
    setTheme: (theme: WindowTheme) => void
    /** Brings Glofly to your attention (an incoming call): shows it if it's in the tray, flashes the taskbar. */
    attention: () => void
  }
}
