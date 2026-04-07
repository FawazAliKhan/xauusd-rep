/**
 * Scalping Strategy Research - Reusable Skill
 * Can be loaded and used for future strategy development
 */

const fs = require('fs');

class ScalpingResearch {
    constructor() {
        this.results = [];
        this.strategies = {};
    }

    loadCSV(filepath) {
        const lines = fs.readFileSync(filepath, 'utf-8').trim().split('\n');
        const headers = lines[0].split(',');
        return lines.slice(1).map(l => {
            const v = l.split(',');
            const row = {};
            headers.forEach((h, i) => row[h] = h === 'time' ? new Date(v[i]) : parseFloat(v[i]));
            return row;
        });
    }

    calculateEMA(prices, period) {
        const k = 2 / (period + 1);
        let prev = prices[0];
        return prices.map(p => prev = p * k + prev * (1 - k));
    }

    calculateRSI(prices, period = 14) {
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

    calculateATR(data, period = 14) {
        const tr = [data[0].high - data[0].low];
        const atr = [tr[0]];
        for (let i = 1; i < data.length; i++) {
            tr[i] = Math.max(data[i].high - data[i].low, Math.abs(data[i].high - data[i-1].close), Math.abs(data[i].low - data[i-1].close));
            if (i === period - 1) atr[i] = tr.slice(0, period).reduce((a,b) => a+b, 0) / period;
            else atr[i] = (atr[i-1] * (period-1) + tr[i]) / period;
        }
        return atr;
    }

    engineerFeatures(data) {
        const close = data.map(d => d.close);
        const ema5 = this.calculateEMA(close, 5);
        const ema13 = this.calculateEMA(close, 13);
        const ema20 = this.calculateEMA(close, 20);
        const ema50 = this.calculateEMA(close, 50);
        const rsi = this.calculateRSI(close, 14);
        const atr = this.calculateATR(data, 14);
        
        return data.map((d, i) => {
            const hour = d.time.getUTCHours();
            let session = 'ny';
            if (hour < 7) session = 'asia';
            else if (hour < 12) session = 'london';
            return { ...d, ema5: ema5[i], ema13: ema13[i], ema20: ema20[i], ema50: ema50[i], rsi: rsi[i], atr: atr[i], session };
        });
    }

    generateSignal(data, type) {
        const signals = new Array(data.length).fill(0);
        for (let i = 5; i < data.length; i++) {
            const curr = data[i], prev = data[i-1];
            switch(type) {
                case 'ema_cross':
                    if (curr.ema5 > curr.ema13 && prev.ema5 <= prev.ema13) signals[i] = 1;
                    if (curr.ema5 < curr.ema13 && prev.ema5 >= prev.ema13) signals[i] = -1;
                    break;
                case 'rsi_rev':
                    if (curr.rsi <= 40 && curr.rsi > prev.rsi) signals[i] = 1;
                    if (curr.rsi >= 60 && curr.rsi < prev.rsi) signals[i] = -1;
                    break;
                case 'momentum':
                    if (curr.ema5 > curr.ema20 && curr.rsi > 50 && curr.rsi < 70) signals[i] = 1;
                    if (curr.ema5 < curr.ema20 && curr.rsi < 50 && curr.rsi > 30) signals[i] = -1;
                    break;
            }
        }
        return signals;
    }

    backtest(data, config) {
        const { sl, tp, spread, signalType } = config;
        const signals = this.generateSignal(data, signalType);
        const trades = [];
        let equity = 10000, pos = 0, entry = 0;
        
        for (let i = 1; i < data.length; i++) {
            const curr = data[i], prev = data[i-1];
            if (pos === 0 && signals[i] !== 0 && signals[i] !== signals[i-1]) {
                pos = signals[i];
                entry = curr.close + spread * (pos > 0 ? 1 : -1);
            }
            if (pos !== 0) {
                const profit = pos > 0 ? curr.close - entry : entry - curr.close;
                if ((pos > 0 && curr.low <= entry - sl) || (pos < 0 && curr.high >= entry + sl)) {
                    trades.push({ pnl: (pos > 0 ? -sl : -sl) - spread });
                    equity += trades[trades.length-1].pnl;
                    pos = 0;
                } else if ((pos > 0 && curr.high >= entry + tp) || (pos < 0 && curr.low <= entry - tp)) {
                    trades.push({ pnl: (pos > 0 ? tp : tp) - spread });
                    equity += trades[trades.length-1].pnl;
                    pos = 0;
                }
            }
        }
        return this.calcMetrics(trades, equity);
    }

    calcMetrics(trades, equity) {
        if (!trades.length) return { t: 0, wr: 0, pf: 0, pnl: 0 };
        const wins = trades.filter(t => t.pnl > 0);
        const tw = wins.reduce((a,b) => a+b.pnl, 0);
        const tl = Math.abs(trades.filter(t => t.pnl <= 0).reduce((a,b) => a+b.pnl, 0));
        return {
            t: trades.length,
            wr: wins.length / trades.length * 100,
            pf: tl > 0 ? tw / tl : 999,
            pnl: equity - 10000
        };
    }

    runFullResearch(symbol, trainData, testData) {
        const strategies = ['ema_cross', 'rsi_rev', 'momentum'];
        const params = symbol === 'XAUUSDm' 
            ? [{sl: 2, tp: 4, spread: 2}, {sl: 3, tp: 6, spread: 2}]
            : [{sl: 2, tp: 4, spread: 3}, {sl: 2.5, tp: 5, spread: 3}];
        
        const results = [];
        for (const p of params) {
            for (const s of strategies) {
                const train = this.backtest(trainData, {...p, signalType: s});
                const test = this.backtest(testData, {...p, signalType: s});
                results.push({ strategy: s, ...p, train, test });
            }
        }
        return results;
    }
}

module.exports = ScalpingResearch;
