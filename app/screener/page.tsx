'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import ScreenerMiniChart from '@/components/screener/ScreenerMiniChart';
import { fetchScreenerBigOrders, type ScreenerSymbol } from '@/lib/screenerApi';
import { useScreenerStore } from '@/store/useScreenerStore';
import { useTradingStore } from '@/store/useTradingStore';
import { getAllUSDTPairs } from '@/lib/binance';
import { getBybitUSDTPairs } from '@/lib/bybit';

const POLL_INTERVAL_MS = 15_000;

export default function ScreenerPage() {
  const { symbols, multiplier, setResult, setLoading, setError, isLoading } = useScreenerStore();
  const setSelectedPair = useTradingStore((s) => s.setSelectedPair);
  const [apiError, setApiError] = useState<string | null>(null);
  // Символы с пробитыми уровнями — скрываем их из списка (с timestamp для cooldown)
  const [brokenSymbols, setBrokenSymbols] = useState<Map<string, number>>(new Map());
  // Символы, которые пользователь убрал крестиком — показываем снова только когда уровень появится заново
  const [dismissedSymbols, setDismissedSymbols] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const data = await fetchScreenerBigOrders();
      setResult(data.symbols, data.multiplier);
      // Сбрасываем «убрано» для символов, которых больше нет в ответе — когда уровень появится снова, карточка покажется
      const currentSymbols = new Set(data.symbols.map((s: { symbol: string }) => s.symbol));
      setDismissedSymbols((prev) => {
        let changed = false;
        const next = new Set(prev);
        next.forEach((sym) => {
          if (!currentSymbols.has(sym)) {
            next.delete(sym);
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка API';
      setError(msg);
      setApiError(msg);
    } finally {
      setLoading(false);
    }
  }, [setResult, setLoading, setError]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [load]);

  const openChart = useCallback(
    async (symbol: string, exchange: 'Binance' | 'Bybit' = 'Binance') => {
      if (exchange === 'Bybit') {
        const bybitTickers = await getBybitUSDTPairs();
        const t = bybitTickers.find((p) => p.symbol === symbol);
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
        }
        return;
      }
      const pairs = await getAllUSDTPairs();
      const pair = pairs.find((p) => p.symbol === symbol);
      if (pair) {
        setSelectedPair({ ...pair, exchange: 'Binance' });
      }
    },
    [setSelectedPair]
  );

  // Когда все уровни пробиты — добавляем в brokenSymbols для скрытия карточки
  const handleAllLevelsBroken = useCallback((symbol: string) => {
    setBrokenSymbols((prev) => {
      const updated = new Map(prev);
      updated.set(symbol, Date.now());
      return updated;
    });
  }, []);

  // Cooldown в миллисекундах — карточка не появится снова в течение этого времени
  const BROKEN_COOLDOWN_MS = 60_000; // 60 секунд

  // Убрать карточку по крестику — скрыта до появления уровня снова (сбрасывается, когда символ выпал из ответа и потом вернулся)
  const handleDismiss = useCallback((sym: string) => {
    setDismissedSymbols((prev) => new Set(prev).add(sym));
  }, []);

  // Фильтруем: только с уровнями, не убранные, не в cooldown после пробития
  const visibleSymbols = useMemo(() => {
    const now = Date.now();
    return symbols.filter((s: ScreenerSymbol) => {
      if (!s.levels?.length) return false;
      if (dismissedSymbols.has(s.symbol)) return false;
      const brokenAt = brokenSymbols.get(s.symbol);
      if (brokenAt && now - brokenAt < BROKEN_COOLDOWN_MS) return false;
      return true;
    });
  }, [symbols, brokenSymbols, dismissedSymbols]);

  // Очищаем устаревшие записи из brokenSymbols (старше cooldown)
  useEffect(() => {
    const now = Date.now();
    setBrokenSymbols((prev) => {
      const updated = new Map<string, number>();
      prev.forEach((timestamp, sym) => {
        // Оставляем только записи моложе cooldown
        if (now - timestamp < BROKEN_COOLDOWN_MS) {
          updated.set(sym, timestamp);
        }
      });
      // Возвращаем новый Map только если что-то изменилось
      if (updated.size !== prev.size) {
        return updated;
      }
      return prev;
    });
  }, [symbols]); // Очищаем при каждом обновлении данных

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Header />
      <main style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-main)' }}>
              Скринер: крупные ордера
            </h1>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Множитель: <strong>{multiplier}x</strong> (задаётся в .bat)
            </span>
            <Link href="/" style={{ fontSize: '0.9rem', color: '#3b82f6', textDecoration: 'none' }}>
              ← Главная
            </Link>
          </div>
          <button
            onClick={load}
            disabled={isLoading}
            style={{
              padding: '8px 16px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              color: 'var(--text-main)',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
            }}
          >
            {isLoading ? 'Обновление…' : 'Обновить'}
          </button>
        </div>

        {apiError && (
          <div
            style={{
              padding: '12px 16px',
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              borderRadius: '8px',
              color: '#ef4444',
              marginBottom: '16px',
            }}
          >
            {apiError}. Убедитесь, что Python API запущен (start_tracker.bat с BIG_ORDER_MULTIPLIER).
          </div>
        )}

        {!apiError && visibleSymbols.length === 0 && !isLoading && (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px' }}>
            {symbols.length > 0 && brokenSymbols.size > 0
              ? `Все уровни пробиты. Карточки появятся через ${Math.ceil(BROKEN_COOLDOWN_MS / 1000)} сек или при новых сигналах...`
              : 'Нет монет с уровнями при текущем множителе. Попробуйте уменьшить множитель в .bat и перезапустить API.'}
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
            gap: '20px',
          }}
        >
          {visibleSymbols.map((item) => (
            <ScreenerMiniChart
              key={item.symbol}
              symbol={item.symbol}
              levels={item.levels}
              onOpenChart={openChart}
              onAllLevelsBroken={handleAllLevelsBroken}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      </main>
    </div>
  );
}
