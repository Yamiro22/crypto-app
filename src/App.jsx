// ─── BABYDOGE BTC ORACLE v3 — FULL INTELLIGENCE TERMINAL ────────────────────
import { useState, useEffect, useCallback, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, BarChart, Bar, ReferenceLine } from 'recharts';
import { fetchAllTimeframes, fetch24hrStats } from './services/binanceApi.js';
import { subscribePriceStream } from './services/binanceWS.js';
import { fetchActiveBTCMarket } from './services/polymarketApi.js';
import { fetchWhaleTransactions, getWhaleSentiment } from './services/whaleMonitor.js';
import { buildSignal, getMacro, classifyMarket, DEFAULT_WEIGHTS } from './ai/signalEngine.js';
import { updateWeights } from './ai/predictionModel.js';
import { requestPrediction, simulateTrade, fetchAiState, saveAiState } from './services/backendApi.js';
import CandlestickChart from './charts/CandlestickChart.jsx';
import QuantPanel from './quant/QuantPanel.jsx';
import { runQuantEngine } from './quant/quantEngine.js';

// ─── STYLES ──────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700&family=Space+Grotesk:wght@400;500;600;700&family=Fredoka+One&display=swap');
  :root{
    --bg-dark:#0a0b10;
    --panel-dark:#14161f;
    --accent-amber:#f2994a;
    --accent-teal:#38d4b3;
    --neon-green:#00ff94;
    --neon-red:#ff4b2b;
    --text-main:#e8e8f2;
    --text-muted:#8b8fa3;
  }
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  html,body,#root{width:100vw;height:100vh;overflow:hidden;background:var(--bg-dark);}
  body{font-family:'Space Grotesk',sans-serif;color:var(--text-main);background:
    radial-gradient(1200px 600px at 20% -10%, rgba(242,153,74,.08), transparent 50%),
    radial-gradient(900px 500px at 90% 0%, rgba(56,212,179,.08), transparent 50%),
    var(--bg-dark);
  }
  ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:var(--bg-dark)}::-webkit-scrollbar-thumb{background:#2a2d3a;border-radius:10px}
  @keyframes pounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes glow{0%,100%{box-shadow:0 0 10px rgba(242,153,74,.2)}50%{box-shadow:0 0 24px rgba(242,153,74,.45)}}
  @keyframes slideUp{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}
  @keyframes flash{0%,100%{opacity:1}50%{opacity:.25}}
  @keyframes pulse{0%{transform:scale(.95);opacity:.6}50%{transform:scale(1);opacity:1}100%{transform:scale(.95);opacity:.6}}
  .glass-panel,.card{background:rgba(20,22,31,.86);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.06);border-radius:16px;}
  .tf-card{background:linear-gradient(145deg,#1a1c26,#14161f);border:1px solid rgba(255,255,255,.05);border-radius:12px;padding:10px;transition:transform .2s;}
  .tf-card:hover{transform:translateY(-2px);}
  .inp{background:#0e1018;border:1.5px solid rgba(255,255,255,.08);border-radius:10px;color:var(--text-main);padding:8px 10px;font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:600;width:100%;outline:none;transition:border-color .2s;}
  .inp:focus{border-color:rgba(242,153,74,.6);}
  .inp::placeholder{color:#34384c;font-weight:600;}
  .flag{border:none;padding:5px 9px;border-radius:14px;cursor:pointer;font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:10px;transition:all .2s;}
  .flag:hover{transform:scale(1.05);}
  .btn{border:none;border-radius:10px;cursor:pointer;font-family:'Sora',sans-serif;font-size:12px;padding:9px 14px;transition:all .2s;letter-spacing:.4px;}
  .btn:hover:not(:disabled){transform:translateY(-1px);}
  .btn:disabled{opacity:.35;cursor:not-allowed;transform:none;}
  .nav-btn{background:none;border:none;cursor:pointer;font-family:'Sora',sans-serif;font-size:12px;padding:6px 10px;border-radius:8px;transition:all .2s;white-space:nowrap;color:var(--text-muted);position:relative;}
  .nav-btn.active{color:var(--accent-amber);}
  .nav-btn.active::after{content:'';position:absolute;left:0;bottom:-6px;width:100%;height:2px;background:var(--accent-amber);box-shadow:0 0 10px rgba(242,153,74,.6);}
  .bar{height:4px;border-radius:2px;background:#0f111b;overflow:hidden;}
  .bar-fill{height:100%;border-radius:2px;transition:width .5s;}
  .pred-glow{animation:glow 2s ease-in-out infinite;}
  .paw{animation:pounce 1.5s ease-in-out infinite;}
  .spin{animation:spin 1s linear infinite;display:inline-block;}
  .flash{animation:flash .8s ease-in-out infinite;}
  .pulse{animation:pulse 2s infinite;}
  .slide{animation:slideUp .3s ease;}
  .scroll{overflow-y:auto;}
  .scroll::-webkit-scrollbar{width:4px;}
  .live-dot{width:7px;height:7px;border-radius:50%;background:var(--neon-green);animation:flash 1s infinite;}
  .dead-dot{width:7px;height:7px;border-radius:50%;background:var(--neon-red);}
  .signal-up{color:var(--neon-green);text-shadow:0 0 10px rgba(0,255,148,.3);}
  .signal-down{color:var(--neon-red);text-shadow:0 0 10px rgba(255,75,43,.3);}
  .stat-card{background:linear-gradient(145deg,#1a1c26,#14161f);border-radius:12px;padding:10px;border:1px solid rgba(255,255,255,.04);}
  .dash-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:16px;padding:16px;min-height:0;overflow:hidden;}
  @media (max-width:1100px){.dash-grid{grid-template-columns:1fr}.dash-col{grid-column:span 12}}
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
  const [thresholdSource,setThresholdSource]=useState(''); // 'real' | ''
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
  const [botCfg, setBotCfg] = useState(() => { try { const s=localStorage.getItem('bd_botCfg'); return s?JSON.parse(s):{minScore:3,minConf:55,useKelly:true,maxConsecLosses:3,stopLoss:20,profitTarget:30}; } catch { return {minScore:3,minConf:55,useKelly:true,maxConsecLosses:3,stopLoss:20,profitTarget:30}; } });
  const [sessionStats, setSessionStats] = useState({ wins:0, losses:0, startBal:100, skipReasons:{rule:0,bayes:0,lmsr:0,balance:0,circuit:0} });
  const autoRef = useRef({ autoBot: false, pred: null, price: null, threshold: null, pendingBet: null, balance: parseFloat(localStorage.getItem('bd_balance')||'100'), fetchedThisRound: false, bettedThisRound: false, betAmt: 5, botCfg: {minScore:3,minConf:55,useKelly:true,maxConsecLosses:3,stopLoss:20,profitTarget:30}, upOdds: 0, dnOdds: 0, tfData: {}, whaleSentiment: {score:0,label:'NEUTRAL'}, oddsHistory: [], spreadData: null, consecLosses: 0, sessionStartBal: parseFloat(localStorage.getItem('bd_balance')||'100'), paused: false });
  const lastBackendPred = useRef(0);
  const aiStateLoaded = useRef(false);

  // ── UI ──
  const [activeTab,    setActiveTab]    = useState('terminal');

  // ── New analytics state ──
  const [balanceHistory,   setBalanceHistory]   = useState(() => { try { return JSON.parse(localStorage.getItem('bd_balHist')||'[]'); } catch{ return []; } });
  const [signalAccuracy,   setSignalAccuracy]   = useState(() => { try { return JSON.parse(localStorage.getItem('bd_sigAcc')||'{}'); } catch{ return {}; } });
  const [weightHistory,    setWeightHistory]    = useState(() => { try { return JSON.parse(localStorage.getItem('bd_wHist')||'[]'); } catch{ return []; } });
  // Confidence deflation factor — starts at 0.85 until 50+ bets calibrated
  const CALIB_GATE = 50;
  const isCalibrated = betHistory.length >= CALIB_GATE;
  const confDeflation = isCalibrated ? 1.0 : 0.85;

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
      setPolyStatus('⚠️ Polymarket unavailable — backend proxy or market not found. Enter odds manually or wait for Auto.');
    }
  }, []);

  // ─── POLYMARKET AUTO REFRESH ──────────────────────────────────────────────
  useEffect(() => {
    fetchPoly();
    const t = setInterval(fetchPoly, 30000);
    return () => clearInterval(t);
  }, [fetchPoly]);

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
    const now = Date.now();
    if (price && now - lastBackendPred.current > 15000) {
      lastBackendPred.current = now;
      requestPrediction().then((p) => {
        if (!p) return;
        const dir = p.prediction || 'SIDEWAYS';
        const confPct = Math.round((p.confidence || 0) * 100);
        setAiPred({
          dir,
          conf: confPct,
          signals: [
            { label: 'Backend model', val: `${p.symbol} ${p.timeframe}`, bull: dir === 'UP' },
            { label: 'Confidence', val: `${confPct}%`, bull: dir === 'UP' },
          ],
        });
      });
    }
    const mkt = classifyMarket(tfData, whaleSentiment);
    setMarket(mkt);
  }, [tfData, price, upOdds, dnOdds, threshold, dangerous, whale, lowLiq, whaleSentiment, weights]);

  // keep ref in sync
  useEffect(() => { autoRef.current.price = price; }, [price]);
  useEffect(() => { autoRef.current.threshold = threshold; }, [threshold]);
  useEffect(() => { autoRef.current.autoBot = autoBot; }, [autoBot]);
  useEffect(() => { autoRef.current.pendingBet = pendingBet; }, [pendingBet]);
  useEffect(() => { autoRef.current.balance = balance; }, [balance]);
  useEffect(() => { autoRef.current.betAmt = parseFloat(betAmt) || 5; }, [betAmt]);
  useEffect(() => { autoRef.current.botCfg = botCfg; }, [botCfg]);
  useEffect(() => { autoRef.current.upOdds = parseFloat(upOdds) || 0; }, [upOdds]);
  useEffect(() => { autoRef.current.dnOdds = parseFloat(dnOdds) || 0; }, [dnOdds]);
  useEffect(() => { autoRef.current.tfData = tfData; }, [tfData]);
  useEffect(() => { autoRef.current.whaleSentiment = whaleSentiment; }, [whaleSentiment]);
  useEffect(() => { autoRef.current.oddsHistory = oddsHistory; }, [oddsHistory]);
  useEffect(() => { autoRef.current.spreadData = spreadData; }, [spreadData]);
  useEffect(() => { try { localStorage.setItem('bd_botCfg', JSON.stringify(botCfg)); } catch{} }, [botCfg]);

  // ─── LOCALSTORAGE PERSISTENCE ────────────────────────────────────────────
  useEffect(() => { try { localStorage.setItem('bd_weights',    JSON.stringify(weights));    } catch{} }, [weights]);
  useEffect(() => { try { localStorage.setItem('bd_balance',    balance.toString());          } catch{} }, [balance]);
  useEffect(() => { try { localStorage.setItem('bd_betHistory', JSON.stringify(betHistory));  } catch{} }, [betHistory]);
  useEffect(() => { try { localStorage.setItem('bd_paperBets',  JSON.stringify(paperBets));   } catch{} }, [paperBets]);
  useEffect(() => { try { localStorage.setItem('bd_aiLog',      JSON.stringify(aiLog));       } catch{} }, [aiLog]);
  useEffect(() => { try { localStorage.setItem('bd_pendingBet', JSON.stringify(pendingBet));  } catch{} }, [pendingBet]);
  useEffect(() => { try { localStorage.setItem('bd_balHist',    JSON.stringify(balanceHistory.slice(-200))); } catch{} }, [balanceHistory]);

  // Load AI state from backend if available
  useEffect(() => {
    fetchAiState().then((state) => {
      if (!state?.payload) { aiStateLoaded.current = true; return; }
      const p = state.payload || {};
      if (p.weights) setWeights(p.weights);
      if (p.aiLog) setAiLog(p.aiLog);
      if (p.betHistory) setBetHistory(p.betHistory);
      if (p.paperBets) setPaperBets(p.paperBets);
      if (p.balance !== undefined) setBalance(p.balance);
      if (p.botCfg) setBotCfg(p.botCfg);
      if (p.balanceHistory) setBalanceHistory(p.balanceHistory);
      if (p.signalAccuracy) setSignalAccuracy(p.signalAccuracy);
      if (p.weightHistory) setWeightHistory(p.weightHistory);
      aiStateLoaded.current = true;
    }).catch(() => { aiStateLoaded.current = true; });
  }, []);

  // Persist AI state to backend (debounced)
  useEffect(() => {
    if (!aiStateLoaded.current) return;
    const payload = {
      weights,
      aiLog,
      betHistory,
      paperBets,
      balance,
      botCfg,
      balanceHistory,
      signalAccuracy,
      weightHistory,
    };
    const t = setTimeout(() => { saveAiState(payload); }, 2000);
    return () => clearTimeout(t);
  }, [weights, aiLog, betHistory, paperBets, balance, botCfg, balanceHistory, signalAccuracy, weightHistory]);
  useEffect(() => { try { localStorage.setItem('bd_sigAcc',     JSON.stringify(signalAccuracy)); } catch{} }, [signalAccuracy]);
  useEffect(() => { try { localStorage.setItem('bd_wHist',      JSON.stringify(weightHistory.slice(-20))); } catch{} }, [weightHistory]);

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

  // Auto-sync threshold from fresh Polymarket data into autoRef
  useEffect(() => {
    if (polyRound?.threshold) {
      autoRef.current.threshold = polyRound.threshold.toString();
    }
  }, [polyRound]);

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
    simulateTrade({
      symbol: 'BTCUSDT',
      side: signal.result === 'UP' ? 'buy' : 'sell',
      size: amt,
      entry_price: currentPrice,
      signal: signal.result === 'UP' ? 'buy' : 'sell',
    });
    return bet;
  }, [upOdds, dnOdds]);

  // Auto-resolve bet (called by bot at round end)
  const botResolveBet = useCallback((bet, exitPrice) => {
    if (!bet || bet.outcome !== null) return;
    const thresh = parseFloat(bet.threshold) || parseFloat(threshold);
    let won = false;
    if (thresh > 0) {
      won = bet.direction === 'UP' ? exitPrice > thresh : exitPrice < thresh;
    } else {
      won = bet.direction === 'UP' ? exitPrice > bet.entryPrice : exitPrice < bet.entryPrice;
    }
    const outcome = won ? bet.direction : (bet.direction === 'UP' ? 'DOWN' : 'UP');
    setPaperBets(p => p.map(b => b.id === bet.id ? { ...b, outcome, exitPrice } : b));
    const pnl = won ? +(bet.payout - bet.amount).toFixed(2) : -bet.amount;
    if (won) setBalance(b => +(b + bet.payout).toFixed(2));
    const newBal = +(autoRef.current.balance + (won ? pnl : 0)).toFixed(2);
    // Balance history
    setBalanceHistory(h => [...h, { time: new Date().toLocaleTimeString(), balance: newBal, pnl, won }].slice(-200));
    if (bet.features) {
      const oldWeights = {...autoRef.current.weights || {}};
      setWeights(w => {
        const nw = updateWeights(w, bet.features, won);
        // Per-signal accuracy
        setSignalAccuracy(sa => {
          const updated = {...sa};
          Object.keys(bet.features).forEach(sig => {
            if (!updated[sig]) updated[sig] = {total:0, correct:0};
            updated[sig].total++;
            if (won) updated[sig].correct++;
          });
          return updated;
        });
        // Weight trajectory
        const wDeltas = {};
        Object.keys(nw).forEach(k => { const d = +(nw[k] - (w[k]||1)).toFixed(3); if (Math.abs(d) > 0.001) wDeltas[k] = d; });
        setWeightHistory(h => [...h, { ts: Date.now(), weights: {...nw} }].slice(-20));
        const regime = getMacro(autoRef.current.tfData || {});
        setAiLog(p => [{ time: new Date().toLocaleTimeString(), won, direction: bet.direction, conf: bet.conf, odds: bet.odds, pnl, regime, weightDeltas: wDeltas, note: won ? '✅ Auto-bet WIN — weights reinforced' : '🔄 Auto-bet LOSS — weights adjusted' }, ...p.slice(0, 19)]);
        return nw;
      });
    }
    setBetHistory(p => [...p, { correct: won, pnl, auto: true, ts: Date.now(), bal: newBal, conf: bet.conf, direction: bet.direction, odds: bet.odds, features: bet.features }]);
    setPendingBet(null);
    setBotRoundBet(null);
    return won;
  }, [threshold, updateWeights]);

  // Main bot ticker — runs every second
  useEffect(() => {
    if (!autoBot) { setRoundTimer(null); setBotStatus('idle'); return; }

    const startBal = autoRef.current.balance;
    // Fix 6: Only reset session data on a true new session (not a quick restart)
    const now = Date.now();
    const lastStop = autoRef.current.lastStopTime || 0;
    const isQuickRestart = (now - lastStop) < 90000; // within 90 seconds = quick restart
    if (!isQuickRestart) {
      autoRef.current.sessionStartBal = startBal;
      autoRef.current.consecLosses = 0;
      autoRef.current.paused = false;
      autoRef.current.consecutiveVetos = 0;
      autoRef.current.consecutiveRuleSkips = 0;
      setSessionStats({ wins:0, losses:0, startBal, skipReasons:{rule:0,bayes:0,lmsr:0,balance:0,circuit:0} });
      botLog_add('🤖 Auto-Bot STARTED — new session', 'start');
    } else {
      botLog_add(`🔄 Auto-Bot RESUMED — continuing session (${autoRef.current.consecLosses}L streak preserved)`, 'start');
    }
    setBotStatus('watching');

    const tick = setInterval(() => {
      const secs = secsToNextRound();
      setRoundTimer(secs);

      const ref = autoRef.current;
      if (!ref.autoBot) return;

      // Reset per-round flags when a new round begins
      if (secs >= 295) {
        ref.fetchedThisRound = false;
        ref.bettedThisRound  = false;
      }

      // ── 80–90s before round ends: fetch fresh data early (Fix: was 55-65) ──
      if (secs <= 90 && secs >= 80 && !ref.fetchedThisRound) {
        ref.fetchedThisRound = true;
        setBotStatus('analyzing');
        botLog_add(`⏱ Round ends in ~${secs}s — fetching fresh data (40s buffer)...`, 'info');
        fetchData();
        // Force-refresh Polymarket threshold directly into autoRef (bypasses state→ref delay)
        fetchActiveBTCMarket().then(market => {
          if (market?.threshold) {
            const newThresh = market.threshold.toString();
            if (newThresh !== autoRef.current.threshold) {
              botLog_add(`🔄 Threshold updated: $${autoRef.current.threshold} → $${newThresh}`, 'info');
            }
            autoRef.current.threshold = newThresh;
            setPolyRound(market); // also update state for UI
          }
        }).catch(() => {/* non-fatal */});
      }

      // ── 55–65s before: evaluate and bet (data now has 25s to arrive) ────
      if (secs <= 65 && secs >= 55 && !ref.bettedThisRound && !ref.pendingBet) {
        ref.bettedThisRound = true;
        const { pred: curPred, price: curPrice, threshold: curThresh, balance: curBalance,
                betAmt: curBetAmt, botCfg: cfg, upOdds: curUp, dnOdds: curDn,
                tfData: curTf, whaleSentiment: curWhale, oddsHistory: curOddsHist,
                spreadData: curSpread, consecLosses: curConsec, sessionStartBal, paused: isPaused } = ref;

        // ── [7] Session stop conditions ────────────────────────────────────
        const sessionPnL = curBalance - sessionStartBal;
        if (sessionPnL <= -(cfg.stopLoss || 20)) {
          botLog_add(`🛑 STOP-LOSS hit — session P&L: -$${Math.abs(sessionPnL).toFixed(2)}. Bot stopping.`, 'loss');
          setAutoBot(false);
          return;
        }
        if (sessionPnL >= (cfg.profitTarget || 30)) {
          botLog_add(`🎯 PROFIT TARGET hit — session P&L: +$${sessionPnL.toFixed(2)}. Bot stopping.`, 'win');
          setAutoBot(false);
          return;
        }

        // ── [3] Consecutive loss circuit breaker ───────────────────────────
        if (isPaused) {
          botLog_add(`⏸ PAUSED — ${curConsec} consecutive losses. Skipping this round.`, 'skip');
          ref.paused = false; // unpause after one skip
          setSkippedCount(n => n + 1);
          setSessionStats(s => ({ ...s, skipReasons: { ...s.skipReasons, circuit: s.skipReasons.circuit + 1 } }));
          setBotStatus('watching');
          return;
        }

        // ── [0] HARD ODDS CEILING — 62¢ max, no exceptions ────────────────
        // Above 62¢ you need >62% accuracy to profit. Engine runs at ~46%.
        if (curUp > 62 || curDn > 62) {
          const high = curUp > curDn ? `UP ${curUp}¢` : `DN ${curDn}¢`;
          botLog_add(`🚫 ODDS CEILING — ${high} > 62¢ cap → negative EV guaranteed. Skipping.`, 'skip');
          setSkippedCount(n => n + 1);
          setSessionStats(s => ({ ...s, skipReasons: { ...s.skipReasons, rule: s.skipReasons.rule + 1 } }));
          setBotStatus('watching');
          return;
        }

        // ── [0b] FRESH buildSignal() gate — re-run signal engine right now ─
        // Even if autoRef.current.pred is fresh, re-evaluate with latest odds/data
        // to catch any skip conditions (skip===true, score too low, etc.)
        {
          const freshSignal = buildSignal({ tfData: curTf, price: curPrice, upOdds: curUp, downOdds: curDn, threshold: curThresh, thresholdSource, dangerous, whale, lowLiq, whaleSentiment: curWhale, weights, spreadData: curSpread });
          if (freshSignal?.skip === true) {
            botLog_add(`🚫 SIGNAL SKIP — ${freshSignal.reason || 'buildSignal() returned skip=true'}`, 'skip');
            setSkippedCount(n => n + 1);
            setSessionStats(s => ({ ...s, skipReasons: { ...s.skipReasons, rule: s.skipReasons.rule + 1 } }));
            setBotStatus('watching');
            return;
          }
          // Use the fresh signal going forward in this tick
          if (freshSignal && ['UP','DOWN'].includes(freshSignal.result)) {
            autoRef.current.pred = freshSignal;
          }
        }

        // ── Balance check ──────────────────────────────────────────────────
        const baseAmt = curBetAmt || 5;
        if (curBalance < baseAmt) {
          botLog_add('💸 Balance too low to bet!', 'warn');
          setSkippedCount(n => n + 1);
          setSessionStats(s => ({ ...s, skipReasons: { ...s.skipReasons, balance: s.skipReasons.balance + 1 } }));
          setBotStatus('watching');
          return;
        }

        // ── [5] Rule engine gate — with Quant override path ─────────────────
        const minScore = cfg.minScore || 3;
        const minConf  = cfg.minConf  || 55;
        const ruleOk   = ['UP','DOWN'].includes(curPred?.result) && curPred.score >= minScore && curPred.conf >= minConf;

        if (!ruleOk) {
          // Track consecutive rule skips — relaxes Quant threshold after 4+ rounds stuck
          const ruleSkipCount = (autoRef.current.consecutiveRuleSkips || 0) + 1;
          autoRef.current.consecutiveRuleSkips = ruleSkipCount;

          // Fix 5 (upgraded): Before hard-skipping, check if Quant Engine agrees on direction.
          // Standard: Bayes≥80% + LMSR tradeable → override.
          // Relaxed (after 4+ skip streak): Bayes≥70% + no VETO → override at 40% size.
          let quantOverride = false;
          let overrideAmt = curBetAmt || 5;
          let overrideNote = '';
          if (curPred && ['UP','DOWN'].includes(curPred.result)) {
            try {
              const qCheck = runQuantEngine({
                signalResult: curPred, tfData: curTf, price: curPrice,
                whaleSentiment: curWhale, oddsHistory: curOddsHist,
                spreadData: curSpread, upOdds: curUp, dnOdds: curDn,
                liquidityUSDC: 100000, balance: curBalance,
                historicalBets: betHistory.length,
                options: { kellyFrac: 0.25, minEV: 0.04 },
              });
              const b = qCheck?.bayesian;
              const isVeto = qCheck?.combined?.strength === 'VETO';
              const lmsrTradeable = qCheck?.lmsr?.tradeable === true;

              // Standard override: Bayes≥80% same direction + LMSR tradeable
              const stdBayesThreshold = 0.80;
              const bayesStrongStd = b && (
                (curPred.result === 'UP'   && b.probUp   >= stdBayesThreshold) ||
                (curPred.result === 'DOWN' && b.probDown >= stdBayesThreshold)
              );
              if (bayesStrongStd && lmsrTradeable && !isVeto) {
                quantOverride = true;
                if (cfg.useKelly && qCheck?.decision?.size > 0) {
                  overrideAmt = Math.max(1, Math.round(Math.min(qCheck.decision.size * 0.6, curBalance * 0.08) * 2) / 2);
                }
                overrideNote = ` | QUANT OVERRIDE: Bayes ${(b.probUp*100).toFixed(0)}%UP/${(b.probDown*100).toFixed(0)}%DOWN + LMSR agree`;
                botLog_add(`⚡ QUANT OVERRIDE — rule ${curPred.score}/${minScore} weak but Bayes ${Math.round((curPred.result==='UP'?b.probUp:b.probDown)*100)}% + LMSR agree → $${overrideAmt}`, 'bet');
              }

              // Relaxed override: after 4+ skip rounds stuck, lower threshold to 70% + no VETO
              if (!quantOverride && ruleSkipCount >= 4 && !isVeto && b) {
                const relaxedThreshold = 0.70;
                const bayesRelaxed =
                  (curPred.result === 'UP'   && b.probUp   >= relaxedThreshold) ||
                  (curPred.result === 'DOWN' && b.probDown >= relaxedThreshold);
                if (bayesRelaxed) {
                  quantOverride = true;
                  // Even more conservative: 40% of base bet, max 5% balance
                  overrideAmt = Math.max(1, Math.round(Math.min((curBetAmt || 5) * 0.4, curBalance * 0.05) * 2) / 2);
                  const bayesPct = Math.round((curPred.result==='UP'?b.probUp:b.probDown)*100);
                  overrideNote = ` | RELAXED OVERRIDE after ${ruleSkipCount} skips: Bayes ${bayesPct}%`;
                  botLog_add(`⚡ RELAXED OVERRIDE — ${ruleSkipCount} rule-skip streak, Bayes ${bayesPct}% ${curPred.result} agrees → betting cautiously $${overrideAmt}`, 'bet');
                }
              }
            } catch(e) { /* non-fatal */ }
          }

          if (!quantOverride) {
            const skipFactors = curPred?.factors?.filter(f => !f.pass).map(f => `${f.name}: ${f.tip}`).join(' | ') || '';
            const baseReason = !curPred ? 'No signal' : curPred.result === 'NO BET' ? curPred.reason : `${curPred.score}/${minScore} confluences — need ${minScore}+`;
            const streakNote = ruleSkipCount >= 4 ? ` [skip #${ruleSkipCount}]` : '';
            botLog_add(`⏭ RULE SKIP — ${baseReason}${skipFactors ? '. Fix: ' + skipFactors : ''}${streakNote}`, 'skip');
            setSkippedCount(n => n + 1);
            setSessionStats(s => ({ ...s, skipReasons: { ...s.skipReasons, rule: s.skipReasons.rule + 1 } }));
            setBotStatus('watching');
            return;
          }
          // Quant override path — place the bet directly (skip main quant block below)
          autoRef.current.consecutiveRuleSkips = 0;
          setBotStatus('betting');
          const overrideBet = botPlaceBet(curPred, overrideAmt, curPrice, curThresh);
          if (overrideBet) botLog_add(`🎯 BET ${curPred.result} @ ${overrideBet.odds}¢ — conf ${curPred.conf}% (${curPred.score}/5) — $${overrideAmt}${overrideNote}`, 'bet');
          return; // done for this round
        }
        // Reset skip streak counter when rule passes
        autoRef.current.consecutiveRuleSkips = 0;

        // ── [1] Quant Engine: Bayesian + LMSR evaluation ───────────────────
        let finalAmt = baseAmt;
        let quantNote = '';
        try {
          const quant = runQuantEngine({
            signalResult: curPred,
            tfData: curTf,
            price: curPrice,
            whaleSentiment: curWhale,
            oddsHistory: curOddsHist,
            spreadData: curSpread,
            upOdds: curUp,
            dnOdds: curDn,
            liquidityUSDC: 100000,
            balance: curBalance,
            historicalBets: betHistory.length,
            options: { kellyFrac: 0.25, minEV: 0.04 },
          });

          // [2] Bayesian veto — Bayes strongly disagrees with rule direction
          if (quant?.combined?.strength === 'VETO') {
            const b = quant.bayesian;
            const vetoCount = (autoRef.current.consecutiveVetos || 0) + 1;
            autoRef.current.consecutiveVetos = vetoCount;

            // ── BAYES FLIP OVERRIDE ──────────────────────────────────────────
            const flipThreshold = vetoCount >= 4 ? 0.75 : 0.85;
            const ruleDir  = curPred?.result;
            const bayesDir = b?.probDown >= flipThreshold ? 'DOWN' : b?.probUp >= flipThreshold ? 'UP' : null;
            const isOpposite = bayesDir && ruleDir && bayesDir !== ruleDir;
            const lmsrAgreesBayes = quant?.lmsr?.bestSide === bayesDir || !quant?.lmsr?.bestSide;

            if (isOpposite && lmsrAgreesBayes && b) {
              const flipConf = Math.round(Math.abs((bayesDir === 'DOWN' ? b.probDown : b.probUp) - 0.5) * 200);
              const flipPred = { ...curPred, result: bayesDir, conf: flipConf };
              // Fix 3: DOWN bets capped at 50% size, max 5% balance
              let flipAmt = Math.max(1, Math.round(Math.min(
                (curBetAmt || 5) * 0.5, curBalance * 0.06
              ) * 2) / 2);
              if (bayesDir === 'DOWN') flipAmt = Math.max(1, Math.round(Math.min(flipAmt * 0.5, curBalance * 0.05) * 2) / 2);
              const bayesPct = Math.round((bayesDir === 'DOWN' ? b.probDown : b.probUp) * 100);
              botLog_add(`🔄 BAYES FLIP — rule→${ruleDir} but Bayes ${bayesPct}%${bayesDir} (${vetoCount} veto streak, threshold ${Math.round(flipThreshold*100)}%) → flipping to ${bayesDir} $${flipAmt}`, 'bet');
              setBotStatus('betting');
              const flipBet = botPlaceBet(flipPred, flipAmt, curPrice, curThresh);
              if (flipBet) botLog_add(`🎯 BET ${bayesDir} @ ${flipBet.odds}¢ — Bayes-flip conf ${flipConf}% — $${flipAmt}`, 'bet');
              autoRef.current.consecutiveVetos = 0;
              return;
            }

            const streakWarn = vetoCount >= 4 ? ` ⚠️ ${vetoCount}-round veto streak — market may be trending ${b?.probDown > 0.5 ? 'DOWN' : 'UP'}` : '';
            botLog_add(`🧠 BAYES VETO — ${quant.combined.reason}${streakWarn}`, 'skip');
            setSkippedCount(n => n + 1);
            setSessionStats(s => ({ ...s, skipReasons: { ...s.skipReasons, bayes: s.skipReasons.bayes + 1 } }));
            setBotStatus('watching');
            return;
          }
          autoRef.current.consecutiveVetos = 0;

          // [2] LMSR edge gate
          if (curUp > 0 && curDn > 0 && quant?.lmsr && !quant.lmsr.tradeable && quant.lmsr.inefficiency?.quality === 'NONE') {
            botLog_add(`📐 LMSR SKIP — no market edge (model ≈ market price)`, 'skip');
            setSkippedCount(n => n + 1);
            setSessionStats(s => ({ ...s, skipReasons: { ...s.skipReasons, lmsr: s.skipReasons.lmsr + 1 } }));
            setBotStatus('watching');
            return;
          }

          // [3] Kelly sizing — prior-blended, max 10% balance
          if (cfg.useKelly && quant?.decision?.size > 0) {
            finalAmt = Math.min(quant.decision.size, curBalance * 0.10);
            finalAmt = Math.max(1, Math.round(finalAmt * 2) / 2);
            const blendNote = betHistory.length < 30 ? ` [prior-blend ${betHistory.length}bets]` : '';
            quantNote = ` | Kelly $${finalAmt} | EV:+${quant.decision.ev?.evPct}¢${blendNote}`;
          }

          // Fix 3: DOWN direction — cap at 50% of calculated size until we have DOWN accuracy data
          // Currently 0/2 on DOWN bets; don't size them the same as UP until proven
          if (curPred.result === 'DOWN') {
            const downBets = betHistory.filter(b => b.dir === 'DOWN' || b.direction === 'DOWN');
            const downWins = downBets.filter(b => b.correct).length;
            const downWR = downBets.length >= 5 ? downWins / downBets.length : null;
            // Cap DOWN at 50% unless we have 5+ DOWN bets with ≥55% win rate
            if (!downWR || downWR < 0.55) {
              const prevAmt = finalAmt;
              finalAmt = Math.max(1, Math.round((finalAmt * 0.5) * 2) / 2);
              if (prevAmt !== finalAmt) quantNote += ` | ↓50% DOWN cap (${downBets.length} DOWN bets, WR:${downWR ? Math.round(downWR*100)+'%' : 'N/A'})`;
            }
          }

          // Log Bayesian reading
          if (quant?.bayesian) {
            const b = quant.bayesian;
            botLog_add(`🧠 Bayes: ${(b.probUp*100).toFixed(0)}% UP / ${(b.probDown*100).toFixed(0)}% DOWN (${b.updateCount} signals, logOdds:${b.logOdds})`, 'info');
          }
        } catch(e) {
          console.warn('[Bot] Quant engine error:', e.message);
        }

        // ── Place bet ──────────────────────────────────────────────────────
        setBotStatus('betting');
        const bet = botPlaceBet(curPred, finalAmt, curPrice, curThresh);
        if (bet) {
          botLog_add(`🎯 BET ${curPred.result} @ ${bet.odds}¢ — conf ${curPred.conf}% (${curPred.score}/5) — $${finalAmt}${quantNote}`, 'bet');
        }
      }

      // ── At round end (1–5s grace): auto-resolve ──────────────────────────
      if (secs <= 5 && secs >= 1) {
        const pending = ref.pendingBet;
        if (pending && pending.auto) {
          setBotStatus('resolving');
          const exitPrice = ref.price;
          const thresh = parseFloat(pending.threshold) || parseFloat(ref.threshold);
          const won = thresh > 0
            ? (pending.direction === 'UP' ? exitPrice > thresh : exitPrice < thresh)
            : (pending.direction === 'UP' ? exitPrice > pending.entryPrice : exitPrice < pending.entryPrice);
          botResolveBet(pending, exitPrice);
          const pnl = won ? +(pending.payout - pending.amount).toFixed(2) : -pending.amount;

          // [3] Update consecutive loss counter
          if (won) {
            ref.consecLosses = 0;
          } else {
            ref.consecLosses += 1;
            if (ref.consecLosses >= (ref.botCfg?.maxConsecLosses || 3)) {
              ref.paused = true;
              botLog_add(`⚠️ ${ref.consecLosses} consecutive losses — pausing 1 round (circuit breaker)`, 'warn');
            }
          }

          // [9] Session stats update
          setSessionStats(s => ({
            ...s,
            wins: won ? s.wins + 1 : s.wins,
            losses: won ? s.losses : s.losses + 1,
          }));

          botLog_add(
            `${won ? '✅ WIN' : '❌ LOSS'} — ${pending.direction} @ $${exitPrice?.toFixed(0)} vs $${thresh?.toFixed(0)} | P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | streak: ${won ? '0L' : ref.consecLosses + 'L'}`,
            won ? 'win' : 'loss'
          );
          setTimeout(() => setBotStatus('watching'), 2000);
        }
      }
    }, 1000);

    return () => { clearInterval(tick); setBotStatus('idle'); autoRef.current.lastStopTime = Date.now(); };
  }, [autoBot, botPlaceBet, botResolveBet, fetchData]);

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
    const pnl = won ? +(bet.payout - bet.amount).toFixed(2) : -bet.amount;
    const newBal = +(balance + (won ? pnl : 0)).toFixed(2);
    if (won) setBalance(b => +(b + bet.payout).toFixed(2));
    // Balance history for P&L curve
    setBalanceHistory(h => [...h, { time: new Date().toLocaleTimeString(), balance: newBal, pnl, won }].slice(-200));
    if (bet.features) {
      const oldWeights = {...weights};
      const nw = updateWeights(weights, bet.features, won);
      setWeights(nw);
      // Per-signal accuracy tracking
      setSignalAccuracy(sa => {
        const updated = {...sa};
        Object.keys(bet.features).forEach(sig => {
          if (!updated[sig]) updated[sig] = {total:0, correct:0};
          updated[sig].total++;
          if (won) updated[sig].correct++;
        });
        return updated;
      });
      // Weight trajectory snapshot
      const wDeltas = {};
      Object.keys(nw).forEach(k => { const d = +(nw[k] - (oldWeights[k]||1)).toFixed(3); if (Math.abs(d) > 0.001) wDeltas[k] = d; });
      setWeightHistory(h => [...h, { ts: Date.now(), weights: {...nw} }].slice(-20));
      const regime = getMacro(tfData);
      setAiLog(p => [{ time: new Date().toLocaleTimeString(), won, direction: bet.direction, conf: bet.conf, odds: bet.odds, pnl, regime, weightDeltas: wDeltas, note: won?'✅ Weights reinforced':'🔄 Weights adjusted' }, ...p.slice(0,19)]);
    }
    setBetHistory(p => { return [...p, { correct:won, pnl, auto:false, ts:Date.now(), bal:newBal, conf:bet.conf, direction:bet.direction, odds:bet.odds, features:bet.features }]; });
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
      <header style={{ display:'flex', flexWrap:'wrap', alignItems:'center', justifyContent:'space-between', gap:12, padding:'12px 16px', borderBottom:'1px solid rgba(255,255,255,.06)', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div className="paw" style={{ width:38, height:38, borderRadius:'50%', background:'linear-gradient(135deg,#f2994a,#38d4b3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:800 }}>🐾</div>
          <div>
            <div style={{ fontFamily:"'Sora'", fontSize:16, fontWeight:700, lineHeight:1 }}>
              <span style={{ background:'linear-gradient(90deg,#f2994a,#38d4b3)', WebkitBackgroundClip:'text', color:'transparent' }}>BabyDoge BTC Oracle</span>
              <span style={{ fontSize:10, color:'#5b6072', marginLeft:6 }}>v4</span>
            </div>
            <div style={{ fontSize:9, color:'#5b6072', letterSpacing:1 }}>Bayesian • microstructure • execution lab</div>
          </div>
        </div>

        {/* Tabs */}
        <nav className="glass-panel" style={{ display:'flex', gap:12, padding:'8px 16px', alignItems:'center' }}>
          {[['terminal','TERMINAL'],['lab','AI LAB & RULES']].map(([id,l])=>(
            <button key={id} className={`nav-btn ${activeTab===id?'active':''}`} onClick={()=>setActiveTab(id)}>
              {l}
            </button>
          ))}
        </nav>

        {/* Price + WS status + Fetch */}
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          {market && market.label !== 'LOADING' && (
            <div style={{ padding:'4px 10px', borderRadius:12, background:market.label==='BULLISH'?'rgba(0,255,148,.12)':market.label==='BEARISH'?'rgba(255,75,43,.12)':'rgba(242,153,74,.12)', fontSize:10, color:market.label==='BULLISH'?'#00ff94':market.label==='BEARISH'?'#ff4b2b':'#f2994a', fontWeight:700 }}>
              {market.label}
            </div>
          )}
          {price && (
            <div style={{ textAlign:'right' }}>
              <div style={{ fontFamily:"'Sora'", fontSize:18, fontWeight:700, color:priceDir==='up'?'#00ff94':priceDir==='down'?'#ff4b2b':'#e8e8f2', lineHeight:1 }}>${fmt(price)}</div>
              <div style={{ fontSize:9, color:change24h>=0?'#00ff94':'#ff4b2b', fontWeight:700 }}>{change24h>=0?'▲':'▼'} {Math.abs(change24h)}%</div>
            </div>
          )}
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div className={wsLive?'live-dot':'dead-dot'} title={wsLive?'Live WS':'Polling'} />
            <span style={{ fontSize:8, color:'#5b6072' }}>{wsLive?'LIVE':'POLL'}</span>
          </div>
          <div>
            <button className="btn" onClick={fetchData} disabled={loading}
              style={{ background:'linear-gradient(135deg,#f2994a,#ff7a00)', color:'#0a0b10', fontSize:11, padding:'8px 14px' }}>
              {loading?<span className="spin">🐾</span>:'↻'} {loading?'Fetching...':'Fetch Data'}
            </button>
            <div style={{ fontSize:8, color:'#5b6072', marginTop:3, textAlign:'right' }}>
              {apiErrors.length>0 ? <span style={{color:'#ff4b2b'}}>⚠ {apiErrors.join(', ')} failed</span> : lastUpdate ? `✓ ${lastUpdate} • ${refreshIn}s` : 'Click to load'}
            </div>
          </div>
        </div>
      </header>

      <main className="scroll" style={{ flex:1, overflow:'auto' }}>

      {/* ══════════════════════════════════════════════════════
          TERMINAL PAGE
      ══════════════════════════════════════════════════════ */}
      {activeTab==='terminal' && (
        <div className="dash-grid" style={{ flex:1 }}>

          {/* ── LEFT: Polymarket + Paper Bet ── */}
          <section className="dash-col scroll" style={{ gridColumn:'span 4', display:'flex', flexDirection:'column', gap:14 }}>

            {/* Polymarket Panel */}
            <div className="card" style={{ padding:11 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                <div style={{ fontFamily:"'Fredoka One'", color:'#ff6d00', fontSize:13 }}>🎯 Polymarket Odds</div>
                <div style={{ display:'flex', gap:4 }}>
                  <button className="btn" onClick={fetchPoly}
                    style={{ background:'linear-gradient(135deg,#ff6d00,#ff9d00)', color:'white', border:'none', fontSize:9, padding:'4px 10px' }}
                    title="Pulls Polymarket odds via backend proxy">
                    ⚡ Auto
                  </button>
                </div>
              </div>

              {/* Status / instructions */}
              {polyStatus ? (
                <div style={{ fontSize:9, color:polyStatus.includes('✅')||polyStatus.includes('📊')?'#00e5aa':polyStatus.includes('⚠')?'#ff9d00':'#ffd700', marginBottom:7, fontWeight:700, padding:'4px 7px', background:'rgba(255,255,255,.03)', borderRadius:5 }}>{polyStatus}</div>
              ) : (
                <div style={{ fontSize:9, color:'#303060', marginBottom:7, lineHeight:1.6, padding:'5px 7px', background:'#050510', borderRadius:6, border:'1px solid #0f0f28' }}>
                  <span style={{color:'#00e5aa',fontWeight:800}}>⚡ Auto</span> pulls Polymarket odds via backend proxy<br/>
                  <span style={{color:'#303060'}}>If unavailable, enter odds manually below.</span>
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
                    background: thresholdSource==='real'?'rgba(0,229,170,.1)':'rgba(255,255,255,.04)',
                    color: thresholdSource==='real'?'#00e5aa':'#3a3a6a',
                    border: `1px solid ${thresholdSource==='real'?'#00e5aa33':'#1a1a38'}` }}>
                    {thresholdSource==='real'?'✅ Real Polymarket threshold':'✏️ Manual entry'}
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
          </section>

          {/* ── CENTER: TF Grid + Quick Chart ── */}
          <section className="dash-col" style={{ gridColumn:'span 5', display:'flex', flexDirection:'column', gap:14, overflow:'hidden', minHeight:0 }}>
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
          </section>

          {/* ── RIGHT: Scorecard + Prediction + AI Pred + Skip ── */}
          <section className="dash-col scroll" style={{ gridColumn:'span 3', display:'flex', flexDirection:'column', gap:14 }}>

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
                  {pred?.result && pred.result !== '---' ? (
                    <>
                      <div style={{ fontSize:10, color:'#252550', marginBottom:6, lineHeight:1.5 }}>
                        Confluence not scored this round
                      </div>
                      <div style={{ fontSize:10, color:'#ff9d00', fontWeight:700, lineHeight:1.6 }}>
                        {pred.reason}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize:10, color:'#252550', marginBottom:8, lineHeight:1.6 }}>
                      Need Polymarket odds to score<br/>
                      <span style={{ color:'#ff9d00' }}>→ Auto fetch or enter manually above</span>
                    </div>
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
                    Step 2: <span style={{color:'#ff9d00',fontWeight:800}}>⚡ Auto</span> pulls odds (or enter manually)<br/>
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

            {/* ── QUANT ENGINE: Bayesian + LMSR ── */}
            <QuantPanel
              signalResult={pred}
              tfData={tfData}
              price={price}
              whaleSentiment={whaleSentiment}
              oddsHistory={oddsHistory}
              spreadData={spreadData}
              upOdds={parseFloat(upOdds) || 0}
              dnOdds={parseFloat(dnOdds) || 0}
              liquidityUSDC={polyRound?.volume || 100000}
              balance={balance}
            />
          </section>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          CHART TAB — Full Candlestick
      ══════════════════════════════════════════════════════ */}
      {activeTab==='terminal' && (
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
      {activeTab==='terminal' && (
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minHeight:0 }}>
          <div style={{ flex:1, padding:10, display:'grid', gridTemplateColumns:'280px 1fr', gap:8, overflow:'hidden', minHeight:0 }}>

              {/* ── LEFT: Controls ── */}
              <div style={{ display:'flex', flexDirection:'column', gap:7, overflow:'hidden' }}>

                {/* Sample gate banner */}
              {!isCalibrated && (
                <div style={{ padding:'8px 12px', borderRadius:9, border:'1px solid #ffd70033', background:'rgba(255,213,0,.05)', marginBottom:0 }}>
                  <div style={{ fontSize:9, color:'#ffd700', fontWeight:800, marginBottom:3 }}>⏳ WARMUP: {betHistory.length}/{CALIB_GATE} bets to calibration</div>
                  <div className="bar" style={{ height:5, marginBottom:4 }}>
                    <div className="bar-fill" style={{ width:`${(betHistory.length/CALIB_GATE)*100}%`, background:'linear-gradient(90deg,#ffd700,#ff9d00)', height:'100%' }}/>
                  </div>
                  <div style={{ fontSize:8, color:'#3a3a6a' }}>Confidence deflated ×0.85 · weights near defaults · conservative sizing</div>
                </div>
              )}

              {/* Main on/off */}
                <div className="card" style={{ padding:14, border:`2px solid ${autoBot ? '#00e5aa' : '#131328'}`, boxShadow: autoBot ? '0 0 20px rgba(0,229,170,.15)' : 'none' }}>
                  <div style={{ fontFamily:"'Fredoka One'", color:'#ff6d00', fontSize:15, marginBottom:4 }}>🤖 Signal Auto-Bot</div>
                  <div style={{ fontSize:10, color:'#3a3a6a', marginBottom:12, lineHeight:1.6 }}>
                    Places + resolves paper bets every 5-min round. Evaluates signal 45s before round end.
                  </div>

                  <button onClick={() => { if(!autoBot){ setSkippedCount(0); } setAutoBot(a => !a); }}
                    style={{ width:'100%', padding:'14px', borderRadius:12, border:'none', cursor:'pointer', fontFamily:"'Fredoka One'", fontSize:18, letterSpacing:1,
                      background: autoBot ? 'linear-gradient(135deg,#00e5aa,#009970)' : 'linear-gradient(135deg,#1a1a3a,#0f0f28)',
                      color: autoBot ? '#050510' : '#252560',
                      boxShadow: autoBot ? '0 0 20px rgba(0,229,170,.3)' : 'none',
                      transition:'all .3s', marginBottom:10 }}>
                    {autoBot ? '⏹ STOP BOT' : '▶ START BOT'}
                  </button>

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
                  {/* Bet size + Kelly toggle */}
                  <div style={{ display:'flex', gap:6, marginBottom:8, alignItems:'flex-end' }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:8, color:'#202045', fontWeight:800, letterSpacing:1, marginBottom:3 }}>BASE BET ($)</div>
                      <input className="inp" type="number" value={betAmt} onChange={e=>setBetAmt(e.target.value)} placeholder="5" disabled={autoBot} style={{ fontSize:12 }}/>
                    </div>
                    <div onClick={()=>!autoBot&&setBotCfg(c=>({...c,useKelly:!c.useKelly}))}
                      style={{ padding:'7px 10px', borderRadius:7, border:`1px solid ${botCfg.useKelly?'#c44dff':'#1a1a38'}`, background:botCfg.useKelly?'rgba(196,77,255,.12)':'#050510', cursor:autoBot?'not-allowed':'pointer', opacity:autoBot?.5:1, whiteSpace:'nowrap' }}>
                      <div style={{ fontSize:7, color:'#252550', fontWeight:800 }}>KELLY</div>
                      <div style={{ fontSize:10, color:botCfg.useKelly?'#c44dff':'#3a3a6a', fontWeight:800 }}>{botCfg.useKelly?'ON':'OFF'}</div>
                    </div>
                  </div>
                  {/* Min score + min conf */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:8 }}>
                    <div>
                      <div style={{ fontSize:8, color:'#202045', fontWeight:800, letterSpacing:1, marginBottom:3 }}>MIN SCORE</div>
                      <select className="inp" value={botCfg.minScore} onChange={e=>!autoBot&&setBotCfg(c=>({...c,minScore:+e.target.value}))} disabled={autoBot} style={{ fontSize:11 }}>
                        {[2,3,4,5].map(v=><option key={v} value={v}>{v}/5</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize:8, color:'#202045', fontWeight:800, letterSpacing:1, marginBottom:3 }}>MIN CONF %</div>
                      <select className="inp" value={botCfg.minConf} onChange={e=>!autoBot&&setBotCfg(c=>({...c,minConf:+e.target.value}))} disabled={autoBot} style={{ fontSize:11 }}>
                        {[50,55,58,60,62,65].map(v=><option key={v} value={v}>{v}%</option>)}
                      </select>
                    </div>
                  </div>
                  {/* Circuit breaker + stop-loss + profit target */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, marginBottom:8 }}>
                    <div>
                      <div style={{ fontSize:7, color:'#202045', fontWeight:800, letterSpacing:1, marginBottom:3 }}>MAX LOSSES</div>
                      <select className="inp" value={botCfg.maxConsecLosses} onChange={e=>!autoBot&&setBotCfg(c=>({...c,maxConsecLosses:+e.target.value}))} disabled={autoBot} style={{ fontSize:11 }}>
                        {[2,3,4,5,99].map(v=><option key={v} value={v}>{v===99?'∞':v}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize:7, color:'#202045', fontWeight:800, letterSpacing:1, marginBottom:3 }}>STOP LOSS</div>
                      <select className="inp" value={botCfg.stopLoss} onChange={e=>!autoBot&&setBotCfg(c=>({...c,stopLoss:+e.target.value}))} disabled={autoBot} style={{ fontSize:11 }}>
                        {[10,15,20,25,30,50,999].map(v=><option key={v} value={v}>{v===999?'∞':`$${v}`}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize:7, color:'#202045', fontWeight:800, letterSpacing:1, marginBottom:3 }}>TARGET</div>
                      <select className="inp" value={botCfg.profitTarget} onChange={e=>!autoBot&&setBotCfg(c=>({...c,profitTarget:+e.target.value}))} disabled={autoBot} style={{ fontSize:11 }}>
                        {[15,20,25,30,40,50,999].map(v=><option key={v} value={v}>{v===999?'∞':`+$${v}`}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ fontSize:8, color:'#3a3a6a', lineHeight:1.8, borderTop:'1px solid #0d0d26', paddingTop:6 }}>
                    <div>🧠 Bayesian + LMSR veto active when Quant Engine loaded</div>
                    <div>⚡ Kelly auto-sizes each bet by EV + conviction</div>
                    <div>🛑 Circuit breaker pauses 1 round after N losses</div>
                  </div>
                </div>

                {/* Current signal snapshot */}
                <div className="card" style={{ padding:12 }}>
                  <div style={{ fontFamily:"'Fredoka One'", color:'#c44dff', fontSize:13, marginBottom:8 }}>📡 Live Signal Preview</div>
                  {pred?.result && pred.result !== '---' ? (() => {
                    const wouldBet = ['UP','DOWN'].includes(pred.result) && pred.score >= (botCfg.minScore||3) && pred.conf >= (botCfg.minConf||55);
                    const dirCol = pred.result==='UP'?'#00e5aa':pred.result==='DOWN'?'#ff3366':'#ffd700';
                    return (
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
                          <div style={{ fontFamily:"'Fredoka One'", fontSize:26, color:dirCol }}>{pred.result}</div>
                          <div style={{ flex:1 }}>
                            <div style={{ fontSize:8, color:'#252550', fontWeight:800 }}>CONF · SCORE</div>
                            <div style={{ fontFamily:"'Fredoka One'", fontSize:15, color:'#e0e0ff' }}>{pred.conf}% · {pred.score}/5</div>
                          </div>
                          {wouldBet && botCfg.useKelly && (() => {
                            // Fix 2: real Kelly estimate from EV, not balance*0.035
                            try {
                              const qPrev = runQuantEngine({ signalResult:pred, tfData, price, whaleSentiment, oddsHistory, spreadData, upOdds:parseFloat(upOdds)||0, dnOdds:parseFloat(dnOdds)||0, liquidityUSDC:100000, balance, options:{kellyFrac:0.25,minEV:0.04} });
                              const sz = qPrev?.decision?.size > 0 ? Math.max(1, Math.round(Math.min(qPrev.decision.size, balance*0.12) * 2)/2) : null;
                              return sz ? (
                                <div style={{ textAlign:'center' }}>
                                  <div style={{ fontSize:7, color:'#252550', fontWeight:800 }}>KELLY</div>
                                  <div style={{ fontSize:11, color:'#c44dff', fontWeight:800 }}>${sz}</div>
                                </div>
                              ) : null;
                            } catch { return null; }
                          })()}
                        </div>
                        <div style={{ fontSize:9, color:'#3a3a6a', lineHeight:1.5, marginBottom:6 }}>{pred.reason}</div>
                        {/* Gating checks */}
                        <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:6 }}>
                          {[
                            [`Score ${pred.score}≥${botCfg.minScore||3}`, pred.score>=(botCfg.minScore||3)],
                            [`Conf ${pred.conf}%≥${botCfg.minConf||55}%`, pred.conf>=(botCfg.minConf||55)],
                            ['Direction', ['UP','DOWN'].includes(pred.result)],
                          ].map(([lbl,pass])=>(
                            <span key={lbl} style={{ fontSize:8, padding:'2px 6px', borderRadius:10, background:pass?'rgba(0,229,170,.1)':'rgba(255,51,102,.08)', color:pass?'#00e5aa':'#ff3366', fontWeight:800 }}>
                              {pass?'✓':'✗'} {lbl}
                            </span>
                          ))}
                        </div>
                        <div style={{ padding:'6px 9px', borderRadius:7, border:`1px solid ${wouldBet?'rgba(0,229,170,.2)':'rgba(255,213,0,.12)'}`, background:wouldBet?'rgba(0,229,170,.06)':'rgba(255,213,0,.04)', fontSize:9, color:wouldBet?'#00e5aa':'#ffd700', fontWeight:800 }}>
                          {wouldBet ? `✅ BET ${pred.result} — passes all gate checks` : '⏭ RULE SKIP — Quant override possible if Bayes≥80% + LMSR'}
                        </div>
                      </div>
                    );
                  })() : (
                    <div style={{ textAlign:'center', color:'#252550', fontSize:10, padding:10 }}>
                      Set up odds on Dashboard first
                    </div>
                  )}
                </div>

                {/* Stats */}
                <div className="card" style={{ padding:12 }}>
                  <div style={{ fontFamily:"'Fredoka One'", color:'#ff9d00', fontSize:13, marginBottom:8 }}>📊 Session Stats</div>
                  {/* Main 2x3 grid */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:5, marginBottom:8 }}>
                    {(() => {
                      const sessBets = sessionStats.wins + sessionStats.losses;
                      const sessWR = sessBets ? Math.round(sessionStats.wins/sessBets*100) : 0;
                      const sessPnL = balance - sessionStats.startBal;
                      const autoBets = betHistory.filter(b=>b.auto).length;
                      const autoWR = autoBets ? Math.round(betHistory.filter(b=>b.auto&&b.correct).length/autoBets*100) : 0;
                      return [
                        ['BAL', `$${balance.toFixed(2)}`, '#ffd700'],
                        ['SESSION P&L', `${sessPnL>=0?'+':''}$${sessPnL.toFixed(2)}`, sessPnL>=0?'#00e5aa':'#ff3366'],
                        ['SESS W%', sessBets?`${sessWR}%`:'—', sessWR>=55?'#00e5aa':sessBets?'#ff3366':'#3a3a6a'],
                        ['TOT BETS', autoBets, '#c44dff'],
                        ['TOT W%', autoBets?`${autoWR}%`:'—', autoWR>=55?'#00e5aa':autoBets?'#ff3366':'#3a3a6a'],
                        ['CONSEC L', autoRef.current.consecLosses||0, (autoRef.current.consecLosses||0)>=(botCfg.maxConsecLosses||3)?'#ff3366':'#ffd700'],
                      ].map(([l,v,c])=>(
                        <div key={l} style={{ background:'#050510', borderRadius:7, padding:'6px', textAlign:'center' }}>
                          <div style={{ fontSize:7, color:'#252550', fontWeight:800, letterSpacing:.5 }}>{l}</div>
                          <div style={{ fontFamily:"'Fredoka One'", fontSize:14, color:c, marginTop:1 }}>{v}</div>
                        </div>
                      ));
                    })()}
                  </div>
                  {/* Skip reason breakdown */}
                  {skippedCount > 0 && (
                    <div style={{ borderTop:'1px solid #0d0d26', paddingTop:7 }}>
                      <div style={{ fontSize:8, color:'#252550', fontWeight:800, letterSpacing:1, marginBottom:5 }}>SKIP BREAKDOWN</div>
                      <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                        {Object.entries(sessionStats.skipReasons).filter(([,v])=>v>0).map(([k,v])=>(
                          <span key={k} style={{ fontSize:8, padding:'2px 7px', borderRadius:10, background:'#0a0a1a', color:'#3a3a6a', fontWeight:800 }}>
                            {k==='rule'?'📊':k==='bayes'?'🧠':k==='lmsr'?'📐':k==='balance'?'💸':'⏸'} {k}: {v}
                          </span>
                        ))}
                        <span style={{ fontSize:8, padding:'2px 7px', borderRadius:10, background:'#0a0a1a', color:'#3a3a6a', fontWeight:800 }}>total: {skippedCount}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── RIGHT: Bot Log ── */}
              <div className="card" style={{ padding:13, display:'flex', flexDirection:'column', overflow:'hidden' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, flexShrink:0 }}>
                  <div style={{ fontFamily:"'Fredoka One'", color:'#ff6d00', fontSize:14 }}>📋 Bot Activity Log <span style={{fontSize:10,color:'#252550'}}>({botLog.length})</span></div>
                  <div style={{ display:'flex', gap:5 }}>
                    <button onClick={()=>{
                      const lines = botLog.map(e=>`[${e.time}] ${e.msg}`).join('\n');
                      const a = document.createElement('a');
                      a.href = 'data:text/plain;charset=utf-8,'+encodeURIComponent(lines);
                      a.download = `bot-log-${new Date().toISOString().slice(0,10)}.txt`;
                      a.click();
                    }} style={{ background:'#0c0c22', color:'#252560', border:'1px solid #131328', borderRadius:6, padding:'3px 10px', fontSize:9, cursor:'pointer', fontFamily:"'Fredoka One'" }}>💾 Export</button>
                    <button onClick={()=>setBotLog([])} style={{ background:'#0c0c22', color:'#252560', border:'1px solid #131328', borderRadius:6, padding:'3px 10px', fontSize:9, cursor:'pointer', fontFamily:"'Fredoka One'" }}>Clear</button>
                  </div>
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
                      {roundTimer > 90 ? (
                        pred?.result && ['UP','DOWN'].includes(pred.result)
                          ? <span>👁 Watching — signal: <span style={{color:pred.result==='UP'?'#00e5aa':'#ff3366',fontWeight:800}}>{pred.result}</span> {pred.conf}% ({pred.score}/5)</span>
                          : <span>👁 Watching — no signal yet</span>
                      ) : roundTimer > 65 ? '⚡ Fetching data — 25s buffer for signal to settle...'
                        : roundTimer > 5  ? '🎯 Evaluating + Bayesian gate — bet placed or skipped'
                        : '🔔 Resolving round + updating AI weights...'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          WHALES TAB
      ══════════════════════════════════════════════════════ */}
      {activeTab==='terminal' && (
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
      {activeTab==='lab' && (
        <div style={{ flex:1, padding:8, display:'flex', flexDirection:'column', gap:7, overflow:'hidden', minHeight:0 }}>

          {/* ── ROW 1: Stats bar ── */}
          <div className="card" style={{ padding:'10px 14px', flexShrink:0, display:'flex', alignItems:'center', gap:8, justifyContent:'space-between', flexWrap:'wrap' }}>
            <div style={{ fontFamily:"'Fredoka One'", color:'#c44dff', fontSize:14 }}>🧠 AI Learning Engine <span style={{ fontSize:9, color:'#00e5aa', fontWeight:800, background:'rgba(0,229,170,.08)', padding:'2px 7px', borderRadius:10, marginLeft:4 }}>💾 Auto-saved</span></div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {(() => {
                const autoBets = betHistory.filter(b=>b.auto);
                const autoWins = autoBets.filter(b=>b.correct).length;
                const autoWR   = autoBets.length ? Math.round(autoWins/autoBets.length*100) : 0;
                const streak   = (() => { let s=0; for(let i=betHistory.length-1;i>=0;i--){ if(betHistory[i].correct){ if(s>=0)s++; else break; } else { if(s<=0)s--; else break; } } return s; })();
                // Last-10 warning
                const last10 = betHistory.slice(-10);
                const last10WR = last10.length >= 5 ? Math.round(last10.filter(b=>b.correct).length/last10.length*100) : null;
                const warnLow = last10WR !== null && last10WR < 40;
                // Win rate color: red<50, yellow 50-55, green 55+
                const wrColor = winRate >= 55 ? '#00e5aa' : winRate >= 50 ? '#ffd700' : '#ff3366';
                const autoWRColor = autoWR >= 55 ? '#00e5aa' : autoWR >= 50 ? '#ffd700' : autoBets.length ? '#ff3366' : '#3a3a6a';
                // Balance vs starting 100
                const balLoss = ((balance - 100) / 100 * 100).toFixed(1);
                const balColor = balance >= 100 ? '#00e5aa' : balance >= 75 ? '#ffd700' : '#ff3366';
                return (
                  <>
                    {warnLow && (
                      <div style={{ width:'100%', padding:'4px 10px', background:'rgba(255,51,102,.1)', border:'1px solid #ff336633', borderRadius:7, fontSize:9, color:'#ff3366', fontWeight:800 }}>
                        ⚠️ Last 10 bets: {last10WR}% WR — consider pausing Auto-Bot for recalibration
                      </div>
                    )}
                    {[
                      ['TOTAL', betHistory.length, '#c44dff'],
                      ['WIN %', `${winRate}%`, wrColor],
                      ['BOT W%', autoBets.length?`${autoWR}%`:'—', autoWRColor],
                      ['P&L', `${totalPnL>=0?'+':''}$${totalPnL.toFixed(2)}`, totalPnL>=0?'#00e5aa':'#ff3366'],
                      ['BALANCE', `$${balance.toFixed(2)}`, balColor],
                    ].map(([l,v,col])=>(
                      <div key={l} style={{ background:'#050510', borderRadius:8, padding:'7px 12px', textAlign:'center', minWidth:56 }}>
                        <div style={{ fontSize:7, color:'#252550', fontWeight:800, letterSpacing:1 }}>{l}</div>
                        <div style={{ fontFamily:"'Fredoka One'", fontSize:15, color:col, marginTop:1 }}>{v}</div>
                        {l==='BALANCE' && balance < 100 && (
                          <div style={{ fontSize:7, color:'#ff3366', marginTop:1, fontWeight:800 }}>{balLoss}%</div>
                        )}
                      </div>
                    ))}
                    {/* Streak + mini sparkline dots (last 10 bets) */}
                    <div style={{ background:'#050510', borderRadius:8, padding:'7px 12px', textAlign:'center', minWidth:70 }}>
                      <div style={{ fontSize:7, color:'#252550', fontWeight:800, letterSpacing:1 }}>STREAK</div>
                      <div style={{ fontFamily:"'Fredoka One'", fontSize:15, color:streak>0?'#00e5aa':streak<0?'#ff3366':'#3a3a6a', marginTop:1 }}>
                        {streak===0?'—':streak>0?`+${streak}W`:`${Math.abs(streak)}L`}
                      </div>
                      {betHistory.length >= 2 && (
                        <div style={{ display:'flex', gap:2, justifyContent:'center', marginTop:3 }} title="Last 10 bets: green=W, red=L">
                          {betHistory.slice(-10).map((b,i) => (
                            <div key={i} style={{ width:5, height:5, borderRadius:'50%', background:b.correct?'#00e5aa':'#ff3366', flexShrink:0 }}/>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
            <div style={{ display:'flex', gap:6 }}>
              <button className="btn" onClick={()=>setWeights(DEFAULT_WEIGHTS)} style={{ background:'#08081e', color:'#252560', border:'1px solid #12122e', fontSize:9 }}>Reset Weights</button>
              <button className="btn" onClick={()=>{ if(!window.confirm('Wipe ALL saved data?')) return; ['bd_weights','bd_balance','bd_betHistory','bd_paperBets','bd_aiLog','bd_pendingBet','bd_botCfg','bd_balHist','bd_sigAcc','bd_wHist'].forEach(k=>localStorage.removeItem(k)); setWeights(DEFAULT_WEIGHTS); setBalance(100); setBetHistory([]); setPaperBets([]); setAiLog([]); setPendingBet(null); setBalanceHistory([]); setSignalAccuracy({}); setWeightHistory([]); }} style={{ background:'rgba(255,51,102,.08)', color:'#ff3366', border:'1px solid #ff336633', fontSize:9 }}>🗑 Wipe All Data</button>
              <button className="btn" onClick={()=>{
                const NL = String.fromCharCode(10);
                const header = 'Time,Direction,Conf,Score,PnL,Balance,Auto';
                const rows = betHistory.map((b,i)=>{
                  const ts = b.ts ? new Date(b.ts).toLocaleTimeString() : ('bet'+(i+1));
                  const cumBal = betHistory.slice(0,i+1).reduce((a,x)=>a+(x.pnl||0),100).toFixed(2);
                  const pnl = b.pnl != null ? b.pnl.toFixed(2) : '0';
                  return [ts, b.direction||'?', b.conf||0, b.score||0, pnl, b.bal||cumBal, b.auto?'yes':'no'].join(',');
                });
                const csv = [header, ...rows].join(NL);
                const a = document.createElement('a');
                a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
                a.download = 'ai-lab-' + new Date().toISOString().slice(0,10) + '.csv';
                a.click();
              }} style={{ background:'rgba(0,229,170,.06)', color:'#00e5aa', border:'1px solid #00e5aa22', fontSize:9 }}>💾 Export CSV</button>
            </div>
          </div>

          {/* ── ROW 2: P&L Curve — full width, fixed height ── */}
          <div className="card" style={{ padding:'10px 14px', flexShrink:0, height:160 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#ffd700', fontSize:13 }}>📊 P&L Curve</div>
              {betHistory.length > 0 && (
                <div style={{ display:'flex', gap:12, fontSize:8, color:'#3a3a6a' }}>
                  <span>▲ <span style={{color:'#00e5aa'}}>{betHistory.filter(b=>b.correct).length}W</span></span>
                  <span>▼ <span style={{color:'#ff3366'}}>{betHistory.filter(b=>!b.correct).length}L</span></span>
                  <span>peak: <span style={{color:'#ffd700'}}>${Math.max(100,...betHistory.map((_,i)=>100+betHistory.slice(0,i+1).reduce((a,x)=>a+x.pnl,0))).toFixed(2)}</span></span>
                </div>
              )}
            </div>
            {betHistory.length < 2 ? (
              <div style={{ height:110, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:4, color:'#252550', fontSize:10 }}>
                <div style={{fontSize:20}}>📈</div>
                <div>No bets resolved yet — place your first bet to see the curve</div>
              </div>
            ) : (() => {
              // Build curve from balanceHistory if available, else compute from betHistory
              const curveData = balanceHistory.length >= 2
                ? balanceHistory.map((h,i) => ({ i: i+1, bal: h.balance, ts: h.time?.slice(0,5) || `#${i+1}`, won: h.won }))
                : betHistory.map((b,i) => {
                    const cumBal = +(100 + betHistory.slice(0,i+1).reduce((a,x)=>a+x.pnl,0)).toFixed(2);
                    return { i:i+1, bal:cumBal, ts: b.ts?new Date(b.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):`#${i+1}`, won:b.correct };
                  });
              const minBal = Math.min(95, ...curveData.map(d=>d.bal));
              const maxBal = Math.max(105, ...curveData.map(d=>d.bal));
              const lineCol = curveData[curveData.length-1].bal >= 100 ? '#00e5aa' : '#ff3366';
              return (
                <ResponsiveContainer width="100%" height={110}>
                  <AreaChart data={curveData} margin={{top:4,right:4,bottom:0,left:0}}>
                    <defs>
                      <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={lineCol} stopOpacity={0.25}/>
                        <stop offset="95%" stopColor={lineCol} stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="ts" tick={{fontSize:7, fill:'#252550'}} interval={Math.max(0,Math.floor(curveData.length/8)-1)} tickLine={false} axisLine={false}/>
                    <YAxis domain={[minBal-1, maxBal+1]} tick={{fontSize:7, fill:'#252550'}} tickFormatter={v=>`$${v.toFixed(0)}`} tickLine={false} axisLine={false} width={32}/>
                    <Tooltip contentStyle={{background:'#0a0a1a',border:`1px solid ${lineCol}44`,borderRadius:6,fontSize:9}} formatter={(v,n,p)=>[`$${Number(v).toFixed(2)}`,p.payload?.won?'✅ WIN':'❌ LOSS']} labelFormatter={l=>`${l}`}/>
                    <ReferenceLine y={100} stroke="#ffd700" strokeDasharray="4 3" strokeOpacity={0.5} label={{value:'$100 start', fill:'#ffd70088', fontSize:7, position:'right'}}/>
                    <ReferenceLine y={0} stroke="#252550" strokeDasharray="3 3"/>
                    <Area type="monotone" dataKey="bal" stroke={lineCol} strokeWidth={2} fill="url(#pnlGrad)" dot={(props)=>{ const{cx,cy,payload}=props; return payload.won ? <circle key={cx} cx={cx} cy={cy} r={2.5} fill="#00e5aa" stroke="none"/> : <circle key={cx} cx={cx} cy={cy} r={2.5} fill="#ff3366" stroke="none"/>; }}/>
                  </AreaChart>
                </ResponsiveContainer>
              );
            })()}
          </div>

          {/* ── ROW 3: Weights | Learning Log | Bet History ── */}
          <div style={{ flex:1, display:'grid', gridTemplateColumns:'240px 1fr 1fr', gap:7, minHeight:0, overflow:'hidden' }}>

            {/* Weights + Signal Accuracy */}
            <div style={{ display:'flex', flexDirection:'column', gap:7, overflow:'hidden' }}>
            <div className="card" style={{ padding:12, overflow:'hidden', display:'flex', flexDirection:'column', minHeight:0, flex:'0 0 auto', maxHeight:'55%' }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#c44dff', fontSize:12, marginBottom:8, flexShrink:0 }}>⚖️ Live Weights</div>
              <div className="scroll" style={{ flex:1 }}>
                {Object.entries(weights).sort(([,a],[,b])=>b-a).map(([k,v])=>{
                  const relBets = betHistory.filter(b=>b.features && b.features[k] !== undefined);
                  const relWins = relBets.filter(b=>b.correct).length;
                  const accPct = relBets.length >= 3 ? Math.round(relWins/relBets.length*100) : null;
                  // Trajectory from weightHistory
                  const wTraj = weightHistory.map(h => h.weights?.[k]).filter(x => x !== undefined);
                  const trajDir = wTraj.length >= 3 ? (wTraj[wTraj.length-1] > wTraj[0] ? 'up' : wTraj[wTraj.length-1] < wTraj[0] ? 'down' : 'flat') : (v > 1.0 ? 'up' : v < 0.7 ? 'down' : 'flat');
                  const trendCol = trajDir==='up'?'#00e5aa':trajDir==='down'?'#ff3366':'#c44dff';
                  const trajBg = trajDir==='up'?'rgba(0,229,170,.05)':trajDir==='down'?'rgba(255,51,102,.05)':'transparent';
                  return (
                    <div key={k} style={{ marginBottom:8, padding:'5px 6px', borderRadius:7, background:trajBg, border:`1px solid ${trendCol}18` }}>
                      <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:3 }}>
                        <span style={{ fontSize:8, color:'#3a3a6a', fontWeight:700, flex:1 }}>{k}</span>
                        <span style={{ fontSize:9, fontWeight:800, color:trendCol }}>{v.toFixed(2)}</span>
                        <button onClick={()=>setWeights(w=>({...w,[k]:DEFAULT_WEIGHTS[k]||1}))}
                          title={`Reset ${k} to default`}
                          style={{ fontSize:7, padding:'1px 5px', borderRadius:5, border:`1px solid ${trendCol}44`, background:'transparent', color:trendCol, cursor:'pointer', opacity:.7 }}>↺</button>
                      </div>
                      <div className="bar" style={{ height:4, marginBottom:3 }}>
                        <div className="bar-fill" style={{ width:`${Math.min(100,(v/2)*100)}%`, background:trendCol, height:'100%', transition:'width .4s ease' }}/>
                      </div>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        {accPct !== null ? (
                          <div style={{ fontSize:7, color: accPct>=55?'#00e5aa':accPct>=45?'#ffd700':'#ff3366' }}>
                            {relBets.length}bets·{accPct}%acc
                          </div>
                        ) : <div/>}
                        {/* Mini sparkline of weight history */}
                        {wTraj.length >= 3 && (() => {
                          const W=50, H=12, last=wTraj.slice(-10);
                          const mn=Math.min(...last), mx=Math.max(...last), rng=mx-mn||0.01;
                          const pts=last.map((w,i)=>`${(i/(last.length-1))*W},${H-(((w-mn)/rng)*(H-2)+1)}`).join(' ');
                          return (
                            <svg width={W} height={H} style={{display:'block'}}>
                              <polyline points={pts} fill="none" stroke={trendCol} strokeWidth={1.2} opacity={0.8}/>
                              <circle cx={(last.length-1)/(last.length-1)*W} cy={H-(((last[last.length-1]-mn)/rng)*(H-2)+1)} r={2} fill={trendCol}/>
                            </svg>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Signal Accuracy Table */}
            {Object.keys(signalAccuracy).length > 0 && (
              <div className="card" style={{ padding:11, flex:'1 1 0', overflow:'hidden', display:'flex', flexDirection:'column' }}>
                <div style={{ fontFamily:"'Fredoka One'", color:'#ffd700', fontSize:11, marginBottom:7, flexShrink:0 }}>🎯 Signal Accuracy</div>
                <div className="scroll" style={{ flex:1 }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:8 }}>
                    <thead>
                      <tr>{['Signal','Preds','Correct','Acc%'].map(h=>(
                        <th key={h} style={{ textAlign:'left', color:'#252550', fontWeight:800, paddingBottom:4, letterSpacing:.5 }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {Object.entries(signalAccuracy)
                        .sort(([,a],[,b])=>b.total-a.total)
                        .map(([sig,{total,correct}])=>{
                          const acc = Math.round(correct/total*100);
                          const col = acc>=55?'#00e5aa':acc>=45?'#ffd700':'#ff3366';
                          return (
                            <tr key={sig} style={{ borderTop:'1px solid #090920' }}>
                              <td style={{ padding:'3px 0', color:'#6060a0', fontWeight:700 }}>{sig}</td>
                              <td style={{ color:'#3a3a6a' }}>{total}</td>
                              <td style={{ color:'#3a3a6a' }}>{correct}</td>
                              <td style={{ color:col, fontWeight:800 }}>{acc}%</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            </div>{/* end weights column wrapper */}

            {/* Learning Log — Timeline with regime clusters */}
            <div className="card" style={{ padding:12, overflow:'hidden', display:'flex', flexDirection:'column' }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#00e5aa', fontSize:12, marginBottom:8, flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span>📝 Learning Log</span>
                {aiLog.length > 0 && (
                  <span style={{ fontSize:8, color:'#252550', fontWeight:800 }}>
                    {aiLog.filter(e=>e.won).length}W / {aiLog.filter(e=>!e.won).length}L
                  </span>
                )}
              </div>
              {aiLog.length===0 ? (
                <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:8, color:'#252550', fontSize:10 }}><div style={{fontSize:24}}>🐾</div>Resolve bets to see AI learning</div>
              ) : (
                <div className="scroll" style={{ flex:1 }}>
                  {aiLog.map((e,i)=>{
                    const streak = (() => { let s=1; for(let j=i+1;j<Math.min(i+5,aiLog.length);j++){if(aiLog[j].won===e.won)s++;else break;} return s; })();
                    const showStreak = streak >= 3 && (i === 0 || aiLog[i-1]?.won !== e.won);
                    const isConsecLoss = !e.won && streak >= 2;
                    // Regime label cluster header — show when regime changes
                    const prevRegime = i < aiLog.length-1 ? aiLog[i+1]?.regime : null;
                    const showRegime = e.regime && e.regime !== prevRegime;
                    const regimeCol = e.regime==='BULLISH'?'#00e5aa':e.regime==='BEARISH'?'#ff3366':'#ffd700';
                    const regimeLabel = e.regime==='BULLISH'?'🐂 BULL TREND':e.regime==='BEARISH'?'🐻 BEAR TREND':'⚠️ CHOPPY';
                    return (
                      <div key={i}>
                        {showRegime && (
                          <div style={{ fontSize:7, color:regimeCol, fontWeight:800, letterSpacing:1, padding:'4px 0 2px', opacity:.7 }}>{regimeLabel}</div>
                        )}
                        <div style={{ display:'flex', gap:6, padding:'5px 0', borderBottom:'1px solid #090920', alignItems:'flex-start',
                          background: isConsecLoss ? 'rgba(255,51,102,.03)' : 'transparent',
                          borderLeft: isConsecLoss ? '2px solid #ff336633' : '2px solid transparent', paddingLeft: isConsecLoss ? 4 : 0 }}>
                          {/* Time */}
                          <div style={{ fontSize:7, color:'#252550', minWidth:32, paddingTop:2, flexShrink:0 }}>{e.time?.slice(0,5)}</div>
                          {/* Outcome pill */}
                          <div style={{ flexShrink:0, width:26, height:17, borderRadius:8, background:e.won?'rgba(0,229,170,.15)':'rgba(255,51,102,.12)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                            <span style={{ fontSize:8, fontWeight:800, color:e.won?'#00e5aa':'#ff3366' }}>{e.won?'W':'L'}</span>
                          </div>
                          {/* Details */}
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:'flex', gap:3, alignItems:'center', flexWrap:'wrap', justifyContent:'space-between' }}>
                              <div style={{ display:'flex', gap:3, alignItems:'center' }}>
                                <span style={{ fontSize:9, fontWeight:800, color:e.direction==='UP'?'#00e5aa':'#ff3366' }}>
                                  {e.direction==='UP'?'▲':'▼'} {e.direction}
                                </span>
                                {e.odds && <span style={{ fontSize:7, color:'#3a3a6a' }}>{e.odds}¢</span>}
                                <span style={{ fontSize:7, color:'#3a3a6a' }}>{e.conf}%</span>
                                {showStreak && <span style={{ fontSize:7, padding:'1px 4px', borderRadius:7, background:e.won?'rgba(0,229,170,.1)':'rgba(255,51,102,.1)', color:e.won?'#00e5aa':'#ff3366', fontWeight:800 }}>{streak}{e.won?'W':'L'}</span>}
                              </div>
                              {e.pnl !== undefined && (
                                <span style={{ fontSize:8, fontWeight:800, color:e.pnl>=0?'#00e5aa':'#ff3366', flexShrink:0 }}>
                                  {e.pnl>=0?'+':''}{e.pnl?.toFixed(2)}
                                </span>
                              )}
                            </div>
                            {/* Weight deltas */}
                            {e.weightDeltas && Object.keys(e.weightDeltas).length > 0 && (
                              <div style={{ display:'flex', gap:3, flexWrap:'wrap', marginTop:2 }}>
                                {Object.entries(e.weightDeltas).slice(0,3).map(([k,d]) => (
                                  <span key={k} style={{ fontSize:6, padding:'0 4px', borderRadius:5, background:d>0?'rgba(0,229,170,.08)':'rgba(255,51,102,.08)', color:d>0?'#00e5aa99':'#ff336699' }}>
                                    {k}: {d>0?'+':''}{d}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {/* Bet History */}
            <div className="card" style={{ padding:12, overflow:'hidden', display:'flex', flexDirection:'column' }}>
              <div style={{ fontFamily:"'Fredoka One'", color:'#ffd700', fontSize:12, marginBottom:8, flexShrink:0 }}>💰 Bet History <span style={{fontSize:8,color:'#252550'}}>({paperBets.length})</span></div>
              {paperBets.length===0 ? (
                <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#252550', fontSize:10 }}>No bets placed</div>
              ) : (
                <div className="scroll" style={{ flex:1 }}>
                  {[...paperBets].reverse().map((b,i)=>(
                    <div key={b.id||i} style={{ padding:'6px 0', borderBottom:'1px solid #090920' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:10 }}>
                        <span style={{ color:b.direction==='UP'?'#00e5aa':'#ff3366', fontWeight:800 }}>{b.direction==='UP'?'▲':'▼'} {b.direction} @{b.odds}¢ {b.auto?<span style={{fontSize:7,color:'#c44dff'}}>🤖</span>:''}</span>
                        <span style={{ color:b.outcome===null?'#ffd700':b.outcome===b.direction?'#00e5aa':'#ff3366', fontWeight:800 }}>
                          {b.outcome===null?'⏳ pending':b.outcome===b.direction?`+$${(b.payout-b.amount).toFixed(2)}`:`-$${b.amount.toFixed(2)}`}
                        </span>
                      </div>
                      <div style={{ fontSize:7, color:'#252550', marginTop:1 }}>conf:{b.conf}% · {b.score}/5 · ${b.amount} · {b.time}</div>
                      {b.outcome===null && <div style={{ display:'flex', gap:4, marginTop:4 }}>
                        <button className="btn" onClick={()=>resolveBet(b.id,true)} style={{ flex:1, background:'rgba(0,229,170,.08)', color:'#00e5aa', border:'1px solid #00e5aa22', fontSize:8, padding:'3px' }}>✅ WIN</button>
                        <button className="btn" onClick={()=>resolveBet(b.id,false)} style={{ flex:1, background:'rgba(255,51,102,.08)', color:'#ff3366', border:'1px solid #ff336622', fontSize:8, padding:'3px' }}>❌ LOSE</button>
                      </div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>{/* end ROW 3 grid */}

          {/* ── ROW 4: Confidence Calibration + Sample Gate ── */}
          <div style={{ display:'flex', gap:7, flexShrink:0 }}>

            {/* Confidence Calibration Chart */}
            <div className="card" style={{ flex:1, padding:'10px 14px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:7 }}>
                <div style={{ fontFamily:"'Fredoka One'", color:'#ff9d00', fontSize:12 }}>🎯 Confidence Calibration</div>
                {!isCalibrated && <div style={{ fontSize:8, color:'#ff9d00', fontWeight:800 }}>×{confDeflation} deflation active until {CALIB_GATE} bets</div>}
              </div>
              {betHistory.length < 5 ? (
                <div style={{ fontSize:9, color:'#252550', padding:'8px 0' }}>Need 5+ bets for calibration data</div>
              ) : (() => {
                const buckets = [
                  {label:'50-55%', min:50, max:55},
                  {label:'55-60%', min:55, max:60},
                  {label:'60-65%', min:60, max:65},
                  {label:'65-70%', min:65, max:70},
                  {label:'70-75%', min:70, max:75},
                ];
                return (
                  <div style={{ display:'flex', gap:6, alignItems:'flex-end' }}>
                    {buckets.map(({label,min,max}) => {
                      const bkBets = betHistory.filter(b => b.conf >= min && b.conf < max);
                      if (!bkBets.length) return (
                        <div key={label} style={{ flex:1, textAlign:'center' }}>
                          <div style={{ height:60, display:'flex', alignItems:'center', justifyContent:'center', color:'#1a1a38', fontSize:8 }}>—</div>
                          <div style={{ fontSize:7, color:'#252550', marginTop:3 }}>{label}</div>
                          <div style={{ fontSize:7, color:'#1a1a38' }}>0 bets</div>
                        </div>
                      );
                      const wr = Math.round(bkBets.filter(b=>b.correct).length/bkBets.length*100);
                      const barH = Math.max(4, Math.round(wr * 0.6));
                      const expectedH = Math.round(((min+max)/2) * 0.6);
                      const col = wr >= min ? '#00e5aa' : wr >= 45 ? '#ffd700' : '#ff3366';
                      return (
                        <div key={label} style={{ flex:1, textAlign:'center' }}>
                          <div style={{ height:60, display:'flex', alignItems:'flex-end', justifyContent:'center', gap:2, position:'relative' }}>
                            {/* Expected bar (ghost) */}
                            <div style={{ position:'absolute', bottom:0, left:'50%', transform:'translateX(-50%)', width:12, height:expectedH, background:'#252550', borderRadius:'3px 3px 0 0', opacity:.4 }}/>
                            {/* Actual bar */}
                            <div style={{ position:'relative', width:12, height:barH, background:col, borderRadius:'3px 3px 0 0', zIndex:1 }}/>
                            <div style={{ position:'absolute', top:0, fontSize:8, fontWeight:800, color:col }}>{wr}%</div>
                          </div>
                          <div style={{ fontSize:7, color:'#252550', marginTop:3 }}>{label}</div>
                          <div style={{ fontSize:7, color:'#3a3a6a' }}>{bkBets.length}b</div>
                        </div>
                      );
                    })}
                    <div style={{ fontSize:7, color:'#3a3a6a', alignSelf:'center', marginLeft:4, lineHeight:1.8 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:3, marginBottom:2 }}><div style={{width:10,height:8,background:'#252550',borderRadius:2,opacity:.5}}/> expected</div>
                      <div style={{ display:'flex', alignItems:'center', gap:3 }}><div style={{width:10,height:8,background:'#00e5aa',borderRadius:2}}/> actual</div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Sample Gate Progress */}
            <div className="card" style={{ width:220, padding:'10px 14px' }}>
              <div style={{ fontFamily:"'Fredoka One'", color:isCalibrated?'#00e5aa':'#ffd700', fontSize:12, marginBottom:7 }}>
                {isCalibrated ? '✅ Engine Calibrated' : '⏳ Warmup Mode'}
              </div>
              {isCalibrated ? (
                <div style={{ fontSize:9, color:'#3a3a6a', lineHeight:1.8 }}>
                  <div>✅ {betHistory.length} bets resolved</div>
                  <div>✅ Adaptive weights active</div>
                  <div>✅ Full Kelly sizing enabled</div>
                  <div style={{ marginTop:6, fontSize:8, color:'#252550' }}>Engine has passed the {CALIB_GATE}-bet calibration gate</div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize:9, color:'#ffd700', fontWeight:800, marginBottom:8 }}>
                    {betHistory.length}/{CALIB_GATE} rounds to calibration — paper mode
                  </div>
                  <div className="bar" style={{ height:8, marginBottom:8 }}>
                    <div className="bar-fill" style={{ width:`${(betHistory.length/CALIB_GATE)*100}%`, background:'linear-gradient(90deg,#ffd700,#ff9d00)', height:'100%', borderRadius:4 }}/>
                  </div>
                  <div style={{ fontSize:8, color:'#3a3a6a', lineHeight:1.8 }}>
                    <div>⚠️ Weights still near defaults</div>
                    <div>⚠️ Confidence deflated ×0.85</div>
                    <div>⚠️ Kelly sizing conservative</div>
                  </div>
                  <button className="btn" onClick={()=>{ if(!window.confirm(`Reset calibration? This won't delete bets, just resets the gate counter. You have ${betHistory.length} bets of history.`)) return; }} style={{ marginTop:8, width:'100%', background:'rgba(255,213,0,.06)', color:'#ffd700', border:'1px solid #ffd70022', fontSize:8, padding:'5px' }}>
                    ⚠️ Reset Calibration Gate
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          RULES TAB
      ══════════════════════════════════════════════════════ */}
      {activeTab==='lab' && (
        <div style={{ flex:1, padding:8, display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8, overflow:'auto' }}>
          {[
            { title:'⚡ Scalp Entry Gate', color:'#00e5aa', items:[
              'Signal score ≥ minScore (default 3/5)',
              'Confidence ≥ minConf (default 55%)',
              'Odds sweet spot 53–62¢ (edge zone)',
              'Price buffer ≥ $10 from threshold (hard skip inside $10)',
              '4H macro + multi‑TF vote aligned with direction',
              'Auto‑Bot evaluates ~80–90s before round end'
            ]},
            { title:'🚫 Instant NO BET', color:'#ff3366', items:[
              'Dangerous / Whale Dom / Low Liquidity < $85k',
              'Coin flip odds 48–52¢',
              'Price within $10 of threshold',
              'StochRSI extreme ≤1 or ≥99',
              '4H NEUTRAL + split TF vote',
              'Anti‑macro bets when odds >62¢'
            ]},
            { title:'🧠 Quant Engine Overrides', color:'#c44dff', items:[
              'After 4+ rule skips, Bayes + LMSR can override',
              'Override only if Bayes + LMSR agree on direction',
              'Bayesian veto can cancel a rule‑based bet',
              'LMSR edge quality adjusts size'
            ]},
            { title:'🐋 Whale & Liquidity', color:'#38d4b3', items:[
              'Whale sentiment boosts confidence when aligned',
              'Manual Whale flag = hard skip',
              'Exchange deposits = bearish pressure',
              'Exchange withdrawals = bullish pressure',
              'Demo mode if no Whale API key'
            ]},
            { title:'🛡 Risk & Circuit Breakers', color:'#f2994a', items:[
              'Session stop‑loss (default $20)',
              'Session profit target (default $30)',
              'Consecutive loss breaker pauses 1 round',
              'Kelly sizing optional; conservative pre‑calibration',
              'No bet if balance < bet amount'
            ]},
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
      {activeTab==='lab' && (
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

      </main>
      <footer style={{ textAlign:'center', fontSize:8, color:'#0f0f28', borderTop:'1px solid #0c0c22', padding:'3px', flexShrink:0 }}>
        🐾 BabyDoge BTC Oracle v3 • Binance WebSocket + REST • Polymarket Gamma API • NOT financial advice • wow
      </footer>
    </div>
  );
}
