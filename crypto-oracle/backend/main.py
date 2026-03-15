import logging

from fastapi import FastAPI

from backend.config import LOG_LEVEL
from backend.database.db import init_db
from backend.api.market_routes import router as market_router
from backend.api.signal_routes import router as signal_router
from backend.api.trade_routes import router as trade_router
from backend.api.whale_routes import router as whale_router

logging.basicConfig(level=LOG_LEVEL)
logger = logging.getLogger("crypto_oracle")

app = FastAPI(title="BabyDoge BTC Oracle v3")


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    logger.info("Database initialized")


@app.get("/")
def health() -> dict:
    return {"status": "ok"}


app.include_router(market_router)
app.include_router(signal_router)
app.include_router(trade_router)
app.include_router(whale_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
