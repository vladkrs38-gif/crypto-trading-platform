"""
SQLite база данных для хранения плотностей
"""

import sqlite3
import json
from datetime import datetime
from typing import Optional, List, Dict, Any
from pathlib import Path

from config import DB_PATH


def get_db_path() -> str:
    """Получить путь к БД относительно скрипта"""
    return str(Path(__file__).parent / DB_PATH)


def init_database():
    """Инициализация базы данных"""
    conn = sqlite3.connect(get_db_path())
    cursor = conn.cursor()
    
    # Таблица плотностей
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS densities (
            id TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            exchange TEXT NOT NULL,
            type TEXT NOT NULL,
            price REAL NOT NULL,
            amount_usd REAL NOT NULL,
            amount_coins REAL NOT NULL,
            first_seen_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            touch_count INTEGER DEFAULT 0,
            avg_volume_per_min REAL DEFAULT 0,
            UNIQUE(symbol, exchange, type, price)
        )
    ''')
    
    # Таблица касаний
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS price_touches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            density_id TEXT NOT NULL,
            touch_time TEXT NOT NULL,
            price_at_touch REAL NOT NULL,
            distance_percent REAL NOT NULL,
            FOREIGN KEY (density_id) REFERENCES densities(id)
        )
    ''')
    
    # Индексы для быстрого поиска
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_densities_active ON densities(is_active)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_densities_symbol ON densities(symbol)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_densities_first_seen ON densities(first_seen_at)')
    
    conn.commit()
    conn.close()
    print(f"[DB] Database initialized: {get_db_path()}")


def upsert_density(
    density_id: str,
    symbol: str,
    exchange: str,
    density_type: str,
    price: float,
    amount_usd: float,
    amount_coins: float,
    avg_volume_per_min: float
) -> bool:
    """
    Добавить или обновить плотность.
    Возвращает True если это новая плотность.
    """
    conn = sqlite3.connect(get_db_path())
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    
    # Проверяем существует ли
    cursor.execute('SELECT id, is_active FROM densities WHERE id = ?', (density_id,))
    existing = cursor.fetchone()
    
    is_new = False
    
    if existing:
        # Обновляем существующую
        cursor.execute('''
            UPDATE densities 
            SET last_seen_at = ?, amount_usd = ?, amount_coins = ?, 
                avg_volume_per_min = ?, is_active = 1
            WHERE id = ?
        ''', (now, amount_usd, amount_coins, avg_volume_per_min, density_id))
    else:
        # Создаём новую
        cursor.execute('''
            INSERT INTO densities 
            (id, symbol, exchange, type, price, amount_usd, amount_coins, 
             first_seen_at, last_seen_at, avg_volume_per_min, is_active, touch_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
        ''', (density_id, symbol, exchange, density_type, price, 
              amount_usd, amount_coins, now, now, avg_volume_per_min))
        is_new = True
    
    conn.commit()
    conn.close()
    return is_new


def mark_density_inactive(density_id: str):
    """Пометить плотность как неактивную (убрана из стакана)"""
    conn = sqlite3.connect(get_db_path())
    cursor = conn.cursor()
    cursor.execute('UPDATE densities SET is_active = 0 WHERE id = ?', (density_id,))
    conn.commit()
    conn.close()


def mark_densities_inactive_except(active_ids: List[str], symbol: str, exchange: str):
    """Пометить все плотности как неактивные, кроме указанных"""
    if not active_ids:
        # Все плотности для этого символа неактивны
        conn = sqlite3.connect(get_db_path())
        cursor = conn.cursor()
        cursor.execute('''
            UPDATE densities SET is_active = 0 
            WHERE symbol = ? AND exchange = ? AND is_active = 1
        ''', (symbol, exchange))
        conn.commit()
        conn.close()
        return
    
    conn = sqlite3.connect(get_db_path())
    cursor = conn.cursor()
    placeholders = ','.join('?' * len(active_ids))
    cursor.execute(f'''
        UPDATE densities SET is_active = 0 
        WHERE symbol = ? AND exchange = ? AND is_active = 1 AND id NOT IN ({placeholders})
    ''', [symbol, exchange] + active_ids)
    conn.commit()
    conn.close()


def record_touch(density_id: str, price_at_touch: float, distance_percent: float):
    """Записать касание цены к плотности"""
    conn = sqlite3.connect(get_db_path())
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    
    # Добавляем касание
    cursor.execute('''
        INSERT INTO price_touches (density_id, touch_time, price_at_touch, distance_percent)
        VALUES (?, ?, ?, ?)
    ''', (density_id, now, price_at_touch, distance_percent))
    
    # Увеличиваем счётчик
    cursor.execute('UPDATE densities SET touch_count = touch_count + 1 WHERE id = ?', (density_id,))
    
    conn.commit()
    conn.close()


def get_active_densities(min_lifetime_seconds: int = 3600) -> List[Dict[str, Any]]:
    """
    Получить активные плотности, которые прожили минимум min_lifetime_seconds.
    """
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT 
            id, symbol, exchange, type, price, amount_usd, amount_coins,
            first_seen_at, last_seen_at, touch_count, avg_volume_per_min,
            (julianday(last_seen_at) - julianday(first_seen_at)) * 86400 as lifetime_seconds
        FROM densities
        WHERE is_active = 1
        AND (julianday('now') - julianday(first_seen_at)) * 86400 >= ?
        ORDER BY amount_usd DESC
    ''', (min_lifetime_seconds,))
    
    rows = cursor.fetchall()
    conn.close()
    
    result = []
    for row in rows:
        result.append({
            'id': row['id'],
            'symbol': row['symbol'],
            'exchange': row['exchange'],
            'type': row['type'],
            'price': row['price'],
            'amountUSD': row['amount_usd'],
            'amountCoins': row['amount_coins'],
            'firstSeenAt': row['first_seen_at'],
            'lastSeenAt': row['last_seen_at'],
            'touchCount': row['touch_count'],
            'avgVolumePerMin': row['avg_volume_per_min'],
            'lifetimeSeconds': row['lifetime_seconds'] or 0,
        })
    
    return result


def get_density_by_id(density_id: str) -> Optional[Dict[str, Any]]:
    """Получить плотность по ID"""
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT * FROM densities WHERE id = ?
    ''', (density_id,))
    
    row = cursor.fetchone()
    conn.close()
    
    if not row:
        return None
    
    return dict(row)


def get_touches_for_density(density_id: str) -> List[Dict[str, Any]]:
    """Получить все касания для плотности"""
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT * FROM price_touches WHERE density_id = ? ORDER BY touch_time DESC
    ''', (density_id,))
    
    rows = cursor.fetchall()
    conn.close()
    
    return [dict(row) for row in rows]


def cleanup_old_inactive(days: int = 3):
    """Удалить все плотности старше N дней (и активные, и неактивные)."""
    conn = sqlite3.connect(get_db_path())
    cursor = conn.cursor()
    
    cursor.execute('''
        DELETE FROM price_touches 
        WHERE density_id IN (
            SELECT id FROM densities 
            WHERE julianday('now') - julianday(last_seen_at) > ?
        )
    ''', (days,))
    
    cursor.execute('''
        DELETE FROM densities 
        WHERE julianday('now') - julianday(last_seen_at) > ?
    ''', (days,))
    
    deleted = cursor.rowcount
    conn.commit()
    
    if deleted > 0:
        cursor.execute('VACUUM')
        conn.commit()
    
    conn.close()
    return deleted


def get_stats() -> Dict[str, Any]:
    """Получить статистику БД"""
    conn = sqlite3.connect(get_db_path())
    cursor = conn.cursor()
    
    cursor.execute('SELECT COUNT(*) FROM densities WHERE is_active = 1')
    active_count = cursor.fetchone()[0]
    
    cursor.execute('SELECT COUNT(*) FROM densities WHERE is_active = 0')
    inactive_count = cursor.fetchone()[0]
    
    cursor.execute('SELECT COUNT(*) FROM price_touches')
    touches_count = cursor.fetchone()[0]
    
    conn.close()
    
    return {
        'activeDensities': active_count,
        'inactiveDensities': inactive_count,
        'totalTouches': touches_count,
    }


if __name__ == '__main__':
    init_database()
    print("Database initialized successfully!")
