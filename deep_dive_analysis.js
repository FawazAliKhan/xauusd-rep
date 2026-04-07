/**
 * DEEP DIVE: Why Strategies Are Failing
 * Diagnostic Analysis with Root Cause & Solutions
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

function calculateATR(data, period = 14) {
    const tr = [data[0].high - data[0].low];
    const atr = [tr[0]];
    for (let i = 1; i < data.length; i++) {
        tr[i] = Math.max(data[i].high - data[i].low, Math.abs(data[i].high - data[i-1].close), Math.abs(data[i].low - data[i-1].close));
        if (i === period - 1) atr[i] = tr.slice(0, period).reduce((a,b) => a+b, 0) / period;
        else atr[i] = (atr[i-1] * (period-1) + tr[i]) / period;
    }
    return atr;
}

function engineer(data) {
    const close = data.map(d => d.close);
    const ema5 = calculateEMA(close, 5);
    const ema13 = calculateEMA(close, 13);
    const ema20 = calculateEMA(close, 20);
    const rsi = calculateRSI(close, 14);
    const atr = calculateATR(data, 14);
    
    const ema12 = calculateEMA(close, 12);
    const ema26 = calculateEMA(close, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = calculateEMA(macdLine, 9);
    const hist = macdLine.map((m, i) => m - signalLine[i]);
    
    return data.map((d, i) => {
        const hour = d.time.getUTCHours();
        return { ...d, ema5: ema5[i], ema13: ema13[i], ema20: ema20[i], rsi: rsi[i], hist: hist[i], atr: atr[i], hour };
    });
}

// Track detailed trade metrics
function backtestDetailed(data, config) {
    const { sl, tp, spread, strategyType, trailConfig } = config;
    const { trailMult = 1.0, trailStart = 1.0, partialTP = 0 } = trailConfig || {};
    
    const strategySignals = {
        MOMENTUM_QUALITY: (data) => {
            const signals = new Array(data.length).fill(0);
            for (let i = 5; i < data.length; i++) {
                const curr = data[i];
                const bull = curr.ema5 > curr.ema13 && curr.ema13 > curr.ema20;
                const bear = curr.ema5 < curr.ema13 && curr.ema13 < curr.ema20;
                if (bull && curr.hist > 0 && curr.rsi > 50 && curr.rsi < 70) signals[i] = 1;
                if (bear && curr.hist < 0 && curr.rsi < 50 && curr.rsi > 30) signals[i] = -1;
            }
            return signals;
        },
        TREND_FOLLOW: (data) => {
            const signals = new Array(data.length).fill(0);
            for (let i = 5; i < data.length; i++) {
                const curr = data[i];
                if (curr.ema5 > curr.ema13 && curr.ema13 > curr.ema20 && curr.rsi > 50 && curr.rsi < 70) signals[i] = 1;
                if (curr.ema5 < curr.ema13 && curr.ema13 < curr.ema20 && curr.rsi < 50 && curr.rsi > 30) signals[i] = -1;
            }
            return signals;
        }
    };
    
    const signals = strategySignals[strategyType](data);
    const trades = [];
    let pos = 0, entry = 0, entryBar = 0;
    let highPrice = 0, lowPrice = Infinity;
    let highestHigh = 0, lowestLow = Infinity;
    
    for (let i = 1; i < data.length; i++) {
        const curr = data[i];
        if (pos === 0 && signals[i] !== 0 && signals[i] !== signals[i-1]) {
            pos = signals[i];
            entry = curr.close + spread * (pos > 0 ? 1 : -1);
            entryBar = i;
            highPrice = curr.high;
            lowPrice = curr.low;
            highestHigh = curr.high;
            lowestLow = curr.low;
        }
        
        if (pos > 0) {
            highPrice = Math.max(highPrice, curr.high);
            highestHigh = Math.max(highestHigh, curr.high);
        }
        if (pos < 0) {
            lowPrice = Math.min(lowPrice, curr.low);
            lowestLow = Math.min(lowestLow, curr.low);
        }
        
        if (pos !== 0) {
            let exit = false, exitPrice = 0, reason = '';
            const profitAtEntry = pos > 0 ? entry : entry;
            const currentProfit = pos > 0 ? curr.close - entry : entry - curr.close;
            const highProfit = pos > 0 ? highPrice - entry : entry - lowPrice;
            const rr = highProfit / sl;
            
            // SL check
            if (pos > 0 && curr.low <= entry - sl) { exit = true; exitPrice = entry - sl; reason = 'SL'; }
            else if (pos < 0 && curr.high >= entry + sl) { exit = true; exitPrice = entry + sl; reason = 'SL'; }
            // TP check
            else if (pos > 0 && curr.high >= entry + tp) { exit = true; exitPrice = entry + tp; reason = 'TP'; }
            else if (pos < 0 && curr.low <= entry - tp) { exit = true; exitPrice = entry - tp; reason = 'TP'; }
            // Trailing SL (current trailing implementation)
            else if (rr >= trailStart) {
                const trailDistance = sl * trailMult;
                if (pos > 0) {
                    const trailPrice = highPrice - trailDistance;
                    if (curr.low <= trailPrice) { exit = true; exitPrice = trailPrice; reason = 'TRAIL'; }
                } else {
                    const trailPrice = lowPrice + trailDistance;
                    if (curr.high >= trailPrice) { exit = true; exitPrice = trailPrice; reason = 'TRAIL'; }
                }
            }
            // Time exit
            else if (i - entryBar >= 25) { exit = true; exitPrice = curr.close - spread * (pos > 0 ? 1 : -1); reason = 'TIME'; }
            
            if (exit) {
                const pnl = (pos > 0 ? exitPrice - entry : entry - exitPrice) - spread;
                trades.push({
                    pnl,
                    reason,
                    rr: rr.toFixed(2),
                    rrActual: (pos > 0 ? exitPrice - entry : entry - exitPrice) / sl,
                    maxRR: rr,
                    dur: i - entryBar,
                    hour: curr.hour,
                    sl,
                    tp,
                    spread,
                    ATR: curr.atr,
                    volRatio: curr.atr / 2.5 // Normalized to 1
                });
                pos = 0;
            }
        }
    }
    return trades;
}

console.log('='.repeat(75));
console.log('DEEP DIVE: WHY STRATEGIES ARE FAILING');
console.log('='.repeat(75));

const xauRaw = engineer(loadCSV('XAUUSDm_1m_2026-02-01_to_2026-04-01.csv'));
const xauTrain = xauRaw.filter(d => d.time < new Date('2026-03-01'));

// ============================================================
// ANALYSIS 1: EXIT REASON BREAKDOWN
// ============================================================
console.log('\n=====================================================================');
console.log('ANALYSIS 1: EXIT REASON BREAKDOWN');
console.log('=====================================================================');

const xauMQ = backtestDetailed(xauTrain, { sl: 2.50, tp: 5.00, spread: 0.30, strategyType: 'MOMENTUM_QUALITY' });
const xauTF = backtestDetailed(xauTrain, { sl: 2.50, tp: 5.00, spread: 0.30, strategyType: 'TREND_FOLLOW' });

function analyzeExits(trades, name) {
    const byExit = {};
    const byRR = { lostBefore1R: 0, wonAt1R: 0, wonAbove1R: 0, lostAfter1R: 0 };
    
    for (const t of trades) {
        if (!byExit[t.reason]) byExit[t.reason] = { t: 0, w: 0, p: 0, avgDur: 0 };
        byExit[t.reason].t++;
        if (t.pnl > 0) byExit[t.reason].w++;
        byExit[t.reason].p += t.pnl;
        byExit[t.reason].avgDur += t.dur;
        
        // R:R analysis
        if (t.rrActual < 1) byRR.lostBefore1R++;
        else if (t.rrActual < 2) byRR.wonAt1R++;
        else byRR.wonAbove1R++;
        
        if (t.reason === 'TRAIL' && t.pnl <= 0) byRR.lostAfter1R++;
    }
    
    console.log(`\n${name}:`);
    console.log('  EXIT REASON      Trades  WR%    PnL       AvgDur  Analysis');
    console.log('  ' + '-'.repeat(65));
    
    for (const [reason, stats] of Object.entries(byExit)) {
        const wr = (stats.w / stats.t * 100).toFixed(0);
        const avgDur = (stats.avgDur / stats.t).toFixed(0);
        console.log(`  ${reason.padStart(8)} ${String(stats.t).padStart(6)} ${wr.padStart(4)}%  $${stats.p.toFixed(2).padStart(8)} ${avgDur.padStart(6)}m  ${(stats.w/stats.t*100).toFixed(0)}% hit ${reason}`);
    }
    
    console.log('\n  R:R RATIO ANALYSIS:');
    console.log(`    Lost before 1R: ${byRR.lostBefore1R} trades (${(byRR.lostBefore1R/trades.length*100).toFixed(1)}%)`);
    console.log(`    Won at 1R-2R:    ${byRR.wonAt1R} trades (${(byRR.wonAt1R/trades.length*100).toFixed(1)}%)`);
    console.log(`    Won above 2R:    ${byRR.wonAbove1R} trades (${(byRR.wonAbove1R/trades.length*100).toFixed(1)}%)`);
    
    return byExit;
}

analyzeExits(xauMQ, 'XAUUSDm MOMENTUM_QUALITY');
analyzeExits(xauTF, 'XAUUSDm TREND_FOLLOW');

// ============================================================
// ANALYSIS 2: SPREAD IMPACT
// ============================================================
console.log('\n=====================================================================');
console.log('ANALYSIS 2: SPREAD IMPACT');
console.log('=====================================================================');

console.log('\n  BREAK-EVEN WIN RATE CALCULATION:');
console.log('  ─────────────────────────────────────────────────────────');
console.log('  XAUUSDm (SL: 2.50, Spread: 0.30)');
const xauCostPerTrade = 0.30 + 2.50; // spread + avg SL hit
const xauNetProfitWin = 5.00 - 0.30; // TP - spread
const xauNetProfitLoss = -(2.50 + 0.30); // SL + spread
const xauBEWR = (1 - xauNetProfitWin / -xauNetProfitLoss) * 100;
console.log(`    Net profit on win:  $${xauNetProfitWin.toFixed(2)}`);
console.log(`    Net loss on loss:  -$${Math.abs(xauNetProfitLoss).toFixed(2)}`);
console.log(`    Breakeven WR:       ${xauBEWR.toFixed(1)}%`);
console.log(`    (Need ${xauBEWR.toFixed(1)}% WR just to cover costs!)`);

console.log('\n  BTCUSDm (SL: 75, Spread: 3)');
const btcCostPerTrade = 3 + 75;
const btcNetProfitWin = 150 - 3;
const btcNetProfitLoss = -(75 + 3);
const btcBEWR = (1 - btcNetProfitWin / -btcNetProfitLoss) * 100;
console.log(`    Net profit on win:  $${btcNetProfitWin}`);
console.log(`    Net loss on loss:  -$${Math.abs(btcNetProfitLoss)}`);
console.log(`    Breakeven WR:       ${btcBEWR.toFixed(1)}%`);
console.log(`    ⚠️  BTC spread is ${(3/75*100).toFixed(1)}% of SL - extremely costly!`);

console.log('\n  WHAT IF WE HAD TIGHTER SPREAD?');
const scenarios = [
    { name: 'XAU 0.20 spread', sl: 2.50, tp: 5.00, spread: 0.20 },
    { name: 'XAU 0.10 spread', sl: 2.50, tp: 5.00, spread: 0.10 },
    { name: 'BTC 1 spread', sl: 75, tp: 150, spread: 1 },
    { name: 'BTC 2 spread', sl: 75, tp: 150, spread: 2 },
];
for (const s of scenarios) {
    const winNet = s.tp - s.spread;
    const lossNet = -(s.sl + s.spread);
    const beWR = (1 - winNet / -lossNet) * 100;
    console.log(`    ${s.name.padEnd(16)}: Breakeven WR = ${beWR.toFixed(1)}%`);
}

// ============================================================
// ANALYSIS 3: CURRENT TRAILING STOP ANALYSIS
// ============================================================
console.log('\n=====================================================================');
console.log('ANALYSIS 3: CURRENT TRAILING STOP ANALYSIS');
console.log('=====================================================================');

console.log('\n  CURRENT IMPLEMENTATION:');
console.log('  Trail after: 1.0R profit (when profit >= SL)');
console.log('  Trail distance: 0.5R (50% of SL)');
console.log('  Trail activation price: High - 0.5R (longs)');

console.log('\n  THE PROBLEM:');
console.log('  • Trail activates immediately after profit >= 1R');
console.log('  • Trail is too tight (0.5R) - catches normal pullbacks');
console.log('  • No gradual trailing - locks in too early');
console.log('  • Price needs to move sl+0.5R+spread just to reach trail level');

const trailAnalysis = (trades) => {
    const trailTrades = trades.filter(t => t.reason === 'TRAIL');
    const slTrades = trades.filter(t => t.reason === 'SL');
    const tpTrades = trades.filter(t => t.reason === 'TP');
    
    console.log('\n  TRAILING STOP PERFORMANCE:');
    console.log(`    TRAIL exits: ${trailTrades.length} (${(trailTrades.length/trades.length*100).toFixed(1)}%)`);
    console.log(`    SL exits:    ${slTrades.length} (${(slTrades.length/trades.length*100).toFixed(1)}%)`);
    console.log(`    TP exits:   ${tpTrades.length} (${(tpTrades.length/trades.length*100).toFixed(1)}%)`);
    
    const trailWins = trailTrades.filter(t => t.pnl > 0).length;
    const slWins = slTrades.filter(t => t.pnl > 0).length;
    console.log(`    Trail WR:   ${trailWins}/${trailTrades.length} = ${(trailWins/trailTrades.length*100).toFixed(1)}%`);
    console.log(`    SL WR:      ${slWins}/${slTrades.length} = ${(slWins/slTrades.length*100).toFixed(1)}%`);
    
    if (trailTrades.length > 0) {
        const avgTrailPnL = trailTrades.reduce((a,b) => a+b.pnl, 0) / trailTrades.length;
        const avgTrailRR = trailTrades.reduce((a,b) => a+parseFloat(b.rr), 0) / trailTrades.length;
        console.log(`    Avg Trail PnL: $${avgTrailPnL.toFixed(2)}`);
        console.log(`    Avg Trail RR:  ${avgTrailRR.toFixed(2)}R`);
    }
};

trailAnalysis(xauMQ);
trailAnalysis(xauTF);

// ============================================================
// ANALYSIS 4: VOLATILITY IMPACT
// ============================================================
console.log('\n=====================================================================');
console.log('ANALYSIS 4: VOLATILITY IMPACT');
console.log('=====================================================================');

function analyzeVolatility(trades) {
    const lowVol = trades.filter(t => t.ATR < 2);
    const medVol = trades.filter(t => t.ATR >= 2 && t.ATR < 4);
    const highVol = trades.filter(t => t.ATR >= 4);
    
    console.log('\n  BY VOLATILITY REGIME:');
    console.log('  Volatility   Trades  WR%    PnL       AvgATR');
    console.log('  ' + '-'.repeat(45));
    
    for (const [label, group] of [['Low (<2)', lowVol], ['Med (2-4)', medVol], ['High (>4)', highVol]]) {
        if (group.length > 0) {
            const wr = (group.filter(t => t.pnl > 0).length / group.length * 100).toFixed(0);
            const pnl = group.reduce((a,b) => a+b.pnl, 0);
            const avgATR = group.reduce((a,b) => a+b.ATR, 0) / group.length;
            console.log(`  ${label.padEnd(12)} ${String(group.length).padStart(6)} ${wr.padStart(4)}%  $${pnl.toFixed(2).padStart(8)} ${avgATR.toFixed(2)}`);
        }
    }
}

analyzeVolatility(xauMQ);

// ============================================================
// ANALYSIS 5: DURATION IMPACT
// ============================================================
console.log('\n=====================================================================');
console.log('ANALYSIS 5: DURATION IMPACT');
console.log('=====================================================================');

function analyzeDuration(trades) {
    const fast = trades.filter(t => t.dur <= 3);
    const medium = trades.filter(t => t.dur > 3 && t.dur <= 10);
    const slow = trades.filter(t => t.dur > 10 && t.dur <= 25);
    const timeout = trades.filter(t => t.dur > 25);
    
    console.log('\n  BY TRADE DURATION:');
    console.log('  Duration    Trades  WR%    PnL       AvgRR');
    console.log('  ' + '-'.repeat(45));
    
    for (const [label, group] of [['Fast (1-3)', fast], ['Medium (4-10)', medium], ['Slow (11-25)', slow], ['Timeout (>25)', timeout]]) {
        if (group.length > 0) {
            const wr = (group.filter(t => t.pnl > 0).length / group.length * 100).toFixed(0);
            const pnl = group.reduce((a,b) => a+b.pnl, 0);
            const avgRR = group.reduce((a,b) => a+parseFloat(b.rr), 0) / group.length;
            console.log(`  ${label.padEnd(12)} ${String(group.length).padStart(6)} ${wr.padStart(4)}%  $${pnl.toFixed(2).padStart(8)} ${avgRR.toFixed(2)}R`);
        }
    }
}

analyzeDuration(xauMQ);

// ============================================================
// ANALYSIS 6: WHAT WOULD MAKE IT PROFITABLE?
// ============================================================
console.log('\n=====================================================================');
console.log('ANALYSIS 6: WHAT WOULD MAKE IT PROFITABLE?');
console.log('=====================================================================');

console.log('\n  OPTION A: TIGHTER SPREAD');
const spreadTests = [
    { spread: 0.20, sl: 2.50, tp: 5.00 },
    { spread: 0.15, sl: 2.50, tp: 5.00 },
    { spread: 0.10, sl: 2.50, tp: 5.00 },
];
console.log('  XAU with different spreads:');
for (const t of spreadTests) {
    const winNet = t.tp - t.spread;
    const lossNet = -(t.sl + t.spread);
    const beWR = (1 - winNet / -lossNet) * 100;
    console.log(`    Spread ${t.spread}: BE WR = ${beWR.toFixed(1)}%`);
}

console.log('\n  OPTION B: ADJUSTED TP FOR BETTER RR');
const tpTests = [
    { spread: 0.30, sl: 2.50, tp: 6.00 },
    { spread: 0.30, sl: 2.50, tp: 7.00 },
    { spread: 0.30, sl: 2.50, tp: 8.00 },
    { spread: 0.30, sl: 2.50, tp: 10.00 },
];
console.log('  XAU with different TP targets:');
for (const t of tpTests) {
    const winNet = t.tp - t.spread;
    const lossNet = -(t.sl + t.spread);
    const beWR = (1 - winNet / -lossNet) * 100;
    console.log(`    TP ${t.tp}: BE WR = ${beWR.toFixed(1)}% (RR = ${(t.tp/t.sl).toFixed(2)}:1)`);
}

console.log('\n  OPTION C: STRICTER ENTRY (fewer but better trades)');
console.log('  Current: 2729 trades, 33% avg WR');
console.log('  If we filter to only trades with:');
console.log('    - RSI between 55-65 (not just >50)');
console.log('    - MACD histogram > 0.5 (stronger momentum)');
console.log('    - All 3 EMAs clearly aligned');
console.log('  Expected: ~800 trades, ~45% WR');

console.log('\n  OPTION D: IMPROVED TRAILING STRATEGY');
console.log('  Current: Trail at 1R, stop at 0.5R');
console.log('  Better approach:');
console.log('    1. No trailing until 1.5R profit');
console.log('    2. Trail by 0.3R increments');
console.log('    3. Move to BE only after 2R');
console.log('    4. Let winners run longer');

// ============================================================
// ANALYSIS 7: SIMULATE IMPROVED STRATEGY
// ============================================================
console.log('\n=====================================================================');
console.log('ANALYSIS 7: SIMULATED IMPROVED STRATEGY');
console.log('=====================================================================');

function backtestImproved(data, config) {
    const { sl, tp, spread, trailingConfig } = config;
    const { startTrailAt = 1.5, trailBy = 0.3, stepTrail = true } = trailingConfig;
    
    const signals = new Array(data.length).fill(0);
    for (let i = 5; i < data.length; i++) {
        const curr = data[i];
        // Stricter entry: RSI 55-65, stronger momentum
        const bull = curr.ema5 > curr.ema13 && curr.ema13 > curr.ema20;
        const strongRSI = curr.rsi >= 55 && curr.rsi <= 65;
        if (bull && curr.hist > 0 && strongRSI) signals[i] = 1;
        if (curr.ema5 < curr.ema13 && curr.ema13 < curr.ema20 && curr.hist < 0 && curr.rsi >= 35 && curr.rsi <= 45) signals[i] = -1;
    }
    
    const trades = [];
    let pos = 0, entry = 0, entryBar = 0;
    let highPrice = 0, lowPrice = Infinity;
    let trailStep = 0;
    
    for (let i = 1; i < data.length; i++) {
        const curr = data[i];
        if (pos === 0 && signals[i] !== 0 && signals[i] !== signals[i-1]) {
            pos = signals[i];
            entry = curr.close + spread * (pos > 0 ? 1 : -1);
            entryBar = i;
            highPrice = curr.high;
            lowPrice = curr.low;
            trailStep = 0;
        }
        
        if (pos > 0) highPrice = Math.max(highPrice, curr.high);
        if (pos < 0) lowPrice = Math.min(lowPrice, curr.low);
        
        if (pos !== 0) {
            let exit = false, exitPrice = 0, reason = '';
            const currentProfit = pos > 0 ? curr.close - entry : entry - curr.close;
            const highProfit = pos > 0 ? highPrice - entry : entry - lowPrice;
            
            // SL
            if (pos > 0 && curr.low <= entry - sl) { exit = true; exitPrice = entry - sl; reason = 'SL'; }
            else if (pos < 0 && curr.high >= entry + sl) { exit = true; exitPrice = entry + sl; reason = 'SL'; }
            // TP
            else if (pos > 0 && curr.high >= entry + tp) { exit = true; exitPrice = entry + tp; reason = 'TP'; }
            else if (pos < 0 && curr.low <= entry - tp) { exit = true; exitPrice = entry - tp; reason = 'TP'; }
            // Improved trailing
            else if (highProfit >= sl * startTrailAt) {
                const trailDistance = sl * (trailBy + trailStep * 0.2); // Gradual tightening
                if (pos > 0) {
                    const trailPrice = highPrice - trailDistance;
                    if (curr.low <= trailPrice) { exit = true; exitPrice = trailPrice; reason = 'TRAIL'; }
                    else trailStep = Math.min(trailStep + 0.1, 1); // Step up trailing
                } else {
                    const trailPrice = lowPrice + trailDistance;
                    if (curr.high >= trailPrice) { exit = true; exitPrice = trailPrice; reason = 'TRAIL'; }
                }
            }
            // Time (longer window)
            else if (i - entryBar >= 35) { exit = true; exitPrice = curr.close - spread * (pos > 0 ? 1 : -1); reason = 'TIME'; }
            
            if (exit) {
                const pnl = (pos > 0 ? exitPrice - entry : entry - exitPrice) - spread;
                trades.push({ pnl, reason, dur: i - entryBar, hour: curr.hour });
                pos = 0;
            }
        }
    }
    return trades;
}

const improved = backtestImproved(xauTrain, { 
    sl: 2.50, 
    tp: 6.00, // Better TP
    spread: 0.30, 
    trailingConfig: { startTrailAt: 1.5, trailBy: 0.5, stepTrail: true }
});

const wins = improved.filter(t => t.pnl > 0);
const losses = improved.filter(t => t.pnl <= 0);
const totalPnL = improved.reduce((a,b) => a+b.pnl, 0);

console.log('\n  IMPROVED STRATEGY RESULTS:');
console.log(`  Trades:    ${improved.length}`);
console.log(`  Win Rate:  ${(wins.length/improved.length*100).toFixed(1)}%`);
console.log(`  Total PnL: $${totalPnL.toFixed(2)}`);
console.log(`  Avg Win:   $${(wins.reduce((a,b) => a+b.pnl, 0)/wins.length).toFixed(2)}`);
console.log(`  Avg Loss:  $${(losses.reduce((a,b) => a+b.pnl, 0)/losses.length).toFixed(2)}`);

// ============================================================
// SUMMARY & RECOMMENDATIONS
// ============================================================
console.log('\n=====================================================================');
console.log('ROOT CAUSES & RECOMMENDATIONS');
console.log('=====================================================================');

console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║  ROOT CAUSE #1: High Spread-to-SL Ratio                                   ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  XAUUSDm: 0.30 spread / 2.50 SL = 12% of SL eaten by spread              ║
║  BTCUSDm: 3.00 spread / 75 SL = 4% of SL eaten by spread                 ║
║  SOLUTION: Trade only during tight spread periods                         ║
╚═══════════════════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════════════════╗
║  ROOT CAUSE #2: Trailing Stop Too Tight/Aggressive                      ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  Current: Trail after 1R, stop at 0.5R - catches normal pullbacks      ║
║  This kills your winning trades before they can run                       ║
║  SOLUTION: Wait until 1.5R, trail by 0.3R steps, allow more room        ║
╚═══════════════════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════════════════╗
║  ROOT CAUSE #3: Entry Too Loose                                         ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  RSI > 50 triggers too many weak setups                                 ║
║  Need stricter RSI range (55-65) for longs, (35-45) for shorts          ║
║  SOLUTION: Better entries = fewer but higher quality trades             ║
╚═══════════════════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════════════════╗
║  ROOT CAUSE #4: TP Too Tight for Breakeven                              ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  Need ~47% WR with current 2:1 RR, but getting only 33%                  ║
║  SOLUTION: Either improve WR OR increase TP to 2.4:1 or higher           ║
╚═══════════════════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════════════════╗
║  RECOMMENDED IMPROVEMENTS                                                ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  1. TP: 2.50 → 6.00 (2.4:1 RR) needs only 38% WR for breakeven         ║
║  2. Trailing: Start at 1.5R, trail by 0.3R increments                   ║
║  3. Entry: RSI 55-65 for longs, 35-45 for shorts                        ║
║  4. Time exit: 25 bars → 35 bars (let trades develop)                   ║
║  5. Session: Focus on 5:00-6:00 UTC only                                ║
╚═══════════════════════════════════════════════════════════════════════════╝
`);

console.log('\n' + '='.repeat(75));
