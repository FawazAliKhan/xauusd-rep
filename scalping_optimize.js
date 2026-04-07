/**
 * Scalping Research - Parameter Optimization
 * Testing different SL/TP combinations
 */

const fs = require('fs');

function loadCSV(filepath) {
    const lines = fs.readFileSync(filepath, 'utf-8').trim().split('\n');
    const headers = lines[0].split(',');
    return lines.slice(1).map(l => {
        const v = l.split(',');
        const row = {};
        headers.forEach((h, i) => row[h] = h === 'time' ? new Date(v[i]) : parseFloat(v[i]));
        return row;
    });
}

function calculateEMA(prices, period) {
    const k = 2 / (period + 1);
    let prev = prices[0];
    return prices.map(p => prev = p * k + prev * (1 - k));
}

function calculateRSI(prices, period = 14) {
    const rsi = [50];
    let gains = [], losses = [];
    for (let i = 1; i < prices.length; i++) {
        const chg = prices[i] - prices[i-1];
        gains.push(chg > 0 ? chg : 0);
        losses.push(chg < 0 ? -chg : 0);
        if (i >= period) {
            const ag = gains.slice(-period).reduce((a,b) => a+b, 0) / period;
            const al = losses.slice(-period).reduce((a,b) => a+b, 0) / period;
            rsi.push(al === 0 ? 100 : 100 - 100/(1 + ag/al));
        } else rsi.push(50);
    }
    return rsi;
}

function engineer(data) {
    const close = data.map(d => d.close);
    const ema5 = calculateEMA(close, 5);
    const ema8 = calculateEMA(close, 8);
    const ema13 = calculateEMA(close, 13);
    const ema20 = calculateEMA(close, 20);
    const ema50 = calculateEMA(close, 50);
    const rsi = calculateRSI(close, 14);
    
    return data.map((d, i) => {
        const hour = d.time.getUTCHours();
        let session = 'ny';
        if (hour < 7) session = 'asia';
        else if (hour < 12) session = 'london';
        return { 
            ...d, ema5: ema5[i], ema8: ema8[i], ema13: ema13[i], 
            ema20: ema20[i], ema50: ema50[i], rsi: rsi[i], session
        };
    });
}

function backtest(data, config) {
    const { symbol, sl, tp, spread, signalType } = config;
    const signals = generateSignals(data, signalType);
    
    const trades = [];
    let equity = 10000, pos = 0, entry = 0, entryBar = 0;
    
    for (let i = 1; i < data.length; i++) {
        const curr = data[i], prev = data[i-1];
        const sig = signals[i], prevSig = signals[i-1];
        
        if (pos === 0 && sig !== 0 && sig !== prevSig) {
            pos = sig; entry = curr.close + spread * (pos > 0 ? 1 : -1); entryBar = i;
        }
        
        if (pos !== 0) {
            const profit = pos > 0 ? curr.close - entry : entry - curr.close;
            let exit = false, exitPrice = 0, reason = '';
            
            if (pos > 0 && curr.low <= entry - sl) { exit = true; exitPrice = entry - sl; reason = 'SL'; }
            else if (pos < 0 && curr.high >= entry + sl) { exit = true; exitPrice = entry + sl; reason = 'SL'; }
            else if (pos > 0 && curr.high >= entry + tp) { exit = true; exitPrice = entry + tp; reason = 'TP'; }
            else if (pos < 0 && curr.low <= entry - tp) { exit = true; exitPrice = entry - tp; reason = 'TP'; }
            else if (i - entryBar >= 15) { exit = true; exitPrice = curr.close - spread * (pos > 0 ? 1 : -1); reason = 'TIME'; }
            
            if (exit) {
                const pnl = (pos > 0 ? exitPrice - entry : entry - exitPrice) - spread;
                trades.push({ dir: pos, pnl, reason, dur: i - entryBar, session: curr.session });
                equity += pnl; pos = 0;
            }
        }
    }
    
    return { trades, equity, metrics: calcMetrics(trades, equity) };
}

function generateSignals(data, signalType) {
    const signals = new Array(data.length).fill(0);
    
    for (let i = 5; i < data.length; i++) {
        const curr = data[i], prev = data[i-1];
        const rsi = curr.rsi;
        
        switch(signalType) {
            case 'ema_cross':
                // Simple EMA crossover
                if (curr.ema5 > curr.ema13 && prev.ema5 <= prev.ema13 && rsi > 40 && rsi < 70) signals[i] = 1;
                if (curr.ema5 < curr.ema13 && prev.ema5 >= prev.ema13 && rsi > 30 && rsi < 60) signals[i] = -1;
                break;
                
            case 'rsi_extreme':
                // RSI at extremes with confirmation
                if (rsi <= 35 && rsi > prev.rsi && curr.ema5 > curr.ema20) signals[i] = 1;
                if (rsi >= 65 && rsi < prev.rsi && curr.ema5 < curr.ema20) signals[i] = -1;
                break;
                
            case 'momentum':
                // Strong momentum continuation
                const bull = curr.ema5 > curr.ema13 && curr.ema13 > curr.ema20;
                const bear = curr.ema5 < curr.ema13 && curr.ema13 < curr.ema20;
                const rsiOk = rsi > 45 && rsi < 65;
                const sessionOk = curr.session !== 'asia';
                
                if (bull && rsiOk && sessionOk) signals[i] = 1;
                if (bear && rsiOk && sessionOk) signals[i] = -1;
                break;
                
            case 'vwap_reversal':
                // VWAP bounce
                if (rsi <= 40 && rsi > prev.rsi && curr.close > curr.ema20) signals[i] = 1;
                if (rsi >= 60 && rsi < prev.rsi && curr.close < curr.ema20) signals[i] = -1;
                break;
        }
    }
    return signals;
}

function calcMetrics(trades, equity) {
    if (!trades.length) return { t: 0, wr: '0', pf: '0', pnl: '0', dd: '0' };
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const tw = wins.reduce((a,b) => a+b.pnl, 0);
    const tl = Math.abs(losses.reduce((a,b) => a+b.pnl, 0));
    
    return {
        t: trades.length, 
        wr: (wins.length / trades.length * 100).toFixed(1),
        pf: tl > 0 ? (tw / tl).toFixed(2) : '999',
        pnl: (equity - 10000).toFixed(2),
        dd: '0.00'
    };
}

// MAIN
console.log('='.repeat(70));
console.log('SCALPING PARAMETER OPTIMIZATION');
console.log('Testing SL/TP combinations');
console.log('='.repeat(70));

const xauRaw = loadCSV('XAUUSDm_1m_2026-02-01_to_2026-04-01.csv');
const btcRaw = loadCSV('BTCUSDm_1m_2026-02-01_to_2026-04-01.csv');

const xau = engineer(xauRaw);
const btc = engineer(btcRaw);

const xauTrain = xau.filter(d => d.time < new Date('2026-03-01'));
const xauTest = xau.filter(d => d.time >= new Date('2026-03-01'));
const btcTrain = btc.filter(d => d.time < new Date('2026-03-01'));
const btcTest = btc.filter(d => d.time >= new Date('2026-03-01'));

const strategies = ['ema_cross', 'rsi_extreme', 'momentum', 'vwap_reversal'];
const xauParams = [
    { sl: 2, tp: 2, spread: 2 },
    { sl: 2, tp: 3, spread: 2 },
    { sl: 2, tp: 4, spread: 2 },
    { sl: 3, tp: 3, spread: 2 },
    { sl: 3, tp: 4, spread: 2 },
    { sl: 3, tp: 5, spread: 2 },
    { sl: 3, tp: 6, spread: 2 },
    { sl: 4, tp: 4, spread: 2 },
    { sl: 4, tp: 6, spread: 2 },
    { sl: 4, tp: 8, spread: 2 },
];

const btcParams = [
    { sl: 2, tp: 2, spread: 3 },
    { sl: 2, tp: 3, spread: 3 },
    { sl: 2.5, tp: 2.5, spread: 3 },
    { sl: 2.5, tp: 3.5, spread: 3 },
    { sl: 2.5, tp: 5, spread: 3 },
    { sl: 3, tp: 3, spread: 3 },
    { sl: 3, tp: 4.5, spread: 3 },
    { sl: 3, tp: 6, spread: 3 },
];

console.log('\n--- XAUUSDm PARAMETER SWEEP ---');
console.log('Strategy        SL  TP  Trades  WR%   PF    PnL');
console.log('-'.repeat(55));

const xauResults = [];

for (const params of xauParams) {
    for (const strat of strategies) {
        const res = backtest(xauTrain, { ...params, symbol: 'XAUUSDm', signalType: strat });
        if (res.metrics.t > 20) {
            xauResults.push({ strat, ...params, ...res.metrics });
            console.log(`${strat.padEnd(14)} ${params.sl}  ${params.tp}  ${String(res.metrics.t).padStart(6)}  ${res.metrics.wr.padStart(5)}%  ${res.metrics.pf.padStart(5)}  $${res.metrics.pnl}`);
        }
    }
}

console.log('\n--- BTCUSDm PARAMETER SWEEP ---');
console.log('Strategy        SL   TP  Trades  WR%   PF    PnL');
console.log('-'.repeat(55));

const btcResults = [];

for (const params of btcParams) {
    for (const strat of strategies) {
        const res = backtest(btcTrain, { ...params, symbol: 'BTCUSDm', signalType: strat });
        if (res.metrics.t > 20) {
            btcResults.push({ strat, ...params, ...res.metrics });
            console.log(`${strat.padEnd(14)} ${params.sl}  ${params.tp}  ${String(res.metrics.t).padStart(6)}  ${res.metrics.wr.padStart(5)}%  ${res.metrics.pf.padStart(5)}  $${res.metrics.pnl}`);
        }
    }
}

// Best combos
console.log('\n' + '='.repeat(70));
console.log('BEST COMBINATIONS');
console.log('='.repeat(70));

const bestXau = xauResults.sort((a, b) => parseFloat(b.pnl) - parseFloat(a.pnl))[0];
const bestBtc = btcResults.sort((a, b) => parseFloat(b.pnl) - parseFloat(a.pnl))[0];

console.log('\nXAUUSDm Best:');
console.log(`  Strategy: ${bestXau.strat}`);
console.log(`  SL: ${bestXau.sl}, TP: ${bestXau.tp}`);
console.log(`  Trades: ${bestXau.t}, WR: ${bestXau.wr}%, PF: ${bestXau.pf}, PnL: $${bestXau.pnl}`);

console.log('\nBTCUSDm Best:');
console.log(`  Strategy: ${bestBtc.strat}`);
console.log(`  SL: ${bestBtc.sl}, TP: ${bestBtc.tp}`);
console.log(`  Trades: ${bestBtc.t}, WR: ${bestBtc.wr}%, PF: ${bestBtc.pf}, PnL: $${bestBtc.pnl}`);

// Out of sample
console.log('\n' + '='.repeat(70));
console.log('OUT-OF-SAMPLE VALIDATION');
console.log('='.repeat(70));

const xauOOS = backtest(xauTest, { ...bestXau, symbol: 'XAUUSDm' });
const btcOOS = backtest(btcTest, { ...bestBtc, symbol: 'BTCUSDm' });

console.log(`\nXAUUSDm OOS: ${xauOOS.metrics.t} trades, WR: ${xauOOS.metrics.wr}%, PF: ${xauOOS.metrics.pf}, PnL: $${xauOOS.metrics.pnl}`);
console.log(`BTCUSDm OOS: ${btcOOS.metrics.t} trades, WR: ${btcOOS.metrics.wr}%, PF: ${btcOOS.metrics.pf}, PnL: $${btcOOS.metrics.pnl}`);

// Deep analysis
console.log('\n' + '='.repeat(70));
console.log('EXIT REASON ANALYSIS');
console.log('='.repeat(70));

const xauTrades = backtest(xauTrain, { ...bestXau, symbol: 'XAUUSDm' }).trades;
const btcTrades = backtest(btcTrain, { ...bestBtc, symbol: 'BTCUSDm' }).trades;

console.log('\nXAUUSDm Exit Reasons:');
const xauExitStats = {};
for (const t of xauTrades) {
    if (!xauExitStats[t.reason]) xauExitStats[t.reason] = { t: 0, w: 0 };
    xauExitStats[t.reason].t++;
    xauExitStats[t.reason].w += t.pnl > 0 ? 1 : 0;
}
for (const [r, s] of Object.entries(xauExitStats)) {
    console.log(`  ${r}: ${s.t} trades, WR: ${(s.w/s.t*100).toFixed(1)}%`);
}

console.log('\nBTCUSDm Exit Reasons:');
const btcExitStats = {};
for (const t of btcTrades) {
    if (!btcExitStats[t.reason]) btcExitStats[t.reason] = { t: 0, w: 0 };
    btcExitStats[t.reason].t++;
    btcExitStats[t.reason].w += t.pnl > 0 ? 1 : 0;
}
for (const [r, s] of Object.entries(btcExitStats)) {
    console.log(`  ${r}: ${s.t} trades, WR: ${(s.w/s.t*100).toFixed(1)}%`);
}

// Session analysis
console.log('\n' + '='.repeat(70));
console.log('SESSION ANALYSIS');
console.log('='.repeat(70));

console.log('\nXAUUSDm Session Performance:');
const xauSessStats = {};
for (const t of xauTrades) {
    if (!xauSessStats[t.session]) xauSessStats[t.session] = { t: 0, w: 0, p: 0 };
    xauSessStats[t.session].t++;
    xauSessStats[t.session].w += t.pnl > 0 ? 1 : 0;
    xauSessStats[t.session].p += t.pnl;
}
for (const [s, stats] of Object.entries(xauSessStats)) {
    console.log(`  ${s}: ${stats.t} trades, WR: ${(stats.w/stats.t*100).toFixed(1)}%, PnL: $${stats.p.toFixed(2)}`);
}

console.log('\nBTCUSDm Session Performance:');
const btcSessStats = {};
for (const t of btcTrades) {
    if (!btcSessStats[t.session]) btcSessStats[t.session] = { t: 0, w: 0, p: 0 };
    btcSessStats[t.session].t++;
    btcSessStats[t.session].w += t.pnl > 0 ? 1 : 0;
    btcSessStats[t.session].p += t.pnl;
}
for (const [s, stats] of Object.entries(btcSessStats)) {
    console.log(`  ${s}: ${stats.t} trades, WR: ${(stats.w/stats.t*100).toFixed(1)}%, PnL: $${stats.p.toFixed(2)}`);
}

// Final Templates
console.log('\n' + '='.repeat(70));
console.log('OPTIMIZED STRATEGY TEMPLATES (MT5 EA Ready)');
console.log('='.repeat(70));

const templates = [
    {
        name: 'XAUUSDm_OPTIMAL',
        strategy: bestXau.strat,
        asset: 'XAUUSDm',
        parameters: { sl: bestXau.sl, tp: bestXau.tp, spread: 2 },
        entry: `EMA-based signal with ${bestXau.strat.replace('_', ' ')} confirmation`,
        filters: [
            'Trend: EMA 5 > EMA 13 for longs, reverse for shorts',
            'RSI: 40-70 for longs, 30-60 for shorts',
            'Session: Non-Asia preferred',
            'Momentum confirmation'
        ],
        trade_management: [
            `Fixed SL: ${bestXau.sl} USD`,
            `Fixed TP: ${bestXau.tp} USD`,
            'Time exit: 15 bars if neither hit',
            'Trail to BE after 1R (optional)'
        ],
        risk: '1-2% per trade, 3-5% daily max'
    },
    {
        name: 'BTCUSDm_OPTIMAL',
        strategy: bestBtc.strat,
        asset: 'BTCUSDm',
        parameters: { sl: bestBtc.sl, tp: bestBtc.tp, spread: 3 },
        entry: `${bestBtc.strat.replace('_', ' ')} signal with trend confirmation`,
        filters: [
            'Strong momentum alignment',
            'Session filter (avoid Asia)',
            'RSI within range',
            'EMA trend confirmation'
        ],
        trade_management: [
            `Fixed SL: ${bestBtc.sl} USD`,
            `Fixed TP: ${bestBtc.tp} USD`,
            '15-bar time exit',
            'Partial scale-out at 1R'
        ],
        risk: '1-2% per trade, 3-5% daily max'
    }
];

templates.forEach((t, i) => {
    console.log(`\n[${i+1}] ${t.name} (${t.asset})`);
    console.log(`    Strategy: ${t.strategy}`);
    console.log(`    Parameters: SL ${t.parameters.sl}, TP ${t.parameters.tp}`);
    console.log(`    Entry: ${t.entry}`);
    console.log(`    Filters: ${t.filters.join(' | ')}`);
    console.log(`    Management: ${t.trade_management.join(' | ')}`);
    console.log(`    Risk: ${t.risk}`);
});

console.log('\n' + '='.repeat(70));
console.log('RESEARCH COMPLETE');
console.log('='.repeat(70));
