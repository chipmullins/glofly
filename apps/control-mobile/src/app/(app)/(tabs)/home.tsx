import { useEffect } from 'react'
import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { api, type Dashboard, type ServerInfo, type Uptime, type UsageReport } from '@control/api'
import { ago, plural, time } from '@control/format'
import { Card, CardTitle, Dot, IconButton, Muted, Row, Screen, Status, Text, VioletHeader } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { c } from '@/ui/theme'
import { useCounts, useLoad } from '@/lib/hooks'
import { routeFor } from '@/lib/alerts'
import { signOut } from '@/state/session'
import { reasonName } from '@/lib/labels'

// Home (Home.dc.html): what's happening now, what needs you, recent alerts. Refreshes every 30 s
// while open and on pull.

type HomeData = { dash: Dashboard; server: ServerInfo | null; uptime: Uptime | null }

async function loadHome() {
  const [dash, server, uptime] = await Promise.all([api.dashboard(), api.server(), api.uptime()])
  if (!dash.ok) return dash
  return { ok: true as const, data: { dash: dash.data, server: server.ok ? server.data : null, uptime: uptime.ok ? uptime.data : null } satisfies HomeData }
}

const today = () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

function upFor(seconds: number): string {
  if (seconds < 3600) return `Up ${Math.max(1, Math.round(seconds / 60))} min`
  if (seconds < 86400) return `Up ${plural(Math.round(seconds / 3600), 'hour')}`
  return `Up ${plural(Math.floor(seconds / 86400), 'day')}`
}

export default function Home() {
  const { data, error, loading, refreshing, refresh } = useLoad(loadHome, [], { everyMs: 30_000 })
  const setCounts = useCounts((s) => s.set)
  const dash = data?.dash
  const now = dash?.now

  useEffect(() => {
    if (dash) setCounts({ openReports: dash.openReports ?? 0, inboxUnread: now?.inboxUnread ?? 0 })
  }, [dash, now, setCounts])

  const paused = data?.server?.pause.paused
  const lockdown = now?.lockdown.on ?? data?.server?.lockdown?.on
  const uptimeSec = data?.server?.uptimeSec ?? dash?.health.server.uptimeSec ?? 0
  const percent = data?.uptime ? `${data.uptime.percent.toFixed(2).replace(/\.?0+$/, '')}% this month` : null
  const status = paused
    ? { title: 'Glofly is paused', sub: 'Everyone sees the pause screen', color: '#ff6b5e', bg: 'rgba(217,54,43,0.18)', border: 'rgba(255,107,94,0.45)' }
    : lockdown
      ? { title: "Running · Lockdown's on", sub: [upFor(uptimeSec), percent].filter(Boolean).join(' · '), color: c.gold, bg: 'rgba(255,194,74,0.12)', border: 'rgba(255,194,74,0.4)' }
      : dash && !dash.health.database.ok
        ? { title: 'Database trouble', sub: 'The server can’t reach the database', color: '#ff6b5e', bg: 'rgba(217,54,43,0.18)', border: 'rgba(255,107,94,0.45)' }
        : { title: "Everything's running", sub: [upFor(uptimeSec), percent].filter(Boolean).join(' · '), color: c.onlineBright, bg: 'rgba(74,222,128,0.10)', border: 'rgba(74,222,128,0.35)' }

  const s = dash?.stats
  const change = s && s.messagesYesterday > 0 ? Math.round(((s.messagesToday - s.messagesYesterday) / s.messagesYesterday) * 100) : null
  const stats = s
    ? [
        { label: 'Online now', value: s.onlineNow.toLocaleString('en-US'), note: plural(s.devicesConnected, 'device') },
        {
          label: 'In calls',
          value: (now?.inCalls ?? 0).toLocaleString('en-US'),
          note: now ? plural(now.calls, 'call') : `${plural(s.callsToday, 'call')} today`,
        },
        {
          label: 'Messages today',
          value: s.messagesToday.toLocaleString('en-US'),
          note: change === null ? `${s.messagesYesterday.toLocaleString('en-US')} yesterday` : `${change >= 0 ? '+' : ''}${change}% vs. yesterday`,
        },
        { label: 'New accounts', value: s.newThisWeek.toLocaleString('en-US'), note: 'This week' },
      ]
    : []

  const todo: { title: string; sub: string; dot: string; go: () => void }[] = []
  if (dash) {
    const open = dash.openReports ?? 0
    if (open > 0)
      todo.push({
        title: plural(open, 'open report'),
        sub: now?.oldestOpenReport ? `Oldest: ${ago(now.oldestOpenReport.createdAt)} · ${reasonName(now.oldestOpenReport.reason)}` : 'Tap to review',
        dot: c.warnDot,
        go: () => router.navigate('/reports'),
      })
    if ((now?.inboxUnread ?? 0) > 0)
      todo.push({ title: `${plural(now!.inboxUnread, 'Inbox reply', 'Inbox replies')} to read`, sub: 'Answers to Glofly Team messages', dot: c.primary, go: () => router.push('/inbox') })
    const failedEmail = dash.health.email.failedToday
    const failedPush = dash.health.push?.failedToday ?? 0
    if (failedEmail + failedPush > 0)
      todo.push({
        title: [failedEmail ? plural(failedEmail, 'email') : null, failedPush ? plural(failedPush, 'push', 'pushes') : null].filter(Boolean).join(' and ') + ' failed today',
        sub: 'Details in desktop Control → Dashboard',
        dot: c.danger,
        go: () => router.navigate('/server'),
      })
    if (lockdown) todo.push({ title: 'Lockdown is on', sub: now?.lockdown.since ? `Since ${ago(now.lockdown.since)}` : 'New accounts can only talk to friends', dot: c.warnDot, go: () => router.navigate('/server') })
    if (paused) todo.push({ title: 'Glofly is paused', sub: 'Unpause from Server', dot: c.danger, go: () => router.navigate('/server') })
  }

  const header = (
    <VioletHeader>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text size={13} color={c.onVioletMuted}>
            {today()}
          </Text>
          <Text display weight="bold" size={26} color={c.white} accessibilityRole="header" style={{ marginTop: 2 }}>
            Control
          </Text>
        </View>
        <IconButton name="bell" label="Alerts" color={c.onViolet} bg="rgba(255,255,255,0.08)" onPress={() => router.push('/alerts')} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Emergency tools"
          onPress={() => router.navigate('/server')}
          style={({ pressed }) => ({
            height: 44,
            paddingHorizontal: 14,
            borderRadius: 22,
            backgroundColor: c.danger,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Icon name="warning" size={18} color={c.white} width={2.2} />
          <Text size={14} weight="semi" color={c.white}>
            Emergency
          </Text>
        </Pressable>
      </View>
      {data ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, backgroundColor: status.bg, borderWidth: 1, borderColor: status.border }}>
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: status.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Dot color={status.color} size={12} />
          </View>
          <View style={{ flex: 1 }}>
            <Text size={15} weight="semi" color={c.white}>
              {status.title}
            </Text>
            <Text size={13} color={c.onVioletSoft}>
              {status.sub}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Server details" onPress={() => router.navigate('/server')} style={{ paddingVertical: 12, paddingLeft: 8 }}>
            <Text size={13} weight="semi" color={c.gold}>
              Details
            </Text>
          </Pressable>
        </View>
      ) : null}
    </VioletHeader>
  )

  return (
    <Screen header={header} onRefresh={refresh} refreshing={refreshing} contentStyle={{ gap: 16 }}>
      <Status loading={loading} error={!data ? error : null} onRetry={refresh} />
      {stats.length ? (
        <View accessibilityLabel="Right now" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 }}>
          {stats.map((st) => (
            <View
              key={st.label}
              accessible
              accessibilityLabel={`${st.label}: ${st.value}, ${st.note}`}
              style={{ flexBasis: '47%', flexGrow: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, gap: 2 }}
            >
              <Text size={12.5} weight="medium" color={c.muted}>
                {st.label}
              </Text>
              <Text display weight="bold" size={26} style={{ lineHeight: 30 }}>
                {st.value}
              </Text>
              <Muted size={12}>{st.note}</Muted>
            </View>
          ))}
        </View>
      ) : null}

      {dash ? (
        <Card style={{ paddingBottom: 4 }}>
          <CardTitle>Needs you</CardTitle>
          {todo.length ? (
            todo.map((t) => (
              <Row key={t.title} title={t.title} sub={t.sub} left={<Dot color={t.dot} />} onPress={t.go} />
            ))
          ) : (
            <Row title="All caught up" sub="No open reports, replies or failures" left={<Dot color={c.online} />} />
          )}
        </Card>
      ) : null}

      {now ? (
        <Card style={{ paddingBottom: 4 }}>
          <CardTitle right={<Muted onPress={() => router.push('/alerts')} accessibilityRole="button" style={{ padding: 8 }}>Settings</Muted>}>Recent alerts</CardTitle>
          {now.alerts.length ? (
            now.alerts.map((a) => (
              <Pressable
                key={a.id}
                accessibilityRole="button"
                onPress={() => router.navigate(routeFor(a.data) as never)}
                style={({ pressed }) => ({ flexDirection: 'row', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.divider, opacity: pressed ? 0.6 : 1 })}
              >
                <Text size={13.5} style={{ flex: 1 }}>
                  {a.body ? `${a.title}: ${a.body}` : a.title}
                </Text>
                <Muted style={{ fontVariant: ['tabular-nums'] }}>{sameDay(a.createdAt) ? time(new Date(a.createdAt)) : ago(a.createdAt)}</Muted>
              </Pressable>
            ))
          ) : (
            <Row title="No alerts yet" sub="They show here and on your lock screen" />
          )}
        </Card>
      ) : null}

      <UsageCard />

      {dash ? (
        <Card style={{ paddingBottom: 2 }}>
          <CardTitle>More</CardTitle>
          <Row title="Inbox" sub="Replies to Glofly Team messages" left={<Icon name="inbox" size={20} color={c.muted} />} onPress={() => router.push('/inbox')} />
          <Row title="Audit log" sub="Everything done in Control" left={<Icon name="list" size={20} color={c.muted} />} onPress={() => router.push('/audit')} />
          <Row
            title="Sign out"
            titleColor={c.dangerText}
            left={<Icon name="signOut" size={20} color={c.dangerText} />}
            chevron={false}
            onPress={() => void signOut('Signed out.')}
          />
        </Card>
      ) : null}
    </Screen>
  )
}

const sameDay = (iso: string) => new Date(iso).toDateString() === new Date().toDateString()

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 100 ? 2 : 0 })

/**
 * Usage & costs (Oct 27, 2026), like desktop Control's: this month so far and on pace for the
 * month, per service. Hidden on a server that doesn't have it yet.
 */
function UsageCard() {
  const { data } = useLoad<UsageReport>(() => api.usage(), [], { everyMs: 5 * 60_000 })
  if (!data) return null
  const projected = new Map(data.endOfMonth.lines.map((l) => [l.key, l.monthly]))
  return (
    <Card style={{ paddingBottom: 2 }}>
      <CardTitle right={<Muted>Estimate</Muted>}>Usage & costs</CardTitle>
      <Text style={{ marginBottom: 6 }}>
        About {money(data.soFar.total)} so far · on pace for {money(data.endOfMonth.total)}
      </Text>
      {data.soFar.lines.map((line, i) => (
        <Row key={line.key} first={i === 0} title={line.label} sub={line.detail} right={<Text>{money(projected.get(line.key) ?? line.monthly)}</Text>} />
      ))}
    </Card>
  )
}
