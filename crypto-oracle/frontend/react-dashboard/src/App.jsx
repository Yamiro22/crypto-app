import { useEffect, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const formatUsd = (value) =>
  value == null
    ? "--"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2
      }).format(value);

const formatPct = (value) =>
  value == null ? "--" : `${(value * 100).toFixed(1)}%`;

const formatNumber = (value) =>
  value == null
    ? "--"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
        value
      );

const fetchJson = async (url, fallback) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("bad response");
    }
    return await response.json();
  } catch (error) {
    return fallback;
  }
};

export default function App() {
  const [market, setMarket] = useState({
    symbol: "BTCUSDT",
    price: null,
    volume: null,
    timestamp: null
  });
  const [signals, setSignals] = useState([]);
  const [whales, setWhales] = useState([]);
  const [trades, setTrades] = useState([]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const [marketData, signalData, whaleData, tradeData] = await Promise.all([
        fetchJson(`${API_BASE}/market`, market),
        fetchJson(`${API_BASE}/signals`, []),
        fetchJson(`${API_BASE}/whales`, []),
        fetchJson(`${API_BASE}/trades`, [])
      ]);

      if (!active) return;
      setMarket(marketData);
      setSignals(signalData);
      setWhales(whaleData);
      setTrades(tradeData);
    };

    load();
    const interval = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const currentSignal = signals[0];
  const whaleSentiment = whales[0]?.sentiment ?? 0;
  const activeTrades = useMemo(
    () => trades.filter((trade) => trade.status === "open"),
    [trades]
  );
  const tradeHistory = useMemo(() => trades.slice(0, 8), [trades]);

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">BabyDoge BTC Oracle v3</p>
          <h1>Microstructure Scalping Control Room</h1>
          <p className="subtitle">
            5-minute BTC directionals with whale-aware signal gating and
            automated risk exits.
          </p>
        </div>
        <div className="hero-card">
          <div>
            <span>BTC Price</span>
            <strong>{formatUsd(market.price)}</strong>
          </div>
          <div>
            <span>Velocity Signal</span>
            <strong className={currentSignal?.direction === "DOWN" ? "down" : "up"}>
              {currentSignal?.direction || "WAIT"}
            </strong>
          </div>
          <div>
            <span>Confidence</span>
            <strong>{formatPct(currentSignal?.confidence)}</strong>
          </div>
        </div>
      </header>

      <section className="grid">
        <article className="panel">
          <h2>Signal Detail</h2>
          <div className="metric-row">
            <div>
              <span>Direction</span>
              <strong>{currentSignal?.direction || "NONE"}</strong>
            </div>
            <div>
              <span>Velocity</span>
              <strong>{formatPct(currentSignal?.price_velocity)}</strong>
            </div>
            <div>
              <span>RSI</span>
              <strong>{formatNumber(currentSignal?.rsi)}</strong>
            </div>
            <div>
              <span>MACD</span>
              <strong>{formatNumber(currentSignal?.macd)}</strong>
            </div>
          </div>
          <div className="signal-banner">
            <p>
              Whale sentiment guardrail is {whaleSentiment > 0.4 ? "blocking" : "clear"}.
            </p>
            <span className="pill">Sentiment {formatNumber(whaleSentiment)}</span>
          </div>
        </article>

        <article className="panel">
          <h2>Whale Flow</h2>
          <div className="whale-score">
            <div className="score">
              <span>Whale Sentiment</span>
              <strong>{formatNumber(whaleSentiment)}</strong>
            </div>
            <div className="flow-list">
              {whales.length === 0 && <p>No recent whale transfers.</p>}
              {whales.slice(0, 5).map((whale) => (
                <div key={whale.id} className="flow-item">
                  <span>{whale.event_type}</span>
                  <span>{formatNumber(whale.amount_btc)} BTC</span>
                  <span>{new Date(whale.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="panel wide">
          <h2>Active Trades</h2>
          <div className="table">
            <div className="row header">
              <span>ID</span>
              <span>Direction</span>
              <span>Entry</span>
              <span>Size</span>
              <span>Status</span>
            </div>
            {activeTrades.length === 0 && (
              <div className="row empty">No open positions.</div>
            )}
            {activeTrades.map((trade) => (
              <div className="row" key={trade.id}>
                <span>{trade.id}</span>
                <span>{trade.direction}</span>
                <span>{formatUsd(trade.entry_price)}</span>
                <span>{formatNumber(trade.size)}</span>
                <span>{trade.status}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel wide">
          <h2>Trade History</h2>
          <div className="table">
            <div className="row header">
              <span>ID</span>
              <span>Direction</span>
              <span>Entry</span>
              <span>Exit</span>
              <span>P/L</span>
            </div>
            {tradeHistory.length === 0 && (
              <div className="row empty">No trade history yet.</div>
            )}
            {tradeHistory.map((trade) => (
              <div className="row" key={trade.id}>
                <span>{trade.id}</span>
                <span>{trade.direction}</span>
                <span>{formatUsd(trade.entry_price)}</span>
                <span>{formatUsd(trade.exit_price)}</span>
                <span>{formatUsd(trade.profit)}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
