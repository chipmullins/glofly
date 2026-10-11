import { Redirect } from 'expo-router'
import { useSession } from '@/state/session'

export default function Start() {
  const status = useSession((s) => s.status)
  return <Redirect href={status === 'signedIn' ? '/chats' : '/login'} />
}
