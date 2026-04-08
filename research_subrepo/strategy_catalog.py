"""Strategy catalog: 50 intraday/scalping strategies applicable to 1m/3m/5m bars."""

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class StrategySpec:
    name: str
    family: str
    direction: str  # long, short, both
    fast: int
    slow: int
    rsi_len: int
    atr_len: int
    atr_mult: float
    trail_atr_mult: float
    take_profit_r: float
    vol_window: int
    vol_z_min: float
    donchian: int
    bb_window: int
    bb_k: float
    regime: str  # trend, meanrev, breakout, neutral


def build_strategy_catalog() -> list[StrategySpec]:
    specs: list[StrategySpec] = []

    # 1) Trend-following EMA + RSI confirmation (12)
    trend_params = [
        (5, 20, 14, 0.9, 1.0),
        (8, 21, 14, 1.0, 1.2),
        (9, 30, 10, 1.1, 1.4),
        (10, 34, 14, 1.0, 1.6),
    ]
    idx = 1
    for fast, slow, rsi_len, atr_mult, tp_r in trend_params:
        for direction in ("both", "long", "short"):
            specs.append(
                StrategySpec(
                    name=f"S{idx:02d}_ema_rsi_{direction}_{fast}_{slow}",
                    family="ema_rsi_trend",
                    direction=direction,
                    fast=fast,
                    slow=slow,
                    rsi_len=rsi_len,
                    atr_len=14,
                    atr_mult=atr_mult,
                    trail_atr_mult=0.8,
                    take_profit_r=tp_r,
                    vol_window=20,
                    vol_z_min=-0.2,
                    donchian=20,
                    bb_window=20,
                    bb_k=2.0,
                    regime="trend",
                )
            )
            idx += 1

    # 2) Mean reversion Bollinger + RSI extremes (10)
    mr_params = [
        (20, 2.0, 0.9, 1.0),
        (20, 2.4, 1.0, 1.1),
        (30, 2.2, 1.2, 1.2),
        (30, 2.6, 1.3, 1.3),
        (40, 2.8, 1.4, 1.4),
    ]
    for bb_w, bb_k, atr_mult, tp_r in mr_params:
        for direction in ("both", "long"):
            specs.append(
                StrategySpec(
                    name=f"S{idx:02d}_bb_rsi_{direction}_{bb_w}_{str(bb_k).replace('.', 'p')}",
                    family="bb_rsi_meanrev",
                    direction=direction,
                    fast=8,
                    slow=34,
                    rsi_len=14,
                    atr_len=14,
                    atr_mult=atr_mult,
                    trail_atr_mult=0.7,
                    take_profit_r=tp_r,
                    vol_window=30,
                    vol_z_min=-1.0,
                    donchian=20,
                    bb_window=bb_w,
                    bb_k=bb_k,
                    regime="meanrev",
                )
            )
            idx += 1

    # 3) Donchian breakouts with volatility filter (10)
    br_params = [
        (15, 0.2, 1.0, 1.5),
        (20, 0.0, 1.0, 1.8),
        (30, 0.1, 1.1, 2.0),
        (40, 0.3, 1.2, 2.2),
        (50, 0.2, 1.3, 2.5),
    ]
    for dlen, vol_min, atr_mult, tp_r in br_params:
        for direction in ("both", "short"):
            specs.append(
                StrategySpec(
                    name=f"S{idx:02d}_donchian_{direction}_{dlen}",
                    family="donchian_breakout",
                    direction=direction,
                    fast=10,
                    slow=40,
                    rsi_len=14,
                    atr_len=14,
                    atr_mult=atr_mult,
                    trail_atr_mult=1.0,
                    take_profit_r=tp_r,
                    vol_window=20,
                    vol_z_min=vol_min,
                    donchian=dlen,
                    bb_window=20,
                    bb_k=2.0,
                    regime="breakout",
                )
            )
            idx += 1

    # 4) Structure + pattern continuation/reversal (10)
    struct_params = [
        (6, 24, 0.9, 1.2),
        (7, 28, 1.0, 1.3),
        (8, 32, 1.1, 1.5),
        (10, 30, 1.0, 1.4),
        (12, 36, 1.2, 1.6),
    ]
    for fast, slow, atr_mult, tp_r in struct_params:
        for direction in ("both", "long"):
            specs.append(
                StrategySpec(
                    name=f"S{idx:02d}_structure_{direction}_{fast}_{slow}",
                    family="market_structure",
                    direction=direction,
                    fast=fast,
                    slow=slow,
                    rsi_len=10,
                    atr_len=14,
                    atr_mult=atr_mult,
                    trail_atr_mult=0.9,
                    take_profit_r=tp_r,
                    vol_window=20,
                    vol_z_min=-0.5,
                    donchian=18,
                    bb_window=20,
                    bb_k=2.0,
                    regime="neutral",
                )
            )
            idx += 1

    # 5) Custom volatility/regime hybrids (8)
    custom_params = [
        (5, 30, 0.0, 1.0, 1.8),
        (8, 34, 0.1, 1.1, 2.0),
        (10, 40, 0.2, 1.2, 2.2),
        (12, 45, 0.3, 1.3, 2.5),
    ]
    for fast, slow, vol_min, atr_mult, tp_r in custom_params:
        for direction in ("both", "short"):
            specs.append(
                StrategySpec(
                    name=f"S{idx:02d}_custom_{direction}_{fast}_{slow}",
                    family="custom_regime",
                    direction=direction,
                    fast=fast,
                    slow=slow,
                    rsi_len=12,
                    atr_len=20,
                    atr_mult=atr_mult,
                    trail_atr_mult=1.1,
                    take_profit_r=tp_r,
                    vol_window=40,
                    vol_z_min=vol_min,
                    donchian=25,
                    bb_window=30,
                    bb_k=2.2,
                    regime="trend",
                )
            )
            idx += 1

    assert len(specs) == 50, len(specs)
    return specs
