import { useState } from 'react'
import { Modal, Platform, Pressable, View } from 'react-native'
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import { Field, Text } from './kit'
import { Icon } from './icons'
import { useTheme } from './theme'

// Birthday on the sign-up screen: the phone's own date picker (Android's dialog, iPhone's wheels in
// a sheet); the web preview types YYYY-MM-DD.

const HINT = 'Never shown on your profile. You need to be 13 or older.'

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function label(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

export function BirthdayField({ value, onChange, error }: { value: string; onChange: (iso: string) => void; error?: string }) {
  const { c } = useTheme()
  const [iosOpen, setIosOpen] = useState<Date | null>(null)
  if (Platform.OS === 'web') {
    return <Field label="Birthday" value={value} onChangeText={onChange} placeholder="YYYY-MM-DD" error={error} hint={HINT} />
  }
  const open = () => {
    const [y, m, d] = value ? value.split('-').map(Number) : [2005, 1, 1]
    if (Platform.OS === 'ios') return setIosOpen(new Date(y, m - 1, d))
    DateTimePickerAndroid.open({
      value: new Date(y, m - 1, d),
      mode: 'date',
      maximumDate: new Date(),
      minimumDate: new Date(1900, 0, 1),
      onChange: (event, date) => {
        if (event.type === 'set' && date) onChange(toIso(date))
      },
    })
  }
  return (
    <View style={{ gap: 6 }}>
      <Text size={14} weight="medium">
        Birthday
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={value ? `Birthday, ${label(value)}. Change` : 'Birthday. Choose a date'}
        onPress={open}
        style={{
          height: 50,
          borderWidth: 1.5,
          borderColor: error ? c.danger : c.fieldLine,
          borderRadius: 12,
          backgroundColor: c.field,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text size={16} tone={value ? 'ink' : 'faint'}>
          {value ? label(value) : 'Choose a date'}
        </Text>
        <Icon name="chevronDown" size={18} color={c.muted} />
      </Pressable>
      <Text size={12} tone={error ? 'danger' : 'muted'} weight={error ? 'medium' : 'regular'}>
        {error ?? HINT}
      </Text>
      {Platform.OS === 'ios' ? (
        <Modal visible={!!iosOpen} transparent animationType="slide" onRequestClose={() => setIosOpen(null)}>
          <Pressable accessibilityLabel="Close" onPress={() => setIosOpen(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} />
          <View style={{ backgroundColor: c.surface, paddingBottom: 34, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14 }}>
              <Pressable accessibilityRole="button" onPress={() => setIosOpen(null)} hitSlop={10}>
                <Text size={16} tone="muted">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => {
                  if (iosOpen) onChange(toIso(iosOpen))
                  setIosOpen(null)
                }}
              >
                <Text size={16} weight="medium" style={{ color: c.accentText }}>
                  Done
                </Text>
              </Pressable>
            </View>
            {iosOpen ? (
              <DateTimePicker
                value={iosOpen}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                minimumDate={new Date(1900, 0, 1)}
                onChange={(_e, date) => date && setIosOpen(date)}
                style={{ alignSelf: 'stretch' }}
              />
            ) : null}
          </View>
        </Modal>
      ) : null}
    </View>
  )
}
