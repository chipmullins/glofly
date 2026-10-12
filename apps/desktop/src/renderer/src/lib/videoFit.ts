// How a camera fills its box. Filling ("cover") looks best but crops whatever doesn't fit, which
// is fine when the camera and the box are about the same shape (a laptop camera in a wide tile)
// and terrible when they aren't (a phone held upright in a wide tile: cover keeps only a band
// across the middle, so the face is cut off and looks zoomed in). So: fill when cover would keep
// at least MIN_KEPT of the picture's width and height, otherwise show all of it ("contain").

export type VideoFit = 'cover' | 'contain'

/** At least this much of the picture's width (or height) stays visible: a 4:3 camera still fills a 16:9 box, an upright phone doesn't. */
const MIN_KEPT = 0.74

export function cameraFit(videoW: number, videoH: number, boxW: number, boxH: number): VideoFit {
  if (!(videoW > 0 && videoH > 0 && boxW > 0 && boxH > 0)) return 'cover'
  const video = videoW / videoH
  const box = boxW / boxH
  const kept = Math.min(video, box) / Math.max(video, box)
  return kept >= MIN_KEPT ? 'cover' : 'contain'
}
