import type { CampfireEvents } from '@glofly/shared'

// Campfire's live events (they only come to apps that sent the `campfire` feature). A leaf file:
// api/realtime.ts imports it to forward them, so it must not import anything of the app.

export type CampfireEventName = keyof CampfireEvents

export const CAMPFIRE_EVENTS: readonly CampfireEventName[] = [
  'campfire:opened',
  'campfire:closed',
  'campfire:state',
  'campfire:token',
  'campfire:scene',
  'campfire:fog',
  'campfire:roll',
  'campfire:pending',
  'campfire:hit',
  'campfire:combat',
  'campfire:character',
  'campfire:handout',
  'campfire:music',
  'campfire:ping',
  'campfire:presence',
  'campfire:members',
  // Round A: the campaign hub changed
  'campfire:hub',
  // Round B
  'campfire:live',
  'campfire:view',
  'campfire:sound',
  'campfire:whisper',
  'campfire:notice',
  'campfire:removed',
]

export const isCampfireEvent = (name: string): name is CampfireEventName => (CAMPFIRE_EVENTS as readonly string[]).includes(name)
