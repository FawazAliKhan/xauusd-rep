# Trading Logic & Backtesting Rules

## Core execution model

1. Read candle `i` close and all prior candles.
2. Generate signal on candle close only (no intra-candle look-ahead).
3. Enter on candle `i+1` open.
4. Evaluate SL/TP during candle `i+1` using high/low.
5. Trailing SL updates only after a candle closes and is applied from next candle.

## Risk framework

- Fixed risk budget per trade: **2 USD**.
- Position size: `qty = min(2 / stop_distance, qty_cap)`.
- Initial stop distance from ATR multiple (`atr_mult * ATR`).
- Trailing stop based on ATR (`trail_atr_mult * ATR`).
- TP set as `take_profit_r * stop_distance`.
- Fee model: 0.02% per side.

## 50 strategy families covered

- **EMA + RSI trend (12):** momentum continuation with volatility filter.
- **Bollinger + RSI mean reversion (10):** reversal from stretched bands.
- **Donchian breakout (10):** structure breakout with volume regime.
- **Market structure + patterns (10):** HH/HL, LH/LL, engulfing confirmation.
- **Custom regime (8):** EMA trend + efficiency ratio + volume filter.

## Output artifacts

- `results/backtest_summary.csv`: all strategy outcomes by pair/timeframe.
- `results/best_per_pair_timeframe.csv`: best strategy shortlist + target check.
- `results/trade_log.csv`: granular trade-level log.

## Current status

This baseline run is complete for all provided datasets and timeframes.
The strict `2 USD` fixed-loss framework with current filters is conservative, and most pair/timeframe combinations do **not** yet hit `20 USD/day` average P&L. This research baseline is intended for iterative optimization.
