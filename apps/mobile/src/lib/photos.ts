import { Platform } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import type { Upload } from '@/api/http'

// Picking photos: profile and group photos (square, cropped by Android's own cropper), and
// photos to send in a chat (up to 10, any shape).

export type Picked = Upload & { name: string; size: number | null; width: number | null; height: number | null }

/** A square photo for a profile or group (or null if they cancelled). Saved as a 512 px JPEG. */
export async function pickSquarePhoto(source: 'library' | 'camera' = 'library'): Promise<Upload | 'denied' | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.92 }
  let result: ImagePicker.ImagePickerResult
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) return 'denied'
    result = await ImagePicker.launchCameraAsync(options)
  } else {
    result = await ImagePicker.launchImageLibraryAsync(options)
  }
  if (result.canceled || !result.assets[0]) return null
  const asset = result.assets[0]
  // GIFs stay as they are so they keep moving (the server crops them itself).
  if (asset.mimeType === 'image/gif') return { uri: asset.uri, type: 'image/gif' }
  if (Platform.OS === 'web') return { uri: asset.uri, type: asset.mimeType ?? 'image/jpeg' }
  const ref = await ImageManipulator.manipulate(asset.uri).resize({ width: 512, height: 512 }).renderAsync()
  const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 })
  return { uri: saved.uri, type: 'image/jpeg' }
}

/** Photos to send (or null if they cancelled). */
export async function pickChatPhotos(source: 'library' | 'camera', limit: number): Promise<Picked[] | 'denied' | null> {
  let result: ImagePicker.ImagePickerResult
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) return 'denied'
    result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 })
  } else {
    result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: limit > 1,
      selectionLimit: limit,
      quality: 0.9,
      orderedSelection: true,
    })
  }
  if (result.canceled) return null
  return result.assets.map((a, i) => ({
    uri: a.uri,
    type: a.mimeType ?? 'image/jpeg',
    name: a.fileName ?? `Photo ${i + 1}.${(a.mimeType ?? 'image/jpeg').split('/')[1] ?? 'jpg'}`,
    size: a.fileSize ?? null,
    width: a.width ?? null,
    height: a.height ?? null,
  }))
}
