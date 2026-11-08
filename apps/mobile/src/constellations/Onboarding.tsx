import { useState } from 'react'
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { accentOf, type ConstellationDetail, type OnboardingQuestion } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { cxSay, loadDetail, putDetail } from '@/state/constellations'
import { Text } from '@/ui/kit'
import { needsWelcome } from './community'
import { haptic } from './motion'
import { N } from './ui'

// Communities round 4.3 (approved board 28): onboarding on phones. New members answer the
// questions right after the welcome sheet, then see "Your …". Setting it up is done on a
// computer (the desktop app or chat.glofly.app); "Your answers & nebulas" is its own page
// (settings/answers.tsx). The server checks every answer again.

export const needsOnboarding = (c: ConstellationDetail): boolean =>
  !!c.onboarding?.enabled && !!c.onboarding.questions.length && !!c.me.onboarding && c.me.onboarding.onboardedAt === null && !c.me.owner

/** Closed (answered) here while Glofly is open, so a reload doesn't bring it back. */
const answeredFor = new Set<string>()

/** One question's answers, as tall cards (board 28). */
export function QuestionCards({ q, picked, onPick }: { q: OnboardingQuestion; picked: string[]; onPick: (ids: string[]) => void }) {
  return (
    <View accessibilityRole={q.multi ? undefined : 'radiogroup'} style={{ gap: 12 }}>
      {q.answers.map((a) => {
        const on = picked.includes(a.id)
        return (
          <Pressable
            key={a.id}
            accessibilityRole={q.multi ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: on }}
            accessibilityLabel={a.description ? `${a.label}, ${a.description}` : a.label}
            onPress={() => {
              haptic.select()
              onPick(q.multi ? (on ? picked.filter((x) => x !== a.id) : [...picked, a.id]) : on && !q.required ? [] : [a.id])
            }}
            style={{ minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, borderRadius: 14, borderWidth: on ? 2 : 1, borderColor: on ? N.amber : N.line2, backgroundColor: on ? 'rgba(255,140,40,0.12)' : N.card }}
          >
            <Text size={24}>{a.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text size={15} weight="bold">
                {a.label}
              </Text>
              {a.description ? (
                <Text size={13} style={{ color: N.muted }}>
                  {a.description}
                </Text>
              ) : null}
            </View>
            {on ? (
              <Text size={16} weight="bold" style={{ color: N.amber }}>
                ✓
              </Text>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

export function OnboardingSheet({ c }: { c: ConstellationDetail }) {
  const insets = useSafeAreaInsets()
  // Sized from the window (a Modal's own box isn't always the screen's width on the web).
  const { width, height } = useWindowDimensions()
  const questions = c.onboarding?.questions ?? []
  const [atRaw, setAt] = useState(0)
  // 0.9.1: an admin may remove a question while you're on it: never past the last one.
  const at = Math.min(atRaw, Math.max(0, questions.length - 1))
  const [answers, setAnswers] = useState<Record<string, string[]>>(() => ({ ...(c.me.onboarding?.answers ?? {}) }))
  const [done, setDone] = useState<ConstellationDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const [, redraw] = useState(0)
  const showing = !!done || (needsOnboarding(c) && !needsWelcome(c) && !answeredFor.has(c.id))
  if (!showing) return null
  const a = accentOf(c)
  const q = questions[at]
  // No questions left (onboarding changed meanwhile): nothing to ask.
  if (!done && !q) return null
  const picked = q ? (answers[q.id] ?? []) : []
  const blocked = !!q?.required && !picked.length

  async function next() {
    if (blocked || busy) return
    if (at < questions.length - 1) {
      haptic.select()
      return setAt(at + 1)
    }
    setBusy(true)
    const r = await cx.answerOnboarding(c.id, answers, true)
    setBusy(false)
    if (!r.ok) {
      cxSay(r.message)
      // Back to the start of the questions as they are now (they may have changed).
      void loadDetail(c.id)
      return
    }
    haptic.success()
    answeredFor.add(c.id)
    setDone(r.data.constellation)
  }
  // Back on the first question: "not now" (asked again next time you open it).
  function notNow() {
    answeredFor.add(c.id)
    redraw((x) => x + 1)
  }
  function open() {
    const d = done
    setDone(null)
    redraw((x) => x + 1)
    if (d) putDetail(d)
  }

  const chosen = questions.flatMap((x) => x.answers.filter((y) => (answers[x.id] ?? []).includes(y.id)))
  const roleNames = [...new Set(chosen.flatMap((x) => x.roleIds))].map((id) => c.roles.find((r) => r.id === id)?.name).filter((x): x is string => !!x)
  const from = roleNames.length ? roleNames : chosen.map((x) => x.label)
  const nebulas = (done?.nebulas ?? []).filter((n) => n.kind !== 'voice')
  const more = (done?.browse?.length ?? 0) + Object.values(done?.unlocks ?? {}).flat().length

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => (done ? open() : at > 0 ? setAt(at - 1) : notNow())}>
      <View accessibilityViewIsModal style={{ width, height, backgroundColor: N.bg, paddingTop: insets.top + 14, paddingBottom: insets.bottom + 12, alignItems: 'center' }}>
        <View style={{ flex: 1, width: Math.min(width - 40, 560) }}>
        {done ? (
          <>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 14 }}>
              <Text size={12} weight="bold" style={{ color: N.muted, letterSpacing: 1 }}>
                ALL SET
              </Text>
              <Text display size={26} accessibilityRole="header">
                Your {c.name}
              </Text>
              {from.length ? (
                <>
                  <Text size={14} style={{ color: N.muted }}>
                    From your answers:
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {from.map((n) => (
                      <View key={n} style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: 'rgba(160,120,255,0.18)' }}>
                        <Text size={13} weight="bold" style={{ color: '#c9b4ff' }}>
                          {n}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
              <View style={{ borderRadius: 14, backgroundColor: N.card, padding: 14, gap: 6 }}>
                {nebulas.slice(0, 12).map((n) => (
                  <Text key={n.id} size={15}>
                    <Text size={12} style={{ color: '#9b7cf0' }}>
                      ✦{'  '}
                    </Text>
                    {n.name}
                  </Text>
                ))}
              </View>
              <Text size={13} style={{ color: N.muted }}>
                {nebulas.length} {nebulas.length === 1 ? 'nebula' : 'nebulas'}
                {more > 0 ? ` · ${more} more you can open any time` : ''}
              </Text>
            </ScrollView>
            <Pressable accessibilityRole="button" onPress={open} style={{ height: 52, borderRadius: 26, backgroundColor: a.color, alignItems: 'center', justifyContent: 'center' }}>
              <Text size={16} weight="bold" style={{ color: a.on }}>
                Open {c.name}
              </Text>
            </Pressable>
          </>
        ) : q ? (
          <>
            <View style={{ flexDirection: 'row', gap: 6, marginBottom: 16 }} accessibilityLabel={`Question ${at + 1} of ${questions.length}`}>
              {Array.from({ length: questions.length + 1 }, (_, i) => (
                <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= at ? N.amber : N.line2 }} />
              ))}
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 12 }}>
              <Text size={12} weight="bold" style={{ color: N.muted, letterSpacing: 1 }}>
                QUESTION {at + 1} OF {questions.length}
              </Text>
              <Text display size={24} accessibilityRole="header">
                {q.title}
              </Text>
              <Text size={14} style={{ color: N.muted, marginBottom: 6 }}>
                {q.multi ? 'Pick any.' : 'Pick one.'} {q.required ? '' : 'You can skip this. '}You can change this later.
              </Text>
              <QuestionCards q={q} picked={picked} onPick={(ids) => setAnswers((x) => ({ ...x, [q.id]: ids }))} />
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {at > 0 ? (
                <Pressable accessibilityRole="button" onPress={() => setAt(at - 1)} style={{ height: 50, paddingHorizontal: 28, borderRadius: 25, borderWidth: 1, borderColor: N.edge2, alignItems: 'center', justifyContent: 'center' }}>
                  <Text size={16} weight="bold">
                    Back
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: blocked || busy }}
                onPress={() => void next()}
                style={{ flex: 1, height: 50, borderRadius: 25, backgroundColor: blocked ? N.line2 : N.amber, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text size={16} weight="bold" style={{ color: blocked ? N.dim : N.amberInk }}>
                  {busy ? 'One moment…' : at === questions.length - 1 ? 'Finish' : 'Next'}
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}
        </View>
      </View>
    </Modal>
  )
}
