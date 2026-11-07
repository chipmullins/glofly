import { useEffect, useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { cfxJoinPage, type CfxServerCard } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { Text } from '@/ui/kit'
import { N } from './ui'

// Communities round (FiveM/RedM quick wins): a cfx.re/join link becomes a card on phones too.
// FiveM and RedM are PC games, so the button opens Cfx.re's own page for the server (people
// join from their computer). With the server lookup on, the card shows name, game and players.

const cache = new Map<string, CfxServerCard>()

export function CfxCard({ code, width = 280 }: { code: string; width?: number }) {
  const [card, setCard] = useState<CfxServerCard | null>(cache.get(code) ?? null)
  useEffect(() => {
    if (cache.has(code)) return
    let live = true
    void cx.cfxCard(code).then((r) => {
      const next: CfxServerCard = r.ok ? r.data : { code, lookup: false }
      cache.set(code, next)
      if (live) setCard(next)
    })
    return () => {
      live = false
    }
  }, [code])
  if (!card) return <View style={{ width, height: 76, marginTop: 8, borderRadius: 16, backgroundColor: N.card2 }} />
  const game = card.game === 'redm' ? 'RedM' : 'FiveM'
  const gone = card.lookup && !card.found
  return (
    <View style={{ width, marginTop: 8, padding: 12, borderRadius: 16, backgroundColor: '#1c1210', borderWidth: 1, borderColor: N.line2, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: card.game === 'redm' ? '#c8102e' : '#f40552', alignItems: 'center', justifyContent: 'center' }}>
        <Text size={13} weight="bold" style={{ color: '#fff' }}>
          {card.lookup ? game.slice(0, 1) : 'Cfx'}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text size={11} weight="bold" style={{ color: N.muted, letterSpacing: 0.6 }}>
          {card.lookup ? `${game.toUpperCase()} SERVER` : 'FIVEM / REDM SERVER'}
        </Text>
        <Text size={15} weight="bold" numberOfLines={1}>
          {card.name ?? `cfx.re/join/${code}`}
        </Text>
        <Text size={12} style={{ color: gone ? N.muted : card.players !== undefined ? N.greenText : N.muted }}>
          {gone ? "Not online right now" : card.players !== undefined ? `${card.players}${card.maxPlayers !== undefined ? ` / ${card.maxPlayers}` : ''} playing` : 'Join from your computer'}
        </Text>
      </View>
      {!gone ? (
        <Pressable accessibilityRole="link" accessibilityLabel={`Open cfx.re/join/${code}`} onPress={() => void Linking.openURL(cfxJoinPage(code))} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: N.amber, justifyContent: 'center' }}>
          <Text size={14} weight="bold" style={{ color: N.amberInk }}>
            Open
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}
