import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { cx } from '@/api/constellations'
import { dropInvitePopup, putDetail, refreshCards, useCx, useCxAvailable } from '@/state/constellations'
import { firstName } from '@/lib/format'
import { isWideNow } from '@/lib/layout'
import { Text } from '@/ui/kit'
import { flyIn } from './transition'
import { placePaths } from './nav'
import { haptic } from './motion'
import { ConstellationIcon, GalaxyIcon, N, NightButton } from './ui'

// 0.7.1: someone invites you to a constellation: it pops up straight away (on Glofly home and on
// the night side), with Join and Decline. It also stays on the Constellations dashboard under
// Invites until you answer. Night style, like the dashboard's invite cards.

export function InvitePopup() {
  const available = useCxAvailable()
  const invite = useCx((s) => s.invitePopups[0])
  const insets = useSafeAreaInsets()
  const [busy, setBusy] = useState<'join' | 'decline' | null>(null)
  useEffect(() => {
    if (!invite) return
    haptic.light()
    // Unanswered, it folds away after a minute (the invite stays on the dashboard).
    const t = setTimeout(() => dropInvitePopup(invite.id), 60_000)
    return () => clearTimeout(t)
  }, [invite])
  if (!available || !invite) return null
  const who = firstName(invite.by.displayName, invite.by.username)
  return (
    <Animated.View
      key={invite.id}
      entering={FadeInDown.duration(320)}
      exiting={FadeOutDown.duration(200)}
      accessibilityViewIsModal={false}
      accessibilityLiveRegion="polite"
      style={{ position: 'absolute', left: 12, right: 12, top: insets.top + 8, zIndex: 60, padding: 14, gap: 12, borderRadius: 20, backgroundColor: N.card, borderWidth: 1, borderColor: N.line2, boxShadow: '0 14px 40px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,165,74,0.14)' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <GalaxyIcon size={14} color={N.amber} />
        <Text size={11} weight="bold" style={{ color: N.amber, letterSpacing: 0.7, flex: 1 }}>
          CONSTELLATION INVITE
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={() => dropInvitePopup(invite.id)}>
          <Text size={18} style={{ color: N.ink2 }}>
            ×
          </Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <ConstellationIcon c={{ id: invite.constellationId, name: invite.name, color: invite.color, iconVersion: invite.iconVersion }} size={44} radius={14} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text size={15} weight="bold" numberOfLines={1} style={{ color: N.ink }}>
            {invite.name}
          </Text>
          <Text size={13} numberOfLines={1} style={{ color: N.ink2 }}>
            {who} invited you · {invite.memberCount} {invite.memberCount === 1 ? 'member' : 'members'}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <NightButton
          kind="outline"
          label="Decline"
          busy={busy === 'decline'}
          style={{ flex: 1, backgroundColor: 'transparent' }}
          onPress={async () => {
            setBusy('decline')
            await cx.dismissInvite(invite.id)
            setBusy(null)
            dropInvitePopup(invite.id)
            void refreshCards()
          }}
        />
        <NightButton
          kind="green"
          label="Join"
          busy={busy === 'join'}
          style={{ flex: 1 }}
          onPress={async () => {
            setBusy('join')
            const r = await cx.join(invite.constellationId)
            setBusy(null)
            dropInvitePopup(invite.id)
            if (!r.ok) return
            if ('constellation' in r.data && 'nebulas' in r.data.constellation) putDetail(r.data.constellation)
            haptic.success()
            void refreshCards()
            flyIn(null, placePaths({ constellationId: invite.constellationId, nebulaId: null }, isWideNow()))
          }}
        />
      </View>
    </Animated.View>
  )
}
