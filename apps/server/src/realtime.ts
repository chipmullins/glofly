import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { cachedNicknames, nicknamesFor, withNicknames } from "./profile/nicknames";
import { conversationMembers, conversations, users } from "./db/schema";
import { findSession } from "./auth/sessions";
import {
  appVersionFrom,
  compareVersions,
  isPhonePlatform,
  platformFrom,
  tooOld,
  updateRequiredBody,
  type AppPlatform,
} from "./app-version";
import { cookieToken, fromWebOrigin } from "./web/session";
import { blockedWith, canMessage } from "./friends/rules";
import {
  announcePresence,
  deviceConnected,
  deviceDisconnected,
  deviceHeartbeat,
  deviceIdle,
  cleanActivityName,
  setDeviceActivity,
  sweepStalePresence,
  onStatusChange,
} from "./presence";
import { onPresenceChange } from "./friends/online-alerts";
import { getPause, isPaused, pausedBody } from "./admin/pause";

/** Runs a background task, logging (not crashing) if it fails. */
function safely(task: () => Promise<unknown>): void {
  task().catch((err) => console.error("Real-time task failed:", err));
}

// The real-time connection: each signed-in app keeps one open, so the server can
// push new messages, typing, and friend changes the moment they happen.

let io: Server | null = null;

const userRoom = (userId: string) => `user:${userId}`;
// 2.0: devices whose app knows Constellations (they say so when connecting). Constellation events
// and anything about a nebula only ever go here, so older apps never hear of them.
const modernRoom = (userId: string) => `user2:${userId}`;

/** Does this connection's app know Constellations? (`auth.features` includes "constellations") */
function knowsConstellations(auth: unknown): boolean {
  const features = (auth as { features?: unknown } | undefined)?.features;
  return Array.isArray(features) && features.includes("constellations");
}

export function startRealtime(httpServer: HttpServer): void {
  io = new Server(httpServer, {
    // The desktop and phone apps don't connect from a web page. The web app (chat.glofly.app)
    // connects with a WebSocket only (no CORS involved); its cookie is only accepted when the
    // connection comes from that page (checked below), so no other website can use it.
    cors: { origin: false },
    maxHttpBufferSize: 16 * 1024, // events are small; reject anything big
    // "Pause Glofly" (admin/pause.ts): new connections are refused before they're even set up.
    // The apps see a plain connection error and keep retrying on their own (every ~10 s), so
    // older apps come back by themselves once Glofly is unpaused.
    allowRequest: (_req, callback) => {
      isPaused().then(
        (paused) => callback(paused ? "paused" : null, !paused),
        () => callback(null, true),
      );
    },
  });

  // Every connection must present a valid session token, same as the API.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      let found =
        typeof token === "string" && token.length <= 200 ? await findSession(token) : null;
      // A web session's token only counts from its cookie (below), never sent as a token.
      if (found?.session.platform === "web") found = null;
      // The web app: its session cookie, only from its own page, and only for a web session.
      if (!found && token === undefined && fromWebOrigin(socket.handshake.headers)) {
        const cookie = cookieToken(socket.handshake.headers);
        const session = cookie ? await findSession(cookie) : null;
        if (session?.session.platform === "web") found = session;
      }
      if (!found) return next(new Error("unauthorized"));
      // Newer apps say their version here; 0.1.8 only on requests (kept on the session).
      const version = appVersionFrom(socket.handshake.auth?.version) ?? found.session.appVersion;
      // Phones say which app they are (desktop apps don't: missing = desktop).
      const platform = platformFrom(socket.handshake.auth?.platform ?? found.session.platform);
      if (await tooOld(version, platform)) return next(new Error("update_required"));
      // Their nicknames, so live events carry them (profile/nicknames.ts). Best effort.
      await nicknamesFor(found.user.id).catch(() => undefined);
      socket.data.platform = platform;
      socket.data.user = found.user;
      socket.data.sessionId = found.session.id;
      socket.data.appVersion = version;
      socket.data.constellations = knowsConstellations(socket.handshake.auth);
      // 0.5.2: what this app knows beyond its version ("callMove": a call can move to a new group).
      socket.data.features = featuresFrom(socket.handshake.auth?.features);
      next();
    } catch (err) {
      // A database hiccup must never take the whole server down. The app retries.
      console.error("Real-time sign-in check failed:", err);
      next(new Error("unavailable"));
    }
  });

  startPresenceHeartbeat(io);
  // "Notify me when they come online".
  onStatusChange(onPresenceChange);

  io.on("connection", (socket) => {
    const me = socket.data.user as { id: string; displayName: string };
    void socket.join(userRoom(me.id));
    if (socket.data.constellations) void socket.join(modernRoom(me.id));
    socket.data.idle = false;

    // Presence: this device is here.
    safely(async () => {
      await deviceConnected(me.id, socket.id, isPhonePlatform(socket.data.platform));
      await announcePresence(me.id, emitToUser);
    });

    // The app says whether someone is actually using the computer (idle = away).
    // Each change reaches every friend, so a misbehaving app can't flip it more than a few
    // times in 10 seconds (real apps change it every few minutes at most).
    let idleChanges: number[] = [];
    socket.on("idle", (idle: unknown) => {
      if (typeof idle !== "boolean" || idle === socket.data.idle) return;
      const now = Date.now();
      idleChanges = idleChanges.filter((t) => now - t < 10_000);
      if (idleChanges.length >= 10) return;
      idleChanges.push(now);
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

    socket.on("disconnect", (reason) => {
      // A phone leaving Glofly (or losing signal) stays "Active on mobile" for a few minutes;
      // not when the server hung up on it (signed out, update required).
      // Nor when Glofly was paused (everyone was hung up on at once).
      const phoneLeft =
        isPhonePlatform(socket.data.platform) && reason !== "server namespace disconnect" && !pausing;
      safely(async () => {
        await deviceDisconnected(me.id, socket.id, phoneLeft ? (socket.data.sessionId as string) : undefined);
        // Wait a moment before telling friends, so a quick reconnect doesn't flicker "offline".
        setTimeout(() => safely(() => announcePresence(me.id, emitToUser)), 5000);
      });
    });

    // "Jacob is typing…". Sent at most every few seconds by the app.
    let lastTyping = 0;
    socket.on("typing", async (payload: unknown) => {
      const conversationId = (payload as { conversationId?: unknown })?.conversationId;
      if (typeof conversationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) return;
      const now = Date.now();
      if (now - lastTyping < 1500) return; // ignore floods
      lastTyping = now;

      try {
        // Respect "Show when I'm typing" (checked first: it's the cheapest no).
        const [settings] = await db
          .select({ showTyping: users.showTyping })
          .from(users)
          .where(eq(users.id, me.id));
        if (!settings?.showTyping) return;
        // Only tell people who share this chat (one query for everyone in it, me included).
        const members = await db
          .select({ userId: conversationMembers.userId })
          .from(conversationMembers)
          .where(eq(conversationMembers.conversationId, conversationId));
        if (!members.some((m) => m.userId === me.id)) return;
        const others = members.filter((m) => m.userId !== me.id);
        if (!others.length) return;
        const [chat] = await db
          .select({ kind: conversations.kind })
          .from(conversations)
          .where(eq(conversations.id, conversationId));
        if (chat?.kind === "dm") {
          // DMs: only if you can message each other.
          const other = others[0].userId;
          if (await canMessage(me.id, other)) emitToUser(other, "typing", { conversationId, userId: me.id });
          return;
        }
        // Groups and nebulas (2.0, newer apps only): everyone, except across a block.
        const blocked = await blockedWith(me.id);
        const nebula = chat?.kind === "nebula";
        for (const other of others) {
          if (!blocked.has(other.userId)) emitToUser(other.userId, "typing", { conversationId, userId: me.id }, nebula);
        }
      } catch {
        // Typing hints aren't important enough to report.
      }
    });
  });
}

// True while Glofly is paused (set by pauseConnections, cleared by resumeConnections).
let pausing = false;

/**
 * "Pause Glofly": every app is told (0.4.0+ shows "Glofly is paused"), then its connection is
 * closed. Not a sign-out: the apps see the connection drop and keep trying to reconnect, which
 * the server refuses until the pause ends. Returns how many devices were connected.
 */
export async function pauseConnections(): Promise<number> {
  pausing = true;
  if (!io) return 0;
  const body = pausedBody(await getPause());
  const sockets = await io.fetchSockets();
  for (const socket of sockets) socket.emit("server:paused", body);
  // Closing the connection itself (not socket.disconnect) waits for the message above to go out,
  // and looks like lost Wi-Fi to the app (it retries) rather than a sign-out.
  for (const socket of io.of("/").sockets.values()) socket.conn.close();
  return sockets.length;
}

/** The pause is over: phones leaving Glofly count as "Active on mobile" again. */
export function resumeConnections(): void {
  pausing = false;
}

/** Shutting down: closes every live connection (the apps reconnect to the next server). */
export async function stopRealtime(): Promise<void> {
  if (!io) return;
  const server = io;
  io = null;
  await new Promise<void>((resolve) => server.close(() => resolve()));
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

/** The features an app says it knows (`auth.features`): short names only, a few at most. */
function featuresFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((f): f is string => typeof f === "string" && /^[a-zA-Z0-9]{1,32}$/.test(f)).slice(0, 16);
}

/**
 * Do this person's apps know a feature? "yes" if any app they have open says so, "no" if they
 * have apps open and none does (older versions), "offline" if none is connected right now.
 */
export async function appsKnow(userId: string, feature: string): Promise<"yes" | "no" | "offline"> {
  if (!io) return "offline";
  const sockets = await io.in(userRoom(userId)).fetchSockets();
  if (!sockets.length) return "offline";
  return sockets.some((s) => Array.isArray(s.data.features) && s.data.features.includes(feature)) ? "yes" : "no";
}

/** 0.7.1: does any app this person has open right now not know this feature (an older version)? */
export async function someAppLacks(userId: string, feature: string): Promise<boolean> {
  if (!io) return false;
  const sockets = await io.in(userRoom(userId)).fetchSockets();
  return sockets.some((s) => !(Array.isArray(s.data.features) && s.data.features.includes(feature)));
}

/**
 * Sends an event to every device the person is signed in on. `modernOnly` (2.0): only to devices
 * whose app knows Constellations (everything about constellations and nebulas).
 */
export function emitToUser(userId: string, event: string, payload: unknown, modernOnly = false): void {
  // Their nicknames for people go in (loaded when their live connection opened).
  io?.to(modernOnly ? modernRoom(userId) : userRoom(userId)).emit(event, withNicknames(payload, userId, cachedNicknames(userId)));
}

/**
 * 0.7.1: one event, two versions: devices whose app knows `feature` get `withFeature`, the rest
 * get `without` (e.g. a Vimeo video for new apps, "nothing's on" for apps that only know YouTube).
 */
export async function emitToUserByFeature(
  userId: string,
  event: string,
  feature: string,
  withFeature: unknown,
  without: unknown,
  modernOnly = false,
): Promise<void> {
  if (!io) return;
  const nicks = cachedNicknames(userId);
  for (const socket of await io.in(modernOnly ? modernRoom(userId) : userRoom(userId)).fetchSockets()) {
    const knows = Array.isArray(socket.data.features) && socket.data.features.includes(feature);
    socket.emit(event, withNicknames(knows ? withFeature : without, userId, nicks));
  }
}

/** Which of these people have Glofly open right now (any device). */
export async function connectedUserIds(userIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!io || !userIds.length) return out;
  for (const socket of await io.in(userIds.map(userRoom)).fetchSockets()) {
    const id = (socket.data.user as { id?: string } | undefined)?.id;
    if (id) out.add(id);
  }
  return out;
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
