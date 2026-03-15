from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database.db import get_db
from backend.database import crud

router = APIRouter()


@router.get("/signals")
def get_signals(limit: int = 50, db: Session = Depends(get_db)) -> list[dict]:
    rows = crud.get_predictions(db, limit=limit)
    return [
        {
            "id": row.id,
            "symbol": row.symbol,
            "direction": row.prediction,
            "confidence": row.confidence,
            "timeframe": row.timeframe,
            "timestamp": row.created_at.isoformat(),
        }
        for row in rows
    ]
