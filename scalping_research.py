"""
Scalping Strategy Research Framework
XAUUSDm & BTCUSDm - Feb/Mar 2026
Tight Fixed USD Stop-Loss Scalping
"""

import pandas as pd
import numpy as np
from datetime import datetime, time
import warnings
warnings.filterwarnings('ignore')

# ============================================================================
# DATA LOADING & PROCESSING
# ============================================================================

def load_data(symbol, timeframes=['1m', '3m', '5m']):
    """Load and merge data from CSV files."""
    data = {}
    for tf in timeframes:
        filepath = f"{symbol}_{tf}_2026-02-01_to_2026-04-01.csv"
        df = pd.read_csv(filepath, parse_dates=['time'])
        df.set_index('time', inplace=True)
        data[tf] = df
    return data

def add_session_tags(df):
    """Add session tags based on UTC time."""
    df = df.copy()
    hour = df.index.hour
    
    df['session'] = 'unknown'
    df.loc[(hour >= 0) & (hour < 7), 'session'] = 'asia'
    df.loc[(hour >= 7) & (hour < 12), 'session'] = 'london'
    df.loc[(hour >= 12) & (hour < 17), 'session'] = 'ny_early'
    df.loc[(hour >= 17) & (hour < 21), 'session'] = 'ny_late'
    df.loc[(hour >= 21) | (hour < 0), 'session'] = 'asia'
    
    df['is_asia'] = df['session'] == 'asia'
    df['is_london'] = df['session'] == 'london'
    df['is_ny'] = df['session'].isin(['ny_early', 'ny_late'])
    
    return df

# ============================================================================
# INDICATOR ENGINEERING
# ============================================================================

def calculate_ema(df, periods):
    """Calculate EMA for multiple periods."""
    df = df.copy()
    for period in periods:
        df[f'ema_{period}'] = df['close'].ewm(span=period, adjust=False).mean()
    return df

def calculate_rsi(df, period=14):
    """Calculate RSI."""
    df = df.copy()
    delta = df['close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    df['rsi'] = 100 - (100 / (1 + rs))
    return df

def calculate_macd(df, fast=12, slow=26, signal=9):
    """Calculate MACD."""
    df = df.copy()
    df['macd'] = df['close'].ewm(span=fast, adjust=False).mean() - df['close'].ewm(span=slow, adjust=False).mean()
    df['macd_signal'] = df['macd'].ewm(span=signal, adjust=False).mean()
    df['macd_hist'] = df['macd'] - df['macd_signal']
    return df

def calculate_atr(df, period=14):
    """Calculate ATR."""
    df = df.copy()
    high_low = df['high'] - df['low']
    high_close = np.abs(df['high'] - df['close'].shift())
    low_close = np.abs(df['low'] - df['close'].shift())
    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    df['atr'] = tr.rolling(window=period).mean()
    return df

def calculate_adx(df, period=14):
    """Calculate ADX and directional movement."""
    df = df.copy()
    
    # Plus/Minus Directional Movement
    plus_dm = df['high'].diff()
    minus_dm = -df['low'].diff()
    
    plus_dm[plus_dm < 0] = 0
    minus_dm[minus_dm < 0] = 0
    
    # Smooth
    df['atr_temp'] = df['atr'] if 'atr' in df.columns else calculate_atr(df, period)['atr']
    
    plus_di = 100 * (plus_dm.rolling(window=period).mean() / df['atr_temp'])
    minus_di = 100 * (minus_dm.rolling(window=period).mean() / df['atr_temp'])
    
    dx = 100 * np.abs(plus_di - minus_di) / (plus_di + minus_di)
    df['adx'] = dx.rolling(window=period).mean()
    df['plus_di'] = plus_di
    df['minus_di'] = minus_di
    
    return df

def calculate_bollinger_bands(df, period=20, std=2):
    """Calculate Bollinger Bands."""
    df = df.copy()
    df['bb_mid'] = df['close'].rolling(window=period).mean()
    df['bb_std'] = df['close'].rolling(window=period).std()
    df['bb_upper'] = df['bb_mid'] + (df['bb_std'] * std)
    df['bb_lower'] = df['bb_mid'] - (df['bb_std'] * std)
    df['bb_width'] = (df['bb_upper'] - df['bb_lower']) / df['bb_mid']
    return df

def calculate_volatility_regime(df, lookback=20):
    """Classify volatility regime based on ATR percentile."""
    df = df.copy()
    df['atr_percentile'] = df['atr'].rolling(window=lookback * 3).apply(
        lambda x: pd.Series(x).rank(pct=True).iloc[-1] * 100, raw=False
    )
    df['vol_regime'] = 'normal'
    df.loc[df['atr_percentile'] < 25, 'vol_regime'] = 'low'
    df.loc[df['atr_percentile'] > 75, 'vol_regime'] = 'high'
    return df

def add_mtf_confirmation(df_1m, df_3m, df_5m):
    """Add multi-timeframe confirmation signals."""
    df = df_1m.copy()
    
    # Resample higher timeframes to align with 1m
    ema_3m = df_3m['close'].resample('1min').last().ffill()
    ema_5m = df_5m['close'].resample('1min').last().ffill()
    
    ema_3m_aligned = ema_3m.reindex(df.index, method='ffill')
    ema_5m_aligned = ema_5m.reindex(df.index, method='ffill')
    
    df['mtf_bull'] = (df['close'] > df['ema_20']) & (ema_3m_aligned > df_3m['close'].rolling(3).mean().resample('1min').last().reindex(df.index, method='ffill'))
    df['mtf_bear'] = (df['close'] < df['ema_20']) & (ema_3m_aligned < df_3m['close'].rolling(3).mean().resample('1min').last().reindex(df.index, method='ffill'))
    
    return df

def engineer_features(df, symbol='XAUUSDm'):
    """Engineer all features for a dataframe."""
    df = df.copy()
    
    # Basic indicators
    df = calculate_ema(df, [5, 8, 13, 20, 50, 200])
    df = calculate_rsi(df, 14)
    df = calculate_macd(df)
    df = calculate_atr(df, 14)
    df = calculate_bollinger_bands(df)
    
    # Price relative to EMAs
    df['price_vs_ema5'] = (df['close'] - df['ema_5']) / df['ema_5'] * 100
    df['price_vs_ema20'] = (df['close'] - df['ema_20']) / df['ema_20'] * 100
    df['ema5_vs_ema20'] = (df['ema_5'] - df['ema_20']) / df['ema_20'] * 100
    
    # Trend strength
    df['trend_up'] = (df['close'] > df['ema_20']) & (df['ema_20'] > df['ema_50'])
    df['trend_down'] = (df['close'] < df['ema_20']) & (df['ema_20'] < df['ema_50'])
    
    # Momentum
    df['momentum_5'] = df['close'].pct_change(5)
    df['momentum_10'] = df['close'].pct_change(10)
    
    # Session and volatility
    df = add_session_tags(df)
    df = calculate_volatility_regime(df)
    
    # Position within daily range
    df['daily_range_pct'] = (df['high'] - df['low']) / df['close'] * 100
    
    # ATR-based volatility in price terms
    if symbol == 'XAUUSDm':
        df['atr_pips'] = df['atr']
    else:  # BTC
        df['atr_pips'] = df['atr']
    
    return df

# ============================================================================
# BACKTESTING ENGINE
# ============================================================================

class ScalpBacktester:
    """Vectorized backtesting engine with realistic costs."""
    
    def __init__(self, symbol='XAUUSDm', spread_pips=2, commission_pct=0.0002):
        self.symbol = symbol
        self.spread_pips = spread_pips  # For XAU: USD, for BTC: USD
        self.commission_pct = commission_pct
        
        # Cost multipliers
        if symbol == 'XAUUSDm':
            self.cost_per_unit = spread_pips / 10000  # Gold is quoted in USD, convert for pct calc
        else:
            self.cost_per_unit = spread_pips / 10000
    
    def run_backtest(self, df, strategy_func, 
                     initial_capital=10000,
                     max_daily_loss_pct=0.05,
                     max_positions=3):
        """
        Run vectorized backtest.
        
        Returns: trades dataframe, equity curve, performance metrics
        """
        df = df.copy()
        df['signal'] = strategy_func(df)
        
        # Initialize columns
        df['position'] = 0
        df['entry_price'] = np.nan
        df['entry_time'] = pd.NaT
        df['equity'] = initial_capital
        df['daily_pnl'] = 0.0
        df['trade_result'] = 0.0
        
        # State variables
        position = 0
        entry_price = 0
        entry_time = None
        daily_pnl = 0.0
        daily_loss = 0.0
        last_date = None
        
        trades = []
        trade_id = 0
        
        for i in range(1, len(df)):
            current_time = df.index[i]
            current_date = current_time.date()
            row = df.iloc[i]
            prev_row = df.iloc[i-1]
            
            # Check daily loss limit
            if last_date != current_date:
                daily_loss = 0.0
                last_date = current_date
            
            if daily_loss >= max_daily_loss_pct * initial_capital:
                if position != 0:
                    # Force close
                    exit_price = row['close']
                    pnl = self._calculate_pnl(position, entry_price, exit_price)
                    trade_result = pnl - (self.spread_pips + entry_price * self.commission_pct)
                    daily_pnl += trade_result
                    daily_loss += max(0, -trade_result)
                    trades.append({
                        'trade_id': trade_id,
                        'entry_time': entry_time,
                        'exit_time': current_time,
                        'direction': 'long' if position > 0 else 'short',
                        'entry_price': entry_price,
                        'exit_price': exit_price,
                        'pnl': trade_result
                    })
                    trade_id += 1
                    position = 0
                    entry_price = 0
                continue
            
            # Entry logic
            if position == 0 and row['signal'] != 0 and row['signal'] != prev_row.get('signal', 0):
                position = row['signal']
                entry_price = row['close'] + (self.spread_pips if position > 0 else -self.spread_pips)
                entry_time = current_time
            
            # Exit logic (to be handled by strategy)
            elif position != 0:
                exit_signal = self._check_exit_conditions(df, i, position, entry_price)
                
                if exit_signal:
                    exit_price = row['close'] - (self.spread_pips if position > 0 else -self.spread_pips)
                    pnl = self._calculate_pnl(position, entry_price, exit_price)
                    trade_result = pnl - self.spread_pips - (entry_price * self.commission_pct)
                    daily_pnl += trade_result
                    daily_loss += max(0, -trade_result)
                    trades.append({
                        'trade_id': trade_id,
                        'entry_time': entry_time,
                        'exit_time': current_time,
                        'direction': 'long' if position > 0 else 'short',
                        'entry_price': entry_price,
                        'exit_price': exit_price,
                        'pnl': trade_result
                    })
                    trade_id += 1
                    position = 0
                    entry_price = 0
            
            # Update equity
            df.loc[df.index[i], 'equity'] = initial_capital + daily_pnl
        
        df['daily_pnl'] = df['equity'].diff().fillna(0)
        
        trades_df = pd.DataFrame(trades)
        if len(trades_df) > 0:
            trades_df['duration'] = (trades_df['exit_time'] - trades_df['entry_time']).dt.total_seconds() / 60
            trades_df['return_pct'] = trades_df['pnl'] / initial_capital * 100
        
        metrics = self._calculate_metrics(trades_df, df)
        
        return trades_df, df, metrics
    
    def _calculate_pnl(self, position, entry, exit_price):
        if position > 0:
            return exit_price - entry
        else:
            return entry - exit_price
    
    def _check_exit_conditions(self, df, idx, position, entry_price):
        """Override this in subclass for custom exit logic."""
        return False
    
    def _calculate_metrics(self, trades_df, equity_df):
        """Calculate performance metrics."""
        if len(trades_df) == 0:
            return {
                'total_trades': 0,
                'win_rate': 0,
                'avg_win': 0,
                'avg_loss': 0,
                'profit_factor': 0,
                'total_pnl': 0,
                'max_drawdown': 0,
                'sharpe_ratio': 0
            }
        
        wins = trades_df[trades_df['pnl'] > 0]
        losses = trades_df[trades_df['pnl'] <= 0]
        
        total_pnl = trades_df['pnl'].sum()
        equity_curve = equity_df['equity']
        running_max = equity_curve.expanding().max()
        drawdown = (equity_curve - running_max) / running_max
        max_drawdown = abs(drawdown.min())
        
        # Sharpe ratio
        returns = equity_df['daily_pnl'] / 10000
        sharpe = np.sqrt(252) * returns.mean() / returns.std() if returns.std() > 0 else 0
        
        return {
            'total_trades': len(trades_df),
            'winning_trades': len(wins),
            'losing_trades': len(losses),
            'win_rate': len(wins) / len(trades_df) * 100 if len(trades_df) > 0 else 0,
            'avg_win': wins['pnl'].mean() if len(wins) > 0 else 0,
            'avg_loss': losses['pnl'].mean() if len(losses) > 0 else 0,
            'profit_factor': abs(wins['pnl'].sum() / losses['pnl'].sum()) if len(losses) > 0 and losses['pnl'].sum() != 0 else 0,
            'total_pnl': total_pnl,
            'max_drawdown': max_drawdown * 100,
            'sharpe_ratio': sharpe,
            'avg_duration_min': trades_df['duration'].mean() if 'duration' in trades_df.columns else 0,
            'max_consecutive_wins': self._max_consecutive(trades_df['pnl'] > 0),
            'max_consecutive_losses': self._max_consecutive(trades_df['pnl'] <= 0)
        }
    
    def _max_consecutive(self, arr):
        """Calculate max consecutive True values."""
        max_run = current_run = 0
        for val in arr:
            if val:
                current_run += 1
                max_run = max(max_run, current_run)
            else:
                current_run = 0
        return max_run

# ============================================================================
# STRATEGY LIBRARY
# ============================================================================

class StrategyLibrary:
    """Collection of scalping strategies."""
    
    @staticmethod
    def ema_crossover(df):
        """EMA 5/20 crossover with trend filter."""
        signal = pd.Series(0, index=df.index)
        
        # Bullish: EMA5 crosses above EMA20 while above EMA50
        ema5_above = df['ema_5'] > df['ema_20']
        ema5_cross = (df['ema_5'] > df['ema_20']) & (df['ema_5'].shift(1) <= df['ema_20'].shift(1))
        trend_bull = df['close'] > df['ema_50']
        rsi_ok = (df['rsi'] > 40) & (df['rsi'] < 70)
        
        signal[(ema5_cross) & (ema5_above) & (trend_bull) & (rsi_ok)] = 1
        
        # Bearish: EMA5 crosses below EMA20 while below EMA50
        ema5_below = df['ema_5'] < df['ema_20']
        ema5_cross_down = (df['ema_5'] < df['ema_20']) & (df['ema_5'].shift(1) >= df['ema_20'].shift(1))
        trend_bear = df['close'] < df['ema_50']
        rsi_ok_bear = (df['rsi'] > 30) & (df['rsi'] < 60)
        
        signal[(ema5_cross_down) & (ema5_below) & (trend_bear) & (rsi_ok_bear)] = -1
        
        return signal
    
    @staticmethod
    def rsi_reversal(df, oversold=35, overbought=65):
        """RSI reversal at extremes."""
        signal = pd.Series(0, index=df.index)
        
        # RSI reversal from oversold with bullish confirmation
        rsi_turning_up = (df['rsi'] > df['rsi'].shift(1)) & (df['rsi'].shift(1) <= df['rsi'].shift(2))
        rsi_oversold = df['rsi'] <= oversold
        price_ok = df['close'] > df['ema_20']
        macd_ok = df['macd_hist'] > 0
        
        signal[(rsi_oversold) & (rsi_turning_up) & (price_ok) & (macd_ok)] = 1
        
        # RSI reversal from overbought with bearish confirmation
        rsi_turning_down = (df['rsi'] < df['rsi'].shift(1)) & (df['rsi'].shift(1) >= df['rsi'].shift(2))
        rsi_overbought = df['rsi'] >= overbought
        price_ok_bear = df['close'] < df['ema_20']
        macd_ok_bear = df['macd_hist'] < 0
        
        signal[(rsi_overbought) & (rsi_turning_down) & (price_ok_bear) & (macd_ok_bear)] = -1
        
        return signal
    
    @staticmethod
    def bollinger_breakout(df, bb_period=20, std_dev=2):
        """Bollinger Band breakout strategy."""
        signal = pd.Series(0, index=df.index)
        
        # Upper band breakout
        upper_break = df['close'] > df['bb_upper']
        prev_upper = df['bb_upper'].shift(1)
        breakout = (df['close'] > df['bb_upper']) & (df['close'].shift(1) <= prev_upper)
        trend_ok = df['close'] > df['ema_20']
        rsi_ok = (df['rsi'] > 50) & (df['rsi'] < 80)
        atr_ok = df['atr'] > df['atr'].rolling(20).mean()
        
        signal[breakout & trend_ok & rsi_ok & atr_ok] = 1
        
        # Lower band breakout
        lower_break = df['close'] < df['bb_lower']
        prev_lower = df['bb_lower'].shift(1)
        breakout_down = (df['close'] < df['bb_lower']) & (df['close'].shift(1) >= prev_lower)
        trend_ok_bear = df['close'] < df['ema_20']
        rsi_ok_bear = (df['rsi'] < 50) & (df['rsi'] > 20)
        
        signal[breakout_down & trend_ok_bear & rsi_ok_bear & atr_ok] = -1
        
        return signal
    
    @staticmethod
    def macd_momentum(df):
        """MACD histogram momentum shift."""
        signal = pd.Series(0, index=df.index)
        
        # MACD histogram turning positive
        hist_turning_up = (df['macd_hist'] > 0) & (df['macd_hist'].shift(1) <= 0)
        trend_ok = df['ema_5'] > df['ema_20']
        rsi_ok = (df['rsi'] > 45) & (df['rsi'] < 70)
        
        signal[hist_turning_up & trend_ok & rsi_ok] = 1
        
        # MACD histogram turning negative
        hist_turning_down = (df['macd_hist'] < 0) & (df['macd_hist'].shift(1) >= 0)
        trend_ok_bear = df['ema_5'] < df['ema_20']
        rsi_ok_bear = (df['rsi'] > 30) & (df['rsi'] < 55)
        
        signal[hist_turning_down & trend_ok_bear & rsi_ok_bear] = -1
        
        return signal
    
    @staticmethod
    def range_expansion(df, lookback=10):
        """Range expansion with momentum confirmation."""
        signal = pd.Series(0, index=df.index)
        
        # Calculate range expansion
        range_ratio = df['atr'] / df['atr'].rolling(lookback).mean()
        range_expanding = range_ratio > 1.2
        
        # Momentum confirmation
        mom_confirm_up = df['momentum_5'] > 0
        rsi_ok = (df['rsi'] > 50) & (df['rsi'] < 75)
        
        # Price structure
        price_near_high = df['close'] > df['high'].rolling(5).mean()
        
        signal[range_expanding & mom_confirm_up & rsi_ok & price_near_high] = 1
        
        mom_confirm_down = df['momentum_5'] < 0
        rsi_ok_bear = (df['rsi'] > 25) & (df['rsi'] < 50)
        price_near_low = df['close'] < df['low'].rolling(5).mean()
        
        signal[range_expanding & mom_confirm_down & rsi_ok_bear & price_near_low] = -1
        
        return signal

# ============================================================================
# TRADE MANAGEMENT
# ============================================================================

class TradeManager:
    """Advanced trade management with trailing stops and partial exits."""
    
    def __init__(self, symbol='XAUUSDm'):
        self.symbol = symbol
        
        # Default stop losses
        if symbol == 'XAUUSDm':
            self.default_sl = 3.0  # 3 USD
            self.default_tp = 6.0  # 6 USD
        else:
            self.default_sl = 2.5  # 2.5 USD
            self.default_tp = 5.0  # 5 USD
    
    def calculate_position_size(self, account_balance, entry_price, stop_loss, risk_pct=0.01):
        """Calculate position size based on risk."""
        risk_amount = account_balance * risk_pct
        risk_per_unit = abs(stop_loss - entry_price)
        
        if risk_per_unit == 0:
            return 0
        
        position_size = risk_amount / risk_per_unit
        return position_size
    
    def trailing_stop_atr(self, entry_price, current_price, atr, position, 
                         trail_mult=2.0, min_trail=0.5):
        """ATR-based trailing stop."""
        trail_distance = max(atr * trail_mult, min_trail)
        
        if position > 0:  # Long
            potential_trail = current_price - trail_distance
            return potential_trail
        else:  # Short
            potential_trail = current_price + trail_distance
            return potential_trail
    
    def partial_exit_levels(self, entry_price, position, risk_amount,
                           first_exit_pct=0.5, second_exit_pct=0.3):
        """Calculate partial exit levels."""
        if position > 0:  # Long
            first_tp = entry_price + (self.default_tp * first_exit_pct)
            second_tp = entry_price + (self.default_tp * (first_exit_pct + second_exit_pct))
        else:  # Short
            first_tp = entry_price - (self.default_tp * first_exit_pct)
            second_tp = entry_price - (self.default_tp * (first_exit_pct + second_exit_pct))
        
        return first_tp, second_tp
    
    def break_even_plus_trail(self, entry_price, current_price, position,
                             trigger_pct=1.5, trail_pct=0.5):
        """Move stop to break-even + trail after certain profit."""
        trigger = self.default_sl * trigger_pct
        
        if position > 0:
            profit = current_price - entry_price
            if profit >= trigger:
                be_price = entry_price + (self.default_sl * trail_pct)
                return max(be_price, entry_price)
        else:
            profit = entry_price - current_price
            if profit >= trigger:
                be_price = entry_price - (self.default_sl * trail_pct)
                return min(be_price, entry_price)
        
        return None
    
    def time_based_exit(self, bars_in_trade, max_bars=30):
        """Time-based exit if stuck."""
        return bars_in_trade >= max_bars
    
    def volatility_adjusted_exit(self, entry_price, atr, position,
                                vol_mult=1.5, direction_mult=2.0):
        """Exit based on volatility expansion."""
        if position > 0:
            upper_target = entry_price + (atr * direction_mult)
            upper_stop = entry_price - (atr * vol_mult)
        else:
            upper_target = entry_price - (atr * direction_mult)
            upper_stop = entry_price + (atr * vol_mult)
        
        return upper_target, upper_stop

# ============================================================================
# ANALYSIS & REPORTING
# ============================================================================

class PerformanceAnalyzer:
    """Deep analysis of strategy performance."""
    
    def __init__(self, trades_df, equity_df, df_features):
        self.trades = trades_df
        self.equity = equity_df
        self.features = df_features
    
    def analyze_by_session(self):
        """Analyze performance by trading session."""
        if len(self.trades) == 0:
            return pd.DataFrame()
        
        trades_with_session = self.trades.copy()
        trades_with_session['session'] = trades_with_session['entry_time'].dt.hour.apply(
            lambda h: 'asia' if h < 7 else ('london' if h < 12 else 'ny')
        )
        
        return trades_with_session.groupby('session').agg({
            'pnl': ['sum', 'mean', 'count'],
            'trade_id': 'count'
        }).round(2)
    
    def analyze_by_timeframe(self, df_1m, df_3m, df_5m):
        """Analyze performance across timeframes."""
        # This would require tracking which timeframe generated the signal
        pass
    
    def analyze_by_direction(self):
        """Long vs Short performance."""
        if len(self.trades) == 0:
            return {}
        
        longs = self.trades[self.trades['direction'] == 'long']
        shorts = self.trades[self.trades['direction'] == 'short']
        
        return {
            'long': {
                'trades': len(longs),
                'win_rate': len(longs[longs['pnl'] > 0]) / len(longs) * 100 if len(longs) > 0 else 0,
                'avg_pnl': longs['pnl'].mean() if len(longs) > 0 else 0,
                'total_pnl': longs['pnl'].sum() if len(longs) > 0 else 0
            },
            'short': {
                'trades': len(shorts),
                'win_rate': len(shorts[shorts['pnl'] > 0]) / len(shorts) * 100 if len(shorts) > 0 else 0,
                'avg_pnl': shorts['pnl'].mean() if len(shorts) > 0 else 0,
                'total_pnl': shorts['pnl'].sum() if len(shorts) > 0 else 0
            }
        }
    
    def analyze_duration_impact(self):
        """Analyze how trade duration affects P&L."""
        if len(self.trades) == 0 or 'duration' not in self.trades.columns:
            return {}
        
        bins = [0, 5, 10, 15, 30, 60, float('inf')]
        labels = ['0-5', '5-10', '10-15', '15-30', '30-60', '60+']
        self.trades['duration_bin'] = pd.cut(self.trades['duration'], bins=bins, labels=labels)
        
        return self.trades.groupby('duration_bin').agg({
            'pnl': ['sum', 'mean', 'count']
        })
    
    def analyze_consecutive_trades(self):
        """Analyze streak performance."""
        if len(self.trades) == 0:
            return {}
        
        self.trades['win'] = self.trades['pnl'] > 0
        
        streaks = []
        current_streak = {'type': 'win' if self.trades.iloc[0]['win'] else 'loss', 'count': 1}
        
        for i in range(1, len(self.trades)):
            is_win = self.trades.iloc[i]['win']
            if (is_win and current_streak['type'] == 'win') or \
               (not is_win and current_streak['type'] == 'loss'):
                current_streak['count'] += 1
            else:
                streaks.append(current_streak.copy())
                current_streak = {'type': 'win' if is_win else 'loss', 'count': 1}
        
        streaks.append(current_streak)
        
        win_streaks = [s for s in streaks if s['type'] == 'win']
        loss_streaks = [s for s in streaks if s['type'] == 'loss']
        
        return {
            'max_consecutive_wins': max([s['count'] for s in win_streaks]) if win_streaks else 0,
            'max_consecutive_losses': max([s['count'] for s in loss_streaks]) if loss_streaks else 0,
            'avg_win_streak': np.mean([s['count'] for s in win_streaks]) if win_streaks else 0,
            'avg_loss_streak': np.mean([s['count'] for s in loss_streaks]) if loss_streaks else 0
        }
    
    def calculate_drawdown_periods(self):
        """Identify drawdown periods."""
        equity = self.equity['equity']
        running_max = equity.expanding().max()
        drawdown = (equity - running_max) / running_max
        
        # Find drawdown periods
        in_dd = drawdown < -0.01  # 1% threshold
        dd_changes = in_dd.diff().fillna(False)
        
        dd_periods = []
        start = None
        
        for i, (idx, is_change) in enumerate(dd_changes.items()):
            if is_change and not in_dd.iloc[i]:
                start = idx
            elif is_change and in_dd.iloc[i] and start:
                dd_periods.append({
                    'start': start,
                    'end': idx,
                    'depth': drawdown.loc[start:idx].min()
                })
                start = None
        
        return dd_periods

# ============================================================================
# MAIN RESEARCH PIPELINE
# ============================================================================

def run_research_pipeline():
    """Main research pipeline."""
    print("=" * 80)
    print("SCALPING STRATEGY RESEARCH - XAUUSDm & BTCUSDm")
    print("Feb-Mar 2026 | Tight Fixed USD Stop-Loss")
    print("=" * 80)
    
    # Load data
    print("\n[1] Loading data...")
    xau_1m = load_data('XAUUSDm', ['1m'])['1m']
    xau_3m = load_data('XAUUSDm', ['3m'])['3m']
    xau_5m = load_data('XAUUSDm', ['5m'])['5m']
    btc_1m = load_data('BTCUSDm', ['1m'])['1m']
    btc_3m = load_data('BTCUSDm', ['3m'])['3m']
    btc_5m = load_data('BTCUSDm', ['5m'])['5m']
    
    print(f"   XAUUSDm 1m: {len(xau_1m)} bars")
    print(f"   BTCUSDm 1m: {len(btc_1m)} bars")
    
    # Engineer features
    print("\n[2] Engineering features...")
    xau_1m = engineer_features(xau_1m, 'XAUUSDm')
    btc_1m = engineer_features(btc_1m, 'BTCUSDm')
    
    # Split data
    print("\n[3] Splitting in-sample / out-of-sample...")
    xau_train = xau_1m[xau_1m.index < '2026-03-01']
    xau_test = xau_1m[xau_1m.index >= '2026-03-01']
    btc_train = btc_1m[btc_1m.index < '2026-03-01']
    btc_test = btc_1m[btc_1m.index >= '2026-03-01']
    
    print(f"   XAUUSDm Train: {len(xau_train)} bars ({xau_train.index.min()} to {xau_train.index.max()})")
    print(f"   XAUUSDm Test: {len(xau_test)} bars ({xau_test.index.min()} to {xau_test.index.max()})")
    print(f"   BTCUSDm Train: {len(btc_train)} bars ({btc_train.index.min()} to {btc_train.index.max()})")
    print(f"   BTCUSDm Test: {len(btc_test)} bars ({btc_test.index.min()} to {btc_test.index.max()})")
    
    # Define strategies
    strategies = {
        'EMA_Crossover': StrategyLibrary.ema_crossover,
        'RSI_Reversal': StrategyLibrary.rsi_reversal,
        'Bollinger_Breakout': StrategyLibrary.bollinger_breakout,
        'MACD_Momentum': StrategyLibrary.macd_momentum,
        'Range_Expansion': StrategyLibrary.range_expansion
    }
    
    # Backtest each strategy
    print("\n[4] Running backtests...")
    results = {}
    
    for strat_name, strat_func in strategies.items():
        print(f"\n   Testing {strat_name}...")
        
        # XAUUSDm backtest
        backtester_xau = ScalpBacktester('XAUUSDm', spread_pips=2.0)
        trades_xau, equity_xau, metrics_xau = backtester_xau.run_backtest(
            xau_train, strat_func, initial_capital=10000
        )
        
        # BTCUSDm backtest
        backtester_btc = ScalpBacktester('BTCUSDm', spread_pips=3.0)
        trades_btc, equity_btc, metrics_btc = backtester_btc.run_backtest(
            btc_train, strat_func, initial_capital=10000
        )
        
        results[strat_name] = {
            'XAUUSDm': {'trades': trades_xau, 'equity': equity_xau, 'metrics': metrics_xau},
            'BTCUSDm': {'trades': trades_btc, 'equity': equity_btc, 'metrics': metrics_btc}
        }
        
        print(f"      XAUUSDm: {metrics_xau['total_trades']} trades, Win Rate: {metrics_xau['win_rate']:.1f}%, PnL: ${metrics_xau['total_pnl']:.2f}")
        print(f"      BTCUSDm: {metrics_btc['total_trades']} trades, Win Rate: {metrics_btc['win_rate']:.1f}%, PnL: ${metrics_btc['total_pnl']:.2f}")
    
    # Analyze and rank strategies
    print("\n[5] Strategy Analysis...")
    print("\n" + "=" * 80)
    print("STRATEGY RANKING (In-Sample Feb 2026)")
    print("=" * 80)
    
    rankings = []
    for strat_name, res in results.items():
        for symbol in ['XAUUSDm', 'BTCUSDm']:
            m = res[symbol]['metrics']
            if m['total_trades'] > 0:
                score = (m['win_rate'] * 0.3 + 
                        min(m['profit_factor'], 3) * 20 + 
                        (100 - m['max_drawdown']) * 0.3)
                rankings.append({
                    'Strategy': strat_name,
                    'Symbol': symbol,
                    'Trades': m['total_trades'],
                    'WinRate': m['win_rate'],
                    'ProfitFactor': m['profit_factor'],
                    'TotalPnL': m['total_pnl'],
                    'MaxDD': m['max_drawdown'],
                    'Score': score
                })
    
    rankings_df = pd.DataFrame(rankings).sort_values('Score', ascending=False)
    print(rankings_df.to_string(index=False))
    
    # Deep analysis of best strategies
    print("\n[6] Deep Analysis of Top Strategies...")
    
    # Get top 3 strategies
    top_strategies = rankings_df.head(6)
    
    analysis_results = {}
    for _, row in top_strategies.iterrows():
        strat_name = row['Strategy']
        symbol = row['Symbol']
        
        res = results[strat_name][symbol]
        analyzer = PerformanceAnalyzer(res['trades'], res['equity'], 
                                        xau_train if symbol == 'XAUUSDm' else btc_train)
        
        analysis_results[f"{strat_name}_{symbol}"] = {
            'session_analysis': analyzer.analyze_by_session(),
            'direction_analysis': analyzer.analyze_by_direction(),
            'duration_analysis': analyzer.analyze_duration_impact(),
            'streak_analysis': analyzer.analyze_consecutive_trades()
        }
    
    # Print detailed analysis
    for key, analysis in analysis_results.items():
        print(f"\n{key}:")
        print(f"   Direction: {analysis['direction_analysis']}")
        print(f"   Streaks: {analysis['streak_analysis']}")
    
    print("\n" + "=" * 80)
    print("RESEARCH COMPLETE")
    print("=" * 80)
    
    return results, rankings_df, analysis_results

if __name__ == "__main__":
    results, rankings, analysis = run_research_pipeline()
