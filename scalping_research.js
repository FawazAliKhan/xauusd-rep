/**
 * Scalping Strategy Research Framework
 * XAUUSDm & BTCUSDm - Feb/Mar 2026
 * Tight Fixed USD Stop-Loss Scalping
 */

const fs = require('fs');

/**
 * Data Loading & Processing
 */
function loadCSV(filepath) {
    const content = fs.readFileSync(filepath, 'utf-8');
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',');
    
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const row = {};
        headers.forEach((h, idx) => {
            if (h === 'time') {
                row[h] = new Date(values[idx]);
            } else {
                row[h] = parseFloat(values[idx]);
            }
        });
        data.push(row);
    }
    return data;
}

function addSessionTags(data) {
    return data.map(row => {
        const hour = new Date(row.time).getUTCHours();
        let session = 'unknown';
        if (hour >= 0 && hour < 7) session = 'asia';
        else if (hour >= 7 && hour < 12) session = 'london';
        else if (hour >= 12 && hour < 17) session = 'ny_early';
        else if (hour >= 17 && hour < 21) session = 'ny_late';
        else session = 'asia';
        
        return { ...row, session, isAsia: session === 'asia', isLondon: session === 'london', isNY: session === 'ny_early' || session === 'ny_late' };
    });
}

/**
 * Indicator Calculations
 */
function calculateEMA(data, period) {
    const k = 2 / (period + 1);
    const ema = [];
    let prevEma = data[0].close;
    
    for (let i = 0; i < data.length; i++) {
        if (i === 0) {
            prevEma = data[i].close;
        } else {
            prevEma = data[i].close * k + prevEma * (1 - k);
        }
        ema.push(prevEma);
    }
    return ema;
}

function calculateRSI(data, period = 14) {
    const rsi = [];
    let gains = [], losses = [];
    
    for (let i = 1; i < data.length; i++) {
        const change = data[i].close - data[i-1].close;
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? -change : 0);
        
        if (i < period) {
            rsi.push(50);
        } else {
            const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
            const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
            if (avgLoss === 0) {
                rsi.push(100);
            } else {
                const rs = avgGain / avgLoss;
                rsi.push(100 - (100 / (1 + rs)));
            }
        }
    }
    return rsi;
}

function calculateMACD(data, fast = 12, slow = 26, signal = 9) {
    const emaFast = calculateEMA(data, fast);
    const emaSlow = calculateEMA(data, slow);
    const macdLine = emaFast.map((f, i) => f - emaSlow[i]);
    const signalLine = calculateEMA(macdLine.map((v, i) => ({ close: v })), signal);
    
    return {
        macd: macdLine,
        signal: signalLine,
        histogram: macdLine.map((m, i) => m - signalLine[i])
    };
}

function calculateATR(data, period = 14) {
    const tr = [data[0].high - data[0].low];
    const atr = [data[0].high - data[0].low];
    
    for (let i = 1; i < data.length; i++) {
        const highLow = data[i].high - data[i].low;
        const highClose = Math.abs(data[i].high - data[i-1].close);
        const lowClose = Math.abs(data[i].low - data[i-1].close);
        tr.push(Math.max(highLow, highClose, lowClose));
    }
    
    // SMA ATR for first value
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += tr[i];
        atr[i] = sum / period;
    }
    
    // EMA ATR for rest
    for (let i = period; i < data.length; i++) {
        atr[i] = (atr[i-1] * (period - 1) + tr[i]) / period;
    }
    
    return atr;
}

function calculateBollingerBands(data, period = 20, stdDev = 2) {
    const sma = [];
    const upper = [];
    const lower = [];
    
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            sma.push(null);
            upper.push(null);
            lower.push(null);
        } else {
            const slice = data.slice(i - period + 1, i + 1);
            const mean = slice.reduce((a, b) => a + b.close, 0) / period;
            const variance = slice.reduce((a, b) => a + Math.pow(b.close - mean, 2), 0) / period;
            const std = Math.sqrt(variance);
            
            sma.push(mean);
            upper.push(mean + stdDev * std);
            lower.push(mean - stdDev * std);
        }
    }
    
    return { mid: sma, upper, lower };
}

/**
 * Feature Engineering
 */
function engineerFeatures(data, symbol = 'XAUUSDm') {
    const ema5 = calculateEMA(data, 5);
    const ema8 = calculateEMA(data, 8);
    const ema13 = calculateEMA(data, 13);
    const ema20 = calculateEMA(data, 20);
    const ema50 = calculateEMA(data, 50);
    const ema200 = calculateEMA(data, 200);
    const rsi = calculateRSI(data, 14);
    const macd = calculateMACD(data);
    const atr = calculateATR(data, 14);
    const bb = calculateBollingerBands(data, 20, 2);
    
    return data.map((row, i) => {
        const trendUp = row.close > ema20[i] && ema20[i] > ema50[i];
        const trendDown = row.close < ema20[i] && ema20[i] < ema50[i];
        const momentum5 = i >= 5 ? (row.close - data[i-5].close) / data[i-5].close : 0;
        const momentum10 = i >= 10 ? (row.close - data[i-10].close) / data[i-10].close : 0;
        const dailyRangePct = (row.high - row.low) / row.close * 100;
        
        return {
            ...row,
            ema5, ema8, ema13, ema20, ema50, ema200,
            rsi,
            macd: macd.macd[i],
            macdSignal: macd.signal[i],
            macdHist: macd.histogram[i],
            atr: atr[i],
            bbMid: bb.mid[i],
            bbUpper: bb.upper[i],
            bbLower: bb.lower[i],
            trendUp,
            trendDown,
            momentum5,
            momentum10,
            dailyRangePct,
            priceVsEma5: (row.close - ema5[i]) / ema5[i] * 100,
            priceVsEma20: (row.close - ema20[i]) / ema20[i] * 100,
            ema5VsEma20: (ema5[i] - ema20[i]) / ema20[i] * 100
        };
    });
}

/**
 * Strategy Functions
 */
const StrategyLibrary = {
    emaCrossover: (data) => {
        const signals = new Array(data.length).fill(0);
        
        for (let i = 1; i < data.length; i++) {
            const curr = data[i];
            const prev = data[i-1];
            
            // Bullish crossover
            const ema5Above = curr.ema5 > curr.ema20;
            const ema5WasBelow = prev.ema5 <= prev.ema20;
            const bullishCross = ema5Above && ema5WasBelow;
            const trendBull = curr.close > curr.ema50;
            const rsiOk = curr.rsi > 40 && curr.rsi < 70;
            
            if (bullishCross && trendBull && rsiOk) {
                signals[i] = 1;
            }
            
            // Bearish crossover
            const ema5Below = curr.ema5 < curr.ema20;
            const ema5WasAbove = prev.ema5 >= prev.ema20;
            const bearishCross = ema5Below && ema5WasAbove;
            const trendBear = curr.close < curr.ema50;
            const rsiOkBear = curr.rsi > 30 && curr.rsi < 60;
            
            if (bearishCross && trendBear && rsiOkBear) {
                signals[i] = -1;
            }
        }
        return signals;
    },
    
    rsiReversal: (data, oversold = 35, overbought = 65) => {
        const signals = new Array(data.length).fill(0);
        
        for (let i = 2; i < data.length; i++) {
            const curr = data[i];
            const prev1 = data[i-1];
            const prev2 = data[i-2];
            
            // RSI reversal from oversold
            const rsiTurningUp = curr.rsi > prev1.rsi && prev1.rsi <= prev2.rsi;
            const rsiOversold = curr.rsi <= oversold;
            const priceOk = curr.close > curr.ema20;
            const macdOk = curr.macdHist > 0;
            
            if (rsiOversold && rsiTurningUp && priceOk && macdOk) {
                signals[i] = 1;
            }
            
            // RSI reversal from overbought
            const rsiTurningDown = curr.rsi < prev1.rsi && prev1.rsi >= prev2.rsi;
            const rsiOverbought = curr.rsi >= overbought;
            const priceOkBear = curr.close < curr.ema20;
            const macdOkBear = curr.macdHist < 0;
            
            if (rsiOverbought && rsiTurningDown && priceOkBear && macdOkBear) {
                signals[i] = -1;
            }
        }
        return signals;
    },
    
    bollingerBreakout: (data) => {
        const signals = new Array(data.length).fill(0);
        
        for (let i = 1; i < data.length; i++) {
            const curr = data[i];
            const prev = data[i-1];
            
            // Upper band breakout
            const breakout = curr.close > curr.bbUpper && prev.close <= prev.bbUpper;
            const trendOk = curr.close > curr.ema20;
            const rsiOk = curr.rsi > 50 && curr.rsi < 80;
            const atrOk = curr.atr > average(data.slice(Math.max(0, i-20), i+1).map(d => d.atr));
            
            if (breakout && trendOk && rsiOk && atrOk) {
                signals[i] = 1;
            }
            
            // Lower band breakout
            const breakoutDown = curr.close < curr.bbLower && prev.close >= prev.bbLower;
            const trendOkBear = curr.close < curr.ema20;
            const rsiOkBear = curr.rsi < 50 && curr.rsi > 20;
            
            if (breakoutDown && trendOkBear && rsiOkBear && atrOk) {
                signals[i] = -1;
            }
        }
        return signals;
    },
    
    macdMomentum: (data) => {
        const signals = new Array(data.length).fill(0);
        
        for (let i = 1; i < data.length; i++) {
            const curr = data[i];
            const prev = data[i-1];
            
            // MACD histogram turning positive
            const histTurningUp = curr.macdHist > 0 && prev.macdHist <= 0;
            const trendOk = curr.ema5 > curr.ema20;
            const rsiOk = curr.rsi > 45 && curr.rsi < 70;
            
            if (histTurningUp && trendOk && rsiOk) {
                signals[i] = 1;
            }
            
            // MACD histogram turning negative
            const histTurningDown = curr.macdHist < 0 && prev.macdHist >= 0;
            const trendOkBear = curr.ema5 < curr.ema20;
            const rsiOkBear = curr.rsi > 30 && curr.rsi < 55;
            
            if (histTurningDown && trendOkBear && rsiOkBear) {
                signals[i] = -1;
            }
        }
        return signals;
    },
    
    rangeExpansion: (data, lookback = 10) => {
        const signals = new Array(data.length).fill(0);
        
        for (let i = lookback; i < data.length; i++) {
            const curr = data[i];
            const avgAtr = average(data.slice(i - lookback, i).map(d => d.atr));
            const rangeExpanding = curr.atr > avgAtr * 1.2;
            
            // Bullish
            const momConfirmUp = curr.momentum5 > 0;
            const rsiOk = curr.rsi > 50 && curr.rsi < 75;
            const priceNearHigh = curr.close > average(data.slice(Math.max(0, i-5), i+1).map(d => d.high));
            
            if (rangeExpanding && momConfirmUp && rsiOk && priceNearHigh) {
                signals[i] = 1;
            }
            
            // Bearish
            const momConfirmDown = curr.momentum5 < 0;
            const rsiOkBear = curr.rsi > 25 && curr.rsi < 50;
            const priceNearLow = curr.close < average(data.slice(Math.max(0, i-5), i+1).map(d => d.low));
            
            if (rangeExpanding && momConfirmDown && rsiOkBear && priceNearLow) {
                signals[i] = -1;
            }
        }
        return signals;
    }
};

/**
 * Trade Management System
 */
class TradeManager {
    constructor(symbol = 'XAUUSDm') {
        this.symbol = symbol;
        this.defaultSL = symbol === 'XAUUSDm' ? 3.0 : 2.5;
        this.defaultTP = symbol === 'XAUUSDm' ? 6.0 : 5.0;
    }
    
    trailingStopATR(entryPrice, currentPrice, atr, position, trailMult = 2.0, minTrail = 0.5) {
        const trailDistance = Math.max(atr * trailMult, minTrail);
        return position > 0 ? currentPrice - trailDistance : currentPrice + trailDistance;
    }
    
    breakEvenPlusTrail(entryPrice, currentPrice, position, triggerPct = 1.5, trailPct = 0.5) {
        const trigger = this.defaultSL * triggerPct;
        
        if (position > 0) {
            const profit = currentPrice - entryPrice;
            if (profit >= trigger) {
                return entryPrice + (this.defaultSL * trailPct);
            }
        } else {
            const profit = entryPrice - currentPrice;
            if (profit >= trigger) {
                return entryPrice - (this.defaultSL * trailPct);
            }
        }
        return null;
    }
    
    partialExitLevels(entryPrice, position, firstExitPct = 0.5, secondExitPct = 0.3) {
        if (position > 0) {
            return {
                first: entryPrice + this.defaultTP * firstExitPct,
                second: entryPrice + this.defaultTP * (firstExitPct + secondExitPct)
            };
        } else {
            return {
                first: entryPrice - this.defaultTP * firstExitPct,
                second: entryPrice - this.defaultTP * (firstExitPct + secondExitPct)
            };
        }
    }
    
    timeBasedExit(barsInTrade, maxBars = 30) {
        return barsInTrade >= maxBars;
    }
    
    volatilityAdjustedExit(entryPrice, atr, position, volMult = 1.5, dirMult = 2.0) {
        if (position > 0) {
            return {
                target: entryPrice + atr * dirMult,
                stop: entryPrice - atr * volMult
            };
        } else {
            return {
                target: entryPrice - atr * dirMult,
                stop: entryPrice + atr * volMult
            };
        }
    }
}

/**
 * Backtesting Engine
 */
class ScalpBacktester {
    constructor(symbol = 'XAUUSDm', spreadPips = 2, commissionPct = 0.0002) {
        this.symbol = symbol;
        this.spreadPips = spreadPips;
        this.commissionPct = commissionPct;
    }
    
    runBacktest(data, strategyFunc, initialCapital = 10000, maxDailyLossPct = 0.05) {
        const signals = strategyFunc(data);
        const trades = [];
        const equity = [initialCapital];
        const tradeManager = new TradeManager(this.symbol);
        
        let position = 0;
        let entryPrice = 0;
        let entryTime = null;
        let entryBar = 0;
        let dailyPnL = 0;
        let lastDate = null;
        let lastSignal = 0;
        
        for (let i = 1; i < data.length; i++) {
            const currentTime = new Date(data[i].time);
            const currentDate = currentTime.toISOString().split('T')[0];
            const curr = data[i];
            
            // New day reset
            if (lastDate !== currentDate) {
                dailyPnL = 0;
                lastDate = currentDate;
            }
            
            // Check daily loss limit
            if (dailyPnL <= -maxDailyLossPct * initialCapital && position !== 0) {
                const exitPrice = curr.close - (this.spreadPips * (position > 0 ? 1 : -1));
                const pnl = this.calculatePnL(position, entryPrice, exitPrice);
                const result = pnl - this.spreadPips;
                dailyPnL += result;
                
                trades.push({
                    entryTime,
                    exitTime: currentTime,
                    direction: position > 0 ? 'long' : 'short',
                    entryPrice,
                    exitPrice,
                    pnl: result,
                    duration: i - entryBar
                });
                
                position = 0;
                equity.push(equity[equity.length - 1] + result);
                continue;
            }
            
            // Entry logic
            if (position === 0 && signals[i] !== 0 && signals[i] !== lastSignal) {
                position = signals[i];
                entryPrice = curr.close + (this.spreadPips * (position > 0 ? 1 : -1));
                entryTime = currentTime;
                entryBar = i;
            }
            
            // Exit logic
            if (position !== 0) {
                let exit = false;
                let exitPrice;
                
                // Fixed SL hit
                if (position > 0 && curr.low <= entryPrice - this.defaultSL) {
                    exit = true;
                    exitPrice = entryPrice - this.defaultSL;
                } else if (position < 0 && curr.high >= entryPrice + this.defaultSL) {
                    exit = true;
                    exitPrice = entryPrice + this.defaultSL;
                }
                
                // TP hit
                const tpDist = this.defaultTP;
                if (position > 0 && curr.high >= entryPrice + tpDist) {
                    exit = true;
                    exitPrice = entryPrice + tpDist;
                } else if (position < 0 && curr.low <= entryPrice - tpDist) {
                    exit = true;
                    exitPrice = entryPrice - tpDist;
                }
                
                // Trailing stop activation after 1.5R profit
                const trailTrigger = this.defaultSL * 1.5;
                if (position > 0 && (curr.close - entryPrice) >= trailTrigger) {
                    const trailPrice = curr.close - this.defaultSL * 0.5;
                    if (curr.low <= trailPrice) {
                        exit = true;
                        exitPrice = trailPrice;
                    }
                } else if (position < 0 && (entryPrice - curr.close) >= trailTrigger) {
                    const trailPrice = curr.close + this.defaultSL * 0.5;
                    if (curr.high >= trailPrice) {
                        exit = true;
                        exitPrice = trailPrice;
                    }
                }
                
                // Time exit
                if (i - entryBar >= 30) {
                    exit = true;
                    exitPrice = curr.close - (this.spreadPips * (position > 0 ? 1 : -1));
                }
                
                if (exit) {
                    const pnl = this.calculatePnL(position, entryPrice, exitPrice);
                    const result = pnl - this.spreadPips;
                    dailyPnL += result;
                    
                    trades.push({
                        entryTime,
                        exitTime: currentTime,
                        direction: position > 0 ? 'long' : 'short',
                        entryPrice,
                        exitPrice,
                        pnl: result,
                        duration: i - entryBar
                    });
                    
                    position = 0;
                }
            }
            
            lastSignal = signals[i];
            equity.push(equity[equity.length - 1] + (position !== 0 ? 0 : dailyPnL - equity[equity.length - 1]));
        }
        
        const metrics = this.calculateMetrics(trades, equity);
        return { trades, equity, metrics };
    }
    
    calculatePnL(position, entry, exitPrice) {
        return position > 0 ? exitPrice - entry : entry - exitPrice;
    }
    
    calculateMetrics(trades, equity) {
        if (trades.length === 0) {
            return { totalTrades: 0, winRate: 0, profitFactor: 0, totalPnL: 0 };
        }
        
        const wins = trades.filter(t => t.pnl > 0);
        const losses = trades.filter(t => t.pnl <= 0);
        const totalWin = wins.reduce((a, b) => a + b.pnl, 0);
        const totalLoss = Math.abs(losses.reduce((a, b) => a + b.pnl, 0));
        
        // Max drawdown
        let maxDD = 0;
        let peak = equity[0];
        for (const e of equity) {
            if (e > peak) peak = e;
            const dd = (peak - e) / peak;
            if (dd > maxDD) maxDD = dd;
        }
        
        return {
            totalTrades: trades.length,
            winningTrades: wins.length,
            losingTrades: losses.length,
            winRate: (wins.length / trades.length * 100).toFixed(1),
            avgWin: wins.length > 0 ? (totalWin / wins.length).toFixed(2) : 0,
            avgLoss: losses.length > 0 ? (totalLoss / losses.length).toFixed(2) : 0,
            profitFactor: losses.length > 0 && totalLoss > 0 ? (totalWin / totalLoss).toFixed(2) : totalWin > 0 ? 'inf' : 0,
            totalPnL: (equity[equity.length - 1] - equity[0]).toFixed(2),
            maxDrawdown: (maxDD * 100).toFixed(2),
            avgDuration: (trades.reduce((a, b) => a + b.duration, 0) / trades.length).toFixed(1)
        };
    }
}

/**
 * Analysis Functions
 */
function analyzeBySession(trades) {
    const sessionStats = { asia: [], london: [], ny: [] };
    
    for (const trade of trades) {
        const hour = new Date(trade.entryTime).getUTCHours();
        let session = 'ny';
        if (hour < 7) session = 'asia';
        else if (hour < 12) session = 'london';
        sessionStats[session].push(trade.pnl);
    }
    
    const results = {};
    for (const [session, pnls] of Object.entries(sessionStats)) {
        if (pnls.length > 0) {
            results[session] = {
                trades: pnls.length,
                totalPnL: pnls.reduce((a, b) => a + b, 0).toFixed(2),
                avgPnL: (pnls.reduce((a, b) => a + b, 0) / pnls.length).toFixed(2),
                winRate: (pnls.filter(p => p > 0).length / pnls.length * 100).toFixed(1)
            };
        }
    }
    return results;
}

function analyzeByDirection(trades) {
    const longs = trades.filter(t => t.direction === 'long');
    const shorts = trades.filter(t => t.direction === 'short');
    
    return {
        longs: longs.length > 0 ? {
            trades: longs.length,
            winRate: (longs.filter(t => t.pnl > 0).length / longs.length * 100).toFixed(1),
            totalPnL: longs.reduce((a, b) => a + b.pnl, 0).toFixed(2)
        } : { trades: 0 },
        shorts: shorts.length > 0 ? {
            trades: shorts.length,
            winRate: (shorts.filter(t => t.pnl > 0).length / shorts.length * 100).toFixed(1),
            totalPnL: shorts.reduce((a, b) => a + b.pnl, 0).toFixed(2)
        } : { trades: 0 }
    };
}

function analyzeByDuration(trades) {
    const bins = { '0-5': [], '5-10': [], '10-20': [], '20-30': [], '30+': [] };
    
    for (const trade of trades) {
        if (trade.duration <= 5) bins['0-5'].push(trade.pnl);
        else if (trade.duration <= 10) bins['5-10'].push(trade.pnl);
        else if (trade.duration <= 20) bins['10-20'].push(trade.pnl);
        else if (trade.duration <= 30) bins['20-30'].push(trade.pnl);
        else bins['30+'].push(trade.pnl);
    }
    
    const results = {};
    for (const [bin, pnls] of Object.entries(bins)) {
        if (pnls.length > 0) {
            results[bin] = {
                trades: pnls.length,
                totalPnL: pnls.reduce((a, b) => a + b, 0).toFixed(2),
                avgPnL: (pnls.reduce((a, b) => a + b, 0) / pnls.length).toFixed(2)
            };
        }
    }
    return results;
}

/**
 * Utility Functions
 */
function average(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function splitData(data, date) {
    const splitDate = new Date(date);
    return {
        train: data.filter(d => new Date(d.time) < splitDate),
        test: data.filter(d => new Date(d.time) >= splitDate)
    };
}

/**
 * Main Research Pipeline
 */
function runResearchPipeline() {
    console.log('='.repeat(80));
    console.log('SCALPING STRATEGY RESEARCH - XAUUSDm & BTCUSDm');
    console.log('Feb-Mar 2026 | Tight Fixed USD Stop-Loss');
    console.log('='.repeat(80));
    
    // Load data
    console.log('\n[1] Loading data...');
    const xauRaw = loadCSV('XAUUSDm_1m_2026-02-01_to_2026-04-01.csv');
    const btcRaw = loadCSV('BTCUSDm_1m_2026-02-01_to_2026-04-01.csv');
    
    console.log(`   XAUUSDm: ${xauRaw.length} bars`);
    console.log(`   BTCUSDm: ${btcRaw.length} bars`);
    
    // Engineer features
    console.log('\n[2] Engineering features...');
    const xauData = engineerFeatures(addSessionTags(xauRaw), 'XAUUSDm');
    const btcData = engineerFeatures(addSessionTags(btcRaw), 'BTCUSDm');
    
    // Split data
    console.log('\n[3] Splitting in-sample/out-of-sample...');
    const xauSplit = splitData(xauData, '2026-03-01');
    const btcSplit = splitData(btcData, '2026-03-01');
    
    console.log(`   XAUUSDm Train: ${xauSplit.train.length} bars`);
    console.log(`   XAUUSDm Test: ${xauSplit.test.length} bars`);
    console.log(`   BTCUSDm Train: ${btcSplit.train.length} bars`);
    console.log(`   BTCUSDm Test: ${btcSplit.test.length} bars`);
    
    // Define strategies
    const strategies = {
        'EMA_Crossover': StrategyLibrary.emaCrossover,
        'RSI_Reversal': StrategyLibrary.rsiReversal,
        'Bollinger_Breakout': StrategyLibrary.bollingerBreakout,
        'MACD_Momentum': StrategyLibrary.macdMomentum,
        'Range_Expansion': StrategyLibrary.rangeExpansion
    };
    
    // Backtest each strategy
    console.log('\n[4] Running backtests...');
    const results = {};
    
    for (const [stratName, stratFunc] of Object.entries(strategies)) {
        console.log(`\n   Testing ${stratName}...`);
        
        const backtesterXau = new ScalpBacktester('XAUUSDm', 2.0);
        const resXau = backtesterXau.runBacktest(xauSplit.train, stratFunc, 10000);
        
        const backtesterBtc = new ScalpBacktester('BTCUSDm', 3.0);
        const resBtc = backtesterBtc.runBacktest(btcSplit.train, stratFunc, 10000);
        
        results[stratName] = {
            XAUUSDm: resXau,
            BTCUSDm: resBtc
        };
        
        console.log(`      XAUUSDm: ${resXau.metrics.totalTrades} trades, WR: ${resXau.metrics.winRate}%, PF: ${resXau.metrics.profitFactor}, PnL: $${resXau.metrics.totalPnL}`);
        console.log(`      BTCUSDm: ${resBtc.metrics.totalTrades} trades, WR: ${resBtc.metrics.winRate}%, PF: ${resBtc.metrics.profitFactor}, PnL: $${resBtc.metrics.totalPnL}`);
    }
    
    // Rank strategies
    console.log('\n[5] Strategy Ranking...');
    console.log('\n' + '='.repeat(80));
    console.log('STRATEGY RANKING (In-Sample Feb 2026)');
    console.log('='.repeat(80));
    
    const rankings = [];
    for (const [stratName, res] of Object.entries(results)) {
        for (const symbol of ['XAUUSDm', 'BTCUSDm']) {
            const m = res[symbol].metrics;
            if (m.totalTrades > 0) {
                const score = parseFloat(m.winRate) * 0.3 + 
                             Math.min(parseFloat(m.profitFactor), 3) * 20 + 
                             (100 - parseFloat(m.maxDrawdown)) * 0.3;
                rankings.push({
                    strategy: stratName,
                    symbol,
                    trades: m.totalTrades,
                    winRate: m.winRate,
                    profitFactor: m.profitFactor,
                    totalPnL: m.totalPnL,
                    maxDD: m.maxDrawdown,
                    score: score.toFixed(1)
                });
            }
        }
    }
    
    rankings.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));
    console.log('\nStrategy             Symbol     Trades  WR%    PF    PnL      MaxDD  Score');
    console.log('-'.repeat(80));
    for (const r of rankings) {
        console.log(`${r.strategy.padEnd(20)} ${r.symbol.padEnd(10)} ${String(r.trades).padStart(6)} ${r.winRate.padStart(5)} ${r.profitFactor.padStart(5)} $${r.totalPnL.padStart(8)} ${r.maxDD.padStart(6)}% ${r.score}`);
    }
    
    // Deep analysis of top strategies
    console.log('\n[6] Deep Analysis of Top Strategies...');
    
    const topStrategies = rankings.slice(0, 4);
    
    for (const r of topStrategies) {
        const res = results[r.strategy][r.symbol];
        console.log(`\n${r.strategy} on ${r.symbol}:`);
        
        const sessionAnalysis = analyzeBySession(res.trades);
        console.log('   Session Analysis:');
        for (const [session, stats] of Object.entries(sessionAnalysis)) {
            console.log(`      ${session}: ${stats.trades} trades, WR: ${stats.winRate}%, PnL: $${stats.totalPnL}`);
        }
        
        const dirAnalysis = analyzeByDirection(res.trades);
        console.log('   Direction Analysis:');
        console.log(`      Longs: ${dirAnalysis.longs.trades} trades, WR: ${dirAnalysis.longs.winRate}%, PnL: $${dirAnalysis.longs.totalPnL}`);
        console.log(`      Shorts: ${dirAnalysis.shorts.trades} trades, WR: ${dirAnalysis.shorts.winRate}%, PnL: $${dirAnalysis.shorts.totalPnL}`);
        
        const durationAnalysis = analyzeByDuration(res.trades);
        console.log('   Duration Analysis:');
        for (const [bin, stats] of Object.entries(durationAnalysis)) {
            console.log(`      ${bin}min: ${stats.trades} trades, Avg PnL: $${stats.avgPnL}`);
        }
    }
    
    // Out-of-sample validation
    console.log('\n[7] Out-of-Sample Validation (March 2026)...');
    console.log('\n' + '='.repeat(80));
    
    for (const r of topStrategies) {
        const stratFunc = strategies[r.strategy];
        const backtester = new ScalpBacktester(r.symbol, r.symbol === 'XAUUSDm' ? 2.0 : 3.0);
        const res = backtester.runBacktest(
            r.symbol === 'XAUUSDm' ? xauSplit.test : btcSplit.test, 
            stratFunc, 
            10000
        );
        
        console.log(`\n${r.strategy} on ${r.symbol} (March 2026):`);
        console.log(`   Trades: ${res.metrics.totalTrades}, WR: ${res.metrics.winRate}%, PF: ${res.metrics.profitFactor}`);
        console.log(`   PnL: $${res.metrics.totalPnL}, MaxDD: ${res.metrics.maxDrawdown}%`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('RESEARCH COMPLETE');
    console.log('='.repeat(80));
    
    return { results, rankings };
}

// Helper to add defaultSL to ScalpBacktester
ScalpBacktester.prototype.defaultSL = 3.0;

// Run the research
const { results, rankings } = runResearchPipeline();
