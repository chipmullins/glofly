import { useSyncExternalStore } from 'react'
import type { CampaignHome } from '@glofly/shared/campfire/types'

// Which Campfire table is open (a full layer over Glofly), and which tables are lit in calls
// ("Campfire is lit · Join"). Small external stores, so the call bar, the voice nebula header and
// the banner can open it without passing anything through the screens in between.

export type CampfireOpen = {
  /** Where its campaigns live (a group chat or a voice nebula's chat); null when joining by id */
  home: CampaignHome | null
  /** The call it's opened from (the GM lights the table in it) */
  callId: string | null
  /** Go straight to this campaign */
  campaignId?: string
  /** "Friday Party", the voice nebula or group's name */
  placeName?: string
}

let open: CampfireOpen | null = null
const openListeners = new Set<() => void>()
const tellOpen = (): void => openListeners.forEach((l) => l())

export function openCampfire(next: CampfireOpen): void {
  open = next
  tellOpen()
}
export function closeCampfire(): void {
  open = null
  tellOpen()
}
export function useCampfireOpen(): CampfireOpen | null {
  return useSyncExternalStore(
    (l) => {
      openListeners.add(l)
      return () => openListeners.delete(l)
    },
    () => open
  )
}

// ───────────── Lit in a call ─────────────

export type LitTable = { campaignId: string; callId: string; name: string; by: string }
let lit: LitTable[] = []
// 0.11.2: "Not now" sticks for that table in that call: the server announces it again whenever
// someone opens it, and it kept coming back.
const dismissed = new Set<string>()
const litListeners = new Set<() => void>()
let listening = false

function startListening(): void {
  if (listening) return
  listening = true
  window.glofly.onEvent((event) => {
    if (event.type !== 'campfire') return
    const d = event.data
    if (event.name === 'campfire:opened' && typeof d.callId === 'string') {
      if (dismissed.has(`${d.campaignId}:${d.callId}`)) return
      lit = [
        ...lit.filter((l) => l.campaignId !== d.campaignId),
        {
          campaignId: d.campaignId,
          callId: d.callId,
          name: typeof d.name === 'string' ? d.name.slice(0, 80) : 'Campfire',
          by: typeof d.by === 'string' ? d.by : ''
        }
      ]
      litListeners.forEach((l) => l())
    } else if (
      event.name === 'campfire:closed' ||
      (event.name === 'campfire:state' && d.reason === 'deleted')
    ) {
      lit = lit.filter((l) => l.campaignId !== d.campaignId)
      litListeners.forEach((l) => l())
    }
  })
}

export function dismissLit(campaignId: string): void {
  for (const l of lit) if (l.campaignId === campaignId) dismissed.add(`${l.campaignId}:${l.callId}`)
  lit = lit.filter((l) => l.campaignId !== campaignId)
  litListeners.forEach((l) => l())
}

export function useLitTables(): LitTable[] {
  startListening()
  return useSyncExternalStore(
    (l) => {
      litListeners.add(l)
      return () => litListeners.delete(l)
    },
    () => lit
  )
}
