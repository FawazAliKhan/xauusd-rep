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

    console.log("=== REALISTIC BACKTEST RESULTS ===");
    console.log(`Total candles loaded: ${data.length}`);
    console.log("Rules: Signal on close, Entry on next open, 0.01 slippage, No lookahead");
    console.log("=");

    for (let i = 3; i < data.length; i++) {
        const current = data[i];
        
        // Calculate RSI(5) - NO LOOKAHEAD, only uses past data
        const closes = data.slice(i-5, i+1).map(x => x.close);
        let gain = 0, loss = 0;
        for (let j = 1; j < closes.length; j++) {
            const delta = closes[j] - closes[j-1];
            if (delta > 0) gain += delta;
            else loss += Math.abs(delta);
        }
        gain /= 5;
        loss /= 5;
        const rs = loss === 0 ? 100 : gain / loss;
        const rsi = 100 - (100 / (1 + rs));

        // Previous 3 candle high/low
        const prev3 = data.slice(i-3, i);
        const prev3High = Math.max(...prev3.map(x => x.high));
        const prev3Low = Math.min(...prev3.map(x => x.low));

        // Entry logic - ONLY IF NO POSITION
        if (position === null && i + 1 < data.length) {
            const nextCandle = data[i+1];
            
            // BUY SIGNAL: Current candle CLOSED above prev 3 high + RSI < 30
            if (current.close > prev3High && rsi < 30) {
                entryPrice = nextCandle.open + 0.01; // +0.01 slippage (realistic)
                sl = entryPrice - 3.00;
                tp = entryPrice + 4.50;
                position = 'buy';
                entryTime = nextCandle.time;
                continue;
            }
            
            // SELL SIGNAL: Current candle CLOSED below prev 3 low + RSI > 70
            if (current.close < prev3Low && rsi > 70) {
                entryPrice = nextCandle.open - 0.01; // -0.01 slippage (realistic)
                sl = entryPrice + 3.00;
                tp = entryPrice - 4.50;
                position = 'sell';
                entryTime = nextCandle.time;
                continue;
            }
        }

        // Exit logic
        if (position !== null) {
            if (position === 'buy') {
                // Check SL first (always)
                if (current.low <= sl) {
                    const profit = (sl - entryPrice) * 200 * 0.02;
                    balance += profit;
                    trades.push({ type: 'buy', entry: entryPrice, exit: sl, profit, reason: 'SL', entryTime, exitTime: current.time });
                    position = null;
                }
                // Check TP
                else if (current.high >= tp) {
                    const profit = (tp - entryPrice) * 200 * 0.02;
                    balance += profit;
                    trades.push({ type: 'buy', entry: entryPrice, exit: tp, profit, reason: 'TP', entryTime, exitTime: current.time });
                    position = null;
                }
            }
            else if (position === 'sell') {
                // Check SL first
                if (current.high >= sl) {
                    const profit = (entryPrice - sl) * 200 * 0.02;
                    balance += profit;
                    trades.push({ type: 'sell', entry: entryPrice, exit: sl, profit, reason: 'SL', entryTime, exitTime: current.time });
                    position = null;
                }
                // Check TP
                else if (current.low <= tp) {
                    const profit = (entryPrice - tp) * 200 * 0.02;
                    balance += profit;
                    trades.push({ type: 'sell', entry: entryPrice, exit: tp, profit, reason: 'TP', entryTime, exitTime: current.time });
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
    
    console.log("\nFirst 10 trades (verify execution order):");
    trades.slice(0, 10).forEach((t, i) => {
        console.log(`${i+1}. ${t.type.toUpperCase()} | Entry: ${t.entry.toFixed(3)} | Exit: ${t.exit.toFixed(3)} | ${t.reason} | $${t.profit.toFixed(2)}`);
    });
}

realisticBacktest();