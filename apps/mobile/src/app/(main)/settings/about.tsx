import { Linking, View } from 'react-native'
import { Image } from 'expo-image'
import { PRIVACY_URL, SITE_URL, SUPPORT_EMAIL, TERMS_URL } from '@glofly/shared'
import { APP_VERSION } from '@/lib/config'
import { Text } from '@/ui/kit'
import { Screen } from '@/ui/Screen'
import { SettingsRow } from '@/ui/SettingsRow'

export default function About() {
  return (
    <Screen title="About">
      <View style={{ alignItems: 'center', gap: 8, padding: 24 }}>
        <Image source={require('../../../../assets/icon.png')} style={{ width: 88, height: 88, borderRadius: 22 }} />
        <Text display size={24}>
          Glofly
        </Text>
        <Text tone="muted">Version {APP_VERSION}</Text>
      </View>
      <SettingsRow icon="file" label="Terms of Service" onPress={() => void Linking.openURL(TERMS_URL)} />
      <SettingsRow icon="shield" label="Privacy Policy" onPress={() => void Linking.openURL(PRIVACY_URL)} />
      <SettingsRow icon="mail" label="Contact support" detail={SUPPORT_EMAIL} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
      <SettingsRow icon="link" label="glofly.app" onPress={() => void Linking.openURL(SITE_URL)} />
      <Text size={12} tone="muted" style={{ padding: 20, lineHeight: 18 }}>
        Emoji names: Emojibase (MIT). Fonts: Outfit and DM Sans (OFL). Built with React Native, Expo, LiveKit and Socket.IO.
      </Text>
    </Screen>
  )
}
