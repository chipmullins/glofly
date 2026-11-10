import { memo, type ReactNode } from 'react'
import { CfxCard } from '@/constellations/CfxCard'
import { cfxJoinCodeIn } from '@glofly/shared'
import { Linking, Pressable, View } from 'react-native'
import { clockTime, quoteSummary, shortBody, splitGroupMentions, splitMentions, type Message, type PublicUser } from '@glofly/shared'
import type { MentionGroups } from './roles'
import { Attachments } from '@/chat/Attachments'
import { Formatted } from '@/chat/Formatted'
import { ForwardedLabel } from '@/chat/MessageRow'
import { GameCard, GifView, LinkCard, PollCard } from '@/chat/Extras'
import { RollCard, chatRollOf } from '@/campfire/RollCard'
import { LiveAlertCard, liveAlertBody } from './LiveAlertCard'
import { isJumbo } from '@/lib/emoji'
import { firstName } from '@/lib/format'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { Face, N } from './ui'
import { CxJoinLine, CxMilestone, InviteCard, inviteCodeIn } from './community'

// One message in a nebula, drawn like the "Glofly 2.0 Mobile" canvas (board 4): a face, the name
// in its role's color with the role's badge, the time, and the text, with @you rows washed in amber.
// Replies, reactions, photos, polls, GIFs and games come from the chat pieces Glofly already has.

export type NebulaRowInfo = {
  message: Message
  /** Same sender as the one above, close in time (no face or name) */
  joined: boolean
  day: string | null
  mentionsMe: boolean
  outgoing: 'sending' | 'failed' | null
  /** 0.7.5: still on its way after 1.5 s (dims, "Sending…") */
  slow?: boolean
}

export type RoleLook = { name: string | null; color: string; badgeBg: string } | null

const URL_PATTERN = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g

function Body({ text, members, meId, size, groups, message }: { text: string; members: PublicUser[]; meId: string; size: number; groups?: MentionGroups; message?: Message }) {
  // 4.2 (board 30): only what the server counted is drawn as @everyone / @here / @Role.
  const counted = new Set(message?.mentionRoles ?? [])
  const plain = (text: string, key: string): ReactNode[] => {
  const out: ReactNode[] = []
  const pieces =
    groups && message && (message.mentionEveryone || counted.size)
      ? splitGroupMentions(text, groups.roles.filter((r) => counted.has(r.id)))
      : [{ kind: 'text' as const, text }]
  pieces.forEach((g, gi0) => {
    const gi = `${key}-${gi0}`
    if ((g.kind === 'everyone' || g.kind === 'here') && message?.mentionEveryone) {
      out.push(
        <Text key={`g${gi}`} size={size} weight="bold" style={{ color: N.amber }}>
          {g.text}
        </Text>,
      )
      return
    }
    if (g.kind === 'role') {
      const role = groups?.roles.find((r) => r.id === g.roleId)
      out.push(
        <Text key={`g${gi}`} size={size} weight="bold" style={{ color: role?.color ?? N.tag }}>
          {g.text}
        </Text>,
      )
      return
    }
    splitMentions(g.text, members).forEach((p, i) => {
      if (p.user) {
        const mine = p.user.id === meId
        out.push(
          <Text key={`m${gi}-${i}`} size={size} weight="bold" style={{ color: N.tag, backgroundColor: mine ? 'rgba(255,179,71,0.28)' : 'rgba(255,179,71,0.14)', borderRadius: 5 }}>
            {' '}{p.text}{' '}
          </Text>,
        )
        return
      }
      p.text.split(URL_PATTERN).forEach((part, j) => {
        if (j % 2 === 1)
          out.push(
            <Text key={`u${gi}-${i}-${j}`} size={size} style={{ color: N.amber, textDecorationLine: 'underline' }} onPress={() => void Linking.openURL(part)} accessibilityRole="link">
              {part}
            </Text>,
          )
        else if (part) out.push(part)
      })
    })
  })
  return out
  }
  return (
    <Formatted
      text={text}
      renderPlain={plain}
      look={{
        size,
        ink: N.ink,
        link: N.amber,
        quoteLine: 'rgba(245,237,230,0.25)',
        quoteInk: N.ink,
        inlineCodeBg: 'rgba(255,255,255,0.09)',
        spoilerBg: '#F5EDE6',
      }}
    />
  )
}

export const NebulaRow = memo(function NebulaRow({
  row,
  meId,
  sender,
  role,
  members,
  people,
  highlight,
  compact,
  canAct,
  onLongPress,
  onReact,
  onQuotePress,
  onRetry,
  onFacePress,
  onOpenPhoto,
  onButton,
  onThread,
  answer,
  groups,
}: {
  row: NebulaRowInfo
  meId: string
  sender: PublicUser | undefined
  role: RoleLook
  members: PublicUser[]
  people: Record<string, PublicUser>
  highlight: boolean
  /** The smaller rows of a mini chat on Glofly home */
  compact?: boolean
  /** You can vote, react and play here */
  canAct: boolean
  onLongPress?: (m: Message) => void
  onReact?: (m: Message, emoji: string) => void
  onQuotePress?: (messageId: string) => void
  onRetry?: (m: Message) => void
  onFacePress?: (userId: string) => void
  onOpenPhoto?: (m: Message, index: number) => void
  /** Communities round: a click on one of a bot's buttons */
  onButton?: (m: Message, buttonId: string) => void
  /** Communities round: the thread chip under a message (opens the thread) */
  onThread?: (m: Message) => void
  /** Forum posts: this reply is the marked answer */
  answer?: boolean
  /** 4.2: @everyone / @here / @Role pills (nebulas) */
  groups?: MentionGroups
}) {
  const m = row.message
  const face = compact ? 32 : 36
  const size = compact ? 15 : 15
  const name = sender ? (m.senderId === meId ? sender.displayName : sender.displayName) : 'Someone'
  const nameOf = (id: string) => (id === meId ? 'You' : firstName(people[id]?.displayName ?? 'Someone', people[id]?.username))
  // Campfire: a `/roll` message is a roll card (its body is the plain text for older apps).
  const roll = m.deleted ? null : chatRollOf(m)
  const special = !m.deleted && !!(m.gif || m.poll || m.game || roll)
  const jumbo = !m.deleted && !special && !m.replyTo && !m.attachments.length && isJumbo(m.body)
  const day = row.day ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 4 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: N.line }} />
      <Text size={11} weight="bold" style={{ color: N.faint, letterSpacing: 0.8, textTransform: 'uppercase' }}>
        {row.day}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: N.line }} />
    </View>
  ) : null

  // 0.7.5: "Priya joined. Say hi!" and member milestones; other lines stay hidden here.
  if (m.event?.type === 'cxJoined')
    return (
      <View>
        {day}
        <CxJoinLine m={m} meId={meId} nameOf={nameOf} canAct={canAct && !compact} onReact={onReact} />
      </View>
    )
  if (m.event?.type === 'cxMilestone')
    return (
      <View>
        {day}
        <CxMilestone m={m} />
      </View>
    )
  if (m.event) return day
  const label = `${name}${role?.name ? `, ${role.name}` : ''}: ${m.deleted ? 'Message deleted' : shortBody(m.body) || 'attachment'}, ${clockTime(m.createdAt)}${m.editedAt ? ', edited' : ''}`

  return (
    <View style={{ marginTop: row.joined ? 2 : compact ? 10 : 12 }}>
      {day}
      {answer ? (
        <Text size={11} weight="bold" style={{ color: '#86efac', letterSpacing: 0.6, marginBottom: 4 }}>
          ✓ THE ANSWER
        </Text>
      ) : null}
      <Pressable
        onLongPress={!m.deleted && onLongPress ? () => onLongPress(m) : undefined}
        delayLongPress={300}
        onPress={row.outgoing === 'failed' && onRetry ? () => onRetry(m) : undefined}
        accessibilityLabel={label}
        accessibilityHint={!m.deleted && onLongPress ? 'Hold for reactions and more' : undefined}
        style={[
          { flexDirection: 'row', gap: 10, opacity: row.outgoing === 'sending' && row.slow ? 0.6 : 1, borderRadius: 14 },
          row.mentionsMe ? { backgroundColor: 'rgba(255,179,71,0.10)', padding: 8, marginHorizontal: -8 } : null,
          highlight ? { backgroundColor: N.raised, padding: 8, marginHorizontal: -8 } : null,
          answer ? { backgroundColor: '#0f2a1b', borderWidth: 1, borderColor: '#1f5135', padding: 8, marginHorizontal: -8 } : null,
        ]}
      >
        {row.joined ? (
          <View style={{ width: face }} />
        ) : (
          <Pressable accessibilityLabel={`${name}'s profile`} onPress={() => sender && onFacePress?.(sender.id)} disabled={!onFacePress}>
            {sender ? <Face user={sender} size={face} me={sender.id === meId} /> : <View style={{ width: face, height: face, borderRadius: face / 2, backgroundColor: N.card2 }} />}
          </Pressable>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          {row.joined ? null : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text size={compact ? 12 : 13} weight="bold" style={{ color: role?.color ?? N.ink }} numberOfLines={1}>
                {name}
              </Text>
              {role?.name ? (
                <View style={{ paddingHorizontal: compact ? 5 : 6, paddingVertical: 1, borderRadius: 4, backgroundColor: role.badgeBg }}>
                  <Text size={10} weight="bold" style={{ color: role.color }}>
                    {role.name}
                  </Text>
                </View>
              ) : null}
              <Text size={11} style={{ color: N.faint }}>
                {clockTime(m.createdAt)}
              </Text>
            </View>
          )}
          {m.replyTo && !m.deleted ? (
            <Pressable
              onPress={() => onQuotePress?.(m.replyTo!.id)}
              accessibilityLabel={`Reply to ${nameOf(m.replyTo.senderId)}. Jump to the message`}
              style={{ marginTop: 4, paddingVertical: 4, paddingHorizontal: 10, borderLeftWidth: 3, borderLeftColor: N.edge2, borderRadius: 6, backgroundColor: N.card }}
            >
              <Text size={12} weight="bold" style={{ color: N.ink2 }}>
                {nameOf(m.replyTo.senderId)}
              </Text>
              <Text size={12} numberOfLines={1} style={{ color: N.muted }}>
                {m.replyTo.deleted ? 'Message deleted' : [m.replyTo.attachment ? quoteSummary(m.replyTo.attachment) : '', shortBody(m.replyTo.body)].filter(Boolean).join(' · ')}
              </Text>
            </Pressable>
          ) : null}
          {m.deleted ? (
            <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: N.line2 }}>
              <Icon name="trash" size={16} color={N.faint} />
              <Text size={13} style={{ color: N.faint, fontStyle: 'italic' }}>
                Message deleted
              </Text>
            </View>
          ) : special && m.poll ? (
            <View style={{ marginTop: 6 }}>
              <PollCard message={m} meId={meId} nameOf={nameOf} canAct={canAct} />
            </View>
          ) : special && roll ? (
            <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
              <RollCard roll={roll} />
            </View>
          ) : special && m.game ? (
            <View style={{ marginTop: 6 }}>
              <GameCard message={m} meId={meId} nameOf={nameOf} canAct={canAct} memberIds={members.map((p) => p.id)} />
            </View>
          ) : special && m.gif ? (
            <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
              <GifView gif={m.gif} onLongPress={() => onLongPress?.(m)} />
            </View>
          ) : (
            <>
              {m.attachments.length ? (
                <View style={{ marginTop: 6, alignSelf: 'flex-start', maxWidth: '100%' }}>
                  <Attachments message={m} mine={false} onOpenPhoto={(i) => onOpenPhoto?.(m, i)} onLongPress={() => onLongPress?.(m)} />
                </View>
              ) : null}
              {m.body ? (
                <View style={{ marginTop: 3 }}>
                  {m.forwarded ? <ForwardedLabel forwarded={m.forwarded} color={N.muted} /> : null}
                  {jumbo ? (
                    <Text size={40} style={{ lineHeight: 48 }}>
                      {m.body}
                    </Text>
                  ) : (
                    <Body text={m.liveCard ? liveAlertBody(m.body, m.liveCard) : m.body} members={members} meId={meId} size={size} groups={groups} message={m} />
                  )}
                </View>
              ) : null}
              {/* 0.9.3: a Live alert (Twitch, Kick, YouTube) */}
              {m.liveCard ? (
                <View style={{ marginTop: 6, alignSelf: 'flex-start', maxWidth: '100%' }}>
                  <LiveAlertCard message={m} card={m.liveCard} preview={m.linkPreview} />
                </View>
              ) : m.linkPreview ? (
                <View style={{ marginTop: 6, alignSelf: 'flex-start', maxWidth: 320 }}>
                  <LinkCard message={m} preview={m.linkPreview} mine={false} />
                </View>
              ) : null}
              {/* Only bots' messages carry buttons (only the bot API can add them). */}
              {m.buttons?.length && onButton ? (
                <View accessibilityLabel="Bot buttons" style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {m.buttons.map((b) => (
                    <Pressable
                      key={b.id}
                      accessibilityRole="button"
                      accessibilityLabel={b.label}
                      onPress={() => onButton(m, b.id)}
                      style={({ pressed }) => ({
                        minHeight: 40,
                        paddingHorizontal: 16,
                        borderRadius: 20,
                        justifyContent: 'center',
                        opacity: pressed ? 0.7 : 1,
                        backgroundColor: b.style === 'primary' ? N.green : 'transparent',
                        borderWidth: b.style === 'primary' ? 0 : 1,
                        borderColor: N.edge2,
                      })}
                    >
                      <Text size={14} weight="bold" style={{ color: b.style === 'primary' ? '#ffffff' : b.style === 'danger' ? N.redText : N.ink }}>
                        {b.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {/* Communities round: the thread started from this message */}
              {m.thread && onThread && !m.deleted ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Trail ${m.thread.title}, ${m.thread.replyCount} replies`}
                  onPress={() => onThread(m)}
                  style={({ pressed }) => ({
                    marginTop: 7,
                    alignSelf: 'flex-start',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    paddingHorizontal: 11,
                    paddingVertical: 7,
                    borderRadius: 12,
                    backgroundColor: N.card,
                    borderWidth: 1,
                    borderColor: N.edge2,
                    opacity: pressed ? 0.7 : 1,
                    maxWidth: 300,
                  })}
                >
                  <Text size={14} style={{ color: N.amber }}>↳</Text>
                  <Text size={13} weight="bold" numberOfLines={1} style={{ color: N.ink, flexShrink: 1 }}>
                    {m.thread.title}
                  </Text>
                  <Text size={13} weight="bold" style={{ color: N.amber }}>
                    {m.thread.replyCount}
                  </Text>
                </Pressable>
              ) : null}
              {/* 0.7.5: a constellation invite link becomes a card */}
              {!m.deleted && inviteCodeIn(m.body) ? <InviteCard code={inviteCodeIn(m.body)!} /> : !m.deleted && cfxJoinCodeIn(m.body) ? <CfxCard code={cfxJoinCodeIn(m.body)!} /> : null}
            </>
          )}
          {m.reactions.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {m.reactions.map((rx) => {
                const minePicked = rx.userIds.includes(meId)
                const who = rx.userIds.map((id) => (id === meId ? 'you' : (people[id]?.displayName ?? 'someone'))).join(', ')
                return (
                  <Pressable
                    key={rx.emoji}
                    accessibilityRole="button"
                    accessibilityLabel={`${rx.emoji} ${rx.userIds.length}, from ${who}. ${minePicked ? 'Tap to remove yours' : 'Tap to add yours'}`}
                    disabled={!canAct || !onReact}
                    onPress={() => onReact?.(m, rx.emoji)}
                    hitSlop={{ top: 8, bottom: 8 }}
                    style={{ height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: minePicked ? N.raised : N.card, borderWidth: 1, borderColor: minePicked ? N.amber : N.edge2, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                  >
                    <Text size={13}>{rx.emoji}</Text>
                    <Text size={12} weight="bold">
                      {rx.userIds.length}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          ) : null}
          {row.outgoing === 'failed' ? (
            <Text size={12} weight="bold" style={{ color: N.redText, marginTop: 3 }}>
              Not sent · Tap to retry or delete
            </Text>
          ) : row.outgoing === 'sending' && row.slow ? (
            <Text size={12} style={{ color: N.faint, marginTop: 3 }} accessibilityLiveRegion="polite">
              Sending…
            </Text>
          ) : m.editedAt && !m.deleted ? (
            <Text size={11} style={{ color: N.faint, marginTop: 2 }}>
              edited
            </Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  )
})
