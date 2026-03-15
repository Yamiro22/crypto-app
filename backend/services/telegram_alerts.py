import logging
from typing import Any, Dict

import requests

from backend.config import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

logger = logging.getLogger("crypto_oracle.telegram")


class TelegramAlerts:
    def __init__(self, bot_token: str = TELEGRAM_BOT_TOKEN, chat_id: str = TELEGRAM_CHAT_ID) -> None:
        self.bot_token = bot_token
        self.chat_id = chat_id

    def send_alert(self, message: str) -> None:
        if not self.bot_token or not self.chat_id:
            logger.warning("Telegram credentials missing; skipping alert")
            return
        url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
        payload = {"chat_id": self.chat_id, "text": message}
        try:
            response = requests.post(url, json=payload, timeout=10)
            response.raise_for_status()
        except Exception as exc:
            logger.exception("Failed to send Telegram alert: %s", exc)

    def signal_alert(self, payload: Dict[str, Any]) -> None:
        self.send_alert(f"Signal: {payload}")

    def trade_alert(self, payload: Dict[str, Any]) -> None:
        self.send_alert(f"Trade: {payload}")

    def whale_alert(self, payload: Dict[str, Any]) -> None:
        self.send_alert(f"Whale: {payload}")

    def kill_switch_alert(self, payload: Dict[str, Any]) -> None:
        self.send_alert(f"Kill switch: {payload}")
