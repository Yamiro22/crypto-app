from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database.db import get_db
from backend.database.models import Signal

router = APIRouter()


@router.get("/signals")
def get_signals(limit: int = 50, db: Session = Depends(get_db)) -> list[dict]:
    rows = (
        db.query(Signal)
        .order_by(Signal.timestamp.desc())
        .limit(limit)
        .all()
    )

    return [
        {
            "id": row.id,
            "symbol": row.symbol,
            "direction": row.direction,
            "confidence": row.confidence,
            "price_velocity": row.price_velocity,
            "rsi": row.rsi,
            "macd": row.macd,
            "whale_sentiment": row.whale_sentiment,
            "timestamp": row.timestamp.isoformat(),
        }
        for row in rows
    ]
