import { ACCENT_THEME, accentOf } from '@glofly/shared/constellations'
import type { ConstellationAccent, ConstellationDetail } from '@glofly/shared/constellations'

// 0.7.5 Constellations polish ("community and identity"): small helpers the screens share.

type HasIdentity = {
  id: string
  accent?: ConstellationAccent | null
  bannerVersion?: string | null
}

/** The CSS variables `.cx-accented` (identity.css) reads. */
export function accentStyle(c: HasIdentity): React.CSSProperties {
  const a = accentOf(c)
  return {
    ['--cxa' as string]: a.color,
    ['--cxa-rgb' as string]: a.rgb,
    ['--cxa-soft' as string]: a.soft,
    ['--cxa-ink' as string]: a.ink,
    ['--cxa-on' as string]: a.on
  }
}

/** Does it have a picked accent (anything other than the default gold)? */
export const hasAccent = (c: HasIdentity): boolean => !!c.accent && c.accent !== 'gold'

/** The six accent swatches (Settings → Overview). */
export const ACCENT_CHOICES = (Object.keys(ACCENT_THEME) as ConstellationAccent[]).map((id) => ({
  id,
  ...ACCENT_THEME[id]
}))

/** The invite code in a message (only real glofly.app/c/… links count). */
export function inviteCodeIn(text: string): string | null {
  const m = text.match(/(?:^|[\s(])(?:https?:\/\/)?(?:www\.)?glofly\.app\/c\/([A-Za-z0-9]{6,16})\b/)
  return m ? m[1] : null
}

/** Should the welcome show now? (Only for people who joined after 0.7.5, once.) */
export function needsWelcome(c: ConstellationDetail): boolean {
  return c.welcomedAt === null && c.welcome?.screen !== false && !c.me.owner
}
