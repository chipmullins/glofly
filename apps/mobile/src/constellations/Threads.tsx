import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { continuesGroup, dayLabel, isSameDay, mentionsMe, type ConstellationDetail, type Message, type Nebula, type PublicUser, type ServerEvent } from '@glofly/shared'
import { FORUM_TAG_COLORS, POST_TAGS_MAX, THREAD_TITLE_MAX, type ForumTag, type ThreadSummary } from '@glofly/shared/threads'
import { onLive } from '@/api/realtime'
import { threadsApi } from '@/api/threads'
import { Composer, type ComposerHandle } from '@/chat/Composer'
import { useSession } from '@/state/session'
import { useStore } from '@/state/store'
import { cxSay } from '@/state/constellations'
import { Text } from '@/ui/kit'
import { haptic } from './motion'
import { NebulaRow, type NebulaRowInfo } from './NebulaRow'
import { roleLook } from './roles'
import { can } from './roles'
import { N, NightButton, NightHeader } from './ui'

// Communities round (Nov 2026): threads and forum posts on phones (approved canvas boards 20–22).
// JS only. A thread (or post) is its own screen; replies load and send through the thread routes,
// and live replies come in as thread:message.

const staffIn = (c: ConstellationDetail) => can(c, 'manageNebulas') || can(c, 'deleteMessages')

export function TagChipN({ tag, on, onPress, locked }: { tag: ForumTag; on?: boolean; onPress?: () => void; locked?: boolean }) {
  const look = FORUM_TAG_COLORS[tag.color]
  const filled = on !== false
  const chip = (
    <View style={{ paddingHorizontal: 9, paddingVertical: 2, borderRadius: 10, backgroundColor: filled ? look.bg : 'transparent', borderWidth: filled ? 0 : 1, borderColor: N.edge2, opacity: locked ? 0.5 : 1 }}>
      <Text size={12} weight="bold" style={{ color: filled ? look.text : N.ink2 }}>
        {locked ? '🔒 ' : ''}
        {tag.name}
      </Text>
    </View>
  )
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!on, disabled: !!locked }} disabled={locked} onPress={onPress} hitSlop={4}>
      {chip}
    </Pressable>
  ) : (
    chip
  )
}

const ago = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  if (s < 2 * 86_400) return 'yesterday'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ───────────── A thread or a forum post (boards 20, 22) ─────────────

export function ThreadScreen({ c, n, threadId }: { c: ConstellationDetail; n: Nebula; threadId: string }) {
  const meId = useSession((s) => s.user?.id ?? '')
  const people = useStore((s) => s.people)
  const insets = useSafeAreaInsets()
  const forum = n.kind === 'forum'
  const staff = staffIn(c)
  const [thread, setThread] = useState<ThreadSummary | null>(null)
  const [parent, setParent] = useState<Message | null>(null)
  const [list, setList] = useState<Message[]>([])
  const [loaded, setLoaded] = useState(false)
  const [reply, setReply] = useState<Message | null>(null)
  const [also, setAlso] = useState(false)
  const composer = useRef<ComposerHandle>(null)
  const members: PublicUser[] = useMemo(() => c.members.map((m) => m.user), [c.members])
  const peopleAll = useMemo(() => {
    const out: Record<string, PublicUser> = { ...people }
    for (const m of c.members) out[m.user.id] = m.user
    return out
  }, [people, c.members])

  const load = useCallback(async () => {
    const [t, page] = await Promise.all([threadsApi.get(c.id, threadId), threadsApi.messages(n.conversationId, threadId)])
    if (!t.ok) {
      cxSay(t.message)
      return router.back()
    }
    setThread(t.data.thread)
    if (page.ok) setList(page.data.messages)
    setLoaded(true)
    void threadsApi.read(c.id, threadId)
    if (t.data.thread.parentMessageId) {
      const around = await import('@/api/glofly').then((api) => api.loadMessages(n.conversationId))
      const found = around.ok ? around.data.messages.find((m) => m.id === t.data.thread.parentMessageId) : undefined
      if (found) setParent(found)
    }
  }, [c.id, threadId, n.conversationId])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(
    () =>
      onLive((event, payload) => {
        if (event !== 'cx') return
        const e = payload as ServerEvent
        if (e.type === 'thread:message' && e.thread.id === threadId) {
          setList((l) => (l.some((x) => x.id === e.message.id) ? l : [...l.filter((x) => !(x.id.startsWith('local-') && x.senderId === e.message.senderId && x.body === e.message.body)), e.message]))
          setThread((t) => (t ? { ...e.thread, following: t.following || e.message.senderId === meId, unread: 0 } : t))
          void threadsApi.read(c.id, threadId)
        } else if (e.type === 'thread:updated' && e.thread.id === threadId) {
          setThread((t) => (t ? { ...e.thread, following: t.following, unread: 0 } : t))
        } else if (e.type === 'thread:deleted' && e.threadId === threadId) {
          cxSay(forum ? 'That post was deleted.' : 'That thread was deleted.')
          router.back()
        }
      }),
    [c.id, threadId, meId, forum],
  )

  const rows: NebulaRowInfo[] = useMemo(() => {
    const out: NebulaRowInfo[] = []
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      const prev = list[i - 1]
      const sameDay = !!prev && isSameDay(prev.createdAt, m.createdAt)
      out.push({
        message: m,
        joined: !!prev && sameDay && !prev.deleted && continuesGroup(prev, m) && thread?.answerMessageId !== m.id,
        day: !prev || !sameDay ? dayLabel(m.createdAt) : null,
        mentionsMe: mentionsMe(m, meId) && m.senderId !== meId,
        outgoing: m.id.startsWith('local-') ? 'sending' : null,
      })
    }
    return out.reverse()
  }, [list, meId, thread?.answerMessageId])

  async function send(text: string) {
    const body = text.trim()
    if (!body || !thread) return
    const local: Message = {
      id: `local-${Date.now()}`,
      conversationId: n.conversationId,
      senderId: meId,
      body,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deleted: false,
      replyTo: null,
      reactions: [],
      attachments: [],
      event: null,
      mentions: [],
      threadId,
    }
    setList((l) => [...l, local])
    const replyTo = reply
    setReply(null)
    composer.current?.clear()
    haptic.light?.()
    const r = await threadsApi.send(n.conversationId, threadId, body, replyTo?.id, also && !forum)
    if (r.ok) {
      setList((l) => (l.some((x) => x.id === r.data.message.id) ? l.filter((x) => x.id !== local.id) : l.map((x) => (x.id === local.id ? r.data.message : x))))
      setThread((t) => (t ? { ...t, following: true } : t))
    } else {
      setList((l) => l.filter((x) => x.id !== local.id))
      composer.current?.setText(body)
      cxSay(r.message)
    }
  }

  const mine = thread?.authorId === meId
  const tags = n.forum?.tags ?? []
  const solved = tags.find((t) => t.name.toLowerCase() === 'solved')
  const isSolved = !!solved && !!thread?.tagIds.includes(solved.id)

  async function longPress(m: Message) {
    if (!thread || m.id.startsWith('local-') || m.deleted) return
    const { openContextMenu } = await import('./ContextMenu')
    const canAnswer = forum && (mine || staff) && m.id !== list[0]?.id
    const pick = await openContextMenu(
      { x: 14, y: 260, w: 360, h: 60 },
      null,
      [
        { key: 'reply', label: 'Reply' },
        ...(canAnswer ? [{ key: 'answer', label: thread.answerMessageId === m.id ? 'Not the answer' : 'Mark as the answer' }] : []),
      ] as never,
    )
    if (pick === 'reply') {
      setReply(m)
      composer.current?.focus()
    } else if (pick === 'answer') {
      const r = await threadsApi.change(c.id, thread.id, { answerMessageId: thread.answerMessageId === m.id ? null : m.id })
      if (r.ok) setThread({ ...r.data.thread, following: thread.following })
      else cxSay(r.message)
    }
  }

  const follow = async () => {
    if (!thread) return
    const r = await threadsApi.follow(c.id, thread.id, !thread.following)
    if (r.ok) setThread(r.data.thread)
  }
  const markSolved = async () => {
    if (!thread || !solved) return
    const r = await threadsApi.change(c.id, thread.id, { tagIds: isSolved ? thread.tagIds.filter((x) => x !== solved.id) : [...thread.tagIds, solved.id] })
    if (r.ok) setThread({ ...r.data.thread, following: thread.following })
    else cxSay(r.message)
  }

  const header = forum ? (
    <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 12, gap: 6, borderBottomWidth: 1, borderBottomColor: N.line }}>
      <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8}>
        <Text size={14} style={{ color: N.ink2 }}>
          ‹ {n.name}
        </Text>
      </Pressable>
      {thread ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {thread.tagIds.map((id) => tags.find((t) => t.id === id)).filter((t): t is ForumTag => !!t).map((t) => (
              <TagChipN key={t.id} tag={t} />
            ))}
          </View>
          <Text display size={19} accessibilityRole="header">
            {thread.pinned ? '📌 ' : ''}
            {thread.title}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text size={12} style={{ color: N.ink2 }}>
              {thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'} ·
            </Text>
            <Pressable accessibilityRole="button" onPress={() => void follow()} hitSlop={6}>
              <Text size={12} weight="bold" style={{ color: thread.following ? N.amber : N.ink2 }}>
                {thread.following ? 'Following' : 'Follow'}
              </Text>
            </Pressable>
            {solved && (mine || staff) ? (
              <Pressable accessibilityRole="button" onPress={() => void markSolved()} hitSlop={6}>
                <Text size={12} weight="bold" style={{ color: '#86efac' }}>
                  · ✓ {isSolved ? 'Solved' : 'Mark solved'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  ) : (
    <NightHeader
      overlay
      title={thread?.title ?? 'Thread'}
      subtitle={`Thread in #${n.name}${thread ? ` · ${thread.replyCount} ${thread.replyCount === 1 ? 'reply' : 'replies'}` : ''}`}
      right={
        thread ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void follow()}
            style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: thread.following ? '#3a2414' : 'transparent', borderWidth: thread.following ? 0 : 1, borderColor: N.edge2 }}
          >
            <Text size={12} weight="bold" style={{ color: thread.following ? '#ffd2a3' : N.ink2 }}>
              {thread.following ? 'Following' : 'Follow'}
            </Text>
          </Pressable>
        ) : undefined
      }
    />
  )

  const parentCard =
    !forum && parent ? (
      <View style={{ marginTop: 12, padding: 10, borderRadius: 12, backgroundColor: N.card }}>
        <NebulaRow row={{ message: parent, joined: false, day: null, mentionsMe: false, outgoing: null }} meId={meId} sender={peopleAll[parent.senderId]} role={roleLook(c, parent.senderId)} members={members} people={peopleAll} highlight={false} canAct={false} />
      </View>
    ) : null
  const countLine =
    !forum && thread ? (
      <Text size={11.5} weight="bold" style={{ textAlign: 'center', color: N.ink2, letterSpacing: 0.5, marginVertical: 12 }}>
        {thread.replyCount === 0 ? 'NO REPLIES YET' : `${thread.replyCount} ${thread.replyCount === 1 ? 'REPLY' : 'REPLIES'}`}
      </Text>
    ) : null

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: N.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {header}
      <FlatList
        inverted
        data={rows}
        keyExtractor={(r) => r.message.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
        ListFooterComponent={
          <>
            {parentCard}
            {countLine}
          </>
        }
        ListEmptyComponent={loaded && forum ? <Text size={14} style={{ color: N.ink2, textAlign: 'center', marginTop: 20 }}>This post is empty.</Text> : null}
        renderItem={({ item }) => (
          <NebulaRow
            row={item}
            meId={meId}
            sender={peopleAll[item.message.senderId]}
            role={roleLook(c, item.message.senderId)}
            members={members}
            people={peopleAll}
            highlight={false}
            canAct
            answer={!!thread?.answerMessageId && thread.answerMessageId === item.message.id}
            onLongPress={(m) => void longPress(m)}
          />
        )}
      />
      {!forum ? (
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: also }} onPress={() => setAlso((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingTop: 6 }}>
          <View style={{ width: 18, height: 18, borderRadius: 5, borderWidth: 2, borderColor: also ? N.amber : N.edge2, backgroundColor: also ? N.amber : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
            {also ? <Text size={11} weight="bold" style={{ color: '#2a1406' }}>✓</Text> : null}
          </View>
          <Text size={13} style={{ color: N.ink2 }}>
            Also send to #{n.name}
          </Text>
        </Pressable>
      ) : null}
      <Composer
        ref={composer}
        placeholder={forum ? 'Reply to this post' : 'Reply in thread'}
        people={members.filter((m) => m.id !== meId)}
        mentionable
        reply={reply}
        replyName={reply ? (reply.senderId === meId ? 'yourself' : (peopleAll[reply.senderId]?.displayName ?? 'them')) : ''}
        editing={null}
        onCancel={() => setReply(null)}
        onSend={(t) => void send(t)}
        onTyping={() => undefined}
        onAttach={() => cxSay('Photos and files in threads are coming soon on phones.')}
      />
    </KeyboardAvoidingView>
  )
}

// ───────────── A forum nebula (board 21) ─────────────

export function ForumList({ c, n }: { c: ConstellationDetail; n: Nebula }) {
  const people = useStore((s) => s.people)
  const insets = useSafeAreaInsets()
  const [tag, setTag] = useState('')
  const [q, setQ] = useState('')
  const [list, setList] = useState<ThreadSummary[] | null>(null)
  const tags = n.forum?.tags ?? []
  const load = useCallback(() => {
    void threadsApi.list(c.id, n.id, { tag: tag || undefined, q: q.trim() || undefined }).then((r) => (r.ok ? setList(r.data.threads) : cxSay(r.message)))
  }, [c.id, n.id, tag, q])
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, q])
  useEffect(
    () =>
      onLive((event, payload) => {
        if (event !== 'cx') return
        const e = payload as ServerEvent
        const nid = e.type === 'thread:deleted' ? e.nebulaId : e.type === 'thread:message' || e.type === 'thread:updated' ? e.thread.nebulaId : null
        if (nid === n.id) load()
      }),
    [load, n.id],
  )
  const nameOf = (id: string | null) => (id ? (c.members.find((m) => m.user.id === id)?.user.displayName ?? people[id]?.displayName ?? 'Someone') : 'Someone')
  return (
    <View style={{ flex: 1, backgroundColor: N.bg }}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 12, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/constellations/[cid]', params: { cid: c.id } }))} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
          <Text size={26} style={{ color: N.ink }}>
            ‹
          </Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text size={17} weight="bold" style={{ color: N.ink }}>
            {n.name}
          </Text>
          <Text size={12} style={{ color: N.ink2 }}>
            {c.name}
            {list ? ` · ${list.length}${list.length >= 30 ? '+' : ''} posts` : ''}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New post"
          disabled={!!c.me.timedOutUntil}
          onPress={() => router.push({ pathname: '/constellations/[cid]/new-post', params: { cid: c.id, nid: n.id } })}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: N.orange, alignItems: 'center', justifyContent: 'center', opacity: c.me.timedOutUntil ? 0.4 : 1 }}
        >
          <Text size={24} style={{ color: '#2a1406', lineHeight: 28 }}>
            +
          </Text>
        </Pressable>
      </View>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search posts"
          placeholderTextColor={N.faint}
          style={{ height: 38, borderRadius: 19, paddingHorizontal: 14, backgroundColor: N.card, color: N.ink, fontSize: 15 }}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 10, gap: 6 }}>
        {[{ id: '', name: 'All' }, ...tags].map((t) => {
          const on = tag === t.id
          return (
            <Pressable key={t.id || 'all'} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setTag(on && t.id ? '' : t.id)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15, backgroundColor: on ? N.ink : 'transparent', borderWidth: on ? 0 : 1, borderColor: N.edge2 }}>
              <Text size={13} weight={on ? 'bold' : 'regular'} style={{ color: on ? N.bg : N.ink }}>
                {t.name}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
      <FlatList
        data={list ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 20, gap: 10 }}
        ListEmptyComponent={
          list ? (
            <Text size={14} style={{ color: N.ink2, textAlign: 'center', marginTop: 30 }}>
              {q || tag ? 'No posts match.' : 'No posts yet. Ask a question or share a guide.'}
            </Text>
          ) : null
        }
        renderItem={({ item: t }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/constellations/[cid]/thread/[tid]', params: { cid: c.id, tid: t.id, nid: n.id } })}
            style={({ pressed }) => ({ padding: 14, borderRadius: 14, backgroundColor: N.card, borderWidth: 1, borderColor: t.unread > 0 ? '#7a4a22' : '#2f241e', gap: 6, opacity: pressed ? 0.8 : 1 })}
          >
            {t.tagIds.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {t.tagIds.map((id) => tags.find((x) => x.id === id)).filter((x): x is ForumTag => !!x).map((x) => (
                  <TagChipN key={x.id} tag={x} />
                ))}
              </View>
            ) : null}
            <Text display size={16} style={{ color: N.ink }}>
              {t.pinned ? '📌 ' : ''}
              {t.title}
            </Text>
            {t.preview ? (
              <Text size={13} numberOfLines={1} style={{ color: N.ink2 }}>
                {t.preview}
              </Text>
            ) : null}
            <Text size={12} style={{ color: N.ink2 }}>
              {nameOf(t.authorId)} · 💬 {t.replyCount} · {ago(t.lastMessageAt)}
              {t.unread > 0 ? <Text size={12} weight="bold" style={{ color: N.amber }}> · new replies</Text> : null}
            </Text>
          </Pressable>
        )}
      />
    </View>
  )
}

// ───────────── New post ─────────────

export function NewPostScreen({ c, n }: { c: ConstellationDetail; n: Nebula }) {
  const staff = staffIn(c)
  const tags = n.forum?.tags ?? []
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const needTag = !!n.forum?.requireTag && tags.some((t) => !t.staffOnly || staff)
  const post = async () => {
    setBusy(true)
    const made = await threadsApi.start(c.id, n.id, { title, tagIds: picked })
    if (!made.ok) {
      setBusy(false)
      return cxSay(made.message)
    }
    const sent = await threadsApi.send(n.conversationId, made.data.thread.id, body.trim())
    setBusy(false)
    if (!sent.ok) {
      void threadsApi.remove(c.id, made.data.thread.id)
      return cxSay(sent.message)
    }
    haptic.success()
    router.replace({ pathname: '/constellations/[cid]/thread/[tid]', params: { cid: c.id, tid: made.data.thread.id, nid: n.id } })
  }
  const field = { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: N.card, color: N.ink, fontSize: 15, borderWidth: 1, borderColor: N.edge } as const
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: N.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <NightHeader title={`New post in #${n.name}`} close />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        {n.forum?.guidelines ? (
          <View style={{ padding: 12, borderRadius: 12, backgroundColor: N.card2 }}>
            <Text size={13} style={{ color: N.ink2, lineHeight: 19 }}>
              {n.forum.guidelines}
            </Text>
          </View>
        ) : null}
        <View style={{ gap: 6 }}>
          <Text size={13} weight="bold" style={{ color: N.ink2 }}>
            Title
          </Text>
          <TextInput value={title} onChangeText={setTitle} maxLength={THREAD_TITLE_MAX} placeholder="What's it about?" placeholderTextColor={N.faint} style={field} />
        </View>
        {tags.length ? (
          <View style={{ gap: 6 }}>
            <Text size={13} weight="bold" style={{ color: N.ink2 }}>
              Tags {needTag ? '(pick at least one, ' : '('}up to {POST_TAGS_MAX})
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {tags.map((t) => {
                const on = picked.includes(t.id)
                return <TagChipN key={t.id} tag={t} on={on} locked={t.staffOnly && !staff} onPress={() => setPicked(on ? picked.filter((x) => x !== t.id) : [...picked, t.id].slice(0, POST_TAGS_MAX))} />
              })}
            </View>
          </View>
        ) : null}
        <View style={{ gap: 6 }}>
          <Text size={13} weight="bold" style={{ color: N.ink2 }}>
            Message
          </Text>
          <TextInput value={body} onChangeText={setBody} multiline maxLength={4000} style={[field, { minHeight: 140, textAlignVertical: 'top' }]} />
        </View>
        <NightButton label="Post" busy={busy} disabled={!title.trim() || !body.trim() || (needTag && !picked.length)} onPress={() => void post()} />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
