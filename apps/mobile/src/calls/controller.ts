// Calls (filled in with LiveKit in the calls step).
import { inform } from '@/ui/dialogs'

export async function joinCallIn(_conversationId: string, _video: boolean): Promise<void> {
  await inform('Calls are coming soon')
}

export async function startCallIn(_conversationId: string, _video: boolean): Promise<void> {
  await inform('Calls are coming soon')
}

export async function startCallWith(_userId: string, _video: boolean): Promise<void> {
  await inform('Calls are coming soon')
}
