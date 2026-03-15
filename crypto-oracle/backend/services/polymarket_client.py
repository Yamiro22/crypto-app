from __future__ import annotations

from typing import Any, Dict, Optional
import logging

import requests

from backend.config import POLY_GAMMA_URL, POLY_DATA_URL, POLY_CLOB_URL, POLY_API_KEY, POLY_API_SECRET


class PolymarketClient:
    def __init__(
        self,
        gamma_url: str = POLY_GAMMA_URL,
        data_url: str = POLY_DATA_URL,
        clob_url: str = POLY_CLOB_URL,
        api_key: str = POLY_API_KEY,
        api_secret: str = POLY_API_SECRET,
    ) -> None:
        self.gamma_url = gamma_url.rstrip("/")
        self.data_url = data_url.rstrip("/")
        self.clob_url = clob_url.rstrip("/")
        self.session = requests.Session()
        if api_key:
            self.session.headers.update({"X-API-KEY": api_key})
        if api_secret:
            self.session.headers.update({"X-API-SECRET": api_secret})
        self.logger = logging.getLogger("crypto_oracle.polymarket")

    def get_markets(self, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._get(f"{self.gamma_url}/markets", params=params)

    def get_orderbook(self, market_id: str) -> Dict[str, Any]:
        return self._get(f"{self.clob_url}/markets/{market_id}/orderbook")

    def get_contract_price(self, market_id: str, side: str = "buy") -> Optional[float]:
        orderbook = self.get_orderbook(market_id)
        book_side = "bids" if side == "sell" else "asks"
        levels = orderbook.get(book_side, [])
        if not levels:
            return None
        best = levels[0]
        price = best[0] if isinstance(best, (list, tuple)) else best.get("price")
        return float(price)

    def place_order(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._post(f"{self.clob_url}/orders", json=payload)

    def cancel_order(self, order_id: str) -> Dict[str, Any]:
        return self._delete(f"{self.clob_url}/orders/{order_id}")

    def _get(self, url: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        try:
            response = self.session.get(url, params=params, timeout=10)
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            self.logger.exception("Polymarket GET failed: %s", exc)
            raise

    def _post(self, url: str, json: Dict[str, Any]) -> Dict[str, Any]:
        try:
            response = self.session.post(url, json=json, timeout=10)
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            self.logger.exception("Polymarket POST failed: %s", exc)
            raise

    def _delete(self, url: str) -> Dict[str, Any]:
        try:
            response = self.session.delete(url, timeout=10)
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            self.logger.exception("Polymarket DELETE failed: %s", exc)
            raise
