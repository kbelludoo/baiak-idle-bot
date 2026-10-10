#!/usr/bin/env bash
#
# Instala o driver terminal do Baiak Idle em Ubuntu 22.04/24.04 ou Oracle Linux 8/9.
#
#   bash instalar_terminal.sh              # instala, configura e registra o serviço
#   bash instalar_terminal.sh uninstall    # remove o serviço (mantém .env e data/)
#   bash instalar_terminal.sh probe        # só roda o --probe (diagnóstico)
#
# Não instala Chromium, não abre porta nenhuma (só conexão de saída) e usa sudo
# apenas para pacotes, swap e systemd.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT=baiak-term
SERVICE_FILE="/etc/systemd/system/${UNIT}.service"
TOKEN_FILE="$DIR/.env"

say() { printf '\033[1;36m[instalar]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[instalar]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[instalar]\033[0m %s\n' "$*" >&2; exit 1; }

BUN_BIN="${BUN_BIN:-$HOME/.bun/bin/bun}"

ensure_bun() {
  if command -v bun >/dev/null 2>&1; then
    BUN_BIN="$(command -v bun)"
  elif [ -x "$BUN_BIN" ]; then
    :
  else
    say "instalando o Bun..."
    curl -fsSL https://bun.sh/install | bash
    [ -x "$BUN_BIN" ] || die "Bun não encontrado em $BUN_BIN"
  fi
  say "bun: $("$BUN_BIN" --version) ($BUN_BIN)"
}

ensure_token() {
  if [ -f "$TOKEN_FILE" ] && grep -q '^BAIAK_TOKEN=..*' "$TOKEN_FILE"; then
    say "token já presente em .env"
    return
  fi
  printf 'Cole o BAIAK_TOKEN (F12 > Application > Local Storage > baiak-idle-token): '
  read -r TOKEN
  [ -n "$TOKEN" ] || die "token vazio"
  # preserva as outras variáveis que o usuário já tenha
  grep -v '^BAIAK_TOKEN=' "$TOKEN_FILE" > "$TOKEN_FILE.tmp" 2>/dev/null || true
  printf 'BAIAK_TOKEN=%s\n' "$TOKEN" >> "$TOKEN_FILE.tmp"
  mv "$TOKEN_FILE.tmp" "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  say "token gravado em .env (permissão 600)"
}

ensure_swap() {
  # 1 GB de RAM é apertado; um swap de 1G evita OOM quando o catálogo carrega.
  local mem_kb
  mem_kb="$(awk '/MemTotal/{print $2}' /proc/meminfo)"
  if [ "$mem_kb" -ge 2000000 ] || [ -f /swapfile ]; then
    return
  fi
  say "RAM ${mem_kb} kB (<2G) — criando swap de 1G"
  if command -v fallocate >/dev/null 2>&1; then
    sudo fallocate -l 1G /swapfile
  else
    sudo dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none
  fi
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
}

run_probe() {
  say "rodando o probe (join + frames por 30s)..."
  (cd "$DIR" && "$BUN_BIN" run src/term/main.ts --probe --session-sec=30)
}

write_unit() {
  local user home
  user="$(id -un)"
  home="$HOME"
  sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Baiak Idle - driver terminal (sem navegador)
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=$user
WorkingDirectory=$DIR
EnvironmentFile=-$TOKEN_FILE
Environment=PATH=$home/.bun/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$BUN_BIN run src/term/main.ts
Restart=always
RestartSec=10
TimeoutStopSec=30
# Limites para a VM Always Free (1 OCPU / 1 GB): só quando o cgroup v2 existe.
MemoryHigh=256M
MemoryMax=384M
CPUQuota=60%
Nice=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable "$UNIT" >/dev/null 2>&1 || true
  say "serviço $UNIT registrado em $SERVICE_FILE"
}

start_service() {
  sudo systemctl restart "$UNIT"
  sleep 3
  if sudo systemctl is-active --quiet "$UNIT"; then
    say "$UNIT ativo — veja com: journalctl -u $UNIT -f"
  else
    warn "$UNIT não subiu; veja: journalctl -u $UNIT -n 50"
    return 1
  fi
}

uninstall() {
  sudo systemctl disable --now "$UNIT" 2>/dev/null || true
  sudo rm -f "$SERVICE_FILE"
  sudo systemctl daemon-reload
  say "serviço removido (.env e data/ mantidos)"
}

case "${1:-install}" in
  uninstall) uninstall ;;
  probe)     ensure_bun; ensure_token; run_probe ;;
  install|*)
    ensure_bun
    ensure_token
    ensure_swap
    # o probe é diagnóstico: um estouro aqui não pode impedir o registro do serviço
    run_probe || warn "probe falhou — o serviço tenta de novo na subida (journalctl -u $UNIT)"
    write_unit
    start_service
    say "pronto. Logs: journalctl -u $UNIT -f"
    ;;
esac
