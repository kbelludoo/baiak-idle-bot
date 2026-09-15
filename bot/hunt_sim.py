"""Simulador de hunt a partir do motor (spawn, HP, loot) + prior de ouro."""

from __future__ import annotations

import json
import os
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_PATH = os.path.join(HERE, "engine_hunts.json")
STONE_ID = "refiner-cave"
STONE_PRIOR = 2.2
PROFIT_MARGIN = 1.15

_ENGINE: dict[str, Any] | None = None


def load_engine(path: str | None = None) -> dict[str, Any]:
    global _ENGINE
    if _ENGINE is not None and path is None:
        return _ENGINE
    p = path or ENGINE_PATH
    if not os.path.exists(p):
        data: dict[str, Any] = {"hunts": [], "monsters": {}, "priors": {STONE_ID: STONE_PRIOR}}
        if path is None:
            _ENGINE = data
        return data
    with open(p, encoding="utf-8") as f:
        data = json.load(f)
    hunts = {h["id"]: h for h in (data.get("hunts") or []) if isinstance(h, dict) and h.get("id")}
    data["_by_id"] = hunts
    if path is None:
        _ENGINE = data
    return data


def hunt_facts(hid: str) -> dict[str, Any] | None:
    eng = load_engine()
    rec = (eng.get("_by_id") or {}).get(hid)
    return rec if isinstance(rec, dict) else None


def gold_farm_ready(magic: dict[str, Any] | None) -> bool:
    """Stone só com magia; dois bonecos prontos se o HUD mostrou o slot 1."""
    magic = magic or {}
    if magic.get("slot1_present") and not magic.get("party_ready"):
        return False
    if magic.get("party_ready"):
        return True
    return int(magic.get("power") or 0) >= 1


def estimate_dps(level: int, magic: dict[str, Any] | None) -> float:
    magic = magic or {}
    power = int(magic.get("power") or 0)
    aoe = int(magic.get("aoe") or 0)
    n = 2 if magic.get("slot1_present") or magic.get("party_ready") else 1
    return max(8.0, float(max(1, level)) * (5 + 7 * power + 9 * min(aoe, 3)) * n)


def simulate_hunt(
    hid: str,
    level: int,
    magic: dict[str, Any] | None = None,
    scale: float = 1.0,
) -> dict[str, Any] | None:
    facts = hunt_facts(hid)
    if not facts:
        return None
    magic = magic or {}
    hp = float(facts.get("avgHp") or 0)
    if hp <= 0:
        return None
    dps = estimate_dps(level, magic)
    ttk = hp / max(dps, 1.0)
    spawn_s = max(0.2, float(facts.get("spawnMs") or 2200) / 1000.0)
    alive = max(1, int(facts.get("maxAlive") or 1))
    if int(magic.get("aoe") or 0) > 0:
        kills_h = alive / max(ttk + spawn_s, spawn_s) * 3600.0
    else:
        kills_h = min(3600.0 / max(ttk, 0.05), 3600.0 / spawn_s)
    prior = float((load_engine().get("priors") or {}).get(hid) or 1.0)
    if hid == STONE_ID:
        prior = max(prior, STONE_PRIOR)
    gold_kill = float(facts.get("goldKill") or 0) * prior
    gold_h = kills_h * gold_kill * max(0.25, min(4.0, float(scale or 1.0)))
    incoming = float(facts.get("avgDmg") or 0) * alive / max(ttk, 0.25)
    sustain = max(1, level) * (18 if int(magic.get("heal") or 0) else 8)
    if int(magic.get("power") or 0) <= 0:
        can_tank = hp <= max(80, level * 20)
    else:
        can_tank = incoming < sustain * 5 or hp <= max(1, level) * 40
    return {
        "id": hid,
        "name": facts.get("name") or hid,
        "ttk": round(ttk, 3),
        "kills_h": round(kills_h, 1),
        "gold_h": round(gold_h, 1),
        "gold_kill": round(gold_kill, 2),
        "can_tank": bool(can_tank),
        "avg_hp": hp,
        "spawn_ms": facts.get("spawnMs"),
        "max_alive": alive,
    }


def calibrate_scale(
    hid: str,
    observed_gold_h: float,
    level: int,
    magic: dict[str, Any] | None,
) -> float | None:
    sim = simulate_hunt(hid, level, magic, scale=1.0)
    if not sim or sim["gold_h"] <= 0 or observed_gold_h <= 0:
        return None
    return max(0.3, min(3.0, float(observed_gold_h) / float(sim["gold_h"])))


def rank_hunts(
    ids: list[str],
    level: int,
    magic: dict[str, Any] | None,
    scale: float = 1.0,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for hid in ids:
        sim = simulate_hunt(hid, level, magic, scale)
        if sim:
            out.append(sim)
    out.sort(key=lambda s: (s["can_tank"], s["gold_h"]), reverse=True)
    return out


def recommend_switch(
    ids: list[str],
    live_id: str | None,
    level: int,
    magic: dict[str, Any] | None,
    scale: float = 1.0,
    banned: set[str] | None = None,
) -> dict[str, Any] | None:
    """Melhor hunt simulada. None = sem dados do motor (cair nas regras de amostra)."""
    banned = banned or set()
    ranked = [s for s in rank_hunts(ids, level, magic, scale) if s["id"] not in banned]
    if not ranked:
        return None
    ready = gold_farm_ready(magic)
    stone = next((s for s in ranked if s["id"] == STONE_ID and s["can_tank"]), None)
    if ready and stone and STONE_ID in ids:
        best = stone
    else:
        tankable = [s for s in ranked if s["can_tank"]]
        best = tankable[0] if tankable else ranked[0]
        if not ready and best["id"] == STONE_ID:
            alt = next((s for s in tankable if s["id"] != STONE_ID), None)
            if alt:
                best = alt
    live = next((s for s in ranked if s["id"] == live_id), None)
    live_g = float(live["gold_h"]) if live else 0.0
    best_g = float(best["gold_h"])
    clearly = live_id is None or live_id != best["id"]
    if live and live_id != best["id"] and live["can_tank"]:
        clearly = best_g >= live_g * PROFIT_MARGIN and best["can_tank"]
    return {
        "id": best["id"],
        "name": best["name"],
        "gold_h": best_g,
        "live_gold_h": live_g,
        "clearly_better": bool(clearly and best["can_tank"]),
        "can_tank": bool(best["can_tank"]),
        "sim": best,
        "ready": ready,
    }
