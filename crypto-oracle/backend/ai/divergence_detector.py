from dataclasses import dataclass
from typing import Sequence

import numpy as np


@dataclass
class DivergenceSignal:
    acceleration: float
    liquidity_sweep: bool
    invalidate: bool


class DivergenceDetector:
    def __init__(self, accel_threshold: float = 0.002, sweep_threshold: float = 0.003) -> None:
        self.accel_threshold = accel_threshold
        self.sweep_threshold = sweep_threshold

    def detect(self, prices: Sequence[float]) -> DivergenceSignal:
        prices_np = np.array(prices, dtype=float)
        if len(prices_np) < 4:
            return DivergenceSignal(0.0, False, False)

        recent_change = prices_np[-1] - prices_np[-2]
        prior_change = prices_np[-2] - prices_np[-3]
        acceleration = (recent_change - prior_change) / max(prices_np[-3], 1e-9)

        recent_max = float(np.max(prices_np[-5:-1]))
        recent_min = float(np.min(prices_np[-5:-1]))
        spike_up = (prices_np[-1] - recent_max) / max(recent_max, 1e-9) > self.sweep_threshold
        spike_down = (recent_min - prices_np[-1]) / max(recent_min, 1e-9) > self.sweep_threshold
        liquidity_sweep = spike_up or spike_down

        invalidate = abs(acceleration) > self.accel_threshold and liquidity_sweep
        return DivergenceSignal(acceleration, liquidity_sweep, invalidate)
