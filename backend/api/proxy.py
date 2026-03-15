import json
import logging
import re
import time
from typing import Optional

import requests
from fastapi import APIRouter, HTTPException, Query

from backend.config import POLY_GAMMA_URL, POLY_CLOB_URL, POLY_DATA_URL, WHALE_ALERT_API_KEY

router = APIRouter()
logger = logging.getLogger("crypto_oracle.proxy")

WHALE_ALERT_URL = "https://api.whale-alert.io/v1/transactions"
POLYMARKET_HOME = "https://polymarket.com"
BTC5M_CACHE_TTL = 8
_btc5m_cache: dict = {"ts": 0.0, "data": None}


def _proxy_get(url: str, params: Optional[dict] = None):
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        logger.exception("Proxy GET failed: %s", exc)
        raise HTTPException(status_code=502, detail="Upstream request failed")


def _fetch_btc5m_market() -> dict:
    now = time.time()
    if _btc5m_cache["data"] and now - _btc5m_cache["ts"] < BTC5M_CACHE_TTL:
        return _btc5m_cache["data"]

    try:
        html = requests.get(POLYMARKET_HOME, timeout=10).text
        match = re.search(r'__NEXT_DATA__\" type=\"application/json\"[^>]*>(.*?)</script>', html, re.S)
        if not match:
            raise ValueError("NEXT_DATA not found")
        data = json.loads(match.group(1))
        queries = data["props"]["pageProps"]["dehydratedState"]["queries"]
        for q in queries:
            key = q.get("queryKey")
            if isinstance(key, list) and key and key[0] == "btc-5m-market":
                payload = q["state"]["data"]
                markets = payload.get("markets", [])
                if not markets:
                    break
                market = markets[0]
                outcomes = market.get("outcomes", [])
                prices = market.get("outcomePrices", [])
                up_idx = outcomes.index("Up") if "Up" in outcomes else 0
                down_idx = outcomes.index("Down") if "Down" in outcomes else 1
                up_price = float(prices[up_idx]) if len(prices) > up_idx else 0.5
                down_price = float(prices[down_idx]) if len(prices) > down_idx else 0.5
                result = {
                    "slug": payload.get("slug"),
                    "title": payload.get("title"),
                    "startTime": payload.get("startTime"),
                    "endDate": payload.get("endDate"),
                    "marketId": market.get("id"),
                    "outcomes": outcomes,
                    "upOdds": round(up_price * 100),
                    "downOdds": round(down_price * 100),
                    "source": "polymarket-home",
                }
                _btc5m_cache["data"] = result
                _btc5m_cache["ts"] = now
                return result
    except Exception as exc:
        logger.exception("BTC5m fetch failed: %s", exc)
        raise HTTPException(status_code=502, detail="BTC5m market fetch failed")

    raise HTTPException(status_code=404, detail="BTC5m market not found")


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


@router.get("/poly/btc5m")
def poly_btc5m():
    return _fetch_btc5m_market()


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
        # Demo fallback if no key configured
        return {
            "transactions": [
                {
                    "id": "demo",
                    "timestamp": start or 0,
                    "symbol": currency.upper(),
                    "amount": 250.5,
                    "amount_usd": 250.5 * 80000,
                    "from": {"owner_type": "exchange", "owner": "Binance"},
                    "to": {"owner_type": "unknown", "owner": "Whale Wallet"},
                }
            ]
        }

    params = {
        "min_value": min_value,
        "start": start,
        "api_key": WHALE_ALERT_API_KEY,
        "currency": currency,
        "limit": limit,
    }
    params = {k: v for k, v in params.items() if v is not None}
    return _proxy_get(WHALE_ALERT_URL, params=params)
