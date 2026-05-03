"""
Telegram bot remote control — long-polling, command-only interface.

Security model:
  - Only one private chat_id is allowed.
  - Only one Telegram user_id inside that private chat is allowed.
  - Messages from any other chat_id or sender_id are silently ignored.
  - Only /stop and /start mutate state. No other changes are possible.

Commands:
  /status  — report current alpaca_execution_mode
  /stop    — set mode to "off", save previous mode for resumption
  /start   — restore previously saved mode
  /help    — list commands
"""

import time
from typing import Any, Dict, Optional

import requests

_POLL_TIMEOUT_SECS = 30     # Telegram long-poll window per request
_ERROR_SLEEP_SECS  = 5      # back-off after network errors
_BOT_BASE          = "https://api.telegram.org/bot{token}/{method}"


# ── Low-level Telegram helpers ────────────────────────────────────────────────

def _api(token: str, method: str, **kwargs) -> dict:
    url = _BOT_BASE.format(token=token, method=method)
    response = requests.post(url, json=kwargs, timeout=_POLL_TIMEOUT_SECS + 10)
    response.raise_for_status()
    return response.json()


def _send(token: str, chat_id: str, text: str) -> None:
    try:
        _api(token, "sendMessage", chat_id=chat_id, text=text, parse_mode="HTML")
    except Exception as exc:
        print(f"[telegram-bot] sendMessage failed: {exc}")


def _send_generic_error(token: str, chat_id: str, action: str) -> None:
    _send(token, chat_id, f"{action} failed. Check backend logs for details.")


# ── Command handlers ──────────────────────────────────────────────────────────

def _handle_status(token: str, chat_id: str) -> None:
    from database.engine import SessionLocal
    from services.app_config import get_or_create_app_config
    db = SessionLocal()
    try:
        config = get_or_create_app_config(db)
        mode = (config.alpaca_execution_mode or "off").upper()
        _send(token, chat_id, f"Trading mode: <b>{mode}</b>")
    except Exception as exc:
        print(f"[telegram-bot] status error: {exc}")
        _send_generic_error(token, chat_id, "Status request")
    finally:
        db.close()


def _handle_stop(token: str, chat_id: str) -> None:
    from database.engine import SessionLocal
    from services.app_config import get_or_create_app_config, update_app_config
    db = SessionLocal()
    try:
        config = get_or_create_app_config(db)
        current = (config.alpaca_execution_mode or "off").lower()
        if current == "off":
            _send(token, chat_id, "Trading is already stopped.")
            return
        # Persist previous mode so /start can restore it
        config.alpaca_pre_stop_mode = current
        db.commit()
        update_app_config(db, {"alpaca_execution_mode": "off"})
        _send(
            token, chat_id,
            f"Trading stopped. Previous mode (<b>{current.upper()}</b>) saved.\n"
            "Send /start to resume.",
        )
        print(f"[telegram-bot] /stop — execution mode changed from {current} → off")
    except Exception as exc:
        db.rollback()
        print(f"[telegram-bot] stop error: {exc}")
        _send_generic_error(token, chat_id, "Stop command")
    finally:
        db.close()


def _handle_start(token: str, chat_id: str) -> None:
    from database.engine import SessionLocal
    from services.app_config import get_or_create_app_config, update_app_config
    db = SessionLocal()
    try:
        config = get_or_create_app_config(db)
        current = (config.alpaca_execution_mode or "off").lower()
        if current != "off":
            _send(token, chat_id, f"Trading is already active (<b>{current.upper()}</b>).")
            return
        resume_mode = str(getattr(config, "alpaca_pre_stop_mode", None) or "").strip().lower()
        if not resume_mode:
            _send(
                token, chat_id,
                "No previous trading mode saved.\n"
                "Use the admin UI to set paper or live mode.",
            )
            return
        update_app_config(db, {"alpaca_execution_mode": resume_mode})
        # Clear saved mode now that it's been consumed
        db.refresh(config)
        config.alpaca_pre_stop_mode = None
        db.commit()
        _send(token, chat_id, f"Trading resumed in <b>{resume_mode.upper()}</b> mode.")
        print(f"[telegram-bot] /start — execution mode restored to {resume_mode}")
    except Exception as exc:
        db.rollback()
        print(f"[telegram-bot] start error: {exc}")
        _send_generic_error(token, chat_id, "Start command")
    finally:
        db.close()


# ── Update dispatcher ─────────────────────────────────────────────────────────

def _dispatch(update: dict, token: str, authorized_chat_id: str, authorized_user_id: str) -> None:
    message = update.get("message")
    if not message:
        return

    chat_id = str(message.get("chat", {}).get("id", ""))
    chat_type = str(message.get("chat", {}).get("type", "")).strip().lower()
    sender_id = str(message.get("from", {}).get("id", ""))
    text = str(message.get("text") or "").strip()

    # Security gate — only one operator in one private chat may control trading.
    if chat_type != "private":
        return
    if chat_id != authorized_chat_id or sender_id != authorized_user_id:
        return

    # Parse command, stripping optional @BotName suffix
    raw_command = text.split()[0].lower() if text else ""
    command = raw_command.split("@")[0]

    if command == "/help":
        _send(token, chat_id, (
            "<b>Remote trading controls</b>\n\n"
            "/status — current trading mode\n"
            "/stop   — disable all Alpaca trading\n"
            "/start  — resume previous trading mode\n"
            "/help   — show this message"
        ))
    elif command == "/status":
        _handle_status(token, chat_id)
    elif command == "/stop":
        _handle_stop(token, chat_id)
    elif command == "/start":
        _handle_start(token, chat_id)
    else:
        _send(token, chat_id, "Unknown command. Send /help for available commands.")


# ── Public polling entry-point (called via asyncio.to_thread) ─────────────────

def _get_updates(token: str, offset: int, timeout: int) -> list[dict]:
    result = _api(
        token,
        "getUpdates",
        offset=offset,
        timeout=timeout,
        allowed_updates=["message"],
    )
    return result.get("result", [])


def initialize_offset(token: str) -> int:
    """Discard any pre-existing Telegram backlog and return the next safe offset."""
    try:
        updates = _get_updates(token, 0, 0)
    except Exception as exc:
        print(f"[telegram-bot] initialize_offset error: {exc}")
        return 0

    next_offset = 0
    for update in updates:
        update_id = int(update.get("update_id", 0) or 0)
        next_offset = max(next_offset, update_id + 1)
    return next_offset


def verify_remote_control(token: str, chat_id: str, authorized_user_id: str) -> Dict[str, Any]:
    """Validate bot token, private chat targeting, and operator binding assumptions."""
    normalized_chat_id = str(chat_id or "").strip()
    normalized_user_id = str(authorized_user_id or "").strip()
    if not normalized_chat_id.isdigit():
        raise ValueError("chat_id must be a positive numeric Telegram private chat ID")
    if not normalized_user_id.isdigit():
        raise ValueError("authorized_user_id must be a positive numeric Telegram user ID")

    me_payload = _api(token, "getMe")
    chat_payload = _api(token, "getChat", chat_id=normalized_chat_id)
    me = me_payload.get("result", {}) if isinstance(me_payload, dict) else {}
    chat = chat_payload.get("result", {}) if isinstance(chat_payload, dict) else {}

    bot_ok = bool(me_payload.get("ok", True) if isinstance(me_payload, dict) else True)
    chat_type = str(chat.get("type") or "").strip().lower() if isinstance(chat, dict) else ""
    resolved_chat_id = str(chat.get("id") or "").strip() if isinstance(chat, dict) else ""

    is_private_chat = chat_type == "private"
    chat_matches = resolved_chat_id == normalized_chat_id
    user_matches_private_chat = normalized_chat_id == normalized_user_id

    return {
        "ok": bool(bot_ok and is_private_chat and chat_matches and user_matches_private_chat),
        "bot_username": str(me.get("username") or "").strip() if isinstance(me, dict) else "",
        "chat_type": chat_type,
        "chat_id_matches": chat_matches,
        "private_chat_required": is_private_chat,
        "authorized_user_matches_chat": user_matches_private_chat,
        "message": (
            "Telegram remote control verified."
            if bot_ok and is_private_chat and chat_matches and user_matches_private_chat
            else "Telegram setup must use a private chat where chat ID and authorized user ID match."
        ),
    }


def poll_and_dispatch(token: str, authorized_chat_id: str, authorized_user_id: str, offset: int) -> int:
    """
    One long-poll cycle against Telegram getUpdates.
    Blocks for up to _POLL_TIMEOUT_SECS seconds waiting for messages.
    Returns the updated offset for the next call.
    """
    try:
        updates = _get_updates(token, offset, _POLL_TIMEOUT_SECS)
    except Exception as exc:
        print(f"[telegram-bot] getUpdates error: {exc}")
        time.sleep(_ERROR_SLEEP_SECS)
        return offset

    for update in updates:
        update_id = update.get("update_id", 0)
        offset = max(offset, update_id + 1)
        try:
            _dispatch(update, token, authorized_chat_id, authorized_user_id)
        except Exception as exc:
            print(f"[telegram-bot] dispatch error: {exc}")

    return offset
