import { useRef, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { GAME_LINK_GAMES, normalizeLinkCode, type GameLinkPreview } from '@glofly/shared'
import { request } from '@/api/http'
import { Button, Notice, Text } from '@/ui/kit'
import { Screen } from '@/ui/Screen'
import { useTheme } from '@/ui/theme'
import { haptic } from '@/constellations/motion'
import { GAME_LOOK } from '@/lib/gameLinks'

// Communities round (Nov 2026): Link a game server (approved canvas board 13). The code the game
// shows (6 digits, 10 minutes, one use) → "Link to Cozy RP's FiveM server?" → Link.

export default function LinkCode() {
  const { c } = useTheme()
  const [value, setValue] = useState('')
  const [preview, setPreview] = useState<GameLinkPreview | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<TextInput>(null)
  const code = normalizeLinkCode(value)

  async function next(v = value) {
    const clean = normalizeLinkCode(v)
    if (!clean) return
    setBusy(true)
    setProblem(null)
    const r = await request<{ preview: GameLinkPreview }>('POST', '/account/game-links/preview', { code: clean })
    setBusy(false)
    if (r.ok) setPreview(r.data.preview)
    else setProblem(r.message)
  }

  async function link() {
    setBusy(true)
    const r = await request<{ serverName: string }>('POST', '/account/game-links', { code })
    setBusy(false)
    if (!r.ok) return setProblem(r.message)
    haptic.success()
    router.dismissTo({ pathname: '/settings/connected-apps', params: { linked: r.data.serverName } })
  }

  if (preview) {
    const look = GAME_LOOK[preview.game]
    return (
      <Screen title="Link a game server">
        <View style={{ padding: 20, gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: look.color, alignItems: 'center', justifyContent: 'center' }}>
              <Text size={12} weight="bold" style={{ color: '#fff' }}>
                {look.badge}
              </Text>
            </View>
            <Text display size={21} style={{ flex: 1 }} accessibilityRole="header">
              Link to {preview.serverName}?
            </Text>
          </View>
          <View style={{ padding: 14, borderRadius: 14, backgroundColor: c.field, gap: 8 }}>
            <Text size={12} tone="muted">
              Joining as
            </Text>
            <Text size={15}>
              {preview.playerName} <Text size={15} tone="muted">on {GAME_LINK_GAMES[preview.game]}</Text>
            </Text>
            <Text size={12} tone="muted">
              It will see
            </Text>
            <Text size={15}>your Glofly name and roles in {preview.constellationName}</Text>
          </View>
          {preview.replaces ? (
            <Text size={14} tone="muted" style={{ lineHeight: 20 }}>
              This replaces your link to the player {preview.replaces} (one player per Glofly account on each server).
            </Text>
          ) : null}
          {!preview.member ? <Notice>Join {preview.constellationName} on Glofly first, then type the code again.</Notice> : null}
          <Text size={14} tone="muted" style={{ lineHeight: 20 }}>
            Only link if you're joining this server right now.
          </Text>
          {problem ? <Notice>{problem}</Notice> : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button kind="secondary" label="Cancel" onPress={() => router.back()} style={{ flex: 1 }} />
            <Button label="Link" busy={busy} disabled={!preview.member} onPress={() => void link()} style={{ flex: 1 }} />
          </View>
        </View>
      </Screen>
    )
  }

  const digits = value.replace(/\D/g, '')
  return (
    <Screen title="Link a game server">
      <View style={{ padding: 20, gap: 18 }}>
        <Text size={15} tone="muted">
          Type the code the game is showing you.
        </Text>
        <Pressable onPress={() => input.current?.focus()} accessibilityLabel="Code" style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {i === 3 ? (
                <Text size={22} tone="muted" weight="bold">
                  –
                </Text>
              ) : null}
              <View
                style={{
                  width: 44,
                  height: 54,
                  borderRadius: 12,
                  borderWidth: 2,
                  borderColor: i === digits.length ? c.accent : c.fieldLine,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: c.surface,
                }}
              >
                <Text display size={24}>
                  {digits[i] ?? ''}
                </Text>
              </View>
            </View>
          ))}
          <TextInput
            ref={input}
            autoFocus
            value={digits}
            onChangeText={(t) => {
              const v = t.replace(/\D/g, '').slice(0, 6)
              setValue(v)
              setProblem(null)
              if (v.length === 6) void next(v)
            }}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="off"
            maxLength={6}
            caretHidden
            accessibilityLabel="Code"
            style={{ position: 'absolute', opacity: 0, width: '100%', height: '100%' }}
          />
        </Pressable>
        <Text size={13} tone="muted" style={{ textAlign: 'center' }}>
          Codes work once, for 10 minutes.
        </Text>
        {problem ? <Notice>{problem}</Notice> : null}
        <Button label="Next" busy={busy} disabled={!code} onPress={() => void next()} />
      </View>
    </Screen>
  )
}
