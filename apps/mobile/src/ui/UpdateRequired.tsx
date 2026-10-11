import { Linking, Platform, View } from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Button, Text } from './kit'
import { useSession } from '@/state/session'
import { APP_VERSION } from '@/lib/config'

// "Please update Glofly": covers the whole app when the server needs a newer version.

export function UpdateRequired() {
  const insets = useSafeAreaInsets()
  const required = useSession((s) => s.updateRequired)
  if (!required) return null
  const store = Platform.OS === 'ios' ? 'Update on the App Store' : 'Update on Google Play'
  const open = () => {
    const market = 'market://details?id=com.glofly.app'
    if (Platform.OS === 'android') Linking.openURL(market).catch(() => Linking.openURL(required.downloadUrl))
    else void Linking.openURL(required.downloadUrl)
  }
  return (
    <View style={{ position: 'absolute', inset: 0, backgroundColor: '#1C1210', paddingTop: insets.top, paddingBottom: insets.bottom + 24, zIndex: 100 }} accessibilityViewIsModal>
      <View style={{ position: 'absolute', left: '18%', top: '22%', width: 5, height: 5, borderRadius: 3, backgroundColor: '#FFD27A', boxShadow: '0 0 16px 6px rgba(255,190,90,0.55)' }} />
      <View style={{ position: 'absolute', left: '82%', top: '64%', width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFC15E', boxShadow: '0 0 20px 7px rgba(255,170,70,0.5)' }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 }}>
        <Image source={require('../../assets/firefly.png')} style={{ width: 64, height: 47 }} contentFit="contain" />
        <Text display size={30} style={{ color: '#FFFFFF', marginTop: 8, textAlign: 'center' }} accessibilityRole="header">
          Please update Glofly
        </Text>
        <Text size={16} style={{ color: '#D9C2B1', textAlign: 'center', lineHeight: 24 }}>
          {required.message || 'This version is too old to keep using. The new one takes a minute and keeps your chats and sign-in.'}
        </Text>
      </View>
      <View style={{ paddingHorizontal: 24, gap: 10 }}>
        <Button label={store} onPress={open} icon="download" />
        <Text size={13} style={{ color: '#B9A294', textAlign: 'center' }}>
          You're on {APP_VERSION}
          {required.minVersion ? ` · needed: ${required.minVersion}` : ''}
        </Text>
      </View>
    </View>
  )
}
