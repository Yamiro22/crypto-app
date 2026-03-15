from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class UserCreate(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    created_at: datetime

    class Config:
        from_attributes = True


class PredictionRequest(BaseModel):
    symbol: str = "BTCUSDT"
    timeframe: str = "5m"


class PredictionCreate(BaseModel):
    symbol: str
    timeframe: str
    prediction: str
    confidence: float


class PredictionOut(PredictionCreate):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class SignalCreate(BaseModel):
    symbol: str
    direction: str
    confidence: float
    reason: str | None = None


class SignalOut(SignalCreate):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class MarketDataOut(BaseModel):
    id: int
    symbol: str
    price: float
    volume: float
    timestamp: datetime

    class Config:
        from_attributes = True


class TradeSimulationRequest(BaseModel):
    user_id: Optional[int] = None
    symbol: str = "BTCUSDT"
    side: str = Field(..., pattern="^(buy|sell)$")
    size: float
    entry_price: float
    signal: Optional[str] = None


class TradeOut(BaseModel):
    id: int
    user_id: Optional[int]
    symbol: str
    side: str
    size: float
    entry_price: float
    exit_price: Optional[float]
    pnl: Optional[float]
    created_at: datetime

    class Config:
        from_attributes = True


class AiStateIn(BaseModel):
    payload: dict


class AiStateOut(AiStateIn):
    id: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
