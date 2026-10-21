// Checks Control for iPhone's request signing and transport against the LIVE local server, using
// the same modules the app ships (src/lib/signing.ts, src/lib/transport.ts) and desktop Control's
// typed client (apps/control/src/renderer/src/lib/api.ts) through `window.control`.
//
//   cd apps/control-mobile && npx tsx test/transport.e2e.ts
//
// Needs the local server on 127.0.0.1:4000 with the UI-check admin (chipm). Talks to it as "home"
// (127.0.0.1, for the desktop sign-in and the pairing) and as "away" (192.0.2.2, a non-loopback
// address of this machine, so the server sees the phone outside the home network). The test phone
// is removed at the end so it doesn't take one of the 3 phone places.
import assert from 'node:assert/strict'
import { randomBytes as nodeRandom } from 'node:crypto'
import { codeFor, stepAt } from '../../server/src/admin/totp'
import { makePhoneKey, publicKeyFor, signRequest, signedText, sha256Hex } from '../src/lib/signing'
import { createTransport, installWindowControl, type EndReason } from '../src/lib/transport'
import { api, ALERT_KINDS } from '@control/api'

const HOME = process.env.HOME_URL ?? 'http://127.0.0.1:4000'
const AWAY = process.env.AWAY_URL ?? 'http://192.0.2.2:4000'
const USERNAME = 'chipm'
const PASSWORD = 'control-admin-pass-2026'
const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const randomBytes = (n: number) => new Uint8Array(nodeRandom(n))

let passed = 0
const ok = (label: string) => {
  passed++
  console.log(`  ✓ ${label}`)
}

// Each authenticator code works once (and other checks may have just used the current one): wait
// for a fresh 30-second step before every sign-in.
let lastStep = stepAt(Date.now())
async function freshCode(): Promise<string> {
  let step = stepAt(Date.now())
  while (step <= lastStep) {
    await new Promise((r) => setTimeout(r, 1000))
    step = stepAt(Date.now())
  }
  lastStep = step
  return codeFor(TOTP_SECRET, step)
}

async function raw(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}, bodyText?: string) {
  const text = bodyText ?? (body === undefined ? undefined : JSON.stringify(body))
  const res = await fetch(base + path, {
    method,
    headers: { ...(text !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: text,
  })
  const t = await res.text()
  let json: any = null
  try {
    json = JSON.parse(t)
  } catch {
    json = t
  }
  return { status: res.status, json }
}

async function main() {
  console.log('Control for iPhone: transport + signing against', HOME, '/', AWAY)

  // ── signing matches the spec (pure checks) ──
  const text = signedText('post', '/admin/x?y=1', '1700000000000', 'nonce-nonce-nonce', '')
  assert.equal(text.split('\n')[0], 'GLOFLY-CONTROL-1')
  assert.equal(text.split('\n')[1], 'POST')
  assert.equal(text.split('\n')[5], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  const key = makePhoneKey(randomBytes)
  assert.match(key.publicKey, /^[A-Za-z0-9_-]{87}$/)
  assert.equal(publicKeyFor(key.secretKeyHex), key.publicKey)
  ok('signed text, key and public key format match the spec')

  // ── desktop Control at home makes a pair code ──
  let r = await raw(HOME, 'POST', '/admin/auth/password', { username: USERNAME, password: PASSWORD, deviceName: 'Linux · phone test' })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  r = await raw(HOME, 'POST', '/admin/auth/code', { challenge: r.json.challenge, code: await freshCode() })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  const desk = { Authorization: `Bearer ${r.json.token}` }
  ok('desktop signed in from home')
  r = await raw(HOME, 'POST', '/admin/devices/pair-code', { note: 'Testing Control for iPhone transport' }, desk)
  assert.equal(r.status, 200, `pair-code: ${JSON.stringify(r.json)}`)
  const code: string = r.json.code
  assert.match(code, /^[A-Z0-9]{3}-[A-Z0-9]{3}$/)
  ok(`pair code made (${code})`)

  let deviceId = ''
  try {
    // ── pairing: away is refused, home works ──
    const away = createTransport({ serverUrl: AWAY, randomBytes, deviceName: () => 'Test iPhone' })
    let pr = await away.pair(code, key.publicKey, 'Test iPhone')
    assert.ok(!pr.ok && pr.status === 403 && /home network/i.test(pr.message), JSON.stringify(pr))
    ok(`pairing from away refused: "${!pr.ok && pr.message}"`)
    const home = createTransport({ serverUrl: HOME, randomBytes })
    pr = await home.pair(code.toLowerCase().replace('-', ''), key.publicKey, 'Test iPhone')
    assert.ok(pr.ok, JSON.stringify(pr))
    deviceId = pr.deviceId
    ok(`phone paired from home (device ${deviceId.slice(0, 8)}…)`)
    pr = await home.pair(code, key.publicKey, 'Again')
    assert.ok(!pr.ok && pr.error === 'wrong_code', JSON.stringify(pr))
    ok('the code works only once')

    // ── sign in through the transport from away ──
    const ends: EndReason[] = []
    away.onEnd((reason) => ends.push(reason))
    away.setDevice(deviceId)
    // Locked (no key yet): nothing is sent.
    let s = await away.signInPassword(USERNAME, PASSWORD)
    assert.ok(!s.ok && s.error === 'locked')
    away.unlock(key.secretKeyHex)
    s = await away.signInPassword(USERNAME, 'wrong-password')
    assert.ok(!s.ok && s.status === 401, JSON.stringify(s))
    ok(`wrong password refused: "${!s.ok && s.message}"`)
    s = await away.signInPassword(USERNAME, PASSWORD)
    assert.ok(s.ok, JSON.stringify(s))
    const signed = await away.signInCode('code', await freshCode())
    assert.ok(signed.ok, JSON.stringify(signed))
    const minutes = (Date.parse(signed.expiresAt) - Date.now()) / 60000
    assert.ok(minutes > 28 && minutes <= 30.1, `session minutes ${minutes}`)
    ok(`signed in from away with the phone's signature (session ${Math.round(minutes)} min)`)

    // ── desktop Control's typed client through window.control ──
    installWindowControl(away)
    const me = await window.control.call('GET', '/admin/auth/me')
    assert.ok(me.ok, JSON.stringify(me))
    assert.equal((me.data.device as { id: string }).id, deviceId)
    ok('GET /admin/auth/me knows this phone')
    const dash = await api.dashboard()
    assert.ok(dash.ok, JSON.stringify(dash))
    assert.equal(typeof dash.data.stats.onlineNow, 'number')
    assert.ok(dash.data.now, 'dashboard.now present')
    ok(`api.dashboard() (online ${dash.data.stats.onlineNow}, open reports ${dash.data.openReports ?? 0})`)
    const notes = await api.quickNotes()
    assert.ok(notes.ok && Array.isArray(notes.data.notes), JSON.stringify(notes))
    ok(`api.quickNotes() (${notes.ok && notes.data.notes.length} notes)`)
    const alerts = await api.alerts()
    assert.ok(alerts.ok, JSON.stringify(alerts))
    const before = alerts.data.prefs.kinds.account_new
    let pp = await api.setAlertPrefs({ kinds: { account_new: !before } })
    assert.ok(pp.ok && pp.data.prefs.kinds.account_new === !before, JSON.stringify(pp))
    pp = await api.setAlertPrefs({ kinds: { account_new: before } })
    assert.ok(pp.ok && pp.data.prefs.kinds.account_new === before)
    assert.equal(Object.keys(pp.ok ? pp.data.prefs.kinds : {}).length, ALERT_KINDS.length)
    ok('PUT /admin/alerts/prefs changed and put back')
    const push = await window.control.call('PUT', '/admin/devices/me/push', { token: `sandbox:${'ab'.repeat(32)}` })
    assert.ok(push.ok, JSON.stringify(push))
    const phones = await api.phones()
    assert.ok(phones.ok && phones.data.devices.some((d) => d.id === deviceId && d.thisDevice && d.alerts), JSON.stringify(phones))
    await window.control.call('PUT', '/admin/devices/me/push', { token: null })
    ok('PUT /admin/devices/me/push registered (and cleared) the alert token')
    const longQuery = await api.accounts('a b', 'all')
    assert.ok(longQuery.ok, JSON.stringify(longQuery))
    ok('a query string (?q=a+b&filter=all) signs correctly')

    // ── replayed and tampered requests are refused ──
    const token = signed.token
    const path = '/admin/quick-notes'
    const h = signRequest({ deviceId, secretKeyHex: key.secretKeyHex, method: 'GET', path, bodyText: '', time: Date.now(), randomBytes })
    r = await raw(AWAY, 'GET', path, undefined, { ...h, Authorization: `Bearer ${token}` })
    assert.equal(r.status, 200)
    r = await raw(AWAY, 'GET', path, undefined, { ...h, Authorization: `Bearer ${token}` })
    assert.ok(r.status === 401 && r.json.error === 'phone_not_approved', JSON.stringify(r))
    ok('a replayed request (same nonce) is refused')
    const body = { kinds: { account_new: before } }
    const h2 = signRequest({
      deviceId, secretKeyHex: key.secretKeyHex, method: 'PUT', path: '/admin/alerts/prefs',
      bodyText: JSON.stringify(body), time: Date.now(), randomBytes,
    })
    r = await raw(AWAY, 'PUT', '/admin/alerts/prefs', undefined, { ...h2, Authorization: `Bearer ${token}` }, JSON.stringify({ kinds: { account_new: !before } }))
    assert.ok(r.status === 401 && r.json.error === 'phone_not_approved', JSON.stringify(r))
    ok('a tampered body is refused')
    const h3 = signRequest({ deviceId, secretKeyHex: key.secretKeyHex, method: 'GET', path: '/admin/dashboard', bodyText: '', time: Date.now(), randomBytes })
    r = await raw(AWAY, 'GET', '/admin/quick-notes', undefined, { ...h3, Authorization: `Bearer ${token}` })
    assert.ok(r.status === 401 && r.json.error === 'phone_not_approved')
    ok('a signature for another path is refused')
    const h4 = signRequest({ deviceId, secretKeyHex: key.secretKeyHex, method: 'GET', path, bodyText: '', time: Date.now() - 5 * 60_000, randomBytes })
    r = await raw(AWAY, 'GET', path, undefined, { ...h4, Authorization: `Bearer ${token}` })
    assert.ok(r.status === 401 && /clock/i.test(r.json.message), JSON.stringify(r))
    ok(`an old timestamp is refused ("${r.json.message}")`)
    const other = makePhoneKey(randomBytes)
    const h5 = signRequest({ deviceId, secretKeyHex: other.secretKeyHex, method: 'GET', path, bodyText: '', time: Date.now(), randomBytes })
    r = await raw(AWAY, 'GET', path, undefined, { ...h5, Authorization: `Bearer ${token}` })
    assert.ok(r.status === 401 && r.json.error === 'phone_not_approved')
    ok("another key's signature is refused")
    r = await raw(AWAY, 'GET', path, undefined, { Authorization: `Bearer ${token}` })
    assert.ok(r.status === 403 && r.json.error === 'not_allowed_network', JSON.stringify(r))
    ok('the phone token without a signature is refused away from home')
    r = await raw(HOME, 'GET', path, undefined, { Authorization: `Bearer ${token}` })
    assert.equal(r.status, 401)
    ok("the phone's token doesn't work as a desktop session either")
    // The session still works after all that.
    const still = await api.quickNotes()
    assert.ok(still.ok)
    assert.deepEqual(ends, [])
    ok('the real session is unaffected')

    // ── removed in desktop Control → the phone learns at its next request ──
    r = await raw(HOME, 'POST', `/admin/devices/${deviceId}/remove`, { note: 'Transport test finished' }, desk)
    assert.equal(r.status, 200, JSON.stringify(r.json))
    deviceId = ''
    const after = await api.dashboard()
    assert.ok(!after.ok && after.error === 'phone_not_approved')
    assert.deepEqual(ends, ['phone_removed'])
    assert.equal(away.signedIn, false)
    assert.equal(away.unlocked, false)
    ok('after removal: 401 phone_not_approved, key and token forgotten, app told "phone_removed"')

    // ── unreachable maps like desktop ──
    const dead = createTransport({ serverUrl: 'http://127.0.0.1:9', randomBytes })
    const d = await dead.pair('AAAAAA', key.publicKey, 'x')
    assert.ok(!d.ok && d.error === 'unreachable' && d.status === 0)
    ok(`unreachable: "${!d.ok && d.message}"`)

    await raw(HOME, 'POST', '/admin/auth/logout', undefined, desk)
  } finally {
    if (deviceId) {
      const rr = await raw(HOME, 'POST', `/admin/devices/${deviceId}/remove`, { note: 'Transport test cleanup' }, desk)
      console.log('  (cleanup: removed the test phone)', rr.status)
    }
  }
  console.log(`\n${passed} checks passed.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
