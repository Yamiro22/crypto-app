from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.ai.predictor import generate_prediction
from backend.database import crud
from backend.database.db import get_db
from backend.database.schemas import PredictionRequest, PredictionOut

router = APIRouter()


@router.post("/predict", response_model=PredictionOut)
def create_prediction(
    payload: PredictionRequest,
    db: Session = Depends(get_db),
) -> PredictionOut:
    prediction = generate_prediction(db, symbol=payload.symbol, timeframe=payload.timeframe)
    stored = crud.create_prediction(db, prediction)
    return stored


@router.get("/predictions", response_model=list[PredictionOut])
def list_predictions(
    limit: int = 50,
    db: Session = Depends(get_db),
) -> list[PredictionOut]:
    return crud.get_predictions(db, limit=limit)
