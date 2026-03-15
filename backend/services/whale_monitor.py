from dataclasses import dataclass
from typing import Iterable
import logging
import time

import requests

from backend.config import WHALE_OVERRIDE_THRESHOLD, WHALE_ALERT_API_KEY

WHALE_ALERT_URL = "https://api.whale-alert.io/v1/transactions"


@dataclass
class WhaleEvent:
    event_type: str
    amount_btc: float


class WhaleMonitor:
    def __init__(self, threshold_btc: float = 50.0) -> None:
        self.threshold_btc = threshold_btc
        self.logger = logging.getLogger("crypto_oracle.whale")

    def compute_sentiment(self, events: Iterable[WhaleEvent]) -> float:
        weighted = 0.0
        total_weight = 0.0
        event_count = 0
        for event in events:
            event_count += 1
            weight = min(1.0, event.amount_btc / self.threshold_btc)
            total_weight += weight
            if event.event_type == "withdrawal":
                weighted += weight
            elif event.event_type == "deposit":
                weighted -= weight
        if total_weight == 0:
            return 0.0
        score = weighted / total_weight
        score = max(-1.0, min(1.0, score))
        self.logger.info("whale_sentiment=%.3f events=%d", score, event_count)
        return score

    def down_signals_blocked(self, sentiment: float) -> bool:
        return sentiment > WHALE_OVERRIDE_THRESHOLD


def fetch_whale_events(
    min_value_usd: int = 5_000_000,
    currency: str = "btc",
    limit: int = 20,
) -> list[WhaleEvent]:
    if not WHALE_ALERT_API_KEY:
        return []

    params = {
        "min_value": min_value_usd,
        "start": int(time.time()) - 300,
        "api_key": WHALE_ALERT_API_KEY,
        "currency": currency,
        "limit": limit,
    }
    response = requests.get(WHALE_ALERT_URL, params=params, timeout=10)
    response.raise_for_status()
    data = response.json()
    events: list[WhaleEvent] = []

    for tx in data.get("transactions", []):
        amount = float(tx.get("amount", 0.0))
        from_owner = (tx.get("from") or {}).get("owner_type")
        to_owner = (tx.get("to") or {}).get("owner_type")
        if from_owner == "exchange" and to_owner in {"unknown", "unknown_wallet", "unknown_wallets"}:
            events.append(WhaleEvent(event_type="withdrawal", amount_btc=amount))
        elif to_owner == "exchange" and from_owner in {"unknown", "unknown_wallet", "unknown_wallets"}:
            events.append(WhaleEvent(event_type="deposit", amount_btc=amount))

    return events
