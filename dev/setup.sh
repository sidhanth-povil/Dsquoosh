#!/usr/bin/env bash
# Bring up the dev WordPress at http://localhost:8089 (admin/admin).
set -euo pipefail
cd "$(dirname "$0")"
DC=(docker compose -p dswebp -f docker-compose.yml)

"${DC[@]}" up -d

echo "waiting for DB + WordPress files..."
db_ready=0
for _ in $(seq 1 60); do
  if "${DC[@]}" exec -T cli wp db check >/dev/null 2>&1; then db_ready=1; break; fi
  sleep 2
done
if [ "$db_ready" -ne 1 ]; then echo "timed out waiting for DB" >&2; exit 1; fi

if ! "${DC[@]}" exec -T cli wp core is-installed >/dev/null 2>&1; then
  "${DC[@]}" exec -T cli wp core install --url=http://localhost:8089 \
    --title="DS WebP Dev" --admin_user=admin --admin_password=admin \
    --admin_email=admin@example.com --skip-email
fi

"${DC[@]}" exec -T cli wp eval 'echo class_exists("DS_WebP_Squoosh_Studio") ? "CLASS OK" : "NO CLASS";'
echo

echo "waiting for HTTP..."
http_ready=0
for _ in $(seq 1 60); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8089/wp-login.php)" = "200" ]; then http_ready=1; break; fi
  sleep 2
done
if [ "$http_ready" -ne 1 ]; then echo "timed out waiting for http://localhost:8089/wp-login.php" >&2; exit 1; fi
