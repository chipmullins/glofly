import { eq, isNull, or } from "drizzle-orm";
import { messages } from "../db/schema";

// Communities round (Nov 2026): a leaf (schema only). Thread replies live in the nebula's own
// conversation with thread_id set; everything that shows the nebula's timeline (the message list,
// unread counts, previews, search) only counts these: messages outside threads, plus thread
// replies sent with "Also send to #nebula".
export const inNebulaTimeline = () => or(isNull(messages.threadId), eq(messages.alsoInNebula, true));
