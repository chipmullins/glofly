import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Text } from '@/ui/kit'
import { prefs } from '@/lib/storage'
import { FireButton } from '@/campfire/ui'
import { useFire } from '@/campfire/lib'

// Round A: the first-time tour on a phone (approved board "Tour"): a few cards over the table,
// once per phone (replay from the hub's "How Campfire works"). Nothing on the table changes.

const PLAYER = [
  ['Your sheet', 'Everything about your character is in the sheet at the bottom: hit points, attacks, spells. Tap a number to roll it.'],
  ['Move your token', 'Drag your token on the map. In a fight your game master may lock tokens until it’s your turn.'],
  ['Target something', 'Tap a creature to target it, then tap an attack. The game master applies the damage.'],
  ['Turn order, rolls, handouts, music', 'The round buttons on the right of the map. On your turn, “End my turn” shows at the bottom.'],
  ['The campaign hub', 'The flame button: the next session (say if you’re coming), recaps, quests, loot and leveling up.'],
] as const
const GM = [
  ['Running it from a phone', 'You can roll, move tokens, step through turns and apply damage here. Fog, the map builder and monsters are on a computer.'],
  ['Approving damage', 'When a player hits, the damage waits at the top of the map: apply it, change it or skip it.'],
  ['The campaign hub', 'The flame button: sessions, recaps, quests and loot. Plan sessions and write recaps on a computer.'],
] as const

const KEY = (gm: boolean) => `campfire.tour.${gm ? 'gm' : 'player'}`

/** Shows the tour the first time on this phone (or when asked to replay it). */
export function useTourOnce(gm: boolean): [boolean, (on: boolean) => void] {
  const [show, setShow] = useState(false)
  useEffect(() => {
    void prefs.get<boolean>(KEY(gm), false).then((seen) => setShow(!seen))
  }, [gm])
  return [
    show,
    (on) => {
      setShow(on)
      if (!on) void prefs.set(KEY(gm), true)
    },
  ]
}

export function PhoneTour({ gm, onDone }: { gm: boolean; onDone: () => void }) {
  const fire = useFire()
  const insets = useSafeAreaInsets()
  const steps = gm ? GM : PLAYER
  const [i, setI] = useState(0)
  const [title, text] = steps[i]
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(8,6,5,0.6)', justifyContent: 'flex-end', padding: 16, paddingBottom: insets.bottom + 16 }} accessibilityViewIsModal>
      <View style={{ padding: 18, borderRadius: 20, backgroundColor: '#241712', borderWidth: 1, borderColor: fire.amberLine, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text size={11} weight="bold" style={{ flex: 1, color: fire.amber }}>
            {gm ? 'GAME MASTER TOUR' : 'YOUR FIRST TIME AT A TABLE'} · {i + 1} OF {steps.length}
          </Text>
          {steps.map((_, n) => (
            <View key={n} style={{ width: 14, height: 5, borderRadius: 3, backgroundColor: n < i ? fire.green : n === i ? fire.amber : fire.track }} />
          ))}
        </View>
        <Text accessibilityRole="header" style={{ fontFamily: 'Outfit_700Bold', fontSize: 21, color: fire.ink }}>
          {title}
        </Text>
        <Text size={15} style={{ color: fire.muted, lineHeight: 22 }}>
          {text}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable accessibilityRole="button" onPress={onDone} style={{ minHeight: 44, justifyContent: 'center', flex: 1 }}>
            <Text weight="bold" size={14} style={{ color: fire.amber }}>
              Skip the tour
            </Text>
          </Pressable>
          {i > 0 ? <FireButton label="Back" onPress={() => setI(i - 1)} /> : null}
          <FireButton label={i === steps.length - 1 ? 'Done' : 'Next'} kind="primary" onPress={() => (i === steps.length - 1 ? onDone() : setI(i + 1))} />
        </View>
      </View>
    </View>
  )
}
