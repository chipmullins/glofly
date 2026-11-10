import { useEffect, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { isFullCharacter, type Character } from '@glofly/shared'
import { ThemeOverride } from '@/ui/theme'
import { Text, webNoOutline } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { inform } from '@/ui/dialogs'
import { campfireApi } from '@/campfire/api'
import { upsertCharacter, useCampfire } from '@/campfire/store'
import { CharacterSheetView } from '@/campfire/CharacterSheet'
import { MonsterBlockView } from '@/campfire/MonsterBlock'
import { FireButton } from '@/campfire/ui'
import { useFire } from '@/campfire/lib'

// Your Campfire character's sheet (id "new" makes one first: just a name, the rest later), or,
// for game masters, a monster's stat block.

export default function CharacterScreen() {
  const { id, campaign } = useLocalSearchParams<{ id: string; campaign: string }>()
  return (
    <ThemeOverride mode="night">
      <Sheet id={String(id)} campaignId={String(campaign ?? '')} />
    </ThemeOverride>
  )
}

function Sheet({ id, campaignId }: { id: string; campaignId: string }) {
  const fire = useFire()
  const fromTable = useCampfire((s) => s.tables[campaignId]?.characters.find((c) => c.id === id))
  const [loaded, setLoaded] = useState<Character | null>(null)
  const [error, setError] = useState<string | null>(null)
  const live = fromTable && isFullCharacter(fromTable) ? fromTable : null

  useEffect(() => {
    if (id === 'new' || live) return
    void campfireApi.character(id).then((r) => {
      if (!r.ok) return setError(r.message)
      if (isFullCharacter(r.data)) setLoaded(r.data)
      else setError("That sheet isn't yours to open.")
    })
  }, [id, live])

  if (id === 'new') return <NewCharacter campaignId={campaignId} />
  const ch = live ?? loaded
  if (!ch) {
    return (
      <View style={{ flex: 1, backgroundColor: fire.bg, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
        <Text size={15} style={{ color: error ? fire.ink : fire.muted, textAlign: 'center' }}>
          {error ?? 'Opening the sheet…'}
        </Text>
        {error ? <FireButton label="Back" onPress={() => router.back()} /> : null}
      </View>
    )
  }
  // NPCs (game masters only: the server sends their sheets to nobody else) show as a stat block.
  if (ch.kind === 'npc') return <MonsterBlockView campaignId={ch.campaignId} initial={ch} />
  return <CharacterSheetView campaignId={ch.campaignId} initial={ch} />
}

function NewCharacter({ campaignId }: { campaignId: string }) {
  const fire = useFire()
  const insets = useSafeAreaInsets()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const make = async () => {
    if (!name.trim()) return
    setBusy(true)
    const r = await campfireApi.createCharacter(campaignId, name.trim())
    setBusy(false)
    if (!r.ok) return void inform("Couldn't make your character", r.message)
    upsertCharacter(campaignId, r.data)
    router.replace({ pathname: '/campfire/character/[id]', params: { id: r.data.id, campaign: campaignId } })
  }
  return (
    <View style={{ flex: 1, backgroundColor: fire.bg, paddingTop: insets.top + 8, paddingHorizontal: 16, gap: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to the table" onPress={() => router.back()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: fire.card, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevronLeft" size={20} color={fire.ink} />
        </Pressable>
        <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_700Bold', fontSize: 17, color: fire.ink }}>
          Your character
        </Text>
      </View>
      <Text size={15} style={{ color: fire.muted }}>
        Give them a name. You can fill in the class, abilities and actions next (Edit on the sheet).
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Lyra"
        placeholderTextColor={fire.muted}
        accessibilityLabel="Character name"
        autoFocus
        maxLength={60}
        returnKeyType="done"
        onSubmitEditing={() => void make()}
        style={[{ height: 52, paddingHorizontal: 14, borderRadius: 14, backgroundColor: fire.card, borderWidth: 1, borderColor: fire.line, color: fire.ink, fontSize: 17, fontFamily: 'DMSans_500Medium' }, webNoOutline]}
      />
      <FireButton label="Make my character" kind="primary" busy={busy} disabled={!name.trim()} onPress={() => void make()} />
    </View>
  )
}
