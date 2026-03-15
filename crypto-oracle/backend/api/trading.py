from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.database.db import get_db
from backend.database.schemas import TradeOut, TradeSimulationRequest
from backend.execution.executor import simulate_trade
from backend.risk.risk_manager import RiskManager

router = APIRouter()


@router.post("/trade/simulate", response_model=TradeOut)
def simulate_trade_endpoint(
    payload: TradeSimulationRequest,
    db: Session = Depends(get_db),
) -> TradeOut:
    trade = simulate_trade(db, payload, risk_manager=RiskManager())
    return trade
