import { useEffect } from 'react'
import { View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import * as Native from 'glofly-native'
import { openIncomingFromLink } from '@/calls/controller'
import { Spinner } from '@/ui/kit'

// Where a ringing call's notification leads (glofly://incoming/<callId>): shows the incoming card
// over the lock screen, or answers straight away when "Answer" was pressed on the notification.

export default function IncomingLink() {
  const { callId, answer, video } = useLocalSearchParams<{ callId: string; answer?: string; video?: string }>()
  useEffect(() => {
    Native.showOverLockScreen(true)
    if (router.canGoBack()) router.back()
    else router.replace('/chats')
    void openIncomingFromLink(callId, answer === '1', video === '1')
  }, [callId, answer, video])
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1C1210' }}>
      <Spinner />
    </View>
  )
}
