import { useEffect, useState } from 'react'

// Who's typing in each chat, for the sidebar ("typing…" under a chat you're not looking at).
// Same timing as the open chat: a typing hint lasts 4.5s after the last keystroke, and a
// message from that person ends it straight away. The server only relays typing hints
// people allow (Settings → Privacy → Show when I'm typing) and never across a block.

const SHOW_FOR_MS = 4500

/** conversationId → user ids typing there right now */
export type TypingByChat = Record<string, string[]>

export function useTypingByChat(meId: string): TypingByChat {
  const [typing, setTyping] = useState<TypingByChat>({})

  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const keyOf = (chatId: string, userId: string): string => `${chatId}:${userId}`

    const stop = (chatId: string, userId: string): void => {
      const key = keyOf(chatId, userId)
      const timer = timers.get(key)
      if (timer) clearTimeout(timer)
      timers.delete(key)
      setTyping((all) => {
        const ids = all[chatId]
        if (!ids?.includes(userId)) return all
        const rest = ids.filter((id) => id !== userId)
        const next = { ...all }
        if (rest.length) next[chatId] = rest
        else delete next[chatId]
        return next
      })
    }

    const unsubscribe = window.glofly.onEvent((event) => {
      if (event.type === 'typing' && event.userId !== meId) {
        const { conversationId: chatId, userId } = event
        setTyping((all) =>
          all[chatId]?.includes(userId)
            ? all
            : { ...all, [chatId]: [...(all[chatId] ?? []), userId] }
        )
        const key = keyOf(chatId, userId)
        const old = timers.get(key)
        if (old) clearTimeout(old)
        timers.set(
          key,
          setTimeout(() => stop(chatId, userId), SHOW_FOR_MS)
        )
      }
      if (event.type === 'message:new') {
        stop(event.message.conversationId, event.message.senderId)
      }
    })

    return () => {
      unsubscribe()
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [meId])

  return typing
}
