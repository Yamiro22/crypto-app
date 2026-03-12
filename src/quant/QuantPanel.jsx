// ─── QuantPanel — Bayesian + LMSR UI Component ───────────────────────────────
//
// Drop this component into App.jsx's dashboard or as a new tab.
// Displays:
//   • Bayesian posterior probability bar (vs market price)
//   • LMSR edge detection output
//   • Kelly-sized position recommendation
//   • Top evidence signals driving the Bayesian update
//   • Combined verdict (Rule + Bayes + LMSR convergence)
// ─────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
import { useEffect, useState, useCallback } from 'react';
import { runQuantEngine } from './quantEngine.js';
import { runBacktest, generateSyntheticRounds, formatBacktestReport } from './backtest.js';

// ── Colour helpers ────────────────────────────────────────────────────────────
const C = {
  up:      '#00e5aa',
  down:    '#ff3366',
  warn:    '#ffd700',
  orange:  '#ff6d00',
  purple:  '#c44dff',
  muted:   '#3a3a6a',
  bg:      '#0a0a1a',
  border:  '#131328',
  panel:   '#07071a',
};

const pct = n => `${n}%`;
const money = n => typeof n === 'number' ? `$${n.toFixed(2)}` : n;

// ── Probability Bar ───────────────────────────────────────────────────────────
function ProbBar({ probUp, marketUp, label = 'Bayesian vs Market' }) {
  const modelColor  = probUp >= 60 ? C.up : probUp <= 40 ? C.down : C.warn;
  const diff        = probUp - (marketUp || 50);
  const diffColor   = Math.abs(diff) >= 8 ? (diff > 0 ? C.up : C.down) : C.warn;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: C.muted, fontWeight: 800 }}>{label}</span>
        <span style={{ fontSize: 10, color: diffColor, fontWeight: 800 }}>
          {diff > 0 ? '▲' : '▼'} {Math.abs(diff).toFixed(1)}¢ edge
        </span>
      </div>
      {/* Model bar */}
      <div style={{ position: 'relative', height: 16, background: '#0e0e26', borderRadius: 8, overflow: 'hidden', marginBottom: 3 }}>
        <div style={{ width: pct(probUp), height: '100%', background: `linear-gradient(90deg, ${modelColor}44, ${modelColor})`, borderRadius: 8, transition: 'width 0.6s ease' }} />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px' }}>
          <span style={{ fontSize: 9, color: '#fff', fontWeight: 800 }}>▲ UP {probUp}%</span>
          <span style={{ fontSize: 9, color: '#fff', fontWeight: 800 }}>▼ DOWN {100 - probUp}%</span>
        </div>
      </div>
      {/* Market bar for comparison */}
      {marketUp && (
        <div style={{ position: 'relative', height: 10, background: '#0e0e26', borderRadius: 5, overflow: 'hidden' }}>
          <div style={{ width: pct(marketUp), height: '100%', background: '#1a1a40', borderRadius: 5 }} />
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px' }}>
            <span style={{ fontSize: 8, color: C.muted }}>Market {marketUp}¢</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Evidence Log ──────────────────────────────────────────────────────────────
function EvidenceLog({ signals }) {
  if (!signals?.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 9, color: C.muted, fontWeight: 800, marginBottom: 4 }}>🔍 TOP BAYESIAN EVIDENCE</div>
      {signals.map((s, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: `1px solid #0a0a1a`, fontSize: 9 }}>
          <span style={{ color: s.startsWith('▲') ? C.up : C.down }}>{s}</span>
        </div>
      ))}
    </div>
  );
}

// ── LMSR Badge ────────────────────────────────────────────────────────────────
function LMSRBadge({ lmsr }) {
  if (!lmsr) return null;
  const { inefficiency, tradeable, summary } = lmsr;
  const color =
    inefficiency?.quality === 'STRONG'   ? C.up :
    inefficiency?.quality === 'MODERATE' ? C.warn :
    inefficiency?.quality === 'WEAK'     ? C.orange : C.muted;

  return (
    <div style={{ background: `${color}11`, border: `1px solid ${color}33`, borderRadius: 8, padding: '7px 10px', marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color, fontWeight: 800 }}>📐 LMSR</span>
        <span style={{ fontSize: 9, color: tradeable ? C.up : C.muted, fontWeight: 800 }}>
          {tradeable ? '✅ Tradeable' : '⛔ No edge'}
        </span>
      </div>
      <div style={{ fontSize: 10, color: '#8080c0', marginTop: 3 }}>{summary}</div>
      {inefficiency?.isValid && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <span style={{ fontSize: 9, color }}>Edge: {inefficiency.edgeCentsPerDollar > 0 ? '+' : ''}{inefficiency.edgeCentsPerDollar}¢/$</span>
          <span style={{ fontSize: 9, color: C.muted }}>Quality: {inefficiency.quality}</span>
          <span style={{ fontSize: 9, color: C.muted }}>Model: {(inefficiency.modelPrice * 100).toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}

// ── Sizing Widget ─────────────────────────────────────────────────────────────
function SizingWidget({ decision }) {
  if (!decision) return null;
  const { size, ev, kelly, tradeable, direction, sizing } = decision;
  const color = direction === 'UP' ? C.up : C.down;

  return (
    <div style={{ background: `${color}0a`, border: `1px solid ${color}22`, borderRadius: 8, padding: '7px 10px', marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontFamily: "'Fredoka One'", fontSize: 12, color }}>
          {tradeable ? `${direction === 'UP' ? '▲' : '▼'} ${direction} ${money(size)}` : '⏭ PASS'}
        </span>
        <span style={{ fontSize: 9, color: ev?.evPct >= 4 ? C.up : C.muted, fontWeight: 800 }}>
          EV: {ev?.evPct >= 0 ? '+' : ''}{ev?.evPct}¢
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
        {[
          ['Kelly', `${kelly?.fracKelly ? (kelly.fracKelly * 100).toFixed(1) : 0}%`],
          ['EV/round', ev ? `${ev.evPct >= 0 ? '+' : ''}${ev.evPct}¢` : '—'],
          ['Conviction', decision.score ? `${decision.score}/100` : '—'],
        ].map(([label, val]) => (
          <div key={label} style={{ textAlign: 'center', background: '#050510', borderRadius: 5, padding: '4px 0' }}>
            <div style={{ fontSize: 8, color: C.muted }}>{label}</div>
            <div style={{ fontSize: 11, color: '#e0e0ff', fontWeight: 800 }}>{val}</div>
          </div>
        ))}
      </div>
      {sizing?.reason && <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>{sizing.reason}</div>}
    </div>
  );
}

// ── Main QuantPanel Component ─────────────────────────────────────────────────
export default function QuantPanel({
  signalResult,
  tfData,
  price,
  whaleSentiment,
  oddsHistory,
  spreadData,
  upOdds,
  dnOdds,
  liquidityUSDC,
  balance,
}) {
  const [quantResult, setQuantResult] = useState(null);
  const [backtestReport, setBacktestReport] = useState(null);
  const [backtesting, setBacktesting] = useState(false);

  // ── Run quant engine whenever inputs change ────────────────────────────────
  useEffect(() => {
    if (!tfData || !price) return;
    try {
      const result = runQuantEngine({
        signalResult, tfData, price, whaleSentiment,
        oddsHistory, spreadData, upOdds, dnOdds, liquidityUSDC, balance,
      });
      setQuantResult(result);
    } catch (e) {
      console.error('[QuantPanel] engine error:', e);
    }
  }, [signalResult, tfData, price, whaleSentiment, oddsHistory, spreadData, upOdds, dnOdds, liquidityUSDC, balance]);

  // ── Run backtest ──────────────────────────────────────────────────────────
  const runBT = useCallback(async () => {
    setBacktesting(true);
    await new Promise(r => setTimeout(r, 50)); // yield to UI
    const rounds = generateSyntheticRounds(200);
    const result = runBacktest(rounds, { initialBalance: 100, baseBetSize: 5 });
    setBacktestReport(formatBacktestReport(result));
    setBacktesting(false);
  }, []);

  const d = quantResult?.display;
  const combined = quantResult?.combined;

  if (!quantResult?.ready || !d) {
    return (
      <div className="card" style={{ padding: 12 }}>
        <div style={{ fontFamily: "'Fredoka One'", color: C.purple, fontSize: 13, marginBottom: 8 }}>🧮 Quant Engine</div>
        <div style={{ fontSize: 10, color: C.muted, textAlign: 'center', padding: 20 }}>
          Waiting for chart data…
        </div>
      </div>
    );
  }

  const verdictColor =
    combined?.verdict === 'UP'     ? C.up :
    combined?.verdict === 'DOWN'   ? C.down :
    combined?.verdict === 'NO BET' ? C.warn : C.muted;

  return (
    <div className="card" style={{ padding: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontFamily: "'Fredoka One'", color: C.purple, fontSize: 13 }}>🧮 Quant Engine (Bayesian + LMSR)</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <div style={{ padding: '2px 8px', borderRadius: 10, background: `${verdictColor}22`, fontFamily: "'Fredoka One'", fontSize: 11, color: verdictColor }}>
            {combined?.verdict}
          </div>
          {combined?.layers > 1 && (
            <div style={{ padding: '2px 8px', borderRadius: 10, background: '#1a1a38', fontSize: 9, color: C.muted, fontWeight: 800 }}>
              {combined.layers}-layer
            </div>
          )}
        </div>
      </div>

      {/* Combined reason */}
      <div style={{ fontSize: 10, color: '#8080c0', marginBottom: 10, lineHeight: 1.5 }}>
        {combined?.reason}
      </div>

      {/* Probability bar */}
      <ProbBar
        probUp={d.probUp}
        marketUp={parseFloat(upOdds) || null}
        label={`Bayesian Posterior vs Market (${d.evidenceCount} signals)`}
      />

      {/* Bayesian detail row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 8 }}>
        <span style={{ color: C.muted }}>Log-odds: {d.bayesLogOdds}</span>
        <span style={{ color: C.muted }}>Conviction: {d.bayesConviction}</span>
        <span style={{ color: C.muted }}>{d.bayesProb}</span>
      </div>

      {/* LMSR badge */}
      <LMSRBadge lmsr={quantResult.lmsr} />

      {/* Sizing widget */}
      <SizingWidget decision={quantResult.decision} />

      {/* Evidence log */}
      <EvidenceLog signals={d.topSignals} />

      {/* Backtest button */}
      <div style={{ marginTop: 12, borderTop: '1px solid #0d0d26', paddingTop: 8 }}>
        <button
          onClick={runBT}
          disabled={backtesting}
          style={{
            width: '100%', padding: '6px', borderRadius: 7, border: '1px solid #2a2a50',
            background: '#0c0c22', color: C.purple, fontFamily: "'Fredoka One'",
            fontSize: 11, cursor: 'pointer'
          }}
        >
          {backtesting ? '⏳ Running…' : '📊 Run 200-Round Backtest'}
        </button>
        {backtestReport && (
          <pre style={{
            marginTop: 8, fontSize: 8, color: '#6060a0', background: '#050510',
            borderRadius: 6, padding: 8, overflow: 'auto', maxHeight: 200,
            fontFamily: 'monospace', lineHeight: 1.5, whiteSpace: 'pre',
          }}>
            {backtestReport}
          </pre>
        )}
      </div>
    </div>
  );
}
