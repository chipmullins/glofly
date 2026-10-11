import { useState } from 'react'
import { View } from 'react-native'
import { router } from 'expo-router'
import { GROUP_MAX, GROUP_NAME_MAX } from '@glofly/shared'
import * as api from '@/api/glofly'
import { upsertConversation } from '@/state/store'
import { FriendPicker } from '@/ui/FriendPicker'
import { Button, Field, Notice, Text } from '@/ui/kit'
import { Screen } from '@/ui/Screen'

// New group chat: pick 2+ friends (up to 25 people including you), optional name.

export default function NewGroup() {
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    const r = await api.createGroup(picked, name.trim() || undefined)
    setBusy(false)
    if (!r.ok) return setError(r.message)
    upsertConversation(r.data)
    router.replace({ pathname: '/chat/[id]', params: { id: r.data.id } })
  }

  return (
    <Screen title="New group" scroll={false}>
      <View style={{ flex: 1 }}>
        <FriendPicker
          selected={picked}
          onToggle={(f) => setPicked((p) => (p.includes(f.id) ? p.filter((x) => x !== f.id) : p.length >= GROUP_MAX - 1 ? p : [...p, f.id]))}
          header={
            <View style={{ gap: 10 }}>
              {error ? <Notice>{error}</Notice> : null}
              <Field label="Group name (optional)" value={name} onChangeText={setName} maxLength={GROUP_NAME_MAX} placeholder="Friday Squad" />
              <Text size={13} tone="muted">
                Pick at least 2 friends · {picked.length} picked
              </Text>
            </View>
          }
        />
      </View>
      <View style={{ padding: 16 }}>
        <Button label={picked.length < 2 ? 'Pick at least 2 friends' : `Start group (${picked.length + 1} people)`} disabled={picked.length < 2} busy={busy} onPress={() => void create()} />
      </View>
    </Screen>
  )
}
