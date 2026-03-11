// ─── BINANCE WEBSOCKET STREAM ─────────────────────────────────────────────────
// Real-time BTC price + trade stream via WebSocket

let ws = null;
let reconnectTimer = null;
let isRunning = false;
const listeners = new Set();

export function subscribePriceStream(callback) {
  listeners.add(callback);
  if (!isRunning) startStream();
  return () => {
    listeners.delete(callback);
    if (listeners.size === 0) stopStream();
  };
}

function notifyAll(data) {
  listeners.forEach(cb => { try { cb(data); } catch (e) {} });
}

function startStream() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  isRunning = true;

  // Binance trade stream + miniTicker combined stream
  // Uses Vite proxy (/binance-ws → wss://stream.binance.com:9443) to avoid CORS/WS blocks
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const streamUrl = `${wsProtocol}//${window.location.host}/binance-ws/stream?streams=btcusdt@trade/btcusdt@miniTicker`;

  try {
    ws = new WebSocket(streamUrl);

    ws.onopen = () => {
      console.log('[BinanceWS] Connected to live stream');
      notifyAll({ type: 'status', connected: true });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const stream = msg.stream || '';
        const data = msg.data || msg;

        if (stream.includes('trade')) {
          notifyAll({
            type: 'price',
            price: parseFloat(data.p),
            qty:   parseFloat(data.q),
            time:  data.T,
            isBuy: !data.m, // maker side = sell side, so !m = buyer
          });
        } else if (stream.includes('miniTicker') || data.e === '24hrMiniTicker') {
          notifyAll({
            type: 'ticker',
            price:     parseFloat(data.c),
            open24h:   parseFloat(data.o),
            high24h:   parseFloat(data.h),
            low24h:    parseFloat(data.l),
            volume24h: parseFloat(data.v),
            change24h: +((parseFloat(data.c) - parseFloat(data.o)) / parseFloat(data.o) * 100).toFixed(3),
          });
        }
      } catch (e) {
        console.warn('[BinanceWS] parse error:', e.message);
      }
    };

    ws.onerror = (e) => {
      console.warn('[BinanceWS] error — falling back to polling');
      notifyAll({ type: 'status', connected: false, error: true });
    };

    ws.onclose = () => {
      console.log('[BinanceWS] disconnected');
      notifyAll({ type: 'status', connected: false });
      if (isRunning) {
        reconnectTimer = setTimeout(() => startStream(), 5000);
      }
    };
  } catch (e) {
    console.warn('[BinanceWS] WebSocket unavailable:', e.message);
    notifyAll({ type: 'status', connected: false, error: true });
  }
}

function stopStream() {
  isRunning = false;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
}

export function getStreamStatus() {
  return ws ? ws.readyState : WebSocket.CLOSED;
}