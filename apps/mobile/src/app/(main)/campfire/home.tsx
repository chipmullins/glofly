import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SRD_CREDIT, type CampaignHomeKind, type CampaignSummary } from '@glofly/shared'
import { ThemeOverride } from '@/ui/theme'
import { Text, webNoOutline } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { inform } from '@/ui/dialogs'
import { campfireApi } from '@/campfire/api'
import { noteLit } from '@/campfire/store'
import { FireButton } from '@/campfire/ui'
import { useFire } from '@/campfire/lib'

// "Start Campfire" (Start board): the campaigns saved with this voice nebula or group chat, and a
// new one. A game master picking one in a call lights it for everyone in the call ("Campfire is
// lit · Join"); players just sit down at it. Building maps and running the game is on a computer.

export default function CampfireHome() {
  const p = useLocalSearchParams<{ kind: string; home: string; callId?: string; title?: string }>()
  const kind: CampaignHomeKind = p.kind === 'nebula' ? 'nebula' : 'chat'
  return (
    <ThemeOverride mode="night">
      <Home kind={kind} home={String(p.home ?? '')} callId={p.callId ? String(p.callId) : null} title={p.title ? String(p.title) : null} />
    </ThemeOverride>
  )
}

function Home({ kind, home, callId, title }: { kind: CampaignHomeKind; home: string; callId: string | null; title: string | null }) {
  const fire = useFire()
  const insets = useSafeAreaInsets()
  const [list, setList] = useState<CampaignSummary[] | null>(null)
  const [canCreate, setCanCreate] = useState(false)
  const [why, setWhy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    const r = await campfireApi.campaigns(kind, home)
    if (!r.ok) return setError(r.message)
    setError(null)
    setList(r.data.campaigns)
    setCanCreate(r.data.canCreate)
    setWhy(r.data.why ?? null)
    for (const c of r.data.campaigns) if (c.openInCallId) noteLit({ campaignId: c.id, callId: c.openInCallId, name: c.name, by: c.createdBy ?? '' })
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, home])

  /** Sit down at it; a GM in a call lights it for the call first. */
  const sit = async (c: CampaignSummary) => {
    if (c.myRole === 'gm' && callId && c.openInCallId !== callId) {
      setBusy(c.id)
      const r = await campfireApi.open(c.id, callId)
      setBusy(null)
      if (!r.ok) void inform("Couldn't light it for the call", r.message)
    }
    router.replace({ pathname: '/campfire/[id]', params: { id: c.id } })
  }

  const create = async () => {
    if (!name.trim()) return
    setBusy('new')
    const r = await campfireApi.create(kind, home, name.trim())
    setBusy(null)
    if (!r.ok) return void inform("Couldn't start it", r.message)
    setNaming(false)
    setName('')
    await sit(r.data)
  }

  return (
    <View style={{ flex: 1, backgroundColor: fire.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/chats'))} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: fire.card, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevronLeft" size={20} color={fire.ink} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_700Bold', fontSize: 20, color: fire.ink }}>
            Start Campfire
          </Text>
          {title ? (
            <Text size={12} numberOfLines={1} style={{ color: fire.muted }}>
              {title}
            </Text>
          ) : null}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 32, gap: 14, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
        <Text size={14} style={{ color: fire.muted, lineHeight: 20 }}>
          {kind === 'nebula'
            ? 'Opens a shared table for everyone in this voice nebula. Saved with the constellation, so next week picks up where you left off.'
            : 'Opens a shared table for everyone in this group’s call. Saved with the group, so next week picks up where you left off.'}
        </Text>
        {error ? (
          <View style={{ gap: 10 }}>
            <Text size={14} style={{ color: fire.redText }}>
              {error}
            </Text>
            <FireButton label="Try again" onPress={() => void load()} />
          </View>
        ) : !list ? (
          <ActivityIndicator color={fire.muted} style={{ marginTop: 24 }} />
        ) : (
          <View style={{ gap: 8 }}>
            {list.map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={`${c.name}${c.openInCallId ? ', lit now' : ''}${c.myRole === 'gm' ? ', you are a game master' : ''}`}
                onPress={() => void sit(c)}
                style={({ pressed }) => ({ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: fire.card, borderWidth: 1, borderColor: c.openInCallId ? 'rgba(255,179,71,0.45)' : fire.line, opacity: pressed ? 0.85 : 1 })}
              >
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: fire.amberSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="campfire" size={20} color={fire.amber} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text size={15} weight="bold" numberOfLines={1} style={{ color: fire.ink }}>
                    {c.name}
                  </Text>
                  <Text size={12} numberOfLines={1} style={{ color: c.openInCallId ? fire.amber : fire.muted }}>
                    {c.openInCallId ? 'Lit now' : `Last played ${new Date(c.updatedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`}
                    {c.myRole === 'gm' ? ' · Game master' : ''}
                  </Text>
                </View>
                {busy === c.id ? <ActivityIndicator color={fire.muted} /> : <Icon name="chevronRight" size={18} color={fire.muted} />}
              </Pressable>
            ))}
            {naming ? (
              <View style={{ gap: 8, padding: 12, borderRadius: 14, backgroundColor: fire.card, borderWidth: 1, borderColor: fire.line }}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="The Sunken Crypt"
                  placeholderTextColor={fire.muted}
                  accessibilityLabel="Campaign name"
                  autoFocus
                  maxLength={60}
                  returnKeyType="done"
                  onSubmitEditing={() => void create()}
                  style={[{ height: 48, paddingHorizontal: 12, borderRadius: 10, backgroundColor: fire.bg, borderWidth: 1, borderColor: fire.line, color: fire.ink, fontSize: 16, fontFamily: 'DMSans_500Medium' }, webNoOutline]}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <FireButton label="Cancel" style={{ flex: 1 }} onPress={() => setNaming(false)} />
                  <FireButton label="Start it" kind="primary" busy={busy === 'new'} disabled={!name.trim()} style={{ flex: 1 }} onPress={() => void create()} />
                </View>
              </View>
            ) : canCreate ? (
              <Pressable accessibilityRole="button" onPress={() => setNaming(true)} style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: fire.line }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: fire.card, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="plus" size={20} color={fire.ink} />
                </View>
                <Text size={15} weight="bold" style={{ color: fire.ink }}>
                  New campaign
                </Text>
              </Pressable>
            ) : list.length === 0 ? (
              <Text size={14} style={{ color: fire.muted }}>
                {why ?? 'No campaigns here yet. A game master can start one.'}
              </Text>
            ) : null}
          </View>
        )}
        <Text size={12} style={{ color: fire.muted, lineHeight: 18 }}>
          {kind === 'nebula' ? 'Game masters: people with "Run Campfire games" (or the Owner). ' : ''}Maps and the turn order are set up on a computer; on a phone you play, roll and keep your sheet. {SRD_CREDIT}
        </Text>
      </ScrollView>
    </View>
  )
}
