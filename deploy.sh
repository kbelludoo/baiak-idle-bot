#!/bin/bash
set -e

KEY="/home/k/Downloads/ssh-key-2026-09-14 (2).key"
VPS1="168.138.151.18"
VPS2="137.131.226.117"

wait_for_ts() {
  local target="$1"
  ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "ubuntu@$target" '
    # Servidor HTTP UP = deploy OK. O jogo pode levar até ~120s p/ handshake;
    # /healthz retorna 503 enquanto offline, então aceita /api/status 200
    # como "container saudável" e só informa o estado do jogo.
    for attempt in $(seq 1 30); do
      if curl --fail --silent http://127.0.0.1:8080/api/status >/dev/null; then
        GAME="$(curl --silent -m 5 http://127.0.0.1:8080/healthz || true)"
        echo "Bot TS HTTP OK após $((attempt * 5))s :: $GAME"
        exit 0
      fi
      if ! docker ps --format "{{.Names}}" | grep -q "^baiak-bot-ts$"; then
        echo "Container baiak-bot-ts sumiu durante o boot"
        docker compose -f /home/ubuntu/baiak-bot-ts/docker-compose.yml logs --tail=80
        exit 1
      fi
      sleep 5
    done
    echo "Bot TS não subiu HTTP em 150s"
    docker compose -f /home/ubuntu/baiak-bot-ts/docker-compose.yml logs --tail=80
    exit 1
  '
}

wait_for_monitor() {
  local target="$1"
  ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "ubuntu@$target" '
    for attempt in $(seq 1 24); do
      if curl --fail --silent http://127.0.0.1:8081/api/public/overview >/dev/null; then
        echo "Monitor OK após $((attempt * 5))s"
        exit 0
      fi
      sleep 5
    done
    echo "Monitor não respondeu em 120s"
    docker compose -f /home/ubuntu/baiak-monitor/docker-compose.yml logs --tail=60
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
  --exclude '.env' \
  --exclude 'data/' \
  --exclude 'node_modules/' \
  /home/k/Downloads/hacker\ do\ tibia/monitor/ \
  ubuntu@$VPS1:/home/ubuntu/baiak-monitor/

echo "🔄 Reiniciando container baiak-monitor na VPS 1..."
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new ubuntu@$VPS1 '
  cd /home/ubuntu/baiak-monitor && docker compose up -d --build
'
wait_for_monitor "$VPS1"

echo "=================================================="
echo "🔗 Garantindo túnel ngrok persistente (VPS 1)..."
echo "=================================================="
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new ubuntu@$VPS1 '
  if [ -f /home/ubuntu/baiak-monitor/ngrok-monitor.service ]; then
    sudo cp /home/ubuntu/baiak-monitor/ngrok-monitor.service /etc/systemd/system/ngrok-monitor.service
    sudo systemctl daemon-reload
    sudo systemctl enable --now ngrok-monitor
  else
    # Fallback: processo simples com restart se não houver systemd instalado
    pgrep -f "ngrok http 127.0.0.1:8081" >/dev/null || (nohup /usr/local/bin/ngrok http 127.0.0.1:8081 --log /home/ubuntu/ngrok-monitor.log >/dev/null 2>&1 &)
  fi
  sleep 3
  curl -s -m 5 http://127.0.0.1:4040/api/tunnels | grep -o "https://[^\"]*ngrok[^\"]*" | head -n1 || echo "(túnel ainda iniciando)"
'

stop_legacy_py "$VPS2"
deploy_ts "$VPS2"

echo "=================================================="
echo "✅ Deploy concluído com sucesso nas 2 VPS!"
echo "=================================================="
