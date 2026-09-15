#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "==================================================="
echo "          BAIAK IDLE - BOT AUTOMÁTICO"
echo "==================================================="
echo ""

# 1. Verifica se Python está instalado
if command -v python3 >/dev/null 2>&1; then
    PY_CMD=python3
elif command -v python >/dev/null 2>&1; then
    PY_CMD=python
else
    echo "[ERRO] Python 3 não encontrado!"
    echo "Instale o python3 e python3-venv pelo gerenciador da sua distro (ex: sudo apt install python3 python3-venv)."
    exit 1
fi

# 2. Configura .env se não existir
if [ ! -f ".env" ]; then
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
AUTO_HUNT=true
AUTO_TREINO=true
AUTO_SELL=true
SELL_THRESHOLD_PCT=75
AUTO_BOSS=true
REDUCE_VFX=true
HEADLESS=true
SCREENSHOT_INTERVAL=0
EOF
    echo "[SUCESSO] Arquivo .env configurado com sucesso!"
    echo ""
fi

# 3. Cria ambiente virtual se não existir
if [ ! -d ".venv" ]; then
    echo "[*] Criando ambiente virtual Python (.venv)..."
    $PY_CMD -m venv .venv
fi

# 4. Ativa o ambiente virtual
source .venv/bin/activate

# 5. Instala/atualiza dependências
echo "[*] Verificando dependências..."
pip install -q -r requirements.txt
playwright install chromium

# 6. Inicia o bot
echo ""
echo "[*] Iniciando Baiak Idle Bot..."
echo "[DICA] Para encerrar, pressione Ctrl+C."
echo "==================================================="
echo ""
python bot.py
