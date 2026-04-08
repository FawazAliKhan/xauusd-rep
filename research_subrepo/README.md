# Trading Strategy Research Sub-Repository

This sub-repository contains a pure-Python backtesting workflow for the 1m, 3m, and 5m trading datasets in the project root.

## Goals implemented

- Evaluate **50 strategy archetypes per timeframe** (scalping and intraday focused).
- Include strategy families for:
  - Volatility
  - Regime
  - Market structure
  - Candle patterns
  - Standard indicators
  - Custom indicators
- Backtest assumptions:
  - Signals generated only on **closed candle**
  - Entries occur on **next candle open**
  - Fixed initial stop-loss of **2.0 USD** per trade
  - Trailing stop-loss logic enabled for all strategies
- Produce summary artifacts:
  - Pair/timeframe strategy ranking
  - Trade logs for top strategies
  - Daily P&L diagnostics for >= 20 USD/day filtering

## Quick start

```bash
python research_subrepo/backtest_research.py
```

Outputs are written under `research_subrepo/output/`.

## Notes

- Uses only Python standard library (no pandas/numpy required).
- This is an initial research baseline and can be extended with walk-forward splits, spread/slippage modeling, and portfolio-level risk constraints.
