"""Decisões 24/7 e despacho DOM (sem opcodes / sem Leviticus)."""

from __future__ import annotations

import re
from typing import Any

from config import Flags

# Offline picker: o bot precisa permanecer online. Entrar em hunt/treino
# offline derruba o loop 24/7 (sem DOM, sem WS, sem auto-sell). No-op de propósito.
OFFLINE_PICKER_SKIP_REASON = (
    "picker offline ignorado: bot 24/7 precisa ficar na sessão online "
    "(hunt/treino/boss via DOM). Ir offline cortaria o loop."
)

_STAM_CLOCK = re.compile(r"^\s*(\d+)\s*:\s*(\d{1,2})\s*$")
_STAM_PCT = re.compile(r"(\d+)\s*%")
_UNSAFE_CONFIRM = re.compile(
    r"comprar|buy\b|lance|bid\b|leil[aã]o|auction|loja\b|store\b|"
    r"\bpix\b|\bvip\b|assinar|premium|doar|donate|transferir coins",
    re.I,
)
_SAFE_CONFIRM = re.compile(
    r"vender|sell|entregar|equipar|coletar|claim|abrir|promover|recrutar",
    re.I,
)
_JUNK_EQUIP = re.compile(
    r"potion|rune|gold coin|platinum|crystal coin|bag|backpack|ammo|"
    r"bolt|arrow|spear|throwing",
    re.I,
)


def parse_stamina_minutes(text: str | None) -> int | None:
    if not text:
        return None
    raw = str(text).strip()
    clock = _STAM_CLOCK.match(raw)
    if clock:
        return int(clock.group(1)) * 60 + int(clock.group(2))
    pct = _STAM_PCT.search(raw)
    if pct:
        return int(pct.group(1))
    if raw in ("0", "—", "–", "-", "empty", "vazia"):
        return 0
    digits = re.sub(r"[^\d]", "", raw)
    if digits == "0":
        return 0
    return None


def stamina_is_empty(text: str | None, pct: int | None = None, threshold_pct: int = 15) -> bool:
    """Retorna True se stamina estiver <= 15% (ou threshold_pct configurado)."""
    if pct is not None:
        return pct <= threshold_pct
    if not text:
        return False
    raw = str(text).strip().lower()
    if raw in ("0:00", "00:00", "0%", "0", "vazia", "empty"):
        return True
    m_pct = re.search(r"(\d+)\s*%", raw)
    if m_pct:
        return int(m_pct.group(1)) <= threshold_pct
    mins = parse_stamina_minutes(text)
    if mins is None:
        return False
    # Max stamina: 42h = 2520 min. 15% = 378 min (~06:18)
    thresh_mins = int(2520 * (threshold_pct / 100.0))
    return mins <= thresh_mins


def stamina_has_recovered(text: str | None, pct: int | None = None, recovery_pct: int = 85) -> bool:
    """Retorna True quando stamina tiver recuperado para patamar saudável (>= 85% ou 35h+)."""
    if pct is not None:
        return pct >= recovery_pct
    if not text:
        return False
    m_pct = re.search(r"(\d+)\s*%", str(text))
    if m_pct:
        return int(m_pct.group(1)) >= recovery_pct
    mins = parse_stamina_minutes(text)
    if mins is None:
        return False
    thresh_mins = int(2520 * (recovery_pct / 100.0))
    return mins >= thresh_mins


def looks_like_treino(wave: str | None) -> bool:
    return bool(re.search(r"treino\s*online|online\s*training", wave or "", re.I))


def should_enter_treino(auto_treino: bool, empty: bool) -> bool:
    return bool(auto_treino and empty)


def should_resume_hunts(auto_treino: bool, recovered: bool, in_treino: bool) -> bool:
    if not in_treino:
        return True
    if not auto_treino:
        return True
    return bool(recovered)


def should_auto_sell(cur: int, cap: int, threshold_pct: int, auto_sell: bool) -> bool:
    if not auto_sell or cap <= 0:
        return False
    return (cur / cap) * 100 >= threshold_pct


def confirm_is_unsafe(body: str | None) -> bool:
    text = body or ""
    if _UNSAFE_CONFIRM.search(text):
        return True
    return False


def confirm_is_safe_action(body: str | None) -> bool:
    text = body or ""
    if confirm_is_unsafe(text):
        return False
    return bool(_SAFE_CONFIRM.search(text) or not text.strip())


def should_transfer_loot(tier: int | None, name: str | None) -> bool:
    """Raro+ (tier>=2) da loot pouch → backpack. Não lista leilão / não compra."""
    label = name or ""
    if re.search(r"gold coin|platinum|crystal coin", label, re.I):
        return False
    if tier is None:
        return bool(re.search(r"rare|epic|legendary|mythical|raro", label, re.I))
    return int(tier) >= 2


def should_skip_equip_item(name: str | None, equip_enabled: bool) -> bool:
    if not equip_enabled:
        return True
    return bool(_JUNK_EQUIP.search(name or ""))


def skip_market_buy() -> bool:
    return True


def _tag(key: str, res: Any) -> list[str]:
    label = {
        "bags": "GLOOTH",
        "boss": "BOSS",
        "equip": "EQUIP",
        "prey": "PREY",
        "treino": "TREINO",
        "vfx": "VFX",
        "chest": "CHEST",
        "codex": "CODEX",
        "tree": "TREE",
        "charms": "CHARMS",
        "bp": "PASSE",
        "guild": "GUILD",
        "merchant": "MERCADOR",
        "boosts": "BOOSTS",
        "market": "MARKET",
        "forge": "FORJA",
        "imbue": "IMBUE",
        "supply": "SUPPLY",
        "loopcfg": "LOOPCFG",
        "manageloot": "LOOT",
        "house": "CASA",
        "offline": "OFFLINE",
        "modals": "MODAL",
    }.get(key, key.upper())
    out: list[str] = []
    if res is None:
        return out
    if isinstance(res, dict):
        events = res.get("events") or []
        if isinstance(events, list) and events:
            for ev in events:
                out.append(f"[{label}] {ev}")
        elif res.get("ok") or res.get("action"):
            out.append(f"[{label}] {res.get('action') or res.get('detail') or res}")
        elif res.get("skip"):
            out.append(f"[{label}] skip: {res.get('skip')}")
    else:
        out.append(f"[{label}] {res}")
    return out


def tick(
    page: Any,
    flags: Flags,
    now: float,
    last: dict[str, float],
    scripts: dict[str, str],
    *,
    in_treino: bool,
) -> list[str]:
    logs: list[str] = []

    def due(key: str, cd: float) -> bool:
        return (now - last.get(key, 0.0)) >= cd

    def run(key: str, cd: float, js_name: str, arg: Any, enabled: bool) -> bool:
        if not enabled or not due(key, cd):
            return False
        js = scripts.get(js_name)
        if not js:
            return False
        last[key] = now
        try:
            safe_js = f"""(arg) => Promise.race([
                Promise.resolve().then(() => ({js})(arg)),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout_12s')), 12000))
            ])"""
            res = page.evaluate(safe_js, arg)
        except Exception as exc:
            logs.append(f"[{key.upper()}] erro: {exc}")
            return True
        logs.extend(_tag(key, res))
        return True

    busy = False
    if flags.reduce_vfx:
        run("vfx", 45, "extra", {"job": "vfx"}, True)

    if flags.auto_bags:
        busy = run("bags", 18, "bags", None, True) or busy

    if not busy and flags.auto_equip:
        busy = run("equip", 90, "equip", None, True) or busy

    if not busy and flags.auto_boss and not in_treino:
        busy = run("boss", 90, "boss", None, True) or busy

    if not busy and flags.auto_prey:
        busy = run("prey", 180, "prey", None, True) or busy

    extra_on = flags.auto_extras
    jobs = (
        ("chest", 15, {"job": "chest"}),
        ("codex", 55, {"job": "codex"}),
        ("tree", 180, {"job": "tree"}),
        ("charms", 240, {"job": "charms"}),
        ("bp", 180, {"job": "battlepass"}),
        ("guild", 180, {"job": "guild"}),
        ("merchant", 240, {"job": "merchant"}),
        ("boosts", 180, {"job": "boosts"}),
        ("market", 200, {"job": "market"}),
        ("supply", 300, {"job": "supply"}),
        ("loopcfg", 600, {"job": "loopcfg"}),
        ("manageloot", 600, {"job": "manageloot"}),
        ("forge", 600, {"job": "forge"}),
        ("imbue", 600, {"job": "imbue"}),
        ("modals", 40, {"job": "close_modals"}),
    )
    if not busy:
        for key, cd, arg in jobs:
            if run(key, cd, "extra", arg, extra_on):
                break

    if due("offline", 600):
        last["offline"] = now
    return logs
