'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { fetchPrePumpFromApi } from '@/lib/screenerApi';
import type { PrePumpSignalApi, PrePumpApiResponse } from '@/lib/screenerApi';

export default function PrePumpPage() {
  const [data, setData] = useState<PrePumpApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchPrePumpFromApi();
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openInMain = useCallback((symbol: string) => {
    const url = `/?symbol=${encodeURIComponent(symbol)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const signals = data?.signals ?? [];
  const idealSymbols = data?.idealSymbols ?? [];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--bg-main)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link
            href="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-main)',
              textDecoration: 'none',
              fontSize: '0.8rem',
              transition: 'all 0.2s',
            }}
          >
            ← Скринер
          </Link>
          <div
            style={{
              fontSize: '1.2rem',
              fontWeight: 700,
              background: 'linear-gradient(135deg, #16a34a, #22c55e)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Pre-Pump
          </div>
          {data?.idealSymbols?.length ? (
            <span
              style={{
                padding: '4px 10px',
                background: 'rgba(34, 197, 94, 0.2)',
                borderRadius: 20,
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#22c55e',
              }}
            >
              {data.idealSymbols.length} идеал
            </span>
          ) : null}
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-main)',
            cursor: loading ? 'wait' : 'pointer',
            fontSize: '0.8rem',
            opacity: loading ? 0.6 : 1,
          }}
        >
          <span style={{ display: 'inline-block', animation: loading ? 'spin 1s linear infinite' : 'none' }}>
            🔄
          </span>
          Обновить
        </button>
      </header>

      <div
        style={{
          padding: '6px 16px',
          fontSize: '0.65rem',
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span>Символ | Score | Vol | Pos | Buy% | Δ%</span>
        <span style={{ color: '#22c55e', marginLeft: 'auto' }}>🟢 идеал</span>
      </div>

      <main style={{ flex: 1, overflowY: 'auto' }}>
        {error && (
          <div
            style={{
              padding: 20,
              textAlign: 'center',
              color: 'var(--text-danger, #ef4444)',
              fontSize: '0.9rem',
            }}
          >
            {error}
          </div>
        )}
        {loading && signals.length === 0 && !error && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Загрузка…
          </div>
        )}
        {!loading && signals.length === 0 && !error && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Нет данных. Запустите Python API (start_tracker.bat).
          </div>
        )}
        {signals.map((s) => (
          <PrePumpRow
            key={s.symbol}
            signal={s}
            isIdeal={idealSymbols.includes(s.symbol)}
            onSelect={openInMain}
          />
        ))}
      </main>
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
        gridTemplateColumns: '100px 60px 44px 48px 48px 56px 1fr',
        gap: '8px',
        padding: '10px 16px',
        fontSize: '0.8rem',
        cursor: 'pointer',
        borderBottom: '1px solid var(--border)',
        alignItems: 'center',
        transition: 'background 0.1s',
        background: isIdeal ? 'rgba(34, 197, 94, 0.12)' : undefined,
        borderLeft: isIdeal ? '4px solid #22c55e' : undefined,
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
      <span style={{ fontFamily: 'monospace', fontWeight: 700, color: scoreColor }}>{signal.score}</span>
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
        {chg >= 0 ? '+' : ''}
        {chg.toFixed(1)}%
      </span>
    </div>
  );
}
