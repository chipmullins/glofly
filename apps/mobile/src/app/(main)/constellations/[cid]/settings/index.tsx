import { View } from 'react-native'
import { router, useLocalSearchParams, type Href } from 'expo-router'
import { type ConstellationPermission } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { cxSay, refreshCards, useCx } from '@/state/constellations'
import { useSession } from '@/state/session'
import { confirm } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { haptic } from '@/constellations/motion'
import { NOTIFY_WORDS } from '@/constellations/nebulaActions'
import { can, roleColor, topRole } from '@/constellations/roles'
import { SettingsScreen, useSettingsDetail } from '@/constellations/settingsKit'
import { Card, ConstellationIcon, Glyph, IconBox, N, Row, StarGlyph } from '@/constellations/ui'

// A constellation's settings menu (canvas board 7): what you can change depends on your role; the
// server checks each change again.

export default function SettingsMenu() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useSettingsDetail(cid)
  const meId = useSession((s) => s.user?.id ?? '')
  const card = useCx((s) => s.cards.find((x) => x.id === cid))
  if (!c) return <SettingsScreen title="Settings" c={null} close>{null}</SettingsScreen>

  const role = topRole(c, meId)
  const go = (page: string) => router.push(`/constellations/${cid}/settings/${page}` as Href)
  const modViewer = (['deleteMessages', 'timeoutKick', 'ban', 'muteVoice', 'manageRoles', 'manageConstellation'] as ConstellationPermission[]).some((p) => can(c, p))
  const manageMembers = can(c, 'approveRequests') || can(c, 'ban') || can(c, 'timeoutKick') || c.me.owner
  const pages = [
    { key: 'overview', label: 'Overview', icon: <Icon name="info" size={17} color={N.ink} />, show: can(c, 'manageConstellation') },
    { key: 'nebulas', label: 'Nebulas & categories', icon: <StarGlyph size={16} color={N.ink} />, detail: String(c.nebulas.length), show: can(c, 'manageNebulas') },
    { key: 'roles', label: 'Roles', icon: <Glyph name="shield" size={17} />, detail: String(c.roles.length), show: can(c, 'manageRoles') },
    { key: 'members', label: 'Members', icon: <Icon name="friends" size={17} color={N.ink} />, detail: c.pendingRequests ? `${c.pendingRequests} ${c.pendingRequests === 1 ? 'request' : 'requests'}` : String(c.members.length), show: manageMembers },
    { key: 'invites', label: 'Invites', icon: <Glyph name="invite" size={17} />, show: can(c, 'invite') },
    { key: 'moderation', label: 'Moderation log', icon: <Icon name="clock" size={17} color={N.ink} />, show: modViewer },
    // Communities round (Nov 2026): API keys for bots and game servers.
    { key: 'integrations', label: 'Integrations', icon: <Glyph name="external" size={17} />, show: can(c, 'manageConstellation') },
  ].filter((p) => p.show)

  async function readAll() {
    const r = await cx.readAll(c!.id)
    if (!r.ok) return cxSay(r.message)
    haptic.success()
    cxSay('Everything is read.')
    void refreshCards()
  }

  async function leave() {
    const ok = await confirm({ title: `Leave ${c!.name}?`, message: c!.visibility === 'invite' ? "You'll need a new invite to come back." : 'You can join again later.', confirmLabel: 'Leave', danger: true })
    if (!ok) return
    const r = await cx.leave(c!.id)
    if (!r.ok) return cxSay(r.message)
    cxSay(`You left ${c!.name}.`)
    void refreshCards()
    router.dismissTo('/constellations')
  }

  return (
    <SettingsScreen title="" c={c} close>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 6 }}>
        <ConstellationIcon c={c} size={56} radius={18} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text display size={22} numberOfLines={1} accessibilityRole="header">
            {c.name}
          </Text>
          <Text size={13} weight="bold" style={{ color: roleColor(role) }}>
            {c.me.owner ? "You're the Owner" : `You're ${/^[aeiou]/i.test(role.name) ? 'an' : 'a'} ${role.name}`}
          </Text>
        </View>
      </View>
      {pages.length ? (
        <Card>
          {pages.map((p, i) => (
            <Row key={p.key} icon={<IconBox>{p.icon}</IconBox>} label={p.label} detail={p.detail} chevron last={i === pages.length - 1} onPress={() => go(p.key)} />
          ))}
        </Card>
      ) : null}
      {/* 0.8.0: AutoMod is set up on a computer (the desktop app or chat.glofly.app) */}
      {can(c, 'manageConstellation') || can(c, 'deleteMessages') ? (
        <Card>
          <Row icon={<IconBox><Glyph name="shield" size={17} /></IconBox>} label="AutoMod" detail="Manage AutoMod on a computer" disabled last onPress={() => undefined} />
        </Card>
      ) : null}
      <Card>
        <Row icon={<IconBox><Icon name="bell" size={17} color={N.ink} /></IconBox>} label="Notifications" detail={c.me.notifications?.mutedUntil ? 'Muted' : NOTIFY_WORDS[c.me.notify]} chevron onPress={() => go('notifications')} />
        {c.onboarding?.enabled ? <Row icon={<IconBox><StarGlyph size={16} color={N.ink} /></IconBox>} label="Your answers & nebulas" chevron onPress={() => go('answers')} /> : null}
        <Row icon={<IconBox><Glyph name="markRead" size={17} /></IconBox>} label="Mark everything read" disabled={!card?.unreadCount && !card?.mentionCount} onPress={() => void readAll()} />
        {!c.me.owner ? <Row icon={<IconBox danger><Glyph name="leave" size={17} color={N.redText} /></IconBox>} label={`Leave ${c.name}`} danger last onPress={() => void leave()} /> : <Row icon={<IconBox><Icon name="link" size={17} color={N.ink} /></IconBox>} label="Invite people" chevron last onPress={() => go('invites')} />}
      </Card>
      {c.me.owner ? (
        <>
          <Card>
            <Row icon={<IconBox danger><Icon name="trash" size={17} color={N.redText} /></IconBox>} label="Delete constellation" danger last onPress={() => go('delete')} />
          </Card>
          <Text size={12} style={{ color: N.faint, textAlign: 'center' }}>
            Deleting asks you to type the name. Only the Owner sees this.
          </Text>
        </>
      ) : null}
    </SettingsScreen>
  )
}
