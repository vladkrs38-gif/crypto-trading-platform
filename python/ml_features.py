"""
Общий модуль расчёта фичей для ML (Apex: подготовка к входу).
Используется в ml_prepare_features.py и в lab_history при ML-фильтре входа.
Формулы идентичны между обучением и инференсом.
"""
import math
from typing import List, Optional, Sequence

# Порядок фичей должен совпадать с обучением (ml_prepare_features / ml_train).
FEATURE_NAMES = [
    "return_1",
    "return_5",
    "return_10",
    "volume_ma_ratio",
    "volume_z",
    "close_vs_ema20",
    "close_vs_ema50",
    "range_hl",
    "atr14_close",
]

# Минимальный индекс бара для которых фичи определены (warmup для EMA50, ATR, volume)
MIN_BAR_INDEX = 50


def _ema(values: Sequence[float], period: int, up_to: int) -> float:
    """EMA на массиве values до индекса up_to включительно."""
    if up_to < 0 or period <= 0:
        return float("nan")
    alpha = 2.0 / (period + 1)
    ema_val = values[up_to - period + 1]
    for j in range(up_to - period + 2, up_to + 1):
        ema_val = alpha * values[j] + (1 - alpha) * ema_val
    return ema_val


def _atr(high: List[float], low: List[float], close: List[float], period: int, up_to: int) -> float:
    """ATR(period) на барах [up_to - period + 1, up_to]."""
    if up_to < period:
        return float("nan")
    tr_sum = 0.0
    for j in range(up_to - period + 1, up_to + 1):
        prev_c = close[j - 1] if j > 0 else close[j]
        tr = max(
            high[j] - low[j],
            abs(high[j] - prev_c),
            abs(low[j] - prev_c),
        )
        tr_sum += tr
    return tr_sum / period


def compute_features_at(
    candles: Sequence[Sequence[float]],
    i: int,
) -> Optional[List[float]]:
    """
    Вычислить вектор фичей для бара i.
    candles: список [t_sec, open, high, low, close, volume].
    Возвращает список из 9 чисел в порядке FEATURE_NAMES или None если недостаточно данных.
    """
    n = len(candles)
    if i < MIN_BAR_INDEX or i >= n:
        return None
    try:
        close = [float(c[4]) for c in candles]
        high = [float(c[2]) for c in candles]
        low = [float(c[3]) for c in candles]
        volume = [float(c[5]) for c in candles]
    except (IndexError, TypeError, ValueError):
        return None

    ci = close[i]
    if ci <= 0:
        return None

    # Returns
    return_1 = (close[i] / close[i - 1] - 1) if close[i - 1] else 0.0
    return_5 = (close[i] / close[i - 5] - 1) if i >= 5 and close[i - 5] else 0.0
    return_10 = (close[i] / close[i - 10] - 1) if i >= 10 and close[i - 10] else 0.0

    # Volume MA(20) and z-score(50)
    vol_slice_20 = volume[i - 19 : i + 1]
    vol_ma_20 = sum(vol_slice_20) / 20
    volume_ma_ratio = (volume[i] / vol_ma_20) if vol_ma_20 else 0.0

    vol_slice_50 = volume[i - 49 : i + 1]
    vol_mean_50 = sum(vol_slice_50) / 50
    vol_var = sum((v - vol_mean_50) ** 2 for v in vol_slice_50) / 50
    vol_std_50 = math.sqrt(vol_var) if vol_var > 0 else 0.0
    volume_z = (volume[i] - vol_mean_50) / vol_std_50 if vol_std_50 else 0.0

    # Close vs EMA
    ema20 = _ema(close, 20, i)
    ema50 = _ema(close, 50, i)
    close_vs_ema20 = (ci / ema20 - 1) if ema20 and ema20 > 0 else 0.0
    close_vs_ema50 = (ci / ema50 - 1) if ema50 and ema50 > 0 else 0.0

    # Range and ATR
    range_hl = (high[i] - low[i]) / ci if ci else 0.0
    atr14 = _atr(high, low, close, 14, i)
    atr14_close = (atr14 / ci) if ci and atr14 and not math.isnan(atr14) else 0.0

    return [
        return_1,
        return_5,
        return_10,
        volume_ma_ratio,
        volume_z,
        close_vs_ema20,
        close_vs_ema50,
        range_hl,
        atr14_close,
    ]
