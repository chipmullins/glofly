// 0.7.5: the welcome flow (components/WelcomeFlow.tsx) for a brand-new account. It's marked
// "waiting" on this device when the account is made (App.tsx, after Register), so it shows once,
// survives closing the app halfway, and never shows for people who already had an account.
// (0.7.4's welcome card used the "invited someone" note; kept for the Add friend dialog.)

const invitedKey = (userId: string): string => `glofly.invitedSomeone.${userId}`
const flowKey = (userId: string): string => `glofly.welcomeFlow.${userId}`

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // just for now
  }
}

/** This person sent an invite from this computer (the server doesn't say). */
export const invitedSomeone = (userId: string): boolean => read(invitedKey(userId)) === '1'

/** Remembers an invite went out. */
export function noteInvited(userId: string): void {
  write(invitedKey(userId), '1')
  window.dispatchEvent(new Event('glofly:invited'))
}

/** A new account was just made here: the welcome flow shows when the app opens. */
export const startWelcomeFlow = (userId: string): void => write(flowKey(userId), 'waiting')

/** Shows the welcome flow (made here, not finished or skipped yet). */
export const welcomeFlowPending = (userId: string): boolean => read(flowKey(userId)) === 'waiting'

/** Finished or skipped: never again on this device. */
export const finishWelcomeFlow = (userId: string): void => write(flowKey(userId), 'done')
