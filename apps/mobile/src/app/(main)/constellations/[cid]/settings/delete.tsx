import { useState } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { cx } from '@/api/constellations'
import { cxSay, refreshCards } from '@/state/constellations'
import { Text } from '@/ui/kit'
import { haptic } from '@/constellations/motion'
import { SettingsScreen, useSettingsDetail } from '@/constellations/settingsKit'
import { N, NightButton, NightField } from '@/constellations/ui'

// Deleting a constellation (Owner only): type its name to confirm.

export default function DeleteScreen() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useSettingsDetail(cid)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  if (!c) return <SettingsScreen title="Delete constellation" c={null}>{null}</SettingsScreen>
  if (!c.me.owner) {
    return (
      <SettingsScreen title="Delete constellation" c={c}>
        <Text size={14} style={{ color: N.muted }}>Only the Owner can delete {c.name}.</Text>
      </SettingsScreen>
    )
  }
  async function remove() {
    setBusy(true)
    const r = await cx.remove(c!.id, typed.trim())
    setBusy(false)
    if (!r.ok) return cxSay(r.message)
    haptic.success()
    cxSay(`${c!.name} was deleted.`)
    void refreshCards()
    router.dismissTo('/constellations')
  }
  return (
    <SettingsScreen title="Delete constellation" c={c}>
      <Text size={15} style={{ color: N.ink2, lineHeight: 22 }}>
        Deleting <Text size={15} weight="bold">{c.name}</Text> removes every nebula and all their messages and files, for everyone. It can't be undone. If you just want to step back, transfer ownership from Members instead.
      </Text>
      <NightField label={`Type ${c.name} to confirm`} value={typed} onChangeText={setTyped} autoCorrect={false} autoCapitalize="none" />
      <NightButton kind="danger" label="Delete constellation" disabled={typed.trim() !== c.name} busy={busy} onPress={() => void remove()} />
    </SettingsScreen>
  )
}
