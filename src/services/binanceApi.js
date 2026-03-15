// ─── BINANCE REST API SERVICE ─────────────────────────────────────────────────
import { calcMACD, calcRSI, calcStochRSI, calcBB, calcSupertrend, calcVWAP } from '../utils/indicators.js';

const API_BASE = import.meta.env?.VITE_API_BASE || 'http://127.0.0.1:8000';
const TFS = ['1m', '5m', '15m', '30m', '1h', '4h'];

async function fetchKlines(symbol, interval, limit = 200) {
  const url = `${API_BASE}/market/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance klines ${interval} failed: ${res.status}`);
  return res.json();
}

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
  const results = {};
  const errors = [];

  await Promise.allSettled(TFS.map(async (tf) => {
    try {
      const klines = await fetchKlines('BTCUSDT', tf, 200);
      const opens   = klines.map(k => parseFloat(k[1]));
      const highs   = klines.map(k => parseFloat(k[2]));
      const lows    = klines.map(k => parseFloat(k[3]));
      const closes  = klines.map(k => parseFloat(k[4]));
      const volumes = klines.map(k => parseFloat(k[5]));
      const times   = klines.map(k => k[0]);

      results[tf] = {
        opens, highs, lows, closes, volumes, times,
        price:    closes[closes.length - 1],
        macd:     calcMACD(closes),
        rsi:      calcRSI(closes),
        stochRSI: calcStochRSI(closes),
        bb:       calcBB(closes),
        supertrend: calcSupertrend(highs, lows, closes),
        vwap:     calcVWAP(highs, lows, closes, volumes),
        // OHLCV for chart (last 60 candles)
        candles: klines.slice(-60).map(k => ({
          time:   k[0],
          open:   parseFloat(k[1]),
          high:   parseFloat(k[2]),
          low:    parseFloat(k[3]),
          close:  parseFloat(k[4]),
          volume: parseFloat(k[5]),
        })),
      };
    } catch (e) {
      errors.push(tf);
      console.error(`[BinanceAPI] ${tf} error:`, e.message);
    }
  }));

  return { data: results, errors };
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
