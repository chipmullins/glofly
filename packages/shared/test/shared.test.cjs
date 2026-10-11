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
