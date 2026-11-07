import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { INTEGRATION_SCOPES, apiKeyShown, type ApiKeyInfo } from '@glofly/shared'
import { integrations, type ToolName } from '@/api/integrations'
import { cxSay } from '@/state/constellations'
import { chooseFrom, confirm } from '@/ui/dialogs'
import { Text } from '@/ui/kit'
import { askPassword } from '@/constellations/ask'
import { haptic } from '@/constellations/motion'
import { can } from '@/constellations/roles'
import { SettingsScreen, useSettingsDetail } from '@/constellations/settingsKit'
import { NightModal } from '@/constellations/sheet'
import { Caps, Card, N, NightButton, Row, Toggle } from '@/constellations/ui'

// Communities round (Nov 2026): Integrations on phones (approved canvas board 11). Keys here;
// webhooks and the Activity log are on a computer (the desktop app or chat.glofly.app).

const used = (iso: string | null): string => {
  if (!iso) return 'Never used'
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 60) return 'Used just now'
  if (s < 3600) return `Used ${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `Used ${Math.floor(s / 3600)} h ago`
  return `Used ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

/** "Copy your key now": the one time a key is shown (also used after making one). */
export function SecretSheet({ title, secret, onDone }: { title: string; secret: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <NightModal onClose={onDone} fit top={100} accessibilityLabel={title}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <Text display size={20}>{title}</Text>
        <Text size={14} style={{ color: N.ink2, lineHeight: 20 }}>This is the only time Glofly shows it. Paste it into your server&apos;s config.</Text>
        <View style={{ padding: 12, borderRadius: 12, backgroundColor: N.deep, borderWidth: 1, borderColor: N.line2 }}>
          <Text size={14} selectable style={{ color: '#ffd9b3' }}>{secret}</Text>
        </View>
        <Text size={13} style={{ color: N.muted, lineHeight: 19 }}>Treat it like a password: never post it in a chat. If it leaks, reset it straight away.</Text>
        <NightButton
          kind="outline"
          label={copied ? 'Copied' : 'Copy'}
          icon={copied ? 'check' : undefined}
          onPress={() => {
            void Clipboard.setStringAsync(secret).then(() => {
              setCopied(true)
              haptic.success()
            })
          }}
        />
        <NightButton label="I've copied it" onPress={onDone} />
      </View>
    </NightModal>
  )
}

const TOOLS: { id: ToolName; name: string; text: string }[] = [
  { id: 'tickets', name: 'Tickets', text: 'Private help nebulas with staff' },
  { id: 'welcome', name: 'Welcome', text: 'Greets new members' },
  { id: 'buttonRoles', name: 'Button roles', text: 'Pick self-assigned roles' },
  { id: 'logging', name: 'Logging', text: 'Joins, edits, deletes to staff' },
  { id: 'giveaways', name: 'Giveaways', text: 'Enter with a button' },
]

export default function IntegrationsScreen() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useSettingsDetail(cid)
  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null)
  const [shown, setShown] = useState<string | null>(null)
  const [tools, setTools] = useState<Record<ToolName, { enabled: boolean; settings: Record<string, unknown> }> | null>(null)
  const load = useCallback(() => {
    void integrations.load(cid).then((r) => {
      if (r.ok) setKeys(r.data.keys)
      else cxSay(r.message)
    })
    void integrations.tools(cid).then((r) => {
      if (r.ok) setTools(r.data.tools)
    })
  }, [cid])
  useFocusEffect(load)
  useEffect(load, [load])
  if (!c) return <SettingsScreen title="Integrations" c={null}>{null}</SettingsScreen>
  if (!can(c, 'manageConstellation')) {
    return (
      <SettingsScreen title="Integrations" c={c}>
        <Text size={14} style={{ color: N.muted }}>Only people who can edit {c.name}&apos;s settings can manage its integrations.</Text>
      </SettingsScreen>
    )
  }

  async function keyMenu(k: ApiKeyInfo) {
    const pick = await chooseFrom(
      [
        { key: 'reset', label: 'Reset key', icon: 'refresh' },
        { key: 'delete', label: 'Delete', icon: 'trash', danger: true },
      ],
      k.name,
    )
    if (pick === 'reset') {
      const ok = await confirm({ title: `Reset the key for ${k.name}?`, message: 'The old key stops working straight away.', confirmLabel: 'Reset key' })
      if (!ok) return
      const password = await askPassword()
      if (!password) return
      const r = await integrations.resetKey(cid, k.id, password)
      if (!r.ok) return cxSay(r.message)
      setShown(r.data.secret)
      load()
    } else if (pick === 'delete') {
      const ok = await confirm({ title: `Delete ${k.name}?`, message: 'The key stops working and its bot leaves. Its messages stay.', confirmLabel: 'Delete', danger: true })
      if (!ok) return
      const r = await integrations.deleteKey(cid, k.id)
      if (!r.ok) return cxSay(r.message)
      haptic.success()
      load()
    }
  }

  async function toggleTool(t: ToolName, on: boolean) {
    if (on && t !== 'giveaways' && !Object.keys(tools?.[t].settings ?? {}).length) {
      return cxSay('Set this one up first in Glofly on a computer or chat.glofly.app (Settings → Integrations).')
    }
    const r = await integrations.setTool(cid, t, on)
    if (!r.ok) return cxSay(r.message)
    haptic.success()
    load()
  }

  return (
    <SettingsScreen title="Integrations" c={c}>
      <Caps>Glofly tools</Caps>
      {tools ? (
        <Card>
          {TOOLS.map((t, i) => (
            <Row
              key={t.id}
              label={t.name}
              sub={t.text}
              last={i === TOOLS.length - 1}
              right={<Toggle value={tools[t.id].enabled} label={`${t.name} on`} onChange={(v) => void toggleTool(t.id, v)} />}
            />
          ))}
        </Card>
      ) : null}
      <Text size={13} style={{ color: N.muted, lineHeight: 19 }}>Built in and free. They post as “Glofly”.</Text>
      <Caps>Bots &amp; API keys</Caps>
      {keys?.length ? (
        <Card>
          {keys.map((k, i) => (
            <Row
              key={k.id}
              label={k.name}
              sub={`${apiKeyShown(k.prefix)} · ${used(k.lastUsedAt)} · ${k.scopes.length} ${k.scopes.length === 1 ? 'permission' : 'permissions'}`}
              icon={
                <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: '#0e7490', alignItems: 'center', justifyContent: 'center' }}>
                  <Text size={10} weight="bold" style={{ color: '#fff' }}>BOT</Text>
                </View>
              }
              chevron
              last={i === keys.length - 1}
              accessibilityLabel={`${k.name}, ${used(k.lastUsedAt)}. ${k.scopes.map((s) => INTEGRATION_SCOPES.find((x) => x.id === s)?.name ?? s).join(', ')}`}
              onPress={() => void keyMenu(k)}
            />
          ))}
        </Card>
      ) : keys ? (
        <Text size={14} style={{ color: N.muted }}>No keys yet. Make one for your game server&apos;s whitelist script or a bot.</Text>
      ) : null}
      <NightButton label="New API key" icon="plus" onPress={() => router.push(`/constellations/${cid}/settings/integration-new` as Href)} />
      <Text size={13} style={{ color: N.muted, lineHeight: 19 }}>
        Webhooks and the Activity log are on this page in Glofly on a computer or chat.glofly.app.
      </Text>
      {shown ? <SecretSheet title="Copy your new key now" secret={shown} onDone={() => setShown(null)} /> : null}
    </SettingsScreen>
  )
}
