// 0.9.3 Glofly Windows notifications: the toast XML and what a press means.
// Run: npx tsx --test test/toastXml.test.ts (from apps/desktop)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildToastXml, encodePayload, isRichNotification, payloadFrom, tomorrowMorning, xmlText } from '../src/main/toastXml'

const conv = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e'

test('names and text are escaped, bad characters dropped', () => {
  assert.equal(xmlText(`a<b>&"c'\u0001`), 'a&lt;b&gt;&amp;&quot;c&apos;')
  const xml = buildToastXml({
    key: conv,
    conversationId: conv,
    title: '<script>"Maya" & co',
    body: '</text><action content="evil"/>',
    rich: { kind: 'message', reply: 'Reply to Maya', buttons: [{ id: 'read', label: 'Mark as read' }] },
    faceUri: 'file:///C:/Users/x/AppData/Local/Temp/glofly-toasts/a.png',
    pictureUri: null
  })
  assert.ok(!xml.includes('<script>'))
  assert.ok(!xml.includes('<action content="evil"'))
  assert.ok(xml.includes('&lt;/text&gt;'))
  assert.ok(xml.includes('hint-crop="circle"'))
  assert.ok(xml.includes('<audio silent="true"/>'))
})

test('payload round trip and junk is refused', () => {
  const g = encodePayload({ k: conv, c: conv, a: 'mute-1h' })
  assert.deepEqual(payloadFrom(`type=action&index=1&g=${g}`), { k: conv, c: conv, a: 'mute-1h' })
  assert.deepEqual(payloadFrom(`type=click&g=${encodePayload({ k: 'request:x', c: null })}`), { k: 'request:x', c: null })
  assert.equal(payloadFrom('type=click'), null)
  assert.equal(payloadFrom('g=!!!'), null)
  // A button that isn't one of Glofly's is dropped; a bad chat id becomes null.
  const odd = Buffer.from(JSON.stringify({ k: 'x', c: '../etc', a: 'format-disk' })).toString('base64url')
  assert.deepEqual(payloadFrom(`g=${odd}`), { k: 'x', c: null })
})

test('calls: call scenario, colored buttons, no header', () => {
  const xml = buildToastXml({
    key: 'call:1',
    conversationId: conv,
    title: 'Maya Reyes is calling you',
    body: 'Video call',
    rich: {
      kind: 'call',
      callScenario: true,
      header: { id: 'chat:1', title: 'x' },
      buttons: [
        { id: 'answer', label: 'Answer', style: 'success' },
        { id: 'answer-voice', label: 'Voice only' },
        { id: 'decline', label: 'Decline', style: 'critical' }
      ]
    },
    faceUri: null,
    pictureUri: null
  })
  assert.ok(xml.includes('scenario="incomingCall"'))
  assert.ok(xml.includes('useButtonStyle="true"'))
  assert.ok(xml.includes('hint-buttonStyle="Success"'))
  assert.ok(xml.includes('hint-buttonStyle="Critical"'))
  assert.ok(!xml.includes('<header'))
})

test('at most 5 buttons, the reply Send counts', () => {
  const buttons = (['read', 'mute-1h', 'mute-tomorrow', 'open', 'not-now'] as const).map((id) => ({ id, label: id }))
  const xml = buildToastXml({ key: 'k', conversationId: conv, title: 't', body: 'b', rich: { kind: 'message', reply: 'r', buttons: [...buttons] }, faceUri: null, pictureUri: null })
  assert.equal((xml.match(/<action /g) ?? []).length, 5)
})

test('specs from the window are checked', () => {
  assert.ok(isRichNotification({ kind: 'message', buttons: [{ id: 'read', label: 'Mark as read' }] }))
  assert.ok(!isRichNotification({ kind: 'hack' }))
  assert.ok(!isRichNotification({ kind: 'message', buttons: [{ id: 'rm', label: 'x' }] }))
  assert.ok(!isRichNotification({ kind: 'message', header: { id: 'a b<', title: 't' } }))
  assert.ok(!isRichNotification({ kind: 'message', buttons: new Array(6).fill({ id: 'read', label: 'x' }) }))
})

test('mute until tomorrow is 8 AM the next day', () => {
  const d = tomorrowMorning(new Date(2026, 10, 8, 23, 30))
  assert.equal(d.getDate(), 9)
  assert.equal(d.getHours(), 8)
})
