import type { SessionStats } from "@glofly/shared";
import type { CampaignRow } from "./perms";

// Round A: what the table does is counted for the session's recap draft (hub.ts noteSession).
// A tiny go-between so rolls (http.ts), fights (play.ts) and hits (sync.ts) can count without
// importing the hub (which imports them).

type Note = (campaign: CampaignRow, change: (s: SessionStats) => SessionStats) => Promise<void>;
let note: Note | null = null;
export const setSessionNoter = (fn: Note) => {
  note = fn;
};
/** Counts something for the session being played (no-op until the hub is loaded; never throws). */
export function noteSessionLater(campaign: CampaignRow, change: (s: SessionStats) => SessionStats): void {
  if (note) void note(campaign, change).catch(() => undefined);
}
