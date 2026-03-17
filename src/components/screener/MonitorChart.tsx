'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import { getKlines, getKlinesBeforeTime, BinanceKlineStream, timeframeToInterval } from '@/lib/binance';
import { getBybitKlinesFull, getBybitKlinesBeforeTime, BybitKlineStream } from '@/lib/bybit';
import { getPriceFormatFromRange } from '@/lib/chartPriceFormat';
import type { BigOrderLevel } from '@/lib/screenerApi';
import type { Timeframe } from '@/types/binance';
import type { MonitorLevel } from '@/components/screener/useRealtimeLevels';

/** Интервал свечи в секундах (для детекции пробела) */
function intervalToSeconds(interval: string): number {
  const map: Record<string, number> = {
    '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '8h': 28800, '12h': 43200,
    '1d': 86400, '1w': 604800, '1M': 2592000,
  };
  return map[interval] ?? 60;
}

const VALID_MIN_MOVES = [
  0.000001, 0.000002, 0.000005, 0.00001, 0.00002, 0.00005, 0.0001, 0.0002, 0.0005,
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1,
];
function toValidMinMove(minMove: number): number {
  if (!isFinite(minMove) || minMove <= 0) return 0.01;
  const clamped = Math.max(0.000001, Math.min(1, minMove));
  for (let i = 0; i < VALID_MIN_MOVES.length; i++) {
    if (VALID_MIN_MOVES[i] >= clamped) return VALID_MIN_MOVES[i];
  }
  return 1;
}

/** Есть ли отскок от уровня по истории свечей (для толщины линии) */
function hadBounce(
  level: BigOrderLevel,
  klines: Array<{ time: number; high: number; low: number; close: number }>,
  startTime?: number
): boolean {
  const price = level.price;
  const bandPct = 0.08; // 0.08% от цены — считаем "коснулся"
  const band = price * (bandPct / 100);
  for (const k of klines) {
    if (startTime && k.time < startTime) continue;
    if (level.side === 'bid') {
      const near = k.low <= price + band && k.low >= price - band;
      if (near && k.close > price) return true; // отскок вверх
    } else {
      const near = k.high >= price - band && k.high <= price + band;
      if (near && k.close < price) return true; // отскок вниз
    }
  }
  return false;
}

type CandleWithVolume = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type Exchange = 'Binance' | 'Bybit';

export type LevelStatus = 'on_place' | 'shifted' | 'gone';

interface MonitorChartProps {
  symbol: string;
  exchange: Exchange;
  levels: MonitorLevel[];
  timeframe: Timeframe;
  /** Статусы из панели мониторинга: «исчез» рисуем пунктиром и приглушённо; «на месте» и «переместился» — сплошные */
  levelStatuses?: Array<{ status: LevelStatus }>;
  /** Вызов при пробитии уровня свечой — уровень убирается из списка */
  onLevelBroken?: (id: string) => void;
}

export default function MonitorChart({ symbol, exchange, levels, timeframe, levelStatuses, onLevelBroken }: MonitorChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const levelSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const klineStreamRef = useRef<BinanceKlineStream | BybitKlineStream | null>(null);
  const klinesRef = useRef<Array<{ time: number; open: number; high: number; low: number; close: number }>>([]);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const allCandlesRef = useRef<CandleWithVolume[]>([]);
  const loadingMoreRef = useRef(false);
  const fillingGapRef = useRef(false);
  const timeRangeUnsubscribeRef = useRef<(() => void) | null>(null);
  const lastCandleTimeRef = useRef<Time | number>(0);
  const levelsRef = useRef<MonitorLevel[]>(levels);
  levelsRef.current = levels;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const interval = timeframeToInterval(timeframe);

  const loadMoreCandles = useCallback(async (beforeTime: number) => {
    if (loadingMoreRef.current || !chartRef.current || !seriesRef.current) return;
    loadingMoreRef.current = true;
    try {
      let older: CandleWithVolume[] = [];
      if (exchange === 'Bybit') {
        older = (await getBybitKlinesBeforeTime(symbol, interval, beforeTime, 100)) as CandleWithVolume[];
      } else {
        const ms = beforeTime * 1000;
        older = (await getKlinesBeforeTime(symbol, interval, ms, 100)) as CandleWithVolume[];
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
      seriesRef.current?.setData(candleData);
      const volumeData = merged.map((c) => ({
        time: c.time as Time,
        value: c.volume ?? 0,
        color: c.close >= c.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
      }));
      volumeSeriesRef.current?.setData(volumeData);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [symbol, exchange, interval]);

  const loadAndDraw = useCallback(async () => {
    if (!containerRef.current) return;
    setLoading(true);
    setError(null);
    try {
      let candles: CandleWithVolume[] = [];
      const initialLimit = 200;
      if (exchange === 'Bybit') {
        candles = (await getBybitKlinesFull(symbol, interval, initialLimit)) as CandleWithVolume[];
      } else {
        candles = (await getKlines(symbol, interval, initialLimit)) as CandleWithVolume[];
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
      volumeSeriesRef.current?.setData(volumeData);

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
        const safeMinMove = toValidMinMove(Number(minMove) || 0.01);
        seriesRef.current.applyOptions({
          priceFormat: {
            type: 'price',
            precision: Math.min(8, Math.max(0, precision)),
            minMove: safeMinMove,
          },
        });
      }

      const lastTime = candleData.length > 0 ? (candleData[candleData.length - 1].time as number) : 0;
      lastCandleTimeRef.current = lastTime;

      levelSeriesRef.current.forEach((s) => chartRef.current?.removeSeries(s));
      levelSeriesRef.current = [];

      const klines = klinesRef.current;
      levels.forEach((lev, idx) => {
        if (!chartRef.current || lastTime <= 0) return;
        let startTime = lev.startTime ?? lastTime;
        if (startTime > lastTime) startTime = lastTime;
        const bounced = hadBounce(lev, klines, lev.startTime);
        const lineWidth = bounced ? 4.5 : 2;
        const levelColor = lev.side === 'bid' ? '#3b82f6' : '#ef4444';
        const levelSeries = chartRef.current.addLineSeries({
          color: levelColor,
          lineWidth,
          lineStyle: 0,
          priceScaleId: 'right',
          lastValueVisible: true,
        });
        const endTime = startTime === lastTime ? lastTime + 60 : lastTime;
        levelSeries.setData([
          { time: startTime as Time, value: lev.price },
          { time: endTime as Time, value: lev.price },
        ]);
        levelSeriesRef.current.push(levelSeries);
      });

      requestAnimationFrame(() => {
        chartRef.current?.timeScale().fitContent();
      });

      if (!klineStreamRef.current && chartRef.current && seriesRef.current) {
        const intervalSec = intervalToSeconds(interval);
        const handleCandleUpdate = (candle: { time: number; open: number; high: number; low: number; close: number; volume?: number }) => {
          const t = candle.time as number;
          const lastKline = klinesRef.current[klinesRef.current.length - 1];
          const hasGap = lastKline && (t - lastKline.time) > intervalSec;

          if (hasGap && !fillingGapRef.current) {
            fillingGapRef.current = true;
            const lastTime = lastKline!.time;
            const fetchPromise =
              exchange === 'Bybit'
                ? getBybitKlinesBeforeTime(symbol, interval, t, 200)
                : getKlinesBeforeTime(symbol, interval, t * 1000, 200);
            fetchPromise
              .then((older) => {
                const gapCandles = (older as CandleWithVolume[]).filter((c) => c.time > lastTime && c.time < t);
                const existing = allCandlesRef.current;
                const existingTimes = new Set(existing.map((c) => c.time));
                const currentCandle: CandleWithVolume = {
                  time: t,
                  open: candle.open,
                  high: candle.high,
                  low: candle.low,
                  close: candle.close,
                  volume: candle.volume ?? 0,
                };
                const toAdd = gapCandles.filter((c) => !existingTimes.has(c.time));
                const merged = [...existing, ...toAdd, currentCandle].sort((a, b) => a.time - b.time);
                const deduped: CandleWithVolume[] = [];
                const seen = new Set<number>();
                for (const c of merged) {
                  if (seen.has(c.time)) continue;
                  seen.add(c.time);
                  deduped.push(c);
                }
                allCandlesRef.current = deduped;
                klinesRef.current = deduped.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
                const candleData: CandlestickData[] = deduped.map((c) => ({
                  time: c.time as Time,
                  open: c.open,
                  high: c.high,
                  low: c.low,
                  close: c.close,
                }));
                seriesRef.current?.setData(candleData);
                const volumeData = deduped.map((c) => ({
                  time: c.time as Time,
                  value: c.volume ?? 0,
                  color: c.close >= c.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
                }));
                volumeSeriesRef.current?.setData(volumeData);
                lastCandleTimeRef.current = t;
                fillingGapRef.current = false;
              })
              .catch(() => {
                fillingGapRef.current = false;
              });
          }

          seriesRef.current?.update({
            time: t as Time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          });
          volumeSeriesRef.current?.update({
            time: t as Time,
            value: candle.volume ?? 0,
            color: candle.close >= candle.open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
          });
          lastCandleTimeRef.current = t;
          if (lastKline && lastKline.time === t) {
            lastKline.open = candle.open;
            lastKline.high = Math.max(lastKline.high, candle.high);
            lastKline.low = Math.min(lastKline.low, candle.low);
            lastKline.close = candle.close;
          } else if (!lastKline || t > lastKline.time) {
            if (!hasGap) {
              klinesRef.current.push({
                time: t,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
              });
              if (klinesRef.current.length > 150) klinesRef.current.shift();
            }
          }
          const currentLevels = levelsRef.current;
          const brokenIds: string[] = [];
          currentLevels.forEach((lev, i) => {
            const broken = lev.side === 'bid' ? candle.low < lev.price : candle.high > lev.price;
            if (broken) brokenIds.push(lev.id);
          });
          brokenIds.forEach((id) => onLevelBroken?.(id));
          levelSeriesRef.current.forEach((ls, i) => {
            const lev = currentLevels[i];
            if (!lev) return;
            const endTime = lev.startTime === t ? t + 60 : t;
            ls.setData([
              { time: (lev.startTime ?? lastCandleTimeRef.current) as Time, value: lev.price },
              { time: endTime as Time, value: lev.price },
            ]);
          });
        };
        if (exchange === 'Bybit') {
          klineStreamRef.current = new BybitKlineStream(symbol, interval, handleCandleUpdate);
        } else {
          klineStreamRef.current = new BinanceKlineStream(symbol, interval, handleCandleUpdate);
        }
        klineStreamRef.current.connect();
      }

      timeRangeUnsubscribeRef.current?.();
      if (chartRef.current && allCandlesRef.current.length > 0) {
        const EDGE_BUFFER_SEC = 300;
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
      console.error('[MonitorChart]', symbol, e);
    } finally {
      setLoading(false);
    }
  }, [symbol, exchange, interval, levels, loadMoreCandles, onLevelBroken]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chartHeight = Math.max(400, container.clientHeight || 400);
    const chart = createChart(container, {
      width: container.clientWidth,
      height: chartHeight,
      layout: {
        background: { type: 'solid', color: '#0d1117' },
        textColor: '#8b949e',
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: {
        borderVisible: true,
        scaleMargins: { top: 0.05, bottom: 0.05 },
        ticksVisible: true,
        entireTextOnly: false,
      },
      timeScale: { borderVisible: true, timeVisible: true, secondsVisible: false, rightBarOffset: 0 },
      crosshair: { vertLine: { visible: true }, horzLine: { visible: true } },
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
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;
    loadAndDraw();
    const onResize = () => {
      if (container && chartRef.current) chartRef.current.applyOptions({ width: container.clientWidth });
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
  }, [symbol, exchange, timeframe]);

  useEffect(() => {
    const lastTime = lastCandleTimeRef.current as number;
    if (!chartRef.current || loading || levels.length === 0 || lastTime <= 0) return;
    const klines = klinesRef.current;
    levelSeriesRef.current.forEach((s) => chartRef.current?.removeSeries(s));
    const newSeries: ISeriesApi<'Line'>[] = [];
    levels.forEach((lev, i) => {
      if (!chartRef.current || lastTime <= 0) return;
      const status = levelStatuses?.[i]?.status;
      const isGone = status === 'gone';
      let startTime = lev.startTime ?? lastTime;
      if (startTime > lastTime) startTime = lastTime;
      const bounced = hadBounce(lev, klines, lev.startTime);
      const lineWidth = bounced ? 4.5 : 2;
      const levelColor = lev.side === 'bid' ? '#3b82f6' : '#ef4444';
      const color = isGone ? (lev.side === 'bid' ? 'rgba(59, 130, 246, 0.35)' : 'rgba(239, 68, 68, 0.35)') : levelColor;
      const levelSeries = chartRef.current!.addLineSeries({
        color,
        lineWidth: isGone ? 1.5 : lineWidth,
        lineStyle: isGone ? 2 : 0,
        priceScaleId: 'right',
        lastValueVisible: true,
      });
      const endTime = startTime === lastTime ? lastTime + 60 : lastTime;
      levelSeries.setData([
        { time: startTime as Time, value: lev.price },
        { time: endTime as Time, value: lev.price },
      ]);
      newSeries.push(levelSeries);
    });
    levelSeriesRef.current = newSeries;
  }, [levels, loading, levelStatuses]);

  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div ref={containerRef} style={{ width: '100%', flex: 1, minHeight: 400 }} />
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
  );
}
