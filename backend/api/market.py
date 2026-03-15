import logging

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.database.db import get_db
from backend.database import crud
from backend.database.schemas import MarketDataOut

router = APIRouter()
logger = logging.getLogger("crypto_oracle.market_api")

BINANCE_REST = "https://api.binance.com/api/v3"
TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h"]


@router.get("/market/btc", response_model=MarketDataOut)
def get_btc_market(db: Session = Depends(get_db)) -> MarketDataOut:
    item = crud.get_latest_market_data(db, symbol="BTCUSDT")
    if item is None:
        raise HTTPException(status_code=404, detail="No market data yet")
    return item


@router.get("/market/klines")
def get_klines(
    symbol: str = Query(default="BTCUSDT"),
    interval: str = Query(default="1m"),
    limit: int = Query(default=200, ge=1, le=1000),
) -> list:
    """Proxy Binance klines through the backend."""
    try:
        response = requests.get(
            f"{BINANCE_REST}/klines",
            params={"symbol": symbol, "interval": interval, "limit": limit},
            timeout=10,
        )
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        logger.exception("Failed to fetch klines: %s", exc)
        raise HTTPException(status_code=502, detail="Klines fetch failed")


@router.get("/market/24hr")
def get_24hr(symbol: str = Query(default="BTCUSDT")) -> dict:
    """Proxy Binance 24hr ticker through the backend."""
    try:
        response = requests.get(
            f"{BINANCE_REST}/ticker/24hr",
            params={"symbol": symbol},
            timeout=10,
        )
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        logger.exception("Failed to fetch 24hr stats: %s", exc)
        raise HTTPException(status_code=502, detail="24hr fetch failed")


@router.get("/market/timeframes")
def get_timeframes(symbol: str = Query(default="BTCUSDT"), limit: int = Query(default=200, ge=50, le=500)) -> dict:
    """Return multi-timeframe candles + indicators computed server-side."""
    from backend.ai.indicators import (
        calc_macd,
        calc_rsi,
        calc_stoch_rsi,
        calc_bb,
        calc_supertrend,
        calc_vwap,
    )

    result = {}
    for tf in TIMEFRAMES:
        try:
            response = requests.get(
                f"{BINANCE_REST}/klines",
                params={"symbol": symbol, "interval": tf, "limit": limit},
                timeout=10,
            )
            response.raise_for_status()
            klines = response.json()
        except Exception as exc:
            logger.exception("Failed to fetch klines %s: %s", tf, exc)
            continue

        opens = [float(k[1]) for k in klines]
        highs = [float(k[2]) for k in klines]
        lows = [float(k[3]) for k in klines]
        closes = [float(k[4]) for k in klines]
        volumes = [float(k[5]) for k in klines]
        times = [k[0] for k in klines]

        result[tf] = {
            "opens": opens,
            "highs": highs,
            "lows": lows,
            "closes": closes,
            "volumes": volumes,
            "times": times,
            "price": closes[-1] if closes else None,
            "macd": calc_macd(closes),
            "rsi": calc_rsi(closes),
            "stochRSI": calc_stoch_rsi(closes),
            "bb": calc_bb(closes),
            "supertrend": calc_supertrend(highs, lows, closes),
            "vwap": calc_vwap(highs, lows, closes, volumes),
            "candles": [
                {
                    "time": k[0],
                    "open": float(k[1]),
                    "high": float(k[2]),
                    "low": float(k[3]),
                    "close": float(k[4]),
                    "volume": float(k[5]),
                }
                for k in klines[-60:]
            ],
        }

    return result
