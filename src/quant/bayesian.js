// ─── Bayesian Sequential Signal Updater ──────────────────────────────────────
//
// Based on: QR-PM-2026-0041 "Real-Time Bayesian Signal Processing Agent Decision
//           Architecture" — Quantitative Research Division, Feb 2026
//
// Core equations:
//   (1) P(H|D) = P(D|H) · P(H) / P(D)          — Bayes' Theorem
//   (2) P(H|D1...Dt) ∝ P(H) · Π P(Dk|H)        — Sequential updating
//   (3) log P(H|D) = log P(H) + Σ log P(Dk|H) - log Z  — Log-space (stable)
//
// Each "data point" D is a new evidence signal that shifts the UP probability.
// Signals come from: MACD, RSI, whale flows, Polymarket order book, momentum.
//
// Architecture:
//   Prior P(H) = base signal confidence from existing signalEngine.js
//   Evidence   = independent signals with known likelihood ratios
//   Posterior  = refined probability after incorporating all evidence
// ─────────────────────────────────────────────────────────────────────────────

const EPSILON = 1e-9; // numerical floor to avoid log(0)

// ── 1. Evidence Likelihood Functions ─────────────────────────────────────────
//
// For each signal type, we define:
//   P(signal=bullish | H=UP)   = likelihood of seeing this signal if UP is true
//   P(signal=bullish | H=DOWN) = likelihood of seeing this signal if DOWN is true
//
// These are calibrated empirical estimates. A perfectly predictive signal would
// have P(D|UP)=1.0 and P(D|DOWN)=0.0. Random noise = 0.5 both sides.
//
// Format: { pIfUp, pIfDown } per signal type and signal value

const LIKELIHOODS = {
  // ── MACD signals ────────────────────────────────────────────────────────
  macd4h: {
    bullish:  { pIfUp: 0.73, pIfDown: 0.27 },  // 4H MACD bullish → strong UP evidence
    bearish:  { pIfUp: 0.27, pIfDown: 0.73 },
    neutral:  { pIfUp: 0.50, pIfDown: 0.50 },
  },
  macd1h: {
    bullish:  { pIfUp: 0.66, pIfDown: 0.34 },
    bearish:  { pIfUp: 0.34, pIfDown: 0.66 },
    neutral:  { pIfUp: 0.50, pIfDown: 0.50 },
  },
  macd5m: {
    bullish:  { pIfUp: 0.62, pIfDown: 0.38 },
    bearish:  { pIfUp: 0.38, pIfDown: 0.62 },
    neutral:  { pIfUp: 0.50, pIfDown: 0.50 },
  },
  macd1m: {
    bullish:  { pIfUp: 0.58, pIfDown: 0.42 },  // 1m noisier → weaker evidence
    bearish:  { pIfUp: 0.42, pIfDown: 0.58 },
    neutral:  { pIfUp: 0.50, pIfDown: 0.50 },
  },

  // ── RSI zones ────────────────────────────────────────────────────────────
  rsi4h: {
    strongBull:  { pIfUp: 0.68, pIfDown: 0.32 },  // RSI 55–70
    weakBull:    { pIfUp: 0.57, pIfDown: 0.43 },  // RSI 50–55
    neutral:     { pIfUp: 0.50, pIfDown: 0.50 },
    weakBear:    { pIfUp: 0.43, pIfDown: 0.57 },
    strongBear:  { pIfUp: 0.32, pIfDown: 0.68 },  // RSI 30–45
    overbought:  { pIfUp: 0.35, pIfDown: 0.65 },  // RSI > 70 — reversal risk
    oversold:    { pIfUp: 0.65, pIfDown: 0.35 },  // RSI < 30 — bounce risk
  },
  rsi5m: {
    strongBull:  { pIfUp: 0.63, pIfDown: 0.37 },
    weakBull:    { pIfUp: 0.55, pIfDown: 0.45 },
    neutral:     { pIfUp: 0.50, pIfDown: 0.50 },
    weakBear:    { pIfUp: 0.45, pIfDown: 0.55 },
    strongBear:  { pIfUp: 0.37, pIfDown: 0.63 },
    overbought:  { pIfUp: 0.38, pIfDown: 0.62 },
    oversold:    { pIfUp: 0.62, pIfDown: 0.38 },
  },

  // ── StochRSI extremes ────────────────────────────────────────────────────
  stochRSI: {
    extreme_oversold:   { pIfUp: 0.72, pIfDown: 0.28 },  // k < 10 — strong bounce signal
    oversold:           { pIfUp: 0.63, pIfDown: 0.37 },  // k 10–25
    neutral:            { pIfUp: 0.50, pIfDown: 0.50 },
    overbought:         { pIfUp: 0.37, pIfDown: 0.63 },  // k 75–90
    extreme_overbought: { pIfUp: 0.28, pIfDown: 0.72 },  // k > 90 — reversal warning
  },

  // ── Supertrend ───────────────────────────────────────────────────────────
  supertrend4h: {
    bullish:  { pIfUp: 0.67, pIfDown: 0.33 },
    bearish:  { pIfUp: 0.33, pIfDown: 0.67 },
  },

  // ── Bollinger Band position ───────────────────────────────────────────────
  bbPosition: {
    above_upper: { pIfUp: 0.32, pIfDown: 0.68 },  // overextended → pullback
    upper_half:  { pIfUp: 0.57, pIfDown: 0.43 },
    middle:      { pIfUp: 0.50, pIfDown: 0.50 },
    lower_half:  { pIfUp: 0.43, pIfDown: 0.57 },
    below_lower: { pIfUp: 0.68, pIfDown: 0.32 },  // oversold → bounce
  },

  // ── VWAP relative position ───────────────────────────────────────────────
  vwap: {
    well_above:  { pIfUp: 0.60, pIfDown: 0.40 },  // price > VWAP — momentum
    above:       { pIfUp: 0.56, pIfDown: 0.44 },
    at:          { pIfUp: 0.50, pIfDown: 0.50 },
    below:       { pIfUp: 0.44, pIfDown: 0.56 },
    well_below:  { pIfUp: 0.40, pIfDown: 0.60 },
  },

  // ── Whale sentiment ──────────────────────────────────────────────────────
  // Exchange withdrawals = bullish (coins leaving exchanges)
  // Exchange deposits = bearish (coins entering exchanges to sell)
  whaleSentiment: {
    BULLISH:  { pIfUp: 0.64, pIfDown: 0.36 },
    BEARISH:  { pIfUp: 0.36, pIfDown: 0.64 },
    NEUTRAL:  { pIfUp: 0.50, pIfDown: 0.50 },
  },

  // ── 1-minute price momentum ──────────────────────────────────────────────
  momentum1m: {
    strong_up:   { pIfUp: 0.69, pIfDown: 0.31 },  // > +0.08% in 1m
    weak_up:     { pIfUp: 0.59, pIfDown: 0.41 },  // +0.02% to +0.08%
    flat:        { pIfUp: 0.50, pIfDown: 0.50 },
    weak_down:   { pIfUp: 0.41, pIfDown: 0.59 },
    strong_down: { pIfUp: 0.31, pIfDown: 0.69 },  // < -0.08% in 1m
  },

  // ── Polymarket odds drift ─────────────────────────────────────────────────
  // When Polymarket odds are moving, it tells us informed money is moving
  oddsDrift: {
    up_strongly:   { pIfUp: 0.68, pIfDown: 0.32 },  // odds rising fast → smart money UP
    up_weakly:     { pIfUp: 0.58, pIfDown: 0.42 },
    flat:          { pIfUp: 0.50, pIfDown: 0.50 },
    down_weakly:   { pIfUp: 0.42, pIfDown: 0.58 },
    down_strongly: { pIfUp: 0.32, pIfDown: 0.68 },  // odds falling fast → smart money DOWN
  },

  // ── Multi-TF vote alignment ──────────────────────────────────────────────
  tfVote: {
    strong_bull:   { pIfUp: 0.75, pIfDown: 0.25 },  // 75%+ TFs agree UP
    moderate_bull: { pIfUp: 0.63, pIfDown: 0.37 },
    split:         { pIfUp: 0.50, pIfDown: 0.50 },
    moderate_bear: { pIfUp: 0.37, pIfDown: 0.63 },
    strong_bear:   { pIfUp: 0.25, pIfDown: 0.75 },
  },
};

// ── 2. Log-Space Sequential Bayesian Updater ──────────────────────────────────
//
// Implements equations (2) and (3) from the document.
// Using log-space for numerical stability (avoids underflow with many signals).
//
// log P(H=UP | D1...Dt) = log P(H=UP) + Σ log P(Dk | H=UP) - log Z
//
// Returns: { probUp, probDown, logOdds, updateCount, evidenceLog }
export function bayesianUpdate(priorProbUp, evidenceList) {
  if (!evidenceList || evidenceList.length === 0) {
    return {
      probUp: priorProbUp,
      probDown: 1 - priorProbUp,
      logOdds: Math.log(priorProbUp / (1 - priorProbUp)),
      updateCount: 0,
      evidenceLog: [],
    };
  }

  // Work in log-odds space: λ = log(P(UP) / P(DOWN))
  // Posterior log-odds = prior log-odds + Σ log likelihood-ratios
  //
  // This is the numerically stable form of equation (2)/(3).
  const priorClamped = Math.max(EPSILON, Math.min(1 - EPSILON, priorProbUp));
  let logOdds = Math.log(priorClamped / (1 - priorClamped));
  const updateLog = [];

  for (const evidence of evidenceList) {
    const { signalType, signalValue, weight = 1.0 } = evidence;
    const likeTable = LIKELIHOODS[signalType];
    if (!likeTable) continue;

    const like = likeTable[signalValue];
    if (!like) continue;

    const { pIfUp, pIfDown } = like;
    const pIfUpC   = Math.max(EPSILON, pIfUp);
    const pIfDownC = Math.max(EPSILON, pIfDown);

    // Log likelihood ratio: log(P(D|UP) / P(D|DOWN))
    const llr = Math.log(pIfUpC / pIfDownC);

    // Apply weight — allows downweighting noisy or redundant signals
    const weightedLLR = llr * weight;
    logOdds += weightedLLR;

    updateLog.push({
      signal: `${signalType}:${signalValue}`,
      llr: +llr.toFixed(4),
      weighted: +weightedLLR.toFixed(4),
      weight,
    });
  }

  // Convert log-odds back to probability: P = σ(λ) = 1 / (1 + e^-λ)
  // Fix 4: Cap at 95%/5% to preserve resolution — avoids 0%/100% saturation
  const rawProbUp = 1 / (1 + Math.exp(-logOdds));
  const probUp = Math.max(0.05, Math.min(0.95, rawProbUp));

  return {
    probUp: +probUp.toFixed(6),
    probDown: +(1 - probUp).toFixed(6),
    logOdds: +logOdds.toFixed(4),
    updateCount: updateLog.length,
    evidenceLog: updateLog,
    // Convergence strength: how far from 0.5 (uncertain) is our posterior?
    conviction: +Math.abs(probUp - 0.5).toFixed(4),
  };
}

// ── 3. Extract Evidence from tfData ──────────────────────────────────────────
//
// Converts the raw tfData (from binanceApi.js) into Bayesian evidence items.
// This is the bridge between the existing signalEngine and the Bayesian updater.
//
// Each evidence item: { signalType, signalValue, weight }
export function extractEvidenceFromTfData(tfData, price, whaleSentiment) {
  const evidence = [];
  if (!tfData) return evidence;

  const d4h = tfData['4h'];
  const d1h = tfData['1h'];
  const d5m = tfData['5m'];
  const d15m = tfData['15m'];
  const d1m = tfData['1m'];

  // ── 4H signals (highest weight — 3x) ────────────────────────────────────
  if (d4h) {
    // MACD
    evidence.push({
      signalType: 'macd4h',
      signalValue: d4h.macd.bullish ? 'bullish' : 'bearish',
      weight: 3.0,
    });

    // RSI categorization
    const rsi4h = d4h.rsi;
    let rsiLabel = 'neutral';
    if      (rsi4h > 70) rsiLabel = 'overbought';
    else if (rsi4h < 30) rsiLabel = 'oversold';
    else if (rsi4h > 55) rsiLabel = 'strongBull';
    else if (rsi4h > 50) rsiLabel = 'weakBull';
    else if (rsi4h < 45) rsiLabel = 'strongBear';
    else if (rsi4h < 50) rsiLabel = 'weakBear';
    evidence.push({ signalType: 'rsi4h', signalValue: rsiLabel, weight: 2.0 });

    // Supertrend
    if (d4h.supertrend) {
      evidence.push({
        signalType: 'supertrend4h',
        signalValue: d4h.supertrend.bullish ? 'bullish' : 'bearish',
        weight: 1.5,
      });
    }
  }

  // ── 1H signals (2x) ─────────────────────────────────────────────────────
  if (d1h) {
    evidence.push({
      signalType: 'macd1h',
      signalValue: d1h.macd.bullish ? 'bullish' : 'bearish',
      weight: 2.0,
    });

    // VWAP
    if (d1h.vwap && price) {
      const vwapRatio = (price - d1h.vwap) / d1h.vwap;
      const vwapLabel =
        vwapRatio >  0.005 ? 'well_above' :
        vwapRatio >  0.001 ? 'above' :
        vwapRatio < -0.005 ? 'well_below' :
        vwapRatio < -0.001 ? 'below' : 'at';
      evidence.push({ signalType: 'vwap', signalValue: vwapLabel, weight: 1.0 });
    }
  }

  // ── 15m signals (1.5x) ──────────────────────────────────────────────────
  if (d15m) {
    evidence.push({
      signalType: 'macd5m', // reuse 5m table (15m likelihoods are similar)
      signalValue: d15m.macd.bullish ? 'bullish' : 'bearish',
      weight: 1.5,
    });
  }

  // ── 5m signals (1x) ─────────────────────────────────────────────────────
  if (d5m) {
    evidence.push({
      signalType: 'macd5m',
      signalValue: d5m.macd.bullish ? 'bullish' : 'bearish',
      weight: 1.0,
    });

    // RSI
    const rsi5m = d5m.rsi;
    let rsi5mLabel = 'neutral';
    if      (rsi5m > 70) rsi5mLabel = 'overbought';
    else if (rsi5m < 30) rsi5mLabel = 'oversold';
    else if (rsi5m > 55) rsi5mLabel = 'strongBull';
    else if (rsi5m > 50) rsi5mLabel = 'weakBull';
    else if (rsi5m < 45) rsi5mLabel = 'strongBear';
    else if (rsi5m < 50) rsi5mLabel = 'weakBear';
    evidence.push({ signalType: 'rsi5m', signalValue: rsi5mLabel, weight: 0.8 });

    // Bollinger bands
    if (d5m.bb) {
      const bbPct = d5m.bb.pct;
      const bbLabel =
        bbPct > 95 ? 'above_upper' :
        bbPct > 55 ? 'upper_half' :
        bbPct > 45 ? 'middle' :
        bbPct > 5  ? 'lower_half' : 'below_lower';
      evidence.push({ signalType: 'bbPosition', signalValue: bbLabel, weight: 0.7 });
    }
  }

  // ── 1m signals (0.75x — noisy) ──────────────────────────────────────────
  if (d1m) {
    evidence.push({
      signalType: 'macd1m',
      signalValue: d1m.macd.bullish ? 'bullish' : 'bearish',
      weight: 0.75,
    });

    // StochRSI
    const sk = d1m.stochRSI?.k ?? 50;
    const stochLabel =
      sk < 5  ? 'extreme_oversold' :
      sk < 25 ? 'oversold' :
      sk > 95 ? 'extreme_overbought' :
      sk > 75 ? 'overbought' : 'neutral';
    evidence.push({ signalType: 'stochRSI', signalValue: stochLabel, weight: 1.0 });

    // 1m momentum slope
    const closes1m = d1m.closes?.slice(-10) || [];
    if (closes1m.length >= 6) {
      const half  = Math.floor(closes1m.length / 2);
      const older = closes1m.slice(0, half).reduce((a, b) => a + b, 0) / half;
      const newer = closes1m.slice(-half).reduce((a, b) => a + b, 0) / half;
      const mom   = ((newer - older) / older) * 100;
      const momLabel =
        mom >  0.08 ? 'strong_up' :
        mom >  0.02 ? 'weak_up' :
        mom < -0.08 ? 'strong_down' :
        mom < -0.02 ? 'weak_down' : 'flat';
      evidence.push({ signalType: 'momentum1m', signalValue: momLabel, weight: 1.2 });
    }
  }

  // ── Whale sentiment (0.8x) ───────────────────────────────────────────────
  if (whaleSentiment?.label) {
    evidence.push({
      signalType: 'whaleSentiment',
      signalValue: whaleSentiment.label,
      weight: 0.8,
    });
  }

  return evidence;
}

// ── 4. TF Vote → Bayesian Evidence ───────────────────────────────────────────
// Adds the multi-timeframe trend vote as a single aggregate evidence item.
export function addTfVoteEvidence(evidence, voteResult) {
  if (!voteResult) return evidence;
  const { pct, majority } = voteResult;

  const voteLabel =
    majority === 'BULLISH' && pct >= 75 ? 'strong_bull' :
    majority === 'BULLISH'              ? 'moderate_bull' :
    majority === 'BEARISH' && pct <= 25 ? 'strong_bear' :
    majority === 'BEARISH'              ? 'moderate_bear' : 'split';

  return [...evidence, { signalType: 'tfVote', signalValue: voteLabel, weight: 2.0 }];
}

// ── 5. Polymarket Odds Drift Evidence ────────────────────────────────────────
// When live odds are drifting (from fetchOddsHistory), informed money is moving.
// This is a strong signal — smart money on prediction markets is usually right.
export function addOddsDriftEvidence(evidence, oddsHistory) {
  if (!oddsHistory || oddsHistory.length < 3) return evidence;

  // Look at last 3 history points for drift direction
  const recent = oddsHistory.slice(-3);
  const first  = recent[0].p;
  const last   = recent[recent.length - 1].p;
  const drift  = last - first; // positive = odds going up (bullish)

  const driftLabel =
    drift >  8 ? 'up_strongly' :
    drift >  3 ? 'up_weakly' :
    drift < -8 ? 'down_strongly' :
    drift < -3 ? 'down_weakly' : 'flat';

  return [...evidence, {
    signalType: 'oddsDrift',
    signalValue: driftLabel,
    weight: 1.5, // smart-money money flow is valuable
  }];
}

// ── 6. Prior Generator from signalEngine output ───────────────────────────────
//
// Converts the existing signal engine's confidence + direction into a
// Bayesian prior probability for UP.
//
// The signal engine gives us:
//   result: 'UP' | 'DOWN' | 'NO BET' | '---'
//   conf:   0–74 (percentage confidence)
//
// We map this to a prior probability in [0.35, 0.65] to stay humble.
// Even a perfect signal engine doesn't give us >0.65 prior — the Bayesian
// updates will push it further if the evidence agrees.
export function signalToPrior(signalResult) {
  if (!signalResult || signalResult.result === '---') return 0.5; // no info

  const { result, conf, score } = signalResult;

  if (result === 'NO BET') return 0.5; // skip conditions → uncertain

  // Base confidence translation: conf 50–74 → prob 0.50–0.65
  const confProb = 0.50 + (conf - 50) * (0.15 / 24);

  // Direction
  const probUp = result === 'UP' ? confProb : 1 - confProb;

  // Slight score bonus: 5/5 gets a tiny boost
  const scoreBonus = (score - 3) * 0.01; // +0 to +0.02
  return Math.max(0.35, Math.min(0.65, probUp + scoreBonus));
}

// ── 7. Full Update Pipeline ───────────────────────────────────────────────────
//
// The complete Bayesian pipeline:
//   1. Get prior from signalEngine output
//   2. Extract evidence from all data sources
//   3. Apply sequential updates in log-space
//   4. Return posterior + full evidence audit trail
//
// This is the main function you call from App.jsx / quantEngine.js
export function runBayesianPipeline({
  signalResult,      // from buildSignal() in signalEngine.js
  tfData,            // from fetchAllTimeframes()
  price,             // current BTC price
  whaleSentiment,    // from getWhaleSentiment()
  oddsHistory,       // from fetchOddsHistory() in polymarketApi.js
  voteResult,        // from getTrendVote() in signalEngine.js
}) {
  // Step 1: Set prior from existing signal engine
  const prior = signalToPrior(signalResult);

  // Step 2: Extract all evidence from chart data
  let evidence = extractEvidenceFromTfData(tfData, price, whaleSentiment);

  // Step 3: Add multi-TF vote as aggregate evidence
  if (voteResult) {
    evidence = addTfVoteEvidence(evidence, voteResult);
  }

  // Step 4: Add smart-money odds drift
  if (oddsHistory?.length > 0) {
    evidence = addOddsDriftEvidence(evidence, oddsHistory);
  }

  // Step 5: Run sequential Bayesian update (log-space, numerically stable)
  const posterior = bayesianUpdate(prior, evidence);

  // Step 6: Classify the posterior
  const direction =
    posterior.probUp >= 0.58 ? 'UP' :
    posterior.probUp <= 0.42 ? 'DOWN' : 'NEUTRAL';

  const confidence = Math.round(Math.abs(posterior.probUp - 0.5) * 200); // 0–100

  return {
    prior,
    ...posterior,
    direction,
    confidence,
    // Human-readable summary of strongest evidence
    topSignals: posterior.evidenceLog
      .sort((a, b) => Math.abs(b.weighted) - Math.abs(a.weighted))
      .slice(0, 5)
      .map(e => `${e.weighted > 0 ? '▲' : '▼'} ${e.signal} (${e.weighted > 0 ? '+' : ''}${e.weighted})`),
  };
}
