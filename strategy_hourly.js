/**
 * MTF Scalping - Strategy-Specific Hourly Analysis
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
    const ema13 = calculateEMA(close, 13);
    const ema20 = calculateEMA(close, 20);
    const rsi = calculateRSI(close, 14);
    
    const ema12 = calculateEMA(close, 12);
    const ema26 = calculateEMA(close, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = calculateEMA(macdLine, 9);
    const hist = macdLine.map((m, i) => m - signalLine[i]);
    
    return data.map((d, i) => {
        const hour = d.time.getUTCHours();
        return { ...d, ema5: ema5[i], ema13: ema13[i], ema20: ema20[i], rsi: rsi[i], hist: hist[i], hour };
    });
}

const strategies = {
    EMA_CROSS: (data) => {
        const signals = new Array(data.length).fill(0);
        for (let i = 5; i < data.length; i++) {
            const curr = data[i], prev = data[i-1];
            if (curr.ema5 > curr.ema13 && prev.ema5 <= prev.ema13) signals[i] = 1;
            if (curr.ema5 < curr.ema13 && prev.ema5 >= prev.ema13) signals[i] = -1;
        }
        return signals;
    },
    
    TREND_FOLLOW: (data) => {
        const signals = new Array(data.length).fill(0);
        for (let i = 5; i < data.length; i++) {
            const curr = data[i];
            const bull = curr.ema5 > curr.ema13 && curr.ema13 > curr.ema20;
            const bear = curr.ema5 < curr.ema13 && curr.ema13 < curr.ema20;
            if (bull && curr.rsi > 50 && curr.rsi < 70) signals[i] = 1;
            if (bear && curr.rsi < 50 && curr.rsi > 30) signals[i] = -1;
        }
        return signals;
    },
    
    MACD_MOMENTUM: (data) => {
        const signals = new Array(data.length).fill(0);
        for (let i = 5; i < data.length; i++) {
            const curr = data[i], prev = data[i-1];
            const histUp = curr.hist > 0 && prev.hist <= 0;
            const histDown = curr.hist < 0 && prev.hist >= 0;
            if (histUp && curr.ema5 > curr.ema20 && curr.rsi > 45) signals[i] = 1;
            if (histDown && curr.ema5 < curr.ema20 && curr.rsi < 55) signals[i] = -1;
        }
        return signals;
    },
    
    RSI_REVERSAL: (data) => {
        const signals = new Array(data.length).fill(0);
        for (let i = 5; i < data.length; i++) {
            const curr = data[i], prev = data[i-1];
            if (curr.rsi <= 40 && curr.rsi > prev.rsi) signals[i] = 1;
            if (curr.rsi >= 60 && curr.rsi < prev.rsi) signals[i] = -1;
        }
        return signals;
    },
    
    MOMENTUM_QUALITY: (data) => {
        const signals = new Array(data.length).fill(0);
        for (let i = 5; i < data.length; i++) {
            const curr = data[i];
            const bull = curr.ema5 > curr.ema13 && curr.ema13 > curr.ema20;
            const bear = curr.ema5 < curr.ema13 && curr.ema13 < curr.ema20;
            const bullMom = curr.hist > 0 && curr.rsi > 50 && curr.rsi < 70;
            const bearMom = curr.hist < 0 && curr.rsi < 50 && curr.rsi > 30;
            if (bull && bullMom) signals[i] = 1;
            if (bear && bearMom) signals[i] = -1;
        }
        return signals;
    }
};

function backtest(data, config) {
    const { sl, tp, spread, strategyType } = config;
    const signals = strategies[strategyType](data);
    
    const trades = [];
    let pos = 0, entry = 0, entryBar = 0, highPrice = 0, lowPrice = Infinity;
    
    for (let i = 1; i < data.length; i++) {
        const curr = data[i];
        if (pos === 0 && signals[i] !== 0 && signals[i] !== signals[i-1]) {
            pos = signals[i];
            entry = curr.close + spread * (pos > 0 ? 1 : -1);
            entryBar = i;
            highPrice = curr.high;
            lowPrice = curr.low;
        }
        if (pos > 0) highPrice = Math.max(highPrice, curr.high);
        if (pos < 0) lowPrice = Math.min(lowPrice, curr.low);
        
        if (pos !== 0) {
            let exit = false, exitPrice = 0, reason = '';
            const dist = pos > 0 ? highPrice - entry : entry - lowPrice;
            
            if (pos > 0 && curr.low <= entry - sl) { exit = true; exitPrice = entry - sl; reason = 'SL'; }
            else if (pos < 0 && curr.high >= entry + sl) { exit = true; exitPrice = entry + sl; reason = 'SL'; }
            else if (pos > 0 && curr.high >= entry + tp) { exit = true; exitPrice = entry + tp; reason = 'TP'; }
            else if (pos < 0 && curr.low <= entry - tp) { exit = true; exitPrice = entry - tp; reason = 'TP'; }
            else if (dist >= sl && curr.low <= highPrice - sl * 0.5) { 
                exit = true; exitPrice = highPrice - sl * 0.5; reason = 'TRAIL'; 
            }
            else if (i - entryBar >= 25) { exit = true; exitPrice = curr.close - spread * (pos > 0 ? 1 : -1); reason = 'TIME'; }
            
            if (exit) {
                const pnl = (pos > 0 ? exitPrice - entry : entry - exitPrice) - spread;
                trades.push({ pnl, hour: curr.hour, reason, rr: (pos > 0 ? curr.close - entry : entry - curr.close) / sl });
                pos = 0;
            }
        }
    }
    return trades;
}

function analyzeByHour(trades) {
    const hourly = {};
    for (let h = 0; h < 24; h++) hourly[h] = { t: 0, w: 0, p: 0, rr: 0 };
    for (const t of trades) {
        hourly[t.hour].t++;
        if (t.pnl > 0) hourly[t.hour].w++;
        hourly[t.hour].p += t.pnl;
        hourly[t.hour].rr += t.rr;
    }
    return hourly;
}

console.log('='.repeat(70));
console.log('STRATEGY-SPECIFIC HOURLY ANALYSIS');
console.log('='.repeat(70));

const xauRaw = engineer(loadCSV('XAUUSDm_1m_2026-02-01_to_2026-04-01.csv'));
const btcRaw = engineer(loadCSV('BTCUSDm_1m_2026-02-01_to_2026-04-01.csv'));

const xauTrain = xauRaw.filter(d => d.time < new Date('2026-03-01'));
const btcTrain = btcRaw.filter(d => d.time < new Date('2026-03-01'));

const stratNames = ['EMA_CROSS', 'TREND_FOLLOW', 'MACD_MOMENTUM', 'RSI_REVERSAL', 'MOMENTUM_QUALITY'];

// XAUUSDm
console.log('\n============================================================');
console.log('XAUUSDm - BY STRATEGY');
console.log('SL: 2.50 | TP: 5.00');
console.log('============================================================');

for (const strat of stratNames) {
    const trades = backtest(xauTrain, { sl: 2.50, tp: 5.00, spread: 0.30, strategyType: strat });
    if (trades.length === 0) continue;
    
    const hourly = analyzeByHour(trades);
    console.log(`\n>>> ${strat} (${trades.length} total trades)`);
    console.log('Hour   Trades  WR%    PnL     AvgRR  Session');
    console.log('-'.repeat(50));
    
    const sessionMap = { 0:'Asia', 7:'London', 12:'NY' };
    for (let h = 0; h < 24; h++) {
        const s = hourly[h];
        if (s.t > 3) {  // Only show hours with 3+ trades
            const wr = (s.w / s.t * 100).toFixed(0);
            const avg = (s.p / s.t).toFixed(2);
            const avgRR = (s.rr / s.t).toFixed(2);
            const sess = h < 7 ? 'Asia' : h < 12 ? 'London' : 'NY';
            console.log(`${String(h).padStart(2)}:00   ${String(s.t).padStart(5)} ${wr.padStart(3)}%  $${s.p.toFixed(2).padStart(7)} ${avgRR.padStart(5)} ${sess}`);
        }
    }
}

// BTCUSDm
console.log('\n\n============================================================');
console.log('BTCUSDm - BY STRATEGY');
console.log('SL: 75 | TP: 150');
console.log('============================================================');

for (const strat of stratNames) {
    const trades = backtest(btcTrain, { sl: 75, tp: 150, spread: 3, strategyType: strat });
    if (trades.length === 0) continue;
    
    const hourly = analyzeByHour(trades);
    console.log(`\n>>> ${strat} (${trades.length} total trades)`);
    console.log('Hour   Trades  WR%    PnL       AvgRR  Session');
    console.log('-'.repeat(55));
    
    for (let h = 0; h < 24; h++) {
        const s = hourly[h];
        if (s.t > 3) {
            const wr = (s.w / s.t * 100).toFixed(0);
            const avg = (s.p / s.t).toFixed(2);
            const avgRR = (s.rr / s.t).toFixed(2);
            const sess = h < 7 ? 'Asia' : h < 12 ? 'London' : 'NY';
            console.log(`${String(h).padStart(2)}:00   ${String(s.t).padStart(5)} ${wr.padStart(3)}%  $${s.p.toFixed(2).padStart(9)} ${avgRR.padStart(5)} ${sess}`);
        }
    }
}

// Summary table
console.log('\n\n============================================================');
console.log('BEST HOURS SUMMARY BY STRATEGY');
console.log('============================================================');

console.log('\n--- XAUUSDm ---');
for (const strat of stratNames) {
    const trades = backtest(xauTrain, { sl: 2.50, tp: 5.00, spread: 0.30, strategyType: strat });
    if (trades.length === 0) continue;
    const hourly = analyzeByHour(trades);
    const sorted = Object.entries(hourly).filter(([h, s]) => s.t > 0).sort((a, b) => b[1].p - a[1].p);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    console.log(`\n${strat}:`);
    console.log(`  Best:  ${best[0]}:00 UTC - WR ${(best[1].w/best[1].t*100).toFixed(0)}%, PnL $${best[1].p.toFixed(2)}`);
    console.log(`  Worst: ${worst[0]}:00 UTC - WR ${(worst[1].w/worst[1].t*100).toFixed(0)}%, PnL $${worst[1].p.toFixed(2)}`);
}

console.log('\n--- BTCUSDm ---');
for (const strat of stratNames) {
    const trades = backtest(btcTrain, { sl: 75, tp: 150, spread: 3, strategyType: strat });
    if (trades.length === 0) continue;
    const hourly = analyzeByHour(trades);
    const sorted = Object.entries(hourly).filter(([h, s]) => s.t > 0).sort((a, b) => b[1].p - a[1].p);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    console.log(`\n${strat}:`);
    console.log(`  Best:  ${best[0]}:00 UTC - WR ${(best[1].w/best[1].t*100).toFixed(0)}%, PnL $${best[1].p.toFixed(2)}`);
    console.log(`  Worst: ${worst[0]}:00 UTC - WR ${(worst[1].w/worst[1].t*100).toFixed(0)}%, PnL $${worst[1].p.toFixed(2)}`);
}

console.log('\n' + '='.repeat(70));
