import { Platform } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import type { Upload } from '@/api/http'
import { afterOverlaysClose, inform } from '@/ui/dialogs'
import { cropSquare } from '@/ui/PhotoCropper'

// Picking photos: profile and group photos (square: Android's own cropper, or Glofly's cropper on
// iPhone), and
// photos to send in a chat (up to 10, any shape).

export type Picked = Upload & { name: string; size: number | null; width: number | null; height: number | null }

// iPhone: hand over JPEGs rather than HEIC (the server and other people's phones can show them),
// and take the photo as iOS gives it (quality 1). Any lower quality made the picker decode and
// re-compress every full-size photo (12 to 48 megapixels) one after another before it returned:
// that was the long wait after choosing photos. Android keeps 0.9 (it was never slow there).
const IOS = Platform.OS === 'ios'
const iosCompatible: ImagePicker.ImagePickerOptions = IOS
  ? { preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible, shouldDownloadFromNetwork: true }
  : {}
const QUALITY = IOS ? 1 : 0.9

function pickFailed(e: unknown): null {
  console.warn('[photos] picking failed', e)
  void inform("Couldn't open that photo", 'Try again, or pick a different photo.')
  return null
}

/** A square photo for a profile or group (or null if they cancelled). Saved as a 512 px JPEG. */
export async function pickSquarePhoto(source: 'library' | 'camera' = 'library'): Promise<Upload | 'denied' | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: IOS ? 1 : 0.92, ...iosCompatible }
  await afterOverlaysClose()
  try {
    return await squarePhoto(source, options)
  } catch (e) {
    return pickFailed(e)
  }
}

async function squarePhoto(source: 'library' | 'camera', options: ImagePicker.ImagePickerOptions): Promise<Upload | 'denied' | null> {
  let result: ImagePicker.ImagePickerResult
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) return 'denied'
    result = await ImagePicker.launchCameraAsync(options)
  } else if (IOS) {
    // iPhone: the fast photo picker, then Glofly's own cropper. (Letting the picker crop makes iOS
    // use its old picker, which took seconds to open: the "Choose a photo" wait.)
    result = await ImagePicker.launchImageLibraryAsync({ ...options, allowsEditing: false })
    if (result.canceled || !result.assets[0]) return null
    const picked = result.assets[0]
    if (picked.mimeType === 'image/gif') return { uri: picked.uri, type: 'image/gif' }
    // Let the photo picker finish sliding away before the cropper appears.
    await new Promise((r) => setTimeout(r, 350))
    const rect = await cropSquare(picked.uri, picked.width, picked.height)
    if (!rect) return null
    const ref = await ImageManipulator.manipulate(picked.uri).crop(rect).resize({ width: 512, height: 512 }).renderAsync()
    const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 })
    return { uri: saved.uri, type: 'image/jpeg' }
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

/** The photo's name, with .jpg when iOS turned a HEIC photo into a JPEG for us. */
function photoName(fileName: string | null | undefined, mimeType: string | undefined, i: number): string {
  const type = mimeType ?? 'image/jpeg'
  if (!fileName) return `Photo ${i + 1}.${type === 'image/jpeg' ? 'jpg' : (type.split('/')[1] ?? 'jpg')}`
  if (type === 'image/jpeg' && /\.(heic|heif)$/i.test(fileName)) return fileName.replace(/\.(heic|heif)$/i, '.jpg')
  return fileName
}

/**
 * Photos and videos to send (0.5.0). iPhone videos are turned into H.264 MP4 at up to 720p by
 * iOS itself while picking (plays everywhere, and a minute is about 30 MB); Android hands over
 * what it has (usually MP4). Videos up to 3 minutes.
 */
export async function pickChatMedia(source: 'library' | 'camera', limit: number): Promise<(Picked & { video: boolean })[] | 'denied' | null> {
  await afterOverlaysClose()
  try {
    const video: ImagePicker.ImagePickerOptions = {
      videoMaxDuration: 180,
      ...(IOS ? { videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720, videoQuality: ImagePicker.UIImagePickerControllerQualityType.High } : {}),
    }
    let result: ImagePicker.ImagePickerResult
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync()
      if (!perm.granted) return 'denied'
      result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images', 'videos'], quality: 0.9, ...video })
    } else {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: limit > 1,
        selectionLimit: limit,
        quality: QUALITY,
        orderedSelection: true,
        ...iosCompatible,
        ...video,
      })
    }
    if (result.canceled) return null
    return result.assets.map((a, i) => {
      const isVideo = a.type === 'video'
      return {
        uri: a.uri,
        type: a.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg'),
        name: isVideo ? videoName(a.fileName, a.mimeType, i) : photoName(a.fileName, a.mimeType, i),
        size: a.fileSize ?? null,
        width: a.width ?? null,
        height: a.height ?? null,
        video: isVideo,
      }
    })
  } catch (e) {
    return pickFailed(e)
  }
}

/** A video's name, ending in .mp4 when it is one (iOS hands over "IMG_1234.MOV" turned into MP4). */
function videoName(fileName: string | null | undefined, mimeType: string | undefined, i: number): string {
  const ext = mimeType === 'video/quicktime' ? 'mov' : mimeType === 'video/webm' ? 'webm' : 'mp4'
  const base = (fileName ?? `Video ${i + 1}`).replace(/\.[^.]+$/, '')
  return `${base}.${ext}`
}
