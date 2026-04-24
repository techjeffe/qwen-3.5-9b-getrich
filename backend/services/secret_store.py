"""
Cross-platform OS-backed secret storage helpers.
Uses Windows Credential Manager on Windows and Keychain Access on macOS via keyring.
"""

from __future__ import annotations

from typing import Any, Dict, Optional


SECRET_SERVICE_NAME = "qwen-3.5-9b-getrich"
TELEGRAM_BOT_TOKEN_KEY = "telegram_bot_token"
TELEGRAM_CHAT_ID_KEY = "telegram_chat_id"


def _get_keyring_module():
    try:
        import keyring  # type: ignore
    except Exception as exc:
        raise RuntimeError(
            "The 'keyring' package is required for secure UI-managed secrets. "
            "Install dependencies to enable OS keychain storage."
        ) from exc
    return keyring


def _mask_secret(value: Optional[str], *, keep: int = 3) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if len(raw) <= keep:
        return "*" * len(raw)
    return "***" + raw[-keep:]


def _read_secret(key: str) -> str:
    keyring = _get_keyring_module()
    value = keyring.get_password(SECRET_SERVICE_NAME, key)
    return str(value or "").strip()


def _write_secret(key: str, value: str) -> None:
    keyring = _get_keyring_module()
    keyring.set_password(SECRET_SERVICE_NAME, key, str(value or "").strip())


def _delete_secret(key: str) -> None:
    keyring = _get_keyring_module()
    try:
        keyring.delete_password(SECRET_SERVICE_NAME, key)
    except Exception:
        # Treat missing secrets as already cleared.
        pass


def get_telegram_secret_status() -> Dict[str, Any]:
    try:
        token = _read_secret(TELEGRAM_BOT_TOKEN_KEY)
        chat_id = _read_secret(TELEGRAM_CHAT_ID_KEY)
        return {
            "available": True,
            "configured": bool(token and chat_id),
            "has_bot_token": bool(token),
            "has_chat_id": bool(chat_id),
            "bot_token_masked": _mask_secret(token),
            "chat_id_masked": _mask_secret(chat_id),
            "error": "",
        }
    except Exception as exc:
        return {
            "available": False,
            "configured": False,
            "has_bot_token": False,
            "has_chat_id": False,
            "bot_token_masked": "",
            "chat_id_masked": "",
            "error": str(exc),
        }


def save_telegram_secrets(bot_token: str, chat_id: str) -> Dict[str, Any]:
    token = str(bot_token or "").strip()
    chat = str(chat_id or "").strip()
    if not token:
        raise ValueError("bot_token is required")
    if not chat:
        raise ValueError("chat_id is required")

    _write_secret(TELEGRAM_BOT_TOKEN_KEY, token)
    _write_secret(TELEGRAM_CHAT_ID_KEY, chat)
    return get_telegram_secret_status()


def clear_telegram_secrets() -> Dict[str, Any]:
    _delete_secret(TELEGRAM_BOT_TOKEN_KEY)
    _delete_secret(TELEGRAM_CHAT_ID_KEY)
    return get_telegram_secret_status()


def get_telegram_credentials() -> Dict[str, str]:
    token = _read_secret(TELEGRAM_BOT_TOKEN_KEY)
    chat_id = _read_secret(TELEGRAM_CHAT_ID_KEY)
    return {
        "bot_token": token,
        "chat_id": chat_id,
    }
