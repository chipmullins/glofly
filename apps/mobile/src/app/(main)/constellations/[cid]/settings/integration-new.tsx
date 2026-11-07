import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { API_KEY_LIFETIMES, INTEGRATION_SCOPES, type ApiKeyLifetime, type IntegrationScope } from '@glofly/shared'
import { integrations } from '@/api/integrations'
import { cxSay } from '@/state/constellations'
import { chooseFrom } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { haptic } from '@/constellations/motion'
import { SettingsScreen, useSettingsDetail } from '@/constellations/settingsKit'
import { Caps, Card, Chip, N, NightButton, NightField, Row } from '@/constellations/ui'
import { SecretSheet } from './integrations'

// Communities round (Nov 2026): a new API key on phones (approved canvas board 2).

export default function NewKeyScreen() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useSettingsDetail(cid)
  const [name, setName] = useState('')
  const [roleId, setRoleId] = useState<string | null>(null)
  const [scopes, setScopes] = useState<IntegrationScope[]>(['members:read'])
  const [post, setPost] = useState<string[]>([])
  const [read, setRead] = useState<string[]>([])
  const [ips, setIps] = useState('')
  const [lifetime, setLifetime] = useState<ApiKeyLifetime>('never')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const roles = useMemo(
    () => (c ? c.roles.filter((r) => r.kind !== 'member' && r.kind !== 'owner' && !r.selfAssign && (c.me.owner || r.position < c.me.rank)).sort((a, b) => b.position - a.position) : []),
    [c],
  )
  if (!c) return <SettingsScreen title="New API key" c={null}>{null}</SettingsScreen>
  const texts = c.nebulas.filter((n) => n.kind === 'text')
  const toggle = (s: IntegrationScope) => setScopes((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))
  const pickRole = async () => {
    const pick = await chooseFrom([{ key: '', label: 'Member only', checked: roleId === null }, ...roles.map((r) => ({ key: r.id, label: r.name, checked: roleId === r.id }))], "Bot's role")
    if (pick !== null) setRoleId(pick || null)
  }
  const pickLifetime = async () => {
    const pick = await chooseFrom(API_KEY_LIFETIMES.map((l) => ({ key: l.id, label: l.name, checked: lifetime === l.id })), 'Stops working')
    if (pick) setLifetime(pick as ApiKeyLifetime)
  }
  async function make() {
    setBusy(true)
    const r = await integrations.makeKey(
      cid,
      { name, roleId, scopes, postNebulaIds: post, readNebulaIds: read, allowedIps: ips.split(/[\s,]+/).filter(Boolean), lifetime },
      password,
    )
    setBusy(false)
    if (!r.ok) return cxSay(r.message)
    haptic.success()
    setSecret(r.data.secret)
  }
  const nebulaChips = (picked: string[], set: (v: string[]) => void) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {texts.map((n) => (
        <Chip key={n.id} label={`#${n.name}`} on={picked.includes(n.id)} onPress={() => set(picked.includes(n.id) ? picked.filter((x) => x !== n.id) : [...picked, n.id])} />
      ))}
    </View>
  )
  return (
    <SettingsScreen title="New API key" c={c}>
      <NightField label="Bot name (shows in chats)" value={name} onChangeText={setName} maxLength={40} placeholder="Cozy RP Whitelist" />
      <Card>
        <Row label="Bot's role" detail={roleId ? (roles.find((r) => r.id === roleId)?.name ?? '') : 'Member only'} chevron onPress={() => void pickRole()} />
        <Row label="Stops working" detail={API_KEY_LIFETIMES.find((l) => l.id === lifetime)?.name} chevron last onPress={() => void pickLifetime()} />
      </Card>
      <Caps>What it can do</Caps>
      <Card>
        {INTEGRATION_SCOPES.map((s, i) => {
          const on = scopes.includes(s.id)
          return (
            <Pressable
              key={s.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${s.name}. ${s.what}`}
              onPress={() => toggle(s.id)}
              style={{ flexDirection: 'row', gap: 12, padding: 14, borderBottomWidth: i === INTEGRATION_SCOPES.length - 1 ? 0 : 1, borderBottomColor: N.line, backgroundColor: on ? 'rgba(255,179,71,0.08)' : 'transparent' }}
            >
              <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: on ? 0 : 1.5, borderColor: N.edge2, backgroundColor: on ? N.amber : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                {on ? <Icon name="check" size={14} color={N.amberInk} strokeWidth={3} /> : null}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text size={15} weight="bold">{s.name}</Text>
                <Text size={13} style={{ color: N.muted }}>{s.what}</Text>
              </View>
            </Pressable>
          )
        })}
      </Card>
      {scopes.includes('messages:write') ? (
        <>
          <Caps>Nebulas it can post in</Caps>
          {nebulaChips(post, setPost)}
        </>
      ) : null}
      {scopes.includes('messages:read') ? (
        <>
          <Caps>Nebulas it can read</Caps>
          {nebulaChips(read, setRead)}
        </>
      ) : null}
      <NightField label="Only from these addresses (optional)" value={ips} onChangeText={setIps} autoCapitalize="none" autoCorrect={false} keyboardType="numbers-and-punctuation" placeholder="203.0.113.24" />
      <NightField label="Your Glofly password, to confirm" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" />
      <NightButton label="Make key" busy={busy} disabled={!name.trim() || !password} onPress={() => void make()} />
      {secret ? (
        <SecretSheet
          title="Copy your key now"
          secret={secret}
          onDone={() => {
            setSecret(null)
            router.back()
          }}
        />
      ) : null}
    </SettingsScreen>
  )
}
