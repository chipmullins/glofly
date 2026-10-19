import { Pressable, View } from 'react-native'
import { Icon } from './icons'
import { Text } from './kit'
import { useTheme } from './theme'

// 0.7.3: a small time picker made of plain buttons (no native picker, so it ships over the air):
// hour − / +, minutes − / + (5-minute steps), AM / PM. Value: "HH:MM" (24-hour).

const pad = (n: number) => String(n).padStart(2, '0')
export const hhmm = (h: number, m: number) => `${pad(((h % 24) + 24) % 24)}:${pad(((m % 60) + 60) % 60)}`
export const parseHHMM = (s: string): [number, number] => {
  const [h, m] = s.split(':').map(Number)
  return [Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0]
}

function Step({ label, onPress, icon }: { label: string; onPress: () => void; icon: 'plus' | 'minus' }) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: pressed ? c.surface2 : c.surface,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <Icon name={icon} size={20} color={c.ink} />
    </Pressable>
  )
}

export function TimePicker({ value, onChange, minuteStep = 5 }: { value: string; onChange: (v: string) => void; minuteStep?: number }) {
  const { c } = useTheme()
  const [h, m] = parseHHMM(value)
  const pm = h >= 12
  const h12 = h % 12 === 0 ? 12 : h % 12
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
      }}
      accessibilityLabel={`Time ${h12}:${pad(m)} ${pm ? 'PM' : 'AM'}`}
    >
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Step icon="plus" label="Later hour" onPress={() => onChange(hhmm(h + 1, m))} />
        <Text
          display
          size={34}
          style={{
            minWidth: 52,
            textAlign: 'center',
            fontVariant: ['tabular-nums'],
          }}
        >
          {h12}
        </Text>
        <Step icon="minus" label="Earlier hour" onPress={() => onChange(hhmm(h - 1, m))} />
      </View>
      <Text display size={34}>
        :
      </Text>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Step icon="plus" label={`${minuteStep} minutes later`} onPress={() => onChange(hhmm(m + minuteStep >= 60 ? h + 1 : h, m + minuteStep))} />
        <Text
          display
          size={34}
          style={{
            minWidth: 52,
            textAlign: 'center',
            fontVariant: ['tabular-nums'],
          }}
        >
          {pad(m)}
        </Text>
        <Step icon="minus" label={`${minuteStep} minutes earlier`} onPress={() => onChange(hhmm(m - minuteStep < 0 ? h - 1 : h, m - minuteStep))} />
      </View>
      <View style={{ gap: 8, marginLeft: 6 }}>
        {(['AM', 'PM'] as const).map((half) => {
          const on = (half === 'PM') === pm
          return (
            <Pressable
              key={half}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => !on && onChange(hhmm(pm ? h - 12 : h + 12, m))}
              style={{
                width: 56,
                height: 40,
                borderRadius: 20,
                backgroundColor: on ? c.accent : c.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text size={15} weight="bold" style={{ color: on ? c.accentInk : c.ink }}>
                {half}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}
