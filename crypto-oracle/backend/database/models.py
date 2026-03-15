from datetime import datetime

from sqlalchemy import Column, DateTime, Float, Integer, String, JSON
from sqlalchemy.orm import declarative_base

Base = declarative_base()


def utcnow() -> datetime:
    return datetime.utcnow()


class Signal(Base):
    __tablename__ = "signals"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), index=True, nullable=False)
    direction = Column(String(10), nullable=False)
    confidence = Column(Float, nullable=False)
    price_velocity = Column(Float, nullable=True)
    rsi = Column(Float, nullable=True)
    macd = Column(Float, nullable=True)
    whale_sentiment = Column(Float, nullable=True)
    meta = Column(JSON, nullable=True)
    timestamp = Column(DateTime, default=utcnow, index=True)


class Trade(Base):
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), index=True, nullable=False)
    direction = Column(String(10), nullable=False)
    entry_price = Column(Float, nullable=False)
    exit_price = Column(Float, nullable=True)
    size = Column(Float, nullable=False)
    profit = Column(Float, nullable=True)
    status = Column(String(20), nullable=False, default="open")
    meta = Column(JSON, nullable=True)
    timestamp = Column(DateTime, default=utcnow, index=True)


class WhaleEvent(Base):
    __tablename__ = "whale_events"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), index=True, nullable=False)
    event_type = Column(String(20), nullable=False)
    amount_btc = Column(Float, nullable=False)
    sentiment = Column(Float, nullable=False)
    meta = Column(JSON, nullable=True)
    timestamp = Column(DateTime, default=utcnow, index=True)


class MarketTick(Base):
    __tablename__ = "market_ticks"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(20), index=True, nullable=False)
    price = Column(Float, nullable=False)
    volume = Column(Float, nullable=False)
    tick_timestamp = Column(DateTime, nullable=False)
    meta = Column(JSON, nullable=True)
    timestamp = Column(DateTime, default=utcnow, index=True)
