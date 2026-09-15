from hunt_sim import (
    STONE_ID,
    gold_farm_ready,
    rank_hunts,
    recommend_switch,
    simulate_hunt,
)
from hunts import classify_magic

AOE = classify_magic([{"empty": False, "name": "exori"}])
BOTH = classify_magic([
    {"slot": 0, "empty": False, "name": "exori"},
    {"slot": 0, "empty": False, "name": "exura"},
    {"slot": 0, "empty": False, "name": "mana potion"},
    {"slot": 1, "empty": False, "name": "exori"},
    {"slot": 1, "empty": False, "name": "exura"},
    {"slot": 1, "empty": False, "name": "great mana potion"},
])
EMPTY = classify_magic([])
IDS = ["troll-cave", "elf-lair", "corym-cave", "refiner-cave", "giant-spider"]


def test_engine_ranks_stone_gold():
    stone = simulate_hunt(STONE_ID, 50, BOTH)
    troll = simulate_hunt("troll-cave", 50, BOTH)
    elf = simulate_hunt("elf-lair", 50, BOTH)
    spider = simulate_hunt("giant-spider", 50, BOTH)
    assert stone and troll and elf and spider
    assert stone["gold_kill"] > troll["gold_kill"]
    assert stone["gold_kill"] > elf["gold_kill"]
    assert stone["gold_h"] > troll["gold_h"]
    assert stone["gold_h"] > elf["gold_h"]
    ranked = rank_hunts(IDS, 50, BOTH)
    assert ranked[0]["id"] == STONE_ID


def test_recommend_stone_when_ready():
    rec = recommend_switch(IDS, "troll-cave", 50, BOTH, 1.0, set())
    assert rec is not None
    assert rec["id"] == STONE_ID
    assert rec["clearly_better"] is True
    assert rec["can_tank"] is True


def test_empty_magic_not_gold_ready():
    assert gold_farm_ready(EMPTY) is False
    assert gold_farm_ready(BOTH) is True
    rec = recommend_switch(IDS, None, 50, EMPTY, 1.0, set())
    assert rec is None or rec["id"] != STONE_ID or not rec.get("ready")


if __name__ == "__main__":
    test_engine_ranks_stone_gold()
    test_recommend_stone_when_ready()
    test_empty_magic_not_gold_ready()
    print("ok")
