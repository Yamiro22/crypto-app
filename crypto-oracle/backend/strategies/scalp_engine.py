from dataclasses import dataclass
from typing import Sequence

from backend.ai.divergence_detector import DivergenceDetector, DivergenceSignal
from backend.ai.feature_engine import FeatureSet, compute_features
from backend.ai.signal_engine import SignalDecision, evaluate_signal
from backend.services.whale_monitor import WhaleEvent, WhaleMonitor


@dataclass
class ScalpResult:
    decision: SignalDecision
    features: FeatureSet
    divergence: DivergenceSignal
    whale_sentiment: float


class ScalpEngine:
    def __init__(self) -> None:
        self.whale_monitor = WhaleMonitor()
        self.divergence_detector = DivergenceDetector()

    def evaluate(
        self,
        prices: Sequence[float],
        volumes: Sequence[float],
        whale_events: Sequence[WhaleEvent],
    ) -> ScalpResult:
        features = compute_features(prices, volumes)
        whale_sentiment = self.whale_monitor.compute_sentiment(whale_events)
        divergence = self.divergence_detector.detect(prices)
        decision = evaluate_signal(features, whale_sentiment, divergence, self.whale_monitor)
        return ScalpResult(decision, features, divergence, whale_sentiment)
