const fs = require('fs');
const readline = require('readline');

async function realisticBacktest() {
    const data = [];
    const rl = readline.createInterface({
        input: fs.createReadStream('XAUUSDm_1m_2026-02-01_to_2026-04-01.csv'),
        crlfDelay: Infinity
    });

    let firstLine = true;
    for await (const line of rl) {
        if (firstLine) { firstLine = false; continue; }
        const parts = line.split(',');
        data.push({
            time: parts[0],
            open: parseFloat(parts[1]),
            high: parseFloat(parts[2]),
            low: parseFloat(parts[3]),
            close: parseFloat(parts[4]),
            volume: parseFloat(parts[5])
        });
    }

    let balance = 1000;
    const trades = [];
    let position = null;
    let entryPrice = 0;
    let sl = 0;
    let tp = 0;
    let entryTime = null;

    console.log("=== IMPROVED REALISTIC BACKTEST RESULTS ===");
    console.log(`Total candles loaded: ${data.length}`);
    console.log("Parameters: SL=4.0, TP=4.0, RSI(14), 2 candle breakout");
    console.log("=");

    for (let i = 14; i < data.length; i++) {
        const current = data[i];
        
        // Calculate RSI(14)
        const closes = data.slice(i-14, i+1).map(x => x.close);
        let gain = 0, loss = 0;
        for (let j = 1; j < closes.length; j++) {
            const delta = closes[j] - closes[j-1];
            if (delta > 0) gain += delta;
            else loss += Math.abs(delta);
        }
        gain /= 14;
        loss /= 14;
        const rs = loss === 0 ? 100 : gain / loss;
        const rsi = 100 - (100 / (1 + rs));

        const prev2 = data.slice(i-2, i);
        const prev2High = Math.max(...prev2.map(x => x.high));
        const prev2Low = Math.min(...prev2.map(x => x.low));

        if (position === null && i + 1 < data.length) {
            const nextCandle = data[i+1];
            
            if (current.close > prev2High && rsi < 45) {
                entryPrice = nextCandle.open + 0.01;
                sl = entryPrice - 4.00;
                tp = entryPrice + 4.00;
                position = 'buy';
                entryTime = nextCandle.time;
                continue;
            }
            
            if (current.close < prev2Low && rsi > 55) {
                entryPrice = nextCandle.open - 0.01;
                sl = entryPrice + 4.00;
                tp = entryPrice - 4.00;
                position = 'sell';
                entryTime = nextCandle.time;
                continue;
            }
        }

        if (position !== null) {
            if (position === 'buy') {
                if (current.low <= sl) {
                    const profit = (sl - entryPrice) * 100;
                    balance += profit;
                    trades.push({ type: 'buy', entry: entryPrice, exit: sl, profit, reason: 'SL' });
                    position = null;
                }
                else if (current.high >= tp) {
                    const profit = (tp - entryPrice) * 100;
                    balance += profit;
                    trades.push({ type: 'buy', entry: entryPrice, exit: tp, profit, reason: 'TP' });
                    position = null;
                }
            }
            else if (position === 'sell') {
                if (current.high >= sl) {
                    const profit = (entryPrice - sl) * 100;
                    balance += profit;
                    trades.push({ type: 'sell', entry: entryPrice, exit: sl, profit, reason: 'SL' });
                    position = null;
                }
                else if (current.low <= tp) {
                    const profit = (entryPrice - tp) * 100;
                    balance += profit;
                    trades.push({ type: 'sell', entry: entryPrice, exit: tp, profit, reason: 'TP' });
                    position = null;
                }
            }
        }
    }

    const wins = trades.filter(t => t.profit > 0);
    const losses = trades.filter(t => t.profit < 0);
    
    console.log(`Total trades: ${trades.length}`);
    console.log(`Winning trades: ${wins.length}`);
    console.log(`Losing trades: ${losses.length}`);
    console.log(`Win rate: ${(wins.length / trades.length * 100).toFixed(1)}%`);
    console.log(`Average win: $${(wins.reduce((a,b) => a + b.profit, 0) / wins.length).toFixed(2)}`);
    console.log(`Average loss: $${(losses.reduce((a,b) => a + b.profit, 0) / losses.length).toFixed(2)}`);
    console.log(`Net profit: $${(balance - 1000).toFixed(2)}`);
    console.log(`Average profit per day: $${((balance - 1000) / 60).toFixed(2)}`);
    
    const cumsum = trades.map((_, i) => trades.slice(0, i+1).reduce((a,b) => a + b.profit, 0));
    console.log(`Maximum drawdown: $${Math.min(...cumsum).toFixed(2)}`);
    console.log(`Profit factor: ${(wins.reduce((a,b) => a + b.profit, 0) / Math.abs(losses.reduce((a,b) => a + b.profit, 0))).toFixed(2)}`);
}

realisticBacktest();