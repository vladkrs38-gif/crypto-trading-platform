"""
Скринер крупных лимитных ордеров (как на 20-тиковом графике с индикатором «Крупные ордера»).
Сканирует стаканы Binance + Bybit USDT пар, находит уровни где объём >= средний * множитель.
Множитель задаётся через переменную окружения BIG_ORDER_MULTIPLIER (в .bat).
"""

import asyncio
import os
from typing import List, Dict, Any, Tuple

import aiohttp

BINANCE_API = "https://api.binance.com/api/v3"
BYBIT_API = "https://api.bybit.com/v5/market"
# Множитель от среднего объёма (2–20). Задаётся в батнике: set BIG_ORDER_MULTIPLIER=5
BIG_ORDER_MULTIPLIER = int(os.environ.get("BIG_ORDER_MULTIPLIER", "5"))
# Сколько топ пар по объёму сканировать (Binance rate limit ~1200/min)
TOP_SYMBOLS_LIMIT = 100
# Пары, которые всегда показывать на скринере (даже без уровней), чтобы не искать "почему нет XRP"
PRIORITY_SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "XRPUSDT", "SOLUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT"]
# Стейблкоины и USD-peg — не сканируем (цена ~1$, уровни неинтересны)
STABLECOIN_BLACKLIST = frozenset([
    "USDCUSDT", "USDTUSDT", "USDEUSDT", "XUSDUSDT", "USD1USDT",
    "FDUSDUSDT", "TUSDUSDT", "BUSDUSDT", "DAIUSDT", "FRAXUSDT",
    "USDPUSDT", "PYUSDUSDT", "RLUSDUSDT", "BFUSDUSDT",
])
# Интервал обновления скринера (секунды)
SCREENER_INTERVAL_SEC = 15
# Лимит стакана: 50 уровней для расчёта средней крупности, из них топ-10 отображаем как стены
DEPTH_LIMIT = 50
# Минимальный отскок от уровня в противоположную сторону (0.2%) — только не пробитые уровни
BOUNCE_PERCENT = 0.002
# Допуск «касания» уровня (0.1%) — low/high в этой зоне считаем касанием
TOUCH_TOLERANCE_PERCENT = 0.001
# Сколько минут свечей смотреть для проверки отскока
KLINE_LOOKBACK = 120
# Глубина истории для проверки пробития — как на фронте (ScreenerMiniChart initialLimit=200)
KLINE_CHECK_LIMIT = 200

# === Устаревание уровней ===
# Максимальное расстояние от текущей цены (%) — если цена ушла дальше, уровень удаляется
MAX_DISTANCE_PERCENT = 1.5
# Максимальный возраст уровня (секунды) — старше удаляется
MAX_AGE_SECONDS = 60 * 60  # 60 минут


def _big_orders_from_depth(bids: List[List], asks: List[List], multiplier: int) -> List[Dict[str, Any]]:
    """
    Та же логика что в Tick200Chart: 50 уровней для расчёта средней крупности,
    из них топ-10 по объёму (где объём >= средний * множитель) = стены.
    """
    levels = []

    def parse_levels(raw: List[List], side: str, limit: int = 50) -> List[Dict]:
        out = []
        for row in raw[:limit]:
            price = float(row[0])
            qty = float(row[1])
            volume_usdt = price * qty
            out.append({"price": price, "quantity": qty, "volumeUsdt": volume_usdt, "side": side})
        return out

    bid_levels = parse_levels(bids, "bid")
    ask_levels = parse_levels(asks, "ask")

    # Средний объём по 50 уровням bid и ask
    avg_bid = sum(x["volumeUsdt"] for x in bid_levels) / len(bid_levels) if bid_levels else 0
    avg_ask = sum(x["volumeUsdt"] for x in ask_levels) / len(ask_levels) if ask_levels else 0

    # Кандидаты: объём >= средний * множитель
    bid_candidates = [x for x in bid_levels if avg_bid > 0 and x["volumeUsdt"] >= avg_bid * multiplier]
    ask_candidates = [x for x in ask_levels if avg_ask > 0 and x["volumeUsdt"] >= avg_ask * multiplier]

    # Топ-10 стен: сортируем по объёму, берём 10 крупнейших (bid и ask вместе)
    all_candidates = sorted(
        bid_candidates + ask_candidates,
        key=lambda x: x["volumeUsdt"],
        reverse=True,
    )[:10]

    return all_candidates


# Универсальная функция получения свечей по бирже
async def _fetch_klines(session: aiohttp.ClientSession, symbol: str, exchange: str = "Binance", limit: int = 30) -> List[Dict[str, Any]]:
    """Получить свечи с указанной биржи."""
    if exchange == "Bybit":
        return await _fetch_bybit_klines(session, symbol, limit)
    else:
        return await _fetch_binance_klines(session, symbol, limit)


def _level_bounce_start_time(level: Dict[str, Any], klines: List[Dict[str, Any]]) -> int | None:
    """
    Время (Unix сек) свечи, на которой произошёл отскок от уровня в противоположную сторону.
    
    Логика:
    1. Bid (поддержка, синий): цена падает к уровню, касается его (low <= price + tolerance),
       затем отскакивает ВВЕРХ (high >= price + bounce). Возвращаем время свечи отскока.
    2. Ask (сопротивление, красный): цена растёт к уровню, касается его (high >= price - tolerance),
       затем отскакивает ВНИЗ (low <= price - bounce). Возвращаем время свечи отскока.
    """
    if not klines:
        return None
    price = level["price"]
    side = level["side"]
    
    # Допуск касания (0.1% от уровня)
    touch_threshold = price * TOUCH_TOLERANCE_PERCENT
    # Порог отскока (0.2% от уровня)
    bounce_threshold = price * BOUNCE_PERCENT

    if side == "bid":
        # Bid (поддержка): цена падает к уровню, касается и отскакивает ВВЕРХ
        # 1. Находим касание: low опустился до уровня
        # 2. После касания находим отскок: close выше уровня на 0.2%
        touch_time = None
        for k in klines:
            # Ещё не было касания - ищем его
            if touch_time is None:
                if k["low"] <= price + touch_threshold:
                    touch_time = k["time"]
            # После касания - ищем отскок вверх
            if touch_time is not None:
                if k["close"] >= price + bounce_threshold:
                    return touch_time  # Возвращаем время касания (начало уровня)
        return None
    else:
        # Ask (сопротивление): цена растёт к уровню, касается и отскакивает ВНИЗ
        # 1. Находим касание: high поднялся до уровня
        # 2. После касания находим отскок: close ниже уровня на 0.2%
        touch_time = None
        for k in klines:
            # Ещё не было касания - ищем его
            if touch_time is None:
                if k["high"] >= price - touch_threshold:
                    touch_time = k["time"]
            # После касания - ищем отскок вниз
            if touch_time is not None:
                if k["close"] <= price - bounce_threshold:
                    return touch_time  # Возвращаем время касания (начало уровня)
        return None


def _level_broken_after_bounce(level: Dict[str, Any], klines: List[Dict[str, Any]], bounce_time: int) -> bool:
    """
    Проверяем: после свечи отскока цена пробила уровень?
    
    Bid (поддержка): пробит если low < уровня (цена ушла ниже поддержки)
    Ask (сопротивление): пробит если high > уровня (цена ушла выше сопротивления)
    
    Без допуска — если цена прошла через уровень, он пробит.
    """
    price = level["price"]
    side = level["side"]
    
    for k in klines:
        if k["time"] <= bounce_time:
            continue
        # Bid (поддержка): пробит если low < уровня
        if side == "bid" and k["low"] < price:
            return True
        # Ask (сопротивление): пробит если high > уровня
        if side == "ask" and k["high"] > price:
            return True
    return False


def _check_level_still_valid(level: Dict[str, Any], klines: List[Dict[str, Any]]) -> bool:
    """Проверяем: уровень всё ещё не пробит? Используется для проверки уже показанных уровней."""
    if "startTime" not in level:
        return False
    return not _level_broken_after_bounce(level, klines, level["startTime"])


def _filter_levels_with_bounce(levels: List[Dict[str, Any]], klines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Фильтруем уровни: добавляем startTime.
    
    Упрощённая логика: если уровень есть в стакане — показываем его.
    startTime = время последней свечи (линия начинается от текущего момента).
    """
    if not klines or not levels:
        return []
    
    # Используем время последней свечи как начало уровня
    last_time = klines[-1]["time"] if klines else None
    if not last_time:
        return []
    
    result = []
    for lev in levels:
        # Добавляем startTime = текущее время
        result.append({**lev, "startTime": last_time})
    return result


# Результат скринера: { symbol -> [ { price, volumeUsdt, side, startTime } ] }
_screener_result: Dict[str, List[Dict[str, Any]]] = {}
# Сохранённые уровни — держим их пока не пробиты (даже если ордер ушёл из стакана)
_saved_levels: Dict[str, List[Dict[str, Any]]] = {}  # symbol -> [levels]
_last_multiplier: int = BIG_ORDER_MULTIPLIER


# ========== BINANCE API ==========

async def _fetch_binance_tickers(session: aiohttp.ClientSession) -> List[Tuple[str, float]]:
    """Топ USDT пар Binance по объёму."""
    try:
        async with session.get(f"{BINANCE_API}/ticker/24hr") as resp:
            if resp.status != 200:
                return []
            data = await resp.json()
    except Exception:
        return []
    # Сортируем по quoteVolume
    with_vol = [(p["symbol"], float(p.get("quoteVolume", 0))) for p in data if isinstance(p, dict) and p.get("symbol", "").endswith("USDT")]
    with_vol.sort(key=lambda x: x[1], reverse=True)
    return with_vol[:TOP_SYMBOLS_LIMIT]


async def _fetch_binance_depth(session: aiohttp.ClientSession, symbol: str) -> Dict[str, Any] | None:
    """Стакан Binance."""
    try:
        async with session.get(f"{BINANCE_API}/depth", params={"symbol": symbol, "limit": DEPTH_LIMIT}) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()
    except Exception:
        return None
    bids = data.get("bids") or []
    asks = data.get("asks") or []
    return {"symbol": symbol, "bids": bids, "asks": asks, "exchange": "Binance"}


async def _fetch_binance_klines(session: aiohttp.ClientSession, symbol: str, limit: int = 30) -> List[Dict[str, Any]]:
    """Свечи Binance."""
    try:
        async with session.get(
            f"{BINANCE_API}/klines",
            params={"symbol": symbol, "interval": "1m", "limit": limit},
        ) as resp:
            if resp.status != 200:
                return []
            data = await resp.json()
    except Exception:
        return []
    out = []
    for bar in data:
        if not bar or len(bar) < 5:
            continue
        out.append({
            "time": int(bar[0]) // 1000,
            "open": float(bar[1]),
            "high": float(bar[2]),
            "low": float(bar[3]),
            "close": float(bar[4]),
        })
    return out


# ========== BYBIT API ==========

async def _fetch_bybit_tickers(session: aiohttp.ClientSession) -> List[Tuple[str, float]]:
    """Топ USDT пар Bybit по объёму."""
    try:
        async with session.get(f"{BYBIT_API}/tickers", params={"category": "spot"}) as resp:
            if resp.status != 200:
                return []
            data = await resp.json()
    except Exception:
        return []
    
    result = data.get("result", {})
    tickers = result.get("list", [])
    
    with_vol = []
    for t in tickers:
        symbol = t.get("symbol", "")
        if not symbol.endswith("USDT"):
            continue
        try:
            volume = float(t.get("turnover24h", 0))
            with_vol.append((symbol, volume))
        except (ValueError, TypeError):
            continue
    
    with_vol.sort(key=lambda x: x[1], reverse=True)
    return with_vol[:TOP_SYMBOLS_LIMIT]


async def _fetch_bybit_depth(session: aiohttp.ClientSession, symbol: str) -> Dict[str, Any] | None:
    """Стакан Bybit."""
    try:
        async with session.get(
            f"{BYBIT_API}/orderbook",
            params={"category": "spot", "symbol": symbol, "limit": DEPTH_LIMIT}
        ) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()
    except Exception:
        return None
    
    result = data.get("result", {})
    # Bybit формат: {"b": [["price", "qty"], ...], "a": [["price", "qty"], ...]}
    bids = result.get("b") or []
    asks = result.get("a") or []
    return {"symbol": symbol, "bids": bids, "asks": asks, "exchange": "Bybit"}


async def _fetch_bybit_klines(session: aiohttp.ClientSession, symbol: str, limit: int = 30) -> List[Dict[str, Any]]:
    """Свечи Bybit."""
    try:
        async with session.get(
            f"{BYBIT_API}/kline",
            params={"category": "spot", "symbol": symbol, "interval": "1", "limit": limit}
        ) as resp:
            if resp.status != 200:
                return []
            data = await resp.json()
    except Exception:
        return []
    
    result = data.get("result", {})
    klines = result.get("list", [])
    
    out = []
    # Bybit возвращает в обратном порядке (новые первые)
    for bar in reversed(klines):
        if not bar or len(bar) < 5:
            continue
        # Формат: [startTime, open, high, low, close, volume, turnover]
        out.append({
            "time": int(bar[0]) // 1000,
            "open": float(bar[1]),
            "high": float(bar[2]),
            "low": float(bar[3]),
            "close": float(bar[4]),
        })
    return out


def _get_multiplier() -> int:
    global _last_multiplier
    m = int(os.environ.get("BIG_ORDER_MULTIPLIER", "5"))
    m = max(2, min(50, m))
    _last_multiplier = m
    return m


def _is_level_expired(level: Dict[str, Any], current_price: float, current_time: int) -> bool:
    """
    Проверяем устарел ли уровень (по расстоянию или времени).
    
    Устарел если:
    - Расстояние от текущей цены > MAX_DISTANCE_PERCENT
    - Возраст > MAX_AGE_SECONDS
    """
    price = level["price"]
    start_time = level.get("startTime", 0)
    
    # Проверка по расстоянию
    if current_price > 0:
        distance_percent = abs(current_price - price) / current_price * 100
        if distance_percent > MAX_DISTANCE_PERCENT:
            return True
    
    # Проверка по времени
    if start_time > 0 and current_time > 0:
        age_seconds = current_time - start_time
        if age_seconds > MAX_AGE_SECONDS:
            return True
    
    return False


def _is_level_broken(level: Dict[str, Any], klines: List[Dict[str, Any]]) -> bool:
    """
    Проверяем пробит ли уровень.
    Логика должна совпадать с фронтендом (isLevelBroken): пробитие по low/high.
    Bid (поддержка): пробит если low < уровня
    Ask (сопротивление): пробит если high > уровня
    """
    if not klines:
        return False
    price = level["price"]
    side = level["side"]
    start_time = level.get("startTime", 0)
    
    for k in klines:
        # Проверяем только свечи после появления уровня
        if k["time"] < start_time:
            continue
        # Пробитие по low/high — как на фронте, иначе бэк возвращает уровни которые фронт сразу скрывает
        if side == "bid" and k["low"] < price:
            return True
        if side == "ask" and k["high"] > price:
            return True
    return False


async def _scan_exchange(
    session: aiohttp.ClientSession,
    exchange: str,
    symbols: List[Tuple[str, float]],
    multiplier: int
) -> Dict[str, List[Dict[str, Any]]]:
    """Сканировать одну биржу."""
    result = {}
    
    for i, (symbol, _) in enumerate(symbols):
        # Получаем стакан
        if exchange == "Bybit":
            depth = await _fetch_bybit_depth(session, symbol)
        else:
            depth = await _fetch_binance_depth(session, symbol)
        
        if not depth or not depth.get("bids") or not depth.get("asks"):
            continue
        
        # Получаем свечи для текущего времени
        klines = await _fetch_klines(session, symbol, exchange, limit=30)
        current_time = klines[-1]["time"] if klines else 0
        
        # Ищем крупные ордера
        found = _big_orders_from_depth(depth["bids"], depth["asks"], multiplier)
        if found:
            for lev in found:
                lev["startTime"] = current_time
                lev["exchange"] = exchange  # Добавляем биржу!
            result[symbol] = found
        
        # Rate limit
        if (i + 1) % 20 == 0:
            await asyncio.sleep(0.2)
    
    return result


async def run_one_scan() -> Dict[str, List[Dict[str, Any]]]:
    """
    Один проход: сканируем Binance + Bybit, находим уровни крупных ордеров.
    
    Логика:
    1. Получаем топ пары с обеих бирж
    2. Ищем крупные ордера в стаканах
    3. Проверяем старые уровни — пробиты или устарели?
    4. Объединяем результаты
    """
    global _screener_result, _saved_levels
    multiplier = _get_multiplier()
    result = {}
    # Удаляем стейблкоины из сохранённых уровней
    for sym in list(_saved_levels.keys()):
        if sym in STABLECOIN_BLACKLIST:
            _saved_levels.pop(sym, None)

    async with aiohttp.ClientSession() as session:
        # Получаем топ пары с обеих бирж параллельно
        binance_task = _fetch_binance_tickers(session)
        bybit_task = _fetch_bybit_tickers(session)
        binance_symbols, bybit_symbols = await asyncio.gather(binance_task, bybit_task)
        
        # Добавляем приоритетные пары в Binance
        binance_set = set(s for s, _ in binance_symbols)
        for sym in PRIORITY_SYMBOLS:
            if sym not in binance_set:
                binance_symbols.append((sym, 0))
        
        # Bybit: только пары которых НЕТ на Binance (чтобы не дублировать)
        bybit_symbols = [(s, v) for s, v in bybit_symbols if s not in binance_set]
        
        # Исключаем стейблкоины из сканирования
        binance_symbols = [(s, v) for s, v in binance_symbols if s not in STABLECOIN_BLACKLIST]
        bybit_symbols = [(s, v) for s, v in bybit_symbols if s not in STABLECOIN_BLACKLIST]
        
        print(f"[BigOrdersScreener] Scanning Binance: {len(binance_symbols)}, Bybit: {len(bybit_symbols)} pairs")
        
        # Сканируем обе биржи
        binance_result = await _scan_exchange(session, "Binance", binance_symbols, multiplier)
        bybit_result = await _scan_exchange(session, "Bybit", bybit_symbols, multiplier)
        
        # Объединяем результаты
        new_levels_map = {**binance_result, **bybit_result}
        
        # Обрабатываем сохранённые уровни + новые (без стейблкоинов)
        all_symbols = (set(new_levels_map.keys()) | set(_saved_levels.keys())) - STABLECOIN_BLACKLIST
        
        for symbol in all_symbols:
            new_levels = new_levels_map.get(symbol, [])
            old_levels = _saved_levels.get(symbol, [])
            
            # Определяем биржу из старых или новых уровней
            exchange = "Binance"
            if new_levels:
                exchange = new_levels[0].get("exchange", "Binance")
            elif old_levels:
                exchange = old_levels[0].get("exchange", "Binance")
            
            # Получаем klines для проверки пробития (глубина как на фронте — иначе уровень есть у нас, но фронт его не рисует)
            klines = await _fetch_klines(session, symbol, exchange, limit=KLINE_CHECK_LIMIT)
            current_time = klines[-1]["time"] if klines else 0
            current_price = klines[-1]["close"] if klines else 0
            
            # Фильтруем старые уровни
            valid_old_levels = []
            for lev in old_levels:
                if _is_level_broken(lev, klines):
                    continue
                if _is_level_expired(lev, current_price, current_time):
                    continue
                valid_old_levels.append(lev)
            
            # Объединяем: старые + новые (без дубликатов)
            all_levels = {}
            for lev in valid_old_levels:
                key = (round(lev["price"], 8), lev["side"])
                all_levels[key] = lev
            
            for lev in new_levels:
                key = (round(lev["price"], 8), lev["side"])
                if key not in all_levels:
                    all_levels[key] = lev
                else:
                    all_levels[key]["volumeUsdt"] = lev["volumeUsdt"]
            
            # Отбрасываем уровни, уже пробитые в видимой истории (как на фронте)
            final_levels = [lev for lev in all_levels.values() if not _is_level_broken(lev, klines)]
            
            if final_levels:
                result[symbol] = final_levels
                _saved_levels[symbol] = final_levels
            else:
                _saved_levels.pop(symbol, None)

    _screener_result = result
    binance_count = sum(1 for s, lvls in result.items() if lvls and lvls[0].get("exchange") == "Binance")
    bybit_count = len(result) - binance_count
    print(f"[BigOrdersScreener] Active: {len(result)} (BN:{binance_count}, BB:{bybit_count}), mult={multiplier}x")
    return result


def get_screener_result() -> Dict[str, Any]:
    """Текущий результат для API: multiplier + symbols с уровнями."""
    multiplier = _get_multiplier()
    symbols_payload = [
        {"symbol": symbol, "levels": levels}
        for symbol, levels in _screener_result.items()
        if symbol not in STABLECOIN_BLACKLIST and levels
    ]
    return {
        "multiplier": multiplier,
        "symbols": symbols_payload,
        "count": len(symbols_payload),
    }


async def run_loop() -> None:
    """Фоновый цикл: раз в SCREENER_INTERVAL_SEC обновлять результат."""
    while True:
        try:
            await run_one_scan()
        except Exception as e:
            print(f"[BigOrdersScreener] Scan error: {e}")
        await asyncio.sleep(SCREENER_INTERVAL_SEC)
