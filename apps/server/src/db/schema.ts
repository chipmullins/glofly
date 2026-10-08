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

    // Set when someone deletes their account: the moment it's permanently removed.
    // Until then the account is hidden, and logging in again offers to restore it.
    deleteAfter: timestamp("delete_after", { withTimezone: true }),

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

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

export type Session = typeof sessions.$inferSelect;

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

export const conversationKind = pgEnum("conversation_kind", ["dm", "group"]);

// A chat: a direct message between two friends, or a group chat (up to 25 people).
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: conversationKind("kind").notNull().default("dm"),
  // For direct messages: "lowerId:higherId", so each pair has exactly one DM. Null for groups.
  dmKey: text("dm_key").unique(),
  // Group chats: the name anyone in the group can set (null = shown as members' names).
  name: text("name"),
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
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
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
  },
  // Loading a chat = newest messages in one conversation, so index exactly that.
  (t) => [index("messages_conversation_created_idx").on(t.conversationId, t.createdAt, t.id)],
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("attachments_message_idx").on(t.messageId),
    index("attachments_unsent_idx").on(t.uploaderId, t.createdAt),
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
