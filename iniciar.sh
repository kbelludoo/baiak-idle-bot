#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "==================================================="
echo "    BAIAK IDLE - BOT v3 (TYPESCRIPT COM BUN)"
echo "==================================================="
echo ""

# 1. Verifica se Bun está instalado
if ! command -v bun >/dev/null 2>&1; then
    echo "[ERRO] Bun não encontrado no sistema!"
    echo "Instale o Bun executando: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# 2. Configura .env se não existir
if [ ! -f ".env" ] && [ ! -f "../.env" ]; then
    echo "[CONFIGURAÇÃO INICIAL]"
    echo "Arquivo .env não encontrado. Vamos configurar seu token agora."
    echo ""
    echo "1. No seu navegador logado no jogo (https://baiakidle.com/jogar/), pressione F12."
    echo "2. Vá na aba Application (ou Aplicativo) > Local Storage > https://baiakidle.com"
    echo "3. Copie o valor de 'baiak-idle-token' (código de 64 letras/números)."
    echo ""
    read -r -p "Cole o seu BAIAK_TOKEN aqui e aperte ENTER: " USER_TOKEN
    
    if [ -z "$USER_TOKEN" ]; then
        echo "[AVISO] Nenhum token informado. Criando .env a partir do .env.example..."
        cp .env.example .env
        echo "Edite o arquivo .env com seu token e execute novamente."
        exit 1
    fi
    
    cat <<EOF > .env
BAIAK_TOKEN=${USER_TOKEN}
HEADLESS=true
AUTO_HUNT=true
AUTO_TREINO=true
AUTO_SELL=true
SELL_THRESHOLD_PCT=70
AUCTION_ENABLED=true
AUCTION_LIVE=true
AUCTION_BUDGET=100
AUCTION_SELL_GOLD=800000000
AUCTION_SELL_ENABLED=true
AUCTION_MARGIN=20
AUTO_BOSS=true
AUTO_EQUIP=true
REDUCE_VFX=true
LIVE_STREAM=true
PORT=8080
EOF
    echo "[SUCESSO] Arquivo .env configurado com sucesso!"
    echo ""
fi

# 3. Verifica dependências
if [ ! -d "node_modules" ]; then
    echo "[*] Instalando dependências com Bun..."
    bun install
fi

# 4. Inicia o bot com autorrecuperação 24/7
echo ""
echo "[*] Iniciando Baiak Idle Bot TS 24/7..."
echo "[DICA] Para encerrar definitivamente, pressione Ctrl+C."
echo "==================================================="
echo ""

trap 'echo -e "\n[*] Bot encerrado pelo usuário."; exit 0' SIGINT SIGTERM

while true; do
    set +e
    bun run src/index.ts
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 0 ]; then
        echo "[*] Bot finalizado normalmente."
        break
    fi
    echo "[!] Processo encerrou com código $EXIT_CODE. Reiniciando em 3 segundos... (Ctrl+C para parar)"
    sleep 3
done
