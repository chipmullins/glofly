// Unit tests for @glofly/shared (run on the built dist/: npm run build && npm test).
const test = require('node:test')
const assert = require('node:assert/strict')
const s = require('../dist/index.js')

test('username rules', () => {
  assert.equal(s.usernameProblem('ab'), 'Usernames need at least 3 characters.')
  assert.equal(s.usernameProblem('a..b'), "Periods and underscores can't be next to each other.")
  assert.equal(s.usernameProblem('Support'), "That username isn't available.")
  assert.equal(s.usernameProblem('_abc'), 'Use letters, numbers, periods and underscores. Start and end with a letter or number.')
  assert.equal(s.usernameProblem('chip.m'), null)
})

test('display names, passwords, birthdays', () => {
  assert.equal(s.displayNameProblem('a​b'), "Display names can't contain hidden characters.")
  assert.equal(s.displayNameProblem('x'.repeat(33)), 'Display names can be at most 32 characters.')
  assert.equal(s.passwordProblem('abcdefgh'), 'Passwords need at least one number.')
  assert.equal(s.passwordProblem('abcdefg1'), null)
  const today = new Date('2026-10-11T12:00:00Z')
  assert.equal(s.birthdayProblem('2013-10-11', today), null)
  assert.equal(s.birthdayProblem('2013-10-12', today), 'You need to be at least 13 to use Glofly.')
  assert.equal(s.birthdayProblem('2001-02-29', today), "That date doesn't exist.")
})

test('mentions', () => {
  assert.deepEqual(s.mentionedNames('hi @Maya.P and a@b.com @maya.p'), ['maya.p'])
  const people = [{ id: '1', username: 'maya', displayName: 'Maya Patel', avatarVersion: null }]
  assert.deepEqual(s.splitMentions('yo @maya!', people).map((p) => [p.text, !!p.user]), [['yo ', false], ['@maya', true], ['!', false]])
  assert.deepEqual(s.mentionQuery('hey @ma', 7), { query: 'ma', start: 4 })
  assert.equal(s.mentionQuery('a@ma', 4), null)
})

test('event lines and older apps', () => {
  assert.equal(s.legacyEventBody({ type: 'left' }), null)
  assert.equal(s.legacyEventBody({ type: 'photo', removed: false }), 'changed the group photo')
  const page = { messages: [{ event: null, body: 'changed the group photo', eventLine: { type: 'photo', removed: false } }] }
  s.upgradeEvents(page)
  assert.deepEqual(page.messages[0], { event: { type: 'photo', removed: false }, body: '' })
  assert.equal(s.eventText({ type: 'photo', removed: true }, 'a', 'me', () => 'Maya'), 'Maya removed the group photo')
  assert.equal(s.eventText({ type: 'someday' }, 'a', 'me', () => 'Maya'), '')
})

test('chat titles, durations, typing', () => {
  const m = (n) => ({ id: n, username: n, displayName: n, avatarVersion: null })
  assert.equal(s.chatTitle({ kind: 'group', name: null, members: [m('Maya'), m('Jacob'), m('Tyler'), m('Ava')] }), 'Maya, Jacob and 2 others')
  assert.equal(s.roughDuration(3900), '1 hr 5 min')
  assert.equal(s.typingText(['Maya', 'Jacob']), 'Maya and Jacob are typing…')
})

test('voice and attachments', () => {
  assert.equal(s.voiceTime(7400), '0:07')
  const peaks = s.toPeaks(Array.from({ length: 200 }, (_, i) => (i % 10) / 10))
  assert.equal(peaks.length, 48)
  assert.equal(Math.max(...peaks), 100)
  assert.equal(s.attachmentSummary([{ kind: 'file', name: 'v.webm', voice: { durationMs: 7000, peaks: [1] } }]), 'Voice message (0:07)')
  assert.equal(s.attachmentSummary([{ kind: 'image', name: 'a' }, { kind: 'image', name: 'b' }]), '2 photos')
})

test('muting and closed chats', () => {
  assert.equal(s.isMuted({ mutedUntil: new Date(Date.now() + 1000).toISOString() }), true)
  assert.equal(s.isMuted({ mutedUntil: null }), false)
  assert.equal(s.isClosed({ closedAt: '2026-10-10T00:00:00Z', lastMessage: { createdAt: '2026-10-09T00:00:00Z' } }), true)
  assert.equal(s.isClosed({ closedAt: '2026-10-10T00:00:00Z', lastMessage: { createdAt: '2026-10-11T00:00:00Z' } }), false)
})

test('phone sounds', () => {
  // Defaults keep the file names phones shipped with (older builds and the server agree on them).
  assert.equal(s.phoneMessageSound(null).native, 'glofly_message')
  assert.equal(s.phoneRingtone(undefined).native, 'glofly_ringtone')
  assert.equal(s.phoneRingtone('nope').id, s.DEFAULT_PHONE_RINGTONE)
  assert.equal(s.isPhoneMessageSound('dewdrop'), true)
  assert.equal(s.isPhoneRingtone('dewdrop'), false)
  // Android res/raw and iPhone bundle names: lowercase letters, digits and underscores, all different.
  const all = [...s.PHONE_MESSAGE_SOUNDS, ...s.PHONE_RINGTONES]
  for (const x of all) assert.match(x.native, /^[a-z][a-z0-9_]*$/)
  assert.equal(new Set(all.map((x) => x.native)).size, all.length)
  assert.equal(new Set(all.map((x) => x.id)).size, all.length)
})

test('active on mobile (0.3.0)', () => {
  const base = { statusText: null, lastSeenAt: null, activity: null }
  assert.equal(s.onMobile({ ...base, status: 'online', mobile: true }), true)
  assert.equal(s.onMobile({ ...base, status: 'offline', mobile: true }), false)
  assert.equal(s.onMobile({ ...base, status: 'online' }), false) // older servers send no flag
  assert.equal(s.mobileLabel({ ...base, status: 'online', mobile: true }), 'Active on mobile')
  assert.equal(s.mobileLabel({ ...base, status: 'dnd', mobile: true }), 'Do not disturb · on mobile')
  assert.equal(s.presenceLine({ ...base, status: 'online', mobile: true }), 'Active on mobile')
  assert.equal(s.presenceLine({ ...base, status: 'online', mobile: true, statusText: 'Brb' }), 'Brb')
  assert.equal(s.presenceHeader({ ...base, status: 'online', mobile: true, statusText: 'Brb' }), 'Active on mobile · Brb')
  assert.equal(s.presenceHeader({ ...base, status: 'online' }), 'Online')
})

test('watch together: YouTube links, positions, event lines', () => {
  const id = 'dQw4w9WgXcQ'
  for (const link of [
    id,
    `https://www.youtube.com/watch?v=${id}&t=42s`,
    `youtube.com/watch?feature=share&v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://m.youtube.com/shorts/${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `https://www.youtube.com/live/${id}`
  ]) assert.equal(s.youTubeIdFrom(link), id, link)
  for (const bad of ['', 'https://vimeo.com/123', `https://evil.com/watch?v=${id}`, 'https://youtube.com/watch?v=short', 'javascript:alert(1)'])
    assert.equal(s.youTubeIdFrom(bad), null, bad)
  assert.equal(s.youTubeStartFrom(`https://youtu.be/${id}?t=90`), 90)
  assert.equal(s.youTubeStartFrom(`https://www.youtube.com/watch?v=${id}&t=1m30s`), 90)
  assert.equal(s.youTubeStartFrom(`https://www.youtube.com/watch?v=${id}`), 0)
  const w = { playing: true, position: 10, at: 1000, durationSec: 30, control: 'starter', startedBy: 'a' }
  assert.equal(s.watchPositionAt(w, 6000), 15)
  assert.equal(s.watchPositionAt(w, 100000), 30)
  assert.equal(s.watchPositionAt({ ...w, playing: false }, 100000), 10)
  assert.equal(s.watchEnded(w, 100000), true)
  assert.equal(s.canControlWatch(w, 'b'), false)
  assert.equal(s.canControlWatch({ ...w, control: 'everyone' }, 'b'), true)
  assert.equal(s.videoTime(3723), '1:02:03')
  assert.equal(s.videoTime(65), '1:05')
  const ev = { type: 'watch', videoId: id, title: 'Sunset' }
  assert.equal(s.eventField(ev), 'eventLine2')
  assert.equal(s.eventField({ type: 'photo', removed: false }), 'eventLine')
  assert.equal(s.eventField({ type: 'left' }), 'event')
  assert.match(s.legacyEventBody(ev), /started watching “Sunset” together/)
  const msg = { event: null, body: 'x', eventLine2: ev }
  s.upgradeEvents(msg)
  assert.deepEqual(msg.event, ev)
  assert.equal(msg.body, '')
  assert.equal('eventLine2' in msg, false)
})

test('watch together: keeping a player in step', () => {
  const w = { callId: 'c', videoId: 'dQw4w9WgXcQ', playing: true, position: 10, at: 0, durationSec: 100, control: 'everyone', startedBy: 'a' }
  const mem = s.newSyncMemory()
  // In step: nothing to do
  let r = s.watchSyncStep(w, 5000, { state: 'playing', time: 15.3, duration: 100, muted: false }, mem, 10_000)
  assert.deepEqual(r.commands, [])
  assert.equal(r.status, 'sync')
  // 3 seconds behind: jump (slightly ahead)
  r = s.watchSyncStep(w, 5000, { state: 'playing', time: 12, duration: 100, muted: false }, mem, 20_000)
  assert.equal(r.commands[0].cmd, 'seek')
  assert.ok(Math.abs(r.commands[0].to - 15.4) < 0.01)
  // …but not again right away
  r = s.watchSyncStep(w, 5000, { state: 'playing', time: 12, duration: 100, muted: false }, mem, 21_000)
  assert.deepEqual(r.commands, [])
  // Paused for everyone: pause the player
  r = s.watchSyncStep({ ...w, playing: false }, 5000, { state: 'playing', time: 10.2, duration: 100, muted: false }, mem, 30_000)
  assert.deepEqual(r.commands, [{ cmd: 'pause' }])
  assert.equal(r.status, 'paused')
  // Should play but won't: play, and after three tries start muted
  const m2 = s.newSyncMemory()
  const stuck = { state: 'paused', time: 15, duration: 100, muted: false }
  s.watchSyncStep(w, 5000, stuck, m2, 2_000)
  s.watchSyncStep(w, 5000, stuck, m2, 4_000)
  r = s.watchSyncStep(w, 5000, stuck, m2, 6_000)
  assert.deepEqual(r.commands.map((c) => c.cmd), ['volume', 'play'])
  assert.equal(r.status, 'blocked')
})

test('glows: brighten each day both write, dim on missed days, never reset', () => {
  const s = require('../dist/index.js')
  let g = { level: 0, days: 0, best: 0, lastDay: null }
  g = s.lightGlow(g, '2026-10-01')
  assert.deepEqual(g, { level: 1, days: 1, best: 1, lastDay: '2026-10-01' })
  g = s.lightGlow(g, '2026-10-02')
  g = s.lightGlow(g, '2026-10-03')
  assert.equal(g.level, 3)
  assert.equal(g.days, 3)
  assert.equal(s.lightGlow(g, '2026-10-03'), g, 'the same day twice changes nothing')
  // Tomorrow, not written yet: still full. Two days later: dimmed by one.
  assert.equal(s.glowNow(g, '2026-10-04').level, 3)
  assert.equal(s.glowNow(g, '2026-10-04').litToday, false)
  assert.equal(s.glowNow(g, '2026-10-05').level, 2)
  // Writing again after one missed day: dims for the miss, then brightens; the days carry on.
  const back = s.lightGlow(g, '2026-10-05')
  assert.equal(back.level, 3)
  assert.equal(back.days, 4)
  // Missed long enough to go fully dim: a new glow starts.
  const restart = s.lightGlow(g, '2026-10-20')
  assert.deepEqual([restart.level, restart.days, restart.best], [1, 1, 3])
  assert.equal(s.glowNow(g, '2026-10-20'), null)
  // Never brighter than 5.
  let h = { level: 0, days: 0, best: 0, lastDay: null }
  for (let d = 1; d <= 9; d++) h = s.lightGlow(h, `2026-11-0${d}`)
  assert.equal(h.level, 5)
  assert.equal(h.days, 9)
  assert.equal(s.glowLabel({ ...s.glowNow(h, '2026-11-09') }), 'Bright 9-day glow')
})

test('birthdays: the day only, Feb 29 on Feb 28 in other years', () => {
  const s = require('../dist/index.js')
  assert.equal(s.isBirthdayOn('1990-10-16', '2026-10-16'), true)
  assert.equal(s.isBirthdayOn('1990-10-16', '2026-10-17'), false)
  assert.equal(s.isBirthdayOn('2004-02-29', '2027-02-28'), true)
  assert.equal(s.isBirthdayOn('2004-02-29', '2028-02-28'), false)
  assert.equal(s.isBirthdayOn('2004-02-29', '2028-02-29'), true)
  assert.equal(s.dayIn(new Date('2026-10-17T03:00:00Z'), 'America/Chicago'), '2026-10-16')
  assert.equal(s.dayGap('2026-02-27', '2026-03-01'), 2)
})

test('0.5.2 Add people: callAdd lines reach older apps as plain text', () => {
  const ev = { type: 'callAdd', callId: 'c', userIds: ['u1', 'u2'], names: ['Dana', 'Sam'], movedTo: null }
  assert.equal(s.eventField(ev), 'eventLine3')
  assert.equal(s.eventField({ type: 'watch', videoId: 'dQw4w9WgXcQ', title: 'x' }), 'eventLine2')
  assert.equal(s.legacyEventBody(ev), 'added Dana and Sam to the call')
  assert.match(s.legacyEventBody({ ...ev, movedTo: 'g' }), /carries on in a new group/)
  const names = { u1: 'Dana', u2: 'Sam', r: 'Riley' }
  assert.equal(s.eventText(ev, 'r', 'me', (id) => names[id]), 'Riley added Dana and Sam to the call')
  assert.equal(s.eventText({ ...ev, userIds: ['me'] }, 'r', 'me', (id) => names[id]), 'Riley added you to the call')
  const msg = { event: null, body: 'added Dana and Sam to the call', eventLine3: ev }
  s.upgradeEvents(msg)
  assert.deepEqual(msg.event, ev)
  assert.equal(msg.body, '')
  assert.equal('eventLine3' in msg, false)
})

test('0.5.2 group calls on your own: the countdown', () => {
  const now = Date.parse('2026-10-17T12:00:00Z')
  assert.equal(s.CALL_SOLO_MS, 7 * 60 * 1000)
  assert.equal(s.soloCountdown(null, now), null)
  assert.equal(s.soloCountdown(new Date(now + 5 * 60_000).toISOString(), now), null)
  assert.equal(s.soloCountdown(new Date(now + 60_000).toISOString(), now), '1:00')
  assert.equal(s.soloCountdown(new Date(now + 41_200).toISOString(), now), '0:42')
  assert.equal(s.soloCountdown(new Date(now - 5_000).toISOString(), now), '0:00')
})
