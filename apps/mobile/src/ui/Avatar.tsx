import { View } from 'react-native'
import { Image } from 'expo-image'
import { colorsFor, initials, type ConversationSummary, type PresenceStatus, type PublicUser } from '@glofly/shared'
import { authHeaders, url } from '@/api/http'
import { Text } from './kit'
import { font, useTheme } from './theme'
import { Icon } from './icons'

// Profile photos (or initials), status dots, and group avatars (photo with a people badge, or
// two faces overlapping), as on the desktop app.

type Person = Pick<PublicUser, 'id' | 'displayName' | 'avatarVersion'>

export const avatarSource = (userId: string, version: string) => ({
  uri: url(`/avatars/${userId}/${version}`),
  headers: authHeaders(),
  cacheKey: `avatar-${userId}-${version}`,
})

export const groupPhotoSource = (chatId: string, version: string) => ({
  uri: url(`/conversations/${chatId}/photo/${version}`),
  headers: authHeaders(),
  cacheKey: `group-${chatId}-${version}`,
})

export function Avatar({ user, size = 40, status, ring, mobile }: { user: Person; size?: number; status?: PresenceStatus | null; ring?: string; mobile?: boolean }) {
  const { c } = useTheme()
  const [bg, fg] = colorsFor(user.id)
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {user.avatarVersion ? (
        <Image
          source={avatarSource(user.id, user.avatarVersion)}
          style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg }}
          cachePolicy="disk"
          transition={120}
        />
      ) : (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: fg, fontFamily: font.display, fontSize: Math.round(size * 0.36) }}>{initials(user.displayName)}</Text>
        </View>
      )}
      {status ? <StatusDot status={status} mobile={mobile} size={Math.max(10, Math.round(size * 0.3))} ring={ring ?? c.bg} style={{ position: 'absolute', right: -1, bottom: -1 }} /> : null}
    </View>
  )
}

export function StatusDot({ status, size = 12, ring, style, mobile }: { status: PresenceStatus; size?: number; ring?: string; style?: object; mobile?: boolean }) {
  const { c } = useTheme()
  const color = status === 'online' ? c.online : status === 'away' ? c.away : status === 'dnd' ? c.dnd : c.faint
  if (mobile && status !== 'offline') {
    // "Active on mobile": a small phone in the status color (0.3.0).
    const w = Math.round(size * 0.78)
    const h = Math.round(size * 1.18)
    return (
      <View style={[{ width: w, height: h, borderRadius: 3, backgroundColor: color, outlineWidth: 2, outlineColor: ring ?? c.bg }, style, { bottom: -2 }]}>
        <View style={{ position: 'absolute', left: w * 0.18, right: w * 0.18, top: h * 0.14, bottom: h * 0.26, borderRadius: 1, backgroundColor: ring ?? c.bg }} />
      </View>
    )
  }
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: status === 'offline' ? (ring ?? c.bg) : color,
          borderWidth: status === 'offline' ? Math.max(2, size * 0.22) : 0,
          borderColor: color,
          outlineWidth: 2.5,
          outlineColor: ring ?? c.bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {status === 'dnd' ? <View style={{ width: size * 0.55, height: Math.max(2, size * 0.16), borderRadius: 1, backgroundColor: ring ?? c.bg }} /> : null}
      {status === 'away' ? (
        <View style={{ position: 'absolute', left: -size * 0.12, top: -size * 0.12, width: size * 0.7, height: size * 0.7, borderRadius: size, backgroundColor: ring ?? c.bg }} />
      ) : null}
    </View>
  )
}

/** A group's avatar: its photo (with a small people badge so it isn't taken for a person) or two faces. */
export function GroupAvatar({ chat, size = 48, ring }: { chat: Extract<ConversationSummary, { kind: 'group' }>; size?: number; ring?: string }) {
  const { c } = useTheme()
  const edge = ring ?? c.bg
  if (chat.photoVersion) {
    const badge = Math.max(16, Math.round(size * 0.38))
    return (
      <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Image source={groupPhotoSource(chat.id, chat.photoVersion)} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.surface }} cachePolicy="disk" />
        <View
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: badge,
            height: badge,
            borderRadius: badge / 2,
            backgroundColor: c.surface2,
            borderWidth: 2,
            borderColor: edge,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="groups" size={badge * 0.66} color={c.ink2} strokeWidth={2.4} />
        </View>
      </View>
    )
  }
  const a = chat.members[0]
  const b = chat.members[1]
  const small = Math.round(size * 0.68)
  if (!a) return <Avatar user={{ id: chat.id, displayName: '?', avatarVersion: null }} size={size} />
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ position: 'absolute', left: 0, top: 0 }}>
        <Avatar user={a} size={small} />
      </View>
      <View style={{ position: 'absolute', right: 0, bottom: 0, borderRadius: small, borderWidth: 2.5, borderColor: edge }}>
        <Avatar user={b ?? a} size={small - 5} />
      </View>
    </View>
  )
}

/** Any chat's avatar: the person (with their status dot) or the group. */
export function ChatAvatar({ chat, size = 52, status, ring, mobile }: { chat: ConversationSummary; size?: number; status?: PresenceStatus | null; ring?: string; mobile?: boolean }) {
  if (chat.kind === 'group') return <GroupAvatar chat={chat} size={size} ring={ring} />
  return <Avatar user={chat.partner} size={size} status={status} ring={ring} mobile={mobile} />
}
