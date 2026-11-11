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
import type { Crosspost, ForwardedFrom, LiveCard, OnboardingSettings } from "@glofly/shared";

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
    // 0.8.0: when the custom status clears itself (null = stays until they change it). Cleared
    // by the status sweep (index.ts) and ignored once past wherever status is read for others.
    statusTextExpiresAt: timestamp("status_text_expires_at", { withTimezone: true }),
    // Profile photo: a new random version each upload, so apps never show a stale cached photo.
    avatarVersion: text("avatar_version"),
    // "About me" on their profile, up to 190 characters.
    bio: text("bio"),
    // ---- 0.9.1 profiles (migration 0052) ----
    // Pronouns shown next to their name (up to 40 characters).
    pronouns: text("pronouns"),
    // Header image on their profile card (a new random version each upload), and how far down
    // the picture is shown (0 = top, 100 = bottom).
    headerVersion: text("header_version"),
    headerFocus: integer("header_focus").notNull().default(50),
    // The board: up to 6 tiles (shared BoardTile[]); null = never set.
    profileBoard: jsonb("profile_board").$type<unknown[]>(),
    // Who sees the board / activity / mutuals (shared ProfilePrivacy); null = the defaults.
    profilePrivacy: jsonb("profile_privacy").$type<Record<string, string>>(),

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
    // Oct 30, 2026 (migration 0040): who "Friends coming online" covers: all friends, only the ones
    // picked with the bell ("selected", the default and the behavior before), or nobody. online_alerts
    // above is kept in step for older apps (false exactly when this is "none").
    onlineAlertsMode: text("online_alerts_mode").$type<"all" | "selected" | "none">().notNull().default("selected"),
    // 0.8.3: show glows (the firefly + day count by a friend's name). Off unless you turn it on
    // (people kept asking what the number meant). Glows still count in the background.
    showGlows: boolean("show_glows").notNull().default(false),

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
    // Communities round (Nov 2026): a constellation's bot (Integrations → API keys). Bots never
    // sign in (no usable password, login refuses them), never show up in search or friends, and
    // are only ever members of their one constellation.
    bot: boolean("bot").notNull().default(false),
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
    // 0.9.3: friends whose "went live" alerts they muted (Twitch / Kick linking).
    mutedLiveAlerts: uuid("muted_live_alerts").array().notNull().default(sql`'{}'::uuid[]`),
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
    // 0.8.0: the status sweep only looks at statuses that have an end.
    index("users_status_text_expires_idx")
      .on(t.statusTextExpiresAt)
      .where(sql`${t.statusTextExpiresAt} is not null`),
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
    // Communities round (Nov 2026): buttons under a bot's message (Integrations). Clicking one
    // tells the bot (its interactions address); the body stays plain text for older apps.
    buttons: jsonb("buttons").$type<{ id: string; label: string; style: "primary" | "secondary" | "danger" }[]>(),
    // Lantern messages fade away once everyone else has read them: lanternFadeAt is when.
    lantern: boolean("lantern").notNull().default(false),
    lanternFadeAt: timestamp("lantern_fade_at", { withTimezone: true }),
    // 0.9.3: a forwarded message: whose words and where they came from (the body is their text).
    forwarded: jsonb("forwarded").$type<ForwardedFrom>(),
    // 0.9.3: a constellation's Live alert (the body + link preview are what older apps show)
    liveCard: jsonb("live_card").$type<LiveCard>(),
    // Communities round 2: the custom emoji its text and reactions use (`:name:` → picture).
    emojis: jsonb("emojis").$type<{ id: string; name: string; animated: boolean }[]>(),
    // Communities round 2: a copy of a followed announcement (forwarded is set too, for older apps).
    crosspost: jsonb("crosspost").$type<Crosspost>(),
    // Communities round (Nov 2026): a reply in a thread or forum post (nebulas only). Thread
    // replies stay out of the nebula's own timeline unless alsoInNebula ("Also send to #general").
    threadId: uuid("thread_id").references((): AnyPgColumn => nebulaThreads.id, { onDelete: "cascade" }),
    alsoInNebula: boolean("also_in_nebula").notNull().default(false),
    // Communities round 4.2 (board 24): "@everyone" / "@here" and the roles a nebula message
    // mentions (only when its sender may: checked on the server), and who those reached: the
    // people it counts as mentioning (minus anyone who ignores them). groupMentions never leaves
    // the server (apps learn from the first two whether it mentions them).
    mentionEveryone: text("mention_everyone"),
    mentionRoles: uuid("mention_roles").array().notNull().default(sql`'{}'::uuid[]`),
    groupMentions: uuid("group_mentions").array().notNull().default(sql`'{}'::uuid[]`),
  },
  // Loading a chat = newest messages in one conversation, so index exactly that.
  // Searching messages = "contains these words": a trigram index keeps that fast.
  (t) => [
    index("messages_conversation_created_idx").on(t.conversationId, t.createdAt, t.id),
    index("messages_body_trgm_idx").using("gin", sql`${t.body} gin_trgm_ops`),
    // "Messages that mention me" (unread mention counts).
    index("messages_mentions_idx").using("gin", t.mentions),
    index("messages_group_mentions_idx").using("gin", t.groupMentions),
    // Lantern messages still glowing (0.5.0): the few the fading sweep looks at.
    index("messages_lantern_idx")
      .on(t.conversationId, t.createdAt)
      .where(sql`${t.lantern} and ${t.deletedAt} is null`),
    // Someone's own messages (Year in Glow), and removing an account's messages with it.
    index("messages_sender_created_idx").on(t.senderId, t.createdAt),
    // Replies to a message: deleting messages (a group, a nebula) clears the links to them.
    index("messages_reply_to_idx").on(t.replyToId).where(sql`${t.replyToId} is not null`),
    index("messages_thread_idx").on(t.threadId, t.createdAt).where(sql`${t.threadId} is not null`),
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
    // 0.8.2: a session started on an approved phone (Control for iPhone). Such a session isn't tied
    // to a network: every request must be signed by that phone's key instead (admin/devices.ts).
    deviceId: uuid("device_id").references((): AnyPgColumn => adminDevices.id, { onDelete: "cascade" }),
  },
);

// 0.8.2: phones approved for Glofly Control (Control for iPhone). Approved once from the home
// network with a code from desktop Control; afterwards the phone signs every request with its own
// key (ECDSA P-256; only the public half is kept here), so it works from anywhere.
export const adminDevices = pgTable(
  "admin_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => admins.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // The raw public key (65 bytes, uncompressed point), base64url.
    publicKey: text("public_key").notNull(),
    // Apple push token for alerts ("<hex>", or "sandbox:<hex>" for development builds).
    pushToken: text("push_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastIp: text("last_ip"),
    // Oct 28, 2026: Face ID sign-in. After a password + code sign-in the phone keeps a secret (its
    // hash here) that, signed with the phone's key, starts a new session until remember_until
    // (14 days after that sign-in; then the password and code again).
    rememberHash: text("remember_hash"),
    rememberUntil: timestamp("remember_until", { withTimezone: true }),
  },
  (t) => [index("admin_devices_admin_idx").on(t.adminId)],
);

// 0.8.2: what Control alerted the admin about (pushes to the phone, desktop notifications, the
// "Recent alerts" lists). Kept 30 days.
export const adminAlerts = pgTable(
  "admin_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: jsonb("data").$type<Record<string, string>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("admin_alerts_created_idx").on(t.createdAt)],
);

// 0.8.2: the server's ups and downs (Control → Server → Uptime). "outage" = it stopped answering by
// itself; "restart" = restarted from Control; "pause" = Glofly paused from Control.
export const uptimeEvents = pgTable(
  "uptime_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    details: jsonb("details").$type<Record<string, unknown>>(),
  },
  (t) => [index("uptime_events_started_idx").on(t.startedAt)],
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
    // "warning" (from a report) or, 0.8.2, "message" (Control → Message as Glofly team).
    kind: text("kind").notNull().default("warning"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    // 0.8.2: they may answer it (their reply goes to Control → Inbox), and which admin sent it.
    allowReply: boolean("allow_reply").notNull().default(false),
    sentBy: uuid("sent_by"),
  },
  (t) => [index("user_notices_user_idx").on(t.userId)],
);

// 0.8.2: answers to a Glofly Team message (Control → Inbox).
export const teamReplies = pgTable(
  "team_replies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noticeId: uuid("notice_id")
      .notNull()
      .references(() => userNotices.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // When the admin opened it in Control.
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [index("team_replies_user_idx").on(t.userId, t.createdAt), index("team_replies_unread_idx").on(t.createdAt).where(sql`${t.readAt} is null`)],
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

// 0.8.0 shareable friend invite links (glofly.app/i/<code>, friends/links.ts): one personal code
// per account, made the first time it's asked for. Reset replaces the code (the old one is dead at
// once). Signing up from it, or opening it while signed in, makes you friends with its owner.
export const friendLinks = pgTable("friend_links", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // `chip-7Kq4mZ` (shared FRIEND_LINK_PATTERN). Matched exactly.
  code: text("code").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Everyone who became friends through someone's link: "3 friends joined from your link" (counted
// for the current code) and the daily cap per link owner.
export const friendLinkUses = pgTable(
  "friend_link_uses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The code they used (the count only counts the current one).
    code: text("code").notNull(),
    // True when they made their account from the link (false: added while signed in).
    signedUp: boolean("signed_up").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("friend_link_uses_inviter_idx").on(t.inviterId, t.createdAt),
    index("friend_link_uses_code_idx").on(t.code),
  ],
);

// ───────────── Constellations (Glofly 2.0) ─────────────
//
// A community: nebulas (text and voice rooms) under categories, members with roles. Everything
// is permission-checked on the server (constellations/perms.ts). Older apps never see any of it.

export const constellationVisibility = pgEnum("constellation_visibility", ["invite", "public", "approval"]);
// Communities round (Nov 2026): "forum" (posts with titles and tags; each post is a thread).
export const nebulaKind = pgEnum("nebula_kind", ["text", "voice", "forum", "stage", "announcement"]);
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
    // 0.8.2, Control: frozen = members can read but nobody can post or join until it's unfrozen;
    // invites off = its invite links stop working and no new ones can be made.
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    // Communities round: the "Glofly" member the built-in tools post as (made on first use).
    toolBotId: uuid("tool_bot_id"),
    // Communities round 4.3 (approved boards 25–28): questions new members answer after the
    // welcome screen (@glofly/shared OnboardingSettings; null = never set up).
    onboarding: jsonb("onboarding").$type<OnboardingSettings>(),
    invitesOffAt: timestamp("invites_off_at", { withTimezone: true }),
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
    // 0.9.3: owners can stop members forwarding its messages to other chats.
    forwardingOff: boolean("forwarding_off").notNull().default(false),
    // Communities round 2 (Night watch, board 1d): @glofly/shared SafetySettings (null = the
    // defaults: raid protection and the mention cap on, verification off), and the raid state:
    // joins paused until then, and when the last raid was noticed.
    safety: jsonb("safety"),
    joinsPausedUntil: timestamp("joins_paused_until", { withTimezone: true }),
    raidAt: timestamp("raid_at", { withTimezone: true }),
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
    // Communities round 4.2 (board 24): anyone can @mention this role (people with "Mention
    // @everyone, @here and all roles" always can).
    mentionable: boolean("mentionable").notNull().default(false),
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
    // 0.9.3: pinned to their desktop sidebar (its place among their pins; null = not pinned).
    sidebarPin: integer("sidebar_pin"),
    // 0.7.5: they saw the welcome screen (null = show it; set for everyone already in) and
    // agreed to the house rules.
    welcomedAt: timestamp("welcomed_at", { withTimezone: true }),
    rulesAgreedAt: timestamp("rules_agreed_at", { withTimezone: true }),
    // Communities round 4.2 (board 23): the constellation's notification window. Muted until then
    // (no sounds, pop-ups or badges; @mentions of you still get through; year 9999 = until I turn
    // it on); @everyone/@here and role mentions don't notify; replies in followed trails and
    // signals notify (by the level above).
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    ignoreEveryone: boolean("ignore_everyone").notNull().default(false),
    ignoreRoles: boolean("ignore_roles").notNull().default(false),
    followAlerts: boolean("follow_alerts").notNull().default(true),
    // Communities round 4.3: their onboarding answers ({ questionId: answerIds }), when they
    // finished it (null = ask after the welcome screen), and the optional nebulas they picked.
    onboardingAnswers: jsonb("onboarding_answers").$type<Record<string, string[]>>().notNull().default({}),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    shownNebulas: uuid("shown_nebulas").array().notNull().default(sql`'{}'::uuid[]`),
    // Communities round 2: joined during a raid; their messages wait for a moderator (raidHold).
    raidHold: boolean("raid_hold").notNull().default(false),
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
    // 0.8.0 role-only: "everyone" or "roles" (only people with one of role_ids, plus the Owner and
    // roles that can manage nebulas). A role-only category gates every nebula inside it.
    visibility: text("visibility").notNull().default("everyone"),
    roleIds: uuid("role_ids").array().notNull().default(sql`'{}'::uuid[]`),
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
    // 0.8.0 role-only nebulas: "everyone" or "roles" (see constellation_categories). Who can see it
    // is kept in its conversation's members (constellations/access.ts syncNebulaAccess).
    visibility: text("visibility").notNull().default("everyone"),
    roleIds: uuid("role_ids").array().notNull().default(sql`'{}'::uuid[]`),
    // Communities round (Glofly tools): people who see it whatever their roles (a ticket's opener).
    userIds: uuid("user_ids").array().notNull().default(sql`'{}'::uuid[]`),
    // Communities round 4.3: with onboarding on, an "optional" nebula for everyone is only seen
    // by people who picked it (an answer or Browse nebulas; constellation_members.shown_nebulas).
    optional: boolean("optional").notNull().default(false),
    // Communities round: threads + forums. Who may start threads (text nebulas), how long a quiet
    // thread or post stays open, and a forum's tags, guidelines, required tag and default sort.
    threadsStaffOnly: boolean("threads_staff_only").notNull().default(false),
    threadCloseDays: integer("thread_close_days").notNull().default(7),
    forumTags: jsonb("forum_tags").$type<{ id: string; name: string; color: string; staffOnly: boolean }[]>().notNull().default(sql`'[]'::jsonb`),
    forumGuidelines: text("forum_guidelines"),
    forumRequireTag: boolean("forum_require_tag").notNull().default(false),
    forumSort: text("forum_sort").notNull().default("activity"),
    // Communities round 2: a stage nebula's speaker limit (each stage starts with it).
    stageSpeakerLimit: integer("stage_speaker_limit").notNull().default(25),
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
    // Communities round 2 (board 1c): appeals "now" / "later" (after 7 days) / "never".
    appeals: text("appeals").notNull().default("now"),
  },
  (t) => [primaryKey({ columns: [t.constellationId, t.userId] })],
);

// Communities round 2 (boards 2a–2c): a constellation's own emoji and stickers. Pictures are in
// storage at emoji/<constellation>/<id>.webp, cleaned like every upload (re-saved, no metadata).
export const constellationEmoji = pgTable(
  "constellation_emoji",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // "emoji" | "sticker"
    name: text("name").notNull(),
    animated: boolean("animated").notNull().default(false),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    // Members can use it outside the constellation (DMs, groups, other constellations).
    outside: boolean("outside").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("constellation_emoji_idx").on(t.constellationId, t.kind, t.createdAt),
    uniqueIndex("constellation_emoji_name_idx").on(t.constellationId, sql`lower(${t.name})`).where(sql`${t.kind} = 'emoji'`),
  ],
);

// Communities round 2 (board 1c): a banned person asking the moderators to reconsider. One per
// ban at a time; another 30 days after a "no". Moderators see their name and this message only.
export const constellationAppeals = pgTable(
  "constellation_appeals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The ban it's about (bans have no id: its time tells a later ban apart).
    banCreatedAt: timestamp("ban_created_at", { withTimezone: true }).notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("open"),
    reply: text("reply"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("constellation_appeals_queue_idx").on(t.constellationId, t.status, t.createdAt),
    index("constellation_appeals_user_idx").on(t.userId, t.constellationId),
  ],
);

// Communities round 2 (board 1a): nebula messages members reported to the constellation's
// moderators (Night watch → Reports). One open report per message; more people reporting it add
// to `reporter_ids`. `excerpt` is the message as first reported (kept 180 days, like the mod log).
export const constellationReports = pgTable(
  "constellation_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    reportedUserId: uuid("reported_user_id").references(() => users.id, { onDelete: "set null" }),
    reporterIds: uuid("reporter_ids").array().notNull().default(sql`'{}'::uuid[]`),
    reason: text("reason").notNull(),
    excerpt: text("excerpt").notNull(),
    status: text("status").notNull().default("open"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    outcome: text("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("constellation_reports_queue_idx").on(t.constellationId, t.status, t.createdAt),
    uniqueIndex("constellation_reports_open_message_idx").on(t.messageId).where(sql`${t.status} = 'open'`),
  ],
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
  (t) => [
    index("constellation_audit_constellation_idx").on(t.constellationId, t.createdAt),
    // Communities round 2: the mod log's filters (one member, one kind of action).
    index("constellation_audit_target_idx").on(t.constellationId, t.targetUserId, t.createdAt),
    index("constellation_audit_action_idx").on(t.constellationId, t.action, t.createdAt),
  ],
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
    // 0.9.3 Steam linking: the game's Steam app id and Steam's own playtime (all computers).
    // My games shows the larger of the two, so nothing is counted twice. Cleared on unlink.
    steamAppId: integer("steam_app_id"),
    steamSeconds: integer("steam_seconds").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.gameKey] })],
);

// 0.9.3: accounts linked in Settings → Connections (Steam, Twitch, Kick). Only the other site's
// id and name are kept (never a password or a sign-in token). One Glofly account per outside
// account, one outside account per site per Glofly account.
export const linkedAccounts = pgTable(
  "linked_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    // Their name there (Steam persona, Twitch / Kick login) and display name.
    login: text("login").notNull(),
    displayName: text("display_name").notNull(),
    profileUrl: text("profile_url"),
    // @glofly/shared ConnectionSettings
    settings: jsonb("settings").notNull().default({}),
    // Twitch / Kick: live right now (title, game, started) or null.
    live: jsonb("live"),
    // Steam: games last synced, and how many.
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    gameCount: integer("game_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("linked_accounts_user_provider_idx").on(t.userId, t.provider),
    uniqueIndex("linked_accounts_external_idx").on(t.provider, t.externalId),
  ],
);

// 0.9.3: channels Glofly listens to for "went live" (Twitch EventSub, Kick webhooks) or new videos
// (YouTube WebSub), for linked accounts and constellation Live alerts. One row per channel.
export const streamWatches = pgTable(
  "stream_watches",
  {
    provider: text("provider").notNull(),
    channelId: text("channel_id").notNull(),
    // The other site's subscription ids (to cancel them), and when they need renewing (YouTube).
    subscriptionIds: text("subscription_ids").array().notNull().default(sql`'{}'::text[]`),
    renewAt: timestamp("renew_at", { withTimezone: true }),
    // Live right now (title, game, started, thumbnail) or null.
    live: jsonb("live"),
    // YouTube: the newest video ids already announced (so a repeat notice isn't posted twice).
    seen: text("seen").array().notNull().default(sql`'{}'::text[]`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.channelId] })],
);

// 0.9.1: box art from IGDB, one row per game (by Glofly's game key, the name in lower case). Looked
// up by the server only (games/igdb.ts); igdb_id null = looked up and nothing matched (tried again
// after 30 days). cover_id is IGDB's image id; the picture is fetched, re-saved and served by Glofly.
export const gameArt = pgTable("game_art", {
  gameKey: text("game_key").primaryKey(),
  igdbId: integer("igdb_id"),
  name: text("name").notNull(),
  coverId: text("cover_id"),
  year: integer("year"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    // Communities round 2: "Keep hidden" in Night watch (out of the queue, never posted).
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    dismissedBy: uuid("dismissed_by").references(() => users.id, { onDelete: "set null" }),
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

// Oct 28, 2026 (Control → Insights): which days each person used Glofly, in Glofly's time zone
// (GLOFLY_TIME_ZONE), and the first app they used that day. Written once a day per person
// (activity.ts). Daily/weekly/monthly active people and "came back after N days" come from here.
export const activeDays = pgTable(
  "active_days",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    // "desktop" / "web" / "ios" / "android"
    platform: text("platform").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] }), index("active_days_day_idx").on(t.day)],
);

// ───────────── Communities round (Nov 2026): constellation Integrations ─────────────

// API keys for bots and game servers. A key works for its one constellation only and acts as its
// bot (a users row with bot = true, a member with a role, so the usual rank rules apply). Only the
// SHA-256 of the key is stored (like sessions); the key is shown once when made or reset.
export const constellationApiKeys = pgTable(
  "constellation_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    botUserId: uuid("bot_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // "gfk_" + the key's first 8 characters, for the list ("gfk_7Hq2kRZp••••••••").
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    // shared INTEGRATION_SCOPES ids
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    postNebulaIds: uuid("post_nebula_ids").array().notNull().default(sql`'{}'::uuid[]`),
    readNebulaIds: uuid("read_nebula_ids").array().notNull().default(sql`'{}'::uuid[]`),
    // Empty = from anywhere. Exact addresses (IPv4 or IPv6), compared as the server sees them.
    allowedIps: text("allowed_ips").array().notNull().default(sql`'{}'::text[]`),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resetAt: timestamp("reset_at", { withTimezone: true }),
    // Written at most once a minute per key.
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastUsedIp: text("last_used_ip"),
    // Where Glofly tells the bot about slash commands and button clicks (https, set by the bot
    // through the API), and the secret those deliveries are signed with (kept to sign them).
    interactionsUrl: text("interactions_url"),
    interactionsSecret: text("interactions_secret"),
  },
  (t) => [
    uniqueIndex("constellation_api_keys_hash_idx").on(t.keyHash),
    index("constellation_api_keys_constellation_idx").on(t.constellationId),
  ],
);

// Integrations → Activity: every use of a key and every change to one. Kept 30 days.
export const integrationActivity = pgTable(
  "integration_activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    keyId: uuid("key_id").references(() => constellationApiKeys.id, { onDelete: "set null" }),
    // The key's name when it happened (the key may be gone later).
    keyName: text("key_name"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    details: jsonb("details").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("integration_activity_constellation_idx").on(t.constellationId, t.createdAt),
    index("integration_activity_created_idx").on(t.createdAt),
  ],
);

// Integrations → Webhooks. Incoming: a secret address that posts into one nebula as its own bot
// (only the SHA-256 of the address's token is stored). Outgoing: Glofly tells a server about
// constellation events (never message contents), signed with HMAC-SHA256 (`Glofly-Signature`).
export const constellationWebhooks = pgTable(
  "constellation_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    // "incoming" | "outgoing"
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    // incoming: the nebula it posts in and the bot it posts as
    nebulaId: uuid("nebula_id").references(() => nebulas.id, { onDelete: "cascade" }),
    botUserId: uuid("bot_user_id").references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash"),
    // outgoing: where events go, which ones, and the signing secret (kept to sign each delivery)
    url: text("url"),
    events: text("events").array().notNull().default(sql`'{}'::text[]`),
    signingSecret: text("signing_secret"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    // outgoing: the last delivery's HTTP status (0 = no answer) and failures in a row
    lastStatus: integer("last_status"),
    failures: integer("failures").notNull().default(0),
    // outgoing: switched off after too many failures in a row (the page offers to turn it on)
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (t) => [
    index("constellation_webhooks_constellation_idx").on(t.constellationId, t.kind),
    uniqueIndex("constellation_webhooks_token_idx").on(t.tokenHash),
  ],
);

// Slash commands a constellation's bots added (Integrations; scope "commands"). Shown in the
// message box's / menu to members. Running one posts the member's own message ("/whitelist apply")
// and tells the bot (its interactions address), which answers through the API.
export const constellationCommands = pgTable(
  "constellation_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    keyId: uuid("key_id")
      .notNull()
      .references(() => constellationApiKeys.id, { onDelete: "cascade" }),
    // lower case letters, digits and - (the shared COMMAND_NAME pattern), without the /
    name: text("name").notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("constellation_commands_name_idx").on(t.constellationId, t.name)],
);

// ───────────── Communities round (Nov 2026): Sign in with Glofly (OAuth 2.0 + OpenID Connect) ─────────────

// Apps people can sign in to with Glofly, registered by developers (Settings → Developer).
// Confidential apps (a server) have a client secret (SHA-256 stored, shown once); public apps
// (phone apps, single-page sites) have none and must use PKCE. Every app must use PKCE anyway.
export const oauthApps = pgTable(
  "oauth_apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // "gfa_" + 12 characters: what the app sends as client_id
    clientId: text("client_id").notNull(),
    // Who made it in Settings → Developer (before 0.9.0); null for apps made in Glofly Control.
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    website: text("website"),
    // The app's own privacy policy and terms (https), linked on the consent page (communities release)
    privacyUrl: text("privacy_url"),
    termsUrl: text("terms_url"),
    // Which Glofly Developer Terms its maker agreed to, and when (null: made before they existed)
    devTermsVersion: text("dev_terms_version"),
    devTermsAcceptedAt: timestamp("dev_terms_accepted_at", { withTimezone: true }),
    // Exact return addresses (https, or a custom scheme like gloslate:// for phone apps)
    redirectUris: text("redirect_uris").array().notNull().default(sql`'{}'::text[]`),
    // What it may ask for: "email", "roles" (name and photo always)
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    clientSecretHash: text("client_secret_hash"),
    // Glofly's own apps (Gloslate): "Made by Glofly" on the consent page. Only Control sets it.
    firstParty: boolean("first_party").notNull().default(false),
    // Switched off in Glofly Control (nobody can sign in with it; its tokens stop working).
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledReason: text("disabled_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("oauth_apps_client_idx").on(t.clientId), index("oauth_apps_owner_idx").on(t.ownerId)],
);

// What someone allowed an app (Settings → Connected apps). Removing it signs the app out.
export const oauthGrants = pgTable(
  "oauth_grants",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => oauthApps.id, { onDelete: "cascade" }),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    // "roles": whose roles it may see (constellations picked on the consent page)
    constellationIds: uuid("constellation_ids").array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.appId] })],
);

// One-use authorization codes (60 seconds), stored as SHA-256, bound to the app, the return
// address and the PKCE challenge.
export const oauthCodes = pgTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  appId: uuid("app_id")
    .notNull()
    .references(() => oauthApps.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
  codeChallenge: text("code_challenge").notNull(),
  nonce: text("nonce"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Access tokens (1 hour) and refresh tokens (60 days, a new one each use: an old one used again
// revokes the whole family). Both stored as SHA-256; neither ever works as a Glofly sign-in.
export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => oauthApps.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Tokens made from the same first sign-in share a family (revoked together)
    family: uuid("family").notNull(),
    accessHash: text("access_hash").notNull(),
    accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }).notNull(),
    refreshHash: text("refresh_hash"),
    refreshExpiresAt: timestamp("refresh_expires_at", { withTimezone: true }),
    // Set when its refresh token was traded for a new pair
    replacedAt: timestamp("replaced_at", { withTimezone: true }),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("oauth_tokens_access_idx").on(t.accessHash),
    uniqueIndex("oauth_tokens_refresh_idx").on(t.refreshHash),
    index("oauth_tokens_user_app_idx").on(t.userId, t.appId),
    index("oauth_tokens_family_idx").on(t.family),
  ],
);

// ───────────── Communities round (Nov 2026): Glofly tools (built in, no bot to invite) ─────────────

// Each tool's switch and settings per constellation (approved canvas board 15).
// tool: "tickets" | "welcome" | "buttonRoles" | "logging" | "giveaways"
export const constellationTools = pgTable(
  "constellation_tools",
  {
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    // The message with its buttons (tickets, button roles), once posted
    messageId: uuid("message_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.constellationId, t.tool] })],
);

export const constellationTickets = pgTable(
  "constellation_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    nebulaId: uuid("nebula_id").references(() => nebulas.id, { onDelete: "set null" }),
    openerId: uuid("opener_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("constellation_tickets_constellation_idx").on(t.constellationId)],
);

export const constellationGiveaways = pgTable(
  "constellation_giveaways",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    nebulaId: uuid("nebula_id")
      .notNull()
      .references(() => nebulas.id, { onDelete: "cascade" }),
    messageId: uuid("message_id"),
    prize: text("prize").notNull(),
    winners: integer("winners").notNull(),
    // Only people with this role can enter (null = everyone)
    roleId: uuid("role_id"),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    winnerIds: uuid("winner_ids").array().notNull().default(sql`'{}'::uuid[]`),
  },
  (t) => [index("constellation_giveaways_open_idx").on(t.endsAt).where(sql`ended_at is null`)],
);

export const giveawayEntries = pgTable(
  "giveaway_entries",
  {
    giveawayId: uuid("giveaway_id")
      .notNull()
      .references(() => constellationGiveaways.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.giveawayId, t.userId] })],
);

// Communities round (Nov 2026): Linked game servers. A game server's script (FiveM/RedM license,
// Minecraft UUID) asks Glofly about a player with its constellation API key ("link" permission).
// Not linked yet → a one-time code (6 digits, 10 minutes, one use) the player types into Glofly
// (Settings → Linked game servers → Enter a code). One player per Glofly account per constellation
// and game; the server only ever learns the Glofly name and roles in its own constellation.
export const gameLinkCodes = pgTable(
  "game_link_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    keyId: uuid("key_id").references(() => constellationApiKeys.id, { onDelete: "cascade" }),
    // "fivem" | "redm" | "minecraft"
    game: text("game").notNull(),
    // "license:<40 hex>" (FiveM/RedM) or a Minecraft UUID (lowercase, with dashes)
    identity: text("identity").notNull(),
    // Other ids the game gave (fivem:, discord:), saved with the link so servers can map old data.
    extraIds: text("extra_ids").array().notNull().default(sql`'{}'::text[]`),
    // The in-game name the server sent (shown in the confirm step, text only).
    playerName: text("player_name").notNull(),
    // SHA-256 of the 6 digits.
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("game_link_codes_hash_idx").on(t.codeHash),
    uniqueIndex("game_link_codes_player_idx").on(t.constellationId, t.game, t.identity),
    index("game_link_codes_expires_idx").on(t.expiresAt),
  ],
);

export const gameLinks = pgTable(
  "game_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    // The key whose server made the code (for the list's name); links outlive a deleted key.
    keyId: uuid("key_id").references(() => constellationApiKeys.id, { onDelete: "set null" }),
    serverName: text("server_name").notNull(),
    game: text("game").notNull(),
    identity: text("identity").notNull(),
    extraIds: text("extra_ids").array().notNull().default(sql`'{}'::text[]`),
    playerName: text("player_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Written at most once a minute per link.
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("game_links_player_idx").on(t.constellationId, t.game, t.identity),
    uniqueIndex("game_links_user_idx").on(t.userId, t.constellationId, t.game),
  ],
);

// Communities round (Nov 2026): threads off a message in a text nebula, and forum posts (a forum
// nebula's posts are threads with a title and tags). Replies are messages in the nebula's own
// conversation with thread_id set, so every permission check on the nebula covers them.
export const nebulaThreads = pgTable(
  "nebula_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    nebulaId: uuid("nebula_id")
      .notNull()
      .references(() => nebulas.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").notNull(),
    // A thread off a message (text nebulas); null for forum posts.
    parentMessageId: uuid("parent_message_id").references((): AnyPgColumn => messages.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // Forum posts: ids from the nebula's forum_tags.
    tagIds: text("tag_ids").array().notNull().default(sql`'{}'::text[]`),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    // A forum post's opening message (set when it's posted; a post without one isn't listed).
    firstMessageId: uuid("first_message_id"),
    answerMessageId: uuid("answer_message_id"),
    replyCount: integer("reply_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    // Closed by hand (a reply reopens it); threads also count as closed after the nebula's quiet days.
    closedAt: timestamp("closed_at", { withTimezone: true }),
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
  },
  (t) => [
    index("nebula_threads_nebula_idx").on(t.nebulaId, t.lastMessageAt),
    uniqueIndex("nebula_threads_parent_idx").on(t.parentMessageId),
  ],
);

// Who follows a thread (starting it or replying follows it) and how far they've read.
export const threadFollows = pgTable(
  "thread_follows",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => nebulaThreads.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    following: boolean("following").notNull().default(true),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.userId] }), index("thread_follows_user_idx").on(t.userId)],
);

// 0.9.3 Constellation settings → Live alerts (approved boards 4–5): post in a nebula when a
// Twitch or Kick channel goes live, or a YouTube channel posts a video. Listening is shared with
// linked accounts through stream_watches (provider + channel id).
export const constellationLiveAlerts = pgTable(
  "constellation_live_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constellationId: uuid("constellation_id")
      .notNull()
      .references(() => constellations.id, { onDelete: "cascade" }),
    site: text("site").notNull(),
    channelId: text("channel_id").notNull(),
    channelLogin: text("channel_login").notNull(),
    channelName: text("channel_name").notNull(),
    nebulaId: uuid("nebula_id")
      .notNull()
      .references(() => nebulas.id, { onDelete: "cascade" }),
    // a role id, "everyone", "here", or null
    ping: text("ping"),
    message: text("message").notNull(),
    watchNebulaId: uuid("watch_nebula_id").references(() => nebulas.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    lastAlertAt: timestamp("last_alert_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("live_alerts_channel_idx").on(t.constellationId, t.site, t.channelId),
    index("live_alerts_watch_idx").on(t.site, t.channelId),
  ],
);

// Communities round 2 (board 3a): a live stage in a stage nebula (one at a time). Its LiveKit room
// is `stage-<id>`: speakers get passes that may send, listeners passes that only receive.
export const stages = pgTable(
  "stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nebulaId: uuid("nebula_id")
      .notNull()
      .references(() => nebulas.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    handsOn: boolean("hands_on").notNull().default(true),
    listenerChat: boolean("listener_chat").notNull().default(false),
    speakerLimit: integer("speaker_limit").notNull().default(25),
    // Glofly Control → Insights → Big constellations: the most listeners at once, and everyone's
    // minutes on it (LiveKit bills each connected minute, speaker or listener).
    peakListeners: integer("peak_listeners").notNull().default(0),
    participantMinutes: integer("participant_minutes").notNull().default(0),
  },
  (t) => [uniqueIndex("stages_live_idx").on(t.nebulaId).where(sql`${t.endedAt} is null`)],
);

// Who's up on a stage, asked up, or has a hand raised (listeners themselves are kept in memory).
export const stagePeople = pgTable(
  "stage_people",
  {
    stageId: uuid("stage_id")
      .notNull()
      .references(() => stages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    speaker: boolean("speaker").notNull().default(false),
    // A manager asked them up (they become a speaker when they accept).
    invited: boolean("invited").notNull().default(false),
    handAt: timestamp("hand_at", { withTimezone: true }),
    upAt: timestamp("up_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.stageId, t.userId] })],
);

// Communities round 2 (board 3b): a constellation following an announcement nebula. New posts are
// copied into target_nebula_id (a text nebula in the follower's constellation).
export const announcementFollows = pgTable(
  "announcement_follows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceNebulaId: uuid("source_nebula_id")
      .notNull()
      .references(() => nebulas.id, { onDelete: "cascade" }),
    targetNebulaId: uuid("target_nebula_id")
      .notNull()
      .references(() => nebulas.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("announcement_follows_pair_idx").on(t.sourceNebulaId, t.targetNebulaId), index("announcement_follows_target_idx").on(t.targetNebulaId)],
);

// Which message is a copy of which (edits and deletes follow the original).
export const crosspostCopies = pgTable(
  "crosspost_copies",
  {
    copyMessageId: uuid("copy_message_id")
      .primaryKey()
      .references(() => messages.id, { onDelete: "cascade" }),
    sourceMessageId: uuid("source_message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    followId: uuid("follow_id").references(() => announcementFollows.id, { onDelete: "set null" }),
  },
  (t) => [index("crosspost_copies_source_idx").on(t.sourceMessageId)],
);
