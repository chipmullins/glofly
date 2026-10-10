import type { PhotoType } from '../../../preload/api-types'

// Picking a profile photo (Edit profile and the Register screen): which files are allowed,
// and reading one so it can be positioned in the crop window.

export const PHOTO_MAX_BYTES = 8 * 1024 * 1024
export const PHOTO_TYPES: PhotoType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/** A photo just picked, before it's positioned in the circle. */
export type PickedPhoto = { data: ArrayBuffer; type: PhotoType; src: string }

/** Checks and reads a picked file. Returns the photo, or a message saying what's wrong. */
export async function readPhoto(file: File): Promise<PickedPhoto | { error: string }> {
  if (!PHOTO_TYPES.includes(file.type as PhotoType)) {
    return { error: 'Choose a JPG, PNG, WebP or GIF photo.' }
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return { error: 'That photo is too big. Photos can be up to 8 MB.' }
  }
  try {
    const [data, src] = await Promise.all([
      file.arrayBuffer(),
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
    ])
    return { data, type: file.type as PhotoType, src }
  } catch {
    return { error: "Couldn't open that photo. Try another one." }
  }
}
