from typing import Sequence

from backend.ai.feature_engine import compute_features, FeatureSet
from backend.config import VELOCITY_LOOKBACK, VELOCITY_THRESHOLD


def velocity_drop(prices: Sequence[float], lookback: int = VELOCITY_LOOKBACK) -> float:
    if len(prices) <= lookback:
        return 0.0
    base = prices[-lookback - 1]
    if base == 0:
        return 0.0
    return (prices[-1] - base) / base


def is_velocity_threshold_met(prices: Sequence[float]) -> bool:
    return abs(velocity_drop(prices)) >= VELOCITY_THRESHOLD


def compute_velocity_features(prices: Sequence[float], volumes: Sequence[float]) -> FeatureSet:
    return compute_features(prices, volumes, velocity_lookback=VELOCITY_LOOKBACK)
