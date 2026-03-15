# Execution Flow and Module Responsibilities

## High-level Flow
```
Binance WebSocket stream
  -> MarketService (services/market_service.py)
     -> feature_engine + signal_engine (strategies/scalp_engine.py)
     -> strategy_manager (strategies/strategy_manager.py)
     -> risk_engine kill-switch (risk/risk_engine.py)
     -> executor (execution/executor.py)
     -> database writes (database/crud.py)
```

## Module Responsibilities

### `services/binance_stream.py`
Maintains a WebSocket connection to Binance and yields `BinanceTick` objects.

### `services/market_service.py`
Main pipeline orchestrator.
- Persists market ticks to `market_data`.
- Refreshes whale events and sentiment.
- Periodically computes predictions and persists to `predictions`.
- Generates scalp signals and persists to `signals`.
- Applies kill-switch before any trade execution.
- Executes simulated trades and persists to `trades`.

### `ai/feature_engine.py`
Computes velocity, volatility, momentum, RSI, MACD, and volume spike.

### `ai/signal_engine.py`
Combines features + whale sentiment + divergence filters into a `SignalDecision`.

### `ai/divergence_detector.py`
Detects acceleration and liquidity sweeps to invalidate oscillator signals.

### `strategies/scalp_engine.py`
Thin orchestration layer that runs feature + signal logic and returns a scalp decision.

### `strategies/strategy_manager.py`
Combines prediction strategies with the scalp decision and picks the best signal.

### `risk/risk_engine.py`
Implements the kill-switch and tiered exit calculations.

### `execution/executor.py`
Simulates trade execution and writes trades to the database.

### `database/*`
SQLAlchemy models + CRUD helpers for market data, predictions, signals, trades, and AI state.
