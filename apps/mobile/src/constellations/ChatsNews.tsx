import { useCallback } from 'react'
import { Pressable, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import type { NebulaNews } from '@glofly/shared'
import { refreshNews, useCx, useCxAvailable } from '@/state/constellations'
import { firstName } from '@/lib/format'
import { isWideNow } from '@/lib/layout'
import { SectionLabel, Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'
import { flyIn } from './transition'
import { placePaths } from './nav'
import { ConstellationIcon, N } from './ui'

// 0.7.1 (Chip): nebulas with news for you (unread messages it notifies you about, or @you) show
// at the top of the Chats list. A tap flies straight into that nebula: no dashboard, no picking
// the constellation and finding the nebula. In Glofly's own colours, with the constellation's
// icon and its little night badge so they read as nebulas, not chats.

const ago = (iso: string): string => {
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h}h`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function NewsRow({ item }: { item: NebulaNews }) {
  const { c } = useTheme()
  const mention = item.nebula.mentionCount > 0
  const count = mention ? item.nebula.mentionCount : item.nebula.unreadCount
  const who = item.last?.sender ? firstName(item.last.sender.displayName, item.last.sender.username) : null
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`#${item.nebula.name} in ${item.constellation.name}, ${mention ? `${count} ${count === 1 ? 'mention' : 'mentions'} of you` : `${count} unread`}`}
      accessibilityHint="Opens this nebula in Constellations"
      onPress={() =>
        flyIn(
          null,
          placePaths(
            {
              constellationId: item.constellation.id,
              nebulaId: item.nebula.id,
            },
            isWideNow(),
          ),
        )
      }
      android_ripple={{ color: c.line }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 9,
        paddingHorizontal: 16,
        backgroundColor: pressed ? c.surface : 'transparent',
      })}
    >
      <View>
        <ConstellationIcon c={item.constellation} size={48} radius={16} />
        <View
          style={{
            position: 'absolute',
            right: -4,
            bottom: -4,
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: N.bg,
            borderWidth: 2,
            borderColor: c.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text size={12} weight="bold" style={{ color: N.amber, lineHeight: 14 }}>
            #
          </Text>
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text size={16} weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>
            #{item.nebula.name}
          </Text>
          <Text size={13} tone="muted" numberOfLines={1} style={{ flexShrink: 2 }}>
            · {item.constellation.name}
          </Text>
          <View style={{ flex: 1 }} />
          {item.last ? (
            <Text size={12} tone="muted">
              {ago(item.last.at)}
            </Text>
          ) : null}
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginTop: 2,
          }}
        >
          <Text size={14} tone="ink2" numberOfLines={1} style={{ flex: 1 }}>
            {item.last ? `${who ? `${who}: ` : ''}${item.last.text}` : 'New messages'}
          </Text>
          <View
            style={{
              minWidth: 22,
              height: 22,
              paddingHorizontal: 6,
              borderRadius: 11,
              backgroundColor: mention ? N.violet : c.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text size={12} weight="bold" style={{ color: mention ? N.violetInk : c.accentInk }}>
              {mention ? `@${count > 9 ? '9+' : count}` : count > 99 ? '99+' : count}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  )
}

/** The Chats list's "Constellations" rows (nothing when there's no news). */
export function ChatsNews() {
  const available = useCxAvailable()
  const news = useCx((s) => s.news)
  useFocusEffect(
    useCallback(() => {
      if (available) refreshNews()
    }, [available]),
  )
  if (!available || !news.length) return null
  return (
    <View>
      <SectionLabel>Constellations</SectionLabel>
      {news.slice(0, 5).map((n) => (
        <NewsRow key={n.nebula.id} item={n} />
      ))}
    </View>
  )
}
