#!/bin/bash
# Sincroniza a URL pública do ngrok (VPS1:4040) com o frontend do GitHub Pages.
# Uso: ./sync-pages-api.sh
# Se a URL mudou, atualiza docs/index.html + monitor/index.html e faz commit.
set -e
KEY="/home/k/Downloads/ssh-key-2026-09-14 (2).key"
VPS1="168.138.151.18"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CURRENT="$(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "ubuntu@$VPS1" \
  'curl -s -m 5 http://127.0.0.1:4040/api/tunnels | python3 -c "import sys,json; d=json.load(sys.stdin); ts=[t for t in d.get(\"tunnels\",[]) if t.get(\"proto\")==\"https\"]; print(ts[0][\"public_url\"] if ts else \"\")"')"
if [ -z "$CURRENT" ]; then
  echo "ERRO: ngrok não está rodando na VPS1 (127.0.0.1:4040 sem túneis). Suba com:"
  echo "  sudo cp monitor/ngrok-monitor.service /etc/systemd/system/ && sudo systemctl enable --now ngrok-monitor"
  exit 1
fi
echo "URL atual do túnel: $CURRENT"

CHANGED=0
for f in "$DIR/docs/index.html" "$DIR/monitor/index.html"; do
  if grep -q "const API = '[ockets]*'" "$f" 2>/dev/null; then :; fi
  OLD="$(grep -o "const API = '[^']*'" "$f" | head -n1 || true)"
  if [ -n "$OLD" ] && ! grep -q "const API = '$CURRENT'" "$f"; then
    sed -i "s|const API = '[^']*'|const API = '$CURRENT'|" "$f"
    echo "Atualizado: $f"
    CHANGED=1
  fi
done

if [ "$CHANGED" = "1" ]; then
  echo "Valide com: git diff -- docs/index.html monitor/index.html"
  echo "Depois: git add docs/index.html monitor/index.html && git commit -m 'chore: sync ngrok URL' && git push"
else
  echo "Frontend já aponta para a URL correta. Nada a fazer."
fi
