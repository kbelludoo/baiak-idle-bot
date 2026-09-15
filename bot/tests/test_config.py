import os

from config import describe_flags, read_flags

_FLAG_KEYS = (
    "AUTO_HUNT", "AUTO_TREINO", "AUTO_SELL", "AUTO_BOSS",
    "REDUCE_VFX", "HEADLESS", "SCREENSHOT_INTERVAL", "SELL_THRESHOLD_PCT",
    "HUNT_ID", "FORCE_HUNT", "AUTO_BAGS", "AUTO_EQUIP", "AUTO_PREY", "AUTO_EXTRAS",
    "AUTO_HEAL", "HEAL_BELOW_PCT", "HP_POTION_BELOW_PCT", "MANA_POTION_BELOW_PCT",
    "LIVE_STREAM", "STREAM_FPS", "STREAM_WIDTH", "STREAM_HEIGHT", "STREAM_QUALITY",
)


def _clear_flags():
    saved = {k: os.environ.pop(k) for k in _FLAG_KEYS if k in os.environ}
    return saved


def _restore(saved):
    for k in _FLAG_KEYS:
        os.environ.pop(k, None)
    os.environ.update(saved)


def test_defaults_hunt_treino_sell_boss_on():
    saved = _clear_flags()
    try:
        flags = read_flags()
        assert flags.auto_hunt is True
        assert flags.auto_treino is True
        assert flags.auto_sell is True
        assert flags.auto_boss is True
        assert flags.reduce_vfx is True
        assert flags.headless is True
        assert flags.screenshot is False
        assert flags.sell_threshold_pct == 70
        assert flags.hunt_id == ""
        assert flags.force_hunt is False
        assert flags.live_stream is True
        assert flags.stream_fps == 12
        assert flags.stream_width == 854
        assert flags.stream_height == 480
        text = describe_flags(flags)
        assert "screenshot=OFF" in text
        assert "BAIAK_TOKEN" not in text
        assert "force_hunt=" not in text
        assert "stream=854x480@12q70" in text
    finally:
        _restore(saved)


def test_env_can_disable_and_set_threshold():
    saved = _clear_flags()
    try:
        os.environ["AUTO_HUNT"] = "false"
        os.environ["AUTO_BOSS"] = "0"
        os.environ["SELL_THRESHOLD_PCT"] = "90"
        os.environ["HUNT_ID"] = "troll-cave"
        os.environ["HEADLESS"] = "no"
        flags = read_flags()
        assert flags.auto_hunt is False
        assert flags.auto_boss is False
        assert flags.sell_threshold_pct == 90
        assert flags.hunt_id == "troll-cave"
        assert flags.force_hunt is False
        assert flags.headless is False
        assert "hunt_id=ignorado" in describe_flags(flags)
    finally:
        _restore(saved)


def test_force_hunt_uses_hunt_id():
    saved = _clear_flags()
    try:
        os.environ["FORCE_HUNT"] = "true"
        os.environ["HUNT_ID"] = "troll-cave"
        flags = read_flags()
        assert flags.force_hunt is True
        assert flags.hunt_id == "troll-cave"
        assert "force_hunt=troll-cave" in describe_flags(flags)
    finally:
        _restore(saved)


if __name__ == "__main__":
    test_defaults_hunt_treino_sell_boss_on()
    test_env_can_disable_and_set_threshold()
    test_force_hunt_uses_hunt_id()
    print("ok")
