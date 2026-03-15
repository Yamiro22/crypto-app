// ─── SIGNAL SCORING ENGINE v3.1 ─────────────────────────────────────────────

export const DEFAULT_WEIGHTS = {
  odds:           1.0,
  buffer:         1.0,
  macd5m:         1.0,
  macd1m:         1.0,
  trend4h:        1.0,
  stochRSI:       0.8,
  macroStrength:  0.9,
  whaleSentiment: 0.6,
  bbPosition:     0.5,
  supertrend:     0.7,
  spreadSignal:   0.8, // tight spread = market confidence signal
};

// ── MACRO DETECTION ───────────────────────────────────────────────────────────
// Primary: 4H MACD direction. RSI confirms strength, 1H used as tiebreaker.
export function getMacro(tfData) {
  const d4h = tfData?.['4h'];
  const d1h = tfData?.['1h'];
  if (!d4h) return 'N/A';

  const macdBull = d4h.macd.bullish;
  const rsi      = d4h.rsi ?? 50;

  if (macdBull && rsi > 30) return 'BULLISH';
  if (!macdBull && rsi < 70) return 'BEARISH';

  // Tiebreak via 1H
  if (d1h) {
    if (macdBull  && d1h.macd.bullish)  return 'BULLISH';
    if (!macdBull && !d1h.macd.bullish) return 'BEARISH';
  }

  return 'NEUTRAL';
}

export function getMacroNote(tfData) {
  const d = tfData?.['4h'];
  if (!d) return '';
  if ( d.macd.bullish && d.rsi < 40) return ` (RSI ${d.rsi?.toFixed(0)} — recovery)`;
  if (!d.macd.bullish && d.rsi > 60) return ` (RSI ${d.rsi?.toFixed(0)} — correction)`;
  return '';
}

// ── MULTI-TIMEFRAME TREND VOTE ─────────────────────────────────────────────
// Weighted vote across all TFs. 4H = 2.5×, 1H = 1.5×, others = 1×
// Returns { bullish, bearish, total, majority, pct }
export function getTrendVote(tfData) {
  // FIX: increased 4H weight from 2 → 2.5 to better reflect its importance
  const TF_WEIGHTS = { '4h': 2.5, '1h': 1.5, '30m': 1.0, '15m': 1.0, '5m': 1.0, '1m': 0.75 };
  let bull = 0, bear = 0;
  const detail = [];

  Object.entries(TF_WEIGHTS).forEach(([tf, w]) => {
    const d = tfData?.[tf];
    if (!d) return;
    if (d.macd.bullish) { bull += w; detail.push({ tf, bull: true  }); }
    else                { bear += w; detail.push({ tf, bull: false }); }
  });

  const total   = bull + bear;
  const bullPct = total > 0 ? Math.round((bull / total) * 100) : 50;
  // FIX: tightened NEUTRAL band — 58/42 vs old 60/40
  // A 58% vote is real signal, not a coin flip
  const majority = bullPct >= 58 ? 'BULLISH' : bullPct <= 42 ? 'BEARISH' : 'NEUTRAL';

  return { bull, bear, total, majority, pct: bullPct, detail };
}

// ── MAIN SIGNAL BUILDER ───────────────────────────────────────────────────────
export function buildSignal({ tfData, price, upOdds, downOdds, threshold, thresholdSource, dangerous, whale, lowLiq, whaleSentiment, weights, spreadData }) {

  // ── Hard skips ────────────────────────────────────────────────────────────
  if (dangerous) return nobet('🔴 DANGEROUS flag — instant skip.', '#ffd700', []);
  if (whale)     return nobet('🐋 Whale Dominated — skip.', '#ffd700', []);
  if (lowLiq)    return nobet('💧 Low Liquidity <85K — skip.', '#ffd700', []);

  const upV     = parseFloat(upOdds)   || 0;
  const dnV     = parseFloat(downOdds) || 0;
  const threshV = parseFloat(threshold) || 0;
  const cur     = price || 0;

  if (!upV && !dnV) return pending('Enter Polymarket odds — click ⚡ Auto or type manually.');
  if (upV >= 48 && upV <= 52) return nobet('⚖️ Coin flip 48–52¢ — no edge.', '#ffd700', []);

  // Odds ceiling: if favored side is >62¢, market is too confident — we can't beat it.
  // At 72¢ we need 72% accuracy; bot's observed rate is 44% → guaranteed negative EV.
  // Only bet in the 53–62¢ range where the edge requirement is achievable.
  // intendedDir is attached so App.jsx can still run Quant override after long skip streaks.
  const favoredOdds = Math.max(upV, dnV);
  if (favoredOdds > 62) {
    const dir2 = upV > dnV ? 'UP' : 'DOWN';
    const nb = nobet(`🚫 Odds too high — ${dir2} at ${favoredOdds}¢ needs ${favoredOdds}% accuracy (sweet spot: 53–62¢).`, '#ff3366', []);
    nb.intendedDir  = dir2;
    nb.intendedOdds = favoredOdds;
    nb.skipReason   = 'odds_ceiling';
    return nb;
  }

  // Buffer skip — hard skip <$10 to avoid coin-flip thresholds
  const bufAbs = threshV > 0 ? Math.abs(cur - threshV) : null;
  if (bufAbs !== null && bufAbs < 10)
    return nobet(`⚠️ Price only $${bufAbs.toFixed(0)} from threshold — too close, skip.`, '#ffd700', []);

  const d4h = tfData?.['4h'], d1h = tfData?.['1h'], d5m = tfData?.['5m'], d1m = tfData?.['1m'];
  if (!d4h || !d5m || !d1m) return pending('Chart data loading — click Fetch Data.');

  const macro     = getMacro(tfData);
  const macroNote = getMacroNote(tfData);
  const vote      = getTrendVote(tfData);
  const dir       = upV > dnV ? 'UP' : 'DOWN';
  const w         = weights || DEFAULT_WEIGHTS;
  const sk1m      = d1m.stochRSI?.k ?? 50;
  const bbPct     = d5m.bb?.pct     ?? 50;
  const stBull    = d4h.supertrend?.bullish ?? d4h.macd.bullish;

  // ── Factor 5: Multi-TF trend vote ────────────────────────────────────────
  const trendPass  = dir === 'UP' ? vote.majority === 'BULLISH' : vote.majority === 'BEARISH';
  const trendPct   = dir === 'UP' ? vote.pct : 100 - vote.pct;
  const trendValue = `${vote.majority} (${trendPct}% TFs agree)`;

  // ── Build all 5 factors ────────────────────────────────────────────────────
  const factors = [
    {
      name:   'Market Odds',
      value:  dir === 'UP' ? `${upV}¢ UP` : `${dnV}¢ DOWN`,
      pass:   dir === 'UP' ? upV >= 53 : dnV >= 53,
      weight: w.odds,
      tip:    dir === 'UP'
        ? (upV  < 53 ? `Need 53¢+, have ${upV}¢`  : '✓ Strong odds')
        : (dnV  < 53 ? `Need 53¢+, have ${dnV}¢`  : '✓ Strong odds'),
    },
    {
      name:   'Price Buffer',
      value:  threshV > 0 ? `${cur > threshV ? '+' : ''}$${(cur - threshV).toFixed(0)}` : 'No threshold set',
      // Buffer logic: UP bet passes if price is within $50 BELOW threshold OR above it
      //              DOWN bet passes if price is within $50 ABOVE threshold OR below it
      // This captures "price is close enough to move through threshold by expiry"
      // Hard skip (<$10) is handled above; here we allow a $50 proximity zone.
      pass:   threshV > 0 ? (dir === 'UP' ? cur > threshV - 50 : cur < threshV + 50) : false,
      weight: w.buffer,
      tip:    threshV === 0
        ? 'Set Price to Beat'
        : dir === 'UP'
          ? (cur <= threshV - 50 ? `Price too far below — need within $50 of $${threshV}` : cur > threshV ? `✓ $${(cur-threshV).toFixed(0)} above threshold` : `✓ Within $50 of threshold ($${(threshV-cur).toFixed(0)} gap)`)
          : (cur >= threshV + 50 ? `Price too far above — need within $50 of $${threshV}` : cur < threshV ? `✓ $${(threshV-cur).toFixed(0)} below threshold` : `✓ Within $50 of threshold ($${(cur-threshV).toFixed(0)} gap)`),
    },
    {
      name:   '5m MACD',
      value:  `${d5m.macd.bullish ? '▲' : '▼'}${d5m.macd.line > 0 ? '+' : ''}${d5m.macd.line}`,
      pass:   dir === 'UP' ? d5m.macd.bullish : !d5m.macd.bullish,
      weight: w.macd5m,
      tip:    `Hist: ${d5m.macd.hist} • Need ${dir === 'UP' ? 'bullish' : 'bearish'}`,
    },
    {
      name:   '1m MACD',
      value:  `${d1m.macd.bullish ? '▲' : '▼'}${d1m.macd.line > 0 ? '+' : ''}${d1m.macd.line}`,
      pass:   dir === 'UP' ? d1m.macd.bullish : !d1m.macd.bullish,
      weight: w.macd1m,
      tip:    `Hist: ${d1m.macd.hist} • Need ${dir === 'UP' ? 'bullish' : 'bearish'}`,
    },
    {
      name:   'Multi-TF Trend',
      value:  trendValue,
      pass:   trendPass,
      weight: w.trend4h,
      tip:    `4H: ${macro}${macroNote} • ${vote.bull.toFixed(1)} bull vs ${vote.bear.toFixed(1)} bear weight`,
    },
  ];

  const score = factors.filter(f => f.pass).length;

  // ── NEUTRAL 4H + split vote: warn and skip ────────────────────────────────
  if (macro === 'NEUTRAL' && vote.majority === 'NEUTRAL') {
    return {
      result: 'NO BET', conf: 0, score, factors,
      reason: `⚠️ No clear trend — 4H NEUTRAL and TF vote split (${vote.pct}%). Wait for direction.`,
      color: '#ffd700', skip: true,
    };
  }

  // ── Anti-pattern: fighting a strong opposing macro ────────────────────────
  // FIX: now SYMMETRIC — also blocks UP when 4H strongly BEARISH (was missing)
  if (macro === 'BULLISH' && dir === 'DOWN' && dnV > 62 && vote.majority !== 'BEARISH') {
    return {
      result: 'NO BET', conf: 0, score, factors,
      reason: `❌ DOWN ${dnV}¢ vs BULLISH 4H — high risk reversal bet. TFs not confirming. Skip.`,
      color: '#ff3366', skip: true,
    };
  }
  if (macro === 'BEARISH' && dir === 'UP' && upV > 62 && vote.majority !== 'BULLISH') {
    return {
      result: 'NO BET', conf: 0, score, factors,
      reason: `❌ UP ${upV}¢ vs BEARISH 4H — high risk reversal bet. TFs not confirming. Skip.`,
      color: '#ff3366', skip: true,
    };
  }

  // ── Need 3+ confluences ───────────────────────────────────────────────────
  if (score < 3) {
    const failed = factors.filter(f => !f.pass).map(f => `${f.name}: ${f.tip}`).join(' | ');
    return {
      result: 'NO BET', conf: 0, score, factors,
      reason: `${score}/5 confluences — need 3+. Fix: ${failed}`,
      color: '#ffd700', skip: false,
    };
  }

  // ── Confidence calculation ────────────────────────────────────────────────
  let conf = score === 3 ? 55 : score === 4 ? 62 : 67;

  // FIX: was `(trendPct - 60) / 10` which goes NEGATIVE at exactly 60% (passing!)
  // Now only adds — we already gated on trendPass, so trendPct >= 58 always
  conf += Math.max(0, Math.round((trendPct - 58) / 8));

  // Whale alignment
  if (whaleSentiment?.label === (dir === 'UP' ? 'BULLISH' : 'BEARISH')) conf += 3;

  // StochRSI adjustments
  let stochNote = '';
  if (sk1m <= 3  && dir === 'DOWN' && macro === 'BULLISH') { conf -= 12; stochNote = ' ⚡ StochRSI floor + bullish 4H — bounce risk.'; }
  if (sk1m >= 97 && dir === 'UP')                          { conf -= 10; stochNote = ' 🚨 StochRSI ceiling — pullback risk.'; }

  // FIX: was `sk1m <= 0 || sk1m >= 100` — basically impossible in real data
  // Changed to <= 1 / >= 99 — these actually fire in practice
  if (sk1m <= 1 || sk1m >= 99) {
    return {
      result: 'NO BET', conf: 0, score, factors,
      reason: `StochRSI at extreme (${sk1m}) — skip.${stochNote}`,
      color: '#ffd700', skip: false,
    };
  }

  if (dir === 'DOWN' && bbPct > 90) conf += 3;
  if (dir === 'UP'   && bbPct < 10) conf += 3;
  if ((dir === 'UP' && stBull) || (dir === 'DOWN' && !stBull)) conf += 2;

  if (conf < 50) {
    return {
      result: 'NO BET', conf: 0, score, factors,
      reason: `Confidence too low (${conf}%).${stochNote}`,
      color: '#ffd700', skip: false,
    };
  }

  // ── Spread signal modifier ────────────────────────────────────────────────
  // TIGHT (<3¢):  market is confident, liquid → boost confidence
  // NORMAL (3–8¢): neutral
  // WIDE (>8¢):    uncertain / thin market → penalise confidence
  // Imbalance: if crowd is heavily on the same side as our bet → small boost
  let spreadNote = '';
  if (spreadData) {
    const sw = w.spreadSignal ?? 0.8;
    if (spreadData.quality === 'TIGHT') {
      conf += Math.round(3 * sw);
      spreadNote = ` 📊 Tight spread (${spreadData.spreadCents}¢).`;
    } else if (spreadData.quality === 'WIDE') {
      conf -= Math.round(5 * sw);
      spreadNote = ` ⚠️ Wide spread (${spreadData.spreadCents}¢) — thin market.`;
    }
    // Imbalance: crowd on our side = +2, against = -2
    if (spreadData.imbalance !== undefined) {
      const isBullBet = dir === 'UP';
      if ((isBullBet && spreadData.imbalance > 20) || (!isBullBet && spreadData.imbalance < -20)) {
        conf += Math.round(2 * sw);
        spreadNote += ` Crowd ${isBullBet ? 'buying' : 'selling'} (${Math.abs(spreadData.imbalance).toFixed(0)}% imbalance).`;
      } else if ((isBullBet && spreadData.imbalance < -20) || (!isBullBet && spreadData.imbalance > 20)) {
        conf -= Math.round(2 * sw);
        spreadNote += ` Crowd against bet (${Math.abs(spreadData.imbalance).toFixed(0)}% imbalance).`;
      }
    }
  }

  conf = Math.min(Math.round(conf), 74);
  const color = dir === 'UP' ? '#00e5aa' : '#ff3366';

  const features = {
    odds:           upV > dnV ? 1 : -1,
    buffer:         cur > (threshV || cur) ? 1 : -1,
    macd5m:         d5m.macd.bullish ? 1 : -1,
    macd1m:         d1m.macd.bullish ? 1 : -1,
    trend4h:        macro === 'BULLISH' ? 1 : -1,
    stochRSI:       sk1m > 50 ? 0.5 : -0.5,
    macroStrength:  d4h.rsi > 55 ? 1 : -1,
    whaleSentiment: whaleSentiment?.score || 0,
    bbPosition:     dir === 'UP' ? (bbPct < 50 ? 0.5 : -0.5) : (bbPct > 50 ? 0.5 : -0.5),
    supertrend:     stBull ? 1 : -1,
    spreadSignal:   spreadData ? (spreadData.quality === 'TIGHT' ? 1 : spreadData.quality === 'WIDE' ? -1 : 0) : 0,
  };

  const whaleLine  = whaleSentiment?.label !== 'NEUTRAL' ? ` 🐋 Whales: ${whaleSentiment.label}.` : '';
  const confLabel  = conf >= 65 ? 'HIGH' : conf >= 62 ? 'MODERATE' : 'LOW';

  return {
    result: dir, conf, score, factors,
    reason: `${score}/5 — ${confLabel} conf. 4H: ${macro}${macroNote}. ${vote.pct}% TFs ${vote.majority}.${stochNote}${whaleLine}${spreadNote}`,
    color, features, skip: false,
  };
}

// ── MARKET CLASSIFICATION ─────────────────────────────────────────────────────
// FIX: now uses RSI + 4H MACD in classification, not just vote + whale
export function classifyMarket(tfData, whaleSentiment) {
  const vote  = getTrendVote(tfData);
  const macro = getMacro(tfData);
  const d4h   = tfData?.['4h'];
  const d5m   = tfData?.['5m'];
  if (!d5m) return { label: 'LOADING', score: 0 };

  let score = 0;

  // Vote strength (±2)
  if (vote.pct >= 58) score += 2;
  else if (vote.pct <= 42) score -= 2;

  // 4H macro (±2) — strongest signal
  if (macro === 'BULLISH') score += 2;
  else if (macro === 'BEARISH') score -= 2;

  // 4H RSI confirmation (±1)
  if (d4h) {
    if (d4h.rsi > 55 && macro === 'BULLISH') score += 1;
    if (d4h.rsi < 45 && macro === 'BEARISH') score -= 1;
  }

  // Whale (±1)
  if (whaleSentiment?.label === 'BULLISH') score += 1;
  if (whaleSentiment?.label === 'BEARISH') score -= 1;

  return {
    label:   score >= 3 ? 'BULLISH' : score <= -3 ? 'BEARISH' : 'NEUTRAL',
    score,
    votePct: vote.pct,
  };
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function nobet(reason, color, factors) {
  return { result: 'NO BET', conf: 0, score: 0, factors, reason, color, skip: true };
}
function pending(reason) {
  return { result: '---', conf: 0, score: 0, factors: [], reason, color: '#303060', skip: false };
}
