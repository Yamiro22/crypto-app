// ─── INDICATOR MATH ──────────────────────────────────────────────────────────

export const calcEMA = (data, period) => {
  if (data.length < period) return data.slice();
  const k = 2 / (period + 1);
  return data.reduce((acc, val, i) =>
    i === 0 ? [val] : [...acc, val * k + acc[i - 1] * (1 - k)], []);
};

export const calcMACD = (closes) => {
  if (closes.length < 40) return { line: 0, signal: 0, hist: 0, bullish: false };
  const e12 = calcEMA(closes, 12);
  const e26 = calcEMA(closes, 26);
  const macdLine = e12.map((v, i) => v - e26[i]);
  const sigLine = calcEMA(macdLine.slice(25), 9);
  const line = macdLine[closes.length - 1];
  const signal = sigLine[sigLine.length - 1];
  return {
    line: +line.toFixed(2),
    signal: +signal.toFixed(2),
    hist: +(line - signal).toFixed(2),
    bullish: line > signal,
    histArr: macdLine.slice(-20).map((v, i) => v - (sigLine[sigLine.length - 20 + i] || v)),
  };
};

export const calcRSI = (closes, period = 14) => {
  if (closes.length < period + 2) return 50;
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    d > 0 ? (ag += d) : (al -= d);
  }
  ag /= period; al /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  return al === 0 ? 100 : +(100 - 100 / (1 + ag / al)).toFixed(2);
};

export const calcStochRSI = (closes, rp = 14, sp = 14, sk = 3, sd = 3) => {
  if (closes.length < rp + sp + sk + sd + 5) return { k: 50, d: 50 };
  const rsiArr = [];
  let ag = 0, al = 0;
  for (let i = 1; i <= rp; i++) {
    const d = closes[i] - closes[i - 1]; d > 0 ? (ag += d) : (al -= d);
  }
  ag /= rp; al /= rp;
  rsiArr.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  for (let i = rp + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (rp - 1) + (d > 0 ? d : 0)) / rp;
    al = (al * (rp - 1) + (d < 0 ? -d : 0)) / rp;
    rsiArr.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  const stochArr = [];
  for (let i = sp - 1; i < rsiArr.length; i++) {
    const sl = rsiArr.slice(i - sp + 1, i + 1);
    const mn = Math.min(...sl), mx = Math.max(...sl);
    stochArr.push(mx === mn ? 50 : (rsiArr[i] - mn) / (mx - mn) * 100);
  }
  if (stochArr.length < sk) return { k: 50, d: 50 };
  const kArr = [];
  for (let i = sk - 1; i < stochArr.length; i++)
    kArr.push(stochArr.slice(i - sk + 1, i + 1).reduce((a, b) => a + b) / sk);
  if (kArr.length < sd) return { k: +kArr[kArr.length - 1].toFixed(2), d: +kArr[kArr.length - 1].toFixed(2) };
  const dArr = [];
  for (let i = sd - 1; i < kArr.length; i++)
    dArr.push(kArr.slice(i - sd + 1, i + 1).reduce((a, b) => a + b) / sd);
  return { k: +kArr[kArr.length - 1].toFixed(2), d: +dArr[dArr.length - 1].toFixed(2) };
};

export const calcBB = (closes, period = 20) => {
  if (closes.length < period) return { upper: 0, middle: 0, lower: 0, pct: 50 };
  const sl = closes.slice(-period);
  const mean = sl.reduce((a, b) => a + b) / period;
  const std = Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
  const upper = mean + 2 * std, lower = mean - 2 * std;
  const lastClose = closes[closes.length - 1];
  const pct = upper === lower ? 50 : ((lastClose - lower) / (upper - lower)) * 100;
  return { upper: +upper.toFixed(2), middle: +mean.toFixed(2), lower: +lower.toFixed(2), pct: +pct.toFixed(1) };
};

export const calcSupertrend = (highs, lows, closes, period = 10, multiplier = 3) => {
  if (closes.length < period + 2) return { bullish: true, value: closes[closes.length - 1] };
  // ATR
  const tr = closes.map((c, i) => {
    if (i === 0) return highs[i] - lows[i];
    return Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
  });
  const atrArr = calcEMA(tr, period);
  const lastATR = atrArr[atrArr.length - 1];
  const lastMid = (highs[highs.length - 1] + lows[lows.length - 1]) / 2;
  const upperBand = lastMid + multiplier * lastATR;
  const lowerBand = lastMid - multiplier * lastATR;
  const lastClose = closes[closes.length - 1];
  return { bullish: lastClose > lowerBand, value: lastClose > lowerBand ? lowerBand : upperBand };
};

export const calcVWAP = (highs, lows, closes, volumes) => {
  if (!volumes || volumes.length === 0) return closes[closes.length - 1];
  let cumPV = 0, cumVol = 0;
  const slice = closes.slice(-20);
  for (let i = 0; i < slice.length; i++) {
    const typical = (highs[closes.length - 20 + i] + lows[closes.length - 20 + i] + slice[i]) / 3;
    cumPV += typical * (volumes[closes.length - 20 + i] || 1);
    cumVol += (volumes[closes.length - 20 + i] || 1);
  }
  return +(cumPV / cumVol).toFixed(2);
};
