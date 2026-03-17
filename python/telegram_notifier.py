"""
Telegram уведомления о приближении цены к плотностям
"""

import asyncio
import aiohttp
import ssl
from datetime import datetime
from typing import Dict, Optional
import json

# Создаём SSL контекст без проверки сертификата (для Windows с антивирусами/прокси)
ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE


class TelegramNotifier:
    """Класс для отправки уведомлений в Telegram"""
    
    def __init__(self):
        self.enabled = False
        self.bot_token = ""
        self.chat_id = ""
        self.alert_distance_percent = 0.5  # Порог для уведомлений
        self.cooldown_minutes = 5  # Минимальный интервал между уведомлениями
        
        # Словарь для отслеживания последних уведомлений
        # density_id -> timestamp последнего уведомления
        self._last_alerts: Dict[str, float] = {}
        
    def configure(self, enabled: bool, bot_token: str, chat_id: str, 
                  alert_distance: float = 0.5, cooldown: int = 5):
        """Настроить параметры уведомлений"""
        self.enabled = enabled
        self.bot_token = bot_token
        self.chat_id = chat_id
        self.alert_distance_percent = alert_distance
        self.cooldown_minutes = cooldown
        
        if enabled:
            print(f"[Telegram] Уведомления включены (порог: {alert_distance}%, cooldown: {cooldown} мин)")
        else:
            print("[Telegram] Уведомления выключены")
    
    def _can_send_alert(self, density_id: str) -> bool:
        """Проверить, можно ли отправить уведомление (cooldown)"""
        if not self.enabled or not self.bot_token or not self.chat_id:
            return False
            
        last_time = self._last_alerts.get(density_id, 0)
        now = datetime.now().timestamp()
        cooldown_seconds = self.cooldown_minutes * 60
        
        return (now - last_time) >= cooldown_seconds
    
    def _format_message(self, density_data: dict) -> str:
        """Форматировать сообщение для Telegram"""
        symbol = density_data.get('symbol', 'UNKNOWN')
        density_type = density_data.get('type', 'unknown')
        price = density_data.get('price', 0)
        current_price = density_data.get('currentPrice', 0)
        distance = density_data.get('distancePercent', 0)
        amount_usd = density_data.get('amountUSD', 0)
        dissolution_time = density_data.get('dissolutionTime', 0)
        exchange = density_data.get('exchange', 'unknown')
        
        # Тип на русском
        type_ru = "BUY (поддержка)" if density_type == 'buy' else "SELL (сопротивление)"
        
        # Форматируем сумму
        if amount_usd >= 1_000_000:
            amount_str = f"${amount_usd / 1_000_000:.1f}M"
        elif amount_usd >= 1_000:
            amount_str = f"${amount_usd / 1_000:.0f}K"
        else:
            amount_str = f"${amount_usd:.0f}"
        
        # Форматируем цены
        if price >= 1000:
            price_str = f"${price:,.2f}"
            current_str = f"${current_price:,.2f}"
        elif price >= 1:
            price_str = f"${price:.4f}"
            current_str = f"${current_price:.4f}"
        else:
            price_str = f"${price:.6f}"
            current_str = f"${current_price:.6f}"
        
        # Биржа с эмодзи
        exchange_emoji = "🟡" if exchange == 'binance' else "🟠"
        exchange_name = exchange.capitalize()
        
        message = f"""🔔 {symbol} приближается к плотности!

📊 Тип: {type_ru}
💵 Цена плотности: {price_str}
📈 Текущая цена: {current_str}
📏 Дистанция: {distance:.2f}%
💰 Объём: {amount_str}
⏱ Время разъедания: {dissolution_time:.1f} мин

{exchange_emoji} {exchange_name}"""
        
        return message
    
    async def send_alert(self, density_data: dict) -> bool:
        """
        Отправить уведомление о плотности.
        Возвращает True если уведомление отправлено.
        """
        density_id = density_data.get('id', '')
        
        if not self._can_send_alert(density_id):
            return False
        
        distance = density_data.get('distancePercent', 100)
        
        # Проверяем порог дистанции
        if distance > self.alert_distance_percent:
            return False
        
        message = self._format_message(density_data)
        
        try:
            url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
            payload = {
                "chat_id": self.chat_id,
                "text": message,
                "parse_mode": "HTML"
            }
            
            connector = aiohttp.TCPConnector(ssl=ssl_context)
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.post(url, json=payload) as resp:
                    if resp.status == 200:
                        # Обновляем время последнего уведомления
                        self._last_alerts[density_id] = datetime.now().timestamp()
                        symbol = density_data.get('symbol', 'UNKNOWN')
                        print(f"[Telegram] Уведомление отправлено: {symbol}")
                        return True
                    else:
                        error = await resp.text()
                        print(f"[Telegram] Ошибка отправки: {resp.status} - {error}")
                        return False
                        
        except Exception as e:
            print(f"[Telegram] Ошибка: {e}")
            return False
    
    async def send_test_message(self) -> dict:
        """Отправить тестовое сообщение"""
        if not self.bot_token or not self.chat_id:
            return {"success": False, "error": "Не заданы bot_token или chat_id"}
        
        message = """✅ Тестовое сообщение от Density Tracker!

Уведомления настроены правильно.
Вы будете получать алерты при приближении цены к плотностям."""
        
        try:
            url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
            payload = {
                "chat_id": self.chat_id,
                "text": message
            }
            
            connector = aiohttp.TCPConnector(ssl=ssl_context)
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.post(url, json=payload) as resp:
                    if resp.status == 200:
                        return {"success": True, "message": "Тестовое сообщение отправлено!"}
                    else:
                        error = await resp.text()
                        try:
                            error_data = json.loads(error)
                            error_msg = error_data.get('description', error)
                        except:
                            error_msg = error
                        return {"success": False, "error": f"Ошибка Telegram API: {error_msg}"}
                        
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def get_settings(self) -> dict:
        """Получить текущие настройки"""
        return {
            "enabled": self.enabled,
            "botToken": self.bot_token[:10] + "..." if self.bot_token else "",
            "chatId": self.chat_id,
            "alertDistancePercent": self.alert_distance_percent,
            "cooldownMinutes": self.cooldown_minutes
        }
    
    def cleanup_old_alerts(self, max_age_hours: int = 24):
        """Очистить старые записи о уведомлениях"""
        now = datetime.now().timestamp()
        max_age_seconds = max_age_hours * 3600
        
        old_ids = [
            density_id 
            for density_id, timestamp in self._last_alerts.items()
            if (now - timestamp) > max_age_seconds
        ]
        
        for density_id in old_ids:
            del self._last_alerts[density_id]
        
        if old_ids:
            print(f"[Telegram] Очищено {len(old_ids)} старых записей о уведомлениях")


# Глобальный экземпляр
notifier = TelegramNotifier()
