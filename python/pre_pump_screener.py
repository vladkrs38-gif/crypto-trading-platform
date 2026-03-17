"""
Pre-Pump Screener — фоновый поиск монет до пампa.
Работает в цикле, результаты через API.
"""

import asyncio
from typing import List, Dict, Any
import aiohttp

BINANCE_API = "https://api.binance.com/api/v3"
SCAN_INTERVAL_SEC = 180  # 3 минуты
TOP_SYMBOLS = 60
BATCH_SIZE = 5
MIN_VOLUME = 500_000
TOP_LIMIT = 20
MIN_SCORE = 20

STABLECOIN_BLACKLIST = frozenset([
    "USDCUSDT", "USDTUSDT", "USDEUSDT", "XUSDUSDT", "USD1USDT",
    "FDUSDUSDT", "TUSDUSDT", "BUSDUSDT", "DAIUSDT", "FRAXUSDT",
    "USDPUSDT", "PYUSDUSDT", "RLUSDUSDT", "BFUSDUSDT", "EURUSDT",
])

_result: Dict[str, Any] = {
    "signals": [],
    "idealSymbols": [],
    "idealCount": 0,
}


def _price_position(high: float, low: float, last: float) -> float:
    if high <= low:
        return 50.0
    return max(0, min(100, ((last - low) / (high - low)) * 100))


def _calc_score(
    vol_ratio: float,
    price_pos: float,
    taker_buy: float,
    chg: float,
    corr: float,
) -> int:
    score = 0
    if vol_ratio >= 2:
        score += 25
    elif vol_ratio >= 1.5:
        score += 18
    elif vol_ratio >= 1.2:
        score += 10

    if 20 <= price_pos <= 70:
        score += 20
    elif 15 <= price_pos <= 80:
        score += 10

    if taker_buy >= 60:
        score += 20
    elif taker_buy >= 55:
        score += 12

    if 0 <= chg <= 5:
        score += 15
    elif 0 <= chg <= 8:
        score += 8

    abs_corr = abs(corr)
    if abs_corr < 0.4:
        score += 20
    elif abs_corr < 0.5:
        score += 10

    return min(100, score)


def _is_ideal(
    score: int,
    vol_ratio: float,
    taker_buy: float,
    chg: float,
) -> bool:
    return (
        score >= 60
        and vol_ratio >= 1.5
        and taker_buy >= 55
        and 0 <= chg <= 5
    )


def _pearson(x: List[float], y: List[float]) -> float:
    n = len(x)
    if n != len(y) or n < 2:
        return 0.0
    sx = sum(x)
    sy = sum(y)
    sxy = sum(xi * yi for xi, yi in zip(x, y))
    sx2 = sum(xi * xi for xi in x)
    sy2 = sum(yi * yi for yi in y)
    num = n * sxy - sx * sy
    den = ((n * sx2 - sx * sx) * (n * sy2 - sy * sy)) ** 0.5
    if den == 0:
        return 0.0
    return max(-1, min(1, num / den))


async def _get_klines(session: aiohttp.ClientSession, symbol: str, interval: str, limit: int) -> List[list]:
    try:
        async with session.get(
            f"{BINANCE_API}/klines",
            params={"symbol": symbol, "interval": interval, "limit": limit},
        ) as resp:
            if resp.status != 200:
                return []
            return await resp.json()
    except Exception:
        return []


async def _get_volume_ratio(session: aiohttp.ClientSession, symbol: str) -> float:
    klines = await _get_klines(session, symbol, "1d", 8)
    if len(klines) < 7:
        return 1.0
    last_qv = float(klines[-1][7] or 0)
    prev = [float(k[7] or 0) for k in klines[:-1]]
    avg = sum(prev) / len(prev)
    return last_qv / avg if avg > 0 else 1.0


async def _get_taker_buy(session: aiohttp.ClientSession, symbol: str) -> float:
    klines = await _get_klines(session, symbol, "1h", 24)
    if not klines:
        return 50.0
    total_q = 0.0
    total_tb = 0.0
    for k in klines:
        total_q += float(k[7] or 0)
        total_tb += float(k[10] or 0)
    return (total_tb / total_q * 100) if total_q > 0 else 50.0


async def _get_correlation(session: aiohttp.ClientSession, symbol: str, btc_returns: List[float]) -> float:
    klines = await _get_klines(session, symbol, "1h", 25)
    if len(klines) < 24 or len(btc_returns) < 2:
        return 0.0
    closes = [float(k[4]) for k in klines]
    pair_returns = []
    for i in range(1, len(closes)):
        if closes[i - 1] > 0:
            pair_returns.append((closes[i] - closes[i - 1]) / closes[i - 1])
    n = min(len(btc_returns), len(pair_returns))
    if n < 2:
        return 0.0
    return _pearson(btc_returns[-n:], pair_returns[-n:])


async def _run_one_scan() -> None:
    global _result
    async with aiohttp.ClientSession() as session:
        # Tickers
        async with session.get(f"{BINANCE_API}/ticker/24hr") as resp:
            if resp.status != 200:
                return
            data = await resp.json()

        tickers = []
        for t in data:
            sym = t.get("symbol", "")
            if not sym.endswith("USDT") or sym == "BTCUSDT" or sym in STABLECOIN_BLACKLIST:
                continue
            qv = float(t.get("quoteVolume", 0))
            if qv < MIN_VOLUME:
                continue
            tickers.append({
                "symbol": sym,
                "lastPrice": float(t.get("lastPrice", t.get("price", 0))),
                "priceChangePercent": float(t.get("priceChangePercent", 0)),
                "highPrice": float(t.get("highPrice", 0)),
                "lowPrice": float(t.get("lowPrice", 0)),
                "quoteVolume": qv,
            })
        tickers.sort(key=lambda x: x["quoteVolume"], reverse=True)
        tickers = tickers[:TOP_SYMBOLS]

        # BTC returns for correlation
        btc_klines = await _get_klines(session, "BTCUSDT", "1h", 25)
        btc_returns = []
        if len(btc_klines) >= 24:
            closes = [float(k[4]) for k in btc_klines]
            for i in range(1, len(closes)):
                if closes[i - 1] > 0:
                    btc_returns.append((closes[i] - closes[i - 1]) / closes[i - 1])

        signals = []
        for i in range(0, len(tickers), BATCH_SIZE):
            batch = tickers[i : i + BATCH_SIZE]
            for t in batch:
                vol_ratio = await _get_volume_ratio(session, t["symbol"])
                taker_buy = await _get_taker_buy(session, t["symbol"])
                corr = await _get_correlation(session, t["symbol"], btc_returns)
                price_pos = _price_position(
                    t["highPrice"], t["lowPrice"], t["lastPrice"]
                )
                score = _calc_score(
                    vol_ratio, price_pos, taker_buy,
                    t["priceChangePercent"], corr
                )
                if score < MIN_SCORE:
                    continue
                sig = {
                    "symbol": t["symbol"],
                    "exchange": "Binance",
                    "score": score,
                    "volumeRatio": round(vol_ratio, 2),
                    "pricePosition": round(price_pos, 1),
                    "takerBuyPercent": round(taker_buy, 1),
                    "priceChangePercent": round(t["priceChangePercent"], 2),
                    "correlation": round(corr, 2),
                    "quoteVolume": t["quoteVolume"],
                }
                signals.append(sig)
            if i + BATCH_SIZE < len(tickers):
                await asyncio.sleep(0.2)

        signals.sort(key=lambda x: x["score"], reverse=True)
        signals = signals[:TOP_LIMIT]

        ideal = [
            s["symbol"]
            for s in signals
            if _is_ideal(
                s["score"],
                s["volumeRatio"],
                s["takerBuyPercent"],
                s["priceChangePercent"],
            )
        ]

        _result = {
            "signals": signals,
            "idealSymbols": ideal,
            "idealCount": len(ideal),
        }
        if ideal:
            print(f"[PrePump] Ideal: {ideal}")


async def run_loop() -> None:
    while True:
        try:
            await _run_one_scan()
        except Exception as e:
            print(f"[PrePump] Scan error: {e}")
        await asyncio.sleep(SCAN_INTERVAL_SEC)


def get_pre_pump_result() -> Dict[str, Any]:
    return {
        "signals": _result["signals"],
        "idealSymbols": _result["idealSymbols"],
        "idealCount": _result["idealCount"],
    }
