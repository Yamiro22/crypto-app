from dataclasses import dataclass
from typing import Optional

from backend.ai.feature_engine import FeatureSet


@dataclass
class Prediction:
    direction: Optional[str]
    confidence: float


class PredictionModel:
    def predict(self, features: FeatureSet) -> Prediction:
        if features.rsi is None or features.macd_hist is None:
            return Prediction(None, 0.0)

        score = 0.0
        if features.macd_hist > 0:
            score += 0.2
        if features.rsi < 50:
            score += 0.1
        if features.price_velocity > 0:
            score += 0.2

        if score >= 0.3:
            return Prediction("UP", min(1.0, score))

        score = 0.0
        if features.macd_hist < 0:
            score += 0.2
        if features.rsi > 50:
            score += 0.1
        if features.price_velocity < 0:
            score += 0.2

        if score >= 0.3:
            return Prediction("DOWN", min(1.0, score))

        return Prediction(None, 0.0)
