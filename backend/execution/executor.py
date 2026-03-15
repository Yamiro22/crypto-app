"""Execution layer for simulated trades and strategy signals."""

from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from backend.database import crud, models
from backend.database.schemas import TradeSimulationRequest
from backend.risk.risk_manager import RiskManager
from backend.strategies.types import StrategySignal


def simulate_trade(
    db: Session,
    request: TradeSimulationRequest,
    risk_manager: Optional[RiskManager] = None,
) -> models.Trade:
    """Create a simulated trade using a deterministic stop-loss/take-profit."""
    manager = risk_manager or RiskManager()
    size = manager.cap_size(request.size)

    signal_side = request.signal.lower() if request.signal else None
    if signal_side == request.side:
        exit_price = manager.take_profit_price(request.entry_price, request.side)
    elif signal_side is None:
        exit_price = request.entry_price
    else:
        exit_price = manager.stop_loss_price(request.entry_price, request.side)

    pnl = manager.calculate_pnl(request.entry_price, exit_price, request.side, size)

    return crud.create_trade(
        db,
        user_id=request.user_id,
        symbol=request.symbol,
        side=request.side,
        size=size,
        entry_price=request.entry_price,
        exit_price=exit_price,
        pnl=pnl,
    )


def execute_strategy_signal(
    db: Session,
    signal: StrategySignal,
    entry_price: float,
    size: float,
    risk_manager: Optional[RiskManager] = None,
) -> Optional[models.Trade]:
    """Persist a trade using an incoming strategy signal."""
    if signal.side is None:
        return None
    manager = risk_manager or RiskManager()
    capped_size = manager.cap_size(size)
    exit_price = manager.take_profit_price(entry_price, signal.side)
    pnl = manager.calculate_pnl(entry_price, exit_price, signal.side, capped_size)
    return crud.create_trade(
        db,
        user_id=None,
        symbol=signal.symbol,
        side=signal.side,
        size=capped_size,
        entry_price=entry_price,
        exit_price=exit_price,
        pnl=pnl,
    )
