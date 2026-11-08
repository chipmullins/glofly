import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { Image } from 'expo-image'
import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  STATUS_CLEAR_AFTER,
  STATUS_CLEAR_LABEL,
  STATUS_LABEL,
  STATUS_TEXT_MAX,
  dotFor,
  displayNameProblem,
  statusClearChoiceFor,
  statusClearEndsAt,
  statusEndsLine,
  type MyStatusChoice,
  type StatusClearAfter,
  BOARD_TILES_MAX,
  DEFAULT_PROFILE_PRIVACY,
  PRONOUNS_MAX,
  PRONOUN_PICKS,
  type BoardTile,
  type ProfileAudience,
  type ProfileHeader,
  type ProfilePrivacy,
} from '@glofly/shared'
import { pickHeaderPhoto } from '@/lib/photos'
import { ProfileHeaderImage } from '@/profiles/Board'
import { TILE_NAMES, setDraftBoard, useBoardDraft } from '@/profiles/draft'
import * as api from '@/api/glofly'
import { refreshMe } from '@/api/auth'
import { useSession } from '@/state/session'
import { useStore } from '@/state/store'
import { refreshStatus } from '@/state/sync'
import { pickSquarePhoto } from '@/lib/photos'
import type { Upload } from '@/api/http'
import { Avatar, StatusDot } from '@/ui/Avatar'
import { chooseFrom, confirm, inform } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Field, Notice, Spinner, Text } from '@/ui/kit'
import { Screen } from '@/ui/Screen'
import { useTheme } from '@/ui/theme'
import { APP_SETTINGS } from '@/lib/config'

// Edit profile (from the design): photo, status, display name, status message (0.8.0: with
// "Clear after"), About me.

/** This phone's time zone, so "Today" and "This week" end at your own midnight. */
function localTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

export default function EditProfile() {
  const { c } = useTheme()
  const user = useSession((s) => s.user)
  const myStatus = useStore((s) => s.myStatus)
  const [loaded, setLoaded] = useState(false)
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [bio, setBio] = useState('')
  const [statusText, setStatusText] = useState(myStatus?.statusText ?? '')
  const [status, setStatus] = useState<MyStatusChoice>(myStatus?.status ?? 'online')
  const [photo, setPhoto] = useState<Upload | 'remove' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clear, setClear] = useState<StatusClearAfter>('never')
  const [endsAt, setEndsAt] = useState<string | null>(null)
  const [original, setOriginal] = useState({ displayName: '', bio: '', statusText: '', status: 'online' as MyStatusChoice, clear: 'never' as StatusClearAfter })
  // 0.9.1 profiles: header, pronouns, board, who sees what.
  const [header, setHeader] = useState<Upload | 'remove' | null>(null)
  const [savedHeader, setSavedHeader] = useState<ProfileHeader>(null)
  const [pronouns, setPronouns] = useState('')
  const [privacy, setPrivacy] = useState<ProfilePrivacy>(DEFAULT_PROFILE_PRIVACY)
  const board = useBoardDraft((s) => s.board)
  const [extras, setExtras] = useState({ pronouns: '', board: '[]', privacy: JSON.stringify(DEFAULT_PROFILE_PRIVACY) })

  useEffect(() => {
    void Promise.all([api.getMyProfile(), api.getMyStatus()]).then(([p, s]) => {
      const o = {
        displayName: p.ok ? p.data.displayName : (user?.displayName ?? ''),
        bio: p.ok ? (p.data.bio ?? '') : '',
        statusText: s.ok ? (s.data.statusText ?? '') : '',
        status: s.ok ? s.data.status : ('online' as MyStatusChoice),
        // The status's own "Clear after" if it has an end, else Never.
        clear: s.ok && s.data.statusText ? statusClearChoiceFor(s.data.statusTextEndsAt) : ('never' as StatusClearAfter),
      }
      if (p.ok) {
        setSavedHeader(p.data.header ?? null)
        setPronouns(p.data.pronouns ?? '')
        setPrivacy(p.data.privacy ?? DEFAULT_PROFILE_PRIVACY)
        setDraftBoard(p.data.boardSource ?? [])
        setExtras({ pronouns: p.data.pronouns ?? '', board: JSON.stringify(p.data.boardSource ?? []), privacy: JSON.stringify(p.data.privacy ?? DEFAULT_PROFILE_PRIVACY) })
      }
      setEndsAt(s.ok ? (s.data.statusTextEndsAt ?? null) : null)
      setClear(o.clear)
      setOriginal(o)
      setDisplayName(o.displayName)
      setBio(o.bio)
      setStatusText(o.statusText)
      setStatus(o.status)
      setLoaded(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const extrasChanged = header !== null || pronouns.trim() !== extras.pronouns || JSON.stringify(board) !== extras.board || JSON.stringify(privacy) !== extras.privacy
  const changed = extrasChanged || photo !== null || displayName !== original.displayName || bio !== original.bio || statusText !== original.statusText || status !== original.status || (clear !== original.clear && !!statusText.trim())

  async function choosePhoto() {
    const hasPhoto = photo ? photo !== 'remove' : !!user?.avatarVersion
    const pick = await chooseFrom(
      [
        { key: 'library', label: 'Choose a photo', icon: 'photo' },
        { key: 'camera', label: 'Take a photo', icon: 'camera' },
        ...(hasPhoto ? [{ key: 'remove', label: 'Remove photo', icon: 'trash' as const, danger: true }] : []),
      ],
      'Profile photo',
    )
    if (pick === 'remove') return setPhoto('remove')
    if (pick !== 'library' && pick !== 'camera') return
    const picked = await pickSquarePhoto(pick)
    if (picked === 'denied') return void inform('Camera not allowed', `Allow Glofly to use the camera in ${APP_SETTINGS}.`)
    if (picked) setPhoto(picked)
  }

  async function chooseStatus() {
    const pick = await chooseFrom(
      (['online', 'away', 'dnd', 'invisible'] as MyStatusChoice[]).map((s) => ({ key: s, label: STATUS_LABEL[s], checked: s === status })),
      'Status',
    )
    if (pick) setStatus(pick as MyStatusChoice)
  }

  async function chooseClear() {
    const pick = await chooseFrom(
      STATUS_CLEAR_AFTER.map((k) => ({ key: k, label: STATUS_CLEAR_LABEL[k], checked: k === clear })),
      'Clear after',
    )
    if (pick) setClear(pick as StatusClearAfter)
  }

  // The real end while nothing changed, else what it would be if saved now.
  const shownEnd =
    statusText === original.statusText && clear === original.clear && original.statusText
      ? endsAt
      : statusClearEndsAt(clear, new Date(), localTimeZone() ?? 'UTC')

  async function save() {
    const problem = displayNameProblem(displayName.trim())
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const failures: string[] = []
    if (header === 'remove') {
      const r = await api.removeHeader()
      if (!r.ok) failures.push(r.message)
    } else if (header) {
      const r = await api.setHeader(header)
      if (!r.ok) failures.push(r.message)
    }
    const boardChanged = JSON.stringify(board) !== extras.board
    const privacyChanged = JSON.stringify(privacy) !== extras.privacy
    const pronounsChanged = pronouns.trim() !== extras.pronouns
    if (displayName.trim() !== original.displayName || bio !== original.bio || boardChanged || privacyChanged || pronounsChanged) {
      const r = await api.updateProfile({
        displayName: displayName.trim(),
        bio: bio.trim() || null,
        ...(pronounsChanged ? { pronouns: pronouns.trim() || null } : {}),
        ...(boardChanged ? { board } : {}),
        ...(privacyChanged ? { privacy } : {}),
      })
      if (!r.ok) failures.push(r.message)
    }
    const clearChanged = clear !== original.clear && !!statusText.trim()
    if (statusText !== original.statusText || status !== original.status || clearChanged) {
      const text = statusText.trim()
      const r = await api.setMyStatus(
        text && (statusText !== original.statusText || clearChanged)
          ? { status, statusText: text, statusClearAfter: clear, timeZone: localTimeZone() }
          : statusText !== original.statusText
            ? { status, statusText: text }
            : { status },
      )
      if (!r.ok) failures.push(r.message)
    }
    if (photo === 'remove') {
      const r = await api.removeAvatar()
      if (!r.ok) failures.push(r.message)
    } else if (photo) {
      const r = await api.setAvatar(photo)
      if (!r.ok) failures.push(r.message)
    }
    await Promise.all([refreshMe(), refreshStatus()])
    setBusy(false)
    if (failures.length) return setError(failures[0])
    router.back()
  }

  async function chooseHeader() {
    const has = header ? header !== 'remove' : !!savedHeader
    const pick = await chooseFrom(
      [
        { key: 'library', label: 'Choose a picture', icon: 'photo' },
        ...(has ? [{ key: 'remove', label: 'Use the night sky', icon: 'trash' as const }] : []),
      ],
      'Header image',
    )
    if (pick === 'remove') return setHeader(savedHeader ? 'remove' : null)
    if (pick !== 'library') return
    const picked = await pickHeaderPhoto()
    if (picked) setHeader(picked)
  }

  async function tileMenu(i: number) {
    const t = board[i]
    const pick = await chooseFrom(
      [
        ...(t.kind !== 'playing' ? [{ key: 'edit', label: 'Edit', icon: 'pencil' as const }] : []),
        ...(i > 0 ? [{ key: 'up', label: 'Move up', icon: 'arrowUp' as const }] : []),
        ...(i < board.length - 1 ? [{ key: 'down', label: 'Move down', icon: 'arrowDown' as const }] : []),
        { key: 'remove', label: 'Remove from your board', icon: 'trash', danger: true },
      ],
      TILE_NAMES[t.kind],
    )
    const swap = (a: number, b: number) => {
      const next = [...board]
      ;[next[a], next[b]] = [next[b], next[a]]
      setDraftBoard(next)
    }
    if (pick === 'edit') router.push({ pathname: '/edit-board', params: { kind: t.kind, index: String(i) } })
    else if (pick === 'up') swap(i, i - 1)
    else if (pick === 'down') swap(i, i + 1)
    else if (pick === 'remove') setDraftBoard(board.filter((_, n) => n !== i))
  }

  async function chooseAudience(key: keyof ProfilePrivacy, title: string) {
    const labels: Record<ProfileAudience, string> = { everyone: key === 'mutuals' ? 'People who share them' : 'Everyone', friends: 'Friends', only_me: 'Only me' }
    const pick = await chooseFrom(
      (['everyone', 'friends', 'only_me'] as ProfileAudience[]).map((a) => ({ key: a, label: labels[a], checked: privacy[key] === a })),
      title,
    )
    if (pick) setPrivacy((p) => ({ ...p, [key]: pick as ProfileAudience }))
  }

  const tileSummary = (t: BoardTile) =>
    t.kind === 'games' ? `${t.games.length} ${t.games.length === 1 ? 'game' : 'games'}` : t.kind === 'into' ? `${t.tags.length}` : t.kind === 'note' ? '' : t.kind === 'playing' ? 'Live' : ''
  const audienceLabel = (key: keyof ProfilePrivacy) =>
    privacy[key] === 'everyone' ? (key === 'mutuals' ? 'People who share them' : 'Everyone') : privacy[key] === 'friends' ? 'Friends' : 'Only me'

  async function cancel() {
    if (changed && !(await confirm({ title: 'Discard changes?', confirmLabel: 'Discard', danger: true }))) return
    router.back()
  }

  if (!user) return null
  const shownPhoto = photo && photo !== 'remove' ? photo.uri : null

  return (
    <Screen
      title="Edit profile"
      onBack={() => void cancel()}
      right={
        <Pressable accessibilityRole="button" onPress={() => void save()} disabled={busy || !changed} style={{ height: 40, paddingHorizontal: 18, marginRight: 8, borderRadius: 20, backgroundColor: changed ? c.accent : c.surface, justifyContent: 'center', opacity: busy ? 0.6 : 1 }}>
          <Text size={15} weight="bold" style={{ color: changed ? c.accentInk : c.muted }}>
            {busy ? 'Saving…' : 'Save'}
          </Text>
        </Pressable>
      }
      contentStyle={{ padding: 20, gap: 18 }}
    >
      {!loaded ? <Spinner /> : null}
      {error ? <Notice>{error}</Notice> : null}
      <View style={{ borderRadius: 16, overflow: 'hidden' }}>
        <ProfileHeaderImage
          userId={user.id}
          header={header === 'remove' ? null : header ? { version: 'new', focus: 50 } : savedHeader}
          localUri={header && header !== 'remove' ? header.uri : null}
          height={110}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change header image"
          onPress={() => void chooseHeader()}
          style={{ position: 'absolute', right: 10, bottom: 10, minHeight: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: 'rgba(28,18,16,0.6)', justifyContent: 'center' }}
        >
          <Text size={12.5} weight="bold" style={{ color: '#FFFFFF' }}>
            Change header
          </Text>
        </Pressable>
      </View>
      <View style={{ alignItems: 'center', gap: 8, marginTop: -56 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Change profile photo" onPress={() => void choosePhoto()} style={{ borderRadius: 60, borderWidth: 4, borderColor: c.bg }}>
          {shownPhoto ? (
            <Image source={{ uri: shownPhoto }} style={{ width: 112, height: 112, borderRadius: 56 }} />
          ) : (
            <Avatar user={{ ...user, avatarVersion: photo === 'remove' ? null : user.avatarVersion }} size={112} />
          )}
          <View style={{ position: 'absolute', right: 0, bottom: 0, height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: c.accent, borderWidth: 3, borderColor: c.bg, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="camera" size={14} color={c.accentInk} />
            <Text size={12} weight="bold" style={{ color: c.accentInk }}>
              Edit
            </Text>
          </View>
        </Pressable>
      </View>
      <View style={{ gap: 6 }}>
        <Text size={14} weight="medium">
          Status
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Status: ${STATUS_LABEL[status]}. Change`} onPress={() => void chooseStatus()} style={{ height: 50, borderWidth: 1.5, borderColor: c.fieldLine, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <StatusDot status={dotFor(status)} size={12} />
          <Text size={16} style={{ flex: 1 }}>
            {STATUS_LABEL[status]}
          </Text>
          <Icon name="chevronDown" size={18} color={c.muted} />
        </Pressable>
      </View>
      <Field label={`Display name · ${displayName.length}/${DISPLAY_NAME_MAX}`} value={displayName} onChangeText={setDisplayName} maxLength={DISPLAY_NAME_MAX} accessibilityLabel="Display name" />
      <View style={{ gap: 8 }}>
        <Field label="Pronouns (optional)" value={pronouns} onChangeText={setPronouns} maxLength={PRONOUNS_MAX} placeholder="Type your own, or pick one" accessibilityLabel="Pronouns" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {PRONOUN_PICKS.map((p) => {
            const on = pronouns.trim() === p
            return (
              <Pressable key={p} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setPronouns(on ? '' : p)} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: on ? c.accent : c.fieldLine, backgroundColor: on ? c.accentSoft : 'transparent', justifyContent: 'center' }}>
                <Text size={13} weight="medium">
                  {p}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </View>
      <Field label={`Status message · ${statusText.length}/${STATUS_TEXT_MAX}`} value={statusText} onChangeText={setStatusText} maxLength={STATUS_TEXT_MAX} placeholder="What are you up to?" accessibilityLabel="Status message" />
      <View style={{ gap: 6, marginTop: -8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Clear after: ${STATUS_CLEAR_LABEL[clear]}. Change`} onPress={() => void chooseClear()} style={{ height: 50, borderRadius: 12, paddingHorizontal: 14, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text size={15} style={{ flex: 1 }}>
            Clear after: <Text size={15} weight="bold">{STATUS_CLEAR_LABEL[clear]}</Text>
          </Text>
          <Icon name="chevronDown" size={18} color={c.muted} />
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 }} accessibilityLiveRegion="polite">
          <Icon name="clock" size={15} color={c.accentText} />
          <Text size={13} tone="muted" style={{ flex: 1 }}>
            {statusEndsLine(shownEnd)}
          </Text>
        </View>
      </View>
      <Field label={`About me · ${bio.length}/${BIO_MAX}`} value={bio} onChangeText={setBio} maxLength={BIO_MAX} multiline style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: 12 }} accessibilityLabel="About me" />
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text size={11.5} weight="bold" tone="muted" style={{ flex: 1, letterSpacing: 0.9, textTransform: 'uppercase' }}>
            Your board · {board.length} of {BOARD_TILES_MAX}
          </Text>
          {board.length < BOARD_TILES_MAX ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Add to your board" onPress={() => router.push('/edit-board')} style={{ minHeight: 40, paddingHorizontal: 8, justifyContent: 'center' }}>
              <Text size={14} weight="bold" style={{ color: c.accentText }}>
                + Add
              </Text>
            </Pressable>
          ) : null}
        </View>
        {board.length ? (
          <View style={{ borderWidth: 1, borderColor: c.line, borderRadius: 14 }}>
            {board.map((t, i) => (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityLabel={`${TILE_NAMES[t.kind]}. Edit, move or remove`}
                onPress={() => void tileMenu(i)}
                style={{ minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderColor: c.line }}
              >
                <Text size={16} style={{ color: c.faint }}>≡</Text>
                <Text size={15} weight="bold" style={{ flex: 1 }}>
                  {TILE_NAMES[t.kind]}
                </Text>
                <Text size={13} tone="muted">
                  {tileSummary(t)}
                </Text>
                <Icon name="chevronRight" size={16} color={c.muted} />
              </Pressable>
            ))}
          </View>
        ) : (
          <Text size={13} tone="muted">
            Show off your favorite games, a constellation you love, a note or what you’re into.
          </Text>
        )}
      </View>
      <View style={{ gap: 2 }}>
        {(
          [
            ['board', 'Who sees your board'],
            ['activity', 'Who sees your activity'],
            ['mutuals', 'Mutual friends and constellations'],
          ] as const
        ).map(([key, title]) => (
          <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${title}: ${audienceLabel(key)}. Change`} onPress={() => void chooseAudience(key, title)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text size={15} weight="medium" style={{ flex: 1 }}>
              {title}
            </Text>
            <Text size={14} weight="bold" style={{ color: c.accentText }}>
              {audienceLabel(key)}
            </Text>
            <Icon name="chevronRight" size={16} color={c.accentText} />
          </Pressable>
        ))}
      </View>
      <View style={{ padding: 14, borderRadius: 14, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="lock" size={18} color={c.muted} />
        <Text size={15} weight="bold">
          @{user.username}
        </Text>
        <Text size={13} tone="muted">
          Usernames are permanent
        </Text>
      </View>
    </Screen>
  )
}
