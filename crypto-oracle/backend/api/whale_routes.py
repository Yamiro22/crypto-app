from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database.db import get_db
from backend.database.models import WhaleEvent

router = APIRouter()


@router.get("/whales")
def get_whale_events(limit: int = 50, db: Session = Depends(get_db)) -> list[dict]:
    rows = (
        db.query(WhaleEvent)
        .order_by(WhaleEvent.timestamp.desc())
        .limit(limit)
        .all()
    )

    return [
        {
            "id": row.id,
            "symbol": row.symbol,
            "event_type": row.event_type,
            "amount_btc": row.amount_btc,
            "sentiment": row.sentiment,
            "timestamp": row.timestamp.isoformat(),
        }
        for row in rows
    ]
