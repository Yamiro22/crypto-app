from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from backend.database.schemas import PredictionCreate


@dataclass
class StrategySignal:
    symbol: str
    side: Optional[str]
    confidence: float
    reason: str


def momentum_signal(prediction: PredictionCreate) -> StrategySignal:
    if prediction.prediction == "UP":
        return StrategySignal(prediction.symbol, "buy", prediction.confidence, "momentum_up")
    if prediction.prediction == "DOWN":
        return StrategySignal(prediction.symbol, "sell", prediction.confidence, "momentum_down")
    return StrategySignal(prediction.symbol, None, prediction.confidence, "momentum_flat")
