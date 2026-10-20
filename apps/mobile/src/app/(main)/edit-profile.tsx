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
} from '@glofly/shared'
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

  const changed = photo !== null || displayName !== original.displayName || bio !== original.bio || statusText !== original.statusText || status !== original.status || (clear !== original.clear && !!statusText.trim())

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
    if (displayName.trim() !== original.displayName || bio !== original.bio) {
      const r = await api.updateProfile({ displayName: displayName.trim(), bio: bio.trim() || null })
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
      <View style={{ alignItems: 'center', gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Change profile photo" onPress={() => void choosePhoto()}>
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
