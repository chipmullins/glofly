import { create } from "zustand";
import { prefs } from "./storage";

// 0.7.5: the welcome flow (ui/WelcomeFlow.tsx) for a brand-new account, like the desktop app. It's
// marked "waiting" on this phone when the account is made (api/auth.ts register), so it shows once,
// comes back if Glofly is closed halfway, and never shows for people who already had an account.

const key = (userId: string) => `welcomeFlow.${userId}`;

export const useWelcome = create<{ userId: string | null }>(() => ({
  userId: null,
}));

/** A new account was just made on this phone: show the welcome flow. */
export async function startWelcome(userId: string): Promise<void> {
  useWelcome.setState({ userId });
  await prefs.set(key(userId), "waiting");
}

/** On start: shows the flow again if it was left halfway. */
export async function resumeWelcome(userId: string): Promise<void> {
  if (useWelcome.getState().userId === userId) return;
  if ((await prefs.get<string | null>(key(userId), null)) === "waiting")
    useWelcome.setState({ userId });
}

/** Finished or skipped: never again on this phone. */
export async function finishWelcome(userId: string): Promise<void> {
  useWelcome.setState({ userId: null });
  await prefs.set(key(userId), "done");
}
