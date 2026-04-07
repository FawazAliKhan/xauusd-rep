# Scalping Strategy Research Skill

## Overview
This skill provides a reusable framework for developing and backtesting scalping strategies on volatile assets (XAUUSDm, BTCUSDm) using tight fixed USD stop-losses.

## Files
- `scalping_v3.js` - Main research framework with quality setup focus
- `scalping_optimize.js` - Parameter optimization testing
- `scalping_skill.js` - Reusable module for future research
- `SCALPING_RESEARCH_REPORT.md` - Complete research findings and strategy templates

## Usage

### Basic Research
```bash
node scalping_v3.js
```

### Parameter Optimization
```bash
node scalping_optimize.js
```

### Load as Module
```javascript
const ScalpingResearch = require('./scalping_skill.js');
const sr = new ScalpingResearch();
const data = sr.loadCSV('XAUUSDm_1m_2026-02-01_to_2026-04-01.csv');
const features = sr.engineerFeatures(data);
```

## Key Functions

### Data Loading
- `loadCSV(filepath)` - Load OHLCV data from CSV

### Indicator Engineering
- `calculateEMA(prices, period)` - Exponential Moving Average
- `calculateRSI(prices, period)` - Relative Strength Index
- `calculateATR(data, period)` - Average True Range
- `engineerFeatures(data)` - Add all indicators + session tags

### Backtesting
- `backtest(data, config)` - Run strategy backtest
- Config options: `{ sl, tp, spread, signalType }`

### Signal Generation
- `generateSignal(data, type)` - Generate trading signals
  - Types: 'ema_cross', 'rsi_rev', 'momentum', 'vwap_reversal'

## Strategy Templates

### System 1: XAUUSDm Trend Continuation
- SL: 3 USD, TP: 6 USD (2:1)
- Session: London/NY only
- Entry: EMA alignment + MACD + RSI confirmation

### System 2: BTCUSDm Momentum Scalp
- SL: 2.5 USD, TP: 5 USD (2:1)
- Session: London preferred
- Entry: MACD histogram shift + momentum

### System 3: XAUUSDm Reversal Hunt
- SL: 2 USD, TP: 4 USD (2:1)
- Session: London/NY open
- Entry: RSI extreme + bounce confirmation

### System 4: XAUUSDm Volatility Breakout
- SL: 2.5 USD, TP: 5 USD (2:1)
- Session: NY only
- Entry: ATR squeeze + range compression breakout

### System 5: BTCUSDm Mean Reversion
- SL: 3 USD, TP: 4 USD (1.3:1)
- Session: NY only
- Entry: 2 SD from SMA + RSI extreme

## Risk Rules
- Per trade: 1-2% of account
- Daily max: 3-5% loss
- Max trades per session: 5-7
- Pause after 3 consecutive losses

## Key Insights
1. Tight-stop scalping requires >40% win rate for profitability
2. Session filtering (avoid Asia) improves results
3. Trade management contributes 40-60% of edge
4. Conservative strategies with strict filters perform best
5. Out-of-sample validation is critical

## Data Files Required
- XAUUSDm_1m_2026-02-01_to_2026-04-01.csv
- BTCUSDm_1m_2026-02-01_to_2026-04-01.csv
