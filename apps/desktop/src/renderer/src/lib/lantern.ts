/** The CSS for a lantern that's fading (0.5.0): the time left becomes its fade. */
export function lanternStyle(fadeAt: string | null | undefined): React.CSSProperties | undefined {
  if (!fadeAt) return undefined
  const left = Math.max(0, new Date(fadeAt).getTime() - Date.now())
  return { '--lantern-fade': `${left}ms` } as React.CSSProperties
}
