import { memo } from 'react'
import { Pressable, View } from 'react-native'
import { onMobile, type ConversationSummary, type Presence } from '@glofly/shared'
import { ChatAvatar } from './Avatar'
import { Icon } from './icons'
import { Badge, Text } from './kit'
import { useTheme } from './theme'
import { useSocial } from '@/state/social'
import { BirthdayMark, GlowMark } from './Social'
import { callLine, chatTitle, isMuted, previewOf, typingLine, type NameOf } from '@/lib/chats'
import { listTime } from '@/lib/format'
import type { Call } from '@glofly/shared'
import { useStore } from '@/state/store'
import { useWide } from '@/lib/layout'

// One row in the Chats or Groups list, from the design canvas.

type Props = {
  chat: ConversationSummary
  meId: string
  nameOf: NameOf
  presence?: Presence
  typing?: Record<string, number>
  call?: Call
  /** Groups page: "4 members · 2 online" instead of the last message when nothing's newer. */
  subtitle?: string
  /** Given the row's chat, so lists can pass the same function every time (keeps memo working). */
  onPress: (chat: ConversationSummary) => void
  onLongPress: (chat: ConversationSummary) => void
  onJoin?: (chat: ConversationSummary) => void
  now: number
}

export const ChatRow = memo(function ChatRow({ chat, meId, nameOf, presence, typing, call, subtitle, onPress, onLongPress, onJoin, now }: Props) {
  const { c } = useTheme()
  // iPad (two panes): the chat open on the right is highlighted in the list.
  const wide = useWide()
  const open = useStore((s) => wide && s.viewing === chat.id)
  const title = chatTitle(chat)
  // 0.5.0: your glow with a friend, and a 🎂 on their birthday.
  const glow = useSocial((s) => (chat.kind === 'dm' ? s.glows[chat.partner.id] : undefined))
  const birthday = useSocial((s) => chat.kind === 'dm' && s.birthdays.includes(chat.partner.id))
  const muted = isMuted(chat, now)
  const unread = chat.unreadCount
  const mentions = chat.mentionCount ?? 0
  const typingText = typingLine(chat, typing, nameOf, now)
  const inCall = callLine(call, meId)
  const preview = previewOf(chat, meId, nameOf)
  const bold = unread > 0 && !muted
  const time = chat.lastMessage ? listTime(chat.lastMessage.createdAt) : ''
  const seen = chat.kind === 'dm' && chat.lastMessage?.senderId === meId && !!chat.partnerReadAt && chat.partnerReadAt >= chat.lastMessage.createdAt
  const label = [
    title,
    chat.kind === 'group' ? 'group' : presence?.status === 'online' ? 'online' : '',
    muted ? 'muted' : '',
    unread ? `${unread} unread` : '',
    mentions ? 'mentions you' : '',
    inCall ? inCall.text : typingText || preview.text,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Long press for more options"
      onPress={() => onPress(chat)}
      onLongPress={() => onLongPress(chat)}
      delayLongPress={350}
      android_ripple={{ color: c.line }}
      accessibilityState={open ? { selected: true } : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 9,
        paddingHorizontal: 16,
        backgroundColor: open ? c.accentSoft : pressed ? c.surface : 'transparent',
        ...(wide ? { marginHorizontal: 8, paddingHorizontal: 8, borderRadius: 14 } : {}),
      })}
    >
      <ChatAvatar chat={chat} size={54} status={chat.kind === 'dm' ? (presence?.status ?? null) : null} mobile={onMobile(presence ?? undefined)} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text numberOfLines={1} size={16} weight="bold" style={{ flexShrink: 1, fontWeight: bold ? '700' : '600' }}>
            {title}
          </Text>
          {glow ? <GlowMark glow={glow} /> : null}
          {birthday ? <BirthdayMark /> : null}
          <View style={{ flex: 1 }} />
          {muted ? <Icon name="bellOff" size={14} color={c.faint} /> : null}
          <Text size={13} weight={bold ? 'bold' : 'regular'} style={{ color: bold ? c.accentText : c.muted }}>
            {time}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22 }}>
          {inCall ? (
            <>
              <Icon name="phone" size={14} color={c.onlineText} />
              <Text size={14} weight="bold" tone="online" numberOfLines={1} style={{ flex: 1 }}>
                {inCall.text}
              </Text>
              {onJoin && !inCall.joined ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Join the call in ${title}`} onPress={() => onJoin(chat)} hitSlop={6} style={{ height: 28, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.online, justifyContent: 'center' }}>
                  <Text size={13} weight="bold" style={{ color: '#FFFFFF' }}>
                    Join
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : typingText ? (
            <Text size={14} weight="medium" tone="accent" numberOfLines={1} style={{ flex: 1 }}>
              {typingText}
            </Text>
          ) : (
            <>
              {preview.missed ? <Icon name="phone" size={14} color={c.dnd} /> : null}
              {preview.photo ? <Icon name="photo" size={15} color={c.muted} /> : null}
              {seen ? <Icon name="checkDouble" size={16} color={c.accentText} strokeWidth={2.2} /> : null}
              <Text
                size={14}
                numberOfLines={1}
                weight={bold ? 'medium' : 'regular'}
                style={{ flex: 1, color: preview.missed ? c.dnd : bold ? c.ink : c.muted }}
              >
                {subtitle && !chat.lastMessage ? subtitle : preview.text}
              </Text>
            </>
          )}
          {mentions > 0 ? <Badge count={1} mention /> : null}
          {unread > 0 ? <Badge count={unread} muted={muted} /> : null}
        </View>
      </View>
    </Pressable>
  )
})
