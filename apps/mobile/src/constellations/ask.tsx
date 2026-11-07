import { useEffect, useState } from 'react'
import { TextInput, View } from 'react-native'
import { create } from 'zustand'
import { Text, webNoOutline } from '@/ui/kit'
import { font } from '@/ui/theme'
import { NightModal } from './sheet'
import { N, NightButton } from './ui'

// A small text prompt on the night side (a tag, a category's name, a kick reason).

type Ask = { title: string; placeholder: string; initial: string; allowEmpty: boolean; secure?: boolean; resolve: (v: string | null) => void } | null
const useAsk = create<{ ask: Ask }>(() => ({ ask: null }))

/** Asks for a line of text on the night side (null if cancelled; `allowEmpty`: OK with nothing typed gives ''). */
export function askText(title: string, placeholder = '', initial = '', allowEmpty = false): Promise<string | null> {
  return new Promise((resolve) => useAsk.setState({ ask: { title, placeholder, initial, allowEmpty, resolve } }))
}

/** Communities round: asks for the person's password again (hidden as it's typed). */
export function askPassword(title = 'Your Glofly password, to confirm'): Promise<string | null> {
  return new Promise((resolve) => useAsk.setState({ ask: { title, placeholder: 'Password', initial: '', allowEmpty: false, secure: true, resolve } }))
}

/** Lives in the night layout. */
export function AskTextHost() {
  const ask = useAsk((s) => s.ask)
  const [value, setValue] = useState('')
  useEffect(() => setValue(ask?.initial ?? ''), [ask])
  if (!ask) return null
  const done = (v: string | null) => {
    useAsk.setState({ ask: null })
    ask.resolve(v)
  }
  return (
    <NightModal onClose={() => done(null)} fit top={80} accessibilityLabel={ask.title}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <Text display size={20}>{ask.title}</Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder={ask.placeholder}
          placeholderTextColor={N.faint}
          autoFocus
          secureTextEntry={!!ask.secure}
          autoCapitalize={ask.secure ? 'none' : undefined}
          autoCorrect={ask.secure ? false : undefined}
          textContentType={ask.secure ? 'password' : undefined}
          onSubmitEditing={() => done(ask.secure ? value || null : value.trim() || (ask.allowEmpty ? '' : null))}
          returnKeyType="done"
          accessibilityLabel={ask.title}
          selectionColor={N.amber}
          style={[{ height: 48, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: N.amber, backgroundColor: N.bg, color: N.ink, fontFamily: font.bodyMedium, fontSize: 16 }, webNoOutline]}
        />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <NightButton kind="outline" label="Cancel" style={{ flex: 1 }} onPress={() => done(null)} />
          <NightButton label="OK" style={{ flex: 1 }} onPress={() => done(ask.secure ? value || null : value.trim() || (ask.allowEmpty ? '' : null))} />
        </View>
      </View>
    </NightModal>
  )
}

