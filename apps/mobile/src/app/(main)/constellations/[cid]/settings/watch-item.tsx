import { useEffect, useState } from 'react'
import { TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import type { BanAppeal, NightWatch, QueueItem } from '@glofly/shared'
import { nightWatch } from '@/api/nightwatch'
import { cxSay } from '@/state/constellations'
import { Spinner, Text, webNoOutline } from '@/ui/kit'
import { font } from '@/ui/theme'
import { SettingsScreen, useSettingsDetail } from '@/constellations/settingsKit'
import { banWithOptions } from '@/constellations/moderation'
import { Face, N, NightButton } from '@/constellations/ui'
import { haptic } from '@/constellations/motion'
import { metaOf, titleOf } from '@/constellations/nightwatch'

// Communities round 2 (approved board 1e, middle): one report, held message or appeal, with
// one-tap actions. Ban opens the same reason + appeals choices as desktop.

export default function WatchItemScreen() {
  const { cid, kind, id } = useLocalSearchParams<{ cid: string; kind: string; id: string }>()
  const c = useSettingsDetail(cid)
  const [data, setData] = useState<NightWatch | null>(null)
  const [appeal, setAppeal] = useState<BanAppeal | null>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void nightWatch.dashboard(cid).then((r) => (r.ok ? setData(r.data) : cxSay(r.message)))
    if (kind === 'appeal') void nightWatch.appeals(cid).then((r) => r.ok && setAppeal(r.data.appeals.find((a) => a.id === id) ?? null))
  }, [cid, kind, id])
  const q: QueueItem | undefined = data?.queue.find((x) => x.kind === kind && x.id === id)

  async function run(task: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) {
    setBusy(true)
    const r = await task()
    setBusy(false)
    if (!r.ok) return cxSay(r.message)
    haptic.success()
    cxSay(done)
    router.back()
  }

  if (!data) {
    return (
      <SettingsScreen title="Night watch" c={c}>
        <Spinner />
      </SettingsScreen>
    )
  }
  if (!q) {
    return (
      <SettingsScreen title="Night watch" c={c}>
        <Text size={14} style={{ color: N.muted }}>
          Someone already took care of this.
        </Text>
      </SettingsScreen>
    )
  }
  const who = q.target
  const quote = q.kind === 'appeal' ? (appeal?.body ?? q.excerpt) : q.excerpt
  return (
    <SettingsScreen title={titleOf(q)} c={c}>
      {who ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Face user={who} size={40} />
          <View style={{ flex: 1 }}>
            <Text size={15} weight="bold">
              @{who.username}
            </Text>
            <Text size={12} style={{ color: N.muted }}>
              {metaOf(q)}
            </Text>
          </View>
        </View>
      ) : null}
      <View style={{ padding: 12, borderRadius: 12, backgroundColor: '#1c1512', borderLeftWidth: 3, borderLeftColor: q.kind === 'appeal' ? '#1679a0' : '#c7372f' }}>
        <Text size={14}>{quote}</Text>
      </View>
      {q.kind === 'report' ? (
        <Text size={12.5} style={{ color: N.muted }}>
          Reported by {q.reporters.map((r) => r.displayName.split(/\s+/)[0]).join(', ') || 'members'}
          {q.reportCount > q.reporters.length ? ` and ${q.reportCount - q.reporters.length} more` : ''}
          {!q.messageLive ? ' · already deleted' : ''}
        </Text>
      ) : null}
      {q.kind === 'appeal' && appeal ? (
        <>
          <Text size={12.5} style={{ color: N.muted }}>
            Ban reason: {appeal.ban.reason ? `“${appeal.ban.reason}”` : 'none given'} · before the ban: {appeal.history.timeouts} time-outs, {appeal.history.deleted} deleted messages
          </Text>
          <TextInput
            value={reply}
            onChangeText={setReply}
            placeholder="Reply (optional, they see it)"
            placeholderTextColor={N.faint}
            maxLength={500}
            multiline
            accessibilityLabel="Reply to the appeal"
            style={[{ minHeight: 64, borderRadius: 12, borderWidth: 1, borderColor: N.edge, color: N.ink, padding: 12, fontFamily: font.body, fontSize: 15 }, webNoOutline]}
          />
        </>
      ) : null}
      <View style={{ gap: 10, marginTop: 8 }}>
        {q.kind === 'report' && q.messageLive && data.can.delete && data.can.timeout ? (
          <NightButton label="Delete + time out 1 hour" height={50} busy={busy} onPress={() => void run(() => nightWatch.resolve(cid, q.id, 'delete_timeout', '1h'), 'Deleted, and they’re timed out for an hour.')} />
        ) : null}
        {q.kind === 'report' && q.messageLive && data.can.delete ? (
          <NightButton label="Delete only" kind="outline" height={50} busy={busy} onPress={() => void run(() => nightWatch.resolve(cid, q.id, 'delete'), 'Deleted.')} />
        ) : null}
        {q.kind === 'held' && data.can.delete ? (
          <>
            <NightButton label="Keep hidden" height={50} busy={busy} onPress={() => void run(() => nightWatch.keepHidden(cid, q.id), 'Kept hidden.')} />
            <NightButton label="Let it through" kind="outline" height={50} busy={busy} onPress={() => void run(() => nightWatch.letThrough(cid, q.id), 'Posted.')} />
          </>
        ) : null}
        {(q.kind === 'report' || q.kind === 'held') && who && data.can.ban && c ? (
          <NightButton
            label="Delete + ban…"
            kind="danger"
            height={50}
            busy={busy}
            onPress={async () => {
              if (q.kind === 'held') await nightWatch.keepHidden(cid, q.id)
              if (await banWithOptions(c, who)) router.back()
            }}
          />
        ) : null}
        {q.kind === 'report' ? (
          <NightButton label="Dismiss" kind="quiet" height={50} busy={busy} onPress={() => void run(() => nightWatch.resolve(cid, q.id, 'dismiss'), 'Dismissed.')} />
        ) : null}
        {q.kind === 'appeal' ? (
          <>
            <NightButton label="Unban" height={50} busy={busy} onPress={() => void run(() => nightWatch.decide(cid, q.id, 'accept', reply), 'Unbanned. They got an invite to rejoin.')} />
            <NightButton label="Keep the ban" kind="outline" height={50} busy={busy} onPress={() => void run(() => nightWatch.decide(cid, q.id, 'deny', reply), 'They keep the ban.')} />
          </>
        ) : null}
      </View>
    </SettingsScreen>
  )
}
