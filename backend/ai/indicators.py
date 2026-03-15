from __future__ import annotations

from typing import List, Dict

import math


def calc_ema(data: List[float], period: int) -> List[float]:
    if len(data) < period:
        return data[:]
    k = 2 / (period + 1)
    ema = []
    for i, val in enumerate(data):
        if i == 0:
            ema.append(val)
        else:
            ema.append(val * k + ema[i - 1] * (1 - k))
    return ema


def calc_macd(closes: List[float]) -> Dict:
    if len(closes) < 40:
        return {"line": 0, "signal": 0, "hist": 0, "bullish": False, "histArr": []}
    e12 = calc_ema(closes, 12)
    e26 = calc_ema(closes, 26)
    macd_line = [e12[i] - e26[i] for i in range(len(closes))]
    sig_line = calc_ema(macd_line[25:], 9)
    line = macd_line[-1]
    signal = sig_line[-1]
    hist = line - signal
    hist_arr = []
    for i in range(20):
        idx = len(macd_line) - 20 + i
        sig_idx = len(sig_line) - 20 + i
        hist_arr.append(macd_line[idx] - (sig_line[sig_idx] if sig_idx >= 0 else macd_line[idx]))
    return {
        "line": round(line, 2),
        "signal": round(signal, 2),
        "hist": round(hist, 2),
        "bullish": line > signal,
        "histArr": hist_arr,
    }


def calc_rsi(closes: List[float], period: int = 14) -> float:
    if len(closes) < period + 2:
        return 50.0
    ag = 0.0
    al = 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        if d > 0:
            ag += d
        else:
            al -= d
    ag /= period
    al /= period
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        ag = (ag * (period - 1) + (d if d > 0 else 0)) / period
        al = (al * (period - 1) + (-d if d < 0 else 0)) / period
    if al == 0:
        return 100.0
    return round(100 - 100 / (1 + ag / al), 2)


def calc_stoch_rsi(closes: List[float], rp: int = 14, sp: int = 14, sk: int = 3, sd: int = 3) -> Dict:
    if len(closes) < rp + sp + sk + sd + 5:
        return {"k": 50, "d": 50}
    rsi_arr = []
    ag = 0.0
    al = 0.0
    for i in range(1, rp + 1):
        d = closes[i] - closes[i - 1]
        if d > 0:
            ag += d
        else:
            al -= d
    ag /= rp
    al /= rp
    rsi_arr.append(100 if al == 0 else 100 - 100 / (1 + ag / al))
    for i in range(rp + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        ag = (ag * (rp - 1) + (d if d > 0 else 0)) / rp
        al = (al * (rp - 1) + (-d if d < 0 else 0)) / rp
        rsi_arr.append(100 if al == 0 else 100 - 100 / (1 + ag / al))
    stoch_arr = []
    for i in range(sp - 1, len(rsi_arr)):
        sl = rsi_arr[i - sp + 1:i + 1]
        mn = min(sl)
        mx = max(sl)
        stoch_arr.append(50 if mx == mn else (rsi_arr[i] - mn) / (mx - mn) * 100)
    if len(stoch_arr) < sk:
        last = stoch_arr[-1] if stoch_arr else 50
        return {"k": round(last, 2), "d": round(last, 2)}
    k_arr = []
    for i in range(sk - 1, len(stoch_arr)):
        k_arr.append(sum(stoch_arr[i - sk + 1:i + 1]) / sk)
    if len(k_arr) < sd:
        last = k_arr[-1]
        return {"k": round(last, 2), "d": round(last, 2)}
    d_arr = []
    for i in range(sd - 1, len(k_arr)):
        d_arr.append(sum(k_arr[i - sd + 1:i + 1]) / sd)
    return {"k": round(k_arr[-1], 2), "d": round(d_arr[-1], 2)}


def calc_bb(closes: List[float], period: int = 20) -> Dict:
    if len(closes) < period:
        return {"upper": 0, "middle": 0, "lower": 0, "pct": 50}
    sl = closes[-period:]
    mean = sum(sl) / period
    std = math.sqrt(sum((x - mean) ** 2 for x in sl) / period)
    upper = mean + 2 * std
    lower = mean - 2 * std
    last_close = closes[-1]
    pct = 50 if upper == lower else (last_close - lower) / (upper - lower) * 100
    return {
        "upper": round(upper, 2),
        "middle": round(mean, 2),
        "lower": round(lower, 2),
        "pct": round(pct, 1),
    }


def calc_supertrend(highs: List[float], lows: List[float], closes: List[float], period: int = 10, multiplier: int = 3) -> Dict:
    if len(closes) < period + 2:
        return {"bullish": True, "value": closes[-1]}
    tr = []
    for i, close in enumerate(closes):
        if i == 0:
            tr.append(highs[i] - lows[i])
        else:
            tr.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])))
    atr_arr = calc_ema(tr, period)
    last_atr = atr_arr[-1]
    last_mid = (highs[-1] + lows[-1]) / 2
    upper_band = last_mid + multiplier * last_atr
    lower_band = last_mid - multiplier * last_atr
    last_close = closes[-1]
    return {
        "bullish": last_close > lower_band,
        "value": lower_band if last_close > lower_band else upper_band,
    }


def calc_vwap(highs: List[float], lows: List[float], closes: List[float], volumes: List[float]) -> float:
    if not volumes:
        return closes[-1]
    length = min(20, len(closes))
    cum_pv = 0.0
    cum_vol = 0.0
    for i in range(length):
        idx = len(closes) - length + i
        typical = (highs[idx] + lows[idx] + closes[idx]) / 3
        vol = volumes[idx] if idx < len(volumes) else 1
        cum_pv += typical * vol
        cum_vol += vol
    return round(cum_pv / cum_vol, 2) if cum_vol else closes[-1]
