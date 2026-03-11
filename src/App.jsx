// ─── BABYDOGE BTC ORACLE v3 — FULL INTELLIGENCE TERMINAL ────────────────────
import { useState, useEffect, useCallback, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, BarChart, Bar } from 'recharts';
import { fetchAllTimeframes, fetch24hrStats } from './services/binanceApi.js';
import { subscribePriceStream } from './services/binanceWS.js';
import { fetchActiveBTCMarket } from './services/polymarketApi.js';
import { fetchWhaleTransactions, getWhaleSentiment } from './services/whaleMonitor.js';
import { buildSignal, getMacro, classifyMarket, DEFAULT_WEIGHTS } from './ai/signalEngine.js';
import { predictDirection, updateWeights } from './ai/predictionModel.js';
import CandlestickChart from './charts/CandlestickChart.jsx';

// ─── STYLES ──────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Fredoka+One&family=Nunito:wght@600;700;800;900&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body,#root{width:100vw;height:100vh;overflow:hidden;background:#050510;}
  ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#050510}::-webkit-scrollbar-thumb{background:#ff6d00;border-radius:2px}
  @keyframes pounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes glow{0%,100%{box-shadow:0 0 6px rgba(255,109,0,.2)}50%{box-shadow:0 0 18px rgba(255,109,0,.5)}}
  @keyframes slideUp{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}
  @keyframes flash{0%,100%{opacity:1}50%{opacity:.25}}
  @keyframes tickUp{from{color:#00e5aa}to{color:#e0e0ff}}
  @keyframes tickDown{from{color:#ff3366}to{color:#e0e0ff}}
  .card{background:#0a0a1a;border:1px solid #131328;border-radius:11px;}
  .tf-card{background:#07071a;border:1px solid #0f0f26;border-radius:9px;padding:9px;transition:transform .2s;}
  .tf-card:hover{transform:translateY(-2px);}
  .inp{background:#050510;border:1.5px solid #141430;border-radius:7px;color:#e0e0ff;padding:7px 10px;font-family:'Nunito',sans-serif;font-size:12px;font-weight:800;width:100%;outline:none;transition:border-color .2s;}
  .inp:focus{border-color:#ff6d00;}
  .inp::placeholder{color:#1e1e40;font-weight:600;}
  .flag{border:none;padding:5px 9px;border-radius:14px;cursor:pointer;font-family:'Nunito',sans-serif;font-weight:800;font-size:10px;transition:all .2s;}
  .flag:hover{transform:scale(1.05);}
  .btn{border:none;border-radius:8px;cursor:pointer;font-family:'Fredoka One',sans-serif;font-size:12px;padding:8px 14px;transition:all .2s;letter-spacing:.4px;}
  .btn:hover:not(:disabled){transform:scale(1.03);}
  .btn:disabled{opacity:.3;cursor:not-allowed;transform:none;}
  .tab{background:none;border:none;cursor:pointer;font-family:'Fredoka One',sans-serif;font-size:11px;padding:6px 10px;border-radius:6px;transition:all .2s;white-space:nowrap;}
  .bar{height:4px;border-radius:2px;background:#0e0e26;overflow:hidden;}
  .bar-fill{height:100%;border-radius:2px;transition:width .5s;}
  .pred-glow{animation:glow 2s ease-in-out infinite;}
  .paw{animation:pounce 1.5s ease-in-out infinite;}
  .spin{animation:spin 1s linear infinite;display:inline-block;}
  .flash{animation:flash .8s ease-in-out infinite;}
  .slide{animation:slideUp .3s ease;}
  .scroll{overflow-y:auto;}
  .scroll::-webkit-scrollbar{width:3px;}
  .live-dot{width:7px;height:7px;border-radius:50%;background:#00e5aa;animation:flash 1s infinite;}
  .dead-dot{width:7px;height:7px;border-radius:50%;background:#ff3366;}
`;

const TFS = ['1m','5m','15m','30m','1h','4h'];
const TF_COL = {'1m':'#ff6d00','5m':'#ff9500','15m':'#ffd700','30m':'#00e5aa','1h':'#00c8ff','4h':'#c44dff'};
const TF_LBL = {'1m':'1 MIN','5m':'5 MIN','15m':'15 MIN','30m':'30 MIN','1h':'1 HOUR','4h':'4 HOUR'};
const fmt = n => n?.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});

// ─── ROOT COMPONENT ──────────────────────────────────────────────────────────
export default function App() {
  // ── Market Data ──
  const [tfData,   setTfData]   = useState({});
  const [price,    setPrice]    = useState(null);
  const [prevPrice,setPrevPrice]= useState(null);
  const [change24h,setChange24h]= useState(0);
  const [stats24h, setStats24h] = useState(null);
  const [wsLive,   setWsLive]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [apiErrors,setApiErrors]= useState([]);
  const [chartData,setChartData]= useState([]);
  const [lastUpdate,setLastUpdate]=useState('');
  const [refreshIn, setRefreshIn]=useState(30);
  const [activeChart,setActiveChart]=useState('5m');

  // ── Polymarket ──
  const [upOdds,  setUpOdds]   = useState('');
  const [dnOdds,  setDnOdds]   = useState('');
  const [threshold,setThreshold]=useState('');
  const [thresholdSource,setThresholdSource]=useState(''); // 'real' | 'smartfill' | ''
  const [dangerous,setDangerous]=useState(false);
  const [whale,    setWhale]    = useState(false);
  const [lowLiq,   setLowLiq]  = useState(false);
  const [polyStatus,setPolyStatus]=useState('');
  const [polyRound, setPolyRound] =useState(null);
  const [spreadData, setSpreadData] = useState(null);
  const [oddsHistory,setOddsHistory] = useState([]);
  const [enriching,  setEnriching]  = useState(false);

  // ── Whales ──
  const [whales,       setWhales]     = useState([]);
  const [whaleSentiment,setWhaleSentiment]=useState({score:0,label:'NEUTRAL'});
  const [whaleLoading, setWhaleLoading]=useState(false);

  // ── AI / Prediction ──
  const [pred,    setPred]    = useState(null);
  const [aiPred,  setAiPred]  = useState(null);
  const [weights, setWeights] = useState(() => { try { const s=localStorage.getItem('bd_weights'); return s?{...DEFAULT_WEIGHTS,...JSON.parse(s)}:DEFAULT_WEIGHTS; } catch{ return DEFAULT_WEIGHTS; } });
  const [aiLog,   setAiLog]   = useState(() => { try { return JSON.parse(localStorage.getItem('bd_aiLog')||'[]'); } catch{ return []; } });
  const [market,  setMarket]  = useState(null);

  // ── Paper Betting ──
  const [paperBets,  setPaperBets]  = useState(() => { try { return JSON.parse(localStorage.getItem('bd_paperBets')||'[]'); } catch{ return []; } });
  const [betAmt,     setBetAmt]     = useState('5');
  const [pendingBet, setPendingBet] = useState(() => { try { return JSON.parse(localStorage.getItem('bd_pendingBet')||'null'); } catch{ return null; } });
  const [balance,    setBalance]    = useState(() => { try { return parseFloat(localStorage.getItem('bd_balance')||'100'); } catch{ return 100; } });
  const [betHistory, setBetHistory] = useState(() => { try { return JSON.parse(localStorage.getItem('bd_betHistory')||'[]'); } catch{ return []; } });

  // ── Auto-Bot ──
  const [autoBot,     setAutoBot]     = useState(false);
  const [botLog,      setBotLog]      = useState([]);
  const [roundTimer,  setRoundTimer]  = useState(null); // seconds until round ends
  const [botStatus,   setBotStatus]   = useState('idle'); // idle | watching | betting | resolving
  const [botRoundBet, setBotRoundBet] = useState(null);  // bet placed this round
  const [skippedCount,setSkippedCount]= useState(0);
  const autoRef = useRef({ autoBot: false, pred: null, price: null, threshold: null, pendingBet: null, balance: parseFloat(localStorage.getItem('bd_balance')||'100'), fetchedThisRound: false, bettedThisRound: false });

  // ── UI ──
  const [activeTab, setActiveTab] = useState('dashboard');

  const winRate  = betHistory.length ? Math.round(betHistory.filter(b=>b.correct).length/betHistory.length*100) : 0;
  const totalPnL = betHistory.reduce((a,b)=>a+b.pnl, 0);

  // ─── BINANCE WEBSOCKET ───────────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribePriceStream((msg) => {
      if (msg.type === 'status') {
        setWsLive(msg.connected);
      } else if (msg.type === 'price') {
        setPrice(p => { setPrevPrice(p); return msg.price; });
      } else if (msg.type === 'ticker') {
        setPrice(p => { setPrevPrice(p); return msg.price; });
        setChange24h(msg.change24h);
      }
    });
    return unsub;
  }, []);

  // ─── BINANCE REST FETCH ──────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setApiErrors([]);
    try {
      const [{ data, errors }, stats] = await Promise.allSettled([
        fetchAllTimeframes(),
        fetch24hrStats(),
      ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : null));

      if (data && Object.keys(data).length > 0) {
        setTfData(data);
        if (!wsLive) {
          const cur = data['1m']?.price;
          const prev = data['1m']?.closes?.slice(-2, -1)[0];
          if (cur) {
            setPrice(p => { setPrevPrice(p); return cur; });
            if (prev) setChange24h(+((cur - prev) / prev * 100).toFixed(3));
          }
        }
        if (errors?.length > 0) setApiErrors(errors);
        // Chart data
        const cd = activeChart && data[activeChart]
          ? data[activeChart].closes.slice(-60).map((c,i) => ({ i, price: c }))
          : [];
        setChartData(cd);
      }
      if (stats) setStats24h(stats);
      setLastUpdate(new Date().toLocaleTimeString());
      setRefreshIn(30);
    } catch(e) {
      console.error('[App] fetchData error:', e);
      setApiErrors(['All timeframes failed']);
    }
    setLoading(false);
  }, [wsLive, activeChart]);

  // ─── AUTO REFRESH ────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setRefreshIn(n => { if(n<=1){fetchData();return 30;} return n-1; }), 1000);
    return () => clearInterval(t);
  }, [fetchData]);

  // Update chart when activeChart changes
  useEffect(() => {
    if (tfData[activeChart]) {
      setChartData(tfData[activeChart].closes.slice(-60).map((c,i)=>({i,price:c})));
    }
  }, [activeChart, tfData]);

  // ─── POLYMARKET AUTO FETCH ───────────────────────────────────────────────
  const fetchPoly = useCallback(async () => {
    setPolyStatus('🔍 Searching Polymarket...');
    const market = await fetchActiveBTCMarket();
    if (market) {
      setUpOdds(market.upOdds.toString());
      setDnOdds(market.downOdds.toString());
      if (market.threshold) { setThreshold(market.threshold.toString()); setThresholdSource('real'); }
      if (market.lowLiquidity) setLowLiq(true);
      setPolyRound(market);
      const srcLabel = market.source === 'clob-live' ? '⚡ LIVE' : '📡 Est';
      setPolyStatus(`✅ ${srcLabel} ${market.upOdds}¢ UP / ${market.downOdds}¢ DOWN${market.threshold ? ` @ $${market.threshold.toLocaleString()}` : ''}`);
      // Enrich with spread + price history (non-blocking)
      if (market.tokenIds?.upId) {
        setEnriching(true);
        fetchMarketEnrichment(market.tokenIds.upId).then(({ spread, history }) => {
          if (spread)           setSpreadData(spread);
          if (history?.length)  setOddsHistory(history);
          setEnriching(false);
        }).catch(() => setEnriching(false));
      }
    } else {
      setPolyStatus('⚠️ CORS blocked — use 📊 Smart Fill or enter odds manually');
    }
  }, []);

  // ─── SMART FILL — estimate odds from chart signals ────────────────────────
  const smartFill = useCallback(() => {
    if (!price || Object.keys(tfData).length === 0) {
      setPolyStatus('⚠️ Fetch chart data first, then Smart Fill'); return;
    }
    const d5m = tfData['5m'], d1m = tfData['1m'], d4h = tfData['4h'], d1h = tfData['1h'], d15m = tfData['15m'];
    if (!d5m || !d1m || !d4h) return;

    // Weight 4H 3x, 1H 2x, others 1x — so 4H strongly influences direction
    const weightedSignals = [
      { val: d4h.macd.bullish, w: 3 },   // 4H MACD — most important
      { val: d4h.rsi > 50, w: 2 },       // 4H RSI
      { val: d1h?.macd.bullish, w: 2 },  // 1H MACD
      { val: d15m?.macd.bullish, w: 1 }, // 15m MACD
      { val: d5m.macd.bullish, w: 1 },   // 5m MACD
      { val: d1m.macd.bullish, w: 1 },   // 1m MACD
      { val: (d5m.stochRSI?.k || 50) > 50, w: 1 }, // StochRSI
    ].filter(s => s.val !== undefined && s.val !== null);

    const totalWeight = weightedSignals.reduce((a, s) => a + s.w, 0);
    const bullWeight  = weightedSignals.filter(s => s.val).reduce((a, s) => a + s.w, 0);
    const bullPct     = Math.round((bullWeight / totalWeight) * 100);

    // Small noise ±4% to simulate market spread
    const noise  = Math.round((Math.random() - 0.5) * 8);
    const upEst  = Math.max(30, Math.min(72, bullPct + noise));
    const dnEst  = 100 - upEst;

    setUpOdds(upEst.toString());
    setDnOdds(dnEst.toString());
    if (!threshold) { setThreshold(Math.round(price).toString()); }
    setThresholdSource('smartfill'); // Smart Fill = estimated, not real Polymarket threshold

    // Tell user which way 4H is pointing
    const macro4H = d4h.macd.bullish ? '4H BULLISH' : '4H BEARISH';
    setPolyStatus(`📊 Smart Fill: ${upEst}¢ UP / ${dnEst}¢ DOWN (${macro4H} weighted)`);
  }, [tfData, price, threshold]);

  // ─── WHALE FETCH ─────────────────────────────────────────────────────────
  const fetchWhales = useCallback(async () => {
    setWhaleLoading(true);
    const txs = await fetchWhaleTransactions();
    setWhales(txs);
    setWhaleSentiment(getWhaleSentiment(txs));
    setWhaleLoading(false);
  }, []);

  useEffect(() => {
    fetchWhales();
    const t = setInterval(fetchWhales, 60000);
    return () => clearInterval(t);
  }, [fetchWhales]);

  // ─── SIGNAL ENGINE ───────────────────────────────────────────────────────
  useEffect(() => {
    const signal = buildSignal({ tfData, price, upOdds, downOdds: dnOdds, threshold, thresholdSource, dangerous, whale, lowLiq, whaleSentiment, weights, spreadData });
    setPred(signal);
    autoRef.current.pred = signal;
    const aiP = predictDirection(tfData, price);
    setAiPred(aiP);
    const mkt = classifyMarket(tfData, whaleSentiment);
    setMarket(mkt);
  }, [tfData, price, upOdds, dnOdds, threshold, dangerous, whale, lowLiq, whaleSentiment, weights]);

  // keep ref in sync
  useEffect(() => { autoRef.current.price = price; }, [price]);
  useEffect(() => { autoRef.current.threshold = threshold; }, [threshold]);
  useEffect(() => { autoRef.current.autoBot = autoBot; }, [autoBot]);
  useEffect(() => { autoRef.current.pendingBet = pendingBet; }, [pendingBet]);
  useEffect(() => { autoRef.current.balance = balance; }, [balance]);

  // ─── LOCALSTORAGE PERSISTENCE ────────────────────────────────────────────
  useEffect(() => { try { localStorage.setItem('bd_weights',    JSON.stringify(weights));    } catch{} }, [weights]);
  useEffect(() => { try { localStorage.setItem('bd_balance',    balance.toString());          } catch{} }, [balance]);
  useEffect(() => { try { localStorage.setItem('bd_betHistory', JSON.stringify(betHistory));  } catch{} }, [betHistory]);
  useEffect(() => { try { localStorage.setItem('bd_paperBets',  JSON.stringify(paperBets));   } catch{} }, [paperBets]);
  useEffect(() => { try { localStorage.setItem('bd_aiLog',      JSON.stringify(aiLog));       } catch{} }, [aiLog]);
  useEffect(() => { try { localStorage.setItem('bd_pendingBet', JSON.stringify(pendingBet));  } catch{} }, [pendingBet]);

  // ─── AUTO-BOT ENGINE ─────────────────────────────────────────────────────
  // How it works:
  // 1. Calculates seconds until next 5-min Polymarket round boundary (:00,:05,:10...)
  // 2. 60s before round ends → fetches fresh data + evaluates signal
  // 3. If signal is UP/DOWN with 3+ confluences → auto-places paper bet
  // 4. At round end → auto-resolves: price > threshold = UP wins, price < threshold = DOWN wins
  // 5. Logs everything to Bot Log tab

  const botLog_add = (msg, type='info') => {
    const entry = { time: new Date().toLocaleTimeString(), msg, type };
    setBotLog(p => [entry, ...p].slice(0, 50));
  };

  // Helper: seconds until next 5-min boundary
  const secsToNextRound = () => {
    const now = new Date();
    const mins = now.getMinutes();
    const secs = now.getSeconds();
    const nextMin = Math.ceil((mins + secs / 60) / 5) * 5;
    return (nextMin - mins) * 60 - secs;
  };

  // Auto-place bet (called by bot)
  const botPlaceBet = useCallback((signal, amt, currentPrice, thresh) => {
    const oddsVal = signal.result === 'UP' ? parseFloat(upOdds) : parseFloat(dnOdds);
    const odds = oddsVal / 100;
    if (!odds || odds <= 0) return null;
    const payout = +(amt / odds).toFixed(2);
    const bet = {
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      direction: signal.result,
      amount: amt,
      odds: Math.round(odds * 100),
      payout,
      conf: signal.conf,
      score: signal.score,
      features: signal.features,
      outcome: null,
      entryPrice: currentPrice,
      threshold: thresh,
      auto: true,
    };
    setPendingBet(bet);
    setBotRoundBet(bet);
    setBalance(b => +(b - amt).toFixed(2));
    setPaperBets(p => [bet, ...p]);
    return bet;
  }, [upOdds, dnOdds]);

  // Auto-resolve bet (called by bot at round end)
  const botResolveBet = useCallback((bet, exitPrice) => {
    if (!bet || bet.outcome !== null) return;
    const thresh = parseFloat(bet.threshold) || parseFloat(threshold);
    let won = false;
    if (thresh > 0) {
      // Real resolution: UP wins if exit price > threshold, DOWN wins if exit price < threshold
      won = bet.direction === 'UP' ? exitPrice > thresh : exitPrice < thresh;
    } else {
      // Fallback: compare exit price to entry price
      won = bet.direction === 'UP' ? exitPrice > bet.entryPrice : exitPrice < bet.entryPrice;
    }
    const outcome = won ? bet.direction : (bet.direction === 'UP' ? 'DOWN' : 'UP');
    setPaperBets(p => p.map(b => b.id === bet.id ? { ...b, outcome, exitPrice } : b));
    if (won) setBalance(b => +(b + bet.payout).toFixed(2));
    if (bet.features) {
      setWeights(w => updateWeights(w, bet.features, won));
      setAiLog(p => [{ time: new Date().toLocaleTimeString(), won, direction: bet.direction, conf: bet.conf, note: won ? '✅ Auto-bet WIN — weights reinforced' : '🔄 Auto-bet LOSS — weights adjusted' }, ...p.slice(0, 19)]);
    }
    setBetHistory(p => [...p, { correct: won, pnl: won ? +(bet.payout - bet.amount).toFixed(2) : -bet.amount, auto: true }]);
    setPendingBet(null);
    setBotRoundBet(null);
    return won;
  }, [threshold, updateWeights]);

  // Main bot ticker — runs every second
  useEffect(() => {
    if (!autoBot) { setRoundTimer(null); setBotStatus('idle'); return; }

    setBotStatus('watching');
    botLog_add('🤖 Auto-Bot STARTED — watching for 5-min round boundaries', 'start');

    const tick = setInterval(() => {
      const secs = secsToNextRound();
      setRoundTimer(secs);

      const { pred: curPred, price: curPrice, threshold: curThresh, pendingBet: curPending, balance: curBalance, autoBot: isOn } = autoRef.current;
      if (!isOn) return;

      // Reset per-round flags when a new round begins (secs resets back near 300)
      if (secs >= 295) {
        autoRef.current.fetchedThisRound = false;
        autoRef.current.bettedThisRound  = false;
      }

      // ── 55–65s before round ends: fetch fresh data (fire once per round)
      if (secs <= 65 && secs >= 55 && !autoRef.current.fetchedThisRound) {
        autoRef.current.fetchedThisRound = true;
        setBotStatus('analyzing');
        botLog_add(`⏱ Round ends in ~${secs}s — fetching fresh data...`, 'info');
        fetchData();
      }

      // ── 40–50s before: place bet if signal is good and no bet placed yet
      if (secs <= 50 && secs >= 40 && !autoRef.current.bettedThisRound && !curPending) {
        autoRef.current.bettedThisRound = true;
        const amt = parseFloat(betAmt) || 5;
        if (curBalance < amt) {
          botLog_add('💸 Balance too low to bet!', 'warn');
          setBotStatus('watching');
          return;
        }
        if (!curPred || !['UP', 'DOWN'].includes(curPred.result)) {
          const reason = curPred?.reason || 'No valid signal';
          botLog_add(`⏭ SKIP — ${reason}`, 'skip');
          setSkippedCount(n => n + 1);
          setBotStatus('watching');
          return;
        }
        // Place the bet!
        setBotStatus('betting');
        const bet = botPlaceBet(curPred, amt, curPrice, curThresh);
        if (bet) {
          botLog_add(`🎯 AUTO-BET ${curPred.result} @ ${bet.odds}¢ — conf ${curPred.conf}% (${curPred.score}/5) — $${amt}`, 'bet');
        }
      }

      // ── At round end (1–5s grace): auto-resolve
      if (secs <= 5 && secs >= 1) {
        const pending = autoRef.current.pendingBet;
        if (pending && pending.auto) {
          setBotStatus('resolving');
          const exitPrice = autoRef.current.price;
          const thresh = parseFloat(pending.threshold) || parseFloat(autoRef.current.threshold);
          const won = thresh > 0
            ? (pending.direction === 'UP' ? exitPrice > thresh : exitPrice < thresh)
            : (pending.direction === 'UP' ? exitPrice > pending.entryPrice : exitPrice < pending.entryPrice);
          botResolveBet(pending, exitPrice);
          const pnl = won ? +(pending.payout - pending.amount).toFixed(2) : -pending.amount;
          botLog_add(
            `${won ? '✅ WIN' : '❌ LOSS'} — ${pending.direction} resolved @ $${exitPrice?.toFixed(0)} vs thresh $${thresh?.toFixed(0)} | P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
            won ? 'win' : 'loss'
          );
          setTimeout(() => setBotStatus('watching'), 2000);
        }
      }
    }, 1000);

    return () => { clearInterval(tick); setBotStatus('idle'); };
  }, [autoBot, betAmt, botPlaceBet, botResolveBet, fetchData]);

  // ─── PAPER BETTING ───────────────────────────────────────────────────────
  const placeBet = () => {
    if (!pred || !['UP','DOWN'].includes(pred.result)) return;
    const amt = parseFloat(betAmt) || 5;
    if (amt > balance) return;
    const odds = (pred.result==='UP' ? parseFloat(upOdds) : parseFloat(dnOdds)) / 100;
    const bet = { id:Date.now(), time:new Date().toLocaleTimeString(), direction:pred.result, amount:amt, odds:Math.round(odds*100), payout:+(amt/odds).toFixed(2), conf:pred.conf, score:pred.score, features:pred.features, outcome:null };
    setPendingBet(bet);
    setBalance(b => +(b - amt).toFixed(2));
    setPaperBets(p => [bet, ...p]);
  };

  const resolveBet = (id, won) => {
    const bet = paperBets.find(b => b.id === id); if (!bet) return;
    const outcome = won ? bet.direction : (bet.direction==='UP'?'DOWN':'UP');
    setPaperBets(p => p.map(b => b.id===id ? {...b, outcome} : b));
    if (won) setBalance(b => +(b + bet.payout).toFixed(2));
    if (bet.features) {
      const nw = updateWeights(weights, bet.features, won);
      setWeights(nw);
      setAiLog(p => [{ time:new Date().toLocaleTimeString(), won, direction:bet.direction, conf:bet.conf, note:won?'✅ Weights reinforced':'🔄 Weights adjusted' }, ...p.slice(0,19)]);
    }
    setBetHistory(p => [...p, { correct:won, pnl: won ? +(bet.payout - bet.amount).toFixed(2) : -bet.amount }]);
    setPendingBet(null);
  };

  const macro    = getMacro(tfData);
  const bufferVal = price && threshold ? price - parseFloat(threshold) : null;
  const bufAbs    = bufferVal !== null ? Math.abs(bufferVal) : null;
  const bufColor  = bufAbs === null ? '#303060' : bufAbs < 20 ? '#ff3366' : bufAbs < 30 ? '#ffd700' : '#00e5aa';
  const priceDir  = price && prevPrice ? (price > prevPrice ? 'up' : price < prevPrice ? 'down' : 'same') : 'same';

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div style={{ width:'100vw', height:'100vh', display:'flex', flexDirection:'column', background:'#050510', fontFamily:"'Nunito',sans-serif", color:'#e0e0ff', overflow:'hidden' }}>
      <style>{CSS}</style>

      {/* ── HEADER ── */}
      <header style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 12px', borderBottom:'1px solid #0d0d26', flexShrink:0, background:'#07071a', gap:8, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div className="paw" style={{ fontSize:24, filter:'drop-shadow(0 0 8px rgba(255,109,0,.8))' }}>🐾</div>
          <div>
            <div style={{ fontFamily:"'Fredoka One'", fontSize:16, color:'#ff6d00', lineHeight:1 }}>BabyDoge BTC Oracle <span style={{ fontSize:10, color:'#303060' }}>v3</span></div>
            <div style={{ fontSize:8, color:'#1a1a40' }}>such intelligence • very terminal • much signal • wow</div>
          </div>
        </div>

        {/* Tabs */}
        <nav style={{ display:'flex', gap:2, background:'#050510', padding:3, borderRadius:8 }}>
          {[['dashboard','🐾 Dashboard'],['chart','📊 Chart'],['autobot','🤖 Auto-Bot'],['whales','🐋 Whales'],['ai','🧠 AI Lab'],['rules','📋 Rules'],['schedule','⏰ Schedule']].map(([id,l])=>(
            <button key={id} className="tab" onClick={()=>setActiveTab(id)}
              style={{ color:activeTab===id?'#ff6d00':'#2a2a5a', background:activeTab===id?'#0f0f2a':'transparent' }}>{l}</button>
          ))}
        </nav>

        {/* Price + WS status + Fetch */}
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {/* Market classification */}
          {market && market.label !== 'LOADING' && (
            <div style={{ padding:'3px 10px', borderRadius:12, background:market.label==='BULLISH'?'rgba(0,229,170,.08)':market.label==='BEARISH'?'rgba(255,51,102,.08)':'rgba(255,213,0,.08)', fontFamily:"'Fredoka One'", fontSize:10, color:market.label==='BULLISH'?'#00e5aa':market.label==='BEARISH'?'#ff3366':'#ffd700' }}>
              {market.label==='BULLISH'?'🐂':market.label==='BEARISH'?'🐻':'⚠️'} {market.label}
            </div>
          )}
          {price && (
            <div style={{ textAlign:'right' }}>
              <div style={{ fontFamily:"'Fredoka One'", fontSize:18, color:priceDir==='up'?'#00e5aa':priceDir==='down'?'#ff3366':'#e0e0ff', lineHeight:1, transition:'color .3s' }}>${fmt(price)}</div>
              <div style={{ fontSize:9, color:change24h>=0?'#00e5aa':'#ff3366', fontWeight:800 }}>{change24h>=0?'▲':'▼'} {Math.abs(change24h)}%</div>
            </div>
          )}
          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
            <div style={{ width:7, height:7, borderRadius:'50%', background:wsLive?'#00e5aa':'#ff3366', ...(wsLive?{animation:'flash 1s infinite'}:{}) }} title={wsLive?'Live WS':'Polling'} />
            <span style={{ fontSize:8, color:'#2a2a5a' }}>{wsLive?'LIVE':'POLL'}</span>
          </div>
          <div>
            <button className="btn" onClick={fetchData} disabled={loading}
              style={{ background:'linear-gradient(135deg,#ff6d00,#ff9d00)', color:'white', fontSize:11, padding:'7px 12px' }}>
              {loading?<span className="spin">🐾</span>:'↻'} {loading?'Fetching...':'Fetch Data'}
            </button>
            <div style={{ fontSize:8, color:'#1a1a40', marginTop:2, textAlign:'right' }}>
              {apiErrors.length>0 ? <span style={{color:'#ff3366'}}>⚠ {apiErrors.join(', ')} failed</span> : lastUpdate ? `✓ ${lastUpdate} • ${refreshIn}s` : 'Click to load'}
            </div>
          </div>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════
          DASHBOARD TAB
      ══════════════════════════════════════════════════════ */}
      {activeTab==='dashboard' && (
        <div style={{ flex:1, display:'grid', gridTemplateColumns:'205px 1fr 235px', gap:8, padding:8, overflow:'hidden', minHeight:0 }}>

          {/* ── LEFT: Polymarket + Paper Bet ── */}
          <div className="scroll" style={{ display:'flex', flexDirection:'column', gap:7 }}>

            {/* Polymarket Panel */}
            <div className="card" style={{ padding:11 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                <div style={{ fontFamily:"'Fredoka One'", color:'#ff6d00', fontSize:13 }}>🎯 Polymarket Odds</div>
                <div style={{ display:'flex', gap:4 }}>
                  <button className="btn" onClick={smartFill}
                    disabled={Object.keys(tfData).length===0}
                    style={{ background:Object.keys(tfData).length>0?'linear-gradient(135deg,#ff6d00,#ff9d00)':'#0c0c22', color:Object.keys(tfData).length>0?'white':'#252550', border:'none', fontSize:9, padding:'4px 9px' }}
                    title="Estimate odds from your live chart signals">
                    📊 Smart Fill
                  </button>
                  <button className="btn" onClick={fetchPoly}
                    style={{ background:'#0c0c22', color:'#3a3a6a', border:'1px solid #1a1a38', fontSize:9, padding:'4px 7px' }}
                    title="Tries Polymarket API — usually blocked by CORS in browser">
                    ⚡ Auto
                  </button>
                </div>
              </div>

              {/* Status / instructions */}
              {polyStatus ? (
                <div style={{ fontSize:9, color:polyStatus.includes('✅')||polyStatus.includes('📊')?'#00e5aa':polyStatus.includes('⚠')?'#ff9d00':'#ffd700', marginBottom:7, fontWeight:700, padding:'4px 7px', background:'rgba(255,255,255,.03)', borderRadius:5 }}>{polyStatus}</div>
              ) : (
                <div style={{ fontSize:9, color:'#303060', marginBottom:7, lineHeight:1.6, padding:'5px 7px', background:'#050510', borderRadius:6, border:'1px solid #0f0f28' }}>
                  <span style={{color:'#ff9d00',fontWeight:800}}>① Fetch Data</span> → <span style={{color:'#ff9d00',fontWeight:800}}>📊 Smart Fill</span> → odds auto-populate<br/>
                  <span style={{color:'#303060'}}>Or enter manually below. ⚡ Auto is often CORS-blocked.</span>
                </div>
              )}

              {/* Round meta + spread badge */}
              {(polyRound?.endTime || spreadData || enriching) && (
                <div style={{ marginBottom:7, display:'flex', flexWrap:'wrap', gap:5, alignItems:'center' }}>
                  {polyRound?.endTime && <div style={{ fontSize:8, color:'#303060', background:'#050510', padding:'2px 7px', borderRadius:10 }}>⏰ {new Date(polyRound.endTime).toLocaleTimeString()}</div>}
                  {enriching && <div style={{ fontSize:8, color:'#3a3a6a' }} className="spin">🐾</div>}
                  {spreadData && !enriching && (
                    <div style={{ fontSize:8, fontWeight:800, padding:'2px 8px', borderRadius:10,
                      background: spreadData.quality==='TIGHT'?'rgba(0,229,170,.12)':spreadData.quality==='WIDE'?'rgba(255,51,102,.12)':'rgba(255,213,0,.08)',
                      color: spreadData.quality==='TIGHT'?'#00e5aa':spreadData.quality==='WIDE'?'#ff3366':'#ffd700',
                      border: `1px solid ${spreadData.quality==='TIGHT'?'#00e5aa33':spreadData.quality==='WIDE'?'#ff336633':'#ffd70033'}` }}>
                      {spreadData.quality==='TIGHT'?'📊 TIGHT':spreadData.quality==='WIDE'?'⚠️ WIDE':'〰 NORMAL'} {spreadData.spreadCents}¢
                      {spreadData.imbalance !== 0 && <span style={{ marginLeft:4, opacity:.8 }}>{spreadData.imbalance > 0 ? '▲' : '▼'}{Math.abs(spreadData.imbalance).toFixed(0)}%</span>}
                    </div>
                  )}
                </div>
              )}

              {/* Odds Trend Sparkline */}
              {oddsHistory.length > 3 && (() => {
                const prices  = oddsHistory.map(d => d.p);
                const minP    = Math.min(...prices), maxP = Math.max(...prices);
                const range   = maxP - minP || 1;
                const W = 180, H = 36, PAD = 3;
                const pts     = prices.map((p, i) => {
                  const x = PAD + (i / (prices.length - 1)) * (W - PAD * 2);
                  const y = H - PAD - ((p - minP) / range) * (H - PAD * 2);
                  return `${x},${y}`;
                }).join(' ');
                const first = prices[0], last = prices[prices.length - 1];
                const trend = last > first ? '#00e5aa' : last < first ? '#ff3366' : '#ffd700';
                const trendArrow = last > first ? '▲' : last < first ? '▼' : '—';
                return (
                  <div style={{ marginBottom:7, background:'#050510', borderRadius:7, padding:'6px 8px', border:'1px solid #0f0f22' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:3 }}>
                      <div style={{ fontSize:7, color:'#252550', fontWeight:800, letterSpacing:1 }}>ODDS TREND (1H)</div>
                      <div style={{ fontSize:9, color:trend, fontWeight:800 }}>{trendArrow} {last}¢ <span style={{ fontSize:7, color:'#2a2a5a' }}>was {first}¢</span></div>
                    </div>
                    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display:'block' }}>
                      <defs>
                        <linearGradient id="oddsGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={trend} stopOpacity={0.25}/>
                          <stop offset="100%" stopColor={trend} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <polygon points={`${pts} ${W-PAD},${H-PAD} ${PAD},${H-PAD}`} fill="url(#oddsGrad)"/>
                      <polyline points={pts} fill="none" stroke={trend} strokeWidth={1.5}/>
                      <text x={PAD} y={H-1} fill="#1e1e40" fontSize={6} fontFamily="Nunito">{minP}¢</text>
                      <text x={PAD} y={PAD+5} fill="#1e1e40" fontSize={6} fontFamily="Nunito">{maxP}¢</text>
                    </svg>
                  </div>
                );
              })()}

              <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:8 }}>
                {[['🔴 Dangerous',dangerous,setDangerous,'rgba(255,51,102,.12)','#ff3366'],['🐋 Whale',whale,setWhale,'rgba(255,109,0,.12)','#ff9d00'],['💧 Low Liq',lowLiq,setLowLiq,'rgba(33,150,243,.12)','#42a5f5']].map(([l,v,s,bg,c])=>(
                  <button key={l} className="flag" onClick={()=>s(!v)} style={{ background:v?bg:'#070718', color:v?c:'#252560', border:`1.5px solid ${v?c:'#141430'}` }}>{l}</button>
                ))}
              </div>

              {[['UP ODDS (¢)',upOdds,setUpOdds,'e.g. 63'],['DOWN ODDS (¢)',dnOdds,setDnOdds,'e.g. 37'],['PRICE TO BEAT ($)',threshold,(v)=>{ setThreshold(v); setThresholdSource(''); },'e.g. 71548']].map(([label,val,setter,ph])=>(
                <div key={label} style={{ marginBottom:6 }}>
                  <div style={{ fontSize:7, color: val ? '#ff6d00' : '#202045', fontWeight:800, letterSpacing:1, marginBottom:2 }}>{label}{val?' ✓':''}</div>
                  <input className="inp" type="number" placeholder={ph} value={val} onChange={e=>setter(e.target.value)}
                    style={{ borderColor: val ? '#ff6d0044' : '#141430' }} />
                </div>
              ))}
              {/* Threshold source badge */}
              {threshold && (
                <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:4 }}>
                  <div style={{ fontSize:7, fontWeight:800, padding:'2px 8px', borderRadius:10,
                    background: thresholdSource==='real'?'rgba(0,229,170,.1)':thresholdSource==='smartfill'?'rgba(255,109,0,.1)':'rgba(255,255,255,.04)',
                    color: thresholdSource==='real'?'#00e5aa':thresholdSource==='smartfill'?'#ff9d00':'#3a3a6a',
                    border: `1px solid ${thresholdSource==='real'?'#00e5aa33':thresholdSource==='smartfill'?'#ff9d0033':'#1a1a38'}` }}>
                    {thresholdSource==='real'?'✅ Real Polymarket threshold':thresholdSource==='smartfill'?'📊 Smart Fill estimate — buffer skip disabled':'✏️ Manual entry'}
                  </div>
                </div>
              )}
              {bufferVal !== null && (
                <div style={{ background:'#050510', borderRadius:7, padding:'7px 9px', marginTop:3 }}>
                  <div style={{ fontSize:7, color:'#202045', fontWeight:800, letterSpacing:1 }}>BUFFER</div>
                  <div style={{ fontFamily:"'Fredoka One'", fontSize:20, color:bufColor }}>{bufferVal>=0?'+':''}${bufferVal.toFixed(0)}</div>
                  <div style={{ fontSize:8, color:bufColor, fontWeight:800 }}>{bufAbs<20?'🚫 SKIP ZONE':bufAbs<30?'⚠️ Borderline':'✅ Safe'}</div>
                </div>
              )}
            </div>

            {/* Paper Betting */}
            <div className="card" style={{ padding:11 }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#ffd700', fontSize:13, marginBottom:8 }}>💰 Paper Betting</div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:7 }}>
                <div><div style={{ fontSize:7, color:'#202045', fontWeight:800, letterSpacing:1 }}>BALANCE</div>
                  <div style={{ fontFamily:"'Fredoka One'", fontSize:18, color:'#ffd700' }}>${balance.toFixed(2)}</div></div>
                <div style={{ textAlign:'right' }}><div style={{ fontSize:7, color:'#202045', fontWeight:800, letterSpacing:1 }}>P&L</div>
                  <div style={{ fontFamily:"'Fredoka One'", fontSize:18, color:totalPnL>=0?'#00e5aa':'#ff3366' }}>{totalPnL>=0?'+':''}${totalPnL.toFixed(2)}</div></div>
              </div>
              {winRate>0 && <div style={{ display:'flex', gap:5, marginBottom:7 }}>
                {[['WIN RATE',`${winRate}%`,winRate>=55?'#00e5aa':'#ff3366'],['BETS',betHistory.length,'#c44dff']].map(([l,v,c])=>(
                  <div key={l} style={{ flex:1, background:'#050510', borderRadius:6, padding:'5px 7px', textAlign:'center' }}>
                    <div style={{ fontSize:7, color:'#202045', fontWeight:800 }}>{l}</div>
                    <div style={{ fontFamily:"'Fredoka One'", fontSize:15, color:c }}>{v}</div>
                  </div>
                ))}
              </div>}
              <div style={{ marginBottom:7 }}>
                <div style={{ fontSize:7, color:'#202045', fontWeight:800, letterSpacing:1, marginBottom:2 }}>BET AMOUNT ($)</div>
                <input className="inp" type="number" placeholder="5" value={betAmt} onChange={e=>setBetAmt(e.target.value)} />
              </div>

              {/* Bet state explainer */}
              {pred?.result === 'UP' || pred?.result === 'DOWN' ? (
                <button className="btn" onClick={placeBet}
                  style={{ width:'100%', background:pred.result==='UP'?'linear-gradient(135deg,#00e5aa,#009970)':'linear-gradient(135deg,#ff3366,#cc0044)', color:'white', marginBottom:7, fontSize:13 }}>
                  {pred.result==='UP'?'🚀 BET UP':'📉 BET DOWN'} — {pred.conf}% conf
                </button>
              ) : (
                <div style={{ padding:'9px', background:'#050510', borderRadius:8, marginBottom:7, textAlign:'center', border:'1px solid #141430' }}>
                  <div style={{ fontSize:11, color:'#252550', fontWeight:700 }}>
                    {!upOdds && !dnOdds ? '① Enter odds → prediction activates betting' : pred?.result === 'NO BET' ? '🛑 Signal says NO BET — wait for better setup' : '⏳ Waiting for signal...'}
                  </div>
                </div>
              )}
              {pendingBet && (
                <div className="flash" style={{ background:'#050510', borderRadius:7, padding:'7px', border:'1px solid #ffd70033' }}>
                  <div style={{ fontSize:9, color:'#ffd700', fontWeight:800, marginBottom:5 }}>⏳ Resolve: {pendingBet.direction}</div>
                  <div style={{ display:'flex', gap:4 }}>
                    <button className="btn" onClick={()=>resolveBet(pendingBet.id,true)} style={{ flex:1, background:'rgba(0,229,170,.12)', color:'#00e5aa', border:'1px solid #00e5aa44', fontSize:10, padding:'5px' }}>✅ WON</button>
                    <button className="btn" onClick={()=>resolveBet(pendingBet.id,false)} style={{ flex:1, background:'rgba(255,51,102,.12)', color:'#ff3366', border:'1px solid #ff336644', fontSize:10, padding:'5px' }}>❌ LOST</button>
                  </div>
                </div>
              )}
              {paperBets.length>0 && (
                <div style={{ marginTop:7 }}>
                  <div style={{ fontSize:7, color:'#202045', fontWeight:800, letterSpacing:1, marginBottom:4 }}>RECENT BETS</div>
                  <div className="scroll" style={{ maxHeight:100 }}>
                    {paperBets.slice(0,6).map(b=>(
                      <div key={b.id} style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', borderBottom:'1px solid #0b0b22', fontSize:10 }}>
                        <span style={{ color:b.direction==='UP'?'#00e5aa':'#ff3366', fontWeight:800 }}>{b.direction==='UP'?'▲':'▼'} ${b.amount}</span>
                        <span style={{ color:b.outcome===null?'#ffd700':b.outcome===b.direction?'#00e5aa':'#ff3366', fontWeight:700 }}>
                          {b.outcome===null?'⏳':b.outcome===b.direction?`+$${(b.payout-b.amount).toFixed(2)}`:`-$${b.amount}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── CENTER: TF Grid + Quick Chart ── */}
          <div style={{ display:'flex', flexDirection:'column', gap:7, overflow:'hidden', minHeight:0 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#ff6d00', fontSize:13 }}>📊 Multi-Timeframe Analysis</div>
              {apiErrors.length>0 && <div style={{ fontSize:9, color:'#ff3366', fontWeight:700 }}>⚠ Failed: {apiErrors.join(', ')}</div>}
            </div>

            {loading ? (
              <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8 }}>
                <div style={{ fontSize:30 }} className="paw">🐾</div>
                <div style={{ fontFamily:"'Fredoka One'", color:'#ff6d00' }}>very fetch • such patience</div>
              </div>
            ) : Object.keys(tfData).length>0 ? (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:7, flexShrink:0 }}>
                {TFS.map(tf=>{
                  const d=tfData[tf]; if(!d) return (
                    <div key={tf} className="tf-card" style={{ borderLeft:`3px solid ${TF_COL[tf]}`, opacity:.4 }}>
                      <div style={{ fontFamily:"'Fredoka One'", color:TF_COL[tf], fontSize:12 }}>{TF_LBL[tf]}</div>
                      <div style={{ fontSize:9, color:'#303060', marginTop:4 }}>⚠ Failed to load</div>
                    </div>
                  );
                  const col=TF_COL[tf], bull=d.macd.bullish, rsi=d.rsi, sk=d.stochRSI.k;
                  return (
                    <div key={tf} className="tf-card" style={{ borderLeft:`3px solid ${col}` }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                        <span style={{ fontFamily:"'Fredoka One'", color:col, fontSize:12 }}>{TF_LBL[tf]}</span>
                        <span style={{ fontSize:12 }}>{bull?'🟢':'🔴'}</span>
                      </div>
                      <div style={{ marginBottom:5 }}>
                        <div style={{ fontSize:7, color:'#1e1e40', fontWeight:800, letterSpacing:1, marginBottom:1 }}>MACD</div>
                        <div style={{ display:'flex', justifyContent:'space-between' }}>
                          <span style={{ fontSize:10, color:bull?'#00e5aa':'#ff3366', fontWeight:800 }}>{bull?'▲':'▼'}{d.macd.line>0?'+':''}{d.macd.line}</span>
                          <span style={{ fontSize:8, color:'#1e1e40' }}>H:{d.macd.hist}</span>
                        </div>
                        <div className="bar" style={{ marginTop:2 }}><div className="bar-fill" style={{ width:`${Math.min(Math.abs(d.macd.hist/3),100)}%`, background:bull?'#00e5aa':'#ff3366' }}/></div>
                      </div>
                      <div style={{ marginBottom:5 }}>
                        <div style={{ fontSize:7, color:'#1e1e40', fontWeight:800, letterSpacing:1, marginBottom:1 }}>RSI {rsi}</div>
                        <div className="bar"><div className="bar-fill" style={{ width:`${rsi}%`, background:rsi>70?'#ff3366':rsi<30?'#42a5f5':col }}/></div>
                      </div>
                      {(tf==='1m'||tf==='5m')&&<div>
                        <div style={{ fontSize:7, color:'#1e1e40', fontWeight:800, letterSpacing:1, marginBottom:1 }}>StochRSI K:{sk}</div>
                        <div className="bar"><div className="bar-fill" style={{ width:`${sk}%`, background:sk<=20?'#42a5f5':sk>=80?'#ff3366':'#ffd700' }}/></div>
                        {(sk<=1||sk>=99)&&<div style={{ fontSize:8, color:sk<=1?'#42a5f5':'#ff3366', fontWeight:800, marginTop:2 }}>{sk<=1?'⚡ FLOOR':'🚨 CEILING'}</div>}
                      </div>}
                      {tf==='5m'&&d.bb&&price&&<div style={{ marginTop:4, padding:'3px 6px', background:'#050510', borderRadius:5, fontSize:8 }}>
                        <span style={{ color:price>d.bb.upper?'#ff3366':price<d.bb.lower?'#42a5f5':'#00e5aa', fontWeight:800 }}>
                          {price>d.bb.upper?'↑ Above BB':price<d.bb.lower?'↓ Below BB':'↔ Inside BB'} ({d.bb.pct?.toFixed(0)}%)
                        </span>
                      </div>}
                      {tf==='1h'&&d.vwap&&price&&<div style={{ marginTop:3, fontSize:8, color:price>d.vwap?'#00e5aa':'#ff3366', fontWeight:700 }}>
                        VWAP: {price>d.vwap?'Above ▲':'Below ▼'} {d.vwap?.toFixed(0)}
                      </div>}
                      {tf==='4h'&&<div style={{ marginTop:5, padding:'4px 7px', borderRadius:6, textAlign:'center', background:macro==='BULLISH'?'rgba(0,229,170,.05)':'rgba(255,51,102,.05)', border:`1px solid ${macro==='BULLISH'?'rgba(0,229,170,.15)':'rgba(255,51,102,.15)'}` }}>
                        <div style={{ fontFamily:"'Fredoka One'", fontSize:10, color:macro==='BULLISH'?'#00e5aa':macro==='BEARISH'?'#ff3366':'#ffd700' }}>
                          {macro==='BULLISH'?'🐂 BULLISH':macro==='BEARISH'?'🐻 BEARISH':'⚠️ NEUTRAL'}
                        </div>
                      </div>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:7 }}>
                <div style={{ fontSize:30 }}>🐾</div>
                <div style={{ fontFamily:"'Fredoka One'", color:'#ff6d00' }}>Click Fetch Data</div>
                <button className="btn" onClick={fetchData} style={{ background:'linear-gradient(135deg,#ff6d00,#ff9d00)', color:'white' }}>↻ Fetch Now</button>
              </div>
            )}

            {/* Quick Chart — SVG based to avoid recharts height issues */}
            {chartData.length>0 && (
              <div className="card" style={{ padding:9, flexShrink:0, height:110 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:5 }}>
                  <div style={{ fontFamily:"'Fredoka One'", color:'#ff9500', fontSize:11 }}>📈 Price Chart ({activeChart})</div>
                  <div style={{ display:'flex', gap:4 }}>
                    {['1m','5m','15m'].map(tf=>(
                      <button key={tf} onClick={()=>setActiveChart(tf)}
                        style={{ background:activeChart===tf?'#ff6d00':'#0c0c22', color:activeChart===tf?'white':'#2a2a5a', border:'none', borderRadius:5, padding:'2px 7px', fontSize:9, cursor:'pointer', fontFamily:"'Fredoka One'" }}>
                        {tf}
                      </button>
                    ))}
                  </div>
                </div>
                {(() => {
                  const prices = chartData.map(d=>d.price);
                  const minP = Math.min(...prices), maxP = Math.max(...prices);
                  const range = maxP - minP || 1;
                  const W = 480, H = 58, PAD = 4;
                  const pts = prices.map((p,i) => {
                    const x = PAD + (i/(prices.length-1))*(W-PAD*2);
                    const y = H - PAD - ((p-minP)/range)*(H-PAD*2);
                    return `${x},${y}`;
                  }).join(' ');
                  const areaClose = `${W-PAD},${H-PAD} ${PAD},${H-PAD}`;
                  const lastPrice = prices[prices.length-1];
                  const lastY = H - PAD - ((lastPrice-minP)/range)*(H-PAD*2);
                  const isUp = prices[prices.length-1] >= prices[0];
                  const col = isUp ? '#00e5aa' : '#ff3366';
                  return (
                    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display:'block' }}>
                      <defs>
                        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={col} stopOpacity={0.3}/>
                          <stop offset="100%" stopColor={col} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <polygon points={`${pts} ${areaClose}`} fill="url(#chartGrad)"/>
                      <polyline points={pts} fill="none" stroke={col} strokeWidth={1.5}/>
                      <line x1={W-PAD} y1={lastY} x2={W-PAD-30} y2={lastY} stroke={col} strokeWidth={1} strokeDasharray="2,2" opacity={0.5}/>
                      <text x={PAD} y={H-2} fill="#252550" fontSize={7} fontFamily="Nunito">${minP.toFixed(0)}</text>
                      <text x={PAD} y={PAD+6} fill="#252550" fontSize={7} fontFamily="Nunito">${maxP.toFixed(0)}</text>
                    </svg>
                  );
                })()}
              </div>
            )}
          </div>

          {/* ── RIGHT: Scorecard + Prediction + AI Pred + Skip ── */}
          <div className="scroll" style={{ display:'flex', flexDirection:'column', gap:7 }}>

            {/* Confluence Scorecard */}
            <div className="card" style={{ padding:11 }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#ff6d00', fontSize:13, marginBottom:8 }}>📋 Confluence Score</div>
              {pred?.factors?.length>0 ? (
                <>
                  {pred.factors.map((f,i)=>(
                    <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:'1px solid #0c0c22' }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:10, fontWeight:800, color:f.pass?'#e0e0ff':'#3a3a6a' }}>{f.name}</div>
                        <div style={{ fontSize:8, color: f.pass ? '#252550' : '#ff6d0088', marginTop:1 }}>
                          {f.pass ? f.value : (f.tip || f.value)}
                        </div>
                      </div>
                      <span style={{ fontSize:14, marginLeft:6 }}>{f.pass?'✅':'❌'}</span>
                    </div>
                  ))}
                  <div style={{ textAlign:'center', marginTop:8 }}>
                    <div style={{ fontSize:7, color:'#252550', fontWeight:800, letterSpacing:1 }}>SCORE</div>
                    <div style={{ fontFamily:"'Fredoka One'", fontSize:30, lineHeight:1, color:pred.score>=4?'#00e5aa':pred.score>=3?'#ffd700':'#ff3366' }}>
                      {pred.score}<span style={{ fontSize:16, color:'#252550' }}>/5</span>
                    </div>
                    {pred.score < 3 && <div style={{ fontSize:9, color:'#ff6d00', marginTop:4, fontWeight:700 }}>Need 3+ to bet</div>}
                  </div>
                </>
              ) : (
                <div style={{ textAlign:'center', padding:'10px 6px' }}>
                  <div style={{ fontSize:20, marginBottom:5 }}>🐾</div>
                  <div style={{ fontSize:10, color:'#252550', marginBottom:8, lineHeight:1.6 }}>
                    Need Polymarket odds to score<br/>
                    <span style={{ color:'#ff9d00' }}>→ Click 📊 Fill above (easiest!)</span>
                  </div>
                  {Object.keys(tfData).length > 0 && (
                    <button className="btn" onClick={smartFill} style={{ background:'rgba(255,109,0,.15)', color:'#ff9d00', border:'1px solid #ff9d0044', fontSize:10, padding:'5px 12px', width:'100%' }}>
                      📊 Smart Fill Odds Now
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* MAIN PREDICTION */}
            <div className={`card slide ${pred?.result && !['NO BET','---'].includes(pred.result)?'pred-glow':''}`}
              style={{ padding:11, border:`2px solid ${pred?.color||'#131328'}`, boxShadow:`0 0 10px ${pred?.color||'transparent'}18` }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#ff6d00', fontSize:12, marginBottom:6 }}>🔮 Signal Prediction</div>
              {pred?.result && pred.result !== '---' ? (
                <div style={{ textAlign:'center', padding:'9px 5px', background:`${pred.color||'#252550'}08`, borderRadius:9, marginBottom:7 }}>
                  <div style={{ fontSize:24, marginBottom:2 }}>{pred.result==='UP'?'🚀':pred.result==='DOWN'?'📉':pred.result==='NO BET'?'🛑':'🐾'}</div>
                  <div style={{ fontFamily:"'Fredoka One'", fontSize:30, color:pred.color||'#ffd700', lineHeight:1 }}>{pred.result}</div>
                  {pred.conf>0 && <div style={{ marginTop:6 }}>
                    <div style={{ fontSize:7, color:'#252550', fontWeight:800, letterSpacing:1 }}>CONFIDENCE</div>
                    <div style={{ fontFamily:"'Fredoka One'", fontSize:20, color:'#e0e0ff' }}>{pred.conf}%</div>
                    <div className="bar" style={{ margin:'4px 0' }}><div className="bar-fill" style={{ width:`${pred.conf}%`, background:`linear-gradient(90deg,#ff6d00,${pred.color})` }}/></div>
                  </div>}
                  <div style={{ fontSize:9, color:'#4a4a7a', lineHeight:1.6, fontWeight:600, marginTop:6 }}>{pred.reason}</div>
                </div>
              ) : (
                <div style={{ textAlign:'center', padding:'10px 5px' }}>
                  <div style={{ fontSize:20, marginBottom:5 }}>🔮</div>
                  <div style={{ fontSize:10, color:'#252550', lineHeight:1.7 }}>
                    Step 1: Click <span style={{color:'#ff9d00',fontWeight:800}}>Fetch Data</span><br/>
                    Step 2: Click <span style={{color:'#ff9d00',fontWeight:800}}>📊 Fill</span> for odds<br/>
                    Step 3: Prediction appears here
                  </div>
                </div>
              )}
            </div>

            {/* AI MOMENTUM PREDICTION */}
            {aiPred && Object.keys(tfData).length > 0 && (
              <div className="card" style={{ padding:11, border:'1px solid #c44dff22' }}>
                <div style={{ fontFamily:"'Fredoka One'", color:'#c44dff', fontSize:12, marginBottom:6 }}>🤖 AI Momentum</div>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
                  <div style={{ fontFamily:"'Fredoka One'", fontSize:22, color:aiPred.dir==='UP'?'#00e5aa':aiPred.dir==='DOWN'?'#ff3366':'#ffd700' }}>{aiPred.dir}</div>
                  <div>
                    <div style={{ fontSize:8, color:'#252550', fontWeight:800 }}>AI CONF</div>
                    <div style={{ fontFamily:"'Fredoka One'", fontSize:16, color:'#c44dff' }}>{aiPred.conf}%</div>
                  </div>
                </div>
                {aiPred.signals.slice(0,3).map((s,i)=>(
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:9, padding:'2px 0', color:'#3a3a6a' }}>
                    <span>{s.label}</span><span style={{ color:s.bull?'#00e5aa':'#ff3366', fontWeight:700 }}>{s.val}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Skip Monitor */}
            <div className="card" style={{ padding:11 }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#ff9d00', fontSize:12, marginBottom:7 }}>🛡️ Skip Monitor</div>
              {[{l:'Dangerous',a:dangerous},{l:'Whale Dom',a:whale},{l:'Low Liq',a:lowLiq},{l:'Coin flip',a:!!upOdds&&parseFloat(upOdds)>=48&&parseFloat(upOdds)<=52},{l:'$20 zone',a:bufAbs!==null&&bufAbs<20},{l:'4H Neutral',a:macro==='NEUTRAL'||macro==='N/A'},{l:'WS Down',a:!wsLive}].map((it,i)=>(
                <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'3px 0', borderBottom:'1px solid #090920', fontSize:10 }}>
                  <span style={{ color:it.a?'#ff3366':'#2a2a5a', fontWeight:700 }}>{it.l}</span>
                  <span>{it.a?'🚫':'✅'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          CHART TAB — Full Candlestick
      ══════════════════════════════════════════════════════ */}
      {activeTab==='chart' && (
        <div style={{ flex:1, padding:10, display:'flex', flexDirection:'column', gap:8, overflow:'hidden', minHeight:0 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
            <div style={{ fontFamily:"'Fredoka One'", color:'#ff6d00', fontSize:14 }}>📊 BTC Candlestick Chart</div>
            <div style={{ display:'flex', gap:5 }}>
              {TFS.map(tf=>(
                <button key={tf} onClick={()=>setActiveChart(tf)}
                  style={{ background:activeChart===tf?TF_COL[tf]:'#0c0c22', color:activeChart===tf?'#050510':'#2a2a5a', border:`1px solid ${activeChart===tf?TF_COL[tf]:'#131328'}`, borderRadius:6, padding:'4px 10px', fontSize:10, cursor:'pointer', fontFamily:"'Fredoka One'" }}>
                  {TF_LBL[tf]}
                </button>
              ))}
            </div>
          </div>

          {/* Stats bar */}
          {stats24h && (
            <div style={{ display:'flex', gap:10, flexShrink:0, padding:'8px 12px', background:'#0a0a1a', borderRadius:9, border:'1px solid #131328' }}>
              {[['24H HIGH', `$${stats24h.high24h?.toFixed(0)||'—'}`, '#00e5aa'],['24H LOW', `$${stats24h.low24h?.toFixed(0)||'—'}`, '#ff3366'],['24H VOL', `${(stats24h.volume24h/1000).toFixed(1)}K BTC`, '#c44dff'],['CHANGE', `${stats24h.change24h>=0?'+':''}${stats24h.change24h}%`, stats24h.change24h>=0?'#00e5aa':'#ff3366']].map(([l,v,c])=>(
                <div key={l}>
                  <div style={{ fontSize:7, color:'#252550', fontWeight:800, letterSpacing:1 }}>{l}</div>
                  <div style={{ fontFamily:"'Fredoka One'", fontSize:14, color:c }}>{v}</div>
                </div>
              ))}
              <div style={{ marginLeft:'auto' }}>
                <div style={{ fontSize:7, color:'#252550', fontWeight:800, letterSpacing:1 }}>CURRENT</div>
                <div style={{ fontFamily:"'Fredoka One'", fontSize:14, color:change24h>=0?'#00e5aa':'#ff3366' }}>${fmt(price)}</div>
              </div>
            </div>
          )}

          <div className="card" style={{ flex:1, padding:12, overflow:'hidden', minHeight:0 }}>
            {tfData[activeChart]?.candles ? (
              <CandlestickChart
                candles={tfData[activeChart].candles}
                height={280}
                threshold={threshold?parseFloat(threshold):null}
                vwap={tfData[activeChart]?.vwap}
              />
            ) : (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:200, flexDirection:'column', gap:8, color:'#252550' }}>
                <div style={{ fontSize:28 }}>📊</div>
                <div style={{ fontFamily:"'Fredoka One'", color:'#ff6d00' }}>Fetch data to view chart</div>
                <button className="btn" onClick={fetchData} style={{ background:'linear-gradient(135deg,#ff6d00,#ff9d00)', color:'white' }}>↻ Fetch Now</button>
              </div>
            )}
          </div>

          {/* MACD Histogram */}
          {tfData[activeChart]?.macd?.histArr && (
            <div className="card" style={{ padding:10, flexShrink:0 }}>
              <div style={{ fontFamily:"'Fredoka One'", color:TF_COL[activeChart]||'#ff6d00', fontSize:11, marginBottom:5 }}>MACD Histogram — {TF_LBL[activeChart]}</div>
              <ResponsiveContainer width="100%" height={50}>
                <BarChart data={tfData[activeChart].macd.histArr.map((v,i)=>({i,v}))}>
                  <XAxis dataKey="i" hide/><YAxis hide/>
                  <Bar dataKey="v" fill="#ff6d00" fillOpacity={0.7}
                    label={false}
                    shape={({x,y,width,height,value})=>{
                      const col = value>=0?'#00e5aa':'#ff3366';
                      const absH = Math.abs(height);
                      const ty = value>=0?y:y+height;
                      return <rect x={x} y={ty} width={width} height={absH} fill={col} opacity={0.7} rx={1}/>;
                    }}/>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          AUTO-BOT TAB
      ══════════════════════════════════════════════════════ */}
      {activeTab==='autobot' && (
        <div style={{ flex:1, padding:10, display:'grid', gridTemplateColumns:'280px 1fr', gap:8, overflow:'hidden', minHeight:0 }}>

          {/* ── LEFT: Controls ── */}
          <div style={{ display:'flex', flexDirection:'column', gap:7, overflow:'hidden' }}>

            {/* Main on/off */}
            <div className="card" style={{ padding:14, border:`2px solid ${autoBot ? '#00e5aa' : '#131328'}`, boxShadow: autoBot ? '0 0 20px rgba(0,229,170,.15)' : 'none' }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#ff6d00', fontSize:15, marginBottom:4 }}>🤖 Auto-Bot</div>
              <div style={{ fontSize:10, color:'#3a3a6a', marginBottom:12, lineHeight:1.6 }}>
                Automatically places and resolves paper bets every 5-min round. Evaluates signal 45s before each round ends.
              </div>

              {/* Big ON/OFF toggle */}
              <button onClick={() => { setAutoBot(a => !a); if(autoBot) { setBotLog([]); setSkippedCount(0); }}}
                style={{ width:'100%', padding:'14px', borderRadius:12, border:'none', cursor:'pointer', fontFamily:"'Fredoka One'", fontSize:18, letterSpacing:1,
                  background: autoBot ? 'linear-gradient(135deg,#00e5aa,#009970)' : 'linear-gradient(135deg,#1a1a3a,#0f0f28)',
                  color: autoBot ? '#050510' : '#252560',
                  boxShadow: autoBot ? '0 0 20px rgba(0,229,170,.3)' : 'none',
                  transition:'all .3s', marginBottom:10 }}>
                {autoBot ? '⏹ STOP BOT' : '▶ START BOT'}
              </button>

              {/* Status indicator */}
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', background:'#050510', borderRadius:8 }}>
                <div style={{ width:10, height:10, borderRadius:'50%', flexShrink:0,
                  background: botStatus==='betting'?'#ffd700': botStatus==='win'?'#00e5aa': botStatus==='loss'?'#ff3366': botStatus==='watching'||botStatus==='analyzing'?'#00e5aa':'#252550',
                  animation: autoBot ? 'flash 1s infinite' : 'none' }}/>
                <div>
                  <div style={{ fontSize:10, fontWeight:800, color:'#e0e0ff', textTransform:'uppercase', letterSpacing:1 }}>{botStatus}</div>
                  {roundTimer !== null && autoBot && (
                    <div style={{ fontSize:9, color:'#3a3a6a' }}>
                      Next round in: <span style={{ color: roundTimer <= 60 ? '#ffd700' : '#3a3a6a', fontWeight:800 }}>
                        {Math.floor(roundTimer/60)}:{String(roundTimer%60).padStart(2,'0')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Bot config */}
            <div className="card" style={{ padding:12 }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#ffd700', fontSize:13, marginBottom:10 }}>⚙️ Bot Config</div>
              <div style={{ marginBottom:8 }}>
                <div style={{ fontSize:8, color:'#202045', fontWeight:800, letterSpacing:1, marginBottom:3 }}>BET SIZE ($)</div>
                <input className="inp" type="number" value={betAmt} onChange={e=>setBetAmt(e.target.value)} placeholder="5" disabled={autoBot}/>
              </div>
              <div style={{ fontSize:9, color:'#3a3a6a', lineHeight:1.7 }}>
                <div>🕐 Evaluates signal <span style={{color:'#ffd700'}}>40–50s</span> before each round</div>
                <div>📊 Needs <span style={{color:'#ffd700'}}>3+/5</span> confluences to bet</div>
                <div>🔁 Auto-resolves at round end</div>
                <div>🧠 Updates AI weights after each bet</div>
                <div>⚠️ Skips if balance &lt; bet size</div>
              </div>
            </div>

            {/* Current signal snapshot */}
            <div className="card" style={{ padding:12 }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#c44dff', fontSize:13, marginBottom:8 }}>📡 Live Signal</div>
              {pred?.result && pred.result !== '---' ? (
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
                    <div style={{ fontFamily:"'Fredoka One'", fontSize:26, color:pred.color||'#ffd700' }}>{pred.result}</div>
                    <div>
                      <div style={{ fontSize:8, color:'#252550', fontWeight:800 }}>CONF / SCORE</div>
                      <div style={{ fontFamily:"'Fredoka One'", fontSize:15, color:'#e0e0ff' }}>{pred.conf}% · {pred.score}/5</div>
                    </div>
                  </div>
                  <div style={{ fontSize:9, color:'#3a3a6a', lineHeight:1.5 }}>{pred.reason}</div>
                  {pred.result !== 'NO BET' && pred.score >= 3 ? (
                    <div style={{ marginTop:8, padding:'6px 9px', background:'rgba(0,229,170,.07)', borderRadius:7, border:'1px solid rgba(0,229,170,.15)', fontSize:9, color:'#00e5aa', fontWeight:800 }}>
                      ✅ Bot WOULD bet {pred.result} this round
                    </div>
                  ) : (
                    <div style={{ marginTop:8, padding:'6px 9px', background:'rgba(255,213,0,.05)', borderRadius:7, border:'1px solid rgba(255,213,0,.1)', fontSize:9, color:'#ffd700', fontWeight:700 }}>
                      ⏭ Bot would SKIP this round
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ textAlign:'center', color:'#252550', fontSize:10, padding:10 }}>
                  Set up odds on Dashboard first
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="card" style={{ padding:12 }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#ff9d00', fontSize:13, marginBottom:10 }}>📊 Bot Stats</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                {[
                  ['BALANCE', `$${balance.toFixed(2)}`, '#ffd700'],
                  ['P&L', `${totalPnL>=0?'+':''}$${totalPnL.toFixed(2)}`, totalPnL>=0?'#00e5aa':'#ff3366'],
                  ['WIN RATE', `${winRate}%`, winRate>=55?'#00e5aa':'#ff3366'],
                  ['AUTO BETS', betHistory.filter(b=>b.auto).length, '#c44dff'],
                  ['SKIPPED', skippedCount, '#ffd700'],
                  ['BETS WON', betHistory.filter(b=>b.auto&&b.correct).length, '#00e5aa'],
                ].map(([l,v,c])=>(
                  <div key={l} style={{ background:'#050510', borderRadius:7, padding:'8px', textAlign:'center' }}>
                    <div style={{ fontSize:7, color:'#252550', fontWeight:800, letterSpacing:1 }}>{l}</div>
                    <div style={{ fontFamily:"'Fredoka One'", fontSize:15, color:c, marginTop:2 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── RIGHT: Bot Log ── */}
          <div className="card" style={{ padding:13, display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, flexShrink:0 }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#ff6d00', fontSize:14 }}>📋 Bot Activity Log</div>
              <button onClick={()=>setBotLog([])} style={{ background:'#0c0c22', color:'#252560', border:'1px solid #131328', borderRadius:6, padding:'3px 10px', fontSize:9, cursor:'pointer', fontFamily:"'Fredoka One'" }}>Clear</button>
            </div>

            {botLog.length === 0 ? (
              <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:10 }}>
                <div style={{ fontSize:36 }}>🤖</div>
                <div style={{ fontFamily:"'Fredoka One'", color:'#ff6d00', fontSize:14 }}>Bot is idle</div>
                <div style={{ fontSize:11, color:'#252550', textAlign:'center', lineHeight:1.8, maxWidth:320 }}>
                  1. Set up your odds on the Dashboard tab<br/>
                  2. Make sure Fetch Data has run<br/>
                  3. Click ▶ START BOT above<br/>
                  4. Bot places bets automatically every 5 mins
                </div>
              </div>
            ) : (
              <div className="scroll" style={{ flex:1 }}>
                {botLog.map((entry, i) => {
                  const col = entry.type==='win'?'#00e5aa': entry.type==='loss'?'#ff3366': entry.type==='bet'?'#ffd700': entry.type==='skip'?'#3a3a6a': entry.type==='start'?'#c44dff':'#3a3a6a';
                  const bg  = entry.type==='win'?'rgba(0,229,170,.05)': entry.type==='loss'?'rgba(255,51,102,.05)': entry.type==='bet'?'rgba(255,213,0,.05)':'transparent';
                  return (
                    <div key={i} style={{ padding:'8px 10px', borderRadius:7, marginBottom:4, background:bg, borderLeft:`3px solid ${col}` }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:2 }}>
                        <span style={{ fontSize:11, color:col, fontWeight:800 }}>{entry.msg}</span>
                        <span style={{ fontSize:8, color:'#252550', flexShrink:0, marginLeft:8 }}>{entry.time}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Round timer bar */}
            {autoBot && roundTimer !== null && (
              <div style={{ flexShrink:0, marginTop:10, padding:'8px 10px', background:'#050510', borderRadius:8 }}>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, marginBottom:4 }}>
                  <span style={{ color:'#252550', fontWeight:800 }}>NEXT ROUND</span>
                  <span style={{ color: roundTimer<=60?'#ffd700':'#3a3a6a', fontWeight:800, fontFamily:"'Fredoka One'" }}>
                    {Math.floor(roundTimer/60)}:{String(roundTimer%60).padStart(2,'0')}
                  </span>
                </div>
                <div className="bar" style={{ height:6 }}>
                  <div className="bar-fill" style={{ width:`${Math.min(100, ((300-roundTimer)/300)*100)}%`, background: roundTimer<=45?'#ffd700':roundTimer<=60?'#ff9d00':'#00e5aa', height:'100%', transition:'width 1s linear' }}/>
                </div>
                <div style={{ fontSize:8, color:'#252550', marginTop:3 }}>
                  {roundTimer > 65 ? 'Watching...' : roundTimer > 50 ? '⚡ Fetching fresh data...' : roundTimer > 5 ? '🎯 Signal evaluated — bet placed or skipped' : '🔔 Resolving round...'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          WHALES TAB
      ══════════════════════════════════════════════════════ */}
      {activeTab==='whales' && (
        <div style={{ flex:1, padding:10, display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, overflow:'hidden', minHeight:0 }}>
          {/* Whale sentiment */}
          <div style={{ display:'flex', flexDirection:'column', gap:7, overflow:'hidden' }}>
            <div className="card" style={{ padding:13 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                <div style={{ fontFamily:"'Fredoka One'", color:'#ff6d00', fontSize:14 }}>🐋 Whale Monitor</div>
                <button className="btn" onClick={fetchWhales} disabled={whaleLoading}
                  style={{ background:'#0c0c22', color:'#c44dff', border:'1px solid #c44dff33', fontSize:10, padding:'5px 10px' }}>
                  {whaleLoading?<span className="spin">🐾</span>:'↻'} Refresh
                </button>
              </div>
              {whales.length>0 && whales[0].demo && <div style={{ fontSize:9, color:'#ffd700', marginBottom:8, fontWeight:700 }}>📌 Demo mode — add real API key in whaleMonitor.js</div>}

              {/* Sentiment score */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:7, marginBottom:10 }}>
                {[['SENTIMENT',whaleSentiment.label,whaleSentiment.label==='BULLISH'?'#00e5aa':whaleSentiment.label==='BEARISH'?'#ff3366':'#ffd700'],['BULLISH',whaleSentiment.bullish||0,'#00e5aa'],['BEARISH',whaleSentiment.bearish||0,'#ff3366']].map(([l,v,c])=>(
                  <div key={l} style={{ background:'#050510', borderRadius:8, padding:'9px', textAlign:'center' }}>
                    <div style={{ fontSize:8, color:'#252550', fontWeight:800, letterSpacing:1 }}>{l}</div>
                    <div style={{ fontFamily:"'Fredoka One'", fontSize:v?.toString().length>6?12:16, color:c, marginTop:2 }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Whale transactions */}
              <div className="scroll" style={{ maxHeight:320 }}>
                {whales.map((w,i)=>(
                  <div key={w.id||i} style={{ padding:'8px 0', borderBottom:'1px solid #0c0c22' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
                      <span style={{ fontFamily:"'Fredoka One'", color:w.sentiment==='bullish'?'#00e5aa':w.sentiment==='bearish'?'#ff3366':'#ffd700', fontSize:12 }}>
                        {w.sentiment==='bullish'?'📤':w.sentiment==='bearish'?'📥':'↔'} {w.amount?.toFixed(1)} BTC
                      </span>
                      <span style={{ color:'#252550', fontSize:9 }}>{w.time}</span>
                    </div>
                    <div style={{ fontSize:9, color:'#3a3a6a', marginTop:2 }}>
                      {w.from} → {w.to}
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', marginTop:2 }}>
                      <span style={{ fontSize:8, color:'#252550' }}>{w.type?.replace(/_/g,' ')}</span>
                      <span style={{ fontSize:9, color:'#ffd700', fontWeight:700 }}>${(w.valueUSD/1000000).toFixed(1)}M</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Whale influence on signal */}
          <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
            <div className="card" style={{ padding:13 }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#c44dff', fontSize:13, marginBottom:10 }}>🧠 Whale → Signal Impact</div>
              <div style={{ fontSize:11, color:'#3a3a6a', lineHeight:1.8, marginBottom:10 }}>
                Whale transactions influence the signal confidence:
              </div>
              {[['Exchange Deposits (bearish)','Whales sending to exchange to sell → reduces UP confidence'],['Exchange Withdrawals (bullish)','Whales taking BTC off exchange → boost for UP'],['Large Transfers (neutral)','OTC or custody moves — no directional signal']].map(([l,d],i)=>(
                <div key={i} style={{ padding:'8px 0', borderBottom:'1px solid #0c0c22' }}>
                  <div style={{ fontSize:11, fontWeight:800, color:'#e0e0ff', marginBottom:2 }}>{l}</div>
                  <div style={{ fontSize:10, color:'#3a3a6a' }}>{d}</div>
                </div>
              ))}
              <div style={{ marginTop:12, padding:'10px', background:'#050510', borderRadius:9, border:'1px solid #c44dff22' }}>
                <div style={{ fontSize:8, color:'#252550', fontWeight:800, letterSpacing:1, marginBottom:5 }}>CURRENT WHALE SIGNAL</div>
                <div style={{ fontFamily:"'Fredoka One'", fontSize:22, color:whaleSentiment.label==='BULLISH'?'#00e5aa':whaleSentiment.label==='BEARISH'?'#ff3366':'#ffd700' }}>{whaleSentiment.label}</div>
                <div style={{ fontSize:10, color:'#3a3a6a', marginTop:3 }}>Score: {whaleSentiment.score} • Adjusts confidence by ±3%</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          AI LAB TAB
      ══════════════════════════════════════════════════════ */}
      {activeTab==='ai' && (
        <div style={{ flex:1, padding:8, display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, overflow:'hidden', minHeight:0 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:7, overflow:'hidden' }}>
            <div className="card" style={{ padding:13 }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#c44dff', fontSize:14, marginBottom:4 }}>🧠 AI Learning Engine <span style={{ fontSize:9, color:'#00e5aa', fontWeight:800, background:'rgba(0,229,170,.08)', padding:'2px 7px', borderRadius:10, marginLeft:4 }}>💾 Auto-saved</span></div>
              <div style={{ fontSize:10, color:'#3a3a6a', marginBottom:10, lineHeight:1.7 }}>Weights update automatically after each resolved paper bet. Correct predictions reinforce signals; incorrect predictions reduce their weight.</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:7, marginBottom:10 }}>
                {[{l:'Total Bets',v:betHistory.length,c:'#c44dff'},{l:'Win Rate',v:`${winRate}%`,c:winRate>=55?'#00e5aa':'#ff3366'},{l:'P&L',v:`${totalPnL>=0?'+':''}$${totalPnL.toFixed(2)}`,c:totalPnL>=0?'#00e5aa':'#ff3366'},{l:'Balance',v:`$${balance.toFixed(2)}`,c:'#ffd700'}].map((s,i)=>(
                  <div key={i} style={{ background:'#050510', borderRadius:8, padding:'9px', textAlign:'center' }}>
                    <div style={{ fontSize:8, color:'#252550', fontWeight:800, letterSpacing:1 }}>{s.l}</div>
                    <div style={{ fontFamily:"'Fredoka One'", fontSize:18, color:s.c }}>{s.v}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontFamily:"'Fredoka One'", color:'#c44dff', fontSize:12, marginBottom:7 }}>Live Weights</div>
              {Object.entries(weights).map(([k,v])=>(
                <div key={k} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:5 }}>
                  <span style={{ fontSize:9, color:'#3a3a6a', fontWeight:700, minWidth:100 }}>{k}</span>
                  <div className="bar" style={{ flex:1, height:6 }}>
                    <div className="bar-fill" style={{ width:`${Math.min(100,(v/2)*100)}%`, background:v>1.5?'#00e5aa':v<0.5?'#ff3366':'#c44dff', height:'100%', boxShadow:v>1.8?'0 0 6px #00e5aa':v<0.3?'0 0 6px #ff3366':'none' }}/>
                  </div>
                  <span style={{ fontSize:9, fontWeight:800, color:v>1.5?'#00e5aa':v<0.5?'#ff3366':'#c44dff', minWidth:32 }}>{v.toFixed(2)}</span>
                </div>
              ))}
              <div style={{ display:'flex', gap:6, marginTop:8 }}>
                <button className="btn" onClick={()=>setWeights(DEFAULT_WEIGHTS)} style={{ flex:1, background:'#08081e', color:'#252560', border:'1px solid #12122e', fontSize:10 }}>Reset Weights</button>
                <button className="btn" onClick={()=>{ if(!window.confirm('Wipe ALL saved data? Balance, bets, weights, history.')) return; ['bd_weights','bd_balance','bd_betHistory','bd_paperBets','bd_aiLog','bd_pendingBet'].forEach(k=>localStorage.removeItem(k)); setWeights(DEFAULT_WEIGHTS); setBalance(100); setBetHistory([]); setPaperBets([]); setAiLog([]); setPendingBet(null); }} style={{ flex:1, background:'rgba(255,51,102,.08)', color:'#ff3366', border:'1px solid #ff336633', fontSize:10 }}>🗑 Wipe All Data</button>
              </div>
            </div>
            {betHistory.length>1 && <div className="card" style={{ padding:11, flex:1 }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#ffd700', fontSize:12, marginBottom:7 }}>📊 P&L Curve</div>
              <ResponsiveContainer width="100%" height={100}>
                <LineChart data={betHistory.map((b,i)=>({i:i+1,pnl:betHistory.slice(0,i+1).reduce((a,x)=>a+x.pnl,0)}))}>
                  <XAxis dataKey="i" hide/><YAxis hide/>
                  <Tooltip contentStyle={{ background:'#0a0a1a', border:'1px solid #ffd700', borderRadius:6, fontSize:9, fontFamily:'Nunito' }} formatter={v=>[`$${v.toFixed(2)}`,'P&L']}/>
                  <Line type="monotone" dataKey="pnl" stroke="#ffd700" strokeWidth={2} dot={false}/>
                </LineChart>
              </ResponsiveContainer>
            </div>}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:7, overflow:'hidden' }}>
            <div className="card" style={{ padding:12, flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#00e5aa', fontSize:13, marginBottom:8 }}>📝 Learning Log</div>
              {aiLog.length===0 ? (
                <div style={{ textAlign:'center', color:'#252550', padding:24, fontSize:10 }}><div style={{ fontSize:26, marginBottom:7 }}>🐾</div>Resolve paper bets to see AI learning</div>
              ) : (
                <div className="scroll" style={{ flex:1 }}>
                  {aiLog.map((e,i)=>(
                    <div key={i} style={{ padding:'7px 0', borderBottom:'1px solid #090920', fontSize:10 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', marginBottom:1 }}>
                        <span style={{ color:e.won?'#00e5aa':'#ff3366', fontWeight:800 }}>{e.note}</span>
                        <span style={{ color:'#252550', fontSize:8 }}>{e.time}</span>
                      </div>
                      <div style={{ color:'#3a3a6a' }}>{e.direction} (conf:{e.conf}%)</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="card" style={{ padding:12, flex:1, overflow:'hidden', display:'flex', flexDirection:'column' }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#ffd700', fontSize:12, marginBottom:8 }}>💰 Bet History</div>
              {paperBets.length===0 ? <div style={{ textAlign:'center', color:'#252550', padding:20, fontSize:10 }}>No bets placed</div> : (
                <div className="scroll" style={{ flex:1 }}>
                  {paperBets.map((b,i)=>(
                    <div key={i} style={{ padding:'6px 0', borderBottom:'1px solid #090920' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
                        <span style={{ color:b.direction==='UP'?'#00e5aa':'#ff3366', fontWeight:800 }}>{b.direction==='UP'?'▲':'▼'} {b.direction} @{b.odds}¢</span>
                        <span style={{ color:b.outcome===null?'#ffd700':b.outcome===b.direction?'#00e5aa':'#ff3366', fontWeight:800 }}>
                          {b.outcome===null?'⏳':b.outcome===b.direction?`+$${(b.payout-b.amount).toFixed(2)}`:`-$${b.amount}`}
                        </span>
                      </div>
                      <div style={{ fontSize:8, color:'#252550' }}>Conf:{b.conf}% • {b.score}/5 • ${b.amount} • {b.time}</div>
                      {b.outcome===null && <div style={{ display:'flex', gap:4, marginTop:4 }}>
                        <button className="btn" onClick={()=>resolveBet(b.id,true)} style={{ flex:1, background:'rgba(0,229,170,.1)', color:'#00e5aa', border:'1px solid #00e5aa33', fontSize:9, padding:'3px' }}>✅ WIN</button>
                        <button className="btn" onClick={()=>resolveBet(b.id,false)} style={{ flex:1, background:'rgba(255,51,102,.1)', color:'#ff3366', border:'1px solid #ff336633', fontSize:9, padding:'3px' }}>❌ LOSE</button>
                      </div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          RULES TAB
      ══════════════════════════════════════════════════════ */}
      {activeTab==='rules' && (
        <div style={{ flex:1, padding:8, display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8, overflow:'auto' }}>
          {[
            { title:'🚫 Instant NO BET', color:'#ff3366', items:['🔴 Dangerous flag active','🐋 Whale Dominated any %','💧 Low Liquidity <85K','⚖️ Market odds 48–52¢ (coin flip)','📍 Price within $20 of threshold','⚠️ 4H NEUTRAL + mixed signals','🚨 StochRSI exact 0 or 100'] },
            { title:'✅ Winning Pattern', color:'#00e5aa', items:['Odds 60¢+ favoring one side','Price $30+ buffer on winning side','4H macro agrees with direction','No Dangerous/Whale/Low Liq flags','Score 4–5/5 with aligned AI pred'] },
            { title:'📉 Losing Patterns', color:'#ff9d00', items:['Fighting 4H bullish with DOWN bets','Ignoring StochRSI extremes','Betting within $20 of threshold','Betting 50/50 odds','Sending screenshots during round','Ignoring whale sentiment'] },
            { title:'🐋 Whale Rules', color:'#c44dff', items:['Exchange deposits = selling signal = bearish','Exchange withdrawals = bullish signal','±$200 BTC moves = liquidation cascade','Whale Dominated 2000%+ = skip always','Check whale tab BEFORE betting','Demo mode active — add API key for live data'] },
          ].map((sec,i)=>(
            <div key={i} className="card" style={{ padding:13, borderLeft:`3px solid ${sec.color}` }}>
              <div style={{ fontFamily:"'Fredoka One'", color:sec.color, fontSize:13, marginBottom:9 }}>{sec.title}</div>
              {sec.items.map((item,j)=>(
                <div key={j} style={{ fontSize:11, color:'#6060a0', fontWeight:600, padding:'5px 0', borderBottom:'1px solid #090920', lineHeight:1.5 }}>{item}</div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          SCHEDULE TAB
      ══════════════════════════════════════════════════════ */}
      {activeTab==='schedule' && (
        <div style={{ flex:1, padding:8, display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8, overflow:'auto' }}>
          {[
            { title:'🟢 Best Windows (EST)', color:'#00e5aa', rows:[['3:00–5:00 AM','London Open','Good liquidity'],['8:00–12:00 PM','London/NY Overlap','⭐ BEST WINDOW'],['12:00–2:00 PM','NY Session','Watch for flags']] },
            { title:'🔴 Avoid', color:'#ff3366', rows:[['10PM–2AM','Asian Dead Zone','Whale dominated'],['4PM–8PM','NY Close','Low liquidity'],['Sat–Sun','Weekend','Poor volume']] },
            { title:'⏰ Daily Routine', color:'#ff9d00', rows:[['7:54 AM','Check 4H macro + whale tab'],['8:00 AM','First round — send screenshots'],['8–11 AM','PRIME TIME — max 6 rounds'],['11:00 AM','Check Dangerous flags'],['2:00 PM','Hard stop for the day']] },
            { title:'💰 Bankroll Rules', color:'#c44dff', rows:[['Max bet/round','10% of balance'],['Daily loss limit','3 losses = stop'],['Win streak','Break after 5 wins'],['Min balance','Stop below $15'],['Screenshots','5 min before round'],['All 3 images','Together in 1 message']] },
          ].map((sec,i)=>(
            <div key={i} className="card" style={{ padding:13, borderLeft:`3px solid ${sec.color}` }}>
              <div style={{ fontFamily:"'Fredoka One'", color:sec.color, fontSize:13, marginBottom:9 }}>{sec.title}</div>
              {sec.rows.map((r,j)=>(
                <div key={j} style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid #090920' }}>
                  <div>
                    <span style={{ fontFamily:"'Fredoka One'", color:sec.color, fontSize:12 }}>{r[0]}</span>
                    {r[2]&&<div style={{ fontSize:9, color:'#3a3a6a', marginTop:1 }}>{r[1]}</div>}
                  </div>
                  <span style={{ fontSize:10, color:r[2]?.includes('⭐')?'#ffd700':'#3a3a6a', fontWeight:800, textAlign:'right', maxWidth:120 }}>{r[2]||r[1]}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <footer style={{ textAlign:'center', fontSize:8, color:'#0f0f28', borderTop:'1px solid #0c0c22', padding:'3px', flexShrink:0 }}>
        🐾 BabyDoge BTC Oracle v3 • Binance WebSocket + REST • Polymarket Gamma API • NOT financial advice • wow
      </footer>
    </div>
  );
}