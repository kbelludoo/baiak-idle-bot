#!/bin/bash
set -e

KEY="/home/k/Downloads/ssh-key-2026-09-14 (2).key"
VPS1="168.138.151.18"
VPS2="137.131.226.117"

wait_for_ts() {
  local target="$1"
  ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "ubuntu@$target" '
    for attempt in $(seq 1 20); do
      if curl --fail --silent --show-error http://127.0.0.1:8080/healthz >/dev/null; then
        echo "Bot TS saudável após $((attempt * 3))s"
        exit 0
      fi
      sleep 3
    done
    echo "Bot TS não passou no health check"
    docker compose -f /home/ubuntu/baiak-bot-ts/docker-compose.yml logs --tail=80
    exit 1
  '
}

stop_legacy_py() {
  local target="$1"
  ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "ubuntu@$target" '
    # Legado Python (baiak-bot) — garante parado/removido, preserva pasta/.env.
    if [ -d /home/ubuntu/baiak-bot ]; then
      cd /home/ubuntu/baiak-bot && docker compose down 2>/dev/null || true
    fi
    docker stop baiak-bot 2>/dev/null || true
    docker rm baiak-bot 2>/dev/null || true
  '
}

deploy_ts() {
  local target="$1"
  echo "=================================================="
  echo "🚀 Sincronizando bot TS com VPS ($target)..."
  echo "=================================================="
  rsync -avz \
    -e "ssh -i \"$KEY\" -o StrictHostKeyChecking=accept-new" \
    --exclude '.env' \
    --exclude 'data/' \
    --exclude 'data-ts/' \
    --exclude 'node_modules/' \
    /home/k/Downloads/hacker\ do\ tibia/bot-ts/ \
    ubuntu@$target:/home/ubuntu/baiak-bot-ts/

  echo "🔄 Reiniciando bot TS na VPS ($target)..."
  ssh -i "$KEY" -o StrictHostKeyChecking=accept-new ubuntu@$target '
    cd /home/ubuntu/baiak-bot-ts && docker compose up -d --build
  '
  wait_for_ts "$target"
}

stop_legacy_py "$VPS1"
deploy_ts "$VPS1"

echo "=================================================="
echo "🚀 Sincronizando monitor com VPS 1 ($VPS1)..."
echo "=================================================="
rsync -avz \
  -e "ssh -i \"$KEY\" -o StrictHostKeyChecking=accept-new" \
  /home/k/Downloads/hacker\ do\ tibia/monitor/ \
  ubuntu@$VPS1:/home/ubuntu/baiak-monitor/

echo "🔄 Reiniciando container baiak-monitor na VPS 1..."
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new ubuntu@$VPS1 '
  cd /home/ubuntu/baiak-monitor && docker compose up -d --build
'

stop_legacy_py "$VPS2"
deploy_ts "$VPS2"

echo "=================================================="
echo "✅ Deploy concluído com sucesso nas 2 VPS!"
echo "=================================================="
