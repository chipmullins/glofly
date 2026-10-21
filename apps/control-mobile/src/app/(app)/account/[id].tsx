import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { api, type AccountDetail } from '@control/api'
import { ago, bytes, plural, shortDate, when } from '@control/format'
import { Avatar, Card, Chip, Muted, Screen, Status, Text } from '@/ui/kit'
import { Icon, type IconName } from '@/ui/icons'
import { c } from '@/ui/theme'
import { openSheet } from '@/ui/ConfirmSheet'
import { useLoad } from '@/lib/hooks'
import { useSession } from '@/state/session'
import { STATUS_CHIP } from '@/lib/labels'

// One account (Account.dc.html): who they are, counts, facts, and what Control can do for them.

function deviceLabel(d: AccountDetail['account']['devices'][number]): string {
  const name = d.deviceName?.trim() || 'App'
  return d.appVersion ? `${name} ${d.appVersion}` : name
}

export default function Account() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const me = useSession((s) => s.admin)
  const { data, error, loading, refreshing, refresh, reload } = useLoad(() => api.account(id), [id])
  const [more, setMore] = useState(false)
  const a = data?.account
  const isMe = !!a && a.id === me?.userId

  if (!a)
    return (
      <Screen back="Accounts">
        <Status loading={loading} error={error} onRetry={refresh} />
      </Screen>
    )

  const who = `@${a.username}`
  const act = (path: string, body: Record<string, unknown> = {}) => (note: string) => api.accountAction(a.id, path, { ...body, note })
  const online = a.devices.find((d) => d.online)
  const status = STATUS_CHIP[a.status]

  const actions: { label: string; icon: IconName; danger?: boolean; isNew?: boolean; onPress: () => void; hidden?: boolean }[] = [
    { label: 'Message as Glofly team', icon: 'teamMessage', isNew: true, onPress: () => router.push(`/message/${a.id}`) },
    {
      label: 'Add a friend for them',
      icon: 'addFriend',
      isNew: true,
      onPress: () =>
        openSheet({
          title: `Add a friend for ${who}`,
          explanation: 'They become friends right away (no request). Both see it in their friends list.',
          action: 'Add friend',
          fields: [{ kind: 'text', key: 'username', label: 'Friend’s username', autoCapitalize: 'none', placeholder: 'username' }],
          validate: (v) => (String(v.username ?? '').trim().replace(/^@/, '').length < 2 ? 'Type their username.' : null),
          run: (note, v) => api.addFriendFor(a.id, String(v.username).trim().replace(/^@/, ''), note),
          done: 'Friend added.',
          onDone: reload,
        }),
    },
    {
      label: 'Inbox thread',
      icon: 'inbox',
      onPress: () => router.push(`/inbox/${a.id}`),
    },
    {
      label: 'Sign out all devices',
      icon: 'signOut',
      onPress: () =>
        openSheet({
          title: `Sign ${who} out everywhere?`,
          explanation: `Ends ${plural(a.devices.length, 'session')}. They can sign in again with their password.`,
          action: 'Sign out all devices',
          run: act('sign-out'),
          done: 'Signed out everywhere.',
          onDone: reload,
        }),
    },
    {
      label: 'Send password reset',
      icon: 'key',
      onPress: () =>
        openSheet({
          title: 'Send a password reset?',
          explanation: `An email with a reset link goes to ${a.email}.`,
          action: 'Send reset email',
          run: act('password-reset'),
          done: 'Reset email sent.',
        }),
    },
    a.status === 'suspended'
      ? {
          label: 'Unsuspend',
          icon: 'undo',
          onPress: () =>
            openSheet({
              title: `Unsuspend ${who}?`,
              explanation: 'They can sign in and use Glofly again.',
              action: 'Unsuspend',
              faceId: true,
              run: act('unsuspend'),
              done: 'Account unsuspended.',
              onDone: reload,
            }),
        }
      : {
          label: 'Suspend',
          icon: 'ban',
          danger: true,
          hidden: a.status === 'deleting',
          onPress: () =>
            openSheet({
              title: `Suspend ${who}?`,
              explanation: isMe
                ? "You can't suspend your own account."
                : 'They’re signed out everywhere and see your reason when they try to log in.',
              action: 'Suspend',
              danger: true,
              faceId: true,
              fields: [{ kind: 'text', key: 'reason', label: 'Reason they see', multiline: true, maxLength: 200 }],
              validate: (v) => (String(v.reason ?? '').trim().length < 3 ? 'Write the reason they’ll see.' : null),
              run: (note, v) => api.accountAction(a.id, 'suspend', { reason: String(v.reason).trim(), note }),
              done: 'Account suspended.',
              onDone: reload,
            }),
        },
    { label: more ? 'Less' : 'More: username, email, delete…', icon: 'more', onPress: () => setMore(!more) },
  ]

  const moreActions: { label: string; icon: IconName; danger?: boolean; onPress: () => void; hidden?: boolean }[] = [
    {
      label: 'Change username',
      icon: 'user',
      onPress: () =>
        openSheet({
          title: 'Change username',
          explanation: `They’ll sign in and be found as the new name. ${who} becomes free for others.`,
          action: 'Change username',
          fields: [{ kind: 'text', key: 'username', label: 'New username', initial: a.username, autoCapitalize: 'none' }],
          validate: (v) => (String(v.username).trim() === a.username ? 'That’s the same username.' : null),
          run: (note, v) => api.accountAction(a.id, 'username', { username: String(v.username).trim().replace(/^@/, ''), note }),
          done: 'Username changed.',
          onDone: reload,
        }),
    },
    {
      label: 'Change email',
      icon: 'mail',
      onPress: () =>
        openSheet({
          title: 'Change email',
          explanation: 'The new address gets a confirmation email.',
          action: 'Change email',
          fields: [{ kind: 'text', key: 'email', label: 'New email', initial: a.pendingEmail ?? a.email, autoCapitalize: 'none', keyboard: 'email-address' }],
          run: (note, v) => api.accountAction(a.id, 'email', { email: String(v.email).trim(), note }),
          done: 'Email changed.',
          onDone: reload,
        }),
    },
    {
      label: 'Resend confirm email',
      icon: 'mail',
      hidden: a.emailVerified && !a.pendingEmail,
      onPress: () =>
        openSheet({
          title: 'Resend the confirmation email?',
          explanation: `To ${a.pendingEmail ?? a.email}.`,
          action: 'Resend',
          run: act('confirm-email'),
          done: 'Confirmation email sent.',
        }),
    },
    {
      label: 'Cancel deletion',
      icon: 'undo',
      hidden: a.status !== 'deleting',
      onPress: () =>
        openSheet({
          title: 'Cancel the deletion?',
          explanation: 'The account stays and works normally again.',
          action: 'Cancel deletion',
          run: act('cancel-deletion'),
          done: 'Deletion cancelled.',
          onDone: reload,
        }),
    },
    {
      label: 'Delete now',
      icon: 'trash',
      danger: true,
      onPress: () =>
        openSheet({
          title: `Delete ${who} now?`,
          explanation: 'Their account, messages and files are deleted for good. This can’t be undone. Type the username to confirm.',
          action: 'Delete account',
          danger: true,
          faceId: true,
          fields: [{ kind: 'text', key: 'confirm', label: `Type ${a.username}`, autoCapitalize: 'none' }],
          validate: (v) => (String(v.confirm).trim().replace(/^@/, '').toLowerCase() !== a.username.toLowerCase() ? `Type ${a.username} exactly to confirm.` : null),
          run: (note, v) => api.accountAction(a.id, 'delete', { confirmUsername: String(v.confirm).trim().replace(/^@/, ''), note }),
          done: 'Account deleted.',
          onDone: () => router.back(),
        }),
    },
  ]

  const facts: [string, string][] = [
    ['Email', a.pendingEmail ? `changing to ${a.pendingEmail}` : a.emailVerified ? 'confirmed' : 'not confirmed'],
    ['Joined', `${shortDate(a.createdAt)}${a.invitedBy ? ` · invited by ${a.invitedBy}` : a.inviteCode ? ` · code ${a.inviteCode.label || a.inviteCode.code}` : ''}`],
    ['Last seen', a.online ? 'online now' : a.lastSeenAt ? when(a.lastSeenAt) : 'never'],
    ['Devices', a.devices.length ? a.devices.map(deviceLabel).join(' · ') : 'none signed in'],
  ]
  if (a.suspendedAt) facts.push(['Suspended', `${ago(a.suspendedAt)}${a.suspendReason ? ` · “${a.suspendReason}”` : ''}`])
  if (a.deleteAfter) facts.push(['Deleted on', shortDate(a.deleteAfter)])

  return (
    <Screen back="Accounts" onRefresh={refresh} refreshing={refreshing}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 2 }}>
        <Avatar id={a.id} name={a.displayName || a.username} size={60} online={a.online} />
        <View style={{ flex: 1 }}>
          <Text display weight="bold" size={22} accessibilityRole="header">
            {a.displayName || a.username}
          </Text>
          <Text size={14} color={c.muted}>
            {`${who}${a.online ? ` · online${online?.deviceName ? ` on ${online.deviceName}` : ''}` : ''}`}
          </Text>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            {status ? <Chip small label={status[0]} tone={status[1]} /> : null}
            {a.isAdmin ? <Chip small label="Admin" tone="hot" /> : null}
            {a.restricted ? <Chip small label="Family account" tone="frozen" /> : null}
          </View>
        </View>
      </View>

      <View accessibilityLabel="About this account" style={{ flexDirection: 'row', gap: 8 }}>
        {[
          [a.friends.toLocaleString('en-US'), 'Friends'],
          [a.groups.toLocaleString('en-US'), 'Groups'],
          a.constellations !== undefined ? [String(a.constellations), 'Constell.'] : [String(a.devices.length), 'Devices'],
          a.openReports !== undefined ? [String(a.openReports), 'Reports'] : [bytes(a.storageBytes), 'Files'],
        ].map(([n, label]) => (
          <View key={label} accessible accessibilityLabel={`${label}: ${n}`} style={{ flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 2 }}>
            <Text display weight="bold" size={19} numberOfLines={1} adjustsFontSizeToFit>
              {n}
            </Text>
            <Muted size={11.5}>{label}</Muted>
          </View>
        ))}
      </View>

      <Card style={{ paddingVertical: 2 }}>
        {facts.map(([k, v], i) => (
          <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: c.divider }}>
            <Text size={13.5} color={c.muted}>
              {k}
            </Text>
            <Text size={13.5} weight="medium" style={{ flex: 1, textAlign: 'right' }}>
              {v}
            </Text>
          </View>
        ))}
      </Card>

      <Card pad={6}>
        {actions.filter((x) => !x.hidden).map((x, i) => (
          <ActionRow key={x.label} {...x} first={i === 0} />
        ))}
        {more ? moreActions.filter((x) => !x.hidden).map((x) => <ActionRow key={x.label} {...x} />) : null}
      </Card>

      {data.history.length ? (
        <Card style={{ paddingBottom: 6 }}>
          <Text display weight="semi" size={16} style={{ marginTop: 12, marginBottom: 4 }}>
            Control history
          </Text>
          {data.history.slice(0, 10).map((h) => (
            <View key={h.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.divider }}>
              <Text size={13.5} weight="semi">
                {h.action}
              </Text>
              <Muted>{[when(h.createdAt), h.adminUsername ? `@${h.adminUsername}` : null, h.note].filter(Boolean).join(' · ')}</Muted>
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  )
}

function ActionRow({ label, icon, danger, isNew, onPress, first }: { label: string; icon: IconName; danger?: boolean; isNew?: boolean; onPress: () => void; first?: boolean }) {
  const color = danger ? c.dangerText : c.ink
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 48,
        paddingHorizontal: 8,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: c.divider,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={20} color={color} width={1.9} />
      <Text size={14.5} weight="medium" color={color} style={{ flex: 1, paddingVertical: 10 }}>
        {label}
      </Text>
      {isNew ? (
        <View style={{ backgroundColor: c.warnSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text size={11} weight="bold" color={c.warnText}>
            New
          </Text>
        </View>
      ) : null}
    </Pressable>
  )
}
