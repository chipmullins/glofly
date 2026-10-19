import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SCHEDULE_MIN_MS, attachmentSummary, sendLaterChoices, shortBody, type Message, type PinnedMessage, type ScheduledMessage } from '@glofly/shared'
import { request } from '@/api/http'
import { onLive } from '@/api/realtime'
import { holdUnread, refreshConversations } from '@/state/sync'
import { BottomSheet, confirm, inform } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Button, Field, Notice, Text } from '@/ui/kit'
import { TimePicker, hhmm } from '@/ui/TimePicker'
import { useTheme } from '@/ui/theme'

// 0.7.3 in a chat (DMs, groups, nebulas): pinned messages, mark as unread, and send later.

// ---------------------------------------------------------------------------------------------
// Pins

export function usePins(conversationId: string) {
  const [pins, setPins] = useState<PinnedMessage[]>([])
  const [canPin, setCanPin] = useState(false)
  const load = useCallback(() => {
    void request<{ pins: PinnedMessage[]; canPin: boolean }>('GET', `/conversations/${conversationId}/pins`).then((r) => {
      if (r.ok) {
        setPins(r.data.pins)
        setCanPin(r.data.canPin)
      }
    })
  }, [conversationId])
  useEffect(() => {
    setPins([])
    load()
    return onLive((event, payload) => {
      if (event === 'pins:changed' && payload === conversationId) load()
      if (event === 'connected') load()
    })
  }, [conversationId, load])
  const isPinned = (messageId: string) => pins.some((p) => p.message.id === messageId)
  async function setPinned(m: Message, pin: boolean) {
    const r = await request<{ pins: PinnedMessage[] }>(pin ? 'POST' : 'DELETE', `/conversations/${conversationId}/messages/${m.id}/pin`)
    if (r.ok) setPins(r.data.pins)
    else void inform(pin ? "Couldn't pin it" : "Couldn't unpin it", r.message)
  }
  return { pins, canPin, isPinned, setPinned }
}

const textOf = (m: Message) => (shortBody(m.body) || attachmentSummary(m.attachments) || 'Message').replace(/\s+/g, ' ')

/** "📌 Game night is Friday… · 3 pinned": under the chat's header while there are pins. */
export function PinnedBar({ pins, onOpen, night }: { pins: PinnedMessage[]; onOpen: () => void; night?: boolean }) {
  const { c } = useTheme()
  if (!pins.length) return null
  const latest = pins[0]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${pins.length} pinned message${pins.length === 1 ? '' : 's'}. Show them`}
      onPress={onOpen}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 16,
        paddingVertical: 9,
        backgroundColor: night ? 'rgba(42,28,23,0.96)' : c.surface,
        borderBottomWidth: 0.5,
        borderBottomColor: c.line,
      }}
    >
      <Icon name="pin" size={16} color={c.accent} />
      <Text size={14} numberOfLines={1} style={{ flex: 1 }}>
        {textOf(latest.message)}
      </Text>
      {pins.length > 1 ? (
        <Text size={12} weight="bold" tone="muted">
          {pins.length} pinned
        </Text>
      ) : null}
      <Icon name="chevronRight" size={16} color={c.faint} />
    </Pressable>
  )
}

export function PinsSheet({
  pins,
  canPin,
  nameOf,
  onJump,
  onUnpin,
  onClose,
}: {
  pins: PinnedMessage[]
  canPin: boolean
  nameOf: (userId: string) => string
  onJump: (messageId: string) => void
  onUnpin: (m: Message) => void
  onClose: () => void
}) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <BottomSheet onClose={onClose}>
      <View style={{ paddingBottom: insets.bottom + 12, maxHeight: 560 }}>
        <Text display size={22} style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
          Pinned messages
        </Text>
        {!pins.length ? (
          <Text tone="muted" style={{ paddingHorizontal: 24, paddingVertical: 12 }}>
            Nothing pinned. Long-press a message and choose Pin.
          </Text>
        ) : null}
        <ScrollView>
          {pins.map((p) => (
            <View
              key={p.message.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingLeft: 24,
                paddingRight: 12,
                borderTopWidth: 0.5,
                borderTopColor: c.line,
              }}
            >
              <Pressable accessibilityRole="button" accessibilityHint="Shows it in the chat" onPress={() => onJump(p.message.id)} style={{ flex: 1, minWidth: 0, paddingVertical: 12, gap: 2 }}>
                <Text size={13} weight="bold" tone="accent">
                  {nameOf(p.message.senderId)} ·{' '}
                  {new Date(p.message.createdAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </Text>
                <Text size={15} numberOfLines={3}>
                  {textOf(p.message)}
                </Text>
              </Pressable>
              {canPin ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Unpin"
                  onPress={() => onUnpin(p.message)}
                  style={{
                    width: 44,
                    height: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="unpin" size={20} color={c.muted} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </View>
    </BottomSheet>
  )
}

// ---------------------------------------------------------------------------------------------
// Mark as unread

/** From this message on counts as unread again (for you). The chat closes so it isn't read again. */
export async function markUnread(conversationId: string, m: Message): Promise<boolean> {
  holdUnread(conversationId)
  const r = await request('POST', `/conversations/${conversationId}/unread`, {
    messageId: m.id,
  })
  if (!r.ok) {
    void inform("Couldn't mark it unread", r.message)
    return false
  }
  await refreshConversations()
  return true
}

// ---------------------------------------------------------------------------------------------
// Send later

/** "Tomorrow, 9:00 AM" / "Wed, Oct 21, 1:00 PM" */
export function whenLabel(at: Date, now = new Date()): string {
  const time = at.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  const diff = Math.round((new Date(at).setHours(0, 0, 0, 0) - day.getTime()) / 86400000)
  if (diff === 0) return `Today, ${time}`
  if (diff === 1) return `Tomorrow, ${time}`
  return `${at.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`
}

export function useScheduled(conversationId: string) {
  const [items, setItems] = useState<ScheduledMessage[]>([])
  const load = useCallback(() => {
    void request<{ scheduled: ScheduledMessage[] }>('GET', `/conversations/${conversationId}/scheduled`).then((r) => r.ok && setItems(r.data.scheduled))
  }, [conversationId])
  useEffect(() => {
    setItems([])
    load()
    return onLive((event, payload) => {
      if (event === 'scheduled:changed' && payload === conversationId) load()
      if (event === 'connected') load()
    })
  }, [conversationId, load])
  async function schedule(body: string, at: Date, replyToId?: string | null): Promise<boolean> {
    const r = await request<{ scheduled: ScheduledMessage }>('POST', `/conversations/${conversationId}/scheduled`, { body, sendAt: at.toISOString(), replyToId: replyToId ?? undefined })
    if (!r.ok) {
      void inform("Couldn't schedule it", r.message)
      return false
    }
    load()
    return true
  }
  return { items, load, schedule }
}

/** The day chips + time for "Pick a date & time". */
function DayTimePicker({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const { c } = useTheme()
  const days = Array.from({ length: 8 }, (_, i) => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + i)
    return d
  })
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  return (
    <View style={{ gap: 18 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {days.map((d, i) => {
          const on = sameDay(d, value)
          const label =
            i === 0
              ? 'Today'
              : i === 1
                ? 'Tomorrow'
                : d.toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })
          return (
            <Pressable
              key={d.toISOString()}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => {
                const next = new Date(d)
                next.setHours(value.getHours(), value.getMinutes(), 0, 0)
                onChange(next)
              }}
              style={{
                height: 40,
                paddingHorizontal: 14,
                borderRadius: 20,
                backgroundColor: on ? c.accent : c.surface,
                justifyContent: 'center',
              }}
            >
              <Text size={14} weight="bold" style={{ color: on ? c.accentInk : c.ink }}>
                {label}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
      <TimePicker
        value={hhmm(value.getHours(), value.getMinutes())}
        onChange={(v) => {
          const [h, m] = v.split(':').map(Number)
          const next = new Date(value)
          next.setHours(h, m, 0, 0)
          onChange(next)
        }}
      />
    </View>
  )
}

const defaultCustom = () => {
  const d = new Date(Date.now() + 60 * 60 * 1000)
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0)
  return d
}

/** Hold Send: when should it go? */
export function SendLaterSheet({ preview, onPick, onClose }: { preview?: string; onPick: (at: Date) => void; onClose: () => void }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const [custom, setCustom] = useState<Date | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const now = new Date()
  return (
    <BottomSheet onClose={onClose}>
      <View
        style={{
          paddingHorizontal: 24,
          paddingBottom: insets.bottom + 16,
          gap: 12,
        }}
      >
        <Text display size={22}>
          Send later
        </Text>
        {preview ? (
          <Text size={14} tone="muted" numberOfLines={2}>
            “{preview}”
          </Text>
        ) : null}
        {custom ? (
          <>
            <DayTimePicker value={custom} onChange={setCustom} />
            {problem ? <Notice>{problem}</Notice> : null}
            <Button
              label={`Send ${whenLabel(custom)}`}
              onPress={() => {
                if (custom.getTime() < Date.now() + SCHEDULE_MIN_MS) return setProblem('Pick a time at least a minute from now.')
                onPick(custom)
              }}
            />
            <Button label="Back" kind="ghost" onPress={() => setCustom(null)} />
          </>
        ) : (
          <View>
            {sendLaterChoices(now).map((ch) => (
              <Pressable
                key={ch.label}
                accessibilityRole="button"
                onPress={() => onPick(ch.at)}
                android_ripple={{ color: c.line }}
                style={{
                  minHeight: 52,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 16,
                  borderBottomWidth: 0.5,
                  borderBottomColor: c.line,
                }}
              >
                <Icon name="clock" size={20} color={c.ink2} />
                <Text size={16} style={{ flex: 1 }}>
                  {ch.label}
                </Text>
                {/* Only where the label doesn't already say when ("In 1 hour", which Monday) */}
                {ch.label.startsWith('In ') || ch.label.startsWith('Monday') ? (
                  <Text size={13} tone="muted">
                    {ch.label.startsWith('In ') ? whenLabel(ch.at, now) : ch.at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </Text>
                ) : null}
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => setCustom(defaultCustom())}
              style={{
                minHeight: 52,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 16,
              }}
            >
              <Icon name="edit" size={20} color={c.ink2} />
              <Text size={16} tone="accent" weight="bold">
                Pick a date & time
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </BottomSheet>
  )
}

/** "🕓 2 scheduled": above the message box while you have messages waiting in this chat. */
export function ScheduledStrip({ items, onOpen }: { items: ScheduledMessage[]; onOpen: () => void }) {
  const { c } = useTheme()
  if (!items.length) return null
  const failed = items.some((i) => i.failed)
  const next = items.find((i) => !i.failed)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${items.length} scheduled message${items.length === 1 ? '' : 's'}. Show them`}
      onPress={onOpen}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        height: 36,
        borderRadius: 18,
        backgroundColor: failed ? c.dangerSoft : c.surface,
      }}
    >
      <Icon name="clock" size={16} color={failed ? c.danger : c.accent} />
      <Text size={13} weight="bold" tone={failed ? 'danger' : 'ink'} style={{ flex: 1 }} numberOfLines={1}>
        {failed ? "A scheduled message couldn't be sent" : `${items.length} scheduled${next ? ` · next ${whenLabel(new Date(next.sendAt))}` : ''}`}
      </Text>
      <Icon name="chevronRight" size={16} color={c.faint} />
    </Pressable>
  )
}

export function ScheduledSheet({ conversationId, items, onChanged, onClose }: { conversationId: string; items: ScheduledMessage[]; onChanged: () => void; onClose: () => void }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [timing, setTiming] = useState<ScheduledMessage | null>(null)
  const base = `/conversations/${conversationId}/scheduled`

  async function patch(id: string, body: Record<string, unknown>) {
    const r = await request('PATCH', `${base}/${id}`, body)
    if (!r.ok) void inform("Couldn't change it", r.message)
    onChanged()
  }
  async function sendNow(s: ScheduledMessage) {
    const r = await request('POST', `${base}/${s.id}/send`)
    if (!r.ok) void inform("Couldn't send it", r.message)
    onChanged()
  }
  async function remove(s: ScheduledMessage) {
    if (
      !(await confirm({
        title: 'Delete this scheduled message?',
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return
    const r = await request('DELETE', `${base}/${s.id}`)
    if (!r.ok) void inform("Couldn't delete it", r.message)
    onChanged()
  }

  if (timing)
    return (
      <SendLaterSheet
        preview={timing.body}
        onClose={() => setTiming(null)}
        onPick={(at) => {
          const id = timing.id
          setTiming(null)
          void patch(id, { sendAt: at.toISOString() })
        }}
      />
    )

  return (
    <BottomSheet onClose={onClose}>
      <View style={{ paddingBottom: insets.bottom + 12, maxHeight: 600 }}>
        <Text display size={22} style={{ paddingHorizontal: 24, paddingBottom: 4 }}>
          Scheduled messages
        </Text>
        <Text size={13} tone="muted" style={{ paddingHorizontal: 24, paddingBottom: 8 }}>
          Only you can see these until they're sent.
        </Text>
        {!items.length ? (
          <Text tone="muted" style={{ paddingHorizontal: 24, paddingVertical: 12 }}>
            Nothing scheduled. Hold the Send button to send a message later.
          </Text>
        ) : null}
        <ScrollView keyboardShouldPersistTaps="handled">
          {items.map((s) => (
            <View
              key={s.id}
              style={{
                paddingHorizontal: 24,
                paddingVertical: 12,
                gap: 8,
                borderTopWidth: 0.5,
                borderTopColor: c.line,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon name="clock" size={14} color={s.failed ? c.danger : c.accent} />
                <Text size={13} weight="bold" tone={s.failed ? 'danger' : 'accent'}>
                  {s.failed ? `Not sent: ${s.failed}` : whenLabel(new Date(s.sendAt))}
                </Text>
              </View>
              {editing?.id === s.id ? (
                <>
                  <Field value={editing.text} onChangeText={(t) => setEditing({ id: s.id, text: t })} multiline autoFocus accessibilityLabel="Message" />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button
                      label="Save"
                      compact
                      disabled={!editing.text.trim()}
                      onPress={() => {
                        const t = editing.text.trim()
                        setEditing(null)
                        void patch(s.id, { body: t })
                      }}
                    />
                    <Button label="Cancel" compact kind="ghost" onPress={() => setEditing(null)} />
                  </View>
                </>
              ) : (
                <Text size={15}>{s.body}</Text>
              )}
              {editing?.id !== s.id ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Button label="Send now" compact icon="send" onPress={() => void sendNow(s)} />
                  <Button label="Change time" compact kind="secondary" onPress={() => setTiming(s)} />
                  <Button label="Edit" compact kind="secondary" onPress={() => setEditing({ id: s.id, text: s.body })} />
                  <Button label="Delete" compact kind="ghost" onPress={() => void remove(s)} />
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </View>
    </BottomSheet>
  )
}
