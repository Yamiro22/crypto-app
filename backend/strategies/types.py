from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass
class StrategySignal:
    symbol: str
    side: Optional[str]
    confidence: float
    reason: str
