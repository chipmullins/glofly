// The functions the Glofly UI can call in the main process.
// Shared by the main process, the preload bridge and the React app.
//
// The server's shapes (users, messages, calls, chats...) live in @glofly/shared
// (packages/shared/src/types.ts), shared with the server and the mobile app. This file adds the
// desktop-only ones and re-exports the shared ones, so imports from here keep working.

export type * from '@glofly/shared/types'
export type * from '@glofly/shared/constellations'
export type * from '@glofly/shared/security'
export type * from '@glofly/shared/chatTools'
export type * from '@glofly/shared/friendLinks'
import type {
  FriendLinkAccepted,
  FriendLinkInfo,
  FriendLinkPreview,
  MyFriendLink
} from '@glofly/shared/friendLinks'
import type {
  ErrorReport,
  LoginTwoStep,
  QrLoginStart,
  QrLoginState,
  TwoStepMethod
} from '@glofly/shared/security'
import type {
  AccountDetails,
  ActiveCall,
  CallAddResult,
  Announcement,
  ApiResult,
  Attachment,
  CallJoin,
  Broadcast,
  BroadcastJoin,
  ConversationSummary,
  FireflyEmoji,
  GifInfo,
  ForgotPasswordResult,
  FriendLists,
  LoginRequest,
  LoginResult,
  Message,
  MessagePage,
  MessageSearchPage,
  MuteDuration,
  MyStatus,
  MyStatusChanges,
  PhotoType,
  PrivacySettings,
  Profile,
  ProfileChanges,
  PublicUser,
  RegisterRequest,
  RegisterResult,
  ReportRequest,
  SearchResult,
  ServerEvent,
  SignedInDevice,
  SignedInUser,
  SignupMode,
  SocialToday,
  Sticker,
  TeamNotice,
  UpdateRequired,
  UsernameCheck,
  WatchControl,
  WatchPreview,
  WatchReaction,
  WatchUpdate,
  VoiceInfo,
  YearInGlow,
  Paused
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

/** What sound can go with a shared screen on this computer (calls.screenSound). */
export type ScreenSoundSupport = 'app' | 'system' | 'browser' | 'none'
export type ScreenSoundFormat = {
  sampleRate: number
  channels: number
  float: boolean
  /** 'app': only the shared window's app. 'computer': everything except Glofly. */
  scope: 'app' | 'computer'
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
  /** 0.7.0 */
  | 'comet'
  /** 0.7.0: the default message sound */
  | 'lowComet'
  /** 0.7.0: the night-sky set (Hollow wood, Night breeze and Lantern are defaults) */
  | 'twinStars'
  | 'constellation'
  | 'nebula'
  | 'starlightPing'
  | 'moonrise'
  | 'hollowWood'
  | 'nightBreeze'
  | 'ember'
  | 'orbit'
  | 'stardust'
  | 'aurora'
  | 'skyLantern'
  | 'deepSpace'
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
  /** A message in a constellation's nebula (0.7.0; older saved settings don't have it) */
  constellationMessage?: AlertSound
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
export type AccentChoice = 'orange' | 'red' | 'lagoon' | 'violet' | 'blossom' | 'graphite'
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
/** Watch Together: what the timeline buttons can ask for. */
export type WatchControlAction = 'play' | 'pause' | 'seek' | 'back' | 'forward'

/** 2.0: the methods the constellations gateway allows. */
export type ConstellationMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** 0.7.3: a sign-in step's answer: signed in, a two-step code is needed, or what went wrong. */
export type LoginStepResult =
  | LoginResult
  | { ok: false; reason: 'two_step'; message: string; twoStep: LoginTwoStep['twoStep'] }
  | { ok: false; reason: 'code_expired' | 'wrong_code'; message: string }

/** 0.7.3: the QR code sign-in's answer while it waits (or signed in once the phone approves). */
export type QrPollResult =
  QrLoginState | { state: 'signed-in'; user: SignedInUser } | { state: 'error'; message: string }

/** 0.8.0: a glofly:// link Glofly was opened with: a friend's invite link or a constellation invite. */
export type DeepLink = { kind: 'friend'; code: string } | { kind: 'constellation'; code: string }

/** What a Jump List task or Dock menu item asks for (see `shortcuts`). */
export type ShortcutAction =
  'new-message' | 'status:online' | 'status:away' | 'status:dnd' | 'quiet-hours'

export type GloflyEvent =
  | ServerEvent
  /** 0.7.3: pins changed in a chat; my own devices: marked unread / send-later list changed */
  | { type: 'pins:changed'; conversationId: string }
  | { type: 'conversation:unread'; conversationId: string; lastReadAt: string }
  /** Jump List / Dock menu: call `shortcuts.take()` and do what it returns */
  | { type: 'shortcut'; action: ShortcutAction }
  /** 0.8.0: Glofly was opened with a glofly:// link: call `links.take()` */
  | { type: 'deep-link' }
  | { type: 'scheduled:changed'; conversationId: string }
  /** Push to talk: the chosen key went down or came up */
  | { type: 'ptt'; down: boolean }
  | { type: 'connection'; connected: boolean }
  | { type: 'session:expired' }
  | { type: 'appearance'; accent: AccentChoice; dark: boolean }
  /** A Windows notification was clicked (Glofly is already brought to the front). */
  | { type: 'notification:click'; conversationId: string | null }
  /** Web only: the browser's notification permission changed (asked from a click). */
  | { type: 'notifications:permission'; permission: 'granted' | 'denied' | 'default' }

/** Which screen is showing, so the window buttons can match its colors. */
export type WindowTheme = 'login' | 'app'

/** Glofly in a browser (chat.glofly.app, apps/web): what this browser can do. */
export type WebInfo = {
  /** The Glofly server, e.g. https://api.glofly.app (photos and voice messages load from it) */
  apiUrl: string
  /** An Apple device (Mac, iPad, iPhone): shortcuts use ⌘ */
  apple: boolean
  /** A touch screen without a mouse (iPad, tablets) */
  touch: boolean
  /** Screen sharing works in this browser (desktop browsers) */
  screenShare: boolean
  notifications: {
    /** The browser's answer to "Allow notifications?" so far */
    permission: () => 'granted' | 'denied' | 'default' | 'unsupported'
    /** Asks (only from a click). Signs up for notifications with the tab closed if allowed. */
    ask: () => Promise<'granted' | 'denied' | 'default' | 'unsupported'>
    /** Notifications can arrive with every Glofly tab closed (service worker + push) */
    pushSupported: boolean
  }
}

/** 0.7.0 Game overlay (Windows): Settings → Game overlay. */
export type OverlaySettings = {
  enabled: boolean
  /** Opens and closes it (an Electron accelerator from OverlayInfo.keys.open) */
  openKey: string
  /** Mutes your mic during a call (from OverlayInfo.keys.mute), or none */
  muteKey: string | null
  /** The voice widget while closed */
  voice: 'full' | 'photos' | 'talking' | 'off'
  corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  /** How solid its panels are, 40–100 */
  opacity: number
  /** Pop-ups in game (instead of Windows notifications) */
  popups: { messages: boolean; calls: boolean; constellations: boolean; friends: boolean }
  /** Games it stays off in (names as Glofly knows them) */
  offGames: string[]
  /** A chat kept on screen in game */
  pinnedChat: string | null
}
export type OverlayInfo = {
  /** Windows only */
  supported: boolean
  settings: OverlaySettings
  /** Games Glofly has seen you play (for the per-game switches) */
  games: string[]
  keys: { open: string[]; mute: string[] }
}
export type OverlayState = {
  /** Showing over a game (or "Try it") */
  visible: boolean
  /** Opened with the key: takes clicks and typing */
  open: boolean
  /** "Try it" from Settings (over Glofly, no game) */
  preview: boolean
  game: string | null
}
/** The call you're in, as the main window sees it (sent to the overlay). */
export type OverlayVoice = {
  title: string
  kind: 'dm' | 'group' | 'nebula'
  people: {
    id: string
    displayName: string
    avatarVersion: string | null
    speaking: boolean
    muted: boolean
    me: boolean
  }[]
  micOn: boolean
  sharing: boolean
  /** In the call (not still ringing or connecting) */
  connected: boolean
}
export type OverlayToast = {
  key: string
  kind: 'message' | 'call' | 'constellation' | 'friend'
  conversationId: string | null
  title: string
  body: string
  icon: string | null
}
/** Buttons in the overlay, carried out by the main window (where the call is). */
export type OverlayCommand =
  { cmd: 'mute' | 'leave' | 'answer' | 'decline' } | { cmd: 'share-game'; sourceId: string }

export type GloflyApi = {
  /** 'win32' on Windows, 'darwin' on Mac, 'linux' on Linux, 'web' in a browser */
  platform: string
  /** Only in a browser (apps/web). */
  web?: WebInfo
  /** 0.7.0 Game overlay (desktop app on Windows; missing in a browser). */
  overlay?: {
    info: () => Promise<OverlayInfo | null>
    set: (changes: Partial<OverlaySettings>) => Promise<OverlayInfo | null>
    /** Settings → "Try it": shows the overlay over Glofly for a little while */
    preview: (on: boolean) => void
    /** The overlay window: close (back to the game) */
    close: () => void
    /** The overlay window: a button that the main window carries out */
    command: (command: { cmd: 'mute' | 'leave' | 'answer' | 'decline' | 'share-game' }) => void
    /** The main window: the call you're in (or null) */
    sendVoice: (voice: OverlayVoice | null) => void
    onCommand: (listener: (command: OverlayCommand) => void) => () => void
    onState: (listener: (state: OverlayState) => void) => () => void
    onVoice: (listener: (voice: OverlayVoice | null) => void) => () => void
    onToast: (listener: (toast: OverlayToast) => void) => () => void
    onClearToast: (listener: (key: string) => void) => () => void
    onSettings: (listener: (info: OverlayInfo) => void) => () => void
    onProblem: (listener: (message: string) => void) => () => void
  }
  auth: {
    /** 0.7.3: may answer reason 'two_step' (a code was sent: finish with loginCode). */
    login: (request: LoginRequest) => Promise<LoginStepResult>
    /** 0.7.3: the two-step code (or a backup code) for a sign-in that asked for one. */
    loginCode: (challenge: string, code: string) => Promise<LoginStepResult>
    /** 0.7.3: another code, or by the other way ("by email instead"). */
    loginResend: (
      challenge: string,
      method?: TwoStepMethod
    ) => Promise<ApiResult<LoginTwoStep['twoStep']>>
    /** 0.7.3: a QR code to sign in with a phone (keepSignedIn as the checkbox says). */
    qrStart: (keepSignedIn: boolean) => Promise<ApiResult<QrLoginStart>>
    /** 0.7.3: how the QR code is doing; signed in once the phone approves. */
    qrPoll: (id: string, secret: string) => Promise<QrPollResult>
    /** Creates an account and signs it in (kept signed in). */
    register: (request: RegisterRequest) => Promise<RegisterResult>
    /** Live "Available" check. Null if the server can't be reached. */
    checkUsername: (username: string) => Promise<UsernameCheck | null>
    /** Open, invite only or closed (Glofly Control → Sign-ups). Null if the server can't be reached. */
    signupMode: () => Promise<SignupMode | null>
    /** Signs back in with a saved "Keep me signed in" session. Null if there isn't a valid one. */
    restore: () => Promise<SignedInUser | null>
    /** Who's signed in, asked again (0.4.0: picks up "Restricted" changes). Null if unknown. */
    me: () => Promise<SignedInUser | null>
    logout: () => Promise<void>
    /** Emails a reset link if the username or email belongs to an account. */
    forgotPassword: (identifier: string) => Promise<ForgotPasswordResult>
    /** 0.8.0: whose friend invite link this is (no sign-in needed). Null: it doesn't work. */
    friendLinkInfo: (code: string) => Promise<FriendLinkInfo | null>
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
    /** 0.8.0: your invite link (made the first time) and how many joined from it */
    myLink: () => Promise<ApiResult<MyFriendLink>>
    /** 0.8.0: a new invite link; the old one stops working right away */
    resetLink: () => Promise<ApiResult<MyFriendLink>>
    /** 0.8.0: whose invite link this is and what they are to you */
    previewLink: (code: string) => Promise<ApiResult<FriendLinkPreview>>
    /** 0.8.0: become friends with the link's owner */
    acceptLink: (code: string) => Promise<ApiResult<FriendLinkAccepted>>
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
  /**
   * 0.7.3: two-step settings, quiet hours, pins, mark unread and send later: one gateway for
   * those routes only (lib/tools.ts wraps them with their types).
   */
  tools: {
    request: <T = unknown>(
      method: ConstellationMethod,
      path: string,
      body?: unknown
    ) => Promise<ApiResult<T>>
  }
  /** 0.7.3: an error report (Control → Errors). Fire and forget. */
  reportError: (report: ErrorReport) => void
  /** 0.7.3: Settings → Privacy "Send error reports" (the main process's own errors follow it). */
  setErrorReports: (on: boolean) => void
  status: {
    get: () => Promise<ApiResult<MyStatus>>
    /**
     * Change your status and/or custom status (empty text clears it). 0.8.0: `statusClearAfter`
     * + `timeZone` make the custom status clear itself.
     */
    set: (changes: MyStatusChanges) => Promise<ApiResult<MyStatus>>
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
      attachmentIds?: string[],
      /** 0.5.0: a lantern message (fades once everyone else has read it) */
      options?: SendOptions
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
  /** 0.5.0: glows, "Want to hang?", birthdays, Year in Glow. */
  /**
   * 2.0 Constellations and My games: requests to the server's /constellations/… and /games/…
   * routes (lib/constellations.ts wraps them with their types).
   */
  constellations: {
    request: <T = unknown>(
      method: ConstellationMethod,
      path: string,
      body?: unknown
    ) => Promise<ApiResult<T>>
    /** The icon photo, or (0.7.5) the banner photo with `which: 'banner'` */
    setIcon: (
      constellationId: string,
      data: ArrayBuffer,
      type: PhotoType,
      which?: 'icon' | 'banner'
    ) => Promise<ApiResult<{ iconVersion?: string; bannerVersion?: string }>>
  }
  social: {
    get: () => Promise<ApiResult<SocialToday>>
    /** Free to hang for the next hour; tells these friends (null: every friend). */
    hang: (
      userIds: string[] | null
    ) => Promise<ApiResult<{ until: string; with: string[] | null; told: number }>>
    stopHang: () => Promise<ApiResult<null>>
    /** Friends see your birthday (the day, never the year) and get a reminder. */
    shareBirthday: (share: boolean) => Promise<ApiResult<{ share: boolean }>>
    year: () => Promise<ApiResult<YearInGlow>>
  }
  /** 0.5.0 custom stickers (your tray). */
  stickers: {
    list: () => Promise<ApiResult<Sticker[]>>
    /** A photo → a sticker (the server cuts out the background). */
    make: (data: ArrayBuffer) => Promise<ApiResult<Sticker>>
    remove: (id: string) => Promise<ApiResult<null>>
    send: (id: string, conversationId: string, replyToId?: string) => Promise<ApiResult<Message>>
  }
  /** 0.5.0 Broadcast now: your screen (and its sound) for any friend to drop in and watch. */
  broadcasts: {
    start: (title: string | null) => Promise<ApiResult<BroadcastJoin>>
    stop: () => Promise<ApiResult<null>>
    mine: () => Promise<ApiResult<{ broadcast: Broadcast | null; viewers: PublicUser[] }>>
    watch: (userId: string) => Promise<ApiResult<BroadcastJoin>>
  }
  /** 0.5.0 chat extras: GIFs, link previews, polls, mini games and firefly swarms. */
  chat: {
    /** Trending GIFs (empty query) or a search, 24 at a time. */
    gifs: (query: string, offset?: number) => Promise<ApiResult<GifPage>>
    sendGif: (
      conversationId: string,
      gifId: string,
      replyToId?: string
    ) => Promise<ApiResult<Message>>
    /** Takes the link preview off your own message. */
    removePreview: (conversationId: string, messageId: string) => Promise<ApiResult<Message>>
    /** Groups only: 2–6 choices. */
    createPoll: (
      conversationId: string,
      question: string,
      options: string[],
      multi: boolean
    ) => Promise<ApiResult<Message>>
    /** Your choices (an empty list takes your vote back). */
    vote: (
      conversationId: string,
      messageId: string,
      options: number[]
    ) => Promise<ApiResult<Message>>
    closePoll: (conversationId: string, messageId: string) => Promise<ApiResult<Message>>
    startGame: (conversationId: string, kind: ChatGameKind) => Promise<ApiResult<Message>>
    move: (
      conversationId: string,
      messageId: string,
      move: ChatGameMove
    ) => Promise<ApiResult<Message>>
    /** A swarm of fireflies across the chat, for everyone in it. */
    fireflies: (conversationId: string, emoji: FireflyEmoji) => Promise<ApiResult<null>>
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
    /**
     * Calls a friend. Returns the pass to join the call's room right away (it rings meanwhile).
     * `ring` (groups, 0.5.2): only these people are rung; the rest of the group can join.
     */
    start: (conversationId: string, video: boolean, ring?: string[]) => Promise<ApiResult<CallJoin>>
    /** Ringing and ongoing calls in your chats (to show an incoming call after a restart). */
    active: () => Promise<ApiResult<ActiveCall[]>>
    answer: (callId: string) => Promise<ApiResult<CallJoin>>
    /** Joins a group call that's going on, or gets back into yours (restart, moving devices). */
    join: (callId: string) => Promise<ApiResult<CallJoin>>
    /** Group calls: rings people in the group who aren't in the call. */
    ring: (callId: string, userIds: string[]) => Promise<ApiResult<null>>
    /**
     * 0.5.2 Add people: a 1-on-1 call moves to a new group with everyone (nobody drops out); a
     * group call rings them (friends not in the group are added to it first).
     */
    add: (callId: string, userIds: string[]) => Promise<ApiResult<CallAddResult>>
    /** 0.5.2 Group calls: on your own, keep the call going another 7 minutes. */
    stay: (callId: string) => Promise<ApiResult<null>>
    decline: (callId: string) => Promise<ApiResult<null>>
    /** Hangs up (or cancels the call while it's still ringing). */
    leave: (callId: string) => Promise<ApiResult<null>>
    /** Screens and windows that can be shared. */
    screenSources: () => Promise<ScreenSource[]>
    /**
     * Picks what the next screen share shows (the share itself starts in the call). `sound`:
     * Electron's own loopback goes with it (only where screenSound.support() is 'system').
     */
    chooseScreen: (sourceId: string, sound?: boolean) => Promise<boolean>
    /**
     * Mac: whether macOS allows Glofly to record the screen (System Settings → Privacy &
     * Security → Screen & System Audio Recording). Always "granted" on Windows.
     */
    screenAccess: () => Promise<'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'>
    /** 0.5.0: the sound that goes with a shared screen or window (renderer lib/screenSound.ts). */
    screenSound: {
      /**
       * 'app': only the shared window's app, or the whole computer without Glofly (Windows 10
       * 2004+, macOS 14.2+). 'system': everything, Glofly too (older Windows). 'browser': the
       * browser asks. 'none': no sound (older Macs).
       */
      support: () => Promise<ScreenSoundSupport>
      /** Starts listening for a picked screen or window; the sound arrives through onChunk. */
      start: (sourceId: string) => Promise<{ ok: true; format: ScreenSoundFormat } | { ok: false }>
      stop: () => Promise<void>
      /** Interleaved 16-bit (or 32-bit float) PCM, about 20 ms at a time. */
      onChunk: (callback: (pcm: Uint8Array) => void) => () => void
      /** The capture stopped by itself (the app quit, the computer said no). */
      onEnded: (callback: () => void) => () => void
    }
  }
  /** Watch Together (0.5.0): a YouTube video everyone in the call watches at the same moment. */
  watch: {
    /** The server's video player page, shown in a frame (null if refused). */
    playerUrl: () => Promise<string | null>
    /** What a call is watching (anyone in the chat may ask). */
    get: (callId: string) => Promise<ApiResult<WatchUpdate>>
    /** A YouTube link's title, channel and picture (the Start dialog). */
    preview: (link: string) => Promise<ApiResult<WatchPreview>>
    /** Starts (or changes) the video for everyone in the call. */
    start: (callId: string, link: string, control?: WatchControl) => Promise<ApiResult<WatchUpdate>>
    /** Play, pause, skip to `to` seconds, or ±10 s, for everyone. */
    control: (
      callId: string,
      action: WatchControlAction,
      to?: number
    ) => Promise<ApiResult<WatchUpdate>>
    /** Whoever picked the video: Everyone or Only me can control it. */
    settings: (callId: string, control: WatchControl) => Promise<ApiResult<WatchUpdate>>
    /** The player found out how long the video is. */
    report: (
      callId: string,
      videoId: string,
      durationSec: number,
      title?: string
    ) => Promise<ApiResult<null>>
    /** A firefly reaction over the video, for everyone in the call. */
    react: (callId: string, reaction: WatchReaction) => Promise<ApiResult<null>>
    /** Stops watching, for everyone. */
    stop: (callId: string) => Promise<ApiResult<WatchUpdate>>
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
  /**
   * Jump List (Windows taskbar) and Dock menu (Mac) actions. On a `shortcut` event, and once
   * when the signed-in screen is ready (Glofly may have been started by one), call take() and do
   * what it returns: null means it was already done.
   */
  shortcuts: {
    take: () => Promise<ShortcutAction | null>
  }
  /**
   * 0.8.0: glofly:// links (a friend's invite link, a constellation invite). On a `deep-link`
   * event, and once at startup, call take(): null means there's nothing waiting.
   */
  links: {
    take: () => Promise<DeepLink | null>
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
    /** 0.9.0: answer a Glofly Team message that allows replies */
    reply: (noticeId: string, body: string) => Promise<ApiResult<null>>
  }
  /** Set when the server needs a newer Glofly (checked at startup). */
  appStatus: {
    updateRequired: () => Promise<UpdateRequired | null>
    /** 0.4.0: Glofly is paused (Glofly Control), or null */
    paused: () => Promise<Paused | null>
    /** Asks the server right now; null once Glofly is back (the window then gets app:resumed) */
    checkPaused: () => Promise<Paused | null>
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
    /** Windows: paint the minimize / maximize / close buttons to match what's under them (#rrggbb) */
    setTitleBarColor: (color: string, symbolColor: string) => void
    /** Brings Glofly to your attention (an incoming call): shows it if it's in the tray, flashes the taskbar. */
    attention: () => void
  }
}

export type SendOptions = {
  lantern?: boolean
  /** 0.7.5: the same id on a retry, so the server never makes a copy */
  clientId?: string
}
export type GifPage = { gifs: GifInfo[]; next: number | null }
export type ChatGameKind = 'tictactoe' | 'wordguess' | 'trivia'
export type ChatGameMove =
  { square: number } | { word: string } | { question: number; choice: number } | { reveal: true }
