"""
Конфигурация трекера плотностей
"""

import os
from pathlib import Path

# Загружаем .env из текущей папки и из корня проекта (для сервера — .env.production)
_env_dir = Path(__file__).resolve().parent
for _f in (_env_dir / ".env", _env_dir / ".env.production", _env_dir.parent / ".env.production"):
    if _f.exists():
        from dotenv import load_dotenv
        load_dotenv(_f)
        break

# Минимальное время жизни плотности (в секундах) чтобы считаться "настоящей"
MIN_LIFETIME_SECONDS = 3600  # 1 час

# Минимальная сумма плотности в USD
MIN_DENSITY_USD = 100_000  # $100K

# Минимальный 24h объём монеты в USD для сканирования
# Уменьшен до $500K чтобы можно было фильтровать низколиквидные монеты на фронтенде
MIN_VOLUME_24H = 500_000  # $500K

# Максимальная дистанция до цены в %
MAX_DISTANCE_PERCENT = 5.0

# Интервал обновления стаканов (секунды)
ORDER_BOOK_UPDATE_INTERVAL = 2

# Порог кластеризации уровней (%)
CLUSTER_THRESHOLD_PERCENT = 0.1

# Порог касания (насколько близко цена должна подойти к плотности)
TOUCH_THRESHOLD_PERCENT = 0.1

# Сколько топ монет мониторить
TOP_COINS_LIMIT = 100

# API сервер
API_HOST = "0.0.0.0"  # 0.0.0.0 для доступа извне на VDS, 127.0.0.1 только для localhost
API_PORT = 8765

# База данных
DB_PATH = "densities.db"

# ===== Telegram уведомления =====
# Можно задать через переменные окружения или оставить пустыми для настройки через UI

# Включить уведомления (можно переопределить через UI)
TELEGRAM_ENABLED = os.getenv("TELEGRAM_ENABLED", "false").lower() == "true"

# Токен бота (получить у @BotFather)
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

# Chat ID (узнать у @userinfobot)
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# Порог дистанции для уведомлений (%)
ALERT_DISTANCE_PERCENT = float(os.getenv("ALERT_DISTANCE_PERCENT", "0.5"))

# Cooldown между уведомлениями об одной плотности (минуты)
ALERT_COOLDOWN_MINUTES = int(os.getenv("ALERT_COOLDOWN_MINUTES", "5"))

# ===== Скринер крупных ордеров =====
# Множитель от среднего объёма (2–50). Задаётся в .bat: set BIG_ORDER_MULTIPLIER=5
BIG_ORDER_MULTIPLIER = max(2, min(50, int(os.getenv("BIG_ORDER_MULTIPLIER", "5"))))

# ===== Сканер выпечки X5 (Gemini) =====
# Ключ Google AI / Gemini API: https://aistudio.google.com/apikey
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

# ===== VPN Dashboard (Xray VLESS Reality) =====
# Токен для админки /vpn и API /api/vpn/* (передавать как X-Admin-Token)
VPN_ADMIN_TOKEN = os.getenv("VPN_ADMIN_TOKEN", "")

# Публичный хост для генерации ссылок (IP или домен). По умолчанию домен сайта.
VPN_PUBLIC_HOST = os.getenv("VPN_PUBLIC_HOST", "proplatforma.ru")

# Порт VLESS Reality на сервере
VPN_VLESS_PORT = int(os.getenv("VPN_VLESS_PORT", "44333"))

# ===== Авто-чистка SQLite (densities.db) =====
# Удаляет старые неактивные плотности и их касания.
CLEANUP_DAYS = int(os.getenv("CLEANUP_DAYS", "3"))
# Интервал запуска авто-чистки (в секундах) — каждые 6 часов
CLEANUP_INTERVAL_SECONDS = int(os.getenv("CLEANUP_INTERVAL_SECONDS", str(6 * 60 * 60)))
