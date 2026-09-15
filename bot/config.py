"""Flags lidas do ambiente / .env. Nunca loga tokens."""

from __future__ import annotations

import os
from dataclasses import dataclass

from chrome import env_flag

HERE = os.path.dirname(os.path.abspath(__file__))


def load_dotenv(path: str | None = None) -> None:
    env_path = path or os.path.join(HERE, ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            if key and key not in os.environ:
                os.environ[key] = val.strip()


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not str(raw).strip():
        return default
    try:
        return int(str(raw).strip())
    except ValueError:
        return default


def env_str(name: str, default: str = "") -> str:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip()


@dataclass(frozen=True)
class Flags:
    auto_hunt: bool
    hunt_id: str
    force_hunt: bool
    auto_treino: bool
    auto_sell: bool
    sell_threshold_pct: int
    auto_boss: bool
    reduce_vfx: bool
    headless: bool
    screenshot: bool
    auto_bags: bool
    auto_equip: bool
    auto_prey: bool
    auto_extras: bool
    auto_heal: bool
    heal_below_pct: int
    hp_potion_below_pct: int
    mana_potion_below_pct: int
    live_stream: bool
    stream_fps: int
    stream_width: int
    stream_height: int
    stream_quality: int


def read_flags() -> Flags:
    shot = env_int("SCREENSHOT_INTERVAL", 0)
    pct = env_int("SELL_THRESHOLD_PCT", 70)
    pct = max(10, min(100, pct))
    heal_pct = env_int("HEAL_BELOW_PCT", 75)
    hp_pct = env_int("HP_POTION_BELOW_PCT", 60)
    mana_pct = env_int("MANA_POTION_BELOW_PCT", 65)
    fps = max(4, min(24, env_int("STREAM_FPS", 12)))
    sw = max(320, min(1280, env_int("STREAM_WIDTH", 854)))
    sh = max(240, min(720, env_int("STREAM_HEIGHT", 480)))
    sq = max(40, min(85, env_int("STREAM_QUALITY", 70)))
    return Flags(
        auto_hunt=env_flag("AUTO_HUNT", True),
        hunt_id=env_str("HUNT_ID"),
        force_hunt=env_flag("FORCE_HUNT", False),
        auto_treino=env_flag("AUTO_TREINO", True),
        auto_sell=env_flag("AUTO_SELL", True),
        sell_threshold_pct=pct,
        auto_boss=env_flag("AUTO_BOSS", True),
        reduce_vfx=env_flag("REDUCE_VFX", True),
        headless=env_flag("HEADLESS", True),
        screenshot=shot > 0,
        auto_bags=env_flag("AUTO_BAGS", True),
        auto_equip=env_flag("AUTO_EQUIP", True),
        auto_prey=env_flag("AUTO_PREY", True),
        auto_extras=env_flag("AUTO_EXTRAS", True),
        auto_heal=env_flag("AUTO_HEAL", True),
        heal_below_pct=max(10, min(95, heal_pct)),
        hp_potion_below_pct=max(10, min(95, hp_pct)),
        mana_potion_below_pct=max(10, min(95, mana_pct)),
        live_stream=env_flag("LIVE_STREAM", True),
        stream_fps=fps,
        stream_width=sw,
        stream_height=sh,
        stream_quality=sq,
    )


def describe_flags(flags: Flags) -> str:
    bits = [
        f"hunt={'ON' if flags.auto_hunt else 'OFF'}",
        f"treino={'ON' if flags.auto_treino else 'OFF'}",
        f"sell={'ON' if flags.auto_sell else 'OFF'}@{flags.sell_threshold_pct}%",
        f"boss={'ON' if flags.auto_boss else 'OFF'}",
        f"heal={'ON' if flags.auto_heal else 'OFF'}@{flags.heal_below_pct}%",
        f"pot_hp={flags.hp_potion_below_pct}%",
        f"pot_mp={flags.mana_potion_below_pct}%",
        f"vfx={'low' if flags.reduce_vfx else 'full'}",
        f"headless={'ON' if flags.headless else 'OFF'}",
        f"screenshot={'ON' if flags.screenshot else 'OFF'}",
        (
            f"stream={flags.stream_width}x{flags.stream_height}@{flags.stream_fps}q{flags.stream_quality}"
            if flags.live_stream
            else "stream=OFF"
        ),
    ]
    if flags.force_hunt and flags.hunt_id:
        bits.append(f"force_hunt={flags.hunt_id}")
    elif flags.hunt_id:
        bits.append("hunt_id=ignorado (última hunt)")
    return " | ".join(bits)
