"""
FastAPI сервер для предоставления данных о плотностях фронтенду
"""

import asyncio
import subprocess
import sys
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Optional

# ML-пайплайн требует sklearn (xgboost/pandas). Устанавливаем при старте, если нет.
try:
    import sklearn  # noqa: F401
except ImportError:
    print("[API] scikit-learn not found, installing...")
    subprocess.run([sys.executable, "-m", "pip", "install", "scikit-learn", "-q"], check=False)
    try:
        import sklearn  # noqa: F401
        print("[API] scikit-learn installed.")
    except ImportError:
        raise ImportError(
            "sklearn is required for ML. Run: " + sys.executable + " -m pip install scikit-learn"
        )

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

from config import (
    API_HOST,
    API_PORT,
    MIN_LIFETIME_SECONDS,
    GEMINI_API_KEY,
    VPN_ADMIN_TOKEN,
    VPN_PUBLIC_HOST,
    VPN_VLESS_PORT,
    CLEANUP_DAYS,
    CLEANUP_INTERVAL_SECONDS,
)
from big_orders_screener import run_loop as screener_run_loop, get_screener_result
from pre_pump_screener import run_loop as pre_pump_run_loop, get_pre_pump_result
from database import (
    init_database, get_active_densities, get_density_by_id,
    get_touches_for_density, get_stats, cleanup_old_inactive
)
from tracker import tracker
from telegram_notifier import notifier
from pydantic import BaseModel
from lab_history import (
    get_history_status,
    start_download_background,
    get_download_status,
    run_optimization,
    get_equity_and_drawdown_curves,
    get_optimization_progress,
    clear_optimization_progress,
    get_ml_model_status,
)
import uuid
import os
import json
from pathlib import Path
from typing import Any, Dict


def _require_admin(request: Request) -> Optional[JSONResponse]:
    """Simple token auth for VPN admin endpoints."""
    if not VPN_ADMIN_TOKEN:
        return JSONResponse(status_code=503, content={"error": "VPN_ADMIN_TOKEN is not set on server"})
    token = request.headers.get("X-Admin-Token", "")
    if token != VPN_ADMIN_TOKEN:
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    return None


VPN_USERS_PATH = Path(__file__).resolve().parent / "vpn_users.json"


def _load_vpn_users() -> List[Dict[str, Any]]:
    if not VPN_USERS_PATH.exists():
        return []
    try:
        return json.loads(VPN_USERS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_vpn_users(users: List[Dict[str, Any]]) -> None:
    VPN_USERS_PATH.write_text(json.dumps(users, ensure_ascii=False, indent=2), encoding="utf-8")


def _build_vless_uri(user_uuid: str, name: str) -> str:
    # Values must match current /usr/local/etc/xray/config.json Reality settings.
    sni = "www.microsoft.com"
    fp = "chrome"
    pbk = "vyQyVS_Pp1eZk6dxvqunsqp_Hi10Y8F82QqMdQXSzkM"
    sid = "7b0a1c2f0a1c2f0a"
    tag = name.strip().replace(" ", "_")[:32] or "user"
    from urllib.parse import urlencode, quote
    params = {
        "type": "tcp",
        "security": "reality",
        "flow": "xtls-rprx-vision",
        "sni": sni,
        "fp": fp,
        "pbk": pbk,
        "sid": sid,
    }
    return f"vless://{user_uuid}@{VPN_PUBLIC_HOST}:{VPN_VLESS_PORT}?{urlencode(params)}#{quote(tag)}"


def _apply_xray_users(users: List[Dict[str, Any]]) -> Optional[str]:
    """
    Writes clients list into /usr/local/etc/xray/config.json and restarts xray.
    Preserves stats/api/policy/routing sections. Returns error string if failed.
    """
    cfg_path = Path("/usr/local/etc/xray/config.json")
    try:
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    except Exception as e:
        return f"Failed to read xray config: {e}"

    try:
        inbound = None
        for ib in cfg.get("inbounds", []):
            if ib.get("protocol") == "vless":
                inbound = ib
                break
        if not inbound:
            inbound = cfg["inbounds"][0]

        clients = []
        for u in users:
            if not u.get("enabled", True):
                continue
            clients.append(
                {
                    "id": u["uuid"],
                    "flow": "xtls-rprx-vision",
                    "email": u.get("name", u["id"]),
                    "level": 0,
                }
            )
        inbound.setdefault("settings", {})["clients"] = clients

        cfg.setdefault("log", {})
        cfg["log"]["loglevel"] = cfg["log"].get("loglevel", "warning")
        cfg["log"]["access"] = "/var/log/xray/access.log"
        cfg["log"]["error"] = "/var/log/xray/error.log"

        cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        return f"Failed to update xray config: {e}"

    import subprocess
    try:
        subprocess.run(["systemctl", "restart", "xray"], check=True)
    except Exception as e:
        return f"Failed to restart xray: {e}"
    return None


def _query_xray_traffic() -> Dict[str, Dict[str, int]]:
    """
    Query Xray gRPC Stats API for per-user traffic (uplink/downlink bytes).
    Returns {email: {"uplink": bytes, "downlink": bytes}}.
    """
    import subprocess
    result: Dict[str, Dict[str, int]] = {}
    try:
        proc = subprocess.run(
            ["xray", "api", "statsquery", "--server=127.0.0.1:10085"],
            capture_output=True, text=True, timeout=5,
        )
        if proc.returncode != 0:
            return result
        data = json.loads(proc.stdout) if proc.stdout.strip() else {}
        for item in data.get("stat", []):
            name = item.get("name", "")
            value = int(item.get("value", 0))
            # Format: user>>>email>>>traffic>>>uplink/downlink
            if name.startswith("user>>>"):
                parts = name.split(">>>")
                if len(parts) == 4:
                    email = parts[1]
                    direction = parts[3]  # "uplink" or "downlink"
                    entry = result.setdefault(email, {"uplink": 0, "downlink": 0})
                    entry[direction] = value
    except Exception:
        pass
    return result


def _parse_xray_access_log(max_lines: int = 5000) -> Dict[str, Any]:
    """
    Best-effort stats from /var/log/xray/access.log.
    Returns mapping keyed by email/name with last_seen and last_ip and conn_count.
    """
    p = Path("/var/log/xray/access.log")
    if not p.exists():
        return {}
    try:
        data = p.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception:
        return {}
    lines = data[-max_lines:]
    stats: Dict[str, Dict[str, Any]] = {}
    import re
    for ln in lines:
        # Xray log: "2026/03/16 15:05:25 from 82.146.16.131:7317 accepted tcp:domain:443 [warp] email: Vlad"
        key = None
        if "email:" in ln:
            key = ln.split("email:", 1)[1].strip().split()[0]
        if not key:
            continue
        s = stats.setdefault(key, {"connCount": 0, "lastSeen": None, "lastIp": None})
        s["connCount"] += 1
        s["lastSeen"] = ln[:19].strip()
        m = re.search(r"from (\d+\.\d+\.\d+\.\d+):\d+", ln)
        if m:
            s["lastIp"] = m.group(1)
    return stats


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Запуск при старте, остановка при выключении"""
    init_database()
    asyncio.create_task(tracker.start())
    asyncio.create_task(screener_run_loop())
    asyncio.create_task(pre_pump_run_loop())
    asyncio.create_task(_cleanup_loop())
    print(f"[API] Server started on http://{API_HOST}:{API_PORT}")
    yield
    await tracker.stop()


async def _cleanup_loop():
    """Periodic DB cleanup to prevent densities.db growing without bound."""
    # Small delay to avoid competing with startup I/O
    await asyncio.sleep(30)
    while True:
        try:
            cleanup_old_inactive(days=CLEANUP_DAYS)
            print(f"[API] Cleanup completed: days={CLEANUP_DAYS}")
        except Exception as e:
            print(f"[API] Cleanup error: {type(e).__name__}: {e}")
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)


app = FastAPI(
    title="Density Tracker API",
    description="API для получения данных о плотностях в стаканах",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS для работы с фронтендом
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Проверка работоспособности"""
    return {
        "status": "ok",
        "service": "Density Tracker API",
        "timestamp": datetime.utcnow().isoformat()
    }


@app.get("/api/densities")
async def get_densities(
    min_lifetime: int = Query(default=MIN_LIFETIME_SECONDS, description="Минимальное время жизни в секундах"),
    symbol: Optional[str] = Query(default=None, description="Фильтр по символу"),
    exchange: Optional[str] = Query(default=None, description="Фильтр по бирже"),
    density_type: Optional[str] = Query(default=None, description="Фильтр по типу (buy/sell)"),
    min_amount: float = Query(default=0, description="Минимальная сумма в USD"),
    max_distance: float = Query(default=10, description="Максимальная дистанция в %"),
    limit: int = Query(default=100, description="Максимальное количество")
):
    """
    Получить список активных плотностей.
    
    Возвращает только плотности, которые:
    - Активны (ещё в стакане)
    - Прожили минимум min_lifetime секунд
    """
    densities = get_active_densities(min_lifetime)
    
    # Дополняем данные
    result = []
    for d in densities:
        # Вычисляем текущую цену и дистанцию
        current_price = tracker.current_prices.get(d['symbol'], 0)
        
        if current_price > 0:
            if d['type'] == 'buy':
                distance_percent = (current_price - d['price']) / current_price * 100
            else:
                distance_percent = (d['price'] - current_price) / current_price * 100
        else:
            distance_percent = 0
        
        # Время разъедания
        dissolution_time = 0
        if d['avgVolumePerMin'] > 0:
            dissolution_time = d['amountUSD'] / d['avgVolumePerMin']
        
        # Время жизни в минутах
        lifetime_minutes = d['lifetimeSeconds'] / 60
        
        # Получаем 24h объём монеты из данных трекера
        coin_key = f"{d['exchange']}:{d['symbol']}"
        coin_data = tracker.coins.get(coin_key, {})
        volume_24h = coin_data.get('volume24h', 0)
        
        density_data = {
            'id': d['id'],
            'symbol': d['symbol'],
            'exchange': d['exchange'],
            'type': d['type'],
            'price': d['price'],
            'currentPrice': current_price,
            'distancePercent': abs(distance_percent),
            'amountUSD': d['amountUSD'],
            'amountCoins': d['amountCoins'],
            'dissolutionTime': dissolution_time,
            'lifeTime': d['lifetimeSeconds'],
            'lifeTimeMinutes': lifetime_minutes,
            'avgVolumePerMin': d['avgVolumePerMin'],
            'touchCount': d['touchCount'],
            'firstSeenAt': d['firstSeenAt'],
            'createdAt': datetime.fromisoformat(d['firstSeenAt']).timestamp() * 1000,
            'volume24h': volume_24h,  # 24h объём монеты для фильтрации
        }
        
        # Применяем фильтры
        if symbol and d['symbol'] != symbol.upper():
            continue
        if exchange and d['exchange'] != exchange.lower():
            continue
        if density_type and d['type'] != density_type.lower():
            continue
        if d['amountUSD'] < min_amount:
            continue
        if abs(distance_percent) > max_distance:
            continue
        
        result.append(density_data)
    
    # Сортируем по времени разъедания (самые значимые сверху)
    result.sort(key=lambda x: x['dissolutionTime'], reverse=True)
    
    return {
        'densities': result[:limit],
        'total': len(result),
        'trackedCoins': len(tracker.coins),
        'timestamp': datetime.utcnow().isoformat()
    }


@app.get("/api/densities/{density_id}")
async def get_density(density_id: str):
    """Получить детальную информацию о плотности"""
    density = get_density_by_id(density_id)
    
    if not density:
        return {"error": "Density not found"}
    
    touches = get_touches_for_density(density_id)
    
    return {
        'density': density,
        'touches': touches
    }


@app.get("/api/stats")
async def get_tracker_stats():
    """Получить статистику трекера"""
    db_stats = get_stats()
    
    return {
        **db_stats,
        'trackedCoins': len(tracker.coins),
        'isRunning': tracker.running,
        'timestamp': datetime.utcnow().isoformat()
    }


@app.get("/api/coins")
async def get_tracked_coins():
    """Получить список отслеживаемых монет"""
    return {
        'coins': list(tracker.coins.values()),
        'total': len(tracker.coins)
    }


@app.post("/api/cleanup")
async def cleanup():
    """Очистить старые неактивные плотности"""
    cleanup_old_inactive(days=7)
    return {"status": "ok", "message": "Cleanup completed"}


# ===== Сканер выпечки X5: прокси к Gemini (ключ только на сервере) =====

X5_PROMPT = """
Проанализируй таблицу (PLU, ПЛАН, ПРОДАЖИ).
Извлеки данные строк.
Если название не указано, напиши "Выпечка PLU".
Верни ТОЛЬКО JSON: [{"plu":"строка", "name":"строка", "plan":число, "sales":число}]
"""

# Пробуем по очереди — у разных ключей/регионов доступны разные модели
GEMINI_X5_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-1.5-flash-8b"]


class X5AnalyzeRequest(BaseModel):
    imageBase64: str


class VpnUserCreateRequest(BaseModel):
    name: str


@app.get("/api/vpn/users")
async def vpn_list_users(request: Request):
    auth = _require_admin(request)
    if auth:
        return auth
    users = _load_vpn_users()
    for u in users:
        u["vless"] = _build_vless_uri(u["uuid"], u.get("name", u["id"]))
    return {"users": users}


@app.post("/api/vpn/users")
async def vpn_create_user(body: VpnUserCreateRequest, request: Request):
    auth = _require_admin(request)
    if auth:
        return auth
    name = (body.name or "").strip()
    if not name:
        return JSONResponse(status_code=400, content={"error": "name is required"})
    users = _load_vpn_users()
    user_id = str(uuid.uuid4())
    user_uuid = str(uuid.uuid4())
    u = {
        "id": user_id,
        "name": name,
        "uuid": user_uuid,
        "enabled": True,
        "createdAt": datetime.utcnow().isoformat(),
    }
    users.append(u)
    _save_vpn_users(users)

    err = _apply_xray_users(users)
    if err:
        return JSONResponse(status_code=500, content={"error": err})
    u["vless"] = _build_vless_uri(user_uuid, name)
    return {"user": u}


@app.post("/api/vpn/users/{user_id}/toggle")
async def vpn_toggle_user(user_id: str, request: Request):
    auth = _require_admin(request)
    if auth:
        return auth
    users = _load_vpn_users()
    found = None
    for u in users:
        if u.get("id") == user_id:
            u["enabled"] = not bool(u.get("enabled", True))
            found = u
            break
    if not found:
        return JSONResponse(status_code=404, content={"error": "not found"})
    _save_vpn_users(users)
    err = _apply_xray_users(users)
    if err:
        return JSONResponse(status_code=500, content={"error": err})
    found["vless"] = _build_vless_uri(found["uuid"], found.get("name", found["id"]))
    return {"user": found}


@app.delete("/api/vpn/users/{user_id}")
async def vpn_delete_user(user_id: str, request: Request):
    auth = _require_admin(request)
    if auth:
        return auth
    users = _load_vpn_users()
    new_users = [u for u in users if u.get("id") != user_id]
    if len(new_users) == len(users):
        return JSONResponse(status_code=404, content={"error": "not found"})
    _save_vpn_users(new_users)
    err = _apply_xray_users(new_users)
    if err:
        return JSONResponse(status_code=500, content={"error": err})
    return {"status": "ok"}


@app.get("/api/vpn/stats")
async def vpn_stats(request: Request):
    auth = _require_admin(request)
    if auth:
        return auth
    users = _load_vpn_users()
    s = _parse_xray_access_log()
    traffic = _query_xray_traffic()
    out = []
    for u in users:
        name = u.get("name", u["id"])
        vless = _build_vless_uri(u["uuid"], name)
        t = traffic.get(name, {})
        out.append(
            {
                "id": u["id"],
                "name": name,
                "uuid": u["uuid"],
                "enabled": bool(u.get("enabled", True)),
                "createdAt": u.get("createdAt"),
                "vless": vless,
                "connCount": s.get(name, {}).get("connCount", 0),
                "lastSeen": s.get(name, {}).get("lastSeen"),
                "lastIp": s.get(name, {}).get("lastIp"),
                "trafficUp": t.get("uplink", 0),
                "trafficDown": t.get("downlink", 0),
            }
        )
    return {"users": out}


@app.get("/api/vpn/net")
async def vpn_net(request: Request):
    auth = _require_admin(request)
    if auth:
        return auth
    # Read cumulative counters from /proc/net/dev (Linux)
    try:
        with open("/proc/net/dev", "r", encoding="utf-8", errors="ignore") as f:
            lines = f.read().splitlines()
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"Failed to read /proc/net/dev: {e}"})

    ifaces = {}
    for ln in lines[2:]:
        if ":" not in ln:
            continue
        name, rest = ln.split(":", 1)
        name = name.strip()
        cols = rest.split()
        if len(cols) < 16:
            continue
        rx_bytes = int(cols[0])
        tx_bytes = int(cols[8])
        if name == "lo":
            continue
        ifaces[name] = {"rxBytes": rx_bytes, "txBytes": tx_bytes}

    return {"ts": datetime.utcnow().isoformat(), "ifaces": ifaces}


@app.post("/api/x5/analyze")
async def x5_analyze(body: X5AnalyzeRequest):
    """
    Прокси к Google Gemini для распознавания таблицы выпечки.
    Ключ берётся из переменной окружения GEMINI_API_KEY на сервере.
    """
    if not GEMINI_API_KEY:
        return JSONResponse(
            status_code=503,
            content={"error": "GEMINI_API_KEY не задан на сервере. Добавьте в .env.production или переменные окружения."}
        )
    import aiohttp
    base64_clean = (body.imageBase64 or "").strip().replace("\n", "").replace("\r", "")
    if not base64_clean:
        return JSONResponse(status_code=400, content={"error": "Пустое изображение"})

    payload = {
        "contents": [{
            "parts": [
                {"inlineData": {"mimeType": "image/jpeg", "data": base64_clean}},
                {"text": X5_PROMPT}
            ]
        }],
        "generationConfig": {"responseMimeType": "application/json"}
    }

    last_status = None
    last_details = None
    # v1 и v1beta — у разных ключей доступны разные версии
    for api_version in ("v1beta", "v1"):
        for model in GEMINI_X5_MODELS:
            url = f"https://generativelanguage.googleapis.com/{api_version}/models/{model}:generateContent?key={GEMINI_API_KEY}"
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.post(url, json=payload) as resp:
                        last_status = resp.status
                        raw = await resp.text()
                        last_details = raw
                        if resp.status == 200:
                            import json
                            data = json.loads(raw)
                            try:
                                text = data["candidates"][0]["content"]["parts"][0]["text"]
                                return {"data": text}
                            except (KeyError, IndexError):
                                return JSONResponse(status_code=502, content={"error": "Неверный ответ Gemini", "details": raw[:500]})
            except Exception as e:
                last_details = str(e)
    return JSONResponse(
        status_code=502,
        content={"error": f"Gemini API error: {last_status or 'connection'}", "details": last_details or ""}
    )


# ===== Telegram API =====

class TelegramSettingsRequest(BaseModel):
    enabled: bool
    botToken: str
    chatId: str
    alertDistancePercent: float = 0.5
    cooldownMinutes: int = 5


@app.get("/api/telegram/settings")
async def get_telegram_settings():
    """Получить текущие настройки Telegram"""
    return notifier.get_settings()


@app.post("/api/telegram/settings")
async def update_telegram_settings(settings: TelegramSettingsRequest):
    """Обновить настройки Telegram"""
    notifier.configure(
        enabled=settings.enabled,
        bot_token=settings.botToken,
        chat_id=settings.chatId,
        alert_distance=settings.alertDistancePercent,
        cooldown=settings.cooldownMinutes
    )
    
    return {
        "status": "ok",
        "message": "Настройки сохранены",
        "settings": notifier.get_settings()
    }


@app.post("/api/telegram/test")
async def test_telegram():
    """Отправить тестовое сообщение в Telegram"""
    result = await notifier.send_test_message()
    return result


# ===== Pre-Pump скринер =====


@app.get("/api/screener/pre-pump")
async def get_pre_pump():
    """Список Pre-Pump сигналов, идеальные подсвечены (idealSymbols, idealCount)."""
    return get_pre_pump_result()


# ===== Скринер крупных ордеров (уровни как на 20-тиковом) =====


@app.get("/api/screener/big-orders")
async def get_screener_big_orders():
    """
    Список монет Binance, у которых в стакане есть «крупные ордера» (объём >= средний * множитель).
    Множитель задаётся в .bat: set BIG_ORDER_MULTIPLIER=5
    """
    return get_screener_result()


# ===== Lab: история для бэктеста =====


@app.get("/api/lab/history-status")
async def lab_history_status(
    symbol: str = Query(..., description="Пара, например BTCUSDT"),
    timeframe: str = Query(..., description="Таймфрейм: 1, 3, 5, 15, 30, 60, 120, 240, 360, 480, 720, D, W, M"),
    exchange: str = Query(default="binance", description="Биржа"),
):
    """Проверить наличие локальной истории для пары и таймфрейма."""
    return get_history_status(exchange, symbol, timeframe)


class LabDownloadRequest(BaseModel):
    symbol: str
    timeframe: str
    exchange: str = "binance"


@app.post("/api/lab/download-history")
async def lab_download_history(body: LabDownloadRequest):
    """Запустить фоновую загрузку истории с Binance. Возвращает id задачи."""
    start_download_background(body.exchange, body.symbol, body.timeframe)
    return {"status": "started", "symbol": body.symbol, "timeframe": body.timeframe}


@app.get("/api/lab/download-status")
async def lab_download_status(
    symbol: str = Query(...),
    timeframe: str = Query(...),
    exchange: str = Query(default="binance"),
):
    """Статус фоновой загрузки истории: running, result."""
    return get_download_status(exchange, symbol, timeframe)


@app.get("/api/lab/history-candles")
async def lab_history_candles(
    symbol: str = Query(..., description="Пара, например BTCUSDT"),
    timeframe: str = Query(..., description="Таймфрейм: 1, 3, 5, 15, 30, 60, 120, 240, 360, 480, 720, D, W, M"),
    exchange: str = Query(default="binance", description="Биржа"),
    limit: int = Query(default=50000, ge=100, le=150000, description="Макс. свечей для отображения на графике"),
):
    """
    Свечи из локальной истории для отображения на графике (совпадают с данными симуляции ML).
    Формат: [{ time, open, high, low, close, volume }, ...], time в секундах.
    """
    from lab_history import load_candles_from_history
    candles = load_candles_from_history(exchange, symbol, timeframe)
    if not candles or len(candles) < 100:
        return {"candles": [], "error": "История не загружена или пуста"}
    if len(candles) > limit:
        candles = candles[-limit:]
    # Конвертация [t, o, h, l, c, v] -> { time, open, high, low, close, volume }
    result = [
        {"time": int(c[0]), "open": float(c[1]), "high": float(c[2]), "low": float(c[3]), "close": float(c[4]), "volume": float(c[5])}
        for c in candles
    ]
    return {"candles": result}


class LabOptimizeRequest(BaseModel):
    symbol: str
    timeframe: str
    exchange: str = "binance"
    startLotUsd: float = 10
    dropLengthMinutes: float = 10
    commissionPct: float = 0.04
    initialEquity: float = 100
    retrospective: int = 100
    obiFilterEnabled: bool = True
    obiThreshold: float = 0.5
    slippagePct: float = 0.01
    historyDays: Optional[int] = None  # None или 0 = вся история, иначе количество дней
    fastMode: bool = False  # Быстрый режим оптимизации с уменьшенным набором параметров
    sigmaRange: Optional[dict] = None  # {"min": float, "max": float, "step": float}
    alphaRange: Optional[dict] = None  # {"min": float, "max": float, "step": float}
    lengthRange: Optional[dict] = None  # {"min": int, "max": int, "step": int}
    gridLegsRange: Optional[dict] = None  # {"min": int, "max": int, "step": int}
    gridStepRange: Optional[dict] = None  # {"min": float, "max": float, "step": float}


@app.post("/api/lab/optimize")
async def lab_optimize(body: LabOptimizeRequest):
    """Оптимизация по выкачанной истории: грид scannerSigma/takeAlpha/grid/martin, топ-5 сетапов."""
    print(f"[API] /api/lab/optimize called: symbol={body.symbol}, timeframe={body.timeframe}, exchange={body.exchange}")
    optimization_id = str(uuid.uuid4())
    base = {
        "startLotUsd": body.startLotUsd,
        "dropLengthMinutes": body.dropLengthMinutes,
        "commissionPct": body.commissionPct,
        "initialEquity": body.initialEquity,
        "retrospective": body.retrospective,
        "obiFilterEnabled": body.obiFilterEnabled,
        "obiThreshold": body.obiThreshold,
        "slippagePct": body.slippagePct,
    }
    # historyDays: None или 0 = вся история, иначе количество дней
    history_days = None if body.historyDays is None or body.historyDays <= 0 else body.historyDays
    
    # Диапазоны для перебора (если не указаны, используются дефолтные значения)
    sigma_range = body.sigmaRange if body.sigmaRange else {"min": 2, "max": 5, "step": 0.5}
    alpha_range = body.alphaRange if body.alphaRange else {"min": 1, "max": 10, "step": 1}
    length_range = body.lengthRange if body.lengthRange else None
    grid_legs_range = body.gridLegsRange if body.gridLegsRange else None
    grid_step_range = body.gridStepRange if body.gridStepRange else None
    
    print(f"[API] Optimization params: history_days={history_days}, sigma_range={sigma_range}, alpha_range={alpha_range}")
    
    
    def _do_optimization():
        return run_optimization(
            body.exchange, 
            body.symbol, 
            body.timeframe, 
            base, 
            top_n=None,
            optimization_id=optimization_id,
            history_days=history_days,
            fast_mode=body.fastMode,
            sigma_range=sigma_range,
            alpha_range=alpha_range,
            length_range=length_range,
            grid_legs_range=grid_legs_range,
            grid_step_range=body.gridStepRange if body.gridStepRange else None,
        )
    
    try:
        # Запускаем в отдельном потоке, чтобы не блокировать event loop.
        # Это позволяет progress-endpoint отвечать во время оптимизации.
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(None, _do_optimization)
        print(f"[API] Optimization completed: {len(results) if results else 0} results")
        return {"results": results if results else [], "optimizationId": optimization_id}
    except Exception as e:
        print(f"[API] Optimization error: {type(e).__name__}: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"results": [], "optimizationId": optimization_id, "error": str(e)}
    finally:
        async def cleanup():
            await asyncio.sleep(300)
            clear_optimization_progress(optimization_id)
        asyncio.create_task(cleanup())


@app.get("/api/lab/optimize-progress")
async def lab_optimize_progress(optimization_id: str = Query(...)):
    """Получить прогресс оптимизации по ID."""
    progress = get_optimization_progress(optimization_id)
    if progress is None:
        return {"status": "not_found", "current": 0, "total": 0}
    return progress


class LabEquityCurveRequest(BaseModel):
    symbol: str
    timeframe: str
    exchange: str = "binance"
    # Сканер
    startLotUsd: float = 10
    scannerSigma: float = 2
    dropLengthMinutes: float = 10
    retrospective: int = 100
    # OBI
    obiFilterEnabled: bool = True
    obiThreshold: float = 0.5
    # Сетка / Мартингейл
    gridLegs: int = 0
    gridStepPct: float = 1.0
    gridStepMode: str = "fixed"
    atrPeriod: int = 14
    martinMultiplier: float = 1.0
    # Тейк
    takeAlpha: Optional[float] = None
    takeProfitPct: float = 0.003
    breakEvenAfterLegs: int = 0
    # Риск
    maxLossPct: float = 3  # Макс. убыток в % от equity
    # Исполнение
    commissionPct: float = 0.04
    slippagePct: float = 0.01
    # Мета
    initialEquity: float = 100
    allowShort: bool = True  # Разрешить шорты по сигналу Z >= +S (Apex Logic)
    # Авто-улучшения (из пресетов)
    trendFilterEnabled: bool = True
    emaPeriod: int = 50
    cooldownBars: int = 5
    dynamicAlphaEnabled: bool = True
    exposureCapBoth: bool = True
    atrRegimeFilterEnabled: bool = True
    atrRegimeMin: float = 0.5
    atrRegimeMax: float = 2.0
    localExtremumBars: int = 2
    trendFilterMarginPct: float = 0.05
    minRRatio: float = 1.15
    # ML-фильтр входа (опционально)
    mlFilterEnabled: bool = False
    mlModelPath: Optional[str] = None
    mlLongThreshold: float = 0.55
    mlShortThreshold: float = 0.55


@app.post("/api/lab/equity-curve")
async def lab_equity_curve(body: LabEquityCurveRequest):
    """Кривые эквити и просадки по всей выкачанной истории для текущих параметров бота. Расчёт в пуле потоков, таймаут до 15 мин."""
    print(f"[API] Equity curve request: {body.symbol} {body.timeframe}, params: takeAlpha={body.takeAlpha}, maxLossPct={body.maxLossPct}, gridLegs={body.gridLegs}, initialEquity={body.initialEquity}")
    params = {
        "startLotUsd": body.startLotUsd,
        "scannerSigma": body.scannerSigma,
        "dropLengthMinutes": body.dropLengthMinutes,
        "retrospective": body.retrospective,
        "obiFilterEnabled": body.obiFilterEnabled,
        "obiThreshold": body.obiThreshold,
        "gridLegs": body.gridLegs,
        "gridStepPct": body.gridStepPct,
        "gridStepMode": body.gridStepMode,
        "atrPeriod": body.atrPeriod,
        "martinMultiplier": body.martinMultiplier,
        "takeAlpha": body.takeAlpha,
        "takeProfitPct": body.takeProfitPct,
        "breakEvenAfterLegs": body.breakEvenAfterLegs,
        "maxLossPct": body.maxLossPct,
        "commissionPct": body.commissionPct,
        "slippagePct": body.slippagePct,
        "initialEquity": body.initialEquity,
        "allowShort": body.allowShort,
        "trendFilterEnabled": body.trendFilterEnabled,
        "emaPeriod": body.emaPeriod,
        "cooldownBars": body.cooldownBars,
        "dynamicAlphaEnabled": body.dynamicAlphaEnabled,
        "exposureCapBoth": body.exposureCapBoth,
        "atrRegimeFilterEnabled": body.atrRegimeFilterEnabled,
        "atrRegimeMin": body.atrRegimeMin,
        "atrRegimeMax": body.atrRegimeMax,
        "localExtremumBars": body.localExtremumBars,
        "trendFilterMarginPct": body.trendFilterMarginPct,
        "minRRatio": body.minRRatio,
        "mlFilterEnabled": body.mlFilterEnabled,
        "mlModelPath": body.mlModelPath,
        "mlLongThreshold": body.mlLongThreshold,
        "mlShortThreshold": body.mlShortThreshold,
        "symbol": body.symbol,
        "timeframe": body.timeframe,
    }
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(
            None,
            lambda: get_equity_and_drawdown_curves(body.exchange, body.symbol, body.timeframe, params),
        )
    except Exception as e:
        print(f"[API] Equity curve error: {e}")
        return {
            "equityCurve": [],
            "drawdownCurve": [],
            "metrics": {},
            "trades": [],
            "warnings": [],
            "error": str(e),
        }


# ─── ML pipeline (экспорт, фичи, обучение) для UI ───

class MlExportRequest(BaseModel):
    symbol: str
    timeframe: str = "1"
    exchange: str = "binance"


class MlPrepareRequest(BaseModel):
    symbol: str
    timeframe: str = "1"
    forwardBars: int = 5
    thresholdPct: float = 0.1
    trainRatio: float = 0.7
    valRatio: float = 0.15


class MlTrainRequest(BaseModel):
    symbol: str
    timeframe: str = "1"
    maxDepth: int = 6
    nEstimators: int = 100
    learningRate: float = 0.1


@app.post("/api/lab/ml-export")
async def lab_ml_export(body: MlExportRequest):
    """Экспорт истории в CSV для ML (после загрузки истории по паре/таймфрейму)."""
    try:
        from ml_export_history import run_export
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: run_export(body.exchange, body.symbol, body.timeframe),
        )
        return result
    except Exception as e:
        return {"ok": False, "rows": 0, "path": "", "error": str(e)}


@app.post("/api/lab/ml-prepare")
async def lab_ml_prepare(body: MlPrepareRequest):
    """Подготовка фичей и разбивка train/val/test из экспортированного CSV."""
    try:
        from ml_prepare_features import run_prepare
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: run_prepare(
                symbol=body.symbol,
                timeframe=body.timeframe,
                forward_bars=body.forwardBars,
                threshold_pct=body.thresholdPct,
                train_ratio=body.trainRatio,
                val_ratio=body.valRatio,
            ),
        )
        return result
    except Exception as e:
        return {"ok": False, "trainRows": 0, "valRows": 0, "testRows": 0, "error": str(e)}


@app.post("/api/lab/ml-train")
async def lab_ml_train(body: MlTrainRequest):
    """Обучение XGBoost на подготовленных фичах."""
    try:
        from ml_train import run_train
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: run_train(
                symbol=body.symbol,
                timeframe=body.timeframe,
                max_depth=body.maxDepth,
                n_estimators=body.nEstimators,
                learning_rate=body.learningRate,
            ),
        )
        return result
    except Exception as e:
        return {"ok": False, "path": "", "accuracyTrain": 0, "accuracyVal": None, "error": str(e)}


@app.get("/api/lab/ml-model-status")
async def lab_ml_model_status(
    symbol: str = Query(..., description="Символ, например BTCUSDT"),
    timeframe: str = Query(..., description="Таймфрейм, например 5 или 1"),
):
    """Проверить, есть ли обученная ML-модель для пары и таймфрейма."""
    return get_ml_model_status(symbol, timeframe)


def run_server():
    """Запуск сервера"""
    uvicorn.run(
        "api_server:app",
        host=API_HOST,
        port=API_PORT,
        reload=False,
        log_level="info"
    )


if __name__ == '__main__':
    run_server()
