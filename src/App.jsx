/**
 * ============================================================
 * App.jsx  —  BabyDoge BTC Oracle v3
 * Continuous-Loop Orchestration + Dynamic Position Sizing
 * ============================================================
 *
 * WHAT CHANGED FROM v2:
 *   ❌ Removed: static T-4:10 timer gate
 *   ❌ Removed: "Hold to expiry" only strategy
 *   ❌ Removed: static betAmt
 *
 *   ✅ Added: continuous 5-second signal evaluation loop
 *   ✅ Added: positionManager integration (TP/SL/trailing)
 *   ✅ Added: Kelly Criterion dynamic bet sizing
 *   ✅ Added: asset_id tracking in pendingBet state
 *   ✅ Added: live P&L display from positionManager ticks
 *   ✅ Added: post-exit cooldown (avoid re-entering immediately)
 *
 * FILE STRUCTURE:
 *   This file replaces the hook/interval logic sections of
 *   your existing App.jsx.  Merge it with your current
 *   UI components (Dashboard, Chart, etc.).
 *
 * ============================================================
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';

// ── Services ─────────────────────────────────────────────────
import { useBinanceWS }       from './services/binanceWS';
import { fetchKlines }        from './services/binanceApi';
import { fetchMarketData, buyPosition } from './services/polymarketApi';
import { positionManager }    from './services/positionManager';

// ── Intelligence ─────────────────────────────────────────────
import { calcMACD, calcRSI, calcBB, calcEMA, calcStochRSI } from './utils/indicators';

// Wrapper that builds the indicator object the signal engine expects
const computeIndicators = (klines, livePrice) => {
  if (!klines || klines.length < 50) return null;
  const closes  = klines.map(k => parseFloat(k[4]));
  const highs   = klines.map(k => parseFloat(k[2]));
  const lows    = klines.map(k => parseFloat(k[3]));

  // Append live price as the latest close
  if (livePrice) closes.push(livePrice);

  const macdRaw = calcMACD(closes);
  const rsi1m   = calcRSI(closes, 14);
  const bb      = calcBB(closes, 20);

  // 4H/1H macro: approximate using longer EMA periods on 1m data
  const ema20  = calcEMA(closes, 20);
  const ema50  = calcEMA(closes, 50);
  const ema100 = calcEMA(closes, 100);

  return {
    price:   livePrice || closes[closes.length - 1],
    rsi1m,
    macd1m: {
      value:     macdRaw.line,
      signal:    macdRaw.signal,
      histogram: macdRaw.hist,
      cross:     macdRaw.bullish ? 'BULL' : 'BEAR',
    },
    bb1m: {
      upper: bb.upper,
      lower: bb.lower,
      mid:   bb.middle,
      width: bb.upper - bb.lower,
    },
    ema4h: {
      fast: ema50[ema50.length - 1],
      slow: ema100[ema100.length - 1],
    },
    ema1h: {
      fast: ema20[ema20.length - 1],
      slow: ema50[ema50.length - 1],
    },
    bbWidthHistory: [],
  };
};
import { evaluateSignal, calcKellyBetSize } from './ai/signalEngine';
import { updatePredictionModel }            from './ai/predictionModel';

// ── UI ───────────────────────────────────────────────────────
// Only CandlestickChart exists as a separate file.
// All other UI panels live inline in your original App.jsx —
// keep your existing JSX render below and just add the new
// state/hooks from this file into it.
import CandlestickChart from './charts/CandlestickChart';

// ─────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────

/** How often the signal engine re-evaluates (ms) */
const SIGNAL_CHECK_INTERVAL_MS = 5000;

/** Seconds to wait after closing a position before entering again */
const POST_TRADE_COOLDOWN_S = 30;

/** Polymarket market ID for the active BTC 5-min market */
const DEFAULT_MARKET_ID = import.meta.env.VITE_POLYMARKET_MARKET_ID ?? '';

/** Maximum % of bankroll risked in any single trade (Kelly cap) */
const MAX_BET_PCT = 0.05; // 5 %

// ─────────────────────────────────────────────────────────────
//  STATE SHAPE (reference)
// ─────────────────────────────────────────────────────────────
/**
 * pendingBet: {
 *   asset_id:   string   ← token address (CRITICAL for sell)
 *   order_id:   string
 *   direction:  'UP'|'DOWN'
 *   entryPrice: number
 *   tokenQty:   number
 *   usdcSpent:  number
 *   enteredAt:  number   ← timestamp
 * } | null
 *
 * livePosition: {
 *   bid:          number
 *   pnl:          number
 *   pnlPct:       number
 *   highWater:    number
 *   trailingFloor:number|null
 *   status:       string
 * } | null
 */

// ─────────────────────────────────────────────────────────────
//  APP COMPONENT
// ─────────────────────────────────────────────────────────────

export default function App() {
  // ── Market data ────────────────────────────────────────────
  const livePrice      = useBinanceWS('BTCUSDT');   // live WebSocket price
  const [klines, setKlines]             = useState([]);
  const [indicators, setIndicators]     = useState(null);
  const [marketData, setMarketData]     = useState({ yes: 50, no: 50 });
  const [currentSignal, setCurrentSignal] = useState(null);

  // ── Bot state ──────────────────────────────────────────────
  const [autoBotEnabled, setAutoBotEnabled] = useState(false);
  const [pendingBet, setPendingBet]         = useState(null);
  const [livePosition, setLivePosition]     = useState(null);
  const [tradeHistory, setTradeHistory]     = useState([]);
  const [bankroll, setBankroll]             = useState(100.00);  // USDC

  // ── AI weights (persisted across rounds) ──────────────────
  const [aiWeights, setAiWeights]           = useState(null);

  // ── Bot status display ─────────────────────────────────────
  const [botStatus, setBotStatus]   = useState('IDLE');
  const [cooldownEnd, setCooldownEnd] = useState(0);  // timestamp

  // ── Refs (avoid stale closures in intervals) ───────────────
  const autoBotRef    = useRef(autoBotEnabled);
  const pendingBetRef = useRef(pendingBet);
  const bankrollRef   = useRef(bankroll);
  const indicatorsRef = useRef(indicators);
  const marketDataRef = useRef(marketData);
  const cooldownRef   = useRef(0);

  // Keep refs in sync with state
  useEffect(() => { autoBotRef.current    = autoBotEnabled; }, [autoBotEnabled]);
  useEffect(() => { pendingBetRef.current = pendingBet;     }, [pendingBet]);
  useEffect(() => { bankrollRef.current   = bankroll;       }, [bankroll]);
  useEffect(() => { indicatorsRef.current = indicators;     }, [indicators]);
  useEffect(() => { marketDataRef.current = marketData;     }, [marketData]);

  // ─────────────────────────────────────────────────────────────
  //  KLINES + INDICATORS  (refresh every 60s)
  // ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const loadKlines = async () => {
      try {
        const data = await fetchKlines('BTCUSDT', '1m', 200);
        setKlines(data);

        const computed = computeIndicators(data, livePrice);
        setIndicators(computed);
        indicatorsRef.current = computed;
      } catch (err) {
        console.error('[App] loadKlines error:', err);
      }
    };

    loadKlines();
    const id = setInterval(loadKlines, 60_000);
    return () => clearInterval(id);
  }, [livePrice]);

  // ─────────────────────────────────────────────────────────────
  //  POLYMARKET ODDS  (refresh every 30s)
  // ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!DEFAULT_MARKET_ID) return;

    const loadMarket = async () => {
      const data = await fetchMarketData(DEFAULT_MARKET_ID);
      if (data) {
        setMarketData(data);
        marketDataRef.current = data;
      }
    };

    loadMarket();
    const id = setInterval(loadMarket, 30_000);
    return () => clearInterval(id);
  }, []);

  // ─────────────────────────────────────────────────────────────
  //  POSITION MANAGER CALLBACKS
  // ─────────────────────────────────────────────────────────────

  const handleTakeProfit = useCallback((receipt) => {
    console.info('[App] 🎯 Take-Profit!', receipt);

    const gain = (receipt.usdcReceived - (pendingBetRef.current?.usdcSpent ?? 0));
    setBankroll(prev => parseFloat((prev + receipt.usdcReceived).toFixed(2)));

    setTradeHistory(prev => [{
      ...pendingBetRef.current,
      exitReason:    receipt.reason,
      exitPrice:     receipt.sellPrice,
      usdcReceived:  receipt.usdcReceived,
      pnl:           gain,
      closedAt:      Date.now(),
    }, ...prev.slice(0, 49)]);

    _closeTrade();
    // Update AI model with a WIN
    setAiWeights(prev => updatePredictionModel(prev, currentSignal, true));
  }, [currentSignal]);

  const handleStopLoss = useCallback((receipt) => {
    console.info('[App] 🛑 Stop-Loss!', receipt);

    const loss = (receipt.usdcReceived - (pendingBetRef.current?.usdcSpent ?? 0));
    setBankroll(prev => parseFloat((prev + receipt.usdcReceived).toFixed(2)));

    setTradeHistory(prev => [{
      ...pendingBetRef.current,
      exitReason:    receipt.reason,
      exitPrice:     receipt.sellPrice,
      usdcReceived:  receipt.usdcReceived,
      pnl:           loss,
      closedAt:      Date.now(),
    }, ...prev.slice(0, 49)]);

    _closeTrade();
    // Update AI model with a LOSS
    setAiWeights(prev => updatePredictionModel(prev, currentSignal, false));
  }, [currentSignal]);

  const handlePositionTick = useCallback((tickData) => {
    setLivePosition(tickData);
  }, []);

  const handlePositionError = useCallback((err) => {
    console.error('[App] Position monitor error:', err);
    setBotStatus('ERROR');
    _closeTrade();
  }, []);

  // ─────────────────────────────────────────────────────────────
  //  INTERNAL: CLOSE TRADE CLEANUP
  // ─────────────────────────────────────────────────────────────

  const _closeTrade = useCallback(() => {
    setPendingBet(null);
    pendingBetRef.current = null;
    setLivePosition(null);
    setBotStatus('COOLDOWN');

    // Enforce post-trade cooldown
    const end = Date.now() + POST_TRADE_COOLDOWN_S * 1000;
    setCooldownEnd(end);
    cooldownRef.current = end;

    setTimeout(() => {
      setBotStatus('WATCHING');
    }, POST_TRADE_COOLDOWN_S * 1000);
  }, []);

  // ─────────────────────────────────────────────────────────────
  //  TRADE EXECUTION
  // ─────────────────────────────────────────────────────────────

  const executeTrade = useCallback(async (signal) => {
    const mktData = marketDataRef.current;
    const indics  = indicatorsRef.current;
    if (!mktData || !indics) return;

    // Determine which token to buy
    const isUp      = signal.direction === 'UP';
    const asset_id  = isUp ? mktData.yesTokenId : mktData.noTokenId;
    const askPrice  = isUp
      ? (mktData.yes / 100)   // approx ask from odds
      : (mktData.no  / 100);

    if (!asset_id) {
      console.warn('[App] No asset_id available — skipping trade');
      return;
    }

    // ── KELLY CRITERION BET SIZING ────────────────────────────
    const betAmt = calcKellyBetSize(
      signal.score,
      askPrice,
      bankrollRef.current,
      MAX_BET_PCT
    );

    if (betAmt <= 0) {
      console.info('[App] Kelly says don\'t bet — score too weak or odds unfavorable');
      return;
    }

    setBotStatus('ENTERING');

    try {
      const receipt = await buyPosition(asset_id, betAmt, askPrice);
      if (!receipt) throw new Error('buyPosition returned null');

      const position = {
        asset_id:   receipt.asset_id,   // ← stored in state
        order_id:   receipt.order_id,
        direction:  signal.direction,
        entryPrice: receipt.entryPrice,
        tokenQty:   receipt.usdcSpent / receipt.entryPrice,
        usdcSpent:  receipt.usdcSpent,
        enteredAt:  Date.now(),
        signalScore: signal.score,
        pattern:    signal.pattern,
      };

      // Update bankroll (deduct spent amount)
      setBankroll(prev => parseFloat((prev - betAmt).toFixed(2)));
      setPendingBet(position);
      pendingBetRef.current = position;
      setBotStatus('IN_POSITION');

      console.info(
        `[App] ✅ Trade entered\n` +
        `  Direction: ${signal.direction}\n` +
        `  Pattern:   ${signal.pattern}\n` +
        `  Score:     ${signal.score}/5\n` +
        `  Bet:       $${betAmt}  (${(betAmt/bankrollRef.current*100).toFixed(1)}% bankroll)\n` +
        `  Asset:     ${asset_id.slice(0, 12)}…`
      );

      // ── START POSITION MONITOR ─────────────────────────────
      positionManager.open(position, {
        onTakeProfit:   handleTakeProfit,
        onStopLoss:     handleStopLoss,
        onTick:         handlePositionTick,
        onError:        handlePositionError,
        // Inject live MACD signal for stop-loss confirmation
        getMacdSignal:  () => indicatorsRef.current?.macd1m?.cross === 'BULL'
          ? 'BULLISH'
          : indicatorsRef.current?.macd1m?.cross === 'BEAR'
          ? 'BEARISH'
          : 'NEUTRAL',
      });

    } catch (err) {
      console.error('[App] executeTrade failed:', err.message);
      setBotStatus('WATCHING');
    }
  }, [handleTakeProfit, handleStopLoss, handlePositionTick, handlePositionError]);

  // ─────────────────────────────────────────────────────────────
  //  CONTINUOUS SIGNAL EVALUATION LOOP  (every 5 seconds)
  //  ★ REPLACES the old T-4:10 static timer ★
  // ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const signalLoop = async () => {
      // ── Gate checks ─────────────────────────────────────────
      if (!autoBotRef.current)           return; // bot is off
      if (pendingBetRef.current)         return; // already in a trade
      if (Date.now() < cooldownRef.current) return; // in cooldown

      const indics  = indicatorsRef.current;
      const mktData = marketDataRef.current;

      if (!indics) return; // indicators not yet loaded

      // ── Evaluate signal ─────────────────────────────────────
      const signal = evaluateSignal(indics, mktData);
      setCurrentSignal(signal);

      if (signal.blocked) {
        setBotStatus(`BLOCKED:${signal.pattern}`);
        return;
      }

      if (signal.direction === 'NONE') {
        setBotStatus('WATCHING');
        return;
      }

      // ── ENTER TRADE ─────────────────────────────────────────
      console.info(
        `[App] 🔔 Signal fired: ${signal.direction}  ` +
        `score=${signal.score}  confidence=${signal.confidence}  ` +
        `pattern=${signal.pattern}`
      );

      await executeTrade(signal);
    };

    if (autoBotEnabled) {
      setBotStatus('WATCHING');
      signalLoop(); // fire immediately on enable
    }

    const id = setInterval(signalLoop, SIGNAL_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoBotEnabled, executeTrade]);

  // ─────────────────────────────────────────────────────────────
  //  CLEANUP ON UNMOUNT
  // ─────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      positionManager.close();
    };
  }, []);

  // ─────────────────────────────────────────────────────────────
  //  TOGGLE AUTO-BOT
  // ─────────────────────────────────────────────────────────────

  const toggleAutoBot = useCallback(() => {
    setAutoBotEnabled(prev => {
      const next = !prev;
      if (!next) {
        // Turning off: close position monitor but don't auto-sell
        positionManager.close();
        setBotStatus('IDLE');
      }
      return next;
    });
  }, []);

  // ─────────────────────────────────────────────────────────────
  //  RENDER
  // ─────────────────────────────────────────────────────────────

  return (
    <div className="app-root">

      {/* ── LIVE P&L BANNER (new) — shows when a position is open ── */}
      {pendingBet && livePosition && (
        <div style={{
          background: livePosition.pnl >= 0 ? '#0a2e1a' : '#2e0a0a',
          color: livePosition.pnl >= 0 ? '#00ff88' : '#ff4444',
          padding: '8px 16px', fontFamily: 'monospace',
          display: 'flex', gap: 24, fontSize: 13, borderBottom: '1px solid #333'
        }}>
          <span>📊 {pendingBet.direction} @ {pendingBet.entryPrice?.toFixed(4)}</span>
          <span>Bid: {livePosition.bid?.toFixed(4)}</span>
          <span>
            P&amp;L: {livePosition.pnl >= 0 ? '+' : ''}
            {livePosition.pnl?.toFixed(3)} USDC ({livePosition.pnlPct}%)
          </span>
          {livePosition.trailingFloor && (
            <span>🔒 Floor: {livePosition.trailingFloor?.toFixed(4)}</span>
          )}
          <span style={{ marginLeft: 'auto', opacity: 0.6 }}>
            {livePosition.status}
          </span>
        </div>
      )}

      {/* ── BOT STATUS BAR (new) ── */}
      <div style={{
        background: '#111', padding: '6px 16px', fontFamily: 'monospace',
        fontSize: 12, color: '#888', display: 'flex', gap: 24,
        borderBottom: '1px solid #222'
      }}>
        <span>🤖 Bot: <strong style={{ color: autoBotEnabled ? '#00ff88' : '#666' }}>
          {autoBotEnabled ? 'ON' : 'OFF'}
        </strong></span>
        <span>Status: <strong style={{ color: '#fff' }}>{botStatus}</strong></span>
        {currentSignal && currentSignal.direction !== 'NONE' && (
          <span>Signal: <strong style={{ color: '#ffcc00' }}>
            {currentSignal.direction} {currentSignal.score}/5 ({currentSignal.pattern})
          </strong></span>
        )}
        <span>Bankroll: <strong style={{ color: '#00ccff' }}>${bankroll?.toFixed(2)}</strong></span>
        <button
          onClick={toggleAutoBot}
          style={{
            marginLeft: 'auto', padding: '2px 12px', cursor: 'pointer',
            background: autoBotEnabled ? '#ff4444' : '#00aa44',
            color: '#fff', border: 'none', borderRadius: 4, fontSize: 12
          }}
        >
          {autoBotEnabled ? 'Stop Bot' : 'Start Bot'}
        </button>
      </div>

      {/* ── YOUR EXISTING APP UI GOES HERE ── */}
      {/* Paste your original App.jsx render content below this line */}
      <CandlestickChart
        klines={klines}
        livePrice={livePrice}
        indicators={indicators}
      />

    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  LivePnLBar COMPONENT  (inline stub — move to its own file)
// ─────────────────────────────────────────────────────────────
//
//  Shows a real-time P&L banner at the top of the page while
//  a position is open.  Color-coded by status.
//
//  Props:
//    position  — the pendingBet object
//    liveData  — the tick data from positionManager.onTick()
//
/**
 * Paste the following into src/components/LivePnLBar.jsx:
 *
 * export default function LivePnLBar({ position, liveData }) {
 *   const { bid, pnl, pnlPct, status, trailingFloor } = liveData;
 *   const color =
 *     status === 'PROFIT_TARGET' ? '#00ff88' :
 *     status === 'TRAILING'      ? '#00ccff' :
 *     status === 'STOP_WATCH'    ? '#ff4444' :
 *     status === 'UNDERWATER'    ? '#ff8800' : '#ffffff';
 *
 *   return (
 *     <div style={{ background: '#111', color, padding: '8px 16px',
 *                   fontFamily: 'monospace', display: 'flex', gap: 24 }}>
 *       <span>📊 {position.direction} @ {position.entryPrice.toFixed(4)}</span>
 *       <span>Bid: {bid.toFixed(4)}</span>
 *       <span>P&L: {pnl >= 0 ? '+' : ''}{pnl.toFixed(3)} USDC ({pnlPct}%)</span>
 *       {trailingFloor && <span>🔒 Floor: {trailingFloor.toFixed(4)}</span>}
 *       <span style={{ marginLeft: 'auto', opacity: 0.6 }}>{status}</span>
 *     </div>
 *   );
 * }
 */
