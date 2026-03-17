'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time, CrosshairMode, SeriesMarker } from 'lightweight-charts';
import { useTradingStore, usePriceLevelsStore } from '@/store/useTradingStore';
import { BinanceKlineStream, getKlines, getKlinesInitial, getKlinesBeforeTime, timeframeToInterval, timeframeToMinutes, getKlinesWithPeriod } from '@/lib/binance';
import { getBybitKlinesFull, getBybitKlinesBeforeTime, BybitKlineStream, getBybitKlinesWithPeriod } from '@/lib/bybit';
import type { CandleData } from '@/types/binance';
import { getPriceFormatFromRange } from '@/lib/chartPriceFormat';
import { useDrawingTools, DrawingToolbar } from './DrawingTools';
import { useDomSurfaceStore, runApexSimulation, runApexIncremental, runKanalSimulation } from '@/store/useDomSurfaceStore';

// Форматирование цены для шкалы (адаптивная точность)
function formatPriceValue(price: number): string {
  if (!isFinite(price)) return '';
  const absPrice = Math.abs(price);
  if (absPrice < 0.0001) return price.toFixed(8);
  if (absPrice < 0.01) return price.toFixed(6);
  if (absPrice < 1) return price.toFixed(6);
  if (absPrice < 100) return price.toFixed(4);
  if (absPrice < 10000) return price.toFixed(2);
  return price.toFixed(0);
}

/** Расчёт данных Delta Rotation по свечам (для немедленного отображения при открытии панели). */
function computeDeltaRotationDataFromCandles(
  candles: CandleData[],
  threshold: number
): { time: Time; value: number; color: string }[] {
  const data: { time: Time; value: number; color: string }[] = [];
  let cumDelta = 0;
  let currentTrend = 0;
  let prevPrice: number | null = null;

  for (const candle of candles) {
    const timeValue =
      typeof candle.time === 'number' && !isNaN(candle.time)
        ? Math.floor(candle.time)
        : typeof candle.time === 'string'
          ? Math.floor(parseFloat(candle.time))
          : null;
    if (timeValue == null || !isFinite(timeValue)) continue;

    const close = typeof candle.close === 'number' ? candle.close : parseFloat(String(candle.close));
    const barDelta = candle.barDelta ?? 0;
    const time = timeValue as Time;

    let priceDirection = 0;
    if (prevPrice !== null) {
      if (close > prevPrice) priceDirection = 1;
      else if (close < prevPrice) priceDirection = -1;
    }

    let isRotation = false;
    if (currentTrend === 0) {
      isRotation = true;
    } else if (currentTrend === 1) {
      if (priceDirection === -1 || barDelta < -threshold) isRotation = true;
    } else if (currentTrend === -1) {
      if (priceDirection === 1 || barDelta > threshold) isRotation = true;
    }

    if (isRotation) {
      currentTrend = priceDirection !== 0 ? priceDirection : barDelta > 0 ? 1 : -1;
      cumDelta = barDelta;
    } else {
      cumDelta += barDelta;
    }

    const color = currentTrend === 1 ? '#3b82f6' : '#ef4444';
    data.push({ time, value: cumDelta, color });
    prevPrice = close;
  }

  return data;
}

// Функция для воспроизведения приятного звукового сигнала
function playAlertSound() {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

    // Создаём приятный двухтональный звук
    const playTone = (frequency: number, startTime: number, duration: number) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime + startTime);

      // Плавное нарастание и затухание
      gainNode.gain.setValueAtTime(0, audioContext.currentTime + startTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + startTime + 0.05);
      gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + startTime + duration);

      oscillator.start(audioContext.currentTime + startTime);
      oscillator.stop(audioContext.currentTime + startTime + duration);
    };

    // Два тона для приятного звучания
    playTone(880, 0, 0.15); // A5
    playTone(1108.73, 0.1, 0.2); // C#6
  } catch (e) {
    console.log('Audio not supported');
  }
}

// Модальное окно настроек КД
function CumulativeDeltaSettingsModal({
  isOpen,
  onClose
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const showCumulativeDeltaTrend = useTradingStore((state) => state.showCumulativeDeltaTrend);
  const setShowCumulativeDeltaTrend = useTradingStore((state) => state.setShowCumulativeDeltaTrend);
  const cumulativeDeltaTrendPeriod = useTradingStore((state) => state.cumulativeDeltaTrendPeriod);
  const setCumulativeDeltaTrendPeriod = useTradingStore((state) => state.setCumulativeDeltaTrendPeriod);
  const cumulativeDeltaTrendOffset = useTradingStore((state) => state.cumulativeDeltaTrendOffset);
  const setCumulativeDeltaTrendOffset = useTradingStore((state) => state.setCumulativeDeltaTrendOffset);
  const cumulativeDeltaDisplayMode = useTradingStore((state) => state.cumulativeDeltaDisplayMode);
  const setCumulativeDeltaDisplayMode = useTradingStore((state) => state.setCumulativeDeltaDisplayMode);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '20px',
          minWidth: '360px',
          maxWidth: '450px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
          paddingBottom: '12px',
          borderBottom: '1px solid var(--border)',
        }}>
          <h3 style={{
            margin: 0,
            color: '#f0b90b',
            fontSize: '1rem',
            fontWeight: 600,
          }}>
            ⚙️ Настройки кумулятивной дельты
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Режим отображения */}
          <div style={{
            padding: '12px',
            background: 'var(--bg-main)',
            borderRadius: '8px',
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '10px' }}>
              Режим отображения
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setCumulativeDeltaDisplayMode('candle')}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  background: cumulativeDeltaDisplayMode === 'candle' ? 'rgba(240, 185, 11, 0.2)' : 'var(--bg-card)',
                  border: `2px solid ${cumulativeDeltaDisplayMode === 'candle' ? '#f0b90b' : 'var(--border)'}`,
                  borderRadius: '8px',
                  color: cumulativeDeltaDisplayMode === 'candle' ? '#f0b90b' : 'var(--text-main)',
                  cursor: 'pointer',
                  fontWeight: cumulativeDeltaDisplayMode === 'candle' ? 600 : 400,
                  fontSize: '0.85rem',
                }}
              >
                📊 Свечи
              </button>
              <button
                onClick={() => setCumulativeDeltaDisplayMode('line')}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  background: cumulativeDeltaDisplayMode === 'line' ? 'rgba(240, 185, 11, 0.2)' : 'var(--bg-card)',
                  border: `2px solid ${cumulativeDeltaDisplayMode === 'line' ? '#f0b90b' : 'var(--border)'}`,
                  borderRadius: '8px',
                  color: cumulativeDeltaDisplayMode === 'line' ? '#f0b90b' : 'var(--text-main)',
                  cursor: 'pointer',
                  fontWeight: cumulativeDeltaDisplayMode === 'line' ? 600 : 400,
                  fontSize: '0.85rem',
                }}
              >
                📈 Линия
              </button>
            </div>
          </div>

          {/* Разделитель - Тренд */}
          <div style={{
            borderTop: '1px solid var(--border)',
            paddingTop: '16px',
            marginTop: '4px',
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Линия тренда
            </div>
          </div>

          {/* Включить/выключить тренд */}
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            cursor: 'pointer',
            padding: '8px 12px',
            background: 'var(--bg-main)',
            borderRadius: '8px',
          }}>
            <input
              type="checkbox"
              checked={showCumulativeDeltaTrend}
              onChange={(e) => setShowCumulativeDeltaTrend(e.target.checked)}
              style={{
                cursor: 'pointer',
                width: '18px',
                height: '18px',
                accentColor: '#f0b90b',
              }}
            />
            <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>
              Показывать линию тренда
            </span>
          </label>

          {/* Период */}
          <div style={{
            padding: '12px',
            background: 'var(--bg-main)',
            borderRadius: '8px',
            opacity: showCumulativeDeltaTrend ? 1 : 0.5,
          }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Период (свечей)
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="range"
                  min={3}
                  max={500}
                  value={cumulativeDeltaTrendPeriod}
                  onChange={(e) => setCumulativeDeltaTrendPeriod(parseInt(e.target.value))}
                  disabled={!showCumulativeDeltaTrend}
                  style={{
                    flex: 1,
                    cursor: showCumulativeDeltaTrend ? 'pointer' : 'not-allowed',
                    accentColor: '#f0b90b',
                  }}
                />
                <input
                  type="number"
                  min={3}
                  max={500}
                  value={cumulativeDeltaTrendPeriod}
                  onChange={(e) => setCumulativeDeltaTrendPeriod(Math.max(3, Math.min(500, parseInt(e.target.value) || 14)))}
                  disabled={!showCumulativeDeltaTrend}
                  style={{
                    width: '70px',
                    padding: '6px 8px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    color: 'var(--text-main)',
                    fontSize: '0.9rem',
                    textAlign: 'center',
                  }}
                />
              </div>
            </label>
          </div>

          {/* Отступ */}
          <div style={{
            padding: '12px',
            background: 'var(--bg-main)',
            borderRadius: '8px',
            opacity: showCumulativeDeltaTrend ? 1 : 0.5,
          }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Отступ от КД (%)
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={cumulativeDeltaTrendOffset}
                  onChange={(e) => setCumulativeDeltaTrendOffset(parseInt(e.target.value))}
                  disabled={!showCumulativeDeltaTrend}
                  style={{
                    flex: 1,
                    cursor: showCumulativeDeltaTrend ? 'pointer' : 'not-allowed',
                    accentColor: '#f0b90b',
                  }}
                />
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={cumulativeDeltaTrendOffset}
                  onChange={(e) => setCumulativeDeltaTrendOffset(Math.max(0, Math.min(50, parseInt(e.target.value) || 15)))}
                  disabled={!showCumulativeDeltaTrend}
                  style={{
                    width: '70px',
                    padding: '6px 8px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    color: 'var(--text-main)',
                    fontSize: '0.9rem',
                    textAlign: 'center',
                  }}
                />
              </div>
            </label>
          </div>

          {/* Легенда */}
          <div style={{
            padding: '12px',
            background: 'rgba(240, 185, 11, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(240, 185, 11, 0.2)',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Как читать тренд:
            </div>
            <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '12px', height: '12px', background: '#3fb950', borderRadius: '2px' }} />
                <span style={{ color: 'var(--text-main)' }}>Восходящий (снизу)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '12px', height: '12px', background: '#f85149', borderRadius: '2px' }} />
                <span style={{ color: 'var(--text-main)' }}>Нисходящий (сверху)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Функция для форматирования обратного отсчёта
function formatCountdown(seconds: number, timeframe: string): string {
  if (seconds <= 0) return '00:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  // Для дневного и 4-часового таймфрейма показываем часы
  if (timeframe === 'D' || timeframe === '240') {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // Для часового показываем минуты:секунды если меньше часа, иначе часы
  if (timeframe === '60' && hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // Для остальных - минуты:секунды
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Функция для получения интервала в секундах
function getIntervalSeconds(timeframe: string): number {
  switch (timeframe) {
    case '1': return 60;
    case '5': return 300;
    case '15': return 900;
    case '60': return 3600;
    case '240': return 14400;
    case 'D': return 86400;
    default: return 60;
  }
}

export default function Chart() {
  // Состояние модального окна настроек тренда
  const [isTrendSettingsOpen, setIsTrendSettingsOpen] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  // Состояние для обратного отсчёта
  const [countdown, setCountdown] = useState<string>('--:--');
  // Позиция Y для метки таймера (следует за текущей ценой)
  const [priceY, setPriceY] = useState<number | null>(null);
  // Текущая цена и направление для кастомной метки
  const [displayPrice, setDisplayPrice] = useState<number>(0);
  const [isBullish, setIsBullish] = useState<boolean>(true);

  // Store для уровней
  const { addLevel, removeLevel, getLevels } = usePriceLevelsStore();

  // Refs для уровней и сделок
  const levelsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tradesCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastAlertTimeRef = useRef<Record<string, number>>({});
  const currentPriceRef = useRef<number>(0);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const barDeltaContainerRef = useRef<HTMLDivElement>(null);
  const deltaRotationContainerRef = useRef<HTMLDivElement>(null);
  const cumulativeDeltaContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const barDeltaChartRef = useRef<IChartApi | null>(null);
  const deltaRotationChartRef = useRef<IChartApi | null>(null);
  const cumulativeDeltaChartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const bollingerUpperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollingerMiddleRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollingerLowerRef = useRef<ISeriesApi<'Line'> | null>(null);
  const updateBollingerBandsRef = useRef<((candles?: CandleData[]) => void) | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const barDeltaSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const deltaRotationSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const cumulativeDeltaLineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const cumulativeDeltaCandleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const cumulativeDeltaTrendSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const klineStreamRef = useRef<BinanceKlineStream | BybitKlineStream | null>(null);
  const currentPairRef = useRef<string | null>(null);
  const currentTimeframeRef = useRef<string | null>(null);
  const chartDataRef = useRef<CandleData[]>([]);
  const cumulativeDeltaRef = useRef<number>(0);
  const hasRestoredDataRef = useRef<boolean>(false);

  // Refs для динамической подгрузки истории при зуме
  const isLoadingMoreRef = useRef<boolean>(false);
  const oldestCandleTimeRef = useRef<number | null>(null);
  const canLoadMoreRef = useRef<boolean>(true); // false если дошли до конца истории
  const loadMoreHistoryRef = useRef<() => void>(() => {});

  // Refs для Delta Rotation
  const cumDeltaRef = useRef<number>(0);
  const currentTrendRef = useRef<number>(0); // 1 = UP (Синий), -1 = DOWN (Красный), 0 = начальное
  const prevPriceRef = useRef<number | null>(null);

  // Refs для настроек тренда (чтобы избежать пересоздания callbacks)
  const trendPeriodRef = useRef<number>(14);
  const trendOffsetRef = useRef<number>(15);

  // Refs для панелей (для ресайза)
  const barDeltaPanelRef = useRef<HTMLDivElement>(null);
  const deltaRotationPanelRef = useRef<HTMLDivElement>(null);
  const cumulativeDeltaPanelRef = useRef<HTMLDivElement>(null);

  const {
    selectedPair,
    timeframe,
    chartPeriod,
    isLabMode,
    chartData,
    chartDataFitTrigger,
    isLoadingChart,
    setChartData,
    setIsLoadingChart,
    showBarDeltaStandard,
    showDeltaRotationStandard,
    showCumulativeDeltaStandard,
    showCumulativeDeltaTrend,
    cumulativeDeltaTrendPeriod,
    cumulativeDeltaTrendOffset,
    cumulativeDeltaDisplayMode,
    deltaRotationThreshold,
  } = useTradingStore();

  // Лаборатория: сделки и параметры бота
  const {
    mode: labMode,
    botType: labBotType,
    trades: labTrades,
    apexParams,
    kanalParams,
    initialEquity: labInitialEquity,
    setSimulationResult,
    setLiveState,
    appendLiveTrades,
    setLiveModeStartTradeCount,
  } = useDomSurfaceStore((state) => ({
    mode: state.mode,
    botType: state.botType,
    trades: state.trades,
    apexParams: state.apexParams,
    kanalParams: state.kanalParams,
    initialEquity: state.initialEquity,
    setSimulationResult: state.setSimulationResult,
    setLiveState: state.setLiveState,
    appendLiveTrades: state.appendLiveTrades,
    setLiveModeStartTradeCount: state.setLiveModeStartTradeCount,
  }));

  // Инструменты рисования
  const {
    activeTool,
    setActiveTool,
    drawings,
    clearAllDrawings,
    extendDrawings,
  } = useDrawingTools({
    chartRef: chartRef as React.RefObject<IChartApi | null>,
    seriesRef: seriesRef as React.RefObject<ISeriesApi<'Candlestick'> | null>,
    containerRef: chartContainerRef,
  });

  // Обновляем refs при изменении настроек
  useEffect(() => {
    trendPeriodRef.current = cumulativeDeltaTrendPeriod;
  }, [cumulativeDeltaTrendPeriod]);

  useEffect(() => {
    trendOffsetRef.current = cumulativeDeltaTrendOffset;
  }, [cumulativeDeltaTrendOffset]);

  // Обратный отсчёт до закрытия свечи и позиция метки цены
  // ОПТИМИЗАЦИЯ: используем requestAnimationFrame вместо частого setInterval
  useEffect(() => {
    const intervalSeconds = timeframe !== '200t' ? getIntervalSeconds(timeframe) : 0;
    let rafId: number | null = null;
    let lastPriceUpdate = 0;

    const updateCountdown = () => {
      if (timeframe === '200t') {
        setCountdown('--:--');
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const remaining = intervalSeconds - (now % intervalSeconds);
      setCountdown(formatCountdown(remaining, timeframe));
    };

    const updatePriceY = (timestamp: number) => {
      // Throttle: обновляем позицию не чаще чем раз в 250ms (было 100ms)
      if (timestamp - lastPriceUpdate >= 250) {
        lastPriceUpdate = timestamp;
        // Обновляем Y-позицию метки цены
        if (seriesRef.current && currentPriceRef.current > 0) {
          const y = seriesRef.current.priceToCoordinate(currentPriceRef.current);
          setPriceY(y);
          setDisplayPrice(currentPriceRef.current);

          // Определяем направление по последней свече
          const data = chartDataRef.current;
          if (data.length > 0) {
            const lastCandle = data[data.length - 1];
            setIsBullish(lastCandle.close >= lastCandle.open);
          }
        }
      }
      rafId = requestAnimationFrame(updatePriceY);
    };

    // Обновляем сразу
    updateCountdown();
    rafId = requestAnimationFrame(updatePriceY);

    // Обновляем время каждую секунду
    const countdownInterval = setInterval(updateCountdown, 1000);

    return () => {
      clearInterval(countdownInterval);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [timeframe]);

  // Обработчик правой кнопки мыши - добавляет уровень (магнит к HIGH или LOW в зависимости от позиции клика)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    if (!chartRef.current || !seriesRef.current || !chartContainerRef.current || !selectedPair) return;

    const rect = chartContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Получаем время по координатам X
    const clickTime = chartRef.current.timeScale().coordinateToTime(x);
    if (clickTime === null) return;

    const clickTimeNum = clickTime as number;

    // Получаем цену по координатам Y
    const clickPrice = seriesRef.current.coordinateToPrice(y);
    if (clickPrice === null) return;

    const clickPriceNum = clickPrice as number;

    // Находим ближайшую свечу к точке клика
    const candles = chartDataRef.current;
    if (candles.length === 0) return;

    // Находим индекс ближайшей свечи
    let nearestIndex = 0;
    let minDiff = Math.abs(candles[0].time - clickTimeNum);

    for (let i = 0; i < candles.length; i++) {
      const diff = Math.abs(candles[i].time - clickTimeNum);
      if (diff < minDiff) {
        minDiff = diff;
        nearestIndex = i;
      }
    }

    // Берём 15 свечей вокруг (±7)
    const startIdx = Math.max(0, nearestIndex - 7);
    const endIdx = Math.min(candles.length - 1, nearestIndex + 7);

    // Определяем тип уровня по позиции клика относительно ближайшей свечи
    const nearestCandle = candles[nearestIndex];
    const candleMidPrice = (nearestCandle.high + nearestCandle.low) / 2;
    const isLongLevel = clickPriceNum >= candleMidPrice; // Клик выше середины свечи = лонг (HIGH)

    let targetCandle = candles[startIdx];

    if (isLongLevel) {
      // Ищем максимальный HIGH среди 15 свечей (для лонгового уровня)
      for (let i = startIdx; i <= endIdx; i++) {
        if (candles[i].high > targetCandle.high) {
          targetCandle = candles[i];
        }
      }
    } else {
      // Ищем минимальный LOW среди 15 свечей (для шортового уровня)
      for (let i = startIdx; i <= endIdx; i++) {
        if (candles[i].low < targetCandle.low) {
          targetCandle = candles[i];
        }
      }
    }

    // Магнитим уровень к HIGH или LOW
    const levelPrice = isLongLevel ? targetCandle.high : targetCandle.low;
    const startTime = targetCandle.time;

    // Добавляем уровень: белый для лонга, красный для шорта
    const levelColor = isLongLevel ? '#ffffff' : '#f23645';
    addLevel(selectedPair.symbol, levelPrice, startTime, levelColor);
  }, [selectedPair, addLevel]);

  // Получаем уровни для текущей пары
  const currentLevels = selectedPair ? getLevels(selectedPair.symbol) : [];

  // Функция отрисовки уровней на canvas (лучи от точки вправо)
  const drawLevels = useCallback(() => {
    const canvas = levelsCanvasRef.current;
    const chart = chartRef.current;
    const series = seriesRef.current;
    const container = chartContainerRef.current;

    if (!canvas || !chart || !series || !container || !selectedPair) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Обновляем размер canvas с учетом DPI
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.floor(rect.width * dpr);
    const targetHeight = Math.floor(rect.height * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      ctx.scale(dpr, dpr);
    }

    // Очищаем canvas полностью (сбрасываем трансформацию для полной очистки)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    const levels = getLevels(selectedPair.symbol);
    if (levels.length === 0) return;

    const timeScale = chart.timeScale();
    const logicalWidth = canvas.width / dpr;

    const currentCandles = chartDataRef.current;

    levels.forEach(level => {
      const y = series.priceToCoordinate(level.price);
      if (y === null) return;

      const levelStartTime = level.startTime || 0;
      let startX = timeScale.timeToCoordinate(levelStartTime as any);

      if (startX === null && levelStartTime > 0 && currentCandles.length > 0) {
        let bestTime = currentCandles[0].time;
        for (let i = 0; i < currentCandles.length; i++) {
          const ct = typeof currentCandles[i].time === 'object'
            ? Math.floor(new Date((currentCandles[i].time as any).year, (currentCandles[i].time as any).month - 1, (currentCandles[i].time as any).day).getTime() / 1000)
            : (currentCandles[i].time as number);
          if (ct >= levelStartTime) {
            bestTime = currentCandles[i].time;
            break;
          }
          bestTime = currentCandles[i].time;
        }
        startX = timeScale.timeToCoordinate(bestTime as any);
      }

      if (startX === null || startX < 0) {
        startX = 0 as any;
      }

      // Рисуем луч от startX до правого края
      ctx.beginPath();
      ctx.moveTo(startX as number, y as number);
      ctx.lineTo(logicalWidth, y);
      ctx.strokeStyle = level.color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Рисуем точку начала
      ctx.beginPath();
      ctx.arc(startX as number, y as number, 4, 0, Math.PI * 2);
      ctx.fillStyle = level.color;
      ctx.fill();

      // Рисуем цену справа
      ctx.font = 'bold 11px Arial';
      ctx.fillStyle = level.color;
      ctx.textAlign = 'right';
      ctx.fillText(level.price.toFixed(4), logicalWidth - 5, y - 5);
    });
  }, [selectedPair, getLevels]);

  // Функция для отрисовки сделок (линий) на Canvas
  const drawTrades = useCallback(() => {
    const canvas = tradesCanvasRef.current;
    const chart = chartRef.current;
    const series = seriesRef.current;
    const container = chartContainerRef.current;

    // Сделки рисуем только в режиме лаборатории и если всё инициализировано
    if (!isLabMode) {
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    if (!canvas || !chart || !series || !container || labTrades.length === 0) {
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Синхронизируем размер с учетом DPI для четкости
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.floor(rect.width * dpr);
    const targetHeight = Math.floor(rect.height * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      // Важно: scale нужно применять после изменения размера
      ctx.scale(dpr, dpr);
    }

    // Очищаем canvas (используем логические координаты благодаря scale, но safe-вариант очистить всё)
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    const timeScale = chart.timeScale();
    const visibleRange = timeScale.getVisibleRange();

    if (!visibleRange) return;

    // Оптимизация: фильтруем сделки, которые хотя бы частично попадают в видимую область
    // Расширяем диапазон чуть влево и вправо, чтобы линии не обрывались
    const fromTime = (visibleRange.from as number) - 3600 * 24; // запас 1 день (условно)
    const toTime = (visibleRange.to as number) + 3600 * 24;

    // Рисуем линии
    labTrades.forEach(trade => {
      // Пропускаем совсем далекие сделки
      // (EntryTime <= toTime) AND (ExitTime >= fromTime)
      if (trade.entryTime > toTime || trade.exitTime < fromTime) return;

      const exitX = timeScale.timeToCoordinate(trade.exitTime as Time);
      const exitY = series.priceToCoordinate(trade.exitPrice);

      // Если точка выхода за пределами видимости по Y (null) или X (null),
      // но часть линии может быть видна - пробуем рисовать
      // timeToCoordinate может вернуть null если далеко за пределами, но
      // для линий нам важно хотя бы приблизительное поведение или отсечение.
      // lightweight-charts возвращает null, если точка вне диапазона данных (range),
      // но если она просто за границей видимости (scroll), может вернуть coordinate < 0 или > width.

      // Собираем точки входа (колен)
      const legs = trade.legDetails && trade.legDetails.length > 0
        ? trade.legDetails
        : [{ time: trade.entryTime, price: trade.entryPrice, qty: 0 }];

      // Цвет линии: Profit = Green, Loss = Red, Live = Blue/Yellow
      let lineColor = trade.pnlUsd >= 0 ? 'rgba(22, 163, 74, 0.85)' : 'rgba(239, 68, 68, 0.85)';
      if (trade.isLive) lineColor = 'rgba(59, 130, 246, 0.9)';

      // Настраиваем стиль
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);

      legs.forEach(leg => {
        const entryX = timeScale.timeToCoordinate(leg.time as Time);
        const entryY = series.priceToCoordinate(leg.price);

        // Рисуем линию только если обе координаты (или хотя бы одна для отсечения) существуют
        // Для простоты: если есть X и Y хотя бы одной точки, рисуем
        // Но timeToCoordinate возвращает null для отсутствующих баров.
        // Если API вернул null, значит точка "не существует" на оси X.

        if (entryX === null || entryY === null) return;

        // Если exit тоже валиден
        if (exitX !== null && exitY !== null) {
          ctx.beginPath();
          ctx.moveTo(entryX, entryY);
          ctx.lineTo(exitX, exitY);
          ctx.stroke();

          // Кружочек в начале (вход)
          ctx.beginPath();
          ctx.arc(entryX, entryY, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = lineColor;
          ctx.fill();
        }
      });

      // Крестик/маркер на выходе
      if (exitX !== null && exitY !== null) {
        ctx.beginPath();
        // Рисуем небольшой треугольник или точку
        ctx.arc(exitX, exitY, 3, 0, Math.PI * 2);
        ctx.fillStyle = trade.isLive ? '#eab308' : lineColor;
        ctx.fill();
      }
    });

  }, [isLabMode, labTrades]);

  // Вспомогательная: обновить все серии графика после изменения данных
  const applyAllSeriesToChart = useCallback((candles: CandleData[]) => {
    if (seriesRef.current) {
      seriesRef.current.setData(candles.map(c => ({
        time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close,
      })));
    }
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(candles.map(c => ({
        time: c.time as Time,
        value: c.volume || 0,
        color: c.close >= c.open ? 'rgba(8, 153, 129, 0.5)' : 'rgba(242, 56, 90, 0.5)',
      })));
    }
    if (barDeltaSeriesRef.current && showBarDeltaStandard) {
      barDeltaSeriesRef.current.setData(candles.map(c => ({
        time: c.time as Time,
        value: c.barDelta || 0,
        color: (c.barDelta || 0) >= 0 ? 'rgba(8, 153, 129, 0.7)' : 'rgba(242, 56, 90, 0.7)',
      })));
    }
    if (showCumulativeDeltaStandard) {
      if (cumulativeDeltaDisplayMode === 'line' && cumulativeDeltaLineSeriesRef.current) {
        cumulativeDeltaLineSeriesRef.current.setData(candles.map(c => ({
          time: c.time as Time, value: c.cumulativeDelta || 0,
        })));
      } else if (cumulativeDeltaDisplayMode === 'candle' && cumulativeDeltaCandleSeriesRef.current) {
        let prev = 0;
        cumulativeDeltaCandleSeriesRef.current.setData(candles.map(c => {
          const o = prev; const cl = c.cumulativeDelta || 0; prev = cl;
          return { time: c.time as Time, open: o, high: Math.max(o, cl), low: Math.min(o, cl), close: cl };
        }));
      }
    }
    if (deltaRotationSeriesRef.current && showDeltaRotationStandard) {
      let cumD = 0, trend = 0, pp: number | null = null;
      deltaRotationSeriesRef.current.setData(candles.map(c => {
        const bd = c.barDelta || 0; cumD += bd;
        let color = '#4a4a4a';
        if (pp !== null) {
          const dir = c.close > pp ? 1 : (c.close < pp ? -1 : 0);
          if (deltaRotationThreshold > 0) {
            if (trend === 0) { if (cumD > deltaRotationThreshold) { trend = 1; cumD = bd; } else if (cumD < -deltaRotationThreshold) { trend = -1; cumD = bd; } }
            else if (trend === 1 && cumD < -deltaRotationThreshold) { trend = -1; cumD = bd; }
            else if (trend === -1 && cumD > deltaRotationThreshold) { trend = 1; cumD = bd; }
          } else if (dir !== 0) {
            const dd = bd > 0 ? 1 : (bd < 0 ? -1 : 0);
            if (dd !== 0 && dd !== dir) { trend = -trend || (dir > 0 ? 1 : -1); cumD = bd; }
            else if (trend === 0) { trend = dir > 0 ? 1 : -1; }
          }
        }
        pp = c.close;
        if (trend === 1) color = '#2196F3'; else if (trend === -1) color = '#f44336';
        return { time: c.time as Time, value: Math.abs(cumD), color };
      }));
    }
  }, [showBarDeltaStandard, showCumulativeDeltaStandard, showDeltaRotationStandard, cumulativeDeltaDisplayMode, deltaRotationThreshold]);

  // Загрузка истории: за один вызов заполняет весь видимый экран
  const loadMoreHistory = useCallback(async () => {
    if (isLabMode) return;
    if (isLoadingMoreRef.current) return;
    if (!canLoadMoreRef.current) return;
    if (!selectedPair?.symbol) return;
    if (!chartDataRef.current || chartDataRef.current.length === 0) return;
    if (timeframe === '200t') return;
    if (!oldestCandleTimeRef.current) return;

    isLoadingMoreRef.current = true;

    try {
      const interval = timeframeToInterval(timeframe);
      const isBybit = selectedPair.exchange === 'Bybit';

      let neededCandles = 500;
      if (chartRef.current) {
        const lr = chartRef.current.timeScale().getVisibleLogicalRange();
        if (lr) {
          const visibleWidth = Math.ceil(lr.to - lr.from);
          const currentLoaded = chartDataRef.current.length;
          // Account for empty space on the left: if lr.from < 0, we need
          // at least |lr.from| candles to fill the gap, plus a buffer
          const leftGap = lr.from < 0 ? Math.ceil(Math.abs(lr.from)) + 100 : 0;
          const deficit = visibleWidth + 200 - currentLoaded;
          neededCandles = Math.max(500, deficit, leftGap);
        }
      }
      neededCandles = Math.min(neededCandles, 5000);

      let allNewCandles: CandleData[] = [];
      let fetchOldest = oldestCandleTimeRef.current;
      const batchSize = 500;
      const maxBatches = Math.ceil(neededCandles / batchSize);

      const loadedTimes = new Set<number>();
      for (let i = 0; i < maxBatches && canLoadMoreRef.current; i++) {
        let batch: CandleData[];
        if (isBybit) {
          batch = await getBybitKlinesBeforeTime(selectedPair.symbol, interval, fetchOldest, batchSize);
        } else {
          batch = await getKlinesBeforeTime(selectedPair.symbol, interval, fetchOldest * 1000, batchSize);
        }

        if (batch.length === 0) {
          canLoadMoreRef.current = false;
          break;
        }

        for (const c of batch) {
          if (!loadedTimes.has(c.time)) {
            loadedTimes.add(c.time);
            allNewCandles.push(c);
          }
        }
        fetchOldest = batch[0].time;

        if (batch.length < batchSize) {
          canLoadMoreRef.current = false;
          break;
        }
      }

      if (allNewCandles.length === 0) {
        canLoadMoreRef.current = false;
        return;
      }

      const existingTimes = new Set(chartDataRef.current.map(c => c.time));
      const uniqueNew = allNewCandles.filter(c => !existingTimes.has(c.time));
      if (uniqueNew.length === 0) {
        canLoadMoreRef.current = false;
        return;
      }

      const allCandles = [...uniqueNew, ...chartDataRef.current].sort((a, b) => a.time - b.time);
      let delta = 0;
      const recalculatedCandles = allCandles.map(candle => {
        delta += candle.barDelta || 0;
        return { ...candle, cumulativeDelta: delta };
      });

      chartDataRef.current = recalculatedCandles;
      cumulativeDeltaRef.current = delta;
      oldestCandleTimeRef.current = recalculatedCandles[0].time;

      applyAllSeriesToChart(recalculatedCandles);
      setChartData(recalculatedCandles);

    } catch (error) {
      console.error('Error loading more history:', error);
    } finally {
      isLoadingMoreRef.current = false;

      // Re-check after load: while loadMoreHistory was running, zoom/scroll events
      // were rejected (isLoadingMoreRef was true). After completing, the screen may
      // still have empty space on the left. Schedule a re-check to fill it.
      if (canLoadMoreRef.current && chartRef.current) {
        requestAnimationFrame(() => {
          if (isLoadingMoreRef.current || !canLoadMoreRef.current || !chartRef.current) return;
          const ts = chartRef.current.timeScale();
          let needMore = false;
          const vr = ts.getVisibleRange();
          if (vr && oldestCandleTimeRef.current) {
            const visFrom = typeof vr.from === 'number' ? (vr.from as number) : Math.floor(new Date(vr.from as any).getTime() / 1000);
            const visTo = typeof vr.to === 'number' ? (vr.to as number) : Math.floor(new Date(vr.to as any).getTime() / 1000);
            const span = visTo - visFrom;
            if (visFrom <= oldestCandleTimeRef.current + span * 0.3) needMore = true;
          }
          if (!needMore) {
            const lr = ts.getVisibleLogicalRange();
            if (lr && lr.from < 50) needMore = true;
          }
          if (needMore) loadMoreHistory();
        });
      }
    }
  }, [selectedPair?.symbol, selectedPair?.exchange, timeframe, isLabMode, applyAllSeriesToChart, setChartData]);

  loadMoreHistoryRef.current = loadMoreHistory;

  // Обновление canvas уровней и сделок при изменении уровней или графика
  useEffect(() => {
    const tryDraw = () => {
      if (chartRef.current && seriesRef.current && levelsCanvasRef.current && tradesCanvasRef.current) {
        if (selectedPair) drawLevels();
        if (isLabMode) drawTrades();
        return true;
      }
      return false;
    };

    let retryTimer: ReturnType<typeof setInterval> | null = null;
    if (!tryDraw()) {
      let attempts = 0;
      retryTimer = setInterval(() => {
        attempts++;
        if (tryDraw() || attempts >= 20) {
          if (retryTimer) clearInterval(retryTimer);
          retryTimer = null;
        }
      }, 200);
    }

    const chart = chartRef.current;
    if (!chart) {
      return () => { if (retryTimer) clearInterval(retryTimer); };
    }

    let drawPending = false;
    const throttledDraw = () => {
      if (!drawPending) {
        drawPending = true;
        requestAnimationFrame(() => {
          if (selectedPair) drawLevels();
          if (isLabMode) drawTrades();
          drawPending = false;
        });
      }
    };

    const handleTimeRangeChange = () => {
      throttledDraw();
    };

    const needsMoreHistory = (): boolean => {
      if (!oldestCandleTimeRef.current || !canLoadMoreRef.current || isLoadingMoreRef.current) return false;
      const ts = chart.timeScale();

      // Logical range check: if left edge is near the start of loaded data
      const lr = ts.getVisibleLogicalRange();
      if (lr) {
        // Negative lr.from means empty space visible on the left
        if (lr.from < 0) return true;
        // Close to the beginning of loaded candles
        const totalLoaded = chartDataRef.current.length;
        if (totalLoaded > 0 && lr.from < totalLoaded * 0.15) return true;
      }

      // Time-based check: oldest loaded candle is visible or close
      const vr = ts.getVisibleRange();
      if (vr) {
        const oldest = oldestCandleTimeRef.current;
        const visFrom = typeof vr.from === 'number' ? (vr.from as number) : Math.floor(new Date(vr.from as any).getTime() / 1000);
        const visTo = typeof vr.to === 'number' ? (vr.to as number) : Math.floor(new Date(vr.to as any).getTime() / 1000);
        const span = visTo - visFrom;
        if (visFrom <= oldest + span * 0.3) return true;
      }

      return false;
    };

    const handleLogicalRangeChange = () => {
      throttledDraw();
      if (needsMoreHistory()) loadMoreHistory();
    };

    chart.timeScale().subscribeVisibleTimeRangeChange(handleTimeRangeChange);
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleLogicalRangeChange);

    const container = chartContainerRef.current;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = () => {
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        if (needsMoreHistory()) loadMoreHistory();
      }, 100);
    };
    if (container) container.addEventListener('wheel', onWheel, { passive: true });

    return () => {
      if (retryTimer) clearInterval(retryTimer);
      if (wheelTimer) clearTimeout(wheelTimer);
      if (container) container.removeEventListener('wheel', onWheel);
      try {
        chart.timeScale().unsubscribeVisibleTimeRangeChange(handleTimeRangeChange);
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleLogicalRangeChange);
      } catch {
        // ignore
      }
    };
  }, [selectedPair, currentLevels, drawLevels, drawTrades, isLabMode, labTrades, loadMoreHistory]);

  // Обработчик ресайза панели
  const handlePanelResize = useCallback((e: React.MouseEvent<HTMLDivElement>, panelRef: React.RefObject<HTMLDivElement | null>) => {
    e.preventDefault();
    e.stopPropagation();

    const panel = panelRef.current;
    const mainChart = chartContainerRef.current;
    if (!panel || !mainChart) return;

    const startY = e.clientY;
    const startPanelHeight = panel.offsetHeight;
    const startChartHeight = mainChart.offsetHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      // Тянем вверх (delta < 0) → панель растёт, график сжимается
      const newPanelHeight = Math.max(80, startPanelHeight - delta);
      const newChartHeight = Math.max(150, startChartHeight + delta);

      panel.style.height = newPanelHeight + 'px';
      panel.style.flex = 'none';
      mainChart.style.height = newChartHeight + 'px';
      mainChart.style.flex = 'none';
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // Сброс стилей графика при изменении видимости индикаторов
  useEffect(() => {
    const mainChart = chartContainerRef.current;
    if (!mainChart) return;

    // Сбрасываем фиксированные стили - график снова займёт доступное место
    mainChart.style.height = '';
    mainChart.style.flex = '1';
  }, [showBarDeltaStandard, showDeltaRotationStandard, showCumulativeDeltaStandard]);

  // Инициализация графика
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const initChart = () => {
      const container = chartContainerRef.current;
      if (!container) return;

      // Удаляем старый график если есть
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }

      const rect = container.getBoundingClientRect();
      const width = rect.width || container.clientWidth || window.innerWidth - 40;
      const height = rect.height || container.clientHeight || window.innerHeight - 200;

      if (width <= 0 || height <= 0) {
        setTimeout(initChart, 200);
        return;
      }

      try {
        const chart = createChart(container, {
          width,
          height,
          layout: {
            background: { color: '#0d1117' },
            textColor: '#c9d1d9',
          },
          grid: {
            vertLines: { color: 'rgba(48, 54, 61, 0.3)' },
            horzLines: { color: 'rgba(48, 54, 61, 0.3)' },
          },
          crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: {
              color: '#758696',
              width: 1,
              style: 3,
              labelBackgroundColor: '#2B2B43',
            },
            horzLine: {
              color: '#758696',
              width: 1,
              style: 3,
              labelBackgroundColor: '#2B2B43',
            },
          },
          timeScale: {
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 12,
            barSpacing: 8,
            minBarSpacing: 0.03, // Ультра-сжатие для просмотра большой истории
          },
          rightPriceScale: {
            scaleMargins: {
              top: 0.1,
              bottom: 0.1,
            },
          },
          handleScroll: {
            mouseWheel: true,
            pressedMouseMove: true,
            horzTouchDrag: true,
            vertTouchDrag: true,
          },
          handleScale: {
            axisPressedMouseMove: true,
            mouseWheel: true,
            pinch: true,
          },
          localization: {
            priceFormatter: formatPriceValue,
          },
        });

        const candlestickSeries = chart.addCandlestickSeries({
          upColor: '#089981',  // Зеленый
          downColor: '#f2385a',  // Красный
          borderVisible: false,
          wickUpColor: '#089981',
          wickDownColor: '#f2385a',
          lastValueVisible: false, // Скрываем стандартную метку - делаем свою с таймером
          priceFormat: {
            type: 'custom',
            formatter: formatPriceValue,
            minMove: 0.000001,
          },
        });

        // Гистограмма объёмов внизу графика
        const volumeSeries = chart.addHistogramSeries({
          priceFormat: {
            type: 'volume',
          },
          priceScaleId: 'volume',
        });

        // Настраиваем отдельную шкалу для объёмов (внизу, 15% высоты)
        chart.priceScale('volume').applyOptions({
          scaleMargins: {
            top: 0.85,
            bottom: 0,
          },
        });

        const bbUpper = chart.addLineSeries({
          color: 'rgba(56, 189, 248, 0.5)',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          visible: false,
        });
        const bbMiddle = chart.addLineSeries({
          color: 'rgba(250, 204, 21, 0.5)',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          visible: false,
        });
        const bbLower = chart.addLineSeries({
          color: 'rgba(56, 189, 248, 0.5)',
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          visible: false,
        });

        chartRef.current = chart;
        seriesRef.current = candlestickSeries;
        bollingerUpperRef.current = bbUpper;
        bollingerMiddleRef.current = bbMiddle;
        bollingerLowerRef.current = bbLower;
        volumeSeriesRef.current = volumeSeries;

        // Если данные уже загружены до создания графика — отрисовать канал Боллинджера
        setTimeout(() => {
          updateBollingerBandsRef.current?.();
        }, 0);

        // Обработка изменения размера
        const resizeObserver = new ResizeObserver(() => {
          if (container && chartRef.current) {
            const newRect = container.getBoundingClientRect();
            const newWidth = newRect.width || container.clientWidth;
            const newHeight = newRect.height || container.clientHeight;
            if (newWidth > 0 && newHeight > 0) {
              chartRef.current.applyOptions({
                width: newWidth,
                height: newHeight,
              });

              // Обновляем canvas уровней и сделок
              if (levelsCanvasRef.current) {
                levelsCanvasRef.current.width = newWidth;
                levelsCanvasRef.current.height = newHeight;
                drawLevels();
              }
              if (tradesCanvasRef.current) {
                tradesCanvasRef.current.width = newWidth;
                tradesCanvasRef.current.height = newHeight;
                drawTrades();
              }
            }
          }
        });

        resizeObserver.observe(container);

        return () => {
          resizeObserver.disconnect();
        };
      } catch (error) {
        // Ignore chart initialization errors
      }
    };

    const timeoutId = setTimeout(initChart, 100);

    return () => {
      clearTimeout(timeoutId);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      seriesRef.current = null;
      bollingerUpperRef.current = null;
      bollingerMiddleRef.current = null;
      bollingerLowerRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // (history loading is handled inside the drawing useEffect via subscribeVisibleLogicalRangeChange)

  // Лаборатория: маркеры сделок (стрелочки)
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return;

    // При выходе из лабораторного режима очищаем маркеры
    if (!isLabMode) {
      seriesRef.current.setMarkers([]);
      if (tradesCanvasRef.current) {
        // Очищаем canvas сделок
        const ctx = tradesCanvasRef.current.getContext('2d');
        ctx?.clearRect(0, 0, tradesCanvasRef.current.width, tradesCanvasRef.current.height);
      }
      return;
    }

    const markers: SeriesMarker<Time>[] = [];
    // Цвет по trade.isLive: с истории — зелёный/красный; новые в лайве — синий/жёлтый
    const getEntryColor = (t: { isLive?: boolean }) => (t.isLive ? '#3b82f6' : '#16a34a');
    const getExitColor = (t: { isLive?: boolean; pnlUsd: number }) =>
      t.isLive ? '#eab308' : (t.pnlUsd >= 0 ? '#16a34a' : '#ef4444');

    labTrades.forEach((trade) => {
      const isShort = trade.side === 'short';
      const entryColor = getEntryColor(trade);
      const exitColor = getExitColor(trade);
      // Шорт: стрелка вниз сверху свечи; лонг: стрелка вверх снизу
      const entryPosition = isShort ? 'aboveBar' : 'belowBar';
      const entryShape = isShort ? 'arrowDown' : 'arrowUp';

      markers.push({
        time: trade.entryTime as unknown as Time,
        position: entryPosition,
        shape: entryShape,
        color: isShort ? (trade.isLive ? '#f97316' : '#ea580c') : entryColor,
        text: `#${trade.id}`,
      });

      if (trade.legDetails && trade.legDetails.length > 1) {
        for (let i = 1; i < trade.legDetails.length; i++) {
          markers.push({
            time: trade.legDetails[i].time as unknown as Time,
            position: entryPosition,
            shape: entryShape,
            color: isShort ? (trade.isLive ? '#f97316' : '#ea580c') : entryColor,
            text: `+${i}`,
          });
        }
      }

      const exitText = trade.exitReason === 'SL' ? 'SL' : trade.exitReason === 'TP' ? 'TP' : trade.exitReason === 'end' ? 'end' : trade.pnlUsd.toFixed(2);
      markers.push({
        time: trade.exitTime as unknown as Time,
        position: isShort ? 'belowBar' : 'aboveBar',
        shape: isShort ? 'arrowUp' : 'arrowDown',
        color: exitColor,
        text: exitText,
      });
    });

    // Lightweight Charts требует маркеры в порядке возрастания time (лонг и шорт могут быть вперемешку)
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    seriesRef.current.setMarkers(markers);
    // Линии рисуются через drawTrades() в useEffect выше
    drawTrades();

  }, [isLabMode, labMode, labTrades, drawTrades]);

  // Bollinger Bands: расчёт и обновление линий на графике
  const updateBollingerBands = useCallback((candles?: CandleData[]) => {
    const upper = bollingerUpperRef.current;
    const middle = bollingerMiddleRef.current;
    const lower = bollingerLowerRef.current;
    if (!upper || !middle || !lower) return;

    const store = useDomSurfaceStore.getState();
    const showBands = isLabMode && store.botType === 'kanal';
    upper.applyOptions({ visible: showBands });
    middle.applyOptions({ visible: showBands });
    lower.applyOptions({ visible: showBands });

    const data = candles || chartDataRef.current;
    if (!showBands || !data || data.length === 0) {
      upper.setData([]);
      middle.setData([]);
      lower.setData([]);
      return;
    }

    const { period, multiplier } = store.kanalParams;
    const n = data.length;
    const closes: number[] = data.map(c => c.close);

    const upperData: { time: any; value: number }[] = [];
    const middleData: { time: any; value: number }[] = [];
    const lowerData: { time: any; value: number }[] = [];

    for (let i = period - 1; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += closes[i - j];
      const mean = sum / period;
      let sqSum = 0;
      for (let j = 0; j < period; j++) {
        const diff = closes[i - j] - mean;
        sqSum += diff * diff;
      }
      const sd = Math.sqrt(sqSum / period);
      const t = data[i].time;
      upperData.push({ time: t, value: mean + sd * multiplier });
      middleData.push({ time: t, value: mean });
      lowerData.push({ time: t, value: mean - sd * multiplier });
    }

    upper.setData(upperData);
    middle.setData(middleData);
    lower.setData(lowerData);
  }, [isLabMode]);

  updateBollingerBandsRef.current = updateBollingerBands;

  // Пересчёт Боллинджера при смене botType, параметров или данных графика
  useEffect(() => {
    updateBollingerBands(chartData);
  }, [isLabMode, labBotType, chartData, kanalParams, updateBollingerBands]);

  // Форматирование больших чисел для шкалы дельты
  const formatDeltaValue = (value: number): string => {
    const absValue = Math.abs(value);
    if (absValue >= 1000000) {
      return (value / 1000000).toFixed(1) + 'M';
    } else if (absValue >= 1000) {
      return (value / 1000).toFixed(0) + 'K';
    }
    return value.toFixed(0);
  };

  // Инициализация графика побарной дельты
  useEffect(() => {
    if (!barDeltaContainerRef.current || !showBarDeltaStandard) {
      if (barDeltaChartRef.current) {
        barDeltaChartRef.current.remove();
        barDeltaChartRef.current = null;
        barDeltaSeriesRef.current = null;
      }
      return;
    }

    const initChart = () => {
      const container = barDeltaContainerRef.current;
      if (!container || !chartRef.current) {
        setTimeout(initChart, 200);
        return;
      }

      if (barDeltaChartRef.current) {
        barDeltaChartRef.current.remove();
        barDeltaChartRef.current = null;
        barDeltaSeriesRef.current = null;
      }

      const rect = container.getBoundingClientRect();
      const width = rect.width || container.clientWidth || 800;
      const height = rect.height || container.clientHeight || 120;

      if (width <= 0 || height <= 0) {
        setTimeout(initChart, 200);
        return;
      }

      try {
        // Получаем настройки временной шкалы основного графика
        const mainTimeScaleOptions = chartRef.current.timeScale().options();

        const chart = createChart(container, {
          width,
          height,
          layout: {
            background: { color: '#0d1117' },
            textColor: '#c9d1d9',
          },
          grid: {
            vertLines: { color: 'rgba(48, 54, 61, 0.3)' },
            horzLines: { color: 'rgba(48, 54, 61, 0.3)' },
          },
          crosshair: {
            horzLine: { visible: false }, // Только вертикальная линия
          },
          timeScale: {
            visible: false, // Скрываем временную шкалу - она есть на основном графике
            rightOffset: mainTimeScaleOptions.rightOffset,
            barSpacing: mainTimeScaleOptions.barSpacing,
            minBarSpacing: mainTimeScaleOptions.minBarSpacing,
          },
          rightPriceScale: {
            scaleMargins: { top: 0.1, bottom: 0.1 },
          },
          localization: {
            priceFormatter: formatDeltaValue,
          },
          handleScroll: false,
          handleScale: false,
        });

        const series = chart.addHistogramSeries({
          priceFormat: {
            type: 'custom',
            formatter: formatDeltaValue,
          },
        });

        barDeltaChartRef.current = chart;
        barDeltaSeriesRef.current = series;

        // Синхронизируем временную шкалу с основным графиком
        const syncTimeScale = () => {
          if (chartRef.current && barDeltaChartRef.current) {
            const logicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
            if (logicalRange) {
              barDeltaChartRef.current.timeScale().setVisibleLogicalRange(logicalRange);
            }
          }
        };

        syncTimeScale();

        const resizeObserver = new ResizeObserver(() => {
          if (container && barDeltaChartRef.current) {
            const newRect = container.getBoundingClientRect();
            const newWidth = newRect.width || container.clientWidth;
            const newHeight = newRect.height || container.clientHeight;
            if (newWidth > 0 && newHeight > 0) {
              barDeltaChartRef.current.applyOptions({ width: newWidth, height: newHeight });
            }
          }
        });

        resizeObserver.observe(container);

        // Обновляем данные дельты если есть
        if (chartDataRef.current.length > 0) {
          updateChartData(chartDataRef.current, false);
          syncTimeScale();
          // Повторная синхронизация с задержкой для гарантии
          setTimeout(syncTimeScale, 100);
        }

        return () => {
          resizeObserver.disconnect();
        };
      } catch (error) {
        // Ignore bar delta chart initialization errors
      }
    };

    const timeoutId = setTimeout(initChart, 200);

    return () => {
      clearTimeout(timeoutId);
      if (barDeltaChartRef.current) {
        barDeltaChartRef.current.remove();
        barDeltaChartRef.current = null;
      }
      barDeltaSeriesRef.current = null;
    };
  }, [showBarDeltaStandard]);

  // Инициализация графика Delta Rotation
  useEffect(() => {
    const container = deltaRotationContainerRef.current;
    if (!container || !showDeltaRotationStandard) {
      if (deltaRotationChartRef.current) {
        deltaRotationChartRef.current.remove();
        deltaRotationChartRef.current = null;
        deltaRotationSeriesRef.current = null;
      }
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout>;

    const initChart = () => {
      const c = deltaRotationContainerRef.current;
      if (!c || !chartRef.current) {
        timeoutId = setTimeout(initChart, 200);
        return;
      }

      if (deltaRotationChartRef.current) {
        deltaRotationChartRef.current.remove();
        deltaRotationChartRef.current = null;
        deltaRotationSeriesRef.current = null;
      }

      const rect = c.getBoundingClientRect();
      const width = rect.width || c.clientWidth || 800;
      const height = rect.height || c.clientHeight || 120;

      if (width <= 0 || height <= 0) {
        timeoutId = setTimeout(initChart, 200);
        return;
      }

      try {
        // Получаем настройки временной шкалы основного графика
        const mainTimeScaleOptions = chartRef.current.timeScale().options();

        const chart = createChart(c, {
          width,
          height,
          layout: {
            background: { color: '#0d1117' },
            textColor: '#c9d1d9',
          },
          grid: {
            vertLines: { color: 'rgba(48, 54, 61, 0.3)' },
            horzLines: { color: 'rgba(48, 54, 61, 0.3)' },
          },
          crosshair: {
            horzLine: { visible: false }, // Только вертикальная линия
          },
          timeScale: {
            visible: false, // Скрываем временную шкалу - она есть на основном графике
            rightOffset: mainTimeScaleOptions.rightOffset,
            barSpacing: mainTimeScaleOptions.barSpacing,
            minBarSpacing: mainTimeScaleOptions.minBarSpacing,
          },
          rightPriceScale: {
            scaleMargins: { top: 0.1, bottom: 0.1 },
          },
          localization: {
            priceFormatter: formatDeltaValue,
          },
          handleScroll: false,
          handleScale: false,
        });

        const series = chart.addHistogramSeries({
          base: 0,
          priceFormat: {
            type: 'custom',
            formatter: formatDeltaValue,
          },
        });

        deltaRotationChartRef.current = chart;
        deltaRotationSeriesRef.current = series;

        // Синхронизируем временную шкалу с основным графиком
        const syncTimeScale = () => {
          if (chartRef.current && deltaRotationChartRef.current) {
            const logicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
            if (logicalRange) {
              deltaRotationChartRef.current.timeScale().setVisibleLogicalRange(logicalRange);
            }
          }
        };

        syncTimeScale();

        const resizeObserver = new ResizeObserver(() => {
          if (c && deltaRotationChartRef.current) {
            const newRect = c.getBoundingClientRect();
            const newWidth = newRect.width || c.clientWidth;
            const newHeight = newRect.height || c.clientHeight;
            if (newWidth > 0 && newHeight > 0) {
              deltaRotationChartRef.current.applyOptions({ width: newWidth, height: newHeight });
            }
          }
        });

        resizeObserver.observe(c);

        // Данные обновятся при следующем вызове updateChartData из основного потока
        syncTimeScale();
        setTimeout(syncTimeScale, 100);

        // Сразу выставляем данные, чтобы не ждать движения графика
        if (chartDataRef.current.length > 0 && deltaRotationSeriesRef.current) {
          const rotationData = computeDeltaRotationDataFromCandles(chartDataRef.current, deltaRotationThreshold);
          deltaRotationSeriesRef.current.setData(rotationData);
        }

        return () => {
          resizeObserver.disconnect();
        };
      } catch (error) {
        // Ignore delta rotation chart initialization errors
      }
    };

    const ro = new ResizeObserver(() => {
      const c = deltaRotationContainerRef.current;
      if (!c || deltaRotationChartRef.current) return;
      const rect = c.getBoundingClientRect();
      const w = rect.width || c.clientWidth;
      const h = rect.height || c.clientHeight;
      if (w > 0 && h > 0) {
        clearTimeout(timeoutId!);
        initChart();
        ro.disconnect();
      }
    });
    ro.observe(container);
    timeoutId = setTimeout(initChart, 200);

    return () => {
      clearTimeout(timeoutId);
      ro.disconnect();
      if (deltaRotationChartRef.current) {
        deltaRotationChartRef.current.remove();
        deltaRotationChartRef.current = null;
      }
      deltaRotationSeriesRef.current = null;
    };
  }, [showDeltaRotationStandard, deltaRotationThreshold]);

  // Инициализация графика кумулятивной дельты
  useEffect(() => {
    if (!cumulativeDeltaContainerRef.current || !showCumulativeDeltaStandard) {
      if (cumulativeDeltaChartRef.current) {
        cumulativeDeltaChartRef.current.remove();
        cumulativeDeltaChartRef.current = null;
        cumulativeDeltaLineSeriesRef.current = null;
        cumulativeDeltaCandleSeriesRef.current = null;
      }
      return;
    }

    const initChart = () => {
      const container = cumulativeDeltaContainerRef.current;
      if (!container || !chartRef.current) {
        setTimeout(initChart, 200);
        return;
      }

      if (cumulativeDeltaChartRef.current) {
        cumulativeDeltaChartRef.current.remove();
        cumulativeDeltaChartRef.current = null;
        cumulativeDeltaLineSeriesRef.current = null;
        cumulativeDeltaCandleSeriesRef.current = null;
      }

      const rect = container.getBoundingClientRect();
      const width = rect.width || container.clientWidth || 800;
      const height = rect.height || container.clientHeight || 120;

      if (width <= 0 || height <= 0) {
        setTimeout(initChart, 200);
        return;
      }

      try {
        // Получаем настройки временной шкалы основного графика
        const mainTimeScaleOptions = chartRef.current.timeScale().options();

        const chart = createChart(container, {
          width,
          height,
          layout: {
            background: { color: '#0d1117' },
            textColor: '#c9d1d9',
          },
          grid: {
            vertLines: { color: 'rgba(48, 54, 61, 0.3)' },
            horzLines: { color: 'rgba(48, 54, 61, 0.3)' },
          },
          crosshair: {
            horzLine: { visible: false }, // Только вертикальная линия
          },
          timeScale: {
            visible: false, // Скрываем временную шкалу - она есть на основном графике
            rightOffset: mainTimeScaleOptions.rightOffset,
            barSpacing: mainTimeScaleOptions.barSpacing,
            minBarSpacing: mainTimeScaleOptions.minBarSpacing,
          },
          rightPriceScale: {
            scaleMargins: { top: 0.1, bottom: 0.1 },
          },
          localization: {
            priceFormatter: formatDeltaValue,
          },
          handleScroll: false,
          handleScale: false,
        });

        cumulativeDeltaChartRef.current = chart;

        // Создаём серию в зависимости от режима отображения
        if (cumulativeDeltaDisplayMode === 'candle') {
          const candleSeries = chart.addCandlestickSeries({
            upColor: '#089981',
            downColor: '#f2385a',
            borderVisible: false,
            wickUpColor: '#089981',
            wickDownColor: '#f2385a',
            priceFormat: {
              type: 'custom',
              formatter: formatDeltaValue,
            },
          });
          cumulativeDeltaCandleSeriesRef.current = candleSeries;
        } else {
          const lineSeries = chart.addLineSeries({
            color: '#f0b90b',
            lineWidth: 2,
            priceFormat: {
              type: 'custom',
              formatter: formatDeltaValue,
            },
          });
          cumulativeDeltaLineSeriesRef.current = lineSeries;
        }

        // Добавляем линию тренда если включена
        if (showCumulativeDeltaTrend) {
          const trendSeries = chart.addLineSeries({
            color: '#3fb950', // Начальный цвет (будет меняться)
            lineWidth: 2,
            lastValueVisible: true,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
            priceFormat: {
              type: 'custom',
              formatter: formatDeltaValue,
            },
          });
          cumulativeDeltaTrendSeriesRef.current = trendSeries;
        }

        // Синхронизируем временную шкалу с основным графиком
        const syncTimeScale = () => {
          if (chartRef.current && cumulativeDeltaChartRef.current) {
            const logicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
            if (logicalRange) {
              cumulativeDeltaChartRef.current.timeScale().setVisibleLogicalRange(logicalRange);
            }
          }
        };

        syncTimeScale();

        const resizeObserver = new ResizeObserver(() => {
          if (container && cumulativeDeltaChartRef.current) {
            const newRect = container.getBoundingClientRect();
            const newWidth = newRect.width || container.clientWidth;
            const newHeight = newRect.height || container.clientHeight;
            if (newWidth > 0 && newHeight > 0) {
              cumulativeDeltaChartRef.current.applyOptions({ width: newWidth, height: newHeight });
            }
          }
        });

        resizeObserver.observe(container);

        // Обновляем данные дельты если есть
        if (chartDataRef.current.length > 0) {
          updateChartData(chartDataRef.current, false);
          syncTimeScale();
          // Повторная синхронизация с задержкой для гарантии
          setTimeout(syncTimeScale, 100);
        }

        return () => {
          resizeObserver.disconnect();
        };
      } catch (error) {
        // Ignore cumulative delta chart initialization errors
      }
    };

    const timeoutId = setTimeout(initChart, 200);

    return () => {
      clearTimeout(timeoutId);
      if (cumulativeDeltaChartRef.current) {
        cumulativeDeltaChartRef.current.remove();
        cumulativeDeltaChartRef.current = null;
      }
      cumulativeDeltaLineSeriesRef.current = null;
      cumulativeDeltaCandleSeriesRef.current = null;
      cumulativeDeltaTrendSeriesRef.current = null;
    };
  }, [showCumulativeDeltaStandard, showCumulativeDeltaTrend, cumulativeDeltaDisplayMode]);

  // Функция расчёта тренда кумулятивной дельты
  // Алгоритм: ступенчатая линия, которая меняет уровень при пробое максимума/минимума за период
  const calculateCumulativeDeltaTrend = useCallback((
    data: { time: Time; value: number }[],
    period: number,
    offsetPercent: number
  ): { time: Time; value: number; color: string }[] => {
    if (data.length < 2) return [];

    const result: { time: Time; value: number; color: string }[] = [];

    // Вычисляем диапазон данных для расчёта отступа
    let dataMin = data[0].value;
    let dataMax = data[0].value;
    for (const point of data) {
      if (point.value < dataMin) dataMin = point.value;
      if (point.value > dataMax) dataMax = point.value;
    }
    const dataRange = dataMax - dataMin;
    // Отступ линии тренда от основной линии (offsetPercent% от диапазона данных)
    const trendOffset = dataRange * (offsetPercent / 100);

    // Инициализируем начальные значения
    let trendLevel = data[0].value;
    let isUptrend = true;
    let periodHigh = data[0].value;
    let periodLow = data[0].value;

    // Цвета тренда
    const upColor = '#3fb950';   // Зелёный для восходящего тренда
    const downColor = '#f85149'; // Красный для нисходящего тренда

    for (let i = 0; i < data.length; i++) {
      const currentValue = data[i].value;

      // Вычисляем максимум и минимум за период
      const lookbackStart = Math.max(0, i - period);
      periodHigh = data[lookbackStart].value;
      periodLow = data[lookbackStart].value;

      for (let j = lookbackStart; j < i; j++) {
        if (data[j].value > periodHigh) periodHigh = data[j].value;
        if (data[j].value < periodLow) periodLow = data[j].value;
      }

      // Определяем изменение тренда
      if (isUptrend) {
        // В восходящем тренде смотрим на пробой минимума
        if (currentValue < periodLow) {
          isUptrend = false;
          trendLevel = currentValue;
        } else if (currentValue > trendLevel) {
          // Обновляем уровень вверх
          trendLevel = currentValue;
        }
      } else {
        // В нисходящем тренде смотрим на пробой максимума
        if (currentValue > periodHigh) {
          isUptrend = true;
          trendLevel = currentValue;
        } else if (currentValue < trendLevel) {
          // Обновляем уровень вниз
          trendLevel = currentValue;
        }
      }

      // Добавляем точку с отступом:
      // При восходящем тренде (зелёный) линия снизу, при нисходящем (красный) - сверху
      const offsetValue = isUptrend ? trendLevel - trendOffset : trendLevel + trendOffset;

      result.push({
        time: data[i].time,
        value: offsetValue,
        color: isUptrend ? upColor : downColor,
      });
    }

    return result;
  }, [isLabMode]);


  // Обновление данных на графике
  const updateChartData = useCallback((candles: CandleData[], fitContent = false) => {
    if (!seriesRef.current || !chartRef.current) return;

    if (!Array.isArray(candles) || candles.length === 0) {
      seriesRef.current.setData([]);
      if (volumeSeriesRef.current) volumeSeriesRef.current.setData([]);
      if (barDeltaSeriesRef.current) barDeltaSeriesRef.current.setData([]);
      if (deltaRotationSeriesRef.current) deltaRotationSeriesRef.current.setData([]);
      if (cumulativeDeltaLineSeriesRef.current) cumulativeDeltaLineSeriesRef.current.setData([]);
      if (cumulativeDeltaCandleSeriesRef.current) cumulativeDeltaCandleSeriesRef.current.setData([]);
      if (cumulativeDeltaTrendSeriesRef.current) cumulativeDeltaTrendSeriesRef.current.setData([]);
      return;
    }

    // Обновляем текущую цену (последняя свеча)
    const lastCandle = candles[candles.length - 1];
    if (lastCandle) {
      const newPrice = lastCandle.close;
      const prevPrice = currentPriceRef.current;
      currentPriceRef.current = newPrice;

      // Проверяем приближение к уровням (только если цена изменилась)
      if (selectedPair && prevPrice !== newPrice) {
        const symbol = selectedPair.symbol;
        const levels = getLevels(symbol);
        const now = Date.now();
        const ALERT_COOLDOWN = 30000; // 30 секунд между сигналами для одного уровня
        const PRICE_PROXIMITY_PERCENT = 0.45; // 0.45% от цены

        levels.forEach(level => {
          const distance = Math.abs(newPrice - level.price);
          const threshold = newPrice * (PRICE_PROXIMITY_PERCENT / 100);

          if (distance <= threshold) {
            const lastAlert = lastAlertTimeRef.current[level.id] || 0;

            if (now - lastAlert > ALERT_COOLDOWN) {
              playAlertSound();
              lastAlertTimeRef.current[level.id] = now;
              console.log(`🔔 Alert: Price ${newPrice.toFixed(4)} near level ${level.price.toFixed(4)}`);
            }
          }
        });
      }
    }

    try {
      // Пересчитываем кумулятивную дельту
      cumulativeDeltaRef.current = 0;

      // Адаптивный формат ценовой шкалы: учитываем полный диапазон и средний размер свечи,
      // чтобы между 2.06 и 2.08 были подписи (2.062, 2.064 … 2.078)
      let dataHigh = -Infinity, dataLow = Infinity, sumBarRange = 0, barCount = 0;
      candles.forEach((c) => {
        const h = typeof c.high === 'number' ? c.high : parseFloat(String(c.high));
        const l = typeof c.low === 'number' ? c.low : parseFloat(String(c.low));
        if (isFinite(h)) dataHigh = Math.max(dataHigh, h);
        if (isFinite(l)) dataLow = Math.min(dataLow, l);
        if (isFinite(h) && isFinite(l)) { sumBarRange += h - l; barCount++; }
      });
      const avgBarRange = barCount > 0 ? sumBarRange / barCount : undefined;
      if (dataHigh > dataLow && isFinite(dataHigh) && isFinite(dataLow) && seriesRef.current) {
        // Получаем precision и minMove из диапазона, но используем кастомный форматтер
        const { precision, minMove } = getPriceFormatFromRange(dataHigh, dataLow, avgBarRange);
        seriesRef.current.applyOptions({
          priceFormat: {
            type: 'custom',
            formatter: formatPriceValue,
            minMove,
          }
        });
      }

      const formattedData: CandlestickData[] = [];
      const volumeData: { time: Time; value: number; color: string }[] = [];
      const barDeltaData: { time: Time; value: number; color?: string }[] = [];
      const deltaRotationData: { time: Time; value: number; color?: string }[] = [];
      const cumulativeDeltaLineData: { time: Time; value: number }[] = [];
      const cumulativeDeltaCandleData: CandlestickData[] = [];

      let prevCumulativeDelta = 0;

      candles.forEach((candle) => {
        let timeValue: number;
        if (typeof candle.time === 'number' && !isNaN(candle.time)) {
          timeValue = Math.floor(candle.time);
        } else if (typeof candle.time === 'string') {
          timeValue = Math.floor(parseFloat(candle.time));
        } else {
          return;
        }

        const open = typeof candle.open === 'number' ? candle.open : parseFloat(String(candle.open));
        const high = typeof candle.high === 'number' ? candle.high : parseFloat(String(candle.high));
        const low = typeof candle.low === 'number' ? candle.low : parseFloat(String(candle.low));
        const close = typeof candle.close === 'number' ? candle.close : parseFloat(String(candle.close));

        if (!isFinite(timeValue) || !isFinite(open) || !isFinite(high) || !isFinite(low) || !isFinite(close)) {
          return;
        }

        const time = timeValue as Time;
        formattedData.push({ time, open, high, low, close });

        // Данные объёма
        const volume = candle.volume || 0;
        const isUp = close >= open;
        volumeData.push({
          time,
          value: volume,
          color: isUp ? 'rgba(8, 153, 129, 0.5)' : 'rgba(242, 56, 90, 0.5)',
        });

        // Всегда готовим данные дельты (независимо от флагов показа)
        const barDelta = candle.barDelta || 0;
        const cdOpen = prevCumulativeDelta;
        cumulativeDeltaRef.current += barDelta;
        const cdClose = cumulativeDeltaRef.current;
        prevCumulativeDelta = cdClose;

        barDeltaData.push({
          time,
          value: barDelta,
          color: barDelta >= 0 ? '#089981' : '#f2385a',
        });

        // Расчет Delta Rotation
        const currentPrice = close; // Текущая цена = close свечи
        const prevPrice = prevPriceRef.current;

        // 1. ОПРЕДЕЛЯЕМ ПЕРВИЧНЫЙ ТРЕНД ЦЕНЫ
        let priceDirection = 0;
        if (prevPrice !== null) {
          if (currentPrice > prevPrice) priceDirection = 1;
          else if (currentPrice < prevPrice) priceDirection = -1;
        }

        // 2. ПРОВЕРЯЕМ УСЛОВИЕ "РОТАЦИИ" (СБРОСА)
        let isRotation = false;

        if (currentTrendRef.current === 0) {
          // Инициализация при первом запуске
          isRotation = true;
        }
        else if (currentTrendRef.current === 1) { // Мы были в синей зоне (UP)
          // Сброс на красный, если цена упала ИЛИ дельта продаж превысила порог
          if (priceDirection === -1 || barDelta < -deltaRotationThreshold) {
            isRotation = true;
          }
        }
        else if (currentTrendRef.current === -1) { // Мы были в красной зоне (DOWN)
          // Сброс на синий, если цена выросла ИЛИ дельта покупок превысила порог
          if (priceDirection === 1 || barDelta > deltaRotationThreshold) {
            isRotation = true;
          }
        }

        // 3. ОБРАБОТКА ЗНАЧЕНИЯ
        if (isRotation) {
          // Если произошла ротация — сбрасываем счетчик и меняем цвет
          currentTrendRef.current = priceDirection !== 0 ? priceDirection : (barDelta > 0 ? 1 : -1);
          cumDeltaRef.current = barDelta;
        }
        else {
          // Если ротации нет — продолжаем копить
          cumDeltaRef.current += barDelta;
        }

        // 4. ВЫВОД ДАННЫХ ДЛЯ ОТРИСОВКИ
        const outputValue = cumDeltaRef.current;
        const outputColor = (currentTrendRef.current === 1) ? '#3b82f6' : '#ef4444'; // BLUE для UP, RED для DOWN

        deltaRotationData.push({
          time,
          value: outputValue,
          color: outputColor,
        });

        // Сохраняем цену для следующей итерации
        prevPriceRef.current = currentPrice;

        // Данные для линейного режима КД
        cumulativeDeltaLineData.push({
          time,
          value: cdClose,
        });

        // Данные для свечного режима КД
        cumulativeDeltaCandleData.push({
          time,
          open: cdOpen,
          high: Math.max(cdOpen, cdClose),
          low: Math.min(cdOpen, cdClose),
          close: cdClose,
        });
      });

      // ОПТИМИЗАЦИЯ: убраны сортировки - данные уже отсортированы от API
      // formattedData.sort(...) - не нужна, данные приходят отсортированными

      if (formattedData.length > 0) {
        seriesRef.current.setData(formattedData);

        // Обновляем объёмы
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.setData(volumeData);
        }


        // Обновляем отдельные графики дельты (если они инициализированы)
        if (barDeltaChartRef.current && barDeltaSeriesRef.current) {
          barDeltaSeriesRef.current.setData(barDeltaData);
        }

        // Обновляем Delta Rotation
        if (deltaRotationChartRef.current && deltaRotationSeriesRef.current) {
          deltaRotationSeriesRef.current.setData(deltaRotationData);
        }

        // Обновляем КД в зависимости от режима отображения
        if (cumulativeDeltaChartRef.current) {
          if (cumulativeDeltaCandleSeriesRef.current) {
            cumulativeDeltaCandleSeriesRef.current.setData(cumulativeDeltaCandleData);
          }
          if (cumulativeDeltaLineSeriesRef.current) {
            cumulativeDeltaLineSeriesRef.current.setData(cumulativeDeltaLineData);
          }

          // Рассчитываем и устанавливаем данные тренда
          if (cumulativeDeltaTrendSeriesRef.current && cumulativeDeltaLineData.length > 0) {
            const trendData = calculateCumulativeDeltaTrend(cumulativeDeltaLineData, trendPeriodRef.current, trendOffsetRef.current);
            cumulativeDeltaTrendSeriesRef.current.setData(trendData);
          }
        }

        // Обновляем Bollinger Bands при каждом обновлении данных
        updateBollingerBands(candles);

        // Синхронизируем временную шкалу
        if (fitContent) {
          chartRef.current.timeScale().fitContent();
        }


        // Синхронизируем графики дельты с основным графиком
        const logicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
        if (logicalRange) {
          if (barDeltaChartRef.current) {
            try {
              barDeltaChartRef.current.timeScale().setVisibleLogicalRange(logicalRange);
            } catch (e) {
              // Ignore
            }
          }
          if (cumulativeDeltaChartRef.current) {
            try {
              cumulativeDeltaChartRef.current.timeScale().setVisibleLogicalRange(logicalRange);
            } catch (e) {
              // Ignore
            }
          }
        }

        // Автопродление фигур с включённым автопродлением
        if (candles.length > 0 && extendDrawings) {
          const lastCandle = candles[candles.length - 1];
          const lastTime = typeof lastCandle.time === 'number'
            ? lastCandle.time
            : parseFloat(String(lastCandle.time));
          if (isFinite(lastTime)) {
            extendDrawings(lastTime);
          }
        }
      }

      requestAnimationFrame(() => {
        drawLevels();
      });
    } catch (error) {
      // Ignore chart update errors
    }
  }, [calculateCumulativeDeltaTrend, extendDrawings, selectedPair, getLevels, updateBollingerBands, drawLevels]);

  // Загрузка истории на график для ML-сделок (setChartDataAndFit из лаборатории)
  useEffect(() => {
    if (chartDataFitTrigger > 0 && chartData.length > 0 && chartRef.current && seriesRef.current) {
      chartDataRef.current = chartData;
      updateChartData(chartData, true);
    }
  }, [chartDataFitTrigger, chartData, updateChartData]);

  // Загрузка данных при смене пары, таймфрейма (и периода в лаборатории)
  useEffect(() => {
    const pairSymbol = selectedPair?.symbol || null;
    const currentTf = timeframe;
    // В лаборатории 200t не поддерживается — используем 5m
    const effectiveTf = isLabMode && currentTf === '200t' ? '5' : currentTf;
    // Пропускаем 200t только в обычном режиме (тиковый график — отдельный компонент)
    if (!isLabMode && currentTf === '200t') {
      return;
    }

    // Если пара и таймфрейм не изменились - не делаем ничего в обычном режиме.
    // В лаборатории всегда разрешаем перезагрузку (для смены периода chartPeriod).
    const samePairAndTf =
      pairSymbol === currentPairRef.current && currentTf === currentTimeframeRef.current;
    if (!isLabMode && samePairAndTf) {
      return;
    }

    // ВОССТАНОВЛЕНИЕ данных из store используем только в обычном режиме.
    // В лаборатории всегда грузим историю заново для выбранного периода.
    if (!isLabMode && !currentPairRef.current && !currentTimeframeRef.current && chartData.length > 0 && pairSymbol) {
      const waitForChartAndRestore = () => {
        if (!chartRef.current || !seriesRef.current) {
          setTimeout(waitForChartAndRestore, 16); // ~1 frame вместо 100ms
          return;
        }

        // Восстанавливаем данные из store
        chartDataRef.current = chartData;
        currentPairRef.current = pairSymbol;
        currentTimeframeRef.current = currentTf;

        // Восстанавливаем кумулятивную дельту (пересчитываем из данных)
        cumulativeDeltaRef.current = 0;
        chartData.forEach(candle => {
          if (candle.barDelta) {
            cumulativeDeltaRef.current += candle.barDelta;
          }
        });

        // Инициализируем refs для динамической подгрузки истории
        if (chartData.length > 0) {
          oldestCandleTimeRef.current = chartData[0].time;
          canLoadMoreRef.current = true;
        }

        // Отображаем данные
        updateChartData(chartData, false);

        // Подключаем WebSocket для обновлений
        const interval = timeframeToInterval(currentTf);
        const isBybit = selectedPair?.exchange === 'Bybit';

        const handleCandleUpdateRestore = (candle: CandleData) => {
          if (currentPairRef.current !== pairSymbol || currentTimeframeRef.current !== currentTf) {
            return;
          }
          const currentData = chartDataRef.current;
          if (currentData.length === 0) {
            chartDataRef.current = [candle];
            updateChartData([candle], true);
            return;
          }
          const lastCandle = currentData[currentData.length - 1];
          if (Math.abs(lastCandle.time - candle.time) < 60) {
            if (lastCandle.barDelta) {
              cumulativeDeltaRef.current -= lastCandle.barDelta;
            }
            chartDataRef.current = [...currentData.slice(0, -1), candle];
          } else {
            chartDataRef.current = [...currentData, candle];
          }
          updateChartData(chartDataRef.current, false);
        };

        if (isBybit) {
          const klineStream = new BybitKlineStream(pairSymbol, interval, handleCandleUpdateRestore);
          klineStream.connect();
          klineStreamRef.current = klineStream;
        } else {
          const klineStream = new BinanceKlineStream(pairSymbol, interval, handleCandleUpdateRestore);
          klineStream.connect();
          klineStreamRef.current = klineStream;
        }
      };

      waitForChartAndRestore();
      return;
    }

    // === ОПТИМИЗАЦИЯ: Сразу показываем loading для мгновенной обратной связи ===
    setIsLoadingChart(true);
    setChartError(null);

    // Сохраняем новые параметры сразу (effectiveTf — в лаборатории 200t → 5m)
    currentPairRef.current = pairSymbol;
    currentTimeframeRef.current = effectiveTf;

    if (!pairSymbol) {
      setIsLoadingChart(false);
      return;
    }

    // Флаг отмены при быстром переключении пар
    let cancelled = false;

    // === Выносим тяжёлую работу в setTimeout(0) чтобы браузер успел отрисовать loading ===
    const workTimeoutId = setTimeout(async () => {
      if (cancelled) return;

      // Отключаем старый стрим
      if (klineStreamRef.current) {
        klineStreamRef.current.disconnect();
        klineStreamRef.current = null;
      }

      // Ждём готовности графика (без лишних задержек)
      const waitForChart = (): Promise<void> => {
        return new Promise((resolve) => {
          const check = () => {
            if (chartRef.current && seriesRef.current) {
              resolve();
            } else {
              setTimeout(check, 16); // ~1 frame
            }
          };
          check();
        });
      };

      await waitForChart();
      if (cancelled) return;

      try {
        const interval = timeframeToInterval(effectiveTf);
        const isBybit = selectedPair?.exchange === 'Bybit';

        // Загрузка данных:
        // - в обычном режиме: последние 500 свечей для быстрого заполнения экрана
        // - в лабораторном режиме: история за выбранный период в днях
        let candles: CandleData[];
        if (isLabMode) {
          const periodDays = Math.max(1, chartPeriod || 3);
          if (isBybit) {
            candles = await getBybitKlinesWithPeriod(pairSymbol, interval, periodDays);
          } else {
            candles = await getKlinesWithPeriod(pairSymbol, interval, periodDays);
          }
        } else {
          if (isBybit) {
            candles = await getBybitKlinesFull(pairSymbol, interval, 500);
          } else {
            candles = await getKlinesInitial(pairSymbol, interval, 500);
          }
        }

        if (cancelled) return;

        // === ТЕПЕРЬ очищаем и устанавливаем новые данные (не раньше!) ===
        // Сбрасываем refs
        cumulativeDeltaRef.current = 0;
        cumDeltaRef.current = 0;
        currentTrendRef.current = 0;
        prevPriceRef.current = null;
        oldestCandleTimeRef.current = null;
        canLoadMoreRef.current = !isLabMode;
        isLoadingMoreRef.current = false;

        // Очищаем старые серии перед установкой новых данных
        if (seriesRef.current) {
          seriesRef.current.setData([]);
        }
        if (volumeSeriesRef.current) {
          volumeSeriesRef.current.setData([]);
        }
        if (barDeltaSeriesRef.current) {
          barDeltaSeriesRef.current.setData([]);
        }
        if (cumulativeDeltaLineSeriesRef.current) {
          cumulativeDeltaLineSeriesRef.current.setData([]);
        }
        if (cumulativeDeltaCandleSeriesRef.current) {
          cumulativeDeltaCandleSeriesRef.current.setData([]);
        }

        // Сбрасываем ценовую шкалу для новой пары
        if (chartRef.current) {
          chartRef.current.priceScale('right').applyOptions({
            autoScale: true,
          });
        }

        // Устанавливаем новые данные
        chartDataRef.current = candles;
        setChartData(candles);
        updateChartData(candles, true);

        if (candles.length > 0) {
          oldestCandleTimeRef.current = candles[0].time;
          canLoadMoreRef.current = true;
        }

        // В лайв-режиме лаборатории прокручиваем к последней свече
        if (isLabMode && labMode === 'live') {
          try {
            chartRef.current?.timeScale().scrollToRealTime();
          } catch {
            // ignore
          }
        }

        // Подключаем WebSocket для live-обновлений
        // ОПТИМИЗАЦИЯ: используем series.update() вместо полного setData()
        const handleCandleUpdate = (candle: CandleData) => {
          if (cancelled || currentPairRef.current !== pairSymbol || currentTimeframeRef.current !== effectiveTf) {
            return;
          }

          const currentData = chartDataRef.current;
          if (currentData.length === 0) {
            chartDataRef.current = [candle];
            updateChartData([candle], true);

            // Лаборатория лайв: инициализация по первой свече
            if (isLabMode && useDomSurfaceStore.getState().mode === 'live') {
              const currentBotType = useDomSurfaceStore.getState().botType;
              if (currentBotType === 'kanal') {
                const kp = useDomSurfaceStore.getState().kanalParams;
                const result = runKanalSimulation(chartDataRef.current, kp);
                setLiveModeStartTradeCount(result.trades.length);
                setSimulationResult(result.trades, result.equityCurve, result.stats, result.finalEquity);
              } else {
                const result = runApexSimulation(
                  chartDataRef.current,
                  { ...apexParams, timeframeMinutes: timeframeToMinutes(effectiveTf) },
                );
                setLiveModeStartTradeCount(result.trades.length);
                setSimulationResult(result.trades, result.equityCurve, result.stats, result.finalEquity);
                setLiveState(result.endState);
              }
              try {
                chartRef.current?.timeScale().scrollToRealTime();
              } catch {
                // ignore
              }
            }
            return;
          }

          const lastCandle = currentData[currentData.length - 1];
          const timeValue = Math.floor(candle.time);
          const isUpdateExisting = Math.abs(lastCandle.time - candle.time) < 60;

          if (isUpdateExisting) {
            // Обновляем последнюю свечу - используем update() вместо setData()
            currentData[currentData.length - 1] = candle;

            // ОПТИМИЗАЦИЯ: быстрое обновление только последней точки
            if (seriesRef.current) {
              seriesRef.current.update({
                time: timeValue as Time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
              });
            }

            // Обновляем объём
            if (volumeSeriesRef.current) {
              const isUp = candle.close >= candle.open;
              volumeSeriesRef.current.update({
                time: timeValue as Time,
                value: candle.volume || 0,
                color: isUp ? 'rgba(8, 153, 129, 0.5)' : 'rgba(242, 56, 90, 0.5)',
              });
            }

            // Обновляем текущую цену для метки
            currentPriceRef.current = candle.close;

          } else {
            // Новая свеча - добавляем
            chartDataRef.current = [...currentData, candle];

            // Для новой свечи используем update() - он добавит её
            if (seriesRef.current) {
              seriesRef.current.update({
                time: timeValue as Time,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
              });
            }

            // Обновляем объём
            if (volumeSeriesRef.current) {
              const isUp = candle.close >= candle.open;
              volumeSeriesRef.current.update({
                time: timeValue as Time,
                value: candle.volume || 0,
                color: isUp ? 'rgba(8, 153, 129, 0.5)' : 'rgba(242, 56, 90, 0.5)',
              });
            }

            // Обновляем дельту для новой свечи
            const barDelta = candle.barDelta || 0;
            cumulativeDeltaRef.current += barDelta;

            if (barDeltaSeriesRef.current) {
              barDeltaSeriesRef.current.update({
                time: timeValue as Time,
                value: barDelta,
                color: barDelta >= 0 ? '#089981' : '#f2385a',
              });
            }

            currentPriceRef.current = candle.close;

            // Обновляем Bollinger Bands при новой свече
            updateBollingerBands();

            // Лаборатория лайв: только по новой свече — инкремент (новые сделки) или инициализация
            if (isLabMode && useDomSurfaceStore.getState().mode === 'live') {
              const storeState = useDomSurfaceStore.getState();
              const currentBotType = storeState.botType;

              if (currentBotType === 'kanal') {
                const kp = storeState.kanalParams;
                const result = runKanalSimulation(chartDataRef.current, kp);
                setSimulationResult(result.trades, result.equityCurve, result.stats, result.finalEquity);
              } else {
                const params = {
                  ...apexParams,
                  timeframeMinutes: timeframeToMinutes(effectiveTf),
                };
                const liveState = storeState.liveState;
                if (liveState === null) {
                  const result = runApexSimulation(chartDataRef.current, params);
                  setLiveModeStartTradeCount(result.trades.length);
                  setSimulationResult(result.trades, result.equityCurve, result.stats, result.finalEquity);
                  setLiveState(result.endState);
                } else {
                  const nextTradeId =
                    storeState.trades.length > 0
                      ? Math.max(...storeState.trades.map((t) => t.id)) + 1
                      : 1;
                  const { newTrades, newState, newEquityCurvePoints } = runApexIncremental(
                    chartDataRef.current,
                    liveState.lastProcessedIndex + 1,
                    liveState,
                    params,
                    nextTradeId,
                  );
                  appendLiveTrades(newTrades, newState.equity, newEquityCurvePoints);
                  setLiveState(newState);
                }
              }
              try {
                chartRef.current?.timeScale().scrollToRealTime();
              } catch {
                // ignore
              }
            }
          }
        };

        if (isBybit) {
          const klineStream = new BybitKlineStream(pairSymbol, interval, handleCandleUpdate);
          klineStream.connect();
          klineStreamRef.current = klineStream;
        } else {
          const klineStream = new BinanceKlineStream(pairSymbol, interval, handleCandleUpdate);
          klineStream.connect();
          klineStreamRef.current = klineStream;
        }

        // Догрузка "до 1000 свечей" в фоне актуальна только для основного режима.
        // В лаборатории мы уже специально загрузили историю за выбранный период
        // (chartPeriod) и не хотим перезаписывать её меньшим срезом.
        if (!isLabMode && !cancelled && candles.length >= 300) {
          try {
            const moreCandles = await (isBybit
              ? getBybitKlinesFull(pairSymbol, interval, 1000)
              : getKlinesInitial(pairSymbol, interval, 1000));

            if (!cancelled && currentPairRef.current === pairSymbol && currentTimeframeRef.current === effectiveTf) {
              chartDataRef.current = moreCandles;
              setChartData(moreCandles);
              updateChartData(moreCandles, false);
              if (moreCandles.length > 0) {
                oldestCandleTimeRef.current = moreCandles[0].time;
              }

              // After background load, check if the current zoom level needs even
              // more candles to fill the screen (e.g. user zoomed out while loading)
              setTimeout(() => {
                if (!cancelled && currentPairRef.current === pairSymbol && currentTimeframeRef.current === effectiveTf) {
                  loadMoreHistoryRef.current();
                }
              }, 200);
            }
          } catch {
            // Игнорируем ошибки фоновой загрузки
          }
        }

      } catch (error: unknown) {
        if (!cancelled && currentPairRef.current === pairSymbol && currentTimeframeRef.current === effectiveTf) {
          const err = error as { response?: { data?: { msg?: string } }; message?: string };
          const msg = err?.response?.data?.msg || err?.message || 'Не удалось загрузить данные. Пара может быть снята с торгов или временно недоступна.';
          setChartError(msg);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingChart(false);
        }
      }
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(workTimeoutId);
      if (klineStreamRef.current) {
        klineStreamRef.current.disconnect();
        klineStreamRef.current = null;
      }
    };
  }, [selectedPair?.symbol, timeframe, chartPeriod, isLabMode, setChartData, setIsLoadingChart, updateChartData]);

  // Лайв: при переключении с «История» на «Лайв» инициализируем состояние по текущим свечам (без перезагрузки)
  useEffect(() => {
    if (!isLabMode || labMode !== 'live' || !chartData.length) return;
    const store = useDomSurfaceStore.getState();
    const currentBotType = store.botType;

    if (currentBotType === 'kanal') {
      const result = runKanalSimulation(chartData, store.kanalParams);
      store.setLiveModeStartTradeCount(result.trades.length);
      store.setSimulationResult(result.trades, result.equityCurve, result.stats, result.finalEquity);
    } else {
      if (store.liveState !== null) return;
      const effectiveTf = timeframe === '200t' ? '5' : timeframe;
      const params = {
        ...store.apexParams,
        timeframeMinutes: timeframeToMinutes(effectiveTf),
      };
      const result = runApexSimulation(chartData, params);
      store.setLiveModeStartTradeCount(result.trades.length);
      store.setSimulationResult(result.trades, result.equityCurve, result.stats, result.finalEquity);
      store.setLiveState(result.endState);
    }
  }, [isLabMode, labMode, chartData.length, chartData, timeframe]);

  // Синхронизация временной шкалы между графиками
  // ОПТИМИЗАЦИЯ: добавляем throttle для синхронизации при скролле/зуме
  useEffect(() => {
    if (!chartRef.current) return;

    const timeScale = chartRef.current.timeScale();
    let syncPending = false;
    let pendingRange: { from: number; to: number } | null = null;

    // Функция синхронизации с throttle через requestAnimationFrame
    const syncDeltaCharts = (logicalRange: { from: number; to: number } | null) => {
      if (!logicalRange) return;

      pendingRange = logicalRange;

      if (!syncPending) {
        syncPending = true;
        requestAnimationFrame(() => {
          if (pendingRange) {
            if (barDeltaChartRef.current) {
              try {
                barDeltaChartRef.current.timeScale().setVisibleLogicalRange(pendingRange);
              } catch (e) {
                // Ignore errors during sync
              }
            }
            if (deltaRotationChartRef.current) {
              try {
                deltaRotationChartRef.current.timeScale().setVisibleLogicalRange(pendingRange);
              } catch (e) {
                // Ignore errors during sync
              }
            }
            if (cumulativeDeltaChartRef.current) {
              try {
                cumulativeDeltaChartRef.current.timeScale().setVisibleLogicalRange(pendingRange);
              } catch (e) {
                // Ignore errors during sync
              }
            }
          }
          syncPending = false;
        });
      }
    };

    // Используем subscribeVisibleLogicalRangeChange для точной синхронизации
    const unsubscribe = timeScale.subscribeVisibleLogicalRangeChange(syncDeltaCharts);

    // Принудительная синхронизация при появлении графиков дельты
    const currentRange = timeScale.getVisibleLogicalRange();
    if (currentRange) {
      syncDeltaCharts(currentRange);
    }

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [showBarDeltaStandard, showDeltaRotationStandard, showCumulativeDeltaStandard]);

  // Синхронизация crosshair (вертикальной линии) между основным графиком и индикаторами дельты
  // ОПТИМИЗАЦИЯ: добавляем throttle для синхронизации crosshair
  useEffect(() => {
    if (!chartRef.current) return;

    const mainChart = chartRef.current;
    let lastSyncTime = 0;

    // Функция синхронизации вертикальной линии crosshair на индикаторы дельты
    const syncCrosshair = (param: any) => {
      // ОПТИМИЗАЦИЯ: throttle - синхронизируем не чаще чем раз в 32ms (~30fps)
      const now = performance.now();
      if (now - lastSyncTime < 32) return;
      lastSyncTime = now;

      const time = param.time;

      // Синхронизируем на график побарной дельты
      if (barDeltaChartRef.current && barDeltaSeriesRef.current) {
        if (time) {
          try {
            // Передаём 0 для value - горизонтальная линия скрыта
            barDeltaChartRef.current.setCrosshairPosition(0, time, barDeltaSeriesRef.current);
          } catch (e) {
            // Игнорируем ошибки
          }
        } else {
          barDeltaChartRef.current.clearCrosshairPosition();
        }
      }

      // Синхронизируем на график Delta Rotation
      if (deltaRotationChartRef.current && deltaRotationSeriesRef.current) {
        if (time) {
          try {
            deltaRotationChartRef.current.setCrosshairPosition(0, time, deltaRotationSeriesRef.current);
          } catch (e) {
            // Игнорируем ошибки
          }
        } else {
          deltaRotationChartRef.current.clearCrosshairPosition();
        }
      }

      // Синхронизируем на график кумулятивной дельты
      const cdSeries = cumulativeDeltaCandleSeriesRef.current || cumulativeDeltaLineSeriesRef.current;
      if (cumulativeDeltaChartRef.current && cdSeries) {
        if (time) {
          try {
            cumulativeDeltaChartRef.current.setCrosshairPosition(0, time, cdSeries);
          } catch (e) {
            // Игнорируем ошибки
          }
        } else {
          cumulativeDeltaChartRef.current.clearCrosshairPosition();
        }
      }
    };

    const unsubscribe = mainChart.subscribeCrosshairMove(syncCrosshair);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [showBarDeltaStandard, showCumulativeDeltaStandard]);

  // Пересчёт тренда при изменении периода
  useEffect(() => {
    if (!cumulativeDeltaTrendSeriesRef.current || !showCumulativeDeltaTrend) return;
    if (chartDataRef.current.length === 0) return;

    // Пересчитываем кумулятивную дельту для расчёта тренда
    let cumDelta = 0;
    const cumulativeDeltaData: { time: Time; value: number }[] = [];

    chartDataRef.current.forEach((candle) => {
      let timeValue: number;
      if (typeof candle.time === 'number' && !isNaN(candle.time)) {
        timeValue = Math.floor(candle.time);
      } else if (typeof candle.time === 'string') {
        timeValue = Math.floor(parseFloat(candle.time));
      } else {
        return;
      }

      const barDelta = candle.barDelta || 0;
      cumDelta += barDelta;

      cumulativeDeltaData.push({
        time: timeValue as Time,
        value: cumDelta,
      });
    });

    if (cumulativeDeltaData.length > 0) {
      const trendData = calculateCumulativeDeltaTrend(cumulativeDeltaData, trendPeriodRef.current, trendOffsetRef.current);
      cumulativeDeltaTrendSeriesRef.current.setData(trendData);
    }
  }, [cumulativeDeltaTrendPeriod, cumulativeDeltaTrendOffset, showCumulativeDeltaTrend, calculateCumulativeDeltaTrend]);

  return (
    <div className="chart-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Основной график */}
      <div
        ref={chartContainerRef}
        onContextMenu={handleContextMenu}
        style={{
          width: '100%',
          flex: 1,
          minHeight: '150px',
          position: 'relative'
        }}
      >
        {/* Панель инструментов рисования */}
        <DrawingToolbar
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          onClear={clearAllDrawings}
          hasDrawings={drawings.length > 0}
        />

        {/* Canvas для отрисовки уровней (лучей) */}
        <canvas
          ref={levelsCanvasRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 51,
          }}
        />

        {/* Canvas для отрисовки сделок (линии) */}
        <canvas
          ref={tradesCanvasRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 50,
          }}
        />

        {/* Кастомная метка цены с обратным отсчётом */}
        {selectedPair && priceY !== null && displayPrice > 0 && (
          <div
            style={{
              position: 'absolute',
              top: `${priceY}px`,
              right: '0px',
              transform: 'translateY(-50%)',
              background: isBullish ? '#089981' : '#f23645',
              padding: '3px 6px',
              fontSize: '0.7rem',
              fontFamily: 'monospace',
              fontWeight: 600,
              color: '#ffffff',
              zIndex: 100,
              minWidth: '55px',
              textAlign: 'center',
              borderRadius: '2px 0 0 2px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              lineHeight: 1.2,
            }}
          >
            <span>{displayPrice.toFixed(displayPrice < 1 ? 6 : displayPrice < 100 ? 4 : 2)}</span>
            {timeframe !== '200t' && (
              <span style={{ fontSize: '0.6rem', opacity: 0.9 }}>{countdown}</span>
            )}
          </div>
        )}

        {/* Список уровней */}
        {selectedPair && getLevels(selectedPair.symbol).length > 0 && (
          <div style={{
            position: 'absolute',
            top: '45px',
            right: '75px',
            background: 'rgba(13, 17, 23, 0.9)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '8px',
            zIndex: 100,
            maxHeight: '200px',
            overflowY: 'auto',
            fontSize: '12px',
          }}>
            <div style={{ color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 600 }}>
              📏 Уровни
            </div>
            {getLevels(selectedPair.symbol).map(level => (
              <div key={level.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 0',
                borderBottom: '1px solid var(--border)',
              }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  background: level.color,
                  borderRadius: '2px',
                }} />
                <span style={{ color: level.color, fontWeight: 500 }}>
                  {level.price.toFixed(4)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeLevel(selectedPair.symbol, level.id);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#f44336',
                    cursor: 'pointer',
                    padding: '2px 4px',
                    fontSize: '14px',
                    marginLeft: 'auto',
                  }}
                  title="Удалить уровень"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {!selectedPair && (
        <div className="chart-placeholder">Выберите пару для отображения графика</div>
      )}

      {/* График побарной дельты */}
      {showBarDeltaStandard && (
        <div ref={barDeltaPanelRef} style={{ height: '120px', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div
            onMouseDown={(e) => handlePanelResize(e, barDeltaPanelRef)}
            style={{
              padding: '4px 8px',
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              background: 'var(--bg-card)',
              cursor: 'ns-resize',
              userSelect: 'none',
              borderTop: '1px solid var(--border)',
            }}
          >
            Побарная дельта
          </div>
          <div ref={barDeltaContainerRef} style={{ width: '100%', flex: 1, minHeight: 0 }} />
        </div>
      )}

      {/* График Delta Rotation */}
      {showDeltaRotationStandard && (
        <div ref={deltaRotationPanelRef} style={{ height: '120px', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div
            onMouseDown={(e) => handlePanelResize(e, deltaRotationPanelRef)}
            style={{
              padding: '4px 8px',
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              background: 'var(--bg-card)',
              cursor: 'ns-resize',
              userSelect: 'none',
              borderTop: '1px solid var(--border)',
            }}
          >
            Delta Rotation
          </div>
          <div ref={deltaRotationContainerRef} style={{ width: '100%', flex: 1, minHeight: 0 }} />
        </div>
      )}

      {/* График кумулятивной дельты */}
      {showCumulativeDeltaStandard && (
        <div ref={cumulativeDeltaPanelRef} style={{ height: '120px', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div
            onMouseDown={(e) => {
              // Не запускаем ресайз если кликнули по кнопке
              if ((e.target as HTMLElement).closest('button')) return;
              handlePanelResize(e, cumulativeDeltaPanelRef);
            }}
            style={{
              padding: '4px 8px',
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              background: 'var(--bg-card)',
              cursor: 'ns-resize',
              userSelect: 'none',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>Кумулятивная дельта</span>
            {showCumulativeDeltaTrend && (
              <span style={{
                color: '#f0b90b',
                fontSize: '0.6rem',
                padding: '1px 4px',
                background: 'rgba(240, 185, 11, 0.15)',
                borderRadius: '3px',
              }}>
                + Тренд ({cumulativeDeltaTrendPeriod})
              </span>
            )}
            <button
              onClick={() => setIsTrendSettingsOpen(true)}
              style={{
                marginLeft: 'auto',
                background: 'rgba(240, 185, 11, 0.1)',
                border: '1px solid rgba(240, 185, 11, 0.3)',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '0.6rem',
                color: '#f0b90b',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              ⚙️ Тренд
            </button>
          </div>
          <div ref={cumulativeDeltaContainerRef} style={{ width: '100%', flex: 1, minHeight: 0 }} />
        </div>
      )}

      {/* Модальное окно настроек КД */}
      <CumulativeDeltaSettingsModal
        isOpen={isTrendSettingsOpen}
        onClose={() => setIsTrendSettingsOpen(false)}
      />

      {chartError && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '12px 16px',
            background: 'rgba(22, 27, 34, 0.95)',
            borderRadius: '6px',
            fontSize: '0.8rem',
            color: '#f85149',
            zIndex: 10,
            maxWidth: '320px',
            textAlign: 'center',
          }}
        >
          {chartError}
        </div>
      )}

      {isLoadingChart && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '8px 12px',
            background: 'rgba(22, 27, 34, 0.9)',
            borderRadius: '6px',
            fontSize: '0.75rem',
            color: '#c9d1d9',
            zIndex: 10,
          }}
        >
          Загрузка...
        </div>
      )}
    </div>
  );
}
