// ─── AI PREDICTION MODEL v2 ───────────────────────────────────────────────────
// Momentum-based short-term direction predictor
// Future: swap inner logic with TensorFlow.js model

export function predictDirection(tfData, price) {
  const d1m  = tfData?.['1m'];
  const d5m  = tfData?.['5m'];
  const d15m = tfData?.['15m'];
  const d1h  = tfData?.['1h'];
  const d4h  = tfData?.['4h'];
  if (!d1m || !d5m) return { dir: 'SIDEWAYS', conf: 40, signals: [] };

  const signals = [];
  let bullScore = 0, bearScore = 0;

  // ── 4H macro (highest weight — 3 pts) ────────────────────────────────────
  // FIX: was completely missing from v1 — 4H is the most important TF!
  if (d4h) {
    if (d4h.macd.bullish && d4h.rsi > 38 && d4h.rsi < 76) {
      bullScore += 3;
      signals.push({ label: '4H MACD', val: `RSI ${d4h.rsi?.toFixed(0)} — bull`, bull: true });
    } else if (!d4h.macd.bullish && d4h.rsi < 62 && d4h.rsi > 24) {
      bearScore += 3;
      signals.push({ label: '4H MACD', val: `RSI ${d4h.rsi?.toFixed(0)} — bear`, bull: false });
    }
    // Supertrend adds a 4th confirmation when available
    if (d4h.supertrend?.bullish !== undefined) {
      if (d4h.supertrend.bullish) { bullScore += 1; signals.push({ label: '4H Supertrend', val: 'bullish', bull: true }); }
      else                        { bearScore += 1; signals.push({ label: '4H Supertrend', val: 'bearish', bull: false }); }
    }
  }

  // ── 1H MACD + VWAP (2 pts + 1 pt) ────────────────────────────────────────
  // FIX: was missing from v1 — 1H bridges 4H and 5m
  if (d1h) {
    if (d1h.macd.bullish) { bullScore += 2; signals.push({ label: '1H MACD', val: 'bullish', bull: true }); }
    else                  { bearScore += 2; signals.push({ label: '1H MACD', val: 'bearish', bull: false }); }

    if (d1h.vwap && price) {
      if (price > d1h.vwap) { bullScore += 1; signals.push({ label: 'VWAP', val: `Above $${d1h.vwap?.toFixed(0)}`, bull: true }); }
      else                  { bearScore += 1; signals.push({ label: 'VWAP', val: `Below $${d1h.vwap?.toFixed(0)}`, bull: false }); }
    }
  }

  // ── 15m MACD (1.5 pts — more important than 1m) ───────────────────────────
  // FIX: was only 1pt same as 1m — 15m carries more signal
  if (d15m) {
    if (d15m.macd.bullish) { bullScore += 1.5; signals.push({ label: '15m MACD', val: 'bullish', bull: true }); }
    else                   { bearScore += 1.5; signals.push({ label: '15m MACD', val: 'bearish', bull: false }); }
  }

  // ── 5m MACD (1 pt) ───────────────────────────────────────────────────────
  if (d5m.macd.bullish) { bullScore += 1; signals.push({ label: '5m MACD', val: 'bullish', bull: true }); }
  else                  { bearScore += 1; signals.push({ label: '5m MACD', val: 'bearish', bull: false }); }

  // ── 1m momentum slope (2 pts when clear) ─────────────────────────────────
  // FIX: smoother slope calc across halves instead of last-3 vs first-3
  const closes1m = d1m.closes?.slice(-10) || [];
  if (closes1m.length >= 6) {
    const half  = Math.floor(closes1m.length / 2);
    const older = closes1m.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const newer = closes1m.slice(-half).reduce((a, b)  => a + b, 0) / half;
    const mom   = ((newer - older) / older) * 100;
    if (mom > 0.04) {
      bullScore += 2;
      signals.push({ label: '1m Momentum', val: `+${mom.toFixed(3)}%`, bull: true });
    } else if (mom < -0.04) {
      bearScore += 2;
      signals.push({ label: '1m Momentum', val: `${mom.toFixed(3)}%`, bull: false });
    }
  }

  // ── 1m MACD (1 pt) ───────────────────────────────────────────────────────
  if (d1m.macd.bullish) { bullScore += 1; signals.push({ label: '1m MACD', val: 'bullish', bull: true }); }
  else                  { bearScore += 1; signals.push({ label: '1m MACD', val: 'bearish', bull: false }); }

  // ── RSI 5m (1 pt) ────────────────────────────────────────────────────────
  const rsi5m = d5m.rsi;
  if      (rsi5m > 55 && rsi5m < 75) { bullScore += 1; signals.push({ label: 'RSI 5m', val: `${rsi5m} bull zone`,   bull: true  }); }
  else if (rsi5m < 45 && rsi5m > 25) { bearScore += 1; signals.push({ label: 'RSI 5m', val: `${rsi5m} bear zone`,   bull: false }); }
  else if (rsi5m >= 75)               { bearScore += 1; signals.push({ label: 'RSI 5m', val: `${rsi5m} overbought`, bull: false }); }
  else if (rsi5m <= 25)               { bullScore += 1; signals.push({ label: 'RSI 5m', val: `${rsi5m} oversold`,   bull: true  }); }

  // ── BB position 5m (1 pt) ────────────────────────────────────────────────
  const bb = d5m.bb;
  if (bb && price) {
    if (price > bb.upper) { bearScore += 1; signals.push({ label: 'BB', val: 'Above upper — reversal risk', bull: false }); }
    if (price < bb.lower) { bullScore += 1; signals.push({ label: 'BB', val: 'Below lower — bounce risk',  bull: true  }); }
  }

  // ── StochRSI 1m (1 pt) ───────────────────────────────────────────────────
  const sk = d1m.stochRSI?.k ?? 50;
  if (sk < 15) { bullScore += 1; signals.push({ label: 'StochRSI', val: `${sk} oversold`,   bull: true  }); }
  if (sk > 85) { bearScore += 1; signals.push({ label: 'StochRSI', val: `${sk} overbought`, bull: false }); }

  const total = bullScore + bearScore;
  if (total === 0) return { dir: 'SIDEWAYS', conf: 45, signals };

  const bullPct = (bullScore / total) * 100;

  // FIX: confidence now scales up to 78 (was hard-capped at 70)
  // And uses a mild multiplier so strong agreement gets proper credit
  const rawConf    = bullPct > 50 ? bullPct : 100 - bullPct;
  const scaledConf = Math.min(78, Math.round(50 + (rawConf - 50) * 1.15));

  // FIX: tighter threshold (62/38 vs old 65/35) — reduces SIDEWAYS false-outs
  if (bullPct >= 62) return { dir: 'UP',      conf: scaledConf, signals };
  if (bullPct <= 38) return { dir: 'DOWN',    conf: scaledConf, signals };
  return                    { dir: 'SIDEWAYS', conf: Math.round(50 - Math.abs(bullPct - 50) * 2), signals };
}

// ─── AI LEARNING ENGINE ───────────────────────────────────────────────────────
const BASE_LR  = 0.05;
const MIN_W    = 0.10;
const MAX_W    = 2.00;

// FIX: adaptive learning rate — high-confidence wrong bets punished harder,
// high-confidence right bets rewarded more. Flat rate ignored certainty.
export function updateWeights(weights, features, correct, conf = 60) {
  const nw = { ...weights };
  if (!features) return nw;

  // confFactor: 1.0 at 60% conf, 1.5 at 70%, 0.5 at 50%
  const confFactor = Math.max(0.4, Math.min(2.0, 1 + (conf - 60) / 20));
  const lr = BASE_LR * confFactor;

  Object.keys(features).forEach(k => {
    if (nw[k] === undefined) return;
    const contrib = Math.abs(features[k]);
    if (contrib < 0.01) return; // skip near-zero noise features

    // Wrong bets cost 20% more — discourages overconfident bad signals
    const delta = correct ? lr * contrib : -(lr * contrib * 1.2);
    nw[k] = Math.max(MIN_W, Math.min(MAX_W, nw[k] + delta));
    nw[k] = +nw[k].toFixed(4);
  });
  return nw;
}

// Summarize what the AI has learned vs defaults
export function getWeightInsights(weights, defaultWeights) {
  const insights = [];
  Object.entries(weights).forEach(([k, v]) => {
    const def  = defaultWeights[k] ?? 1.0;
    const diff = +(v - def).toFixed(3);
    if (diff >  0.35) insights.push({ key: k, type: 'strong', msg: `${k} is proving very reliable (+${diff})` });
    if (diff < -0.35) insights.push({ key: k, type: 'weak',   msg: `${k} giving false signals (${diff})` });
    if (v <= MIN_W + 0.05) insights.push({ key: k, type: 'dead', msg: `${k} nearly zeroed — consider Reset` });
  });
  return insights;
}
