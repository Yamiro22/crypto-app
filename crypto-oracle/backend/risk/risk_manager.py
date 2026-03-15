"""Risk management controls for simulated trading."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class RiskLimits:
    max_position_size: float = 1.0
    stop_loss_pct: float = 0.01
    risk_per_trade_pct: float = 0.02


class RiskManager:
    """Provides sizing and stop-loss calculations."""

    def __init__(self, limits: RiskLimits | None = None) -> None:
        self.limits = limits or RiskLimits()

    def cap_size(self, size: float) -> float:
        return min(size, self.limits.max_position_size)

    def stop_loss_price(self, entry_price: float, side: str) -> float:
        if side == "buy":
            return entry_price * (1.0 - self.limits.stop_loss_pct)
        return entry_price * (1.0 + self.limits.stop_loss_pct)

    def take_profit_price(self, entry_price: float, side: str, reward_multiple: float = 2.0) -> float:
        if side == "buy":
            return entry_price * (1.0 + self.limits.stop_loss_pct * reward_multiple)
        return entry_price * (1.0 - self.limits.stop_loss_pct * reward_multiple)

    def calculate_pnl(self, entry_price: float, exit_price: float, side: str, size: float) -> float:
        if side == "buy":
            return (exit_price - entry_price) * size
        return (entry_price - exit_price) * size
