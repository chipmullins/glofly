import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { and, eq, ne } from "drizzle-orm";
import { db } from "./db";
import { conversationMembers } from "./db/schema";
import { findSession } from "./auth/sessions";
import { canMessage } from "./friends/rules";

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
      socket.data.user = found.user;
      next();
    } catch (err) {
      // A database hiccup must never take the whole server down. The app retries.
      console.error("Real-time sign-in check failed:", err);
      next(new Error("unavailable"));
    }
  });

  io.on("connection", (socket) => {
    const me = socket.data.user as { id: string; displayName: string };
    void socket.join(userRoom(me.id));

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
        for (const other of others) {
          if (await canMessage(me.id, other.userId)) {
            emitToUser(other.userId, "typing", { conversationId, userId: me.id });
          }
        }
      } catch {
        // Typing hints aren't important enough to report.
      }
    });
  });
}

/** Sends an event to every device the person is signed in on. */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(userRoom(userId)).emit(event, payload);
}
