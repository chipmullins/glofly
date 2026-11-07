import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import type { OnboardingQuestion } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { useSession } from '@/state/session'
import { Text } from '@/ui/kit'
import { QuestionCards } from '@/constellations/Onboarding'
import { haptic } from '@/constellations/motion'
import { runDetail, SettingsScreen, useSettingsDetail } from '@/constellations/settingsKit'
import { NightModal } from '@/constellations/sheet'
import { AmberSegmented, Caps, N, StarGlyph, Toggle } from '@/constellations/ui'

// Communities round 4.3 (approved board 27, phones): your onboarding answers (change one), and
// Browse nebulas (optional nebulas, and role-only ones a role you can pick opens).

export default function YourAnswers() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useSettingsDetail(cid)
  const meId = useSession((s) => s.user?.id ?? '')
  const [tab, setTab] = useState<'answers' | 'browse'>('answers')
  const [changing, setChanging] = useState<OnboardingQuestion | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  if (!c) return <SettingsScreen title="Your answers & nebulas" c={null}>{null}</SettingsScreen>
  const questions = c.onboarding?.questions ?? []
  const mine = c.me.onboarding?.answers ?? {}
  const myRoles = c.members.find((m) => m.user.id === meId)?.roleIds ?? []
  const picks = myRoles.filter((id) => c.roles.find((r) => r.id === id)?.selfAssign)
  const answerFor = (roleId: string): string | null => {
    for (const q of questions) for (const a of q.answers) if (a.roleIds.includes(roleId)) return a.label
    return null
  }
  const unlockRows = Object.entries(c.unlocks ?? {}).flatMap(([roleId, names]) => names.map((name) => ({ roleId, name: name.replace(/^#/, ''), on: myRoles.includes(roleId) })))
  const optional = [...c.nebulas.filter((n) => n.optional).map((n) => ({ id: n.id, name: n.name, on: true })), ...(c.browse ?? []).map((n) => ({ id: n.id, name: n.name, on: false }))]

  async function run(task: Parameters<typeof runDetail>[0]) {
    if (busy) return
    setBusy(true)
    const ok = await runDetail(task)
    setBusy(false)
    if (ok) haptic.success()
    return ok
  }

  return (
    <SettingsScreen title="Your answers & nebulas" c={c}>
      <AmberSegmented
        label="Show"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'answers', name: 'Your answers' },
          { id: 'browse', name: 'Browse nebulas' },
        ]}
      />
      {tab === 'answers' ? (
        questions.length ? (
          questions.map((q) => {
            const words = q.answers.filter((a) => (mine[q.id] ?? []).includes(a.id)).map((a) => a.label)
            return (
              <Pressable
                key={q.id}
                accessibilityRole="button"
                accessibilityLabel={`${q.title}: ${words.join(', ') || 'Not now'}. Change`}
                onPress={() => {
                  setPicked(mine[q.id] ?? [])
                  setChanging(q)
                }}
                style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: N.line2, backgroundColor: N.card }}
              >
                <View style={{ flex: 1 }}>
                  <Text size={15} weight="bold">
                    {q.title}
                  </Text>
                  <Text size={13} style={{ color: N.muted }}>
                    {words.length ? words.join(', ') : 'Not now'}
                  </Text>
                </View>
                <Text size={14} weight="bold" style={{ color: N.amber }}>
                  Change
                </Text>
              </Pressable>
            )
          })
        ) : (
          <Text size={14} style={{ color: N.muted }}>
            This constellation has no questions right now.
          </Text>
        )
      ) : (
        <>
          <Caps>Browse nebulas</Caps>
          <View>
            {unlockRows.map((u) => (
              <View key={`${u.roleId}-${u.name}`} style={{ minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: N.line }}>
                <StarGlyph size={14} color="#9b7cf0" />
                <View style={{ flex: 1 }}>
                  <Text size={15} weight="bold">
                    {u.name}
                  </Text>
                  <Text size={12} style={{ color: N.muted }}>
                    {answerFor(u.roleId) ? `Comes with the ${answerFor(u.roleId)} answer` : `Comes with the ${c.roles.find((r) => r.id === u.roleId)?.name ?? ''} role`}
                  </Text>
                </View>
                <Toggle amber value={u.on} label={u.name} disabled={busy} onChange={(v) => void run(() => cx.myRoles(c.id, v ? [...picks, u.roleId] : picks.filter((id) => id !== u.roleId)))} />
              </View>
            ))}
            {optional.map((n) => (
              <View key={n.id} style={{ minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: N.line }}>
                <StarGlyph size={14} color="#9b7cf0" />
                <View style={{ flex: 1 }}>
                  <Text size={15} weight="bold">
                    {n.name}
                  </Text>
                  <Text size={12} style={{ color: N.muted }}>
                    Optional for everyone
                  </Text>
                </View>
                <Toggle amber value={n.on} label={n.name} disabled={busy} onChange={(v) => void run(() => cx.showNebula(c.id, n.id, v))} />
              </View>
            ))}
          </View>
          {!unlockRows.length && !optional.length ? (
            <Text size={14} style={{ color: N.muted }}>
              You see every nebula already.
            </Text>
          ) : null}
          <Text size={12} style={{ color: N.faint }}>
            Hiding a nebula only hides it for you. Nebulas limited to roles (staff, tickets) never show here.
          </Text>
        </>
      )}
      {changing ? (
        <NightModal onClose={() => setChanging(null)} fit accessibilityLabel={changing.title}>
          <View style={{ gap: 12, paddingBottom: 8 }}>
            <Text display size={22}>
              {changing.title}
            </Text>
            <Text size={13} style={{ color: N.muted }}>
              {changing.multi ? 'Pick any.' : 'Pick one.'}
            </Text>
            <QuestionCards q={changing} picked={picked} onPick={setPicked} />
            <Pressable
              accessibilityRole="button"
              disabled={busy || (changing.required && !picked.length)}
              onPress={async () => {
                const ok = await run(() => cx.answerOnboarding(c.id, { [changing.id]: picked }, false))
                if (ok) setChanging(null)
              }}
              style={{ height: 50, borderRadius: 25, backgroundColor: changing.required && !picked.length ? N.line2 : N.amber, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text size={16} weight="bold" style={{ color: N.amberInk }}>
                Save
              </Text>
            </Pressable>
          </View>
        </NightModal>
      ) : null}
    </SettingsScreen>
  )
}
