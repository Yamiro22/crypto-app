from __future__ import annotations

from datetime import datetime
from typing import Optional
import hashlib

from sqlalchemy.orm import Session

from backend.database import models
from backend.database.schemas import PredictionCreate


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def create_user(db: Session, email: str, password: str) -> models.User:
    user = models.User(email=email, password_hash=_hash_password(password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_user_by_email(db: Session, email: str) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.email == email).first()


def create_prediction(db: Session, prediction: PredictionCreate) -> models.Prediction:
    item = models.Prediction(
        symbol=prediction.symbol,
        timeframe=prediction.timeframe,
        prediction=prediction.prediction,
        confidence=prediction.confidence,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def get_predictions(db: Session, limit: int = 50) -> list[models.Prediction]:
    return (
        db.query(models.Prediction)
        .order_by(models.Prediction.created_at.desc())
        .limit(limit)
        .all()
    )


def create_market_data(
    db: Session,
    symbol: str,
    price: float,
    volume: float,
    timestamp: datetime,
) -> models.MarketData:
    item = models.MarketData(
        symbol=symbol,
        price=price,
        volume=volume,
        timestamp=timestamp,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def get_latest_market_data(db: Session, symbol: str) -> Optional[models.MarketData]:
    return (
        db.query(models.MarketData)
        .filter(models.MarketData.symbol == symbol)
        .order_by(models.MarketData.timestamp.desc())
        .first()
    )


def get_recent_market_data(db: Session, symbol: str, limit: int = 200) -> list[models.MarketData]:
    return (
        db.query(models.MarketData)
        .filter(models.MarketData.symbol == symbol)
        .order_by(models.MarketData.timestamp.desc())
        .limit(limit)
        .all()[::-1]
    )


def create_trade(
    db: Session,
    user_id: Optional[int],
    symbol: str,
    side: str,
    size: float,
    entry_price: float,
    exit_price: Optional[float],
    pnl: Optional[float],
) -> models.Trade:
    trade = models.Trade(
        user_id=user_id,
        symbol=symbol,
        side=side,
        size=size,
        entry_price=entry_price,
        exit_price=exit_price,
        pnl=pnl,
    )
    db.add(trade)
    db.commit()
    db.refresh(trade)
    return trade


def get_trades(db: Session, limit: int = 50) -> list[models.Trade]:
    return (
        db.query(models.Trade)
        .order_by(models.Trade.created_at.desc())
        .limit(limit)
        .all()
    )
