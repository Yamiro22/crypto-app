// ─── WHALE TRANSACTION MONITOR ───────────────────────────────────────────────
// Uses Whale Alert API (free tier) + fallback demo data
// Get a free API key at https://whale-alert.io/

const WHALE_API_KEY = 'YOUR_WHALE_ALERT_API_KEY'; // Replace with real key
const MIN_VALUE_USD = 5_000_000; // $5M+ transfers
const BASE = '/whale/v1';

// Cache to avoid duplicate entries
const seenIds = new Set();
let cachedWhales = [];

export async function fetchWhaleTransactions() {
  const start = Math.floor(Date.now() / 1000) - 3600; // Last 1 hour

  try {
    if (WHALE_API_KEY === 'YOUR_WHALE_ALERT_API_KEY') {
      // Demo mode — generate realistic simulated whale data
      return generateDemoWhales();
    }

    const res = await fetch(`${BASE}/transactions?min_value=${MIN_VALUE_USD}&start=${start}&api_key=${WHALE_API_KEY}&currency=btc&limit=20`);
    if (!res.ok) throw new Error(`Whale API ${res.status}`);
    const data = await res.json();
    const txs = (data.transactions || [])
      .filter(tx => !seenIds.has(tx.id))
      .map(tx => {
        seenIds.add(tx.id);
        return parseWhaleTx(tx);
      });

    cachedWhales = [...txs, ...cachedWhales].slice(0, 15);
    return cachedWhales;
  } catch (e) {
    console.warn('[WhaleMonitor] error:', e.message);
    return cachedWhales.length > 0 ? cachedWhales : generateDemoWhales();
  }
}

function parseWhaleTx(tx) {
  const fromEx = tx.from?.owner_type === 'exchange';
  const toEx   = tx.to?.owner_type   === 'exchange';
  let type = 'TRANSFER';
  if (fromEx && !toEx) type = 'EXCHANGE_WITHDRAWAL'; // Bullish (taking off exchange)
  if (!fromEx && toEx)  type = 'EXCHANGE_DEPOSIT';   // Bearish (sending to exchange to sell)
  if (fromEx && toEx)   type = 'EXCHANGE_TRANSFER';  // Neutral

  return {
    id:       tx.id || Math.random().toString(36),
    time:     tx.timestamp ? new Date(tx.timestamp * 1000).toLocaleTimeString() : new Date().toLocaleTimeString(),
    amount:   +(tx.amount || 0).toFixed(2),
    valueUSD: Math.round(tx.amount_usd || 0),
    from:     tx.from?.owner || tx.from?.address?.slice(0, 8) || 'Unknown',
    to:       tx.to?.owner   || tx.to?.address?.slice(0, 8)   || 'Unknown',
    type,
    sentiment: type === 'EXCHANGE_WITHDRAWAL' ? 'bullish' : type === 'EXCHANGE_DEPOSIT' ? 'bearish' : 'neutral',
    symbol:   (tx.symbol || 'BTC').toUpperCase(),
  };
}

function generateDemoWhales() {
  // Demo mode — realistic looking whale data for testing
  const exchanges = ['Binance', 'Coinbase', 'Kraken', 'Huobi', 'OKX'];
  const wallets   = ['Whale Wallet', 'Unknown Wallet', 'DeFi Protocol', 'Mining Pool'];
  const types     = ['EXCHANGE_WITHDRAWAL', 'EXCHANGE_DEPOSIT', 'TRANSFER'];
  const now = Date.now();

  if (cachedWhales.length === 0 || Math.random() < 0.3) {
    const type = types[Math.floor(Math.random() * types.length)];
    const amount = +(Math.random() * 800 + 100).toFixed(2);
    const fromEx = type === 'EXCHANGE_DEPOSIT';
    const toEx   = type === 'EXCHANGE_WITHDRAWAL';
    const newTx = {
      id:       now.toString(),
      time:     new Date(now).toLocaleTimeString(),
      amount,
      valueUSD: Math.round(amount * 83000),
      from:     fromEx ? wallets[Math.floor(Math.random() * wallets.length)] : exchanges[Math.floor(Math.random() * exchanges.length)],
      to:       toEx   ? wallets[Math.floor(Math.random() * wallets.length)] : exchanges[Math.floor(Math.random() * exchanges.length)],
      type,
      sentiment: type === 'EXCHANGE_WITHDRAWAL' ? 'bullish' : type === 'EXCHANGE_DEPOSIT' ? 'bearish' : 'neutral',
      symbol: 'BTC',
      demo: true,
    };
    cachedWhales = [newTx, ...cachedWhales].slice(0, 10);
  }
  return cachedWhales;
}

export function getWhaleSentiment(whales) {
  if (!whales || whales.length === 0) return { score: 0, label: 'NEUTRAL' };
  const last10 = whales.slice(0, 10);
  const bullish = last10.filter(w => w.sentiment === 'bullish').length;
  const bearish = last10.filter(w => w.sentiment === 'bearish').length;
  const score = (bullish - bearish) / last10.length;
  return {
    score: +score.toFixed(2),
    label: score > 0.2 ? 'BULLISH' : score < -0.2 ? 'BEARISH' : 'NEUTRAL',
    bullish, bearish,
  };
}
