'use client';

import { useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { fetchScreenerBigOrders } from '@/lib/screenerApi';
import { useScreenerStore } from '@/store/useScreenerStore';

const POLL_INTERVAL_MS = 60_000;

function playScreenerAlertSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const play = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + start + 0.05);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    play(660, 0, 0.12);
    play(880, 0.12, 0.15);
  } catch (_) {}
}

/**
 * Фоновый опрос скринера и показ уведомлений на главной при появлении новых монет с уровнями.
 */
export default function ScreenerNotifications() {
  const { processNewSymbols, notifications, dismissNotification, clearNotifications } = useScreenerStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = await fetchScreenerBigOrders();
      if (data.symbols?.length) {
        const newCount = processNewSymbols(data.symbols);
        if (newCount > 0) playScreenerAlertSound();
      }
    } catch (_) {
      // API может быть выключен
    }
  }, [processNewSymbols]);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [poll]);

  if (notifications.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 56,
        right: 16,
        zIndex: 999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 360,
      }}
    >
      {notifications.slice(0, 5).map((n) => (
        <ScreenerNotificationItem
          key={`${n.symbol}-${n.triggeredAt}`}
          symbol={n.symbol}
          levelsCount={n.levelsCount}
          dismissNotification={dismissNotification}
        />
      ))}
      {notifications.length > 1 && (
        <button
          type="button"
          onClick={clearNotifications}
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 4,
            alignSelf: 'flex-end',
          }}
        >
          Очистить все
        </button>
      )}
    </div>
  );
}

const AUTO_DISMISS_MS = 5000;

function ScreenerNotificationItem({
  symbol,
  levelsCount,
  dismissNotification,
}: {
  symbol: string;
  levelsCount: number;
  dismissNotification: (symbol: string) => void;
}) {
  useEffect(() => {
    const t = setTimeout(() => dismissNotification(symbol), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [symbol, dismissNotification]);

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid #3b82f6',
        borderRadius: '10px',
        padding: '12px 14px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)' }}>
          Скринер: уровни на {symbol}
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
          {levelsCount} уровн. крупных ордеров
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Link
          href="/screener"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: '0.8rem',
            color: '#3b82f6',
            textDecoration: 'none',
            fontWeight: 500,
          }}
        >
          Открыть
        </Link>
        <button
          type="button"
          onClick={() => dismissNotification(symbol)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 4,
            fontSize: '1rem',
            lineHeight: 1,
          }}
          aria-label="Закрыть"
        >
          ×
        </button>
      </div>
    </div>
  );
}
