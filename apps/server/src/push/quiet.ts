import { inQuietHours } from "@glofly/shared";
import type { QuietHoursSetting } from "../db/schema";

/**
 * 0.7.3 quiet hours: during them a phone is treated like Do not disturb (no message
 * notifications; calls ring silently, or as usual if they let calls through).
 */
export function quietOrDnd(d: { status: string; quiet?: QuietHoursSetting | null }, forCall = false): boolean {
  if (d.status === "dnd") return true;
  if (!d.quiet) return false;
  if (forCall && d.quiet.calls) return false;
  return inQuietHours(d.quiet);
}
