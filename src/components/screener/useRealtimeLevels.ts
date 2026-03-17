'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { BinanceDepthStream } from '@/lib/binance';
import { BybitDepthStream } from '@/lib/bybit';
import { getAdaptiveDepthLevels } from '@/lib/orderBookUtils';
import type { BigOrderLevel } from '@/lib/screenerApi';
import type { LevelMonitorItem, LevelMonitorStatus } from '@/components/screener/LevelMonitorPanel';

export interface MonitorLevel extends BigOrderLevel {
  id: string;
}

const MIN_VOLUME_RATIO = 0.1;
const PRICE_BAND_PCT = 0.08;
const SHIFT_BAND_PCT = 0.15;
const MAX_DISTANCE_PCT = 3;
const CLUSTER_PCT = 0.1;
const MATCH_PCT = 0.05;
const DEFAULT_MIN_VOLUME_USDT = 20_000;
const NEW_LEVEL_MIN_RATIO = 0.5;

function getStatus(
  level: BigOrderLevel,
  bids: Array<{ price: number; quantity: number }>,
  asks: Array<{ price: number; quantity: number }>
): { status: LevelMonitorStatus; currentPrice?: number; volumeUsdt?: number } {
  const side = level.side;
  const arr = side === 'bid' ? bids : asks;
  const price = level.price;
  const minVolumeUsdt = level.volumeUsdt * MIN_VOLUME_RATIO;
  const band = price * (PRICE_BAND_PCT / 100);
  const shiftBand = price * (SHIFT_BAND_PCT / 100);

  let bestAtPlace: { price: number; volumeUsdt: number } | null = null;
  let bestShifted: { price: number; volumeUsdt: number } | null = null;

  for (const row of arr) {
    const volumeUsdt = row.price * row.quantity;
    const dist = Math.abs(row.price - price);
    if (dist <= band && volumeUsdt >= minVolumeUsdt) {
      if (!bestAtPlace || volumeUsdt > bestAtPlace.volumeUsdt) bestAtPlace = { price: row.price, volumeUsdt };
    } else if (dist <= shiftBand && volumeUsdt >= minVolumeUsdt) {
      if (!bestShifted || volumeUsdt > bestShifted.volumeUsdt) bestShifted = { price: row.price, volumeUsdt };
    }
  }
  if (bestAtPlace) return { status: 'on_place', currentPrice: bestAtPlace.price, volumeUsdt: bestAtPlace.volumeUsdt };
  if (bestShifted) return { status: 'shifted', currentPrice: bestShifted.price, volumeUsdt: bestShifted.volumeUsdt };
  return { status: 'gone' };
}

function clusterByPrice(
  rows: Array<{ price: number; quantity: number }>,
  side: 'bid' | 'ask',
  midPrice: number,
  minVolumeUsdt: number,
  maxDistancePct: number
): Array<{ price: number; volumeUsdt: number; side: 'bid' | 'ask' }> {
  const pct = maxDistancePct / 100;
  const filtered =
    side === 'bid'
      ? rows.filter((r) => r.price <= midPrice && r.price >= midPrice * (1 - pct))
      : rows.filter((r) => r.price >= midPrice && r.price <= midPrice * (1 + pct));
  const withUsdt = filtered
    .map((r) => ({ price: r.price, volumeUsdt: r.price * r.quantity, side }))
    .filter((r) => r.volumeUsdt >= minVolumeUsdt);
  if (withUsdt.length === 0) return [];
  const sorted = [...withUsdt].sort((a, b) => a.price - b.price);
  const clusters: Array<{ price: number; volumeUsdt: number; side: 'bid' | 'ask' }> = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const row = sorted[i];
    const diffPct = (Math.abs(row.price - cur.price) / midPrice) * 100;
    if (diffPct <= CLUSTER_PCT) {
      const total = cur.volumeUsdt + row.volumeUsdt;
      cur.price = (cur.price * cur.volumeUsdt + row.price * row.volumeUsdt) / total;
      cur.volumeUsdt = total;
    } else {
      clusters.push(cur);
      cur = { ...row };
    }
  }
  clusters.push(cur);
  return clusters;
}

function findNewLevels(
  bids: Array<{ price: number; quantity: number }>,
  asks: Array<{ price: number; quantity: number }>,
  existingLevels: MonitorLevel[],
  minVolumeUsdt: number
): Array<Omit<MonitorLevel, 'id'>> {
  if (bids.length === 0 || asks.length === 0) return [];
  const bestBid = bids[0].price;
  const bestAsk = asks[0].price;
  const midPrice = (bestBid + bestAsk) / 2;

  const newOnes: Array<{ price: number; volumeUsdt: number; side: 'bid' | 'ask' }> = [];
  const bidClusters = clusterByPrice(bids, 'bid', midPrice, minVolumeUsdt, MAX_DISTANCE_PCT);
  const askClusters = clusterByPrice(asks, 'ask', midPrice, minVolumeUsdt, MAX_DISTANCE_PCT);
  const matchBand = midPrice * (MATCH_PCT / 100);

  for (const c of bidClusters) {
    const exists = existingLevels.some(
      (l) => l.side === 'bid' && Math.abs(l.price - c.price) <= matchBand
    );
    if (!exists) newOnes.push(c);
  }
  for (const c of askClusters) {
    const exists = existingLevels.some(
      (l) => l.side === 'ask' && Math.abs(l.price - c.price) <= matchBand
    );
    if (!exists) newOnes.push(c);
  }

  return newOnes.map((l) => ({
    price: l.price,
    volumeUsdt: l.volumeUsdt,
    side: l.side,
    startTime: Math.floor(Date.now() / 1000),
  }));
}

type Exchange = 'Binance' | 'Bybit';
type DepthData = { bids: Array<{ price: number; quantity: number }>; asks: Array<{ price: number; quantity: number }> };

export function useRealtimeLevels(
  symbol: string,
  exchange: Exchange,
  initialLevels: BigOrderLevel[]
) {
  const [levels, setLevels] = useState<MonitorLevel[]>(() =>
    initialLevels.map((l, i) => ({
      ...l,
      id: `init-${i}-${l.price}-${l.side}`,
    }))
  );
  const [levelStatuses, setLevelStatuses] = useState<LevelMonitorItem[]>([]);
  const depthRef = useRef<BinanceDepthStream | BybitDepthStream | null>(null);
  const levelsRef = useRef<MonitorLevel[]>(levels);
  levelsRef.current = levels;

  const removeLevel = useCallback((id: string) => {
    setLevels((prev) => prev.filter((l) => l.id !== id));
    setLevelStatuses((prev) =>
      prev.map((it) => ((it.level as MonitorLevel).id === id ? { ...it, status: 'broken' as const } : it))
    );
    levelsRef.current = levelsRef.current.filter((l) => l.id !== id);
  }, []);

  useEffect(() => {
    if (!symbol) return;
    const depthLevels = getAdaptiveDepthLevels(symbol);

    const onDepth = (data: DepthData) => {
      const current = levelsRef.current;
      const minVolumeUsdt =
        current.length > 0
          ? Math.min(...current.map((l) => l.volumeUsdt)) * NEW_LEVEL_MIN_RATIO
          : DEFAULT_MIN_VOLUME_USDT;

      const newCandidates = findNewLevels(data.bids, data.asks, current, minVolumeUsdt);
      let nextLevels = current;
      if (newCandidates.length > 0) {
        const toAdd: MonitorLevel[] = newCandidates
          .filter(
            (nl) =>
              !current.some(
                (l) =>
                  l.side === nl.side &&
                  Math.abs(l.price - nl.price) <= (nl.price * MATCH_PCT) / 100
              )
          )
          .map((l) => ({ ...l, id: `rt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }));
        if (toAdd.length > 0) {
          nextLevels = [...current, ...toAdd];
          levelsRef.current = nextLevels;
          setLevels(nextLevels);
        }
      }
      const allLevels = levelsRef.current;
      const activeItems: LevelMonitorItem[] = allLevels.map((level) => {
        const { status, currentPrice, volumeUsdt } = getStatus(level, data.bids, data.asks);
        return { level, status, currentPrice, volumeUsdt };
      });
      setLevelStatuses((prev) => {
        const broken = prev.filter((it) => it.status === 'broken');
        return [...activeItems, ...broken];
      });
    };

    if (exchange === 'Bybit') {
      const stream = new BybitDepthStream(symbol, depthLevels, onDepth as (d: DepthData) => void);
      stream.connect();
      depthRef.current = stream;
    } else {
      const stream = new BinanceDepthStream(symbol, depthLevels, onDepth as (d: DepthData) => void);
      stream.connect();
      depthRef.current = stream;
    }
    return () => {
      depthRef.current?.disconnect();
      depthRef.current = null;
    };
  }, [symbol, exchange]);

  const initialKey = `${symbol}-${exchange}-${initialLevels.length}-${initialLevels[0]?.price ?? 0}`;
  const prevInitialKeyRef = useRef<string>('');
  useEffect(() => {
    if (initialLevels.length === 0) return;
    if (prevInitialKeyRef.current === initialKey) return;
    prevInitialKeyRef.current = initialKey;
    const next = initialLevels.map((l, i) => ({
      ...l,
      id: `init-${i}-${l.price}-${l.side}`,
    }));
    setLevels(next);
    levelsRef.current = next;
  }, [initialKey, initialLevels]);

  return { levels, levelStatuses, removeLevel };
}
