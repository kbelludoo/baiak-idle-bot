from hunts import (
    HuntProfiler,
    SAMPLE_SEC,
    classify_magic,
    effective_level,
    ids_from_picker_rows,
    infer_level,
    match_hunt,
    meta_hunt_for,
)

AOE = classify_magic([{"empty": False, "name": "exori"}])
EMPTY = classify_magic([])
UNLOCK_30 = [
    "troll-cave", "elf-lair", "amazon-camp", "minotaur", "cyclopolis", "corym-cave",
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
    assert best["id"] == "cyclopolis"


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
    ):
        with tempfile.TemporaryDirectory() as d:
            fn(Path(d))
    print("ok")
