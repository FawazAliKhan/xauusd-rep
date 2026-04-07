/**
 * MTF Scalping - Hourly Performance Analysis
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

function generateSignal(data) {
    const signals = new Array(data.length).fill(0);
    for (let i = 5; i < data.length; i++) {
        const curr = data[i], prev = data[i-1];
        const bullTrend = curr.ema5 > curr.ema13 && curr.ema13 > curr.ema20;
        const bearTrend = curr.ema5 < curr.ema13 && curr.ema13 < curr.ema20;
        
        if (bullTrend && curr.hist > 0 && curr.rsi > 45 && curr.rsi < 70) signals[i] = 1;
        if (bearTrend && curr.hist < 0 && curr.rsi < 55 && curr.rsi > 30) signals[i] = -1;
    }
    return signals;
}

function backtest(data, config) {
    const { sl, tp, spread } = config;
    const signals = generateSignal(data);
    
    const trades = [];
    let equity = 10000, pos = 0, entry = 0;
    
    for (let i = 1; i < data.length; i++) {
        const curr = data[i];
        if (pos === 0 && signals[i] !== 0 && signals[i] !== signals[i-1]) {
            pos = signals[i];
            entry = curr.close + spread * (pos > 0 ? 1 : -1);
        }
        if (pos !== 0) {
            if ((pos > 0 && curr.low <= entry - sl) || (pos < 0 && curr.high >= entry + sl)) {
                trades.push({ pnl: -sl - spread, hour: curr.hour });
                equity -= sl + spread;
                pos = 0;
            } else if ((pos > 0 && curr.high >= entry + tp) || (pos < 0 && curr.low <= entry - tp)) {
                trades.push({ pnl: tp - spread, hour: curr.hour });
                equity += tp - spread;
                pos = 0;
            } else if (i - (trades.length > 0 ? trades[trades.length-1].bar || i : i) > 30) {
                const exitPrice = curr.close - spread * (pos > 0 ? 1 : -1);
                trades.push({ pnl: (pos > 0 ? exitPrice - entry : entry - exitPrice) - spread, hour: curr.hour });
                equity += trades[trades.length-1].pnl;
                pos = 0;
            }
        }
    }
    return trades;
}

function analyzeByHour(trades) {
    const hourly = {};
    for (let h = 0; h < 24; h++) hourly[h] = { t: 0, w: 0, p: 0 };
    
    for (const t of trades) {
        const h = t.hour;
        hourly[h].t++;
        if (t.pnl > 0) hourly[h].w++;
        hourly[h].p += t.pnl;
    }
    
    return hourly;
}

console.log('='.repeat(60));
console.log('HOURLY PERFORMANCE ANALYSIS');
console.log('='.repeat(60));

// Load and prepare XAU data
const xau1m = engineer(loadCSV('XAUUSDm_1m_2026-02-01_to_2026-04-01.csv'));
const xau3m = engineer(loadCSV('XAUUSDm_3m_2026-02-01_to_2026-04-01.csv'));
const xau5m = engineer(loadCSV('XAUUSDm_5m_2026-02-01_to_2026-04-01.csv'));

const btc1m = engineer(loadCSV('BTCUSDm_1m_2026-02-01_to_2026-04-01.csv'));
const btc3m = engineer(loadCSV('BTCUSDm_3m_2026-02-01_to_2026-04-01.csv'));
const btc5m = engineer(loadCSV('BTCUSDm_5m_2026-02-01_to_2026-04-01.csv'));

const xauTrain = xau1m.filter(d => d.time < new Date('2026-03-01'));
const btcTrain = btc1m.filter(d => d.time < new Date('2026-03-01'));

// XAUUSDm
console.log('\n--- XAUUSDm HOURLY (SL: 2.50, TP: 5.00) ---');
const xauTrades = backtest(xauTrain, { sl: 2.50, tp: 5.00, spread: 0.30 });
const xauHourly = analyzeByHour(xauTrades);

console.log('Hour(UTC)  Trades  Wins  WR%    PnL     Avg  Session');
console.log('-'.repeat(55));

const sessionNames = { 0:'Asia', 1:'Asia', 2:'Asia', 3:'Asia', 4:'Asia', 5:'Asia', 6:'Asia',
                       7:'London', 8:'London', 9:'London', 10:'London', 11:'London',
                       12:'NY', 13:'NY', 14:'NY', 15:'NY', 16:'NY', 17:'NY',
                       18:'NY', 19:'Asia', 20:'Asia', 21:'Asia', 22:'Asia', 23:'Asia' };

let xauTotal = 0;
for (let h = 0; h < 24; h++) {
    const s = xauHourly[h];
    if (s.t > 0) {
        const wr = (s.w / s.t * 100).toFixed(0);
        const avg = (s.p / s.t).toFixed(2);
        console.log(`${String(h).padStart(2)}:00     ${String(s.t).padStart(5)} ${String(s.w).padStart(4)} ${wr.padStart(3)}%  $${s.p.toFixed(2).padStart(7)} ${avg.padStart(6)} ${sessionNames[h]}`);
        xauTotal += s.t;
    }
}
console.log(`\nTotal: ${xauTotal} trades`);

// BTCUSDm
console.log('\n--- BTCUSDm HOURLY (SL: 75, TP: 150) ---');
const btcTrades = backtest(btcTrain, { sl: 75, tp: 150, spread: 3 });
const btcHourly = analyzeByHour(btcTrades);

console.log('Hour(UTC)  Trades  Wins  WR%    PnL       Avg    Session');
console.log('-'.repeat(60));

let btcTotal = 0;
for (let h = 0; h < 24; h++) {
    const s = btcHourly[h];
    if (s.t > 0) {
        const wr = (s.w / s.t * 100).toFixed(0);
        const avg = (s.p / s.t).toFixed(2);
        console.log(`${String(h).padStart(2)}:00     ${String(s.t).padStart(5)} ${String(s.w).padStart(4)} ${wr.padStart(3)}%  $${s.p.toFixed(2).padStart(9)} ${avg.padStart(8)} ${sessionNames[h]}`);
        btcTotal += s.t;
    }
}
console.log(`\nTotal: ${btcTotal} trades`);

// Best hours summary
console.log('\n' + '='.repeat(60));
console.log('BEST HOURS (by PnL)');
console.log('='.repeat(60));

console.log('\nXAUUSDm Top 5 Hours:');
const xauSorted = Object.entries(xauHourly).filter(([h, s]) => s.t > 0).sort((a, b) => b[1].p - a[1].p);
xauSorted.slice(0, 5).forEach(([h, s]) => {
    const wr = (s.w / s.t * 100).toFixed(0);
    console.log(`  ${h}:00 UTC - ${s.t} trades, WR ${wr}%, PnL $${s.p.toFixed(2)} (${sessionNames[h]})`);
});

console.log('\nBTCUSDm Top 5 Hours:');
const btcSorted = Object.entries(btcHourly).filter(([h, s]) => s.t > 0).sort((a, b) => b[1].p - a[1].p);
btcSorted.slice(0, 5).forEach(([h, s]) => {
    const wr = (s.w / s.t * 100).toFixed(0);
    console.log(`  ${h}:00 UTC - ${s.t} trades, WR ${wr}%, PnL $${s.p.toFixed(2)} (${sessionNames[h]})`);
});

// Worst hours
console.log('\n' + '='.repeat(60));
console.log('AVOID THESE HOURS:');
console.log('='.repeat(60));

console.log('\nXAUUSDm Bottom 5 Hours:');
xauSorted.slice(-5).reverse().forEach(([h, s]) => {
    const wr = (s.w / s.t * 100).toFixed(0);
    console.log(`  ${h}:00 UTC - ${s.t} trades, WR ${wr}%, PnL $${s.p.toFixed(2)} (${sessionNames[h]})`);
});

console.log('\nBTCUSDm Bottom 5 Hours:');
btcSorted.slice(-5).reverse().forEach(([h, s]) => {
    const wr = (s.w / s.t * 100).toFixed(0);
    console.log(`  ${h}:00 UTC - ${s.t} trades, WR ${wr}%, PnL $${s.p.toFixed(2)} (${sessionNames[h]})`);
});

console.log('\n' + '='.repeat(60));
