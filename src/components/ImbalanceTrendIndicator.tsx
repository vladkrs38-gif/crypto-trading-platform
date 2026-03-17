'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, LineData, Time, Range } from 'lightweight-charts';
import { useTradingStore } from '@/store/useTradingStore';
import { BinanceDepthStream, OrderBookData } from '@/lib/binance';

interface ImbalanceTrendData {
  time: Time;
  value: number;
  emaValue: number;
}

// EMA для сглаживания
function calculateEMA(currentValue: number, previousEMA: number, period: number): number {
  const multiplier = 2 / (period + 1);
  return currentValue * multiplier + previousEMA * (1 - multiplier);
}

// Вычисление цвета линии в зависимости от процента перевеса (70-100%)
function getHeatMapColor(imbalancePercent: number): string {
  if (!imbalancePercent || imbalancePercent < 70) {
    return '#00E5FF'; // Синий по умолчанию
  }
  
  // Нормализуем от 70% до 100% в диапазон 0-1
  const intensity = (imbalancePercent - 70) / 30; // 0 при 70%, 1 при 100%
  
  // Интерполируем от бледно-розового (#FFB3BA) до красного (#FF0000)
  const r1 = 255, g1 = 179, b1 = 186; // Бледно-розовый
  const r2 = 255, g2 = 0, b2 = 0; // Красный
  
  const r = Math.round(r1 + (r2 - r1) * intensity);
  const g = Math.round(g1 + (g2 - g1) * intensity);
  const b = Math.round(b1 + (b2 - b1) * intensity);
  
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

interface ImbalanceTrendIndicatorProps {
  externalTimeRange?: Range<Time> | null; // Используем TimeRange вместо LogicalRange для корректной синхронизации
  onChartReady?: (chart: IChartApi | null, series: ISeriesApi<'Line'> | null) => void;
  onSettingsClick?: () => void; // Callback для открытия настроек
}

export default function ImbalanceTrendIndicator({ externalTimeRange, onChartReady, onSettingsClick }: ImbalanceTrendIndicatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const trendSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const depthStreamRef = useRef<BinanceDepthStream | null>(null);
  
  // Данные индикатора
  const trendDataRef = useRef<ImbalanceTrendData[]>([]);
  const cumulativeImbalanceRef = useRef<number>(0);
  const lastEmaRef = useRef<number>(0);
  const lastCandleCountRef = useRef<number>(0); // Номер последней обработанной свечи
  const isDisposedRef = useRef<boolean>(false);
  const isInitializedRef = useRef<boolean>(false);
  const tick200ChartDataRef = useRef(tick200ChartData); // Ref для актуальных данных свечей
  const handleDepthUpdateRef = useRef<((data: OrderBookData) => void) | null>(null); // Ref для callback
  
  const [currentImbalance, setCurrentImbalance] = useState<number>(0);
  const [trend, setTrend] = useState<'bullish' | 'bearish' | 'neutral'>('neutral');
  const [cumulativeValue, setCumulativeValue] = useState<number>(0);
  
  const { 
    selectedPair, 
    showImbalanceTrend, 
    imbalanceLevels,
    imbalanceHeatMap,
    imbalanceMultiplier,
    imbalanceEmaPeriod,
    showImbalanceEma,
    showImbalanceMarkers,
    imbalanceMinStrength,
    tick200ChartData,
  } = useTradingStore();
  
  // Определяем, есть ли какие-то настройки изменены (для показа иконки)
  const hasCustomSettings = 
    imbalanceLevels !== 10 || // Уровни изменены
    imbalanceMultiplier !== 10 || // Множитель изменен
    imbalanceEmaPeriod !== 5 || // EMA период изменен
    !showImbalanceEma || // EMA выключена
    imbalanceHeatMap || // Heatmap включена
    showImbalanceMarkers; // Маркеры включены

  // Синхронизация timeScale с основным графиком - используем TimeRange для точной синхронизации по time
  useEffect(() => {
    if (!isDisposedRef.current && chartRef.current && externalTimeRange && isInitializedRef.current) {
      try {
        // setVisibleRange работает с реальными time значениями
        // Это обеспечивает точную синхронизацию даже если у индикатора меньше точек данных
        chartRef.current.timeScale().setVisibleRange(externalTimeRange);
      } catch (e) {
        // Игнорируем ошибки если нет данных в указанном диапазоне
      }
    }
  }, [externalTimeRange]);

  // Инициализация графика - при изменении режима пересоздаем
  useEffect(() => {
    if (!containerRef.current || !showImbalanceTrend) {
      // Очищаем график если индикатор выключен
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        trendSeriesRef.current = null;
        emaSeriesRef.current = null;
        isInitializedRef.current = false;
      }
      return;
    }
    
    isDisposedRef.current = false;
    
    const initChart = () => {
      if (!containerRef.current || isDisposedRef.current || chartRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        setTimeout(initChart, 100);
        return;
      }

      try {
        chartRef.current = createChart(containerRef.current, {
          width: rect.width,
          height: rect.height,
          layout: {
            background: { color: 'transparent' },
            textColor: '#787b86',
          },
          grid: {
            vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
            horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
          },
          crosshair: {
            mode: 1,
            horzLine: { visible: false }, // Только вертикальная линия
          },
          rightPriceScale: {
            borderColor: 'rgba(197, 203, 206, 0.3)',
            scaleMargins: { top: 0.1, bottom: 0.1 },
          },
          timeScale: {
            visible: false, // Скрываем timeScale полностью - синхронизация через основной график
            borderColor: 'rgba(197, 203, 206, 0.3)',
            timeVisible: false,
            secondsVisible: false,
            rightOffset: 5,
            barSpacing: 6,
            minBarSpacing: 1,
          },
          handleScroll: false,
          handleScale: false,
        });

        // Основная серия (линия)
        trendSeriesRef.current = chartRef.current.addLineSeries({
          color: '#00E5FF',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
        });

        // EMA линия (только если включена)
        if (showImbalanceEma) {
          emaSeriesRef.current = chartRef.current.addLineSeries({
            color: '#FF9800',
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
            lineStyle: 2,
          });
        } else {
          emaSeriesRef.current = null;
        }

        // ResizeObserver
        const resizeObserver = new ResizeObserver(entries => {
          if (!isDisposedRef.current && chartRef.current && entries[0]) {
            try {
              const { width, height } = entries[0].contentRect;
              chartRef.current.applyOptions({ width, height });
            } catch (e) {
              // Игнорируем
            }
          }
        });
        resizeObserver.observe(containerRef.current);
        
        isInitializedRef.current = true;
        
        // Уведомляем родителя о готовности графика
        if (onChartReady) {
          onChartReady(chartRef.current, trendSeriesRef.current);
        }
        
        // Если уже есть данные - отрисовываем
        if (trendDataRef.current.length > 0 && trendSeriesRef.current) {
          const trendLineData: LineData[] = trendDataRef.current.map(d => ({
            time: d.time,
            value: d.value,
          }));
          trendSeriesRef.current.setData(trendLineData);
          
          if (emaSeriesRef.current && showImbalanceEma) {
            const emaData: LineData[] = trendDataRef.current.map(d => ({
              time: d.time,
              value: d.emaValue,
            }));
            emaSeriesRef.current.setData(emaData);
          }
          chartRef.current.timeScale().fitContent();
        }

        return () => {
          resizeObserver.disconnect();
        };
      } catch (error) {
        // Ignore chart initialization errors
      }
    };

    const timeoutId = setTimeout(initChart, 50);

    return () => {
      isDisposedRef.current = true;
      isInitializedRef.current = false;
      clearTimeout(timeoutId);
      // Уведомляем родителя что график удаляется
      if (onChartReady) {
        onChartReady(null, null);
      }
      trendSeriesRef.current = null;
      emaSeriesRef.current = null;
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [showImbalanceTrend, showImbalanceEma, onChartReady]);

  // Обновление ref при изменении данных свечей
  useEffect(() => {
    tick200ChartDataRef.current = tick200ChartData;
  }, [tick200ChartData]);

  // Добавление новой точки при появлении новой свечи
  // Привязываемся к последней (самой правой) свече
  useEffect(() => {
    if (!showImbalanceTrend || isDisposedRef.current || !trendSeriesRef.current) return;
    if (showImbalanceEma && !emaSeriesRef.current) return;
    
    const candleCount = tick200ChartData.length;
    
    // Если свечей нет или это не новая свеча - выходим
    if (candleCount === 0 || candleCount <= lastCandleCountRef.current) return;
    
    // Запоминаем текущее количество свечей
    lastCandleCountRef.current = candleCount;
    
    // Time для новой точки = номер последней свечи (справа)
    const newTime = candleCount as Time;
    
    // Используем накопленное значение
    const newValue = cumulativeImbalanceRef.current;
    const newEma = calculateEMA(newValue, lastEmaRef.current, imbalanceEmaPeriod);
    lastEmaRef.current = newEma;
    
    const newPoint: ImbalanceTrendData = {
      time: newTime,
      value: newValue,
      emaValue: newEma,
    };
    
    trendDataRef.current.push(newPoint);
    
    // Ограничиваем историю
    if (trendDataRef.current.length > 500) {
      trendDataRef.current = trendDataRef.current.slice(-500);
    }
    
    // Добавляем точку
    if (!isDisposedRef.current) {
      try {
        if (trendSeriesRef.current) {
          // Обновляем линию
          trendSeriesRef.current.update({ time: newTime, value: newValue });
          
          // Обновляем цвет линии с учетом heatmap (без проверки порога)
          const imbalancePercent = Math.abs(currentImbalance * 100);
          
          // Обычный цвет или heatmap
          if (imbalanceHeatMap) {
            const newColor = getHeatMapColor(imbalancePercent);
            trendSeriesRef.current.applyOptions({ 
              color: newColor,
              lineStyle: 0, // Сплошная
              lineWidth: 2 // Обычная толщина
            });
          } else {
            trendSeriesRef.current.applyOptions({ 
              color: '#00E5FF', // Синий по умолчанию
              lineStyle: 0, // Сплошная
              lineWidth: 2 // Обычная толщина
            });
          }
        }
        
        if (showImbalanceEma && emaSeriesRef.current) {
          emaSeriesRef.current.update({ time: newTime, value: newEma });
        }
        
        // Для первых точек - скроллим к последней свече (справа)
        if (chartRef.current && trendDataRef.current.length <= 5) {
          chartRef.current.timeScale().scrollToPosition(0, false);
        }
      } catch (e) {
        // Игнорируем ошибки
      }
    }
  }, [tick200ChartData.length, showImbalanceTrend, imbalanceHeatMap, currentImbalance, imbalanceEmaPeriod, showImbalanceEma]);

  // Подключение к Depth Stream
  useEffect(() => {
    console.log('[ImbalanceTrendIndicator] useEffect triggered:', {
      hasPair: !!selectedPair,
      showImbalanceTrend,
      pairSymbol: selectedPair?.symbol
    });
    
    if (!selectedPair || !showImbalanceTrend) {
      if (depthStreamRef.current) {
        console.log('[ImbalanceTrendIndicator] Disconnecting stream');
        depthStreamRef.current.disconnect();
        depthStreamRef.current = null;
      }
      return;
    }

    const pairSymbol = selectedPair.symbol;
    console.log('[ImbalanceTrendIndicator] Setting up stream for:', pairSymbol);

    // Сбрасываем все данные при смене пары или включении
    trendDataRef.current = [];
    cumulativeImbalanceRef.current = 0;
    lastEmaRef.current = 0;
    setCumulativeValue(0);
    
    // Обновляем ref с актуальными данными
    tick200ChartDataRef.current = tick200ChartData;
    
    // ВАЖНО: устанавливаем lastCandleCountRef на текущее количество свечей
    // Это означает, что индикатор начнёт рисовать со СЛЕДУЮЩЕЙ свечи
    // которая будет справа (последняя = самая новая)
    lastCandleCountRef.current = tick200ChartData.length;
    
    // Очищаем графики
    if (!isDisposedRef.current) {
      try {
        if (trendSeriesRef.current) {
          trendSeriesRef.current.setData([]);
        }
        if (emaSeriesRef.current) {
          emaSeriesRef.current.setData([]);
        }
      } catch (e) {
        // Игнорируем
      }
    }

    const handleDepthUpdate = (data: OrderBookData) => {
      const timestamp = Date.now();
      console.log('[ImbalanceTrend] ====== Depth update received ======', {
        imbalance: data.imbalance,
        bidTotal: data.bidTotal,
        askTotal: data.askTotal,
        timestamp,
        candleCount: tick200ChartDataRef.current.length,
        hasData: !!data,
        dataKeys: data ? Object.keys(data) : []
      });
      
      // Проверяем, что компонент еще активен
      if (isDisposedRef.current) {
        console.log('[ImbalanceTrend] Component disposed, ignoring update');
        return;
      }
      
      const imbalancePercent = Math.abs(data.imbalance * 100);
      
      // Обновляем состояние для отображения (показываем исходное значение)
      setCurrentImbalance(data.imbalance);
      
      // Сохраняем процент перевеса для побарного режима
      // Пропорциональное накопление: чем больше перевес, тем сильнее рост
      // Используем степень 1.5 для более плавной кривой (1.0 = линейно, 1.5 = среднее, 2.0 = квадрат)
      const weight = (imbalancePercent / 100) ** 1.5;
      
      // Накапливаем пропорционально силе перевеса
      const oldCumulative = cumulativeImbalanceRef.current;
      cumulativeImbalanceRef.current += data.imbalance * 100 * weight;
      setCumulativeValue(cumulativeImbalanceRef.current);
      
      console.log('[ImbalanceTrend] Cumulative updated:', {
        old: oldCumulative,
        new: cumulativeImbalanceRef.current,
        delta: cumulativeImbalanceRef.current - oldCumulative
      });
      
      // Определяем тренд (простая логика без порога)
      if (data.imbalance > 0.01) {
        setTrend('bullish');
      } else if (data.imbalance < -0.01) {
        setTrend('bearish');
      } else {
        setTrend('neutral');
      }

      // Обновляем последнюю точку на графике в реальном времени
      // Обновляем напрямую, без requestAnimationFrame для минимальной задержки
      if (!isDisposedRef.current && trendSeriesRef.current) {
        try {
          // Используем ref для получения актуального количества свечей
          const candleCount = tick200ChartDataRef.current.length;
          console.log('[ImbalanceTrend] Updating line:', {
            candleCount,
            hasSeries: !!trendSeriesRef.current,
            isDisposed: isDisposedRef.current
          });
          
          if (candleCount > 0) {
            const currentTime = candleCount as Time;
            const newValue = cumulativeImbalanceRef.current;
            const newEma = calculateEMA(newValue, lastEmaRef.current, imbalanceEmaPeriod);
            lastEmaRef.current = newEma; // Сохраняем EMA для следующего расчета
            
            // Проверяем, есть ли уже точка для этого времени
            const existingPointIndex = trendDataRef.current.findIndex(p => p.time === currentTime);
            
            if (existingPointIndex >= 0) {
              // Обновляем существующую точку
              const oldValue = trendDataRef.current[existingPointIndex].value;
              trendDataRef.current[existingPointIndex].value = newValue;
              trendDataRef.current[existingPointIndex].emaValue = newEma;
              console.log('[ImbalanceTrend] Updating existing point:', {
                time: currentTime,
                oldValue,
                newValue,
                index: existingPointIndex
              });
            } else {
              // Создаем новую точку, если ее еще нет
              const newPoint: ImbalanceTrendData = {
                time: currentTime,
                value: newValue,
                emaValue: newEma,
              };
              trendDataRef.current.push(newPoint);
              console.log('[ImbalanceTrend] Creating new point:', {
                time: currentTime,
                value: newValue,
                totalPoints: trendDataRef.current.length
              });
              
              // Ограничиваем историю
              if (trendDataRef.current.length > 500) {
                trendDataRef.current = trendDataRef.current.slice(-500);
              }
            }
            
            // ВСЕГДА обновляем линию на графике при каждом обновлении данных
            // Используем update для обновления последней точки
            console.log('[ImbalanceTrend] Calling trendSeriesRef.current.update:', {
              time: currentTime,
              value: newValue
            });
            trendSeriesRef.current.update({ time: currentTime, value: newValue });
            
            // Дополнительно: обновляем последние 3 точки через setData для гарантии обновления
            // Это помогает, если update() не всегда срабатывает
            if (trendDataRef.current.length >= 3) {
              const lastThreePoints = trendDataRef.current.slice(-3).map(p => ({
                time: p.time,
                value: p.value
              }));
              console.log('[ImbalanceTrend] Updating last 3 points:', lastThreePoints);
              // Обновляем только последние точки, не всю линию
              lastThreePoints.forEach(point => {
                trendSeriesRef.current?.update(point);
              });
            }
            
            if (showImbalanceEma && emaSeriesRef.current) {
              emaSeriesRef.current.update({ time: currentTime, value: newEma });
              
              // То же самое для EMA
              if (trendDataRef.current.length >= 3) {
                const lastThreeEmaPoints = trendDataRef.current.slice(-3).map(p => ({
                  time: p.time,
                  value: p.emaValue
                }));
                lastThreeEmaPoints.forEach(point => {
                  emaSeriesRef.current?.update(point);
                });
              }
            }
            
            // Обновляем цвет линии с учетом heatmap (только если включен)
            if (imbalanceHeatMap) {
              const newColor = getHeatMapColor(imbalancePercent);
              trendSeriesRef.current.applyOptions({ 
                color: newColor,
                lineStyle: 0,
                lineWidth: 2
              });
            }
          } else {
            console.log('[ImbalanceTrend] No candles yet, skipping update');
          }
        } catch (e) {
          console.error('[ImbalanceTrend] Error updating line:', e);
        }
      } else {
        console.log('[ImbalanceTrend] Cannot update - series not ready:', {
          isDisposed: isDisposedRef.current,
          hasSeries: !!trendSeriesRef.current
        });
      }
    };

    // Сохраняем callback в ref, чтобы он не терялся
    handleDepthUpdateRef.current = handleDepthUpdate;
    
    console.log('[ImbalanceTrendIndicator] Creating BinanceDepthStream:', {
      symbol: pairSymbol,
      levels: imbalanceLevels,
      hasCallback: typeof handleDepthUpdate === 'function',
      hasRefCallback: !!handleDepthUpdateRef.current
    });
    
    // Используем стабильный callback через ref
    const stableCallback = (data: OrderBookData) => {
      console.log('[ImbalanceTrendIndicator] Stable callback called:', {
        hasData: !!data,
        hasRefCallback: !!handleDepthUpdateRef.current,
        isDisposed: isDisposedRef.current
      });
      
      if (handleDepthUpdateRef.current && !isDisposedRef.current) {
        handleDepthUpdateRef.current(data);
      } else {
        console.warn('[ImbalanceTrendIndicator] Cannot call callback:', {
          hasRefCallback: !!handleDepthUpdateRef.current,
          isDisposed: isDisposedRef.current
        });
      }
    };
    
    depthStreamRef.current = new BinanceDepthStream(
      pairSymbol,
      imbalanceLevels,
      stableCallback
    );
    
    console.log('[ImbalanceTrendIndicator] Stream created, connecting...');
    depthStreamRef.current.connect().catch((error) => {
      console.error('[ImbalanceTrendIndicator] Failed to connect depth stream:', error);
    });

    return () => {
      console.log('[ImbalanceTrendIndicator] Cleaning up stream');
      if (depthStreamRef.current) {
        depthStreamRef.current.disconnect();
        depthStreamRef.current = null;
      }
      handleDepthUpdateRef.current = null;
    };
  }, [selectedPair?.symbol, showImbalanceTrend, imbalanceLevels]);

  // Обновление цвета линии при изменении heatmap
  useEffect(() => {
    if (!trendSeriesRef.current) return;
    
    try {
      const imbalancePercent = Math.abs(currentImbalance * 100);
      
      // Обычный цвет или heatmap (без проверки порога)
      if (imbalanceHeatMap) {
        const newColor = getHeatMapColor(imbalancePercent);
        trendSeriesRef.current.applyOptions({ 
          color: newColor,
          lineWidth: 2 // Обычная толщина
        });
      } else {
        trendSeriesRef.current.applyOptions({ 
          color: '#00E5FF', // Синий по умолчанию
          lineWidth: 2 // Обычная толщина
        });
      }
    } catch (e) {
      // Игнорируем ошибки
    }
  }, [imbalanceHeatMap, currentImbalance]);

  if (!showImbalanceTrend) {
    return null;
  }

  const imbalancePercent = Math.abs(currentImbalance * 100);
  
  // Цвет для заголовка (без проверки порога)
  const imbalanceColor = trend === 'bullish' ? '#26a69a' : trend === 'bearish' ? '#ef5350' : '#787b86';

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '150px',
      borderTop: '1px solid var(--border-color)',
    }}>
      <div style={{ 
        padding: '4px 8px', 
        background: 'var(--bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '0.75rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--text-muted)' }}>
            Imbalance Trend ({imbalanceLevels} lvl)
          </span>
          {/* Иконка настроек - показываем если есть кастомные настройки или всегда показываем для доступа */}
          {onSettingsClick && (
            <button
              onClick={onSettingsClick}
              title="Настройки индикатора"
              style={{
                background: hasCustomSettings 
                  ? 'rgba(0, 212, 255, 0.2)' 
                  : 'rgba(0, 212, 255, 0.1)',
                border: `1px solid ${hasCustomSettings ? 'rgba(0, 212, 255, 0.5)' : 'rgba(0, 212, 255, 0.3)'}`,
                borderRadius: '4px',
                padding: '2px 6px',
                fontSize: '0.65rem',
                color: hasCustomSettings ? '#00d4ff' : 'rgba(0, 212, 255, 0.7)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                fontWeight: hasCustomSettings ? 600 : 400,
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(0, 212, 255, 0.25)';
                e.currentTarget.style.borderColor = 'rgba(0, 212, 255, 0.6)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = hasCustomSettings 
                  ? 'rgba(0, 212, 255, 0.2)' 
                  : 'rgba(0, 212, 255, 0.1)';
                e.currentTarget.style.borderColor = hasCustomSettings 
                  ? 'rgba(0, 212, 255, 0.5)' 
                  : 'rgba(0, 212, 255, 0.3)';
              }}
            >
              ⚙️{hasCustomSettings ? ' *' : ''}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ color: imbalanceColor, fontWeight: 'bold' }}>
            {trend === 'bullish' ? '▲' : trend === 'bearish' ? '▼' : '◆'} {imbalancePercent.toFixed(1)}%
            <span style={{ color: 'var(--text-muted)', marginLeft: '4px', fontWeight: 'normal' }}>
              {trend === 'bullish' ? 'Покупатели' : trend === 'bearish' ? 'Продавцы' : 'Баланс'}
            </span>
          </span>
          <span style={{ 
            color: cumulativeValue >= 0 ? '#26a69a' : '#ef5350',
          }}>
            Тренд: {cumulativeValue >= 0 ? '+' : ''}{cumulativeValue.toFixed(0)}
          </span>
        </div>
      </div>
      
      <div ref={containerRef} style={{ width: '100%', flex: 1, minHeight: 0 }} />
    </div>
  );
}
