import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { api, type ReportDetail, type ReportRow, type ResolveAction } from '@control/api'
import { ago, when } from '@control/format'
import { Avatar, Card, Chip, IconButton, Muted, Pill, Row, Screen, Status, Text } from '@/ui/kit'
import { Icon, type IconName } from '@/ui/icons'
import { c } from '@/ui/theme'
import { openSheet } from '@/ui/ConfirmSheet'
import { useCounts, useLoad } from '@/lib/hooks'
import { OUTCOME, REASON_TONE, reasonName } from '@/lib/labels'

// Reports (Reports.dc.html): the open queue one at a time ("1 of 3 open", next / previous), the
// reported person, reason, reporter, where, the details and the conversation as the reporter saw
// it with the reported message marked. Dismiss / Remove / Warn / Suspend go through the sheet.

export default function Reports() {
  const params = useLocalSearchParams<{ open?: string }>()
  const [show, setShow] = useState<'open' | 'resolved'>('open')
  const list = useLoad(() => api.reports(show), [show], { everyMs: 60_000 })
  const setCounts = useCounts((s) => s.set)
  const rows = list.data?.reports ?? []
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    if (list.data) setCounts({ openReports: list.data.counts.open })
  }, [list.data, setCounts])

  // An alert can ask for one report.
  useEffect(() => {
    if (params.open) {
      setShow('open')
      setPicked(params.open)
    }
  }, [params.open])

  useEffect(() => {
    if (picked && rows.length) {
      const i = rows.findIndex((r) => r.id === picked)
      if (i >= 0) setIndex(i)
    }
  }, [picked, rows])

  const safeIndex = Math.min(index, Math.max(rows.length - 1, 0))
  const current = show === 'open' ? rows[safeIndex] : picked ? rows.find((r) => r.id === picked) : undefined
  const counts = list.data?.counts

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {show === 'open' && rows.length > 1 ? (
        <>
          <Muted size={13} weight="medium">{`${safeIndex + 1} of ${rows.length} open`}</Muted>
          <IconButton name="chevronLeft" label="Previous report" border={c.fieldBorder} bg={c.card} size={18} disabled={safeIndex === 0} onPress={() => setIndex(safeIndex - 1)} />
          <IconButton name="chevron" label="Next report" border={c.fieldBorder} bg={c.card} size={18} disabled={safeIndex >= rows.length - 1} onPress={() => setIndex(safeIndex + 1)} />
        </>
      ) : show === 'open' && rows.length === 1 ? (
        <Muted size={13} weight="medium">1 of 1 open</Muted>
      ) : null}
    </View>
  )

  return (
    <Screen title="Reports" right={header} onRefresh={list.refresh} refreshing={list.refreshing}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pill label={`Open${counts ? ` · ${counts.open}` : ''}`} on={show === 'open'} onPress={() => (setShow('open'), setPicked(null), setIndex(0))} />
        <Pill label={`Resolved${counts ? ` · ${counts.resolved}` : ''}`} on={show === 'resolved'} onPress={() => (setShow('resolved'), setPicked(null))} />
      </View>
      <Status loading={list.loading} error={!list.data ? list.error : null} onRetry={list.refresh} />
      {list.data && show === 'open' && !rows.length ? <Status empty="No open reports. Nice." /> : null}

      {show === 'resolved' && !picked
        ? rows.length
          ? (
            <Card>
              {rows.map((r, i) => (
                <ResolvedRow key={r.id} r={r} first={i === 0} onPress={() => setPicked(r.id)} />
              ))}
            </Card>
          )
          : list.data
            ? <Status empty="Nothing resolved yet." />
            : null
        : null}
      {show === 'resolved' && picked ? (
        <Pressable accessibilityRole="button" onPress={() => setPicked(null)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="back" size={18} color={c.primary} />
          <Text size={14} weight="semi" color={c.primary}>
            All resolved reports
          </Text>
        </Pressable>
      ) : null}

      {current || (show === 'resolved' && picked) ? (
        <ReportView
          key={current?.id ?? picked!}
          id={current?.id ?? picked!}
          onResolved={() => {
            list.reload()
          }}
        />
      ) : null}
    </Screen>
  )
}

function ResolvedRow({ r, first, onPress }: { r: ReportRow; first: boolean; onPress: () => void }) {
  return (
    <Row
      first={first}
      onPress={onPress}
      title={r.reported ? `@${r.reported.username}` : 'Deleted account'}
      sub={`${r.reasonLabel} · ${r.resolvedAt ? ago(r.resolvedAt) : ago(r.createdAt)}`}
      right={r.outcome ? <Chip small label={OUTCOME[r.outcome][0]} tone={OUTCOME[r.outcome][1]} /> : null}
    />
  )
}

function ReportView({ id, onResolved }: { id: string; onResolved: () => void }) {
  const { data, error, loading, reload } = useLoad(() => api.report(id), [id])
  const r = data?.report
  const people = useMemo(() => new Map((r?.people ?? []).map((p) => [p.id, p])), [r])
  if (loading || (!r && error)) return <Status loading={loading} error={error} onRetry={reload} />
  if (!r) return null
  const open = r.status === 'open'
  const reported = r.reported
  const where = whereText(r)

  function act(kind: ResolveAction['action']) {
    if (!r) return
    const who = reported ? `@${reported.username}` : 'this account'
    const hasMessage = r.kind === 'message' && !!r.message && !r.message.deleted
    const done = () => {
      reload()
      onResolved()
    }
    if (kind === 'dismiss')
      openSheet({
        title: 'Dismiss this report?',
        explanation: 'Nothing happens to anyone; the report moves to Resolved.',
        action: 'Dismiss',
        run: (note) => api.resolveReport(r.id, { action: 'dismiss', note }),
        done: 'Report dismissed.',
        onDone: done,
      })
    else if (kind === 'remove')
      openSheet({
        title: 'Remove the reported message?',
        explanation: hasMessage ? `It disappears for everyone in the chat. ${who} isn't told.` : 'The message is already gone; this just closes the report.',
        action: 'Remove',
        danger: true,
        run: (note) => api.resolveReport(r.id, { action: 'remove', note }),
        done: 'Message removed.',
        onDone: done,
      })
    else if (kind === 'warn')
      openSheet({
        title: `Warn ${who}?`,
        explanation: 'They see your warning the next time they open Glofly.',
        action: 'Send warning',
        fields: [
          { kind: 'text', key: 'warning', label: 'Warning they see', multiline: true, maxLength: 500, initial: warningFor(r.reason) },
          ...(hasMessage ? [{ kind: 'switch' as const, key: 'alsoRemove', label: 'Also remove the reported message', initial: true }] : []),
        ],
        validate: (v) => (String(v.warning ?? '').trim().length < 3 ? 'Write the warning they’ll see.' : null),
        run: (note, v) => api.resolveReport(r.id, { action: 'warn', warning: String(v.warning).trim(), alsoRemove: !!v.alsoRemove, note }),
        done: 'Warning sent.',
        onDone: done,
      })
    else
      openSheet({
        title: `Suspend ${who}?`,
        explanation: 'They’re signed out everywhere and see your reason when they try to log in. You can unsuspend later.',
        action: 'Suspend',
        danger: true,
        faceId: true,
        fields: [
          { kind: 'text', key: 'reason', label: 'Reason they see', multiline: true, maxLength: 200 },
          ...(hasMessage ? [{ kind: 'switch' as const, key: 'alsoRemove', label: 'Also remove the reported message', initial: true }] : []),
        ],
        validate: (v) => (String(v.reason ?? '').trim().length < 3 ? 'Write the reason they’ll see.' : null),
        run: (note, v) => api.resolveReport(r.id, { action: 'suspend', reason: String(v.reason).trim(), alsoRemove: !!v.alsoRemove, note }),
        done: 'Account suspended.',
        onDone: done,
      })
  }

  const lines = r.context.length ? r.context : r.message ? [r.message] : []

  return (
    <>
      <Card style={{ paddingVertical: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {reported ? <Avatar id={reported.id} name={reported.displayName || reported.username} size={40} /> : <Avatar id="x" name="?" size={40} />}
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens the account"
            disabled={!reported?.exists}
            onPress={() => reported && router.push(`/account/${reported.id}`)}
            style={{ flex: 1 }}
          >
            <Text size={15} weight="semi">
              {reported ? `@${reported.username}` : 'Deleted account'}
            </Text>
            <Muted>
              {[reported?.displayName, r.otherReportsAboutThem ? `${r.otherReportsAboutThem} other report${r.otherReportsAboutThem === 1 ? '' : 's'}` : 'No other reports', r.reportedSuspended ? 'suspended' : null]
                .filter(Boolean)
                .join(' · ')}
            </Muted>
          </Pressable>
          <Chip small label={reasonName(r.reason)} tone={REASON_TONE[r.reason]} />
        </View>
        <Text size={13} color={c.muted} style={{ lineHeight: 19 }}>
          {`Reported by ${r.reporter ? `@${r.reporter.username}` : 'a deleted account'} · ${ago(r.createdAt)}`}
          {where ? (
            <>
              {' · '}
              <Text size={13} weight="semi">
                {where}
              </Text>
            </>
          ) : null}
        </Text>
        {r.details ? (
          <View style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: c.page }}>
            <Text size={13.5} style={{ lineHeight: 20 }}>{`“${r.details}”`}</Text>
          </View>
        ) : null}
        {!open ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {r.outcome ? <Chip small label={OUTCOME[r.outcome][0]} tone={OUTCOME[r.outcome][1]} /> : null}
            <Muted>{[r.resolvedBy ? `by @${r.resolvedBy}` : null, r.resolvedAt ? when(r.resolvedAt) : null, r.note].filter(Boolean).join(' · ')}</Muted>
          </View>
        ) : null}
      </Card>

      {lines.length ? (
        <Card style={{ paddingVertical: 12, gap: 10 }}>
          <Text size={12} weight="semi" color={c.muted} style={{ textTransform: 'uppercase', letterSpacing: 0.7 }} accessibilityRole="header">
            {r.reporter ? `As @${r.reporter.username} saw it` : 'As the reporter saw it'}
          </Text>
          <ScrollView nestedScrollEnabled style={{ maxHeight: 340 }} contentContainerStyle={{ gap: 10 }}>
            {lines.map((m) => {
              const marked = m.id === r.messageId
              const who = people.get(m.senderId)
              return (
                <View
                  key={m.id}
                  accessibilityLabel={`${marked ? 'Reported message. ' : ''}${who ? `@${who.username}` : 'Someone'}: ${m.deleted ? 'deleted' : m.body}`}
                  style={{
                    gap: 2,
                    paddingVertical: marked ? 8 : 0,
                    paddingHorizontal: marked ? 10 : 2,
                    borderRadius: 10,
                    backgroundColor: marked ? c.dangerSoft : 'transparent',
                    borderWidth: marked ? 1 : 0,
                    borderColor: c.dangerBorder,
                  }}
                >
                  <Text size={12.5} weight="semi" color={c.primary}>
                    {who ? `@${who.username}` : 'Someone'}
                    <Muted size={11.5}>{`  ${when(m.createdAt)}`}</Muted>
                  </Text>
                  <Text size={13.5} style={{ lineHeight: 19, fontStyle: m.deleted ? 'italic' : 'normal' }} color={m.deleted ? c.muted : c.ink}>
                    {m.deleted ? 'Message deleted' : m.body || (m.attachments.length ? `[${m.attachments.length} attachment${m.attachments.length === 1 ? '' : 's'}]` : '')}
                  </Text>
                </View>
              )
            })}
          </ScrollView>
        </Card>
      ) : r.kind === 'person' ? (
        <Card style={{ paddingVertical: 12 }}>
          <Muted size={13}>This report is about the person, not one message.</Muted>
        </Card>
      ) : null}

      {open ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <ActionTile label="Dismiss" icon="close" onPress={() => act('dismiss')} />
          <ActionTile label="Remove" icon="trash" onPress={() => act('remove')} disabled={r.kind !== 'message'} />
          <ActionTile label="Warn" icon="warning" tone="warn" onPress={() => act('warn')} disabled={!reported?.exists} />
          <ActionTile label="Suspend" icon="ban" tone="danger" onPress={() => act('suspend')} disabled={!reported?.exists || r.reportedSuspended} />
        </View>
      ) : null}
    </>
  )
}

function ActionTile({ label, icon, tone, onPress, disabled }: { label: string; icon: IconName; tone?: 'warn' | 'danger'; onPress: () => void; disabled?: boolean }) {
  const [bg, fg, border] = tone === 'danger' ? [c.danger, c.white, c.danger] : tone === 'warn' ? [c.warnSoft, c.warnText, c.warnBorder] : [c.card, c.ink, c.fieldBorder]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 62,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
      })}
    >
      <Icon name={icon} size={20} color={fg} />
      <Text size={12.5} weight="semi" color={fg} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </Pressable>
  )
}

function whereText(r: ReportDetail): string | null {
  if (!r.chat) return null
  if (r.chat.kind === 'nebula') return `${r.chat.constellation.name} › #${r.chat.name}`
  if (r.chat.kind === 'group') return r.chat.name ? `Group “${r.chat.name}”` : 'A group'
  return 'A direct chat'
}

function warningFor(reason: string): string {
  switch (reason) {
    case 'spam':
      return 'Please stop posting spam or the same link over and over. Next time your account may be suspended.'
    case 'harassment':
      return 'Please be kind to others on Glofly. Harassing people can get your account suspended.'
    default:
      return 'Something you posted broke Glofly’s rules. Please keep it friendly, or your account may be suspended.'
  }
}
