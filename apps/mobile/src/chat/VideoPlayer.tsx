import { useEffect, useState } from 'react'
import { Modal, Platform, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useVideoPlayer, VideoView } from 'expo-video'
import type { Attachment } from '@glofly/shared'
import { authHeaders } from '@/api/http'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { attachmentUrl } from './media'

// A video from a chat (0.5.0), full screen with the phone's own player controls. It streams from
// the Glofly server with the session (so nobody else can load it).

export function VideoPlayer({ conversationId, attachment, onClose }: { conversationId: string; attachment: Attachment; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const uri = attachmentUrl(conversationId, attachment, 'video')
  // The browser preview can't send the session with a <video>: it fetches the video first.
  const [webUri, setWebUri] = useState<string | null>(null)
  useEffect(() => {
    if (Platform.OS !== 'web') return
    let url: string | null = null
    void fetch(uri, { headers: authHeaders() as Record<string, string> })
      .then((r) => r.blob())
      .then((b) => {
        url = URL.createObjectURL(b)
        setWebUri(url)
      })
      .catch(() => undefined)
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [uri])
  const source = Platform.OS === 'web' ? (webUri ? { uri: webUri } : null) : { uri, headers: authHeaders() as Record<string, string> }
  const player = useVideoPlayer(source, (p) => {
    p.loop = false
    p.play()
  })
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls fullscreenOptions={{ enable: true }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close video"
          onPress={onClose}
          style={{ position: 'absolute', top: insets.top + 8, left: 12, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="close" size={22} color="#FFFFFF" />
        </Pressable>
        <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 18, left: 70, right: 16 }}>
          <Text size={14} weight="bold" numberOfLines={1} style={{ color: '#FFF' }}>
            {attachment.name}
          </Text>
        </View>
      </View>
    </Modal>
  )
}
