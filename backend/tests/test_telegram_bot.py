from __future__ import annotations

import sys
from pathlib import Path


sys.path.append(str(Path(__file__).resolve().parents[1]))

from services import telegram_bot


def test_verify_remote_control_requires_private_chat_and_matching_user(monkeypatch):
    responses = {
        "getMe": {"ok": True, "result": {"username": "trade_guard_bot"}},
        "getChat": {"ok": True, "result": {"id": 123456789, "type": "private"}},
    }
    monkeypatch.setattr(telegram_bot, "_api", lambda token, method, **kwargs: responses[method])

    result = telegram_bot.verify_remote_control("token", "123456789", "123456789")

    assert result["ok"] is True
    assert result["chat_type"] == "private"
    assert result["authorized_user_matches_chat"] is True


def test_dispatch_ignores_messages_from_wrong_sender(monkeypatch):
    sent_messages: list[str] = []
    monkeypatch.setattr(telegram_bot, "_send", lambda token, chat_id, text: sent_messages.append(text))
    monkeypatch.setattr(telegram_bot, "_handle_stop", lambda token, chat_id: sent_messages.append("STOP"))

    telegram_bot._dispatch(
        {
            "update_id": 1,
            "message": {
                "chat": {"id": 123456789, "type": "private"},
                "from": {"id": 999999999},
                "text": "/stop",
            },
        },
        "token",
        "123456789",
        "123456789",
    )

    assert sent_messages == []


def test_initialize_offset_discards_existing_backlog(monkeypatch):
    monkeypatch.setattr(
        telegram_bot,
        "_get_updates",
        lambda token, offset, timeout: [{"update_id": 10}, {"update_id": 15}],
    )

    assert telegram_bot.initialize_offset("token") == 16
