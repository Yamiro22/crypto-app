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
