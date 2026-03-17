'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import { getKlines, getKlinesBeforeTime, BinanceKlineStream } from '@/lib/binance';
import { getBybitKlinesFull, getBybitKlinesBeforeTime, BybitKlineStream } from '@/lib/bybit';
import { getPriceFormatFromRange } from '@/lib/chartPriceFormat';
import type { BigOrderLevel } from '@/lib/screenerApi';

type Exchange = 'Binance' | 'Bybit';

type CandleWithVolume = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

interface ScreenerMiniChartProps {
  symbol: string;
  levels: BigOrderLevel[];
  onOpenChart?: (symbol: string, exchange?: Exchange) => void;
  /** Колбэк когда все уровни пробиты — карточку можно скрыть */
  onAllLevelsBroken?: (symbol: string) => void;
  /** Колбэк при нажатии крестика — скрыть карточку до появления уровня снова */
  onDismiss?: (symbol: string) => void;
}

function formatVolumeUsdt(volume: number): string {
  if (volume >= 1_000_000) return (volume / 1_000_000).toFixed(1) + 'M';
  if (volume >= 1000) return (volume / 1000).toFixed(1) + 'K';
  return volume.toFixed(0);
}

/** Форматирование цены для шкалы (больше знаков после запятой для мелких цен) */
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

/**
 * Приводит minMove к значению, при котором base = round(1/minMove) содержит только множители 2 и 5.
 * Иначе lightweight-charts выбрасывает "unexpected base" в PriceTickSpanCalculator.
 */
const VALID_MIN_MOVES = [
  0.000001, 0.000002, 0.000005, 0.00001, 0.00002, 0.00005, 0.0001, 0.0002, 0.0005,
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1,
];
function toValidMinMove(minMove: number): number {
  if (!isFinite(minMove) || minMove <= 0) return 0.01;
  const clamped = Math.max(0.000001, Math.min(1, minMove));
  // Берём наименьший допустимый шаг >= clamped
  for (let i = 0; i < VALID_MIN_MOVES.length; i++) {
    if (VALID_MIN_MOVES[i] >= clamped) return VALID_MIN_MOVES[i];
  }
  return 1;
}

/**
 * Проверяет, пробит ли уровень текущими свечами.
 * Bid (поддержка): пробит если low опустился НИЖЕ уровня
 * Ask (сопротивление): пробит если high поднялся ВЫШЕ уровня
 * 
 * Без допуска — если цена прошла через уровень хоть на копейку, он пробит.
 */
function isLevelBroken(
  level: BigOrderLevel,
  klines: Array<{ time: number; low: number; high: number }>,
  startTime?: number
): boolean {
  const price = level.price;
  
  for (const k of klines) {
    // Проверяем только свечи ПОСЛЕ появления уровня
    if (startTime && k.time < startTime) continue;
    
    // Bid (поддержка): пробит если low < уровня
    if (level.side === 'bid' && k.low < price) {
      return true;
    }
    // Ask (сопротивление): пробит если high > уровня
    if (level.side === 'ask' && k.high > price) {
      return true;
    }
  }
  return false;
}

export default function ScreenerMiniChart({ symbol, levels, onOpenChart, onAllLevelsBroken, onDismiss }: ScreenerMiniChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const levelSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const levelDataRef = useRef<Array<{ startTime: number; price: number; side: 'bid' | 'ask' }>>([]);
  const lastCandleTimeRef = useRef<Time | number>(0);
  const klineStreamRef = useRef<BinanceKlineStream | BybitKlineStream | null>(null);
  const klinesRef = useRef<Array<{ time: number; open: number; high: number; low: number; close: number }>>([]);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const allCandlesRef = useRef<CandleWithVolume[]>([]);
  const loadingMoreRef = useRef(false);
  const timeRangeUnsubscribeRef = useRef<(() => void) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeLevels, setActiveLevels] = useState<BigOrderLevel[]>(levels);
  const notifiedBrokenRef = useRef(false);
  
  // Определяем биржу по первому уровню
  const exchange: Exchange = levels[0]?.exchange ?? 'Binance';

  // Фильтруем пробитые уровни при изменении levels или klines
  const filterBrokenLevels = useCallback((levelsToCheck: BigOrderLevel[], klines: typeof klinesRef.current) => {
    const valid = levelsToCheck.filter((lev) => !isLevelBroken(lev, klines, lev.startTime));
    setActiveLevels(valid);
    
    // Уведомляем если все уровни пробиты
    if (valid.length === 0 && levelsToCheck.length > 0 && !notifiedBrokenRef.current) {
      notifiedBrokenRef.current = true;
      onAllLevelsBroken?.(symbol);
    }
    return valid;
  }, [symbol, onAllLevelsBroken]);

  const loadMoreCandles = useCallback(async (beforeTime: number) => {
    if (loadingMoreRef.current || !chartRef.current || !seriesRef.current) return;
    loadingMoreRef.current = true;
    try {
      let older: CandleWithVolume[] = [];
      if (exchange === 'Bybit') {
        older = (await getBybitKlinesBeforeTime(symbol, '1m', beforeTime, 100)) as CandleWithVolume[];
      } else {
        const ms = beforeTime * 1000;
        older = (await getKlinesBeforeTime(symbol, '1m', ms, 100)) as CandleWithVolume[];
      }
      if (!older.length) {
        loadingMoreRef.current = false;
        return;
      }
      const existing = allCandlesRef.current;
      const existingTimes = new Set(existing.map((c) => c.time));
      const newOnly = older.filter((c) => !existingTimes.has(c.time));
      if (!newOnly.length) {
        loadingMoreRef.current = false;
        return;
      }
      const merged: CandleWithVolume[] = [...newOnly, ...existing].sort((a, b) => a.time - b.time);
      allCandlesRef.current = merged;
      klinesRef.current = merged.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
      const candleData: CandlestickData[] = merged.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      if (!seriesRef.current) return;
      seriesRef.current.setData(candleData);
      const volumeData = merged.map((c) => ({
        time: c.time as Time,
        value: c.volume ?? 0,
        color: c.close >= c.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
      }));
      volumeSeriesRef.current?.setData(volumeData);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [symbol, exchange]);

  const loadAndDraw = useCallback(async () => {
    if (!containerRef.current) return;
    setLoading(true);
    setError(null);
    try {
      // Загружаем свечи с правильной биржи (с объёмом)
      let candles: CandleWithVolume[] = [];
      
      const initialLimit = 200;
      if (exchange === 'Bybit') {
        candles = (await getBybitKlinesFull(symbol, '1m', initialLimit)) as CandleWithVolume[];
      } else {
        candles = (await getKlines(symbol, '1m', initialLimit)) as CandleWithVolume[];
      }
      
      if (!candles.length) {
        setError('Нет данных');
        setLoading(false);
        return;
      }
      
      allCandlesRef.current = candles;
      klinesRef.current = candles.map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      
      const candleData: CandlestickData[] = candles.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));

      if (!chartRef.current || !seriesRef.current) {
        setLoading(false);
        return;
      }
      seriesRef.current.setData(candleData);

      const volumeData = candles.map((c) => ({
        time: c.time as Time,
        value: Number(c.volume) || 0,
        color: c.close >= c.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
      }));
      if (volumeSeriesRef.current) {
        volumeSeriesRef.current.setData(volumeData);
      }

      // Шкала цены: больше знаков после запятой и больше меток по вертикали
      let dataHigh = -Infinity;
      let dataLow = Infinity;
      let sumBarRange = 0;
      let barCount = 0;
      candles.forEach((c) => {
        if (isFinite(c.high)) dataHigh = Math.max(dataHigh, c.high);
        if (isFinite(c.low)) dataLow = Math.min(dataLow, c.low);
        if (isFinite(c.high) && isFinite(c.low)) {
          sumBarRange += c.high - c.low;
          barCount++;
        }
      });
      const avgBarRange = barCount > 0 ? sumBarRange / barCount : undefined;
      if (dataHigh > dataLow && isFinite(dataHigh) && isFinite(dataLow)) {
        const { precision, minMove } = getPriceFormatFromRange(dataHigh, dataLow, avgBarRange);
        // base = round(1/minMove) должен содержать только 2 и 5, иначе "unexpected base"
        const safeMinMove = toValidMinMove(Number(minMove) || 0.01);
        seriesRef.current.applyOptions({
          priceFormat: {
            type: 'price',
            precision: Math.min(8, Math.max(0, precision)),
            minMove: safeMinMove,
          },
        });
      }

      levelSeriesRef.current.forEach((s) => {
        if (chartRef.current) chartRef.current.removeSeries(s);
      });
      levelSeriesRef.current = [];

      const lastTime = candleData.length > 0 ? (candleData[candleData.length - 1].time as number) : 0;
      lastCandleTimeRef.current = lastTime;

      // Фильтруем пробитые уровни
      const validLevels = filterBrokenLevels(levels, klinesRef.current);

      levelDataRef.current = [];
      validLevels.forEach((lev) => {
        if (!chartRef.current) return;
        if (lastTime <= 0) return;
        
        // startTime не должен быть больше lastTime (иначе линия не отрисуется)
        // Если startTime в будущем относительно свечей — используем lastTime
        let startTime = lev.startTime ?? lastTime;
        if (startTime > lastTime) {
          startTime = lastTime;
        }
        
        levelDataRef.current.push({ startTime, price: lev.price, side: lev.side });
        const levelColor = lev.side === 'bid' ? '#3b82f6' : '#ef4444';
        
        // Только одна горизонтальная линия от свечи вправо
        const levelSeries = chartRef.current.addLineSeries({
          color: levelColor,
          lineWidth: 4.5,
          lineStyle: 0, // Сплошная
          priceScaleId: 'right',
          lastValueVisible: true, // Показываем цену на шкале
        });
        // Если startTime == lastTime, добавляем 60 секунд чтобы избежать ошибки библиотеки
        const endTime = startTime === lastTime ? lastTime + 60 : lastTime;
        levelSeries.setData([
          { time: startTime as Time, value: lev.price },
          { time: endTime as Time, value: lev.price },
        ]);
        levelSeriesRef.current.push(levelSeries);
      });

      requestAnimationFrame(() => {
        chartRef.current?.timeScale().fitContent();
        requestAnimationFrame(() => {
          chartRef.current?.timeScale().fitContent();
        });
      });

      // Подписка на живые обновления: свечи + проверка пробития уровней
      if (!klineStreamRef.current && chartRef.current && seriesRef.current) {
        // Обработчик обновления свечи (общий для обеих бирж)
        const handleCandleUpdate = (candle: { time: number; open: number; high: number; low: number; close: number; volume?: number }) => {
          const t = candle.time as number;
          if (seriesRef.current) {
            seriesRef.current.update({
              time: t as Time,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
            });
          }
          const vol = candle.volume ?? 0;
          if (volumeSeriesRef.current) {
            volumeSeriesRef.current.update({
              time: t as Time,
              value: vol,
              color: candle.close >= candle.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
            });
          }
          lastCandleTimeRef.current = t;
          
          // Обновляем klines (добавляем/обновляем последнюю свечу)
          const lastKline = klinesRef.current[klinesRef.current.length - 1];
          if (lastKline && lastKline.time === t) {
            // Обновляем существующую
            lastKline.open = candle.open;
            lastKline.high = Math.max(lastKline.high, candle.high);
            lastKline.low = Math.min(lastKline.low, candle.low);
            lastKline.close = candle.close;
          } else if (!lastKline || t > lastKline.time) {
            // Новая свеча
            klinesRef.current.push({
              time: t,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
            });
            // Ограничиваем размер массива
            if (klinesRef.current.length > 150) {
              klinesRef.current.shift();
            }
          }
          
          // Проверяем пробитие уровней и убираем пробитые
          const levelsToRemove: number[] = [];
          levelDataRef.current.forEach((lev, i) => {
            const levelSeries = levelSeriesRef.current[i];
            if (!levelSeries) return;
            
            // Проверяем пробитие: bid пробит если low < уровня, ask пробит если high > уровня
            const broken = (lev.side === 'bid' && candle.low < lev.price) ||
                          (lev.side === 'ask' && candle.high > lev.price);
            
            if (broken) {
              levelsToRemove.push(i);
              if (chartRef.current) {
                chartRef.current.removeSeries(levelSeries);
              }
            } else if (t >= lev.startTime) {
              // Продлеваем линию до текущей свечи
              const endTime = lev.startTime === t ? t + 60 : t;
              levelSeries.setData([
                { time: lev.startTime as Time, value: lev.price },
                { time: endTime as Time, value: lev.price },
              ]);
            }
          });
          
          // Удаляем пробитые уровни из массивов (с конца чтобы индексы не сбились)
          if (levelsToRemove.length > 0) {
            for (let i = levelsToRemove.length - 1; i >= 0; i--) {
              const idx = levelsToRemove[i];
              levelDataRef.current.splice(idx, 1);
              levelSeriesRef.current.splice(idx, 1);
            }
            
            // Обновляем state и проверяем нужно ли скрывать карточку
            setActiveLevels((prev) => {
              const newLevels = prev.filter((_, i) => !levelsToRemove.includes(i));
              if (newLevels.length === 0 && prev.length > 0 && !notifiedBrokenRef.current) {
                notifiedBrokenRef.current = true;
                onAllLevelsBroken?.(symbol);
              }
              return newLevels;
            });
          }
        };
        
        // Создаём стрим для соответствующей биржи
        if (exchange === 'Bybit') {
          klineStreamRef.current = new BybitKlineStream(symbol, '1m', handleCandleUpdate);
        } else {
          klineStreamRef.current = new BinanceKlineStream(symbol, '1m', handleCandleUpdate);
        }
        klineStreamRef.current.connect();
      }

      // Подгрузка свечей при сужении/зуме графика — когда видимая область приближается к левому краю
      timeRangeUnsubscribeRef.current?.();
      if (chartRef.current && allCandlesRef.current.length > 0) {
        const EDGE_BUFFER_SEC = 300; // загружаем когда до левого края остаётся 5 мин
        const handler = (range: { from: number; to: number } | null) => {
          if (!range?.from) return;
          const fromTime = typeof range.from === 'number' ? range.from : (range.from as unknown as number);
          const first = allCandlesRef.current[0]?.time;
          if (first != null && fromTime <= first + EDGE_BUFFER_SEC && !loadingMoreRef.current) {
            loadMoreCandles(first);
          }
        };
        chartRef.current.timeScale().subscribeVisibleTimeRangeChange(handler);
        timeRangeUnsubscribeRef.current = () => chartRef.current?.timeScale().unsubscribeVisibleTimeRangeChange(handler);
      }
    } catch (e) {
      setError('Ошибка загрузки');
      console.error('[ScreenerMiniChart]', symbol, e);
    } finally {
      setLoading(false);
    }
  }, [symbol, levels, filterBrokenLevels, onAllLevelsBroken, exchange, loadMoreCandles]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 300,
      layout: { 
        background: { type: 'solid', color: '#0d1117' }, 
        textColor: '#8b949e',
        attributionLogo: false, // Убираем логотип TradingView
      },
      grid: { 
        vertLines: { visible: false }, 
        horzLines: { visible: false } // Полностью отключаем горизонтальную сетку, чтобы не путать с уровнями
      },
      rightPriceScale: { 
        borderVisible: true, 
        scaleMargins: { top: 0.05, bottom: 0.05 }, // Меньше отступы — больше места для цен
        ticksVisible: true, // Показываем тики
        entireTextOnly: false, // Показываем больше значений
      },
      timeScale: { borderVisible: true, timeVisible: true, secondsVisible: false, rightBarOffset: 0 },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } }, // Отключаем перекрестие в мини-чартах
    });

    const series = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      lastValueVisible: false,
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;

    loadAndDraw();

    const onResize = () => {
      if (container && chartRef.current) {
        chartRef.current.applyOptions({ width: container.clientWidth });
      }
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    return () => {
      timeRangeUnsubscribeRef.current?.();
      timeRangeUnsubscribeRef.current = null;
      if (klineStreamRef.current) {
        klineStreamRef.current.disconnect();
        klineStreamRef.current = null;
      }
      levelSeriesRef.current.forEach((s) => chart.removeSeries(s));
      levelSeriesRef.current = [];
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!chartRef.current || loading || levels.length === 0) return;
    const lastTime = lastCandleTimeRef.current as number;
    
    // Сбрасываем флаг уведомления при получении новых уровней
    notifiedBrokenRef.current = false;
    
    // Фильтруем пробитые уровни
    const validLevels = klinesRef.current.length > 0
      ? levels.filter((lev) => !isLevelBroken(lev, klinesRef.current, lev.startTime))
      : levels;
    
    setActiveLevels(validLevels);
    
    levelSeriesRef.current.forEach((s) => chartRef.current?.removeSeries(s));
    levelSeriesRef.current = [];
    levelDataRef.current = validLevels
      .map((lev) => ({ startTime: lev.startTime ?? lastTime, price: lev.price, side: lev.side }))
      .filter((lev) => lastTime > 0 && lev.startTime <= lastTime);
    validLevels.forEach((lev) => {
      if (!chartRef.current) return;
      const startTime = lev.startTime ?? lastTime;
      if (!lastTime || startTime > lastTime) return;
      const levelColor = lev.side === 'bid' ? '#3b82f6' : '#ef4444';
      
      // Только одна горизонтальная линия от свечи вправо
      const levelSeries = chartRef.current.addLineSeries({
        color: levelColor,
        lineWidth: 4.5,
        lineStyle: 0, // Сплошная
        priceScaleId: 'right',
        lastValueVisible: true, // Показываем цену на шкале
      });
      // Если startTime == lastTime, добавляем 60 секунд чтобы избежать ошибки библиотеки
      const endTime = startTime === lastTime ? lastTime + 60 : lastTime;
      levelSeries.setData([
        { time: startTime as Time, value: lev.price },
        { time: endTime as Time, value: lev.price },
      ]);
      levelSeriesRef.current.push(levelSeries);
    });
    
    // Уведомляем если все уровни пробиты
    if (validLevels.length === 0 && levels.length > 0 && !notifiedBrokenRef.current) {
      notifiedBrokenRef.current = true;
      onAllLevelsBroken?.(symbol);
    }
  }, [levels, loading, symbol, onAllLevelsBroken]);

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 320,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{symbol}</span>
          {levels[0]?.exchange === 'Binance' && (
            <span style={{
              fontSize: '0.6rem',
              padding: '2px 4px',
              borderRadius: '3px',
              background: 'rgba(240, 185, 11, 0.15)',
              color: '#f0b90b',
              fontWeight: 600,
            }}>BN</span>
          )}
          {levels[0]?.exchange === 'Bybit' && (
            <span style={{
              fontSize: '0.6rem',
              padding: '2px 4px',
              borderRadius: '3px',
              background: 'rgba(242, 153, 74, 0.2)',
              color: '#f2994a',
              fontWeight: 600,
            }}>BB</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onOpenChart && (
            <a
              href={`/screener/monitor?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`}
              onClick={(e) => {
                e.preventDefault();
                try {
                  sessionStorage.setItem(
                    'screener-monitor',
                    JSON.stringify({ symbol, exchange, levels: activeLevels })
                  );
                } catch {
                  // ignore
                }
                onOpenChart(symbol, exchange);
                window.location.href = `/screener/monitor?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(exchange)}`;
              }}
              style={{
                fontSize: '0.8rem',
                color: '#3b82f6',
                textDecoration: 'none',
              }}
            >
              Открыть график →
            </a>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={() => onDismiss(symbol)}
              title="Убрать карточку до появления уровня снова"
              style={{
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                border: 'none',
                borderRadius: '6px',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '1.1rem',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 300, position: 'relative' }}>
        {loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-main)',
              color: 'var(--text-muted)',
              fontSize: '0.85rem',
            }}
          >
            Загрузка…
          </div>
        )}
        {error && !loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-main)',
              color: 'var(--text-muted)',
              fontSize: '0.85rem',
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
