"""Market data collection service."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Optional

import requests

from backend.database.db import SessionLocal
from backend.database import crud

logger = logging.getLogger("crypto_oracle.market")

BINANCE_TICKER_URL = "https://api.binance.com/api/v3/ticker/24hr"


class MarketService:
    """Fetches BTC price data and persists it on a fixed interval."""

    def __init__(self, symbol: str = "BTCUSDT", interval_seconds: int = 10) -> None:
        self.symbol = symbol
        self.interval_seconds = interval_seconds
        self._task: Optional[asyncio.Task] = None

    def fetch_btc_price(self) -> dict:
        """Fetch latest BTC price and volume from Binance."""
        response = requests.get(BINANCE_TICKER_URL, params={"symbol": self.symbol}, timeout=10)
        response.raise_for_status()
        data = response.json()
        price = float(data["lastPrice"])
        volume = float(data.get("volume", 0.0))
        close_time = data.get("closeTime")
        timestamp = (
            datetime.utcfromtimestamp(close_time / 1000.0)
            if close_time is not None
            else datetime.utcnow()
        )
        return {"price": price, "volume": volume, "timestamp": timestamp}

    async def run_collector(self) -> None:
        """Background loop that stores market data every interval."""
        while True:
            try:
                payload = await asyncio.to_thread(self.fetch_btc_price)
                with SessionLocal() as db:
                    crud.create_market_data(
                        db,
                        symbol=self.symbol,
                        price=payload["price"],
                        volume=payload["volume"],
                        timestamp=payload["timestamp"],
                    )
                logger.info("market_data symbol=%s price=%.2f", self.symbol, payload["price"])
            except Exception as exc:
                logger.exception("Market data fetch failed: %s", exc)
            await asyncio.sleep(self.interval_seconds)

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
