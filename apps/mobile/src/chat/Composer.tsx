import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { Platform, Pressable, ScrollView, TextInput, View, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MESSAGE_MAX, applyFormat, type FormatAction, groupMentionSuggestions, mentionQuery, mentionSuggestions, quoteSummary, type Message, type PublicUser } from '@glofly/shared'
import type { MentionGroups } from '@/constellations/roles'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/icons'
import { Text, webNoOutline } from '@/ui/kit'
import { pickEmoji } from '@/ui/sheets'
import { font, useTheme } from '@/ui/theme'
import { MONO } from './Formatted'

// The message box: reply / edit bar, @mention suggestions, + (photos and files), emoji, and
// Send (which becomes the voice-message mic while the box is empty).

const FORMAT_BUTTONS: { action: FormatAction; label: string; glyph: string; mono?: boolean; italic?: boolean; strike?: boolean }[] = [
  { action: 'b', label: 'Bold', glyph: 'B' },
  { action: 'i', label: 'Italic', glyph: 'I', italic: true },
  { action: 's', label: 'Strikethrough', glyph: 'S', strike: true },
  { action: 'code', label: 'Code', glyph: '</>', mono: true },
  { action: 'spoiler', label: 'Spoiler', glyph: '||', mono: true },
  { action: 'quote', label: 'Quote', glyph: '❝' },
  { action: 'codeblock', label: 'Code block', glyph: '```', mono: true },
]

export type ComposerHandle = {
  focus: () => void
  setText: (t: string) => void
  clear: () => void
  /** 0.8.0 keyboard ↑: the box is focused and empty (then ↑ edits your last message). */
  emptyAndFocused: () => boolean
}

type Props = {
  placeholder: string
  people: PublicUser[]
  mentionable: boolean
  reply: Message | null
  replyName: string
  editing: Message | null
  onCancel: () => void
  onSend: (text: string) => void
  onTyping: () => void
  onAttach: () => void
  /** The voice recorder takes over the bar while recording. */
  voice?: ReactNode
  canRecord?: boolean
  recordButton?: ReactNode
  topSlot?: ReactNode
  /** Photos or files are ready, so Send works with an empty box. */
  canSendEmpty?: boolean
  /** 0.7.3: hold Send to send the text later (the box keeps it until it's scheduled) */
  onSendLater?: (text: string) => void
  /** 0.8.0 keyboard shortcuts: the box gained or lost focus, or became empty / not empty */
  onKeyState?: (s: { focused: boolean; empty: boolean }) => void
  /** Communities round (nebulas): the constellation's slash commands, offered while typing "/" */
  commands?: { name: string; description: string; bot: { displayName: string } }[]
  /** 4.2 (nebulas, board 30): @everyone, @here and roles, offered above people */
  groups?: MentionGroups
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { placeholder, people, mentionable, reply, replyName, editing, onCancel, onSend, onTyping, onAttach, voice, recordButton, topSlot, canSendEmpty, onSendLater, onKeyState, commands, groups },
  ref,
) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const [text, setText] = useState('')
  const [selection, setSelectionState] = useState({ start: 0, end: 0 })
  // Only set while moving the cursor ourselves (after a mention or emoji); otherwise the box owns it.
  const [forced, setForced] = useState<{ start: number; end: number } | undefined>(undefined)
  const setSelection = (s: { start: number; end: number }) => {
    setSelectionState(s)
    setForced(s)
  }
  const input = useRef<TextInput>(null)
  const [focused, setFocused] = useState(false)
  const empty = text.length === 0
  const keyState = useRef({ focused: false, empty: true })
  useEffect(() => {
    if (keyState.current.focused === focused && keyState.current.empty === empty) return
    keyState.current = { focused, empty }
    onKeyState?.({ focused, empty })
  }, [focused, empty, onKeyState])

  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    setText: (t) => {
      setText(t)
      setSelection({ start: t.length, end: t.length })
    },
    clear: () => {
      setText('')
      setSelection({ start: 0, end: 0 })
    },
    emptyAndFocused: () => keyState.current.focused && keyState.current.empty,
  }))

  const query = mentionable ? mentionQuery(text, selection.start) : null
  const suggestions = query ? mentionSuggestions(query.query, people) : []
  const groupChoices = query && groups ? groupMentionSuggestions(query.query, groups.roles, groups.canEveryone, 5) : []
  const commandMatches = commands?.length && !editing && /^\/[a-z0-9-]*$/i.test(text) ? commands.filter((x) => x.name.startsWith(text.slice(1).toLowerCase())).slice(0, 6) : []
  function pickCommand(name: string) {
    const next = `/${name} `
    setText(next)
    setSelection({ start: next.length, end: next.length })
    input.current?.focus()
  }

  function insertMention(p: PublicUser | string) {
    if (!query) return
    const word = typeof p === 'string' ? p : p.username
    const before = text.slice(0, query.start)
    const after = text.slice(selection.start)
    const next = `${before}@${word} ${after}`
    setText(next)
    const at = before.length + word.length + 2
    setSelection({ start: at, end: at })
  }

  async function addEmoji() {
    const e = await pickEmoji()
    if (!e) return
    const next = text.slice(0, selection.start) + e + text.slice(selection.end)
    setText(next)
    const at = selection.start + e.length
    setSelection({ start: at, end: at })
    input.current?.focus()
  }

  function send() {
    const body = text.trim()
    if (!body && !canSendEmpty) return
    onSend(body)
    setText('')
    setSelection({ start: 0, end: 0 })
  }

  const showSend = text.trim().length > 0 || !!editing || !!canSendEmpty || !recordButton

  return (
    <View style={{ backgroundColor: c.barBg, borderTopWidth: 0.5, borderTopColor: c.line, paddingHorizontal: 10, paddingTop: 6, paddingBottom: Math.max(insets.bottom, 8) + 4, gap: 8 }}>
      {topSlot}
      {commandMatches.length ? (
        <View accessibilityLabel="Commands" style={{ borderRadius: 16, backgroundColor: c.sheet, borderWidth: 1, borderColor: c.line, overflow: 'hidden' }}>
          {commandMatches.map((x) => (
            <Pressable key={x.name} accessibilityRole="button" accessibilityLabel={`/${x.name}: ${x.description}`} onPress={() => pickCommand(x.name)} android_ripple={{ color: c.line }} style={{ paddingHorizontal: 14, paddingVertical: 9, gap: 1 }}>
              <Text size={15} weight="bold">
                /{x.name}
              </Text>
              <Text size={13} tone="muted" numberOfLines={1}>
                {x.description} · {x.bot.displayName}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {suggestions.length || groupChoices.length ? (
        <View accessibilityLabel="People to mention" style={{ borderRadius: 16, backgroundColor: c.sheet, borderWidth: 1, borderColor: c.line, overflow: 'hidden', maxHeight: 240 }}>
          <ScrollView keyboardShouldPersistTaps="always">
            {groupChoices.map((g) => {
              const word = g.kind === 'role' ? g.role.name : g.kind
              const what =
                g.kind === 'role'
                  ? `${g.role.count} ${g.role.count === 1 ? 'person' : 'people'}`
                  : g.kind === 'everyone'
                    ? `All ${people.length} here`
                    : `${people.filter((p) => groups!.onlineIds.includes(p.id)).length} online`
              return (
                <Pressable key={g.kind === 'role' ? g.role.id : g.kind} accessibilityRole="button" accessibilityLabel={`Mention @${word}, ${what}`} onPress={() => insertMention(word)} android_ripple={{ color: c.line }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
                  <Text size={16} weight="bold" numberOfLines={1} style={{ width: 110, color: g.kind === 'role' ? g.role.color : '#ffb347' }}>
                    @{word}
                  </Text>
                  <Text size={13} tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                    {what}
                  </Text>
                </Pressable>
              )
            })}
            {suggestions.map((p) => (
              <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`Mention ${p.displayName}`} onPress={() => insertMention(p)} android_ripple={{ color: c.line }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                <Avatar user={p} size={32} />
                <Text size={15} weight="bold">
                  {p.displayName}
                </Text>
                <Text size={14} tone="muted">
                  @{p.username}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {reply || editing ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 6, paddingLeft: 8, paddingRight: 4 }}>
          <Icon name={editing ? 'pencil' : 'reply'} size={18} color={c.accentText} />
          <View style={{ flex: 1, minWidth: 0, borderLeftWidth: 3, borderLeftColor: c.accent, paddingLeft: 10 }}>
            <Text size={13} weight="bold" tone="accent">
              {editing ? 'Editing message' : `Replying to ${replyName}`}
            </Text>
            <Text size={13} tone="muted" numberOfLines={1}>
              {editing ? editing.body : reply ? [reply.attachments[0] ? quoteSummary({ kind: reply.attachments[0].kind, name: reply.attachments[0].name, count: reply.attachments.length, voice: !!reply.attachments[0].voice }) : '', reply.body].filter(Boolean).join(' · ') : ''}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editing ? 'Cancel editing' : 'Cancel reply'}
            onPress={() => {
              if (editing) setText('')
              onCancel()
            }}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="close" size={16} color={c.muted} strokeWidth={2.4} />
          </Pressable>
        </View>
      ) : null}
      {focused && !voice && selection.end > selection.start ? (
        <View accessibilityRole="toolbar" accessibilityLabel="Formatting" style={{ flexDirection: 'row', alignSelf: 'flex-start', gap: 2, padding: 4, marginBottom: 6, marginLeft: 50, borderRadius: 12, backgroundColor: '#1C1210' }}>
          {FORMAT_BUTTONS.map((b) => (
            <Pressable
              key={b.action}
              accessibilityRole="button"
              accessibilityLabel={b.label}
              onPress={() => {
                const next = applyFormat(text, selection.start, selection.end, b.action)
                setText(next.text)
                setSelection({ start: next.start, end: next.end })
              }}
              style={({ pressed }) => ({ minWidth: 40, height: 40, paddingHorizontal: 6, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? '#3A2A22' : 'transparent' })}
            >
              <Text size={b.mono ? 12 : 16} weight="bold" style={{ color: '#F5EDE6', fontFamily: b.mono ? MONO : undefined, fontStyle: b.italic ? 'italic' : 'normal', textDecorationLine: b.strike ? 'line-through' : 'none' }}>
                {b.glyph}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: voice ? 'center' : 'flex-end', gap: 6 }}>
        {voice ? (
          <View style={{ flex: 1, minWidth: 0 }}>{voice}</View>
        ) : (
          <>
          {!editing ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Add photos or files" onPress={onAttach} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="plus" size={22} color={c.ink2} strokeWidth={2.2} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'flex-end', paddingLeft: 14, paddingRight: 4, borderWidth: 1.5, borderColor: c.fieldLine, borderRadius: 22, backgroundColor: c.field }}>
            <TextInput
              ref={input}
              value={text}
              onChangeText={(t) => {
                // Typing at the end keeps the cursor at the end (the selection event can lag behind).
                if (selection.start >= text.length) setSelectionState({ start: t.length, end: t.length })
                setText(t)
                if (t) onTyping()
              }}
              selection={forced}
              onSelectionChange={(e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
                setSelectionState(e.nativeEvent.selection)
                if (forced) setForced(undefined)
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={placeholder}
              placeholderTextColor={c.faint}
              accessibilityLabel={placeholder}
              selectionColor={c.accent}
              multiline
              {...(Platform.OS === 'web' ? { rows: 1 } : {})}
              maxLength={MESSAGE_MAX}
              style={[{ flex: 1, minHeight: 40, maxHeight: 140, paddingTop: 10, paddingBottom: 10, color: c.ink, fontFamily: font.body, fontSize: 16 }, webNoOutline]}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Emoji" onPress={() => void addEmoji()} style={{ width: 38, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="emoji" size={22} color={c.muted} strokeWidth={1.9} />
            </Pressable>
          </View>
          </>
        )}
        {!voice && showSend ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Save edit' : 'Send'}
              accessibilityHint={onSendLater && !editing && text.trim() ? 'Hold to send it later' : undefined}
              onPress={send}
              onLongPress={onSendLater && !editing && text.trim() ? () => onSendLater(text.trim()) : undefined}
              delayLongPress={450}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 16px ${c.glow}` }}
            >
              <Icon name={editing ? 'check' : 'send'} size={20} color={c.accentInk} strokeWidth={2.2} />
            </Pressable>
        ) : (
          recordButton
        )}
      </View>
    </View>
  )
})
