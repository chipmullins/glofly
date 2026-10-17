// 2.0 voice nebulas: who a moderator muted, per room (kept in memory like the ring timers; a
// server restart forgets it, the same as everyone rejoining). Muted people get passes without a
// microphone until they're unmuted. Cleared when the room closes.

const muted = new Map<string, Set<string>>();

export function isVoiceMuted(callId: string, userId: string): boolean {
  return muted.get(callId)?.has(userId) ?? false;
}

export function setVoiceMuted(callId: string, userId: string, on: boolean): void {
  const set = muted.get(callId) ?? new Set<string>();
  if (on) set.add(userId);
  else set.delete(userId);
  if (set.size) muted.set(callId, set);
  else muted.delete(callId);
}

export function voiceMutedIn(callId: string): string[] {
  return [...(muted.get(callId) ?? [])];
}

export function forgetVoiceMutes(callId: string): void {
  muted.delete(callId);
}
