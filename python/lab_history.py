"""
Загрузка и хранение истории свечей для Лаборатории (бэктест/оптимизация).
Данные сохраняются в data/history/{exchange}/{symbol}/{interval}.json.gz + meta.
"""

import gzip
import json
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen

# ML-фильтр входа: фичи считаются в run_apex_simulation при ml_filter_enabled
try:
    from ml_features import MIN_BAR_INDEX, compute_features_at
except ImportError:
    MIN_BAR_INDEX = 50
    compute_features_at = None  # type: ignore

# Таймфрейм фронта (1, 3, 5, 15, 30, 60, 120, 240, 360, 480, 720, D, W, M) -> интервал Binance
TIMEFRAME_TO_BINANCE = {
    "1": "1m",
    "3": "3m",
    "5": "5m",
    "15": "15m",
    "30": "30m",
    "60": "1h",
    "120": "2h",
    "240": "4h",
    "360": "6h",
    "480": "8h",
    "720": "12h",
    "D": "1d",
    "W": "1w",
    "M": "1M",
}

BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines"
LIMIT_PER_REQUEST = 1000
REQUEST_DELAY_SEC = 0.05

# Кэш загруженных ML-моделей (path -> model) для фильтра входа в run_apex_simulation
_ml_model_cache = {}


def _get_ml_proba(model_path: str, feature_vector: list):
    """
    Загрузить модель по пути (с кэшем), вернуть predict_proba для одного вектора фичей.
    Классы: 0=down, 1=flat, 2=up. Возвращает None при ошибке загрузки или неверном числе фичей.
    """
    if not model_path or not feature_vector or len(feature_vector) != 9:
        return None
    if model_path not in _ml_model_cache:
        try:
            import xgboost as xgb
            model = xgb.XGBClassifier()
            model.load_model(model_path)
            _ml_model_cache[model_path] = model
        except Exception:
            return None
    model = _ml_model_cache[model_path]
    try:
        import numpy as np
        X = np.array([feature_vector], dtype=float)
        if np.any(np.isnan(X)) or np.any(np.isinf(X)):
            return None
        proba = model.predict_proba(X)
        if proba is None or len(proba) == 0 or proba.shape[1] != 3:
            return None
        return proba[0]
    except Exception:
        return None

# Корень каталога данных (рядом с python/ или в python/)
def _data_root() -> Path:
    root = Path(__file__).resolve().parent
    if (root / "data").is_dir():
        return root / "data"
    return root.parent / "data"


def _history_dir(exchange: str, symbol: str, timeframe: str) -> Path:
    interval = TIMEFRAME_TO_BINANCE.get(timeframe, "1m")
    return _data_root() / "history" / exchange.lower() / symbol.upper() / interval


def _meta_path(exchange: str, symbol: str, timeframe: str) -> Path:
    return _history_dir(exchange, symbol, timeframe) / "meta.json"


def get_ml_model_status(symbol: str, timeframe: str) -> dict:
    """
    Проверить наличие обученной ML-модели для пары/таймфрейма.
    Возвращает: { "available": bool, "path": str }
    """
    path = _data_root() / "models" / f"{symbol.upper()}_{timeframe}_xgb.json"
    return {"available": path.exists(), "path": str(path)}


def _data_path(exchange: str, symbol: str, timeframe: str) -> Path:
    interval = TIMEFRAME_TO_BINANCE.get(timeframe, "1m")
    return _history_dir(exchange, symbol, timeframe) / f"{interval}.json.gz"


def get_history_status(
    exchange: str, symbol: str, timeframe: str
) -> dict:
    """
    Проверить наличие локальной истории.
    Возвращает: { "available": bool, "days"?: int, "candlesCount"?: int, "firstTs"?: int, "lastTs"?: int }
    """
    meta_path = _meta_path(exchange, symbol, timeframe)
    data_path = _data_path(exchange, symbol, timeframe)
    if not meta_path.exists() or not data_path.exists():
        return {"available": False}

    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
        return {
            "available": True,
            "days": meta.get("days", 0),
            "candlesCount": meta.get("candlesCount", 0),
            "firstTs": meta.get("firstTs"),
            "lastTs": meta.get("lastTs"),
        }
    except Exception:
        return {"available": False}


def _fetch_binance_klines(
    symbol: str, interval: str, start_ts_ms: int, end_ts_ms: int
) -> list:
    params = {
        "symbol": symbol.upper(),
        "interval": interval,
        "startTime": start_ts_ms,
        "endTime": end_ts_ms,
        "limit": LIMIT_PER_REQUEST,
    }
    url = f"{BINANCE_KLINES_URL}?{urlencode(params)}"
    req = Request(url, headers={"User-Agent": "Plat3Lab/1.0"})
    with urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    return data


def download_full_history(
    exchange: str, symbol: str, timeframe: str, progress_dict: Optional[dict] = None
) -> dict:
    """
    Синхронно скачать полную историю с Binance и сохранить в json.gz + meta.
    progress_dict: если передан, в него пишется прогресс (candles_so_far, first_ts, last_ts, days_so_far).
    Возвращает: { "ok": bool, "days": int, "candlesCount": int, "error"?: str }
    """
    if exchange.lower() != "binance":
        return {"ok": False, "error": "Only binance is supported"}

    interval = TIMEFRAME_TO_BINANCE.get(timeframe, "1m")
    symbol = symbol.upper()
    dir_path = _history_dir(exchange, symbol, timeframe)
    dir_path.mkdir(parents=True, exist_ok=True)

    end_ts_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_ts_ms = 0
    all_candles = []

    try:
        while True:
            chunk = _fetch_binance_klines(symbol, interval, start_ts_ms, end_ts_ms)
            if not chunk:
                break
            all_candles.extend(chunk)
            if progress_dict is not None and all_candles:
                first_ts = all_candles[0][0] // 1000
                last_ts = all_candles[-1][6] // 1000
                days_so_far = max(1, (last_ts - first_ts) // (24 * 3600))
                progress_dict["candles_so_far"] = len(all_candles)
                progress_dict["first_ts"] = first_ts
                progress_dict["last_ts"] = last_ts
                progress_dict["days_so_far"] = days_so_far
            last_close = chunk[-1][6]
            if last_close >= end_ts_ms:
                break
            start_ts_ms = last_close + 1
            time.sleep(REQUEST_DELAY_SEC)
        if not all_candles:
            return {"ok": False, "error": "No data returned"}

        # Сохраняем компактно: [t, o, h, l, c, v] в секундах и float
        compact = []
        for k in all_candles:
            compact.append([
                k[0] // 1000,
                float(k[1]),
                float(k[2]),
                float(k[3]),
                float(k[4]),
                float(k[5]),
            ])
        first_ts = compact[0][0]
        last_ts = compact[-1][0]
        days = max(1, (last_ts - first_ts) // (24 * 3600))

        data_path = _data_path(exchange, symbol, timeframe)
        with gzip.open(data_path, "wt", encoding="utf-8") as f:
            json.dump(compact, f, separators=(",", ":"))

        meta = {
            "days": days,
            "candlesCount": len(compact),
            "firstTs": first_ts,
            "lastTs": last_ts,
            "interval": interval,
            "symbol": symbol,
            "exchange": exchange,
        }
        meta_path = _meta_path(exchange, symbol, timeframe)
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

        return {
            "ok": True,
            "days": days,
            "candlesCount": len(compact),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


# Фоновая загрузка: один поток на пару (symbol+timeframe), статус в памяти
_download_state: dict = {}
_download_lock = threading.Lock()


def start_download_background(exchange: str, symbol: str, timeframe: str) -> str:
    """Запустить загрузку в фоне. Возвращает id задачи."""
    key = f"{exchange}:{symbol}:{timeframe}"
    with _download_lock:
        if key in _download_state and _download_state[key].get("running"):
            return key
        _download_state[key] = {"running": True, "result": None}

    def run():
        result = download_full_history(exchange, symbol, timeframe, progress_dict=_download_state[key])
        with _download_lock:
            _download_state[key]["running"] = False
            _download_state[key]["result"] = result
            for k in ("candles_so_far", "first_ts", "last_ts", "days_so_far"):
                _download_state[key].pop(k, None)

    threading.Thread(target=run, daemon=True).start()
    return key


def get_download_status(exchange: str, symbol: str, timeframe: str) -> dict:
    """Статус фоновой загрузки: { "running": bool, "result"?: {...}, "days_so_far"?: int }"""
    key = f"{exchange}:{symbol}:{timeframe}"
    with _download_lock:
        state = _download_state.get(key, {})
    out = {
        "running": state.get("running", False),
        "result": state.get("result"),
    }
    if state.get("days_so_far") is not None:
        out["days_so_far"] = state["days_so_far"]
    return out


# ===== Модернизированная Apex-симуляция: Z-Score, Сетка/Мартингейл, Продвинутый Тейк =====

import math
from collections import deque
from multiprocessing import Pool, cpu_count
import uuid
import numpy as np

# Глобальный словарь для отслеживания прогресса оптимизации
# Ключ: optimization_id (str), Значение: {"current": int, "total": int, "status": str}
_optimization_progress: dict[str, dict] = {}
_progress_lock = threading.Lock()

TIMEFRAME_MINUTES = {
    "1": 1, "3": 3, "5": 5, "15": 15, "30": 30,
    "60": 60, "120": 120, "240": 240, "360": 360,
    "480": 480, "720": 720, "D": 1440, "W": 10080, "M": 43200,
}


def load_candles_from_history(exchange: str, symbol: str, timeframe: str) -> list:
    """
    Загрузить свечи из локального json.gz. Формат: список [t, o, h, l, c, v].
    Проверяет временные разрывы (дырки) в данных и помечает их флагом.
    """
    path = _data_path(exchange, symbol, timeframe)
    if not path.exists():
        return []
    try:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            data = json.load(f)
        
        if not data:
            return []
        
        # Проверка дырок в данных
        tf_min = TIMEFRAME_MINUTES.get(timeframe, 1)
        expected_interval_sec = tf_min * 60
        
        validated_data = []
        for i, candle in enumerate(data):
            if i == 0:
                validated_data.append(candle)
                continue
            
            prev_ts = data[i - 1][0]
            curr_ts = candle[0]
            gap_sec = curr_ts - prev_ts
            
            # Если разрыв больше ожидаемого интервала (допускаем небольшую погрешность 10%)
            if gap_sec > expected_interval_sec * 1.1:
                # Вставляем пустую свечу для заполнения дырки
                # Пустая свеча: [timestamp, prev_close, prev_close, prev_close, prev_close, 0]
                prev_close = data[i - 1][4]  # Close предыдущей свечи
                missing_bars = int(gap_sec / expected_interval_sec) - 1
                
                for j in range(missing_bars):
                    gap_ts = prev_ts + (j + 1) * expected_interval_sec
                    validated_data.append([gap_ts, prev_close, prev_close, prev_close, prev_close, 0.0])
            
            validated_data.append(candle)
        
        return validated_data
    except Exception:
        return []


def _calc_atr(candles: list, end_idx: int, period: int = 14) -> float:
    """ATR (Average True Range) до свечи end_idx включительно."""
    start = max(1, end_idx - period + 1)
    if start > end_idx:
        return 0.0
    trs = []
    for j in range(start, end_idx + 1):
        h = float(candles[j][2])
        low = float(candles[j][3])
        prev_c = float(candles[j - 1][4])
        tr = max(h - low, abs(h - prev_c), abs(low - prev_c))
        trs.append(tr)
    return sum(trs) / len(trs) if trs else 0.0


def _calc_ema(closes: list, end_idx: int, period: int) -> float:
    """EMA(period) по closes до end_idx включительно. Для тренд-фильтра (Apex)."""
    if end_idx < 0 or period <= 0:
        return 0.0
    start = max(0, end_idx - period * 3)  # достаточно истории для сходимости EMA
    if start > end_idx:
        return float(closes[end_idx]) if end_idx < len(closes) else 0.0
    k = 2.0 / (period + 1)
    ema = float(closes[start])
    for j in range(start + 1, end_idx + 1):
        if j < len(closes):
            ema = float(closes[j]) * k + ema * (1.0 - k)
    return ema


def _calc_atr_median(candles: list, end_idx: int, atr_period: int, lookback: int = 50) -> float:
    """Медиана ATR за последние lookback баров (для динамического alpha)."""
    start = max(1, end_idx - lookback + 1)
    if start > end_idx:
        return _calc_atr(candles, end_idx, atr_period)
    atrs = []
    for j in range(start, end_idx + 1):
        atr = _calc_atr(candles, j, atr_period)
        atrs.append(atr)
    atrs.sort()
    n = len(atrs)
    if n == 0:
        return 0.0
    if n % 2 == 1:
        return atrs[n // 2]
    return (atrs[n // 2 - 1] + atrs[n // 2]) / 2.0


class _GridPosition:
    """Позиция с поддержкой нескольких колен (Grid/Мартингейл). Поддержка long и short (Apex Logic)."""
    __slots__ = ('legs', 'total_qty', 'total_cost', 'p_avg', 'entry_time',
                 'p_drop_avg', 'total_fees', 'entry_atr', 'side')

    def __init__(self):
        self.legs: list = []        # [(price, qty, time)]
        self.total_qty: float = 0.0
        self.total_cost: float = 0.0  # sum(price * qty) — для расчёта P_avg
        self.p_avg: float = 0.0
        self.entry_time: int = 0
        self.p_drop_avg: float = 0.0  # средняя цена окна падения (long) / всплеска (short) — L-window
        self.total_fees: float = 0.0  # суммарные комиссии всех входов
        self.entry_atr: float = 0.0   # ATR на момент первого входа (для динамической сетки)
        self.side: str = "long"       # "long" | "short"

    def add_leg(self, price: float, qty: float, time_: int, fee: float):
        self.legs.append((price, qty, time_))
        self.total_cost += price * qty
        self.total_qty += qty
        self.p_avg = self.total_cost / self.total_qty if self.total_qty > 0 else 0.0
        self.total_fees += fee
        if not self.entry_time:
            self.entry_time = time_

    @property
    def leg_count(self) -> int:
        return len(self.legs)

    def unrealized_pnl(self, current_price: float) -> float:
        """Нереализованный PnL (без учёта выходной комиссии). Long: (price - p_avg)*qty; Short: (p_avg - price)*qty."""
        if self.side == "short":
            return (self.p_avg - current_price) * self.total_qty - self.total_fees
        return (current_price - self.p_avg) * self.total_qty - self.total_fees

    def stop_price(self, max_loss_usd: float, commission_rate: float) -> float:
        """
        Рассчитать цену стоп-лосса на основе max_loss_usd.
        Формула: stop_price = P_avg - (max_loss_usd + fees) / total_qty
        """
        if self.total_qty <= 0:
            return 0.0
        # Учитываем входные комиссии и выходную комиссию при стопе
        total_fees_with_exit = self.total_fees + self.p_avg * self.total_qty * commission_rate
        stop_price = self.p_avg - (max_loss_usd + total_fees_with_exit) / self.total_qty
        return max(0.0, stop_price)  # Защита от отрицательных цен

    def reset(self):
        self.legs.clear()
        self.total_qty = 0.0
        self.total_cost = 0.0
        self.p_avg = 0.0
        self.entry_time = 0
        self.p_drop_avg = 0.0
        self.total_fees = 0.0
        self.entry_atr = 0.0
        self.side = "long"


def run_apex_simulation(
    candles: list, 
    params: dict, 
    signals: Optional[list] = None,
    signals_short: Optional[list] = None,
    vol_ratios: Optional[list] = None,
    returns: Optional[list] = None,
    closes: Optional[list] = None,
    return_curve: bool = False, 
    return_trades: bool = False
) -> dict:
    """
    Модернизированная Apex-симуляция. candles: [[t, o, h, l, c, v], ...].
    
    ОПТИМИЗИРОВАННАЯ ВЕРСИЯ: Принимает готовые сигналы входа вместо расчета Z-Score.
    Если signals не передан, рассчитывает сигналы самостоятельно (для обратной совместимости).

    === Параметры ===

    Сканер (вход по Z-Score):
      scannerSigma (S)     : порог Z-Score, вход при Z <= -S (default 2.0)
      retrospective (R)    : окно для расчёта μ и σ в барах (default 100)
      dropLengthMinutes    : длина L в минутах (конвертируется в бары)

    OBI фильтр (имитация через объём в бэктесте):
      obiFilterEnabled     : вкл/выкл (default True)
      obiThreshold         : мин. ratio vol/avg для входа (default 0.5)

    Сетка / Мартингейл:
      gridLegs             : макс. колен усреднения, 0 = выкл (default 0)
      gridStepPct          : шаг сетки в % (default 1.0)
      gridStepMode         : "fixed" | "atr" (default "fixed")
      atrPeriod            : период ATR для динамического шага (default 14)
      martinMultiplier     : множитель лота на колено (default 1.0 = без мартингейла)

    Тейк-профит:
      takeAlpha (α)        : коэффициент формулы 0-10, None = legacy (default None)
                             P_take = P_avg + (P_drop_avg - P_avg) * α
      takeProfitPct        : legacy фиксированный % (default 0.003)
      breakEvenAfterLegs   : после N колен — режим безубытка (default 0 = выкл)

    Риск:
      maxLossPct           : макс. убыток в % от средней цены входа P_avg (default 3)
                              Формула: StopPrice = P_avg * (1 - maxLossPct / 100)

    Исполнение:
      commissionPct        : комиссия % (default 0.04)
      slippagePct          : имитация проскальзывания % (default 0.01)

    Мета:
      startLotUsd          : базовый лот в USD (default 10)
      timeframeMinutes     : (default 1)
      initialEquity        : (default 100)
      allowShort           : разрешить шорты по сигналу Z >= +S (default True)

    === Возвращает ===
    { totalPnlUsd, totalPnlPct, maxDrawdownPct, tradesCount, winratePct,
      profitFactor, avgLegsPerTrade, gridTradesCount }
    При return_curve=True: + equityCurve: [{ time, equity }, ...]
    При return_trades=True: + trades: [{ entryTime, exitTime, entryPrice, exitPrice, pAvg, pnlUsd, legs, legDetails, reason, duration }, ...]
    """
    empty = {
        "totalPnlUsd": 0, "totalPnlPct": 0, "maxDrawdownPct": 0,
        "tradesCount": 0, "winratePct": 0, "profitFactor": 0,
        "avgLegsPerTrade": 0, "gridTradesCount": 0,
    }
    if return_curve:
        empty["equityCurve"] = []
    if not candles or len(candles) < 50:
        return empty

    # ─── Парсинг параметров ───
    scanner_sigma = float(params.get("scannerSigma", 2.0))
    R = int(params.get("retrospective", 100))
    drop_len_min = float(params.get("dropLengthMinutes", 10))
    tf_min = int(params.get("timeframeMinutes", 1))
    L = int(params.get("dropLength", 0)) or max(1, round(drop_len_min / tf_min))

    obi_enabled = bool(params.get("obiFilterEnabled", True))
    obi_threshold = float(params.get("obiThreshold", 0.6))

    start_lot = float(params.get("startLotUsd", 10))
    grid_legs = int(params.get("gridLegs", 0))
    grid_step_pct = float(params.get("gridStepPct", 1.0)) / 100.0
    grid_step_mode = str(params.get("gridStepMode", "fixed"))
    atr_period = int(params.get("atrPeriod", 14))
    martin_mult = float(params.get("martinMultiplier", 1.0))

    take_alpha = params.get("takeAlpha", None)
    if take_alpha is not None:
        take_alpha = float(take_alpha)
    take_profit_pct = float(params.get("takeProfitPct", 0.003))
    be_after_legs = int(params.get("breakEvenAfterLegs", 0))

    max_loss_pct = float(params.get("maxLossPct", 3))  # Макс. убыток в % от equity

    commission_rate = float(params.get("commissionPct", 0.04)) / 100.0
    slippage_rate = float(params.get("slippagePct", 0.01)) / 100.0
    initial_equity = float(params.get("initialEquity", 100))
    allow_short = bool(params.get("allowShort", True))

    # Авто-улучшения (можно переопределить пресетом)
    trend_filter_enabled = bool(params.get("trendFilterEnabled", True))
    ema_period = int(params.get("emaPeriod", 50))
    cooldown_bars = int(params.get("cooldownBars", 5))
    dynamic_alpha_enabled = bool(params.get("dynamicAlphaEnabled", True))
    exposure_cap_both = bool(params.get("exposureCapBoth", True))
    # Режим волатильности: вход только когда ATR в допустимом диапазоне (избегаем флэта и хаоса)
    atr_regime_filter_enabled = bool(params.get("atrRegimeFilterEnabled", True))
    atr_regime_min = float(params.get("atrRegimeMin", 0.5))
    atr_regime_max = float(params.get("atrRegimeMax", 2.0))
    # Локальный экстремум: лонг только на локальном минимуме L-return, шорт на локальном максимуме
    local_extremum_bars = int(params.get("localExtremumBars", 2))
    # Запас по тренду: цена должна быть чуть выше EMA для лонга, чуть ниже для шорта
    trend_filter_margin_pct = float(params.get("trendFilterMarginPct", 0.05))
    # Минимальное соотношение риск/прибыль при входе: тейк-дистанция >= min_r_ratio * стоп-дистанция
    min_r_ratio = float(params.get("minRRatio", 1.15))

    # ML-фильтр входа (Apex: опциональный фильтр по предсказанию XGBoost)
    ml_filter_enabled = bool(params.get("mlFilterEnabled", False))
    ml_model_path = params.get("mlModelPath") or None
    ml_long_threshold = float(params.get("mlLongThreshold", 0.55))
    ml_short_threshold = float(params.get("mlShortThreshold", 0.55))
    if ml_filter_enabled and not ml_model_path:
        sym = params.get("symbol", "")
        tf = params.get("timeframe", "")
        if sym and tf:
            ml_model_path = str(_data_root() / "models" / f"{sym.upper()}_{tf}_xgb.json")

    # ─── Предвычисления ───
    n = len(candles)
    
    # Используем переданные данные или рассчитываем самостоятельно
    if closes is None:
        closes = [float(c[4]) for c in candles]
    if returns is None:
        returns = [0.0] * n
        for i in range(L, n):
            if closes[i - L] > 0:
                returns[i] = (closes[i] - closes[i - L]) / closes[i - L]
    
    volumes = [float(c[5]) for c in candles]

    # Минимальный стартовый бар: нужен L для return + R для ретроспективы
    start_bar = L + R
    if start_bar >= n:
        return empty

    # Если сигналы не переданы, рассчитываем их (для обратной совместимости)
    signals_short_inline = None
    if signals is None:
        # Старая логика расчета Z-Score (для обратной совместимости) + шорт при Z >= +S
        signals = [False] * n
        signals_short_inline = [False] * n
        retro_window = deque()
        running_sum = 0.0
        running_sum_sq = 0.0
        for j in range(L, L + R):
            val = returns[j]
            retro_window.append(val)
            running_sum += val
            running_sum_sq += val * val
        
        for i in range(start_bar, n):
            mu = running_sum / R if R > 0 else 0.0
            variance = (running_sum_sq / R) - (mu * mu) if R > 0 else 0.0
            sigma_raw = math.sqrt(max(0.0, variance))
            sigma_adjusted = sigma_raw * math.sqrt(L / R) if R > 0 and L > 0 else sigma_raw
            current_ret = returns[i]
            z_score = (current_ret - mu) / sigma_adjusted if sigma_adjusted > 1e-12 else 0.0
            signals[i] = z_score <= -scanner_sigma
            signals_short_inline[i] = z_score >= scanner_sigma
            
            if i < n - 1:
                old_ret = retro_window.popleft()
                running_sum -= old_ret
                running_sum_sq -= old_ret * old_ret
                retro_window.append(returns[i])
                running_sum += returns[i]
                running_sum_sq += returns[i] * returns[i]
    
    # Если vol_ratios не передан, рассчитываем (для обратной совместимости)
    if vol_ratios is None:
        vol_ratios = [0.0] * n
        vol_window = deque()
        vol_sum = 0.0
        vol_start = max(0, start_bar - R)
        for j in range(vol_start, start_bar):
            vol_window.append(volumes[j])
            vol_sum += volumes[j]
        
        for i in range(start_bar, n):
            avg_vol = vol_sum / len(vol_window) if vol_window else 1.0
            vol_ratios[i] = volumes[i] / avg_vol if avg_vol > 0 else 0.0
            vol_window.append(volumes[i])
            vol_sum += volumes[i]
            if len(vol_window) > R:
                old_vol = vol_window.popleft()
                vol_sum -= old_vol

    # ─── Состояние симуляции ───
    equity = initial_equity
    trades = []
    equity_curve_values = [initial_equity]
    equity_curve_timed = []
    if return_curve:
        equity_curve_timed.append({"time": int(candles[start_bar][0]), "equity": initial_equity})

    pos_long = _GridPosition()
    pos_long.side = "long"
    pos_short = _GridPosition()
    pos_short.side = "short"

    last_close_bar_long = -9999
    last_close_bar_short = -9999

    def _slip(price: float, is_buy: bool) -> float:
        return price * (1.0 + slippage_rate) if is_buy else price * (1.0 - slippage_rate)

    def _current_equity(price: float) -> float:
        """Эквити с учётом нереализованного PnL по обеим позициям (лонг + шорт одновременно)."""
        return equity + pos_long.unrealized_pnl(price) + pos_short.unrealized_pnl(price)

    def _close_position(pos: _GridPosition, exit_price_raw: float, time_: int, reason: str):
        nonlocal equity
        is_long = pos.side == "long"
        exit_price = _slip(exit_price_raw, is_buy=not is_long)
        exit_fee = exit_price * pos.total_qty * commission_rate
        gross_pnl = (exit_price - pos.p_avg) * pos.total_qty if is_long else (pos.p_avg - exit_price) * pos.total_qty
        pnl_usd = gross_pnl - pos.total_fees - exit_fee
        equity += pnl_usd
        
        trade_info = {
            "pnlUsd": round(pnl_usd, 2),
            "legs": pos.leg_count,
            "reason": reason,
            "side": pos.side,
        }
        if return_trades:
            leg_details = []
            for leg_price, leg_qty, leg_time in pos.legs:
                leg_details.append({
                    "price": round(leg_price, 8),
                    "qty": round(leg_qty, 8),
                    "time": leg_time,
                })
            duration_seconds = time_ - pos.entry_time if pos.entry_time > 0 else 0
            trade_info.update({
                "entryTime": pos.entry_time,
                "exitTime": time_,
                "entryPrice": round(pos.legs[0][0] if pos.legs else 0.0, 8),
                "exitPrice": round(exit_price, 8),
                "pAvg": round(pos.p_avg, 8),
                "pDropAvg": round(pos.p_drop_avg, 8),
                "totalQty": round(pos.total_qty, 8),
                "duration": duration_seconds,
                "legDetails": leg_details,
            })
        trades.append(trade_info)
        equity_curve_values.append(equity)
        if return_curve:
            equity_curve_timed.append({"time": time_, "equity": round(equity, 4)})
        pos.reset()
        if is_long:
            pos.side = "long"
        else:
            pos.side = "short"

    # ─── Основной цикл ───
    for i in range(start_bar, n):
        time_i = int(candles[i][0])
        close_i = closes[i]
        low_i = float(candles[i][3])
        high_i = float(candles[i][2])

        # Сигналы входа: лонг при падении (Z <= -S), шорт при всплеске (Z >= +S)
        signal_long = signals[i] if i < len(signals) else False
        signal_short = (signals_short_inline[i] if signals_short_inline is not None and i < len(signals_short_inline) else (signals_short[i] if signals_short is not None and i < len(signals_short) else False))
        
        # Используем готовый vol_ratio (предрассчитанный)
        vol_ratio = vol_ratios[i] if i < len(vol_ratios) else 0.0

        current_eq = _current_equity(close_i)

        grid_legs_eff = 0 if (exposure_cap_both and pos_long.leg_count > 0 and pos_short.leg_count > 0) else grid_legs
        atr_i = _calc_atr(candles, i, atr_period)
        atr_median = _calc_atr_median(candles, i, atr_period, 50) if dynamic_alpha_enabled else 0.0
        alpha_eff = (float(take_alpha) * (atr_i / atr_median) if (atr_median and take_alpha is not None) else take_alpha) if take_alpha is not None else None
        ema_i = _calc_ema(closes, i, ema_period) if trend_filter_enabled else close_i
        # Режим ATR: не входить в мёртвом рынке (ATR слишком низкий) и не в хаосе (ATR слишком высокий)
        atr_ratio = (atr_i / atr_median) if (atr_median and atr_median > 1e-12) else 1.0
        atr_regime_ok = not atr_regime_filter_enabled or (atr_regime_min <= atr_ratio <= atr_regime_max)
        # Локальный экстремум: лонг — L-return минимальный за последние N баров, шорт — максимальный
        lookback = min(local_extremum_bars, i - start_bar) if local_extremum_bars > 0 else 0
        local_min_ok = (lookback == 0 or returns[i] <= min(returns[i - k] for k in range(lookback + 1)))
        local_max_ok = (lookback == 0 or returns[i] >= max(returns[i - k] for k in range(lookback + 1)))
        margin_mult = 1.0 + (trend_filter_margin_pct / 100.0) if trend_filter_enabled else 1.0
        trend_ok_long = not trend_filter_enabled or (close_i >= ema_i * margin_mult)
        trend_ok_short = not trend_filter_enabled or (close_i <= ema_i * (2.0 - margin_mult))

        # ─── Управление лонгом ───
        if pos_long.leg_count > 0:
            stop_price = pos_long.p_avg * (1.0 - max_loss_pct / 100.0)
            if low_i <= stop_price:
                _close_position(pos_long, stop_price, time_i, "stop")
                last_close_bar_long = i
                continue
            if grid_legs_eff > 0 and pos_long.leg_count < grid_legs_eff + 1:
                step = grid_step_pct * (_calc_atr(candles, i, atr_period) / pos_long.entry_atr) if (grid_step_mode == "atr" and pos_long.entry_atr > 0) else grid_step_pct
                next_level = pos_long.p_avg * (1.0 - step)
                if low_i <= next_level:
                    leg_lot = start_lot * (martin_mult ** pos_long.leg_count)
                    if leg_lot <= current_eq:
                        buy_price = _slip(next_level, is_buy=True)
                        leg_qty = leg_lot / buy_price if buy_price > 0 else 0
                        fee = buy_price * leg_qty * commission_rate
                        pos_long.add_leg(buy_price, leg_qty, time_i, fee)
                        if pos_long.leg_count > 0:
                            stop_price_new = pos_long.p_avg * (1.0 - max_loss_pct / 100.0)
                            if low_i <= stop_price_new:
                                _close_position(pos_long, stop_price_new, time_i, "stop")
                                last_close_bar_long = i
                                continue
                            if be_after_legs > 0 and pos_long.leg_count >= be_after_legs:
                                fee_recovery = (pos_long.total_fees + pos_long.p_avg * pos_long.total_qty * commission_rate) / pos_long.total_qty if pos_long.total_qty > 0 else 0
                                take_price_new = pos_long.p_avg + fee_recovery
                            elif alpha_eff is not None and pos_long.p_drop_avg > 0:
                                take_price_new = pos_long.p_avg + (pos_long.p_drop_avg - pos_long.p_avg) * alpha_eff
                            else:
                                take_price_new = pos_long.p_avg * (1.0 + take_profit_pct)
                            if high_i >= take_price_new:
                                _close_position(pos_long, take_price_new, time_i, "take")
                                last_close_bar_long = i
                                continue
            if pos_long.leg_count > 0:
                if be_after_legs > 0 and pos_long.leg_count >= be_after_legs:
                    fee_recovery = (pos_long.total_fees + pos_long.p_avg * pos_long.total_qty * commission_rate) / pos_long.total_qty if pos_long.total_qty > 0 else 0
                    take_price = pos_long.p_avg + fee_recovery
                elif alpha_eff is not None and pos_long.p_drop_avg > 0:
                    take_price = pos_long.p_avg + (pos_long.p_drop_avg - pos_long.p_avg) * alpha_eff
                else:
                    take_price = pos_long.p_avg * (1.0 + take_profit_pct)
                if high_i >= take_price:
                    _close_position(pos_long, take_price, time_i, "take")
                    last_close_bar_long = i
                    continue

        # ─── Управление шортом ───
        if pos_short.leg_count > 0:
            stop_price = pos_short.p_avg * (1.0 + max_loss_pct / 100.0)
            if high_i >= stop_price:
                _close_position(pos_short, stop_price, time_i, "stop")
                last_close_bar_short = i
                continue
            if grid_legs_eff > 0 and pos_short.leg_count < grid_legs_eff + 1:
                step = grid_step_pct * (_calc_atr(candles, i, atr_period) / pos_short.entry_atr) if (grid_step_mode == "atr" and pos_short.entry_atr > 0) else grid_step_pct
                next_level = pos_short.p_avg * (1.0 + step)
                if high_i >= next_level:
                    leg_lot = start_lot * (martin_mult ** pos_short.leg_count)
                    if leg_lot <= current_eq:
                        sell_price = _slip(next_level, is_buy=False)
                        leg_qty = leg_lot / sell_price if sell_price > 0 else 0
                        fee = sell_price * leg_qty * commission_rate
                        pos_short.add_leg(sell_price, leg_qty, time_i, fee)
                        if pos_short.leg_count > 0:
                            stop_price_new = pos_short.p_avg * (1.0 + max_loss_pct / 100.0)
                            if high_i >= stop_price_new:
                                _close_position(pos_short, stop_price_new, time_i, "stop")
                                last_close_bar_short = i
                                continue
                            if be_after_legs > 0 and pos_short.leg_count >= be_after_legs:
                                fee_recovery = (pos_short.total_fees + pos_short.p_avg * pos_short.total_qty * commission_rate) / pos_short.total_qty if pos_short.total_qty > 0 else 0
                                take_price_new = pos_short.p_avg - fee_recovery
                            elif alpha_eff is not None and pos_short.p_drop_avg > 0:
                                take_price_new = pos_short.p_avg - (pos_short.p_drop_avg - pos_short.p_avg) * alpha_eff
                            else:
                                take_price_new = pos_short.p_avg * (1.0 - take_profit_pct)
                            if low_i <= take_price_new:
                                _close_position(pos_short, take_price_new, time_i, "take")
                                last_close_bar_short = i
                                continue
            if pos_short.leg_count > 0:
                if be_after_legs > 0 and pos_short.leg_count >= be_after_legs:
                    fee_recovery = (pos_short.total_fees + pos_short.p_avg * pos_short.total_qty * commission_rate) / pos_short.total_qty if pos_short.total_qty > 0 else 0
                    take_price = pos_short.p_avg - fee_recovery
                elif alpha_eff is not None and pos_short.p_drop_avg > 0:
                    take_price = pos_short.p_avg - (pos_short.p_drop_avg - pos_short.p_avg) * alpha_eff
                else:
                    take_price = pos_short.p_avg * (1.0 - take_profit_pct)
                if low_i <= take_price:
                    _close_position(pos_short, take_price, time_i, "take")
                    last_close_bar_short = i
                    continue

        # ─── ML-фильтр: предсказание модели только при наличии сигнала входа (ускоряет расчёт) ───
        if ml_filter_enabled and ml_model_path and (signal_long or signal_short):
            if i < MIN_BAR_INDEX or compute_features_at is None:
                ml_ok_long, ml_ok_short = False, False
            else:
                feats = compute_features_at(candles, i)
                if feats is None:
                    ml_ok_long, ml_ok_short = False, False
                else:
                    proba = _get_ml_proba(ml_model_path, feats)
                    if proba is None:
                        ml_ok_long, ml_ok_short = True, True
                    else:
                        ml_ok_long = proba[2] >= ml_long_threshold
                        ml_ok_short = proba[0] >= ml_short_threshold
        elif ml_filter_enabled and ml_model_path:
            ml_ok_long, ml_ok_short = False, False  # нет сигнала — ML не вызываем, вход запрещён по Z-Score
        else:
            ml_ok_long, ml_ok_short = True, True

        # ─── Вход: лонг и шорт независимо (тренд + кулдаун + ATR + лок. экстремум + min R:R + ML) ───
        if pos_long.leg_count == 0 and signal_long and ml_ok_long and trend_ok_long and (i > last_close_bar_long + cooldown_bars) and atr_regime_ok and local_min_ok:
            if not (obi_enabled and vol_ratio < obi_threshold) and start_lot <= current_eq:
                buy_price = _slip(close_i, is_buy=True)
                window_closes_long = closes[max(0, i - L):i + 1]
                p_drop_avg_long = sum(window_closes_long) / len(window_closes_long) if window_closes_long else close_i
                stop_price_long = buy_price * (1.0 - max_loss_pct / 100.0)
                if alpha_eff is not None and p_drop_avg_long > 0:
                    take_price_long = buy_price + (p_drop_avg_long - buy_price) * alpha_eff
                else:
                    take_price_long = buy_price * (1.0 + take_profit_pct)
                take_dist_long = take_price_long - buy_price
                stop_dist_long = buy_price - stop_price_long
                if stop_dist_long > 1e-12 and take_dist_long > 0 and take_dist_long >= min_r_ratio * stop_dist_long:
                    qty = start_lot / buy_price if buy_price > 0 else 0
                    fee = buy_price * qty * commission_rate
                    pos_long.add_leg(buy_price, qty, time_i, fee)
                    pos_long.p_drop_avg = p_drop_avg_long
                    if grid_step_mode == "atr":
                        pos_long.entry_atr = _calc_atr(candles, i, atr_period)
        if pos_short.leg_count == 0 and allow_short and signal_short and ml_ok_short and trend_ok_short and (i > last_close_bar_short + cooldown_bars) and atr_regime_ok and local_max_ok:
            if not (obi_enabled and vol_ratio < obi_threshold) and start_lot <= current_eq:
                sell_price = _slip(close_i, is_buy=False)
                window_closes_short = closes[max(0, i - L):i + 1]
                p_drop_avg_short = sum(window_closes_short) / len(window_closes_short) if window_closes_short else close_i
                stop_price_short = sell_price * (1.0 + max_loss_pct / 100.0)
                if alpha_eff is not None and p_drop_avg_short > 0:
                    take_price_short = sell_price - (sell_price - p_drop_avg_short) * alpha_eff
                else:
                    take_price_short = sell_price * (1.0 - take_profit_pct)
                take_dist_short = sell_price - take_price_short
                stop_dist_short = stop_price_short - sell_price
                if stop_dist_short > 1e-12 and take_dist_short > 0 and take_dist_short >= min_r_ratio * stop_dist_short:
                    qty = start_lot / sell_price if sell_price > 0 else 0
                    fee = sell_price * qty * commission_rate
                    pos_short.add_leg(sell_price, qty, time_i, fee)
                    pos_short.p_drop_avg = p_drop_avg_short
                    if grid_step_mode == "atr":
                        pos_short.entry_atr = _calc_atr(candles, i, atr_period)

        if return_curve and (pos_long.leg_count > 0 or pos_short.leg_count > 0):
            if (i % 10 == 0) or (i == n - 1):
                equity_curve_timed.append({"time": time_i, "equity": round(_current_equity(close_i), 4)})

    # Закрыть открытые позиции в конце (лонг и шорт независимо)
    end_time = int(candles[-1][0])
    end_price = closes[-1]
    if pos_long.leg_count > 0 and pos_long.total_qty > 0:
        _close_position(pos_long, end_price, end_time, "end")
    if pos_short.leg_count > 0 and pos_short.total_qty > 0:
        _close_position(pos_short, end_price, end_time, "end")

    # ─── Статистика ───
    total_pnl_usd = equity - initial_equity
    total_pnl_pct = (total_pnl_usd / initial_equity * 100) if initial_equity > 0 else 0
    trades_count = len(trades)
    wins = [t for t in trades if t["pnlUsd"] > 0]
    losses = [t for t in trades if t["pnlUsd"] < 0]
    winrate_pct = (len(wins) / trades_count * 100) if trades_count > 0 else 0
    gross_profit = sum(t["pnlUsd"] for t in wins)
    gross_loss = sum(abs(t["pnlUsd"]) for t in losses)
    profit_factor = round(gross_profit / gross_loss, 2) if gross_loss > 0 else (999.99 if gross_profit > 0 else 0)

    # Max Drawdown % рассчитывается от Initial Equity (а не от peakEquity)
    # Формула: Max Drawdown % = ((peakEquity - currentEquity) / initialEquity) * 100
    peak = initial_equity
    max_dd = 0.0
    for e in equity_curve_values:
        if e > peak:
            peak = e
        dd = ((peak - e) / initial_equity * 100) if initial_equity > 0 else 0
        if dd > max_dd:
            max_dd = dd

    avg_legs = sum(t.get("legs", 1) for t in trades) / trades_count if trades_count > 0 else 0
    grid_trades = sum(1 for t in trades if t.get("legs", 1) > 1)

    out = {
        "totalPnlUsd": round(total_pnl_usd, 2),
        "totalPnlPct": round(total_pnl_pct, 2),
        "maxDrawdownPct": round(max_dd, 2),
        "tradesCount": trades_count,
        "winratePct": round(winrate_pct, 1),
        "profitFactor": profit_factor,
        "avgLegsPerTrade": round(avg_legs, 1),
        "gridTradesCount": grid_trades,
    }
    if return_curve:
        out["equityCurve"] = equity_curve_timed
    if return_trades:
        out["trades"] = trades
    return out


# ─── ТУРБО-УСКОРЕНИЕ: Предрасчет сигналов ───

# Глобальные переменные для передачи данных в процессы Pool через initializer
_shared_candles = None
_shared_signals_data = None


def prepare_signals(candles: list, R: int, L: int, sigma_opts: list, tf_min: int, drop_len_min: float) -> dict:
    """
    ТУРБО-УСКОРЕНИЕ: Предрасчет сигналов входа для всех значений sigma с использованием numpy.
    Возвращает словарь: {sigma_value: [bool, bool, ...]} - массив сигналов для каждого бара.
    Также возвращает предрассчитанные vol_ratios, returns, closes.
    """
    n = len(candles)
    if n < L + R:
        return {}

    # Конвертируем в numpy массивы для ускорения
    closes_arr = np.array([float(c[4]) for c in candles], dtype=np.float64)
    volumes_arr = np.array([float(c[5]) for c in candles], dtype=np.float64)

    # L-барные доходности (% изменение за L баров) - рассчитываем ОДИН РАЗ с numpy
    returns = np.zeros(n, dtype=np.float64)
    if L > 0 and n > L:
        for i in range(L, n):
            if closes_arr[i - L] > 1e-12:
                returns[i] = (closes_arr[i] - closes_arr[i - L]) / closes_arr[i - L]

    start_bar = L + R
    if start_bar >= n:
        return {}

    # Предрасчет vol_ratios для всех баров с numpy (скользящее среднее через deque для эффективности)
    vol_ratios = np.zeros(n, dtype=np.float64)
    vol_window = deque()
    vol_sum = 0.0
    vol_start = max(0, start_bar - R)

    # Инициализация окна объёмов
    for j in range(vol_start, start_bar):
        vol_window.append(volumes_arr[j])
        vol_sum += volumes_arr[j]

    # Рассчитываем vol_ratios для всех баров
    for i in range(start_bar, n):
        avg_vol = vol_sum / len(vol_window) if vol_window else 1.0
        vol_ratios[i] = volumes_arr[i] / avg_vol if avg_vol > 1e-12 else 0.0

        # Сдвигаем окно
        vol_window.append(volumes_arr[i])
        vol_sum += volumes_arr[i]
        if len(vol_window) > R:
            old_vol = vol_window.popleft()
            vol_sum -= old_vol

    # Предрасчет сигналов для каждого sigma с оптимизированным скользящим окном
    signals_by_sigma = {}

    signals_short_by_sigma = {}
    for sigma in sigma_opts:
        signals = np.zeros(n, dtype=bool)
        signals_short = np.zeros(n, dtype=bool)

        # Инициализация скользящего окна ретроспективы через running_sum и running_sum_sq
        # Это избегает создания объектов на каждой итерации (в 5-10 раз быстрее)
        running_sum = 0.0
        running_sum_sq = 0.0
        
        # Инициализируем окно: заполняем первыми R значениями (returns[L] до returns[L+R-1])
        for j in range(L, L + R):
            val = returns[j]
            running_sum += val
            running_sum_sq += val * val

        # Проходим по всем барам и рассчитываем сигналы
        for i in range(start_bar, n):
            # Расчет μ и σ через running_sum (без создания массивов - в 5-10 раз быстрее)
            mu = running_sum / R if R > 0 else 0.0
            variance = (running_sum_sq / R) - (mu * mu) if R > 0 else 0.0
            sigma_raw = np.sqrt(max(0.0, variance))
            sigma_adjusted = sigma_raw * np.sqrt(L / R) if R > 0 and L > 0 else sigma_raw

            current_ret = returns[i]
            if sigma_adjusted > 1e-12:
                z_score = (current_ret - mu) / sigma_adjusted
                signals[i] = z_score <= -sigma
                # Шорт: вход при аномальном росте (Z >= +sigma) — mean reversion вниз (Apex Logic)
                signals_short[i] = z_score >= sigma

            # Сдвигаем окно ретроспективы: удаляем старое значение, добавляем новое
            # Окно для индекса i содержит returns[i-R] до returns[i-1]
            # При переходе к i+1: убираем returns[i-R], добавляем returns[i]
            if i < n - 1:
                # Индекс значения, которое выходит из окна
                old_idx = i - R
                old_ret = returns[old_idx]
                running_sum -= old_ret
                running_sum_sq -= old_ret * old_ret
                
                # Добавляем текущее значение в окно
                running_sum += returns[i]
                running_sum_sq += returns[i] * returns[i]

        signals_by_sigma[sigma] = signals.tolist()
        signals_short_by_sigma[sigma] = signals_short.tolist()

    return {
        "signals": signals_by_sigma,  # {sigma: [bool, bool, ...]} — лонг при падении (Z <= -sigma)
        "signals_short": signals_short_by_sigma,  # {sigma: [bool, ...]} — шорт при всплеске (Z >= +sigma)
        "vol_ratios": vol_ratios.tolist(),  # [float, float, ...]
        "returns": returns.tolist(),  # [float, float, ...] - для расчета P_drop_avg
        "closes": closes_arr.tolist(),  # [float, float, ...] - для расчета P_drop_avg
    }


def run_apex_simulation_turbo(candles: list, params: dict, signals: list, signals_short: Optional[list], vol_ratios: list, returns: list, closes: list, return_curve: bool = False, return_trades: bool = False) -> dict:
    """
    ТУРБО-версия: предрассчитанные сигналы лонг + шорт; делегирует в run_apex_simulation.
    """
    return run_apex_simulation(
        candles, params,
        signals=signals,
        signals_short=signals_short,
        vol_ratios=vol_ratios,
        returns=returns,
        closes=closes,
        return_curve=return_curve,
        return_trades=return_trades,
    )


def _init_worker(candles, signals_data):
    """Инициализатор для процессов Pool - передает данные один раз."""
    global _shared_candles, _shared_signals_data
    _shared_candles = candles
    _shared_signals_data = signals_data


def _run_single_simulation(args):
    """Вспомогательная функция для параллельного выполнения симуляции."""
    candles, params = args
    return run_apex_simulation(candles, params)


def _run_single_simulation_turbo(params):
    """Турбо-версия: использует предрассчитанные сигналы и глобальные данные."""
    global _shared_candles, _shared_signals_data
    
    if _shared_candles is None or _shared_signals_data is None:
        # Fallback на обычную симуляцию если данные не инициализированы
        return run_apex_simulation(_shared_candles or [], params)

    # Используем предрассчитанные сигналы (лонг + шорт)
    scanner_sigma = float(params.get("scannerSigma", 2.0))
    n_candles = len(_shared_candles)
    signals = _shared_signals_data["signals"].get(scanner_sigma, [False] * n_candles)
    signals_short = _shared_signals_data.get("signals_short", {}).get(scanner_sigma, [False] * n_candles)
    vol_ratios = _shared_signals_data["vol_ratios"]
    returns = _shared_signals_data["returns"]
    closes = _shared_signals_data["closes"]

    return run_apex_simulation_turbo(
        _shared_candles,
        params,
        signals,
        signals_short,
        vol_ratios,
        returns,
        closes
    )


def _run_simulation_with_signals(args):
    """
    Вспомогательная функция для параллельного выполнения симуляции с сигналами.
    Должна быть на уровне модуля для возможности pickle в multiprocessing.
    """
    params, signals_data_local, candles_local = args
    scanner_sigma = float(params.get("scannerSigma", 2.0))
    n_c = len(candles_local)
    signals = signals_data_local["signals"].get(scanner_sigma, [False] * n_c)
    signals_short = signals_data_local.get("signals_short", {}).get(scanner_sigma, [False] * n_c)
    vol_ratios = signals_data_local["vol_ratios"]
    returns = signals_data_local["returns"]
    closes = signals_data_local["closes"]
    
    return run_apex_simulation(
        candles_local, 
        params, 
        signals=signals,
        signals_short=signals_short,
        vol_ratios=vol_ratios,
        returns=returns,
        closes=closes
    )


# Глобальные переменные для worker'ов оптимизации
_worker_candles = None
_worker_all_signals = None  # dict: { L_value: signals_data }

def _init_optimization_worker(candles_arg, all_signals_arg):
    """Инициализация глобальных переменных в worker-процессе (один раз при создании Pool)."""
    global _worker_candles, _worker_all_signals
    _worker_candles = candles_arg
    _worker_all_signals = all_signals_arg

def _run_optimization_task(task):
    """
    Запуск одной симуляции внутри worker-процесса.
    task = (params_dict, L_key) — L_key для выбора нужных сигналов.
    """
    global _worker_candles, _worker_all_signals
    
    params, L_key = task
    
    if _worker_candles is None or _worker_all_signals is None:
        return {}

    signals_data = _worker_all_signals.get(L_key)
    if signals_data is None:
        return {}

    scanner_sigma = float(params.get("scannerSigma", 2.0))
    signals = signals_data["signals"].get(scanner_sigma, [False] * len(_worker_candles))
    vol_ratios = signals_data["vol_ratios"]
    returns = signals_data["returns"]
    closes = signals_data["closes"]
    
    return run_apex_simulation(
        _worker_candles, 
        params, 
        signals=signals,
        vol_ratios=vol_ratios,
        returns=returns,
        closes=closes
    )


def run_optimization(
    exchange: str,
    symbol: str,
    timeframe: str,
    base_params: dict,
    top_n: Optional[int] = 5,
    use_multiprocessing: bool = True,
    optimization_id: Optional[str] = None,
    history_days: Optional[int] = None,
    fast_mode: bool = False,
    sigma_range: Optional[dict] = None,
    alpha_range: Optional[dict] = None,
    length_range: Optional[dict] = None,
    grid_legs_range: Optional[dict] = None,
    grid_step_range: Optional[dict] = None,
) -> list:
    """
    Грид-оптимизация по новым параметрам Apex с параллелизацией.
    base_params: startLotUsd, dropLengthMinutes, commissionPct, initialEquity, retrospective.
    Перебирает: scannerSigma, takeAlpha, gridLegs, gridStepPct, martinMultiplier, maxLossPct.
    Возвращает top_n лучших сетапов по profitFactor * totalPnlPct.
    
    use_multiprocessing: использовать многопоточность (по умолчанию True).
    history_days: количество дней истории для оптимизации (None = вся история).
    """
    candles = load_candles_from_history(exchange, symbol, timeframe)
    
    # Фильтрация по количеству дней, если указано
    if history_days and history_days > 0:
        if candles:
            # Свечи отсортированы по времени (первый элемент - самый старый)
            # Находим timestamp для начала периода (history_days дней назад от последней свечи)
            last_timestamp = candles[-1][0]  # Последняя свеча
            cutoff_timestamp = last_timestamp - (history_days * 24 * 60 * 60)  # history_days дней назад в секундах
            
            # Фильтруем свечи: оставляем только те, что после cutoff_timestamp
            candles = [c for c in candles if c[0] >= cutoff_timestamp]
            print(f"[Optimization] Filtered to last {history_days} days: {len(candles)} candles")
    
    if len(candles) < 200:
        print(f"[Optimization] ERROR: Not enough candles: {len(candles)} < 200")
        return []

    tf_min = TIMEFRAME_MINUTES.get(timeframe, 1)
    base_params = dict(base_params)
    base_params["timeframeMinutes"] = tf_min
    base_params["symbol"] = symbol
    base_params["timeframe"] = timeframe

    # Генерация диапазонов для Sigma и Alpha
    if sigma_range:
        # Генерируем значения от min до max с шагом step
        sigma_opts = []
        current = sigma_range["min"]
        while current <= sigma_range["max"]:
            sigma_opts.append(round(current, 2))
            current += sigma_range["step"]
    else:
        # Дефолтные значения для обратной совместимости
        sigma_opts = [2.0, 3.0, 4.0]
    
    if alpha_range:
        # Генерируем значения от min до max с шагом step
        alpha_opts = []
        current = alpha_range["min"]
        while current <= alpha_range["max"]:
            alpha_opts.append(round(current, 1))
            current += alpha_range["step"]
    else:
        # Дефолтные значения для обратной совместимости
        alpha_opts = [1.0, 2.0, 3.0]
    
    # Генерация диапазонов для Длины (L) - dropLengthMinutes
    if length_range:
        length_opts = []
        current = length_range["min"]
        while current <= length_range["max"]:
            length_opts.append(int(current))
            current += length_range["step"]
    else:
        # Используем значение из base_params
        length_opts = [int(base_params.get("dropLengthMinutes", 10))]
    
    # Генерация диапазонов для Колен сетки
    if grid_legs_range:
        grid_legs_opts = []
        current = grid_legs_range["min"]
        while current <= grid_legs_range["max"]:
            grid_legs_opts.append(int(current))
            current += grid_legs_range["step"]
    else:
        # Используем значение из base_params
        grid_legs_opts = [base_params.get("gridLegs", 0)]
    
    # Генерация диапазонов для Шага сетки
    if grid_step_range:
        grid_step_opts = []
        current = grid_step_range["min"]
        while current <= grid_step_range["max"]:
            grid_step_opts.append(round(current, 2))
            current += grid_step_range["step"]
    else:
        # Используем значение из base_params
        grid_step_opts = [base_params.get("gridStepPct", 1.0)]
    
    # Остальные параметры фиксируем из base_params
    max_loss_opts = [base_params.get("maxLossPct", 3)]
    martin_opts = [base_params.get("martinMultiplier", 1.0)]
    
    R = int(base_params.get("retrospective", 100))

    # ДВУХУРОВНЕВАЯ ОПТИМИЗАЦИЯ:
    # Внешний цикл: перебираем только L (Length)
    # Внутри L: один раз предрассчитываем сигналы для всех Sigma
    # Внутренний цикл: параллельно прогоняем остальные параметры (Alpha, Колена, Шаг, Мартин)
    
    all_results = []
    total_combinations = 0
    
    # Подсчитываем общее количество комбинаций для прогресса
    for length_min in length_opts:
        for sigma in sigma_opts:
            for alpha in alpha_opts:
                for max_loss in max_loss_opts:
                    for g_legs in grid_legs_opts:
                        if g_legs == 0:
                            total_combinations += 1
                        else:
                            total_combinations += len(grid_step_opts) * len(martin_opts)
    
    if optimization_id:
        with _progress_lock:
            _optimization_progress[optimization_id] = {
                "current": 0,
                "total": total_combinations,
                "status": "running",
            }
    
    # ═══════════════════════════════════════════════════════════════
    # ШАГ 1: Предрасчет сигналов для ВСЕХ значений L (один раз)
    # ═══════════════════════════════════════════════════════════════
    all_signals = {}  # { L_bars: signals_data }
    for length_min in length_opts:
        L = max(1, round(length_min / tf_min))
        print(f"[Optimization] Pre-calculating signals for L={length_min}min (L={L} bars)...")
        signals_data = prepare_signals(candles, R, L, sigma_opts, tf_min, length_min)
        if signals_data:
            all_signals[L] = signals_data
        else:
            print(f"[Optimization] Warning: Failed to prepare signals for L={length_min}, skipping...")
    
    if not all_signals:
        print(f"[Optimization] ERROR: No signals prepared for any L value!")
        return []

    # ═══════════════════════════════════════════════════════════════
    # ШАГ 2: Генерация ВСЕХ комбинаций параметров (для всех L сразу)
    # ═══════════════════════════════════════════════════════════════
    all_tasks = []      # [(params, L_key), ...]
    all_task_params = [] # [params, ...] — для сборки результатов
    
    for length_min in length_opts:
        L = max(1, round(length_min / tf_min))
        if L not in all_signals:
            continue
        for sigma in sigma_opts:
            for alpha in alpha_opts:
                for max_loss in max_loss_opts:
                    for g_legs in grid_legs_opts:
                        if g_legs == 0:
                            p = {
                                **base_params,
                                "scannerSigma": sigma,
                                "takeAlpha": alpha,
                                "dropLengthMinutes": length_min,
                                "maxLossPct": max_loss,
                                "gridLegs": 0,
                                "gridStepPct": 1.0,
                                "martinMultiplier": 1.0,
                            }
                            all_tasks.append((p, L))
                            all_task_params.append(p)
                        else:
                            for g_step in grid_step_opts:
                                for martin in martin_opts:
                                    p = {
                                        **base_params,
                                        "scannerSigma": sigma,
                                        "takeAlpha": alpha,
                                        "dropLengthMinutes": length_min,
                                        "maxLossPct": max_loss,
                                        "gridLegs": g_legs,
                                        "gridStepPct": g_step,
                                        "martinMultiplier": martin,
                                    }
                                    all_tasks.append((p, L))
                                    all_task_params.append(p)

    print(f"[Optimization] Total tasks to run: {len(all_tasks)}")

    # ═══════════════════════════════════════════════════════════════
    # ШАГ 3: Запуск ВСЕХ симуляций в ОДНОМ Pool (один раз)
    # ═══════════════════════════════════════════════════════════════
    if use_multiprocessing and len(all_tasks) > 1:
        num_workers = min(cpu_count(), len(all_tasks))
        chunksize = max(1, len(all_tasks) // (num_workers * 4))
        print(f"[Optimization] Using {num_workers} CPU cores, chunksize={chunksize}")
        
        with Pool(processes=num_workers, initializer=_init_optimization_worker, initargs=(candles, all_signals)) as pool:
            results_raw = []
            for result in pool.imap(_run_optimization_task, all_tasks, chunksize=chunksize):
                results_raw.append(result)
                if optimization_id:
                    with _progress_lock:
                        if optimization_id in _optimization_progress:
                            _optimization_progress[optimization_id]["current"] = len(results_raw)
    else:
        # Последовательное выполнение (для отладки или одной задачи)
        results_raw = []
        for task_params, L_key in all_tasks:
            signals_data = all_signals[L_key]
            scanner_sigma = float(task_params.get("scannerSigma", 2.0))
            signals = signals_data["signals"].get(scanner_sigma, [False] * len(candles))
            
            result = run_apex_simulation(
                candles, 
                task_params, 
                signals=signals,
                vol_ratios=signals_data["vol_ratios"],
                returns=signals_data["returns"],
                closes=signals_data["closes"]
            )
            results_raw.append(result)
            if optimization_id:
                with _progress_lock:
                    if optimization_id in _optimization_progress:
                        _optimization_progress[optimization_id]["current"] = len(results_raw)

    # ═══════════════════════════════════════════════════════════════
    # ШАГ 4: Сборка результатов
    # ═══════════════════════════════════════════════════════════════
    for i, params in enumerate(all_task_params):
        st = results_raw[i]
        if not st:  # пустой результат от worker'а
            continue
        result = {
            "scannerSigma": params["scannerSigma"],
            "takeAlpha": params["takeAlpha"],
            "dropLengthMinutes": params.get("dropLengthMinutes", base_params.get("dropLengthMinutes", 10)),
            "maxLossPct": params["maxLossPct"],
            "gridLegs": params["gridLegs"],
            "gridStepPct": params.get("gridStepPct", 0),
            "martinMultiplier": params["martinMultiplier"],
            **{k: st[k] for k in ("profitFactor", "totalPnlPct", "totalPnlUsd",
                                    "maxDrawdownPct", "tradesCount", "winratePct",
                                    "avgLegsPerTrade", "gridTradesCount")},
        }
        all_results.append(result)
    
    results = all_results

    # Сортировка с фильтрацией по Max Drawdown
    # Фильтр: отбрасываем стратегии с MDD > 50% (слишком рискованно)
    MAX_MDD_THRESHOLD = 50.0
    
    print(f"[Optimization] Before sorting: {len(results)} results")
    if len(results) > 0:
        print(f"[Optimization] Sample result before sorting: {results[0]}")
    
    def _score(r):
        mdd = r.get("maxDrawdownPct", 0)
        pnl_usd = r.get("totalPnlUsd", 0)
        
        # Фильтр: MDD не должен превышать порог — отправляем в хвост
        if mdd > MAX_MDD_THRESHOLD:
            return -1e12 + pnl_usd
        
        # Главный критерий: максимум заработанных денег (Total PnL USD).
        # Тай-брейк: при одинаковом PnL побеждает меньшая просадка.
        mdd_bonus = (1.0 - mdd / 100.0) * 0.001 if mdd < 100 else 0
        return pnl_usd + mdd_bonus

    results.sort(key=_score, reverse=True)
    # Дополнительно фильтруем по MDD перед возвратом
    filtered = [r for r in results if r.get("maxDrawdownPct", 0) <= MAX_MDD_THRESHOLD]
    
    print(f"[Optimization] Total results: {len(results)}, filtered by MDD: {len(filtered)}")
    
    # ВРЕМЕННО: Если все результаты отфильтрованы, возвращаем первые 10 без фильтрации для диагностики
    if len(filtered) == 0 and len(results) > 0:
        print(f"[Optimization] WARNING: All results filtered by MDD! Returning first 10 results without MDD filter for debugging")
        top_results = results[:10] if top_n is None else results[:min(10, top_n)]
    elif top_n is None:
        top_results = filtered  # Всегда возвращаем отфильтрованные результаты
    else:
        top_results = filtered[:top_n] if len(filtered) > 0 else []
    
    print(f"[Optimization] Returning {len(top_results)} results")
    if len(top_results) > 0:
        print(f"[Optimization] First result: PF={top_results[0].get('profitFactor')}, PnL={top_results[0].get('totalPnlPct')}, MDD={top_results[0].get('maxDrawdownPct')}, Trades={top_results[0].get('tradesCount')}")
    else:
        print(f"[Optimization] WARNING: No results to return! Total combinations processed: {total_combinations}")
    
    # Завершение прогресса
    if optimization_id:
        with _progress_lock:
            if optimization_id in _optimization_progress:
                _optimization_progress[optimization_id]["status"] = "completed"
                _optimization_progress[optimization_id]["current"] = total_combinations
    
    return top_results


def get_optimization_progress(optimization_id: str) -> Optional[dict]:
    """Получить прогресс оптимизации по ID."""
    with _progress_lock:
        return _optimization_progress.get(optimization_id, None)


def clear_optimization_progress(optimization_id: str):
    """Очистить прогресс оптимизации после завершения."""
    with _progress_lock:
        _optimization_progress.pop(optimization_id, None)


def get_equity_and_drawdown_curves(
    exchange: str,
    symbol: str,
    timeframe: str,
    params: dict,
) -> dict:
    """
    Симуляция по всей выкачанной истории, возврат кривых эквити и просадки.
    Возвращает: { 
        equityCurve: [{ time, equity }], 
        drawdownCurve: [{ time, drawdown }],
        metrics: { netProfitUsd, netProfitPct, maxDrawdownPct, recoveryFactor, profitFactor, winRate, avgTrade },
        trades: [{ entryTime, exitTime, entryPrice, exitPrice, pAvg, pnlUsd, legs, legDetails, reason, duration }, ...],
        warnings: [{ type, message, tradeIndex }, ...]
    }
    """
    candles = load_candles_from_history(exchange, symbol, timeframe)
    if len(candles) < 100:
        return {
            "equityCurve": [],
            "drawdownCurve": [],
            "metrics": {},
            "trades": [],
            "warnings": [],
        }

    # Ограничение длины истории: для 1m меньше баров (расчёт укладывается в таймаут 60 мин при ML)
    MAX_CANDLES_1M = 80_000
    MAX_CANDLES_OTHER = 150_000
    max_candles = MAX_CANDLES_1M if (timeframe or "").strip().lower() == "1m" else MAX_CANDLES_OTHER
    trimmed = False
    if len(candles) > max_candles:
        candles = candles[-max_candles:]
        trimmed = True
        print(f"[get_equity_and_drawdown_curves] Trimmed to last {max_candles} candles (tf={timeframe})")

    tf_min = TIMEFRAME_MINUTES.get(timeframe, 1)
    params = dict(params)
    params["timeframeMinutes"] = tf_min
    params["symbol"] = symbol
    params["timeframe"] = timeframe

    print(f"[get_equity_and_drawdown_curves] Running simulation with params: takeAlpha={params.get('takeAlpha')}, maxLossPct={params.get('maxLossPct')}, gridLegs={params.get('gridLegs')}, initialEquity={params.get('initialEquity')}, scannerSigma={params.get('scannerSigma')}")
    
    res = run_apex_simulation(candles, params, return_curve=True, return_trades=True)
    equity_curve = res.get("equityCurve", [])
    if not equity_curve:
        return {
            "equityCurve": [],
            "drawdownCurve": [],
            "metrics": {},
            "trades": [],
            "warnings": [],
        }

    # Прореживание кривой для больших историй (ускоряет ответ и отрисовку)
    MAX_CURVE_POINTS = 4000
    if len(equity_curve) > MAX_CURVE_POINTS:
        step = len(equity_curve) / MAX_CURVE_POINTS
        indices = [int(i * step) for i in range(MAX_CURVE_POINTS)]
        indices[-1] = len(equity_curve) - 1
        equity_curve = [equity_curve[i] for i in indices]

    # Рассчитываем кривую просадки
    peak = equity_curve[0]["equity"]
    drawdown_curve = []
    for point in equity_curve:
        t = point["time"]
        eq = point["equity"]
        if eq > peak:
            peak = eq
        dd = round(peak - eq, 2)
        drawdown_curve.append({"time": t, "drawdown": dd})

    # Рассчитываем метрики
    initial_equity = equity_curve[0]["equity"]
    final_equity = equity_curve[-1]["equity"]
    net_profit_usd = final_equity - initial_equity
    net_profit_pct = (net_profit_usd / initial_equity * 100) if initial_equity > 0 else 0
    max_drawdown_pct = res.get("maxDrawdownPct", 0.0)
    
    # Recovery Factor = Net Profit / Max Drawdown
    recovery_factor = (net_profit_usd / (max_drawdown_pct * initial_equity / 100)) if max_drawdown_pct > 0 else 0
    
    profit_factor = res.get("profitFactor", 0.0)
    win_rate = res.get("winratePct", 0.0)
    
    # Avg Trade = Net Profit / Trades Count
    trades_count = res.get("tradesCount", 0)
    avg_trade = (net_profit_usd / trades_count) if trades_count > 0 else 0.0
    
    metrics = {
        "netProfitUsd": round(net_profit_usd, 2),
        "netProfitPct": round(net_profit_pct, 2),
        "maxDrawdownPct": round(max_drawdown_pct, 2),
        "recoveryFactor": round(recovery_factor, 2),
        "profitFactor": profit_factor,
        "winRate": round(win_rate, 1),
        "avgTrade": round(avg_trade, 2),
    }
    
    # Получаем детальные сделки
    trades = res.get("trades", [])
    
    # Генерируем предупреждения ("скелеты в шкафу")
    warnings = []
    if trimmed:
        warnings.append({
            "type": "trimmed_history",
            "message": f"Расчёт по последним {MAX_CANDLES_EQUITY} свечам (история обрезана для скорости).",
            "tradeIndex": -1,
        })
    max_grid_legs = params.get("gridLegs", 0)
    
    for idx, trade in enumerate(trades):
        # Предупреждение: максимальное количество колен сетки
        if max_grid_legs > 0 and trade.get("legs", 0) >= max_grid_legs:
            warnings.append({
                "type": "max_grid_legs",
                "message": f"Сделка #{idx + 1}: достигнуто максимальное количество колен сетки ({trade.get('legs', 0)})",
                "tradeIndex": idx,
            })
        
        # Предупреждение: длительная сделка (более 24 часов)
        duration_hours = trade.get("duration", 0) / 3600.0
        if duration_hours > 24:
            warnings.append({
                "type": "long_duration",
                "message": f"Сделка #{idx + 1}: длительность {duration_hours:.1f} часов",
                "tradeIndex": idx,
            })
        
        # Предупреждение: большой убыток
        if trade.get("pnlUsd", 0) < -10:
            warnings.append({
                "type": "large_loss",
                "message": f"Сделка #{idx + 1}: убыток ${abs(trade.get('pnlUsd', 0)):.2f}",
                "tradeIndex": idx,
            })

    return {
        "equityCurve": equity_curve,
        "drawdownCurve": drawdown_curve,
        "metrics": metrics,
        "trades": trades,
        "warnings": warnings,
    }
