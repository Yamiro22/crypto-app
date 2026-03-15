// ─── BINANCE REST API SERVICE ─────────────────────────────────────────────────
const API_BASE = import.meta.env?.VITE_API_BASE || 'http://127.0.0.1:8000';
const TFS = ['1m', '5m', '15m', '30m', '1h', '4h'];

async function fetchTicker(symbol) {
  const res = await fetch(`${API_BASE}/market/24hr?symbol=${symbol}`);
  if (!res.ok) throw new Error(`Binance ticker failed: ${res.status}`);
  return res.json();
}

export async function fetchBTCPrice() {
  try {
    const res = await fetch(`${API_BASE}/market/btc`);
    if (!res.ok) throw new Error('price fetch failed');
    const data = await res.json();
    return parseFloat(data.price);
  } catch (e) {
    console.error('[BinanceAPI] price error:', e.message);
    return null;
  }
}

export async function fetchAllTimeframes() {
  try {
    const res = await fetch(`${API_BASE}/market/timeframes?symbol=BTCUSDT&limit=200`);
    if (!res.ok) throw new Error(`timeframes failed: ${res.status}`);
    const data = await res.json();
    return { data, errors: [] };
  } catch (e) {
    console.error('[BinanceAPI] timeframes error:', e.message);
    return { data: {}, errors: TFS };
  }
}

export async function fetch24hrStats() {
  try {
    const data = await fetchTicker('BTCUSDT');
    return {
      change24h:   +parseFloat(data.priceChangePercent).toFixed(2),
      high24h:     parseFloat(data.highPrice),
      low24h:      parseFloat(data.lowPrice),
      volume24h:   parseFloat(data.volume),
      quoteVolume: parseFloat(data.quoteVolume),
    };
  } catch (e) {
    console.error('[BinanceAPI] 24hr stats error:', e.message);
    return null;
  }
}
