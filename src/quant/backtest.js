// ─── Backtest Engine ──────────────────────────────────────────────────────────
//
// Simulates the Quant Engine (Bayesian + LMSR + Position Sizer) against
// historical 5-minute BTC rounds and compares to the base signal engine.
//
// Two modes:
//   1. runBacktest(rounds)  — feed historical round data, get accuracy report
//   2. generateSyntheticRounds(n) — synthetic BTC-like data for demo
//
// ─────────────────────────────────────────────────────────────────────────────

import { buildSignal, getTrendVote, DEFAULT_WEIGHTS } from '../ai/signalEngine.js';
import { predictDirection }                            from '../ai/predictionModel.js';
import { runQuantEngine }                              from './quantEngine.js';
import { calcEV }                                      from './positionSizer.js';

// ── 1. Run Backtest ───────────────────────────────────────────────────────────
//
// Each `round` in `rounds` should have:
//   { tfData, price, whaleSentiment, upOdds, dnOdds, liquidityUSDC,
//     oddsHistory, spreadData, actualOutcome: 'UP' | 'DOWN' }
//
// Returns comprehensive performance comparison.
export function runBacktest(rounds, options = {}) {
  const {
    initialBalance = 100,
    baseBetSize    = 5,
    kellyFrac      = 0.25,
    minEV          = 0.04,
    verbose        = false,
  } = options;

  const results = {
    base:  initStats(initialBalance),
    quant: initStats(initialBalance),
    rounds: [],
  };

  for (const round of rounds) {
    const {
      tfData, price, whaleSentiment, upOdds, dnOdds,
      liquidityUSDC, oddsHistory, spreadData, actualOutcome,
    } = round;

    // ── Base signal engine ────────────────────────────────────────────────
    const signalResult = buildSignal({
      tfData, price,
      upOdds:     upOdds?.toString(),
      downOdds:   dnOdds?.toString(),
      threshold:  null,
      thresholdSource: null,
      dangerous:  false,
      whale:      false,
      lowLiq:     false,
      whaleSentiment,
      weights:    DEFAULT_WEIGHTS,
      spreadData,
    });

    // ── Quant engine ──────────────────────────────────────────────────────
    const quantResult = runQuantEngine({
      signalResult, tfData, price, whaleSentiment, oddsHistory,
      spreadData, upOdds, dnOdds, liquidityUSDC,
      balance: results.quant.balance,
      options: { kellyFrac, maxPosition: 20, minEV },
    });

    // ── Evaluate base ─────────────────────────────────────────────────────
    const baseDir = signalResult?.result;
    const baseActivates = ['UP', 'DOWN'].includes(baseDir);
    let basePnl = 0;
    let baseBet = 0;
    if (baseActivates) {
      const odds = (baseDir === 'UP' ? upOdds : dnOdds) / 100;
      baseBet = baseBetSize;
      const won = baseDir === actualOutcome;
      basePnl = won ? +(baseBet / odds - baseBet).toFixed(2) : -baseBet;
      updateStats(results.base, baseBet, basePnl, won);
    } else {
      results.base.skipped++;
    }

    // ── Evaluate quant ────────────────────────────────────────────────────
    const quantVerdict = quantResult?.combined?.verdict;
    const quantTradeable = quantResult?.decision?.tradeable;
    const quantSize    = quantResult?.decision?.size || 0;
    const quantActivates = ['UP', 'DOWN'].includes(quantVerdict) && quantTradeable && quantSize > 0;
    let quantPnl = 0;
    let quantBet = 0;
    if (quantActivates) {
      const odds = (quantVerdict === 'UP' ? upOdds : dnOdds) / 100;
      quantBet = Math.min(quantSize, results.quant.balance * 0.15); // safety cap
      if (results.quant.balance >= quantBet && quantBet >= 0.5) {
        const won = quantVerdict === actualOutcome;
        quantPnl = won ? +(quantBet / odds - quantBet).toFixed(2) : -quantBet;
        updateStats(results.quant, quantBet, quantPnl, won);
      } else {
        results.quant.skipped++;
      }
    } else {
      results.quant.skipped++;
    }

    if (verbose) {
      results.rounds.push({
        outcome: actualOutcome,
        upOdds,
        dnOdds,
        base:  { dir: baseDir,     bet: baseBet,  pnl: basePnl  },
        quant: { dir: quantVerdict, bet: quantBet, pnl: quantPnl,
                 probUp: quantResult?.bayesian?.probUp,
                 ev: quantResult?.decision?.ev?.evPct },
      });
    }
  }

  // ── Final statistics ──────────────────────────────────────────────────────
  return {
    base:  finalizeStats(results.base,  rounds.length),
    quant: finalizeStats(results.quant, rounds.length),
    roundsAnalyzed: rounds.length,
    rounds: results.rounds,
    comparison: buildComparison(results.base, results.quant, rounds.length, initialBalance),
  };
}

function initStats(initialBalance) {
  return {
    balance: initialBalance,
    initial: initialBalance,
    wins: 0, losses: 0, skipped: 0,
    totalBet: 0, totalPnl: 0,
    maxDrawdown: 0, peak: initialBalance,
    history: [initialBalance],
  };
}

function updateStats(stats, bet, pnl, won) {
  if (won) stats.wins++; else stats.losses++;
  stats.totalBet += bet;
  stats.totalPnl += pnl;
  stats.balance   = +(stats.balance + pnl).toFixed(2);
  if (stats.balance > stats.peak) stats.peak = stats.balance;
  const dd = (stats.peak - stats.balance) / stats.peak;
  if (dd > stats.maxDrawdown) stats.maxDrawdown = +dd.toFixed(4);
  stats.history.push(stats.balance);
}

function finalizeStats(stats, totalRounds) {
  const traded = stats.wins + stats.losses;
  return {
    finalBalance: +stats.balance.toFixed(2),
    totalPnl:     +stats.totalPnl.toFixed(2),
    roi:          +(((stats.balance - stats.initial) / stats.initial) * 100).toFixed(2),
    winRate:      traded > 0 ? +((stats.wins / traded) * 100).toFixed(1) : 0,
    wins:         stats.wins,
    losses:       stats.losses,
    skipped:      stats.skipped,
    tradedPct:    +((traded / totalRounds) * 100).toFixed(1),
    maxDrawdownPct: +(stats.maxDrawdown * 100).toFixed(2),
    avgBetSize:   traded > 0 ? +(stats.totalBet / traded).toFixed(2) : 0,
    history:      stats.history,
  };
}

function buildComparison(base, quant, total, initial) {
  const bPnl = +(base.totalPnl).toFixed(2);
  const qPnl = +(quant.totalPnl).toFixed(2);
  const pnlDelta = +(qPnl - bPnl).toFixed(2);

  const bTrades = base.wins + base.losses;
  const qTrades = quant.wins + quant.losses;
  const bWR = bTrades > 0 ? (base.wins / bTrades * 100).toFixed(1) : 0;
  const qWR = qTrades > 0 ? (quant.wins / qTrades * 100).toFixed(1) : 0;

  return {
    pnlDelta,
    pnlImprovement: bPnl !== 0 ? +((pnlDelta / Math.abs(bPnl)) * 100).toFixed(1) : 0,
    winRateDelta:   +(qWR - bWR).toFixed(1),
    baseWinRate:    bWR,
    quantWinRate:   qWR,
    tradesDelta:    qTrades - bTrades,
    // Quality over quantity — quant should trade less but win more
    betterQuality:  parseFloat(qWR) >= parseFloat(bWR) && qTrades <= bTrades,
    summary: `Quant: ${qWR}% WR, $${qPnl} P&L (${pnlDelta >= 0 ? '+' : ''}$${pnlDelta} vs base)`,
  };
}

// ── 2. Synthetic Round Generator ─────────────────────────────────────────────
//
// Generates realistic synthetic 5-min BTC trading data for testing.
// Simulates trending + ranging regimes, realistic RSI/MACD patterns.
export function generateSyntheticRounds(n = 100, seed = 42) {
  const rounds = [];
  let price = 95000;
  let trend = 0; // -1 bearish, 0 neutral, +1 bullish
  let trendStrength = 0;
  let trendDuration = 0;

  // Simple seeded PRNG
  let rngState = seed;
  const rng = () => {
    rngState = (rngState * 1664525 + 1013904223) & 0xffffffff;
    return (rngState >>> 0) / 0xffffffff;
  };

  for (let i = 0; i < n; i++) {
    // ── Regime change ──────────────────────────────────────────────────────
    trendDuration++;
    if (trendDuration > 8 + Math.floor(rng() * 12)) {
      trend = rng() > 0.5 ? 1 : rng() > 0.5 ? -1 : 0;
      trendStrength = 0.3 + rng() * 0.6;
      trendDuration = 0;
    }

    // ── Price evolution ────────────────────────────────────────────────────
    const trendBias  = trend * trendStrength * 0.001;
    const noise      = (rng() - 0.5) * 0.004;
    const priceMove  = trendBias + noise;
    price = +(price * (1 + priceMove)).toFixed(2);

    // ── Build synthetic tfData ─────────────────────────────────────────────
    // Generate realistic OHLCV for each timeframe
    const tfData = buildSyntheticTfData(price, trend, trendStrength, rng, i);

    // ── Polymarket odds ────────────────────────────────────────────────────
    // Odds partially correlated with real trend + noise
    const trueProb  = 0.50 + trend * trendStrength * 0.20;
    const oddsNoise = (rng() - 0.5) * 0.12;
    const upOdds    = Math.max(25, Math.min(75, Math.round((trueProb + oddsNoise) * 100)));
    const dnOdds    = 100 - upOdds;

    // ── Actual outcome ─────────────────────────────────────────────────────
    // Outcome partially correlated with true trend + randomness
    const outcomeProb = trueProb + (rng() - 0.5) * 0.3;
    const actualOutcome = outcomeProb > 0.5 ? 'UP' : 'DOWN';

    // ── Whale sentiment ────────────────────────────────────────────────────
    const whaleRnd = rng();
    const whaleSentiment = {
      label: whaleRnd > 0.7 ? 'BULLISH' : whaleRnd < 0.3 ? 'BEARISH' : 'NEUTRAL',
      score: (whaleRnd - 0.5) * 2,
    };

    rounds.push({
      i,
      price,
      trend: trend === 1 ? 'BULL' : trend === -1 ? 'BEAR' : 'FLAT',
      tfData,
      upOdds,
      dnOdds,
      liquidityUSDC: 100000 + rng() * 200000,
      whaleSentiment,
      oddsHistory: null,
      spreadData: {
        spreadCents: 1 + rng() * 8,
        quality: rng() > 0.6 ? 'TIGHT' : rng() > 0.3 ? 'NORMAL' : 'WIDE',
        imbalance: (rng() - 0.5) * 60,
      },
      actualOutcome,
    });
  }

  return rounds;
}

// ── Build realistic-ish synthetic tfData ──────────────────────────────────────
function buildSyntheticTfData(currentPrice, trend, strength, rng, tick) {
  const tf = {};
  const timeframes = ['1m', '5m', '15m', '30m', '1h', '4h'];
  const decays = { '1m': 0.2, '5m': 0.5, '15m': 0.65, '30m': 0.75, '1h': 0.85, '4h': 0.95 };

  for (const t of timeframes) {
    const decay = decays[t];
    // Higher timeframes → stronger trend signal, less noise
    const effectiveTrend = trend * strength * decay;
    const noise = rng() - 0.5;
    const macdBull = effectiveTrend + noise * 0.5 > 0;
    const rsiBase = 50 + effectiveTrend * 25 + (rng() - 0.5) * 15;
    const rsi = Math.max(20, Math.min(80, rsiBase));
    const stochK = Math.max(5, Math.min(95, 50 + effectiveTrend * 30 + (rng() - 0.5) * 20));

    tf[t] = {
      price: currentPrice,
      closes: Array.from({ length: 200 }, (_, i) => {
        const progress = i / 200;
        const historicTrend = effectiveTrend * progress * 0.002;
        return currentPrice * (0.99 + historicTrend + (rng() - 0.5) * 0.001);
      }),
      macd: {
        bullish: macdBull,
        line: (effectiveTrend * 50 + (rng() - 0.5) * 10).toFixed(2),
        signal: ((effectiveTrend * 50 - 5) + (rng() - 0.5) * 5).toFixed(2),
        hist: (effectiveTrend * 10 + (rng() - 0.5) * 5).toFixed(2),
      },
      rsi: +rsi.toFixed(2),
      stochRSI: { k: +stochK.toFixed(2), d: +stochK.toFixed(2) },
      bb: {
        pct: +(50 + effectiveTrend * 30 + (rng() - 0.5) * 20).toFixed(1),
        upper: currentPrice * 1.005,
        lower: currentPrice * 0.995,
        middle: currentPrice,
      },
      supertrend: { bullish: effectiveTrend > 0 },
      vwap: currentPrice * (1 + effectiveTrend * 0.001),
      opens:   Array(200).fill(currentPrice),
      highs:   Array(200).fill(currentPrice * 1.002),
      lows:    Array(200).fill(currentPrice * 0.998),
      volumes: Array(200).fill(1000 + rng() * 500),
      times:   Array(200).fill(Date.now()),
      candles: [],
    };
  }
  return tf;
}

// ── 3. Print Backtest Report ──────────────────────────────────────────────────
// Returns a human-readable summary string.
export function formatBacktestReport(btResult) {
  const { base, quant, comparison, roundsAnalyzed } = btResult;
  const lines = [
    `═══════════════════════════════════════════════════════`,
    `  BACKTEST REPORT — ${roundsAnalyzed} rounds`,
    `═══════════════════════════════════════════════════════`,
    ``,
    `  BASE SIGNAL ENGINE:`,
    `    Win Rate    : ${base.winRate}%`,
    `    P&L         : $${base.totalPnl} (ROI: ${base.roi}%)`,
    `    Trades      : ${base.wins + base.losses} (${base.tradedPct}% of rounds)`,
    `    Max Drawdown: ${base.maxDrawdownPct}%`,
    `    Final Bal.  : $${base.finalBalance}`,
    ``,
    `  BAYESIAN + LMSR QUANT ENGINE:`,
    `    Win Rate    : ${quant.winRate}%  (${parseFloat(quant.winRate) >= parseFloat(base.winRate) ? '▲' : '▼'} ${Math.abs(comparison.winRateDelta).toFixed(1)}%)`,
    `    P&L         : $${quant.totalPnl} (ROI: ${quant.roi}%)`,
    `    Trades      : ${quant.wins + quant.losses} (${quant.tradedPct}% of rounds)`,
    `    Max Drawdown: ${quant.maxDrawdownPct}%`,
    `    Final Bal.  : $${quant.finalBalance}`,
    ``,
    `  COMPARISON:`,
    `    P&L Delta   : ${comparison.pnlDelta >= 0 ? '+' : ''}$${comparison.pnlDelta}`,
    `    Win Rate Δ  : ${comparison.winRateDelta >= 0 ? '+' : ''}${comparison.winRateDelta}%`,
    `    Quality     : ${comparison.betterQuality ? '✅ Better quality trades' : '⚠️ No clear improvement'}`,
    `    Summary     : ${comparison.summary}`,
    `═══════════════════════════════════════════════════════`,
  ];
  return lines.join('\n');
}

// ── 4. Quick Demo ─────────────────────────────────────────────────────────────
// Run this in a browser console or Node.js to see the backtest in action.
export async function runDemo(n = 200) {
  console.log(`🐾 BabyDoge Quant Engine — Backtest Demo (${n} rounds)`);
  console.log(`Generating synthetic BTC 5-min rounds...`);

  const rounds = generateSyntheticRounds(n);
  const result = runBacktest(rounds, { initialBalance: 100, baseBetSize: 5, kellyFrac: 0.25, verbose: true });
  console.log(formatBacktestReport(result));

  return result;
}
