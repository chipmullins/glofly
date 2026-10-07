import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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

// A chat. Right now every conversation is a direct message between two friends;
// group chats will reuse these same tables.
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  // For direct messages: "lowerId:higherId", so each pair has exactly one DM.
  dmKey: text("dm_key").unique(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // For editing and deleting, coming later.
    editedAt: timestamp("edited_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  // Loading a chat = newest messages in one conversation, so index exactly that.
  (t) => [index("messages_conversation_created_idx").on(t.conversationId, t.createdAt, t.id)],
);
