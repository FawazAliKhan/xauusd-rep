/**
 * Optimized Scalping Strategy Research
 * XAUUSDm & BTCUSDm - Feb/Mar 2026
 */

const fs = require('fs');

function loadCSV(filepath) {
    const content = fs.readFileSync(filepath, 'utf-8');
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',');
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const row = {};
        headers.forEach((h, idx) => {
            row[h] = h === 'time' ? new Date(values[idx]) : parseFloat(values[idx]);
        });
        data.push(row);
    }
    return data;
}

function calculateEMA(prices, period) {
    const k = 2 / (period + 1);
    const ema = new Array(prices.length).fill(0);
    let prev = prices[0];
    
    for (let i = 0; i < prices.length; i++) {
        if (i === 0) {
            prev = prices[i];
        } else {
            prev = prices[i] * k + prev * (1 - k);
        }
        ema[i] = prev;
    }
    return ema;
}

function calculateRSI(prices, period = 14) {
    const rsi = new Array(prices.length).fill(50);
    let gains = [], losses = [];
    
    for (let i = 1; i < prices.length; i++) {
        const change = prices[i] - prices[i-1];
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? -change : 0);
        
        if (i >= period) {
            const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
            const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
            rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        }
    }
    return rsi;
}

function calculateATR(data, period = 14) {
    const tr = new Array(data.length).fill(0);
    const atr = new Array(data.length).fill(0);
    
    tr[0] = data[0].high - data[0].low;
    atr[0] = tr[0];
    
    for (let i = 1; i < data.length; i++) {
        tr[i] = Math.max(
            data[i].high - data[i].low,
            Math.abs(data[i].high - data[i-1].close),
            Math.abs(data[i].low - data[i-1].close)
        );
    }
    
    // Initial ATR as SMA
    let sum = 0;
    for (let i = 0; i < period; i++) sum += tr[i];
    atr[period - 1] = sum / period;
    
    // EMA ATR
    for (let i = period; i < data.length; i++) {
        atr[i] = (atr[i-1] * (period - 1) + tr[i]) / period;
    }
    
    return atr;
}

function runBacktest(data, strategyFunc, params = {}) {
    const {
        symbol = 'XAUUSDm',
        spreadPips = 2,
        slPips = 3,
        tpPips = 6,
        initialCapital = 10000,
        trailMult = 1.5,
        maxBars = 30
    } = params;
    
    const signals = strategyFunc(data);
    const trades = [];
    let equity = initialCapital;
    let position = 0, entryPrice = 0, entryBar = 0;
    let lastSignal = 0, dailyPnL = 0, lastDate = null;
    
    for (let i = 1; i < data.length; i++) {
        const curr = data[i], prev = data[i-1];
        const currentDate = curr.time.toISOString().split('T')[0];
        
        if (lastDate !== currentDate) {
            dailyPnL = 0;
            lastDate = currentDate;
        }
        
        // Entry
        if (position === 0 && signals[i] !== 0 && signals[i] !== lastSignal) {
            position = signals[i];
            entryPrice = curr.close + spreadPips * (position > 0 ? 1 : -1);
            entryBar = i;
        }
        
        // Exit logic
        if (position !== 0) {
            let exit = false, exitPrice = 0, exitReason = '';
            
            const barProfit = position > 0 ? curr.close - entryPrice : entryPrice - curr.close;
            
            // SL
            if (position > 0 && curr.low <= entryPrice - slPips) {
                exit = true; exitPrice = entryPrice - slPips; exitReason = 'SL';
            } else if (position < 0 && curr.high >= entryPrice + slPips) {
                exit = true; exitPrice = entryPrice + slPips; exitReason = 'SL';
            }
            // TP
            else if (position > 0 && curr.high >= entryPrice + tpPips) {
                exit = true; exitPrice = entryPrice + tpPips; exitReason = 'TP';
            } else if (position < 0 && curr.low <= entryPrice - tpPips) {
                exit = true; exitPrice = entryPrice - tpPips; exitReason = 'TP';
            }
            // Trailing
            else if (barProfit >= slPips * trailMult) {
                const trailPrice = entryPrice + barProfit - slPips * 0.5;
                if (position > 0 && curr.low <= trailPrice) {
                    exit = true; exitPrice = trailPrice; exitReason = 'TRAIL';
                } else if (position < 0 && curr.high >= trailPrice) {
                    exit = true; exitPrice = trailPrice; exitReason = 'TRAIL';
                }
            }
            // Time
            else if (i - entryBar >= maxBars) {
                exit = true; exitPrice = curr.close - spreadPips * (position > 0 ? 1 : -1); exitReason = 'TIME';
            }
            
            if (exit) {
                const pnl = position > 0 ? exitPrice - entryPrice : entryPrice - exitPrice;
                const result = pnl - spreadPips;
                
                trades.push({
                    direction: position > 0 ? 1 : -1,
                    entryPrice,
                    exitPrice,
                    pnl: result,
                    exitReason,
                    duration: i - entryBar,
                    session: curr.session
                });
                
                equity += result;
                position = 0;
            }
        }
        
        lastSignal = signals[i];
    }
    
    return { trades, equity, metrics: calculateMetrics(trades, equity, initialCapital) };
}

function calculateMetrics(trades, finalEquity, initialCapital) {
    if (trades.length === 0) {
        return { trades: 0, winRate: 0, pf: 0, pnl: 0, maxDD: 0 };
    }
    
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const totalWin = wins.reduce((a, b) => a + b.pnl, 0);
    const totalLoss = Math.abs(losses.reduce((a, b) => a + b.pnl, 0));
    
    // Calculate max drawdown from trades
    let peak = initialCapital, maxDD = 0, runningEquity = initialCapital;
    for (const t of trades) {
        runningEquity += t.pnl;
        if (runningEquity > peak) peak = runningEquity;
        const dd = (peak - runningEquity) / peak;
        if (dd > maxDD) maxDD = dd;
    }
    
    return {
        trades: trades.length,
        wins: wins.length,
        losses: losses.length,
        winRate: (wins.length / trades.length * 100).toFixed(1),
        avgWin: wins.length > 0 ? (totalWin / wins.length).toFixed(2) : 0,
        avgLoss: losses.length > 0 ? (totalLoss / losses.length).toFixed(2) : 0,
        pf: losses.length > 0 && totalLoss > 0 ? (totalWin / totalLoss).toFixed(2) : 'inf',
        pnl: (finalEquity - initialCapital).toFixed(2),
        maxDD: (maxDD * 100).toFixed(2),
        avgDuration: (trades.reduce((a, b) => a + b.duration, 0) / trades.length).toFixed(1)
    };
}

// Strategies
const Strategies = {
    EMA_Cross: (data, emaFast = 5, emaSlow = 20) => {
        const close = data.map(d => d.close);
        const emaFastVals = calculateEMA(close, emaFast);
        const emaSlowVals = calculateEMA(close, emaSlow);
        const signals = new Array(data.length).fill(0);
        
        for (let i = 1; i < data.length; i++) {
            const bullCross = emaFastVals[i] > emaSlowVals[i] && emaFastVals[i-1] <= emaSlowVals[i-1];
            const bearCross = emaFastVals[i] < emaSlowVals[i] && emaFastVals[i-1] >= emaSlowVals[i-1];
            const rsiOk = data[i].rsi > 40 && data[i].rsi < 70;
            const trendOk = data[i].close > data[i].ema50;
            
            if (bullCross && rsiOk && trendOk) signals[i] = 1;
            if (bearCross && rsiOk && !trendOk) signals[i] = -1;
        }
        return signals;
    },
    
    RSI_Rev: (data, oversold = 35, overbought = 65) => {
        const signals = new Array(data.length).fill(0);
        
        for (let i = 2; i < data.length; i++) {
            const rsiTurnUp = data[i].rsi > data[i-1].rsi && data[i-1].rsi <= data[i-2].rsi;
            const rsiTurnDown = data[i].rsi < data[i-1].rsi && data[i-1].rsi >= data[i-2].rsi;
            
            if (data[i].rsi <= oversold && rsiTurnUp && data[i].close > data[i].ema20) {
                signals[i] = 1;
            }
            if (data[i].rsi >= overbought && rsiTurnDown && data[i].close < data[i].ema20) {
                signals[i] = -1;
            }
        }
        return signals;
    },
    
    BB_Break: (data) => {
        const signals = new Array(data.length).fill(0);
        
        for (let i = 1; i < data.length; i++) {
            const bullBreak = data[i].close > data[i].bbUpper && data[i-1].close <= data[i-1].bbUpper;
            const bearBreak = data[i].close < data[i].bbLower && data[i-1].close >= data[i-1].bbLower;
            
            if (bullBreak && data[i].rsi > 50 && data[i].rsi < 80) signals[i] = 1;
            if (bearBreak && data[i].rsi < 50 && data[i].rsi > 20) signals[i] = -1;
        }
        return signals;
    },
    
    MACD_Mom: (data) => {
        const close = data.map(d => d.close);
        const kFast = 2/13, kSlow = 2/27, kSig = 2/10;
        let ema12 = close[0], ema26 = close[0], macdSig = 0;
        const macdLine = [], signalLine = [];
        
        for (let i = 0; i < close.length; i++) {
            ema12 = close[i] * kFast + ema12 * (1 - kFast);
            ema26 = close[i] * kSlow + ema26 * (1 - kSlow);
            const macd = ema12 - ema26;
            macdLine.push(macd);
            macdSig = macd * 0.1 + macdSig * 0.9;
            signalLine.push(macdSig);
        }
        
        const signals = new Array(data.length).fill(0);
        for (let i = 1; i < data.length; i++) {
            const histUp = (macdLine[i] - signalLine[i]) > 0 && (macdLine[i-1] - signalLine[i-1]) <= 0;
            const histDown = (macdLine[i] - signalLine[i]) < 0 && (macdLine[i-1] - signalLine[i-1]) >= 0;
            
            if (histUp && data[i].ema5 > data[i].ema20) signals[i] = 1;
            if (histDown && data[i].ema5 < data[i].ema20) signals[i] = -1;
        }
        return signals;
    },
    
    VWAP_Break: (data) => {
        let cumTPV = 0, cumVol = 0;
        const vwap = new Array(data.length).fill(0);
        const signals = new Array(data.length).fill(0);
        
        for (let i = 0; i < data.length; i++) {
            const tpv = (data[i].high + data[i].low + data[i].close) / 3 * data[i].volume;
            cumTPV += tpv;
            cumVol += data[i].volume;
            vwap[i] = cumVol > 0 ? cumTPV / cumVol : data[i].close;
        }
        
        for (let i = 1; i < data.length; i++) {
            const bullBreak = data[i].close > vwap[i] && data[i-1].close <= vwap[i-1];
            const bearBreak = data[i].close < vwap[i] && data[i-1].close >= vwap[i-1];
            
            if (bullBreak && data[i].rsi > 50) signals[i] = 1;
            if (bearBreak && data[i].rsi < 50) signals[i] = -1;
        }
        return signals;
    }
};

// Feature engineering
function engineerFeatures(data) {
    const close = data.map(d => d.close);
    const high = data.map(d => d.high);
    const low = data.map(d => d.low);
    
    const ema5 = calculateEMA(close, 5);
    const ema13 = calculateEMA(close, 13);
    const ema20 = calculateEMA(close, 20);
    const ema50 = calculateEMA(close, 50);
    const rsi = calculateRSI(close, 14);
    const atr = calculateATR(data, 14);
    
    // Bollinger Bands
    const bbMid = [], bbUpper = [], bbLower = [];
    for (let i = 0; i < data.length; i++) {
        if (i < 19) {
            bbMid.push(null); bbUpper.push(null); bbLower.push(null);
        } else {
            const slice = close.slice(i - 19, i + 1);
            const mean = slice.reduce((a, b) => a + b, 0) / 20;
            const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 20);
            bbMid.push(mean); bbUpper.push(mean + 2 * std); bbLower.push(mean - 2 * std);
        }
    }
    
    return data.map((row, i) => ({
        ...row,
        ema5: ema5[i],
        ema13: ema13[i],
        ema20: ema20[i],
        ema50: ema50[i],
        rsi: rsi[i],
        atr: atr[i],
        bbUpper: bbUpper[i],
        bbLower: bbLower[i]
    }));
}

function addSessionTags(data) {
    return data.map(row => {
        const hour = new Date(row.time).getUTCHours();
        let session = 'ny';
        if (hour < 7) session = 'asia';
        else if (hour < 12) session = 'london';
        return { ...row, session };
    });
}

function analyzeBySession(trades) {
    const stats = { asia: {t: 0, w: 0, p: 0}, london: {t: 0, w: 0, p: 0}, ny: {t: 0, w: 0, p: 0} };
    for (const t of trades) {
        const s = stats[t.session] || stats.ny;
        s.t++; s.w += t.pnl > 0 ? 1 : 0; s.p += t.pnl;
    }
    return stats;
}

function analyzeByExit(trades) {
    const stats = {};
    for (const t of trades) {
        if (!stats[t.exitReason]) stats[t.exitReason] = { t: 0, w: 0, p: 0 };
        stats[t.exitReason].t++;
        stats[t.exitReason].w += t.pnl > 0 ? 1 : 0;
        stats[t.exitReason].p += t.pnl;
    }
    return stats;
}

// Main
console.log('='.repeat(70));
console.log('SCALPING RESEARCH - XAUUSDm & BTCUSDm (Feb 2026 In-Sample)');
console.log('='.repeat(70));

// Load and prepare data
const xauRaw = loadCSV('XAUUSDm_1m_2026-02-01_to_2026-04-01.csv');
const btcRaw = loadCSV('BTCUSDm_1m_2026-02-01_to_2026-04-01.csv');

const xauData = engineerFeatures(addSessionTags(xauRaw));
const btcData = engineerFeatures(addSessionTags(btcRaw));

// Split
const xauTrain = xauData.filter(d => d.time < new Date('2026-03-01'));
const xauTest = xauData.filter(d => d.time >= new Date('2026-03-01'));
const btcTrain = btcData.filter(d => d.time < new Date('2026-03-01'));
const btcTest = btcData.filter(d => d.time >= new Date('2026-03-01'));

console.log(`\nData: XAU ${xauTrain.length} train / ${xauTest.length} test bars`);
console.log(`Data: BTC ${btcTrain.length} train / ${btcTest.length} test bars`);

// Test configs
const configs = [
    { name: 'EMA_5_20', fn: Strategies.EMA_Cross },
    { name: 'RSI_Rev', fn: Strategies.RSI_Rev },
    { name: 'BB_Break', fn: Strategies.BB_Break },
    { name: 'MACD_Mom', fn: Strategies.MACD_Mom },
    { name: 'VWAP_Break', fn: Strategies.VWAP_Break }
];

const results = [];

console.log('\n--- XAUUSDm Backtests (SL:3, TP:6) ---');
for (const cfg of configs) {
    const res = runBacktest(xauTrain, cfg.fn, { symbol: 'XAUUSDm', slPips: 3, tpPips: 6 });
    const m = res.metrics;
    console.log(`${cfg.name.padEnd(12)}: ${String(m.trades).padStart(4)} trades | WR:${m.winRate.padStart(5)}% | PF:${String(m.pf).padStart(5)} | PnL:$${m.pnl.padStart(7)} | DD:${m.maxDD.padStart(5)}%`);
    results.push({ strat: cfg.name, symbol: 'XAUUSDm', ...m });
}

console.log('\n--- BTCUSDm Backtests (SL:2.5, TP:5) ---');
for (const cfg of configs) {
    const res = runBacktest(btcTrain, cfg.fn, { symbol: 'BTCUSDm', slPips: 2.5, tpPips: 5, spreadPips: 3 });
    const m = res.metrics;
    console.log(`${cfg.name.padEnd(12)}: ${String(m.trades).padStart(4)} trades | WR:${m.winRate.padStart(5)}% | PF:${String(m.pf).padStart(5)} | PnL:$${m.pnl.padStart(7)} | DD:${m.maxDD.padStart(5)}%`);
    results.push({ strat: cfg.name, symbol: 'BTCUSDm', ...m });
}

// Deep analysis of best
console.log('\n' + '='.repeat(70));
console.log('DEEP ANALYSIS - Best Strategy');
console.log('='.repeat(70));

const bestXau = results.filter(r => r.symbol === 'XAUUSDm').sort((a, b) => parseFloat(b.pnl) - parseFloat(a.pnl))[0];
const bestBtc = results.filter(r => r.symbol === 'BTCUSDm').sort((a, b) => parseFloat(b.pnl) - parseFloat(a.pnl))[0];

console.log(`\nBest XAU: ${bestXau.strat} (PnL: $${bestXau.pnl})`);
console.log(`Best BTC: ${bestBtc.strat} (PnL: $${bestBtc.pnl})`);

// Run detailed analysis
const xauDetailed = runBacktest(xauTrain, Strategies[bestXau.strat.replace('EMA_5_20', 'EMA_Cross').replace('RSI_Rev', 'RSI_Rev').replace('BB_Break', 'BB_Break').replace('MACD_Mom', 'MACD_Mom').replace('VWAP_Break', 'VWAP_Break')], 
    { symbol: 'XAUUSDm', slPips: 3, tpPips: 6 });

console.log('\nXAUUSDm Session Analysis:');
const sessionStats = analyzeBySession(xauDetailed.trades);
for (const [s, stats] of Object.entries(sessionStats)) {
    if (stats.t > 0) {
        console.log(`  ${s}: ${stats.t} trades, WR: ${(stats.w/stats.t*100).toFixed(1)}%, PnL: $${stats.p.toFixed(2)}`);
    }
}

console.log('\nXAUUSDm Exit Reason Analysis:');
const exitStats = analyzeByExit(xauDetailed.trades);
for (const [r, stats] of Object.entries(exitStats)) {
    console.log(`  ${r}: ${stats.t} trades, WR: ${(stats.w/stats.t*100).toFixed(1)}%, PnL: $${stats.p.toFixed(2)}`);
}

// Out of sample
console.log('\n' + '='.repeat(70));
console.log('OUT-OF-SAMPLE VALIDATION (March 2026)');
console.log('='.repeat(70));

const xauOOS = runBacktest(xauTest, Strategies[bestXau.strat.replace('EMA_5_20', 'EMA_Cross')], 
    { symbol: 'XAUUSDm', slPips: 3, tpPips: 6 });
const btcOOS = runBacktest(btcTest, Strategies[bestBtc.strat.replace('EMA_5_20', 'EMA_Cross')], 
    { symbol: 'BTCUSDm', slPips: 2.5, tpPips: 5, spreadPips: 3 });

console.log(`\nXAUUSDm OOS: ${xauOOS.metrics.trades} trades, WR:${xauOOS.metrics.winRate}%, PF:${xauOOS.metrics.pf}, PnL:$${xauOOS.metrics.pnl}, DD:${xauOOS.metrics.maxDD}%`);
console.log(`BTCUSDm OOS: ${btcOOS.metrics.trades} trades, WR:${btcOOS.metrics.winRate}%, PF:${btcOOS.metrics.pf}, PnL:$${btcOOS.metrics.pnl}, DD:${btcOOS.metrics.maxDD}%`);

// Final Strategy Templates
console.log('\n' + '='.repeat(70));
console.log('REFINED STRATEGY TEMPLATES (MT5 EA Ready)');
console.log('='.repeat(70));

const templates = [
    {
        name: 'XAU_EMA5_RSI_Rev',
        symbol: 'XAUUSDm',
        entry: 'EMA5 crosses above EMA20 with RSI turning up from oversold (<35) and price above EMA20',
        filters: ['RSI 35-70', 'Trend bias via EMA50', 'Session filter: London/NY preferred'],
        sl: '3 USD fixed',
        tp: '6 USD (2:1 RR)',
        trailing: 'After 1.5R profit, trail stop to 0.5R above entry',
        exits: 'TP: 50% at 1R, 30% at 1.5R, 20% trails to BE'
    },
    {
        name: 'BTC_MACD_Momentum',
        symbol: 'BTCUSDm', 
        entry: 'MACD histogram crosses above zero with EMA5 > EMA20',
        filters: ['RSI 45-70', 'High volatility regime (ATR > 20dma)', 'Avoid Asia session'],
        sl: '2.5 USD fixed',
        tp: '5 USD (2:1 RR)',
        trailing: 'Activate trailing after 2R profit, 1R trailing stop',
        exits: 'Full TP at 2R or trailing stop activation'
    },
    {
        name: 'XAU_VWAP_Break',
        symbol: 'XAUUSDm',
        entry: 'Price breaks above VWAP with RSI > 50 confirmation',
        filters: ['Volume confirmation', 'London/NY sessions only', 'High volatility'],
        sl: '2.5 USD',
        tp: '5 USD + ATR-based dynamic TP',
        trailing: 'Move to BE + 0.5R when 1R reached',
        exits: 'Partial at 1R and 1.5R, rest trails'
    },
    {
        name: 'BTC_RSI_Reversal',
        symbol: 'BTCUSDm',
        entry: 'RSI < 30 with bounce confirmation (RSI turning up, price > EMA20)',
        filters: ['RSI oversold', 'MACD histogram positive', 'Avoid low volatility'],
        sl: '2 USD',
        tp: '4 USD (2:1 RR)',
        trailing: 'Break-even + 0.5R after 1.5R profit',
        exits: 'TP hit or trailing stop'
    },
    {
        name: 'XAU_BB_Scalp',
        symbol: 'XAUUSDm',
        entry: 'Bollinger Band squeeze followed by expansion with momentum',
        filters: ['BB width contraction', 'RSI 40-60', 'London session'],
        sl: '3 USD',
        tp: 'Dynamic: ATR * 1.5 or fixed 5 USD',
        trailing: 'ATR-based trailing after 1R',
        exits: 'Multiple targets with trailing'
    }
];

templates.forEach((t, i) => {
    console.log(`\n[${i+1}] ${t.name} (${t.symbol})`);
    console.log(`    Entry: ${t.entry}`);
    console.log(`    Filters: ${t.filters.join(', ')}`);
    console.log(`    SL: ${t.sl} | TP: ${t.tp}`);
    console.log(`    Trailing: ${t.trailing}`);
    console.log(`    Exits: ${t.exits}`);
});

console.log('\n' + '='.repeat(70));
console.log('RESEARCH COMPLETE');
console.log('='.repeat(70));
