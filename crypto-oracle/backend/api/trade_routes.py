from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database.db import get_db
from backend.database.models import Trade

router = APIRouter()


@router.get("/trades")
def get_trades(limit: int = 50, db: Session = Depends(get_db)) -> list[dict]:
    rows = (
        db.query(Trade)
        .order_by(Trade.timestamp.desc())
        .limit(limit)
        .all()
    )

    return [
        {
            "id": row.id,
            "symbol": row.symbol,
            "direction": row.direction,
            "entry_price": row.entry_price,
            "exit_price": row.exit_price,
            "size": row.size,
            "profit": row.profit,
            "status": row.status,
            "timestamp": row.timestamp.isoformat(),
        }
        for row in rows
    ]
