from __future__ import annotations

from backend.database.schemas import PredictionCreate
from backend.strategies.types import StrategySignal


def momentum_signal(prediction: PredictionCreate) -> StrategySignal:
    if prediction.prediction == "UP":
        return StrategySignal(prediction.symbol, "buy", prediction.confidence, "momentum_up")
    if prediction.prediction == "DOWN":
        return StrategySignal(prediction.symbol, "sell", prediction.confidence, "momentum_down")
    return StrategySignal(prediction.symbol, None, prediction.confidence, "momentum_flat")
