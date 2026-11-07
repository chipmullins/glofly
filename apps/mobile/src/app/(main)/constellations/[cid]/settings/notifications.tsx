import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { MUTE_CHOICES, mutedLabel, type ConstellationNotifySettings, type MuteDuration, type Nebula, type NotifyLevel } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { cxSay, putDetail, refreshCards, useCx } from '@/state/constellations'
import { chooseFrom } from '@/ui/dialogs'
import { Text } from '@/ui/kit'
import { haptic } from '@/constellations/motion'
import { NOTIFY_WORDS, setNebulaNotify } from '@/constellations/nebulaActions'
import { SettingsScreen, useSettingsDetail } from '@/constellations/settingsKit'
import { Caps, N, Radio, Toggle } from '@/constellations/ui'

// Communities round 4.2 (approved board 29): a constellation's notification window on phones.
// The same choices as the desktop's (board 23); only you see these.

const LEVELS: { level: NotifyLevel; name: string; what: string }[] = [
  { level: 'all', name: 'All messages', what: 'Every message you can see' },
  { level: 'mentions', name: 'Only @mentions', what: 'You, @everyone or your roles' },
  { level: 'none', name: 'Nothing', what: 'Only badges' },
]
const DEFAULTS: ConstellationNotifySettings = { mutedUntil: null, ignoreEveryone: false, ignoreRoles: false, followAlerts: true }
const MUTE_WORDS: Record<MuteDuration, string> = { '1h': 'For 1 hour', '8h': 'For 8 hours', '24h': 'For 24 hours', forever: 'Until I turn it on' }

function ToggleRow({ label, sub, value, onChange }: { label: string; sub?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 2 }}>
      <View style={{ flex: 1 }}>
        <Text size={15} weight="bold">
          {label}
        </Text>
        {sub ? (
          <Text size={12} style={{ color: N.muted }}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Toggle amber value={value} label={label} onChange={onChange} />
    </View>
  )
}

export default function NotificationSettings() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useSettingsDetail(cid)
  const [busy, setBusy] = useState(false)
  if (!c) return <SettingsScreen title="Notifications" c={null}>{null}</SettingsScreen>
  const s = c.me.notifications ?? DEFAULTS
  const muted = !!s.mutedUntil && new Date(s.mutedUntil).getTime() > Date.now()

  // Shown at once; put back if the server says no.
  async function change(body: Parameters<typeof cx.notifySettings>[1], shown: Partial<ConstellationNotifySettings> & { notify?: NotifyLevel }) {
    if (!c || busy) return
    const before = c
    const { notify, ...rest } = shown
    putDetail({ ...c, me: { ...c.me, ...(notify ? { notify } : {}), notifications: { ...s, ...rest } } })
    haptic.select()
    setBusy(true)
    const r = await cx.notifySettings(c.id, body)
    setBusy(false)
    if (!r.ok) {
      putDetail(before)
      return cxSay(r.message)
    }
    void refreshCards()
  }

  async function toggleMute(on: boolean) {
    if (!on) return change({ mute: null }, { mutedUntil: null })
    const pick = await chooseFrom(
      MUTE_CHOICES.map((m) => ({ key: m.duration, label: MUTE_WORDS[m.duration] })),
      `Mute ${c!.name}`,
    )
    if (!pick) return
    const d = pick as MuteDuration
    const until = d === 'forever' ? '2100-01-01T00:00:00.000Z' : new Date(Date.now() + { '1h': 1, '8h': 8, '24h': 24 }[d] * 3_600_000).toISOString()
    void change({ mute: d }, { mutedUntil: until })
  }

  async function pickFor(n: Nebula) {
    const pick = await chooseFrom(
      [
        { key: 'default', label: `Use ${c!.name}’s setting (${NOTIFY_WORDS[c!.me.notify]})`, checked: !n.notify },
        ...LEVELS.map((l) => ({ key: l.level, label: l.name, checked: n.notify === l.level })),
      ],
      `#${n.name}`,
    )
    if (!pick) return
    haptic.select()
    void setNebulaNotify(c!, n, pick === 'default' ? null : (pick as NotifyLevel))
  }

  async function addNebula() {
    const others = c!.nebulas.filter((n) => n.kind !== 'voice' && !n.notify)
    const pick = await chooseFrom(others.map((n) => ({ key: n.id, label: `#${n.name}` })), 'Pick a nebula')
    const n = others.find((x) => x.id === pick)
    if (n) void pickFor(n)
  }

  const differing = c.nebulas.filter((n) => n.kind !== 'voice' && n.notify)
  return (
    <SettingsScreen title="Notifications" c={c}>
      <Text size={13} style={{ color: N.muted, marginTop: -8 }}>
        {c.name}
      </Text>
      <ToggleRow
        label={`Mute ${c.name}`}
        sub={muted ? `${mutedLabel(s.mutedUntil!)} · @mentions of you still get through` : '@mentions of you still get through'}
        value={muted}
        onChange={(v) => void toggleMute(v)}
      />

      <Caps>Notify me about</Caps>
      <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
        {LEVELS.map((l) => {
          const on = c.me.notify === l.level
          return (
            <Pressable
              key={l.level}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${l.name}, ${l.what}`}
              onPress={() => !on && void change({ level: l.level }, { notify: l.level })}
              style={{ minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: on ? N.amber : N.line2, backgroundColor: N.card }}
            >
              <Radio on={on} />
              <View style={{ flex: 1 }}>
                <Text size={15} weight="bold">
                  {l.name}
                </Text>
                <Text size={12} style={{ color: N.muted }}>
                  {l.what}
                </Text>
              </View>
            </Pressable>
          )
        })}
      </View>

      <Caps>Mentions</Caps>
      <View>
        <ToggleRow label="Ignore @everyone and @here" value={s.ignoreEveryone} onChange={(v) => void change({ ignoreEveryone: v }, { ignoreEveryone: v })} />
        <ToggleRow label="Ignore role mentions" value={s.ignoreRoles} onChange={(v) => void change({ ignoreRoles: v }, { ignoreRoles: v })} />
        <ToggleRow label="Trails and signals I follow" sub="New replies notify me" value={s.followAlerts} onChange={(v) => void change({ followAlerts: v }, { followAlerts: v })} />
      </View>

      <Caps>Nebulas that differ</Caps>
      <View style={{ gap: 2 }}>
        {differing.map((n) => (
          <Pressable key={n.id} accessibilityRole="button" accessibilityLabel={`#${n.name}: ${NOTIFY_WORDS[n.notify!]}`} onPress={() => void pickFor(n)} style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center' }}>
            <Text size={15} numberOfLines={1} style={{ flex: 1 }}>
              #{n.name}
              {n.kind === 'forum' ? ' (star chart)' : ''}
            </Text>
            <Text size={15} style={{ color: N.amber }}>
              {NOTIFY_WORDS[n.notify!]} ›
            </Text>
          </Pressable>
        ))}
        {!differing.length ? (
          <Text size={13} style={{ color: N.faint }}>
            Every nebula follows the setting above.
          </Text>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => void addNebula()} style={{ minHeight: 40, justifyContent: 'center' }}>
          <Text size={15} weight="bold" style={{ color: N.amber }}>
            + Pick a nebula
          </Text>
        </Pressable>
      </View>
    </SettingsScreen>
  )
}
