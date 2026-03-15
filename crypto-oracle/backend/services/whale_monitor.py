from dataclasses import dataclass
from typing import Iterable
import logging

from backend.config import WHALE_OVERRIDE_THRESHOLD


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
