import MetaTrader5 as mt5
import pandas as pd
import numpy as np
import time
from datetime import datetime
import argparse

# ==============================================
# USOILm LIVE TRADING BOT - OPTIMIZED FOR YOUR TRADING STYLE
# ==============================================

MAGIC_NUMBER = 24062028

def connect_mt5():
    if not mt5.initialize():
        print(f"❌ MT5 initialize failed: {mt5.last_error()}")
        return False
    return True

def calculate_rsi(prices, period=14):
    delta = np.diff(prices)
    gain = np.where(delta > 0, delta, 0)
    loss = np.where(delta < 0, -delta, 0)
    avg_gain = np.mean(gain[-period:])
    avg_loss = np.mean(loss[-period:])
    if avg_loss == 0:
        return 100
    return 100 - (100 / (1 + (avg_gain / avg_loss)))

def has_open_position(symbol):
    return len(mt5.positions_get(symbol=symbol)) > 0

def open_order(symbol, lot_size):
    """BUY ONLY - matches your trading style"""
    price = mt5.symbol_info_tick(symbol).ask
    sl = price - 1.80
    tp = price + 2.70
    
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": lot_size,
        "type": mt5.ORDER_TYPE_BUY,
        "price": price,
        "sl": sl,
        "tp": tp,
        "deviation": 10,
        "magic": MAGIC_NUMBER,
        "comment": "USOIL Bot",
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    
    result = mt5.order_send(request)
    if result.retcode == mt5.TRADE_RETCODE_DONE:
        print(f"✅ BUY opened at {price:.3f} | SL: {sl:.3f} | TP: {tp:.3f}")

def trail_stop(symbol):
    """3-stage trailing stop optimized for your style"""
    positions = mt5.positions_get(symbol=symbol)
    if not positions:
        return
    
    pos = positions[0]
    entry_price = pos.price_open
    current_price = mt5.symbol_info_tick(symbol).bid
    profit = current_price - entry_price
    
    if profit >= 1.80 and abs(pos.sl - entry_price) > 0.1:
        new_sl = entry_price
        mt5.order_send({
            "action": mt5.TRADE_ACTION_SLTP,
            "symbol": symbol,
            "position": pos.ticket,
            "sl": new_sl,
            "tp": pos.tp,
        })
        print(f"🔄 SL moved to break-even at {new_sl:.3f}")
    
    elif profit >= 1.80:
        new_sl = current_price - 1.00
        if new_sl > pos.sl + 0.1:
            mt5.order_send({
                "action": mt5.TRADE_ACTION_SLTP,
                "symbol": symbol,
                "position": pos.ticket,
                "sl": new_sl,
                "tp": pos.tp,
            })
            print(f"🔄 Trailed SL to {new_sl:.3f}")

def main():
    parser = argparse.ArgumentParser(description='USOILm Live Trading Bot')
    parser.add_argument('--lot', type=float, default=0.02, help='Lot size')
    parser.add_argument('--symbol', type=str, default='USOILm', help='Trading symbol')
    
    args = parser.parse_args()
    
    if not connect_mt5():
        return
    
    print(f"🚀 USOIL Bot LIVE | Lot: {args.lot} | BUY ONLY strategy")
    print(f"   Optimized for your existing trading style")
    last_candle_time = 0
    
    try:
        while True:
            trail_stop(args.symbol)
            rates = mt5.copy_rates_from_pos(args.symbol, mt5.TIMEFRAME_M1, 0, 20)
            
            if rates[-1][0] != last_candle_time:
                last_candle_time = rates[-1][0]
                
                if not has_open_position(args.symbol):
                    close_prices = rates['close']
                    rsi = calculate_rsi(close_prices, 14)
                    prev3_high = max(rates[-2]['high'], rates[-3]['high'], rates[-4]['high'])
                    last_close = rates[-1]['close']
                    last_open = rates[-1]['open']
                    
                    # EXACT ENTRY CONDITIONS
                    if last_close > prev3_high and 35 < rsi < 55 and last_close > last_open:
                        print(f"\n📊 {datetime.fromtimestamp(last_candle_time)} | RSI: {rsi:.1f}")
                        open_order(args.symbol, args.lot)
            
            time.sleep(1)
            
    except KeyboardInterrupt:
        print("\n👋 Bot stopped")
    finally:
        mt5.shutdown()

if __name__ == "__main__":
    main()