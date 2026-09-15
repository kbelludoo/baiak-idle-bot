@echo off
chcp 65001 >nul
title Baiak Idle Bot
cd /d "%~dp0"

echo ===================================================
echo           BAIAK IDLE - BOT AUTOMATICO
echo ===================================================
echo.

:: 1. Verifica se o Python esta instalado
where python >nul 2>nul
if %errorlevel% neq 0 (
    where py >nul 2>nul
    if %errorlevel% neq 0 (
        echo [ERRO] Python nao encontrado!
        echo Por favor instale o Python 3.10 ou superior pelo site:
        echo https://www.python.org/downloads/
        echo (IMPORTANTE: Marque a opcao "Add Python to PATH" durante a instalacao!)
        echo.
        pause
        exit /b 1
    ) else (
        set PY_CMD=py
    )
) else (
    set PY_CMD=python
)

:: 2. Verifica se o arquivo .env existe, caso contrario cria e pede o token
if not exist ".env" (
    echo [CONFIGURACAO INICIAL]
    echo Arquivo .env nao encontrado. Vamos configurar seu token agora.
    echo.
    echo 1. No seu navegador logado no jogo (https://baiakidle.com/jogar/), aperte F12.
    echo 2. Va na aba Application (ou Aplicativo) ^> Local Storage ^> https://baiakidle.com
    echo 3. Copie o valor da chave "baiak-idle-token" (codigo de 64 letras/numeros).
    echo.
    set /p USER_TOKEN="Cole o seu BAIAK_TOKEN aqui e aperte ENTER: "
    
    if "%USER_TOKEN%"=="" (
        echo [AVISO] Nenhum token informado. Criando .env padrao...
        copy .env.example .env >nul
        echo Abra o arquivo .env no Bloco de Notas, coloque seu token e execute novamente.
        pause
        exit /b 1
    )
    
    (
        echo BAIAK_TOKEN=%USER_TOKEN%
        echo AUTO_HUNT=true
        echo AUTO_TREINO=true
        echo AUTO_SELL=true
        echo SELL_THRESHOLD_PCT=75
        echo AUTO_BOSS=true
        echo REDUCE_VFX=true
        echo HEADLESS=false
        echo SCREENSHOT_INTERVAL=0
    ) > .env
    echo [SUCESSO] Arquivo .env configurado com sucesso!
    echo.
)

:: 3. Cria o ambiente virtual (.venv) se nao existir
if not exist ".venv" (
    echo [*] Criando ambiente virtual Python (.venv)...
    %PY_CMD% -m venv .venv
)

:: 4. Ativa o ambiente virtual
call .venv\Scripts\activate.bat

:: 5. Instala/Atualiza dependencias
echo [*] Verificando dependencias...
pip install -q -r requirements.txt
playwright install chromium

:: 6. Executa o bot
echo.
echo [*] Iniciando Baiak Idle Bot...
echo [DICA] Para fechar, pressione Ctrl+C ou feche esta janela.
echo ===================================================
echo.
python bot.py

echo.
echo [!] Bot finalizado.
pause
