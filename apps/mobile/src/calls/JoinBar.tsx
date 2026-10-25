import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { Call, PublicUser } from '@glofly/shared'
import { firstName } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import { Avatar } from '@/ui/Avatar'
import { BottomSheet } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Button, Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'

// 0.8.3: a group has a call going and you're not in it. Shows who's in it (faces and names) before
// you join; tap it for the whole list, including who's being rung. Like desktop's join bar.

type Who = { person: PublicUser; state: 'joined' | 'ringing' }

/** Who is in the call (and being rung right now), from the call's members and the chat's people. */
export function callPeople(call: Call, people: PublicUser[], now: number): Who[] {
  const out: Who[] = []
  for (const m of call.members) {
    const ringing = m.state === 'ringing' && !!m.ringingUntil && new Date(m.ringingUntil).getTime() > now
    if (m.state !== 'joined' && !ringing) continue
    const person = people.find((p) => p.id === m.userId)
    if (person) out.push({ person, state: m.state === 'joined' ? 'joined' : 'ringing' })
  }
  return out
}

export function JoinBar({ call, people, onJoin, busy }: { call: Call; people: PublicUser[]; onJoin: (video: boolean) => void; busy?: boolean }) {
  const { c } = useTheme()
  const now = useNow(5000)
  const [open, setOpen] = useState(false)
  const who = callPeople(call, people, now)
  const joined = who.filter((w) => w.state === 'joined')
  const names = joined.map((w) => firstName(w.person.displayName))
  const line = names.length === 0 ? 'Starting…' : `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`
  const kind = call.video ? 'Video call' : 'Voice call'
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: c.barBg, borderBottomWidth: 0.5, borderBottomColor: c.line }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${kind}, ${joined.length} in it: ${names.join(', ') || 'starting'}. Show everyone`}
          onPress={() => setOpen(true)}
          style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.online }} />
          <View style={{ flexDirection: 'row' }}>
            {joined.slice(0, 4).map((w, i) => (
              <View key={w.person.id} style={{ marginLeft: i ? -8 : 0, borderRadius: 16, borderWidth: 2, borderColor: c.barBg }}>
                <Avatar user={w.person} size={28} />
              </View>
            ))}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text size={13} weight="bold" numberOfLines={1}>
              {kind} · {joined.length} of {call.members.length} in
            </Text>
            <Text size={13} tone="muted" numberOfLines={1}>
              {line}
            </Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Join with your microphone"
          disabled={busy}
          onPress={() => onJoin(false)}
          style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: c.online, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: busy ? 0.5 : 1 }}
        >
          <Icon name="phone" size={16} color="#FFFFFF" />
          <Text size={14} weight="bold" style={{ color: '#FFFFFF' }}>
            Join
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Join with your camera on"
          disabled={busy}
          onPress={() => onJoin(true)}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.online, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.5 : 1 }}
        >
          <Icon name="video" size={18} color="#FFFFFF" />
        </Pressable>
      </View>
      {open ? (
        <BottomSheet onClose={() => setOpen(false)}>
          <View style={{ paddingHorizontal: 20, paddingBottom: 12, gap: 4 }}>
            <Text display size={20}>
              {kind}
            </Text>
            <Text size={14} tone="muted">
              {joined.length === 1 ? '1 person is in it' : `${joined.length} people are in it`}
            </Text>
          </View>
          <ScrollView style={{ maxHeight: 360 }}>
            {who.map((w) => (
              <View key={w.person.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, minHeight: 52 }}>
                <Avatar user={w.person} size={36} />
                <Text size={16} style={{ flex: 1 }} numberOfLines={1}>
                  {w.person.displayName}
                </Text>
                <Text size={13} tone={w.state === 'joined' ? 'accent' : 'muted'} weight="bold">
                  {w.state === 'joined' ? 'In the call' : 'Ringing…'}
                </Text>
              </View>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, padding: 20 }}>
            <Button
              label="Join"
              icon="phone"
              style={{ flex: 1 }}
              disabled={busy}
              onPress={() => {
                setOpen(false)
                onJoin(false)
              }}
            />
            <Button
              label="Join with video"
              icon="video"
              kind="secondary"
              style={{ flex: 1 }}
              disabled={busy}
              onPress={() => {
                setOpen(false)
                onJoin(true)
              }}
            />
          </View>
        </BottomSheet>
      ) : null}
    </>
  )
}
