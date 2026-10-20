// 0.7.4: what the welcome card (components/WelcomeCard.tsx) remembers on this computer.

const invitedKey = (userId: string): string => `glofly.invitedSomeone.${userId}`
const hiddenKey = (userId: string): string => `glofly.welcomeHidden.${userId}`

function stored(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
function store(key: string): void {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // just for now
  }
}

/** This person sent an invite from this computer (the server doesn't say). */
export const invitedSomeone = (userId: string): boolean => stored(invitedKey(userId))

/** Remembers an invite went out, and tells the welcome card. */
export function noteInvited(userId: string): void {
  store(invitedKey(userId))
  window.dispatchEvent(new Event('glofly:invited'))
}

/** Hidden by the person (only offered once they have friends). */
export const welcomeHidden = (userId: string): boolean => stored(hiddenKey(userId))
export const hideWelcome = (userId: string): void => store(hiddenKey(userId))
