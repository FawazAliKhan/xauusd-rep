#!/usr/bin/env python3
"""Strategy research harness for 1m/3m/5m trading-pair datasets."""

from __future__ import annotations

import csv
import glob
import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = Path(__file__).resolve().parent / "output"
OUT_DIR.mkdir(parents=True, exist_ok=True)

STOP_LOSS_USD = 2.0
TIMEFRAMES = ("1m", "3m", "5m")


@dataclass
class Bar:
    t: datetime
    o: float
    h: float
    l: float
    c: float
    v: float


@dataclass
class StrategySpec:
    name: str
    family: str
    signal_fn: Callable[[int, Dict[str, List[Optional[float]]], List[Bar]], int]


def parse_file(path: str) -> Tuple[str, str, List[Bar]]:
    stem = Path(path).name.split("_")[0]
    timeframe = Path(path).name.split("_")[1]
    bars: List[Bar] = []
    with open(path, "r", newline="") as f:
        for row in csv.DictReader(f):
            bars.append(
                Bar(
                    t=datetime.strptime(row["time"], "%Y-%m-%d %H:%M:%S"),
                    o=float(row["open"]),
                    h=float(row["high"]),
                    l=float(row["low"]),
                    c=float(row["close"]),
                    v=float(row.get("volume") or 0.0),
                )
            )
    bars.sort(key=lambda b: b.t)
    return stem, timeframe, bars


def rolling_sma(values: List[float], n: int) -> List[Optional[float]]:
    out = [None] * len(values)
    s = 0.0
    for i, v in enumerate(values):
        s += v
        if i >= n:
            s -= values[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def rolling_std(values: List[float], n: int, sma: List[Optional[float]]) -> List[Optional[float]]:
    out = [None] * len(values)
    for i in range(n - 1, len(values)):
        m = sma[i]
        if m is None:
            continue
        seg = values[i - n + 1 : i + 1]
        var = sum((x - m) ** 2 for x in seg) / n
        out[i] = math.sqrt(var)
    return out


def ema(values: List[float], n: int) -> List[Optional[float]]:
    out = [None] * len(values)
    if len(values) < n:
        return out
    k = 2.0 / (n + 1.0)
    seed = sum(values[:n]) / n
    out[n - 1] = seed
    prev = seed
    for i in range(n, len(values)):
        prev = values[i] * k + prev * (1 - k)
        out[i] = prev
    return out


def rsi(closes: List[float], n: int = 14) -> List[Optional[float]]:
    out = [None] * len(closes)
    if len(closes) <= n:
        return out
    gains = [0.0] * len(closes)
    losses = [0.0] * len(closes)
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains[i] = max(d, 0.0)
        losses[i] = max(-d, 0.0)
    avg_gain = sum(gains[1 : n + 1]) / n
    avg_loss = sum(losses[1 : n + 1]) / n
    if avg_loss == 0:
        out[n] = 100.0
    else:
        rs = avg_gain / avg_loss
        out[n] = 100 - (100 / (1 + rs))
    for i in range(n + 1, len(closes)):
        avg_gain = (avg_gain * (n - 1) + gains[i]) / n
        avg_loss = (avg_loss * (n - 1) + losses[i]) / n
        if avg_loss == 0:
            out[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            out[i] = 100 - (100 / (1 + rs))
    return out


def atr(bars: List[Bar], n: int = 14) -> List[Optional[float]]:
    trs = [0.0] * len(bars)
    for i, b in enumerate(bars):
        if i == 0:
            trs[i] = b.h - b.l
        else:
            p = bars[i - 1].c
            trs[i] = max(b.h - b.l, abs(b.h - p), abs(b.l - p))
    return ema(trs, n)


def rolling_high(vals: List[float], n: int) -> List[Optional[float]]:
    out = [None] * len(vals)
    for i in range(n - 1, len(vals)):
        out[i] = max(vals[i - n + 1 : i + 1])
    return out


def rolling_low(vals: List[float], n: int) -> List[Optional[float]]:
    out = [None] * len(vals)
    for i in range(n - 1, len(vals)):
        out[i] = min(vals[i - n + 1 : i + 1])
    return out


def build_indicators(bars: List[Bar]) -> Dict[str, List[Optional[float]]]:
    c = [b.c for b in bars]
    h = [b.h for b in bars]
    l = [b.l for b in bars]
    v = [b.v for b in bars]
    ind: Dict[str, List[Optional[float]]] = {}

    for n in (5, 8, 10, 13, 20, 34, 50):
        ind[f"sma_{n}"] = rolling_sma(c, n)
        ind[f"ema_{n}"] = ema(c, n)
    ind["rsi_14"] = rsi(c, 14)
    ind["atr_14"] = atr(bars, 14)
    ind["hh_20"] = rolling_high(h, 20)
    ind["ll_20"] = rolling_low(l, 20)
    ind["hh_50"] = rolling_high(h, 50)
    ind["ll_50"] = rolling_low(l, 50)

    sma20 = ind["sma_20"]
    std20 = rolling_std(c, 20, sma20)
    ind["std_20"] = std20

    z20 = [None] * len(c)
    for i in range(len(c)):
        if sma20[i] is not None and std20[i] not in (None, 0):
            z20[i] = (c[i] - sma20[i]) / std20[i]
    ind["z_20"] = z20

    vma20 = rolling_sma(v, 20)
    ind["vma_20"] = vma20

    # Custom trend pressure indicator
    pressure = [None] * len(c)
    for i in range(1, len(c)):
        body = c[i] - bars[i].o
        rng = max(bars[i].h - bars[i].l, 1e-6)
        pressure[i] = (body / rng) * (v[i] / (vma20[i] or max(v[i], 1.0)))
    ind["pressure"] = pressure

    return ind


def s(v: Optional[float], default: float = 0.0) -> float:
    return v if v is not None else default


def build_strategies() -> List[StrategySpec]:
    strategies: List[StrategySpec] = []

    # Indicator crossover (12)
    crossover_pairs = [(5, 20), (8, 34), (10, 50), (13, 34), (5, 50), (8, 20)]
    for a, b in crossover_pairs:
        strategies.append(StrategySpec(
            name=f"ema_cross_{a}_{b}",
            family="indicator",
            signal_fn=lambda i, ind, bars, a=a, b=b: 1 if s(ind[f"ema_{a}"][i]) > s(ind[f"ema_{b}"][i]) else (-1 if s(ind[f"ema_{a}"][i]) < s(ind[f"ema_{b}"][i]) else 0),
        ))
        strategies.append(StrategySpec(
            name=f"sma_cross_{a}_{b}",
            family="indicator",
            signal_fn=lambda i, ind, bars, a=a, b=b: 1 if s(ind[f"sma_{a}"][i]) > s(ind[f"sma_{b}"][i]) else (-1 if s(ind[f"sma_{a}"][i]) < s(ind[f"sma_{b}"][i]) else 0),
        ))

    # RSI regime/mean reversion (10)
    rsi_levels = [(30, 70), (25, 75), (35, 65), (40, 60), (20, 80)]
    for lo, hi in rsi_levels:
        strategies.append(StrategySpec(
            name=f"rsi_revert_{lo}_{hi}",
            family="regime",
            signal_fn=lambda i, ind, bars, lo=lo, hi=hi: 1 if s(ind["rsi_14"][i], 50) < lo else (-1 if s(ind["rsi_14"][i], 50) > hi else 0),
        ))
        strategies.append(StrategySpec(
            name=f"rsi_trend_{lo}_{hi}",
            family="regime",
            signal_fn=lambda i, ind, bars, lo=lo, hi=hi: 1 if s(ind["rsi_14"][i], 50) > hi else (-1 if s(ind["rsi_14"][i], 50) < lo else 0),
        ))

    # Volatility and structure breakout (10)
    for look in (20, 50):
        hh = f"hh_{look}"
        ll = f"ll_{look}"
        for k in (0.0, 0.2, 0.4, 0.6, 1.0):
            strategies.append(StrategySpec(
                name=f"donchian_break_{look}_k{k}",
                family="structure",
                signal_fn=lambda i, ind, bars, hh=hh, ll=ll, k=k: 1 if ind[hh][i] is not None and bars[i].c > s(ind[hh][i]) - k * s(ind['atr_14'][i], 0.0) else (-1 if ind[ll][i] is not None and bars[i].c < s(ind[ll][i]) + k * s(ind['atr_14'][i], 0.0) else 0),
            ))

    # Bollinger / zscore (8)
    for z in (0.8, 1.0, 1.2, 1.5):
        strategies.append(StrategySpec(
            name=f"z_revert_{z}",
            family="volatility",
            signal_fn=lambda i, ind, bars, z=z: 1 if s(ind["z_20"][i]) < -z else (-1 if s(ind["z_20"][i]) > z else 0),
        ))
        strategies.append(StrategySpec(
            name=f"z_break_{z}",
            family="volatility",
            signal_fn=lambda i, ind, bars, z=z: 1 if s(ind["z_20"][i]) > z else (-1 if s(ind["z_20"][i]) < -z else 0),
        ))

    # Candle pattern + custom pressure (10)
    for min_body in (0.2, 0.35, 0.5, 0.65, 0.8):
        strategies.append(StrategySpec(
            name=f"engulfing_body_{min_body}",
            family="pattern",
            signal_fn=lambda i, ind, bars, min_body=min_body: pattern_engulfing_signal(i, bars, min_body),
        ))
        strategies.append(StrategySpec(
            name=f"pressure_thrust_{min_body}",
            family="custom",
            signal_fn=lambda i, ind, bars, min_body=min_body: 1 if s(ind["pressure"][i]) > min_body else (-1 if s(ind["pressure"][i]) < -min_body else 0),
        ))

    return strategies[:50]


def pattern_engulfing_signal(i: int, bars: List[Bar], min_body: float) -> int:
    if i < 1:
        return 0
    p = bars[i - 1]
    c = bars[i]
    p_body = p.c - p.o
    c_body = c.c - c.o
    p_rng = max(p.h - p.l, 1e-6)
    c_rng = max(c.h - c.l, 1e-6)
    if abs(c_body) / c_rng < min_body:
        return 0
    if p_body < 0 < c_body and c.c > p.o and c.o < p.c and abs(p_body) / p_rng > 0.2:
        return 1
    if p_body > 0 > c_body and c.c < p.o and c.o > p.c and abs(p_body) / p_rng > 0.2:
        return -1
    return 0


def backtest(
    bars: List[Bar],
    ind: Dict[str, List[Optional[float]]],
    strategy: StrategySpec,
    rr: float,
    trail_trigger: float,
    trail_step: float,
    collect_log: bool = False,
) -> Dict[str, float | int | str]:
    trades = 0
    wins = 0
    pnl = 0.0
    pos = 0
    entry = 0.0
    stop = 0.0
    tp = 0.0
    last_day = None
    daily = defaultdict(float)
    trade_log: List[Dict[str, str | float | int]] = []

    for i in range(51, len(bars) - 1):
        signal = strategy.signal_fn(i, ind, bars)
        nxt = bars[i + 1]

        if pos == 0 and signal != 0:
            pos = signal
            entry = nxt.o
            stop = entry - STOP_LOSS_USD if pos == 1 else entry + STOP_LOSS_USD
            tp = entry + rr * STOP_LOSS_USD if pos == 1 else entry - rr * STOP_LOSS_USD
            trades += 1
            if collect_log:
                trade_log.append({
                    "event": "entry",
                    "time": nxt.t.isoformat(sep=" "),
                    "side": "long" if pos == 1 else "short",
                    "price": round(entry, 5),
                    "stop": round(stop, 5),
                    "tp": round(tp, 5),
                })
            continue

        if pos != 0:
            b = nxt
            # trailing update from closed-candle info (i)
            favorable = (bars[i].c - entry) if pos == 1 else (entry - bars[i].c)
            if favorable >= trail_trigger:
                if pos == 1:
                    stop = max(stop, bars[i].c - trail_step)
                else:
                    stop = min(stop, bars[i].c + trail_step)

            exit_px = None
            if pos == 1:
                if b.l <= stop:
                    exit_px = stop
                elif b.h >= tp:
                    exit_px = tp
            else:
                if b.h >= stop:
                    exit_px = stop
                elif b.l <= tp:
                    exit_px = tp

            if exit_px is not None:
                trade_pnl = (exit_px - entry) * pos
                pnl += trade_pnl
                if trade_pnl > 0:
                    wins += 1
                day = b.t.date().isoformat()
                daily[day] += trade_pnl
                if collect_log:
                    trade_log.append({
                        "event": "exit",
                        "time": b.t.isoformat(sep=" "),
                        "side": "long" if pos == 1 else "short",
                        "price": round(exit_px, 5),
                        "pnl": round(trade_pnl, 5),
                    })
                pos = 0

    if pos != 0:
        close_px = bars[-1].c
        trade_pnl = (close_px - entry) * pos
        pnl += trade_pnl
        if trade_pnl > 0:
            wins += 1
        daily[bars[-1].t.date().isoformat()] += trade_pnl

    days = max(1, len(daily))
    pnl_day = pnl / days
    winrate = (wins / trades * 100.0) if trades else 0.0
    return {
        "strategy": strategy.name,
        "family": strategy.family,
        "rr": rr,
        "trail_trigger": trail_trigger,
        "trail_step": trail_step,
        "trades": trades,
        "wins": wins,
        "winrate": round(winrate, 2),
        "net_pnl": round(pnl, 2),
        "pnl_per_day": round(pnl_day, 2),
        "days_ge_20": sum(1 for d in daily.values() if d >= 20.0),
        "active_days": len(daily),
        "trade_log": trade_log,
    }


def optimize_strategy(bars: List[Bar], ind: Dict[str, List[Optional[float]]], spec: StrategySpec) -> Dict[str, float | int | str]:
    # Keep optimization light enough for fast full-universe scans.
    return backtest(bars, ind, spec, rr=2.0, trail_trigger=2.0, trail_step=1.0)


def write_csv(path: Path, rows: List[Dict[str, float | int | str]], fieldnames: List[str]) -> None:
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    files = sorted(glob.glob(str(ROOT / "*m_*to*.csv")))
    strategies = build_strategies()
    summary_rows: List[Dict[str, float | int | str]] = []

    for fp in files:
        pair, tf, bars = parse_file(fp)
        if tf not in TIMEFRAMES or len(bars) < 200:
            continue
        ind = build_indicators(bars)
        pair_rows = []
        for spec in strategies:
            best = optimize_strategy(bars, ind, spec)
            best.pop("trade_log", None)
            best["pair"] = pair
            best["timeframe"] = tf
            pair_rows.append(best)
            summary_rows.append(best)

        pair_rows.sort(key=lambda x: (x["pnl_per_day"], x["net_pnl"]), reverse=True)
        out = OUT_DIR / f"summary_{pair}_{tf}.csv"
        fields = ["pair", "timeframe", "strategy", "family", "rr", "trail_trigger", "trail_step", "trades", "wins", "winrate", "net_pnl", "pnl_per_day", "days_ge_20", "active_days"]
        write_csv(out, pair_rows, fields)

        # Write trade logs for top 3 strategies per dataset.
        for rank, row in enumerate(pair_rows[:3], 1):
            spec = next(s for s in strategies if s.name == row["strategy"])
            details = backtest(
                bars, ind, spec,
                rr=float(row["rr"]),
                trail_trigger=float(row["trail_trigger"]),
                trail_step=float(row["trail_step"]),
                collect_log=True,
            )
            log_path = OUT_DIR / f"trades_{pair}_{tf}_rank{rank}_{row['strategy']}.csv"
            logs = details.get("trade_log", [])
            if logs:
                fields_log = sorted({k for row_log in logs for k in row_log.keys()})
                with open(log_path, "w", newline="") as f:
                    w = csv.DictWriter(f, fieldnames=fields_log)
                    w.writeheader()
                    w.writerows(logs)

    summary_rows.sort(key=lambda x: (x["pair"], x["timeframe"], -float(x["pnl_per_day"])))
    fields = ["pair", "timeframe", "strategy", "family", "rr", "trail_trigger", "trail_step", "trades", "wins", "winrate", "net_pnl", "pnl_per_day", "days_ge_20", "active_days"]
    write_csv(OUT_DIR / "all_pairs_summary.csv", summary_rows, fields)

    # Markdown report
    md = ["# Strategy Backtesting Summary", "", f"Strategies tested per pair/timeframe: {len(strategies)}", ""]
    keyed: Dict[Tuple[str, str], List[Dict[str, float | int | str]]] = defaultdict(list)
    for r in summary_rows:
        keyed[(str(r["pair"]), str(r["timeframe"]))].append(r)

    for (pair, tf), rows in sorted(keyed.items()):
        rows = sorted(rows, key=lambda x: (x["pnl_per_day"], x["net_pnl"]), reverse=True)
        md.append(f"## {pair} {tf}")
        md.append("")
        md.append("| Rank | Strategy | Family | Net PnL | PnL/Day | Winrate | Trades | >=20 USD Days |")
        md.append("|---:|---|---|---:|---:|---:|---:|---:|")
        for i, r in enumerate(rows[:10], 1):
            md.append(f"| {i} | {r['strategy']} | {r['family']} | {r['net_pnl']} | {r['pnl_per_day']} | {r['winrate']}% | {r['trades']} | {r['days_ge_20']} |")
        eligible = [r for r in rows if float(r["pnl_per_day"]) >= 20.0]
        md.append("")
        md.append(f"Strategies meeting >=20 USD/day: **{len(eligible)}**")
        md.append("")

    (OUT_DIR / "report.md").write_text("\n".join(md))
    print(f"Completed backtests for {len(keyed)} pair/timeframe datasets.")


if __name__ == "__main__":
    main()
