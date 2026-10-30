#!/usr/bin/env bash
# Bring up the dev WordPress at http://localhost:8089 (admin/admin).
set -euo pipefail
cd "$(dirname "$0")"
DC=(docker compose -p dswebp -f docker-compose.yml)

"${DC[@]}" up -d

echo "waiting for DB + WordPress files..."
for _ in $(seq 1 60); do
  "${DC[@]}" exec -T cli wp db check >/dev/null 2>&1 && break
  sleep 2
done

if ! "${DC[@]}" exec -T cli wp core is-installed >/dev/null 2>&1; then
  "${DC[@]}" exec -T cli wp core install --url=http://localhost:8089 \
    --title="DS WebP Dev" --admin_user=admin --admin_password=admin \
    --admin_email=admin@example.com --skip-email
fi

"${DC[@]}" exec -T cli wp eval 'echo class_exists("DS_WebP_Squoosh_Studio") ? "CLASS OK" : "NO CLASS";'
echo
