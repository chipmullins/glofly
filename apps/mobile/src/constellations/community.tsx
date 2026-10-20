import { useEffect, useRef, useState } from 'react'
import { Animated as RNAnimated, Easing, Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import Svg, { Circle, Path } from 'react-native-svg'
import {
  ROLE_COLORS,
  accentOf,
  gameInitials,
  milestoneText,
  playingFor,
  type ConstellationDetail,
  type InvitePreview,
  type MemberCardInfo,
  type Message,
  type PublicUser,
} from '@glofly/shared'
import { authHeaders, url } from '@/api/http'
import { cx } from '@/api/constellations'
import { sendText } from '@/chat/send'
import { isWideNow } from '@/lib/layout'
import { useSession } from '@/state/session'
import { putDetail, refreshCards, useCx, useCxAvailable } from '@/state/constellations'
import { Text } from '@/ui/kit'
import { haptic, useReduceMotion } from './motion'
import { placePaths } from './nav'
import { NightModal } from './sheet'
import { flyIn } from './transition'
import { ConstellationIcon, Face, N } from './ui'

// 0.7.5 Constellations polish on phones, "community and identity" (the approved boards 1, 2, 3, 6
// and 12, drawn in the phone app's night style): banner photos and accent colors, the welcome when
// you join, invite cards in chats, join lines with Say hi, milestone cards, and the member card's
// "playing now" and mutual friends.

const first = (u: Pick<PublicUser, 'displayName' | 'username'>) => u.displayName.trim().split(/\s+/)[0] || u.username

// ───────────── Identity ─────────────

export const constellationBannerSource = (id: string, version: string) => ({
  uri: url(`/constellations/${id}/banner/${version}`),
  headers: authHeaders(),
  cacheKey: `cx-banner-${id}-${version}`,
})

/** The banner: its photo, or the drawn night sky with a little constellation in its accent. */
export function BannerArt({ c, width, height, radius = 0 }: { c: { id: string; accent?: ConstellationDetail['accent']; bannerVersion?: string | null }; width: number; height: number; radius?: number }) {
  const a = accentOf(c)
  if (c.bannerVersion) {
    return <Image source={constellationBannerSource(c.id, c.bannerVersion)} style={{ width, height, borderRadius: radius }} contentFit="cover" cachePolicy="disk" transition={120} />
  }
  const p = (x: number, y: number) => `${Math.round(x * width)} ${Math.round(y * height)}`
  return (
    <View style={{ width, height, borderRadius: radius, overflow: 'hidden', backgroundColor: '#1a1020', experimental_backgroundImage: `radial-gradient(circle at 70% 40%, rgba(${a.rgb},.35), transparent 45%), linear-gradient(160deg, #2b1a3a 0%, #1a1020 55%, #120c0a 100%)` } as object}>
      <Svg width={width} height={height}>
        <Path d={`M${p(0.13, 0.72)} L${p(0.34, 0.42)} L${p(0.53, 0.55)} L${p(0.73, 0.23)} L${p(0.89, 0.45)}`} stroke={a.color} strokeOpacity={0.55} strokeWidth={1.4} fill="none" />
        <Circle cx={0.13 * width} cy={0.72 * height} r={3} fill={a.color} />
        <Circle cx={0.34 * width} cy={0.42 * height} r={2.5} fill="#f5ede6" />
        <Circle cx={0.53 * width} cy={0.55 * height} r={3.5} fill={a.color} />
        <Circle cx={0.73 * width} cy={0.23 * height} r={4} fill={a.color} />
        <Circle cx={0.89 * width} cy={0.45 * height} r={2.5} fill="#f5ede6" />
        <Circle cx={0.24 * width} cy={0.17 * height} r={1.2} fill="#e9d5c4" />
        <Circle cx={0.92 * width} cy={0.78 * height} r={1.5} fill="#f9b26b" />
      </Svg>
    </View>
  )
}

// ───────────── Invite cards in chats ─────────────

/** The invite code in a message (only real glofly.app/c/… links). */
export function inviteCodeIn(text: string): string | null {
  const m = text.match(/(?:^|[\s(])(?:https?:\/\/)?(?:www\.)?glofly\.app\/c\/([A-Za-z0-9]{6,16})\b/)
  return m ? m[1] : null
}

type Looked = { ok: true; preview: InvitePreview } | { ok: false; hide: boolean }
const lookups = new Map<string, { at: number; result: Promise<Looked> }>()
function lookUp(code: string, fresh = false): Promise<Looked> {
  const hit = lookups.get(code)
  if (hit && !fresh && Date.now() - hit.at < 5 * 60_000) return hit.result
  const result = cx.linkPreview(code).then((r): Looked => (r.ok ? { ok: true, preview: r.data } : { ok: false, hide: r.error !== 'not_found' }))
  lookups.set(code, { at: Date.now(), result })
  return result
}

function expiresText(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'expired'
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `expires in ${days} ${days === 1 ? 'day' : 'days'}`
  const hours = Math.max(1, Math.floor(ms / 3_600_000))
  return `expires in ${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

/** A constellation invite link in a chat, as a card (Join, or Open once you're in). */
export function InviteCard({ code, width = 280, onProblem }: { code: string; width?: number; onProblem?: (m: string) => void }) {
  const available = useCxAvailable()
  const [looked, setLooked] = useState<Looked | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!available) return
    let live = true
    void lookUp(code).then((r) => live && setLooked(r))
    return () => {
      live = false
    }
  }, [code, available])
  if (!available) return null
  if (!looked) return <View style={{ width, height: 132, marginTop: 8, borderRadius: 16, backgroundColor: N.card2 }} />
  if (!looked.ok) {
    if (looked.hide) return null
    return (
      <View style={{ width, marginTop: 8, borderRadius: 16, padding: 14, backgroundColor: N.card, borderWidth: 1, borderColor: N.line2 }}>
        <Text size={11} weight="bold" style={{ color: N.muted, letterSpacing: 0.9 }}>
          INVITE TO A CONSTELLATION
        </Text>
        <Text size={13} style={{ color: N.ink2 }}>
          This invite has expired or doesn't work any more.
        </Text>
      </View>
    )
  }
  const { constellation: c, by, expiresAt } = looked.preview
  const a = accentOf(c)
  const open = (id: string) => flyIn(null, placePaths({ constellationId: id, nebulaId: null }, isWideNow()))
  async function join() {
    if (c.joined) return open(c.id)
    setBusy(true)
    const r = await cx.joinLink(code)
    setBusy(false)
    if (!r.ok) {
      onProblem?.(r.message)
      void lookUp(code, true).then(setLooked)
      return
    }
    haptic.success()
    putDetail(r.data.constellation)
    void refreshCards()
    void lookUp(code, true)
    open(r.data.constellation.id)
  }
  const from = by ? first(by) : null
  const expires = expiresText(expiresAt)
  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ width, borderRadius: 16, overflow: 'hidden', backgroundColor: N.card, borderWidth: 1, borderColor: N.line2, boxShadow: '0 0 20px rgba(255,165,74,0.12)' }}>
        <View style={{ height: 70 }}>
          <BannerArt c={c} width={width} height={70} />
          <ConstellationIcon c={c} size={44} radius={14} border={N.card} style={{ position: 'absolute', left: 12, bottom: -20, ...(c.iconVersion ? null : { backgroundColor: N.bg }) }} />
        </View>
        <View style={{ paddingTop: 24, paddingHorizontal: 12, paddingBottom: 12, flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text size={10} weight="bold" style={{ color: N.muted, letterSpacing: 0.9 }}>
              INVITE TO A CONSTELLATION
            </Text>
            <Text display size={18} numberOfLines={1} style={{ color: N.ink }}>
              {c.name}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: N.online }} />
              <Text size={12} style={{ color: N.ink2 }} numberOfLines={1}>
                {c.onlineCount} online now · {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={c.joined ? `Open ${c.name}` : `Join ${c.name}`}
            disabled={busy}
            onPress={() => void join()}
            style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: a.color, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.6 : pressed ? 0.85 : 1 })}
          >
            <Text size={15} weight="bold" style={{ color: a.on }}>
              {c.joined ? 'Open' : busy ? 'Joining…' : 'Join'}
            </Text>
          </Pressable>
        </View>
      </View>
      {from || expires ? (
        <Text size={11} style={{ color: N.faint, marginTop: 5 }}>
          {[from && `Invite from ${from}`, expires].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
    </View>
  )
}

// ───────────── Join lines and milestones (nebulas) ─────────────

/** "Priya joined Firefly Guild. Say hi!" with Say hi (a 👋 on the line and a 👋 in the chat). */
export function CxJoinLine({ m, meId, nameOf, canAct, onReact }: { m: Message; meId: string; nameOf: (id: string) => string; canAct: boolean; onReact?: (m: Message, emoji: string) => void }) {
  const event = m.event?.type === 'cxJoined' ? m.event : null
  const mine = m.senderId === meId
  const wavers = m.reactions.find((r) => r.emoji === '👋')?.userIds ?? []
  const waved = wavers.includes(meId)
  const others = wavers.filter((id) => id !== meId)
  const names = [...(waved ? ['You'] : []), ...others.slice(0, 1).map(nameOf)]
  const rest = wavers.length - names.length
  const wavedText = !others.length ? null : rest > 0 ? `${names.join(', ')} and ${rest} ${rest === 1 ? 'other' : 'others'} waved` : names.length === 2 ? `${names[0]} and ${names[1]} waved` : `${names[0]} waved`
  const who = mine ? 'You' : nameOf(m.senderId)
  return (
    <View style={{ marginTop: 10, marginLeft: 48, gap: 6 }} accessibilityLabel={`${who} joined ${event?.name ?? 'the constellation'}${wavedText ? `. ${wavedText}` : ''}`}>
      <Text size={14} style={{ color: N.ink2 }}>
        <Text size={14} weight="bold" style={{ color: N.greenText }}>
          →{' '}
        </Text>
        <Text size={14} weight="bold" style={{ color: N.ink }}>
          {who}
        </Text>{' '}
        joined {event?.name ?? 'the constellation'}
        {mine ? '' : '. Say hi!'}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {!mine && canAct ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: waved, selected: waved }}
            accessibilityLabel={waved ? `You waved at ${who}` : `Say hi to ${who} with a wave`}
            disabled={waved || !onReact}
            onPress={() => {
              haptic.light()
              onReact?.(m, '👋')
              sendText(m.conversationId, '👋', null)
            }}
            style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: waved ? N.amber : N.edge2, backgroundColor: waved ? 'rgba(255,179,71,0.14)' : pressed ? N.card2 : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 6 })}
          >
            <Text size={15}>👋</Text>
            <Text size={13} weight="bold" style={{ color: waved ? N.tag : N.ink }}>
              {waved ? 'You waved' : 'Say hi'}
            </Text>
          </Pressable>
        ) : null}
        {wavedText ? (
          <Text size={12} style={{ color: N.faint }}>
            {wavedText}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

const SPARKS = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2
  const d = 50 + ((i * 53) % 70)
  return { x: Math.round(Math.cos(a) * d * 1.4), y: Math.round(Math.sin(a) * d * 0.7), delay: ((i * 13) % 25) * 10 }
})

/** The milestone card, finding its constellation (for the icon) from the nebula's chat. */
export function CxMilestone({ m }: { m: Message }) {
  const c = useCx((s) => Object.values(s.details).find((d) => d.nebulas.some((n) => n.conversationId === m.conversationId)) ?? null)
  return <CxMilestoneCard m={m} c={c} />
}

/** "Firefly Guild just reached 100 members!" with a firefly burst (Replay). */
export function CxMilestoneCard({ m, c }: { m: Message; c: ConstellationDetail | null }) {
  const event = m.event?.type === 'cxMilestone' ? m.event : null
  const reduce = useReduceMotion((s) => s.on)
  const fresh = Date.now() - new Date(m.createdAt).getTime() < 2 * 60_000
  const burst = useRef(SPARKS.map(() => new RNAnimated.Value(0))).current
  const play = () => {
    if (reduce) return
    burst.forEach((v) => v.setValue(0))
    RNAnimated.parallel(
      burst.map((v, i) => RNAnimated.timing(v, { toValue: 1, duration: 1400, delay: SPARKS[i].delay, easing: Easing.out(Easing.cubic), useNativeDriver: true })),
    ).start()
  }
  useEffect(() => {
    if (fresh) play()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!event) return null
  const when = new Date(m.createdAt)
  const today = when.toDateString() === new Date().toDateString()
  const time = when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return (
    <View style={{ marginVertical: 12, alignItems: 'center' }} accessibilityLabel={milestoneText(event)}>
      <View style={{ position: 'absolute', left: '50%', top: '50%' }} pointerEvents="none">
        {SPARKS.map((s, i) => (
          <RNAnimated.View
            key={i}
            style={{
              position: 'absolute',
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: '#ffd27a',
              boxShadow: '0 0 10px 4px rgba(255,179,71,0.65)',
              opacity: burst[i].interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }),
              transform: [
                { translateX: burst[i].interpolate({ inputRange: [0, 1], outputRange: [0, s.x] }) },
                { translateY: burst[i].interpolate({ inputRange: [0, 1], outputRange: [0, s.y] }) },
              ],
            }}
          />
        ))}
      </View>
      <View style={{ alignSelf: 'stretch', borderRadius: 18, padding: 14, backgroundColor: N.card, borderWidth: 1, borderColor: N.edge, boxShadow: '0 0 0 1px rgba(255,179,71,0.1), 0 0 30px rgba(255,165,74,0.28)', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {c ? <ConstellationIcon c={c} size={44} radius={14} style={c.iconVersion ? undefined : { backgroundColor: N.bg }} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text display size={17}>
            {event.name} {event.years ? '' : 'just reached '}
            <Text display size={17} style={{ color: '#ffd27a' }}>
              {event.years ? `turns ${event.years} today!` : `${event.members ?? 0} members!`}
            </Text>
          </Text>
          <Text size={12} style={{ color: N.ink2 }}>
            Thanks for making it glow. {today ? 'Today' : when.toLocaleDateString([], { month: 'short', day: 'numeric' })}, {time}
          </Text>
        </View>
        {!reduce ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Replay the celebration" onPress={play} style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: N.edge2, backgroundColor: pressed ? N.card2 : 'transparent', justifyContent: 'center' })}>
            <Text size={12} weight="bold">
              Replay
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

// ───────────── The welcome when you join ─────────────

export const needsWelcome = (c: ConstellationDetail): boolean => c.welcomedAt === null && c.welcome?.screen !== false && !c.me.owner

/** Closed for this constellation while Glofly is open (Escape / swipe down = later). */
const closedFor = new Set<string>()

export function WelcomeSheet({ c }: { c: ConstellationDetail }) {
  const meId = useSession((s) => s.user?.id ?? '')
  const me = c.members.find((m) => m.user.id === meId)?.user
  const [, redraw] = useState(0)
  const rules = c.rules ?? []
  const pickable = c.roles.filter((r) => r.selfAssign)
  const steps = ['about', ...(rules.length ? ['rules'] : []), ...(pickable.length ? ['roles'] : [])] as const
  const [at, setAt] = useState(0)
  const [agreed, setAgreed] = useState(false)
  const [picks, setPicks] = useState<string[]>(() => (c.members.find((m) => m.user.id === meId)?.roleIds ?? []).filter((id) => pickable.some((r) => r.id === id)))
  const [busy, setBusy] = useState(false)
  if (!needsWelcome(c) || closedFor.has(c.id) || !me) return null
  const step = steps[at]
  const last = at === steps.length - 1
  const a = accentOf(c)
  const online = c.members.filter((m) => m.status !== 'offline').length
  const owner = c.members.find((m) => m.user.id === c.ownerId)?.user
  const blocked = step === 'rules' && !agreed
  const close = () => {
    closedFor.add(c.id)
    redraw((x) => x + 1)
  }
  async function next() {
    if (blocked || busy) return
    if (!last) {
      haptic.select()
      return setAt(at + 1)
    }
    setBusy(true)
    const r = await cx.welcomeDone(c.id, agreed, picks)
    setBusy(false)
    if (!r.ok) return
    haptic.success()
    closedFor.add(c.id)
    putDetail(r.data.constellation)
  }
  return (
    <NightModal onClose={close} fit top={80} accessibilityLabel={`Welcome to ${c.name}`} padded={false}>
      <View>
        <View style={{ height: 120 }}>
          <BannerArt c={c} width={600} height={120} />
          <ConstellationIcon c={c} size={56} radius={18} border={N.card} style={{ position: 'absolute', left: 20, bottom: -24, boxShadow: `0 0 18px rgba(${a.rgb},0.45)`, ...(c.iconVersion ? null : { backgroundColor: N.bg }) }} />
          {steps.length > 1 ? (
            <View style={{ position: 'absolute', right: 16, top: 14, flexDirection: 'row', gap: 6 }} accessibilityLabel={`Step ${at + 1} of ${steps.length}`}>
              {steps.map((s, i) => (
                <View key={s} style={{ width: i === at ? 26 : 8, height: 8, borderRadius: 4, backgroundColor: i <= at ? a.color : 'rgba(255,255,255,0.25)' }} />
              ))}
            </View>
          ) : null}
        </View>
        <View style={{ paddingTop: 36, paddingHorizontal: 20, paddingBottom: 16, gap: 14 }}>
          {step === 'about' ? (
            <>
              <View>
                <Text display size={24}>
                  Welcome to {c.name}, {first(me)}!
                </Text>
                <Text size={13} style={{ color: N.ink2, marginTop: 4 }}>
                  {c.members.length} members · <Text size={13} style={{ color: N.greenText }}>{online} online now</Text>
                  {owner ? ` · made by ${first(owner)}` : ''}
                </Text>
              </View>
              <Text size={15} style={{ color: '#e9d5c4', lineHeight: 22 }}>
                {c.description || `Say hi in #${c.nebulas.find((n) => n.kind === 'text' && !n.readOnly)?.name ?? 'general'} once you're in!`}
              </Text>
            </>
          ) : null}
          {step === 'rules' ? (
            <>
              <Text display size={24}>
                House rules
              </Text>
              {rules.map((r, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
                  <Text size={15} weight="bold" style={{ color: a.color }}>
                    {i + 1}
                  </Text>
                  <Text size={15} style={{ color: '#e9d5c4', flex: 1 }}>
                    {r}
                  </Text>
                </View>
              ))}
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: agreed }}
                onPress={() => {
                  haptic.select()
                  setAgreed(!agreed)
                }}
                style={{ alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: agreed ? a.color : N.edge2, backgroundColor: agreed ? `rgba(${a.rgb},0.12)` : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: a.color, backgroundColor: agreed ? a.color : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {agreed ? (
                    <Text size={13} weight="bold" style={{ color: N.amberInk }}>
                      ✓
                    </Text>
                  ) : null}
                </View>
                <Text size={15} weight="bold">
                  I agree to the house rules
                </Text>
              </Pressable>
            </>
          ) : null}
          {step === 'roles' ? (
            <>
              <View>
                <Text display size={24}>
                  What do you play?
                </Text>
                <Text size={13} style={{ color: N.ink2, marginTop: 4 }}>
                  Pick any. You get the role, so people know. Change it any time.
                </Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {pickable.map((r) => {
                  const on = picks.includes(r.id)
                  const dot = (ROLE_COLORS[r.color] ?? ROLE_COLORS.gray).dot
                  return (
                    <Pressable
                      key={r.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      onPress={() => {
                        haptic.select()
                        setPicks(on ? picks.filter((x) => x !== r.id) : [...picks, r.id])
                      }}
                      style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1.5, borderColor: on ? dot : N.edge2, backgroundColor: on ? 'rgba(255,255,255,0.08)' : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 8 }}
                    >
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} />
                      <Text size={14} weight="bold" style={{ color: on ? '#ffffff' : N.ink2 }}>
                        {r.name}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </>
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: N.line2, paddingTop: 14 }}>
            <Pressable accessibilityRole="button" onPress={() => setAt(Math.max(0, at - 1))} disabled={at === 0} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6, opacity: at === 0 ? 0 : 1 }}>
              <Text size={15} weight="bold" style={{ color: N.ink2 }}>
                Back
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: blocked || busy }}
              onPress={() => void next()}
              style={{ minHeight: 48, paddingHorizontal: 24, borderRadius: 24, backgroundColor: blocked ? N.line2 : a.color, justifyContent: 'center' }}
            >
              <Text size={15} weight="bold" style={{ color: blocked ? N.dim : a.on }}>
                {busy ? 'One moment…' : step === 'rules' ? (agreed ? 'Continue' : 'Agree to continue') : last ? 'Fly in' : 'Next'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </NightModal>
  )
}

// ───────────── The member card's extras ─────────────

/** What they're playing (and for how long) and the friends you both have. */
export function MemberExtras({ c, userId, playing }: { c: ConstellationDetail; userId: string; playing: { name: string; since: string } | null | undefined }) {
  const meId = useSession((s) => s.user?.id ?? '')
  const [info, setInfo] = useState<MemberCardInfo | null>(null)
  useEffect(() => {
    if (userId === meId) return
    let live = true
    void cx.memberCard(c.id, userId).then((r) => live && r.ok && setInfo(r.data))
    return () => {
      live = false
    }
  }, [c.id, userId, meId])
  const voice = c.voice.find((v) => v.userIds.includes(userId))
  const voiceName = voice ? c.nebulas.find((n) => n.id === voice.nebulaId)?.name : null
  const mutual = info
    ? info.mutualCount === 0
      ? 'No mutual friends yet'
      : info.mutualCount === 1
        ? `${first(info.mutualFriends[0])} is a mutual friend`
        : info.mutualCount === 2
          ? `${first(info.mutualFriends[0])} and ${first(info.mutualFriends[1])} are mutual friends`
          : `${info.mutualFriends.slice(0, 2).map(first).join(', ')} and ${info.mutualCount - 2} more are mutual friends`
    : null
  return (
    <>
      {playing ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, backgroundColor: N.bg, borderWidth: 1, borderColor: N.line2 }}>
          <View style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: gameTileColor(playing.name), alignItems: 'center', justifyContent: 'center' }}>
            <Text size={12} weight="bold" style={{ color: '#ffffff' }}>
              {gameInitials(playing.name)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text size={11} weight="bold" style={{ color: N.greenText, letterSpacing: 0.7 }}>
              PLAYING NOW
            </Text>
            <Text size={15} weight="bold">
              {playing.name}
            </Text>
            <Text size={12} style={{ color: N.muted }}>
              For {playingFor(playing.since)}
              {voiceName ? ` · in ${voiceName}` : ''}
            </Text>
          </View>
        </View>
      ) : null}
      {mutual ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {info?.mutualFriends.length ? (
            <View style={{ flexDirection: 'row', paddingLeft: 6 }}>
              {info.mutualFriends.map((p) => (
                <Face key={p.id} user={p} size={24} style={{ marginLeft: -6, boxShadow: `0 0 0 2px ${N.card}` }} />
              ))}
            </View>
          ) : null}
          <Text size={13} style={{ color: N.muted, flex: 1 }}>
            {mutual}
          </Text>
        </View>
      ) : null}
    </>
  )
}

const GAME_TILES = ['#1d4fa0', '#e0193a', '#2e9e5b', '#7457e6', '#d4448c', '#127a85', '#b8430a']
function gameTileColor(name: string): string {
  let h = 0
  for (const ch of name.toLowerCase()) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return GAME_TILES[h % GAME_TILES.length]
}
