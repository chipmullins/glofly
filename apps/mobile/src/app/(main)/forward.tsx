import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import type { ConstellationColor } from '@glofly/shared'
import { forwardMessage, forwardTargets, type ForwardTarget } from '@/api/glofly'
import { ConstellationIcon } from '@/constellations/ui'
import { Avatar } from '@/ui/Avatar'
import { inform } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Text, webNoOutline } from '@/ui/kit'
import { Screen } from '@/ui/Screen'
import { font, useTheme } from '@/ui/theme'

// 0.9.3 Forward a message (approved board 1, as a phone screen): the message, a search, recent
// chats, groups and nebulas with checkboxes (up to 5), an optional note, then Forward.

const MAX = 5

export default function Forward() {
  const { c } = useTheme()
  const params = useLocalSearchParams<{ mid: string; from?: string; text?: string }>()
  const [targets, setTargets] = useState<ForwardTarget[] | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    void forwardTargets().then((r) => {
      if (r.ok) setTargets(r.data)
      else setProblem(r.message ?? "Couldn't load your chats.")
    })
  }, [])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^[@#]/, '')
    if (!q) return targets ?? []
    return (targets ?? []).filter((t) => [t.title, t.subtitle ?? ''].some((s) => s.toLowerCase().replace(/^[@#]/, '').includes(q)))
  }, [targets, query])

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX ? p : [...p, id]))

  async function send() {
    if (!picked.length || busy || !params.mid) return
    setBusy(true)
    setProblem(null)
    const r = await forwardMessage(params.mid, picked, note)
    setBusy(false)
    if (!r.ok) return setProblem(r.message ?? "Couldn't forward it.")
    if (!r.data.sent.length) return setProblem(r.data.failed[0]?.reason ?? "Couldn't forward it.")
    router.back()
    if (r.data.failed.length) {
      const name = targets?.find((t) => t.conversationId === r.data.failed[0].conversationId)?.title ?? 'one place'
      void inform(`Forwarded to ${r.data.sent.length}`, `Not sent to ${name}: ${r.data.failed[0].reason}`)
    }
  }

  const field = [{ height: 44, borderRadius: 12, borderWidth: 1, borderColor: c.fieldLine, backgroundColor: c.field, paddingHorizontal: 12, color: c.ink, fontFamily: font.body, fontSize: 16 }, webNoOutline]

  return (
    <Screen title="Forward message" scroll={false}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ padding: 12, borderRadius: 14, backgroundColor: c.surface, gap: 4 }}>
          <Text size={12} weight="bold" tone="muted" style={{ letterSpacing: 0.6 }}>
            {`FROM ${(params.from ?? 'SOMEONE').toUpperCase()}`}
          </Text>
          <Text size={15} numberOfLines={4}>
            {params.text ?? ''}
          </Text>
        </View>
        <TextInput value={query} onChangeText={setQuery} placeholder="Search people, groups and nebulas" placeholderTextColor={c.faint} accessibilityLabel="Search people, groups and nebulas" autoCorrect={false} style={field} />
        <View style={{ gap: 2 }}>
          {!query ? (
            <Text size={12} weight="bold" tone="muted" style={{ letterSpacing: 0.6, paddingHorizontal: 4, paddingBottom: 4 }}>
              RECENT
            </Text>
          ) : null}
          {targets === null && !problem ? <ActivityIndicator color={c.accent} style={{ padding: 20 }} /> : null}
          {targets !== null && shown.length === 0 ? (
            <Text size={14} tone="muted" style={{ padding: 12 }}>
              {query ? `Nothing matches “${query}”.` : 'No chats to forward to yet.'}
            </Text>
          ) : null}
          {shown.map((t) => {
            const on = picked.includes(t.conversationId)
            const full = !on && picked.length >= MAX
            return (
              <Pressable
                key={t.conversationId}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: full }}
                accessibilityLabel={`${t.title}${t.subtitle ? `, ${t.subtitle}` : ''}`}
                disabled={full}
                onPress={() => toggle(t.conversationId)}
                style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, borderRadius: 12, backgroundColor: on ? c.accentSoft : 'transparent', opacity: full ? 0.5 : 1 }}
              >
                <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: on ? c.accent : c.fieldLine, backgroundColor: on ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {on ? <Icon name="check" size={14} color={c.accentInk} strokeWidth={3} /> : null}
                </View>
                {t.kind === 'dm' && t.userId ? (
                  <Avatar user={{ id: t.userId, displayName: t.title, avatarVersion: t.avatarVersion }} size={38} />
                ) : t.kind === 'nebula' && t.constellationId ? (
                  <ConstellationIcon c={{ id: t.constellationId, name: t.subtitle ?? t.title, color: (t.color ?? 'violet') as ConstellationColor, iconVersion: t.iconVersion }} size={38} radius={12} />
                ) : (
                  <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="groups" size={20} color={c.ink2} />
                  </View>
                )}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text size={15} weight="bold" numberOfLines={1}>
                    {t.title}
                  </Text>
                  {t.subtitle ? (
                    <Text size={13} tone="muted" numberOfLines={1}>
                      {t.subtitle}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            )
          })}
        </View>
        <TextInput value={note} onChangeText={setNote} placeholder="Add a note (optional)" placeholderTextColor={c.faint} accessibilityLabel="Add a note (optional)" maxLength={4000} style={field} />
        {problem ? (
          <Text size={14} tone="danger" accessibilityRole="alert">
            {problem}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text size={13} tone="muted" style={{ flex: 1 }}>
            {picked.length ? `Sending to ${picked.length} of up to ${MAX}` : `Pick up to ${MAX}`}
          </Text>
          <Pressable accessibilityRole="button" disabled={!picked.length || busy} onPress={() => void send()} style={{ minHeight: 46, paddingHorizontal: 22, borderRadius: 23, backgroundColor: c.accent, opacity: !picked.length || busy ? 0.5 : 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text size={15} weight="bold" style={{ color: c.accentInk }}>
              {busy ? 'Forwarding…' : 'Forward'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  )
}
