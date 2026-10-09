#!/bin/sh
# Quick Glofly numbers for Chip. Run on the server, from ~/glofly/deploy:  ./stats.sh
# Read-only: it only counts things, never shows names, emails or messages.
cd "$(dirname "$0")"

echo "Online right now (connected devices' accounts):"
docker compose exec -T redis redis-cli -a "$(grep '^REDIS_PASSWORD=' .env | cut -d= -f2-)" --no-auth-warning \
  --scan --pattern 'presence:devices:*' | wc -l

docker run --rm --env-file .env postgres:18 sh -c 'psql "${DATABASE_URL}?sslmode=require" -P pager=off -c "
select
  (select count(*) from users where delete_after is null)                                   as accounts,
  (select count(*) from users where created_at > now() - interval '\''7 days'\'')            as new_this_week,
  (select count(distinct user_id) from sessions where last_used_at > now() - interval '\''1 day'\'')  as active_today,
  (select count(distinct user_id) from sessions where last_used_at > now() - interval '\''7 days'\'') as active_this_week,
  (select count(*) from messages where event is null and created_at > now() - interval '\''1 day'\'') as messages_today,
  (select count(*) from calls where created_at > now() - interval '\''1 day'\'')            as calls_today;
"' 2>&1 | grep -v "^$"
