// ─── POLYMARKET API v3 ─────────────────────────────────────────────────────
//
// Architecture — 2-phase fetch:
//   Phase 1 (Gamma): find the active BTC UP/DOWN market → get token IDs
//   Phase 2 (CLOB):  use token IDs for live price, spread, price history
//
// All price/spread/history endpoints are PUBLIC — no auth needed.
// Your Builder API key (VITE_POLY_API_KEY) is only used for order endpoints.
//
// Proxy config in vite.config.js routes these paths:
//   /polymarket/...      → https://gamma-api.polymarket.com/...
//   /polymarket-clob/... → https://clob.polymarket.com/...

const TIMEOUT_MS = 5000;

// ── Auth headers (available for future order endpoints) ───────────────────
export function getAuthHeaders() {
  const key  = import.meta.env?.VITE_POLY_API_KEY  || '';
  const addr = import.meta.env?.VITE_POLY_ADDRESS  || '';
  if (!key || key.includes('your-builder')) return {};
  return {
    'POLY-API-KEY':  key,
    'POLY-ADDRESS':  addr,
    'POLY-TIMESTAMP': Date.now().toString(),
  };
}

// ── Fetch with timeout ─────────────────────────────────────────────────────
async function timedFetch(url, opts = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'Accept': 'application/json', ...opts.headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `Timeout (${TIMEOUT_MS}ms)` : e.message);
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1: Gamma API — find active BTC market + token IDs
// ─────────────────────────────────────────────────────────────────────────────

async function findBTCMarket() {
  const urls = [
    '/polymarket/markets?tag=bitcoin&active=true&closed=false&limit=30',
    '/polymarket/markets?search=bitcoin+up+down+5&active=true&limit=30',
  ];
  for (const url of urls) {
    try {
      const data    = await timedFetch(url);
      const markets = Array.isArray(data) ? data : (data.markets || []);
      const match   = pickBestBTCMarket(markets);
      if (match) return match;
    } catch (e) {
      console.warn('[Poly/Gamma]', e.message);
    }
  }
  return null;
}

function isBTCUpDownMarket(q = '') {
  const lq = q.toLowerCase();
  return (lq.includes('bitcoin') || lq.includes('btc'))
    && (lq.includes('up or down') || lq.includes('up/down')
        || lq.includes('higher or lower') || lq.includes('5 min') || lq.includes('5min'));
}

function pickBestBTCMarket(markets) {
  const now = Date.now();
  return markets
    .filter(m => isBTCUpDownMarket(m.question))
    .map(m => {
      const endMs    = new Date(m.end_date_iso || m.endDate || m.endDateIso || 0).getTime();
      const minsLeft = (endMs - now) / 60000;
      let score = 0;
      if (minsLeft > 0  && minsLeft <= 5)   score += 10;
      else if (minsLeft > 0 && minsLeft <= 10) score += 7;
      else if (minsLeft > 0 && minsLeft <= 20) score += 4;
      else if (minsLeft > 0)                   score += 1;
      if (/\$[0-9,]+/.test(m.question || ''))  score += 4;
      const liq = parseFloat(m.liquidity || m.liquidityNum || 0);
      if (liq > 200000) score += 3;
      else if (liq > 85000) score += 1;
      if (m.tokens?.length >= 2)       score += 3;
      if (m.clobTokenIds?.length >= 2) score += 2;
      return { m, score, endMs };
    })
    .filter(x => x.endMs > now || x.endMs === 0)
    .sort((a, b) => b.score - a.score || a.endMs - b.endMs)[0]?.m || null;
}

function extractTokenIds(market) {
  const tokens = market.tokens || [];
  if (tokens.length >= 2) {
    const upT   = tokens.find(t => (t.outcome || '').toUpperCase().includes('UP'))   || tokens[0];
    const downT = tokens.find(t => (t.outcome || '').toUpperCase().includes('DOWN')) || tokens[1];
    const upId   = upT?.token_id   || upT?.tokenId;
    const downId = downT?.token_id || downT?.tokenId;
    if (upId && downId) return { upId, downId };
  }
  if (market.clobTokenIds?.length >= 2) {
    return { upId: market.clobTokenIds[0], downId: market.clobTokenIds[1] };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2: CLOB API — live price (public, no auth needed)
// ─────────────────────────────────────────────────────────────────────────────

// NOTE: /price is the reliable live odds endpoint.
// /book can return stale data for some markets — avoid for odds.
async function fetchLiveOdds(upId, downId) {
  const [upData, downData] = await Promise.all([
    timedFetch(`/polymarket-clob/price?token_id=${upId}&side=BUY`),
    timedFetch(`/polymarket-clob/price?token_id=${downId}&side=BUY`),
  ]);
  const upOdds   = Math.round(parseFloat(upData.price   || 0.5) * 100);
  const downOdds = Math.round(parseFloat(downData.price || 0.5) * 100);
  return { upOdds, downOdds };
}

// ── Spread signal — exported for signalEngine use ─────────────────────────
// Returns: { spreadCents, imbalance, quality }
// quality: 'TIGHT' (<3¢) | 'NORMAL' (3–8¢) | 'WIDE' (>8¢)
export async function fetchSpreadSignal(tokenId) {
  if (!tokenId) return null;
  try {
    const data        = await timedFetch(`/polymarket-clob/spread?token_id=${tokenId}`);
    const bid         = parseFloat(data.bid  || 0);
    const ask         = parseFloat(data.ask  || 0);
    const spreadCents = +((ask - bid) * 100).toFixed(2);

    // Depth imbalance from /book (best-effort — book can be stale so we use it
    // only for imbalance direction, not exact values)
    let imbalance = 0;
    try {
      const book     = await timedFetch(`/polymarket-clob/book?token_id=${tokenId}`);
      const bidDepth = (book.bids || []).slice(0, 5).reduce((a, b) => a + parseFloat(b.size || 0), 0);
      const askDepth = (book.asks || []).slice(0, 5).reduce((a, b) => a + parseFloat(b.size || 0), 0);
      const total    = bidDepth + askDepth;
      imbalance      = total > 0 ? +((bidDepth - askDepth) / total * 100).toFixed(1) : 0;
    } catch (_) { /* depth optional */ }

    return {
      spreadCents,
      imbalance,   // positive = more buyers (bullish pressure), negative = more sellers
      quality: spreadCents < 3 ? 'TIGHT' : spreadCents < 8 ? 'NORMAL' : 'WIDE',
    };
  } catch (e) {
    console.warn('[Poly/Spread]', e.message);
    return null;
  }
}

// ── Price history — last 1h odds trend ────────────────────────────────────
// Returns: [{ t, p, time }] — p in cents (0–100)
export async function fetchOddsHistory(tokenId) {
  if (!tokenId) return [];
  try {
    const data    = await timedFetch(`/polymarket-clob/prices-history?market=${tokenId}&interval=1h&fidelity=1`);
    const history = data.history || data || [];
    return history.map(pt => ({
      t:    pt.t * 1000,
      p:    Math.round(parseFloat(pt.p) * 100),
      time: new Date(pt.t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }));
  } catch (e) {
    console.warn('[Poly/History]', e.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT — full market fetch
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN ID CACHE — persist across sessions so hedge bot doesn't need a fresh
// Gamma fetch every time. Token IDs are stable for each market (days/weeks).
// ─────────────────────────────────────────────────────────────────────────────
const TOKEN_CACHE_KEY = 'bd_tokenIds';
const TOKEN_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

function loadCachedTokenIds() {
  try {
    const raw = localStorage.getItem(TOKEN_CACHE_KEY);
    if (!raw) return null;
    const { upId, downId, ts } = JSON.parse(raw);
    if (Date.now() - ts > TOKEN_CACHE_TTL) { localStorage.removeItem(TOKEN_CACHE_KEY); return null; }
    return { upId, downId };
  } catch { return null; }
}

function saveCachedTokenIds(ids) {
  try { localStorage.setItem(TOKEN_CACHE_KEY, JSON.stringify({ ...ids, ts: Date.now() })); } catch {}
}

export async function fetchActiveBTCMarket() {
  // Phase 1: find market
  let market = null;
  try {
    market = await findBTCMarket();
  } catch (e) {
    console.warn('[Poly] market search error:', e.message);
  }
  if (!market) return null;

  // Extract base info from Gamma
  const base    = extractGammaOdds(market);
  let tokenIds   = extractTokenIds(market);

  // Phase 1b: if Gamma didn't return token IDs, try localStorage cache
  if (!tokenIds) {
    const cached = loadCachedTokenIds();
    if (cached) {
      console.log('[Poly] Using cached token IDs');
      tokenIds = cached;
    }
  }

  // Phase 2: enrich with CLOB live price
  if (tokenIds) {
    try {
      const live  = await fetchLiveOdds(tokenIds.upId, tokenIds.downId);
      base.upOdds   = live.upOdds;
      base.downOdds = live.downOdds;
      base.tokenIds = tokenIds;
      base.source   = 'clob-live';
      saveCachedTokenIds(tokenIds); // persist on success
      console.log('[Poly] CLOB live odds:', live.upOdds, '↑ /', live.downOdds, '↓');
    } catch (e) {
      console.warn('[Poly] CLOB price fallback to Gamma:', e.message);
      // Still attach tokenIds even if price fetch failed — hedge bot needs them
      base.tokenIds = tokenIds;
      base.source   = 'gamma-fallback';
    }
  } else {
    base.source = 'gamma-no-tokens';
    console.warn('[Poly] No token IDs found in Gamma response. Fields:', Object.keys(market).join(', '));
  }

  return base;
}

// Separate enrichment — spread + history fetched after main load
// so the initial Auto fetch stays fast
export async function fetchMarketEnrichment(tokenId) {
  const [spreadResult, historyResult] = await Promise.allSettled([
    fetchSpreadSignal(tokenId),
    fetchOddsHistory(tokenId),
  ]);
  return {
    spread:  spreadResult.status  === 'fulfilled' ? spreadResult.value  : null,
    history: historyResult.status === 'fulfilled' ? historyResult.value : [],
  };
}

// ── Gamma odds extractor ──────────────────────────────────────────────────
function extractGammaOdds(market) {
  let upOdds = 50, downOdds = 50;
  const tokens = market.tokens || [];

  if (tokens.length >= 2) {
    const upT   = tokens.find(t => (t.outcome || '').toUpperCase().includes('UP'))   || tokens[0];
    const downT = tokens.find(t => (t.outcome || '').toUpperCase().includes('DOWN')) || tokens[1];
    upOdds   = Math.round(parseFloat(upT?.price   || upT?.lastTradePrice   || 0.5) * 100);
    downOdds = Math.round(parseFloat(downT?.price || downT?.lastTradePrice || 0.5) * 100);
  } else if (market.outcomePrices) {
    const prices = typeof market.outcomePrices === 'string'
      ? JSON.parse(market.outcomePrices) : market.outcomePrices;
    upOdds   = Math.round(parseFloat(prices[0] || 0.5) * 100);
    downOdds = Math.round(parseFloat(prices[1] || 0.5) * 100);
  }

  upOdds   = Math.max(1, Math.min(99, upOdds));
  downOdds = Math.max(1, Math.min(99, downOdds));
  if (Math.abs(upOdds + downOdds - 100) > 5) downOdds = 100 - upOdds;

  const liquidity = parseFloat(market.liquidity || market.liquidityNum || market.volume || 0);
  const endTime   = market.end_date_iso || market.endDate || market.endDateIso || '';
  const qMatch    = (market.question || '').match(/\$([0-9,]+(?:\.[0-9]+)?)/);
  const threshold = qMatch ? parseFloat(qMatch[1].replace(/,/g, '')) : null;

  return {
    id:          market.id || market.conditionId || market.marketId,
    question:    market.question,
    upOdds,
    downOdds,
    liquidity,
    endTime,
    threshold,
    lowLiquidity: liquidity > 0 && liquidity < 85000,
    source: 'gamma',
  };
}

export async function fetchMarketHistory(marketId) {
  try { return await timedFetch(`/polymarket/markets/${marketId}/history`); }
  catch (e) { console.warn('[Poly/History]', e.message); return null; }
}