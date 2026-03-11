/**
 * ============================================================
 * polymarketApi.js  —  BabyDoge BTC Oracle v3
 * Two-Way Trading: Buy + Sell via Polymarket CLOB API
 * ============================================================
 *
 * ARCHITECTURE NOTE:
 *   All requests go through the Vite dev-proxy (/api/polymarket)
 *   to avoid CORS issues in the browser. In production, swap
 *   BASE_URL and CLOB_URL for your own back-end proxy.
 *
 * KEY ADDITIONS IN THIS VERSION:
 *   • sellPosition()  — market-sell any open token position
 *   • buyPosition()   — returns { asset_id, order_id } so the
 *                       caller can track & later sell the token
 *   • getTokenBidPrice() — live bid for any outcome token
 *   • getOrderBook()  — full depth-of-book for a token
 * ============================================================
 */

// ── Proxy routes configured in vite.config.js ───────────────
const GAMMA_BASE  = '/api/gamma';   // Gamma metadata API
const CLOB_BASE   = '/api/clob';    // CLOB order-book API

// ── Polymarket outcome token decimals (USDC = 6 decimals) ───
const USDC_DECIMALS = 1_000_000;

// ── Slippage tolerance for market orders (0.5 %) ────────────
const SLIPPAGE_BPS = 50; // 50 basis-points

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Generic fetch wrapper with timeout & JSON parsing.
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} timeoutMs
 */
async function apiFetch(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Build a minimal CLOB order payload.
 * Polymarket CLOB expects price in [0, 1] range (not cents).
 *
 * @param {string}  asset_id   - Outcome token contract address
 * @param {'BUY'|'SELL'} side
 * @param {number}  price      - e.g. 0.72 = 72 ¢
 * @param {number}  usdcAmount - Dollar amount to spend / receive
 */
function buildOrder(asset_id, side, price, usdcAmount) {
  // Convert dollar amount → token quantity
  // BUY:  qty = usdcAmount / price
  // SELL: qty = usdcAmount (you're selling tokens worth ~$usdcAmount)
  const qty =
    side === 'BUY'
      ? (usdcAmount / price).toFixed(4)
      : usdcAmount.toFixed(4);

  // Apply slippage: BUY pays slightly more, SELL accepts slightly less
  const slippageFactor = side === 'BUY'
    ? 1 + SLIPPAGE_BPS / 10_000
    : 1 - SLIPPAGE_BPS / 10_000;

  const worstPrice = Math.min(
    1,
    Math.max(0, parseFloat((price * slippageFactor).toFixed(4)))
  );

  return {
    asset_id,
    side,
    type: 'MARKET',
    price: worstPrice,
    size: parseFloat(qty),
    time_in_force: 'IOC', // Immediate-Or-Cancel → no resting orders
  };
}

// ─────────────────────────────────────────────────────────────
//  GAMMA API  (market metadata, event IDs, token IDs)
// ─────────────────────────────────────────────────────────────

/**
 * Fetch active BTC end-of-day / 5-minute markets from Gamma.
 * Returns an array of market objects with their outcome token IDs.
 *
 * @param {string} slug - e.g. 'will-btc-price-be-above-X-at-Y'
 */
export async function fetchMarkets(slug = 'btc') {
  try {
    const data = await apiFetch(
      `${GAMMA_BASE}/markets?tag=${encodeURIComponent(slug)}&active=true&limit=20`
    );
    return data?.markets ?? data ?? [];
  } catch (err) {
    console.error('[polymarketApi] fetchMarkets error:', err.message);
    return [];
  }
}

/**
 * Fetch a single market by Gamma market ID.
 * Returns the full market object including clobTokenIds array:
 *   clobTokenIds[0] = YES token asset_id
 *   clobTokenIds[1] = NO  token asset_id
 */
export async function fetchMarketById(marketId) {
  try {
    const data = await apiFetch(`${GAMMA_BASE}/markets/${marketId}`);
    return data;
  } catch (err) {
    console.error('[polymarketApi] fetchMarketById error:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  CLOB API  (live prices, order book, trading)
// ─────────────────────────────────────────────────────────────

/**
 * Get the full order-book for a token.
 * Returns { bids: [{price, size}], asks: [{price, size}] }
 *
 * @param {string} asset_id - Outcome token contract address
 */
export async function getOrderBook(asset_id) {
  try {
    const data = await apiFetch(
      `${CLOB_BASE}/book?token_id=${encodeURIComponent(asset_id)}`
    );
    return data;
  } catch (err) {
    console.error('[polymarketApi] getOrderBook error:', err.message);
    return { bids: [], asks: [] };
  }
}

/**
 * Get the current best BID price for a token (in dollars, 0–1).
 * This is the price someone would PAY US if we want to exit.
 *
 * Used by positionManager.js to monitor take-profit / stop-loss.
 *
 * @param {string} asset_id
 * @returns {number} bid price, e.g. 0.82 = 82 ¢  (0 if no data)
 */
export async function getTokenBidPrice(asset_id) {
  try {
    const book = await getOrderBook(asset_id);
    if (!book?.bids?.length) return 0;

    // Sort descending and return the best (highest) bid
    const sorted = [...book.bids].sort((a, b) => b.price - a.price);
    return parseFloat(sorted[0].price) || 0;
  } catch (err) {
    console.error('[polymarketApi] getTokenBidPrice error:', err.message);
    return 0;
  }
}

/**
 * Get the current best ASK price for a token (what we pay to BUY).
 *
 * @param {string} asset_id
 * @returns {number} ask price, e.g. 0.55 = 55 ¢
 */
export async function getTokenAskPrice(asset_id) {
  try {
    const book = await getOrderBook(asset_id);
    if (!book?.asks?.length) return 1;

    // Sort ascending and return the best (lowest) ask
    const sorted = [...book.asks].sort((a, b) => a.price - b.price);
    return parseFloat(sorted[0].price) || 1;
  } catch (err) {
    console.error('[polymarketApi] getTokenAskPrice error:', err.message);
    return 1;
  }
}

// ─────────────────────────────────────────────────────────────
//  BUY POSITION
// ─────────────────────────────────────────────────────────────

/**
 * Place a market BUY order on the CLOB.
 *
 * IMPORTANT: Returns { asset_id, order_id, entryPrice, usdcSpent }
 * so App.jsx can store asset_id in state for later exit via sellPosition().
 *
 * @param {string} asset_id   - YES or NO token address
 * @param {number} usdcAmount - How many USDC to spend
 * @param {number} price      - Current ask price (for slippage calc)
 * @returns {object|null}
 */
export async function buyPosition(asset_id, usdcAmount, price) {
  if (!asset_id || usdcAmount <= 0) {
    console.warn('[polymarketApi] buyPosition: invalid params');
    return null;
  }

  const order = buildOrder(asset_id, 'BUY', price, usdcAmount);

  try {
    console.info(
      `[polymarketApi] BUY  asset=${asset_id.slice(0, 10)}…  ` +
      `qty=${order.size}  price≤${order.price}  usdc=$${usdcAmount}`
    );

    const result = await apiFetch(`${CLOB_BASE}/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });

    if (!result?.order_id) {
      throw new Error('No order_id returned from CLOB');
    }

    return {
      asset_id,                      // ← CRITICAL: stored in App state
      order_id:   result.order_id,
      entryPrice: order.price,
      usdcSpent:  usdcAmount,
      timestamp:  Date.now(),
      side:       'BUY',
    };
  } catch (err) {
    console.error('[polymarketApi] buyPosition failed:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  SELL POSITION  (NEW — the key addition for early-exit)
// ─────────────────────────────────────────────────────────────

/**
 * Market-sell an open position back to the CLOB order book.
 *
 * Called by positionManager.js when:
 *   • Take-Profit: bid >= TAKE_PROFIT_THRESHOLD (default 85 ¢)
 *   • Stop-Loss:   bid <= STOP_LOSS_THRESHOLD   (default 15 ¢)
 *                  AND confirming MACD crossover against position
 *
 * @param {string} asset_id   - The exact token address from buyPosition()
 * @param {number} tokenQty   - How many tokens to sell (from buy receipt)
 * @param {number} currentBid - Live bid price from getTokenBidPrice()
 * @returns {{ success: boolean, sellPrice: number, usdcReceived: number }|null}
 */
export async function sellPosition(asset_id, tokenQty, currentBid) {
  if (!asset_id || tokenQty <= 0) {
    console.warn('[polymarketApi] sellPosition: invalid params');
    return null;
  }

  // For SELL we pass the token quantity directly (not a USDC amount)
  const order = {
    asset_id,
    side:         'SELL',
    type:         'MARKET',
    price:        Math.max(0, parseFloat((currentBid * (1 - SLIPPAGE_BPS / 10_000)).toFixed(4))),
    size:         parseFloat(tokenQty.toFixed(4)),
    time_in_force: 'IOC',
  };

  try {
    console.info(
      `[polymarketApi] SELL asset=${asset_id.slice(0, 10)}…  ` +
      `qty=${order.size}  bid=${currentBid}  floor=${order.price}`
    );

    const result = await apiFetch(`${CLOB_BASE}/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    });

    if (!result?.order_id) {
      throw new Error('No order_id in SELL response');
    }

    const usdcReceived = order.size * order.price;

    return {
      success:      true,
      order_id:     result.order_id,
      sellPrice:    order.price,
      usdcReceived: parseFloat(usdcReceived.toFixed(4)),
      timestamp:    Date.now(),
    };
  } catch (err) {
    console.error('[polymarketApi] sellPosition failed:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  POLYMARKET ODDS  (for the dashboard probability display)
// ─────────────────────────────────────────────────────────────

/**
 * Fetch current YES/NO probability from the Gamma API.
 * Returns { yes: number, no: number } in percentage (0–100).
 *
 * @param {string} marketId
 */
export async function fetchMarketOdds(marketId) {
  try {
    const market = await fetchMarketById(marketId);
    if (!market) return { yes: 50, no: 50 };

    // Gamma returns outcomePrices as ["0.62", "0.38"] or similar
    const prices = market.outcomePrices ?? [];
    const yes = Math.round(parseFloat(prices[0] ?? 0.5) * 100);
    const no  = 100 - yes;

    return { yes, no };
  } catch (err) {
    console.error('[polymarketApi] fetchMarketOdds error:', err.message);
    return { yes: 50, no: 50 };
  }
}

/**
 * Convenience: get both odds AND the token asset_ids for a market.
 * App.jsx calls this to know which token to buy (YES=UP, NO=DOWN).
 *
 * @param {string} marketId
 * @returns {{ yes: number, no: number, yesTokenId: string, noTokenId: string }}
 */
export async function fetchMarketData(marketId) {
  try {
    const market = await fetchMarketById(marketId);
    if (!market) return null;

    const prices = market.outcomePrices ?? [];
    const tokens = market.clobTokenIds  ?? [];

    return {
      yes:        Math.round(parseFloat(prices[0] ?? 0.5) * 100),
      no:         100 - Math.round(parseFloat(prices[0] ?? 0.5) * 100),
      yesTokenId: tokens[0] ?? null,   // YES outcome token (bet UP)
      noTokenId:  tokens[1] ?? null,   // NO  outcome token (bet DOWN)
      endTime:    market.endDate ?? null,
    };
  } catch (err) {
    console.error('[polymarketApi] fetchMarketData error:', err.message);
    return null;
  }
}
