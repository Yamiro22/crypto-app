from dataclasses import dataclass
from typing import Optional
import logging

from backend.ai.feature_engine import FeatureSet
from backend.ai.divergence_detector import DivergenceSignal
from backend.config import VELOCITY_THRESHOLD, RSI_LOWER, RSI_UPPER
from backend.services.whale_monitor import WhaleMonitor


@dataclass
class SignalDecision:
    direction: Optional[str]
    confidence: float
    reason: str


logger = logging.getLogger("crypto_oracle.signal")


def evaluate_signal(
    features: FeatureSet,
    whale_sentiment: float,
    divergence: DivergenceSignal,
    whale_monitor: WhaleMonitor,
) -> SignalDecision:
    if divergence.invalidate:
        decision = SignalDecision(None, 0.0, "divergence_spike")
        logger.info("signal_decision=%s confidence=%.3f", decision.direction, decision.confidence)
        return decision

    velocity = features.price_velocity
    rsi = features.rsi
    macd_hist = features.macd_hist

    if rsi is None or macd_hist is None:
        decision = SignalDecision(None, 0.0, "insufficient_data")
        logger.info("signal_decision=%s confidence=%.3f", decision.direction, decision.confidence)
        return decision

    if velocity <= -VELOCITY_THRESHOLD:
        if whale_monitor.down_signals_blocked(whale_sentiment):
            decision = SignalDecision(None, 0.0, "whale_override")
            logger.info("signal_decision=%s confidence=%.3f", decision.direction, decision.confidence)
            return decision
        if rsi <= RSI_LOWER:
            decision = SignalDecision(None, 0.0, "rsi_floor")
            logger.info("signal_decision=%s confidence=%.3f", decision.direction, decision.confidence)
            return decision
        if macd_hist >= 0:
            decision = SignalDecision(None, 0.0, "macd_not_bearish")
            logger.info("signal_decision=%s confidence=%.3f", decision.direction, decision.confidence)
            return decision
        confidence = min(1.0, abs(velocity) + (rsi - RSI_LOWER) / 100.0)
        decision = SignalDecision("DOWN", confidence, "velocity_drop")
        logger.info("signal_decision=%s confidence=%.3f", decision.direction, decision.confidence)
        return decision

    if velocity >= VELOCITY_THRESHOLD:
        if rsi >= RSI_UPPER:
            decision = SignalDecision(None, 0.0, "rsi_ceiling")
            logger.info("signal_decision=%s confidence=%.3f", decision.direction, decision.confidence)
            return decision
        if macd_hist <= 0:
            decision = SignalDecision(None, 0.0, "macd_not_bullish")
            logger.info("signal_decision=%s confidence=%.3f", decision.direction, decision.confidence)
            return decision
        confidence = min(1.0, velocity + (RSI_UPPER - rsi) / 100.0)
        decision = SignalDecision("UP", confidence, "velocity_rise")
        logger.info("signal_decision=%s confidence=%.3f", decision.direction, decision.confidence)
        return decision

    decision = SignalDecision(None, 0.0, "velocity_below_threshold")
    logger.info("signal_decision=%s confidence=%.3f", decision.direction, decision.confidence)
    return decision
