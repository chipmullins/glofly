// Face ID sign-in on Control for iPhone (Oct 28, 2026) against the LIVE local server, with the same
// transport the app ships. Needs the local server on 127.0.0.1:4000 with the UI-check admin (chipm).
//
//   cd apps/control-mobile && npx tsx test/faceid.e2e.ts
import assert from 'node:assert/strict'
import { randomBytes as nodeRandom } from 'node:crypto'
import { codeFor, stepAt } from '../../server/src/admin/totp'
import { makePhoneKey } from '../src/lib/signing'
import { createTransport } from '../src/lib/transport'

const HOME = process.env.HOME_URL ?? 'http://127.0.0.1:4000'
const USERNAME = 'chipm'
const PASSWORD = 'control-admin-pass-2026'
const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const randomBytes = (n: number) => new Uint8Array(nodeRandom(n))
const ok = (label: string) => console.log(`  ✓ ${label}`)

let lastStep = stepAt(Date.now()) - 1
async function freshCode(): Promise<string> {
  let step = stepAt(Date.now())
  while (step <= lastStep) {
    await new Promise((r) => setTimeout(r, 1000))
    step = stepAt(Date.now())
  }
  lastStep = step
  return codeFor(TOTP_SECRET, step)
}

async function raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(HOME + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text()
  return { status: res.status, json: t ? JSON.parse(t) : null }
}

async function main() {
  let r = await raw('POST', '/admin/auth/password', { username: USERNAME, password: PASSWORD, deviceName: 'Face ID test' })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  r = await raw('POST', '/admin/auth/code', { challenge: r.json.challenge, code: await freshCode(), remember: true })
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.equal(r.json.remember, undefined, 'desktop never gets a Face ID secret')
  const desk = { Authorization: `Bearer ${r.json.token}` }
  ok('desktop signed in (no Face ID secret for desktop)')
  r = await raw('POST', '/admin/devices/pair-code', { note: 'Testing Face ID sign-in' }, desk)
  assert.equal(r.status, 200, JSON.stringify(r.json))

  const key = makePhoneKey(randomBytes)
  const phone = createTransport({ serverUrl: HOME, randomBytes })
  const pr = await phone.pair(r.json.code, key.publicKey, 'Face ID iPhone')
  assert.ok(pr.ok, JSON.stringify(pr))
  const deviceId = pr.deviceId
  phone.setDevice(deviceId)
  try {
    // Locked (Face ID not passed yet): nothing is sent.
    let res = await phone.resume('x'.repeat(43))
    assert.ok(!res.ok && res.error === 'locked')
    ok('without the unlocked key, Face ID sign-in sends nothing')
    phone.unlock(key.secretKeyHex)
    res = await phone.resume('x'.repeat(43))
    assert.ok(!res.ok && res.status === 401 && res.error === 'remember_expired', JSON.stringify(res))
    ok(`before a password sign-in it's refused: "${!res.ok && res.message}"`)

    // Old apps: no remember asked → no secret.
    let s = await phone.signInPassword(USERNAME, PASSWORD)
    assert.ok(s.ok)
    let signed = await phone.signInCode('code', await freshCode())
    assert.ok(signed.ok && !signed.remember, JSON.stringify(signed))
    ok('a sign-in without remember (older phone builds) gets no secret')

    s = await phone.signInPassword(USERNAME, PASSWORD)
    assert.ok(s.ok)
    signed = await phone.signInCode('code', await freshCode(), { remember: true })
    assert.ok(signed.ok && signed.remember && signed.rememberUntil, JSON.stringify(signed))
    const days = (Date.parse(signed.rememberUntil!) - Date.now()) / 86400000
    assert.ok(days > 13.9 && days <= 14.01, `days ${days}`)
    const secret = signed.remember!
    ok(`password + code with remember → secret good for ${days.toFixed(2)} days`)

    // App goes to the background / 30 minutes pass: everything in memory is forgotten.
    phone.end('ended')
    assert.ok(!phone.signedIn && !phone.unlocked)
    phone.unlock(key.secretKeyHex) // Face ID again
    res = await phone.resume(secret)
    assert.ok(res.ok, JSON.stringify(res))
    const minutes = (Date.parse(res.expiresAt) - Date.now()) / 60000
    assert.ok(minutes > 28 && minutes <= 30.1)
    assert.equal(res.rememberUntil, signed.rememberUntil, 'the 14 days count from the password sign-in')
    let me = await phone.call('GET', '/admin/auth/me')
    assert.ok(me.ok, JSON.stringify(me))
    ok('Face ID sign-in → a fresh 30-minute session that works; the 14 days don’t restart')

    // The secret alone isn't enough: another key (another phone) can't use it.
    const other = createTransport({ serverUrl: HOME, randomBytes })
    other.setDevice(deviceId)
    other.unlock(makePhoneKey(randomBytes).secretKeyHex)
    res = await other.resume(secret)
    assert.ok(!res.ok && res.status === 401, JSON.stringify(res))
    ok(`the secret with a different key is refused (${!res.ok && res.error})`)

    // A wrong secret is refused.
    res = await phone.resume(secret.slice(0, -2) + (secret.endsWith('AA') ? 'BB' : 'AA'))
    assert.ok(!res.ok && res.error === 'remember_expired')
    ok('a wrong secret is refused')

    // Desktop sees it in the phone list.
    r = await raw('GET', '/admin/devices', undefined, desk)
    const row = r.json.devices.find((d: { id: string }) => d.id === deviceId)
    assert.equal(row.faceIdUntil, signed.rememberUntil)
    ok('desktop Control lists until when Face ID works on that phone')

    // Signing out on the phone ends Face ID sign-in.
    phone.unlock(key.secretKeyHex)
    res = await phone.resume(secret)
    assert.ok(res.ok)
    await phone.signOut()
    phone.unlock(key.secretKeyHex)
    res = await phone.resume(secret)
    assert.ok(!res.ok && res.error === 'remember_expired', JSON.stringify(res))
    r = await raw('GET', '/admin/devices', undefined, desk)
    assert.equal(r.json.devices.find((d: { id: string }) => d.id === deviceId).faceIdUntil, null)
    ok('signing out on the phone ends Face ID sign-in (password and code next time)')

    // Removing the phone ends it too (and the next Face ID try says the phone was removed).
    s = await phone.signInPassword(USERNAME, PASSWORD)
    signed = await phone.signInCode('code', await freshCode(), { remember: true })
    assert.ok(signed.ok)
    r = await raw('POST', `/admin/devices/${deviceId}/remove`, { note: 'Face ID test done' }, desk)
    assert.equal(r.status, 200)
    phone.unlock(key.secretKeyHex)
    res = await phone.resume(signed.remember!)
    assert.ok(!res.ok && res.status === 401 && res.error === 'phone_not_approved', JSON.stringify(res))
    ok('a removed phone can’t use Face ID sign-in')
  } finally {
    await raw('POST', `/admin/devices/${deviceId}/remove`, { note: 'cleanup' }, desk)
  }
  console.log('Face ID sign-in: all checks passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
