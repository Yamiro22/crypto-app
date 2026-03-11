/**
 * ============================================================
 * signalEngine.js  —  BabyDoge BTC Oracle v3
 * 5-Factor + Dip/Mountain Catcher + Volatility Squeeze Filter
 * ============================================================
 *
 * SIGNAL SCORING ARCHITECTURE
 * ────────────────────────────
 *  The engine produces a composite score [0–5] and a direction
 *  ('UP' | 'DOWN' | 'NONE').  Each of the 5 factors contributes
 *  at most 1.0 point.  Fractional points allow nuance.
 *
 *  Factor 1: MACD (1m)          — momentum direction
 *  Factor 2: RSI  (1m)          — overbought / oversold
 *  Factor 3: Bollinger Bands    — price vs band extremes + squeeze
 *  Factor 4: Macro Trend        — 4H/1H EMAs for higher-timeframe bias
 *  Factor 5: Polymarket Odds    — crowd wisdom alignment
 *
 * SPECIAL PATTERN DETECTORS (override / boost base score)
 * ─────────────────────────────────────────────────────────
 *  "Dip Catcher":      1m RSI < 25  AND  4H macro is BULLISH
 *                      → fires aggressive UP signal (score boosted to 5/5)
 *
 *  "Mountain Catcher": 1m RSI > 80  AND  price touches upper BB
 *                      AND macro is BEARISH
 *                      → fires aggressive DOWN signal (score boosted to 5/5)
 *
 *  "Squeeze Block":    BB width < historical squeeze threshold
 *                      → blocks ALL new entries until breakout detected
 *
 * ============================================================
 */

// ─────────────────────────────────────────────────────────────
//  THRESHOLDS  (all tunable)
// ─────────────────────────────────────────────────────────────

const RSI = {
  OVERSOLD_EXTREME:  25,   // Dip Catcher fires here
  OVERSOLD:          35,   // Normal buy bias
  OVERBOUGHT:        65,   // Normal sell bias
  OVERBOUGHT_EXTREME: 80,  // Mountain Catcher fires here
};

const MACD = {
  STRONG_BULL_THRESHOLD:  0.5,   // histogram > 0.5 = strong bull
  STRONG_BEAR_THRESHOLD: -0.5,   // histogram < -0.5 = strong bear
};

const BB = {
  /**
   * Price must be this far through the band (0 = midline, 1 = band edge)
   * to score a full point.  0.85 = within the top/bottom 15% of the band.
   */
  BAND_TOUCH_RATIO: 0.85,

  /**
   * Squeeze threshold: if BB width (as % of price) is below this,
   * the market is coiling and we should NOT trade (false breakouts).
   * Typical BTC 1m BB width is 0.3–0.8 %; < 0.15 % = squeeze.
   */
  SQUEEZE_PCT_THRESHOLD: 0.0015, // 0.15 % of price

  /**
   * To confirm a breakout FROM a squeeze, price must close
   * outside the band by at least this fraction of band width.
   */
  BREAKOUT_CONFIRMATION_RATIO: 0.10,
};

const MACRO = {
  /**
   * For the 4H/1H EMA trend, we compare two EMAs.
   * If fast > slow by this %, it's a BULLISH macro.
   */
  EMA_BULL_DIFF_PCT: 0.002,  // 0.2 %
  EMA_BEAR_DIFF_PCT: -0.002,
};

const ODDS = {
  STRONG_ALIGNMENT: 65,  // Polymarket YES > 65 % → full UP score
  STRONG_COUNTER:   35,  // Polymarket YES < 35 % → full DOWN score
};

/** Minimum score to fire a trading signal */
const MIN_SIGNAL_SCORE = 3.0;

/** Score required for an "aggressive" entry (Dip/Mountain pattern) */
const AGGRESSIVE_SCORE = 5.0;

// ─────────────────────────────────────────────────────────────
//  MAIN EXPORT: evaluateSignal()
// ─────────────────────────────────────────────────────────────

/**
 * Evaluate all indicators and return a unified signal object.
 *
 * @param {object} indicators — output from indicators.js
 *   {
 *     // 1-minute timeframe
 *     macd1m:   { value: number, signal: number, histogram: number, cross: 'BULL'|'BEAR'|null }
 *     rsi1m:    number
 *     bb1m:     { upper: number, lower: number, mid: number, width: number }
 *     price:    number   (current live price)
 *
 *     // 4H / 1H macro
 *     ema4h:    { fast: number, slow: number }
 *     ema1h:    { fast: number, slow: number }
 *
 *     // Historical BB widths for squeeze detection (array, newest last)
 *     bbWidthHistory: number[]
 *   }
 *
 * @param {object} marketData — from polymarketApi.fetchMarketData()
 *   { yes: number, no: number }
 *
 * @returns {SignalResult}
 *   {
 *     direction:  'UP'|'DOWN'|'NONE'
 *     score:      number (0–5)
 *     confidence: 'NONE'|'WEAK'|'MODERATE'|'STRONG'|'AGGRESSIVE'
 *     factors:    object  (breakdown of each factor score)
 *     pattern:    string  (e.g. 'DIP_CATCHER', 'MOUNTAIN_CATCHER', 'SQUEEZE_BLOCK')
 *     blocked:    boolean (true = do not trade this tick)
 *     macdSignal: 'BULLISH'|'BEARISH'|'NEUTRAL'  (for positionManager.js)
 *     reason:     string  (human-readable summary)
 *   }
 */
export function evaluateSignal(indicators, marketData = { yes: 50, no: 50 }) {
  const {
    macd1m,
    rsi1m,
    bb1m,
    price,
    ema4h,
    ema1h,
    bbWidthHistory = [],
  } = indicators;

  // ── Guard: require minimum data ────────────────────────────
  if (!price || !rsi1m || !bb1m || !macd1m) {
    return _blocked('INSUFFICIENT_DATA', 'Not enough indicator data yet');
  }

  // ─────────────────────────────────────────────────────────────
  //  STEP 1: SQUEEZE FILTER  (must check before anything else)
  // ─────────────────────────────────────────────────────────────

  const squeezeState = detectSqueeze(bb1m, price, bbWidthHistory);

  if (squeezeState.inSqueeze && !squeezeState.breakoutDetected) {
    return _blocked(
      'SQUEEZE_BLOCK',
      `BB squeeze active (width ${(squeezeState.currentWidthPct * 100).toFixed(3)}%). ` +
      `Waiting for breakout confirmation.`
    );
  }

  // ─────────────────────────────────────────────────────────────
  //  STEP 2: MACRO TREND (4H / 1H)
  // ─────────────────────────────────────────────────────────────

  const macroTrend = getMacroTrend(ema4h, ema1h);

  // ─────────────────────────────────────────────────────────────
  //  STEP 3: SPECIAL PATTERN DETECTORS (override normal scoring)
  // ─────────────────────────────────────────────────────────────

  // ── DIP CATCHER ────────────────────────────────────────────
  //  Logic: 1m RSI < 25 (extreme oversold) but macro says BULLISH
  //         = beaten-down price in an uptrend  = high-prob bounce
  if (rsi1m < RSI.OVERSOLD_EXTREME && macroTrend === 'BULLISH') {
    return _signal('UP', AGGRESSIVE_SCORE, 'DIP_CATCHER', {
      rsi1m, macroTrend,
      note: `RSI at ${rsi1m.toFixed(1)} (extreme oversold) in BULLISH macro — bounce expected`,
    });
  }

  // ── MOUNTAIN CATCHER ───────────────────────────────────────
  //  Logic: 1m RSI > 80 (extreme overbought) + price touches upper BB
  //         + macro is BEARISH = exhaustion peak → high-prob reversal
  const bbTouchUpper = price >= bb1m.upper * (1 - (1 - BB.BAND_TOUCH_RATIO) * 0.5);

  if (rsi1m > RSI.OVERBOUGHT_EXTREME && bbTouchUpper && macroTrend === 'BEARISH') {
    return _signal('DOWN', AGGRESSIVE_SCORE, 'MOUNTAIN_CATCHER', {
      rsi1m, macroTrend,
      note: `RSI at ${rsi1m.toFixed(1)} (extreme overbought), touching upper BB in BEARISH macro — reversal expected`,
    });
  }

  // ─────────────────────────────────────────────────────────────
  //  STEP 4: STANDARD 5-FACTOR SCORING
  // ─────────────────────────────────────────────────────────────

  const factors = {};

  // ── Factor 1: MACD 1m ──────────────────────────────────────
  factors.macd = scoreMacd(macd1m);

  // ── Factor 2: RSI 1m ───────────────────────────────────────
  factors.rsi = scoreRsi(rsi1m);

  // ── Factor 3: Bollinger Bands ──────────────────────────────
  factors.bb = scoreBollingerBands(bb1m, price);

  // ── Factor 4: Macro Trend ──────────────────────────────────
  factors.macro = scoreMacro(macroTrend);

  // ── Factor 5: Polymarket Odds ──────────────────────────────
  factors.odds = scoreOdds(marketData);

  // ── Tally UP and DOWN scores separately ───────────────────
  let upScore   = 0;
  let downScore = 0;

  for (const f of Object.values(factors)) {
    upScore   += Math.max(0,  f.upScore   ?? 0);
    downScore += Math.max(0,  f.downScore ?? 0);
  }

  // ── Determine dominant direction ──────────────────────────
  const dominantDir   = upScore > downScore ? 'UP' : downScore > upScore ? 'DOWN' : 'NONE';
  const dominantScore = Math.max(upScore, downScore);

  if (dominantScore < MIN_SIGNAL_SCORE || dominantDir === 'NONE') {
    return {
      direction:  'NONE',
      score:      dominantScore,
      confidence: 'NONE',
      factors,
      pattern:    'NO_SIGNAL',
      blocked:    false,
      macdSignal: _macdLabel(macd1m),
      reason:     `Score ${dominantScore.toFixed(2)}/5 — below threshold of ${MIN_SIGNAL_SCORE}`,
    };
  }

  return {
    direction:  dominantDir,
    score:      parseFloat(dominantScore.toFixed(2)),
    confidence: scoreToConfidence(dominantScore),
    factors,
    pattern:    squeezeState.breakoutDetected ? 'SQUEEZE_BREAKOUT' : 'STANDARD',
    blocked:    false,
    macdSignal: _macdLabel(macd1m),
    reason:     `${dominantDir} signal — score ${dominantScore.toFixed(2)}/5 (${scoreToConfidence(dominantScore)})`,
  };
}

// ─────────────────────────────────────────────────────────────
//  INDIVIDUAL FACTOR SCORERS
//  Each returns { upScore: 0–1, downScore: 0–1, note: string }
// ─────────────────────────────────────────────────────────────

/**
 * MACD Factor
 * • Strong bull histogram → upScore 1.0
 * • Bullish cross         → upScore 0.7
 * • Slight positive       → upScore 0.4
 * (mirrored for DOWN)
 */
function scoreMacd(macd) {
  const h = macd.histogram ?? 0;
  const cross = macd.cross;

  let upScore = 0, downScore = 0, note = '';

  if (h > MACD.STRONG_BULL_THRESHOLD) {
    upScore = 1.0; note = `Strong bull histogram (${h.toFixed(3)})`;
  } else if (cross === 'BULL' || h > 0) {
    upScore = cross === 'BULL' ? 0.7 : 0.4;
    note = cross === 'BULL' ? 'Bullish MACD cross' : `Positive histogram (${h.toFixed(3)})`;
  } else if (h < MACD.STRONG_BEAR_THRESHOLD) {
    downScore = 1.0; note = `Strong bear histogram (${h.toFixed(3)})`;
  } else if (cross === 'BEAR' || h < 0) {
    downScore = cross === 'BEAR' ? 0.7 : 0.4;
    note = cross === 'BEAR' ? 'Bearish MACD cross' : `Negative histogram (${h.toFixed(3)})`;
  }

  return { upScore, downScore, note };
}

/**
 * RSI Factor
 * Oversold → upScore bias, Overbought → downScore bias
 */
function scoreRsi(rsi) {
  let upScore = 0, downScore = 0, note = '';

  if (rsi <= RSI.OVERSOLD) {
    // The more oversold, the stronger the UP bias
    const intensity = Math.min(1.0, (RSI.OVERSOLD - rsi) / RSI.OVERSOLD);
    upScore = 0.5 + intensity * 0.5;
    note = `Oversold RSI (${rsi.toFixed(1)})`;
  } else if (rsi >= RSI.OVERBOUGHT) {
    const intensity = Math.min(1.0, (rsi - RSI.OVERBOUGHT) / (100 - RSI.OVERBOUGHT));
    downScore = 0.5 + intensity * 0.5;
    note = `Overbought RSI (${rsi.toFixed(1)})`;
  } else {
    // Neutral zone: slight momentum bias based on distance from 50
    const dist = rsi - 50;
    if (dist > 5)       { upScore   = 0.2; note = `RSI slightly bullish (${rsi.toFixed(1)})`; }
    else if (dist < -5) { downScore = 0.2; note = `RSI slightly bearish (${rsi.toFixed(1)})`; }
    else                { note = `RSI neutral (${rsi.toFixed(1)})`; }
  }

  return { upScore, downScore, note };
}

/**
 * Bollinger Band Factor
 * Price near lower band → UP score (oversold stretch)
 * Price near upper band → DOWN score (overbought stretch)
 */
function scoreBollingerBands(bb, price) {
  const range  = bb.upper - bb.lower;
  if (range <= 0) return { upScore: 0, downScore: 0, note: 'BB range zero' };

  // Position within the band: 0 = at lower, 1 = at upper
  const position = (price - bb.lower) / range;

  let upScore = 0, downScore = 0, note = '';

  if (position <= (1 - BB.BAND_TOUCH_RATIO)) {
    // Near lower band
    upScore = BB.BAND_TOUCH_RATIO + (1 - BB.BAND_TOUCH_RATIO) * (1 - position / (1 - BB.BAND_TOUCH_RATIO));
    upScore = Math.min(1.0, upScore);
    note = `Price near lower BB (pos: ${(position * 100).toFixed(1)}%)`;
  } else if (position >= BB.BAND_TOUCH_RATIO) {
    // Near upper band
    downScore = (position - BB.BAND_TOUCH_RATIO) / (1 - BB.BAND_TOUCH_RATIO);
    downScore = Math.min(1.0, downScore);
    note = `Price near upper BB (pos: ${(position * 100).toFixed(1)}%)`;
  } else {
    note = `Price mid-band (pos: ${(position * 100).toFixed(1)}%)`;
  }

  return { upScore, downScore, note };
}

/**
 * Macro Trend Factor (4H/1H EMA alignment)
 */
function scoreMacro(macroTrend) {
  if (macroTrend === 'BULLISH')         return { upScore: 1.0, downScore: 0,   note: 'Bullish macro (4H/1H)' };
  if (macroTrend === 'BEARISH')         return { upScore: 0,   downScore: 1.0, note: 'Bearish macro (4H/1H)' };
  if (macroTrend === 'WEAKLY_BULLISH')  return { upScore: 0.5, downScore: 0,   note: 'Weakly bullish macro' };
  if (macroTrend === 'WEAKLY_BEARISH')  return { upScore: 0,   downScore: 0.5, note: 'Weakly bearish macro' };
  return { upScore: 0, downScore: 0, note: 'Neutral macro' };
}

/**
 * Polymarket Odds Factor
 * Market crowd wisdom as a confirming/contrarian indicator.
 */
function scoreOdds(marketData) {
  const yes = marketData?.yes ?? 50;

  if (yes >= ODDS.STRONG_ALIGNMENT) {
    return { upScore: 1.0, downScore: 0, note: `Polymarket YES ${yes}% — crowd bullish` };
  }
  if (yes <= ODDS.STRONG_COUNTER) {
    return { upScore: 0, downScore: 1.0, note: `Polymarket YES ${yes}% — crowd bearish` };
  }

  // Interpolate between 35 % and 65 %
  const mid   = 50;
  const dist  = yes - mid;
  const score = Math.abs(dist) / (ODDS.STRONG_ALIGNMENT - mid) * 0.5;

  return dist >= 0
    ? { upScore: score,   downScore: 0,     note: `Polymarket lean UP (${yes}%)` }
    : { upScore: 0,       downScore: score, note: `Polymarket lean DOWN (${yes}%)` };
}

// ─────────────────────────────────────────────────────────────
//  MACRO TREND CALCULATOR
// ─────────────────────────────────────────────────────────────

/**
 * Determine higher-timeframe trend from 4H and 1H EMA pairs.
 * Both timeframes must agree for a STRONG classification.
 *
 * @param {{ fast: number, slow: number }} ema4h
 * @param {{ fast: number, slow: number }} ema1h
 * @returns {'BULLISH'|'WEAKLY_BULLISH'|'NEUTRAL'|'WEAKLY_BEARISH'|'BEARISH'}
 */
export function getMacroTrend(ema4h, ema1h) {
  if (!ema4h?.fast || !ema4h?.slow || !ema1h?.fast || !ema1h?.slow) {
    return 'NEUTRAL';
  }

  const diff4h = (ema4h.fast - ema4h.slow) / ema4h.slow;
  const diff1h = (ema1h.fast - ema1h.slow) / ema1h.slow;

  const bull4h = diff4h > MACRO.EMA_BULL_DIFF_PCT;
  const bear4h = diff4h < MACRO.EMA_BEAR_DIFF_PCT;
  const bull1h = diff1h > MACRO.EMA_BULL_DIFF_PCT;
  const bear1h = diff1h < MACRO.EMA_BEAR_DIFF_PCT;

  if (bull4h && bull1h) return 'BULLISH';
  if (bear4h && bear1h) return 'BEARISH';
  if (bull4h || bull1h) return 'WEAKLY_BULLISH';
  if (bear4h || bear1h) return 'WEAKLY_BEARISH';
  return 'NEUTRAL';
}

// ─────────────────────────────────────────────────────────────
//  VOLATILITY SQUEEZE DETECTOR
// ─────────────────────────────────────────────────────────────

/**
 * Detect if the Bollinger Bands are in a squeeze (consolidation).
 * A squeeze means the market is coiling — breakouts are violent
 * but direction is unpredictable → we block entries.
 *
 * We also detect if a breakout is underway (price outside band
 * by more than BREAKOUT_CONFIRMATION_RATIO of band width).
 *
 * @param {{ upper, lower, mid, width }} bb
 * @param {number} price
 * @param {number[]} widthHistory — recent BB widths (newest last)
 * @returns {{ inSqueeze, breakoutDetected, currentWidthPct }}
 */
export function detectSqueeze(bb, price, widthHistory = []) {
  const range = bb.upper - bb.lower;
  const currentWidthPct = bb.mid > 0 ? range / bb.mid : 0;

  const inSqueeze = currentWidthPct < BB.SQUEEZE_PCT_THRESHOLD;

  // Breakout = price has closed outside the band
  const outsideUpper = price > bb.upper;
  const outsideLower = price < bb.lower;
  const breakoutDetected =
    (outsideUpper || outsideLower) &&
    Math.abs(price - (outsideUpper ? bb.upper : bb.lower)) >
      range * BB.BREAKOUT_CONFIRMATION_RATIO;

  return { inSqueeze, breakoutDetected, currentWidthPct };
}

// ─────────────────────────────────────────────────────────────
//  KELLY CRITERION POSITION SIZER
// ─────────────────────────────────────────────────────────────

/**
 * Compute recommended bet size as a fraction of bankroll
 * using the Kelly Criterion, capped for safety.
 *
 * Used by App.jsx to replace static betAmt.
 *
 * Kelly formula: f = (bp - q) / b
 *   b = net payout odds (e.g. Polymarket YES at 0.60 → b = (1-0.60)/0.60 ≈ 0.667)
 *   p = our estimated win probability from signal score
 *   q = 1 - p
 *
 * We map score → p:
 *   5/5 → p = 0.80  (very confident)
 *   4/5 → p = 0.70
 *   3/5 → p = 0.60  (minimum threshold)
 *   < 3 → don't trade
 *
 * @param {number} score       — signal score (0–5)
 * @param {number} oddsPrice   — current ask price (0–1), e.g. 0.55
 * @param {number} bankroll    — total USDC balance
 * @param {number} maxPct      — hard cap as decimal (default 0.05 = 5%)
 * @returns {number}           — dollar amount to bet (0 = don't trade)
 */
export function calcKellyBetSize(score, oddsPrice, bankroll, maxPct = 0.05) {
  if (score < MIN_SIGNAL_SCORE || oddsPrice <= 0 || oddsPrice >= 1) return 0;

  // Map score to estimated win probability
  const winProb = scoreToProbability(score);

  // b = odds paid on a win (net profit per $ wagered at this price)
  // If we buy at p=0.55 and win (resolves to $1), profit = 0.45 on 0.55 risk
  const b = (1 - oddsPrice) / oddsPrice;
  const p = winProb;
  const q = 1 - p;

  const kelly = (b * p - q) / b;

  if (kelly <= 0) return 0; // negative Kelly = don't bet

  // Apply half-Kelly for safety (full Kelly is very aggressive)
  const halfKelly  = kelly * 0.5;
  const cappedFrac = Math.min(halfKelly, maxPct);

  return parseFloat((bankroll * cappedFrac).toFixed(2));
}

// ─────────────────────────────────────────────────────────────
//  UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────

function scoreToProbability(score) {
  if (score >= 5.0) return 0.82;
  if (score >= 4.5) return 0.76;
  if (score >= 4.0) return 0.70;
  if (score >= 3.5) return 0.65;
  if (score >= 3.0) return 0.60;
  return 0.50;
}

export function scoreToConfidence(score) {
  if (score >= AGGRESSIVE_SCORE) return 'AGGRESSIVE';
  if (score >= 4.0)              return 'STRONG';
  if (score >= 3.0)              return 'MODERATE';
  if (score >= 2.0)              return 'WEAK';
  return 'NONE';
}

function _macdLabel(macd) {
  if (!macd) return 'NEUTRAL';
  if (macd.histogram > 0 || macd.cross === 'BULL') return 'BULLISH';
  if (macd.histogram < 0 || macd.cross === 'BEAR') return 'BEARISH';
  return 'NEUTRAL';
}

function _signal(direction, score, pattern, meta = {}) {
  return {
    direction,
    score,
    confidence: scoreToConfidence(score),
    factors:    {},
    pattern,
    blocked:    false,
    macdSignal: 'NEUTRAL',
    reason:     meta.note ?? pattern,
    meta,
  };
}

function _blocked(pattern, reason) {
  return {
    direction:  'NONE',
    score:      0,
    confidence: 'NONE',
    factors:    {},
    pattern,
    blocked:    true,
    macdSignal: 'NEUTRAL',
    reason,
  };
}
