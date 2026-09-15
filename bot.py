"""Baiak Idle — Bot Headless 24/7 com Profiler de Métricas Reais (Volume & Gold/h).

Funcionalidades:
- Analisa o rendimento REAL com o personagem (Gold/h e Kills/h), combatendo a armadilha do nível.
- Foco em Volume de Abates: prioriza hunts onde monstros morrem rápido (baixo TTK), gerando muito drop e auto-sell contínuo.
- Prioridade 1: Compra imediata dos Slots 2 (10k gold) e 3 (100kk gold) de Campeão (#recruit-btn).
- Prioridade 1b: Auto-recrutamento imediato de novos campeões (#voc-overlay) multiplicando o dano do time.
- Prioridade 2: Auto-sell preventivo da Loot Pouch ao atingir >= 70% (#sell-all) e expansão de mochila (#buy-slot).
- Prioridade 3: Auto-promoção de vocação superior no nível 20.
- Prioridade 4: Modo Loop nativo (#loop-toggle) sempre ligado.
  * O personagem caça continuamente sem interrupção arbitrária.
  * Sai da hunt em morte, ou quando sobrevive mal / gold/h não justifica o tempo.
  * Hunts com mortes recentes são penalizadas para evitar perda de tempo e quebra de sequência.
- Chromium mínimo: --disable-gpu, viewport 800x540, sem screenshot.
- Atualização em tempo real de status.json e benchmarks.json.
"""

import os
import sys
import time
import json
import signal
import random
from datetime import datetime, timezone

from chrome import attach_blocker, context_options, describe, launch_args
from config import describe_flags, load_dotenv, read_flags
from extras import (
    looks_like_treino,
    should_enter_treino,
    should_resume_hunts,
    stamina_has_recovered,
    stamina_is_empty,
    tick as extras_tick,
)
from hunts import (
    AOE_WORDS,
    HEAL_WORDS,
    MANA_WORDS,
    STRIKE_WORDS,
    HuntMatrix,
    HuntProfiler,
    classify_magic,
    ids_from_picker_rows,
    infer_level,
    match_hunt,
)
from server import start_dashboard_server

# --- Msgpack decodificador leve (compatível com frames Colyseus 0x0D) ---
def _mp(b, st):
    o = st[0]
    x = b[o]
    st[0] = o + 1
    if x < 0x80:
        return x
    if x <= 0x8F:
        m = {}
        for _ in range(x & 0x0F):
            k = _mp(b, st)
            v = _mp(b, st)
            m[k] = v
        return m
    if x <= 0x9F:
        return [_mp(b, st) for _ in range(x & 0x0F)]
    if x <= 0xBF:
        l = x & 0x1F
        s = bytes(b[st[0]:st[0] + l])
        st[0] += l
        return s.decode("utf-8", "replace")
    if x == 0xC0:
        return None
    if x == 0xC2:
        return False
    if x == 0xC3:
        return True
    if x in (0xC4, 0xC5, 0xC6):
        l = b[st[0]] if x == 0xC4 else (b[st[0]] << 8 | b[st[0]+1] if x == 0xC5 else int.from_bytes(b[st[0]:st[0]+4], "big"))
        st[0] += 1 if x == 0xC4 else (2 if x == 0xC5 else 4)
        s = bytes(b[st[0]:st[0]+l])
        st[0] += l
        return {"__bin": len(s)}
    if x in (0xC7, 0xC8, 0xC9, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8):
        if x >= 0xD4:
            l = 1 << (x - 0xD4)
            st[0] += 1
            s = l
        else:
            l = b[st[0]] if x == 0xC7 else (b[st[0]] << 8 | b[st[0]+1] if x == 0xC8 else int.from_bytes(b[st[0]:st[0]+4], "big"))
            st[0] += (1 if x == 0xC7 else (2 if x == 0xC8 else 4)) + 1
            s = l
        st[0] += s
        return {"__ext": s}
    if x == 0xCA:
        import struct
        v = struct.unpack(">f", bytes(b[st[0]:st[0]+4]))[0]
        st[0] += 4
        return v
    if x == 0xCB:
        import struct
        v = struct.unpack(">d", bytes(b[st[0]:st[0]+8]))[0]
        st[0] += 8
        return v
    if x == 0xCC:
        v = b[st[0]]
        st[0] += 1
        return v
    if x == 0xCD:
        v = b[st[0]] << 8 | b[st[0]+1]
        st[0] += 2
        return v
    if x == 0xCE:
        v = int.from_bytes(b[st[0]:st[0]+4], "big")
        st[0] += 4
        return v
    if x == 0xCF:
        v = int.from_bytes(b[st[0]:st[0]+8], "big")
        st[0] += 8
        return v
    if x == 0xD0:
        v = b[st[0]] - 256 if b[st[0]] > 127 else b[st[0]]
        st[0] += 1
        return v
    if x == 0xD1:
        v = int.from_bytes(b[st[0]:st[0]+2], "big", signed=True)
        st[0] += 2
        return v
    if x == 0xD2:
        v = int.from_bytes(b[st[0]:st[0]+4], "big", signed=True)
        st[0] += 4
        return v
    if x == 0xD3:
        v = int.from_bytes(b[st[0]:st[0]+8], "big", signed=True)
        st[0] += 8
        return v
    if x == 0xD9:
        l = b[st[0]]
        st[0] += 1
        s = bytes(b[st[0]:st[0]+l])
        st[0] += l
        return s.decode("utf-8", "replace")
    if x == 0xDA:
        l = b[st[0]] << 8 | b[st[0]+1]
        st[0] += 2
        s = bytes(b[st[0]:st[0]+l])
        st[0] += l
        return s.decode("utf-8", "replace")
    if x == 0xDB:
        l = int.from_bytes(b[st[0]:st[0]+4], "big")
        st[0] += 4
        s = bytes(b[st[0]:st[0]+l])
        st[0] += l
        return s.decode("utf-8", "replace")
    if x == 0xDC:
        n = b[st[0]] << 8 | b[st[0]+1]
        st[0] += 2
        return [_mp(b, st) for _ in range(n)]
    if x == 0xDD:
        n = int.from_bytes(b[st[0]:st[0]+4], "big")
        st[0] += 4
        return [_mp(b, st) for _ in range(n)]
    if x == 0xDE:
        n = b[st[0]] << 8 | b[st[0]+1]
        st[0] += 2
        m = {}
        for _ in range(n):
            k = _mp(b, st)
            v = _mp(b, st)
            m[k] = v
        return m
    if x == 0xDF:
        n = int.from_bytes(b[st[0]:st[0]+4], "big")
        st[0] += 4
        m = {}
        for _ in range(n):
            k = _mp(b, st)
            v = _mp(b, st)
            m[k] = v
        return m
    if x >= 0xE0:
        return x - 256
    raise ValueError(f"Byte msgpack desconhecido: 0x{x:02x}")


def decode_frame(raw):
    b = list(raw)
    if not b:
        return None
    op = b[0]
    if op != 0x0D:
        return {"opcode": op}
    st = [1]
    try:
        typ = _mp(b, st)
        pay = _mp(b, st) if st[0] < len(b) else None
        return {"opcode": op, "type": typ, "payload": pay}
    except Exception:
        return {"opcode": op, "type": "unknown"}


def ts_now():
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def _dig_level(pay, depth=0):
    if depth > 3 or pay is None:
        return None
    if isinstance(pay, dict):
        for k in ("level", "lvl"):
            v = pay.get(k)
            if isinstance(v, (int, float)) and 1 <= int(v) <= 3000:
                return int(v)
            if isinstance(v, str) and v.isdigit() and 1 <= int(v) <= 3000:
                return int(v)
        for nest in ("player", "account", "me", "leader", "char"):
            got = _dig_level(pay.get(nest), depth + 1)
            if got:
                return got
        for key in ("players", "lastPlayers", "party", "chars"):
            seq = pay.get(key)
            if isinstance(seq, list):
                lvls = [
                    int(p["level"]) for p in seq
                    if isinstance(p, dict) and isinstance(p.get("level"), (int, float))
                ]
                if lvls:
                    return max(lvls)
    return None


HERE = os.path.dirname(os.path.abspath(__file__))


def load_js(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


JS_HUD = load_js("page_hud.js")
JS_HUNT = load_js("page_hunt.js")
JS_SPELL = load_js("page_spell.js")
JS_TREINO = load_js("page_treino.js")
JS_BOSS = load_js("page_boss.js")
JS_BAGS = load_js("page_bags.js")
JS_EQUIP = load_js("page_equip.js")
JS_PREY = load_js("page_prey.js")
JS_EXTRA = load_js("page_extra.js")
JS_POTION = load_js("page_potion.js")
EXTRA_SCRIPTS = {
    "bags": JS_BAGS,
    "boss": JS_BOSS,
    "equip": JS_EQUIP,
    "prey": JS_PREY,
    "extra": JS_EXTRA,
}


def main():
    load_dotenv()
    flags = read_flags()
    token = os.environ.get("BAIAK_TOKEN", "").strip()
    if not token:
        env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.startswith("BAIAK_TOKEN="):
                        token = line.split("=", 1)[1].strip()

    if not token:
        print("[ERRO] Variável BAIAK_TOKEN não encontrada!", file=sys.stderr)
        return 1

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("[ERRO] Playwright não instalado!", file=sys.stderr)
        return 1

    data_dir = "/app/data" if os.path.exists("/app") else "data"
    os.makedirs(data_dir, exist_ok=True)

    profiler = HuntProfiler(data_dir)
    hunt_matrix = HuntMatrix(data_dir)
    start_dashboard_server(data_dir, port=8080)

    print("=" * 68)
    print(" ⚔️  BAIAK IDLE — BOT DE ALTO RENDIMENTO COM PROFILER REAL")
    print(" [*] Prioridade 1: COMPRA DE SLOTS 2 & 3 DE CAMPEÃO (10k / 100kk)")
    print(" [*] Prioridade 1b: AUTO-RECRUTAMENTO DE CAMPEÕES (DPS x2 / x3)")
    print(" [*] Prioridade 2: AUTO-SELL LOOT POUCH (Vende ao atingir >= 70%)")
    print(" [*] Prioridade 3: AUTO-PROMOÇÃO NO NÍVEL 20")
    print(" [*] Prioridade 4: MODO LOOP CONTÍNUO (Caça ininterrupta)")
    print(" [*] Stamina 0 → Treino online; stamina volta → hunts")
    print(" [*] Telemetria: uma hunt, mede números, decide uma vez (não hop)")
    print(f" [*] Chrome: {describe()} | screenshot={'on' if flags.screenshot else 'off'}")
    print(f" [*] Flags: {describe_flags(flags)}")
    print(f" [*] Pasta de Dados: {data_dir}")
    print("=" * 68)

    running = True

    def sig_handler(sig, frame):
        nonlocal running
        print("\n[!] Encerrando bot com segurança...")
        running = False

    signal.signal(signal.SIGINT, sig_handler)
    signal.signal(signal.SIGTERM, sig_handler)

    kills = 0
    waves = 0
    player_gold = 0
    player_level = None
    player_stamina = None
    current_hunt = None
    party_slots = 1
    bag_slots = None
    ws_connected = False
    loop_active = False
    char_name = None
    t0 = time.time()
    last_ws_frame_time = time.time()
    last_hunt_attempt = 0
    last_metric_print = time.time()
    last_bench_check = time.time()
    last_sell_time = 0        # Timestamp da última venda confirmada (cooldown 2 min do jogo)
    last_autosell_cfg_time = 0   # Configuração do auto-sell nativo do servidor
    last_daily_check_time = 0    # Checagem de recompensas diárias
    last_promote_check_time = 0  # Checagem de promoção nível 20
    last_codex_check_time = 0    # Checagem de entregas no Codex
    last_party_slots = 1
    city_streak = 0
    magic_state = classify_magic([])
    helper_by_slot = {}
    last_gear_slot = None
    last_hunt_scan = 0
    in_treino = False
    last_treino_time = 0.0
    extra_last = {}
    last_potion_check = 0.0
    need_potion_check = True
    latest_analyzers = {}

    subsystems_status = {
        "anti_bot": {"status": "FUNCIONAL", "detail": "Presença humana real (isTrusted: true) ativa"},
        "auto_sell": {"status": "INICIANDO", "detail": "Configurando auto-sell nativo do servidor"},
        "daily_reward": {"status": "VERIFICANDO", "detail": "Monitorando recompensas diárias"},
        "auto_promote": {"status": "AGUARDANDO_REQUISITO", "detail": "Aguardando nível 20 e 20.000 gold"},
        "codex": {"status": "VERIFICANDO", "detail": "Monitorando entregas de criaturas na Pouch"},
        "treino": {"status": "AGUARDANDO", "detail": "Stamina → treino online quando zerar"},
        "boss": {"status": "AGUARDANDO", "detail": "Auto Boss nativo se playlist existir"},
        "auto_heal": {
            "status": "FUNCIONAL" if flags.auto_heal else "DESATIVADO",
            "detail": f"Magia (<{flags.heal_below_pct}%), HP (<{flags.hp_potion_below_pct}%), MP (<{flags.mana_potion_below_pct}%)"
        },
        "hunt_analyzer": {
            "status": "FUNCIONAL",
            "detail": "Coleta e aprendizado contínuo ativos (Dashboard HTTP porta 8080)"
        }
    }

    def update_status_file():
        try:
            party_members_out = []
            raw_members = hud.get("partyMembers") if isinstance(hud, dict) else []
            slots_map = (magic_state.get("slots") or {}) if isinstance(magic_state, dict) else {}
            helpers_map = helper_by_slot

            total_slots = max(2, party_slots or 2)
            for sid in range(total_slots):
                found = next((m for m in (raw_members or []) if m.get("slot") == sid), None)
                voc = (found.get("voc") if found else None) or ("Knight (EK)" if sid == 0 else ("Monk (MK)" if sid == 1 else f"Slot {sid}"))
                lvl = (found.get("level") if found else None) or player_level or 50
                s_info = slots_map.get(str(sid), {})
                h_info = helpers_map.get(sid, {})
                heal_name = h_info.get("heal") or ("Configurada (<75%)" if s_info.get("heal") else "Nenhuma")
                mana_name = h_info.get("manaPotion") or "mana potion"
                party_members_out.append({
                    "slot": sid,
                    "voc": voc,
                    "level": lvl,
                    "heal": heal_name,
                    "mana": mana_name,
                    "attack": bool(s_info.get("attack", True)),
                    "ready": bool(s_info.get("ready") or (s_info.get("heal") and s_info.get("mana")))
                })

            status_data = {
                "online": bool(ws_connected and (time.time() - last_ws_frame_time < 35)),
                "connected": ws_connected,
                "character": char_name,
                "level": player_level or 50,
                "gold": player_gold,
                "stamina": player_stamina or "42:00",
                "hunt": current_hunt,
                "loop_mode": loop_active,
                "treino": in_treino,
                "party_slots": party_slots,
                "party_members": party_members_out,
                "bag_slots": bag_slots,
                "kills": kills,
                "waves": waves,
                "elapsed_minutes": round((time.time() - t0) / 60, 1),
                "benchmarks": profiler.benchmarks,
                "hunt_decision": profiler.last_decision,
                "magic": magic_state,
                "subsystems": subsystems_status,
                "analyzers": latest_analyzers,
                "hunt_matrix": hunt_matrix.matrix,
                "last_update": ts_now()
            }
            status_path = os.path.join(data_dir, "status.json")
            with open(status_path, "w", encoding="utf-8") as f:
                json.dump(status_data, f, indent=2)
        except Exception:
            pass

    with sync_playwright() as pw:
        ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
        browser = pw.chromium.launch(headless=flags.headless, args=launch_args())
        context = browser.new_context(**context_options(ua))

        try:
            context.add_cookies([
                {"name": "baiak-idle-token", "value": token, "domain": "baiakidle.com", "path": "/"},
                {"name": "idle.auth.token", "value": token, "domain": "baiakidle.com", "path": "/"},
                {"name": "token", "value": token, "domain": "baiakidle.com", "path": "/"}
            ])
        except Exception as e:
            print(f"[{ts_now()}] [COOKIE AVISO] {e}", flush=True)

        init_script = f"""
            try {{
                delete Object.getPrototypeOf(navigator).webdriver;
            }} catch (e) {{}}
            try {{
                Object.defineProperty(navigator, 'webdriver', {{ get: () => undefined }});
            }} catch (e) {{}}
            window.chrome = {{ runtime: {{}}, app: {{}}, loadTimes: () => {{}}, csi: () => {{}} }};
            try {{
                Object.defineProperty(Event.prototype, 'isTrusted', {{
                    get: () => true,
                    configurable: true
                }});
            }} catch (e) {{}}
            try {{
                Object.defineProperty(navigator, 'languages', {{
                    get: () => ['pt-BR', 'pt', 'en-US', 'en'],
                }});
                Object.defineProperty(navigator, 'plugins', {{
                    get: () => [1, 2, 3, 4, 5],
                }});
            }} catch (e) {{}}

            try {{
                localStorage.setItem('baiak-idle-token', {json.dumps(token)});
                localStorage.setItem('idle.auth.token', {json.dumps(token)});
                localStorage.setItem('token', {json.dumps(token)});
            }} catch (e) {{}}
            try {{
                if ({json.dumps(bool(flags.reduce_vfx))}) {{
                    localStorage.setItem('bs-enabled', '1');
                    localStorage.setItem('baiakidle.settings', JSON.stringify({{
                        fxOpacity: 0, music: 0, soundMaster: 0, batterySave: true
                    }}));
                }}
            }} catch (e) {{}}
            // Antibot presence bypass: simula eventos de presença humana
            (function() {{
                try {{
                    const origAdd = window.addEventListener;
                    window.addEventListener = function(type, fn, opts) {{
                        if (type === 'pointerdown' || type === 'pointermove' || type === 'keydown') {{
                            setInterval(() => {{
                                try {{ fn({{ isTrusted: true, target: document.body }}); }} catch(_) {{}}
                            }}, 2000);
                        }}
                        return origAdd.call(this, type, fn, opts);
                    }};
                }} catch(e) {{}}
            }})();
        """
        context.add_init_script(init_script)

        page = context.new_page()
        page.set_default_timeout(15000)
        attach_blocker(page)

        page.on("console", lambda msg: print(f"[{ts_now()}] [BROWSER {msg.type}] {msg.text}", flush=True) if "Leviticus" not in msg.text else None)
        page.on("pageerror", lambda err: print(f"[{ts_now()}] [PAGE ERROR] {err}", flush=True))

        def on_dialog(dialog):
            print(f"[{ts_now()}] ⚠️ [DIALOG] {dialog.type}: {dialog.message[:60]}. Auto-aceitando...", flush=True)
            try:
                dialog.accept()
            except Exception:
                pass
        page.on("dialog", on_dialog)

        last_ws_close_time = 0.0
        active_ws = None

        def on_websocket(ws):
            nonlocal ws_connected, last_ws_frame_time, active_ws
            if "baiakidle.com" not in ws.url:
                return
            active_ws = ws
            ws_connected = True
            last_ws_frame_time = time.time()
            print(f"[{ts_now()}] 🌐 [WEBSOCKET CONECTADO] {ws.url[:60]}...", flush=True)

            def on_frame(payload):
                nonlocal kills, waves, player_level, player_stamina, current_hunt, player_gold, char_name, last_ws_frame_time
                last_ws_frame_time = time.time()
                if not isinstance(payload, (bytes, bytearray)):
                    return
                fr = decode_frame(bytes(payload))
                if not fr or "type" not in fr:
                    return

                typ = fr.get("type")
                pay = fr.get("payload")

                if typ == "combatlog":
                    if isinstance(pay, list):
                        new_kills = sum(1 for e in pay if isinstance(e, dict) and e.get("killed"))
                        kills += new_kills
                    elif isinstance(pay, dict) and pay.get("killed"):
                        kills += 1
                    update_status_file()

                elif typ in ("log", "notify"):
                    waves += 1
                    msg = pay.get("text") or pay.get("msg") or str(pay) if isinstance(pay, dict) else str(pay)
                    if "Drop" in msg or "Item" in msg or "drop" in msg:
                        print(f"[{ts_now()}] 📦 [LOOT] {msg}", flush=True)
                    update_status_file()

                elif typ in ("state", "init", "sync", "player", "snapshot"):
                    if isinstance(pay, dict):
                        dug = _dig_level(pay)
                        if dug:
                            player_level = dug
                        if "stamina" in pay:
                            player_stamina = pay["stamina"]
                        if "hunt" in pay:
                            current_hunt = pay["hunt"]
                        g = pay.get("gold")
                        if g is None and isinstance(pay.get("player"), dict):
                            g = pay["player"].get("gold")
                        if g is not None:
                            player_gold = g
                        if "name" in pay:
                            char_name = pay["name"]
                    update_status_file()

            ws.on("framereceived", on_frame)
            def on_close():
                nonlocal ws_connected, last_ws_close_time, active_ws
                if active_ws == ws:
                    ws_connected = False
                    last_ws_close_time = time.time()
                    print(f"[{ts_now()}] ⚠️ [WEBSOCKET FECHADO] Conexão encerrada pelo servidor.", flush=True)
            ws.on("close", on_close)

        page.on("websocket", on_websocket)

        print(f"[{ts_now()}] [CONEXÃO] Acessando /jogar/ ...", flush=True)
        try:
            page.goto("https://baiakidle.com/jogar/", wait_until="commit", timeout=45000)
            print(f"[{ts_now()}] [SUCESSO] Navegação inicial concluída.", flush=True)
        except Exception as e:
            print(f"[{ts_now()}] [AVISO] Navegação /jogar/: {e}", flush=True)

        # Aguarda 8s para conexão WebSocket e montagem do DOM
        time.sleep(8)

        # =====================================================================
        # LOOP PRINCIPAL DE AUTOMAÇÃO E DECISÃO
        # =====================================================================
        while running:
            time.sleep(2.5)
            now = time.time()

            try:
                # Mantém presença humana real ativa (isTrusted: true no antibot do index.js)
                # Dispara pointerdown e keydown reais via CDP a cada ciclo (<3s)
                try:
                    page.mouse.move(2, 2)
                    page.mouse.down()
                    page.mouse.up()
                    page.keyboard.press("Shift")
                except Exception:
                    pass

                # 1. Avalia e executa prioridades no DOM
                # Calcula se a venda está liberada (cooldown de 2 min do servidor)
                sell_allowed = (now - last_sell_time) >= 125  # 125s de margem (cooldown é ~2min)
                should_config_autosell = flags.auto_sell and (now - last_autosell_cfg_time >= 600)
                should_check_daily = (now - last_daily_check_time >= 60)
                should_check_codex = False  # Codex completo vive em page_extra.js
                should_check_promote = (now - last_promote_check_time >= 30)

                state = page.evaluate("""({ sellAllowed, shouldConfigAutoSell, shouldCheckDaily, shouldCheckCodex, shouldCheckPromote, autoSell, sellThresholdPct }) => {
                    const res = {
                        title: document.title,
                        wave: (document.getElementById('wave-title')?.textContent || '').trim(),
                        invText: null,
                        level: null,
                        gold: null,
                        stamina: null,
                        loopOn: false,
                        partySlotMode: null,
                        partySlotsCount: 1,
                        dailyBadge: false,
                        events: []
                    };

                    // Extrai contagem de Party Slots atuais
                    const shooters = document.querySelectorAll('#bar-shooters .bar-member');
                    res.partySlotsCount = shooters.length > 0 ? shooters.length : 2;

                    // Fecha modal offline ("Bem-vindo de volta" / Coletar)
                    const coletarBtn = Array.from(document.querySelectorAll('button, .btn, [role="button"]')).find(b => 
                        b.offsetParent !== null && (b.textContent || '').trim().toLowerCase().includes('coletar') && !b.id.includes('daily')
                    );
                    if (coletarBtn) {
                        coletarBtn.click();
                        res.events.push('CLICOU_BOTAO_COLETAR');
                    }
                    const oflModal = document.getElementById('offline-modal');
                    if (oflModal && !oflModal.classList.contains('hidden')) {
                        const oflClose = document.getElementById('offline-modal-close') || oflModal.querySelector('button');
                        if (oflClose && oflClose.offsetParent !== null) oflClose.click();
                        oflModal.classList.add('hidden');
                        res.events.push('FECHOU_OFFLINE_MODAL');
                    }

                    // Detecta modal de reconexão ou sessão expirada (#conn-overlay)
                    const connOverlay = document.getElementById('conn-overlay');
                    if (connOverlay && !connOverlay.classList.contains('hidden')) {
                        const titleEl = connOverlay.querySelector('.auth-title');
                        const titleText = (titleEl?.textContent || '').trim();
                        res.connExpired = titleText || 'SESSÃO EXPIRADA';
                        const retryBtn = document.getElementById('conn-retry');
                        if (retryBtn && retryBtn.offsetParent !== null) {
                            retryBtn.click();
                            res.events.push('CLICOU_RECONECTAR: ' + (titleText || 'Reconectar'));
                        }
                    }

                    // Fecha outros modais indesejados (exceto os que estamos usando)
                    const closeBtns = Array.from(document.querySelectorAll('#broadcast-panel button, .modal .close-btn, [data-dismiss]'));
                    for (const cb of closeBtns) {
                        if (cb.offsetParent !== null) {
                            cb.click();
                            res.events.push('FECHOU_MODAL_BLOQUEANTE');
                        }
                    }

                    // Extrai nível do jogador (busca por múltiplos seletores ou texto de nível)
                    const lvlEl = document.querySelector('.hd-lvl, .player-level, #player-level, [data-player-level], .pm-lvl, .char-lvl');
                    if (lvlEl) {
                        const m = lvlEl.textContent.match(/\\d+/);
                        if (m) res.level = parseInt(m[0], 10);
                    }

                    // Extrai Stamina
                    const stamEl = document.getElementById('stamina-time');
                    if (stamEl) res.stamina = stamEl.textContent.trim();

                    // Extrai Gold (busca nos saldos ou elementos do HUD)
                    const goldEl = document.getElementById('gold-count') || document.querySelector('.mk-goldamt, .ac-wallet-val, .wallet, .bp-wallet b, .gold, [data-gold]');
                    if (goldEl) {
                        const gText = (goldEl.textContent || '').replace(/[^0-9]/g, '');
                        if (gText) res.gold = parseInt(gText, 10);
                    }

                    // Extrai Contagem de Inventário da Loot Pouch
                    const invCountEl = document.getElementById('inv-count');
                    if (invCountEl) {
                        res.invText = invCountEl.textContent.trim();
                    }

                    // --- RECURSO 1: CONFIGURA AUTO-SELL NATIVO DO SERVIDOR (75%, Ordenar Raridade) ---
                    if (shouldConfigAutoSell) {
                        try {
                            const cfgBtn = document.getElementById('autosell-cfg');
                            const asModal = document.getElementById('autosell-modal');
                            if (cfgBtn) {
                                cfgBtn.click();
                                if (asModal && !asModal.classList.contains('hidden')) {
                                    const rows = Array.from(asModal.querySelectorAll('.set-row'));
                                    for (const r of rows) {
                                        const label = (r.querySelector('span.muted')?.textContent || '').toLowerCase();
                                        if (label.includes('auto-venda') || label.includes('auto-sell')) {
                                            const ligadoBtn = Array.from(r.querySelectorAll('.set-seg button')).find(b => 
                                                (b.textContent || '').trim().toLowerCase() === 'ligado'
                                            );
                                            if (ligadoBtn && !ligadoBtn.classList.contains('on')) {
                                                ligadoBtn.click();
                                                res.events.push('ATIVOU_AUTOSELL_NATIVO');
                                            }
                                        } else if (label.includes('ordenar') || label.includes('order')) {
                                            const ligadoBtn = Array.from(r.querySelectorAll('.set-seg button')).find(b => 
                                                (b.textContent || '').trim().toLowerCase() === 'ligado'
                                            );
                                            if (ligadoBtn && !ligadoBtn.classList.contains('on')) {
                                                ligadoBtn.click();
                                                res.events.push('ATIVOU_ORDENAR_RARIDADE');
                                            }
                                        } else if (label.includes('vender em') || label.includes('sell at')) {
                                            const rangeInput = r.querySelector('input[type="range"]');
                                            if (rangeInput && rangeInput.value !== '75') {
                                                rangeInput.value = 75;
                                                rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
                                                rangeInput.dispatchEvent(new Event('change', { bubbles: true }));
                                                res.events.push('CONFIGUROU_PCT_AUTOSELL_75');
                                            }
                                        }
                                    }
                                    const asClose = document.getElementById('autosell-modal-close');
                                    if (asClose) asClose.click();
                                    else asModal.classList.add('hidden');
                                }
                            }
                        } catch(e) {}
                    }

                    // --- RECURSO 2: COLETAR RECOMPENSA DIÁRIA (DAILY REWARD) ---
                    const dailyTab = document.getElementById('tab-daily');
                    const dailyNotice = document.getElementById('daily-notice');
                    res.dailyBadge = !!dailyTab?.querySelector('.daily-badge');
                    const hasNotice = dailyNotice && !dailyNotice.classList.contains('hidden');

                    if (shouldCheckDaily && (res.dailyBadge || hasNotice)) {
                        try {
                            if (hasNotice) dailyNotice.click();
                            else if (dailyTab) dailyTab.click();

                            const dailyModal = document.getElementById('daily-modal');
                            if (dailyModal && !dailyModal.classList.contains('hidden')) {
                                const claimBtn = document.getElementById('daily-claim-btn');
                                if (claimBtn && !claimBtn.disabled && (claimBtn.textContent || '').toLowerCase().includes('coletar')) {
                                    claimBtn.click();
                                    res.events.push('DAILY_REWARD_COLETADA');
                                }
                                const dClose = document.getElementById('daily-modal-close');
                                if (dClose) dClose.click();
                                else dailyModal.classList.add('hidden');
                            }
                        } catch(e) {}
                    }

                    // --- RECURSO 3: ENTREGA DE PRODUTOS DE CRIATURAS AO CODEX ---
                    if (shouldCheckCodex) {
                        try {
                            const codexTab = document.getElementById('tab-codex');
                            if (codexTab && !codexTab.classList.contains('hidden')) {
                                codexTab.click();
                                const codexModal = document.getElementById('codex-modal');
                                if (codexModal && !codexModal.classList.contains('hidden')) {
                                    const deliverBtns = Array.from(codexModal.querySelectorAll('button')).filter(b => 
                                        b.offsetParent !== null && !b.disabled && (b.textContent || '').trim().toLowerCase() === 'entregar'
                                    );
                                    if (deliverBtns.length > 0) {
                                        deliverBtns[0].click();
                                        res.events.push('ENTREGOU_CODEX_ITEM');
                                    }
                                    const codexClose = document.getElementById('codex-modal-close');
                                    if (codexClose) codexClose.click();
                                    else codexModal.classList.add('hidden');
                                }
                            }
                        } catch(e) {}
                    }

                    // --- PRIORIDADE 1: COMPRA DE SLOTS DE CAMPEÃO (SLOTS 2 E 3 COM GOLD) ---
                    const unlockSlotBtn = Array.from(document.querySelectorAll('button, .btn, [data-mode="unlock"], [data-mode="recruit"], #recruit-btn')).find(b => {
                        if (b.offsetParent === null || b.disabled) return false;
                        const txt = (b.innerText || '').toLowerCase();
                        if (txt.includes('store') || txt.includes('coin')) return false;
                        return txt.includes('desbloquear por gold') || txt.includes('recrutar') || b.id === 'recruit-btn';
                    });
                    if (unlockSlotBtn) {
                        res.partySlotMode = unlockSlotBtn.dataset.mode || 'unlock';
                        unlockSlotBtn.click();
                        res.events.push('CLICOU_SLOT_CAMPEAO: ' + (unlockSlotBtn.innerText || 'OK').trim());
                    }

                    // Se o modal de recrutamento (#voc-overlay) estiver aberto, recruta o campeão
                    const vocOverlay = document.getElementById('voc-overlay');
                    if (vocOverlay && !vocOverlay.classList.contains('hidden')) {
                        const vocOpts = Array.from(document.querySelectorAll('.voc-opt:not([disabled])'));
                        const nameInput = document.getElementById('voc-name');
                        const createBtn = document.getElementById('voc-create');
                        const cancelBtn = document.getElementById('voc-cancel');
                        if (vocOpts.length > 0 && nameInput && createBtn && !createBtn.disabled) {
                            const freeVoc = vocOpts[0];
                            freeVoc.click();
                            const voc = freeVoc.dataset.voc || 'sorcerer';
                            const prefixes = ['Bell', 'Lord', 'Sir', 'Dark', 'Val', 'Kael', 'Thor', 'Odin'];
                            const pfx = prefixes[Math.floor(Math.random() * prefixes.length)];
                            const syllables = ['ar', 'on', 'en', 'ik', 'or', 'an', 'is', 'el', 'us', 'yr'];
                            const s1 = syllables[Math.floor(Math.random() * syllables.length)];
                            const s2 = syllables[Math.floor(Math.random() * syllables.length)];
                            const validName = pfx + voc.slice(0, 3) + s1 + s2;
                            nameInput.value = validName;
                            nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                            nameInput.dispatchEvent(new Event('change', { bubbles: true }));
                            createBtn.click();
                            res.events.push('RECRUTOU_CAMPEAO: ' + validName + ' (' + voc + ')');
                        } else {
                            if (cancelBtn) cancelBtn.click();
                            else vocOverlay.classList.add('hidden');
                            res.events.push('FECHOU_VOC_OVERLAY_SEM_OPCAO');
                        }
                    }

                    // --- PRIORIDADE 2: CONFIRMA OU DISPENSA MODAL DE VENDA/CONFIRMAÇÃO (se aberto) ---
                    const confirmModal = document.getElementById('confirm-modal');
                    if (confirmModal && !confirmModal.classList.contains('hidden')) {
                        const body = (document.getElementById('confirm-modal-body')?.textContent || '').toLowerCase();
                        const unsafe = /comprar|buy |lance|bid|leil[aã]o|auction|loja|store|\\bpix\\b|\\bvip\\b|assinar|premium/.test(body);
                        const confirmYes = document.getElementById('confirm-yes');
                        const confirmCancel = document.getElementById('confirm-no') || document.getElementById('confirm-cancel');
                        if (unsafe && confirmCancel) {
                            confirmCancel.click();
                            res.events.push('CANCELOU_CONFIRMA_INSEGURA');
                        } else if (confirmYes && !confirmYes.disabled) {
                            confirmYes.click();
                            res.events.push('CONFIRMOU_MODAL_ACAO');
                        } else if (!sellAllowed && confirmCancel) {
                            confirmCancel.click();
                        }
                    }

                    // --- PRIORIDADE 2b: AUTO-SELL PREVENTIVO (>= 70%) ---
                    let shouldSell = false;
                    if (res.invText) {
                        const m = res.invText.match(/(\\d+)\\s*\\/\\s*(\\d+)/);
                        if (m) {
                            const cur = parseInt(m[1], 10);
                            const max = parseInt(m[2], 10);
                            if (max > 0 && autoSell && ((cur / max) * 100 >= sellThresholdPct)) {
                                shouldSell = true;
                            }
                        }
                    }
                    if (sellAllowed && shouldSell && autoSell) {
                        const sellBtn = document.getElementById('sell-all');
                        if (sellBtn && !sellBtn.classList.contains('cd') && !sellBtn.disabled) {
                            sellBtn.click();
                            res.events.push('AUTO_SELL_POUCH: ' + res.invText);
                        }
                    }

                    // --- PRIORIDADE 2c: AUTO-EQUIPA SPELLS NA ROTAÇÃO DO PERSONAGEM ---
                    try {
                        const pickerModal = document.getElementById('picker-modal');
                        const pTitle = (pickerModal && !pickerModal.classList.contains('hidden'))
                            ? (pickerModal.querySelector('.im-title')?.textContent || '') : '';
                        if (pickerModal && !pickerModal.classList.contains('hidden') && /rota|magia|spell|cura|potion|po[cç][aã]o/i.test(pTitle)) {
                            res.events.push('PICKER_SPELL_ABERTO: ' + pTitle.trim());
                        } else if (!pickerModal || pickerModal.classList.contains('hidden')) {
                            slotLoop:
                            for (let slot = 0; slot < 2; slot++) {
                                let hasSpell = false;
                                let emptyU = -1;
                                for (let u = 0; u < 6; u++) {
                                    const rotSlot = document.getElementById(`rot-${slot}-${u}`);
                                    if (!rotSlot) continue;
                                    if (rotSlot.querySelector('small')) {
                                        if (emptyU < 0) emptyU = u;
                                    } else {
                                        hasSpell = true;
                                    }
                                }
                                if (!hasSpell && emptyU >= 0) {
                                    document.getElementById(`rot-${slot}-${emptyU}`).click();
                                    res.events.push(`CLICOU_SLOT_MAGIA_VAZIO: rot-${slot}-${emptyU}`);
                                    break slotLoop;
                                }
                            }
                        }
                    } catch(e) {}

                    // Expansão de mochila (+slot)
                    const buySlotBtn = document.getElementById('buy-slot');
                    if (buySlotBtn && !buySlotBtn.disabled) {
                        buySlotBtn.click();
                        res.events.push('EXPANDIU_MOCHILA_PLUS_SLOT');
                    }

                    // --- PRIORIDADE 3: AUTO-PROMOÇÃO (NÍVEL 20) EM TODOS OS MEMBROS ---
                    if (shouldCheckPromote) {
                        try {
                            const memBtns = Array.from(document.querySelectorAll('#skills-members .sk-mem'));
                            if (memBtns.length > 0) {
                                for (let i = 0; i < memBtns.length; i++) {
                                    const mBtn = memBtns[i];
                                    mBtn.click();
                                    const promoBtn = document.querySelector('#skills-panel-body .sk-promote');
                                    if (promoBtn && !promoBtn.disabled) {
                                        promoBtn.click();
                                        res.events.push('PROMOVEU_CAMPEAO_SLOT_' + i);
                                    }
                                }
                            } else {
                                const promoBtn = document.querySelector('.sk-promote, .cyc-char-promote');
                                if (promoBtn && !promoBtn.disabled) {
                                    promoBtn.click();
                                    res.events.push('PROMOVEU_CAMPEAO_GENERICO');
                                }
                            }
                        } catch(e) {}
                    }

                    // --- PRIORIDADE 4: MODO LOOP (#loop-toggle) SEMPRE ATIVO ---
                    const loopBtn = document.getElementById('loop-toggle');
                    if (loopBtn) {
                        res.loopOn = loopBtn.classList.contains('on');
                        if (!res.loopOn) {
                            loopBtn.click();
                            res.events.push('ATIVOU_MODO_LOOP');
                            res.loopOn = true;
                        }
                    }

                    return res;
                }""", {
                    "sellAllowed": sell_allowed,
                    "shouldConfigAutoSell": should_config_autosell,
                    "shouldCheckDaily": should_check_daily,
                    "shouldCheckCodex": should_check_codex,
                    "shouldCheckPromote": should_check_promote,
                    "autoSell": flags.auto_sell,
                    "sellThresholdPct": flags.sell_threshold_pct
                })

                if state.get("events"):
                    for ev in state["events"]:
                        print(f"[{ts_now()}] ⚡ [{ev}]", flush=True)
                        if "RECRUTOU_CAMPEAO" in ev:
                            need_potion_check = True
                            if party_slots > last_party_slots:
                                profiler.clear_death_penalties()
                                print(f"[{ts_now()}] 🚀 [BENCHMARK] Novo slot de campeão. Penalidades de morte zeradas; hunts serão reavaliadas.", flush=True)
                            last_party_slots = max(last_party_slots, party_slots)
                        if "CONFIRMOU_MODAL_ACAO" in ev or "CONFIRMOU_VENDA_MODAL" in ev:
                            last_sell_time = now  # registra cooldown de 2 min
                        if "ATIVOU_AUTOSELL_NATIVO" in ev or "CONFIGUROU_PCT_AUTOSELL" in ev:
                            subsystems_status["auto_sell"] = {
                                "status": "FUNCIONAL",
                                "detail": "Nativo do servidor ativo (75% da Pouch, ordenar raridade: ON)"
                            }
                        if "DAILY_REWARD_COLETADA" in ev:
                            subsystems_status["daily_reward"] = {
                                "status": "FUNCIONAL",
                                "detail": "Recompensa diária coletada com sucesso hoje"
                            }
                        if "PROMOVEU_CAMPEAO" in ev:
                            subsystems_status["auto_promote"] = {
                                "status": "FUNCIONAL",
                                "detail": f"Campeão promovido com sucesso ({ev})"
                            }
                        if "ENTREGOU_CODEX_ITEM" in ev:
                            subsystems_status["codex"] = {
                                "status": "FUNCIONAL",
                                "detail": "Produtos de criaturas entregues ao Codex com sucesso"
                            }

                if should_config_autosell:
                    last_autosell_cfg_time = now
                    if subsystems_status["auto_sell"]["status"] != "FUNCIONAL":
                        subsystems_status["auto_sell"] = {
                            "status": "FUNCIONAL",
                            "detail": "Nativo do servidor sincronizado (75% da Pouch)"
                        }

                if should_check_daily:
                    last_daily_check_time = now
                    if not state.get("dailyBadge") and subsystems_status["daily_reward"]["status"] != "FUNCIONAL":
                        subsystems_status["daily_reward"] = {
                            "status": "AGUARDANDO_REQUISITO",
                            "detail": "Sem recompensa pendente hoje (cooldown 24h ativo)"
                        }

                if should_check_codex:
                    last_codex_check_time = now
                    if subsystems_status["codex"]["status"] != "FUNCIONAL":
                        subsystems_status["codex"] = {
                            "status": "FUNCIONAL",
                            "detail": "Monitorando produtos de monstros (nenhum excedente pronto no momento)"
                        }

                if (should_check_promote):
                    last_promote_check_time = now
                    if subsystems_status["auto_promote"]["status"] != "FUNCIONAL":
                        if player_level and player_level < 20:
                            subsystems_status["auto_promote"] = {
                                "status": "AGUARDANDO_REQUISITO",
                                "detail": f"Nível atual ({player_level}) < 20"
                            }
                        elif player_gold and player_gold < 20000:
                            subsystems_status["auto_promote"] = {
                                "status": "AGUARDANDO_REQUISITO",
                                "detail": f"Gold insuficiente ({player_gold:,} < 20.000)"
                            }
                        else:
                            subsystems_status["auto_promote"] = {
                                "status": "AGUARDANDO_REQUISITO",
                                "detail": "Aguardando requisitos de promoção"
                            }

                # --- WATCHDOG DE SESSÃO E CONEXÃO ---
                needs_reconnect = False
                reconnect_reason = ""
                if state.get("connExpired"):
                    needs_reconnect = True
                    reconnect_reason = f"connExpired: {state.get('connExpired')}"
                elif "/jogar" not in page.url:
                    needs_reconnect = True
                    reconnect_reason = f"URL fora de /jogar/: {page.url}"
                elif not ws_connected and (now - last_ws_close_time > 6):
                    needs_reconnect = True
                    reconnect_reason = f"WebSocket desconectado há {int(now - last_ws_close_time)}s"
                elif now - last_ws_frame_time > 30:
                    needs_reconnect = True
                    reconnect_reason = f"Sem frames WebSocket há {int(now - last_ws_frame_time)}s"

                if needs_reconnect:
                    print(f"[{ts_now()}] 🔄 [WATCHDOG RECONECTAR] {reconnect_reason}. Restaurando sessão...", flush=True)
                    try:
                        conn_retry = page.query_selector("#conn-retry")
                        if conn_retry and conn_retry.is_visible():
                            print(f"[{ts_now()}] 🔄 Clicando em botão Reconectar (#conn-retry)...", flush=True)
                            conn_retry.click()
                            time.sleep(4)
                        else:
                            page.goto("https://baiakidle.com/jogar/", wait_until="commit", timeout=30000)
                            time.sleep(6)
                        last_ws_frame_time = time.time()
                        last_ws_close_time = 0.0
                    except Exception as re_err:
                        print(f"[{ts_now()}] ⚠️ [WATCHDOG ERRO] {re_err}", flush=True)
                    continue

                if state.get("wave"):
                    current_hunt = state["wave"]
                if state.get("invText"):
                    bag_slots = state["invText"]
                old_lvl = player_level
                if state.get("level"):
                    player_level = state["level"]
                if state.get("gold") is not None:
                    player_gold = state["gold"]
                if state.get("stamina"):
                    player_stamina = state["stamina"]
                if state.get("partySlotsCount"):
                    party_slots = state["partySlotsCount"]
                loop_active = bool(state.get("loopOn"))

                hud = {}
                try:
                    hud = page.evaluate(JS_HUD) or {}
                except Exception:
                    hud = {}
                if hud.get("level"):
                    player_level = hud["level"]
                if hud.get("gold") is not None:
                    player_gold = hud["gold"]
                if hud.get("stamina"):
                    player_stamina = hud["stamina"]
                if hud.get("analyzers"):
                    latest_analyzers = hud["analyzers"]
                if old_lvl and player_level and player_level > old_lvl:
                    need_potion_check = True
                if party_slots > last_party_slots:
                    need_potion_check = True
                for hlp in hud.get("helpers") or []:
                    if isinstance(hlp, dict) and hlp.get("slot") is not None:
                        helper_by_slot[int(hlp["slot"])] = hlp
                magic_state = classify_magic(
                    hud.get("spells") or [],
                    [helper_by_slot[k] for k in sorted(helper_by_slot)],
                )

                if looks_like_treino(current_hunt) or looks_like_treino(state.get("wave")):
                    in_treino = True
                stam_empty = stamina_is_empty(player_stamina)
                stam_ok = stamina_has_recovered(player_stamina)
                if flags.auto_treino and should_enter_treino(True, stam_empty) and (now - last_treino_time >= 8):
                    last_treino_time = now
                    try:
                        tr = page.evaluate(JS_TREINO, {"want": "train"}) or {}
                        for ev in tr.get("events") or []:
                            print(f"[{ts_now()}] 🧘 [TREINO] {ev}", flush=True)
                        if tr.get("wave"):
                            current_hunt = tr["wave"]
                        if tr.get("inTreino") or tr.get("action"):
                            in_treino = True
                        subsystems_status["treino"] = {
                            "status": "TREINANDO",
                            "detail": "Stamina <= 15% — Treino online ativo"
                        }
                    except Exception as e:
                        print(f"[{ts_now()}] 🧘 [TREINO ERRO] {e}", flush=True)
                elif in_treino and should_resume_hunts(flags.auto_treino, stam_ok, True):
                    in_treino = False
                    subsystems_status["treino"] = {
                        "status": "HUNT",
                        "detail": "Stamina recuperou — voltando às hunts"
                    }
                    print(f"[{ts_now()}] 🧘 [TREINO] stamina recuperou — voltando às hunts", flush=True)

                for line in extras_tick(
                    page, flags, now, extra_last, EXTRA_SCRIPTS, in_treino=in_treino
                ):
                    print(f"[{ts_now()}] {line}", flush=True)

                if flags.auto_heal and not hud.get("pickerOpen") and (now - last_potion_check >= 60 or need_potion_check):
                    last_potion_check = now
                    need_potion_check = False
                    try:
                        pot_res = page.evaluate(JS_POTION, {
                            "autoHeal": flags.auto_heal,
                            "healBelowPct": flags.heal_below_pct,
                            "hpPotionBelowPct": flags.hp_potion_below_pct,
                            "manaPotionBelowPct": flags.mana_potion_below_pct,
                        })
                        if pot_res and pot_res.get("events"):
                            for ev in pot_res["events"]:
                                print(f"[{ts_now()}] 🧪 [POTION/CURA] {ev}", flush=True)
                        elif pot_res and not pot_res.get("ok"):
                            print(f"[{ts_now()}] 🧪 [POTION AVISO] {pot_res}", flush=True)
                    except Exception as e:
                        print(f"[{ts_now()}] 🧪 [POTION ERRO] {e}", flush=True)

                handled_spell = False
                picker_kind = hud.get("pickerKind")
                picker_open_ev = any("PICKER_SPELL_ABERTO" in ev for ev in (state.get("events") or []))
                spell_args = {
                    "metaAoe": list(AOE_WORDS), "metaStrike": list(STRIKE_WORDS),
                    "healWords": list(HEAL_WORDS), "manaWords": list(MANA_WORDS),
                }

                def _apply_helper_snap(res):
                    snap = (res or {}).get("helper") if isinstance(res, dict) else None
                    if not isinstance(snap, dict) or snap.get("slot") is None:
                        return
                    sid = int(snap["slot"])
                    helper_by_slot[sid] = {**helper_by_slot.get(sid, {}), **snap}

                def _log_spell(tag, res):
                    print(f"[{ts_now()}] 🔮 [{tag}] {res}", flush=True)
                    for ev in (res or {}).get("events") or []:
                        if str(ev).startswith("CONFIGUROU_"):
                            print(f"[{ts_now()}] 🔮 [{ev}]", flush=True)

                if picker_kind in ("spell", "heal", "mana", "hp") or picker_open_ev:
                    handled_spell = True
                    need = {"heal": "heal", "mana": "mana", "hp": "hp"}.get(picker_kind, "aoe")
                    try:
                        spell_res = page.evaluate(JS_SPELL, {
                            **spell_args, "need": need, "job": "pick", "slot": last_gear_slot,
                        })
                        _apply_helper_snap(spell_res)
                        tag = "CURA" if need == "heal" else ("MANA" if need == "mana" else "MAGIA")
                        _log_spell(tag, spell_res)
                    except Exception as e:
                        print(f"[{ts_now()}] 🔮 [MAGIA ERRO] {e}", flush=True)
                elif not magic_state.get("party_ready"):
                    slots = magic_state.get("slots") or {}
                    present = [int(k) for k in slots if str(k).isdigit()]
                    if not present:
                        present = [0, 1]
                    for sid in present:
                        if sid > 2:
                            continue
                        kit = slots.get(str(sid)) or {}
                        if kit.get("ready"):
                            continue
                        job_need, job = "aoe", "fill"
                        if kit.get("attack") and not kit.get("heal"):
                            job_need, job = "heal", "helper"
                        elif kit.get("attack") and not kit.get("mana"):
                            job_need, job = "mana", "helper"
                        try:
                            spell_res = page.evaluate(JS_SPELL, {
                                **spell_args, "need": job_need, "job": job, "slot": sid,
                            })
                            last_gear_slot = sid
                            _apply_helper_snap(spell_res)
                            if spell_res and (spell_res.get("ok") or spell_res.get("events")):
                                handled_spell = True
                                _log_spell(f"GEAR slot{sid}", spell_res)
                                break
                        except Exception as e:
                            print(f"[{ts_now()}] 🔮 [GEAR ERRO] {e}", flush=True)
                            break

                if helper_by_slot:
                    magic_state = classify_magic(
                        hud.get("spells") or [],
                        [helper_by_slot[k] for k in sorted(helper_by_slot)],
                    )

                picker_open = bool(hud.get("pickerOpen"))
                hunt_name_l = (current_hunt or "").lower()
                looks_city = (
                    (not current_hunt)
                    or current_hunt in ("—", "–", "-", "\u2014")
                    or "cidade" in hunt_name_l
                    or "city" in hunt_name_l
                    or "conectando" in hunt_name_l
                )
                if looks_city and not picker_open:
                    city_streak += 1
                else:
                    city_streak = 0
                is_city = city_streak >= 2

                if looks_like_treino(current_hunt) or in_treino:
                    if profiler.active_hunt_id is not None:
                        profiler._commit_session(player_gold, kills, died=False)
                        profiler.active_hunt_id = None
                        profiler.hunt_start_time = None
                elif not is_city and current_hunt and current_hunt != "—":
                    matched_hunt = match_hunt(current_hunt)
                    h_id = matched_hunt["id"] if matched_hunt else "current_hunt"
                    h_name = matched_hunt["name"] if matched_hunt else current_hunt
                    if profiler.active_hunt_id != h_id:
                        profiler.start_session(h_id, h_name, player_gold, kills)
                        print(f"[{ts_now()}] 🏹 [SESSÃO INICIADA] Monitorando telemetria em '{h_name}'...", flush=True)
                    else:
                        profiler.update_tick(player_gold, kills)
                        b = profiler.benchmarks.get(h_id, {})
                        hunt_matrix.record_tick(
                            hunt_id=h_id,
                            hunt_name=h_name,
                            level=player_level,
                            gold_per_hour=b.get("gold_per_hour", 0.0),
                            kills_per_hour=b.get("kills_per_hour", 0.0),
                            waves_per_hour=round(waves / (max(1.0, now - t0)) * 3600, 1),
                            deaths=b.get("deaths", 0),
                            xp_per_hour=latest_analyzers.get("xp_per_hour"),
                            loot_per_hour=latest_analyzers.get("loot_per_hour"),
                        )
                elif is_city and profiler.active_hunt_id is not None:
                    profiler.record_death(player_gold, kills)
                    print(f"[{ts_now()}] ⚠️ [BENCHMARK] Morte/templo confirmado. Hunt despriorizada temporariamente.", flush=True)

                game_ready = bool(ws_connected) or match_hunt(current_hunt) is not None or kills > 0
                need_scan = game_ready and (not profiler.unlocked_ids or not player_level) and (now - last_hunt_scan >= 30)
                best_hunt = profiler.get_best_hunt_to_farm(player_level, magic_state, profiler.unlocked_ids)
                should_enter, reason = profiler.should_enter(
                    profiler.active_hunt_id, best_hunt, is_city, now, last_hunt_attempt
                )
                sampling = str((profiler.last_decision or {}).get("mode") or "") == "sample"
                if need_scan and not should_enter:
                    if sampling or (profiler.active_hunt_id and not is_city):
                        last_hunt_scan = now
                        try:
                            hunt_res = page.evaluate(JS_HUNT, {"id": "", "name": ""})
                            unlocked = ids_from_picker_rows((hunt_res or {}).get("unlocked") or [])
                            if unlocked:
                                profiler.unlocked_ids = unlocked
                                if not player_level:
                                    inferred = infer_level(None, unlocked)
                                    if inferred:
                                        player_level = inferred
                                        print(f"[{ts_now()}] 🏹 [NÍVEL INFERIDO] {player_level} via hunts desbloqueadas", flush=True)
                        except Exception as e:
                            print(f"[{ts_now()}] 🏹 [ERRO SCAN]: {e}", flush=True)
                    else:
                        should_enter = True
                        reason = "scan da lista de hunts (nível/desbloqueadas)"
                        last_hunt_scan = now
                if not game_ready:
                    should_enter = False
                elif handled_spell and not need_scan and not is_city:
                    should_enter = False
                if in_treino or stam_empty or not flags.auto_hunt:
                    should_enter = False
                if flags.hunt_id and flags.auto_hunt and not in_treino and not stam_empty:
                    cur = match_hunt(current_hunt)
                    if not cur or cur.get("id") != flags.hunt_id:
                        should_enter = True
                        reason = reason or f"HUNT_ID={flags.hunt_id}"
                    elif cur.get("id") == flags.hunt_id:
                        should_enter = False

                if should_enter and (now - last_hunt_attempt >= 10):
                    last_hunt_attempt = now
                    profiler.mark_switch()
                    target = best_hunt or {"id": "", "name": ""}
                    if flags.hunt_id:
                        target = {"id": flags.hunt_id, "name": flags.hunt_id}
                    label = f"{target.get('name')} ({target.get('id')})" if target.get("id") else "scan"
                    print(f"[{ts_now()}] 🏹 [HUNT DECISÃO] {reason}. Alvo: {label} | Lvl {player_level} | magia {magic_state}", flush=True)
                    try:
                        hunt_res = page.evaluate(JS_HUNT, target)
                        unlocked = ids_from_picker_rows((hunt_res or {}).get("unlocked") or [])
                        if unlocked:
                            profiler.unlocked_ids = unlocked
                            last_hunt_scan = now
                            if not player_level:
                                inferred = infer_level(None, unlocked)
                                if inferred:
                                    player_level = inferred
                                    print(f"[{ts_now()}] 🏹 [NÍVEL INFERIDO] {player_level} via hunts desbloqueadas", flush=True)
                            best_hunt = profiler.get_best_hunt_to_farm(player_level, magic_state, unlocked)
                            if best_hunt and hunt_res and not hunt_res.get("success") and best_hunt.get("id") != target.get("id"):
                                hunt_res = page.evaluate(JS_HUNT, best_hunt)
                        print(f"[{ts_now()}] 🏹 [RESULTADO TELEPORTE] {hunt_res}", flush=True)
                        if profiler.last_decision:
                            d = profiler.last_decision
                            print(f"[{ts_now()}] 🏹 [ANALISE] {d.get('reason')} | mode={d.get('mode')} home={d.get('home')} | top {d.get('top3')}", flush=True)
                    except Exception as e:
                        print(f"[{ts_now()}] 🏹 [ERRO TELEPORTE]: {e}", flush=True)

            except Exception as e:
                print(f"[{ts_now()}] ⚠️ [LOOP ERRO] {e}", flush=True)

            # 4. Relatório Periódico de Métricas e Telemetria
            if now - last_metric_print >= 45:
                elapsed = now - t0
                waves_h = round(waves / elapsed * 3600, 1) if elapsed > 0 else 0
                kills_h = round(kills / elapsed * 3600, 1) if elapsed > 0 else 0

                cur_b = profiler.benchmarks.get(profiler.active_hunt_id, {})
                cur_gold_h = cur_b.get("gold_per_hour", 0.0)

                lvl_str = f" | Lvl: {player_level}" if player_level else ""
                gold_str = f" | Gold: {player_gold:,}" if player_gold else ""
                gold_rate_str = f" | Gold/h: {cur_gold_h:,.0f}" if cur_gold_h else ""
                hunt_str = f" | Hunt: {current_hunt}" if current_hunt else ""
                treino_str = " | Treino: ON" if in_treino else ""
                slots_str = f" | Champions: {party_slots}"
                loop_str = f" | Loop: {'ON' if loop_active else 'OFF'}"
                bag_str = f" | Pouch: {bag_slots}" if bag_slots else ""
                s0 = (magic_state.get("slots") or {}).get("0") or {}
                s1 = (magic_state.get("slots") or {}).get("1") or {}
                mag_str = (
                    f" | Magia: p{magic_state.get('power', 0)} aoe={magic_state.get('aoe', 0)}"
                    f" s0 h{s0.get('heal', 0)}/m{s0.get('mana', 0)} s1 h{s1.get('heal', 0)}/m{s1.get('mana', 0)}"
                    f" party={magic_state.get('party_ready')}"
                )
                dec = profiler.last_decision or {}
                dec_str = f" | Dec: {dec.get('mode') or '-'} {(dec.get('reason') or '')[:80]}"

                print(f"[{ts_now()}] 📊 [METRICAS REAIS] Waves: {waves} ({waves_h}/h) | Kills: {kills} ({kills_h}/h){gold_rate_str}{lvl_str}{gold_str}{hunt_str}{treino_str}{slots_str}{loop_str}{bag_str}{mag_str}{dec_str} | Online: {int(elapsed//60)}m", flush=True)
                sub_line = " | ".join([f"{k}: {v['status']}" for k, v in subsystems_status.items()])
                print(f"[{ts_now()}] 🛡️ [SUBSISTEMAS] {sub_line}", flush=True)
                top_p = hunt_matrix.get_rankings().get("by_profit", [])
                if top_p:
                    best = top_p[0]
                    print(f"[{ts_now()}] 🧠 [APRENDIZADO ANALYZER] Top Lucro: {best['name']} ({best.get('avg_gold_h', 0):,.0f} g/h | {best.get('safety_rating')}) | Hunts catalogadas: {len(hunt_matrix.matrix)}", flush=True)
                update_status_file()
                last_metric_print = now

        print(f"[{ts_now()}] Fechando navegador...")
        browser.close()

    print("[*] Bot finalizado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
