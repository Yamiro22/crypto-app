import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import LOG_LEVEL
from backend.database.db import init_db
from backend.services.market_service import MarketService
from backend.api.health import router as health_router
from backend.api.market import router as market_router
from backend.api.prediction import router as prediction_router
from backend.api.trading import router as trading_router
from backend.api.market_routes import router as legacy_market_router
from backend.api.signal_routes import router as legacy_signal_router
from backend.api.trade_routes import router as legacy_trade_router
from backend.api.whale_routes import router as legacy_whale_router

logging.basicConfig(level=LOG_LEVEL)
logger = logging.getLogger("crypto_oracle")

app = FastAPI(title="BabyDoge BTC Oracle v3")
market_service = MarketService()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup() -> None:
    init_db()
    market_service.start()
    logger.info("Database initialized and market collector started")


@app.on_event("shutdown")
async def on_shutdown() -> None:
    await market_service.stop()
    logger.info("Market collector stopped")


@app.get("/")
def root() -> dict:
    return {"status": "ok"}


app.include_router(health_router)
app.include_router(market_router)
app.include_router(prediction_router)
app.include_router(trading_router)
app.include_router(legacy_market_router)
app.include_router(legacy_signal_router)
app.include_router(legacy_trade_router)
app.include_router(legacy_whale_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
