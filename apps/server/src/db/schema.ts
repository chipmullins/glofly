import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userStatus = pgEnum("user_status", ["online", "away", "dnd", "invisible"]);
// Who can send someone friend requests (Settings → General → Privacy).
export const friendRequestsFrom = pgEnum("friend_requests_from", ["everyone", "nobody"]);

export type CallStatus = "ringing" | "ongoing" | "ended" | "missed" | "declined";

/** Something that happened in a chat, shown as a line ("Chip added Maya", "Chip started a video call"). */
export type ChatEvent =
  | { type: "created"; name: string | null }
  | { type: "renamed"; name: string | null }
  | { type: "added"; userIds: string[] }
  | { type: "removed"; userId: string }
  | { type: "left" }
  // 0.2.1: someone set or removed the group photo. Older apps get it as a plain line of text
  // (see legacyEvent in messages/routes.ts).
  | { type: "photo"; removed: boolean }
  // 0.5.0: someone started watching a video together in the call (calls/watch.ts). 0.2.1–0.4.0
  // apps don't know it either, so it travels as `eventLine2` (packages/shared/src/events.ts).
  | { type: "watch"; videoId: string; title: string }
  // 0.5.2 Add people: someone added people to a call (calls/add.ts). 0.5.0–0.5.1 apps don't know
  // it, so it travels as `eventLine3`. `names` are for older apps' plain text; `movedTo` (in a
  // 1-on-1 chat) is the new group the call moved to.
  | { type: "callAdd"; callId: string; userIds: string[]; names: string[]; movedTo: string | null }
  // 0.7.5 Constellations: someone joined (the "Say hi" line) and member milestones / birthdays.
  // Older apps don't know them, so they travel as `eventLine4` with a plain-text body.
  | { type: "cxJoined"; name: string }
  | { type: "cxMilestone"; name: string; members: number | null; years: number | null }
  // A call. The line changes as the call goes: ringing → ongoing → ended (or missed / declined).
  | { type: "call"; callId: string; video: boolean; status: CallStatus; durationSec: number | null };

// One row per Glofly account.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // The unique @handle friends use to find you. Stored as typed, matched case-insensitively.
    username: text("username").notNull(),

    // What friends see in chats. Can be changed anytime.
    displayName: text("display_name").notNull(),

    email: text("email").notNull(),
    // When they proved they own `email` (clicked the link we sent). Null = not confirmed yet.
    // Changing the email sets this again, since the new address is confirmed by its link.
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),

    // Argon2 hash of the password. The real password is never stored.
    passwordHash: text("password_hash").notNull(),

    // Used to confirm the user is at least 13. Never shown on the profile.
    birthday: date("birthday").notNull(),

    // When they agreed to the Terms of Service and Privacy Policy.
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }).notNull(),

    // The status they picked. "invisible" means they appear offline to everyone.
    statusPreference: userStatus("status_preference").notNull().default("online"),
    // Custom status, e.g. "Grinding ranked tonight". Shown to friends while not offline.
    statusText: text("status_text"),
    // Profile photo: a new random version each upload, so apps never show a stale cached photo.
    avatarVersion: text("avatar_version"),
    // "About me" on their profile, up to 190 characters.
    bio: text("bio"),

    // When their last device disconnected. Shown to friends as "Last seen …".
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),

    // Privacy settings (Settings → General → Privacy).
    // Read receipts work both ways: turn them off and you don't see other people's either.
    readReceipts: boolean("read_receipts").notNull().default(true),
    showLastSeen: boolean("show_last_seen").notNull().default(true),
    showTyping: boolean("show_typing").notNull().default(true),
    friendRequests: friendRequestsFrom("friend_requests").notNull().default("everyone"),
    // Settings → Notifications → "Friends coming online" (0.3.0): the master switch for the
    // per-person alerts in online_alerts. On by default; nobody is followed until you pick them.
    onlineAlerts: boolean("online_alerts").notNull().default(true),

    // Set when someone deletes their account: the moment it's permanently removed.
    // Until then the account is hidden, and logging in again offers to restore it.
    deleteAfter: timestamp("delete_after", { withTimezone: true }),

    // Suspended in Glofly Control: every device signed out and logging in refused (showing
    // the reason) until unsuspended. Null = not suspended.
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendReason: text("suspend_reason"),

    // A restricted (family-managed) account (Control → Accounts → Restricted, 0.4.0): for a
    // child, managed by the admin. Can't send or accept friend requests (friends are added in
    // Control), doesn't show up in search, can only be in groups with their own friends, and
    // can't change their email or delete the account. Off for everyone else.
    restricted: boolean("restricted").notNull().default(false),
    // ---- 0.5.0 ----
    // Birthday glow: friends see the day (never the year) and get a reminder. Off unless chosen.
    shareBirthday: boolean("share_birthday").notNull().default(false),
    // "Want to hang?": free for a call until then (null: not right now).
    hangUntil: timestamp("hang_until", { withTimezone: true }),
    // ...and which friends were told (null: every friend). 0.5.0, migration 0028.
    hangWith: jsonb("hang_with").$type<string[]>(),
    // ---- 2.0 ----
    // My games: who can see the games they've played ("everyone" / "friends" / "only_me").
    myGamesVisibility: text("my_games_visibility").notNull().default("friends"),
    // ---- 0.7.3 ----
    // Two-step sign-in: after the password, a 6-digit code by email (and by text once a phone is
    // confirmed). Off unless turned on in Settings → Account.
    twoStep: boolean("two_step").notNull().default(false),
    // The phone number codes can go to (E.164, e.g. +15025550123), once confirmed with a code.
    twoStepPhone: text("two_step_phone"),
    // Quiet hours: no notification sounds or phone notifications between `from` and `to`
    // ("22:00" → "08:00") in their time zone. Null = off.
    quietHours: jsonb("quiet_hours").$type<QuietHoursSetting>(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // "Chip" and "chip" count as the same username / email.
    uniqueIndex("users_username_lower_idx").on(sql`lower(${t.username})`),
    uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// One row per signed-in device. Deleting a row signs that device out.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // SHA-256 of the session token. The token itself only exists on the user's device,
    // so a database leak doesn't hand anyone working sessions.
    tokenHash: text("token_hash").notNull().unique(),

    // true = "Keep me signed in" (30 days, renewed as the app is used); false = 1 day.
    persistent: boolean("persistent").notNull(),

    // e.g. "Glofly Desktop on Windows", for a future "Where you're signed in" list.
    deviceName: text("device_name"),
    // The app version this device last reported (X-Glofly-Version), for Control's
    // "App versions in use". Null = an app from before versions were reported (0.1.7 and older).
    appVersion: text("app_version"),
    // Which app: "android" / "ios" (X-Glofly-Platform). Null = desktop (it doesn't send one).
    platform: text("platform"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export type Session = typeof sessions.$inferSelect;

// Phones that get push notifications (Firebase Cloud Messaging). One per signed-in phone: the
// row belongs to its session, so signing out (anywhere, any way) stops its pushes too.
export const pushDevices = pgTable(
  "push_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .unique()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // "android" or "ios"
    platform: text("platform").notNull(),
    // The phone's push address from Firebase. One phone, one row: a token moves with sign-ins.
    token: text("token").notNull().unique(),
    // "Show message preview" on this phone: off sends "New message" without the text.
    preview: boolean("preview").notNull().default(true),
    // iPhone only: Apple's VoIP push address (PushKit), so a call rings on the lock screen like a
    // phone call (CallKit). Sent straight to Apple, not through Firebase. Null = none / Android.
    voipToken: text("voip_token"),
    // The message sound and ringtone picked on this phone (@glofly/shared PHONE_* ids), for iPhone
    // notifications, which name their sound file. Null = the defaults (older apps). Oct 13.
    messageSound: text("message_sound"),
    ringtone: text("ringtone"),
    // 0.7.0: what this phone's app can show beyond plain chats, e.g. "constellations" (nebula
    // notifications). Empty = an older app, which never gets nebula pushes.
    features: text("features").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_devices_user_id_idx").on(t.userId)],
);

export const emailTokenKind = pgEnum("email_token_kind", [
  "reset_password", // Forgot password: the link lets them choose a new one
  "verify_email", // confirms the address they signed up with
  "change_email", // confirms a new address before it replaces the old one
]);

// One-time links sent by email. Like sessions, only a hash of the token is stored.
export const emailTokens = pgTable(
  "email_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: emailTokenKind("kind").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    // The address the link was sent to (for change_email: the new address).
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Set when the link is used, or replaced by a newer one. A used link never works again.
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("email_tokens_user_kind_idx").on(t.userId, t.kind)],
);

export type EmailTokenKind = (typeof emailTokenKind.enumValues)[number];

export const friendshipStatus = pgEnum("friendship_status", ["pending", "accepted"]);

// One row per pair of people: a pending request or an accepted friendship.
// The pair is stored in a fixed order (lower id first) so each pair can only exist once.
export const friendships = pgTable(
  "friendships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userLow: uuid("user_low")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userHigh: uuid("user_high")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Who sent the request.
    requesterId: uuid("requester_id").notNull(),
    status: friendshipStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // When the request was accepted.
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("friendships_pair_idx").on(t.userLow, t.userHigh),
    index("friendships_user_high_idx").on(t.userHigh),
  ],
);

// Blocked people can't find you in search, send you requests, or (later) message or call you.
export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index("blocks_blocked_idx").on(t.blockedId),
  ],
);

// "nebula" (2.0, Constellations): a nebula's messages. Its members are the constellation's members
// (kept in step by constellations/sync.ts); it never shows in anyone's chat list, and older apps
// never hear about it (messages/routes.ts `summaries`, realtime.ts `emitToUser` modern-only).
export const conversationKind = pgEnum("conversation_kind", ["dm", "group", "nebula"]);

// A chat: a direct message between two friends, or a group chat (up to 25 people).
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: conversationKind("kind").notNull().default("dm"),
  // For direct messages: "lowerId:higherId", so each pair has exactly one DM. Null for groups.
  dmKey: text("dm_key").unique(),
  // Group chats: the name anyone in the group can set (null = shown as members' names).
  name: text("name"),
  // Group chats: the group photo's version (null = the members' faces). Anyone in it can set it.
  photoVersion: text("photo_version"),
  // Group chats: who made it. They can remove people. If they leave, it passes to whoever
  // has been in the group longest.
  createdBy: uuid("created_by").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Used to sort the sidebar: most recent chat first.
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
});

export const conversationMembers = pgTable(
  "conversation_members",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Everything after this is unread for this person.
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
    // When this person pinned the chat to the top of their sidebar (null = not pinned).
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    // Groups page: where this person dragged the group to (lower first). Null = never moved:
    // those sit above the moved ones, newest first.
    groupPosition: integer("group_position"),
    // Muted by this person until then (no sound or notification; mentions still get through).
    // Far in the future = "until I turn it back on". Null = not muted.
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    // When this person closed the chat in their sidebar (history kept). It stays hidden until
    // a message newer than this arrives, or they open it again. Null = not closed.
    closedAt: timestamp("closed_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    // Nebulas only (2.0): this person's notifications for it ("all" / "mentions" / "none").
    // Null = their default for the constellation (constellation_members.notify).
    notifyLevel: text("notify_level"),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index("conversation_members_user_idx").on(t.userId),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    // The message this one replies to, if any. If that message is removed entirely, the link clears.
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => messages.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    // Deleted messages keep their place (so replies still make sense) but lose their text.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // Group events shown as a line in the chat ("Chip renamed the group …"). The sender is
    // who did it; the body is empty. Null for ordinary messages.
    event: jsonb("event").$type<ChatEvent>(),
    // Group members this message @mentions (checked against the group when sent or edited).
    mentions: uuid("mentions").array().notNull().default(sql`'{}'::uuid[]`),
    // ---- 0.5.0 (older apps ignore these; the body carries a plain-text version) ----
    // A GIF from GIPHY: only its id and shape are kept; apps show it from GIPHY's own address.
    gif: jsonb("gif").$type<GifInfo>(),
    // The first link's preview (title, site, picture), made by the server after sending.
    linkPreview: jsonb("link_preview").$type<LinkPreviewInfo>(),
    // A poll (groups): question and options; votes are in poll_votes.
    poll: jsonb("poll").$type<PollInfo>(),
    // A mini game (tic-tac-toe, word guess, trivia): its state, changed by moves.
    game: jsonb("game").$type<GameInfo>(),
    // Lantern messages fade away once everyone else has read them: lanternFadeAt is when.
    lantern: boolean("lantern").notNull().default(false),
    lanternFadeAt: timestamp("lantern_fade_at", { withTimezone: true }),
  },
  // Loading a chat = newest messages in one conversation, so index exactly that.
  // Searching messages = "contains these words": a trigram index keeps that fast.
  (t) => [
    index("messages_conversation_created_idx").on(t.conversationId, t.createdAt, t.id),
    index("messages_body_trgm_idx").using("gin", sql`${t.body} gin_trgm_ops`),
    // "Messages that mention me" (unread mention counts).
    index("messages_mentions_idx").using("gin", t.mentions),
    // Lantern messages still glowing (0.5.0): the few the fading sweep looks at.
    index("messages_lantern_idx")
      .on(t.conversationId, t.createdAt)
      .where(sql`${t.lantern} and ${t.deletedAt} is null`),
    // Someone's own messages (Year in Glow), and removing an account's messages with it.
    index("messages_sender_created_idx").on(t.senderId, t.createdAt),
    // Replies to a message: deleting messages (a group, a nebula) clears the links to them.
    index("messages_reply_to_idx").on(t.replyToId).where(sql`${t.replyToId} is not null`),
    // Search (0.8.0): newest live messages first, so a common word finds a page without
    // sorting every match (messages/search.ts). Built CONCURRENTLY by migrate.ts.
    index("messages_search_recent_idx")
      .on(t.createdAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} is null and ${t.event} is null`),
  ],
);

/** 0.5.0: a GIF in a message (GIPHY's id; apps build its addresses on GIPHY's servers). */
export type GifInfo = { id: string; title: string; width: number; height: number };
/** 0.5.0: a link's preview. `image`: a picture was saved (served by the server, never hotlinked). */
export type LinkPreviewInfo = {
  url: string;
  title: string;
  description: string | null;
  siteName: string | null;
  image: { width: number; height: number } | null;
};
/** 0.5.0: a poll. */
export type PollInfo = { question: string; options: string[]; multi: boolean; closedAt: string | null };
/** 0.5.0: a mini game's state (see messages/games.ts). */
export type GameInfo = { kind: string; [key: string]: unknown };

// 0.5.0 Glows: a streak between two friends who message each other. Each day both write, it
// gets brighter (level 0–5); a missed day dims it by one instead of starting over.
export const glows = pgTable(
  "glows",
  {
    userLow: uuid("user_low")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userHigh: uuid("user_high")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    level: integer("level").notNull().default(0),
    /** Days in a row (or with only dims in between) both wrote */
    days: integer("days").notNull().default(0),
    best: integer("best").notNull().default(0),
    /** The last day (YYYY-MM-DD, Glofly's day) both wrote */
    lastDay: date("last_day"),
    /** Today's progress: who has written today (the day it's for) */
    lowWroteOn: date("low_wrote_on"),
    highWroteOn: date("high_wrote_on"),
  },
  (t) => [primaryKey({ columns: [t.userLow, t.userHigh] })],
);

// 0.5.0 Custom stickers: pictures made in Glofly (background removed), kept for their maker.
export const stickers = pgTable(
  "stickers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stickers_owner_idx").on(t.ownerId, t.createdAt)],
);

// 0.5.0: votes in polls, one row per person per option picked.
export const pollVotes = pgTable(
  "poll_votes",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    option: integer("option").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.option] })],
);

// One row per person per emoji per message.
export const messageReactions = pgTable(
  "message_reactions",
  {
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
);

/** A voice message's length and its waveform (bar heights 0–100). */
export type VoiceInfo = { durationMs: number; peaks: number[] };
/** 0.5.0: a video's length and size (videos are kind "file" with a poster picture beside them). */
export type VideoInfo = { durationMs: number; width: number; height: number; mime: "video/mp4" | "video/quicktime" | "video/webm" };

export const attachmentKind = pgEnum("attachment_kind", ["image", "file"]);

// Photos and files shared in chats. Uploaded first (message_id empty), then attached
// when the message is sent. Unsent uploads are cleaned up after an hour.
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    uploaderId: uuid("uploader_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
    // Order within its message.
    position: integer("position").notNull().default(0),
    kind: attachmentKind("kind").notNull(),
    // The file name as shown (cleaned up: no folders, hidden characters or tricks).
    name: text("name").notNull(),
    // Bytes of what's stored (for photos, the full-size version).
    size: integer("size").notNull(),
    // Photos only: size of the full-size version.
    width: integer("width"),
    height: integer("height"),
    // Voice messages (0.2.1): how long it is and its waveform. They're kind "file", so apps
    // before 0.2.1 show them as a downloadable "Voice message.webm".
    voice: jsonb("voice").$type<VoiceInfo>(),
    // Videos (0.5.0): length, size and type. Kind "file", so older apps offer a download.
    video: jsonb("video").$type<VideoInfo>(),
    // A sticker (0.5.0): a see-through picture shown without a bubble (older apps: a photo).
    sticker: boolean("sticker").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attachments_message_idx").on(t.messageId),
    index("attachments_unsent_idx").on(t.uploaderId, t.createdAt),
    // A chat's files (removing a group, a nebula or a constellation).
    index("attachments_conversation_idx").on(t.conversationId),
  ],
);

export const callStatus = pgEnum("call_status", ["ringing", "ongoing", "ended", "missed", "declined"]);

// Voice and video calls. The audio and video travel through LiveKit (the room is named after
// the call's id); this table is Glofly's record of who called whom and how it went.
export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    // Who started it.
    callerId: uuid("caller_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Started as a video call (true) or a voice call (false). Cameras can still be turned on or off.
    video: boolean("video").notNull(),
    status: callStatus("status").notNull().default("ringing"),
    // The line in the chat ("Chip started a video call"), updated as the call goes.
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    // At most one ringing or ongoing call per chat.
    uniqueIndex("calls_one_active_idx")
      .on(t.conversationId)
      .where(sql`${t.status} in ('ringing', 'ongoing')`),
    index("calls_active_idx").on(t.status).where(sql`${t.status} in ('ringing', 'ongoing')`),
  ],
);

// Everyone a call involves. A row is made when someone is rung (invited_at) or joins on their
// own (group calls). In the call now = joined_at set and left_at empty. Ringing = invited_at
// within the last 23 seconds, not joined, not declined.
export const callParticipants = pgTable(
  "call_participants",
  {
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // When they were last rung (null = joined without being rung).
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    // Pressed Decline (stops ringing on all their devices).
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    // When they last joined (null = never joined, or rung again after leaving: see left_at).
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.callId, t.userId] }),
    index("call_participants_user_idx").on(t.userId),
  ],
);

// ───────────── Glofly Control (admin) ─────────────

export const signupMode = pgEnum("signup_mode", [
  "open", // anyone with the app can sign up
  "invite", // sign-up needs an invite code
  "closed", // no new sign-ups (accounts created in Control still work)
]);

// Server-wide settings changed in Control. One row per setting.
export const serverSettings = pgTable("server_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Codes typed on the sign-up screen while sign-ups are invite only.
export const inviteCodes = pgTable(
  "invite_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // e.g. GLOW-7K2M. Matched case-insensitively (stored upper case).
    code: text("code").notNull().unique(),
    // Who it's for, e.g. "Friday group".
    label: text("label").notNull(),
    maxUses: integer("max_uses").notNull(),
    uses: integer("uses").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // Turned off in Control: stops working at once.
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// Who signed up with which code.
export const inviteCodeUses = pgTable(
  "invite_code_uses",
  {
    codeId: uuid("code_id")
      .notNull()
      .references(() => inviteCodes.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.codeId, t.userId] }), index("invite_code_uses_user_idx").on(t.userId)],
);

// "Create an account for someone": the admin picks the email, username and display name;
// the person finishes on glofly.app/welcome (their own password, birthday, Terms). The
// account itself (a users row) is only made then. Until then, the username and email are
// held for them while the invite is pending.
export const accountInvites = pgTable(
  "account_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    // SHA-256 of the link's token; a resend replaces it (the old link stops working).
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    // Make the inviter and the new account friends when they finish.
    addFriend: boolean("add_friend").notNull().default(true),
    // 0.4.0: the account starts out restricted (family-managed): set up with a parent's consent,
    // so the welcome page takes any real birthday (no 13+ check).
    restricted: boolean("restricted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedUserId: uuid("accepted_user_id").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    index("account_invites_username_idx").on(sql`lower(${t.username})`),
    index("account_invites_email_idx").on(sql`lower(${t.email})`),
  ],
);

// Who can use Control: a Glofly account plus separate admin credentials (its own password
// and an authenticator app). Made with the admin:setup script on the server, never by the API.
export const admins = pgTable("admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  // Argon2id, like account passwords, but a different password from their Glofly one.
  passwordHash: text("password_hash").notNull(),
  // The authenticator secret, encrypted with ADMIN_KEY (AES-256-GCM).
  totpSecret: text("totp_secret").notNull(),
  // The last 30-second step a code was accepted for, so the same code can't be used twice.
  lastTotpStep: integer("last_totp_step").notNull().default(0),
  // SHA-256 of each unused backup code (one use each).
  backupCodes: jsonb("backup_codes").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Signed-in Control windows. Short-lived and tied to the network they signed in from.
export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    ip: text("ip").notNull(),
    deviceName: text("device_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
);

// Everything done in Control. Rows can only be added: the database refuses to change or
// delete them (a trigger in migration 0016). Accounts are referenced by id without a
// foreign key, so entries stay after an account is removed; target_label keeps the name.
export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null for things that happened on their own (e.g. someone finishing their invite).
    adminId: uuid("admin_id"),
    action: text("action").notNull(),
    targetUserId: uuid("target_user_id"),
    // What it was about, as it read then: "@maya.p", "GLOW-7K2M", "Open → Invite only".
    targetLabel: text("target_label"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    // The admin's reason, required for every action.
    note: text("note").notNull().default(""),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("admin_audit_created_idx").on(t.createdAt),
    index("admin_audit_target_idx").on(t.targetUserId),
  ],
);

// ───────────── Reports, warnings and announcements (Glofly Control v2) ─────────────

export const reportReason = pgEnum("report_reason", [
  "spam",
  "harassment", // harassment or bullying
  "hate",
  "sexual",
  "violence", // violence or threats
  "self_harm",
  "other",
]);
export const reportStatus = pgEnum("report_status", ["open", "resolved"]);
export const reportOutcome = pgEnum("report_outcome", ["dismissed", "removed", "warned", "suspended"]);

/** What a report keeps of the conversation, as it was when it was reported. */
export type ReportSnapshot = {
  /** The reported message (null when a person was reported from their profile) */
  message: { id: string; senderId: string; body: string; createdAt: string; attachments: string[] } | null;
  /** Up to 5 messages before and after it, the way the reporter saw them */
  context: { id: string; senderId: string; body: string; createdAt: string; deleted: boolean; attachments: string[] }[];
  /** Names as they were (people can rename or delete their account) */
  people: { id: string; username: string; displayName: string }[];
  chat: { kind: "dm" | "group"; name: string | null } | NebulaReportChat | null;
};
/** 2.0: a reported message in a constellation's nebula. */
export type NebulaReportChat = {
  kind: "nebula";
  name: string;
  constellation: { id: string; name: string };
};

// "Report" in Glofly: a message (from its menu) or a person (from their profile card).
// Reviewed in Glofly Control. Accounts are referenced without foreign keys, so a report
// stays after either account is removed; the snapshot keeps the names.
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id"),
    reportedUserId: uuid("reported_user_id").notNull(),
    conversationId: uuid("conversation_id"),
    messageId: uuid("message_id"),
    reason: reportReason("reason").notNull(),
    details: text("details"),
    snapshot: jsonb("snapshot").$type<ReportSnapshot>().notNull(),
    status: reportStatus("status").notNull().default("open"),
    outcome: reportOutcome("outcome"),
    resolvedBy: uuid("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    // The admin's note when resolving it.
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reports_status_created_idx").on(t.status, t.createdAt),
    index("reports_reported_user_idx").on(t.reportedUserId),
    // One open report per person per message.
    uniqueIndex("reports_one_open_per_message_idx")
      .on(t.reporterId, t.messageId)
      .where(sql`${t.status} = 'open' and ${t.messageId} is not null`),
  ],
);

// Messages from the Glofly team to one person (a warning from Control). Shown in their app
// as a dialog until they press "I understand".
export const userNotices = pgTable(
  "user_notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("warning"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
  },
  (t) => [index("user_notices_user_idx").on(t.userId)],
);

export const announcementTone = pgEnum("announcement_tone", ["info", "important"]);

// The banner at the top of everyone's app. At most one is showing at a time (a new one ends
// the old one). Kept afterwards as a history.
export const announcements = pgTable("announcements", {
  id: uuid("id").primaryKey().defaultRandom(),
  body: text("body").notNull(),
  tone: announcementTone("tone").notNull().default("info"),
  // Optional "Learn more" link (https only).
  linkUrl: text("link_url"),
  linkLabel: text("link_label"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Ends by itself then (null = until ended in Control).
  endsAt: timestamp("ends_at", { withTimezone: true }),
  // Ended early in Control, or replaced by a newer one.
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

// Nicknames (Oct 2026): a name someone gave another person, only they see it. The server swaps it
// in for the person's display name in everything it sends that someone (see profile/nicknames.ts).
export const nicknames = pgTable(
  "nicknames",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nickname: text("nickname").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.targetId] })],
);

// "Notify me when they come online" (0.3.0): the owner gets a notification when the target goes
// from offline to online. Off by default; set per person on their profile.
export const onlineAlerts = pgTable(
  "online_alerts",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetId: uuid("target_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.targetId] }), index("online_alerts_target_idx").on(t.targetId)],
);

// "Invite your friends" (0.3.0): someone emailed a friend a link to join Glofly. Signing up from
// the link (glofly.app/join) makes the two of you friends straight away, even when sign-ups are
// invite-only. The link's token is only stored hashed.
export const friendInvites = pgTable(
  "friend_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // As typed (matched case-insensitively).
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => [index("friend_invites_inviter_idx").on(t.inviterId), index("friend_invites_email_idx").on(sql`lower(${t.email})`)],
);

// ───────────── Constellations (Glofly 2.0) ─────────────
//
// A community: nebulas (text and voice rooms) under categories, members with roles. Everything
// is permission-checked on the server (constellations/perms.ts). Older apps never see any of it.

export const constellationVisibility = pgEnum("constellation_visibility", ["invite", "public", "approval"]);
export const nebulaKind = pgEnum("nebula_kind", ["text", "voice"]);
export const constellationRoleKind = pgEnum("constellation_role_kind", ["admin", "moderator", "member", "custom"]);

export const constellations = pgTable(
  "constellations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    // @glofly/shared ConstellationColor: the banner and the icon's color without a photo.
    color: text("color").notNull().default("ember"),
    // The icon photo's version (a new random one each upload). Null = initials.
    iconVersion: text("icon_version"),
    // The Owner: can do everything, the only one who can transfer ownership or delete it.
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    visibility: constellationVisibility("visibility").notNull().default("invite"),
    // Directory: what kind of community (shared ConstellationType) and up to 5 genre tags.
    type: text("type"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    // Taken down in Glofly Control: hidden from everyone (members see it's gone). Kept for the
    // record until the admin removes it for good. Null = normal.
    takenDownAt: timestamp("taken_down_at", { withTimezone: true }),
    takedownReason: text("takedown_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // The newest message in any of its nebulas (the dashboard's "Quiet since yesterday").
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    // 0.7.5 identity: @glofly/shared ConstellationAccent (null = firefly gold) and the banner
    // photo's version (null = the drawn sky). `color` stays set to the nearest older color.
    accent: text("accent"),
    bannerVersion: text("banner_version"),
    // 0.7.5 welcome: the house rules, and @glofly/shared WelcomeSettings (null = the defaults).
    rules: text("rules").array().notNull().default(sql`'{}'::text[]`),
    welcome: jsonb("welcome"),
    // 0.7.5 celebrations already posted: the highest member milestone and birthday year.
    celebratedMembers: integer("celebrated_members").notNull().default(0),
    celebratedYears: integer("celebrated_years").notNull().default(0),
  },
  (t) => [
    index("constellations_owner_idx").on(t.ownerId),
    // The directory: public ones by name.
    index("constellations_directory_idx").on(t.visibility, t.lastActivityAt).where(sql`${t.visibility} <> 'invite' and ${t.takenDownAt} is null`),
    index("constellations_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
    index("constellations_tags_idx").using("gin", t.tags),
  ],
);

export const constellationRoles = pgTable(
  "constellation_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    // admin / moderator (the starting roles, which can be renamed or deleted), member (everyone's
    // role: can't be deleted, always lowest) or custom.
    kind: constellationRoleKind("kind").notNull().default("custom"),
    name: text("name").notNull(),
    // @glofly/shared RoleColor
    color: text("color").notNull().default("gray"),
    // Higher = more powerful. Member is 0.
    position: integer("position").notNull(),
    // @glofly/shared ConstellationPermission ids
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    // 0.7.5: members can give themselves this role (welcome screen, "Your roles").
    selfAssign: boolean("self_assign").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("constellation_roles_constellation_idx").on(t.constellationId)],
);

export const constellationMembers = pgTable(
  "constellation_members",
  {
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    // Timed out by a moderator until then: can read, can't post, react or talk in voice.
    timedOutUntil: timestamp("timed_out_until", { withTimezone: true }),
    // Their notifications for its nebulas: "all" / "mentions" / "none" (each nebula can differ).
    notify: text("notify").notNull().default("all"),
    // Where they dragged it on the dashboard / icon strip (null = never moved).
    position: integer("position"),
    // 0.7.5: they saw the welcome screen (null = show it; set for everyone already in) and
    // agreed to the house rules.
    welcomedAt: timestamp("welcomed_at", { withTimezone: true }),
    rulesAgreedAt: timestamp("rules_agreed_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.constellationId, t.userId] }),
    index("constellation_members_user_idx").on(t.userId),
  ],
);

// Which roles each member has (besides Member, which everyone has).
export const constellationMemberRoles = pgTable(
  "constellation_member_roles",
  {
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => constellationRoles.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.constellationId, t.userId, t.roleId] }),
    index("constellation_member_roles_role_idx").on(t.roleId),
  ],
);

export const constellationCategories = pgTable(
  "constellation_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [index("constellation_categories_constellation_idx").on(t.constellationId)],
);

// A constellation's channels. Each one has a conversation (kind "nebula") for its messages: text
// nebulas are that chat; a voice nebula's conversation holds its voice room (a call) and its chat.
export const nebulas = pgTable(
  "nebulas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => constellationCategories.id, { onDelete: "set null" }),
    kind: nebulaKind("kind").notNull(),
    name: text("name").notNull(),
    topic: text("topic"),
    position: integer("position").notNull(),
    // Announcements: only people who can manage nebulas or delete messages can post.
    readOnly: boolean("read_only").notNull().default(false),
    conversationId: uuid("conversation_id")
      .notNull()
      .unique()
      .references(() => conversations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("nebulas_constellation_idx").on(t.constellationId)],
);

// Invite links (glofly.app/c/<code>).
export const constellationLinks = pgTable(
  "constellation_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    // Letters and numbers, matched exactly (case matters).
    code: text("code").notNull().unique(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    // Turned off by someone who can invite: stops working at once.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("constellation_links_constellation_idx").on(t.constellationId)],
);

// A friend invited you (shown on your dashboard under Invites).
export const constellationInvites = pgTable(
  "constellation_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    inviteeId: uuid("invitee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // "Not now": hidden from their dashboard (a new invite later shows again).
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("constellation_invites_pair_idx").on(t.constellationId, t.inviteeId),
    index("constellation_invites_invitee_idx").on(t.inviteeId),
  ],
);

// "Public, approval needed": people who asked to join.
export const constellationJoinRequests = pgTable(
  "constellation_join_requests",
  {
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.constellationId, t.userId] })],
);

export const constellationBans = pgTable(
  "constellation_bans",
  {
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bannedBy: uuid("banned_by").references(() => users.id, { onDelete: "set null" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.constellationId, t.userId] })],
);

// Settings → Moderation: what moderators and admins did (kicks, bans, time-outs, deleted
// messages, role changes). Only ever added to.
export const constellationAuditLog = pgTable(
  "constellation_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("constellation_audit_constellation_idx").on(t.constellationId, t.createdAt)],
);

// ───────────── My games (Glofly 2.0) ─────────────

// The games someone has played (from the desktop's "Playing …"), with their total playtime. The
// server adds time every minute while their presence says they're playing. Names are kept as the
// app detected them; `game_key` (lower case, spaces squeezed) merges the same game's spellings.
export const userGames = pgTable(
  "user_games",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gameKey: text("game_key").notNull(),
    name: text("name").notNull(),
    seconds: integer("seconds").notNull().default(0),
    firstPlayedAt: timestamp("first_played_at", { withTimezone: true }).notNull().defaultNow(),
    lastPlayedAt: timestamp("last_played_at", { withTimezone: true }).notNull().defaultNow(),
    // Starred by them: pinned at the top of My games.
    favorite: boolean("favorite").notNull().default(false),
    // Hidden by them: never shown to anyone else (still counted).
    hidden: boolean("hidden").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.gameKey] })],
);

// Glofly 2.0: nebulas someone pinned to the dock on Glofly home ("Pin to Glofly dock"), in their order.
export const nebulaPins = pgTable(
  "nebula_pins",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nebulaId: uuid("nebula_id")
      .notNull()
      .references(() => nebulas.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.nebulaId] })],
);

// ---------------------------------------------------------------------------------------------
// 0.7.3

export type QuietHoursSetting = {
  /** "HH:MM", 24-hour */
  from: string
  to: string
  /** IANA time zone, e.g. "America/New_York" */
  tz: string
  /** Calls still ring during quiet hours */
  calls: boolean
}

// Two-step sign-in backup codes (one-time, for when email and texts can't be reached). Only the
// hash of each code is kept. A new set replaces the old one.
export const twoStepBackupCodes = pgTable(
  "two_step_backup_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("two_step_backup_codes_user_idx").on(t.userId)],
);

// Devices an account has signed in from (a hash of the device's name and app), so "New sign-in to
// your Glofly account" is only emailed for a device not seen before.
export const knownDevices = pgTable(
  "known_devices",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceKey: text("device_key").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deviceKey] })],
);

// Pinned messages in a chat (a DM, a group or a nebula), newest pin first.
export const pinnedMessages = pgTable(
  "pinned_messages",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    pinnedBy: uuid("pinned_by").references(() => users.id, { onDelete: "set null" }),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.messageId] })],
);

// "Send later": a text message waiting for its time. Sent by the server's sweep (scheduled.ts)
// exactly as if typed then; only its writer sees it before that.
export const scheduledMessages = pgTable(
  "scheduled_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    replyToId: uuid("reply_to_id").references(() => messages.id, { onDelete: "set null" }),
    sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
    // Why it couldn't be sent at its time (no longer allowed in that chat). Null = waiting.
    failed: text("failed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("scheduled_messages_due_idx").on(t.sendAt).where(sql`${t.failed} is null`),
    index("scheduled_messages_sender_idx").on(t.senderId, t.conversationId),
  ],
);

// Error reports from the apps (Control → Errors). One row per distinct problem and app version;
// the same error again only bumps its count. No message text, no passwords: just what broke, where.
export const appErrors = pgTable(
  "app_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Hash of app + version + the error's first line + where it happened.
    fingerprint: text("fingerprint").notNull().unique(),
    app: text("app").notNull(), // "desktop" / "web" / "android" / "ios" / "server" / "control"
    appVersion: text("app_version"),
    os: text("os"),
    message: text("message").notNull(),
    stack: text("stack"),
    // Which screen or action ("chat", "call", "watch"…)
    where: text("where"),
    count: integer("count").notNull().default(1),
    // How many different accounts hit it (approximate: the last few are remembered)
    userIds: uuid("user_ids").array().notNull().default(sql`'{}'::uuid[]`),
    firstAt: timestamp("first_at", { withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
    // Marked fixed in Control. Happening again in a newer version opens it again.
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("app_errors_last_idx").on(t.lastAt)],
);

// ---------------------------------------------------------------------------------------------
// 0.8.0 Constellations community tools (approved Oct 20 boards 13, 14, 15)

// AutoMod lite: one row per constellation that turned something on (no row = all off).
export const constellationAutomod = pgTable("constellation_automod", {
  constellationId: uuid("constellation_id")
    .primaryKey()
    .references(() => constellations.id, { onDelete: "cascade" }),
  wordsOn: boolean("words_on").notNull().default(false),
  // Stored as cleaned by @glofly/shared cleanBlockedWord (lower case, `*` = any letters).
  words: text("words").array().notNull().default(sql`'{}'::text[]`),
  linkGuardOn: boolean("link_guard_on").notNull().default(false),
  slowModeOn: boolean("slow_mode_on").notNull().default(false),
  // nebulaId → seconds between someone's messages there
  slowMode: jsonb("slow_mode").$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
  // New members can post after this many minutes (0 = off)
  newMemberWaitMinutes: integer("new_member_wait_minutes").notNull().default(0),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Messages AutoMod held back (a blocked word, or link spam). Nobody sees them unless a moderator
// presses Undo in the moderation log, which posts them as the sender would have.
export const automodHeld = pgTable(
  "automod_held",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    replyToId: uuid("reply_to_id").references(() => messages.id, { onDelete: "set null" }),
    // "word" or "links"; `detail` = the blocked word, or which rule the links broke
    reason: text("reason").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Undo: let through by a moderator (the message it became), or null while held
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: uuid("released_by").references(() => users.id, { onDelete: "set null" }),
    releasedMessageId: uuid("released_message_id").references(() => messages.id, { onDelete: "set null" }),
  },
  (t) => [index("automod_held_constellation_idx").on(t.constellationId, t.createdAt)],
);

// Events with RSVP. The card is a message in a text nebula (its plain text works in older apps);
// the event itself lives here, with who's going.
export const constellationEvents = pgTable(
  "constellation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    nebulaId: uuid("nebula_id")
      .notNull()
      .references(() => nebulas.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    voiceNebulaId: uuid("voice_nebula_id").references(() => nebulas.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    // IANA zone it was planned in ("8:30 PM Eastern" in the plain-text card)
    timeZone: text("time_zone"),
    hostId: uuid("host_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    // The sweep's marks: reminder sent 15 minutes before; started
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
  },
  (t) => [
    index("constellation_events_constellation_idx").on(t.constellationId, t.startsAt),
    index("constellation_events_due_idx").on(t.startsAt).where(sql`${t.cancelledAt} is null and ${t.startedAt} is null`),
  ],
);

export const constellationEventRsvps = pgTable(
  "constellation_event_rsvps",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => constellationEvents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // "going" / "maybe" / "no"
    answer: text("answer").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] }), index("constellation_event_rsvps_user_idx").on(t.userId)],
);

// The Inbox: items someone marked read one by one, and when they last pressed "Mark all read".
export const inboxReads = pgTable(
  "inbox_reads",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemKey: text("item_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemKey] })],
);

export const inboxState = pgTable("inbox_state", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  clearedAt: timestamp("cleared_at", { withTimezone: true }).notNull().defaultNow(),
});
