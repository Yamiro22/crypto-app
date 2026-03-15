from dataclasses import dataclass
from typing import Sequence

from backend.config import (
    KILL_SWITCH_VARIANCE,
    KILL_SWITCH_WINDOW_SECONDS,
    TIER1_TARGET_MULTIPLE,
    TIER2_LIMIT_PRICE,
)


@dataclass
class ExitPlan:
    scalp_size: float
    moonbag_size: float
    tier1_target_price: float
    tier2_limit_price: float


class RiskEngine:
    def build_exit_plan(self, entry_price: float, size: float) -> ExitPlan:
        scalp_size = size * 0.7
        moonbag_size = size * 0.3
        tier1_target = min(1.0, entry_price * TIER1_TARGET_MULTIPLE)
        return ExitPlan(
            scalp_size=scalp_size,
            moonbag_size=moonbag_size,
            tier1_target_price=tier1_target,
            tier2_limit_price=TIER2_LIMIT_PRICE,
        )

    def price_recovery_begins(self, prices: Sequence[float], direction: str) -> bool:
        if len(prices) < 4:
            return False
        recent = prices[-4:]
        deltas = [recent[i + 1] - recent[i] for i in range(len(recent) - 1)]
        if direction == "DOWN":
            return all(delta > 0 for delta in deltas)
        if direction == "UP":
            return all(delta < 0 for delta in deltas)
        return False

    def kill_switch_triggered(self, ticks: Sequence[tuple[float, float]]) -> bool:
        if not ticks:
            return False
        latest_time = ticks[-1][0]
        window = [price for ts, price in ticks if latest_time - ts <= KILL_SWITCH_WINDOW_SECONDS]
        if len(window) < 2:
            return False
        max_price = max(window)
        min_price = min(window)
        return (max_price - min_price) <= (KILL_SWITCH_VARIANCE * 2)
