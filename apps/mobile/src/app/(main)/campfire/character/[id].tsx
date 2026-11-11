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
import { BringCharacter } from '@/campfire/PhoneBuilder'

// Your Campfire character's sheet (id "new": bring one to the table, built or copied in), or,
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
  const table = useCampfire((s) => s.tables[campaignId])
  const fromTable = table?.characters.find((c) => c.id === id)
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

  if (id === 'new') return <BringCharacter campaignId={campaignId} table={table} />
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
