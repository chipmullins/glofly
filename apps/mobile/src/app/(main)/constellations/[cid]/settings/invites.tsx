import { useEffect, useState } from 'react'
import { Pressable, Share, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { DEFAULT_LINK_LIFETIME, LINK_LIFETIMES, constellationLink, type ConstellationLink, type LinkLifetime } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { useStore } from '@/state/store'
import { cxSay } from '@/state/constellations'
import { firstName } from '@/lib/format'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/icons'
import { Spinner, Text } from '@/ui/kit'
import { haptic } from '@/constellations/motion'
import { can } from '@/constellations/roles'
import { SettingsScreen, useSettingsDetail } from '@/constellations/settingsKit'
import { AmberSegmented, Caps, Card, N, NightButton, SearchBox } from '@/constellations/ui'

// Invites (canvas board 7): the invite link (copy, how long it works, share), your other links,
// and friends to invite (they see it on their dashboard).

function lifetimeOf(l: ConstellationLink): LinkLifetime {
  if (!l.expiresAt) return 'never'
  const ms = new Date(l.expiresAt).getTime() - new Date(l.createdAt).getTime()
  let best: LinkLifetime = DEFAULT_LINK_LIFETIME
  let diff = Infinity
  for (const x of LINK_LIFETIMES) if (x.ms !== null && Math.abs(x.ms - ms) < diff) {
    diff = Math.abs(x.ms - ms)
    best = x.id
  }
  return best
}

export default function InvitesScreen() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useSettingsDetail(cid)
  const friends = useStore((s) => s.friends.friends)
  const [links, setLinks] = useState<ConstellationLink[] | null>(null)
  const [making, setMaking] = useState(false)
  const [q, setQ] = useState('')
  const [invited, setInvited] = useState<string[]>([])
  const allowed = !!c && can(c, 'invite')

  useEffect(() => {
    if (allowed) void cx.links(cid).then((r) => (r.ok ? setLinks(r.data.links) : cxSay(r.message)))
  }, [allowed, cid])

  if (!c) return <SettingsScreen title="Invite" c={null}>{null}</SettingsScreen>
  if (!allowed) {
    return (
      <SettingsScreen title={`Invite to ${c.name}`} c={c}>
        <Text size={14} style={{ color: N.muted }}>
          Your role can't invite people here.
        </Text>
      </SettingsScreen>
    )
  }
  const link = links?.[0] ?? null
  const url = link ? `https://${constellationLink(link.code)}` : ''

  async function make(lifetime: LinkLifetime) {
    setMaking(true)
    const r = await cx.addLink(cid, lifetime)
    setMaking(false)
    if (!r.ok) return cxSay(r.message)
    haptic.success()
    setLinks((l) => [r.data.link, ...(l ?? [])])
  }
  async function copy(l: ConstellationLink) {
    await Clipboard.setStringAsync(`https://${constellationLink(l.code)}`)
    haptic.light()
    cxSay('Link copied.')
  }
  async function revoke(l: ConstellationLink) {
    const r = await cx.revokeLink(cid, l.id)
    if (!r.ok) return cxSay(r.message)
    setLinks((list) => list?.filter((x) => x.id !== l.id) ?? null)
  }
  async function invite(id: string) {
    const r = await cx.invite(cid, [id])
    if (!r.ok) return cxSay(r.message)
    haptic.success()
    setInvited((l) => [...l, id])
  }

  const memberIds = new Set(c.members.map((m) => m.user.id))
  const t = q.trim().toLowerCase()
  const shown = friends
    .filter((f) => !t || f.displayName.toLowerCase().includes(t) || f.username.toLowerCase().includes(t))
    .sort((a, b) => Number(memberIds.has(a.id)) - Number(memberIds.has(b.id)) || a.displayName.localeCompare(b.displayName))
    .slice(0, 60)

  return (
    <SettingsScreen title={`Invite to ${c.name}`} c={c}>
      <Card style={{ padding: 14, gap: 12 }}>
        <Caps>Invite link</Caps>
        {links === null ? (
          <Spinner />
        ) : link ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, paddingLeft: 14, paddingRight: 6, borderRadius: 14, backgroundColor: N.bg, borderWidth: 1, borderColor: N.edge }}>
              <Text size={15} weight="medium" numberOfLines={1} selectable style={{ flex: 1, color: N.tag }}>
                {constellationLink(link.code)}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Copy the link" onPress={() => void copy(link)} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: N.amber, justifyContent: 'center' }}>
                <Text size={13} weight="bold" style={{ color: N.amberInk }}>
                  Copy
                </Text>
              </Pressable>
            </View>
            <Text size={12} style={{ color: N.muted }}>
              {link.uses} used{link.maxUses ? ` of ${link.maxUses}` : ''} · {link.expiresAt ? `works until ${new Date(link.expiresAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : 'never expires'}
            </Text>
          </>
        ) : (
          <Text size={14} style={{ color: N.muted }}>
            No working links. Pick how long one works to make it.
          </Text>
        )}
        <Caps>Expires after</Caps>
        <AmberSegmented
          label="Expires after"
          options={LINK_LIFETIMES.map((l) => ({ id: l.id, name: l.name }))}
          value={link ? lifetimeOf(link) : DEFAULT_LINK_LIFETIME}
          onChange={(v) => {
            haptic.select()
            void make(v)
          }}
        />
        <Text size={11} style={{ color: N.faint }}>
          Picking a time makes a new link. Old links keep working until they run out or you turn them off.
        </Text>
        {link ? (
          <NightButton icon="share" label="Share link" busy={making} onPress={() => void Share.share({ message: `Join ${c.name} on Glofly: ${url}`, url })} />
        ) : (
          <NightButton label="Make a link" busy={making} onPress={() => void make(DEFAULT_LINK_LIFETIME)} />
        )}
      </Card>
      {links && links.length > 1 ? (
        <>
          <Caps>Other links</Caps>
          <Card>
            {links.slice(1).map((l, i, all) => (
              <View key={l.id} style={{ minHeight: 56, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: i === all.length - 1 ? 0 : 1, borderBottomColor: N.line }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text size={14} weight="medium" numberOfLines={1}>
                    {constellationLink(l.code)}
                  </Text>
                  <Text size={12} style={{ color: N.muted }} numberOfLines={1}>
                    {l.uses} used · {l.expiresAt ? `until ${new Date(l.expiresAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : 'never expires'}
                    {l.createdBy ? ` · by ${firstName(l.createdBy.displayName, l.createdBy.username)}` : ''}
                  </Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Copy" onPress={() => void copy(l)} hitSlop={6} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="copy" size={18} color={N.ink2} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Turn this link off" onPress={() => void revoke(l)} hitSlop={6} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="trash" size={18} color={N.redText} />
                </Pressable>
              </View>
            ))}
          </Card>
        </>
      ) : null}
      {link ? (
        <Pressable accessibilityRole="button" onPress={() => void revoke(link)} style={{ alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' }}>
          <Text size={13} weight="bold" style={{ color: N.redText }}>
            Turn off this link
          </Text>
        </Pressable>
      ) : null}
      <Caps>Invite friends</Caps>
      <SearchBox value={q} onChange={setQ} placeholder="Search friends" />
      <View>
        {shown.map((f) => {
          const here = memberIds.has(f.id)
          const done = invited.includes(f.id)
          return (
            <View key={f.id} style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 }}>
              <Avatar user={f} size={38} />
              <Text size={15} weight="bold" numberOfLines={1} style={{ flex: 1 }}>
                {f.displayName}
                {here ? <Text size={12} style={{ color: N.faint }}>{'  already here'}</Text> : null}
              </Text>
              {here ? null : done ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="check" size={14} color={N.greenText} strokeWidth={2.6} />
                  <Text size={13} weight="bold" style={{ color: N.greenText }}>
                    Invited
                  </Text>
                </View>
              ) : (
                <Pressable accessibilityRole="button" accessibilityLabel={`Invite ${f.displayName}`} onPress={() => void invite(f.id)} style={{ height: 36, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: N.amber, justifyContent: 'center' }}>
                  <Text size={13} weight="bold" style={{ color: N.amber }}>
                    Invite
                  </Text>
                </Pressable>
              )}
            </View>
          )
        })}
        {!shown.length ? (
          <Text size={14} style={{ color: N.muted, paddingVertical: 8 }}>
            {friends.length ? 'No friends by that name.' : 'Add friends in Glofly to invite them here.'}
          </Text>
        ) : null}
      </View>
    </SettingsScreen>
  )
}
