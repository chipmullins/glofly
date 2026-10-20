import { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg'
import { FRIEND_LINK_PITCH, friendLinkJoinedLine, friendLinkText, friendLinkUrl } from '@glofly/shared'
import { Icon } from './icons'
import { Button, Text } from './kit'
import { useTheme } from './theme'
import { loadFriendLink, resetFriendLink, shareFriendLink, useFriendLinkStore } from '@/state/friendLink'

// 0.8.0 shareable friend invite link on phones (InviteLink.dc.html): "Not on Glofly yet?", the
// link, "Share your invite link" (the phone's share sheet with "Join me on Glofly"), long-press
// the link to copy it, "3 friends joined from your link", Reset link with the inline confirm.

/** Your link (loaded the first time it's shown). */
export function useMyFriendLink(enabled = true) {
  const state = useFriendLinkStore()
  useEffect(() => {
    if (enabled) void loadFriendLink()
  }, [enabled])
  return state
}

function ResetConfirm({ busy, onCancel, onReset }: { busy: boolean; onCancel: () => void; onReset: () => void }) {
  const { c } = useTheme()
  return (
    <View
      accessibilityRole="alert"
      style={{ borderRadius: 14, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line, padding: 12, gap: 8 }}
    >
      <Text size={14} style={{ color: c.ink2, lineHeight: 20 }}>
        Make a new link? Your old one stops working right away. People who already joined stay your friends.
      </Text>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
        <Button compact kind="ghost" label="Cancel" onPress={onCancel} />
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy }}
          disabled={busy}
          onPress={onReset}
          style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: c.ink, justifyContent: 'center', opacity: pressed || busy ? 0.75 : 1 })}
        >
          <Text size={15} weight="bold" style={{ color: c.bg }}>
            {busy ? 'Making…' : 'New link'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

/** Add friend's card ("Not on Glofly yet?"). */
export function InviteLinkCard({ onShared }: { onShared?: () => void }) {
  const { c } = useTheme()
  const { link, problem, loading } = useMyFriendLink()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  async function share() {
    const failed = await shareFriendLink()
    setNote(failed)
    if (!failed) onShared?.()
  }

  async function copy() {
    if (!link) return
    await Clipboard.setStringAsync(friendLinkUrl(link.code))
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
    onShared?.()
  }

  async function reset() {
    setBusy(true)
    const failed = await resetFriendLink()
    setBusy(false)
    setConfirming(false)
    setNote(failed)
  }

  return (
    <View style={{ borderRadius: 18, backgroundColor: c.accentSoft, padding: 16, gap: 12, overflow: 'hidden' }}>
      <Svg width={140} height={90} viewBox="0 0 140 90" style={{ position: 'absolute', right: -6, top: -8, opacity: 0.9 }} pointerEvents="none">
        <Defs>
          <RadialGradient id="ilg">
            <Stop offset="0" stopColor="#ffe9a8" />
            <Stop offset=".35" stopColor="#ffb347" stopOpacity=".75" />
            <Stop offset="1" stopColor="#ffb347" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Path d="M20 70c26-34 64-40 100-26" stroke={c.accent} strokeOpacity={0.35} strokeWidth={2} fill="none" strokeDasharray="2 6" strokeLinecap="round" />
        <Circle cx={20} cy={70} r={14} fill="url(#ilg)" />
        <Circle cx={20} cy={70} r={2.6} fill="#fff4cf" />
        <Circle cx={118} cy={44} r={18} fill="url(#ilg)" />
        <Circle cx={118} cy={44} r={3.2} fill="#fff4cf" />
      </Svg>
      <View style={{ gap: 2, paddingRight: 60 }}>
        <Text display size={18}>
          Not on Glofly yet?
        </Text>
        <Text size={14} tone="muted" style={{ lineHeight: 20 }}>
          {FRIEND_LINK_PITCH}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={link ? `Your invite link, ${friendLinkText(link.code)}. Long press to copy.` : 'Your invite link'}
        accessibilityHint="Long press to copy"
        onLongPress={() => void copy()}
        disabled={!link}
        style={{ minHeight: 46, borderRadius: 12, backgroundColor: c.field, borderWidth: 1, borderColor: c.fieldLine, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8 }}
      >
        <Icon name="link" size={16} color={c.accentText} />
        <Text size={15} numberOfLines={1} style={{ flex: 1 }}>
          {link ? (
            <>
              glofly.app/i/<Text size={15} weight="bold">{link.code}</Text>
            </>
          ) : (
            <Text size={14} tone="faint">
              {problem ?? (loading ? 'Making your link…' : '')}
            </Text>
          )}
        </Text>
        {copied ? (
          <Text size={13} weight="bold" style={{ color: c.onlineText }}>
            Copied!
          </Text>
        ) : null}
      </Pressable>
      <Button label="Share your invite link" icon="share" disabled={!link} onPress={() => void share()} compact />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text size={13} tone="muted" style={{ flex: 1 }}>
          {link ? friendLinkJoinedLine(link.joined) : ''}
        </Text>
        <Pressable accessibilityRole="button" disabled={!link || confirming} onPress={() => setConfirming(true)} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }}>
          <Text size={13} weight="bold" style={{ color: c.accentText, opacity: !link || confirming ? 0.5 : 1 }}>
            Reset link
          </Text>
        </Pressable>
      </View>
      {confirming ? <ResetConfirm busy={busy} onCancel={() => setConfirming(false)} onReset={() => void reset()} /> : null}
      {note ? (
        <Text size={13} style={{ color: c.danger }} accessibilityRole="alert">
          {note}
        </Text>
      ) : null}
    </View>
  )
}

/** Settings: "Your invite link" with Share / Copy and Reset. */
export function InviteLinkSettings() {
  const { c } = useTheme()
  const { link, problem, loading } = useMyFriendLink()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function reset() {
    setBusy(true)
    const failed = await resetFriendLink()
    setBusy(false)
    setConfirming(false)
    setNote(failed)
  }

  return (
    <View style={{ marginHorizontal: 16, padding: 14, borderRadius: 18, backgroundColor: c.surface, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text size={16} weight="bold">
            Your invite link
          </Text>
          <Text size={13} tone="muted" numberOfLines={1}>
            {link ? friendLinkText(link.code) : (problem ?? (loading ? 'Making your link…' : ''))}
          </Text>
          {link ? (
            <Text size={12} tone="faint">
              {friendLinkJoinedLine(link.joined)}
            </Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy your invite link"
          disabled={!link}
          onPress={() => {
            if (!link) return
            void Clipboard.setStringAsync(friendLinkUrl(link.code)).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1600)
            })
          }}
          style={{ minHeight: 44, minWidth: 72, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: copied ? c.online : c.accent, justifyContent: 'center', alignItems: 'center' }}
        >
          <Text size={14} weight="bold" style={{ color: copied ? c.onlineText : c.accentText }}>
            {copied ? 'Copied!' : 'Copy'}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={!link || confirming} onPress={() => setConfirming(true)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }}>
          <Text size={14} weight="bold" tone="muted">
            Reset
          </Text>
        </Pressable>
      </View>
      <Button compact kind="secondary" label="Share your invite link" icon="share" disabled={!link} onPress={() => void shareFriendLink().then(setNote)} />
      {confirming ? <ResetConfirm busy={busy} onCancel={() => setConfirming(false)} onReset={() => void reset()} /> : null}
      {note ? (
        <Text size={13} style={{ color: c.danger }} accessibilityRole="alert">
          {note}
        </Text>
      ) : null}
    </View>
  )
}
