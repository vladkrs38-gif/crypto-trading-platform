'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import MonitorChart from '@/components/screener/MonitorChart';
import LevelMonitorPanel from '@/components/screener/LevelMonitorPanel';
import { useRealtimeLevels } from '@/components/screener/useRealtimeLevels';
import { useTradingStore } from '@/store/useTradingStore';
import { getAllUSDTPairs } from '@/lib/binance';
import { getBybitUSDTPairs } from '@/lib/bybit';
import type { BigOrderLevel } from '@/lib/screenerApi';

const STORAGE_KEY = 'screener-monitor';

type Exchange = 'Binance' | 'Bybit';

interface StoredMonitor {
  symbol: string;
  exchange: Exchange;
  levels: BigOrderLevel[];
}

function getStoredMonitor(): StoredMonitor | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredMonitor;
      if (parsed.symbol && Array.isArray(parsed.levels)) return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function useMonitorData() {
  const searchParams = useSearchParams();
  const symbolFromUrl = searchParams.get('symbol');
  const exchangeFromUrl = (searchParams.get('exchange') || 'Binance') as Exchange;
  // Инициализируем null, чтобы сервер и первый клиентский рендер совпадали (нет sessionStorage на сервере)
  const [stored, setStored] = useState<StoredMonitor | null>(null);

  useEffect(() => {
    const next = getStoredMonitor();
    if (next?.symbol && Array.isArray(next.levels)) setStored(next);
  }, [symbolFromUrl, exchangeFromUrl]);

  return useMemo(() => {
    const symbol = symbolFromUrl || stored?.symbol || '';
    const exchange = (exchangeFromUrl || stored?.exchange || 'Binance') as Exchange;
    const levels = stored?.levels ?? [];
    return { symbol, exchange, levels, hasData: !!symbol && levels.length > 0 };
  }, [symbolFromUrl, exchangeFromUrl, stored]);
}

function MonitorContent() {
  const { symbol, exchange, levels: initialLevels, hasData: hasStoredData } = useMonitorData();
  const setSelectedPair = useTradingStore((s) => s.setSelectedPair);
  const timeframe = useTradingStore((s) => s.timeframe);
  const [pairLoaded, setPairLoaded] = useState(false);
  const { levels, levelStatuses, removeLevel } = useRealtimeLevels(symbol, exchange, initialLevels);
  const hasData = !!symbol;

  useEffect(() => {
    if (!symbol || pairLoaded) return;
    const load = async () => {
      if (exchange === 'Bybit') {
        const tickers = await getBybitUSDTPairs();
        const t = tickers.find((p) => p.symbol === symbol);
        if (t) {
          setSelectedPair({
            symbol: t.symbol,
            price: t.lastPrice,
            priceChange: '0',
            priceChangePercent: (parseFloat(t.price24hPcnt || '0') * 100).toFixed(2),
            volume: t.volume24h,
            quoteVolume: t.turnover24h,
            exchange: 'Bybit',
          });
          setPairLoaded(true);
        }
      } else {
        const pairs = await getAllUSDTPairs();
        const pair = pairs.find((p) => p.symbol === symbol);
        if (pair) {
          setSelectedPair({ ...pair, exchange: 'Binance' });
          setPairLoaded(true);
        }
      }
    };
    load();
  }, [symbol, exchange, setSelectedPair, pairLoaded]);

  if (!hasData) {
    return (
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <p style={{ marginBottom: '12px' }}>Нет данных для мониторинга.</p>
          <Link href="/screener" style={{ color: '#3b82f6', textDecoration: 'none' }}>
            Откройте монету из скринера уровней →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main style={{ flex: 1, overflow: 'hidden', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '12px', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-main)' }}>
          Мониторинг: {symbol}
        </h1>
        <span
          style={{
            fontSize: '0.7rem',
            padding: '2px 6px',
            borderRadius: '4px',
            background: exchange === 'Binance' ? 'rgba(240, 185, 11, 0.15)' : 'rgba(242, 153, 74, 0.2)',
            color: exchange === 'Binance' ? '#f0b90b' : '#f2994a',
            fontWeight: 600,
          }}
        >
          {exchange}
        </span>
        <Link href="/screener" style={{ fontSize: '0.9rem', color: '#3b82f6', textDecoration: 'none' }}>
          ← Скринер
        </Link>
      </div>
      <div style={{ display: 'flex', gap: '16px', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <MonitorChart
            symbol={symbol}
            exchange={exchange}
            levels={levels}
            timeframe={timeframe}
            levelStatuses={levelStatuses.map((i) => ({ status: i.status }))}
            onLevelBroken={removeLevel}
          />
        </div>
        <LevelMonitorPanel symbol={symbol} exchange={exchange} items={levelStatuses} />
      </div>
    </main>
  );
}

export default function ScreenerMonitorPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Header />
      <Suspense fallback={<main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Загрузка…</main>}>
        <MonitorContent />
      </Suspense>
    </div>
  );
}
