import { useState } from 'react'
import { FlatList, Modal, Pressable, useWindowDimensions, View } from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Message } from '@glofly/shared'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { imageSource, savePhoto, shareFile } from './media'

// Full-size photos: swipe between a message's photos, save to the gallery, or share.

export type ViewerState = { message: Message; index: number }

export function PhotoViewer({ state, onClose }: { state: ViewerState; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const photos = state.message.attachments.filter((a) => a.kind === 'image')
  const first = Math.max(0, photos.indexOf(state.message.attachments[state.index]))
  const [index, setIndex] = useState(first)
  const current = photos[index]
  return (
    <Modal visible animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000000' }}>
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          initialScrollIndex={first}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          showsHorizontalScrollIndicator={false}
          keyExtractor={(a) => a.id}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => (
            <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
              <Image
                source={imageSource(state.message.conversationId, item, 'full')}
                placeholder={imageSource(state.message.conversationId, item, 'preview')}
                style={{ width, height: height - insets.top - insets.bottom - 120 }}
                contentFit="contain"
                accessibilityLabel={item.name}
              />
            </View>
          )}
        />
        <View style={{ position: 'absolute', top: insets.top, left: 0, right: 0, height: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={24} color="#FFFFFF" />
          </Pressable>
          <Text size={15} weight="medium" style={{ flex: 1, color: '#FFFFFF' }}>
            {photos.length > 1 ? `${index + 1} of ${photos.length}` : ''}
          </Text>
          {current ? (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel="Save to gallery" onPress={() => void savePhoto(state.message.conversationId, current)} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="download" size={22} color="#FFFFFF" />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Share" onPress={() => void shareFile(state.message.conversationId, current)} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="share" size={22} color="#FFFFFF" />
              </Pressable>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  )
}
