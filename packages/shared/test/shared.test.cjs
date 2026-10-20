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

test('watch together: a playing video is never muted for autoplay (Oct 17)', () => {
  const w = { callId: 'c', videoId: 'dQw4w9WgXcQ', playing: true, position: 0, at: 0, durationSec: 100, control: 'everyone', startedBy: 'a' }
  // YouTube still says "unstarted" but the time moves on: it's playing, so no mute.
  const m = s.newSyncMemory()
  let muted = false
  for (let i = 0; i < 12; i++) {
    const r = s.watchSyncStep(w, i * 500, { state: 'unstarted', time: i * 0.5, duration: 100, muted: false }, m, 1000 + i * 500)
    if (r.commands.some((c) => c.cmd === 'volume' && c.muted)) muted = true
  }
  assert.equal(muted, false)
  // The desktop app never mutes, however long it takes to start.
  const m2 = s.newSyncMemory()
  const stuck = { state: 'unstarted', time: 0, duration: 100, muted: false }
  for (let t = 2_000; t <= 12_000; t += 2_000) {
    const r = s.watchSyncStep(w, 0, stuck, m2, t, { neverMute: true })
    assert.equal(r.commands.some((c) => c.cmd === 'volume'), false)
    assert.notEqual(r.status, 'blocked')
  }
  // Once it has played with sound, a later stall doesn't mute it either.
  const m3 = s.newSyncMemory()
  s.watchSyncStep(w, 0, { state: 'playing', time: 0, duration: 100, muted: false }, m3, 1_000)
  let r
  for (let t = 3_000; t <= 9_000; t += 2_000) r = s.watchSyncStep(w, 0, { state: 'paused', time: 0, duration: 100, muted: false }, m3, t)
  assert.equal(r.commands.some((c) => c.cmd === 'volume'), false)
})

test('watch together 0.7.1: skips apply at once, ended videos stay ended', () => {
  const w = { callId: 'c', videoId: 'dQw4w9WgXcQ', playing: true, position: 30, at: 0, durationSec: 100, control: 'everyone', startedBy: 'a', last: { userId: 'a', action: 'back' }, seq: 3 }
  // A skip back while YouTube still says "unstarted" (its state lagging): seek straight away.
  const m = s.newSyncMemory()
  s.watchSyncStep(w, 0, { state: 'unstarted', time: 40, duration: 100, muted: false }, m, 1_000)
  s.noteWatchChange(m, w)
  let r = s.watchSyncStep(w, 0, { state: 'unstarted', time: 40.1, duration: 100, muted: false }, m, 1_050)
  assert.equal(r.commands[0].cmd, 'seek')
  assert.ok(Math.abs(r.commands[0].to - 30.2) < 0.01)
  // A step with no fresh report right after: a playing video isn't treated as stopped.
  const m1 = s.newSyncMemory()
  s.watchSyncStep(w, 0, { state: 'unstarted', time: 29.5, duration: 100, muted: false }, m1, 1_000)
  s.watchSyncStep(w, 500, { state: 'unstarted', time: 30, duration: 100, muted: false }, m1, 1_500)
  r = s.watchSyncStep(w, 520, { state: 'unstarted', time: 30, duration: 100, muted: false }, m1, 1_520)
  assert.equal(r.commands.some((c) => c.cmd === 'play'), false)
  // The video ended but the server never learned its length: no "play" and no seek (replay).
  const noLen = { ...w, durationSec: null, position: 0, last: null }
  const m2 = s.newSyncMemory()
  for (let t = 0; t < 6; t++) {
    r = s.watchSyncStep(noLen, 61_000 + t * 500, { state: 'ended', time: 60, duration: 60, muted: false }, m2, 5_000 + t * 2_000)
    assert.deepEqual(r.commands, [])
    assert.equal(r.status, 'ended')
  }
  // Server says ended (paused at the end): an ended player is never asked to seek.
  const atEnd = { ...w, playing: false, position: 100, last: { userId: 'a', action: 'ended' } }
  const m3 = s.newSyncMemory()
  s.noteWatchChange(m3, atEnd)
  r = s.watchSyncStep(atEnd, 0, { state: 'ended', time: 99.2, duration: 100, muted: false }, m3, 1_000)
  assert.deepEqual(r.commands, [])
  // Paused after the end at an earlier moment (someone pressed back): seek, then pause again.
  const back = { ...w, playing: false, position: 90 }
  const m4 = s.newSyncMemory()
  s.noteWatchChange(m4, back)
  r = s.watchSyncStep(back, 0, { state: 'ended', time: 100, duration: 100, muted: false }, m4, 1_000)
  assert.deepEqual(r.commands.map((c) => c.cmd), ['seek', 'pause'])
  // A live stream: only play and pause.
  const live = { ...w, site: 'twitch', videoId: 'c:somechannel', live: true, durationSec: null }
  r = s.watchSyncStep(live, 0, { state: 'paused', time: 1234, duration: 0, muted: false }, s.newSyncMemory(), 5_000)
  assert.deepEqual(r.commands, [{ cmd: 'play' }])
})

test('watch together 0.7.1: links from other sites', () => {
  assert.deepEqual(s.watchLinkFrom('https://www.twitch.tv/videos/2345678901?t=1h2m3s'), { site: 'twitch', videoId: 'v2345678901', live: false, start: 3723 })
  assert.deepEqual(s.watchLinkFrom('twitch.tv/Some_Streamer'), { site: 'twitch', videoId: 'c:some_streamer', live: true, start: 0 })
  assert.equal(s.watchLinkFrom('https://twitch.tv/directory'), null)
  assert.deepEqual(s.watchLinkFrom('https://vimeo.com/76979871'), { site: 'vimeo', videoId: '76979871', live: false, start: 0 })
  assert.deepEqual(s.watchLinkFrom('https://vimeo.com/76979871/1a2b3c4d5e#t=90'), { site: 'vimeo', videoId: '76979871:1a2b3c4d5e', live: false, start: 90 })
  assert.deepEqual(s.watchLinkFrom('https://player.vimeo.com/video/76979871?h=abcdef12'), { site: 'vimeo', videoId: '76979871:abcdef12', live: false, start: 0 })
  assert.deepEqual(s.watchLinkFrom('https://www.dailymotion.com/video/x8abcd1_some-title'), { site: 'dailymotion', videoId: 'x8abcd1', live: false, start: 0 })
  assert.deepEqual(s.watchLinkFrom('https://dai.ly/x8abcd1'), { site: 'dailymotion', videoId: 'x8abcd1', live: false, start: 0 })
  assert.equal(s.watchLinkFrom('https://www.youtube.com/watch?v=dQw4w9WgXcQ').site, 'youtube')
  for (const bad of ['https://netflix.com/watch/123', 'https://evil.com/videos/12345', 'vimeo.com/abc', 'javascript:alert(1)']) assert.equal(s.watchLinkFrom(bad), null, bad)
  // States: a Twitch one passes the check, one with a bad id doesn't; no site = YouTube.
  const base = { callId: '7f8b5a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b', startedBy: '7f8b5a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5c', control: 'everyone', playing: true, position: 0, at: 1, seq: 1, title: 't' }
  assert.equal(s.cleanWatchState({ ...base, site: 'twitch', videoId: 'c:abc', live: true }).live, true)
  assert.equal(s.cleanWatchState({ ...base, site: 'twitch', videoId: 'dQw4w9WgXcQ' }), null)
  assert.equal(s.cleanWatchState({ ...base, videoId: 'dQw4w9WgXcQ' }).site, 'youtube')
  assert.equal(s.cleanWatchState({ ...base, site: 'netflix', videoId: 'dQw4w9WgXcQ' }), null)
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

test('0.7.5 photo viewer: photos, when, zoom', () => {
  const img = (id, extra = {}) => ({ id, kind: 'image', name: id, size: 1, width: 100, height: 50, ...extra })
  const msgs = [
    { id: 'b', senderId: 'u', createdAt: '2026-10-17T12:00:00Z', deleted: false, attachments: [img('p2'), img('s', { sticker: true })] },
    { id: 'a', senderId: 'u', createdAt: '2026-10-16T12:00:00Z', deleted: false, attachments: [img('p1'), { ...img('f'), kind: 'file' }] },
    { id: 'c', senderId: 'u', createdAt: '2026-10-18T12:00:00Z', deleted: true, attachments: [img('gone')] }
  ]
  assert.deepEqual(s.viewerPhotos(msgs).map((p) => p.photo.id), ['p1', 'p2'])
  const now = new Date(2026, 9, 20, 9, 0)
  assert.equal(s.photoWhen(new Date(2026, 9, 20, 8, 5).toISOString(), now), 'Today 8:05 AM')
  assert.equal(s.photoWhen(new Date(2026, 9, 19, 18, 42).toISOString(), now), 'Yesterday 6:42 PM')
  assert.equal(s.photoWhen(new Date(2026, 9, 17, 18, 42).toISOString(), now), 'Saturday 6:42 PM')
  assert.equal(s.photoWhen(new Date(2026, 9, 3, 0, 15).toISOString(), now), 'Oct 3, 12:15 AM')
  assert.equal(s.photoWhen(new Date(2025, 9, 3, 12, 0).toISOString(), now), 'Oct 3, 2025, 12:00 PM')
  assert.equal(s.photoSubtitle(new Date(2026, 9, 17, 18, 42).toISOString(), 'Weekend Hike', now), 'Saturday 6:42 PM · in Weekend Hike')
  assert.equal(s.photoSubtitle(new Date(2026, 9, 17, 18, 42).toISOString(), null, now), 'Saturday 6:42 PM')
  assert.equal(s.fitScale({ w: 2000, h: 1000 }, { w: 1000, h: 1000 }), 0.5)
  assert.equal(s.fitScale({ w: 200, h: 100 }, { w: 1000, h: 1000 }), 1)
  assert.equal(s.stepZoom(0.5, 0.5, 1), 0.625)
  assert.equal(s.stepZoom(0.6, 0.5, -1), null)
  assert.equal(s.stepZoom(8, 0.5, 1), 8)
  assert.equal(s.toggleZoom(null, 0.5), 1)
  assert.equal(s.toggleZoom(null, 1), 2)
  assert.equal(s.toggleZoom(1, 0.5), null)
  assert.deepEqual(s.clampPan({ x: 900, y: -900 }, { w: 2000, h: 1000 }, 1, { w: 1000, h: 800 }), { x: 500, y: -100 })
  assert.deepEqual(s.zoomAround({ x: 0, y: 0 }, 1, 2, { x: 100, y: 0 }), { x: -100, y: 0 })
})

test('0.8.0 AutoMod: blocked words, l33t, whole words, wildcards', () => {
  const words = ['free nitro', 'crypto giveaway', 'onlyf*ns', 'scam']
  assert.equal(s.blockedWordIn('get FREE NITRO here', words), 'free nitro')
  assert.equal(s.blockedWordIn('fr33 n1tr0 lol', words), 'free nitro')
  assert.equal(s.blockedWordIn('Fr€€   Nítro!!', words), 'free nitro')
  assert.equal(s.blockedWordIn('fr.ee nitro', words), 'free nitro')
  assert.equal(s.blockedWordIn('💰 CRYPTO GIVEAWAY click here', words), 'crypto giveaway')
  assert.equal(s.blockedWordIn('check my onlyfans', words), 'onlyf*ns')
  assert.equal(s.blockedWordIn('onlyf*ns link', words), 'onlyf*ns')
  assert.equal(s.blockedWordIn('$c@m alert', words), 'scam')
  assert.equal(s.blockedWordIn('n!tro is fr|ee', ['nitro']), 'nitro')
  // whole words only
  assert.equal(s.blockedWordIn('scampi for dinner', words), null)
  assert.equal(s.blockedWordIn('freenitro', words), null)
  assert.equal(s.blockedWordIn('game night at 8', words), null)
  assert.equal(s.blockedWordIn('', words), null)
  assert.equal(s.blockedWordIn('scam', []), null)
  assert.equal(s.cleanBlockedWord('  Free   Nitro '), 'free nitro')
  assert.equal(s.cleanBlockedWord('*'), null)
  assert.equal(s.cleanBlockedWord('a*'), null)
  assert.equal(s.cleanBlockedWord('x'.repeat(41)), null)
})

test('0.8.0 AutoMod: links and waits', () => {
  assert.deepEqual(s.linksIn('see https://Example.com/a/ and www.foo.io/x, ok?'), ['example.com/a', 'foo.io/x'])
  assert.deepEqual(s.linksIn('no links here'), [])
  assert.equal(s.slowModeWait(12.2), 'Slow mode is on here: you can post again in 13 seconds.')
  assert.equal(s.slowModeWait(0.3), 'Slow mode is on here: you can post again in 1 second.')
  assert.equal(s.newMemberWait(5.5, 10), 'New members can post after 10 minutes. You can post in 6 minutes.')
  assert.equal(s.slowModeLabel(120), '2 min')
  assert.equal(s.isSlowModeChoice(30), true)
  assert.equal(s.isSlowModeChoice(31), false)
})

test('0.8.0 events: phases, labels, calendar file', () => {
  const now = Date.parse('2026-10-20T12:00:00Z')
  const e = (start, extra = {}) => ({ startsAt: new Date(start).toISOString(), endsAt: null, cancelledAt: null, ...extra })
  assert.equal(s.eventPhase(e(now + 3600_000), now), 'upcoming')
  assert.equal(s.eventPhase(e(now + 10 * 60_000), now), 'soon')
  assert.equal(s.eventPhase(e(now - 60_000), now), 'live')
  assert.equal(s.eventPhase(e(now - 4 * 3600_000), now), 'ended')
  assert.equal(s.eventPhase(e(now - 4 * 3600_000, { endsAt: new Date(now + 60_000).toISOString() }), now), 'live')
  assert.equal(s.eventPhase(e(now + 3600_000, { cancelledAt: new Date(now).toISOString() }), now), 'cancelled')
  assert.equal(s.eventWhenLabel(e(now + 15 * 60_000), now), 'Starts in 15 min')
  assert.equal(s.eventWhenLabel(e(now - 60_000), now), 'Happening now')
  const local = new Date(2026, 9, 20, 9, 0).getTime()
  assert.equal(s.eventWhenLabel(e(new Date(2026, 9, 24, 20, 30).getTime()), local), 'In 4 days')
  assert.equal(s.eventWhenLabel(e(new Date(2026, 9, 21, 20, 30).getTime()), local), 'Tomorrow')
  assert.equal(s.eventWhenLabel(e(new Date(2026, 9, 20, 12, 0).getTime()), local), 'In 3 hours')
  assert.deepEqual(s.eventDateTile('2026-10-25T00:30:00Z', 'America/New_York'), { weekday: 'SAT', day: '24', month: 'OCT' })
  assert.equal(s.eventTimeLabel('2026-10-25T00:30:00Z', 'America/New_York'), '8:30 PM Eastern')
  assert.equal(s.eventTimeLabel('2026-10-25T00:30:00Z', 'America/Chicago'), '7:30 PM Central')
  assert.match(s.eventFallbackText({ title: 'Game Night', startsAt: '2026-10-25T00:30:00Z', timeZone: 'America/New_York', voiceName: 'Campfire' }), /^📅 Game Night · Sat, Oct 24, 8:30 PM EDT · in Campfire$/)
  const ics = s.eventIcs({ id: 'e1', title: 'Game Night; snacks, too', description: 'Line 1\nLine 2', startsAt: '2026-10-25T00:30:00Z', endsAt: null }, 'Firefly Guild · Campfire')
  assert.match(ics, /DTSTART:20261025T003000Z/)
  assert.match(ics, /DTEND:20261025T033000Z/)
  assert.ok(ics.includes('SUMMARY:Game Night\\; snacks\\, too'))
  assert.ok(ics.includes('DESCRIPTION:Line 1\\nLine 2'))
  assert.match(ics, /TRIGGER:-PT15M/)
  assert.equal(s.rsvpSummary(11, 4), '11 going · 4 maybe')
  assert.equal(s.rsvpSummary(3, 0), '3 going')
  assert.equal(s.isRsvpAnswer('maybe'), true)
  assert.equal(s.isRsvpAnswer('yes'), false)
})

test('0.8.0 search and inbox helpers', () => {
  assert.deepEqual(s.searchWords('Rocket  league r'), ['rocket', 'league'])
  assert.deepEqual(s.highlightPieces('That rocket save', ['rocket']), [
    { text: 'That ', hit: false },
    { text: 'rocket', hit: true },
    { text: ' save', hit: false }
  ])
  assert.deepEqual(s.highlightPieces('Rocket League', ['rocket']).map((p) => p.hit), [true, false])
  const fri = s.lastWeekday(5, new Date(2026, 9, 20, 15, 0)) // a Tuesday
  assert.equal(fri.getDate(), 16)
  assert.equal(s.lastWeekday(2, new Date(2026, 9, 20, 15, 0)).getDate(), 13)
  assert.equal(s.isInboxTab('replies'), true)
  assert.equal(s.isInboxTab('spam'), false)
  assert.equal(s.isSearchHas('image'), true)
})

test('0.8.0 constellation events pass the live-event checker', () => {
  assert.deepEqual(s.cleanConstellationEvent('constellation:event', { constellationId: 'c', eventId: 'e', phase: 'changed' }), {
    type: 'constellation:event',
    constellationId: 'c',
    eventId: 'e',
    phase: 'changed'
  })
  const r = s.cleanConstellationEvent('constellation:event', { constellationId: 'c', eventId: 'e', phase: 'started', title: 'Game Night', voiceNebulaId: 'v', inVoice: 9 })
  assert.equal(r.phase, 'started')
  assert.equal(r.inVoice, 9)
  assert.equal(r.voiceNebulaId, 'v')
  assert.equal(s.cleanConstellationEvent('constellation:event', { eventId: 'e' }), null)
  assert.deepEqual(s.cleanConstellationEvent('inbox:changed', {}), { type: 'inbox:changed' })
  assert.ok(s.CONSTELLATION_EVENT_NAMES.includes('inbox:changed'))
  assert.ok(s.DEFAULT_ROLES.find((r) => r.kind === 'member').permissions.includes('events'))
})

test('0.7.5 quick switcher matching', () => {
  assert.ok(s.matchScore('ma', 'Maya Lopez') > s.matchScore('ma', 'Game Night'))
  assert.ok(s.matchScore('lop', 'Maya Lopez') > 0) // a word starts with it
  assert.ok(s.matchScore('gn', 'Game Night') > 0) // initials
  assert.ok(s.matchScore('night game', 'Game Night') > 0) // words in any order
  assert.equal(s.matchScore('xyz', 'Game Night'), 0)
  assert.ok(s.matchScore('quiet', 'Quiet hours') > s.matchScore('sleep', 'Quiet hours', 'quiet hours night sleep'))
  assert.ok(s.matchScore('sleep', 'Quiet hours', 'quiet hours night sleep') > 0) // keywords
  assert.ok(s.matchScore('jose', 'José') > 0) // accents don't matter
  assert.equal(s.matchScore('', 'anything'), 1)
})
