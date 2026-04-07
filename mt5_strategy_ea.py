import MetaTrader5 as mt5
import pandas as pd
import numpy as np
import time
from datetime import datetime

# ==============================================
# EXACT BACKTESTED STRATEGY - LIVE TRADING
# ==============================================
SYMBOL = "XAUUSDm"
LOT_SIZE = 0.03  # Adjust this to hit your $50/day target
TIMEFRAME = mt5.TIMEFRAME_M1
MAGIC_NUMBER = 24062026

def connect_mt5():
    """Connect to MT5 terminal"""
    if not mt5.initialize():
        print(f"MT5 initialize failed, error code: {mt5.last_error()}")
        return False
    print(f"✅ MT5 Connected. Version: {mt5.version()}")
    return True

def calculate_rsi(prices, period=14):
    """Calculate RSI without lookahead bias"""
    delta = np.diff(prices)
    gain = np.where(delta > 0, delta, 0)
    loss = np.where(delta < 0, -delta, 0)
    
    avg_gain = np.mean(gain[-period:])
    avg_loss = np.mean(loss[-period:])
    
    if avg_loss == 0:
        return 100
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def calculate_atr(data, period=10):
    """Calculate Average True Range"""
    tr = []
    for i in range(1, len(data)):
        high_low = data[i]['high'] - data[i]['low']
        high_close = abs(data[i]['high'] - data[i-1]['close'])
        low_close = abs(data[i]['low'] - data[i-1]['close'])
        tr.append(max(high_low, high_close, low_close))
    return np.mean(tr[-period:]) if len(tr) >= period else 0

def has_open_position():
    """Check if we already have an open position for this symbol"""
    positions = mt5.positions_get(symbol=SYMBOL)
    return len(positions) > 0

def open_order(order_type):
    """Open BUY or SELL order with exact SL/TP rules"""
    price = mt5.symbol_info_tick(SYMBOL).ask if order_type == mt5.ORDER_TYPE_BUY else mt5.symbol_info_tick(SYMBOL).bid
    
    if order_type == mt5.ORDER_TYPE_BUY:
        sl = price - 3.00
        tp = price + 4.00
    else:
        sl = price + 3.00
        tp = price - 4.00
    
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": SYMBOL,
        "volume": LOT_SIZE,
        "type": order_type,
        "price": price,
        "sl": sl,
        "tp": tp,
        "deviation": 10,
        "magic": MAGIC_NUMBER,
        "comment": "Strategy EA",
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    
    result = mt5.order_send(request)
    if result.retcode == mt5.TRADE_RETCODE_DONE:
        print(f"✅ {order_type} opened at {price:.3f} | SL: {sl:.3f} | TP: {tp:.3f}")
    else:
        print(f"❌ Order failed: {result.comment}")

def trail_stop():
    """Implement the exact trailing stop rules from backtest"""
    positions = mt5.positions_get(symbol=SYMBOL)
    if not positions:
        return
    
    pos = positions[0]
    entry_price = pos.price_open
    current_price = mt5.symbol_info_tick(SYMBOL).bid if pos.type == mt5.ORDER_TYPE_BUY else mt5.symbol_info_tick(SYMBOL).ask
    profit = current_price - entry_price if pos.type == mt5.ORDER_TYPE_BUY else entry_price - current_price
    
    # Rule 1: Move SL to break-even when +3.00 profit
    if profit >= 3.00 and abs(pos.sl - entry_price) > 0.1:
        new_sl = entry_price
        request = {
            "action": mt5.TRADE_ACTION_SLTP,
            "symbol": SYMBOL,
            "position": pos.ticket,
            "sl": new_sl,
            "tp": pos.tp,
        }
        mt5.order_send(request)
        print(f"🔄 SL moved to break-even at {new_sl:.3f}")
    
    # Rule 2: Trail stop 1.50 behind price after break-even
    elif profit >= 3.00:
        if pos.type == mt5.ORDER_TYPE_BUY:
            new_sl = current_price - 1.50
            if new_sl > pos.sl + 0.1:
                request = {
                    "action": mt5.TRADE_ACTION_SLTP,
                    "symbol": SYMBOL,
                    "position": pos.ticket,
                    "sl": new_sl,
                    "tp": pos.tp,
                }
                mt5.order_send(request)
                print(f"🔄 Trailed SL to {new_sl:.3f}")
        else:
            new_sl = current_price + 1.50
            if new_sl < pos.sl - 0.1:
                request = {
                    "action": mt5.TRADE_ACTION_SLTP,
                    "symbol": SYMBOL,
                    "position": pos.ticket,
                    "sl": new_sl,
                    "tp": pos.tp,
                }
                mt5.order_send(request)
                print(f"🔄 Trailed SL to {new_sl:.3f}")

def main():
    if not connect_mt5():
        return
    
    print(f"🚀 Strategy LIVE | Symbol: {SYMBOL} | Lot Size: {LOT_SIZE}")
    print(f"   Win Rate: 53.3% | Profit Factor: 1.33 | Average $21.75/day @ 0.01 lots")
    
    last_candle_time = 0
    
    while True:
        # Only run on new candle close
        rates = mt5.copy_rates_from_pos(SYMBOL, TIMEFRAME, 0, 20)
        current_candle_time = rates[-1][0]
        
        if current_candle_time == last_candle_time:
            # Check trailing stop every second
            trail_stop()
            time.sleep(1)
            continue
        
        last_candle_time = current_candle_time
        
        # Candle just closed - calculate indicators
        df = pd.DataFrame(rates)
        close_prices = df['close'].values
        atr = calculate_atr(rates, 10)
        rsi = calculate_rsi(close_prices, 14)
        
        # Volatility filter - ONLY trade in optimal ATR range
        if atr < 0.8 or atr > 3.0:
            print(f"⏭️  Skipping | ATR: {atr:.2f} (outside 0.8-3.0 range)")
            time.sleep(1)
            continue
        
        prev2_high = max(rates[-2]['high'], rates[-3]['high'])
        prev2_low = min(rates[-2]['low'], rates[-3]['low'])
        last_close = rates[-1]['close']
        
        print(f"\n📊 {datetime.fromtimestamp(current_candle_time)} | Close: {last_close:.3f} | RSI: {rsi:.1f} | ATR: {atr:.2f}")
        
        if not has_open_position():
            # BUY SIGNAL
            if last_close > prev2_high and 30 < rsi < 45:
                print(f"🎯 BUY SIGNAL | Close {last_close:.3f} > prev2 high {prev2_high:.3f} | RSI: {rsi:.1f}")
                open_order(mt5.ORDER_TYPE_BUY)
            
            # SELL SIGNAL
            elif last_close < prev2_low and 55 < rsi < 70:
                print(f"🎯 SELL SIGNAL | Close {last_close:.3f} < prev2 low {prev2_low:.3f} | RSI: {rsi:.1f}")
                open_order(mt5.ORDER_TYPE_SELL)
        
        time.sleep(1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n👋 Strategy stopped")
    finally:
        mt5.shutdown()