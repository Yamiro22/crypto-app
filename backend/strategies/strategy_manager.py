from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional

from backend.ai.signal_engine import SignalDecision
from backend.database.schemas import PredictionCreate
from backend.strategies.mean_reversion import mean_reversion_signal
from backend.strategies.momentum_strategy import momentum_signal
from backend.strategies.types import StrategySignal


@dataclass
class StrategySelection:
    primary: StrategySignal
    candidates: list[StrategySignal]


class StrategyManager:
    """Selects the best signal from the available strategies."""

    def select(
        self,
        prediction: Optional[PredictionCreate],
        scalp_decision: Optional[SignalDecision] = None,
    ) -> StrategySelection:
        candidates: list[StrategySignal] = []

        if prediction is not None:
            candidates.append(momentum_signal(prediction))
            candidates.append(mean_reversion_signal(prediction))

        if scalp_decision is not None and scalp_decision.direction:
            side = "buy" if scalp_decision.direction == "UP" else "sell"
            candidates.append(
                StrategySignal(
                    symbol=prediction.symbol if prediction else "BTCUSDT",
                    side=side,
                    confidence=scalp_decision.confidence,
                    reason=f"scalp_{scalp_decision.reason}",
                )
            )

        primary = self._pick_best(candidates)
        return StrategySelection(primary=primary, candidates=candidates)

    def _pick_best(self, candidates: Iterable[StrategySignal]) -> StrategySignal:
        best = StrategySignal(symbol="BTCUSDT", side=None, confidence=0.0, reason="no_signal")
        for candidate in candidates:
            if candidate.side is None:
                continue
            if candidate.confidence > best.confidence:
                best = candidate
        return best
