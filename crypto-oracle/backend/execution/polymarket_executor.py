from typing import Any, Dict
import logging

from backend.services.polymarket_client import PolymarketClient


class PolymarketExecutor:
    def __init__(self, client: PolymarketClient | None = None) -> None:
        self.client = client or PolymarketClient()
        self.logger = logging.getLogger("crypto_oracle.executor")

    def open_position(self, market_id: str, side: str, size: float, price: float) -> Dict[str, Any]:
        payload = {
            "marketId": market_id,
            "side": side,
            "size": size,
            "price": price,
        }
        response = self.client.place_order(payload)
        self.logger.info("trade_opened market=%s side=%s size=%.4f price=%.4f", market_id, side, size, price)
        return response

    def close_position(self, order_id: str) -> Dict[str, Any]:
        response = self.client.cancel_order(order_id)
        self.logger.info("trade_closed order_id=%s", order_id)
        return response

    def limit_sell(self, market_id: str, size: float, price: float) -> Dict[str, Any]:
        payload = {
            "marketId": market_id,
            "side": "sell",
            "size": size,
            "price": price,
        }
        response = self.client.place_order(payload)
        self.logger.info("limit_sell market=%s size=%.4f price=%.4f", market_id, size, price)
        return response
