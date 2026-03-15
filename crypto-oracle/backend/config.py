import os


def _get_env(name: str, default: str) -> str:
    value = os.getenv(name)
    return value if value is not None and value != "" else default


DATABASE_URL = _get_env(
    "DATABASE_URL",
    "postgresql+psycopg2://postgres:postgres@localhost:5432/crypto_oracle",
)

BINANCE_SYMBOL = _get_env("BINANCE_SYMBOL", "BTCUSDT")
BINANCE_STREAM_URL = _get_env("BINANCE_STREAM_URL", "wss://stream.binance.com:9443")

POLY_GAMMA_URL = _get_env("POLY_GAMMA_URL", "https://gamma-api.polymarket.com")
POLY_DATA_URL = _get_env("POLY_DATA_URL", "https://data-api.polymarket.com")
POLY_CLOB_URL = _get_env("POLY_CLOB_URL", "https://clob.polymarket.com")
POLY_API_KEY = _get_env("POLY_API_KEY", "")
POLY_API_SECRET = _get_env("POLY_API_SECRET", "")

TELEGRAM_BOT_TOKEN = _get_env("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = _get_env("TELEGRAM_CHAT_ID", "")

LOG_LEVEL = _get_env("LOG_LEVEL", "INFO")

VELOCITY_LOOKBACK = int(_get_env("VELOCITY_LOOKBACK", "5"))
VELOCITY_THRESHOLD = float(_get_env("VELOCITY_THRESHOLD", "0.30"))
RSI_PERIOD = int(_get_env("RSI_PERIOD", "14"))
RSI_UPPER = float(_get_env("RSI_UPPER", "70"))
RSI_LOWER = float(_get_env("RSI_LOWER", "30"))
WHALE_OVERRIDE_THRESHOLD = float(_get_env("WHALE_OVERRIDE_THRESHOLD", "0.4"))

KILL_SWITCH_VARIANCE = float(_get_env("KILL_SWITCH_VARIANCE", "0.02"))
KILL_SWITCH_WINDOW_SECONDS = int(_get_env("KILL_SWITCH_WINDOW_SECONDS", "20"))

TIER1_TARGET_MULTIPLE = float(_get_env("TIER1_TARGET_MULTIPLE", "2.0"))
TIER2_LIMIT_PRICE = float(_get_env("TIER2_LIMIT_PRICE", "0.90"))
