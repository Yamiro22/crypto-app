"""BTC 5-minute prediction engine."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import pandas as pd
from sqlalchemy.orm import Session

from backend.database import crud
from backend.database.schemas import PredictionCreate


@dataclass
class IndicatorBundle:
    rsi: Optional[float]
    macd: Optional[float]
    macd_hist: Optional[float]
    ma_fast: Optional[float]
    ma_slow: Optional[float]
    volume_ratio: Optional[float]


def _compute_rsi(series: pd.Series, period: int = 14) -> Optional[float]:
    if len(series) <= period:
        return None
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.rolling(window=period).mean().iloc[-1]
    avg_loss = loss.rolling(window=period).mean().iloc[-1]
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def compute_indicators(df: pd.DataFrame) -> IndicatorBundle:
    """Compute RSI, MACD, and moving averages for the price series."""
    prices = df["price"]
    volumes = df["volume"]

    rsi = _compute_rsi(prices)
    ema_fast = _ema(prices, 12)
    ema_slow = _ema(prices, 26)
    macd_line = ema_fast - ema_slow
    signal_line = _ema(macd_line, 9)
    macd = float(macd_line.iloc[-1]) if len(macd_line) else None
    macd_hist = float((macd_line - signal_line).iloc[-1]) if len(macd_line) else None

    ma_fast = float(prices.rolling(window=7).mean().iloc[-1]) if len(prices) >= 7 else None
    ma_slow = float(prices.rolling(window=21).mean().iloc[-1]) if len(prices) >= 21 else None

    volume_ratio = None
    if len(volumes) >= 10:
        avg_volume = volumes.rolling(window=10).mean().iloc[-1]
        if avg_volume and avg_volume > 0:
            volume_ratio = float(volumes.iloc[-1] / avg_volume)

    return IndicatorBundle(rsi, macd, macd_hist, ma_fast, ma_slow, volume_ratio)


def generate_prediction(
    db: Session,
    symbol: str = "BTCUSDT",
    timeframe: str = "5m",
) -> PredictionCreate:
    """Generate a short-term BTC direction prediction with confidence."""
    rows = crud.get_recent_market_data(db, symbol=symbol, limit=120)
    if len(rows) < 30:
        return PredictionCreate(
            symbol=symbol,
            timeframe=timeframe,
            prediction="SIDEWAYS",
            confidence=0.2,
        )

    df = pd.DataFrame(
        [{"price": row.price, "volume": row.volume} for row in rows]
    )
    indicators = compute_indicators(df)

    last_price = float(df["price"].iloc[-1])
    rsi = indicators.rsi
    macd_hist = indicators.macd_hist
    ma_fast = indicators.ma_fast
    ma_slow = indicators.ma_slow

    direction = "SIDEWAYS"
    if rsi is not None and macd_hist is not None and ma_fast is not None and ma_slow is not None:
        if macd_hist > 0 and ma_fast > ma_slow and rsi < 70:
            direction = "UP"
        elif macd_hist < 0 and ma_fast < ma_slow and rsi > 30:
            direction = "DOWN"

    rsi_score = 0.0 if rsi is None else abs(rsi - 50.0) / 50.0
    macd_score = 0.0
    if macd_hist is not None and last_price > 0:
        macd_score = min(abs(macd_hist) / (last_price * 0.001), 1.0)
    ma_score = 0.0
    if ma_fast is not None and ma_slow is not None and ma_slow > 0:
        ma_score = min(abs(ma_fast - ma_slow) / ma_slow * 5.0, 1.0)

    confidence = float(min(1.0, (rsi_score + macd_score + ma_score) / 3.0))
    if direction == "SIDEWAYS":
        confidence = min(confidence, 0.5)

    return PredictionCreate(
        symbol=symbol,
        timeframe=timeframe,
        prediction=direction,
        confidence=confidence,
    )
