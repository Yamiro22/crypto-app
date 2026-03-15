// Backend-driven price poller (replaces direct Binance WebSocket)
let pollTimer = null;
let isRunning = false;
let tickerCounter = 0;
const listeners = new Set();

const API_BASE = import.meta.env?.VITE_API_BASE || 'http://127.0.0.1:8000';

export function subscribePriceStream(callback) {
  listeners.add(callback);
  if (!isRunning) startPolling();
  return () => {
    listeners.delete(callback);
    if (listeners.size === 0) stopPolling();
  };
}

function notifyAll(data) {
  listeners.forEach(cb => { try { cb(data); } catch (_) {} });
}

async function pollOnce() {
  try {
    const res = await fetch(`${API_BASE}/market/btc`);
    if (!res.ok) throw new Error('market fetch failed');
    const data = await res.json();
    notifyAll({ type: 'status', connected: true });
    if (data?.price) {
      notifyAll({
        type: 'price',
        price: parseFloat(data.price),
        qty: parseFloat(data.volume || 0),
        time: data.timestamp ? Date.parse(data.timestamp) : Date.now(),
        isBuy: true,
      });
    }

    // refresh 24h stats every 5 polls
    tickerCounter += 1;
    if (tickerCounter >= 5) {
      tickerCounter = 0;
      const tRes = await fetch(`${API_BASE}/market/24hr?symbol=BTCUSDT`);
      if (tRes.ok) {
        const t = await tRes.json();
        const last = parseFloat(t.lastPrice || t.last_price || 0);
        const open = parseFloat(t.openPrice || t.open_price || 0);
        const change24h = open ? +(((last - open) / open) * 100).toFixed(3) : 0;
        notifyAll({
          type: 'ticker',
          price: last,
          open24h: open,
          high24h: parseFloat(t.highPrice || t.high_price || 0),
          low24h: parseFloat(t.lowPrice || t.low_price || 0),
          volume24h: parseFloat(t.volume || 0),
          change24h,
        });
      }
    }
  } catch (e) {
    notifyAll({ type: 'status', connected: false, error: true });
  }
}

function startPolling() {
  if (pollTimer) return;
  isRunning = true;
  pollOnce();
  pollTimer = setInterval(pollOnce, 2000);
}

function stopPolling() {
  isRunning = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

export function getStreamStatus() {
  return isRunning ? 1 : 3;
}
