// ─── Position Sizer ───────────────────────────────────────────────────────────
//
// Combines:
//   • EV formula from doc equation (4): EV = p̂ - p
//   • Kelly Criterion for optimal bet sizing
//   • LMSR cost bounds for Polymarket contract sizes
//   • Risk-of-ruin protection
//
// Doc note (hand-written annotation on eq. 2):
//   "NEVER full Kelly on 5min markets!" — We use fractional Kelly (0.25×)
//   to account for model uncertainty and high variance in 5-min windows.
//
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Expected Value (from document equation 4) ──────────────────────────────
// EV = p̂ · (1-p) - (1-p̂) · p = p̂ - p
//
// Where:
//   p̂ = our model's probability (Bayesian posterior)
//   p  = market price (e.g., 0.58 for a 58¢ contract)
//
// EV > 0 → positive edge in our direction
// EV < 0 → market is overpriced relative to our model
//
// NOTE: For prediction market contracts, a $1 payout contract priced at p
// has raw EV = p̂ - p per dollar wagered.
export function calcEV(modelProb, marketPrice) {
  // Direct from document equation (4)
  const ev = modelProb - marketPrice;
  return {
    ev: +ev.toFixed(6),
    evPct: +(ev * 100).toFixed(2),
    // Annualized expectancy — just for intuition (not literal)
    // 288 five-minute rounds per day
    dailyEdgeEstimate: +(ev * 100 * 288 * 0.01).toFixed(2),
  };
}

// ── 2. Kelly Criterion ────────────────────────────────────────────────────────
// The Kelly formula for a win/loss bet:
//   f* = (b·p - q) / b
//
// Where:
//   f* = fraction of bankroll to bet
//   b  = net payout odds (dollars won per dollar risked)
//   p  = probability of winning (our model's posterior)
//   q  = probability of losing = 1 - p
//
// For Polymarket binary contracts priced at `marketPrice`:
//   Payout for $1 bet: 1/marketPrice (if correct)
//   Net profit: (1/marketPrice) - 1 = (1 - marketPrice) / marketPrice
//   So b = (1 - marketPrice) / marketPrice
//
// Fractional Kelly: f = f* × fraction (default 0.25)
// This accounts for model uncertainty ("NEVER full Kelly on 5min markets!")
export function kellyFraction(modelProb, marketPrice, fraction = 0.25) {
  const p = Math.max(0.01, Math.min(0.99, modelProb));
  const q = 1 - p;

  // Net payout odds
  const b = (1 - marketPrice) / marketPrice;

  // Full Kelly
  const fullKelly = (b * p - q) / b;

  // Fractional Kelly (document annotation: never full Kelly on 5min)
  const fracKelly = fullKelly * fraction;

  return {
    fullKelly: +fullKelly.toFixed(4),
    fracKelly: +Math.max(0, fracKelly).toFixed(4),
    b: +b.toFixed(4),
    // Readable: what % of bankroll to bet
    pctOfBankroll: +Math.max(0, fracKelly * 100).toFixed(2),
  };
}

// ── 3. Recommended Position Size (USDC) ──────────────────────────────────────
//
// Combines Kelly sizing with hard limits and EV floor.
// Returns a concrete USDC amount to bet.
//
// Risk rules:
//   1. Never bet if EV < minEV (e.g., 0.04 = 4¢ edge)
//   2. Never bet more than maxPctBalance of current balance
//   3. Never bet more than maxBet (hard cap)
//   4. Scale by Bayesian conviction strength
export function recommendedSize({
  modelProb,          // Bayesian posterior [0..1]
  marketPriceCents,   // Polymarket market price 0–100
  balance,            // current paper/real balance USDC
  conviction,         // Bayesian conviction 0–0.5 (abs(prob - 0.5))
  historicalBets = 0, // total resolved bets in history (for prior blending)
  options = {},
}) {
  const {
    minEV           = 0.04,   // minimum 4¢ EV per dollar
    kellyFrac       = 0.25,   // fractional Kelly multiplier
    maxPctBalance   = 0.10,   // max 10% of balance per bet
    maxBet          = 25,     // hard cap per trade
    minBet          = 1,      // minimum meaningful bet
  } = options;

  // ── Win-rate prior blending (Fix 2) ───────────────────────────────────────
  // Prevent Kelly inflation from short win streaks. Blend modelProb toward a
  // conservative 55% prior. Blend fades out as historical sample grows past 30.
  //   < 10 bets: 80% prior, 20% model  (not enough data)
  //   10–30 bets: linearly transition
  //   30+ bets: 100% model (trust it fully)
  const PRIOR = 0.55;
  const blendWeight = Math.min(1, Math.max(0, (historicalBets - 10) / 20)); // 0→1 over 10–30 bets
  const blendedProb = PRIOR * (1 - blendWeight) + modelProb * blendWeight;

  const marketPrice = marketPriceCents / 100;
  const { ev }      = calcEV(blendedProb, marketPrice);
  const { fracKelly } = kellyFraction(blendedProb, marketPrice, kellyFrac);

  // EV gate
  if (ev < minEV) {
    return {
      size: 0,
      reason: `EV too low: ${(ev * 100).toFixed(1)}¢ < ${(minEV * 100).toFixed(0)}¢ minimum${historicalBets < 30 ? ` (prior-blended, ${historicalBets} bets)` : ''}`,
      ev, fracKelly,
    };
  }

  // Kelly-based size (uses blended prob → conservative when sample is small)
  let size = balance * fracKelly;

  // Conviction multiplier: scale down when we're less certain
  // conviction 0.08 = 58% prob → 1.0x, conviction 0.15 = 65% → 1.3x
  // Dampen conviction multiplier until 30+ bets to avoid streak inflation
  const convictionDamp = Math.min(1, historicalBets / 20); // 0→1 over first 20 bets
  const rawMul = 1.0 + Math.max(0, (conviction - 0.08) * 5);
  const convictionMul = 1.0 + (rawMul - 1.0) * convictionDamp;
  size *= Math.min(1.5, convictionMul);

  // Apply limits
  size = Math.min(size, balance * maxPctBalance);
  size = Math.min(size, maxBet);
  size = Math.max(size, minBet);

  // Round to nearest 50 cents
  size = Math.round(size * 2) / 2;

  return {
    size: +size.toFixed(2),
    ev:   +ev.toFixed(4),
    evPct: +(ev * 100).toFixed(2),
    fracKelly: +fracKelly.toFixed(4),
    kellySize: +(balance * fracKelly).toFixed(2),
    convictionMul: +convictionMul.toFixed(3),
    blendedProb: +blendedProb.toFixed(3),
    blendWeight: +blendWeight.toFixed(2),
    reason: `EV: +${(ev*100).toFixed(1)}¢ | Kelly: ${(fracKelly*100).toFixed(1)}% | Conviction: ${(conviction*200).toFixed(0)}%${historicalBets < 30 ? ` | prior-blended (${historicalBets} bets)` : ''}`,
  };
}

// ── 4. Daily P&L Expectancy ───────────────────────────────────────────────────
// Given a win rate, edge, and bet size, estimate daily P&L.
// 288 five-minute rounds per day on Polymarket.
export function dailyExpectancy(modelProb, marketPriceCents, betSize, roundsPerDay = 288) {
  const marketPrice = marketPriceCents / 100;
  const { ev }      = calcEV(modelProb, marketPrice);

  // Expected P&L per round = EV × bet size (in contracts)
  // For prediction market: payout = betSize / marketPrice (if win)
  const payout = betSize / marketPrice;
  const evPerRound = ev * betSize; // simplified: EV × stake

  return {
    evPerRound: +evPerRound.toFixed(4),
    dailyEV: +(evPerRound * roundsPerDay).toFixed(2),
    winAmount: +(payout - betSize).toFixed(2),
    lossAmount: -betSize,
    breakEvenWinRate: +marketPrice.toFixed(4),
    modelWinRate: +modelProb.toFixed(4),
  };
}

// ── 5. Risk of Ruin ──────────────────────────────────────────────────────────
// Probability of balance dropping below ruin threshold.
// Uses the gambler's ruin formula for positive-EV games.
//
// For a symmetric random walk with drift μ = EV and variance σ²:
// P(ruin) ≈ exp(-2 · μ · balance / σ²)
export function riskOfRuin(modelProb, marketPrice, betFrac, initialBalance) {
  const { ev } = calcEV(modelProb, marketPrice);
  if (ev <= 0) return 1; // negative EV → certain ruin

  const betSize = initialBalance * betFrac;
  const sigma2  = betSize ** 2; // variance ≈ bet² for binary outcomes (approx)
  const mu      = ev * betSize;

  const rorApprox = Math.exp(-2 * mu * initialBalance / sigma2);
  return Math.min(1, Math.max(0, +rorApprox.toFixed(6)));
}

// ── 6. Full Sizing Decision ───────────────────────────────────────────────────
// One-shot function that returns the complete position sizing recommendation.
export function fullSizingDecision({
  bayesResult,         // from runBayesianPipeline()
  lmsrResult,          // from analyzeLMSR()
  upOdds,              // market UP cents
  dnOdds,              // market DOWN cents
  balance,             // current balance
  historicalBets = 0,  // total resolved bets for prior blending
  options = {},
}) {
  const { probUp, probDown, direction, conviction } = bayesResult;

  // Pick the relevant side
  const betDir      = direction === 'UP' ? 'UP' : 'DOWN';
  const modelProb   = betDir === 'UP' ? probUp : probDown;
  const marketCents = betDir === 'UP' ? upOdds : dnOdds;
  const marketPrice = marketCents / 100;

  const evResult   = calcEV(modelProb, marketPrice);
  const kelly      = kellyFraction(modelProb, marketPrice, options.kellyFrac || 0.25);
  const sizing     = recommendedSize({ modelProb, marketPriceCents: marketCents, balance, conviction, historicalBets, options });
  const expectancy = dailyExpectancy(modelProb, marketCents, sizing.size || 5);
  const ror        = riskOfRuin(modelProb, marketPrice, kelly.fracKelly, balance);

  // LMSR confirms the edge
  const lmsrEdge = lmsrResult?.inefficiency?.isValid;
  const tradeable = sizing.size > 0 && direction !== 'NEUTRAL' && (!lmsrResult || lmsrEdge);

  return {
    direction: betDir,
    tradeable,
    size: sizing.size,
    ev: evResult,
    kelly,
    sizing,
    expectancy,
    riskOfRuin: ror,
    // Combined score for UI display (0-100)
    score: Math.round(
      (conviction * 100) * 0.4 +
      Math.min(30, evResult.evPct * 3) * 0.4 +
      (lmsrEdge ? 20 : 0)
    ),
    summary: tradeable
      ? `${betDir} $${sizing.size} | EV: +${evResult.evPct}¢ | Conf: ${(conviction * 200).toFixed(0)}%`
      : `NO BET — ${sizing.reason || 'insufficient edge'}`,
  };
}