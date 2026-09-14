from hunts import (
    HuntProfiler,
    PROBE_COOLDOWN,
    SAMPLE_SEC,
    STALL_SEC,
    classify_magic,
    effective_level,
    ids_from_picker_rows,
    infer_level,
    match_hunt,
    meta_hunt_for,
)

AOE = classify_magic([{"empty": False, "name": "exori"}])
EMPTY = classify_magic([])
BOTH = classify_magic([
    {"slot": 0, "empty": False, "name": "exori"},
    {"slot": 0, "empty": False, "name": "exura"},
    {"slot": 0, "empty": False, "name": "mana potion"},
    {"slot": 1, "empty": False, "name": "exori"},
    {"slot": 1, "empty": False, "name": "exura"},
    {"slot": 1, "empty": False, "name": "great mana potion"},
])
ONLY_LEAD = classify_magic([
    {"slot": 0, "empty": False, "name": "exori"},
    {"slot": 0, "empty": False, "name": "exura"},
    {"slot": 0, "empty": False, "name": "mana potion"},
    {"slot": 1, "empty": True, "name": ""},
])
UNLOCK_30 = [
    "troll-cave", "elf-lair", "amazon-camp", "minotaur", "cyclopolis",
    "corym-cave", "refiner-cave",
]
UNLOCK_50 = UNLOCK_30 + ["giant-spider"]


def _seed(p, hid, name, gold_h, kills_h=100, deaths=0, last_death=0, sec=None):
    p.benchmarks[hid] = {
        "name": name, "total_seconds": float(SAMPLE_SEC if sec is None else sec),
        "gold_gained": int(gold_h * (SAMPLE_SEC / 3600)),
        "kills": int(kills_h * (SAMPLE_SEC / 3600)),
        "deaths": deaths, "gold_per_hour": gold_h, "kills_per_hour": kills_h,
        "last_death_ts": last_death, "samples_count": 2,
    }


def _live(p, hid, name, elapsed, gold, kills):
    p.start_session(hid, name, 0, 0)
    p.hunt_start_time = p.hunt_start_time - elapsed  # type: ignore[operator]
    if p.measure_t0:
        p.measure_t0 = p.measure_t0 - elapsed
    p.update_tick(gold, kills)


def test_infer_level_does_not_default_to_one():
    assert infer_level(None, None) is None
    assert infer_level(None, []) is None
    assert infer_level(42, ["troll-cave"]) == 42
    assert infer_level(None, ["troll-cave", "elf-lair", "minotaur"]) == 10


def test_meta_uses_level_and_magic():
    assert meta_hunt_for(1, AOE)["id"] == "troll-cave"
    assert meta_hunt_for(10, AOE)["id"] == "minotaur"
    assert meta_hunt_for(15, AOE)["id"] == "cyclopolis"
    assert effective_level(80, EMPTY) == 15
    assert meta_hunt_for(80, EMPTY)["id"] == "cyclopolis"
    assert meta_hunt_for(80, AOE)["id"] == "dragon-lair"


def test_picker_rows_map_names_and_skip_locked():
    rows = [
        {"name": "Troll Cave", "locked": False},
        {"name": "Elf", "locked": False},
        {"name": "Giant Spider", "locked": True},
        {"text": "Minotaur Cyclops something", "locked": False},
        {"id": "kongra", "goDisabled": True},
    ]
    ids = ids_from_picker_rows(rows)
    assert "troll-cave" in ids
    assert "elf-lair" in ids
    assert "giant-spider" not in ids
    assert "minotaur" in ids
    assert "kongra" not in ids


def test_unknown_level_does_not_pick_troll(tmp_path):
    p = HuntProfiler(str(tmp_path))
    assert p.get_best_hunt_to_farm(None, AOE, None) is None
    assert p.last_decision.get("mode") == "scan"


def test_unsampled_does_not_follow_minlevel_meta(tmp_path):
    p = HuntProfiler(str(tmp_path))
    best = p.get_best_hunt_to_farm(50, AOE, UNLOCK_50)
    assert best["id"] == "refiner-cave"
    assert best["id"] not in ("troll-cave", "elf-lair", "giant-spider")
    reason = (p.last_decision.get("reason") or "").lower()
    assert "meta" not in reason
    go, why = p.should_enter(None, best, True, 1e12, 0)
    assert go is True
    assert "meta" not in why.lower()


def test_match_hunt_and_probe_climbs_after_sample(tmp_path):
    assert match_hunt("Troll Cave")["id"] == "troll-cave"
    p = HuntProfiler(str(tmp_path))
    _live(p, "troll-cave", "Troll Cave", SAMPLE_SEC + 10, 400, 30)
    best = p.get_best_hunt_to_farm(50, AOE, UNLOCK_50)
    assert best["id"] == "refiner-cave"
    assert best["id"] not in ("elf-lair", "giant-spider", "troll-cave")
    go, reason = p.should_enter("troll-cave", best, False, 1e12, 0)
    assert go is True
    assert "meta" not in reason.lower()


def test_unlocked_caps_fake_high_level(tmp_path):
    p = HuntProfiler(str(tmp_path))
    best = p.get_best_hunt_to_farm(1113, AOE, ["troll-cave", "elf-lair", "minotaur"])
    assert best["min"] <= 10
    assert best["id"] in ("troll-cave", "elf-lair", "minotaur")


def test_measured_profit_beats_higher_minlevel(tmp_path):
    p = HuntProfiler(str(tmp_path))
    _seed(p, "troll-cave", "Troll Cave", 20000, 400)
    _seed(p, "corym-cave", "Corym Skirmisher", 3000, 40)
    best = p.get_best_hunt_to_farm(30, AOE, UNLOCK_30)
    assert best["id"] != "corym-cave"
    assert best["id"] != "giant-spider"
    assert best["id"] == "refiner-cave" or p.last_decision.get("home") == "troll-cave"


def test_recent_death_drops_to_easier(tmp_path):
    import time
    p = HuntProfiler(str(tmp_path))
    _seed(p, "corym-cave", "Corym Skirmisher", 50000, 200, deaths=1, last_death=time.time())
    _seed(p, "cyclopolis", "Cyclopolis", 8000, 120)
    best = p.get_best_hunt_to_farm(30, AOE, UNLOCK_30)
    assert best["id"] != "corym-cave"


def test_probe_reverts_when_gold_h_not_better(tmp_path):
    p = HuntProfiler(str(tmp_path))
    _seed(p, "troll-cave", "Troll Cave", 18000, 300)
    p.home_id = "troll-cave"
    _live(p, "elf-lair", "Elf", SAMPLE_SEC + 15, 50, 4)
    best = p.get_best_hunt_to_farm(20, AOE, UNLOCK_30)
    assert best["id"] == "troll-cave"
    assert p.last_decision["mode"] == "revert"
    go, why = p.should_enter("elf-lair", best, False, 1e12, 0)
    assert go is True
    assert "meta" not in why.lower()


def test_probe_keeps_harder_if_profit_justifies(tmp_path):
    p = HuntProfiler(str(tmp_path))
    _seed(p, "troll-cave", "Troll Cave", 2000, 40)
    p.home_id = "troll-cave"
    _live(p, "elf-lair", "Elf", SAMPLE_SEC + 15, 900, 80)
    best = p.get_best_hunt_to_farm(20, AOE, UNLOCK_30)
    assert best["id"] == "elf-lair"


def test_stall_reverts_urgent(tmp_path):
    p = HuntProfiler(str(tmp_path))
    _seed(p, "troll-cave", "Troll Cave", 10000, 200)
    p.home_id = "troll-cave"
    _live(p, "corym-cave", "Corym Skirmisher", 70, 0, 0)
    best = p.get_best_hunt_to_farm(30, AOE, UNLOCK_30)
    assert best["id"] != "corym-cave"
    assert p.last_decision.get("urgent") is True
    go, why = p.should_enter("corym-cave", best, False, 1e12, 1e12)
    assert go is True
    assert "sobreviveu" in why.lower() or "fácil" in why.lower()


def test_empty_magic_does_not_probe_hard(tmp_path):
    p = HuntProfiler(str(tmp_path))
    _seed(p, "troll-cave", "Troll Cave", 5000, 80)
    _live(p, "troll-cave", "Troll Cave", SAMPLE_SEC + 10, 200, 20)
    best = p.get_best_hunt_to_farm(80, EMPTY, UNLOCK_50)
    assert best["min"] <= 15
    assert best["id"] != "refiner-cave"


def test_party_two_slots_need_attack_heal_mana(tmp_path=None):
    assert BOTH["party_ready"] is True
    assert BOTH["slots"]["0"]["ready"] is True
    assert BOTH["slots"]["1"]["ready"] is True
    assert BOTH["heal"] >= 1
    assert BOTH["mana"] >= 1
    assert ONLY_LEAD["slot1_present"] is True
    assert ONLY_LEAD["party_ready"] is False
    assert ONLY_LEAD["slots"]["0"]["ready"] is True
    assert not ONLY_LEAD["slots"]["1"]["ready"]


def test_party_ready_from_helper_not_rotation(tmp_path=None):
    mag = classify_magic(
        [
            {"slot": 0, "empty": False, "name": "exori"},
            {"slot": 1, "empty": False, "name": "exori gran"},
        ],
        [
            {"slot": 0, "heal": "Cura automática", "manaPotion": "mana potion", "autoHeal": True},
            {"slot": 1, "heal": "Cura automática", "manaPotion": "great mana potion", "autoHeal": True},
        ],
    )
    assert mag["party_ready"] is True
    assert mag["slots"]["0"]["ready"] is True
    assert mag["slots"]["1"]["ready"] is True
    only0 = classify_magic(
        [
            {"slot": 0, "empty": False, "name": "exori"},
            {"slot": 1, "empty": False, "name": "exori"},
        ],
        [{"slot": 0, "heal": "Cura automática", "manaPotion": "mana potion", "autoHeal": True}],
    )
    assert only0["slot1_present"] is True
    assert only0["party_ready"] is False
    assert only0["slots"]["1"]["ready"] is False


def test_level50_both_chars_go_stone(tmp_path):
    p = HuntProfiler(str(tmp_path))
    best = p.get_best_hunt_to_farm(50, BOTH, UNLOCK_50)
    assert best["id"] == "refiner-cave"
    assert best["name"] == "Stone Refiner"
    go, _ = p.should_enter(None, best, True, 1e12, 0)
    assert go is True


def test_level50_incomplete_party_not_stone(tmp_path):
    p = HuntProfiler(str(tmp_path))
    best = p.get_best_hunt_to_farm(50, ONLY_LEAD, UNLOCK_50)
    assert best["id"] != "refiner-cave"
    assert best["id"] != "giant-spider"


def test_sim_switches_off_troll_before_120s(tmp_path):
    p = HuntProfiler(str(tmp_path))
    _live(p, "troll-cave", "Troll Cave", 40, 80, 10)
    best = p.get_best_hunt_to_farm(50, BOTH, UNLOCK_50)
    assert best["id"] == "refiner-cave"
    assert p.last_decision["mode"] == "sim"
    go, _ = p.should_enter("troll-cave", best, False, 1e12, 0)
    assert go is True


def test_stone_sample_calibrates_without_hop(tmp_path):
    p = HuntProfiler(str(tmp_path))
    _live(p, "refiner-cave", "Stone Refiner", 40, 200, 20)
    best = p.get_best_hunt_to_farm(50, BOTH, UNLOCK_50)
    assert best["id"] == "refiner-cave"
    assert p.last_decision["mode"] == "sample"
    go, _ = p.should_enter("refiner-cave", best, False, 1e12, 0)
    assert go is False


def test_death_on_stone_reverts(tmp_path):
    import time
    p = HuntProfiler(str(tmp_path))
    _seed(p, "refiner-cave", "Stone Refiner", 80000, 400, deaths=1, last_death=time.time())
    _live(p, "refiner-cave", "Stone Refiner", 5, 10, 1)
    best = p.get_best_hunt_to_farm(50, BOTH, UNLOCK_50)
    assert best["id"] != "refiner-cave"


def test_live_sample_beats_stone_by_margin(tmp_path):
    p = HuntProfiler(str(tmp_path))
    _seed(p, "refiner-cave", "Stone Refiner", 1000, 20)
    p.home_id = "refiner-cave"
    _live(p, "giant-spider", "Giant Spider", SAMPLE_SEC + 20, 90000, 400)
    best = p.get_best_hunt_to_farm(50, BOTH, UNLOCK_50)
    assert best["id"] == "giant-spider"


if __name__ == "__main__":
    from pathlib import Path
    import tempfile
    test_infer_level_does_not_default_to_one()
    test_meta_uses_level_and_magic()
    test_picker_rows_map_names_and_skip_locked()
    for fn in (
        test_unknown_level_does_not_pick_troll,
        test_unsampled_does_not_follow_minlevel_meta,
        test_match_hunt_and_probe_climbs_after_sample,
        test_unlocked_caps_fake_high_level,
        test_measured_profit_beats_higher_minlevel,
        test_recent_death_drops_to_easier,
        test_probe_reverts_when_gold_h_not_better,
        test_probe_keeps_harder_if_profit_justifies,
        test_stall_reverts_urgent,
        test_empty_magic_does_not_probe_hard,
        test_party_two_slots_need_attack_heal_mana,
        test_party_ready_from_helper_not_rotation,
        test_level50_both_chars_go_stone,
        test_level50_incomplete_party_not_stone,
        test_sim_switches_off_troll_before_120s,
        test_stone_sample_calibrates_without_hop,
        test_death_on_stone_reverts,
        test_live_sample_beats_stone_by_margin,
    ):
        with tempfile.TemporaryDirectory() as d:
            fn(Path(d))
    print("ok")
