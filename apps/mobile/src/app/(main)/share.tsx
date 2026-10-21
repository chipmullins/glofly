import { useEffect, useMemo, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native'
import { router, useIsFocused, useLocalSearchParams } from 'expo-router'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ATTACHMENTS_PER_MESSAGE,
  ATTACHMENT_MAX_BYTES,
  MESSAGE_MAX,
  VIDEO_MAX_BYTES,
  chatTitle,
  fileTypeLabel,
  findChats,
  formatSize,
  looksLikeVideo,
  matchScore,
  type Attachment,
  type ConstellationCard,
  type ConversationSummary,
  type Nebula,
  type PublicUser,
} from '@glofly/shared'
import type { SharedFile } from 'glofly-native'
import * as api from '@/api/glofly'
import { sendText } from '@/chat/send'
import { openChat } from '@/lib/chatActions'
import { useKeyCommand } from '@/lib/keys'
import { isWideNow } from '@/lib/layout'
import { useSession } from '@/state/session'
import { useStore } from '@/state/store'
import { loadDetail, useCx, useCxAvailable } from '@/state/constellations'
import { flyIn } from '@/constellations/transition'
import { placePaths } from '@/constellations/nav'
import { cantPost } from '@/constellations/roles'
import { ConstellationIcon, N } from '@/constellations/ui'
import { finishShare, putWebTestShare, useShareInbox } from '@/share/inbox'
import { Avatar, ChatAvatar } from '@/ui/Avatar'
import { inform } from '@/ui/dialogs'
import { EmptyScene } from '@/ui/EmptyScene'
import { Icon } from '@/ui/icons'
import { Button, IconButton, SectionLabel, Text, webNoOutline } from '@/ui/kit'
import { font, useTheme } from '@/ui/theme'

// 0.8.0 "Share to Glofly": a photo, video, file, link or text shared from another app. Pick a chat,
// group or nebula you can post in (recent first, with a search), add a message, Send. It's sent
// with the app's own upload and send code (chat/uploads.ts → api.uploadAttachment, chat/send.ts),
// then that chat opens.

type Target =
  | { kind: 'chat'; key: string; chat: ConversationSummary }
  | { kind: 'person'; key: string; user: PublicUser }
  | { kind: 'nebula'; key: string; card: ConstellationCard; nebula: Nebula }

type Row = Target | { kind: 'label'; key: string; label: string }

const kindOf = (f: SharedFile): 'image' | 'video' | 'file' =>
  f.mimeType.startsWith('image/') ? 'image' : f.mimeType.startsWith('video/') || looksLikeVideo(f.name) ? 'video' : 'file'
const limitOf = (f: SharedFile) => (kindOf(f) === 'video' ? VIDEO_MAX_BYTES : ATTACHMENT_MAX_BYTES)

export default function ShareScreen() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ text?: string }>()
  const item = useShareInbox((s) => s.item)
  const seq = useShareInbox((s) => s.seq)
  const conversations = useStore((s) => s.conversations)
  const friends = useStore((s) => s.friends.friends)
  const cxOn = useCxAvailable()
  const cards = useCx((s) => s.cards)
  const details = useCx((s) => s.details)
  const meId = useSession((s) => s.user?.id ?? '')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Target | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  // The browser preview has no share sheet: /share?text=… stands in (testing).
  useEffect(() => {
    if (Platform.OS === 'web' && !item && params.text) putWebTestShare(String(params.text))
  }, [item, params.text])

  // A new share: start fresh, with its text (a link or words) in the message box.
  useEffect(() => {
    const words = [item?.subject && item?.text && !item.text.includes(item.subject) ? item.subject : null, item?.text].filter(Boolean).join('\n')
    setMessage(words.slice(0, MESSAGE_MAX))
    setPicked(null)
    setQuery('')
  }, [seq, item?.id])

  // Nebulas you can post in: each constellation's details (loaded once).
  useEffect(() => {
    if (!cxOn) return
    for (const card of cards.slice(0, 30)) if (!useCx.getState().details[card.id]) void loadDetail(card.id)
  }, [cxOn, cards])

  const files = item?.files ?? []
  const sendable = files.filter((f) => !f.tooBig && f.uri && (f.size <= 0 || f.size <= limitOf(f))).slice(0, ATTACHMENTS_PER_MESSAGE)
  const leftOut = files.length - sendable.length + (item?.skipped ?? 0)

  const rows: Row[] = useMemo(() => {
    const chats = Object.values(conversations)
      .filter((ch) => ch.canMessage)
      .sort((a, b) => b.activityAt.localeCompare(a.activityAt))
    const nebulas: { card: ConstellationCard; nebula: Nebula }[] = []
    if (cxOn) {
      for (const card of [...cards].sort((a, b) => b.activityAt.localeCompare(a.activityAt))) {
        const d = details[card.id]
        if (!d) continue
        for (const n of [...d.nebulas].sort((a, b) => a.position - b.position)) {
          if (n.kind !== 'text' || cantPost(d, n)) continue
          nebulas.push({ card, nebula: n })
        }
      }
    }
    const q = query.trim()
    if (q) {
      const found: Row[] = findChats(q, chats, friends).flatMap((r): Row[] => {
        if (r.conversation) return r.conversation.canMessage ? [{ kind: 'chat', key: r.conversation.id, chat: r.conversation }] : []
        return r.kind === 'person' && r.isFriend ? [{ kind: 'person', key: `p:${r.user.id}`, user: r.user }] : []
      })
      const nebs: Row[] = nebulas
        .map((x) => ({ x, s: Math.max(matchScore(q, x.nebula.name), matchScore(q, `${x.nebula.name} ${x.card.name}`), matchScore(q, x.card.name) / 2) }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 12)
        .map(({ x }) => ({ kind: 'nebula', key: `n:${x.nebula.id}`, ...x }))
      return [...found, ...(nebs.length ? [{ kind: 'label' as const, key: 'l-n', label: 'Nebulas' }, ...nebs] : [])]
    }
    return [
      ...(chats.length ? [{ kind: 'label' as const, key: 'l-r', label: 'Recent' }] : []),
      ...chats.slice(0, 40).map((chat): Row => ({ kind: 'chat', key: chat.id, chat })),
      ...(nebulas.length ? [{ kind: 'label' as const, key: 'l-n', label: 'Nebulas' }] : []),
      ...nebulas.slice(0, 40).map((x): Row => ({ kind: 'nebula', key: `n:${x.nebula.id}`, ...x })),
    ]
  }, [conversations, friends, cxOn, cards, details, query])

  const close = () => {
    finishShare()
    if (router.canGoBack()) router.back()
    else router.replace('/chats')
  }
  const focused = useIsFocused()
  useKeyCommand('escape', () => (picked ? setPicked(null) : close()), focused && !busy)

  async function send() {
    if (!picked || busy || !item) return
    const body = message.trim()
    if (!body && !sendable.length) return void inform('Nothing to send', 'Glofly couldn’t read what was shared. Try sharing it again.')
    if (body.length > MESSAGE_MAX) return void inform('That’s a long one', `Messages can be up to ${MESSAGE_MAX} characters.`)
    setBusy('Sending…')
    // Who it goes to (a friend you haven't messaged yet gets a new chat).
    let conversationId: string
    if (picked.kind === 'chat') conversationId = picked.chat.id
    else if (picked.kind === 'nebula') conversationId = picked.nebula.conversationId
    else {
      const r = await api.openDm(picked.user.id)
      if (!r.ok) {
        setBusy(null)
        return void inform('Couldn’t open the chat', r.message)
      }
      useStore.setState({ conversations: { ...useStore.getState().conversations, [r.data.id]: r.data } })
      conversationId = r.data.id
    }
    // Photos, videos and files first (with the same upload the + button uses).
    const ready: Attachment[] = []
    for (let i = 0; i < sendable.length; i++) {
      const f = sendable[i]
      setBusy(sendable.length > 1 ? `Uploading ${i + 1} of ${sendable.length}…` : kindOf(f) === 'video' ? 'Uploading the video…' : kindOf(f) === 'image' ? 'Uploading the photo…' : 'Uploading the file…')
      const r = await api.uploadAttachment(conversationId, { uri: f.uri!, type: 'application/octet-stream', name: f.name })
      if (!r.ok) {
        for (const a of ready) void api.removeUpload(conversationId, a.id)
        setBusy(null)
        return void inform(`Couldn’t send ${f.name}`, r.message)
      }
      ready.push(r.data)
    }
    sendText(conversationId, body, null, ready)
    finishShare()
    setBusy(null)
    // Then the chat it went to.
    if (picked.kind === 'nebula') {
      if (router.canGoBack()) router.back()
      flyIn(null, placePaths({ constellationId: picked.card.id, nebulaId: picked.nebula.id }, isWideNow()))
    } else {
      if (router.canGoBack()) router.back()
      void openChat(conversationId)
    }
  }

  const header = (
    <View style={{ paddingTop: insets.top, backgroundColor: c.bg }}>
      <View style={{ height: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, gap: 4 }}>
        <IconButton name="close" label="Cancel" onPress={close} color={c.ink} size={24} />
        <Text display size={22} numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
          Send to…
        </Text>
      </View>
    </View>
  )

  if (!item) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        {header}
        <EmptyScene kind="caughtUp" title="Nothing to send" text="Share a photo, video, link or text to Glofly from any app, and pick where it goes here.">
          <Button compact kind="secondary" label="Back to Glofly" onPress={close} />
        </EmptyScene>
      </View>
    )
  }

  const pickedName = !picked ? '' : picked.kind === 'chat' ? chatTitle(picked.chat) : picked.kind === 'person' ? picked.user.displayName : `#${picked.nebula.name}`

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: c.bg }}>
      {header}
      <SharedPreview files={files} sendable={sendable} leftOut={leftOut} />
      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <View style={{ height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 24, backgroundColor: c.surface }}>
          <Icon name="search" size={20} color={c.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={cxOn ? 'Search chats, groups and nebulas' : 'Search chats and groups'}
            placeholderTextColor={c.muted}
            accessibilityLabel="Search chats, groups and nebulas"
            selectionColor={c.accent}
            autoCorrect={false}
            style={[{ flex: 1, height: 44, color: c.ink, fontFamily: font.body, fontSize: 16 }, webNoOutline]}
          />
          {query ? <IconButton name="close" label="Clear search" onPress={() => setQuery('')} size={18} box={36} color={c.muted} /> : null}
        </View>
      </View>
      <FlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(r) => r.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingVertical: 6 }}
        ListEmptyComponent={
          <Text tone="muted" style={{ textAlign: 'center', padding: 24 }}>
            {query.trim() ? `No chats called “${query.trim()}”` : 'Your chats show up here.'}
          </Text>
        }
        renderItem={({ item: r }) =>
          r.kind === 'label' ? (
            <SectionLabel>{r.label}</SectionLabel>
          ) : (
            <TargetRow target={r} meId={meId} picked={picked?.key === r.key} onPress={() => setPicked(picked?.key === r.key ? null : r)} />
          )
        }
      />
      <View style={{ borderTopWidth: 0.5, borderTopColor: c.line, backgroundColor: c.barBg, paddingHorizontal: 12, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 10) + 4, gap: 10 }}>
        <View style={{ minHeight: 44, borderWidth: 1.5, borderColor: c.fieldLine, borderRadius: 22, backgroundColor: c.field, paddingHorizontal: 14 }}>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={files.length ? 'Add a message' : 'Message'}
            placeholderTextColor={c.faint}
            accessibilityLabel={files.length ? 'Add a message' : 'Message'}
            selectionColor={c.accent}
            multiline
            maxLength={MESSAGE_MAX}
            style={[{ minHeight: 40, maxHeight: 120, paddingTop: 10, paddingBottom: 10, color: c.ink, fontFamily: font.body, fontSize: 16 }, webNoOutline]}
          />
        </View>
        <Button
          label={busy ?? (picked ? `Send to ${pickedName}` : 'Pick a chat')}
          icon={busy ? undefined : 'send'}
          busy={!!busy}
          disabled={!picked || (!message.trim() && !sendable.length)}
          onPress={() => void send()}
        />
      </View>
    </KeyboardAvoidingView>
  )
}

function SharedPreview({ files, sendable, leftOut }: { files: SharedFile[]; sendable: SharedFile[]; leftOut: number }) {
  const { c } = useTheme()
  if (!files.length) return null
  const tooBig = files.filter((f) => f.tooBig || (f.size > 0 && f.size > limitOf(f)))
  return (
    <View style={{ paddingTop: 4, gap: 6 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }} accessibilityLabel="What you're sharing">
        {sendable.map((f, i) => {
          const kind = kindOf(f)
          return (
            <View key={`${f.name}-${i}`} accessibilityLabel={kind === 'image' ? `Photo ${f.name}` : kind === 'video' ? `Video ${f.name}` : `File ${f.name}`} style={{ width: 88, height: 88, borderRadius: 16, overflow: 'hidden', backgroundColor: c.surface }}>
              {kind === 'image' ? (
                <Image source={{ uri: f.uri ?? undefined }} style={{ width: 88, height: 88 }} contentFit="cover" />
              ) : kind === 'video' ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C1210', gap: 4 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="play" size={15} color="#1C1210" />
                  </View>
                  <Text size={10} weight="bold" style={{ color: '#FFF' }}>
                    {f.size ? formatSize(f.size) : 'Video'}
                  </Text>
                </View>
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 6, gap: 2 }}>
                  <Icon name="file" size={24} color={c.ink2} />
                  <Text size={10} weight="bold" tone="muted" numberOfLines={1}>
                    {fileTypeLabel(f.name)}
                  </Text>
                  <Text size={10} numberOfLines={1}>
                    {f.name}
                  </Text>
                </View>
              )}
            </View>
          )
        })}
      </ScrollView>
      {leftOut > 0 ? (
        <Text size={13} tone="muted" style={{ paddingHorizontal: 16 }}>
          {tooBig.length
            ? `${tooBig.map((f) => f.name).slice(0, 2).join(', ')}${tooBig.length > 2 ? ` and ${tooBig.length - 2} more` : ''} ${tooBig.length === 1 ? 'is' : 'are'} too big to send (photos and files up to ${formatSize(ATTACHMENT_MAX_BYTES)}, videos up to ${formatSize(VIDEO_MAX_BYTES)}).`
            : `Glofly sends up to ${ATTACHMENTS_PER_MESSAGE} at a time, so ${leftOut} ${leftOut === 1 ? 'was' : 'were'} left out.`}
        </Text>
      ) : null}
    </View>
  )
}

function TargetRow({ target, meId, picked, onPress }: { target: Target; meId: string; picked: boolean; onPress: () => void }) {
  const { c } = useTheme()
  void meId
  const title = target.kind === 'chat' ? chatTitle(target.chat) : target.kind === 'person' ? target.user.displayName : `# ${target.nebula.name}`
  const detail =
    target.kind === 'chat'
      ? target.chat.kind === 'group'
        ? 'Group'
        : `@${target.chat.partner.username}`
      : target.kind === 'person'
        ? `@${target.user.username} · new chat`
        : `Nebula in ${target.card.name}`
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: picked }}
      accessibilityLabel={target.kind === 'nebula' ? `Nebula ${target.nebula.name} in ${target.card.name}` : title}
      onPress={onPress}
      android_ripple={{ color: c.line }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: picked ? c.accentSoft : 'transparent' }}
    >
      {target.kind === 'chat' ? (
        <ChatAvatar chat={target.chat} size={48} />
      ) : target.kind === 'person' ? (
        <Avatar user={target.user} size={48} />
      ) : (
        <View style={{ width: 48, height: 48 }}>
          <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: N.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="sparkles" size={20} color={N.amber} />
          </View>
          <View style={{ position: 'absolute', right: -4, bottom: -4 }}>
            <ConstellationIcon c={target.card} size={22} radius={7} />
          </View>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text size={16} weight="bold" numberOfLines={1}>
          {title}
        </Text>
        <Text size={13} tone="muted" numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: picked ? c.accent : c.fieldLine,
          backgroundColor: picked ? c.accent : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {picked ? <Icon name="check" size={14} color={c.accentInk} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  )
}
