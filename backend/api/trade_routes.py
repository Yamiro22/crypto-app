from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database.db import get_db
from backend.database import crud

router = APIRouter()


@router.get("/trades")
def get_trades(limit: int = 50, db: Session = Depends(get_db)) -> list[dict]:
    rows = crud.get_trades(db, limit=limit)
    return [
        {
            "id": row.id,
            "user_id": row.user_id,
            "symbol": row.symbol,
            "side": row.side,
            "size": row.size,
            "entry_price": row.entry_price,
            "exit_price": row.exit_price,
            "pnl": row.pnl,
            "timestamp": row.created_at.isoformat(),
        }
        for row in rows
    ]
