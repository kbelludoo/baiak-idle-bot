"""Hunt table + profiler: unlock, survival, lucro vs tempo (não meta de minLevel)."""

from __future__ import annotations

import json
import os
import time
from typing import Any

from hunt_sim import STONE_ID, calibrate_scale, gold_farm_ready, recommend_switch

# id, nome, minLevel — minLevel = UNLOCK (entrar), nunca "melhor hunt"
_HUNTS: tuple[tuple[str, str, int], ...] = (
    ("troll-cave", "Troll Cave", 1),
    ("elf-lair", "Elf", 8),
    ("amazon-camp", "Amazon", 9),
    ("minotaur", "Minotaur", 10),
    ("kongra", "Kongra", 10),
    ("cyclopolis", "Cyclopolis", 15),
    ("corym-cave", "Corym Skirmisher", 30),
    ("refiner-cave", "Stone Refiner", 30),
    ("giant-spider", "Giant Spider", 50),
    ("crawler-cave", "Crawler", 50),
    ("glooth-cave", "Glooth Bandit", 60),
    ("hero-cave", "Hero", 60),
    ("cult-cave", "Cult", 80),
    ("dragon-lair", "Dragon Lair", 80),
    ("werebadge-cave", "Werebadge", 90),
    ("hydra-cave", "Hydra", 100),
    ("behemoth-cave", "Behemoth", 100),
    ("orclops-cave", "Orclops", 100),
    ("grimreaper-cave", "Grim Reaper", 130),
    ("wyrm-cave", "Wyrm", 130),
    ("werehyaena-cave", "Werehyaena", 140),
    ("asura-lair", "Asuras", 150),
    ("darktorturer-cave", "Dark Torturer", 150),
    ("wereliones-cave", "Wereliones", 170),
    ("draken-lair", "Draken", 180),
    ("mitmah-cave", "Mitmah Seer", 180),
    ("cobra-cave", "Cobras", 190),
    ("undeadragon-lair", "Undead Dragon", 200),
    ("cliffstrider-cave", "Cliff Strider", 200),
    ("hideous-fungus", "Hideous Fungus", 200),
    ("magmacrawler-cave", "Magma Crawler", 200),
    ("dreadintruder-cave", "Dread Intruder", 200),
    ("falcon", "Falcon", 210),
    ("vexclaw-lair", "Vexclaw", 210),
    ("grimeleech-cave", "Grimeleech", 220),
    ("choking-cave", "Choking Fear", 240),
    ("crazed-cave", "Crazed Elf's", 240),
    ("guzzlemaw-cave", "Guzzlemaw", 250),
    ("raubritter-lair", "Raubritter", 250),
    ("catacomb-cave", "Catacomb", 250),
    ("prison-cave", "Prison", 250),
    ("lionknight-cave", "Lion Knight", 270),
    ("megadragon-cave", "Mega Dragon", 290),
    ("naga-lair", "Naga Lair", 300),
    ("trueazura-cave", "True Azura", 300),
    ("freakishlostsoul-cave", "Freakish Lost Soul", 300),
    ("bulltaur-cave", "Bulltaur", 350),
    ("gazer-lair", "Gazer", 350),
    ("bashmu-cave", "Bashmu", 350),
    ("inferniarch-lair", "Inferniarch", 450),
    ("girtablilu-cave", "girtablilu warrior", 460),
    ("livrariaice-cave", "Livraria ICE", 500),
    ("livrariafire-cave", "Livraria FIRE", 500),
    ("livrariaearth-cave", "Livraria EARTH", 500),
    ("livraria-cave", "Livraria ENERGY", 500),
    ("quararaider-lair", "Quara Raider", 600),
    ("norcferatu-cave", "Norcferatu Nightweaver", 600),
    ("lavafungos-cave", "Lavafungos", 610),
    ("afflictedstrider-cave", "Afflicted Strider", 610),
    ("varnisheddiremaw-cave", "Varnished Diremaw", 610),
    ("crypt-cave", "Crypt Construct", 700),
    ("gnomprona2-cave", "Crystal Enigma", 800),
    ("rottengolem-cave", "Rotten Golem", 800),
    ("cloakofterror-lair", "Cloak Of Terror", 800),
    ("gnomprona1-cave", "Monster Graveyard", 800),
    ("gnomprona3-cave", "Sparkling Pools", 800),
    ("infernalmdemon-cave", "Infernal Demon", 800),
    ("bonyseadevil-cave", "Bony Sea Devil", 800),
    ("darkthais-cave", "Dark Thais", 800),
)

HUNTS_TABLE = [{"id": i, "name": n, "min": m} for i, n, m in _HUNTS]
HUNTS_BY_ID = {h["id"]: h for h in HUNTS_TABLE}

# Ordem de PROBE no mesmo minLevel (não é score de "melhor hunt").
PREFERRED = {
    1: "troll-cave", 8: "elf-lair", 9: "amazon-camp", 10: "minotaur", 15: "cyclopolis",
    30: "refiner-cave", 50: "giant-spider", 60: "glooth-cave", 80: "dragon-lair",
    90: "werebadge-cave", 100: "hydra-cave", 130: "wyrm-cave", 140: "werehyaena-cave",
    150: "asura-lair", 170: "wereliones-cave", 180: "draken-lair", 190: "cobra-cave",
    200: "undeadragon-lair", 210: "falcon", 220: "grimeleech-cave", 240: "choking-cave",
    250: "guzzlemaw-cave", 270: "lionknight-cave", 290: "megadragon-cave", 300: "naga-lair",
    350: "gazer-lair", 450: "inferniarch-lair", 500: "livraria-cave", 610: "lavafungos-cave",
}

AOE_WORDS = (
    "exori gran", "exori", "exevo mas san", "exevo gran mas vis",
    "exevo gran mas flam", "exevo gran mas tera", "exevo gran mas frigo",
    "exevo gran mas pox", "berserk", "fierce", "caldera", "rage of the skies",
    "eternal winter", "wrath of nature", "hell's core",
)
STRIKE_WORDS = (
    "exori ico", "exori hur", "exori san", "exori vis", "exori flam",
    "exori tera", "exori frigo", "exori mort", "exori con", "brutal strike",
)
HEAL_WORDS = ("exura", "heal", "cura", "cura automática", "light healing", "wound cleansing")
MANA_WORDS = (
    "mana potion", "great mana", "strong mana", "ultimate mana", "mana fluid",
    "poção mp", "pocao mp", "potion de mana", "mp pot",
)

SAMPLE_SEC = 120
STALL_SEC = 60
DEATH_BAN = 600
PROBE_COOLDOWN = 1200
PROFIT_MARGIN = 1.15
SWITCH_GRACE = 45


def match_hunt(wave: str | None) -> dict[str, Any] | None:
    if not wave:
        return None
    low = wave.lower()
    for h in HUNTS_TABLE:
        if h["name"].lower() in low or h["id"].lower() in low:
            return h
    return None


def ids_from_picker_rows(rows: list[dict[str, Any]] | None) -> list[str]:
    """Mapa das linhas do picker (nome visível) para ids oficiais; ignora hunts locked."""
    out: list[str] = []
    for row in rows or []:
        if row.get("locked"):
            continue
        if row.get("goDisabled") and not row.get("current"):
            continue
        hid = (row.get("id") or "").strip()
        if hid and hid in HUNTS_BY_ID:
            out.append(hid)
            continue
        blob = f"{row.get('name') or ''} {row.get('text') or ''}".strip().lower()
        if not blob:
            continue
        hit = None
        for h in HUNTS_TABLE:
            n = h["name"].lower()
            if blob == n or blob.startswith(n + " ") or f" {n} " in f" {blob} ":
                hit = h["id"]
                break
        if not hit:
            for h in HUNTS_TABLE:
                if h["name"].lower() in blob:
                    hit = h["id"]
                    break
        if hit:
            out.append(hit)
    seen: set[str] = set()
    uniq: list[str] = []
    for i in out:
        if i not in seen:
            seen.add(i)
            uniq.append(i)
    return uniq


def infer_level(player_level: int | None, unlocked_ids: list[str] | None) -> int | None:
    floor = None
    if unlocked_ids:
        mins = [HUNTS_BY_ID[i]["min"] for i in unlocked_ids if i in HUNTS_BY_ID]
        floor = max(mins) if mins else None
    if floor is not None:
        if player_level and abs(int(player_level) - floor) <= 80:
            return max(int(player_level), floor)
        return floor
    if player_level and 1 <= int(player_level) <= 100:
        return int(player_level)
    return None


def _blob_has(blob: str, words: tuple[str, ...]) -> int:
    return sum(1 for w in words if w in blob)


def _slot_kit(names_blob: str, helper: dict[str, Any] | None) -> dict[str, Any]:
    helper = helper or {}
    heal_txt = f"{names_blob} {(helper.get('heal') or helper.get('healSpell') or '')}".lower()
    mana_txt = f"{names_blob} {(helper.get('mana') or helper.get('manaPotion') or '')}".lower()
    hp_txt = f"{heal_txt} {(helper.get('hp') or helper.get('hpPotion') or '')}".lower()
    none = ("", "nenhuma", "none", "n/a")
    aoe = _blob_has(names_blob, AOE_WORDS)
    strike = _blob_has(names_blob, STRIKE_WORDS)
    heal = _blob_has(heal_txt, HEAL_WORDS)
    if (helper.get("healEnabled") is not False) and (helper.get("heal") or helper.get("healSpell")) not in none:
        if str(helper.get("heal") or helper.get("healSpell") or "").strip() or helper.get("autoHeal"):
            heal = max(heal, 1)
    mana = _blob_has(mana_txt, MANA_WORDS)
    mana_name = str(helper.get("mana") or helper.get("manaPotion") or "").strip().lower()
    if mana_name and mana_name not in none:
        mana = max(mana, 1)
    if any(x in hp_txt for x in ("health potion", "poção hp", "pocao hp", "hp pot")):
        heal = max(heal, 1)
    attack = aoe > 0 or strike > 0
    return {
        "aoe": aoe, "strike": strike, "heal": heal, "mana": mana,
        "attack": attack, "ready": attack and heal > 0 and mana > 0,
    }


def classify_magic(
    spells: list[dict[str, Any]] | None,
    helpers: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    spells = spells or []
    help_by: dict[int, dict[str, Any]] = {}
    for h in helpers or []:
        if isinstance(h, dict) and h.get("slot") is not None:
            help_by[int(h["slot"])] = h
    names = " ".join(
        (s.get("name") or s.get("title") or "").lower()
        for s in spells if not s.get("empty")
    )
    filled = [s for s in spells if not s.get("empty") and (s.get("name") or s.get("title"))]
    aoe = _blob_has(names, AOE_WORDS)
    strike = _blob_has(names, STRIKE_WORDS)
    heal = _blob_has(names, HEAL_WORDS)
    mana = _blob_has(names, MANA_WORDS)
    if aoe:
        power = 3 if heal else 2
    elif strike or filled:
        power = 1
    else:
        power = 0
    by_slot: dict[int, list[str]] = {}
    present: set[int] = set()
    for s in spells:
        if s.get("slot") is None:
            continue
        sid = int(s["slot"])
        present.add(sid)
        if not s.get("empty"):
            by_slot.setdefault(sid, []).append((s.get("name") or s.get("title") or "").lower())
    for sid, h in help_by.items():
        present.add(int(sid))
    slots: dict[str, Any] = {}
    for sid in sorted(present):
        blob = " ".join(by_slot.get(sid) or [])
        kit = _slot_kit(blob, help_by.get(sid))
        slots[str(sid)] = kit
        heal = max(heal, kit["heal"])
        mana = max(mana, kit["mana"])
    slot1 = 1 in present
    need = [0, 1] if slot1 else ([0] if 0 in present else [])
    if need:
        party_ready = all(slots.get(str(s), {}).get("ready") for s in need)
    else:
        party_ready = power >= 1 and heal > 0 and mana > 0
    if party_ready and power < 2 and aoe:
        power = 3 if heal else 2
    return {
        "power": power, "aoe": aoe, "strike": strike, "heal": heal, "mana": mana,
        "filled": len(filled), "empty": sum(1 for s in spells if s.get("empty")),
        "names": [s.get("name") or s.get("title") or "" for s in filled],
        "slots": slots, "slot1_present": slot1, "party_ready": bool(party_ready),
    }


def effective_level(level: int, magic: dict[str, Any]) -> int:
    """Teto de PROBE por magia — não escolhe hunt; sem AoE não testa hunts duras."""
    power = int(magic.get("power") or 0)
    if power >= 2:
        return level
    if power == 1:
        return min(level, max(50, level - 20))
    return min(level, 15)


def meta_hunt_for(level: int, magic: dict[str, Any] | None = None) -> dict[str, Any]:
    """Faixa desbloqueável mais alta (referência). NÃO é a hunt escolhida."""
    magic = magic or classify_magic([])
    lvl = effective_level(max(1, level), magic)
    eligible = [h for h in HUNTS_TABLE if h["min"] <= lvl]
    if not eligible:
        return HUNTS_TABLE[0]
    top_min = max(h["min"] for h in eligible)
    band = [h for h in eligible if h["min"] == top_min]
    pref = PREFERRED.get(top_min)
    if pref:
        for h in band:
            if h["id"] == pref:
                return h
    return band[0]


def _blank(name: str) -> dict[str, Any]:
    return {
        "name": name, "total_seconds": 0.0, "gold_gained": 0, "kills": 0, "deaths": 0,
        "gold_per_hour": 0.0, "kills_per_hour": 0.0, "last_death_ts": 0, "samples_count": 0,
    }


def _order_key(h: dict[str, Any]) -> tuple[int, int, str]:
    return (h["min"], 0 if PREFERRED.get(h["min"]) == h["id"] else 1, h["name"])


class HuntProfiler:
    def __init__(self, data_dir: str):
        self.file_path = os.path.join(data_dir, "benchmarks.json")
        self.benchmarks: dict[str, Any] = {}
        self.home_id: str | None = None
        self.probe_id: str | None = None
        self.failed_until: dict[str, float] = {}
        self.last_probe_ts = 0.0
        self.switch_grace_until = 0.0
        self.last_played_id: str | None = None
        self.last_played_name: str | None = None
        self.load()
        self.active_hunt_id: str | None = None
        self.active_hunt_name: str | None = None
        self.hunt_start_time: float | None = None
        self.hunt_start_gold: int | None = None
        self.hunt_start_kills: int | None = None
        self.last_gold: int | None = None
        self.last_kills: int | None = None
        self.measure_t0: float | None = None
        self.measure_gold0: int | None = None
        self.measure_kills0: int | None = None
        self._sess_gold_h = 0.0
        self._sess_kills_h = 0.0
        self.unlocked_ids: list[str] = []
        self.last_decision: dict[str, Any] = {}
        self.sim_scale = 1.0

    def load(self) -> None:
        if os.path.exists(self.file_path):
            try:
                with open(self.file_path, encoding="utf-8") as f:
                    self.benchmarks = json.load(f)
            except Exception:
                self.benchmarks = {}
        st = self.benchmarks.pop("_decision", None) or {}
        self.home_id = st.get("home_id")
        self.probe_id = st.get("probe_id")
        self.failed_until = {k: float(v) for k, v in (st.get("failed_until") or {}).items()}
        self.last_probe_ts = float(st.get("last_probe_ts") or 0)
        self.sim_scale = float(st.get("sim_scale") or 1.0)
        lp = str(st.get("last_played_id") or "").strip()
        ln = str(st.get("last_played_name") or "").strip()
        self.last_played_id = lp or None
        self.last_played_name = ln or None

    def save(self) -> None:
        try:
            payload = dict(self.benchmarks)
            payload["_decision"] = {
                "home_id": self.home_id, "probe_id": self.probe_id,
                "failed_until": self.failed_until, "last_probe_ts": self.last_probe_ts,
                "sim_scale": self.sim_scale,
                "last_played_id": self.last_played_id,
                "last_played_name": self.last_played_name,
            }
            with open(self.file_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
        except Exception:
            pass

    def _elapsed(self) -> float:
        return max(0.0, time.time() - self.hunt_start_time) if self.hunt_start_time else 0.0

    def _measure_elapsed(self) -> float:
        t0 = self.measure_t0 or self.hunt_start_time
        return max(0.0, time.time() - t0) if t0 else 0.0

    def _measure_gold_delta(self) -> int:
        if self.last_gold is None or self.measure_gold0 is None:
            return 0
        return max(0, int(self.last_gold) - int(self.measure_gold0))

    def _measure_kill_delta(self) -> int:
        if self.last_kills is None or self.measure_kills0 is None:
            return 0
        return max(0, int(self.last_kills) - int(self.measure_kills0))

    def _numbers_moved(self) -> bool:
        if self.last_gold is None and self.last_kills is None:
            return True
        return self._measure_gold_delta() > 0 or self._measure_kill_delta() > 0

    def _visit_ready(self) -> bool:
        return self._measure_elapsed() >= SAMPLE_SEC and self._numbers_moved()

    def _roll_sample(self) -> None:
        self.measure_t0 = time.time()
        self.measure_gold0 = self.last_gold
        self.measure_kills0 = self.last_kills

    def _commit_session(self, cur_gold: int | None, cur_kills: int | None, died: bool) -> None:
        if not self.active_hunt_id or not self.hunt_start_time:
            return
        b = self.benchmarks.get(self.active_hunt_id)
        if not b:
            return
        now = time.time()
        dur = max(0.0, now - self.hunt_start_time)
        if dur >= 5:
            b["total_seconds"] = float(b.get("total_seconds") or 0) + dur
            if cur_gold is not None and self.hunt_start_gold is not None:
                b["gold_gained"] = int(b.get("gold_gained") or 0) + max(0, cur_gold - self.hunt_start_gold)
            if cur_kills is not None and self.hunt_start_kills is not None:
                b["kills"] = int(b.get("kills") or 0) + max(0, cur_kills - self.hunt_start_kills)
            if dur >= 30:
                b["samples_count"] = int(b.get("samples_count") or 0) + 1
            sec = float(b["total_seconds"])
            if sec >= 30:
                b["gold_per_hour"] = round((int(b.get("gold_gained") or 0) / sec) * 3600, 1)
                b["kills_per_hour"] = round((int(b.get("kills") or 0) / sec) * 3600, 1)
        if died:
            b["deaths"] = int(b.get("deaths") or 0) + 1
            b["last_death_ts"] = now
        self.save()

    def start_session(self, hunt_id: str, hunt_name: str, cur_gold: int | None, cur_kills: int | None) -> None:
        if self.active_hunt_id and self.active_hunt_id != hunt_id:
            self._commit_session(cur_gold, cur_kills, died=False)
        self.active_hunt_id = hunt_id
        self.active_hunt_name = hunt_name
        self.hunt_start_time = time.time()
        self.hunt_start_gold = cur_gold
        self.hunt_start_kills = cur_kills
        self.last_gold = cur_gold
        self.last_kills = cur_kills
        self.measure_t0 = self.hunt_start_time
        self.measure_gold0 = cur_gold
        self.measure_kills0 = cur_kills
        self._sess_gold_h = 0.0
        self._sess_kills_h = 0.0
        if hunt_id not in self.benchmarks:
            self.benchmarks[hunt_id] = _blank(hunt_name)
        else:
            self.benchmarks[hunt_id]["name"] = hunt_name
        self.remember_played(hunt_id, hunt_name)

    def remember_played(self, hunt_id: str | None, hunt_name: str | None) -> None:
        hid = str(hunt_id or "").strip()
        name = str(hunt_name or "").strip()
        if hid in ("", "current_hunt", "—", "-", "–"):
            hid = ""
        low = name.lower()
        if low in ("", "—", "-", "–", "cidade", "city", "conectando"):
            if not hid:
                return
            name = ""
        changed = False
        if hid and hid != self.last_played_id:
            self.last_played_id = hid
            changed = True
        if name and name != self.last_played_name:
            self.last_played_name = name
            changed = True
        if changed:
            self.save()

    def resume_target(self, force_id: str = "") -> dict[str, Any]:
        fid = str(force_id or "").strip()
        if fid:
            known = HUNTS_BY_ID.get(fid) or {}
            return {"id": fid, "name": str(known.get("name") or fid), "resumeLast": False}
        return {
            "id": self.last_played_id or "",
            "name": self.last_played_name or "",
            "resumeLast": True,
        }

    def should_resume_last(
        self,
        auto_hunt: bool,
        is_city: bool,
        current_id: str | None,
        force_id: str = "",
    ) -> tuple[bool, str]:
        """Fica na hunt atual; só teleporta para a última (ou FORCE_HUNT). Sem ranking."""
        fid = str(force_id or "").strip()
        if not auto_hunt:
            self.last_decision = {"mode": "off", "reason": "AUTO_HUNT off", "home": self.last_played_id}
            return False, ""
        if fid:
            if current_id == fid and not is_city:
                why = f"FORCE_HUNT já em {fid}"
                self.last_decision = {"mode": "stay", "reason": why, "home": fid}
                return False, why
            why = f"FORCE_HUNT={fid}"
            self.last_decision = {"mode": "force", "reason": why, "home": fid}
            return True, why
        if not is_city and current_id:
            label = self.last_played_name or current_id
            why = f"ficar na última hunt ({label})"
            self.last_decision = {"mode": "stay", "reason": why, "home": self.last_played_id}
            return False, why
        label = self.last_played_name or self.last_played_id or "pick-current do jogo"
        why = f"cidade/templo → última hunt: {label}"
        self.last_decision = {"mode": "resume", "reason": why, "home": self.last_played_id}
        return True, why

    def mark_switch(self) -> None:
        self.switch_grace_until = time.time() + SWITCH_GRACE

    def record_death(self, cur_gold: int | None, cur_kills: int | None) -> None:
        if not self.active_hunt_id:
            return
        died = time.time() >= self.switch_grace_until
        self._commit_session(cur_gold, cur_kills, died=died)
        self.active_hunt_id = None
        self.hunt_start_time = None
        self.measure_t0 = None
        self._sess_gold_h = 0.0
        self._sess_kills_h = 0.0

    def update_tick(self, cur_gold: int | None, cur_kills: int | None) -> None:
        if not self.active_hunt_id or not self.hunt_start_time:
            return
        if cur_gold is not None:
            self.last_gold = cur_gold
        if cur_kills is not None:
            self.last_kills = cur_kills
        elapsed = time.time() - self.hunt_start_time
        g_delta = max(0, cur_gold - self.hunt_start_gold) if cur_gold is not None and self.hunt_start_gold is not None else 0
        k_delta = max(0, cur_kills - self.hunt_start_kills) if cur_kills is not None and self.hunt_start_kills is not None else 0
        if elapsed > 0:
            self._sess_gold_h = (g_delta / elapsed) * 3600
            self._sess_kills_h = (k_delta / elapsed) * 3600
        if elapsed < 30:
            return
        b = self.benchmarks.get(self.active_hunt_id)
        if not b:
            return
        eff_sec = float(b.get("total_seconds") or 0) + elapsed
        b["gold_per_hour"] = round(((int(b.get("gold_gained") or 0) + g_delta) / eff_sec) * 3600, 1) if eff_sec else 0
        b["kills_per_hour"] = round(((int(b.get("kills") or 0) + k_delta) / eff_sec) * 3600, 1) if eff_sec else 0
        self.save()

    def clear_death_penalties(self) -> None:
        for k, b in self.benchmarks.items():
            if k.startswith("_") or not isinstance(b, dict):
                continue
            b["last_death_ts"] = 0
            b["deaths"] = 0
        self.failed_until = {}
        self.save()

    def _banned(self, hid: str, now: float) -> bool:
        b = self.benchmarks.get(hid) or {}
        ts = float(b.get("last_death_ts") or 0)
        if ts and now - ts < DEATH_BAN:
            return True
        if int(b.get("deaths") or 0) >= 2 and ts and now - ts < 1800:
            return True
        return False

    def _stalling(self) -> bool:
        if self._measure_elapsed() < STALL_SEC:
            return False
        return self._measure_kill_delta() <= 0

    def _profit(self, hid: str, live: bool = False) -> float:
        if live and hid == self.active_hunt_id and self._measure_elapsed() >= 30:
            return self._sess_gold_h + self._sess_kills_h * 8
        b = self.benchmarks.get(hid) or {}
        return float(b.get("gold_per_hour") or 0) + float(b.get("kills_per_hour") or 0) * 8

    def _sampled(self, hid: str) -> bool:
        sec = float((self.benchmarks.get(hid) or {}).get("total_seconds") or 0)
        if hid == self.active_hunt_id:
            sec += self._elapsed()
        return sec >= SAMPLE_SEC

    def _justifies(self, cand: str, home: str) -> bool:
        cp, hp = self._profit(cand, live=True), self._profit(home, live=False)
        if hp <= 0:
            return cp > 0
        return cp >= hp * PROFIT_MARGIN

    def _next_probe(self, ordered: list[dict[str, Any]], home: dict[str, Any], cap: int, now: float) -> dict[str, Any] | None:
        idx = next((i for i, h in enumerate(ordered) if h["id"] == home["id"]), -1)
        for h in ordered[idx + 1:]:
            if h["min"] > cap or self._banned(h["id"], now):
                continue
            if now < float(self.failed_until.get(h["id"]) or 0):
                continue
            return h
        return None

    def _drop_easier(self, ordered: list[dict[str, Any]], live: dict[str, Any], now: float) -> dict[str, Any]:
        easier = [h for h in ordered if h["min"] < live["min"] and not self._banned(h["id"], now)]
        return easier[-1] if easier else next((h for h in ordered if not self._banned(h["id"], now)), ordered[0])

    def get_best_hunt_to_farm(
        self,
        player_level: int | None,
        magic: dict[str, Any] | None = None,
        unlocked_ids: list[str] | None = None,
    ) -> dict[str, Any] | None:
        magic = magic or classify_magic([])
        if unlocked_ids:
            self.unlocked_ids = unlocked_ids
        level = infer_level(player_level, self.unlocked_ids)
        if not level:
            self.last_decision = {"reason": "nível desconhecido — scan", "mode": "scan"}
            self.save()
            return None
        enterable = [h for h in HUNTS_TABLE if h["min"] <= level]
        if self.unlocked_ids:
            unlocked = [h for h in enterable if h["id"] in self.unlocked_ids]
            if unlocked:
                enterable = unlocked
        if not enterable:
            enterable = [HUNTS_TABLE[0]]
        ordered = sorted(enterable, key=_order_key)
        cap = effective_level(level, magic)
        now = time.time()
        live = next((h for h in ordered if h["id"] == self.active_hunt_id), None)
        pick, reason, mode, urgent = self._decide(ordered, live, cap, now, level, magic)
        if mode == "probe" and pick:
            self.probe_id = pick["id"]
        elif mode == "revert":
            if live:
                self.failed_until[live["id"]] = now + PROBE_COOLDOWN
            self.probe_id = None
            self.last_probe_ts = now
        elif mode in ("farm", "fallback", "sim") and pick:
            if mode in ("farm", "sim"):
                self.home_id = pick["id"]
            self.probe_id = None
            if live and pick["id"] == live["id"] and self._visit_ready():
                scaled = calibrate_scale(live["id"], self._sess_gold_h, level, magic)
                if scaled:
                    self.sim_scale = scaled
                self._roll_sample()
        self.last_decision = {
            "level": level, "probe_cap": cap, "reason": reason, "mode": mode,
            "urgent": urgent, "best": pick, "home": self.home_id, "probe": self.probe_id,
            "magic": {k: magic[k] for k in ("power", "aoe", "strike", "heal", "mana", "filled", "party_ready") if k in magic},
            "sim_scale": self.sim_scale,
            "top3": [{"id": h["id"], "name": h["name"], "profit": round(self._profit(h["id"]), 1)} for h in ordered[:3]],
        }
        self.save()
        return pick

    def _hunt(self, ordered: list[dict[str, Any]], hid: str | None) -> dict[str, Any] | None:
        return next((h for h in ordered if h["id"] == hid), None)

    def _decide(
        self, ordered: list[dict[str, Any]], live: dict[str, Any] | None,
        cap: int, now: float, level: int = 1, magic: dict[str, Any] | None = None,
    ) -> tuple[dict[str, Any], str, str, bool]:
        magic = magic or classify_magic([])
        if live and (self._banned(live["id"], now) or self._stalling()):
            drop = self._drop_easier(ordered, live, now)
            why = "sobreviveu mal (morte/stall) — cair para hunt mais fácil"
            return drop, why, "revert", True
        if self.home_id and live and live["id"] != self.home_id and self._visit_ready():
            home = self._hunt(ordered, self.home_id)
            if home and not self._banned(home["id"], now):
                if not self._justifies(live["id"], home["id"]):
                    g_l, g_h = round(self._profit(live["id"], True), 1), round(self._profit(home["id"]), 1)
                    return home, f"probe falhou: lucro {g_l} não supera {home['name']} {g_h} — reverter", "revert", False
                self.home_id = live["id"]
                return live, "probe ok: gold/h justifica o tempo; ficar e medir", "farm", False
        ids = [h["id"] for h in ordered if h["min"] <= cap]
        banned = {h["id"] for h in ordered if self._banned(h["id"], now)}
        rec = recommend_switch(ids, live["id"] if live else None, level, magic, self.sim_scale, banned)
        sim_h = self._hunt(ordered, rec["id"]) if rec else None
        ready = gold_farm_ready(magic)
        if rec and sim_h and rec.get("can_tank") and ready:
            if live and live["id"] != sim_h["id"] and self._visit_ready():
                live_p = self._profit(live["id"], True)
                sampled_p = self._profit(sim_h["id"])
                bar = sampled_p if self._sampled(sim_h["id"]) and sampled_p > 0 else max(
                    sampled_p, float(rec.get("gold_h") or 0)
                )
                if bar > 0 and live_p >= bar * PROFIT_MARGIN:
                    self.home_id = live["id"]
                    return live, "amostra 15% melhor que a sim — ficar e medir", "farm", False
            if live and live["id"] == sim_h["id"]:
                if not self._visit_ready():
                    el = int(self._measure_elapsed())
                    g, k = self._measure_gold_delta(), self._measure_kill_delta()
                    return live, f"sim ok; calibrar amostra ({el}s/{SAMPLE_SEC}s, +{g}g/{k}k)", "sample", False
                return live, f"sim+amostra: {sim_h['name']} é o gold farm", "farm", False
            if rec.get("clearly_better") and gold_farm_ready(magic):
                g_s = round(float(rec.get("gold_h") or 0), 0)
                return sim_h, f"sim motor: {sim_h['name']} ~{g_s}g/h (amostra só calibra)", "sim", True
            if not live and gold_farm_ready(magic):
                return sim_h, f"sim motor: ir para {sim_h['name']} (gold/h)", "sim", False
        if live and not self._visit_ready():
            el = int(self._measure_elapsed())
            g, k = self._measure_gold_delta(), self._measure_kill_delta()
            why = f"amostra até números ({el}s/{SAMPLE_SEC}s, +{g}g/{k}k)"
            return live, why, "sample", False
        sampled = [h for h in ordered if self._sampled(h["id"]) and not self._banned(h["id"], now)]
        pool = [h for h in sampled if not live or h["id"] != live["id"]]
        home = max(pool, key=lambda h: self._profit(h["id"])) if pool else None
        if self.home_id:
            hid = next((h for h in ordered if h["id"] == self.home_id and not self._banned(h["id"], now)), None)
            if hid and (home is None or self._profit(hid["id"]) >= self._profit(home["id"]) * 0.9):
                home = hid
        if home:
            self.home_id = home["id"]
        if home and live and live["id"] != home["id"] and live["min"] >= home["min"]:
            if not self._justifies(live["id"], home["id"]):
                g_l, g_h = round(self._profit(live["id"], True), 1), round(self._profit(home["id"]), 1)
                return home, f"probe falhou: lucro {g_l} não supera {home['name']} {g_h} — reverter", "revert", False
            self.home_id = live["id"]
            return live, "probe ok: gold/h justifica o tempo; ficar e medir", "farm", False
        farm = home or (sim_h if ready else None) or live or ordered[0]
        if gold_farm_ready(magic) and self._hunt(ordered, STONE_ID) and STONE_ID in ids:
            stone = self._hunt(ordered, STONE_ID)
            if stone and not self._banned(STONE_ID, now):
                farm = stone
                if not live or live["id"] != STONE_ID:
                    return stone, "gold farm: Stone Refiner (magia pronta)", "sim", True
        nxt = self._next_probe(ordered, farm, cap, now)
        if nxt and live and live["id"] == farm["id"] and nxt["id"] != STONE_ID:
            if not (gold_farm_ready(magic) and farm["id"] == STONE_ID):
                return nxt, f"probe {nxt['name']}: testar lucro vs tempo em {farm['name']}", "probe", False
        tag = "lucro medido + sobrevive" if home else "sem amostra — começar fácil e medir"
        if home and live and live["id"] == home["id"]:
            tag = "probe ok: gold/h justifica o tempo; ficar e medir"
        return farm, f"ficar em {farm['name']} ({tag})", "farm" if home else "fallback", False

    def should_enter(
        self,
        current_id: str | None,
        best: dict[str, Any] | None,
        is_city: bool,
        now: float,
        last_switch: float,
    ) -> tuple[bool, str]:
        reason = str((self.last_decision or {}).get("reason") or "")
        mode = str((self.last_decision or {}).get("mode") or "")
        if not best:
            if current_id and not is_city:
                return False, ""
            return True, reason or "nível desconhecido — abrir lista de hunts para analisar"
        if is_city:
            return True, reason or f"cidade/templo → {best['name']} (sobrevive+lucro)"
        if not current_id or current_id == best["id"]:
            return False, ""
        if mode == "sample":
            return False, ""
        if mode == "sim":
            return True, reason or f"sim → {best['name']}"
        urgent = bool((self.last_decision or {}).get("urgent"))
        if not urgent and now - last_switch < 90:
            return False, ""
        return True, reason or f"trocar para {best['name']} (sobrevive+lucro, não meta)"


class HuntMatrix:
    """
    Matriz de Aprendizado Empírico de Hunts.
    Consolida histórico de telemetria, rendimento de XP/h, Gold/h, kills e segurança de cada hunt.
    Gera classificações de eficiência ('TOP_LUCRO', 'TOP_XP', 'EQUILIBRADO', 'PERIGOSO').
    """
    def __init__(self, data_dir: str):
        self.file_path = os.path.join(data_dir, "hunt_matrix.json")
        self.matrix: dict[str, dict[str, Any]] = {}
        self.load()

    def load(self) -> None:
        if os.path.exists(self.file_path):
            try:
                with open(self.file_path, encoding="utf-8") as f:
                    self.matrix = json.load(f)
            except Exception:
                self.matrix = {}

    def save(self) -> None:
        try:
            with open(self.file_path, "w", encoding="utf-8") as f:
                json.dump(self.matrix, f, indent=2)
        except Exception:
            pass

    def record_tick(
        self,
        hunt_id: str,
        hunt_name: str,
        level: int | None,
        gold_per_hour: float,
        kills_per_hour: float,
        waves_per_hour: float,
        deaths: int,
        xp_per_hour: float | str | None = None,
        loot_per_hour: float | str | None = None,
    ) -> dict[str, Any]:
        if not hunt_id:
            return {}

        match = match_hunt(hunt_name)
        min_lvl = match.get("min_lvl", 1) if match else 1

        rec = self.matrix.setdefault(hunt_id, {
            "id": hunt_id,
            "name": hunt_name,
            "min_level": min_lvl,
            "samples": 0,
            "deaths": 0,
            "avg_gold_h": 0.0,
            "max_gold_h": 0.0,
            "avg_kills_h": 0.0,
            "avg_waves_h": 0.0,
            "xp_h_display": "—",
            "loot_h_display": "—",
            "safety_rating": "SEGURO",
            "category": "EQUILIBRADO",
            "efficiency_score": 50,
            "last_seen_ts": time.time(),
        })

        rec["samples"] += 1
        rec["deaths"] = max(rec.get("deaths", 0), deaths)
        rec["last_seen_ts"] = time.time()

        if gold_per_hour > 0:
            rec["avg_gold_h"] = round((rec.get("avg_gold_h", 0.0) * 0.7) + (gold_per_hour * 0.3), 1)
            rec["max_gold_h"] = max(rec.get("max_gold_h", 0.0), round(gold_per_hour, 1))

        if kills_per_hour > 0:
            rec["avg_kills_h"] = round((rec.get("avg_kills_h", 0.0) * 0.7) + (kills_per_hour * 0.3), 1)

        if waves_per_hour > 0:
            rec["avg_waves_h"] = round((rec.get("avg_waves_h", 0.0) * 0.7) + (waves_per_hour * 0.3), 1)

        if xp_per_hour and str(xp_per_hour) != "—":
            rec["xp_h_display"] = str(xp_per_hour)

        if loot_per_hour and str(loot_per_hour) != "—":
            rec["loot_h_display"] = str(loot_per_hour)

        # Avalia Segurança
        if rec["deaths"] == 0:
            rec["safety_rating"] = "SEGURO"
        elif rec["deaths"] <= 2:
            rec["safety_rating"] = "MODERADO"
        else:
            rec["safety_rating"] = "PERIGOSO"

        # Avalia Categoria & Score
        if rec["deaths"] > 2:
            rec["category"] = "EVITAR (ALTA MORTALIDADE)"
            rec["efficiency_score"] = 20
        elif rec["avg_gold_h"] >= 100000:
            rec["category"] = "TOP_LUCRO (OURO ALTO)"
            rec["efficiency_score"] = 95
        elif rec["avg_kills_h"] >= 1000:
            rec["category"] = "TOP_XP (FAST CLEAR)"
            rec["efficiency_score"] = 90
        elif rec["avg_gold_h"] >= 10000:
            rec["category"] = "FARM ESTÁVEL"
            rec["efficiency_score"] = 80
        else:
            rec["category"] = "EQUILIBRADO"
            rec["efficiency_score"] = 65

        self.save()
        return rec

    def get_rankings(self) -> dict[str, list[dict[str, Any]]]:
        valid = list(self.matrix.values())
        by_profit = sorted(valid, key=lambda x: x.get("avg_gold_h", 0.0), reverse=True)
        by_kills = sorted(valid, key=lambda x: x.get("avg_kills_h", 0.0), reverse=True)
        return {
            "by_profit": by_profit[:5],
            "by_kills": by_kills[:5],
            "all": valid
        }
