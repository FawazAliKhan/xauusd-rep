from __future__ import annotations

import csv
import glob
import os
import argparse

from backtest_engine import backtest, build_feature_cache, read_candles
from strategy_catalog import build_strategy_catalog


ROOT = os.path.dirname(os.path.dirname(__file__))
RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")


def parse_meta(path: str) -> tuple[str, str]:
    base = os.path.basename(path)
    pair = base.split("_")[0]
    tf = base.split("_")[1]
    return pair, tf


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pair", default="", help="optional pair prefix filter, e.g. XAUUSDm")
    args = parser.parse_args()
    os.makedirs(RESULTS_DIR, exist_ok=True)
    files = sorted(glob.glob(os.path.join(ROOT, "*_1m_*.csv")) + glob.glob(os.path.join(ROOT, "*_3m_*.csv")) + glob.glob(os.path.join(ROOT, "*_5m_*.csv")))
    if args.pair:
        files = [f for f in files if os.path.basename(f).startswith(args.pair + "_")]
    strategies = build_strategy_catalog()

    all_summaries = []
    all_trades = []

    for path in files:
        pair, tf = parse_meta(path)
        candles = read_candles(path)
        cache = build_feature_cache(candles, strategies)
        for s in strategies:
            summary, trades = backtest(candles, cache, s, pair, tf)
            all_summaries.append(summary)
            if summary["avg_daily_pnl"] > 0 or summary["net_pnl"] > 0:
                all_trades.extend(trades)
        print(f"Done: {pair} {tf} ({len(candles)} candles)")

    all_summaries.sort(key=lambda x: (x["pair"], x["timeframe"], -(x["trades"] > 0), -x["avg_daily_pnl"], -x["net_pnl"]))

    sum_path = os.path.join(RESULTS_DIR, "backtest_summary.csv")
    with open(sum_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["pair", "timeframe", "strategy", "trades", "net_pnl", "avg_daily_pnl", "win_rate", "max_dd"],
        )
        w.writeheader()
        w.writerows(all_summaries)

    log_path = os.path.join(RESULTS_DIR, "trade_log.csv")
    with open(log_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["pair", "timeframe", "strategy", "direction", "entry_ts", "exit_ts", "entry", "exit", "qty", "pnl", "reason"])
        for t in all_trades:
            w.writerow([t.pair, t.timeframe, t.strategy, t.direction, t.entry_ts, t.exit_ts, round(t.entry, 5), round(t.exit, 5), round(t.qty, 5), round(t.pnl, 5), t.reason])

    # shortlist of best strategy per pair/timeframe
    best = {}
    for s in all_summaries:
        k = (s["pair"], s["timeframe"])
        if k not in best:
            best[k] = s
            continue
        cur = best[k]
        cur_score = (1 if cur["trades"] >= 20 else 0, cur["avg_daily_pnl"], cur["net_pnl"])
        new_score = (1 if s["trades"] >= 20 else 0, s["avg_daily_pnl"], s["net_pnl"])
        if new_score > cur_score:
            best[k] = s

    best_path = os.path.join(RESULTS_DIR, "best_per_pair_timeframe.csv")
    with open(best_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["pair", "timeframe", "strategy", "trades", "net_pnl", "avg_daily_pnl", "win_rate", "max_dd", "meets_20_usd_day"])
        w.writeheader()
        for (_, _), s in sorted(best.items()):
            row = dict(s)
            row["meets_20_usd_day"] = "yes" if s["avg_daily_pnl"] >= 20.0 else "no"
            w.writerow(row)


if __name__ == "__main__":
    main()
