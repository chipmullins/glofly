import { useEffect, useState } from 'react'
import { View } from 'react-native'
import type { MyBan } from '@glofly/shared'
import { nightWatch } from '@/api/nightwatch'
import { cxSay, useCx } from '@/state/constellations'
import { Text } from '@/ui/kit'
import { askText } from './ask'
import { haptic } from './motion'
import { Caps, N, NightButton } from './ui'

// Communities round 2 (board 1c, middle): bans you have, with an Appeal when it's open.

export function YourBans() {
  const [bans, setBans] = useState<MyBan[]>([])
  const [now, setNow] = useState(0)
  const tick = useCx((s) => s.bansTick)
  useEffect(() => {
    void nightWatch.myBans().then((r) => {
      if (!r.ok) return
      setBans(r.data.bans)
      setNow(Date.now())
    })
  }, [tick])
  if (!bans.length) return null
  async function appeal(b: MyBan) {
    const text = await askText(`Appeal your ban from ${b.constellation.name}`, 'What would you like the moderators to know?')
    if (!text?.trim()) return
    const r = await nightWatch.appeal(b.constellation.id, text)
    if (!r.ok) return cxSay(r.message)
    haptic.success()
    cxSay('Your appeal is with the moderators.')
    useCx.setState({ bansTick: useCx.getState().bansTick + 1 })
  }
  return (
    <View style={{ gap: 10 }}>
      <Caps>Your bans</Caps>
      {bans.map((b) => {
        const open = !!b.appealFrom && Date.parse(b.appealFrom) <= now && b.appeal?.status !== 'open'
        const line =
          b.appeal?.status === 'open'
            ? 'Your appeal is with the moderators.'
            : b.appeal?.status === 'denied'
              ? `They kept the ban${b.appeal.reply ? `: “${b.appeal.reply}”` : '.'}`
              : b.appealFrom === null
                ? 'This ban can’t be appealed.'
                : open
                  ? 'You can ask the moderators to reconsider.'
                  : `You can appeal from ${new Date(b.appealFrom).toLocaleDateString([], { month: 'short', day: 'numeric' })}.`
        return (
          <View key={b.constellation.id} style={{ padding: 14, borderRadius: 16, backgroundColor: N.card, borderWidth: 1, borderColor: N.line2, gap: 6 }}>
            <Text size={15} weight="bold">
              Banned from {b.constellation.name}
            </Text>
            {b.reason ? (
              <Text size={13} style={{ color: N.ink2 }}>
                Reason: “{b.reason}”
              </Text>
            ) : null}
            <Text size={12.5} style={{ color: N.muted }}>
              {line}
            </Text>
            {open ? <NightButton label="Appeal" height={40} style={{ alignSelf: 'flex-start' }} onPress={() => void appeal(b)} /> : null}
          </View>
        )
      })}
    </View>
  )
}
