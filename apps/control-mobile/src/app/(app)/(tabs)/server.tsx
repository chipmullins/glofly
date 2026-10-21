import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import {
  api,
  PLATFORM_LABEL,
  type Announcement,
  type AppPlatform,
  type ApprovedPhone,
  type LockdownState,
  type ServerInfo,
  type SignupMode,
  type Uptime,
} from '@control/api'
import { ago, plural, when } from '@control/format'
import { Card, CardTitle, Chip, Dot, Muted, Row, Screen, Status, Text } from '@/ui/kit'
import { Icon, type IconName } from '@/ui/icons'
import { c, type ChipTone } from '@/ui/theme'
import { openSheet } from '@/ui/ConfirmSheet'
import { toast } from '@/ui/toast'
import { useLoad } from '@/lib/hooks'

// Server = Emergency (Emergency.dc.html): the four big switches, then sign-ups, banner, required
// update, uptime and approved phones. Every change goes through the confirm sheet; the dangerous
// ones ask for Face ID right before they're sent.

const PLATFORMS: AppPlatform[] = ['desktop', 'ios', 'android', 'web']
const MODE_LABEL: Record<SignupMode, string> = { open: 'Open', invite: 'Invite only', closed: 'Closed' }
const MODE_TONE: Record<SignupMode, ChipTone> = { open: 'good', invite: 'warn', closed: 'danger' }

type ServerData = {
  server: ServerInfo
  lockdown: { lockdown: LockdownState; affected: number; hours: number } | null
  mode: SignupMode | null
  banner: Announcement | null
  mins: Record<AppPlatform, { min: string | null; message: string | null; newest: string | null }>
  uptime: Uptime | null
  phones: { devices: ApprovedPhone[]; max: number } | null
}

async function loadServer() {
  const [server, lockdown, signups, ann, uptime, phones, ...versions] = await Promise.all([
    api.server(),
    api.lockdown(),
    api.signups(),
    api.announcements(),
    api.uptime(),
    api.phones(),
    ...PLATFORMS.map((p) => api.appVersion(undefined, p)),
  ])
  if (!server.ok) return server
  const mins = Object.fromEntries(
    PLATFORMS.map((p, i) => {
      const v = versions[i]
      return [p, v.ok ? { min: v.data.minVersion, message: v.data.message, newest: v.data.newest } : { min: null, message: null, newest: null }]
    }),
  ) as ServerData['mins']
  return {
    ok: true as const,
    data: {
      server: server.data,
      lockdown: lockdown.ok ? lockdown.data : null,
      mode: signups.ok ? signups.data.mode : null,
      banner: ann.ok ? ann.data.current : null,
      mins,
      uptime: uptime.ok ? uptime.data : null,
      phones: phones.ok ? phones.data : null,
    } satisfies ServerData,
  }
}

/** "in 3 h", "in 2 days". */
function until(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms < 3600_000) return `in ${Math.max(1, Math.round(ms / 60_000))} min`
  if (ms < 86400_000) return `in ${Math.round(ms / 3600_000)} h`
  return `in ${plural(Math.round(ms / 86400_000), 'day')}`
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function Server() {
  const { data, error, loading, refreshing, refresh, reload } = useLoad(loadServer)
  const [restarting, setRestarting] = useState(false)
  const s = data?.server
  const paused = !!s?.pause.paused
  const lockOn = !!data?.lockdown?.lockdown.on

  function pause() {
    if (!s) return
    openSheet({
      title: 'Pause Glofly?',
      explanation: 'Everyone sees the pause screen with your message until you unpause. Control keeps working.',
      action: 'Pause',
      danger: true,
      faceId: true,
      fields: [{ kind: 'text', key: 'message', label: 'Message people see', initial: s.defaultPauseMessage, multiline: true, maxLength: 300 }],
      run: (note, v) => api.setPause(true, String(v.message ?? '').trim(), note),
      done: 'Glofly is paused.',
      onDone: reload,
    })
  }
  function unpause() {
    openSheet({
      title: 'Unpause Glofly?',
      explanation: 'Everyone can use Glofly again right away.',
      action: 'Unpause',
      faceId: true,
      run: (note) => api.setPause(false, '', note),
      done: 'Glofly is running again.',
      onDone: reload,
    })
  }
  function changeMessage() {
    if (!s) return
    openSheet({
      title: 'Change the pause message',
      action: 'Save message',
      fields: [{ kind: 'text', key: 'message', label: 'Message people see', initial: s.pause.message, multiline: true, maxLength: 300 }],
      run: (note, v) => api.setPause(true, String(v.message ?? '').trim(), note),
      done: 'Message changed.',
      onDone: reload,
    })
  }
  function restart() {
    if (!s) return
    if (!s.canRestart) return toast('This server can’t restart itself (only the live server can).', 'bad')
    openSheet({
      title: 'Restart the server?',
      explanation: 'Everyone reconnects in about 10 seconds. Calls in progress usually drop.',
      action: 'Restart',
      danger: true,
      faceId: true,
      run: (note) => api.restartServer(note),
      done: 'Restarting…',
      onDone: (d) => void waitForRestart((d as { startedAt?: string })?.startedAt ?? s.startedAt),
    })
  }
  async function waitForRestart(oldStart: string) {
    setRestarting(true)
    const t0 = Date.now()
    await sleep(2000)
    while (Date.now() - t0 < 120_000) {
      const r = await api.server()
      if (r.ok && r.data.startedAt !== oldStart) {
        setRestarting(false)
        toast(`Server back after restart (${Math.max(1, Math.round((Date.now() - t0) / 1000))} s).`)
        reload()
        return
      }
      if (!r.ok && r.status === 401) break
      await sleep(1500)
    }
    setRestarting(false)
    toast('The server hasn’t come back yet. Check again in a minute.', 'bad')
    reload()
  }
  function lockdown() {
    const l = data?.lockdown
    openSheet({
      title: lockOn ? 'Turn off Lockdown?' : 'Turn on Lockdown?',
      explanation: lockOn
        ? 'New accounts can make friends and talk to anyone again.'
        : `Accounts made in the last ${l?.hours ?? 24} hours can only talk to friends they already have${l ? ` (${plural(l.affected, 'account')} right now)` : ''}. Use it during a spam wave.`,
      action: lockOn ? 'Turn off' : 'Turn on',
      danger: !lockOn,
      faceId: true,
      run: (note) => api.setLockdown(!lockOn, note),
      done: lockOn ? 'Lockdown is off.' : 'Lockdown is on.',
      onDone: reload,
    })
  }
  function endCalls() {
    openSheet({
      title: 'End all calls?',
      explanation: 'Hangs up every call, voice room and Watch Together on Glofly right now.',
      action: 'End all calls',
      danger: true,
      faceId: true,
      run: (note) => api.endAllCalls(note),
      onDone: reload,
    })
  }
  function signups() {
    if (!data?.mode) return
    openSheet({
      title: 'Who can make a new account?',
      action: 'Change sign-ups',
      faceId: true,
      fields: [
        {
          kind: 'choice',
          key: 'mode',
          label: 'Sign-ups',
          initial: data.mode,
          options: (['open', 'invite', 'closed'] as SignupMode[]).map((m) => ({ value: m, label: MODE_LABEL[m] })),
        },
      ],
      validate: (v) => (v.mode === data.mode ? `Sign-ups are already ${MODE_LABEL[data.mode].toLowerCase()}.` : null),
      run: (note, v) => api.setMode(v.mode as SignupMode, note),
      done: 'Sign-ups changed.',
      onDone: reload,
    })
  }
  function banner() {
    const b = data?.banner
    if (b) {
      openSheet({
        title: 'End the banner?',
        explanation: `“${b.body}” stops showing at the top of Glofly.`,
        action: 'End banner',
        run: (note) => api.endAnnouncement(b.id, note),
        done: 'Banner ended.',
        onDone: reload,
      })
      return
    }
    openSheet({
      title: 'Post a banner',
      explanation: 'One line at the top of every Glofly app. A new one replaces the current one.',
      action: 'Post banner',
      fields: [
        { kind: 'text', key: 'body', label: 'Banner text', multiline: true, maxLength: 240 },
        { kind: 'choice', key: 'tone', label: 'Tone', initial: 'info', options: [{ value: 'info', label: 'Info' }, { value: 'important', label: 'Important' }] },
        {
          kind: 'choice',
          key: 'hours',
          label: 'Ends',
          initial: '24',
          options: [
            { value: '1', label: 'In 1 hour' },
            { value: '24', label: 'In a day' },
            { value: '168', label: 'In a week' },
            { value: '', label: 'When I end it' },
          ],
        },
      ],
      validate: (v) => (String(v.body ?? '').trim().length < 3 ? 'Write the banner.' : null),
      run: (note, v) =>
        api.postAnnouncement({ body: String(v.body).trim(), tone: v.tone === 'important' ? 'important' : 'info', hours: v.hours ? Number(v.hours) : null, note }),
      done: 'Banner posted.',
      onDone: reload,
    })
  }
  function requiredUpdate(p: AppPlatform) {
    const m = data?.mins[p]
    if (!m) return
    if (m.min) {
      openSheet({
        title: `${PLATFORM_LABEL[p]}: ${m.min} required`,
        explanation: `Older ${PLATFORM_LABEL[p]} apps are asked to update before they can be used. Change the minimum, or remove it.`,
        action: 'Save minimum',
        faceId: true,
        fields: [
          { kind: 'switch', key: 'remove', label: 'Remove the minimum', sub: 'Every version works again', initial: false },
          { kind: 'text', key: 'version', label: 'Minimum version', initial: m.min, autoCapitalize: 'none' },
          { kind: 'text', key: 'message', label: 'Message (optional)', initial: m.message ?? '', multiline: true, maxLength: 200 },
        ],
        validate: (v) => (!v.remove && !/^\d+\.\d+\.\d+$/.test(String(v.version).trim()) ? 'Use a version like 0.8.2.' : null),
        run: (note, v) => api.setAppVersion(v.remove ? null : String(v.version).trim(), v.remove ? '' : String(v.message ?? '').trim(), note, p),
        done: 'Required update changed.',
        onDone: reload,
      })
      return
    }
    openSheet({
      title: `Require a ${PLATFORM_LABEL[p]} update`,
      explanation: `${PLATFORM_LABEL[p]} apps older than this are asked to update before they can be used.${m.newest ? ` Newest seen: ${m.newest}.` : ''}`,
      action: 'Require update',
      faceId: true,
      fields: [
        { kind: 'text', key: 'version', label: 'Minimum version', initial: m.newest ?? '', autoCapitalize: 'none', placeholder: '0.8.2' },
        { kind: 'text', key: 'message', label: 'Message (optional)', multiline: true, maxLength: 200 },
      ],
      validate: (v) => (!/^\d+\.\d+\.\d+$/.test(String(v.version).trim()) ? 'Use a version like 0.8.2.' : null),
      run: (note, v) => api.setAppVersion(String(v.version).trim(), String(v.message ?? '').trim(), note, p),
      done: 'Required update set.',
      onDone: reload,
    })
  }

  const statusLabel = !s ? null : paused ? ['Paused', c.dangerText, c.danger] : restarting ? ['Restarting', c.warnText, c.warnDot] : ['Running', c.goodText, c.online]
  const minsText = data
    ? PLATFORMS.filter((p) => data.mins[p].min)
        .map((p) => `${PLATFORM_LABEL[p]} ${data.mins[p].min}`)
        .join(' · ')
    : ''

  return (
    <Screen
      title="Emergency"
      onRefresh={refresh}
      refreshing={refreshing}
      right={
        statusLabel ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityLabel={`Server: ${statusLabel[0]}`}>
            <Dot color={statusLabel[2]} size={8} />
            <Text size={13} weight="semi" color={statusLabel[1]}>
              {statusLabel[0]}
            </Text>
          </View>
        ) : null
      }
    >
      <Status loading={loading} error={!data ? error : null} onRetry={refresh} />
      {s ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {paused ? (
              <Tile title="Unpause" sub={`Paused ${ago(s.pause.since)}. Tap to let everyone back in.`} icon="play" tone="danger" onPress={unpause} />
            ) : (
              <Tile title="Pause Glofly" sub="Everyone sees the pause screen. Control keeps working." icon="pause" tone="danger" onPress={pause} />
            )}
            <Tile
              title="Restart server"
              sub={restarting ? 'Waiting for it to come back…' : s.canRestart ? 'Back in about 10 s' : 'Only the live server can restart itself'}
              icon="restart"
              disabled={!s.canRestart || restarting}
              onPress={restart}
            />
            <Tile
              title={lockOn ? 'Lockdown is on' : 'Lockdown'}
              sub={
                lockOn
                  ? `${plural(data.lockdown?.affected ?? 0, 'new account')} limited. Tap to turn off.`
                  : 'New accounts can only talk to friends'
              }
              icon="lock"
              tone={lockOn ? 'warn' : undefined}
              onPress={lockdown}
            />
            <Tile title="End all calls" sub="Hangs up every call and Watch Together" icon="hangup" onPress={endCalls} />
          </View>
          {paused ? (
            <Card style={{ paddingVertical: 4 }}>
              <Row first title="Pause message" sub={s.pause.message} onPress={changeMessage} />
            </Card>
          ) : null}

          <Card>
            <Row
              first
              title="Sign-ups"
              sub="Who can make a new account"
              right={data.mode ? <Chip label={MODE_LABEL[data.mode]} tone={MODE_TONE[data.mode]} /> : null}
              onPress={signups}
              chevron={false}
              minHeight={54}
            />
            <Row
              title="Banner"
              sub={data.banner ? data.banner.body : 'One line at the top of every Glofly'}
              right={<Chip label={data.banner ? (data.banner.endsAt ? `Ends ${until(data.banner.endsAt)}` : 'On') : 'None'} tone={data.banner ? (data.banner.tone === 'important' ? 'warn' : 'hot') : 'off'} />}
              onPress={banner}
              chevron={false}
              minHeight={54}
            />
            <View style={{ borderTopWidth: 1, borderTopColor: c.divider, paddingVertical: 10, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text size={14} weight="semi">
                    Required update
                  </Text>
                  <Muted>{minsText || 'No minimum version for any app'}</Muted>
                </View>
                <Chip label={minsText ? 'On' : 'Off'} tone={minsText ? 'warn' : 'off'} />
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {PLATFORMS.map((p) => (
                  <Pressable
                    key={p}
                    accessibilityRole="button"
                    accessibilityLabel={`${PLATFORM_LABEL[p]} minimum: ${data.mins[p].min ?? 'none'}`}
                    onPress={() => requiredUpdate(p)}
                    style={({ pressed }) => ({
                      minHeight: 44,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: c.fieldBorder,
                      justifyContent: 'center',
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Text size={13} weight="semi">
                      {PLATFORM_LABEL[p]}
                    </Text>
                    <Muted size={12}>{data.mins[p].min ? `${data.mins[p].min}+` : 'Any version'}</Muted>
                  </Pressable>
                ))}
              </View>
            </View>
          </Card>

          {data.uptime ? <UptimeCard uptime={data.uptime} /> : null}

          {data.phones ? (
            <Card style={{ paddingBottom: 6 }}>
              <CardTitle right={<Muted>{`${data.phones.devices.length} of ${data.phones.max}`}</Muted>}>Approved phones</CardTitle>
              {data.phones.devices.map((p) => (
                <Row
                  key={p.id}
                  title={
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text size={14} weight="semi">
                        {p.name}
                      </Text>
                      {p.thisDevice ? <Chip small label="This iPhone" tone="hot" /> : null}
                    </View>
                  }
                  sub={`Approved ${when(p.createdAt)}${p.lastUsedAt ? ` · used ${ago(p.lastUsedAt)}` : ''} · alerts ${p.alerts ? 'on' : 'off'}`}
                  left={<Icon name="phone" size={20} color={c.muted} />}
                />
              ))}
              <Muted style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: c.divider }}>Approve new phones from desktop Control at home.</Muted>
            </Card>
          ) : null}

          <Card style={{ paddingVertical: 2 }}>
            <Row first title="Audit log" sub="Everything done in Control" left={<Icon name="list" size={20} color={c.muted} />} onPress={() => router.push('/audit')} />
          </Card>
        </>
      ) : null}
    </Screen>
  )
}

function Tile({ title, sub, icon, tone, onPress, disabled }: { title: string; sub: string; icon: IconName; tone?: 'danger' | 'warn'; onPress: () => void; disabled?: boolean }) {
  const [bg, fg, border] = tone === 'danger' ? [c.danger, c.white, c.danger] : tone === 'warn' ? [c.warnSoft, c.warnText, c.warnBorder] : [c.card, c.ink, c.border]
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}`}
      accessibilityState={{ disabled: !!disabled }}
      onPress={disabled ? () => toast(sub, 'bad') : onPress}
      style={({ pressed }) => ({
        flexBasis: '47%',
        flexGrow: 1,
        minHeight: 118,
        padding: 14,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: bg,
        gap: 6,
        opacity: disabled ? 0.55 : pressed ? 0.85 : 1,
      })}
    >
      <Icon name={icon} size={24} color={fg} />
      <Text display weight="semi" size={16} color={fg}>
        {title}
      </Text>
      <Text size={12} color={fg} style={{ opacity: 0.85, lineHeight: 16 }}>
        {sub}
      </Text>
    </Pressable>
  )
}

const UPTIME_KIND: Record<string, string> = { outage: 'Outage', restart: 'Restart', update: 'Update', pause: 'Paused' }

function duration(sec: number | null): string {
  if (sec === null) return 'ongoing'
  if (sec < 60) return `${sec} s`
  if (sec < 3600) return `${Math.round(sec / 60)} min`
  return `${(sec / 3600).toFixed(1)} h`
}

function UptimeCard({ uptime }: { uptime: Uptime }) {
  const [open, setOpen] = useState(false)
  return (
    <Card style={{ paddingBottom: 12 }}>
      <CardTitle right={<Text display weight="bold" size={18}>{`${uptime.percent.toFixed(2)}%`}</Text>}>Uptime</CardTitle>
      <Muted style={{ marginBottom: 8 }}>The last 30 days</Muted>
      <View accessibilityLabel={`${uptime.days.filter((d) => d.status === 'down').length} days with outages in the last 30`} style={{ flexDirection: 'row', gap: 3, height: 28 }}>
        {uptime.days.map((d) => (
          <View
            key={d.day}
            style={{ flex: 1, borderRadius: 3, backgroundColor: d.status === 'down' ? c.danger : d.status === 'you' ? c.warnDot : c.online, opacity: d.status === 'up' ? 0.75 : 1 }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
        <Legend color={c.online} label="Up" />
        <Legend color={c.warnDot} label="Restart, update or pause" />
        <Legend color={c.danger} label="Outage" />
      </View>
      {uptime.events.length ? (
        <>
          <Pressable accessibilityRole="button" onPress={() => setOpen(!open)} style={{ minHeight: 44, justifyContent: 'center', marginTop: 4 }}>
            <Text size={13.5} weight="semi" color={c.primary}>
              {open ? 'Hide events' : `Show ${plural(uptime.events.length, 'event')}`}
            </Text>
          </Pressable>
          {open
            ? uptime.events.map((e, i) => (
                <View key={`${e.startedAt}${i}`} style={{ flexDirection: 'row', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.divider }}>
                  <Text size={13.5} weight="semi" style={{ width: 70 }}>
                    {UPTIME_KIND[e.kind] ?? e.kind}
                  </Text>
                  <Text size={13.5} style={{ flex: 1 }}>
                    {when(e.startedAt)}
                  </Text>
                  <Muted>{duration(e.seconds)}</Muted>
                </View>
              ))
            : null}
        </>
      ) : null}
    </Card>
  )
}

const Legend = ({ color, label }: { color: string; label: string }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
    <Dot color={color} size={8} />
    <Muted size={12}>{label}</Muted>
  </View>
)
