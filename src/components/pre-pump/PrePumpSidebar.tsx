'use client';

/**
 * Pre-Pump Sidebar — данные от Python API (usePrePumpStore).
 * Удаление: удалить папку pre-pump и убрать импорт из page.tsx, Header, store.
 */

import { useCallback, useState } from 'react';
import { useTradingStore } from '@/store/useTradingStore';
import { usePrePumpStore } from '@/store/usePrePumpStore';
import { getAllUSDTPairs } from '@/lib/binance';
import { fetchPrePumpFromApi } from '@/lib/screenerApi';
import type { PrePumpSignalApi } from '@/lib/screenerApi';

export default function PrePumpSidebar() {
  const showPrePumpSidebar = useTradingStore((s) => s.showPrePumpSidebar);
  const setShowPrePumpSidebar = useTradingStore((s) => s.setShowPrePumpSidebar);
  const setSelectedPair = useTradingStore((s) => s.setSelectedPair);
  const { signals, idealSymbols, setPrePumpData } = usePrePumpStore();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await fetchPrePumpFromApi();
      setPrePumpData(data);
    } finally {
      setRefreshing(false);
    }
  }, [setPrePumpData]);

  const handleSelect = useCallback(
    async (symbol: string) => {
      const pairs = await getAllUSDTPairs();
      const pair = pairs.find((p) => p.symbol === symbol);
      if (pair) {
        setSelectedPair({ ...pair, exchange: 'Binance' });
      }
    },
    [setSelectedPair]
  );

  if (!showPrePumpSidebar) return null;

  return (
    <div className="pre-pump-sidebar">
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-elevated)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
          Pre-Pump
        </span>
        <button
          onClick={refresh}
          disabled={refreshing}
          title="Обновить"
          style={{
            background: 'var(--bg-main)',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            padding: '4px 8px',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            cursor: refreshing ? 'wait' : 'pointer',
          }}
        >
          {refreshing ? '…' : '↻'}
        </button>
        <button
          onClick={() => setShowPrePumpSidebar(false)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '1.1rem',
            padding: '2px',
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          padding: '6px 10px',
          fontSize: '0.65rem',
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-main)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span>Score | Vol | Pos | Buy% | Δ%</span>
        <span style={{ color: '#22c55e', marginLeft: 'auto' }}>🟢 идеал</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {signals.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            Ожидание данных… Запустите Python API (start_tracker.bat)
          </div>
        ) : (
          signals.map((s) => (
            <PrePumpRow
              key={s.symbol}
              signal={s}
              isIdeal={idealSymbols.includes(s.symbol)}
              onSelect={handleSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PrePumpRow({
  signal,
  isIdeal,
  onSelect,
}: {
  signal: PrePumpSignalApi;
  isIdeal: boolean;
  onSelect: (symbol: string) => void;
}) {
  const chg = signal.priceChangePercent;
  const chgColor = chg >= 0 ? '#089981' : '#f23645';
  const scoreColor =
    signal.score >= 70 ? '#22c55e' : signal.score >= 50 ? '#f0b90b' : 'var(--text-muted)';

  return (
    <div
      onClick={() => onSelect(signal.symbol)}
      style={{
        display: 'grid',
        gridTemplateColumns: '60px 38px 36px 40px 44px 1fr',
        gap: '4px',
        padding: '6px 10px',
        fontSize: '0.72rem',
        cursor: 'pointer',
        borderBottom: '1px solid var(--border)',
        alignItems: 'center',
        transition: 'background 0.1s',
        background: isIdeal ? 'rgba(34, 197, 94, 0.12)' : undefined,
        borderLeft: isIdeal ? '3px solid #22c55e' : undefined,
        fontWeight: isIdeal ? 700 : undefined,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = isIdeal ? 'rgba(34, 197, 94, 0.2)' : 'var(--bg-elevated)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = isIdeal ? 'rgba(34, 197, 94, 0.12)' : 'transparent';
      }}
    >
      <span style={{ fontWeight: 600 }}>{signal.symbol.replace('USDT', '')}</span>
      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: scoreColor }}>
        {signal.score}
      </span>
      <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>
        {signal.volumeRatio >= 2 ? '2+' : signal.volumeRatio.toFixed(1)}x
      </span>
      <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>
        {Math.round(signal.pricePosition)}%
      </span>
      <span
        style={{
          fontFamily: 'monospace',
          color: signal.takerBuyPercent >= 55 ? '#089981' : 'var(--text-muted)',
        }}
      >
        {Math.round(signal.takerBuyPercent)}%
      </span>
      <span style={{ fontFamily: 'monospace', color: chgColor, textAlign: 'right' }}>
        {chg >= 0 ? '+' : ''}{chg.toFixed(1)}%
      </span>
    </div>
  );
}
