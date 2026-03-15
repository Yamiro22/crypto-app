"""Market data streaming service and execution pipeline."""

from __future__ import annotations

import asyncio
import logging
from collections import deque
from datetime import datetime
from typing import Optional

from backend.config import BINANCE_SYMBOL
from backend.database import crud
from backend.database.db import SessionLocal
from backend.database.schemas import PredictionCreate, SignalCreate
from backend.execution.executor import execute_strategy_signal
from backend.ai.predictor import generate_prediction
from backend.risk.risk_engine import RiskEngine
from backend.risk.risk_manager import RiskManager
from backend.services.binance_stream import BinanceTick, run_stream
from backend.services.whale_monitor import fetch_whale_events
from backend.strategies.scalp_engine import ScalpEngine
from backend.strategies.strategy_manager import StrategyManager

logger = logging.getLogger("crypto_oracle.market")


class MarketService:
    """Consumes Binance WebSocket ticks, generates signals, and persists data."""

    def __init__(self, symbol: str = BINANCE_SYMBOL, interval_seconds: int = 10) -> None:
        self.symbol = symbol
        self.interval_seconds = interval_seconds
        self._task: Optional[asyncio.Task] = None
        self._prices: deque[float] = deque(maxlen=600)
        self._volumes: deque[float] = deque(maxlen=600)
        self._ticks: deque[tuple[float, float]] = deque(maxlen=2000)
        self._last_persist_ts = 0.0
        self._last_signal_ts = 0.0
        self._last_prediction_ts = 0.0
        self._last_whale_ts = 0.0
        self._whale_events = []
        self._latest_prediction: Optional[PredictionCreate] = None
        self.scalp_engine = ScalpEngine()
        self.strategy_manager = StrategyManager()
        self.risk_engine = RiskEngine()
        self.risk_manager = RiskManager()

    async def _handle_tick(self, tick: BinanceTick) -> None:
        try:
            now = tick.timestamp
            price = tick.price
            volume = tick.volume

            self._prices.append(price)
            self._volumes.append(volume)
            self._ticks.append((now, price))

            cutoff = now - 120
            while self._ticks and self._ticks[0][0] < cutoff:
                self._ticks.popleft()

            if now - self._last_persist_ts >= self.interval_seconds:
                self._last_persist_ts = now
                with SessionLocal() as db:
                    crud.create_market_data(
                        db,
                        symbol=self.symbol,
                        price=price,
                        volume=volume,
                        timestamp=datetime.utcfromtimestamp(now),
                    )
                logger.info("market_data symbol=%s price=%.2f", self.symbol, price)

            if now - self._last_whale_ts >= 60:
                self._last_whale_ts = now
                try:
                    self._whale_events = fetch_whale_events()
                except Exception as exc:
                    logger.warning("whale_fetch_failed=%s", exc)

            if now - self._last_prediction_ts >= 30:
                self._last_prediction_ts = now
                with SessionLocal() as db:
                    prediction = generate_prediction(db, symbol=self.symbol, timeframe="5m")
                    crud.create_prediction(db, prediction)
                    self._latest_prediction = prediction

            if now - self._last_signal_ts >= 5:
                self._last_signal_ts = now
                if len(self._prices) < 20:
                    return

                scalp = self.scalp_engine.evaluate(
                    prices=list(self._prices),
                    volumes=list(self._volumes),
                    whale_events=self._whale_events,
                )

                if scalp.decision.direction is None:
                    return

                with SessionLocal() as db:
                    crud.create_signal(
                        db,
                        SignalCreate(
                            symbol=self.symbol,
                            direction=scalp.decision.direction,
                            confidence=scalp.decision.confidence,
                            reason=scalp.decision.reason,
                        ),
                    )

                if self.risk_engine.kill_switch_triggered(list(self._ticks)):
                    logger.warning("kill_switch_triggered: blocking execution")
                    return

                selection = self.strategy_manager.select(self._latest_prediction, scalp.decision)
                if selection.primary.side is None:
                    return

                trade_size = max(0.1, selection.primary.confidence)
                with SessionLocal() as db:
                    execute_strategy_signal(
                        db,
                        selection.primary,
                        entry_price=price,
                        size=trade_size,
                        risk_manager=self.risk_manager,
                    )

                logger.info(
                    "trade_signal side=%s confidence=%.2f reason=%s",
                    selection.primary.side,
                    selection.primary.confidence,
                    selection.primary.reason,
                )
        except Exception as exc:
            logger.exception("tick_processing_failed: %s", exc)

    async def run_collector(self) -> None:
        await run_stream(self._handle_tick, symbol=self.symbol)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self.run_collector())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
