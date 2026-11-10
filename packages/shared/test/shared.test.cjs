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
  assert.equal(s.phoneMessageSound('lowComet').id, s.DEFAULT_PHONE_MESSAGE_SOUND) // no longer offered (Oct 30, 2026)
  assert.equal(s.isPhoneMessageSound('mmHm'), true)
  assert.equal(s.isPhoneMessageSound('dewdrop'), false)
  assert.equal(s.phoneConstellationSound('nope').id, s.DEFAULT_PHONE_CONSTELLATION_SOUND)
  for (const x of s.PHONE_CONSTELLATION_SOUNDS) assert.match(x.native, /^[a-z][a-z0-9_]*$/)
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

test('watch together: live streams ask for a tap too; a player stuck even muted lets people click it (0.9.3)', () => {
  // A Twitch channel the browser won't start with sound: muted after three tries, then a tap.
  const live = { callId: 'c', videoId: 'c:somechannel', site: 'twitch', live: true, playing: true, position: 0, at: 0, durationSec: null, control: 'everyone', startedBy: 'a' }
  let m = s.newSyncMemory()
  let r
  for (let i = 1; i <= 2; i++) r = s.watchSyncStep(live, 0, { state: 'cued', time: 0, duration: 0, muted: false }, m, i * 2_000)
  assert.equal(r.status, 'catching')
  r = s.watchSyncStep(live, 0, { state: 'cued', time: 0, duration: 0, muted: false }, m, 6_000)
  assert.deepEqual(r.commands.map((c) => c.cmd), ['volume', 'play'])
  assert.equal(r.status, 'blocked')
  r = s.watchSyncStep(live, 0, { state: 'playing', time: 1, duration: 0, muted: true }, m, 7_000)
  assert.equal(r.status, 'sync')
  // Muted and still not starting (Twitch's "Start watching" screen): a click after ~12 s.
  m = s.newSyncMemory()
  for (let i = 1; i <= 7; i++) {
    r = s.watchSyncStep(live, 0, { state: 'cued', time: 0, duration: 0, muted: i > 3 }, m, i * 2_000)
    if (i > 3) assert.equal(r.status, 'catching')
  }
  r = s.watchSyncStep(live, 0, { state: 'cued', time: 0, duration: 0, muted: true }, m, 16_000)
  assert.equal(r.status, 'blocked')
  // Same for a video, and the desktop app (never mutes) gets there too.
  const vid = { callId: 'c', videoId: 'v123456789', site: 'twitch', playing: true, position: 0, at: 0, durationSec: 100, control: 'everyone', startedBy: 'a' }
  m = s.newSyncMemory()
  for (let i = 1; i <= 8; i++) r = s.watchSyncStep(vid, 0, { state: 'unstarted', time: 0, duration: 0, muted: false }, m, i * 2_000, { neverMute: true })
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

test('0.7.5 constellation community: milestones, join lines, accents, playing time', () => {
  assert.equal(s.milestoneReached(9, 10), 10)
  assert.equal(s.milestoneReached(10, 11), null)
  assert.equal(s.milestoneReached(49, 100), 100)
  const joined = { type: 'cxJoined', name: 'Firefly Guild' }
  const ms = { type: 'cxMilestone', name: 'Firefly Guild', members: 100, years: null }
  assert.equal(s.eventField(joined), 'eventLine4')
  assert.equal(s.eventField(ms), 'eventLine4')
  assert.equal(s.eventField({ type: 'callAdd', callId: 'c', userIds: [], names: [], movedTo: null }), 'eventLine3')
  assert.equal(s.legacyEventBody(joined), 'joined Firefly Guild 👋')
  assert.equal(s.legacyEventBody(ms), '🎉 Firefly Guild just reached 100 members!')
  assert.equal(s.milestoneText({ name: 'X', members: null, years: 2 }), '🎂 X turns 2 today!')
  const msg = { event: null, body: 'joined Firefly Guild 👋', eventLine4: joined }
  s.upgradeEvents(msg)
  assert.deepEqual(msg.event, joined)
  assert.equal('eventLine4' in msg, false)
  assert.equal(s.eventText(joined, 'u1', 'me', () => 'Priya'), 'Priya joined Firefly Guild. Say hi!')
  assert.equal(s.eventText(joined, 'me', 'me', () => 'Priya'), 'You joined Firefly Guild')
  assert.equal(s.accentOf({}).color, '#ffb347')
  assert.equal(s.accentOf({ accent: 'lagoon' }).legacy, 'lagoon')
  assert.equal(s.accentOf({ accent: 'nope' }).name, 'Firefly gold')
  assert.equal(s.isConstellationAccent('rose'), true)
  const now = Date.parse('2026-10-20T20:00:00Z')
  assert.equal(s.playingFor('2026-10-20T19:18:00Z', now), '42 min')
  assert.equal(s.playingFor('2026-10-20T18:48:00Z', now), '1 h 12 min')
  assert.equal(s.playingFor('2026-10-20T18:00:00Z', now), '2 h')
  assert.equal(s.gameInitials('Rocket League'), 'RL')
  assert.equal(s.gameInitials('Valorant'), 'VAL')
})

test('keyboard shortcuts: one list, per app', () => {
  const desk = s.shortcutSections('desktop', { mod: 'Ctrl', alt: 'Alt' })
  const tab = s.shortcutSections('tablet', { mod: '⌘', alt: '⌥' })
  const lines = (secs) => secs.flatMap((x) => x.lines.map((l) => l.what))
  assert.ok(lines(desk).includes('Send'))
  assert.ok(!lines(tab).includes('Send'))
  assert.ok(lines(tab).includes('New message'))
  assert.ok(!lines(desk).includes('New message'))
  assert.deepEqual(tab[0].lines[0].keys, [['⌘', 'K']])
  assert.deepEqual(desk[0].lines[0].keys, [['Ctrl', 'K']])
  assert.ok(!tab.some((x) => x.title === 'Photo viewer'))
  const neb = tab.find((x) => x.title === 'Constellations')
  assert.deepEqual(neb.lines[0].keys, [['⌥', '↑'], ['⌥', '↓']])
})

test('status clear after (0.8.0)', () => {
  const chi = 'America/Chicago'
  // Tuesday Oct 20, 2026, 1:10 PM in Chicago (CDT, UTC-5).
  const now = new Date('2026-10-20T18:10:00Z')
  assert.equal(s.statusClearEndsAt('never', now, chi), null)
  assert.equal(s.statusClearEndsAt('30m', now, chi).toISOString(), '2026-10-20T18:40:00.000Z')
  assert.equal(s.statusClearEndsAt('4h', now, chi).toISOString(), '2026-10-20T22:10:00.000Z')
  assert.equal(s.statusClearEndsAt('today', now, chi).toISOString(), '2026-10-21T05:00:00.000Z')
  assert.equal(s.statusClearEndsAt('week', now, chi).toISOString(), '2026-10-26T05:00:00.000Z')
  // Same moment in Tokyo is already Wednesday 3:10 AM.
  assert.equal(s.statusClearEndsAt('today', now, 'Asia/Tokyo').toISOString(), '2026-10-21T15:00:00.000Z')
  assert.equal(s.statusClearEndsAt('week', now, 'Asia/Tokyo').toISOString(), '2026-10-25T15:00:00.000Z')
  // Sunday evening: "This week" is tonight.
  const sun = new Date('2026-10-25T23:00:00Z') // 6 PM Sunday in Chicago
  assert.equal(s.statusClearEndsAt('week', sun, chi).toISOString(), '2026-10-26T05:00:00.000Z')
  // Across the clock change (Nov 1, 2026: CDT → CST): Saturday night's week ends at CST midnight.
  const sat = new Date('2026-10-31T20:00:00Z')
  assert.equal(s.statusClearEndsAt('week', sat, chi).toISOString(), '2026-11-02T06:00:00.000Z')
  assert.equal(s.statusClearEndsAt('today', sat, chi).toISOString(), '2026-11-01T05:00:00.000Z')
  // A zone whose midnight is skipped (Santiago springs forward at 00:00 → 01:00 on Sep 6, 2026).
  const santiago = s.statusClearEndsAt('today', new Date('2026-09-05T20:00:00Z'), 'America/Santiago')
  assert.equal(santiago.toISOString(), '2026-09-06T04:00:00.000Z')
  // Half-hour zone.
  assert.equal(s.statusClearEndsAt('today', now, 'Asia/Kolkata').toISOString(), '2026-10-20T18:30:00.000Z')

  const o = { timeZone: chi, locale: 'en-US' }
  assert.equal(s.statusEndsLine(null, now, o), 'Stays until you change it')
  assert.equal(s.statusEndsLine('2026-10-20T22:10:00Z', now, o), 'Clears at 5:10 PM (in 4 hours)')
  assert.equal(s.statusEndsLine('2026-10-20T18:40:00Z', now, o), 'Clears at 1:40 PM (in 30 minutes)')
  assert.equal(s.statusEndsLine('2026-10-20T19:10:00Z', now, o), 'Clears at 2:10 PM (in 1 hour)')
  assert.equal(s.statusEndsLine('2026-10-20T20:40:00Z', now, o), 'Clears at 3:40 PM (in about 3 hours)')
  assert.equal(s.statusEndsLine('2026-10-21T05:00:00Z', now, o), 'Clears tonight at midnight')
  assert.equal(s.statusEndsLine('2026-10-26T05:00:00Z', now, o), 'Clears Sunday night at midnight')
  assert.equal(s.statusEndsLine('2026-10-22T05:00:00Z', now, o), 'Clears Wednesday night at midnight')

  assert.equal(s.statusClearChoiceFor(null, now, chi), 'never')
  assert.equal(s.statusClearChoiceFor('2026-10-21T05:00:00Z', now, chi), 'today')
  assert.equal(s.statusClearChoiceFor('2026-10-26T05:00:00Z', now, chi), 'week')
  assert.equal(s.statusClearChoiceFor('2026-10-20T18:30:00Z', now, chi), '30m')
  assert.equal(s.statusClearChoiceFor('2026-10-20T21:00:00Z', now, chi), '4h')
  assert.equal(s.isTimeZone('Europe/Berlin'), true)
  assert.equal(s.isTimeZone('Mars/Base'), false)
  assert.equal(s.isStatusClearAfter('week'), true)
  assert.equal(s.isStatusClearAfter('2h'), false)
})

test('friend invite links (0.8.0)', () => {
  assert.equal(s.friendLinkSlug('Chip.M_2'), 'chipm2')
  assert.equal(s.friendLinkSlug('___'), 'glofly')
  assert.equal(s.friendLinkSlug('averyveryverylongusername'), 'averyveryver')
  assert.ok(s.FRIEND_LINK_PATTERN.test('chip-7Kq4mZ'))
  assert.ok(!s.FRIEND_LINK_PATTERN.test('Chip-7Kq4mZ'))
  assert.ok(!s.FRIEND_LINK_PATTERN.test('chip-7Kq4m'))
  assert.equal(s.friendLinkCodeFrom('https://glofly.app/i/chip-7Kq4mZ'), 'chip-7Kq4mZ')
  assert.equal(s.friendLinkCodeFrom('glofly.app/i/chip-7Kq4mZ?x=1'), 'chip-7Kq4mZ')
  assert.equal(s.friendLinkCodeFrom('glofly://i/chip-7Kq4mZ'), 'chip-7Kq4mZ')
  assert.equal(s.friendLinkCodeFrom('https://chat.glofly.app/?friend=chip-7Kq4mZ'), 'chip-7Kq4mZ')
  assert.equal(s.friendLinkCodeFrom(' chip-7Kq4mZ '), 'chip-7Kq4mZ')
  assert.equal(s.friendLinkCodeFrom('https://glofly.app/c/AbC123'), null)
  assert.equal(s.friendLinkCodeFrom('chip-7Kq4mZ<script>'), null)
  assert.equal(s.friendLinkUrl('chip-7Kq4mZ'), 'https://glofly.app/i/chip-7Kq4mZ')
  assert.equal(s.friendLinkJoinedLine(3), '3 friends joined from your link')
  assert.equal(s.friendLinkJoinedLine(1), '1 friend joined from your link')
  assert.equal(s.friendLinkJoinedLine(0), 'New link. Nobody has used it yet.')
  assert.equal(s.friendLinkShareMessage('chip-7Kq4mZ'), 'Join me on Glofly https://glofly.app/i/chip-7Kq4mZ')
})

test('0.8.0 role-only nebulas and templates', () => {
  const held = new Set(['val'])
  assert.equal(s.gateOpen(undefined, held), true)
  assert.equal(s.gateOpen({ visibility: 'everyone', roleIds: ['x'] }, held), true)
  assert.equal(s.gateOpen({ visibility: 'roles', roleIds: ['val', 'rl'] }, held), true)
  assert.equal(s.gateOpen({ visibility: 'roles', roleIds: [] }, held), false)
  const valorant = { visibility: 'roles', roleIds: ['val'] }
  assert.equal(s.canSeeNebula(false, held, valorant, null), true)
  assert.equal(s.canSeeNebula(false, new Set(), valorant, null), false)
  assert.equal(s.canSeeNebula(true, new Set(), valorant, { visibility: 'roles', roleIds: ['rl'] }), true)
  // A role-only category gates everything inside it
  assert.equal(s.canSeeNebula(false, held, valorant, { visibility: 'roles', roleIds: ['rl'] }), false)
  assert.equal(s.canSeeNebula(false, new Set(['val', 'rl']), valorant, { visibility: 'roles', roleIds: ['rl'] }), true)
  assert.equal(s.nebulaLabel({ kind: 'text', name: 'valorant' }), '#valorant')
  assert.equal(s.nebulaLabel({ kind: 'voice', name: 'Campfire' }), 'Campfire')
  const ids = s.CONSTELLATION_TEMPLATES.map((t) => t.id)
  assert.deepEqual(ids, ['blank', 'friends', 'gaming', 'study'])
  const gaming = s.CONSTELLATION_TEMPLATES.find((t) => t.id === 'gaming')
  assert.equal(gaming.accent, 'violet')
  assert.deepEqual(gaming.roles.map((r) => r.name), ['Rocket League', 'Valorant', 'Minecraft'])
  const games = gaming.categories.find((c) => c.name === 'Games')
  for (const n of games.nebulas) assert.equal(gaming.roles.some((r) => r.name === n.roles[0]), true)
  for (const t of s.CONSTELLATION_TEMPLATES) {
    assert.equal(s.isConstellationAccent(t.accent), true)
    for (const r of t.roles) assert.equal(s.ROLE_COLOR_CHOICES.includes(r.color), true)
    assert.equal(t.rules.length <= s.RULES_MAX, true)
  }
})

test('dashboard star pattern (Nov 6)', () => {
  const a = s.starChartFor('5a0d3ef7-1f30-4816-b751-cdc70944d78c')
  assert.deepEqual(a, s.starChartFor('5a0d3ef7-1f30-4816-b751-cdc70944d78c'))
  assert.notDeepEqual(a, s.starChartFor('88c1a64c-2203-4c02-bb88-8b138b97c9f7'))
  assert.equal(a.stars.length >= 4 && a.stars.length <= 6, true)
  for (const st of a.stars) assert.equal(st.x > 0 && st.x < 1 && st.y > 0 && st.y < 1, true)
  for (let i = 1; i < a.stars.length; i++) assert.equal(a.stars[i].x > a.stars[i - 1].x, true)
  const sky = Array.from({ length: 10 }, (_, i) => ({ kind: 'text', news: i === 1, chatting: i === 2, voice: 0 }))
  const b = s.starChartFor('x', sky)
  assert.equal(b.stars.length, 7)
  assert.equal(b.stars[1].bright, true)
  assert.equal(b.stars[2].big, true)
  assert.equal(s.starChartFor('x', sky.slice(0, 1)).stars.length, 3)
  for (const [i, j] of b.links) assert.equal(i < b.stars.length && j < b.stars.length, true)
})

test('link codes: typed any way, shown as 482-913', () => {
  assert.equal(s.normalizeLinkCode('482-913'), '482913')
  assert.equal(s.normalizeLinkCode(' 482 913 '), '482913')
  assert.equal(s.normalizeLinkCode('48291'), null)
  assert.equal(s.normalizeLinkCode('48291a'), null)
  assert.equal(s.formatLinkCode('482913'), '482-913')
})

// Communities round 4.2: @everyone, @here and role mentions
test('group mentions: everyone, here, roles with spaces, word edges', () => {
  const roles = [{ id: 'r1', name: 'Raiders' }, { id: 'r2', name: 'Night Raiders' }, { id: 'r3', name: 'Healers' }]
  assert.deepStrictEqual(s.groupMentionsIn('@everyone raid in 10', roles), { everyone: 'everyone', roleIds: [] })
  assert.deepStrictEqual(s.groupMentionsIn('hey @here and @EVERYONE', roles), { everyone: 'everyone', roleIds: [] })
  assert.deepStrictEqual(s.groupMentionsIn('@here', roles), { everyone: 'here', roleIds: [] })
  assert.deepStrictEqual(s.groupMentionsIn('@Night Raiders and @healers!', roles), { everyone: null, roleIds: ['r2', 'r3'] })
  assert.deepStrictEqual(s.groupMentionsIn('@raiders, go', roles), { everyone: null, roleIds: ['r1'] })
  // Not inside an email, not when the word goes on
  assert.deepStrictEqual(s.groupMentionsIn('me@everyone.com @everyones @Healersx', roles), { everyone: null, roleIds: [] })
  const pieces = s.splitGroupMentions('stack @Healers now', roles)
  assert.deepStrictEqual(pieces.map((p) => p.kind), ['text', 'role', 'text'])
  assert.strictEqual(pieces[1].text, '@Healers')
})

test('group mention suggestions follow the permission', () => {
  const roles = [{ id: 'm', name: 'Member', kind: 'member' }, { id: 'r1', name: 'Raiders', kind: 'custom', mentionable: true }, { id: 'r3', name: 'Healers', kind: 'custom' }]
  assert.deepStrictEqual(s.groupMentionSuggestions('e', roles, true).map((s) => s.kind), ['everyone'])
  assert.deepStrictEqual(s.groupMentionSuggestions('', roles, false).map((s) => s.role.id), ['r1'])
  assert.deepStrictEqual(s.groupMentionSuggestions('h', roles, true).map((s) => s.kind + (s.role ? s.role.id : '')), ['here', 'roler3'])
  assert.ok(s.mentionsMe({ mentions: [], mentionRoles: ['r1'] }, 'me', ['r1']))
  assert.ok(!s.mentionsMe({ mentions: [], mentionRoles: ['r1'] }, 'me'))
})

// Communities round: cfx.re/join links
test('cfx.re join links and server names', () => {
  assert.equal(s.cfxJoinCodeIn('come play https://cfx.re/join/Ab12cd tonight'), 'ab12cd')
  assert.equal(s.cfxJoinCodeIn('cfx.re/join/xyz789.'), 'xyz789')
  assert.equal(s.cfxJoinCodeIn('evilcfx.re/join/abc123'), null)
  assert.equal(s.cfxJoinCodeIn('https://cfx.re/join/abc123/extra'), null)
  assert.equal(s.cleanCfxName('^1Cozy ^7RP ~r~| Serious​ RP'), 'Cozy RP | Serious RP')
  assert.equal(s.cfxConnectUrl('abc123', 'redm'), 'redm://connect/cfx.re/join/abc123')
})

// 0.9.3: text formatting
test('formatting: inline markers, nesting, escapes, links', () => {
  const p = (t) => s.parseInline(t)
  assert.deepStrictEqual(p('**bold**'), [{ t: 'b', c: [{ t: 'text', text: 'bold' }] }])
  assert.deepStrictEqual(p('a *b* c'), [{ t: 'text', text: 'a ' }, { t: 'i', c: [{ t: 'text', text: 'b' }] }, { t: 'text', text: ' c' }])
  assert.deepStrictEqual(p('~~x~~ ||y||').map((n) => n.t), ['s', 'text', 'spoiler'])
  assert.deepStrictEqual(p('`**not bold**`'), [{ t: 'code', text: '**not bold**' }])
  assert.deepStrictEqual(p('**bold *and italic***')[0].c.map((n) => n.t), ['text', 'i'])
  // snake_case, @mentions and lone markers stay plain
  assert.deepStrictEqual(p('my_var_name and @maya_p'), [{ t: 'text', text: 'my_var_name and @maya_p' }])
  assert.deepStrictEqual(p('2 * 3 * 4'), [{ t: 'text', text: '2 * 3 * 4' }])
  assert.deepStrictEqual(p('_hi_ there'), [{ t: 'i', c: [{ t: 'text', text: 'hi' }] }, { t: 'text', text: ' there' }])
  assert.deepStrictEqual(p('\\*not italic\\*'), [{ t: 'text', text: '*not italic*' }])
  assert.deepStrictEqual(p('see https://glofly.app/terms.'), [{ t: 'text', text: 'see ' }, { t: 'link', url: 'https://glofly.app/terms' }, { t: 'text', text: '.' }])
  assert.deepStrictEqual(p('(https://en.wikipedia.org/wiki/A_(b))'), [{ t: 'text', text: '(' }, { t: 'link', url: 'https://en.wikipedia.org/wiki/A_(b)' }, { t: 'text', text: ')' }])
  assert.deepStrictEqual(p('ftp://x javascript:alert(1)'), [{ t: 'text', text: 'ftp://x javascript:alert(1)' }])
})

test('formatting: blocks', () => {
  const b = s.parseFormatted('hi\n> quoted\n> more\n```lua\nlocal x = 1\n```\nbye')
  assert.deepStrictEqual(b.map((x) => x.t), ['p', 'quote', 'codeblock', 'p'])
  assert.equal(b[2].lang, 'lua')
  assert.equal(b[2].code, 'local x = 1')
  assert.deepStrictEqual(s.parseFormatted('```one line```')[0], { t: 'codeblock', lang: null, code: 'one line' })
  // An unclosed fence runs to the end
  assert.equal(s.parseFormatted('```\nabc\ndef')[0].code, 'abc\ndef')
  // ">" without a space isn't a quote (">_<")
  assert.equal(s.parseFormatted('>_<')[0].t, 'p')
})

test('formatting: plain previews hide spoilers and markers', () => {
  assert.equal(s.plainFormatted('**Raid** at 9, boss is ||the king||'), 'Raid at 9, boss is Spoiler')
  assert.equal(s.shortBody('```lua\n\nset x 1\n```'), 'set x 1')
  assert.equal(s.shortBody('plain text'), 'plain text')
})

test('formatting: composer buttons wrap and unwrap', () => {
  assert.deepStrictEqual(s.applyFormat('raid at 9', 0, 4, 'b'), { text: '**raid** at 9', start: 2, end: 6 })
  assert.deepStrictEqual(s.applyFormat('**raid** at 9', 2, 6, 'b'), { text: 'raid at 9', start: 0, end: 4 })
  assert.equal(s.applyFormat('a\nb', 0, 3, 'quote').text, '> a\n> b')
  assert.equal(s.applyFormat('> a\n> b', 0, 7, 'quote').text, 'a\nb')
  assert.equal(s.applyFormat('x', 0, 1, 'codeblock').text, '```\nx\n```')
})

test('code colors: pieces join back to the code', () => {
  const code = 'local x = "hi" -- note\nif x then print(x) end\n--[[ block ]]\nreturn 0x1F'
  const toks = s.highlightCode(code, 'lua')
  assert.equal(toks.map((t) => t.text).join(''), code)
  assert.ok(toks.some((t) => t.k === 'kw' && t.text === 'local'))
  assert.ok(toks.some((t) => t.k === 'str' && t.text === '"hi"'))
  assert.ok(toks.some((t) => t.k === 'com'))
  assert.ok(toks.some((t) => t.k === 'fn' && t.text === 'print'))
  const cfg = 'set glofly_api_key "gfk_x"\nensure glofly-whitelist\n# comment'
  const ct = s.highlightCode(cfg, 'ini')
  assert.equal(ct.map((t) => t.text).join(''), cfg)
  assert.ok(ct.some((t) => t.k === 'str' && t.text.includes('gfk_x')))
  const json = '{"a": 1, "b": [true, null]}'
  assert.equal(s.codeLanguage(null, json), 'json')
  assert.ok(s.highlightCode(json, 'json').some((t) => t.k === 'key' && t.text === '"a"'))
  for (const lang of ['js', 'yaml', 'java', 'sh', 'py', 'sql', 'css', 'html']) {
    const c = 'a: "x" // y\n<b c="d">1</b> # z'
    assert.equal(s.highlightCode(c, lang).map((t) => t.text).join(''), c, lang)
  }
})

test('0.9.3 live alerts: channel links and alert text', () => {
  assert.deepEqual(s.parseChannel('twitch', 'https://www.twitch.tv/MayaPlays'), { login: 'mayaplays' })
  assert.deepEqual(s.parseChannel('twitch', 'twitch.tv/kroof_/videos'), { login: 'kroof_' })
  assert.deepEqual(s.parseChannel('twitch', 'kroof_'), { login: 'kroof_' })
  assert.equal(s.parseChannel('twitch', 'twitch.tv'), null)
  assert.equal(s.parseChannel('twitch', 'evil.com/x'), null)
  assert.equal(s.parseChannel('twitch', 'a b'), null)
  assert.deepEqual(s.parseChannel('kick', 'https://kick.com/maya-plays'), { login: 'maya-plays' })
  assert.equal(s.parseChannel('kick', 'kick.com'), null)
  assert.deepEqual(s.parseChannel('youtube', 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv'), { youtubeId: 'UCabcdefghijklmnopqrstuv' })
  assert.deepEqual(s.parseChannel('youtube', 'youtube.com/@NightRaidersTV/videos'), { handle: 'NightRaidersTV' })
  assert.deepEqual(s.parseChannel('youtube', '@NightRaidersTV'), { handle: 'NightRaidersTV' })
  assert.equal(s.parseChannel('youtube', 'youtube.com/watch?v=abc'), null)
  const card = { channelName: 'kroof_', title: 'Heist night', game: 'GTA V', url: 'https://www.twitch.tv/kroof_' }
  assert.equal(s.liveAlertText('{streamer} is live: {title} ({game})', card, '@Stream fans'), '@Stream fans kroof_ is live: Heist night (GTA V)\nhttps://www.twitch.tv/kroof_')
  assert.equal(s.liveAlertText('', { ...card, title: '' }, null), 'kroof_ is live: untitled\nhttps://www.twitch.tv/kroof_')
})

test('0.9.3 Watch Together: Kick channels', () => {
  const w = s
  assert.deepEqual(w.watchLinkFrom('https://kick.com/Maya-Plays'), { site: 'kick', videoId: 'c:maya-plays', live: true, start: 0 })
  assert.deepEqual(w.watchLinkFrom('player.kick.com/xqc'), { site: 'kick', videoId: 'c:xqc', live: true, start: 0 })
  assert.equal(w.watchLinkFrom('kick.com/categories'), null)
  assert.equal(w.watchLinkFrom('kick.com/maya/videos/abc'), null)
  assert.equal(w.isWatchVideoId('kick', 'c:maya'), true)
  assert.equal(w.isWatchVideoId('kick', 'maya'), false)
  assert.equal(w.isLiveSite('kick'), true)
})

// ───────────── Campfire (phase 1) ─────────────

/** A small seeded random source (mulberry32), so dice tests are repeatable. */
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const fixed = (...values) => {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}
/** rng value that rolls `face` on a die with `sides` sides. */
const face = (f, sides) => (f - 1 + 0.5) / sides

test('Campfire dice: grammar', () => {
  const ok = (text, expression) => {
    const p = s.parseDice(text)
    assert.equal(p.ok, true, `${text}: ${p.error}`)
    assert.equal(p.expr.expression, expression)
    return p.expr
  }
  ok('1d20+7', '1d20+7')
  ok(' 1 D 20 + 7 ', '1d20+7')
  ok('d20', '1d20')
  ok('d%', '1d100')
  ok('4dF', '4dF')
  ok('adv+3', '2d20kh1+3')
  ok('DIS', '2d20kl1')
  ok('4d6dl1', '4d6dl1')
  ok('4d6d1', '4d6dl1')
  ok('4d6k3', '4d6kh3')
  ok('2d20kh', '2d20kh1')
  ok('3d6!', '3d6!')
  ok('3d6!>=5', '3d6!>=5')
  ok('2d10r1', '2d10r1')
  ok('2d10r<3', '2d10r<3')
  ok('1d20ro1', '1d20ro1')
  ok('6d6>=5', '6d6>=5')
  ok('1d8min3max7', '1d8min3max7')
  ok('1d8max7min3', '1d8min3max7')
  ok('(1d4+2)*3-1', '(1d4+2)*3-1')
  ok('-1d4', '-1d4')
  ok('[[1d20+5]]', '1d20+5')
  const labelled = ok('1d20+5 [Stealth] #sneaky', '1d20+5')
  assert.equal(labelled.label, 'sneaky')
  assert.equal(ok('1d20+5 [Stealth]', '1d20+5').label, 'Stealth')
  assert.equal(ok('1d20 [to hit] + 1d6 [fire]', '1d20+1d6').label, null)
  assert.equal(ok('1d20 #  Perception check ', '1d20').label, 'Perception check')
  // Precedence: 2 + 3 * 4 = 14, (2 + 3) * 4 = 20, 7 / 2 rounds down.
  assert.equal(s.roll('2+3*4', Math.random).result.total, 14)
  assert.equal(s.roll('(2+3)*4', Math.random).result.total, 20)
  assert.equal(s.roll('7/2', Math.random).result.total, 3)
  assert.equal(s.roll('-7/2', Math.random).result.total, -4)
  assert.equal(s.roll('10-2-3', Math.random).result.total, 5)
})

test('Campfire dice: bad input and limits', () => {
  const bad = (text, error) => {
    const p = s.parseDice(text)
    assert.equal(p.ok, false, text)
    if (error) assert.equal(p.error, error)
  }
  bad('', 'Type a roll, like 1d20+5.')
  bad('   ', 'Type a roll, like 1d20+5.')
  bad('#only a label', 'Type a roll, like 1d20+5.')
  bad('1d20+'.padEnd(201, '1'), 'Rolls can be up to 200 characters.')
  bad('101d6', 'You can roll 1 to 100 dice at once.')
  bad('0d6', 'You can roll 1 to 100 dice at once.')
  bad('60d6+50d6', "That's more than 100 dice. Try fewer.")
  bad('1d1', 'Dice can have 2 to 1000 sides.')
  bad('1d1001', 'Dice can have 2 to 1000 sides.')
  bad(Array(21).fill('1').join('+'), 'Rolls can have up to 20 parts.')
  bad('2d20kh3', "You can't keep more dice than you roll.")
  bad('2d20dl3', "You can't drop more dice than you roll.")
  bad('1d6r<7', 'That reroll would never stop.')
  bad('1d6!>=1', 'Those dice would explode forever.')
  bad('1d6min4!>=4', 'Those dice would explode forever.')
  bad('1d6min9', '“min” and “max” must be numbers the dice can roll.')
  bad('1d6min5max2', '“min” must be smaller than “max”.')
  bad('1d6kh1kl1', 'Use each modifier once per dice roll.')
  bad('1d6/0', "You can't divide by zero.")
  bad('1d20+', 'That roll ends too soon. Add a number or dice after the + or −.')
  bad('2d6+1d', 'Dice need a number of sides, like d20.')
  bad('(1d6+2', 'A bracket ( is missing its ).')
  bad('1d6 [fire', 'A label [ is missing its ].')
  bad('fireball', 'I couldn\'t read “fireball” in that roll.')
  bad('1d20 1d20')
  bad('99999999')
  bad('1000000*1000000', 'That roll could get too big. Try smaller numbers.')
  bad('1d20r', '“r” needs a number after it, like r1.')
  assert.equal(s.parseDice(42).ok, false)
})

test('Campfire dice: rolling, breakdowns and flags', () => {
  const r = s.roll('1d20+7', fixed(face(14, 20))).result
  assert.equal(r.total, 21)
  assert.equal(r.breakdown, '1d20+7 → (14) + 7 = 21')
  assert.equal(s.chatRollText('Chip', r), '🎲 Chip rolled 1d20+7: 21 (14 + 7)')
  assert.equal(s.chatRollText('Chip', s.roll('1d20 [Stealth]', fixed(face(9, 20))).result), '🎲 Chip rolled 1d20 (Stealth): 9')
  // Advantage keeps the higher; crit and fumble flags on d20s.
  const adv = s.roll('adv+5', fixed(face(20, 20), face(1, 20))).result
  assert.equal(adv.total, 25)
  assert.equal(adv.natural, 20)
  assert.equal(adv.crit, true)
  const dice = s.rollDiceList(adv)
  assert.deepEqual(dice.map((d) => [d.value, d.kept, !!d.crit, !!d.fumble]), [[20, true, true, false], [1, false, false, true]])
  assert.equal(adv.breakdown, '2d20kh1+5 → (20, ~1~) + 5 = 25')
  const dis = s.roll('dis', fixed(face(20, 20), face(1, 20))).result
  assert.equal(dis.total, 1)
  assert.equal(dis.fumble, true)
  // Drop lowest.
  assert.equal(s.roll('4d6dl1', fixed(face(3, 6), face(6, 6), face(1, 6), face(4, 6))).result.total, 13)
  assert.equal(s.roll('4d6dh1', fixed(face(3, 6), face(6, 6), face(1, 6), face(4, 6))).result.total, 8)
  // Explode on max, chained.
  const ex = s.roll('1d6!', fixed(face(6, 6), face(6, 6), face(2, 6))).result
  assert.equal(ex.total, 14)
  assert.deepEqual(s.rollDiceList(ex).map((d) => [d.value, !!d.exploded, !!d.extra]), [[6, true, false], [6, true, true], [2, false, true]])
  assert.equal(ex.breakdown, '1d6! → (6!, 6!, 2) = 14')
  // Explosions stop at the cap.
  const capped = s.roll('1d6!', () => 0.9999).result
  assert.equal(capped.capped, true)
  assert.ok(s.rollDiceList(capped).length <= s.DICE_MAX_DICE)
  // Reroll forever, and once.
  const rr = s.roll('1d6r<3', fixed(face(1, 6), face(2, 6), face(5, 6))).result
  assert.equal(rr.total, 5)
  assert.deepEqual(s.rollDiceList(rr)[0].rerolled, [1, 2])
  assert.equal(s.roll('1d6ro<3', fixed(face(1, 6), face(2, 6), face(5, 6))).result.total, 2)
  const stuck = s.roll('1d6r<6', () => 0).result
  assert.equal(s.rollDiceList(stuck)[0].rerolled.length, s.DICE_MAX_REROLLS)
  // Success counting, clamping, Fudge.
  const succ = s.roll('4d6>=5', fixed(face(5, 6), face(2, 6), face(6, 6), face(4, 6))).result
  assert.equal(succ.total, 2)
  assert.equal(succ.breakdown, '4d6>=5 → (5✓, 2, 6✓, 4) = 2')
  assert.equal(s.roll('2d8min3', fixed(face(1, 8), face(8, 8))).result.total, 11)
  assert.equal(s.roll('2d8max4', fixed(face(1, 8), face(8, 8))).result.total, 5)
  assert.equal(s.roll('4dF', fixed(0.1, 0.5, 0.9, 0.9)).result.total, 1)
  // Bad random sources never break a roll.
  assert.equal(s.roll('1d6', () => NaN).result.total, 1)
  assert.equal(s.roll('1d6', () => 1).result.total, 6)
})

test('Campfire dice: distributions with a seeded rng', () => {
  const rng = seeded(12345)
  const n = 60000
  const counts = Array(7).fill(0)
  const d6 = s.parseDice('1d6').expr
  for (let i = 0; i < n; i++) counts[s.rollDice(d6, rng).total]++
  for (let f = 1; f <= 6; f++) assert.ok(Math.abs(counts[f] - n / 6) < 600, `face ${f}: ${counts[f]}`)
  const mean = (text, runs = 40000) => {
    const e = s.parseDice(text).expr
    let sum = 0
    for (let i = 0; i < runs; i++) sum += s.rollDice(e, rng).total
    return sum / runs
  }
  assert.ok(Math.abs(mean('adv') - 13.825) < 0.15)
  assert.ok(Math.abs(mean('dis') - 7.175) < 0.15)
  assert.ok(Math.abs(mean('4dF')) < 0.05)
  assert.ok(Math.abs(mean('4d6dl1') - 12.24) < 0.1)
  assert.ok(Math.abs(mean('1d6!') - 4.2) < 0.1)
  assert.ok(Math.abs(mean('d%') - 50.5) < 0.6)
})

test('Campfire dice: chat commands and crits', () => {
  assert.equal(s.rollCommand('/roll 1d20+3'), '1d20+3')
  assert.equal(s.rollCommand('/R  adv #init'), 'adv #init')
  assert.equal(s.rollCommand('/rolling'), null)
  assert.equal(s.rollCommand('hello /roll 1d6'), null)
  assert.deepEqual(s.inlineRolls('I attack [[1d20+5]] for [[2d6+3]]!').map((r) => r.expression), ['1d20+5', '2d6+3'])
  assert.equal(s.critDice('1d8+4'), '2d8+4')
  assert.equal(s.critDice('2d6+1d4+3'), '4d6+2d4+3')
  assert.equal(s.critDice('d8'), '2d8')
  assert.equal(s.critDice('4d6dl1'), '8d6dl1')
})

/** Thorin: a 5th-level fighter (Str 18, Dex 14, Con 16), longsword and longbow. */
function fighter() {
  const sheet = s.blankSheet()
  sheet.classes = [{ name: 'Fighter', level: 5, hitDie: 10, caster: 'none' }]
  sheet.abilities = { str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 8 }
  sheet.saves = { str: true, con: true }
  sheet.skills = { athletics: 1, perception: 1 }
  sheet.ac = 18
  sheet.hp = { current: 44, max: 44, temp: 0 }
  sheet.hitDice = [{ die: 10, max: 5, used: 4 }]
  sheet.attacks = [
    { id: 'a1', name: 'Longsword', kind: 'melee', ability: 'str', proficient: true, bonus: 0, fixedToHit: null, damage: '1d8', damageAbility: true, damageType: 'slashing', range: '', notes: '' },
    { id: 'a2', name: 'Longbow +1', kind: 'ranged', ability: 'dex', proficient: true, bonus: 1, fixedToHit: null, damage: '1d8+1', damageAbility: true, damageType: 'piercing', range: '150/600', notes: '' }
  ]
  sheet.resources = [
    { id: 'r1', name: 'Second Wind', max: 1, used: 1, reset: 'short' },
    { id: 'r2', name: 'Indomitable', max: 1, used: 1, reset: 'long' }
  ]
  return sheet
}

test('Campfire 5e rules: a fighter and a wizard', () => {
  assert.deepEqual([1, 8, 9, 10, 11, 20, 30].map(s.abilityMod), [-5, -1, -1, 0, 0, 5, 10])
  assert.deepEqual([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(s.profBonus), [2, 2, 3, 3, 4, 4, 5, 5, 6, 6])
  const f = fighter()
  assert.equal(s.sheetProf(f), 3)
  assert.equal(s.saveBonus(f, 'str'), 7)
  assert.equal(s.saveBonus(f, 'dex'), 2)
  assert.equal(s.skillBonus(f, 'athletics'), 7)
  assert.equal(s.skillBonus(f, 'stealth'), 2)
  assert.equal(s.passivePerception(f), 14)
  assert.equal(s.initiativeBonus(f), 2)
  assert.deepEqual(s.attackExpressions(f, f.attacks[0]), { toHit: '1d20+7', damage: '1d8+4', critDamage: '2d8+4' })
  assert.deepEqual(s.attackExpressions(f, f.attacks[1]), { toHit: '1d20+6', damage: '1d8+1+2', critDamage: '2d8+1+2' })
  // A rogue with Stealth expertise.
  const rogue = s.blankSheet()
  rogue.classes = [{ name: 'Rogue', level: 3, hitDie: 8, caster: 'none' }]
  rogue.abilities.dex = 16
  rogue.skills = { stealth: 2 }
  assert.equal(s.skillBonus(rogue, 'stealth'), 7)
  // A 5th-level wizard (Int 18): DC 15, +7 to hit, slots 4/3/2.
  const wiz = s.blankSheet()
  wiz.classes = [{ name: 'Wizard', level: 5, hitDie: 6, caster: 'full' }]
  wiz.abilities.int = 18
  wiz.spellcasting.ability = 'int'
  assert.equal(s.spellSaveDc(wiz), 15)
  assert.equal(s.spellAttackBonus(wiz), 7)
  const bolt = { id: 'a', name: 'Fire Bolt', kind: 'spell', ability: 'spell', proficient: true, bonus: 0, fixedToHit: null, damage: '2d10', damageAbility: false, damageType: 'fire', range: '120', notes: '' }
  assert.deepEqual(s.attackExpressions(wiz, bolt), { toHit: '1d20+7', damage: '2d10', critDamage: '4d10' })
  // A monster's fixed numbers win.
  const ogre = s.blankSheet()
  ogre.profOverride = 2
  ogre.saveOverrides = { con: 9 }
  ogre.skillOverrides = { perception: 5 }
  assert.equal(s.saveBonus(ogre, 'con'), 9)
  assert.equal(s.passivePerception(ogre), 15)
  const club = { ...bolt, ability: null, fixedToHit: 6, damage: '2d8+4', kind: 'melee' }
  assert.deepEqual(s.attackExpressions(ogre, club), { toHit: '1d20+6', damage: '2d8+4', critDamage: '4d8+4' })
})

test('Campfire 5e rules: damage, healing, death saves, rests', () => {
  assert.deepEqual(s.applyDamage(20, 5, 8), { hp: 17, temp: 0, taken: 8 })
  assert.deepEqual(s.applyDamage(20, 10, 8), { hp: 20, temp: 2, taken: 8 })
  assert.deepEqual(s.applyDamage(5, 0, 30), { hp: 0, temp: 0, taken: 30 })
  assert.deepEqual(s.applyDamage(20, 0, 9, { resist: true }), { hp: 16, temp: 0, taken: 4 })
  assert.deepEqual(s.applyDamage(20, 0, 9, { vulnerable: true }), { hp: 2, temp: 0, taken: 18 })
  assert.deepEqual(s.applyDamage(20, 0, 9, { immune: true }), { hp: 20, temp: 0, taken: 0 })
  const sheet = fighter()
  sheet.resist = ['fire']
  assert.deepEqual(s.damageModsFor(sheet, 'fire'), { resist: true, vulnerable: false, immune: false })
  assert.equal(s.heal(0, 44, 10), 10)
  assert.equal(s.heal(40, 44, 10), 44)
  assert.equal(s.hpState(22, 44), 'bloodied')
  assert.equal(s.hpState(23, 44), 'healthy')
  assert.equal(s.hpState(0, 44), 'defeated')
  assert.equal(s.concentrationDc(25), 12)
  assert.equal(s.concentrationDc(5), 10)
  const none = s.NO_DEATH_SAVES
  assert.equal(s.deathSave(12, none).outcome, 'success')
  assert.equal(s.deathSave(9, none).state.failures, 1)
  assert.equal(s.deathSave(1, none).state.failures, 2)
  assert.equal(s.deathSave(20, { ...none, failures: 2 }).outcome, 'revived')
  assert.equal(s.deathSave(15, { ...none, successes: 2 }).outcome, 'stable')
  assert.equal(s.deathSave(3, { ...none, failures: 2 }).outcome, 'dead')
  assert.equal(s.deathSaveFailures(none, 2).state.failures, 2)
  assert.equal(s.deathSaveFailures({ ...none, failures: 2 }, 1).state.dead, true)
  // Rests.
  sheet.hp = { current: 3, max: 44, temp: 4 }
  sheet.exhaustion = 2
  sheet.concentration = 'Bless'
  const short = s.shortRest(sheet)
  assert.deepEqual(short.resources.map((r) => r.used), [0, 1])
  assert.equal(short.hp.current, 3)
  const long = s.longRest(sheet)
  assert.deepEqual(long.hp, { current: 44, max: 44, temp: 0 })
  assert.deepEqual(long.resources.map((r) => r.used), [0, 0])
  assert.deepEqual(long.hitDice, [{ die: 10, max: 5, used: 2 }]) // half of 5 = 2 back
  assert.equal(long.exhaustion, 1)
  assert.equal(long.concentration, null)
})

test('Campfire 5e rules: spell slots, CR, sizes, conditions', () => {
  const cls = (name, level, caster) => ({ name, level, hitDie: 8, caster })
  assert.deepEqual(s.slotsForClasses([cls('Wizard', 5, 'full')]).slots.slice(0, 4), [4, 3, 2, 0])
  assert.deepEqual(s.slotsForClasses([cls('Wizard', 20, 'full')]).slots, [4, 3, 3, 3, 3, 2, 2, 1, 1])
  assert.deepEqual(s.slotsForClasses([cls('Paladin', 1, 'half')]).slots[0], 0)
  assert.deepEqual(s.slotsForClasses([cls('Paladin', 5, 'half')]).slots.slice(0, 3), [4, 2, 0])
  assert.deepEqual(s.slotsForClasses([cls('Fighter', 3, 'third')]).slots.slice(0, 2), [2, 0])
  // Multiclass: paladin 2 (1) + sorcerer 3 (3) = caster level 4: 4/3.
  assert.deepEqual(s.slotsForClasses([cls('Paladin', 2, 'half'), cls('Sorcerer', 3, 'full')]).slots.slice(0, 3), [4, 3, 0])
  assert.deepEqual(s.slotsForClasses([cls('Warlock', 5, 'pact')]).pact, { slots: 2, level: 3 })
  assert.equal(s.slotsForClasses([cls('Rogue', 5, 'none')]).pact, null)
  assert.equal(s.xpForCr(0.25), 50)
  assert.equal(s.xpForCr(10), 5900)
  assert.equal(s.crLabel(0.125), '1/8')
  assert.deepEqual(['tiny', 'medium', 'large', 'huge', 'gargantuan'].map(s.sizeCells), [1, 1, 2, 3, 4])
  assert.equal(s.CONDITIONS.length, 15)
  assert.equal(s.EXHAUSTION_LEVELS.length, 6)
  assert.equal(s.isCondition('prone'), true)
  assert.equal(s.isCondition('sleepy'), false)
})

test('Campfire sheets: cleaning up what apps send', () => {
  const clean = s.normalizeSheet({
    abilities: { str: 99, dex: -4, con: 'x' },
    hp: { current: 500, max: 40, temp: -3 },
    ac: 12.6,
    skills: { stealth: 2, perception: 7, hacking: 1 },
    saves: { dex: true, luck: true },
    attacks: [{ name: 'Bite', damage: '1d6+2' }, { name: 'Evil', damage: 'rm -rf' }, { name: '' }],
    conditions: ['prone', 'prone', 'sleepy'],
    notes: 'x'.repeat(30000),
    extra: 'dropped',
    monster: { cr: 0.5, traits: [{ name: 'Keen Smell', text: 'Sniff' }] }
  })
  assert.deepEqual(clean.abilities, { str: 30, dex: 1, con: 10, int: 10, wis: 10, cha: 10 })
  assert.deepEqual(clean.hp, { current: 40, max: 40, temp: 0 })
  assert.equal(clean.ac, 13)
  assert.deepEqual(clean.skills, { stealth: 2 })
  assert.deepEqual(clean.saves, { dex: true })
  assert.deepEqual(clean.attacks.map((a) => [a.name, a.damage]), [['Bite', '1d6+2'], ['Evil', '1d4']])
  assert.deepEqual(clean.conditions, ['prone'])
  assert.equal(clean.notes.length, 20000)
  assert.equal(clean.extra, undefined)
  assert.equal(clean.monster.cr, 0.5)
  assert.equal(clean.monster.traits[0].name, 'Keen Smell')
  assert.deepEqual(s.normalizeSheet(null), s.blankSheet())
  assert.deepEqual(s.normalizeSheet(s.normalizeSheet(clean)), clean)
  assert.equal(s.classLine(fighter()), 'Fighter 5')
})

test('Campfire fog of war and maps', () => {
  const fog = { enabled: true, revealed: [{ id: 'a', kind: 'rect', points: [[0, 0], [200, 200]] }, { id: 'b', kind: 'rect', points: [[100, 100], [150, 150]], mode: 'hide' }] }
  assert.equal(s.isFogged(fog, [50, 50]), false)
  assert.equal(s.isFogged(fog, [120, 120]), true) // hidden again
  assert.equal(s.isFogged(fog, [300, 300]), true)
  assert.equal(s.isFogged({ ...fog, enabled: false }, [300, 300]), false)
  const tri = { id: 't', kind: 'poly', points: [[400, 0], [500, 0], [450, 100]] }
  assert.equal(s.isFogged({ enabled: true, revealed: [tri] }, [450, 30]), false)
  assert.equal(s.isFogged({ enabled: true, revealed: [tri] }, [405, 90]), true)
  assert.deepEqual(s.tokenCenter({ x: 70, y: 0, w: 2, h: 2 }, { size: 70 }), [140, 70])
  const built = {
    floors: [{ id: 'in', points: [[10, 10], [90, 10], [90, 90]], material: 'wood' }, { id: 'out', points: [[1000, 1000], [1100, 1000], [1100, 1100]], material: 'stone' }],
    walls: [{ id: 'cross', points: [[-500, 50], [900, 50]] }, { id: 'far', points: [[1000, 2000], [1200, 2000]] }],
    objects: [{ id: 'box', kind: 'crate', x: 20, y: 20, w: 10, h: 10, rotation: 0 }, { id: 'hid', kind: 'crate', x: 110, y: 110, w: 20, h: 20, rotation: 0 }],
    notes: [{ id: 'n', x: 1, y: 1, text: 'Trap here' }]
  }
  const seen = s.builtForPlayer(built, fog)
  assert.deepEqual(seen.floors.map((f) => f.id), ['in'])
  assert.deepEqual(seen.walls.map((w) => w.id), ['cross'])
  assert.deepEqual(seen.objects.map((o) => o.id), ['box'])
  assert.deepEqual(seen.notes, [])
  // A big floor with a small reveal in its middle still shows (the reveal's corners are inside it).
  const big = { floors: [{ id: 'hall', points: [[0, 0], [5000, 0], [5000, 5000], [0, 5000]], material: 'stone' }], walls: [], objects: [], notes: [] }
  assert.equal(s.builtForPlayer(big, { enabled: true, revealed: [{ id: 'r', kind: 'rect', points: [[2400, 2400], [2410, 2410]] }] }).floors.length, 1)
  // Cleaning up.
  const f2 = s.normalizeFog({ enabled: true, revealed: [{ kind: 'rect', points: [[0, 0], [1, 1]] }, { kind: 'poly', points: [[0, 0]] }, { kind: 'circle' }] })
  assert.equal(f2.revealed.length, 1)
  assert.equal(s.normalizeGrid({ size: 5000, type: 'hex', color: 'red' }).size, 500)
  assert.equal(s.normalizeGrid({ color: 'red' }).color, '#000000')
  const b2 = s.normalizeBuilt({ walls: [{ points: [[0, 0], [1, 'x']] }, { points: [[0, 0], [5, 5]], door: { state: 'locked' } }], notes: [{ x: 0, y: 0, text: '  ' }] })
  assert.deepEqual(b2.walls, [{ id: 'w1', points: [[0, 0], [5, 5]], door: { state: 'locked' } }])
  assert.deepEqual(b2.notes, [])
  assert.equal(s.SRD_CREDIT, 'Includes material from the System Reference Document 5.1 by Wizards of the Coast LLC, licensed under CC BY 4.0.')
})

test('campfire: fair to-hit rolls, capped fog corners and fog work (security review)', () => {
  const unfair = (t) => s.unfairToHit(s.parseDice(t).expr)
  for (const ok of ['1d20+5', '2d20kh1+3', '2d20kl1', '3d20kh1', '1d20ro1+2', 'd20+1d4+3', '1d8+4']) assert.equal(unfair(ok), null, ok)
  for (const bad of ['1d20min20', '1d20min14max14', '1d20r<20', '1d20!', '4d20kh1', '1d20>=10', '(1d20max2)+5', '1d20ro<20']) assert.ok(unfair(bad), bad)
  // Fog: the newest shapes are kept while their corners fit, and dropping old ones only adds fog.
  const poly = (x) => ({ kind: 'poly', points: Array.from({ length: 100 }, (_, k) => [x + Math.cos(k), Math.sin(k)]) })
  const fog = s.normalizeFog({ enabled: true, revealed: Array.from({ length: 80 }, (_, i) => poly(i * 10)) })
  assert.ok(s.fogPointCount(fog) <= s.CAMPFIRE_LIMITS.fogPoints)
  assert.equal(fog.revealed.at(-1).points[0][0], 790 + 1)
  // Running out of work: the rest of the map counts as fogged (players get less, never more).
  const walls = Array.from({ length: 50 }, (_, i) => ({ id: `w${i}`, points: [[0, 5000 + i], [9000, 5000 + i]] }))
  const far = { enabled: true, revealed: [{ id: 'r', kind: 'rect', points: [[-10, -10], [-5, -5]] }] }
  assert.equal(s.builtForPlayer({ floors: [], walls, objects: [], notes: [] }, far, 35, 1000).walls.length, 0)
  const open = { enabled: true, revealed: [{ id: 'r', kind: 'rect', points: [[0, 0], [9000, 9000]] }] }
  assert.equal(s.builtForPlayer({ floors: [], walls, objects: [], notes: [] }, open).walls.length, 50)
})

test('campfire: optional sheet fields (XP, inspiration, AC note, senses, subclass, spell details)', () => {
  // Older sheets stay exactly as they were: none of the new fields appear unless set.
  assert.equal('xp' in s.normalizeSheet({}), false)
  assert.equal('inspiration' in s.normalizeSheet({ inspiration: false }), false)
  const sheet = s.normalizeSheet({
    xp: 6500.4,
    inspiration: true,
    acNote: '  Leather ',
    senses: 'Darkvision 60 ft',
    classes: [{ name: 'Ranger', level: 5, hitDie: 10, caster: 'half', subclass: 'Hunter' }, { name: 'Rogue', level: 1, subclass: '' }],
    spellcasting: {
      spells: [
        { name: "Hunter's Mark", level: 1, castingTime: '1 bonus action', range: '90 feet', duration: 'Up to 1 hour', concentration: true, roll: '1d6', notes: '+1d6 to hits' },
        { name: 'Bad', level: 1, roll: 'rm -rf', concentration: 'yes', range: 'x'.repeat(100) }
      ]
    }
  })
  assert.equal(sheet.xp, 6500)
  assert.equal(sheet.inspiration, true)
  assert.equal(sheet.acNote, 'Leather')
  assert.equal(sheet.senses, 'Darkvision 60 ft')
  assert.equal(sheet.classes[0].subclass, 'Hunter')
  assert.equal('subclass' in sheet.classes[1], false)
  assert.deepEqual(sheet.spellcasting.spells[0], {
    slug: null, name: "Hunter's Mark", level: 1, prepared: false, castingTime: '1 bonus action', range: '90 feet', duration: 'Up to 1 hour', concentration: true, roll: '1d6', notes: '+1d6 to hits'
  })
  assert.deepEqual(Object.keys(sheet.spellcasting.spells[1]).sort(), ['level', 'name', 'prepared', 'range', 'slug'])
  assert.equal(sheet.spellcasting.spells[1].range.length, 60)
  assert.equal(s.normalizeSheet({ xp: 5e9 }).xp, 1_000_000)
  assert.deepEqual(s.normalizeSheet(s.normalizeSheet(sheet)), sheet)
  // XP thresholds and the hit point formula (an ogre: 7d10, Constitution 16 → 7d10+21).
  assert.equal(s.nextLevelXp(5), 14000)
  assert.equal(s.nextLevelXp(20), null)
  const ogre = s.normalizeSheet({ abilities: { con: 16 }, hitDice: [{ die: 10, max: 7 }] })
  assert.equal(s.hitPointFormula(ogre), '7d10+21')
  assert.equal(s.hitPointFormula(s.blankSheet()), null)
})

test('campfire: massive damage kills outright (5e)', () => {
  assert.equal(s.instantDeath(38, 0, 99, 44), true)
  assert.equal(s.instantDeath(38, 0, 81, 44), false)
  assert.equal(s.instantDeath(38, 5, 87, 44), true)
  assert.equal(s.instantDeath(0, 0, 44, 44), true)
  assert.equal(s.instantDeath(0, 0, 43, 44), false)
})

test('campfire: grid distances (squares, 5-10-5 diagonals, hexes) and fog lassos', () => {
  const sq = { ...s.DEFAULT_GRID }
  assert.equal(s.gridFeet([35, 35], [35 + 70 * 4, 35 + 70 * 3], sq), 20)
  assert.equal(s.gridFeet([35, 35], [35 + 70 * 4, 35 + 70 * 3], sq, '5-10'), 25)
  assert.equal(s.gridFeet([35, 35], [35 + 70 * 2, 35 + 70 * 2], sq, '5-10'), 15)
  const hex = { ...s.DEFAULT_GRID, type: 'hex' }
  const c = (col, row) => s.hexCenter(col, row, hex)
  assert.deepEqual(s.hexAt(...c(3, 4), hex), [3, 4])
  // Straight along a row, and diagonally down through shifted rows.
  assert.equal(s.gridFeet(c(0, 0), c(4, 0), hex), 20)
  assert.equal(s.gridFeet(c(0, 0), c(1, 2), hex), 10)
  assert.equal(s.gridFeet(c(2, 1), c(2, 5), hex), 20)
  assert.equal(s.hexSteps([0, 0], [0, 1]), 1)
  assert.equal(s.hexSteps([0, 1], [1, 0]), 1)
  // Lasso: dense points thinned, tiny or flat ones refused.
  const ring = Array.from({ length: 1000 }, (_, i) => [500 + 300 * Math.cos(i / 159.15), 500 + 300 * Math.sin(i / 159.15)])
  const l = s.simplifyLasso(ring)
  assert.ok(l && l.length <= 120 && l.length >= 3)
  assert.equal(s.simplifyLasso([[0, 0], [100, 0], [200, 0], [300, 0]]), null)
  assert.ok(s.cleanFogShape({ kind: 'poly', points: l }, 'x'))
})
