from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database.db import get_db
from backend.database import crud

router = APIRouter()


@router.get("/market")
def get_market(db: Session = Depends(get_db)) -> dict:
    item = crud.get_latest_market_data(db, symbol="BTCUSDT")
    if item is None:
        raise HTTPException(status_code=404, detail="No market data yet")
    return {
        "symbol": item.symbol,
        "price": item.price,
        "volume": item.volume,
        "timestamp": item.timestamp.isoformat(),
    }
