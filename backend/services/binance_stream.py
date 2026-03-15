import asyncio
import json
from dataclasses import dataclass
from typing import AsyncIterator, Callable, Awaitable

import websockets

from backend.config import BINANCE_SYMBOL, BINANCE_STREAM_URL


@dataclass
class BinanceTick:
    price: float
    volume: float
    timestamp: float


async def stream_trades(symbol: str = BINANCE_SYMBOL) -> AsyncIterator[BinanceTick]:
    stream = f"{symbol.lower()}@trade"
    url = f"{BINANCE_STREAM_URL}/ws/{stream}"
    async with websockets.connect(url, ping_interval=20, ping_timeout=20) as socket:
        async for message in socket:
            payload = json.loads(message)
            yield BinanceTick(
                price=float(payload["p"]),
                volume=float(payload["q"]),
                timestamp=float(payload["T"]) / 1000.0,
            )


async def run_stream(
    handler: Callable[[BinanceTick], Awaitable[None]],
    symbol: str = BINANCE_SYMBOL,
) -> None:
    while True:
        try:
            async for tick in stream_trades(symbol=symbol):
                await handler(tick)
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(5)
