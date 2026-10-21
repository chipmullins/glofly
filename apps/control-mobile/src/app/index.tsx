import { Redirect } from 'expo-router'
import { useSession } from '@/state/session'

/** The first page: wherever the session says. */
export default function Index() {
  const phase = useSession((s) => s.phase)
  if (phase === 'app') return <Redirect href="/home" />
  if (phase === 'approve') return <Redirect href="/approve" />
  return <Redirect href="/signin" />
}
