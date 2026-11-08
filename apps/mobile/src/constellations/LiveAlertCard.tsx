import { useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { alertSiteName, type LinkPreview, type LiveCard, type Message } from '@glofly/shared'
import * as api from '@/api/glofly'
import { authHeaders, url } from '@/api/http'
import { startWatching, useWatchStore } from '@/calls/watch'
import { inform } from '@/ui/dialogs'
import { Text } from '@/ui/kit'
import { N } from './ui'

// 0.9.3 a constellation's Live alert (approved board 5, on the night side): the site, the
// stream's picture (the server's copy, never loaded from Twitch, Kick or YouTube), LIVE, the title,
// game and viewers. Watch together plays it in the call or voice nebula you're in.

const SITE_COLOR: Record<LiveCard['site'], string> = { twitch: '#6f3fd1', kick: '#1f7a3a', youtube: '#c4302b' }
const SITE_SHORT: Record<LiveCard['site'], string> = { twitch: 'TW', kick: 'KI', youtube: 'YT' }

export function isCardUrl(card: LiveCard): boolean {
  if (card.site === 'twitch') return /^https:\/\/www\.twitch\.tv\/[a-z0-9_]{2,25}$/.test(card.url)
  if (card.site === 'kick') return /^https:\/\/kick\.com\/[a-z0-9_-]{2,40}$/.test(card.url)
  return /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(card.url)
}

/** The alert's text without its last line (the link: the card opens it). */
export const liveAlertBody = (body: string, card: LiveCard): string => (body.endsWith(`\n${card.url}`) ? body.slice(0, -card.url.length - 1) : body)

export function LiveAlertCard({ message, card, preview }: { message: Message; card: LiveCard; preview: LinkPreview | null | undefined }) {
  const [imageOk, setImageOk] = useState(true)
  const inCall = !!useWatchStore((s) => s.callId)
  const site = alertSiteName(card.site)
  const ok = isCardUrl(card)
  const facts = [card.game, card.viewers !== null ? `${card.viewers.toLocaleString()} watching` : null].filter(Boolean).join(' · ')
  return (
    <View style={{ width: 300, maxWidth: '100%', borderRadius: 16, borderWidth: 1, borderColor: N.line2, backgroundColor: N.card, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 9 }}>
        <View style={{ width: 22, height: 22, borderRadius: 6, backgroundColor: SITE_COLOR[card.site], alignItems: 'center', justifyContent: 'center' }}>
          <Text size={9} weight="bold" style={{ color: '#ffffff' }}>
            {SITE_SHORT[card.site]}
          </Text>
        </View>
        <Text size={13} weight="bold" numberOfLines={1} style={{ color: N.ink, flex: 1 }}>
          {card.channelName} on {site}
        </Text>
      </View>
      <View style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: SITE_COLOR[card.site] }}>
        {preview?.image && imageOk ? (
          <Image
            source={{ uri: url(api.previewImagePath(message.conversationId, message.id)), headers: authHeaders(), cacheKey: `lp-${message.id}` }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            contentFit="cover"
            onError={() => setImageOk(false)}
          />
        ) : null}
        <View style={{ position: 'absolute', left: 10, top: 10, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#c42b1c' }}>
          <Text size={11} weight="bold" style={{ color: '#ffffff', letterSpacing: 0.4 }}>
            {card.kind === 'live' ? 'LIVE' : 'NEW VIDEO'}
          </Text>
        </View>
      </View>
      <View style={{ padding: 12, gap: 4 }}>
        <Text size={15} weight="bold" numberOfLines={3} style={{ color: N.ink }}>
          {card.title || (card.kind === 'live' ? `${card.channelName} is live` : 'New video')}
        </Text>
        {facts ? (
          <Text size={13} style={{ color: N.muted }}>
            {facts}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
          {ok && inCall ? (
            <Pressable
              accessibilityRole="button"
              onPress={async () => {
                const r = await startWatching(card.url, 'everyone')
                if (!r.ok) void inform("Couldn't start it", r.message)
              }}
              style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 14, borderRadius: 12, backgroundColor: N.amber, opacity: pressed ? 0.85 : 1, justifyContent: 'center' })}
            >
              <Text size={14} weight="bold" style={{ color: N.amberInk }}>
                Watch together
              </Text>
            </Pressable>
          ) : null}
          {ok ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(card.url)}
              style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: N.line2, backgroundColor: pressed ? N.raised : N.card2, justifyContent: 'center' })}
            >
              <Text size={14} weight="bold" style={{ color: N.ink }}>
                Open on {site}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  )
}
