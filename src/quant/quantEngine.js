// ─── Quant Engine ─────────────────────────────────────────────────────────────
//
// This is the master integration layer. It:
//   1. Takes raw inputs from the existing signalEngine.js / predictionModel.js
//   2. Runs the full Bayesian pipeline (sequential log-space updating)
//   3. Runs LMSR market analysis (inefficiency + cost calculation)
//   4. Combines both into a final, risk-sized trading decision
//
// Drop-in enhancement — the existing buildSignal() output becomes the prior,
// and this module layers Bayesian refinement + LMSR pricing on top.
//
// ─────────────────────────────────────────────────────────────────────────────

import { runBayesianPipeline }          from './bayesian.js';
import { analyzeLMSR }                  from './lmsr.js';
import { fullSizingDecision }           from './positionSizer.js';
import { getTrendVote, getMacro }       from '../ai/signalEngine.js';

// ── Main Quant Analysis ───────────────────────────────────────────────────────
//
// Call this function after buildSignal() to get the full quant layer output.
//
// Input:
//   signalResult  — output from buildSignal() in signalEngine.js
//   tfData        — from fetchAllTimeframes() in binanceApi.js
//   price         — current BTC price (from WebSocket or REST)
//   whaleSentiment— from getWhaleSentiment() in whaleMonitor.js
//   oddsHistory   — from fetchOddsHistory() in polymarketApi.js
//   upOdds        — Polymarket UP odds in cents (0–100)
//   dnOdds        — Polymarket DOWN odds in cents (0–100)
//   liquidityUSDC — Polymarket market liquidity in USDC
//   spreadData    — from fetchSpreadSignal() in polymarketApi.js
//   balance       — current paper trading balance
//
// Output: { bayesian, lmsr, decision, combined }
export function runQuantEngine({
  signalResult,
  tfData,
  price,
  whaleSentiment,
  oddsHistory,
  spreadData,
  upOdds,
  dnOdds,
  liquidityUSDC,
  balance = 100,
  historicalBets = 0,  // total resolved bets — used for Kelly prior blending
  options = {},
}) {
  // ── Guard: need basic data ────────────────────────────────────────────────
  if (!tfData || !price) {
    return {
      ready: false,
      reason: 'Waiting for chart data',
      bayesian: null,
      lmsr: null,
      decision: null,
    };
  }

  // ── Step 1: Get trend vote for Bayesian evidence ──────────────────────────
  const voteResult = getTrendVote(tfData);

  // ── Step 2: Run Bayesian pipeline ─────────────────────────────────────────
  const bayesian = runBayesianPipeline({
    signalResult,
    tfData,
    price,
    whaleSentiment,
    oddsHistory,
    voteResult,
  });

  // ── Step 3: LMSR market analysis ─────────────────────────────────────────
  // Determine the direction our Bayesian model is pointing at
  const upOddsNum = parseFloat(upOdds) || 50;
  const dnOddsNum = parseFloat(dnOdds) || 50;

  const lmsr = (upOddsNum > 0 && dnOddsNum > 0)
    ? analyzeLMSR({
        upOdds:       upOddsNum,
        downOdds:     dnOddsNum,
        liquidityUSDC: liquidityUSDC || 100000,
        modelProb:    bayesian.probUp,
        spreadData,
        maxPosition:  options.maxPosition || 15,
      })
    : null;

  // ── Step 4: Position sizing decision ──────────────────────────────────────
  const decision = (upOddsNum > 0 && dnOddsNum > 0)
    ? fullSizingDecision({
        bayesResult: bayesian,
        lmsrResult:  lmsr,
        upOdds:  upOddsNum,
        dnOdds:  dnOddsNum,
        balance,
        historicalBets,
        options,
      })
    : null;

  // ── Step 5: Combine with existing signal for final verdict ────────────────
  const combined = combineSignals(signalResult, bayesian, lmsr, decision);

  return {
    ready: true,
    bayesian,
    lmsr,
    decision,
    combined,
    // Summary for UI display
    display: buildDisplayOutput(bayesian, lmsr, decision, combined),
  };
}

// ── Signal Combination Logic ──────────────────────────────────────────────────
//
// The existing signalEngine uses a 5-factor confluence score (0–5).
// We add the Bayesian + LMSR layer as a "second opinion" that can:
//   - Veto a bet the signal engine likes (if Bayesian strongly disagrees)
//   - Confirm a borderline bet (if both agree strongly)
//   - Detect orphaned edges the rule engine missed
function combineSignals(signalResult, bayesian, lmsr, decision) {
  if (!bayesian || !decision) {
    return { verdict: 'PENDING', conf: 0, reason: 'Quant data loading' };
  }

  const sigDir   = signalResult?.result;
  const bayDir   = bayesian.direction;
  const decDir   = decision?.direction;
  const bayConf  = bayesian.conviction;
  const lmsrEdge = lmsr?.inefficiency?.isValid;

  // Case 1: All three agree → STRONG
  if (sigDir === bayDir && sigDir === decDir && sigDir !== 'NO BET' && sigDir !== '---' && sigDir !== 'NEUTRAL') {
    const conf = signalResult.conf + Math.round(bayConf * 40) + (lmsrEdge ? 5 : 0);
    return {
      verdict: sigDir,
      conf: Math.min(conf, 85),
      reason: `✅ 3-layer convergence: Rule(${sigDir}) + Bayes(${bayDir}) + LMSR(${lmsrEdge ? 'edge' : 'no edge'})`,
      strength: 'STRONG',
      layers: 3,
    };
  }

  // Case 2: Signal engine skips, but Bayesian + LMSR both see an edge
  if ((sigDir === 'NO BET' || sigDir === '---') && bayDir !== 'NEUTRAL' && lmsrEdge) {
    const conf = Math.round(bayConf * 100) + (lmsrEdge ? 10 : 0);
    return {
      verdict: bayDir,
      conf: Math.min(conf, 72),
      reason: `🔍 Quant override: Rule skipped but Bayes(${bayDir} ${(bayConf*200).toFixed(0)}%) + LMSR edge`,
      strength: 'MODERATE',
      layers: 2,
    };
  }

  // Case 3: Signal + Bayesian agree (no LMSR data)
  if (sigDir === bayDir && sigDir !== 'NO BET' && sigDir !== '---' && sigDir !== 'NEUTRAL') {
    const conf = signalResult.conf + Math.round(bayConf * 20);
    return {
      verdict: sigDir,
      conf: Math.min(conf, 78),
      reason: `✅ Rule + Bayes agree: ${sigDir} (Bayes: ${(bayesian.probUp * 100).toFixed(1)}% UP)`,
      strength: 'MODERATE',
      layers: 2,
    };
  }

  // Case 4: Rule engine says bet, Bayesian disagrees strongly → caution
  if ((sigDir === 'UP' || sigDir === 'DOWN') && bayDir !== sigDir && bayConf > 0.10) {
    return {
      verdict: 'NO BET',
      conf: 0,
      reason: `⚠️ Bayesian veto: Rule→${sigDir} but Bayes→${bayDir} (${(bayesian.probUp * 100).toFixed(1)}% UP). Skip.`,
      strength: 'VETO',
      layers: 0,
    };
  }

  // Default: use the signal engine result
  return {
    verdict: sigDir || '---',
    conf: signalResult?.conf || 0,
    reason: signalResult?.reason || 'No signal',
    strength: 'RULE_ONLY',
    layers: 1,
  };
}

// ── Display Output Builder ────────────────────────────────────────────────────
function buildDisplayOutput(bayesian, lmsr, decision, combined) {
  if (!bayesian) return null;

  const probBar = Math.round(bayesian.probUp * 100);
  const edgeStr = lmsr?.inefficiency?.isValid
    ? `${lmsr.inefficiency.quality} edge: ${lmsr.inefficiency.edgeCentsPerDollar > 0 ? '+' : ''}${lmsr.inefficiency.edgeCentsPerDollar}¢/$`
    : 'No LMSR edge';

  return {
    // For the probability bar visualization
    probUp:   probBar,
    probDown: 100 - probBar,
    probColor: probBar >= 60 ? '#00e5aa' : probBar <= 40 ? '#ff3366' : '#ffd700',

    // Main verdict display
    verdict:  combined.verdict,
    verdictColor: combined.verdict === 'UP' ? '#00e5aa' : combined.verdict === 'DOWN' ? '#ff3366' : '#ffd700',
    conf:     combined.conf,
    strength: combined.strength,
    reason:   combined.reason,

    // Bayesian detail
    bayesProb:      `${(bayesian.probUp * 100).toFixed(1)}% UP / ${(bayesian.probDown * 100).toFixed(1)}% DOWN`,
    bayesConviction: `${(bayesian.conviction * 200).toFixed(0)}%`,
    bayesLogOdds:   bayesian.logOdds,
    topSignals:     bayesian.topSignals,
    evidenceCount:  bayesian.updateCount,

    // LMSR detail
    lmsrEdge:     edgeStr,
    lmsrQuality:  lmsr?.inefficiency?.quality || 'N/A',
    lmsrTradeable: lmsr?.tradeable || false,

    // Position sizing
    sizeRec:      decision?.size || 0,
    evPct:        decision?.ev?.evPct || 0,
    kellyPct:     decision ? (decision.kelly.fracKelly * 100).toFixed(1) : '0',
    dailyEV:      decision?.sizing?.reason || '',
  };
}

// ── Quant Engine State Reducer ────────────────────────────────────────────────
// Use this in React's useReducer for clean state management.
//
// State shape matches App.jsx's existing useState pattern.
export const QUANT_INIT = {
  quantResult: null,
  quantLoading: false,
  quantError: null,
  lastQuantUpdate: null,
};

// ── Integration hook helper ───────────────────────────────────────────────────
// Utility to check if the quant engine result is bullish/bearish with the
// existing signal, for quick conditional rendering in App.jsx
export function quantAgrees(quantResult, signalResult) {
  if (!quantResult?.combined || !signalResult) return false;
  return (
    quantResult.combined.verdict === signalResult.result &&
    ['UP', 'DOWN'].includes(quantResult.combined.verdict)
  );
}

export function quantVetoes(quantResult, signalResult) {
  if (!quantResult?.combined || !signalResult) return false;
  return (
    quantResult.combined.strength === 'VETO' &&
    ['UP', 'DOWN'].includes(signalResult.result)
  );
}