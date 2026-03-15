from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.config import BINANCE_SYMBOL
from backend.database.db import get_db
from backend.database.models import MarketTick

router = APIRouter()


@router.get("/market")
def get_market(db: Session = Depends(get_db)) -> dict:
    tick = (
        db.query(MarketTick)
        .filter(MarketTick.symbol == BINANCE_SYMBOL)
        .order_by(MarketTick.tick_timestamp.desc())
        .first()
    )
    if tick is None:
        return {
            "symbol": BINANCE_SYMBOL,
            "price": None,
            "volume": None,
            "timestamp": None,
        }

    return {
        "symbol": tick.symbol,
        "price": tick.price,
        "volume": tick.volume,
        "timestamp": tick.tick_timestamp.isoformat(),
    }
