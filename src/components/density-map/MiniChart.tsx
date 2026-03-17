'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, IPriceLine } from 'lightweight-charts';
import type { Density } from '@/types/density';
import { getMiniChartCandles, formatAmount, formatDissolutionTime, getDensityHint } from '@/lib/densityScanner';
import { useDensityMapStore } from '@/store/useDensityMapStore';

interface MiniChartProps {
  density: Density;
  oppositeDensity?: Density | null;
  position: { x: number; y: number };
  timeframe: string;
  bars: number;
  isPinned?: boolean;
  onClose?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onOpenInScreener?: (density: Density) => void;
}

export default function MiniChart({ 
  density, 
  oppositeDensity,
  position, 
  timeframe, 
  bars,
  isPinned = false,
  onClose,
  onMouseEnter,
  onMouseLeave,
  onOpenInScreener,
}: MiniChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const oppositePriceLineRef = useRef<IPriceLine | null>(null);
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isChartReady, setIsChartReady] = useState(false);
  const { setMiniChartData, setIsMiniChartLoading } = useDensityMapStore();
  
  const hint = getDensityHint(density);
  const isBuy = density.type === 'buy';
  
  const loadChartData = useCallback(async () => {
    if (!candleSeriesRef.current || !chartRef.current) return;
    
    setIsLoading(true);
    setIsMiniChartLoading(true);
    setError(null);
    
    try {
      const candles = await getMiniChartCandles(
        density.symbol,
        density.exchange,
        timeframe,
        bars
      );
      
      if (candles.length === 0) {
        setError('Нет данных');
        return;
      }
      
      // Проверяем что компонент не размонтирован после await
      if (!candleSeriesRef.current || !chartRef.current) return;
      
      // Устанавливаем данные свечей
      const candleData: CandlestickData[] = candles.map(c => ({
        time: c.time as any,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      candleSeriesRef.current.setData(candleData);
      
      // Удаляем старую линию если есть
      if (priceLineRef.current) {
        candleSeriesRef.current.removePriceLine(priceLineRef.current);
      }
      
      // Создаём горизонтальную линию цены плотности (идёт вправо)
      priceLineRef.current = candleSeriesRef.current.createPriceLine({
        price: density.price,
        color: isBuy ? '#22c55e' : '#ef4444',
        lineWidth: 2,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: isBuy ? 'BUY' : 'SELL',
      });
      
      // Подгоняем масштаб
      chartRef.current.timeScale().fitContent();
      
      setMiniChartData({
        symbol: density.symbol,
        exchange: density.exchange,
        candles,
        densityPrice: density.price,
      });
    } catch (err) {
      setError('Ошибка загрузки');
      console.error('[MiniChart] Load error:', err);
    } finally {
      setIsLoading(false);
      setIsMiniChartLoading(false);
    }
  }, [density.symbol, density.exchange, density.price, timeframe, bars, isBuy, setMiniChartData, setIsMiniChartLoading]);
  
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;
    
    // Ждём следующий кадр чтобы контейнер был в DOM
    const timeoutId = setTimeout(() => {
      // Проверяем размеры контейнера
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        console.warn('[MiniChart] Container has zero size');
        return;
      }
      
      try {
        // Создаём график с возможностью взаимодействия
        const chart = createChart(container, {
          width: 400,
          height: 220,
          layout: {
            background: { color: '#1a1a2e' },
            textColor: '#9ca3af',
          },
          grid: {
            vertLines: { color: 'rgba(75, 85, 99, 0.2)' },
            horzLines: { color: 'rgba(75, 85, 99, 0.2)' },
          },
          crosshair: {
            mode: 1,
          },
          rightPriceScale: {
            borderColor: 'rgba(75, 85, 99, 0.3)',
            scaleMargins: {
              top: 0.1,
              bottom: 0.1,
            },
          },
          timeScale: {
            borderColor: 'rgba(75, 85, 99, 0.3)',
            timeVisible: true,
            secondsVisible: false,
          },
          // Разрешаем взаимодействие
          handleScale: true,
          handleScroll: true,
        });
        
        chartRef.current = chart;
        
        // Свечной ряд
        const candleSeries = chart.addCandlestickSeries({
          upColor: '#22c55e',
          downColor: '#ef4444',
          borderUpColor: '#22c55e',
          borderDownColor: '#ef4444',
          wickUpColor: '#22c55e',
          wickDownColor: '#ef4444',
        });
        candleSeriesRef.current = candleSeries;
        
        setIsChartReady(true);
      } catch (err) {
        console.error('[MiniChart] Chart creation error:', err);
        setError('Ошибка создания графика');
      }
    }, 50);
    
    return () => {
      clearTimeout(timeoutId);
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch (e) {
          // Игнорируем ошибки при удалении
        }
        chartRef.current = null;
        candleSeriesRef.current = null;
        priceLineRef.current = null;
        oppositePriceLineRef.current = null;
      }
      setIsChartReady(false);
    };
  }, []);
  
  // Загружаем данные когда график готов
  useEffect(() => {
    if (isChartReady) {
      loadChartData();
    }
  }, [isChartReady, loadChartData]);
  
  // Отдельный useEffect для линии противоположной плотности (не перезагружает данные)
  useEffect(() => {
    if (!candleSeriesRef.current || !isChartReady) return;
    
    // Удаляем старую противоположную линию если есть
    if (oppositePriceLineRef.current) {
      try {
        candleSeriesRef.current.removePriceLine(oppositePriceLineRef.current);
      } catch (e) {
        // Игнорируем ошибки
      }
      oppositePriceLineRef.current = null;
    }
    
    // Если есть противоположная плотность - показываем её
    if (oppositeDensity) {
      const isOppositeBuy = oppositeDensity.type === 'buy';
      oppositePriceLineRef.current = candleSeriesRef.current.createPriceLine({
        price: oppositeDensity.price,
        color: isOppositeBuy ? '#22c55e' : '#ef4444',
        lineWidth: 1,
        lineStyle: 3, // Dotted - чтобы отличалась от основной
        axisLabelVisible: true,
        title: isOppositeBuy ? 'BUY' : 'SELL',
      });
    }
  }, [oppositeDensity?.id, oppositeDensity?.price, isChartReady]);
  
  // Рассчитываем позицию tooltip
  const tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    left: position.x,
    top: position.y - 180,
    zIndex: 1000,
    background: '#1a1a2e',
    border: isPinned ? '2px solid var(--accent)' : '1px solid var(--border)',
    borderRadius: 12,
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
    overflow: 'hidden',
    minWidth: 400,
  };
  
  // Корректируем позицию если выходит за экран
  if (typeof window !== 'undefined') {
    if (position.x + 410 > window.innerWidth) {
      tooltipStyle.left = position.x - 420;
    }
    if (position.y - 180 < 0) {
      tooltipStyle.top = position.y + 50;
    }
    if ((tooltipStyle.top as number) + 500 > window.innerHeight) {
      tooltipStyle.top = window.innerHeight - 520;
    }
  }
  
  return (
    <div 
      style={tooltipStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Заголовок */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: isPinned ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: '1rem',
              fontWeight: 700,
              color: 'var(--text-main)',
            }}
            title={`Добавить в ЧС: ${density.symbol}`}
          >
            {density.symbol}
          </span>
          <span
            style={{
              fontSize: '0.7rem',
              padding: '2px 6px',
              borderRadius: 4,
              background: isBuy ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
              color: isBuy ? '#22c55e' : '#ef4444',
              fontWeight: 600,
            }}
          >
            {isBuy ? 'BUY' : 'SELL'}
          </span>
          <span
            style={{
              fontSize: '0.65rem',
              padding: '2px 6px',
              borderRadius: 4,
              background: 'rgba(251, 191, 36, 0.2)',
              color: '#fbbf24',
              textTransform: 'uppercase',
            }}
          >
            {density.exchange}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {timeframe} • {bars} bars
          </span>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'rgba(239, 68, 68, 0.2)',
                border: 'none',
                borderRadius: 4,
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#ef4444',
                fontSize: '1rem',
                fontWeight: 'bold',
                transition: 'background 0.2s',
              }}
              onMouseOver={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.4)'}
              onMouseOut={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
            >
              ✕
            </button>
          )}
        </div>
      </div>
      
      {/* График */}
      <div
        ref={chartContainerRef}
        style={{
          width: 400,
          height: 220,
          position: 'relative',
          minWidth: 400,
          minHeight: 220,
          cursor: 'crosshair',
        }}
      >
        {isLoading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(26, 26, 46, 0.8)',
              zIndex: 10,
            }}
          >
            <div className="loading-spinner" />
          </div>
        )}
        {error && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--down)',
              fontSize: '0.8rem',
              zIndex: 10,
            }}
          >
            {error}
          </div>
        )}
      </div>
      
      {/* Информация о плотности */}
      <div
        style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--border)',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10,
          fontSize: '0.7rem',
        }}
      >
        <div>
          <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Цена плотности</div>
          <div style={{ color: isBuy ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
            ${density.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Дистанция</div>
          <div style={{ color: 'var(--text-main)', fontWeight: 600 }}>
            {density.distancePercent.toFixed(2)}%
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Время разъед.</div>
          <div style={{ color: '#a78bfa', fontWeight: 600 }}>
            {formatDissolutionTime(density.dissolutionTime)}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Сумма</div>
          <div style={{ color: 'var(--text-main)', fontWeight: 600 }}>
            {formatAmount(density.amountUSD)}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Монет</div>
          <div style={{ color: 'var(--text-main)', fontWeight: 600 }}>
            {density.amountCoins.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>Текущая цена</div>
          <div style={{ color: 'var(--text-main)', fontWeight: 600 }}>
            ${density.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
          </div>
        </div>
      </div>
      
      {/* Противоположная плотность */}
      {oppositeDensity && (
        <div
          style={{
            padding: '8px 14px',
            borderTop: '1px solid var(--border)',
            background: oppositeDensity.type === 'buy' 
              ? 'rgba(34, 197, 94, 0.05)' 
              : 'rgba(239, 68, 68, 0.05)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.7rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                padding: '2px 5px',
                borderRadius: 3,
                background: oppositeDensity.type === 'buy' 
                  ? 'rgba(34, 197, 94, 0.2)' 
                  : 'rgba(239, 68, 68, 0.2)',
                color: oppositeDensity.type === 'buy' ? '#22c55e' : '#ef4444',
                fontWeight: 600,
                fontSize: '0.6rem',
              }}
            >
              {oppositeDensity.type === 'buy' ? 'BUY' : 'SELL'}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
              Противоположная плотность
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: oppositeDensity.type === 'buy' ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
              ${oppositeDensity.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
              {oppositeDensity.distancePercent.toFixed(2)}%
            </span>
            <span style={{ color: '#a78bfa' }}>
              {formatDissolutionTime(oppositeDensity.dissolutionTime)}
            </span>
          </div>
        </div>
      )}
      
      {/* AI Подсказка */}
      <div
        style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--border)',
          background: hint.type === 'bounce' 
            ? 'rgba(34, 197, 94, 0.1)' 
            : hint.type === 'breakout'
              ? 'rgba(239, 68, 68, 0.1)'
              : 'rgba(107, 114, 128, 0.1)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: '0.75rem',
          }}
        >
          <span
            style={{
              fontSize: '1rem',
            }}
          >
            {hint.type === 'bounce' ? '🎯' : hint.type === 'breakout' ? '💥' : '👁️'}
          </span>
          <span
            style={{
              color: hint.type === 'bounce' 
                ? '#22c55e' 
                : hint.type === 'breakout'
                  ? '#ef4444'
                  : 'var(--text-muted)',
              fontWeight: 500,
            }}
          >
            {hint.message}
          </span>
        </div>
      </div>
      
      {/* Кнопка открыть в скринере */}
      {onOpenInScreener && (
        <div
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--border)',
          }}
        >
          <button
            onClick={() => onOpenInScreener(density)}
            style={{
              width: '100%',
              padding: '10px 16px',
              background: 'var(--accent)',
              border: 'none',
              borderRadius: 8,
              color: 'white',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'opacity 0.2s',
            }}
            onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
          >
            Открыть в скринере →
          </button>
        </div>
      )}
    </div>
  );
}
