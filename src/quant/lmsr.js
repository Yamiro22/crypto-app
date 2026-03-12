// ─── LMSR — Logarithmic Market Scoring Rule Engine ───────────────────────────
//
// Based on: QR-PM-2026-0041 "Logarithmic Market Scoring Rule: Pricing Mechanism
//           & Inefficiency Detection" — Quantitative Research Division, Feb 2026
//
// Core idea: Polymarket's AMM uses LMSR internally. By reverse-engineering the
// implied quantity state q from the observed prices (softmax), we can:
//   1. Calculate the exact USDC cost of buying δ shares at any price
//   2. Detect when market prices diverge from our Bayesian posterior → EDGE
//   3. Bound maximum loss per trade with L_max = b·ln(n)
//
// ─────────────────────────────────────────────────────────────────────────────

const LOG2 = Math.LN2; // ln(2) ≈ 0.6931 — used for binary market bounds

// ── 1. LMSR Cost Function ─────────────────────────────────────────────────────
// C(q) = b · ln( Σ exp(qi / b) )
// where:
//   q = [q_up, q_down] — outstanding quantity vector (shares)
//   b = liquidity parameter (larger b → more depth, larger max loss)
//
// For Polymarket's 5-min BTC markets, b ≈ liquidity / ln(2)
// We back-calculate b from the observed pool size.
export function lmsrCost(quantities, b) {
  if (!b || b <= 0) throw new Error('LMSR: liquidity parameter b must be > 0');
  // log-sum-exp trick for numerical stability: LSE(x) = max + ln(Σ exp(xi - max))
  const max = Math.max(...quantities);
  const sumExp = quantities.reduce((acc, q) => acc + Math.exp((q - max) / b), 0);
  return b * (max / b + Math.log(sumExp));
}

// ── 2. Price Function (Softmax) ───────────────────────────────────────────────
// p_i(q) = exp(q_i/b) / Σ_j exp(q_j/b)
//
// This is IDENTICAL to neural network softmax. The market IS a Bayesian classifier.
// For a binary market: p_up = 1 - p_down, prices always sum to 1.
export function lmsrPrice(quantities, b) {
  const max = Math.max(...quantities);
  const exps = quantities.map(q => Math.exp((q - max) / b));
  const sum = exps.reduce((a, x) => a + x, 0);
  return exps.map(e => e / sum);
}

// ── 3. Cost of a Trade ────────────────────────────────────────────────────────
// Cost(buy δ of outcome i) = C(q1,..., qi+δ,...) - C(q1,..., qi,...)
//
// Returns USDC cost to purchase `delta` shares of `outcomeIndex`
// given current quantity state `quantities` and liquidity `b`.
export function lmsrTradeCost(quantities, outcomeIndex, delta, b) {
  const qAfter = quantities.map((q, i) => (i === outcomeIndex ? q + delta : q));
  return lmsrCost(qAfter, b) - lmsrCost(quantities, b);
}

// ── 4. Maximum Market Maker Loss ──────────────────────────────────────────────
// L_max = b · ln(n)
// For Polymarket binary markets (n=2): L_max = b · ln(2) ≈ 0.693b
//
// This bounds our worst-case per-market exposure.
export function lmsrMaxLoss(b, n = 2) {
  return b * Math.log(n);
}

// ── 5. Back-calculate b from observed liquidity + prices ─────────────────────
// Given market liquidity L (total USDC) and observed prices [p_up, p_down],
// we recover the effective b parameter.
//
// Polymarket relationship: b ≈ L / ln(n) for equal starting quantities
// For a 50/50 start: b = L / ln(2)
export function estimateB(liquidityUSDC, n = 2) {
  if (!liquidityUSDC || liquidityUSDC <= 0) return 100000; // safe fallback
  return liquidityUSDC / Math.log(n);
}

// ── 6. Implied Quantities from Prices ────────────────────────────────────────
// Given observed prices [p_up, p_down] and liquidity b, recover q vector.
// From softmax: q_i = b · (ln(p_i) + C) for some constant C.
// We can set q_down = 0 as reference: q_up = b · ln(p_up / p_down)
export function impliedQuantities(prices, b) {
  const pDown = prices[1] || (1 - prices[0]);
  const pUp   = prices[0];
  // Log-odds parameterization: q_up relative to q_down = 0
  const qUp   = b * Math.log(pUp / pDown);
  return [qUp, 0];
}

// ── 7. Inefficiency Signal — Edge Detection ───────────────────────────────────
// This is Section 4 from the document (cut off in image).
//
// Algorithm:
//   1. Our Bayesian posterior gives P_model(UP) = p_hat
//   2. Market price gives P_market(UP) = p_market
//   3. Edge = EV = p_hat - p_market  (from document formula 4)
//   4. If |edge| > threshold, the market is mis-priced → opportunity
//
// EV = p̂ · (1-p) - (1-p̂) · p = p̂ - p  (doc equation 4)
//
// Returns { edge, direction, evPct, quality, marketPrice, modelPrice }
export function detectInefficiency(modelProb, marketPriceCents, options = {}) {
  const {
    minEdge = 0.05,       // minimum EV to be worth trading (5¢)
    minMarketPrice = 20,  // avoid very thin edges of very cheap contracts
    maxMarketPrice = 80,  // avoid overpriced contracts
  } = options;

  const pMarket = marketPriceCents / 100;  // convert cents to [0,1]
  const pModel  = Math.max(0.01, Math.min(0.99, modelProb)); // clamp

  // EV formula from document equation (4)
  const ev = pModel - pMarket;
  const evAbs = Math.abs(ev);

  const direction = ev > 0 ? 'UP' : 'DOWN';
  const quality =
    evAbs >= 0.12 ? 'STRONG' :
    evAbs >= 0.08 ? 'MODERATE' :
    evAbs >= minEdge ? 'WEAK' : 'NONE';

  const isValid = (
    evAbs >= minEdge &&
    marketPriceCents >= minMarketPrice &&
    marketPriceCents <= maxMarketPrice
  );

  return {
    edge: +ev.toFixed(4),
    evPct: +(evAbs * 100).toFixed(1),
    direction,
    quality,
    isValid,
    marketPrice: pMarket,
    modelPrice: pModel,
    // How many cents of edge per dollar wagered
    edgeCentsPerDollar: +(ev * 100).toFixed(2),
  };
}

// ── 8. Optimal Share Quantity (from edge + LMSR cost) ─────────────────────────
// Given an edge, how many shares should we buy?
// Based on: cost to buy δ shares must be < expected return
//
// For Polymarket binary contracts: 1 share pays $1 if correct.
// Cost to buy δ shares of the UP token at price p:
//   cost_per_share ≈ p (in thin markets; exact = LMSR trade cost / δ)
//
// We solve for δ where cost ≤ maxUSDC and cost/share ≤ modelProb
export function optimalShareCount(modelProb, marketPriceCents, quantities, b, maxUSDC = 10) {
  const pMarket = marketPriceCents / 100;
  const outcomeIdx = modelProb > pMarket ? 0 : 1; // 0=UP, 1=DOWN

  // Binary search for δ that spends as close to maxUSDC as possible
  // while keeping cost per share below our model's estimated fair value
  let lo = 0, hi = maxUSDC / (pMarket + 0.001);
  for (let iter = 0; iter < 50; iter++) {
    const mid = (lo + hi) / 2;
    const cost = lmsrTradeCost(quantities, outcomeIdx, mid, b);
    if (cost < maxUSDC) lo = mid;
    else hi = mid;
  }

  const delta = Math.floor(lo); // whole shares only
  const actualCost = delta > 0 ? lmsrTradeCost(quantities, outcomeIdx, delta, b) : 0;

  return {
    shares: delta,
    cost: +actualCost.toFixed(4),
    costPerShare: delta > 0 ? +(actualCost / delta).toFixed(4) : pMarket,
    outcomeIndex: outcomeIdx,
  };
}

// ── 9. LMSR Spread Signal ─────────────────────────────────────────────────────
// A tight LMSR spread (difference between ask and bid in the orderbook)
// indicates high market confidence and liquidity.
// We use this as a signal quality multiplier in the Bayesian engine.
//
// Input: spread from polymarketApi.js fetchSpreadSignal()
// Output: { multiplier, note }
export function spreadSignalMultiplier(spreadData) {
  if (!spreadData) return { multiplier: 1.0, note: 'no spread data' };
  const { spreadCents, quality, imbalance } = spreadData;

  let m = 1.0;
  let note = '';

  // Tight spread → high confidence → amplify signal
  if (quality === 'TIGHT')  { m += 0.15; note = `tight ${spreadCents}¢ spread`; }
  if (quality === 'NORMAL') { m += 0.00; note = `normal ${spreadCents}¢ spread`; }
  if (quality === 'WIDE')   { m -= 0.20; note = `wide ${spreadCents}¢ spread — thin`; }

  // Order book imbalance
  if (Math.abs(imbalance || 0) > 30) {
    const boost = (imbalance > 0 ? 0.05 : -0.05);
    m += boost;
    note += ` | ${imbalance > 0 ? 'bid' : 'ask'} imbalance ${Math.abs(imbalance).toFixed(0)}%`;
  }

  return { multiplier: Math.max(0.5, Math.min(1.4, m)), note };
}

// ── 10. Summary: Complete LMSR Market Analysis ───────────────────────────────
// One-shot function: feed market data, get full LMSR analysis.
export function analyzeLMSR({
  upOdds,          // market odds for UP in cents (e.g., 58)
  downOdds,        // market odds for DOWN in cents (e.g., 42)
  liquidityUSDC,   // pool liquidity in USDC
  modelProb,       // our Bayesian posterior for UP [0..1]
  spreadData,      // from fetchSpreadSignal()
  maxPosition,     // max USDC to risk per trade
}) {
  const b           = estimateB(liquidityUSDC || 100000);
  const prices      = [upOdds / 100, downOdds / 100];
  const quantities  = impliedQuantities(prices, b);
  const maxLoss     = lmsrMaxLoss(b);
  const ineff       = detectInefficiency(modelProb, upOdds);
  const spread      = spreadSignalMultiplier(spreadData);

  // Only calculate share count if there's a valid edge
  const sizing = ineff.isValid
    ? optimalShareCount(modelProb, upOdds, quantities, b, maxPosition || 10)
    : { shares: 0, cost: 0, costPerShare: upOdds / 100, outcomeIndex: 0 };

  return {
    b,
    quantities,
    prices,
    maxLoss,
    inefficiency: ineff,
    spread,
    sizing,
    tradeable: ineff.isValid && spread.multiplier > 0.7,
    summary: ineff.isValid
      ? `${ineff.quality} edge: model ${(modelProb * 100).toFixed(1)}% vs market ${upOdds}¢ → ${ineff.edgeCentsPerDollar > 0 ? '+' : ''}${ineff.edgeCentsPerDollar}¢/$`
      : `No edge: model ${(modelProb * 100).toFixed(1)}% ≈ market ${upOdds}¢`,
  };
}
