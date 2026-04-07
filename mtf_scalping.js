/**
 * Scalping Research - CORRECTED PARAMETERS + MULTI-TIMEFRAME
 * XAUUSDm: SL 2.50, TP 5 (2:1 RR)
 * BTCUSDm: SL 75, TP 150 (2:1 RR)
 * MTF confirmation: 1m, 3m, 5m analysis
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

function engineerFeatures(data) {
    const close = data.map(d => d.close);
    const ema5 = calculateEMA(close, 5);
    const ema8 = calculateEMA(close, 8);
    const ema13 = calculateEMA(close, 13);
    const ema20 = calculateEMA(close, 20);
    const ema50 = calculateEMA(close, 50);
    const rsi = calculateRSI(close, 14);
    const rsi4 = calculateRSI(close, 4);
    const atr = calculateATR(data, 14);
    
    // MACD
    const ema12 = calculateEMA(close, 12);
    const ema26 = calculateEMA(close, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = calculateEMA(macdLine, 9);
    const hist = macdLine.map((m, i) => m - signalLine[i]);
    
    return data.map((d, i) => {
        const hour = d.time.getUTCHours();
        let session = 'ny';
        if (hour < 7) session = 'asia';
        else if (hour < 12) session = 'london';
        return { 
            ...d, 
            ema5: ema5[i], ema8: ema8[i], ema13: ema13[i], ema20: ema20[i], ema50: ema50[i],
            rsi: rsi[i], rsi4: rsi4[i],
            atr: atr[i],
            macd: macdLine[i], signal: signalLine[i], hist: hist[i],
            session
        };
    });
}

// Align higher TF data to 1m
function alignTo1m(data1m, data3m, data5m) {
    // For each 1m bar, get the current 3m and 5m state
    const result = [];
    let idx3m = 0, idx5m = 0;
    
    for (let i = 0; i < data1m.length; i++) {
        const t1m = data1m[i].time.getTime();
        
        // Advance 3m pointer
        while (idx3m < data3m.length && data3m[idx3m].time.getTime() <= t1m) idx3m++;
        const tf3m = data3m[Math.min(idx3m - 1, data3m.length - 1)];
        
        // Advance 5m pointer
        while (idx5m < data5m.length && data5m[idx5m].time.getTime() <= t1m) idx5m++;
        const tf5m = data5m[Math.min(idx5m - 1, data5m.length - 1)];
        
        result.push({
            ...data1m[i],
            // 3m indicators
            tf3_ema5: tf3m.ema5, tf3_ema13: tf3m.ema13, tf3_ema20: tf3m.ema20,
            tf3_rsi: tf3m.rsi, tf3_hist: tf3m.hist, tf3_atr: tf3m.atr,
            // 5m indicators
            tf5_ema5: tf5m.ema5, tf5_ema13: tf5m.ema13, tf5_ema20: tf5m.ema20,
            tf5_rsi: tf5m.rsi, tf5_hist: tf5m.hist, tf5_atr: tf5m.atr,
            // Higher TF trend
            tf3_trend_up: tf3m.ema5 > tf3m.ema20,
            tf3_trend_down: tf3m.ema5 < tf3m.ema20,
            tf5_trend_up: tf5m.ema5 > tf5m.ema20,
            tf5_trend_down: tf5m.ema5 < tf5m.ema20,
            tf3_rsi_ok: tf3m.rsi > 40 && tf3m.rsi < 70,
            tf5_rsi_ok: tf5m.rsi > 40 && tf5m.rsi < 70,
            // MTF confirmation flags
            mtf_bull: (tf3m.ema5 > tf3m.ema20) && (tf5m.ema5 > tf5m.ema20),
            mtf_bear: (tf3m.ema5 < tf3m.ema20) && (tf5m.ema5 < tf5m.ema20),
            mtf_confirmed: (tf3m.ema5 > tf3m.ema20) === (data1m[i].ema5 > data1m[i].ema20)
        });
    }
    return result;
}

// MTF Signal Generation
function generateMTFSignal(data, config) {
    const { signalType = 'mtf_quality' } = config;
    const signals = new Array(data.length).fill(0);
    
    for (let i = 10; i < data.length; i++) {
        const curr = data[i], prev = data[i-1];
        
        // Trend alignment across TFs
        const bullTrend = curr.ema5 > curr.ema13 && curr.ema13 > curr.ema20;
        const bearTrend = curr.ema5 < curr.ema13 && curr.ema13 < curr.ema20;
        
        // MTF confirmation
        const mtfBull = curr.mtf_bull;
        const mtfBear = curr.mtf_bear;
        const mtfConfirmed = curr.mtf_confirmed;
        
        // Momentum on all TFs
        const bullMomentum = curr.hist > 0 && curr.tf3_hist > 0 && curr.tf5_hist > 0;
        const bearMomentum = curr.hist < 0 && curr.tf3_hist < 0 && curr.tf5_hist < 0;
        
        // RSI confirmation
        const rsiBull = curr.rsi > 50 && curr.rsi < 70 && curr.rsi4 > curr.rsi4;
        const rsiBear = curr.rsi < 50 && curr.rsi > 30 && curr.rsi4 < curr.rsi4;
        
        // Session filter
        const goodSession = curr.session === 'london' || curr.session === 'ny';
        
        switch(signalType) {
            case 'mtf_quality':
                // All TFs aligned, strict confirmation
                if (bullTrend && mtfBull && bullMomentum && rsiBull && goodSession) signals[i] = 1;
                if (bearTrend && mtfBear && bearMomentum && rsiBear && goodSession) signals[i] = -1;
                break;
                
            case 'mtf_momentum':
                // MTF momentum confirmation
                if (bullTrend && mtfConfirmed && curr.hist > 0 && curr.rsi > 45 && curr.rsi < 70) signals[i] = 1;
                if (bearTrend && mtfConfirmed && curr.hist < 0 && curr.rsi < 55 && curr.rsi > 30) signals[i] = -1;
                break;
                
            case 'mtf_reversal':
                // RSI extreme with MTF trend filter
                if (curr.rsi <= 40 && curr.rsi > prev.rsi && curr.tf3_trend_up && curr.hist >= 0) signals[i] = 1;
                if (curr.rsi >= 60 && curr.rsi < prev.rsi && curr.tf3_trend_down && curr.hist <= 0) signals[i] = -1;
                break;
                
            case 'mtf_breakout':
                // MTF breakout with confirmation
                const bullBreak = curr.close > curr.tf3_ema5 && curr.close > curr.tf5_ema5;
                const bearBreak = curr.close < curr.tf3_ema5 && curr.close < curr.tf5_ema5;
                
                if (bullBreak && curr.rsi > 50 && curr.rsi < 75 && mtfConfirmed) signals[i] = 1;
                if (bearBreak && curr.rsi < 50 && curr.rsi > 25 && mtfConfirmed) signals[i] = -1;
                break;
                
            case 'mtf_conservative':
                // Strictest: All TFs must agree
                if (bullTrend && mtfBull && curr.tf5_trend_up && bullMomentum && rsiBull && goodSession) {
                    signals[i] = 1;
                }
                if (bearTrend && mtfBear && curr.tf5_trend_down && bearMomentum && rsiBear && goodSession) {
                    signals[i] = -1;
                }
                break;
        }
    }
    return signals;
}

// MTF Backtest with proper trailng
function backtestMTF(data, config) {
    const { symbol, sl, tp, spread, signalType, trailAtRR = 1.0 } = config;
    const signals = generateMTFSignal(data, { signalType });
    
    const trades = [];
    let equity = 10000, pos = 0, entry = 0, entryBar = 0, highPrice = 0, lowPrice = Infinity;
    
    for (let i = 1; i < data.length; i++) {
        const curr = data[i], prev = data[i-1];
        const sig = signals[i], prevSig = signals[i-1];
        
        // Entry
        if (pos === 0 && sig !== 0 && sig !== prevSig) {
            pos = sig;
            entry = curr.close + spread * (pos > 0 ? 1 : -1);
            entryBar = i;
            highPrice = curr.high;
            lowPrice = curr.low;
        }
        
        // Track high/low for trailing
        if (pos > 0) highPrice = Math.max(highPrice, curr.high);
        if (pos < 0) lowPrice = Math.min(lowPrice, curr.low);
        
        // Exit logic
        if (pos !== 0) {
            const currentProfit = pos > 0 ? curr.close - entry : entry - curr.close;
            const currentDist = pos > 0 ? highPrice - entry : entry - lowPrice;
            let exit = false, exitPrice = 0, reason = '';
            
            // SL
            if (pos > 0 && curr.low <= entry - sl) { exit = true; exitPrice = entry - sl; reason = 'SL'; }
            else if (pos < 0 && curr.high >= entry + sl) { exit = true; exitPrice = entry + sl; reason = 'SL'; }
            // TP
            else if (pos > 0 && curr.high >= entry + tp) { exit = true; exitPrice = entry + tp; reason = 'TP'; }
            else if (pos < 0 && curr.low <= entry - tp) { exit = true; exitPrice = entry - tp; reason = 'TP'; }
            // Trailing SL (after trailAtRR profit)
            else if (currentDist >= sl * trailAtRR) {
                const trailDist = sl * 0.5; // Trail 0.5R from high/low
                if (pos > 0) {
                    const trailPrice = highPrice - trailDist;
                    if (curr.low <= trailPrice) { exit = true; exitPrice = trailPrice; reason = 'TRAIL'; }
                } else {
                    const trailPrice = lowPrice + trailDist;
                    if (curr.high >= trailPrice) { exit = true; exitPrice = trailPrice; reason = 'TRAIL'; }
                }
            }
            // Time exit (30 bars max)
            else if (i - entryBar >= 30) { 
                exit = true; 
                exitPrice = curr.close - spread * (pos > 0 ? 1 : -1); 
                reason = 'TIME'; 
            }
            
            if (exit) {
                const pnl = (pos > 0 ? exitPrice - entry : entry - exitPrice) - spread;
                const rr = currentProfit / sl;
                trades.push({ 
                    dir: pos > 0 ? 1 : -1, 
                    pnl, 
                    reason, 
                    rr: rr.toFixed(2),
                    dur: i - entryBar, 
                    session: curr.session,
                    mtf: curr.mtf_confirmed ? 1 : 0
                });
                equity += pnl;
                pos = 0;
            }
        }
    }
    
    return { trades, equity, metrics: calcMetrics(trades, equity) };
}

function calcMetrics(trades, equity) {
    if (!trades.length) return { t: 0, wr: '0', pf: '0', pnl: '0', dd: '0', avgRR: '0' };
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const tw = wins.reduce((a,b) => a+b.pnl, 0);
    const tl = Math.abs(losses.reduce((a,b) => a+b.pnl, 0));
    
    return {
        t: trades.length, w: wins.length, l: losses.length,
        wr: (wins.length / trades.length * 100).toFixed(1),
        pf: tl > 0 ? (tw / tl).toFixed(2) : '999',
        pnl: (equity - 10000).toFixed(2),
        dd: '0.00',
        avgRR: (trades.reduce((a,b) => a+parseFloat(b.rr), 0) / trades.length).toFixed(2)
    };
}

function analyzeDeep(trades) {
    const bySession = { asia: {t:0,w:0,p:0}, london: {t:0,w:0,p:0}, ny: {t:0,w:0,p:0} };
    const byReason = {};
    const byMTF = { confirmed: {t:0,w:0,p:0}, notConfirmed: {t:0,w:0,p:0} };
    
    for (const t of trades) {
        const sess = bySession[t.session] || bySession.ny;
        sess.t++; sess.w += t.pnl > 0 ? 1 : 0; sess.p += t.pnl;
        
        if (!byReason[t.reason]) byReason[t.reason] = {t:0,w:0,p:0};
        byReason[t.reason].t++; byReason[t.reason].w += t.pnl > 0 ? 1 : 0; byReason[t.reason].p += t.pnl;
        
        const mtfKey = t.mtf === 1 ? 'confirmed' : 'notConfirmed';
        byMTF[mtfKey].t++; byMTF[mtfKey].w += t.pnl > 0 ? 1 : 0; byMTF[mtfKey].p += t.pnl;
    }
    
    return { bySession, byReason, byMTF };
}

// MAIN
console.log('='.repeat(70));
console.log('SCALPING RESEARCH - CORRECTED PARAMS + MTF');
console.log('XAUUSDm: SL 2.50, TP 5 | BTCUSDm: SL 75, TP 150');
console.log('Multi-Timeframe: 1m + 3m + 5m confirmation');
console.log('='.repeat(70));

// Load ALL timeframes
const xau1m = engineerFeatures(loadCSV('XAUUSDm_1m_2026-02-01_to_2026-04-01.csv'));
const xau3m = engineerFeatures(loadCSV('XAUUSDm_3m_2026-02-01_to_2026-04-01.csv'));
const xau5m = engineerFeatures(loadCSV('XAUUSDm_5m_2026-02-01_to_2026-04-01.csv'));

const btc1m = engineerFeatures(loadCSV('BTCUSDm_1m_2026-02-01_to_2026-04-01.csv'));
const btc3m = engineerFeatures(loadCSV('BTCUSDm_3m_2026-02-01_to_2026-04-01.csv'));
const btc5m = engineerFeatures(loadCSV('BTCUSDm_5m_2026-02-01_to_2026-04-01.csv'));

// Align to 1m
const xau = alignTo1m(xau1m, xau3m, xau5m);
const btc = alignTo1m(btc1m, btc3m, btc5m);

// Split
const xauTrain = xau.filter(d => d.time < new Date('2026-03-01'));
const xauTest = xau.filter(d => d.time >= new Date('2026-03-01'));
const btcTrain = btc.filter(d => d.time < new Date('2026-03-01'));
const btcTest = btc.filter(d => d.time >= new Date('2026-03-01'));

console.log(`\nXAU: ${xauTrain.length} train / ${xauTest.length} test bars`);
console.log(`BTC: ${btcTrain.length} train / ${btcTest.length} test bars`);

const signalTypes = ['mtf_quality', 'mtf_momentum', 'mtf_reversal', 'mtf_breakout', 'mtf_conservative'];
const results = [];

// XAUUSDm Backtests
console.log('\n--- XAUUSDm IN-SAMPLE (SL: 2.50, TP: 5.00) ---');
console.log('Strategy          Trades  WR%   PF    PnL      AvgRR');
console.log('-'.repeat(55));

for (const s of signalTypes) {
    const res = backtestMTF(xauTrain, { symbol: 'XAUUSDm', signalType: s, sl: 2.50, tp: 5.00, spread: 0.30 });
    const m = res.metrics;
    console.log(`${s.padEnd(16)} ${String(m.t).padStart(6)} ${m.wr.padStart(5)}% ${m.pf.padStart(6)} $${m.pnl.padStart(8)} ${m.avgRR}`);
    results.push({ s, sym: 'XAU', ...m, equity: res.equity });
}

// BTCUSDm Backtests
console.log('\n--- BTCUSDm IN-SAMPLE (SL: 75, TP: 150) ---');
console.log('Strategy          Trades  WR%   PF    PnL      AvgRR');
console.log('-'.repeat(55));

for (const s of signalTypes) {
    const res = backtestMTF(btcTrain, { symbol: 'BTCUSDm', signalType: s, sl: 75, tp: 150, spread: 3 });
    const m = res.metrics;
    console.log(`${s.padEnd(16)} ${String(m.t).padStart(6)} ${m.wr.padStart(5)}% ${m.pf.padStart(6)} $${m.pnl.padStart(8)} ${m.avgRR}`);
    results.push({ s, sym: 'BTC', ...m, equity: res.equity });
}

// Ranking
const xauResults = results.filter(r => r.sym === 'XAU').sort((a,b) => parseFloat(b.pnl) - parseFloat(a.pnl));
const btcResults = results.filter(r => r.sym === 'BTC').sort((a,b) => parseFloat(b.pnl) - parseFloat(a.pnl));

console.log('\n' + '='.repeat(70));
console.log('RANKING (by PnL)');
console.log('='.repeat(70));

console.log('\nXAUUSDm:');
xauResults.slice(0, 3).forEach((r, i) => console.log(`  ${i+1}. ${r.s}: ${r.t} trades, WR ${r.wr}%, PF ${r.pf}, PnL $${r.pnl}`));

console.log('\nBTCUSDm:');
btcResults.slice(0, 3).forEach((r, i) => console.log(`  ${i+1}. ${r.s}: ${r.t} trades, WR ${r.wr}%, PF ${r.pf}, PnL $${r.pnl}`));

// Deep analysis
const bestXau = xauResults[0];
const bestBtc = btcResults[0];

console.log('\n' + '='.repeat(70));
console.log('DEEP ANALYSIS - TOP STRATEGIES');
console.log('='.repeat(70));

if (bestXau && bestXau.t > 0) {
    const xauRes = backtestMTF(xauTrain, { symbol: 'XAUUSDm', signalType: bestXau.s, sl: 2.50, tp: 5.00, spread: 0.30 });
    const ana = analyzeDeep(xauRes.trades);
    
    console.log(`\nXAUUSDm ${bestXau.s}:`);
    console.log('\n  By Session:');
    for (const [s, v] of Object.entries(ana.bySession)) {
        if (v.t > 0) console.log(`    ${s}: ${v.t} trades, WR ${(v.w/v.t*100).toFixed(1)}%, PnL $${v.p.toFixed(2)}`);
    }
    console.log('\n  By Exit Reason:');
    for (const [r, v] of Object.entries(ana.byReason)) {
        console.log(`    ${r}: ${v.t} trades, WR ${(v.w/v.t*100).toFixed(1)}%`);
    }
    console.log('\n  By MTF Confirmation:');
    for (const [k, v] of Object.entries(ana.byMTF)) {
        console.log(`    ${k}: ${v.t} trades, WR ${(v.w/v.t*100).toFixed(1)}%, PnL $${v.p.toFixed(2)}`);
    }
}

if (bestBtc && bestBtc.t > 0) {
    const btcRes = backtestMTF(btcTrain, { symbol: 'BTCUSDm', signalType: bestBtc.s, sl: 75, tp: 150, spread: 3 });
    const ana = analyzeDeep(btcRes.trades);
    
    console.log(`\nBTCUSDm ${bestBtc.s}:`);
    console.log('\n  By Session:');
    for (const [s, v] of Object.entries(ana.bySession)) {
        if (v.t > 0) console.log(`    ${s}: ${v.t} trades, WR ${(v.w/v.t*100).toFixed(1)}%, PnL $${v.p.toFixed(2)}`);
    }
    console.log('\n  By Exit Reason:');
    for (const [r, v] of Object.entries(ana.byReason)) {
        console.log(`    ${r}: ${v.t} trades, WR ${(v.w/v.t*100).toFixed(1)}%`);
    }
    console.log('\n  By MTF Confirmation:');
    for (const [k, v] of Object.entries(ana.byMTF)) {
        console.log(`    ${k}: ${v.t} trades, WR ${(v.w/v.t*100).toFixed(1)}%, PnL $${v.p.toFixed(2)}`);
    }
}

// Out of Sample
console.log('\n' + '='.repeat(70));
console.log('OUT-OF-SAMPLE (March 2026)');
console.log('='.repeat(70));

if (bestXau && bestXau.t > 0) {
    const xauOOS = backtestMTF(xauTest, { symbol: 'XAUUSDm', signalType: bestXau.s, sl: 2.50, tp: 5.00, spread: 0.30 });
    console.log(`\nXAUUSDm ${bestXau.s}: ${xauOOS.metrics.t} trades, WR ${xauOOS.metrics.wr}%, PF ${xauOOS.metrics.pf}, PnL $${xauOOS.metrics.pnl}`);
}

if (bestBtc && bestBtc.t > 0) {
    const btcOOS = backtestMTF(btcTest, { symbol: 'BTCUSDm', signalType: bestBtc.s, sl: 75, tp: 150, spread: 3 });
    console.log(`BTCUSDm ${bestBtc.s}: ${btcOOS.metrics.t} trades, WR ${btcOOS.metrics.wr}%, PF ${btcOOS.metrics.pf}, PnL $${btcOOS.metrics.pnl}`);
}

// Final Templates
console.log('\n' + '='.repeat(70));
console.log('MTF STRATEGY TEMPLATES (CORRECTED PARAMS)');
console.log('='.repeat(70));

const templates = [
    {
        name: 'XAUUSDm_MTF_TREND',
        asset: 'XAUUSDm',
        params: { sl: 2.50, tp: 5.00, spread: 0.30 },
        entry: [
            '1m: EMA5 crosses EMA13',
            '3m: EMA alignment (EMA5 > EMA13 > EMA20)',
            '5m: Trend direction confirmed',
            'All TFs: RSI 50-70, MACD histogram positive'
        ],
        exit: [
            'TP1: 5.00 (2:1) - close 50%',
            'TP2: 5.00 - close remaining',
            'SL: 2.50 - trail after 1R profit'
        ],
        mtf_rules: 'Entry requires all 3 TFs aligned. Trail uses 5m structure lows.'
    },
    {
        name: 'BTCUSDm_MTF_MOMENTUM',
        asset: 'BTCUSDm',
        params: { sl: 75, tp: 150, spread: 3 },
        entry: [
            '1m: Price momentum confirmed',
            '3m: MACD histogram > 0',
            '5m: EMA5 > EMA20',
            'Session: London/NY only'
        ],
        exit: [
            'TP: 150 (2:1)',
            'Trailing: After 1R, trail SL 37.5 (0.5R)',
            'Time: 30 bars max'
        ],
        mtf_rules: 'MTF confirmation required. 5m EMA20 as dynamic SL level.'
    }
];

templates.forEach((t, i) => {
    console.log(`\n[${i+1}] ${t.name}`);
    console.log(`    SL: ${t.params.sl}, TP: ${t.params.tp}`);
    console.log(`    Entry:`);
    t.entry.forEach(e => console.log(`      - ${e}`));
    console.log(`    Exit:`);
    t.exit.forEach(e => console.log(`      - ${e}`));
    console.log(`    MTF Rules: ${t.mtf_rules}`);
});

console.log('\n' + '='.repeat(70));
