import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { and, eq, ne } from "drizzle-orm";
import { db } from "./db";
import { conversationMembers, conversations, users } from "./db/schema";
import { findSession } from "./auth/sessions";
import { appVersionFrom, compareVersions, platformFrom, tooOld, updateRequiredBody, type AppPlatform } from "./app-version";
import { blockedEitherWay, canMessage } from "./friends/rules";
import {
  announcePresence,
  deviceConnected,
  deviceDisconnected,
  deviceHeartbeat,
  deviceIdle,
  cleanActivityName,
  setDeviceActivity,
  sweepStalePresence,
} from "./presence";

/** Runs a background task, logging (not crashing) if it fails. */
function safely(task: () => Promise<unknown>): void {
  task().catch((err) => console.error("Real-time task failed:", err));
}

// The real-time connection: each signed-in app keeps one open, so the server can
// push new messages, typing, and friend changes the moment they happen.

let io: Server | null = null;

const userRoom = (userId: string) => `user:${userId}`;

export function startRealtime(httpServer: HttpServer): void {
  io = new Server(httpServer, {
    // The desktop app connects from its main process, not a web page, so no
    // website gets permission to connect from a browser.
    cors: { origin: false },
    maxHttpBufferSize: 16 * 1024, // events are small; reject anything big
  });

  // Every connection must present a valid session token, same as the API.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const found =
        typeof token === "string" && token.length <= 200 ? await findSession(token) : null;
      if (!found) return next(new Error("unauthorized"));
      // Newer apps say their version here; 0.1.8 only on requests (kept on the session).
      const version = appVersionFrom(socket.handshake.auth?.version) ?? found.session.appVersion;
      // Phones say which app they are (desktop apps don't: missing = desktop).
      const platform = platformFrom(socket.handshake.auth?.platform ?? found.session.platform);
      if (await tooOld(version, platform)) return next(new Error("update_required"));
      socket.data.platform = platform;
      socket.data.user = found.user;
      socket.data.sessionId = found.session.id;
      socket.data.appVersion = version;
      next();
    } catch (err) {
      // A database hiccup must never take the whole server down. The app retries.
      console.error("Real-time sign-in check failed:", err);
      next(new Error("unavailable"));
    }
  });

  startPresenceHeartbeat(io);

  io.on("connection", (socket) => {
    const me = socket.data.user as { id: string; displayName: string };
    void socket.join(userRoom(me.id));
    socket.data.idle = false;

    // Presence: this device is here.
    safely(async () => {
      await deviceConnected(me.id, socket.id);
      await announcePresence(me.id, emitToUser);
    });

    // The app says whether someone is actually using the computer (idle = away).
    socket.on("idle", (idle: unknown) => {
      if (typeof idle !== "boolean" || idle === socket.data.idle) return;
      socket.data.idle = idle;
      safely(async () => {
        await deviceIdle(me.id, socket.id, idle);
        await announcePresence(me.id, emitToUser);
      });
    });

    // "Playing Guild Wars 2": the app sends the game it detected (or null when it stops).
    // Only the game's name ever arrives here, never the list of running programs.
    let lastActivityAt = 0;
    socket.on("activity", (payload: unknown) => {
      const now = Date.now();
      if (now - lastActivityAt < 1000) return; // ignore floods (the app sends at most every 15s)
      lastActivityAt = now;
      const raw = (payload as { name?: unknown } | null)?.name;
      const name = raw === null ? null : cleanActivityName(raw);
      if (raw !== null && name === null) return; // not a usable name
      safely(async () => {
        if (await setDeviceActivity(me.id, socket.id, name)) {
          await announcePresence(me.id, emitToUser);
        }
      });
    });

    socket.on("disconnect", () => {
      safely(async () => {
        await deviceDisconnected(me.id, socket.id);
        // Wait a moment before telling friends, so a quick reconnect doesn't flicker "offline".
        setTimeout(() => safely(() => announcePresence(me.id, emitToUser)), 5000);
      });
    });

    // "Jacob is typing…". Sent at most every few seconds by the app.
    let lastTyping = 0;
    socket.on("typing", async (payload: unknown) => {
      const conversationId = (payload as { conversationId?: unknown })?.conversationId;
      if (typeof conversationId !== "string" || conversationId.length > 40) return;
      const now = Date.now();
      if (now - lastTyping < 1500) return; // ignore floods
      lastTyping = now;

      try {
        const others = await db
          .select({ userId: conversationMembers.userId })
          .from(conversationMembers)
          .where(
            and(
              eq(conversationMembers.conversationId, conversationId),
              ne(conversationMembers.userId, me.id),
            ),
          );
        // Only tell people who share this chat, and only if messaging is allowed.
        const isMember = await db
          .select({ userId: conversationMembers.userId })
          .from(conversationMembers)
          .where(
            and(
              eq(conversationMembers.conversationId, conversationId),
              eq(conversationMembers.userId, me.id),
            ),
          )
          .limit(1);
        if (!isMember.length) return;
        // Respect "Show when I'm typing".
        const [settings] = await db
          .select({ showTyping: users.showTyping })
          .from(users)
          .where(eq(users.id, me.id));
        if (!settings?.showTyping) return;
        const [chat] = await db
          .select({ kind: conversations.kind })
          .from(conversations)
          .where(eq(conversations.id, conversationId));
        for (const other of others) {
          // DMs: only if you can message each other. Groups: everyone, except across a block.
          const allowed =
            chat?.kind === "group"
              ? !(await blockedEitherWay(me.id, other.userId))
              : await canMessage(me.id, other.userId);
          if (allowed) {
            emitToUser(other.userId, "typing", { conversationId, userId: me.id });
          }
        }
      } catch {
        // Typing hints aren't important enough to report.
      }
    });
  });
}

/** Every 30 seconds: refresh each connected device, then catch anyone who vanished. */
function startPresenceHeartbeat(server: Server): void {
  setInterval(() => {
    safely(async () => {
      for (const socket of server.of("/").sockets.values()) {
        const user = socket.data.user as { id: string } | undefined;
        if (user) await deviceHeartbeat(user.id, socket.id, socket.data.idle === true);
      }
      await sweepStalePresence(emitToUser);
    });
  }, 30_000);
}

/** Sends an event to every device the person is signed in on. */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(userRoom(userId)).emit(event, payload);
}

/**
 * Closes the live connections of a person's signed-out devices (all of them, or all but
 * one session). Their apps see the server close the connection and sign out.
 */
export async function disconnectSessions(userId: string, keepSessionId?: string): Promise<void> {
  if (!io) return;
  for (const socket of await io.in(userRoom(userId)).fetchSockets()) {
    if (socket.data.sessionId !== keepSessionId) socket.disconnect(true);
  }
}

/**
 * Which sessions of these people have Glofly open right now (a live connection). Phones close
 * theirs when Glofly goes to the background, so this is "using Glofly on that phone now".
 */
export async function liveSessions(userIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!io || !userIds.length) return out;
  for (const socket of await io.in(userIds.map(userRoom)).fetchSockets()) {
    const user = socket.data.user as { id: string } | undefined;
    const session = socket.data.sessionId as string | undefined;
    if (!user || !session) continue;
    if (!out.has(user.id)) out.set(user.id, new Set());
    out.get(user.id)!.add(session);
  }
  return out;
}

/** Closes the live connection of one signed-out device (one session). */
export async function disconnectSession(userId: string, sessionId: string): Promise<void> {
  if (!io) return;
  for (const socket of await io.in(userRoom(userId)).fetchSockets()) {
    if (socket.data.sessionId === sessionId) socket.disconnect(true);
  }
}

/** Which of a person's sessions have the app open and connected right now. */
export async function connectedSessionIds(userId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!io) return ids;
  for (const socket of await io.in(userRoom(userId)).fetchSockets()) {
    if (typeof socket.data.sessionId === "string") ids.add(socket.data.sessionId);
  }
  return ids;
}

/** Everyone with the app open right now: how many devices, and which people (Control's Dashboard). */
export async function connectedSummary(): Promise<{ devices: number; userIds: Set<string> }> {
  const userIds = new Set<string>();
  if (!io) return { devices: 0, userIds };
  const sockets = await io.fetchSockets();
  for (const socket of sockets) {
    const id = (socket.data.user as { id?: string } | undefined)?.id;
    if (id) userIds.add(id);
  }
  return { devices: sockets.length, userIds };
}

/** Sends an event to every connected app (an announcement changed, say). */
export function emitToAll(event: string, payload: unknown): void {
  io?.emit(event, payload);
}

/**
 * A new minimum app version: apps older than it are told to update, then disconnected (their
 * requests are refused from now on too). Returns how many devices that was.
 */
export async function dropOutdatedApps(minVersion: string, platform: AppPlatform = "desktop"): Promise<number> {
  if (!io) return 0;
  const body = await updateRequiredBody(platform);
  let dropped = 0;
  for (const socket of await io.fetchSockets()) {
    if ((socket.data.platform ?? "desktop") !== platform) continue;
    const version = typeof socket.data.appVersion === "string" ? socket.data.appVersion : "0.0.0";
    if (compareVersions(version, minVersion) < 0) {
      socket.emit("app:update-required", body);
      socket.disconnect(true);
      dropped++;
    }
  }
  return dropped;
}
