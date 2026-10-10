#!/usr/bin/env bash
#
# Roda o driver terminal 24/7 no terminal (sem systemd).
#   bash iniciar_terminal.sh                    # rotação automática de hunts
#   bash iniciar_terminal.sh --hunt-id=glooth-cave
#   HUNT_ID=hydra-cave bash iniciar_terminal.sh
#
# Para parar: Ctrl+C. Se cair, o próprio driver reconecta com backoff.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

BUN_BIN="${BUN_BIN:-$HOME/.bun/bin/bun}"
if command -v bun >/dev/null 2>&1; then
  BUN_BIN="$(command -v bun)"
fi
if [ ! -x "$BUN_BIN" ] && ! command -v bun >/dev/null 2>&1; then
  echo "[iniciar] Bun não encontrado — rode: bash instalar_terminal.sh" >&2
  exit 1
fi

if [ ! -f .env ] || ! grep -q '^BAIAK_TOKEN=..*' .env; then
  echo "[iniciar] BAIAK_TOKEN ausente em .env — rode: bash instalar_terminal.sh" >&2
  exit 1
fi

# carrega o .env sem vazar o token no `ps`
set -a
# shellcheck disable=SC1091
. ./.env
set +a

exec "$BUN_BIN" run src/term/main.ts "$@"
