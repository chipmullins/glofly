import { isAppActive, onLive } from "@/api/realtime";
import { isMuted } from "@glofly/shared";
import { useSession } from "@/state/session";
import { useStore } from "@/state/store";
import { usePhonePrefs } from "@/state/prefs";
import { isQuietNow } from "@/state/quiet";
import type { Message } from "@glofly/shared";

// 0.9.3 "Hop" (the approved "Glofly Dock Hop" canvas, same rules as the desktop app's lib/hop.ts):
// when someone messages you, their face hops once in the Chats list and on the dock.
// Pinned rows and the dock hop twice ("full"), other rows once, softly, after they move to the top.
// Not for the chat on screen, a muted chat, your own messages, Do not disturb or quiet hours, and
// Settings → Notifications & sounds → "Hop when someone messages you" can turn it off.

const EVERY_MS = 4000;
const BURST_MS = 150;
/** Wait for the row to reach the top before it hops. */
const SETTLE_MS = 320;

type Fn = () => void;
const listeners = new Map<string, Set<Fn>>();
const last = new Map<string, number>();
let pending: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/** HopFace listens here for its chat. */
export function onHop(conversationId: string, fn: Fn): () => void {
  let set = listeners.get(conversationId);
  if (!set) listeners.set(conversationId, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(conversationId);
  };
}

function queueHop(conversationId: string) {
  pending = conversationId;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const id = pending;
    pending = null;
    if (!id) return;
    const now = Date.now();
    if (now - (last.get(id) ?? 0) < EVERY_MS) return;
    last.set(id, now);
    for (const fn of listeners.get(id) ?? []) fn();
  }, BURST_MS + SETTLE_MS);
}

onLive((event, payload) => {
  if (event !== "message:new") return;
  const { message, counts } = payload as { message: Message; counts: boolean };
  if (!counts || !isAppActive() || !usePhonePrefs.getState().hops) return;
  const me = useSession.getState().user?.id ?? "";
  if (message.senderId === me || message.event) return;
  const s = useStore.getState();
  if (s.viewing === message.conversationId) return;
  if (s.myStatus?.status === "dnd" || isQuietNow()) return;
  const chat = s.conversations[message.conversationId];
  if (chat && isMuted(chat)) return;
  queueHop(message.conversationId);
});
