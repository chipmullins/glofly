import { memo, type ReactNode } from 'react'
import { Animated, Linking, Pressable, View } from 'react-native'
import { clockTime, eventText, quoteSummary, shortBody, splitMentions, type Message, type PublicUser } from '@glofly/shared'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { SwipeTime } from './SwipeTime'
import { useTheme } from '@/ui/theme'
import { Rise } from '@/ui/motion'
import { isJumbo } from '@/lib/emoji'
import { firstName } from '@/lib/format'
import { Attachments } from './Attachments'
import { GameCard, GifView, LanternTag, LinkCard, PollCard, useLanternFade } from './Extras'
import { InviteCard, inviteCodeIn } from '@/constellations/community'

// One message in a chat, drawn like the design canvas: bubbles (yours in Glow Orange), reply
// quotes, reactions, @mentions, event lines, "Seen", and the failed-to-send state.

export type RowInfo = {
  message: Message
  /** Same sender as the message above, close in time */
  joinedAbove: boolean
  joinedBelow: boolean
  /** Show the day ("Today") above it */
  day: string | null
  /** DMs: "Seen 10:03 PM" or "Sent" under your latest message */
  receipt: string | null
  mentionsMe: boolean
  outgoing: 'sending' | 'failed' | null
  /** 0.7.5: still on its way after 1.5 s (dims, "Sending…") */
  slow?: boolean
}

type Props = {
  row: RowInfo
  meId: string
  isGroup: boolean
  people: Record<string, PublicUser>
  members: PublicUser[]
  highlight: boolean
  onLongPress: (m: Message) => void
  onReact: (m: Message, emoji: string) => void
  onQuotePress: (messageId: string) => void
  onRetry: (m: Message) => void
  onAvatarPress: (userId: string) => void
  onOpenPhoto: (m: Message, index: number) => void
  /** 0.5.0: you can vote and play (friends, not blocked) */
  canAct: boolean
  /** Everyone in the chat, you included (games) */
  memberIds: string[]
}

const URL_PATTERN = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g

function Body({ text, members, mine }: { text: string; members: PublicUser[]; mine: boolean }) {
  const { c } = useTheme()
  const pieces = splitMentions(text, members)
  const out: ReactNode[] = []
  pieces.forEach((p, i) => {
    if (p.user) {
      out.push(
        <Text
          key={`m${i}`}
          size={16}
          weight="bold"
          style={{
            color: mine ? c.meInk : c.accentText,
            backgroundColor: mine ? 'rgba(255,255,255,0.28)' : c.accentSoft,
            borderRadius: 6,
          }}
        >
          {p.text}
        </Text>,
      )
      return
    }
    const parts = p.text.split(URL_PATTERN)
    parts.forEach((part, j) => {
      if (j % 2 === 1)
        out.push(
          <Text
            key={`u${i}-${j}`}
            size={16}
            style={{
              color: mine ? c.meInk : c.accentText,
              textDecorationLine: 'underline',
            }}
            onPress={() => void Linking.openURL(part)}
            accessibilityRole="link"
          >
            {part}
          </Text>,
        )
      else if (part) out.push(part)
    })
  })
  return (
    <Text size={16} style={{ color: mine ? c.meInk : c.ink, lineHeight: 22 }} selectable={false}>
      {out}
    </Text>
  )
}

export const MessageRow = memo(function MessageRow({ row, meId, isGroup, people, members, highlight, onLongPress, onReact, onQuotePress, onRetry, onAvatarPress, onOpenPhoto, canAct, memberIds }: Props) {
  const { c } = useTheme()
  const m = row.message
  const mine = m.senderId === meId
  const sender = people[m.senderId]
  const lanternOpacity = useLanternFade(m.lantern && !m.deleted ? m.lanternFadeAt : null)
  const nameOf = (id: string) => (id === meId ? 'You' : firstName(people[id]?.displayName ?? 'Someone', people[id]?.username))

  const day = row.day ? (
    <Text
      size={12}
      weight="bold"
      tone="muted"
      style={{
        alignSelf: 'center',
        marginTop: 14,
        marginBottom: 6,
        letterSpacing: 0.7,
        textTransform: 'uppercase',
      }}
    >
      {row.day}
    </Text>
  ) : null

  if (m.event) {
    const text = eventText(m.event, m.senderId, meId, nameOf)
    if (!text) return day
    const isCall = m.event.type === 'call'
    const missed = isCall && m.event.type === 'call' && m.event.status === 'missed' && !mine
    return (
      <View>
        {day}
        <View
          style={{
            alignSelf: 'center',
            marginVertical: 8,
            minHeight: 34,
            paddingHorizontal: 14,
            paddingVertical: 7,
            borderRadius: 17,
            backgroundColor: c.surface,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            maxWidth: '88%',
          }}
          accessibilityLabel={`${text}, ${clockTime(m.createdAt)}`}
        >
          {isCall ? <Icon name={m.event.type === 'call' && m.event.video ? 'video' : 'phone'} size={16} color={missed ? c.dnd : c.onlineText} /> : null}
          <Text size={13} style={{ color: missed ? c.dnd : c.ink2, flexShrink: 1 }}>
            {text} · {clockTime(m.createdAt)}
          </Text>
        </View>
      </View>
    )
  }

  const jumbo = !m.deleted && !m.replyTo && m.attachments.length === 0 && isJumbo(m.body)
  const showName = isGroup && !mine && !row.joinedAbove
  const showAvatar = !mine && !row.joinedBelow
  const r = 18
  const small = 6
  const radius = mine
    ? {
        borderTopLeftRadius: r,
        borderBottomLeftRadius: r,
        borderTopRightRadius: row.joinedAbove ? small : r,
        borderBottomRightRadius: small,
      }
    : {
        borderTopRightRadius: r,
        borderBottomRightRadius: r,
        borderTopLeftRadius: row.joinedAbove ? small : r,
        borderBottomLeftRadius: small,
      }
  // A GIF, poll or game: the body is only the plain-text version for older apps.
  const special = !m.deleted && !!(m.gif || m.poll || m.game)
  const lantern = !!m.lantern && !m.deleted
  const hasText = !!m.body && !m.deleted && !special
  const onlyPhotos = !hasText && !m.replyTo && m.attachments.length > 0 && m.attachments.every((a) => a.kind === 'image')

  const label = `${mine ? 'You' : (sender?.displayName ?? 'Someone')}: ${m.deleted ? 'Message deleted' : shortBody(m.body) || 'attachment'}, ${clockTime(m.createdAt)}${m.editedAt ? ', edited' : ''}`

  return (
    <Rise conversationId={m.conversationId} body={m.body} sending={row.outgoing === 'sending'} mine={mine}>
      <View style={{ marginTop: row.joinedAbove ? 2 : 8 }}>
        {day}
        <SwipeTime time={clockTime(m.createdAt)}>
          <View
            style={[
              {
                flexDirection: 'row',
                alignItems: 'flex-end',
                gap: 8,
                paddingHorizontal: 12,
              },
              mine ? { justifyContent: 'flex-end' } : null,
              row.mentionsMe
                ? {
                    backgroundColor: c.mentionWash,
                    borderLeftWidth: 3,
                    borderLeftColor: c.accent,
                    paddingVertical: 4,
                  }
                : null,
              highlight ? { backgroundColor: c.accentSoft } : null,
            ]}
          >
            {!mine ? (
              showAvatar && sender ? (
                <Pressable accessibilityLabel={`${sender.displayName}'s profile`} onPress={() => onAvatarPress(sender.id)}>
                  <Avatar user={sender} size={28} />
                </Pressable>
              ) : (
                <View style={{ width: 28 }} />
              )
            ) : null}
            <View
              style={{
                maxWidth: '80%',
                alignItems: mine ? 'flex-end' : 'flex-start',
              }}
            >
              {showName ? (
                <Text size={13} weight="bold" tone="muted" style={{ marginLeft: 12, marginBottom: 2 }}>
                  {sender?.displayName ?? 'Someone'}
                </Text>
              ) : null}
              <Animated.View style={lantern ? { opacity: lanternOpacity } : undefined}>
                <Pressable
                  onLongPress={() => !m.deleted && onLongPress(m)}
                  delayLongPress={300}
                  onPress={row.outgoing === 'failed' ? () => onRetry(m) : undefined}
                  accessibilityLabel={label}
                  accessibilityHint={m.deleted ? undefined : 'Long press for reactions and more'}
                  style={{
                    opacity: row.outgoing === 'sending' && row.slow ? 0.6 : 1,
                  }}
                >
                  {special && m.gif && !m.replyTo ? (
                    <GifView gif={m.gif} onLongPress={() => onLongPress(m)} />
                  ) : special && m.poll ? (
                    <PollCard message={m} meId={meId} nameOf={nameOf} canAct={canAct} />
                  ) : special && m.game ? (
                    <GameCard message={m} meId={meId} nameOf={nameOf} canAct={canAct} memberIds={memberIds} />
                  ) : jumbo ? (
                    <Text size={44} style={{ lineHeight: 52, paddingHorizontal: 4 }}>
                      {m.body}
                    </Text>
                  ) : (
                    <View
                      style={[
                        radius,
                        {
                          backgroundColor: onlyPhotos ? 'transparent' : mine ? c.me : c.them,
                          overflow: 'hidden',
                        },
                        lantern
                          ? {
                              borderWidth: 1.5,
                              borderColor: '#FFB048',
                              boxShadow: '0 0 16px rgba(255,176,72,0.55)',
                            }
                          : null,
                        onlyPhotos
                          ? null
                          : {
                              padding: m.replyTo || m.attachments.length ? 7 : 0,
                            },
                      ]}
                    >
                      {m.replyTo ? (
                        <Pressable
                          onPress={() => onQuotePress(m.replyTo!.id)}
                          accessibilityLabel={`Reply to ${nameOf(m.replyTo.senderId)}. Jump to the message`}
                          style={{
                            paddingVertical: 6,
                            paddingHorizontal: 10,
                            borderRadius: 12,
                            backgroundColor: mine ? c.quoteBg : c.bg,
                            borderLeftWidth: 3,
                            borderLeftColor: mine ? c.meInk : c.accent,
                            gap: 1,
                          }}
                        >
                          <Text size={13} weight="bold" style={{ color: mine ? c.meInk : c.accentText }}>
                            {m.replyTo.senderId === meId ? 'You' : (people[m.replyTo.senderId]?.displayName ?? 'Someone')}
                          </Text>
                          <Text size={13} numberOfLines={2} style={{ color: mine ? c.meInk : c.ink2 }}>
                            {m.replyTo.deleted ? 'Message deleted' : [m.replyTo.attachment ? quoteSummary(m.replyTo.attachment) : '', shortBody(m.replyTo.body)].filter(Boolean).join(' · ')}
                          </Text>
                        </Pressable>
                      ) : null}
                      {m.attachments.length && !m.deleted ? (
                        <View style={{ marginTop: m.replyTo ? 6 : 0 }}>
                          <Attachments message={m} mine={mine} onOpenPhoto={(i) => onOpenPhoto(m, i)} onLongPress={() => onLongPress(m)} />
                        </View>
                      ) : null}
                      {m.deleted ? (
                        <Text
                          size={15}
                          style={{
                            fontStyle: 'italic',
                            color: mine ? c.meInk : c.muted,
                            paddingHorizontal: 13,
                            paddingVertical: 9,
                          }}
                        >
                          {m.lantern ? 'A lantern message faded away' : 'Message deleted'}
                        </Text>
                      ) : hasText ? (
                        <View
                          style={{
                            paddingHorizontal: m.replyTo || m.attachments.length ? 6 : 13,
                            paddingTop: m.replyTo || m.attachments.length ? 6 : 9,
                            paddingBottom: m.replyTo || m.attachments.length || m.linkPreview ? 2 : 9,
                          }}
                        >
                          <Body text={m.body} members={members} mine={mine} />
                        </View>
                      ) : special && m.gif ? (
                        <View style={{ marginTop: 6 }}>
                          <GifView gif={m.gif} onLongPress={() => onLongPress(m)} />
                        </View>
                      ) : null}
                      {m.linkPreview && !m.deleted ? (
                        <View style={{ paddingHorizontal: 6, paddingBottom: 6 }}>
                          <LinkCard message={m} preview={m.linkPreview} mine={mine} />
                        </View>
                      ) : null}
                    </View>
                  )}
                </Pressable>
              </Animated.View>
              {/* 0.7.5: a constellation invite link becomes a card */}
              {!m.deleted && inviteCodeIn(m.body) ? (
                <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                  <InviteCard code={inviteCodeIn(m.body)!} />
                </View>
              ) : null}
              {lantern && row.outgoing === null ? <LanternTag fadeAt={m.lanternFadeAt} /> : null}
              {m.reactions.length ? (
                <View
                  style={
                    {
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      gap: 4,
                      marginTop: -4,
                      [mine ? 'marginRight' : 'marginLeft']: 10,
                    } as object
                  }
                >
                  {m.reactions.map((rx) => {
                    const minePicked = rx.userIds.includes(meId)
                    const who = rx.userIds.map((id) => (id === meId ? 'you' : (people[id]?.displayName ?? 'someone'))).join(', ')
                    return (
                      <Pressable
                        key={rx.emoji}
                        accessibilityRole="button"
                        accessibilityLabel={`${rx.emoji} ${rx.userIds.length}, from ${who}. ${minePicked ? 'Tap to remove yours' : 'Tap to add yours'}`}
                        onPress={() => onReact(m, rx.emoji)}
                        style={{
                          height: 26,
                          paddingHorizontal: 8,
                          borderRadius: 13,
                          backgroundColor: minePicked ? c.chipMine : c.chip,
                          borderWidth: 1.5,
                          borderColor: minePicked ? c.accent : c.line,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <Text size={14}>{rx.emoji}</Text>
                        <Text size={13} weight="bold">
                          {rx.userIds.length}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
              ) : null}
              {row.outgoing === 'failed' ? (
                <Text size={12} tone="danger" weight="bold" style={{ marginTop: 3 }}>
                  Not sent · Tap to retry or delete
                </Text>
              ) : row.outgoing === 'sending' && row.slow ? (
                <Text size={12} tone="muted" style={{ marginTop: 3 }} accessibilityLiveRegion="polite">
                  Sending…
                </Text>
              ) : m.editedAt && !m.deleted ? (
                <Text size={11} tone="faint" style={{ marginTop: 2, marginHorizontal: 6 }}>
                  edited
                </Text>
              ) : null}
              {row.receipt ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    marginTop: 3,
                    paddingRight: 4,
                  }}
                >
                  {row.receipt.startsWith('Seen') ? <Icon name="checkDouble" size={15} color={c.accentText} strokeWidth={2.2} /> : <Icon name="check" size={14} color={c.muted} strokeWidth={2.2} />}
                  <Text size={12} tone="muted">
                    {row.receipt}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </SwipeTime>
      </View>
    </Rise>
  )
})
