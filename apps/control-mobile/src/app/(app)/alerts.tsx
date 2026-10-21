import { useCallback, useEffect, useState } from 'react'
import { AppState, View } from 'react-native'
import { api, ALERT_KINDS, ALERT_LABELS, URGENT_ALERTS, type AlertKind, type AlertPrefs } from '@control/api'
import { Button, Card, GroupTitle, Muted, Row, Screen, Status, Switch, Text } from '@/ui/kit'
import { Icon, Shield } from '@/ui/icons'
import { c } from '@/ui/theme'
import { toast } from '@/ui/toast'
import { useLoad } from '@/lib/hooks'
import { haptic } from '@/lib/haptics'
import { openIosSettings, pushPermission, registerForAlerts, type PushState } from '@/lib/alerts'

// Alerts (Alerts.dc.html): which alerts reach this iPhone. Saved as soon as you flip a switch.

export default function Alerts() {
  const { data, setData, error, loading, refreshing, refresh } = useLoad(() => api.alerts())
  const [push, setPush] = useState<PushState | null>(null)
  const [testing, setTesting] = useState(false)

  const checkPush = useCallback(() => void pushPermission().then(setPush), [])
  useEffect(() => {
    checkPush()
    const sub = AppState.addEventListener('change', (s) => s === 'active' && checkPush())
    return () => sub.remove()
  }, [checkPush])

  async function flip(kind: AlertKind, on: boolean) {
    if (!data) return
    const before = data.prefs
    setData({ ...data, prefs: { ...before, kinds: { ...before.kinds, [kind]: on } } })
    haptic.light()
    const r = await api.setAlertPrefs({ kinds: { [kind]: on } })
    if (r.ok) setData((d) => (d ? { ...d, prefs: r.data.prefs } : d))
    else {
      setData((d) => (d ? { ...d, prefs: before } : d))
      toast(r.message, 'bad')
    }
  }

  async function test() {
    setTesting(true)
    if (push !== 'on') {
      const state = await registerForAlerts(true)
      setPush(state)
    }
    const r = await api.testAlert()
    setTesting(false)
    if (r.ok) {
      haptic.success()
      toast(r.data.message || (r.data.sent ? 'Test alert sent.' : 'Sent, but no phone is set up for alerts yet.'))
    } else toast(r.message, 'bad')
  }

  const prefs: AlertPrefs | undefined = data?.prefs
  const urgent = ALERT_KINDS.filter((k) => URGENT_ALERTS.includes(k))
  const normal = ALERT_KINDS.filter((k) => !URGENT_ALERTS.includes(k))

  return (
    <Screen back title="Alerts" onRefresh={refresh} refreshing={refreshing} contentStyle={{ gap: 14 }}>
      <View
        accessibilityLabel="Example alert: Server isn't answering. Down for 2 minutes. Tap to restart or pause."
        style={{ flexDirection: 'row', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 18, backgroundColor: 'rgba(36,23,74,0.92)' }}
      >
        <View style={{ width: 38, height: 38, borderRadius: 9, backgroundColor: '#3d2775', alignItems: 'center', justifyContent: 'center' }}>
          <Shield size={22} />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text size={13.5} weight="semi" color={c.white}>
              Glofly Control
            </Text>
            <Text size={12} color={c.onVioletMuted}>
              now
            </Text>
          </View>
          <Text size={13.5} weight="semi" color={c.white}>
            Server isn't answering
          </Text>
          <Text size={13.5} color={c.onVioletSoft}>
            Down for 2 minutes. Tap to restart or pause.
          </Text>
        </View>
      </View>

      {push === 'denied' ? (
        <Card style={{ paddingVertical: 2, borderColor: c.warnBorder, backgroundColor: c.warnSoft }}>
          <Row
            first
            title="Notifications are off for Glofly Control"
            sub="Turn them on in iOS Settings to get alerts."
            titleColor={c.warnText}
            left={<Icon name="bell" size={20} color={c.warnText} />}
            onPress={openIosSettings}
          />
        </Card>
      ) : push === 'undetermined' ? (
        <Card style={{ paddingVertical: 2 }}>
          <Row first title="Allow alerts on this iPhone" sub="iOS asks once." left={<Icon name="bell" size={20} color={c.primary} />} onPress={() => void registerForAlerts(true).then(setPush)} />
        </Card>
      ) : null}

      <Status loading={loading} error={!data ? error : null} onRetry={refresh} />
      {prefs ? (
        <>
          <View>
            <GroupTitle>Urgent · break through Focus</GroupTitle>
            <Card>
              {urgent.map((k, i) => (
                <KindRow key={k} kind={k} first={i === 0} on={prefs.kinds[k]} onChange={(v) => void flip(k, v)} />
              ))}
            </Card>
          </View>
          <View>
            <GroupTitle>Normal</GroupTitle>
            <Card>
              {normal.map((k, i) => (
                <KindRow key={k} kind={k} first={i === 0} on={prefs.kinds[k]} onChange={(v) => void flip(k, v)} />
              ))}
            </Card>
          </View>
          {!data?.pushReady ? <Muted>The server isn't set up to send iPhone alerts yet (APNs key). They still show in Recent alerts.</Muted> : null}
          <Button label="Send a test alert" kind="secondary" height={48} busy={testing} onPress={() => void test()} />
        </>
      ) : null}

      <Muted style={{ marginHorizontal: 4, lineHeight: 19 }}>
        Alerts never include message text or names of people who reported someone, so nothing private shows on your lock screen.
      </Muted>
    </Screen>
  )
}

function KindRow({ kind, on, onChange, first }: { kind: AlertKind; on: boolean; onChange: (v: boolean) => void; first: boolean }) {
  const label = ALERT_LABELS[kind]
  return <Row first={first} minHeight={56} title={label.title} sub={label.sub} right={<Switch label={label.title} value={on} onChange={onChange} />} />
}
