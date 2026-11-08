import type { Broadcast } from "@glofly/shared";

// Who's broadcasting right now (0.5.0 Broadcast now). Kept in memory like Watch Together: a
// broadcast only lives as long as its LiveKit room, and a restart simply ends them (the apps
// see it gone and stop).

export type Live = {
  userId: string;
  room: string;
  startedAt: Date;
  title: string | null;
  /** Friends watching (user ids), from the room */
  viewers: string[];
  /** When the broadcaster was last seen in the room */
  seenAt: number;
  /** 0.9.3: friends were told (Go live → "Tell my friends") */
  notify?: boolean;
};

export const live = new Map<string, Live>();

export const shown = (b: Live): Broadcast => ({
  userId: b.userId,
  startedAt: b.startedAt.toISOString(),
  title: b.title,
  viewers: b.viewers.length,
  notified: b.notify !== false,
});

/** Broadcasts someone can watch: their friends' (and their own first). */
export function broadcastsFor(userId: string, friendIds: string[]): Broadcast[] {
  const out: Broadcast[] = [];
  const own = live.get(userId);
  if (own) out.push(shown(own));
  for (const id of friendIds) {
    const b = live.get(id);
    if (b) out.push(shown(b));
  }
  return out;
}
