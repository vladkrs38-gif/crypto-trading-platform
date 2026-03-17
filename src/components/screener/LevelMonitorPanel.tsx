'use client';

import { useEffect, useRef, useState } from 'react';
import { BinanceDepthStream } from '@/lib/binance';
import { BybitDepthStream } from '@/lib/bybit';
import { getAdaptiveDepthLevels } from '@/lib/orderBookUtils';
import type { BigOrderLevel } from '@/lib/screenerApi';

export type LevelMonitorStatus = 'on_place' | 'shifted' | 'gone' | 'broken';

export interface LevelMonitorItem {
  level: BigOrderLevel;
  status: LevelMonitorStatus;
  /** Текущая цена уровня в стакане (если сместился) */
  currentPrice?: number;
  /** Объём в стакане на этом уровне (USDT) */
  volumeUsdt?: number;
}

type Exchange = 'Binance' | 'Bybit';

interface LevelMonitorPanelProps {
  symbol: string;
  exchange: Exchange;
  /** Уровни для подписки на стакан и расчёта статусов (если не передан items) */
  levels?: BigOrderLevel[];
  /** Готовый список статусов — если передан, подписка на стакан не делается, только отображение */
  items?: LevelMonitorItem[];
  /** Колбэк при обновлении статусов (только когда используется подписка по levels) */
  onStatusChange?: (items: LevelMonitorItem[]) => void;
}

/** Порог: считаем уровень "на месте" если объём >= этой доли от изначального volumeUsdt */
const MIN_VOLUME_RATIO = 0.1;
/** Допуск по цене: в пределах этого % от уровня — "на месте" */
const PRICE_BAND_PCT = 0.08;
/** Если объём есть, но цена сместилась больше чем на этот % — "сместился" */
const SHIFT_BAND_PCT = 0.15;

function getStatus(
  level: BigOrderLevel,
  bids: Array<{ price: number; quantity: number }>,
  asks: Array<{ price: number; quantity: number }>
): { status: LevelMonitorStatus; currentPrice?: number; volumeUsdt?: number } {
  const side = level.side;
  const arr = side === 'bid' ? bids : asks;
  const price = level.price;
  const minVolumeUsdt = level.volumeUsdt * MIN_VOLUME_RATIO;
  const bandPct = PRICE_BAND_PCT / 100;
  const band = price * bandPct;
  const shiftBand = price * (SHIFT_BAND_PCT / 100);

  let bestAtPlace: { price: number; volumeUsdt: number } | null = null;
  let bestShifted: { price: number; volumeUsdt: number } | null = null;

  for (const row of arr) {
    const volumeUsdt = row.price * row.quantity;
    const dist = Math.abs(row.price - price);
    if (dist <= band && volumeUsdt >= minVolumeUsdt) {
      if (!bestAtPlace || volumeUsdt > bestAtPlace.volumeUsdt) {
        bestAtPlace = { price: row.price, volumeUsdt };
      }
    } else if (dist <= shiftBand && volumeUsdt >= minVolumeUsdt) {
      if (!bestShifted || volumeUsdt > bestShifted.volumeUsdt) {
        bestShifted = { price: row.price, volumeUsdt };
      }
    }
  }

  if (bestAtPlace) {
    return { status: 'on_place', currentPrice: bestAtPlace.price, volumeUsdt: bestAtPlace.volumeUsdt };
  }
  if (bestShifted) {
    return { status: 'shifted', currentPrice: bestShifted.price, volumeUsdt: bestShifted.volumeUsdt };
  }
  return { status: 'gone' };
}

export default function LevelMonitorPanel({ symbol, exchange, levels = [], items: itemsProp, onStatusChange }: LevelMonitorPanelProps) {
  const [itemsState, setItemsState] = useState<LevelMonitorItem[]>([]);
  const depthRef = useRef<BinanceDepthStream | BybitDepthStream | null>(null);

  const items = itemsProp ?? itemsState;

  useEffect(() => {
    if (itemsProp != null || !symbol || levels.length === 0) return;
    const depthLevels = getAdaptiveDepthLevels(symbol);

    const onDepth = (data: { bids: Array<{ price: number; quantity: number }>; asks: Array<{ price: number; quantity: number }> }) => {
      const next: LevelMonitorItem[] = levels.map((level) => {
        const { status, currentPrice, volumeUsdt } = getStatus(level, data.bids, data.asks);
        return { level, status, currentPrice, volumeUsdt };
      });
      setItemsState(next);
      onStatusChange?.(next);
    };

    type DepthData = { bids: Array<{ price: number; quantity: number }>; asks: Array<{ price: number; quantity: number }> };
    if (exchange === 'Bybit') {
      const stream = new BybitDepthStream(symbol, depthLevels, onDepth as (data: DepthData) => void);
      stream.connect();
      depthRef.current = stream;
    } else {
      const stream = new BinanceDepthStream(symbol, depthLevels, onDepth as (data: DepthData) => void);
      stream.connect();
      depthRef.current = stream;
    }
    return () => {
      depthRef.current?.disconnect();
      depthRef.current = null;
    };
  }, [symbol, exchange, levels, itemsProp]);

  if (items.length === 0) return null;

  // Порядок как на графике: самый низкий внизу, самый высокий вверху (синие Bid внизу, красные Ask вверху)
  const sortedItems = [...items].sort((a, b) => a.level.price - b.level.price);

  const statusLabel: Record<LevelMonitorStatus, string> = {
    on_place: 'На месте',
    shifted: 'Сместился',
    gone: 'Исчез',
    broken: 'Пробит',
  };
  const statusColor: Record<LevelMonitorStatus, string> = {
    on_place: 'var(--text-main)',
    shifted: '#f59e0b',
    gone: '#ef4444',
    broken: 'var(--text-muted)',
  };

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '12px',
        minWidth: 260,
        maxHeight: 400,
        overflow: 'auto',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '8px', color: 'var(--text-main)' }}>
        Мониторинг уровней
      </div>
      <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: '6px' }}>
        {sortedItems.map((item, i) => {
          const isBroken = item.status === 'broken';
          const rowStyle = {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 8px',
            background: 'var(--bg-elevated)',
            borderRadius: '8px',
            fontSize: '0.8rem',
            opacity: isBroken ? 0.5 : 1,
            textDecoration: isBroken ? 'line-through' : undefined,
          };
          const levelId = 'id' in item.level ? (item.level as { id: string }).id : `${item.level.price}-${item.level.side}-${i}`;
          return (
            <div key={levelId} style={rowStyle}>
              <div>
                <span style={{ color: item.level.side === 'bid' ? '#3b82f6' : '#ef4444', fontWeight: 600 }}>
                  {item.level.side === 'bid' ? 'Bid' : 'Ask'}
                </span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                  {item.level.price.toFixed(4)}
                </span>
                {item.volumeUsdt != null && !isBroken && (
                  <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                    {item.volumeUsdt >= 1000 ? `${(item.volumeUsdt / 1000).toFixed(1)}k` : item.volumeUsdt.toFixed(0)} $
                  </span>
                )}
              </div>
              <span style={{ color: statusColor[item.status], fontWeight: 500 }}>
                {statusLabel[item.status]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
