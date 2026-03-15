from dataclasses import dataclass
from typing import Sequence

import numpy as np

from backend.config import RSI_PERIOD, VELOCITY_LOOKBACK


@dataclass
class FeatureSet:
    price_velocity: float
    volatility: float
    momentum: float
    rsi: float | None
    macd: float | None
    macd_hist: float | None
    volume_spike: float | None


def _ema_series(values: np.ndarray, period: int) -> np.ndarray:
    if len(values) == 0:
        return values
    alpha = 2 / (period + 1)
    ema = np.zeros_like(values, dtype=float)
    ema[0] = values[0]
    for idx in range(1, len(values)):
        ema[idx] = alpha * values[idx] + (1 - alpha) * ema[idx - 1]
    return ema


def _compute_rsi(prices: np.ndarray, period: int) -> float | None:
    if len(prices) <= period:
        return None
    deltas = np.diff(prices)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = np.mean(gains[-period:])
    avg_loss = np.mean(losses[-period:])
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def compute_features(
    prices: Sequence[float],
    volumes: Sequence[float],
    velocity_lookback: int = VELOCITY_LOOKBACK,
) -> FeatureSet:
    prices_np = np.array(prices, dtype=float)
    volumes_np = np.array(volumes, dtype=float)
    if len(prices_np) < max(velocity_lookback + 1, 3):
        return FeatureSet(0.0, 0.0, 0.0, None, None, None, None)

    velocity_base = prices_np[-velocity_lookback - 1]
    if velocity_base == 0:
        price_velocity = 0.0
    else:
        price_velocity = (prices_np[-1] - velocity_base) / velocity_base

    returns = np.diff(prices_np) / prices_np[:-1]
    volatility = float(np.std(returns[-velocity_lookback:])) if len(returns) > 0 else 0.0
    momentum = price_velocity

    rsi = _compute_rsi(prices_np, RSI_PERIOD)

    ema_fast = _ema_series(prices_np, 12)
    ema_slow = _ema_series(prices_np, 26)
    macd_line = ema_fast - ema_slow
    signal_line = _ema_series(macd_line, 9)
    macd = float(macd_line[-1]) if len(macd_line) else None
    macd_hist = float(macd_line[-1] - signal_line[-1]) if len(macd_line) else None

    volume_spike = None
    if len(volumes_np) > 1:
        avg_volume = float(np.mean(volumes_np[-velocity_lookback:]))
        volume_spike = float(volumes_np[-1] / (avg_volume + 1e-9))

    return FeatureSet(
        price_velocity=price_velocity,
        volatility=volatility,
        momentum=momentum,
        rsi=rsi,
        macd=macd,
        macd_hist=macd_hist,
        volume_spike=volume_spike,
    )
