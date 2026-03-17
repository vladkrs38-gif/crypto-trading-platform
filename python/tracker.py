"""
Трекер плотностей - мониторинг стаканов Binance и Bybit через WebSocket
"""

import asyncio
import json
import aiohttp
import websockets
from datetime import datetime
from typing import Dict, List, Set, Optional, Any
from collections import defaultdict

from config import (
    MIN_DENSITY_USD, MIN_VOLUME_24H, MAX_DISTANCE_PERCENT,
    ORDER_BOOK_UPDATE_INTERVAL, CLUSTER_THRESHOLD_PERCENT,
    TOUCH_THRESHOLD_PERCENT, TOP_COINS_LIMIT,
    TELEGRAM_ENABLED, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
    ALERT_DISTANCE_PERCENT, ALERT_COOLDOWN_MINUTES
)
from database import (
    init_database, upsert_density, mark_densities_inactive_except,
    record_touch, get_active_densities
)
from telegram_notifier import notifier


class DensityTracker:
    def __init__(self):
        self.running = False
        self.coins: Dict[str, Dict] = {}  # symbol -> {price, volume24h, exchange}
        self.current_prices: Dict[str, float] = {}  # symbol -> current_price
        self.tracked_density_ids: Set[str] = set()  # Текущие активные ID
        
    async def start(self):
        """Запуск трекера"""
        print("[Tracker] Initializing database...")
        init_database()
        
        # Инициализируем Telegram уведомления из конфига
        notifier.configure(
            enabled=TELEGRAM_ENABLED,
            bot_token=TELEGRAM_BOT_TOKEN,
            chat_id=TELEGRAM_CHAT_ID,
            alert_distance=ALERT_DISTANCE_PERCENT,
            cooldown=ALERT_COOLDOWN_MINUTES
        )
        
        print("[Tracker] Starting density tracker...")
        self.running = True
        
        # Запускаем задачи параллельно
        await asyncio.gather(
            self.fetch_coins_loop(),
            self.scan_order_books_loop(),
            self.check_touches_loop(),
        )
    
    async def stop(self):
        """Остановка трекера"""
        print("[Tracker] Stopping...")
        self.running = False
    
    async def fetch_coins_loop(self):
        """Периодическое обновление списка монет"""
        while self.running:
            try:
                await self.fetch_top_coins()
            except Exception as e:
                print(f"[Tracker] Error fetching coins: {e}")
            
            # Обновляем список монет каждые 5 минут
            await asyncio.sleep(300)
    
    async def fetch_top_coins(self):
        """Получить топ монет по объёму с обеих бирж - сканируем ОБЕ биржи"""
        coins = {}
        binance_symbols = set()
        bybit_symbols = set()
        
        async with aiohttp.ClientSession() as session:
            # Binance
            try:
                async with session.get('https://api.binance.com/api/v3/ticker/24hr') as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        for ticker in data:
                            if ticker['symbol'].endswith('USDT'):
                                volume = float(ticker['quoteVolume'])
                                if volume >= MIN_VOLUME_24H:
                                    symbol = ticker['symbol']
                                    binance_symbols.add(symbol)
                                    # Ключ включает биржу чтобы сканировать обе
                                    key = f"binance:{symbol}"
                                    coins[key] = {
                                        'symbol': symbol,
                                        'price': float(ticker['lastPrice']),
                                        'volume24h': volume,
                                        'exchange': 'binance'
                                    }
            except Exception as e:
                print(f"[Tracker] Binance error: {e}")
            
            # Bybit (Spot)
            try:
                async with session.get('https://api.bybit.com/v5/market/tickers?category=spot') as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        if data.get('retCode') == 0:
                            for ticker in data['result']['list']:
                                if ticker['symbol'].endswith('USDT'):
                                    volume = float(ticker.get('turnover24h', 0))
                                    if volume >= MIN_VOLUME_24H:
                                        symbol = ticker['symbol']
                                        bybit_symbols.add(symbol)
                                        # Ключ включает биржу
                                        key = f"bybit:{symbol}"
                                        coins[key] = {
                                            'symbol': symbol,
                                            'price': float(ticker['lastPrice']),
                                            'volume24h': volume,
                                            'exchange': 'bybit'
                                        }
            except Exception as e:
                print(f"[Tracker] Bybit error: {e}")
        
        # Сортируем по объёму и берём топ
        sorted_coins = sorted(coins.values(), key=lambda x: x['volume24h'], reverse=True)
        # Используем ключ exchange:symbol для хранения
        self.coins = {f"{c['exchange']}:{c['symbol']}": c for c in sorted_coins[:TOP_COINS_LIMIT * 2]}
        
        binance_count = sum(1 for c in self.coins.values() if c['exchange'] == 'binance')
        bybit_count = sum(1 for c in self.coins.values() if c['exchange'] == 'bybit')
        print(f"[Tracker] Tracking {len(self.coins)} coins (Binance: {binance_count}, Bybit: {bybit_count})")
    
    async def scan_order_books_loop(self):
        """Периодическое сканирование стаканов"""
        while self.running:
            if not self.coins:
                await asyncio.sleep(5)
                continue
            
            try:
                # Сканируем по батчам чтобы не перегружать API
                coin_keys = list(self.coins.keys())
                batch_size = 10
                
                for i in range(0, len(coin_keys), batch_size):
                    batch = coin_keys[i:i + batch_size]
                    await asyncio.gather(*[
                        self.scan_symbol(key) for key in batch
                    ])
                    await asyncio.sleep(0.5)  # Пауза между батчами
                
            except Exception as e:
                print(f"[Tracker] Error scanning order books: {e}")
            
            await asyncio.sleep(ORDER_BOOK_UPDATE_INTERVAL)
    
    async def scan_symbol(self, coin_key: str):
        """Сканировать стакан одного символа"""
        coin = self.coins.get(coin_key)
        if not coin:
            return
        
        symbol = coin['symbol']
        exchange = coin['exchange']
        
        async with aiohttp.ClientSession() as session:
            try:
                order_book = await self.fetch_order_book(session, symbol, exchange)
                if not order_book:
                    return
                
                current_price = order_book['currentPrice']
                self.current_prices[symbol] = current_price
                
                # Получаем средний объём за 4 часа
                avg_volume = await self.get_avg_volume(session, symbol, exchange)
                
                # Ищем плотности
                found_ids = []
                
                for side, levels in [('buy', order_book['bids']), ('sell', order_book['asks'])]:
                    for level in levels:
                        price = level['price']
                        amount_usd = level['amountUSD']
                        
                        # Проверяем минимальную сумму
                        if amount_usd < MIN_DENSITY_USD:
                            continue
                        
                        # Проверяем дистанцию
                        if side == 'buy':
                            distance = (current_price - price) / current_price * 100
                        else:
                            distance = (price - current_price) / current_price * 100
                        
                        if distance < 0 or distance > MAX_DISTANCE_PERCENT:
                            continue
                        
                        # Создаём ID плотности
                        density_id = f"{exchange}-{symbol}-{side}-{price:.8f}"
                        found_ids.append(density_id)
                        
                        # Сохраняем в БД
                        avg_vol_per_min = avg_volume / 240 if avg_volume > 0 else 0  # 4 часа = 240 минут
                        upsert_density(
                            density_id=density_id,
                            symbol=symbol,
                            exchange=exchange,
                            density_type=side,
                            price=price,
                            amount_usd=amount_usd,
                            amount_coins=level['quantity'],
                            avg_volume_per_min=avg_vol_per_min
                        )
                
                # Помечаем неактивные плотности
                mark_densities_inactive_except(found_ids, symbol, exchange)
                
            except Exception as e:
                print(f"[Tracker] Error scanning {symbol}: {e}")
    
    async def fetch_order_book(self, session: aiohttp.ClientSession, symbol: str, exchange: str) -> Optional[Dict]:
        """Получить стакан с биржи"""
        try:
            if exchange == 'binance':
                async with session.get(
                    f'https://api.binance.com/api/v3/depth?symbol={symbol}&limit=500'
                ) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()
                
                # Получаем текущую цену
                async with session.get(
                    f'https://api.binance.com/api/v3/ticker/price?symbol={symbol}'
                ) as resp:
                    price_data = await resp.json()
                    current_price = float(price_data['price'])
                
                bids = [{
                    'price': float(b[0]),
                    'quantity': float(b[1]),
                    'amountUSD': float(b[0]) * float(b[1])
                } for b in data['bids']]
                
                asks = [{
                    'price': float(a[0]),
                    'quantity': float(a[1]),
                    'amountUSD': float(a[0]) * float(a[1])
                } for a in data['asks']]
                
                return {'bids': bids, 'asks': asks, 'currentPrice': current_price}
            
            elif exchange == 'bybit':
                async with session.get(
                    f'https://api.bybit.com/v5/market/orderbook?category=spot&symbol={symbol}&limit=200'
                ) as resp:
                    if resp.status != 200:
                        return None
                    data = await resp.json()
                
                if data.get('retCode') != 0:
                    return None
                
                result = data['result']
                best_bid = float(result['b'][0][0]) if result['b'] else 0
                best_ask = float(result['a'][0][0]) if result['a'] else 0
                current_price = (best_bid + best_ask) / 2
                
                bids = [{
                    'price': float(b[0]),
                    'quantity': float(b[1]),
                    'amountUSD': float(b[0]) * float(b[1])
                } for b in result['b']]
                
                asks = [{
                    'price': float(a[0]),
                    'quantity': float(a[1]),
                    'amountUSD': float(a[0]) * float(a[1])
                } for a in result['a']]
                
                return {'bids': bids, 'asks': asks, 'currentPrice': current_price}
        
        except Exception as e:
            print(f"[Tracker] Order book error {symbol}: {e}")
            return None
    
    async def get_avg_volume(self, session: aiohttp.ClientSession, symbol: str, exchange: str) -> float:
        """Получить средний объём за 4 часа"""
        try:
            if exchange == 'binance':
                async with session.get(
                    f'https://api.binance.com/api/v3/klines?symbol={symbol}&interval=1h&limit=4'
                ) as resp:
                    if resp.status != 200:
                        return 0
                    data = await resp.json()
                    return sum(float(k[7]) for k in data)  # Quote volume
            
            elif exchange == 'bybit':
                async with session.get(
                    f'https://api.bybit.com/v5/market/kline?category=spot&symbol={symbol}&interval=60&limit=4'
                ) as resp:
                    if resp.status != 200:
                        return 0
                    data = await resp.json()
                    if data.get('retCode') != 0:
                        return 0
                    klines = data['result']['list']
                    return sum(float(k[6]) for k in klines)  # Turnover
        
        except Exception as e:
            return 0
    
    async def check_touches_loop(self):
        """Проверка касаний цены к плотностям и отправка уведомлений"""
        while self.running:
            try:
                # Получаем активные плотности из БД (без фильтра по времени для проверки касаний)
                from database import get_db_path
                import sqlite3
                
                conn = sqlite3.connect(get_db_path())
                conn.row_factory = sqlite3.Row
                cursor = conn.cursor()
                
                cursor.execute('''
                    SELECT id, symbol, exchange, type, price, amount_usd, amount_coins, 
                           avg_volume_per_min, first_seen_at,
                           (julianday('now') - julianday(first_seen_at)) * 24 * 60 as lifetime_minutes
                    FROM densities WHERE is_active = 1
                ''')
                
                densities = cursor.fetchall()
                conn.close()
                
                for density in densities:
                    symbol = density['symbol']
                    current_price = self.current_prices.get(symbol)
                    
                    if not current_price:
                        continue
                    
                    density_price = density['price']
                    density_type = density['type']
                    
                    # Вычисляем дистанцию
                    if density_type == 'buy':
                        distance = (current_price - density_price) / current_price * 100
                    else:
                        distance = (density_price - current_price) / current_price * 100
                    
                    # Если цена подошла близко - записываем касание
                    if 0 <= distance <= TOUCH_THRESHOLD_PERCENT:
                        record_touch(density['id'], current_price, distance)
                        print(f"[Touch] {symbol} touched {density_type} density at {density_price}")
                    
                    # Отправляем Telegram уведомление если дистанция в пределах порога
                    if notifier.enabled and 0 <= distance <= notifier.alert_distance_percent:
                        # Вычисляем время разъедания
                        avg_vol = density['avg_volume_per_min'] or 0
                        dissolution_time = density['amount_usd'] / avg_vol if avg_vol > 0 else 0
                        
                        density_data = {
                            'id': density['id'],
                            'symbol': symbol,
                            'exchange': density['exchange'],
                            'type': density_type,
                            'price': density_price,
                            'currentPrice': current_price,
                            'distancePercent': abs(distance),
                            'amountUSD': density['amount_usd'],
                            'dissolutionTime': dissolution_time,
                        }
                        
                        await notifier.send_alert(density_data)
                
            except Exception as e:
                print(f"[Tracker] Error checking touches: {e}")
            
            # Периодически очищаем старые записи об уведомлениях
            notifier.cleanup_old_alerts()
            
            await asyncio.sleep(1)


# Глобальный экземпляр трекера
tracker = DensityTracker()


async def main():
    """Точка входа"""
    print("=" * 50)
    print("  DENSITY TRACKER")
    print("  Мониторинг плотностей Binance & Bybit")
    print("=" * 50)
    
    try:
        await tracker.start()
    except KeyboardInterrupt:
        print("\n[Tracker] Interrupted by user")
        await tracker.stop()


if __name__ == '__main__':
    asyncio.run(main())
