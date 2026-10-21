import { router } from 'expo-router'
import { api } from '@control/api'
import { ago } from '@control/format'
import { Avatar, Card, Chip, Muted, Row, Screen, Status, Text } from '@/ui/kit'
import { c } from '@/ui/theme'
import { useLoad } from '@/lib/hooks'

// Inbox: replies to "Message as Glofly team".
export default function Inbox() {
  const { data, error, loading, refreshing, refresh } = useLoad(() => api.inbox(), [], { everyMs: 30_000 })
  return (
    <Screen back title="Inbox" onRefresh={refresh} refreshing={refreshing}>
      <Status loading={loading} error={!data ? error : null} onRetry={refresh} />
      {data && !data.threads.length ? <Status empty="No team messages yet. Send one from an account's page." /> : null}
      {data?.threads.length ? (
        <Card style={{ paddingHorizontal: 12 }}>
          {data.threads.map((t, i) => (
            <Row
              key={t.user.id}
              first={i === 0}
              minHeight={64}
              left={<Avatar id={t.user.id} name={t.user.displayName || t.user.username} size={40} />}
              title={
                <Text size={14.5} weight="semi">
                  {t.user.displayName || `@${t.user.username}`}
                  <Muted>{`  ${ago(t.lastAt)}`}</Muted>
                </Text>
              }
              sub={
                <Muted numberOfLines={2} color={t.unread ? c.ink : c.muted}>
                  {`${t.lastFromTeam ? 'You: ' : ''}${t.preview}`}
                </Muted>
              }
              right={t.unread ? <Chip small label={String(t.unread)} tone="primary" /> : null}
              onPress={() => router.push(`/inbox/${t.user.id}`)}
            />
          ))}
        </Card>
      ) : null}
    </Screen>
  )
}
