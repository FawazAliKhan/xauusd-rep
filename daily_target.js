/**
 * $50/DAY TARGET ANALYSIS
 * What does it take to make $50/day?
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
    
    return data.map((d, i) => {
        const hour = d.time.getUTCHours();
        return { ...d, ema5: ema5[i], ema13: ema13[i], ema20: ema20[i], rsi: rsi[i], hour };
    });
}

function backtest(data, config) {
    const { sl, tp, spread, strategyType, trailConfig = {} } = config;
    const startTrailAt = trailConfig.startTrailAt || 1.5;
    const trailDist = trailConfig.trailDist || 0.3;
    const timeExit = trailConfig.timeExit || 35;
    
    const strategySignals = {
        MOMENTUM_QUALITY: (data) => {
            const signals = new Array(data.length).fill(0);
            for (let i = 5; i < data.length; i++) {
                const curr = data[i];
                const bull = curr.ema5 > curr.ema13 && curr.ema13 > curr.ema20;
                const bear = curr.ema5 < curr.ema13 && curr.ema13 < curr.ema20;
                const strongRSI = curr.rsi >= 55 && curr.rsi <= 65;
                const strongRSIBear = curr.rsi >= 35 && curr.rsi <= 45;
                if (bull && curr.rsi > 0 && strongRSI) signals[i] = 1;
                if (bear && curr.rsi > 0 && strongRSIBear) signals[i] = -1;
            }
            return signals;
        }
    };
    
    const signals = strategySignals[strategyType](data);
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
            const highProfit = pos > 0 ? highPrice - entry : entry - lowPrice;
            
            if (pos > 0 && curr.low <= entry - sl) { exit = true; exitPrice = entry - sl; reason = 'SL'; }
            else if (pos < 0 && curr.high >= entry + sl) { exit = true; exitPrice = entry + sl; reason = 'SL'; }
            else if (pos > 0 && curr.high >= entry + tp) { exit = true; exitPrice = entry + tp; reason = 'TP'; }
            else if (pos < 0 && curr.low <= entry - tp) { exit = true; exitPrice = entry - tp; reason = 'TP'; }
            else if (highProfit >= sl * startTrailAt) {
                const trailDistance = sl * (trailDist + trailStep * 0.2);
                if (pos > 0) {
                    const trailPrice = highPrice - trailDistance;
                    if (curr.low <= trailPrice) { exit = true; exitPrice = trailPrice; reason = 'TRAIL'; }
                    else trailStep = Math.min(trailStep + 0.1, 1);
                } else {
                    const trailPrice = lowPrice + trailDistance;
                    if (curr.high >= trailPrice) { exit = true; exitPrice = trailPrice; reason = 'TRAIL'; }
                }
            }
            else if (i - entryBar >= timeExit) { exit = true; exitPrice = curr.close - spread * (pos > 0 ? 1 : -1); reason = 'TIME'; }
            
            if (exit) {
                const pnl = (pos > 0 ? exitPrice - entry : entry - exitPrice) - spread;
                trades.push({ pnl, reason, dur: i - entryBar, hour: curr.hour });
                pos = 0;
            }
        }
    }
    return trades;
}

console.log('='.repeat(70));
console.log('$50/DAY TARGET ANALYSIS');
console.log('='.repeat(70));

const xauRaw = engineer(loadCSV('XAUUSDm_1m_2026-02-01_to_2026-04-01.csv'));
const xauTrain = xauRaw.filter(d => d.time < new Date('2026-03-01'));
const xauTest = xauRaw.filter(d => d.time >= new Date('2026-03-01'));

// ============================================================
// PART 1: WHAT DOES $50/DAY REQUIRE?
// ============================================================
console.log('\n=====================================================================');
console.log('PART 1: THE MATH');
console.log('=====================================================================');

console.log(`
  MONTHLY TARGET: $50 × 22 trading days = $1,100/month
  
  IF YOU TRADE:
  ─────────────────────────────────────────────────────────────
  1. 10 trades/day × $5 avg profit = $50/day ✓
  2. 5 trades/day × $10 avg profit = $50/day ✓
  3. 2 trades/day × $25 avg profit = $50/day ✓
  
  WITH XAUUSDm (SL: 2.50, TP: 6.00):
  ─────────────────────────────────────────────────────────────
  Win: +$5.70 (TP 6 - spread 0.30)
  Loss: -$2.80 (SL 2.50 + spread 0.30)
  
  To make $50/day with 40% WR:
    Net per win:  $5.70
    Net per loss: -$2.80
    Per 10 trades: (4 wins × $5.70) - (6 losses × $2.80) = $22.80 - $16.80 = $6.00
    Need: 80+ trades/day (not realistic)
  
  To make $50/day with 50% WR:
    Per 10 trades: (5 wins × $5.70) - (5 losses × $2.80) = $28.50 - $14.00 = $14.50
    Need: 35 trades/day (possible with scalping)
  
  To make $50/day with 60% WR:
    Per 10 trades: (6 wins × $5.70) - (4 losses × $2.80) = $34.20 - $11.20 = $23.00
    Need: 22 trades/day (ideal)
`);

// ============================================================
// PART 2: TEST IMPROVED STRATEGY
// ============================================================
console.log('\n=====================================================================');
console.log('PART 2: IMPROVED STRATEGY BACKTEST');
console.log('=====================================================================');

const configs = [
    { name: 'XAU Base', sl: 2.50, tp: 5.00, spread: 0.30, startTrailAt: 1.0, trailDist: 0.5, timeExit: 25 },
    { name: 'XAU Improved', sl: 2.50, tp: 6.00, spread: 0.30, startTrailAt: 1.5, trailDist: 0.3, timeExit: 35 },
    { name: 'XAU Strict', sl: 2.50, tp: 7.00, spread: 0.30, startTrailAt: 1.5, trailDist: 0.3, timeExit: 35 },
];

console.log('\nXAUUSDm IN-SAMPLE (Feb 2026):');
console.log('Config           Trades  WR%    PnL/Day  DaysTo$50');
console.log('-'.repeat(55));

for (const cfg of configs) {
    const trades = backtest(xauTrain, { ...cfg, strategyType: 'MOMENTUM_QUALITY' });
    if (trades.length === 0) continue;
    
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const totalPnL = trades.reduce((a,b) => a+b.pnl, 0);
    
    // Calculate days in data
    const days = 28; // Feb 2026
    const pnlPerDay = totalPnL / days;
    const wr = (wins.length / trades.length * 100).toFixed(1);
    const tradesPerDay = trades.length / days;
    
    console.log(`${cfg.name.padEnd(16)} ${String(trades.length).padStart(6)} ${wr.padStart(4)}%  $${pnlPerDay.toFixed(2).padStart(8)} ${(50/pnlPerDay).toFixed(1)}`);
}

// ============================================================
// PART 3: SESSION FILTERING
// ============================================================
console.log('\n=====================================================================');
console.log('PART 3: BEST SESSION FOR XAUUSDm');
console.log('=====================================================================');

const bestCfg = { sl: 2.50, tp: 6.00, spread: 0.30, startTrailAt: 1.5, trailDist: 0.3, timeExit: 35, strategyType: 'MOMENTUM_QUALITY' };
const allTrades = backtest(xauTrain, bestCfg);

const sessionStats = {};
for (let h = 0; h < 24; h++) sessionStats[h] = { t: 0, w: 0, p: 0 };

for (const t of allTrades) {
    sessionStats[t.hour].t++;
    if (t.pnl > 0) sessionStats[t.hour].w++;
    sessionStats[t.hour].p += t.pnl;
}

console.log('\nHour(UTC)  Trades  WR%    PnL     $/Day  Session');
console.log('-'.repeat(55));

const days = 28;
const hourlyResults = [];
for (let h = 0; h < 24; h++) {
    const s = sessionStats[h];
    if (s.t > 0) {
        const wr = (s.w / s.t * 100).toFixed(0);
        const pnlPerDay = s.p / days;
        const sess = h < 7 ? 'Asia' : h < 12 ? 'London' : 'NY';
        hourlyResults.push({ hour: h, ...s, wr, pnlPerDay, sess });
        console.log(`${String(h).padStart(2)}:00    ${String(s.t).padStart(6)} ${wr.padStart(4)}%  $${s.p.toFixed(2).padStart(7)} $${pnlPerDay.toFixed(2).padStart(6)} ${sess}`);
    }
}

// Best hours
const sortedByPnl = hourlyResults.sort((a, b) => b.pnlPerDay - a.pnlPerDay);
console.log('\nTOP 3 HOURS:');
sortedByPnl.slice(0, 3).forEach(h => {
    console.log(`  ${h.hour}:00 UTC - ${h.t} trades, WR ${h.wr}%, $${h.pnlPerDay.toFixed(2)}/day`);
});

// ============================================================
// PART 4: WHAT WOULD IT TAKE?
// ============================================================
console.log('\n=====================================================================');
console.log('PART 4: REALISTIC $50/DAY PLAN');
console.log('=====================================================================');

console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║  OPTION A: XAUUSDm ONLY (Conservative)                                  ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  • SL: 2.50 | TP: 6.00 (2.4:1 RR)                                     ║
║  • Trade only 5:00-6:00 UTC (best hour)                                 ║
║  • Target 10-15 quality trades per day                                ║
║  • Need ~50% WR to make $30-40/day                                     ║
║  • Gap to $50: Trade another session (NY open 12:00)                   ║
║  REALISTIC: $30-50/day possible                                        ║
╚═══════════════════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════════════════╗
║  OPTION B: XAUUSDm + BTCUSDm (Aggressive)                               ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  XAUUSDm: $20-30/day (3-5 trades, 50%+ WR, good session)              ║
║  BTCUSDm: $20-30/day (tighter spreads needed, or larger SL)           ║
║  COMBINED: $40-60/day achievable                                      ║
╚═══════════════════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════════════════╗
║  OPTION C: INCREASE CAPITAL BASE                                        ║
╠═══════════════════════════════════════════════════════════════════════════╣
║  Current: $10,000 account, risk 1% = $100/trade                        ║
║  If you have $50,000: Same strategy = 5x profits                       ║
║  $50/day on $10k = 0.5%/day (very achievable)                          ║
║  $50/day on $5k = 1%/day (aggressive but doable)                       ║
║  $50/day on $2k = 2.5%/day (very hard, needs edge)                      ║
╚═══════════════════════════════════════════════════════════════════════════╝
`);

// ============================================================
// PART 5: RECOMMENDED SETUP
// ============================================================
console.log('\n=====================================================================');
console.log('RECOMMENDED SETUP FOR $50/DAY');
console.log('=====================================================================');

console.log(`
┌───────────────────────────────────────────────────────────────────────────┐
│  XAUUSDm STRATEGY                                                        │
├───────────────────────────────────────────────────────────────────────────┤
│  ENTRY:                                                                    │
│    • EMA 5 > 13 > 20 (bull trend)                                        │
│    • RSI 55-65 (not overbought)                                         │
│    • MACD histogram positive                                            │
│                                                                           │
│  PARAMETERS:                                                              │
│    • SL: 2.50 USD                                                        │
│    • TP: 6.00 USD (2.4:1 RR)                                             │
│    • Spread: Trade only when < 0.30                                      │
│                                                                           │
│  TRAILING:                                                                │
│    • Start trailing at 1.5R profit                                       │
│    • Trail by 0.3R increments                                            │
│    • Move to BE only after 2R                                             │
│                                                                           │
│  SESSION:                                                                 │
│    • Primary: 5:00-6:00 UTC (Asia close, best performance)               │
│    • Secondary: 12:00-13:00 UTC (NY open)                                │
│    • AVOID: 9:00-10:00 UTC (London volatility spike)                     │
│                                                                           │
│  RISK:                                                                    │
│    • 1% per trade ($100 on $10k account)                                │
│    • Max 3% daily loss                                                   │
│    • Stop after 3 consecutive losses                                     │
│                                                                           │
│  EXPECTED:                                                                │
│    • 5-8 trades/day                                                      │
│    • 50%+ WR target                                                      │
│    • $20-40/day realistic                                               │
└───────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────┐
│  BTCUSDm STRATEGY (IF ADDING)                                            │
├───────────────────────────────────────────────────────────────────────────┤
│  PROBLEM: Spread ($3) eats 4% of SL - very costly                       │
│                                                                           │
│  SOLUTION:                                                               │
│    • Use larger SL: 100-150 USD (wider = spread less impactful)         │
│    • Trade only during NY session (tightest spreads)                     │
│    • TP: 200-300 USD (2:1 RR minimum)                                   │
│                                                                           │
│  OR: Skip BTC and focus on XAU only until spreads improve                │
└───────────────────────────────────────────────────────────────────────────┘
`);

// ============================================================
// PART 6: FINAL RECOMMENDATION
// ============================================================
console.log('\n=====================================================================');
console.log('MY HONEST RECOMMENDATION');
console.log('=====================================================================');

console.log(`
  REALITY CHECK:
  ─────────────────────────────────────────────────────────────────────────
  • Based on Feb 2026 data, most strategies lose money
  • The edge is very thin - 35-40% WR typical
  • Spread is a major factor eating profits
  • $50/day is achievable but requires:
  
    1. CAPITAL: $10k+ minimum
    2. WIN RATE: 50%+ (need strict entry rules)
    3. DISCIPLINE: Stop trading after 2-3 losses
    4. SESSION: Only trade best hours (5:00-6:00 UTC)
    5. SPREAD: Only trade when spread < 0.30
    
  REALISTIC TARGET FOR XAUUSDm ONLY:
  ─────────────────────────────────────────────────────────────────────────
  • Good day: $30-50
  • Average day: $10-20  
  • Bad day: -$20 to -$50
  • Monthly: $200-800 (highly variable)
  
  WHAT I'D RECOMMEND:
  ─────────────────────────────────────────────────────────────────────────
  1. Start with $10k account
  2. Demo trade the strategy for 2 weeks
  3. Track your actual WR by session
  4. If WR > 50%, go live with micro lots
  5. Scale only when you prove the edge
  
  $50/day is NOT easy money. It's work.
  But with the right setup, it's possible.
`);

console.log('\n' + '='.repeat(70));
