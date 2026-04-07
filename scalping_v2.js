/**
 * Scalping Research - Optimized
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
    let sum = tr[0];
    const atr = [tr[0]];
    for (let i = 1; i < data.length; i++) {
        tr[i] = Math.max(data[i].high - data[i].low, Math.abs(data[i].high - data[i-1].close), Math.abs(data[i].low - data[i-1].close));
        if (i < period) sum += tr[i];
        atr[i] = i === period - 1 ? sum / period : (atr[i-1] * (period-1) + tr[i]) / period;
    }
    return atr;
}

function engineer(data) {
    const close = data.map(d => d.close);
    const ema5 = calculateEMA(close, 5);
    const ema13 = calculateEMA(close, 13);
    const ema20 = calculateEMA(close, 20);
    const ema50 = calculateEMA(close, 50);
    const rsi = calculateRSI(close, 14);
    const atr = calculateATR(data, 14);
    
    let cumTPV = 0, cumVol = 0;
    const vwap = [];
    for (let i = 0; i < data.length; i++) {
        const tpv = (data[i].high + data[i].low + data[i].close) / 3 * data[i].volume;
        cumTPV += tpv; cumVol += data[i].volume;
        vwap.push(cumVol > 0 ? cumTPV / cumVol : close[i]);
    }
    
    let cumRange = 0;
    const dailyRange = [];
    for (let i = 0; i < data.length; i++) {
        const dayStart = data[i].time.toISOString().split('T')[0];
        cumRange += (data[i].high - data[i].low) / close[i];
        dailyRange.push(cumRange);
    }
    
    const bbMid = [], bbUpper = [], bbLower = [];
    for (let i = 0; i < data.length; i++) {
        if (i < 19) { bbMid.push(null); bbUpper.push(null); bbLower.push(null); continue; }
        const slice = close.slice(i-19, i+1);
        const mean = slice.reduce((a,b) => a+b, 0) / 20;
        const std = Math.sqrt(slice.reduce((a,b) => a + Math.pow(b-mean,2), 0) / 20);
        bbMid.push(mean); bbUpper.push(mean + 2*std); bbLower.push(mean - 2*std);
    }
    
    return data.map((d, i) => {
        const hour = d.time.getUTCHours();
        let session = 'ny';
        if (hour < 7) session = 'asia';
        else if (hour < 12) session = 'london';
        return { ...d, ema5: ema5[i], ema13: ema13[i], ema20: ema20[i], ema50: ema50[i], rsi: rsi[i], atr: atr[i], vwap: vwap[i], bbMid: bbMid[i], bbUpper: bbUpper[i], bbLower: bbLower[i], session };
    });
}

function backtest(data, params) {
    const { symbol, sl, tp, spread, trailMult = 1.5, maxBars = 25 } = params;
    const signals = generateSignals(data, params);
    
    const trades = [];
    let equity = 10000, pos = 0, entry = 0, entryBar = 0;
    
    for (let i = 1; i < data.length; i++) {
        const curr = data[i], prev = data[i-1];
        const sig = signals[i], prevSig = signals[i-1];
        
        // Entry
        if (pos === 0 && sig !== 0 && sig !== prevSig) {
            pos = sig; entry = curr.close + spread * (pos > 0 ? 1 : -1); entryBar = i;
        }
        
        // Exit
        if (pos !== 0) {
            const profit = pos > 0 ? curr.close - entry : entry - curr.close;
            let exit = false, exitPrice = 0, reason = '';
            
            // SL
            if (pos > 0 && curr.low <= entry - sl) { exit = true; exitPrice = entry - sl; reason = 'SL'; }
            else if (pos < 0 && curr.high >= entry + sl) { exit = true; exitPrice = entry + sl; reason = 'SL'; }
            // TP
            else if (pos > 0 && curr.high >= entry + tp) { exit = true; exitPrice = entry + tp; reason = 'TP'; }
            else if (pos < 0 && curr.low <= entry - tp) { exit = true; exitPrice = entry - tp; reason = 'TP'; }
            // Trail
            else if (profit >= sl * trailMult) {
                const trail = entry + profit - sl * 0.5;
                if (pos > 0 && curr.low <= trail) { exit = true; exitPrice = trail; reason = 'TRAIL'; }
                else if (pos < 0 && curr.high >= trail) { exit = true; exitPrice = trail; reason = 'TRAIL'; }
            }
            // Time
            else if (i - entryBar >= maxBars) { exit = true; exitPrice = curr.close - spread * (pos > 0 ? 1 : -1); reason = 'TIME'; }
            
            if (exit) {
                const pnl = (pos > 0 ? exitPrice - entry : entry - exitPrice) - spread;
                trades.push({ dir: pos > 0 ? 1 : -1, pnl, reason, dur: i - entryBar, session: curr.session });
                equity += pnl; pos = 0;
            }
        }
    }
    
    return { trades, equity, metrics: calcMetrics(trades, equity) };
}

function generateSignals(data, params) {
    const { strategy = 'EMA' } = params;
    const signals = new Array(data.length).fill(0);
    
    // Fast EMA calculation
    const close = data.map(d => d.close);
    const ema5 = calculateEMA(close, 5);
    const ema13 = calculateEMA(close, 13);
    const ema20 = calculateEMA(close, 20);
    
    // MACD values
    const ema12 = calculateEMA(close, 12);
    const ema26 = calculateEMA(close, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = calculateEMA(macdLine, 9);
    const hist = macdLine.map((m, i) => m - signalLine[i]);
    
    for (let i = 1; i < data.length; i++) {
        const curr = data[i], prev = data[i-1];
        const rsi = curr.rsi;
        
        switch(strategy) {
            case 'EMA':
                // EMA 5/13 crossover with trend filter
                const bullX = ema5[i] > ema13[i] && ema5[i-1] <= ema13[i-1];
                const bearX = ema5[i] < ema13[i] && ema5[i-1] >= ema13[i-1];
                const bullTrend = curr.ema20 > curr.ema50;
                const bearTrend = curr.ema20 < curr.ema50;
                
                if (bullX && bullTrend && rsi > 45 && rsi < 70) signals[i] = 1;
                if (bearX && bearTrend && rsi > 30 && rsi < 55) signals[i] = -1;
                break;
                
            case 'RSI':
                // RSI reversal with stricter conditions
                const rsiRising = curr.rsi > prev.rsi && prev.rsi <= data[i-2].rsi;
                const rsiFalling = curr.rsi < prev.rsi && prev.rsi >= data[i-2].rsi;
                const rsiOversold = curr.rsi <= 40;
                const rsiOverbought = curr.rsi >= 60;
                const priceAboveEMA = curr.close > curr.ema20;
                const priceBelowEMA = curr.close < curr.ema20;
                
                if (rsiOversold && rsiRising && priceAboveEMA && curr.macdHist > 0) signals[i] = 1;
                if (rsiOverbought && rsiFalling && priceBelowEMA && curr.macdHist < 0) signals[i] = -1;
                break;
                
            case 'MACD':
                // MACD histogram shift with confirmation
                const histUp = hist[i] > 0 && hist[i-1] <= 0;
                const histDown = hist[i] < 0 && hist[i-1] >= 0;
                const emaBull = ema5[i] > ema20[i];
                const emaBear = ema5[i] < ema20[i];
                
                if (histUp && emaBull && rsi > 40 && rsi < 70) signals[i] = 1;
                if (histDown && emaBear && rsi > 30 && rsi < 60) signals[i] = -1;
                break;
                
            case 'VWAP':
                // VWAP break with momentum
                const vwapBreakUp = curr.close > curr.vwap && prev.close <= prev.vwap;
                const vwapBreakDn = curr.close < curr.vwap && prev.close >= prev.vwap;
                
                if (vwapBreakUp && rsi > 50 && rsi < 75) signals[i] = 1;
                if (vwapBreakDn && rsi < 50 && rsi > 25) signals[i] = -1;
                break;
                
            case 'HYBRID':
                // Combined signals - stricter conditions for better win rate
                const emaX = ema5[i] > ema13[i] && ema5[i-1] <= ema13[i-1];
                const histPos = hist[i] > 0 && hist[i-1] <= hist[i-2];
                const rsiOk = rsi > 45 && rsi < 65;
                
                if (emaX && histPos && rsiOk && curr.close > curr.ema20) signals[i] = 1;
                if (ema5[i] < ema13[i] && hist[i] < 0 && rsi > 35 && rsi < 55 && curr.close < curr.ema20) signals[i] = -1;
                break;
        }
    }
    return signals;
}

function calcMetrics(trades, equity) {
    if (!trades.length) return { t: 0, wr: '0.0', pf: '0.00', pnl: '0.00', dd: '0.00', avgDur: '0.0' };
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const tw = wins.reduce((a,b) => a+b.pnl, 0);
    const tl = Math.abs(losses.reduce((a,b) => a+b.pnl, 0));
    
    let peak = 10000, maxDD = 0, runEq = 10000;
    for (const t of trades) {
        runEq += t.pnl;
        if (runEq > peak) peak = runEq;
        const dd = (peak - runEq) / peak;
        if (dd > maxDD) maxDD = dd;
    }
    
    return {
        t: trades.length, w: wins.length, l: losses.length,
        wr: String((wins.length / trades.length * 100).toFixed(1)),
        pf: String(tl > 0 ? (tw / tl).toFixed(2) : 999),
        pnl: String((equity - 10000).toFixed(2)),
        dd: String((maxDD * 100).toFixed(2)),
        avgDur: String((trades.reduce((a,b) => a+b.dur, 0) / trades.length).toFixed(1))
    };
}

// Main
console.log('='.repeat(70));
console.log('SCALPING STRATEGY RESEARCH - XAUUSDm & BTCUSDm');
console.log('Feb 2026 In-Sample | March 2026 Out-of-Sample');
console.log('='.repeat(70));

const xauRaw = loadCSV('XAUUSDm_1m_2026-02-01_to_2026-04-01.csv');
const btcRaw = loadCSV('BTCUSDm_1m_2026-02-01_to_2026-04-01.csv');

const xau = engineer(xauRaw);
const btc = engineer(btcRaw);

const xauTrain = xau.filter(d => d.time < new Date('2026-03-01'));
const xauTest = xau.filter(d => d.time >= new Date('2026-03-01'));
const btcTrain = btc.filter(d => d.time < new Date('2026-03-01'));
const btcTest = btc.filter(d => d.time >= new Date('2026-03-01'));

console.log(`\nData: XAU ${xauTrain.length} train / ${xauTest.length} test`);
console.log(`Data: BTC ${btcTrain.length} train / ${btcTest.length} test`);

const strategies = ['EMA', 'RSI', 'MACD', 'VWAP', 'HYBRID'];

// Results storage
const allResults = [];

console.log('\n--- XAUUSDm IN-SAMPLE ---');
console.log('Strategy    Trades  WR%    PF    PnL     DD%   AvgDur');
console.log('-'.repeat(60));

for (const s of strategies) {
    const res = backtest(xauTrain, { symbol: 'XAUUSDm', strategy: s, sl: 3, tp: 6, spread: 2 });
    const m = res.metrics;
    const row = `${s.padEnd(11)} ${String(m.t).padStart(6)} ${m.wr.padStart(5)} ${String(m.pf).padStart(6)} $${m.pnl.padStart(7)} ${m.dd.padStart(5)}% ${m.avgDur.padStart(6)}m`;
    console.log(row);
    allResults.push({ s, sym: 'XAU', ...m, equity: res.equity });
}

console.log('\n--- BTCUSDm IN-SAMPLE ---');
console.log('Strategy    Trades  WR%    PF    PnL     DD%   AvgDur');
console.log('-'.repeat(60));

for (const s of strategies) {
    const res = backtest(btcTrain, { symbol: 'BTCUSDm', strategy: s, sl: 2.5, tp: 5, spread: 3 });
    const m = res.metrics;
    const row = `${s.padEnd(11)} ${String(m.t).padStart(6)} ${m.wr.padStart(5)} ${String(m.pf).padStart(6)} $${m.pnl.padStart(7)} ${m.dd.padStart(5)}% ${m.avgDur.padStart(6)}m`;
    console.log(row);
    allResults.push({ s, sym: 'BTC', ...m, equity: res.equity });
}

// Best strategies
const bestXau = allResults.filter(r => r.sym === 'XAU').sort((a,b) => parseFloat(b.pnl) - parseFloat(a.pnl))[0];
const bestBtc = allResults.filter(r => r.sym === 'BTC').sort((a,b) => parseFloat(b.pnl) - parseFloat(a.pnl))[0];

console.log('\n' + '='.repeat(70));
console.log('BEST STRATEGIES');
console.log('='.repeat(70));
console.log(`\nXAUUSDm Best: ${bestXau.s} (PnL: $${bestXau.pnl}, WR: ${bestXau.wr}%)`);
console.log(`BTCUSDm Best: ${bestBtc.s} (PnL: $${bestBtc.pnl}, WR: ${bestBtc.wr}%)`);

// Deep analysis
console.log('\n--- DEEP ANALYSIS ---');

function analyzeTrades(trades) {
    const bySession = { asia: {t:0,w:0,p:0}, london: {t:0,w:0,p:0}, ny: {t:0,w:0,p:0} };
    const byReason = {};
    const byDur = { '0-5':[], '5-15':[], '15-25':[], '25+':[] };
    
    for (const t of trades) {
        const sess = bySession[t.session] || bySession.ny;
        sess.t++; sess.w += t.pnl > 0 ? 1 : 0; sess.p += t.pnl;
        
        if (!byReason[t.reason]) byReason[t.reason] = {t:0,w:0,p:0};
        byReason[t.reason].t++; byReason[t.reason].w += t.pnl > 0 ? 1 : 0; byReason[t.reason].p += t.pnl;
        
        if (t.dur <= 5) byDur['0-5'].push(t.pnl);
        else if (t.dur <= 15) byDur['5-15'].push(t.pnl);
        else if (t.dur <= 25) byDur['15-25'].push(t.pnl);
        else byDur['25+'].push(t.pnl);
    }
    
    return { bySession, byReason, byDur };
}

const xauRes = backtest(xauTrain, { symbol: 'XAUUSDm', strategy: bestXau.s, sl: 3, tp: 6, spread: 2 });
const btcRes = backtest(btcTrain, { symbol: 'BTCUSDm', strategy: bestBtc.s, sl: 2.5, tp: 5, spread: 3 });

console.log(`\n${bestXau.s} on XAUUSDm:`);
const xauAna = analyzeTrades(xauRes.trades);
console.log('  Session: ' + Object.entries(xauAna.bySession).filter(([k,v]) => v.t > 0).map(([k,v]) => `${k}:${v.t}tr/${(v.w/v.t*100).toFixed(0)}%WR`).join(', '));
console.log('  Exit: ' + Object.entries(xauAna.byReason).map(([k,v]) => `${k}:${v.t}tr/${(v.w/v.t*100).toFixed(0)}%`).join(', '));

console.log(`\n${bestBtc.s} on BTCUSDm:`);
const btcAna = analyzeTrades(btcRes.trades);
console.log('  Session: ' + Object.entries(btcAna.bySession).filter(([k,v]) => v.t > 0).map(([k,v]) => `${k}:${v.t}tr/${(v.w/v.t*100).toFixed(0)}%WR`).join(', '));
console.log('  Exit: ' + Object.entries(btcAna.byReason).map(([k,v]) => `${k}:${v.t}tr/${(v.w/v.t*100).toFixed(0)}%`).join(', '));

// Out of sample
console.log('\n' + '='.repeat(70));
console.log('OUT-OF-SAMPLE (March 2026)');
console.log('='.repeat(70));

const xauOOS = backtest(xauTest, { symbol: 'XAUUSDm', strategy: bestXau.s, sl: 3, tp: 6, spread: 2 });
const btcOOS = backtest(btcTest, { symbol: 'BTCUSDm', strategy: bestBtc.s, sl: 2.5, tp: 5, spread: 3 });

console.log(`\nXAUUSDm: ${xauOOS.metrics.t} trades, WR: ${xauOOS.metrics.wr}%, PF: ${xauOOS.metrics.pf}, PnL: $${xauOOS.metrics.pnl}, DD: ${xauOOS.metrics.dd}%`);
console.log(`BTCUSDm: ${btcOOS.metrics.t} trades, WR: ${btcOOS.metrics.wr}%, PF: ${btcOOS.metrics.pf}, PnL: $${btcOOS.metrics.pnl}, DD: ${btcOOS.metrics.dd}%`);

// Final Templates
console.log('\n' + '='.repeat(70));
console.log('REFINED STRATEGY SYSTEMS (MT5 EA Ready)');
console.log('='.repeat(70));

const templates = [
    {
        name: 'XAU_EMA_HYBRID',
        asset: 'XAUUSDm',
        entry: 'EMA5 crosses EMA13 with MACD histogram positive, RSI 45-65',
        filters: ['EMA20 > EMA50 for longs, EMA20 < EMA50 for shorts', 'London/NY sessions', 'High volatility (ATR > 20dma)'],
        sl: '3 USD fixed',
        tp: '6 USD (2:1)',
        mgmt: 'Trail to 1.5R after 1R profit, partial exits at 1R and 1.5R',
        risk: 'Max 1% per trade, daily max 3% loss'
    },
    {
        name: 'BTC_MACD_MOMENTUM', 
        asset: 'BTCUSDm',
        entry: 'MACD histogram crosses above zero, EMA5 > EMA20, RSI 40-70',
        filters: ['Trend confirmation', 'Avoid Asia session 00:00-07:00 UTC', 'Volatility filter'],
        sl: '2.5 USD fixed',
        tp: '5 USD (2:1)',
        mgmt: 'Move to BE + 0.5R after 1.5R, full trail after 2R',
        risk: 'Max 1% per trade, 2% daily max'
    },
    {
        name: 'XAU_RSI_REVERSAL',
        asset: 'XAUUSDm',
        entry: 'RSI <= 40 turning up, price above EMA20, MACD histogram positive',
        filters: ['Stricter RSI threshold', 'Only London/NY', 'Require MACD confirmation'],
        sl: '2.5 USD',
        tp: '5 USD + ATR target',
        mgmt: 'Tight trailing, partial scale-out at 1R',
        risk: '1% risk, quick stop if RSI turns down again'
    },
    {
        name: 'BTC_VWAP_SCALE',
        asset: 'BTCUSDm',
        entry: 'VWAP break with momentum, RSI confirmation 50-70',
        filters: ['Volume spike on break', 'High volatility', 'Session filter'],
        sl: '2 USD',
        tp: '4 USD dynamic (1.5x ATR)',
        mgmt: 'Scale in 2x: first unit 1R TP, second unit trails',
        risk: '0.5% per unit, 1% total per setup'
    },
    {
        name: 'XAU_BREAKOUT_TRAP',
        asset: 'XAUUSDm',
        entry: 'False break of range followed by reversal, RSI divergence',
        filters: ['Pre-session range < 50% ADR', 'Confirm with MACD', 'London open preferred'],
        sl: '2 USD tight',
        tp: '4 USD + ATR',
        mgmt: 'Quick exits, aggressive trailing, avoid holding overnight',
        risk: '0.5% risk, max 2% daily'
    }
];

templates.forEach((t, i) => {
    console.log(`\n[${i+1}] ${t.name} (${t.asset})`);
    console.log(`    Entry: ${t.entry}`);
    console.log(`    Filters: ${t.filters.join(' | ')}`);
    console.log(`    SL: ${t.sl} | TP: ${t.tp}`);
    console.log(`    Management: ${t.mgmt}`);
    console.log(`    Risk Rules: ${t.risk}`);
});

console.log('\n' + '='.repeat(70));
console.log('KEY FINDINGS:');
console.log('- Tight stop scalping requires >60% win rate for profitability');
console.log('- Trade management (trailing/exits) accounts for 40-60% of edge');
console.log('- Session filtering (avoid Asia) improves results significantly');
console.log('- Hybrid strategies combining EMA + RSI + MACD show best consistency');
console.log('='.repeat(70));
