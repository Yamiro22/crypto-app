from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database.db import get_db
from backend.database import crud
from backend.database.schemas import MarketDataOut

router = APIRouter()


@router.get("/market/btc", response_model=MarketDataOut)
def get_btc_market(db: Session = Depends(get_db)) -> MarketDataOut:
    item = crud.get_latest_market_data(db, symbol="BTCUSDT")
    if item is None:
        raise HTTPException(status_code=404, detail="No market data yet")
    return item
