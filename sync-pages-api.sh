#!/bin/bash
# Sincroniza a URL pública do Cloudflare Tunnel (trycloudflare.com) com o frontend do GitHub Pages.
# Uso: ./sync-pages-api.sh
# Se a URL mudou, atualiza docs/index.html + monitor/index.html e faz commit.
set -e
KEY="/home/k/Downloads/ssh-key-2026-09-14 (2).key"
VPS1="168.138.151.18"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CURRENT="$(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "ubuntu@$VPS1" \
  'grep -o "https://[a-zA-Z0-9.-]*trycloudflare\.com" /home/ubuntu/cloudflared.log 2>/dev/null | tail -n 1')"
if [ -z "$CURRENT" ]; then
  echo "ERRO: Cloudflare Tunnel não está rodando na VPS1. Verifique com:"
  echo "  sudo systemctl status cloudflared-monitor"
  exit 1
fi
echo "URL atual do túnel Cloudflare: $CURRENT"

CHANGED=0
for f in "$DIR/docs/index.html" "$DIR/monitor/index.html"; do
  OLD="$(grep -o "const PRIMARY_TUNNEL = '[^']*'" "$f" | head -n1 || true)"
  if [ -n "$OLD" ] && ! grep -q "const PRIMARY_TUNNEL = '$CURRENT'" "$f"; then
    sed -i "s|const PRIMARY_TUNNEL = '[^']*'|const PRIMARY_TUNNEL = '$CURRENT'|" "$f"
    echo "Atualizado PRIMARY_TUNNEL em: $f"
    CHANGED=1
  fi
done

if [ "$CHANGED" = "1" ]; then
  echo "Valide com: git diff -- docs/index.html monitor/index.html"
  echo "Depois: git add docs/index.html monitor/index.html && git commit -m 'chore: sync cloudflare tunnel URL' && git push"
else
  echo "Frontend já aponta para a URL correta do Cloudflare. Nada a fazer."
fi
