# Quant Research Sub-Repository (Phase 1)

This sub-repository bootstraps a realistic, candle-close-driven backtesting workflow over the provided 1m / 3m / 5m datasets.

## What is included

- **50 strategy definitions** in `strategy_catalog.py`, grouped by:
  - Trend (EMA + RSI)
  - Mean reversion (Bollinger + RSI)
  - Breakout (Donchian + volume regime)
  - Market structure/patterns (higher-high/lower-low + engulfing)
  - Custom regime/volatility (efficiency ratio + volatility filters)
- **Backtest engine** in `backtest_engine.py` with:
  - Entry decision strictly after candle close
  - Execution at next candle open
  - Per-trade loss capped by position sizing to **~2 USD risk**
  - ATR-based stop loss + trailing stop logic
  - Take-profit based on R multiple
  - Basic fee model
  - Trade log and summary outputs
- **Research runner** in `run_research.py` that scans all CSVs and evaluates all 50 strategies for each pair/timeframe.

## Realism assumptions

- Signals are generated on bar `i` close and orders are opened on bar `i+1` open.
- SL/TP checks happen against `i+1` high/low.
- Trailing stop is updated from closed candle data before being active on next candle.
- No look-ahead on indicators.

## How to run

```bash
python research_subrepo/run_research.py
```

Outputs in `research_subrepo/results/`:

- `backtest_summary.csv`
- `trade_log.csv`
- `best_per_pair_timeframe.csv`

## Notes

- This is a **phase-1 research baseline** and not live-trading advice.
- Profitability targets (e.g., >=20 USD/day) are validated from the generated summaries; not all pair/timeframe combinations will meet the target in out-of-sample conditions.
