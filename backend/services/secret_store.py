"""
Cross-platform OS-backed secret storage helpers.
Uses Windows Credential Manager on Windows and Keychain Access on macOS via keyring.
"""

from __future__ import annotations

from typing import Any, Dict, Optional


SECRET_SERVICE_NAME = "qwen-3.5-9b-getrich"
TELEGRAM_BOT_TOKEN_KEY = "telegram_bot_token"
TELEGRAM_CHAT_ID_KEY = "telegram_chat_id"

# Per-mode keys (new — paper and live are independent Alpaca accounts)
ALPACA_PAPER_API_KEY_KEY    = "alpaca_paper_api_key"
ALPACA_PAPER_SECRET_KEY_KEY = "alpaca_paper_secret_key"
ALPACA_LIVE_API_KEY_KEY     = "alpaca_live_api_key"
ALPACA_LIVE_SECRET_KEY_KEY  = "alpaca_live_secret_key"

# Legacy single-slot keys kept only for backward-compat reads
ALPACA_API_KEY_KEY    = "alpaca_api_key"
ALPACA_SECRET_KEY_KEY = "alpaca_secret_key"
ALPACA_MODE_KEY       = "alpaca_trading_mode"   # "paper" | "live"


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


# ── Alpaca ────────────────────────────────────────────────────────────────────

def get_alpaca_credentials_for_mode(mode: str) -> Dict[str, str]:
    """Return (api_key, secret_key) for a specific mode, with legacy fallback."""
    if mode == "live":
        api_key    = _read_secret(ALPACA_LIVE_API_KEY_KEY)
        secret_key = _read_secret(ALPACA_LIVE_SECRET_KEY_KEY)
        if not api_key:
            # Backward compat: old single-slot key stored with mode=live
            old_mode = _read_secret(ALPACA_MODE_KEY) or "paper"
            if old_mode == "live":
                api_key    = _read_secret(ALPACA_API_KEY_KEY)
                secret_key = _read_secret(ALPACA_SECRET_KEY_KEY)
    else:
        api_key    = _read_secret(ALPACA_PAPER_API_KEY_KEY)
        secret_key = _read_secret(ALPACA_PAPER_SECRET_KEY_KEY)
        if not api_key:
            # Backward compat: old single-slot key stored with mode=paper (or unset)
            old_mode = _read_secret(ALPACA_MODE_KEY) or "paper"
            if old_mode == "paper":
                api_key    = _read_secret(ALPACA_API_KEY_KEY)
                secret_key = _read_secret(ALPACA_SECRET_KEY_KEY)
    return {"api_key": api_key or "", "secret_key": secret_key or "", "mode": mode}


def get_alpaca_secret_status() -> Dict[str, Any]:
    try:
        paper = get_alpaca_credentials_for_mode("paper")
        live  = get_alpaca_credentials_for_mode("live")
        paper_ok = bool(paper["api_key"] and paper["secret_key"])
        live_ok  = bool(live["api_key"]  and live["secret_key"])
        return {
            "available":  True,
            "configured": paper_ok or live_ok,
            "paper": {
                "configured":     paper_ok,
                "api_key_masked": _mask_secret(paper["api_key"]),
            },
            "live": {
                "configured":     live_ok,
                "api_key_masked": _mask_secret(live["api_key"]),
            },
            "error": "",
        }
    except Exception as exc:
        return {
            "available":  False,
            "configured": False,
            "paper": {"configured": False, "api_key_masked": ""},
            "live":  {"configured": False, "api_key_masked": ""},
            "error": str(exc),
        }


def save_alpaca_secrets(api_key: str, secret_key: str, mode: str = "paper") -> Dict[str, Any]:
    key    = str(api_key    or "").strip()
    secret = str(secret_key or "").strip()
    m      = str(mode       or "paper").strip().lower()
    if not key:
        raise ValueError("api_key is required")
    if not secret:
        raise ValueError("secret_key is required")
    if m not in ("paper", "live"):
        raise ValueError("mode must be 'paper' or 'live'")

    if m == "paper":
        _write_secret(ALPACA_PAPER_API_KEY_KEY,    key)
        _write_secret(ALPACA_PAPER_SECRET_KEY_KEY, secret)
    else:
        _write_secret(ALPACA_LIVE_API_KEY_KEY,    key)
        _write_secret(ALPACA_LIVE_SECRET_KEY_KEY, secret)
    return get_alpaca_secret_status()


def clear_alpaca_secrets(mode: Optional[str] = None) -> Dict[str, Any]:
    """Clear credentials for a specific mode, or both if mode is None."""
    if mode in (None, "paper"):
        _delete_secret(ALPACA_PAPER_API_KEY_KEY)
        _delete_secret(ALPACA_PAPER_SECRET_KEY_KEY)
    if mode in (None, "live"):
        _delete_secret(ALPACA_LIVE_API_KEY_KEY)
        _delete_secret(ALPACA_LIVE_SECRET_KEY_KEY)
    if mode is None:
        # Also wipe legacy single-slot keys on full clear
        _delete_secret(ALPACA_API_KEY_KEY)
        _delete_secret(ALPACA_SECRET_KEY_KEY)
        _delete_secret(ALPACA_MODE_KEY)
    return get_alpaca_secret_status()


def get_alpaca_credentials() -> Dict[str, str]:
    """Return active credentials: live if configured, else paper (legacy compat)."""
    live = get_alpaca_credentials_for_mode("live")
    if live["api_key"] and live["secret_key"]:
        return live
    return get_alpaca_credentials_for_mode("paper")
