"""Decisões 24/7: treino, sell, market, transfer."""

from extras import (
    OFFLINE_PICKER_SKIP_REASON,
    confirm_is_safe_action,
    confirm_is_unsafe,
    looks_like_treino,
    skip_market_buy,
    stamina_has_recovered,
    stamina_is_empty,
    should_auto_sell,
    should_enter_treino,
    should_resume_hunts,
    should_skip_equip_item,
    should_transfer_loot,
)


def test_stamina_empty_clock_and_pct():
    assert stamina_is_empty("0:00")
    assert stamina_is_empty("00:00")
    assert stamina_is_empty("0%")
    assert stamina_is_empty("0")
    assert stamina_is_empty("vazia")
    assert stamina_is_empty("5:00", pct=0)
    assert not stamina_is_empty("1:00")
    assert not stamina_is_empty("42:10")
    assert not stamina_is_empty("15%")


def test_stamina_recovers_then_hunts():
    assert stamina_has_recovered("1:00")
    assert stamina_has_recovered("0:01")
    assert stamina_has_recovered("12%", pct=12)
    assert not stamina_has_recovered("0:00")
    assert not stamina_has_recovered(None)


def test_treino_when_stamina_zero():
    assert should_enter_treino(True, True)
    assert not should_enter_treino(False, True)
    assert not should_enter_treino(True, False)
    assert looks_like_treino("Treino online")
    assert looks_like_treino("Online Training")
    assert not looks_like_treino("Troll Cave")
    assert should_resume_hunts(True, True, True)
    assert not should_resume_hunts(True, False, True)
    assert should_resume_hunts(True, False, False)


def test_sell_honors_threshold_and_flag():
    assert should_auto_sell(70, 100, 70, True)
    assert not should_auto_sell(69, 100, 70, True)
    assert should_auto_sell(90, 100, 90, True)
    assert not should_auto_sell(90, 100, 70, False)
    assert not should_auto_sell(10, 0, 70, True)


def test_skip_market_buy_and_unsafe_confirm():
    assert skip_market_buy() is True
    assert confirm_is_unsafe("Comprar item por 50000 gold")
    assert confirm_is_unsafe("Dar lance no leilão")
    assert confirm_is_unsafe("Assinar VIP com Pix")
    assert not confirm_is_unsafe("Vender 40 itens da mochila")
    assert confirm_is_safe_action("Entregar no Codex")
    assert confirm_is_safe_action("Vender todos os itens")
    assert not confirm_is_safe_action("Comprar na loja")


def test_transfer_rare_plus_not_gold():
    assert should_transfer_loot(2, "knight armor")
    assert should_transfer_loot(4, "legendary sword")
    assert not should_transfer_loot(0, "leather helmet")
    assert not should_transfer_loot(5, "gold coin")
    assert should_transfer_loot(None, "epic legs")


def test_skip_junk_equip():
    assert should_skip_equip_item("great mana potion", True)
    assert should_skip_equip_item("knight armor", False)
    assert not should_skip_equip_item("knight armor", True)


def test_offline_picker_is_documented_noop():
    assert "24/7" in OFFLINE_PICKER_SKIP_REASON
    assert "offline" in OFFLINE_PICKER_SKIP_REASON.lower()


if __name__ == "__main__":
    test_stamina_empty_clock_and_pct()
    test_stamina_recovers_then_hunts()
    test_treino_when_stamina_zero()
    test_sell_honors_threshold_and_flag()
    test_skip_market_buy_and_unsafe_confirm()
    test_transfer_rare_plus_not_gold()
    test_skip_junk_equip()
    test_offline_picker_is_documented_noop()
    print("ok")
