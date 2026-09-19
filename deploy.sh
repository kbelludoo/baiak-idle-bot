#!/bin/bash
set -e

KEY="/home/k/Downloads/ssh-key-2026-09-14 (2).key"
VPS1="168.138.151.18"
VPS2="137.131.226.117"

wait_for_bot() {
  local target="$1"
  ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "ubuntu@$target" '
    for attempt in $(seq 1 20); do
      if curl --fail --silent --show-error http://127.0.0.1:8080/healthz >/dev/null; then
        echo "Bot saudável após $((attempt * 3))s"
        exit 0
      fi
      sleep 3
    done
    echo "Bot não passou no health check"
    docker compose -f /home/ubuntu/baiak-bot/docker-compose.yml logs --tail=80
    exit 1
  '
}

echo "=================================================="
echo "🚀 Sincronizando bot Python com VPS 1 ($VPS1)..."
echo "=================================================="
rsync -avz \
  -e "ssh -i \"$KEY\" -o StrictHostKeyChecking=accept-new" \
  --exclude '.env' \
  --exclude 'data/' \
  --exclude '__pycache__/' \
  /home/k/Downloads/hacker\ do\ tibia/bot/ \
  ubuntu@$VPS1:/home/ubuntu/baiak-bot/

echo "🔄 Reiniciando bot Python na VPS 1..."
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new ubuntu@$VPS1 '
  cd /home/ubuntu/baiak-bot-ts 2>/dev/null && docker compose down 2>/dev/null || true
  docker stop baiak-bot-ts 2>/dev/null || true
  docker rm baiak-bot-ts 2>/dev/null || true
  cd /home/ubuntu/baiak-bot && docker compose up -d --build
'
wait_for_bot "$VPS1"

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

echo "=================================================="
echo "🚀 Sincronizando bot Python com VPS 2 ($VPS2)..."
echo "=================================================="
rsync -avz \
  -e "ssh -i \"$KEY\" -o StrictHostKeyChecking=accept-new" \
  --exclude '.env' \
  --exclude 'data/' \
  --exclude '__pycache__/' \
  /home/k/Downloads/hacker\ do\ tibia/bot/ \
  ubuntu@$VPS2:/home/ubuntu/baiak-bot/

echo "🔄 Reiniciando bot Python na VPS 2..."
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new ubuntu@$VPS2 '
  cd /home/ubuntu/baiak-bot-ts 2>/dev/null && docker compose down 2>/dev/null || true
  docker stop baiak-bot-ts 2>/dev/null || true
  docker rm baiak-bot-ts 2>/dev/null || true
  cd /home/ubuntu/baiak-bot && docker compose up -d --build
'
wait_for_bot "$VPS2"

echo "=================================================="
echo "✅ Deploy concluído com sucesso nas 2 VPS!"
echo "=================================================="
