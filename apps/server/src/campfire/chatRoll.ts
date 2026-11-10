import { chatRollText, parseDice, rollCommand, rollDice, rollDiceList, type ChatRoll } from "@glofly/shared";
import { lockedDown, LOCKDOWN_MESSAGE } from "../admin/lockdown";
import { rollSlot, serverRng, TOO_MANY_ROLLS } from "./http";

// Campfire `/roll` in any chat (DMs, groups, nebulas): a message starting with "/roll " is rolled
// here on the server and saved with a `roll` field; its body is the plain text older apps show
// ("🎲 Chip rolled 1d20+3: 17 (14 + 3)"). Lockdown holds new accounts back from posting rolls.

export type ChatRollOutcome = { roll: ChatRoll; body: string } | { status: number; error: string; message: string } | null;

/** Null: not a roll (send the text as it is). */
export async function chatRollFor(text: string, sender: { id: string; displayName: string }): Promise<ChatRollOutcome> {
  const expression = rollCommand(text);
  if (expression === null) return null;
  if (await lockedDown(sender.id)) return { status: 403, ...LOCKDOWN_MESSAGE };
  const parsed = parseDice(expression);
  if (!parsed.ok) return { status: 400, error: "invalid_roll", message: parsed.error };
  if (!(await rollSlot(sender.id))) return { status: 429, error: "too_many_requests", message: TOO_MANY_ROLLS };
  const result = rollDice(parsed.expr, serverRng);
  return {
    body: chatRollText(sender.displayName, result),
    roll: { expression: result.expression, label: result.label, total: result.total, breakdown: result.breakdown, dice: rollDiceList(result).slice(0, 100) },
  };
}
