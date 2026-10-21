import { router } from 'expo-router'
import { STATUS_LABEL, type MyStatusChoice } from '@glofly/shared'
import * as api from '@/api/glofly'
import { chooseFrom, inform } from '@/ui/dialogs'
import { useStore } from '@/state/store'

// The status menu (tapping your own avatar): Online, Away, Do not disturb, Invisible.

const CHOICES: { key: MyStatusChoice; detail: string }[] = [
  { key: 'online', detail: '' },
  { key: 'away', detail: '' },
  { key: 'dnd', detail: 'No notifications or sounds' },
  { key: 'invisible', detail: 'You look offline, but can use Glofly as usual' },
]

export async function setStatus(status: MyStatusChoice) {
  const before = useStore.getState().myStatus
  useStore.setState({ myStatus: { status, statusText: before?.statusText ?? null, statusTextEndsAt: before?.statusTextEndsAt ?? null } })
  const r = await api.setMyStatus({ status })
  if (r.ok) useStore.setState({ myStatus: r.data })
  else {
    useStore.setState({ myStatus: before })
    void inform("Couldn't change your status", r.message)
  }
}

export async function statusMenu() {
  const current = useStore.getState().myStatus
  const pick = await chooseFrom(
    [
      ...CHOICES.map((c) => ({ key: c.key, label: STATUS_LABEL[c.key], detail: c.detail || undefined, checked: current?.status === c.key })),
      { key: 'custom', label: current?.statusText ? `Status message: ${current.statusText}` : 'Set a status message…', icon: 'pencil' as const },
      { key: 'profile', label: 'Edit profile', icon: 'user' as const },
    ],
    'Your status',
  )
  if (!pick) return
  if (pick === 'custom' || pick === 'profile') router.push('/edit-profile')
  else await setStatus(pick as MyStatusChoice)
}
