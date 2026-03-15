from __future__ import annotations

from backend.database.schemas import PredictionCreate
from backend.strategies.types import StrategySignal


def mean_reversion_signal(prediction: PredictionCreate) -> StrategySignal:
    if prediction.prediction == "DOWN" and prediction.confidence > 0.6:
        return StrategySignal(prediction.symbol, "buy", prediction.confidence, "mean_reversion_buy")
    if prediction.prediction == "UP" and prediction.confidence > 0.6:
        return StrategySignal(prediction.symbol, "sell", prediction.confidence, "mean_reversion_sell")
    return StrategySignal(prediction.symbol, None, prediction.confidence, "mean_reversion_hold")
