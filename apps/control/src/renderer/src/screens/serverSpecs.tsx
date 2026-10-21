import { api, type LockdownState } from '../lib/api'
import type { ActionSpec } from '../components/ActionDialog'
import { plural } from '../lib/format'

// 0.8.2: the confirm dialogs for Lockdown and End all calls (Server's cards, its header buttons
// and the command bar all open these).

export function lockdownSpec(
  state: { on: boolean; affected: number; hours: number } | null,
  after: (lockdown: LockdownState) => void
): ActionSpec {
  const on = state?.on === true
  if (on)
    return {
      title: 'Turn off Lockdown',
      intro: 'New accounts can add friends, join groups and talk to anyone again.',
      confirmLabel: 'Turn off Lockdown',
      notePlaceholder: 'e.g. "Spam wave is over"',
      run: async (_v, note) => {
        const r = await api.setLockdown(false, note)
        if (r.ok) after(r.data.lockdown)
        return r
      }
    }
  return {
    title: 'Turn on Lockdown',
    intro: (
      <>
        <strong>
          Accounts made in the last {state?.hours ?? 24} hours can only talk to friends they already
          have
        </strong>{' '}
        ({state ? plural(state.affected, 'account') : 'new accounts'} right now). They can’t send
        friend requests, join constellations or message anyone new. Everyone else is unaffected.
      </>
    ),
    confirmLabel: 'Turn on Lockdown',
    danger: true,
    notePlaceholder: 'e.g. "Spam wave from new accounts"',
    run: async (_v, note) => {
      const r = await api.setLockdown(true, note)
      if (r.ok) after(r.data.lockdown)
      return r
    }
  }
}

export const endCallsSpec = (): ActionSpec => ({
  title: 'End all calls',
  intro:
    'Hangs up every call on Glofly right now: one-on-one and group calls, voice nebulas and Watch Together. People can call again straight away.',
  confirmLabel: 'End all calls',
  danger: true,
  notePlaceholder: 'e.g. "Calls stuck after the update"',
  run: (_v, note) => api.endAllCalls(note)
})
