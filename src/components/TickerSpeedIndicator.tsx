'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTradingStore } from '@/store/useTradingStore';
import { BinanceTickStream } from '@/lib/binance';
import { BybitTickStream } from '@/lib/bybit';

// Период накопления в минутах
const ACCUMULATION_PERIOD = 15;
// Порог дисбаланса для алерта (70%)
const IMBALANCE_THRESHOLD = 70;
// Кулдаун между алертами
const ALERT_COOLDOWN = 10000;

// Структура данных для минутного блока
interface MinuteBlock {
  minute: number; // timestamp начала минуты
  buyVolume: number;
  sellVolume: number;
  buyCount: number;
  sellCount: number;
}

// Функция для воспроизведения звука дисбаланса
function playImbalanceSound(isBullish: boolean) {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.type = 'sine';
    // Разные тона для покупателей и продавцов
    const baseFreq = isBullish ? 523.25 : 392; // C5 vs G4
    oscillator.frequency.setValueAtTime(baseFreq, audioContext.currentTime);
    oscillator.frequency.linearRampToValueAtTime(baseFreq * 1.5, audioContext.currentTime + 0.15);
    
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.15, audioContext.currentTime + 0.03);
    gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.2);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.2);
  } catch (error) {
    // Ignore audio errors
  }
}

// Получить ключ минуты из timestamp
function getMinuteKey(timestamp: number): number {
  return Math.floor(timestamp / 60000) * 60000;
}

export default function TickerSpeedIndicator() {
  // ОПТИМИЗАЦИЯ: убран addTick - компонент использует собственные refs для данных
  const selectedPair = useTradingStore((state) => state.selectedPair);
  
  // Состояния
  const [buyPercent, setBuyPercent] = useState(50); // Процент покупателей (0-100)
  const [minuteBlocks, setMinuteBlocks] = useState<MinuteBlock[]>([]); // История по минутам
  const [currentSpeed, setCurrentSpeed] = useState(0); // Текущая скорость
  const [isAlert, setIsAlert] = useState(false); // Флаг алерта
  const [soundEnabled, setSoundEnabled] = useState(false);
  
  // Refs
  const tickStreamRef = useRef<BinanceTickStream | BybitTickStream | null>(null);
  const minuteDataRef = useRef<Map<number, MinuteBlock>>(new Map());
  const tickTimestampsRef = useRef<number[]>([]);
  const lastAlertTimeRef = useRef<number>(0);
  
  // Обработка тика
  // ОПТИМИЗАЦИЯ: убран addTick - используем только refs для накопления данных
  const handleTick = useCallback((tick: { time: number; price: number; volume: number; isBuyerMaker: boolean }) => {
    const now = Date.now();
    const minuteKey = getMinuteKey(now);
    
    // Добавляем timestamp для расчёта скорости
    tickTimestampsRef.current.push(now);
    
    // Получаем или создаём блок для текущей минуты
    const currentBlock = minuteDataRef.current.get(minuteKey) || {
      minute: minuteKey,
      buyVolume: 0,
      sellVolume: 0,
      buyCount: 0,
      sellCount: 0,
    };
    
    // Обновляем данные (isBuyerMaker = false означает покупатель инициатор)
    if (!tick.isBuyerMaker) {
      currentBlock.buyVolume += tick.volume;
      currentBlock.buyCount += 1;
    } else {
      currentBlock.sellVolume += tick.volume;
      currentBlock.sellCount += 1;
    }
    
    minuteDataRef.current.set(minuteKey, currentBlock);
  }, []);

  // Подключение к WebSocket
  useEffect(() => {
    if (!selectedPair) {
      if (tickStreamRef.current) {
        tickStreamRef.current.disconnect();
        tickStreamRef.current = null;
      }
      return;
    }

    const pairSymbol = selectedPair.symbol;
    const isBybit = selectedPair.exchange === 'Bybit';
    
    // Отключаем предыдущий поток
    if (tickStreamRef.current) {
      tickStreamRef.current.disconnect();
      tickStreamRef.current = null;
    }
    
    // Очищаем данные
    minuteDataRef.current.clear();
    tickTimestampsRef.current = [];
    setMinuteBlocks([]);
    setBuyPercent(50);

    // Создаем новый поток
    if (isBybit) {
      const stream = new BybitTickStream(pairSymbol, handleTick);
      stream.connect();
      tickStreamRef.current = stream;
    } else {
      const stream = new BinanceTickStream(pairSymbol, handleTick);
      stream.connect();
      tickStreamRef.current = stream;
    }

    return () => {
      if (tickStreamRef.current) {
        tickStreamRef.current.disconnect();
        tickStreamRef.current = null;
      }
    };
  }, [selectedPair?.symbol, selectedPair?.exchange, handleTick]);

  // Обновление UI каждые 500ms (было 200ms) - ОПТИМИЗАЦИЯ производительности
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const currentMinuteKey = getMinuteKey(now);
      const cutoffTime = currentMinuteKey - ACCUMULATION_PERIOD * 60000;
      
      // Удаляем старые данные (оптимизация - только если есть что удалять)
      if (minuteDataRef.current.size > ACCUMULATION_PERIOD) {
        const keysToDelete: number[] = [];
        minuteDataRef.current.forEach((_, key) => {
          if (key < cutoffTime) {
            keysToDelete.push(key);
          }
        });
        keysToDelete.forEach(key => minuteDataRef.current.delete(key));
      }
      
      // Очищаем старые timestamps (оптимизация - только если много накопилось)
      if (tickTimestampsRef.current.length > 100) {
        tickTimestampsRef.current = tickTimestampsRef.current.filter(t => t >= now - 15000);
      }
      
      // Считаем скорость
      const oneSecAgo = now - 1000;
      const speed = tickTimestampsRef.current.filter(t => t >= oneSecAgo).length;
      setCurrentSpeed(speed);
      
      // Собираем блоки и считаем общий баланс
      const blocks: MinuteBlock[] = [];
      let totalBuyVolume = 0;
      let totalSellVolume = 0;
      
      // Создаём массив из 15 минут (от старых к новым)
      for (let i = ACCUMULATION_PERIOD - 1; i >= 0; i--) {
        const minuteKey = currentMinuteKey - i * 60000;
        const block = minuteDataRef.current.get(minuteKey);
        
        if (block) {
          blocks.push(block);
          totalBuyVolume += block.buyVolume;
          totalSellVolume += block.sellVolume;
        } else {
          // Пустой блок для этой минуты
          blocks.push({
            minute: minuteKey,
            buyVolume: 0,
            sellVolume: 0,
            buyCount: 0,
            sellCount: 0,
          });
        }
      }
      
      setMinuteBlocks(blocks);
      
      // Считаем процент покупателей
      const totalVolume = totalBuyVolume + totalSellVolume;
      const newBuyPercent = totalVolume > 0 
        ? Math.round((totalBuyVolume / totalVolume) * 100) 
        : 50;
      setBuyPercent(newBuyPercent);
      
      // Проверяем порог для алерта
      const imbalance = Math.abs(newBuyPercent - 50) * 2; // 0-100%
      const timeSinceLastAlert = now - lastAlertTimeRef.current;
      
      if (imbalance >= IMBALANCE_THRESHOLD - 50 && timeSinceLastAlert > ALERT_COOLDOWN && totalVolume > 0) {
        setIsAlert(true);
        lastAlertTimeRef.current = now;
        
        if (soundEnabled) {
          playImbalanceSound(newBuyPercent > 50);
        }
        
        setTimeout(() => setIsAlert(false), 500);
      }
      
    }, 500); // Увеличен интервал с 200ms до 500ms

    return () => clearInterval(interval);
  }, [soundEnabled]);

  // Функция для получения цвета блока на основе интенсивности
  const getBlockColor = (block: MinuteBlock): string => {
    const total = block.buyVolume + block.sellVolume;
    if (total === 0) return 'rgba(255, 255, 255, 0.05)';
    
    const buyRatio = block.buyVolume / total;
    const isBullish = buyRatio > 0.5;
    
    // Интенсивность от 0 до 1 (насколько сильный перекос)
    const intensity = Math.abs(buyRatio - 0.5) * 2;
    
    // Альфа от 0.2 до 1 в зависимости от интенсивности
    const alpha = 0.2 + intensity * 0.8;
    
    if (isBullish) {
      return `rgba(8, 153, 129, ${alpha})`; // Зелёный
    } else {
      return `rgba(242, 54, 69, ${alpha})`; // Красный
    }
  };

  // Вычисляем позицию курсора "перетягивания"
  const tugPosition = buyPercent; // 0-100, где 50 = центр

  return (
    <div style={{
      width: '100%',
      background: 'var(--bg-card)',
      borderBottom: '1px solid var(--border)',
      padding: '6px 12px',
      flexShrink: 0,
    }}>
      {/* Верхняя строка: Tug of War + значения */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        marginBottom: '4px',
      }}>
        {/* Метка SELL */}
        <div style={{
          fontSize: '0.65rem',
          fontWeight: 600,
          color: '#f23645',
          minWidth: '28px',
        }}>
          SELL
        </div>
        
        {/* Основная полоса Tug of War */}
        <div style={{
          position: 'relative',
          flex: 1,
          height: '14px',
          background: 'rgba(255, 255, 255, 0.03)',
          borderRadius: '7px',
          overflow: 'hidden',
          border: isAlert ? '1px solid rgba(255, 215, 0, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: isAlert ? '0 0 10px rgba(255, 215, 0, 0.3)' : 'none',
          transition: 'border 0.3s, box-shadow 0.3s',
        }}>
          {/* Фон продавцов (слева) */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '50%',
            height: '100%',
            background: 'linear-gradient(to right, rgba(242, 54, 69, 0.15), rgba(242, 54, 69, 0.05))',
          }} />
          
          {/* Фон покупателей (справа) */}
          <div style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '50%',
            height: '100%',
            background: 'linear-gradient(to left, rgba(8, 153, 129, 0.15), rgba(8, 153, 129, 0.05))',
          }} />
          
          {/* Центральная линия */}
          <div style={{
            position: 'absolute',
            top: '2px',
            bottom: '2px',
            left: '50%',
            width: '2px',
            transform: 'translateX(-50%)',
            background: 'rgba(255, 255, 255, 0.3)',
            borderRadius: '1px',
          }} />
          
          {/* Заполнение в сторону победителя */}
          <div style={{
            position: 'absolute',
            top: '2px',
            bottom: '2px',
            left: buyPercent > 50 ? '50%' : `${tugPosition}%`,
            width: `${Math.abs(tugPosition - 50)}%`,
            background: buyPercent > 50 
              ? 'linear-gradient(to right, rgba(8, 153, 129, 0.4), rgba(8, 153, 129, 0.8))'
              : 'linear-gradient(to left, rgba(242, 54, 69, 0.4), rgba(242, 54, 69, 0.8))',
            borderRadius: '5px',
            transition: 'left 0.3s, width 0.3s',
          }} />
          
          {/* Курсор баланса */}
          <div style={{
            position: 'absolute',
            top: '1px',
            bottom: '1px',
            left: `${tugPosition}%`,
            width: '4px',
            transform: 'translateX(-50%)',
            background: buyPercent > 50 ? '#089981' : buyPercent < 50 ? '#f23645' : '#888',
            borderRadius: '2px',
            boxShadow: `0 0 6px ${buyPercent > 50 ? '#089981' : buyPercent < 50 ? '#f23645' : '#888'}`,
            transition: 'left 0.3s',
          }} />
        </div>
        
        {/* Метка BUY */}
        <div style={{
          fontSize: '0.65rem',
          fontWeight: 600,
          color: '#089981',
          minWidth: '24px',
        }}>
          BUY
        </div>
        
        {/* Процент перекоса */}
        <div style={{
          fontFamily: 'monospace',
          fontSize: '0.7rem',
          fontWeight: 700,
          minWidth: '65px',
          textAlign: 'right',
          color: buyPercent > 55 ? '#089981' : buyPercent < 45 ? '#f23645' : 'var(--text-muted)',
        }}>
          {buyPercent > 50 ? '+' : ''}{buyPercent - 50}% {buyPercent > 50 ? 'BUY' : buyPercent < 50 ? 'SELL' : ''}
        </div>
        
        {/* Скорость */}
        <div style={{
          fontFamily: 'monospace',
          fontSize: '0.65rem',
          color: 'var(--text-muted)',
          minWidth: '40px',
          textAlign: 'right',
        }}>
          {currentSpeed} t/s
        </div>
        
        {/* Кнопка звука */}
        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '0.8rem',
            opacity: soundEnabled ? 1 : 0.4,
            padding: '2px',
          }}
          title={soundEnabled ? 'Звук включен' : 'Звук выключен'}
        >
          {soundEnabled ? '🔔' : '🔕'}
        </button>
      </div>
      
      {/* Нижняя строка: История по минутам */}
      <div style={{
        display: 'flex',
        gap: '2px',
        height: '8px',
      }}>
        {minuteBlocks.map((block, index) => (
          <div
            key={block.minute}
            style={{
              flex: 1,
              height: '100%',
              background: getBlockColor(block),
              borderRadius: '1px',
              transition: 'background 0.3s',
            }}
            title={`${new Date(block.minute).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}: Buy ${Math.round(block.buyVolume)} / Sell ${Math.round(block.sellVolume)}`}
          />
        ))}
      </div>
      
      {/* Метки времени */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: '2px',
        fontSize: '0.55rem',
        color: 'var(--text-muted)',
        opacity: 0.5,
      }}>
        <span>-15м</span>
        <span>сейчас</span>
      </div>
    </div>
  );
}
