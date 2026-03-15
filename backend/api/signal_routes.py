from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database.db import get_db
from backend.database import crud
from backend.database.schemas import SignalOut

router = APIRouter()


@router.get("/signals", response_model=list[SignalOut])
def get_signals(limit: int = 50, db: Session = Depends(get_db)) -> list[SignalOut]:
    return crud.get_signals(db, limit=limit)
