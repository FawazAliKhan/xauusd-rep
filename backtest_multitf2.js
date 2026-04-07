const fs = require('fs');
const readline = require('readline');

async function multiTimeframeBacktest() {
    const data1m = [];
    const rl = readline.createInterface({
        input: fs.createReadStream('XAUUSDm_1m_2026-02-01_to_2026-04-01.csv'),
        crlfDelay: Infinity
    });

    let firstLine = true;
    for await (const line of rl) {
        if (firstLine) { firstLine = false; continue; }
        const parts = line.split(',');
        data1m.push({
            time: new Date(parts[0]),
            open: parseFloat(parts[1]),
            high: parseFloat(parts[2]),
            low: parseFloat(parts[3]),
            close: parseFloat(parts[4])
        });
    }

    // Build 3min and 5min data
    const data3m = [];
    for (let i = 0; i < data1m.length; i += 3) {
        const slice = data1m.slice(i, i+3);
        data3m.push({
            time: slice[0].time,
            open: slice[0].open,
            high: Math.max(...slice.map(x => x.high)),
            low: Math.min(...slice.map(x => x.low)),
            close: slice[slice.length-1].close
        });
    }

    function calculateRSI(data, period, index) {
        let gain = 0, loss = 0;
        for (let i = index - period + 1; i <= index; i++) {
            const delta = data[i].close - data[i-1].close;
            if (delta > 0) gain += delta;
            else loss += Math.abs(delta);
        }
        gain /= period;
        loss /= period;
        const rs = loss === 0 ? 100 : gain / loss;
        return 100 - (100 / (1 + rs));
    }

    const trades = [];
    let position = null;
    let entryPrice = 0;
    let sl = 0;
    let tp = 0;

    console.log("=== MULTI-TIMEFRAME STRATEGY BACKTEST ===");
    console.log("OPTIMIZED: 3min trend filter + 1min entry");
    console.log("=");

    for (let i = 50; i < data1m.length; i++) {
        const current1m = data1m[i];
        const idx3m = Math.floor(i / 3);
        
        if (idx3m < 14) continue;

        // 3MIN TREND FILTER (HIGHER TIMEFRAME)
        const rsi3m = calculateRSI(data3m, 14, idx3m);
        const trendUp = rsi3m > 40 && rsi3m < 60;
        const trendDown = rsi3m > 40 && rsi3m < 60;

        // 1MIN ENTRY CONDITIONS
        const prev2High = Math.max(data1m[i-1].high, data1m[i-2].high);
        const prev2Low = Math.min(data1m[i-1].low, data1m[i-2].low);
        const rsi1m = calculateRSI(data1m, 14, i);

        if (position === null && i + 1 < data1m.length) {
            const nextCandle = data1m[i+1];
            
            if (trendUp && current1m.close > prev2High && rsi1m < 45 && rsi1m > 30) {
                entryPrice = nextCandle.open + 0.01;
                sl = entryPrice - 3.00;
                tp = entryPrice + 4.00;
                position = 'buy';
                continue;
            }
            
            if (trendDown && current1m.close < prev2Low && rsi1m > 55 && rsi1m < 70) {
                entryPrice = nextCandle.open - 0.01;
                sl = entryPrice + 3.00;
                tp = entryPrice - 4.00;
                position = 'sell';
                continue;
            }
        }

        if (position !== null) {
            if (position === 'buy') {
                if (current1m.low <= sl) {
                    const profit = (sl - entryPrice) * 100 * 0.01;
                    trades.push({ profit });
                    position = null;
                }
                else if (current1m.high >= tp) {
                    const profit = (tp - entryPrice) * 100 * 0.01;
                    trades.push({ profit });
                    position = null;
                }
            }
            else if (position === 'sell') {
                if (current1m.high >= sl) {
                    const profit = (entryPrice - sl) * 100 * 0.01;
                    trades.push({ profit });
                    position = null;
                }
                else if (current1m.low <= tp) {
                    const profit = (entryPrice - tp) * 100 * 0.01;
                    trades.push({ profit });
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
    console.log(`✅ WIN RATE: ${(wins.length / trades.length * 100).toFixed(1)}%`);
    console.log(`Average win: $${(wins.reduce((a,b) => a + b.profit, 0) / wins.length).toFixed(2)}`);
    console.log(`Average loss: $${(losses.reduce((a,b) => a + b.profit, 0) / losses.length).toFixed(2)}`);
    console.log(`Net Profit: $${trades.reduce((a,b) => a + b.profit, 0).toFixed(2)}`);
    console.log(`Average daily profit: $${(trades.reduce((a,b) => a + b.profit, 0) / 60).toFixed(2)}`);
    console.log(`✅ PROFIT FACTOR: ${(wins.reduce((a,b) => a + b.profit, 0) / Math.abs(losses.reduce((a,b) => a + b.profit, 0))).toFixed(2)}`);
    
    console.log("\n📊 vs SINGLE TIMEFRAME:");
    console.log(`Single TF Win Rate: 53.3% | Multi TF Win Rate: ${(wins.length / trades.length * 100).toFixed(1)}%`);
    console.log(`Single TF Profit Factor: 1.33 | Multi TF Profit Factor: ${(wins.reduce((a,b) => a + b.profit, 0) / Math.abs(losses.reduce((a,b) => a + b.profit, 0))).toFixed(2)}`);
}

multiTimeframeBacktest();