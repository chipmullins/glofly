// Glofly's own Windows notifications (0.9.3, approved canvas "Glofly Windows notifications:
// today vs new"). Pure: builds the toast XML Windows draws, and reads back what a press on it
// means. No Electron here, so it can be tested on its own (test/toastXml.test.ts).
//
// Every button and the toast itself are "foreground" activations with arguments in Electron's
// own shape (type=click / type=action&index=N / type=reply), so Electron's
// Notification.handleActivation hands them back with the typed reply text. Glofly's part rides
// along as g=<base64url JSON>: which notification it was and which button.

import type { RichNotification, ToastButtonId } from '../preload/api-types'

/** The buttons main knows. Anything else from the window is dropped. */
export const TOAST_BUTTONS: readonly ToastButtonId[] = [
  'read',
  'mute-1h',
  'mute-tomorrow',
  'answer',
  'answer-voice',
  'decline',
  'join',
  'accept',
  'decline-request',
  'watch',
  'open',
  'not-now',
  'join-voice'
]

/** What Windows hands back for a press: which notification, which button (none = the toast). */
export type ToastPayload = { k: string; c: string | null; a?: ToastButtonId }

/** Characters XML 1.0 can't hold at all (a toast with one simply doesn't show). */
// eslint-disable-next-line no-control-regex
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

/** Text or an attribute value, safe inside the toast's XML. */
export function xmlText(value: string, max = 300): string {
  return value
    .replace(BAD_XML, '')
    .slice(0, max)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

const b64url = (s: string): string =>
  Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export function encodePayload(p: ToastPayload): string {
  return b64url(JSON.stringify(p))
}

/** Reads Glofly's part back out of Windows' activation arguments (null: not one of ours). */
export function payloadFrom(args: string): ToastPayload | null {
  try {
    const g = new URLSearchParams(args).get('g')
    if (!g || g.length > 2000) return null
    const json = Buffer.from(g.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const v = JSON.parse(json) as Partial<ToastPayload>
    if (typeof v !== 'object' || !v || typeof v.k !== 'string' || v.k.length > 60) return null
    const c = typeof v.c === 'string' && /^[0-9a-f-]{36}$/i.test(v.c) ? v.c : null
    const a = typeof v.a === 'string' && (TOAST_BUTTONS as readonly string[]).includes(v.a) ? v.a : undefined
    return { k: v.k, c, ...(a ? { a } : {}) }
  } catch {
    return null
  }
}

/** Is this a notification spec main can show? (Everything from the window is checked.) */
export function isRichNotification(v: unknown): v is RichNotification {
  const r = v as Partial<RichNotification> | null
  if (typeof r !== 'object' || r === null) return false
  const kinds = ['message', 'mention', 'call', 'request', 'live', 'invite', 'voice', 'other']
  if (typeof r.kind !== 'string' || !kinds.includes(r.kind)) return false
  if (r.attribution !== undefined && (typeof r.attribution !== 'string' || r.attribution.length > 120)) return false
  if (
    r.header !== undefined &&
    (typeof r.header !== 'object' ||
      !r.header ||
      typeof r.header.id !== 'string' ||
      !/^[\w:.-]{1,60}$/.test(r.header.id) ||
      typeof r.header.title !== 'string' ||
      r.header.title.length > 100)
  )
    return false
  if (r.picture !== undefined && r.picture !== null && typeof r.picture !== 'string') return false
  if (r.hero !== undefined && typeof r.hero !== 'boolean') return false
  if (r.reply !== undefined && (typeof r.reply !== 'string' || r.reply.length > 60)) return false
  if (r.callScenario !== undefined && typeof r.callScenario !== 'boolean') return false
  if (r.buttons !== undefined) {
    if (!Array.isArray(r.buttons) || r.buttons.length > 5) return false
    for (const b of r.buttons) {
      if (
        typeof b !== 'object' ||
        !b ||
        !(TOAST_BUTTONS as readonly string[]).includes(b.id) ||
        typeof b.label !== 'string' ||
        !b.label.trim() ||
        b.label.length > 40 ||
        (b.style !== undefined && b.style !== 'success' && b.style !== 'critical')
      )
        return false
    }
  }
  return true
}

export type ToastSpec = {
  key: string
  conversationId: string | null
  title: string
  body: string
  rich: RichNotification
  /** file:/// addresses of pictures main saved for this toast */
  faceUri: string | null
  pictureUri: string | null
}

/** The toast's XML. Windows limits a toast to 5 buttons; the reply's Send counts as one. */
export function buildToastXml(t: ToastSpec): string {
  const pay = (a?: ToastButtonId): string =>
    encodePayload({ k: t.key, c: t.conversationId, ...(a ? { a } : {}) })
  const click = `type=click&g=${pay()}`
  const call = t.rich.callScenario === true
  const buttons = (t.rich.buttons ?? []).slice(0, t.rich.reply ? 4 : 5)
  const styled = buttons.some((b) => b.style)
  const attrs = [
    `launch="${xmlText(click, 2400)}"`,
    'activationType="foreground"',
    call ? 'scenario="incomingCall"' : '',
    call || t.rich.kind === 'invite' || t.rich.kind === 'voice' ? 'duration="long"' : '',
    styled ? 'useButtonStyle="true"' : ''
  ]
    .filter(Boolean)
    .join(' ')
  const parts: string[] = [`<toast ${attrs}>`]
  if (t.rich.header && !call) {
    parts.push(
      `<header id="${xmlText(t.rich.header.id, 60)}" title="${xmlText(t.rich.header.title, 100)}" arguments="${xmlText(click, 2400)}" activationType="foreground"/>`
    )
  }
  parts.push('<visual><binding template="ToastGeneric">')
  parts.push(`<text hint-maxLines="1">${xmlText(t.title, 100)}</text>`)
  if (t.body) parts.push(`<text>${xmlText(t.body, 300)}</text>`)
  if (t.rich.attribution) parts.push(`<text placement="attribution">${xmlText(t.rich.attribution, 120)}</text>`)
  if (t.faceUri) {
    parts.push(`<image placement="appLogoOverride" hint-crop="circle" src="${xmlText(t.faceUri, 1000)}"/>`)
  }
  if (t.pictureUri) {
    parts.push(
      t.rich.hero
        ? `<image placement="hero" src="${xmlText(t.pictureUri, 1000)}"/>`
        : `<image src="${xmlText(t.pictureUri, 1000)}"/>`
    )
  }
  parts.push('</binding></visual>')
  if (t.rich.reply || buttons.length) {
    parts.push('<actions>')
    if (t.rich.reply) {
      parts.push(`<input id="reply" type="text" placeHolderContent="${xmlText(t.rich.reply, 60)}"/>`)
      parts.push(
        `<action content="Send" hint-inputId="reply" arguments="${xmlText(`type=reply&g=${pay()}`, 2400)}" activationType="foreground"/>`
      )
    }
    buttons.forEach((b, index) => {
      const style = b.style === 'success' ? ' hint-buttonStyle="Success"' : b.style === 'critical' ? ' hint-buttonStyle="Critical"' : ''
      parts.push(
        `<action content="${xmlText(b.label, 40)}" arguments="${xmlText(`type=action&index=${index}&g=${pay(b.id)}`, 2400)}" activationType="foreground"${style}/>`
      )
    })
    parts.push('</actions>')
  }
  // Glofly plays its own sounds; Windows stays quiet (and a call toast doesn't loop Windows' ring).
  parts.push('<audio silent="true"/>')
  parts.push('</toast>')
  return parts.join('')
}

/** 8 AM tomorrow on this computer ("Mute until tomorrow"). */
export function tomorrowMorning(now = new Date()): Date {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(8, 0, 0, 0)
  return d
}
