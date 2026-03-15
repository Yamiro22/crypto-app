from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database.db import get_db
from backend.database import crud
from backend.database.schemas import AiStateIn, AiStateOut

router = APIRouter()


@router.get("/ai/state", response_model=AiStateOut)
def get_ai_state(db: Session = Depends(get_db)) -> AiStateOut:
    state = crud.get_ai_state(db)
    if not state:
        raise HTTPException(status_code=404, detail="AI state not found")
    return state


@router.post("/ai/state", response_model=AiStateOut)
def put_ai_state(payload: AiStateIn, db: Session = Depends(get_db)) -> AiStateOut:
    return crud.upsert_ai_state(db, payload.payload)
