from __future__ import annotations

import csv
import math
from collections import deque
from dataclasses import dataclass
from datetime import datetime
from statistics import mean
from typing import Optional

from strategy_catalog import StrategySpec


@dataclass
class Candle:
    ts: datetime
    o: float
    h: float
    l: float
    c: float
    v: float


@dataclass
class Trade:
    pair: str
    timeframe: str
    strategy: str
    direction: int
    entry_ts: datetime
    exit_ts: datetime
    entry: float
    exit: float
    qty: float
    pnl: float
    reason: str


def read_candles(path: str) -> list[Candle]:
    out: list[Candle] = []
    with open(path, newline="", encoding="utf-8") as f:
        rd = csv.DictReader(f)
        for row in rd:
            out.append(Candle(ts=datetime.strptime(row["time"], "%Y-%m-%d %H:%M:%S"), o=float(row["open"]), h=float(row["high"]), l=float(row["low"]), c=float(row["close"]), v=float(row.get("volume", 0.0))))
    out.sort(key=lambda x: x.ts)
    return out


def ema(values: list[float], n: int) -> list[float]:
    alpha = 2.0 / (n + 1.0)
    out: list[float] = []
    val = values[0]
    for x in values:
        val = alpha * x + (1 - alpha) * val
        out.append(val)
    return out


def rolling_std(values: list[float], n: int) -> list[float]:
    out = [0.0] * len(values)
    q: deque[float] = deque()
    s = 0.0
    s2 = 0.0
    for i, x in enumerate(values):
        q.append(x)
        s += x
        s2 += x * x
        if len(q) > n:
            old = q.popleft()
            s -= old
            s2 -= old * old
        m = s / len(q)
        var = max(s2 / len(q) - m * m, 0.0)
        out[i] = math.sqrt(var)
    return out


def rolling_mean(values: list[float], n: int) -> list[float]:
    out = [0.0] * len(values)
    q: deque[float] = deque()
    s = 0.0
    for i, x in enumerate(values):
        q.append(x)
        s += x
        if len(q) > n:
            s -= q.popleft()
        out[i] = s / len(q)
    return out


def rolling_max(values: list[float], n: int) -> list[float]:
    out = [values[0]] * len(values)
    q: deque[float] = deque()
    for i, x in enumerate(values):
        q.append(x)
        if len(q) > n:
            q.popleft()
        out[i] = max(q)
    return out


def rolling_min(values: list[float], n: int) -> list[float]:
    out = [values[0]] * len(values)
    q: deque[float] = deque()
    for i, x in enumerate(values):
        q.append(x)
        if len(q) > n:
            q.popleft()
        out[i] = min(q)
    return out


def rsi(close: list[float], n: int) -> list[float]:
    gains = [0.0]
    losses = [0.0]
    for i in range(1, len(close)):
        d = close[i] - close[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_g = ema(gains, n)
    avg_l = ema(losses, n)
    out = [50.0] * len(close)
    for i in range(len(close)):
        if avg_l[i] == 0:
            out[i] = 100.0 if avg_g[i] > 0 else 50.0
        else:
            out[i] = 100 - (100 / (1 + (avg_g[i] / avg_l[i])))
    return out


def atr(candles: list[Candle], n: int) -> list[float]:
    tr = [candles[0].h - candles[0].l]
    for i in range(1, len(candles)):
        c = candles[i]
        p = candles[i - 1]
        tr.append(max(c.h - c.l, abs(c.h - p.c), abs(c.l - p.c)))
    return ema(tr, n)


def build_feature_cache(candles: list[Candle], strategies: list[StrategySpec]) -> dict[str, list[float]]:
    close = [c.c for c in candles]
    high = [c.h for c in candles]
    low = [c.l for c in candles]
    open_ = [c.o for c in candles]
    vol = [c.v for c in candles]
    cache: dict[str, list[float]] = {"open": open_, "high": high, "low": low, "close": close, "vol": vol}

    for n in sorted({s.fast for s in strategies} | {s.slow for s in strategies}):
        cache[f"ema_{n}"] = ema(close, n)
    for n in sorted({s.rsi_len for s in strategies}):
        cache[f"rsi_{n}"] = rsi(close, n)
    for n in sorted({s.atr_len for s in strategies}):
        cache[f"atr_{n}"] = atr(candles, n)
    for n in sorted({s.vol_window for s in strategies}):
        cache[f"vmean_{n}"] = rolling_mean(vol, n)
        cache[f"vstd_{n}"] = rolling_std(vol, n)
    for n in sorted({s.bb_window for s in strategies}):
        cache[f"bb_mid_{n}"] = rolling_mean(close, n)
        cache[f"bb_std_{n}"] = rolling_std(close, n)
    for n in sorted({s.donchian for s in strategies}):
        cache[f"d_high_{n}"] = rolling_max(high, n)
        cache[f"d_low_{n}"] = rolling_min(low, n)

    er = [0.0] * len(close)
    win = 10
    for i in range(win, len(close)):
        num = abs(close[i] - close[i - win])
        den = 1e-9
        for j in range(i - win + 1, i + 1):
            den += abs(close[j] - close[j - 1])
        er[i] = num / den
    cache["eff_ratio"] = er
    return cache


def signal_for(i: int, s: StrategySpec, d: dict[str, list[float]], vol_z: list[float]) -> int:
    c = d["close"][i]
    ef = d[f"ema_{s.fast}"][i]
    es = d[f"ema_{s.slow}"][i]
    rv = d[f"rsi_{s.rsi_len}"][i]
    sig = 0

    if s.family == "ema_rsi_trend":
        sig = 1 if ef > es and rv > 52 and vol_z[i] >= s.vol_z_min else (-1 if ef < es and rv < 48 and vol_z[i] >= s.vol_z_min else 0)
    elif s.family == "bb_rsi_meanrev":
        up = d[f"bb_mid_{s.bb_window}"][i] + s.bb_k * d[f"bb_std_{s.bb_window}"][i]
        lo = d[f"bb_mid_{s.bb_window}"][i] - s.bb_k * d[f"bb_std_{s.bb_window}"][i]
        sig = 1 if c < lo and rv < 35 else (-1 if c > up and rv > 65 else 0)
    elif s.family == "donchian_breakout":
        sig = 1 if c > d[f"d_high_{s.donchian}"][i-1] and vol_z[i] >= s.vol_z_min else (-1 if c < d[f"d_low_{s.donchian}"][i-1] and vol_z[i] >= s.vol_z_min else 0)
    elif s.family == "market_structure":
        hh = d["high"][i] > d["high"][i - 1] > d["high"][i - 2]
        hl = d["low"][i] > d["low"][i - 1] > d["low"][i - 2]
        lh = d["high"][i] < d["high"][i - 1] < d["high"][i - 2]
        ll = d["low"][i] < d["low"][i - 1] < d["low"][i - 2]
        bull_engulf = d["close"][i] > d["open"][i] and d["open"][i] <= d["close"][i - 1]
        bear_engulf = d["close"][i] < d["open"][i] and d["open"][i] >= d["close"][i - 1]
        sig = 1 if hh and hl and bull_engulf and rv > 50 else (-1 if lh and ll and bear_engulf and rv < 50 else 0)
    else:
        er = d["eff_ratio"][i]
        sig = 1 if ef > es and er > 0.35 and vol_z[i] >= s.vol_z_min and rv > 50 else (-1 if ef < es and er > 0.35 and vol_z[i] >= s.vol_z_min and rv < 50 else 0)

    if s.direction == "long" and sig == -1:
        return 0
    if s.direction == "short" and sig == 1:
        return 0
    return sig


def backtest(candles: list[Candle], cache: dict[str, list[float]], strategy: StrategySpec, pair: str, timeframe: str) -> tuple[dict, list[Trade]]:
    trades: list[Trade] = []
    fee_rate = 0.0002
    risk_usd = 2.0
    qty_cap = 5.0

    vol_mean = cache[f"vmean_{strategy.vol_window}"]
    vol_std = cache[f"vstd_{strategy.vol_window}"]
    vol = cache["vol"]
    vol_z = [(vol[i] - vol_mean[i]) / vol_std[i] if vol_std[i] > 1e-9 else 0.0 for i in range(len(vol))]

    pos = 0
    entry = stop = trail = take = qty = 0.0
    entry_ts: Optional[datetime] = None
    start = max(50, strategy.slow + 5)

    for i in range(start, len(candles) - 1):
        c = candles[i]
        nxt = candles[i + 1]

        if pos == 0:
            sig = signal_for(i, strategy, cache, vol_z)
            if sig != 0:
                atr_v = max(cache[f"atr_{strategy.atr_len}"][i], 1e-6)
                stop_dist = max(strategy.atr_mult * atr_v, 0.05)
                qty = min(risk_usd / stop_dist, qty_cap)
                pos = sig
                entry = nxt.o
                entry_ts = nxt.ts
                if pos == 1:
                    stop, trail, take = entry - stop_dist, entry - stop_dist, entry + stop_dist * strategy.take_profit_r
                else:
                    stop, trail, take = entry + stop_dist, entry + stop_dist, entry - stop_dist * strategy.take_profit_r
            continue

        atr_v = max(cache[f"atr_{strategy.atr_len}"][i], 1e-6)
        trail = max(trail, c.c - strategy.trail_atr_mult * atr_v) if pos == 1 else min(trail, c.c + strategy.trail_atr_mult * atr_v)

        exit_price = None
        reason = ""
        if pos == 1:
            active_stop = max(stop, trail)
            if nxt.l <= active_stop:
                exit_price, reason = active_stop, "stop/trail"
            elif nxt.h >= take:
                exit_price, reason = take, "target"
        else:
            active_stop = min(stop, trail)
            if nxt.h >= active_stop:
                exit_price, reason = active_stop, "stop/trail"
            elif nxt.l <= take:
                exit_price, reason = take, "target"

        if exit_price is not None and entry_ts is not None:
            gross = (exit_price - entry) * pos * qty
            fees = (entry + exit_price) * qty * fee_rate
            pnl = gross - fees
            trades.append(Trade(pair, timeframe, strategy.name, pos, entry_ts, nxt.ts, entry, exit_price, qty, pnl, reason))
            pos = 0
            entry = stop = trail = take = qty = 0.0
            entry_ts = None

    if not trades:
        return {"pair": pair, "timeframe": timeframe, "strategy": strategy.name, "trades": 0, "net_pnl": 0.0, "avg_daily_pnl": 0.0, "win_rate": 0.0, "max_dd": 0.0}, trades

    equity = peak = 0.0
    max_dd = 0.0
    wins = 0
    daily: dict[str, float] = {}
    for t in trades:
        equity += t.pnl
        wins += 1 if t.pnl > 0 else 0
        peak = max(peak, equity)
        max_dd = min(max_dd, equity - peak)
        d = t.exit_ts.strftime("%Y-%m-%d")
        daily[d] = daily.get(d, 0.0) + t.pnl

    return {
        "pair": pair,
        "timeframe": timeframe,
        "strategy": strategy.name,
        "trades": len(trades),
        "net_pnl": round(equity, 2),
        "avg_daily_pnl": round(mean(daily.values()) if daily else 0.0, 2),
        "win_rate": round(100.0 * wins / len(trades), 2),
        "max_dd": round(max_dd, 2),
    }, trades
