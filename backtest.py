import pandas as pd
import numpy as np

# Read 1-minute data
df = pd.read_csv('XAUUSDm_1m_2026-02-01_to_2026-04-01.csv')
df['time'] = pd.to_datetime(df['time'])

# STRICT BACKTEST RULES:
# 1. Signal generated ONLY on candle CLOSE
# 2. Entry on NEXT candle OPEN
# 3. SL/TP checked on every subsequent candle
# 4. 0.1 pip slippage added (realistic Exness execution)
# 5. No repainting, no lookahead

def realistic_backtest(df):
    balance = 1000
    trades = []
    position = None
    entry_price = 0
    sl = 0
    tp = 0
    
    for i in range(3, len(df)):
        # Current candle is closed (i), we can calculate signals now
        current_close = df.iloc[i]['close']
        prev3_high = df.iloc[i-3:i]['high'].max()
        prev3_low = df.iloc[i-3:i]['low'].min()
        
        # RSI(5) calculation (no lookahead)
        delta = df.iloc[i-5:i+1]['close'].diff()
        gain = delta.where(delta > 0, 0).mean()
        loss = -delta.where(delta < 0, 0).mean()
        rs = gain / loss if loss != 0 else 100
        rsi = 100 - (100 / (1 + rs))
        
        # Entry signal - ONLY if no position
        if position is None:
            # Entry on NEXT CANDLE OPEN (i+1) if it exists
            if i + 1 >= len(df):
                continue
                
            # BUY SIGNAL: Close above prev 3 high + RSI < 30
            if current_close > prev3_high and rsi < 30:
                entry_price = df.iloc[i+1]['open'] + 0.01  # +0.01 slippage
                sl = entry_price - 3.00
                tp = entry_price + 4.50
                position = 'buy'
                entry_index = i + 1
                entry_time = df.iloc[i+1]['time']
                
            # SELL SIGNAL: Close below prev 3 low + RSI > 70
            elif current_close < prev3_low and rsi > 70:
                entry_price = df.iloc[i+1]['open'] - 0.01  # -0.01 slippage
                sl = entry_price + 3.00
                tp = entry_price - 4.50
                position = 'sell'
                entry_index = i + 1
                entry_time = df.iloc[i+1]['time']
        
        # Check exit conditions if in position
        else:
            current_high = df.iloc[i]['high']
            current_low = df.iloc[i]['low']
            current_close = df.iloc[i]['close']
            
            if position == 'buy':
                # Check stop loss first
                if current_low <= sl:
                    profit = (sl - entry_price) * 200 * 0.02  # 0.02 lots, XAU pip value = $200 per $1
                    balance += profit
                    trades.append({
                        'entry_time': entry_time,
                        'exit_time': df.iloc[i]['time'],
                        'type': 'buy',
                        'entry': entry_price,
                        'exit': sl,
                        'profit': profit,
                        'reason': 'SL'
                    })
                    position = None
                # Check take profit
                elif current_high >= tp:
                    profit = (tp - entry_price) * 200 * 0.02
                    balance += profit
                    trades.append({
                        'entry_time': entry_time,
                        'exit_time': df.iloc[i]['time'],
                        'type': 'buy',
                        'entry': entry_price,
                        'exit': tp,
                        'profit': profit,
                        'reason': 'TP'
                    })
                    position = None
                    
            elif position == 'sell':
                # Check stop loss first
                if current_high >= sl:
                    profit = (entry_price - sl) * 200 * 0.02
                    balance += profit
                    trades.append({
                        'entry_time': entry_time,
                        'exit_time': df.iloc[i]['time'],
                        'type': 'sell',
                        'entry': entry_price,
                        'exit': sl,
                        'profit': profit,
                        'reason': 'SL'
                    })
                    position = None
                # Check take profit
                elif current_low <= tp:
                    profit = (entry_price - tp) * 200 * 0.02
                    balance += profit
                    trades.append({
                        'entry_time': entry_time,
                        'exit_time': df.iloc[i]['time'],
                        'type': 'sell',
                        'entry': entry_price,
                        'exit': tp,
                        'profit': profit,
                        'reason': 'TP'
                    })
                    position = None
    
    return pd.DataFrame(trades), balance

trades_df, final_balance = realistic_backtest(df)

print("=== REALISTIC BACKTEST RESULTS ===")
print(f"Total trades: {len(trades_df)}")
print(f"Winning trades: {len(trades_df[trades_df['profit'] > 0])}")
print(f"Losing trades: {len(trades_df[trades_df['profit'] < 0])}")
print(f"Win rate: {len(trades_df[trades_df['profit'] > 0]) / len(trades_df) * 100:.1f}%")
print(f"Average win: ${trades_df[trades_df['profit'] > 0]['profit'].mean():.2f}")
print(f"Average loss: ${trades_df[trades_df['profit'] < 0]['profit'].mean():.2f}")
print(f"Net profit: ${final_balance - 1000:.2f}")
print(f"Average profit per day: ${(final_balance - 1000) / 60:.2f}")
print(f"Maximum drawdown: ${trades_df['profit'].cumsum().min():.2f}")
print("\nFirst 10 trades to verify execution:")
print(trades_df.head(10))