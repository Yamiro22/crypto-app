const API_BASE = import.meta.env?.VITE_API_BASE || 'http://127.0.0.1:8000';

export async function requestPrediction(symbol = 'BTCUSDT', timeframe = '5m') {
  try {
    const res = await fetch(`${API_BASE}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, timeframe }),
    });
    if (!res.ok) throw new Error(`predict failed: ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('[BackendAPI] predict error:', e.message);
    return null;
  }
}

export async function simulateTrade(payload) {
  try {
    const res = await fetch(`${API_BASE}/trade/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`simulate failed: ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('[BackendAPI] simulate error:', e.message);
    return null;
  }
}

export async function fetchTrades(limit = 50) {
  try {
    const res = await fetch(`${API_BASE}/trades?limit=${limit}`);
    if (!res.ok) throw new Error(`trades failed: ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('[BackendAPI] trades error:', e.message);
    return [];
  }
}
