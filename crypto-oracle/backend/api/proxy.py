import logging
from typing import Optional

import requests
from fastapi import APIRouter, HTTPException, Query

from backend.config import POLY_GAMMA_URL, POLY_CLOB_URL, POLY_DATA_URL, WHALE_ALERT_API_KEY

router = APIRouter()
logger = logging.getLogger("crypto_oracle.proxy")

WHALE_ALERT_URL = "https://api.whale-alert.io/v1/transactions"


def _proxy_get(url: str, params: Optional[dict] = None):
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        logger.exception("Proxy GET failed: %s", exc)
        raise HTTPException(status_code=502, detail="Upstream request failed")


@router.get("/poly/markets")
def poly_markets(
    tag: Optional[str] = None,
    search: Optional[str] = None,
    active: Optional[bool] = None,
    closed: Optional[bool] = None,
    limit: Optional[int] = Query(default=None, ge=1, le=200),
):
    params = {
        "tag": tag,
        "search": search,
        "active": active,
        "closed": closed,
        "limit": limit,
    }
    params = {k: v for k, v in params.items() if v is not None}
    return _proxy_get(f"{POLY_GAMMA_URL}/markets", params=params)


@router.get("/poly/markets/{market_id}/history")
def poly_market_history(market_id: str):
    return _proxy_get(f"{POLY_GAMMA_URL}/markets/{market_id}/history")


@router.get("/clob/price")
def clob_price(token_id: str = Query(...), side: str = Query(default="BUY")):
    return _proxy_get(f"{POLY_CLOB_URL}/price", params={"token_id": token_id, "side": side})


@router.get("/clob/spread")
def clob_spread(token_id: str = Query(...)):
    return _proxy_get(f"{POLY_CLOB_URL}/spread", params={"token_id": token_id})


@router.get("/clob/book")
def clob_book(token_id: str = Query(...)):
    return _proxy_get(f"{POLY_CLOB_URL}/book", params={"token_id": token_id})


@router.get("/clob/prices-history")
def clob_prices_history(
    market: str = Query(...),
    interval: str = Query(default="1h"),
    fidelity: int = Query(default=1),
):
    return _proxy_get(
        f"{POLY_CLOB_URL}/prices-history",
        params={"market": market, "interval": interval, "fidelity": fidelity},
    )


@router.get("/whale/transactions")
def whale_transactions(
    min_value: int = Query(default=5_000_000, ge=1),
    start: Optional[int] = None,
    currency: str = Query(default="btc"),
    limit: int = Query(default=20, ge=1, le=100),
):
    if not WHALE_ALERT_API_KEY:
        raise HTTPException(status_code=503, detail="Whale Alert API key not configured")

    params = {
        "min_value": min_value,
        "start": start,
        "api_key": WHALE_ALERT_API_KEY,
        "currency": currency,
        "limit": limit,
    }
    params = {k: v for k, v in params.items() if v is not None}
    return _proxy_get(WHALE_ALERT_URL, params=params)
