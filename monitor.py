"""Baiak Idle — monitor passivo (só leitura).

Observa os WebSockets reais da página /jogar/, decodifica
[opcode:1B][msgpack(type)][msgpack(payload)] e registra tudo em JSONL.
NÃO injeta mensagens, NÃO altera nada, NÃO compra, NÃO fala no chat.

Uso:
    export BAIAK_TOKEN=...   # valor de localStorage['baiak-idle-token']
    python monitor.py

Saída em ./data/: frames.jsonl, metrics.jsonl
"""
import json
import os
import sys
import time
from datetime import datetime, timezone

RT_URLS = ("rt2.baiakidle.com", "rt3.baiakidle.com")

# --- msgpack decode mínimo (suficiente p/ frames do jogo) ---
def _mp(b, st):
    o = st[0]
    x = b[o]; st[0] = o + 1
    if x < 0x80: return x
    if x <= 0x8f:
        m = {}
        # NOTA: avalia k e v em statements separados — `m[_mp()] = _mp()`
        # avalia o valor antes da chave no CPython e corrompe o cursor.
        for _ in range(x & 0x0F):
            k = _mp(b, st); v = _mp(b, st); m[k] = v
        return m
    if x <= 0x9F: return [_mp(b, st) for _ in range(x & 0x0F)]
    if x <= 0xBF:
        l = x & 0x1F; s = bytes(b[st[0]:st[0] + l]); st[0] += l
        return s.decode("utf-8", "replace")
    if x == 0xC0: return None
    if x == 0xC2: return False
    if x == 0xC3: return True
    if x in (0xC4, 0xC5, 0xC6):
        l = b[st[0]] if x == 0xC4 else (b[st[0]] << 8 | b[st[0]+1] if x == 0xC5
            else int.from_bytes(b[st[0]:st[0]+4], "big"))
        st[0] += 1 if x == 0xC4 else (2 if x == 0xC5 else 4)
        s = bytes(b[st[0]:st[0]+l]); st[0] += l
        return {"__bin": len(s)}
    if x in (0xC7, 0xC8, 0xC9, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8):
        if x >= 0xD4:
            l = 1 << (x - 0xD4); st[0] += 1; s = l
        else:
            l = b[st[0]] if x == 0xC7 else (b[st[0]] << 8 | b[st[0]+1] if x == 0xC8
                else int.from_bytes(b[st[0]:st[0]+4], "big"))
            st[0] += (1 if x == 0xC7 else (2 if x == 0xC8 else 4)) + 1
            s = l
        st[0] += s
        return {"__ext": s}
    if x == 0xCA:
        import struct; v = struct.unpack(">f", bytes(b[st[0]:st[0]+4]))[0]; st[0] += 4; return v
    if x == 0xCB:
        import struct; v = struct.unpack(">d", bytes(b[st[0]:st[0]+8]))[0]; st[0] += 8; return v
    if x == 0xCC: v = b[st[0]]; st[0] += 1; return v
    if x == 0xCD: v = b[st[0]] << 8 | b[st[0]+1]; st[0] += 2; return v
    if x == 0xCE: v = int.from_bytes(b[st[0]:st[0]+4], "big"); st[0] += 4; return v
    if x == 0xCF: v = int.from_bytes(b[st[0]:st[0]+8], "big"); st[0] += 8; return v
    if x == 0xD0: v = b[st[0]] - 256 if b[st[0]] > 127 else b[st[0]]; st[0] += 1; return v
    if x == 0xD1: v = int.from_bytes(b[st[0]:st[0]+2], "big", signed=True); st[0] += 2; return v
    if x == 0xD2: v = int.from_bytes(b[st[0]:st[0]+4], "big", signed=True); st[0] += 4; return v
    if x == 0xD3: v = int.from_bytes(b[st[0]:st[0]+8], "big", signed=True); st[0] += 8; return v
    if x == 0xD9: l = b[st[0]]; st[0] += 1; s = bytes(b[st[0]:st[0]+l]); st[0] += l; return s.decode("utf-8", "replace")
    if x == 0xDA:
        l = b[st[0]] << 8 | b[st[0]+1]; st[0] += 2
        s = bytes(b[st[0]:st[0]+l]); st[0] += l; return s.decode("utf-8", "replace")
    if x == 0xDB:
        l = int.from_bytes(b[st[0]:st[0]+4], "big"); st[0] += 4
        s = bytes(b[st[0]:st[0]+l]); st[0] += l; return s.decode("utf-8", "replace")
    if x == 0xDC:
        n = b[st[0]] << 8 | b[st[0]+1]; st[0] += 2; return [_mp(b, st) for _ in range(n)]
    if x == 0xDD:
        n = int.from_bytes(b[st[0]:st[0]+4], "big"); st[0] += 4; return [_mp(b, st) for _ in range(n)]
    if x == 0xDE:
        n = b[st[0]] << 8 | b[st[0]+1]; st[0] += 2
        m = {}
        for _ in range(n):
            k = _mp(b, st); v = _mp(b, st); m[k] = v
        return m
    if x == 0xDF:
        n = int.from_bytes(b[st[0]:st[0]+4], "big"); st[0] += 4
        m = {}
        for _ in range(n):
            k = _mp(b, st); v = _mp(b, st); m[k] = v
        return m
    if x >= 0xE0: return x - 256
    raise ValueError(f"byte msgpack desconhecido 0x{x:02x}")


def decode_frame(raw):
    """Retorna dict serializável ou {'opaco': ...} p/ STATE/PATCH."""
    b = list(raw)
    if not b: return {"opaco": "vazio"}
    op = b[0]
    if op != 0x0D:  # só ROOM_DATA decodifica; 0x0E/0x0F = schema opaco
        return {"opcode": op, "opaco": f"{len(b)}B state/schema"}
    st = [1]
    try:
        typ = _mp(b, st)
        pay = _mp(b, st) if st[0] < len(b) else None
        return {"opcode": op, "type": typ, "payload": pay}
    except Exception as e:
        return {"opcode": op, "opaco": f"msgpack falhou: {e}"}


def now():
    return datetime.now(timezone.utc).isoformat()


def main():
    token = os.environ.get("BAIAK_TOKEN", "").strip()
    if not token:
        print("BAIAK_TOKEN vazio. Pegue em: Brave devtools > Application > Local Storage > baiak-idle-token", file=sys.stderr)
        return 2
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("pip install -r requirements.txt (+ playwright install chromium)", file=sys.stderr)
        return 3

    os.makedirs("data", exist_ok=True)
    f_frames = open("data/frames.jsonl", "a", encoding="utf-8")
    f_met = open("data/metrics.jsonl", "a", encoding="utf-8")
    waves, kills, t0 = 0, 0, time.time()
    saw_offline = False

    def log(kind, obj):
        rec = {"ts": now(), "kind": kind, **obj}
        (f_frames if kind == "ws_frame" else f_met).write(json.dumps(rec, ensure_ascii=False) + "\n")
        (f_frames if kind == "ws_frame" else f_met).flush()

    with sync_playwright() as pw:
        br = pw.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = br.new_context()
        # injeta token antes de qualquer JS (evita tela de login)
        ctx.add_init_script(f"localStorage.setItem('baiak-idle-token', {json.dumps(token)});")
        pg = ctx.new_page()

        def on_ws(ws):
            if not any(h in ws.url for h in RT_URLS):
                return
            def hook(direction):
                def cb(payload):
                    if not isinstance(payload, (bytes, bytearray)):
                        log("ws_frame", {"direction": direction, "url": ws.url.split("?")[0],
                                         "frame": {"texto": str(payload)[:200]}})
                        return
                    fr = decode_frame(bytes(payload))
                    log("ws_frame", {"direction": direction, "url": ws.url.split("?")[0], "frame": fr})
                    nonlocal waves, kills, saw_offline
                    if direction == "in" and isinstance(fr, dict):
                        t = fr.get("type")
                        if t == "offlineReport":
                            saw_offline = True
                            log("metric", {"m": "offlineReport", "v": fr.get("payload")})
                        if t in ("log", "notify"):
                            waves += 1
                        if t == "combatlog":
                            pl = fr.get("payload") or []
                            kills += sum(1 for e in (pl if isinstance(pl, list) else [pl])
                                         if isinstance(e, dict) and e.get("killed"))
                        el = time.time() - t0
                        if el > 0 and (waves + kills) > 0:
                            log("metric", {"m": "ritmo", "waves": waves, "kills": kills,
                                           "waves_h": round(waves / el * 3600, 1)})
                return cb
            ws.on("framesent", hook("out"))
            ws.on("framereceived", hook("in"))

        pg.on("websocket", on_ws)
        pg.goto("https://baiakidle.com/jogar/", wait_until="domcontentloaded", timeout=45000)
        print("observando... Ctrl+C para parar. frames -> data/frames.jsonl", flush=True)
        try:
            while True:
                pg.wait_for_timeout(5000)
                if pg.url == "https://baiakidle.com/":
                    log("metric", {"m": "redirect_landing"})
                    pg.goto("https://baiakidle.com/jogar/", wait_until="domcontentloaded", timeout=45000)
        except KeyboardInterrupt:
            pass
        br.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
