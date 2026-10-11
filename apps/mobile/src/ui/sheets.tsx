import { useEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { create } from 'zustand'
import type { ReportReason } from '@glofly/shared'
import * as api from '@/api/glofly'
import { pickerGroups, recentEmoji, searchEmoji, noteEmojiUsed, type PickerEmoji } from '@/lib/emoji'
import { SUPPORT_EMAIL } from '@/lib/config'
import { BottomSheet } from './dialogs'
import { Icon } from './icons'
import { Button, Checkbox, Notice, Text, webNoOutline } from './kit'
import { font, useTheme } from './theme'

// Bigger sheets with their own forms: the emoji picker and Report.

type Sheet =
  | { kind: 'emoji'; resolve: (e: string | null) => void }
  | { kind: 'report'; target: ReportTarget; resolve: (sent: boolean) => void }

export type ReportTarget = { userId: string; name: string; messageId?: string; conversationId?: string }

const useSheets = create<{ sheet: Sheet | null }>(() => ({ sheet: null }))

export function pickEmoji(): Promise<string | null> {
  return new Promise((resolve) => useSheets.setState({ sheet: { kind: 'emoji', resolve } }))
}

/** Report a message or a person. Resolves true once the report is sent. */
export function openReport(target: ReportTarget): Promise<boolean> {
  return new Promise((resolve) => useSheets.setState({ sheet: { kind: 'report', target, resolve } }))
}

export function SheetHost() {
  const sheet = useSheets((s) => s.sheet)
  if (!sheet) return null
  const close = () => useSheets.setState({ sheet: null })
  if (sheet.kind === 'emoji')
    return (
      <EmojiPicker
        onPick={(e) => {
          close()
          sheet.resolve(e)
        }}
      />
    )
  return (
    <ReportSheet
      target={sheet.target}
      onDone={(sent) => {
        close()
        sheet.resolve(sent)
      }}
    />
  )
}

function EmojiPicker({ onPick }: { onPick: (e: string | null) => void }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('recent')
  const [recent, setRecent] = useState<string[]>([])
  const groups = useMemo(() => pickerGroups(), [])
  useEffect(() => {
    void recentEmoji().then((r) => {
      setRecent(r)
      if (!r.length) setGroup('smileys')
    })
  }, [])
  const list: PickerEmoji[] = query.trim()
    ? searchEmoji(query, 120)
    : group === 'recent'
      ? recent.map((e) => ({ emoji: e, label: e, words: '' }))
      : (groups.find((g) => g.id === group)?.emoji ?? [])
  const pick = (e: string) => {
    noteEmojiUsed(e)
    onPick(e)
  }
  const tabs = [{ id: 'recent', label: 'Recently used', icon: '🕘' }, ...groups.map((g) => ({ id: g.id, label: g.label, icon: g.emoji[0]?.emoji ?? '' }))]
  return (
    <BottomSheet onClose={() => onPick(null)}>
      <View style={{ height: 460, paddingBottom: insets.bottom }}>
        <View style={{ marginHorizontal: 16, height: 48, borderRadius: 24, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8 }}>
          <Icon name="search" size={20} color={c.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search emoji"
            placeholderTextColor={c.muted}
            accessibilityLabel="Search emoji"
            style={[{ flex: 1, color: c.ink, fontFamily: font.body, fontSize: 16 }, webNoOutline]}
          />
        </View>
        {!query.trim() ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: 8 }} contentContainerStyle={{ paddingHorizontal: 12, gap: 4 }}>
            {tabs.map((t) => (
              <Pressable
                key={t.id}
                accessibilityRole="tab"
                accessibilityLabel={t.label}
                accessibilityState={{ selected: group === t.id }}
                onPress={() => setGroup(t.id)}
                style={{ width: 44, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: group === t.id ? c.accentSoft : 'transparent' }}
              >
                <Text size={22}>{t.icon}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <FlatList
          data={list}
          key={group + (query ? 'q' : '')}
          numColumns={8}
          keyExtractor={(e, i) => e.emoji + i}
          contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 6 }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Text tone="muted" style={{ textAlign: 'center', padding: 24 }}>
              {query ? 'No emoji found' : 'Emoji you use show up here.'}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" accessibilityLabel={item.label} onPress={() => pick(item.emoji)} style={{ flex: 1 / 8, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }}>
              <Text size={28}>{item.emoji}</Text>
            </Pressable>
          )}
        />
      </View>
    </BottomSheet>
  )
}

const REASONS: { key: ReportReason; label: string }[] = [
  { key: 'harassment', label: 'Harassment or bullying' },
  { key: 'spam', label: 'Spam' },
  { key: 'hate', label: 'Hate' },
  { key: 'sexual', label: 'Sexual content' },
  { key: 'violence', label: 'Violence or threats' },
  { key: 'self_harm', label: 'Self-harm' },
  { key: 'other', label: 'Something else' },
]

function ReportSheet({ target, onDone }: { target: ReportTarget; onDone: (sent: boolean) => void }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [details, setDetails] = useState('')
  const [block, setBlock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<ReportReason | null>(null)
  const first = target.name.split(/\s+/)[0]

  async function send() {
    if (!reason) return setError('Pick what’s wrong.')
    setBusy(true)
    setError(null)
    const r = await api.report({
      ...(target.messageId ? { messageId: target.messageId, conversationId: target.conversationId } : { userId: target.userId }),
      reason,
      ...(details.trim() ? { details: details.trim() } : {}),
      block,
    })
    setBusy(false)
    if (!r.ok) return setError(r.message)
    setSent(reason)
  }

  if (sent) {
    return (
      <BottomSheet onClose={() => onDone(true)}>
        <View style={{ padding: 24, paddingTop: 8, paddingBottom: insets.bottom + 20, gap: 14 }}>
          <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.onlineSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={28} color={c.onlineText} strokeWidth={2.6} />
          </View>
          <Text display size={22}>
            Thanks for telling us
          </Text>
          <Text size={15} tone="ink2" style={{ lineHeight: 22 }}>
            The Glofly team will look at it. {first} won't know you reported them.
            {block ? ` You've also blocked ${first}.` : ' If you feel unsafe, you can also block them from their profile.'}
          </Text>
          {sent === 'self_harm' ? (
            <Notice tone="info">If someone is in immediate danger, call 911. In the US you can call or text 988 to reach the Suicide & Crisis Lifeline any time.</Notice>
          ) : null}
          <Button label="Done" onPress={() => onDone(true)} />
        </View>
      </BottomSheet>
    )
  }

  return (
    <BottomSheet onClose={() => onDone(false)}>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 640 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 20, gap: 12 }}>
        <Text display size={22}>
          {target.messageId ? 'Report message' : `Report ${target.name}`}
        </Text>
        <Text size={14} tone="muted" style={{ lineHeight: 20 }}>
          What's wrong with it? Only the Glofly team sees reports. {first} isn't told.
        </Text>
        {error ? <Notice>{error}</Notice> : null}
        <View accessibilityRole="radiogroup" accessibilityLabel="Reason">
          {REASONS.map((r) => (
            <Pressable
              key={r.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: reason === r.key }}
              onPress={() => setReason(r.key)}
              style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 14 }}
            >
              <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: reason === r.key ? c.accent : c.muted, alignItems: 'center', justifyContent: 'center' }}>
                {reason === r.key ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.accent }} /> : null}
              </View>
              <Text size={16}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={details}
          onChangeText={setDetails}
          placeholder="Anything else we should know? (optional)"
          accessibilityLabel="Anything else we should know? (optional)"
          placeholderTextColor={c.faint}
          multiline
          maxLength={1000}
          style={[{ minHeight: 84, borderWidth: 1.5, borderColor: c.fieldLine, borderRadius: 12, padding: 12, color: c.ink, fontFamily: font.body, fontSize: 15, textAlignVertical: 'top' }, webNoOutline]}
        />
        <Checkbox value={block} onChange={setBlock}>
          <Text size={15}>Also block {first}</Text>
        </Checkbox>
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button label="Cancel" kind="ghost" compact onPress={() => onDone(false)} />
          <Button label="Send report" kind="danger" compact busy={busy} onPress={() => void send()} />
        </View>
        <Text size={12} tone="faint">
          Questions? {SUPPORT_EMAIL}
        </Text>
      </ScrollView>
    </BottomSheet>
  )
}
