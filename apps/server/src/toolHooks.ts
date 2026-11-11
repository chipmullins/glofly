// Communities round (Nov 2026): a leaf module (no imports) through which the rest of the server tells
// Glofly tools what happened. tools/hooks.ts registers itself here from index.ts at start-up, so the
// code being watched never imports the tools (which import it back): no import cycle can form.

type Hooks = {
  onJoin: (constellationId: string, userId: string) => Promise<void>;
  onLeave: (constellationId: string, userId: string) => Promise<void>;
  onModeration: (constellationId: string, actorId: string | null, action: string, targetUserId: string | null, details: Record<string, unknown> | null) => Promise<void>;
  onMessageChanged: (conversationId: string, userId: string, change: "edited" | "deleted") => Promise<void>;
  /** Any nebula message posted, edited or deleted (integrations/readers.ts: bridges with messages:read). */
  onNebulaMessage: (conversationId: string, messageId: string, change: "created" | "edited" | "deleted") => Promise<void>;
};

const hooks: { [K in keyof Hooks]?: Hooks[K][] } = {};

/**
 * Each module registers the hooks it handles (tools/hooks.ts, integrations/readers.ts, and since
 * communities round 2 stages/announcements.ts and bridge/discord.ts). Several modules may handle one.
 */
export function registerToolHooks(h: Partial<Hooks>): void {
  for (const key of Object.keys(h) as (keyof Hooks)[]) {
    const fn = h[key];
    if (fn) (hooks[key] ??= [] as never[]).push(fn as never);
  }
}

/** Runs a tool hook in the background (nothing happens before registration; never throws). */
export function toolHook<K extends keyof Hooks>(name: K, ...args: Parameters<Hooks[K]>): void {
  for (const fn of (hooks[name] ?? []) as ((...a: Parameters<Hooks[K]>) => Promise<void>)[])
    void fn(...args).catch((err) => console.error(`Glofly tools (${name}) failed`, err));
}
