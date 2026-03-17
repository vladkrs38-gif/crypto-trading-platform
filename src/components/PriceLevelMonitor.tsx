'use client';

import { useEffect, useRef, useCallback } from 'react';
import { usePriceLevelsStore, useActiveAlertsStore } from '@/store/useTradingStore';

// Функция для воспроизведения звукового сигнала
function playAlertSound() {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    const playTone = (frequency: number, startTime: number, duration: number) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime + startTime);
      
      gainNode.gain.setValueAtTime(0, audioContext.currentTime + startTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + startTime + 0.05);
      gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + startTime + duration);
      
      oscillator.start(audioContext.currentTime + startTime);
      oscillator.stop(audioContext.currentTime + startTime + duration);
    };
    
    // Два тона
    playTone(880, 0, 0.15);
    playTone(1100, 0.15, 0.2);
  } catch (error) {
    console.error('Error playing alert sound:', error);
  }
}

// WebSocket URL для mini ticker (легче чем trades)
const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/ws';
const BYBIT_WS_BASE = 'wss://stream.bybit.com/v5/public/spot';

interface PriceUpdate {
  symbol: string;
  price: number;
}

/**
 * Компонент для фонового отслеживания цен пар с установленными уровнями.
 * Работает независимо от активного графика.
 */
export default function PriceLevelMonitor() {
  const levels = usePriceLevelsStore((state) => state.levels);
  const addAlert = useActiveAlertsStore((state) => state.addAlert);
  const clearExpiredAlerts = useActiveAlertsStore((state) => state.clearExpiredAlerts);
  
  const wsRef = useRef<WebSocket | null>(null);
  const bybitWsRef = useRef<WebSocket | null>(null);
  const lastAlertTimeRef = useRef<Record<string, number>>({});
  const pricesRef = useRef<Record<string, number>>({});
  
  // Получаем список символов с уровнями
  const symbolsWithLevels = Object.keys(levels).filter(symbol => levels[symbol]?.length > 0);
  
  // Проверка приближения к уровню
  const checkLevels = useCallback((symbol: string, price: number, exchange: 'Binance' | 'Bybit') => {
    const symbolLevels = levels[symbol];
    if (!symbolLevels || symbolLevels.length === 0) return;
    
    const now = Date.now();
    const SOUND_COOLDOWN = 30000; // 30 секунд между звуками для одного уровня
    const PRICE_PROXIMITY_PERCENT = 0.45; // 0.45% от цены
    
    symbolLevels.forEach(level => {
      const distance = Math.abs(price - level.price);
      const threshold = price * (PRICE_PROXIMITY_PERCENT / 100);
      
      if (distance <= threshold) {
        const alertKey = `${symbol}-${level.id}`;
        const lastSound = lastAlertTimeRef.current[alertKey] || 0;
        
        // Всегда обновляем алерт (чтобы колокольчик не пропадал пока цена в зоне)
        addAlert({
          symbol,
          levelId: level.id,
          levelPrice: level.price,
          currentPrice: price,
          triggeredAt: now,
          exchange,
        });
        
        // Звук играем только раз в 30 секунд
        if (now - lastSound > SOUND_COOLDOWN) {
          playAlertSound();
          lastAlertTimeRef.current[alertKey] = now;
          console.log(`🔔 Alert: ${symbol} price ${price.toFixed(4)} near level ${level.price.toFixed(4)}`);
        }
      }
    });
  }, [levels, addAlert]);
  
  // Подключение к Binance WebSocket
  useEffect(() => {
    // Фильтруем только Binance символы (те что не помечены как Bybit в levels)
    // Для простоты подписываемся на все - Binance вернет данные только для своих пар
    const binanceSymbols = symbolsWithLevels.filter(s => !s.includes('_BYBIT'));
    
    if (binanceSymbols.length === 0) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }
    
    // Формируем streams для mini ticker
    const streams = binanceSymbols.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
    const wsUrl = `${BINANCE_WS_BASE}/${streams}`;
    
    try {
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('[PriceLevelMonitor] Binance WS connected for', binanceSymbols.length, 'symbols');
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Mini ticker формат: { s: symbol, c: close price }
          if (data.s && data.c) {
            const symbol = data.s;
            const price = parseFloat(data.c);
            
            if (isFinite(price) && price > 0) {
              pricesRef.current[symbol] = price;
              checkLevels(symbol, price, 'Binance');
            }
          }
        } catch (error) {
          // Ignore parsing errors
        }
      };
      
      ws.onerror = (error) => {
        console.error('[PriceLevelMonitor] Binance WS error:', error);
      };
      
      ws.onclose = () => {
        console.log('[PriceLevelMonitor] Binance WS closed');
      };
      
      wsRef.current = ws;
    } catch (error) {
      console.error('[PriceLevelMonitor] Binance connection error:', error);
    }
    
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [symbolsWithLevels.join(','), checkLevels]);
  
  // Подключение к Bybit WebSocket (для Bybit пар)
  useEffect(() => {
    // Bybit пары определяем по отсутствию на Binance или по метке
    // Для простоты - подписываемся на все символы с уровнями через Bybit тоже
    // Bybit вернет данные только для своих пар
    
    if (symbolsWithLevels.length === 0) {
      if (bybitWsRef.current) {
        bybitWsRef.current.close();
        bybitWsRef.current = null;
      }
      return;
    }
    
    try {
      const ws = new WebSocket(BYBIT_WS_BASE);
      
      ws.onopen = () => {
        console.log('[PriceLevelMonitor] Bybit WS connected');
        
        // Подписываемся на tickers для всех символов с уровнями
        const args = symbolsWithLevels.map(s => `tickers.${s}`);
        ws.send(JSON.stringify({
          op: 'subscribe',
          args,
        }));
        
        // Ping каждые 20 секунд
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ op: 'ping' }));
          }
        }, 20000);
        
        (ws as any)._pingInterval = pingInterval;
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Пропускаем pong
          if (data.op === 'pong' || data.op === 'subscribe') return;
          
          // Ticker формат: { topic: "tickers.BTCUSDT", data: { lastPrice: "..." } }
          if (data.topic && data.topic.startsWith('tickers.') && data.data) {
            const symbol = data.topic.replace('tickers.', '');
            const price = parseFloat(data.data.lastPrice);
            
            if (isFinite(price) && price > 0) {
              pricesRef.current[symbol] = price;
              checkLevels(symbol, price, 'Bybit');
            }
          }
        } catch (error) {
          // Ignore parsing errors
        }
      };
      
      ws.onerror = (error) => {
        console.error('[PriceLevelMonitor] Bybit WS error:', error);
      };
      
      ws.onclose = () => {
        console.log('[PriceLevelMonitor] Bybit WS closed');
        if ((ws as any)._pingInterval) {
          clearInterval((ws as any)._pingInterval);
        }
      };
      
      bybitWsRef.current = ws;
    } catch (error) {
      console.error('[PriceLevelMonitor] Bybit connection error:', error);
    }
    
    return () => {
      if (bybitWsRef.current) {
        if ((bybitWsRef.current as any)._pingInterval) {
          clearInterval((bybitWsRef.current as any)._pingInterval);
        }
        bybitWsRef.current.close();
        bybitWsRef.current = null;
      }
    };
  }, [symbolsWithLevels.join(','), checkLevels]);
  
  // Очистка алертов: если нет обновления 10с — цена ушла из зоны
  useEffect(() => {
    const interval = setInterval(() => {
      clearExpiredAlerts(10000);
    }, 3000);
    
    return () => clearInterval(interval);
  }, [clearExpiredAlerts]);
  
  // Компонент невидимый - только логика
  return null;
}
