'use client';

import { useTradingStore } from '@/store/useTradingStore';
import type { Timeframe } from '@/types/binance';

const timeframes: { value: Timeframe; label: string }[] = [
  { value: '1', label: '1м' },
  { value: '5', label: '5м' },
  { value: '15', label: '15м' },
  { value: '60', label: '1ч' },
  { value: '240', label: '4ч' },
  { value: 'D', label: '1д' },
];

export default function TimeframeSelector() {
  const { timeframe, setTimeframe } = useTradingStore();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      {timeframes.map((tf) => {
        const isActive = timeframe === tf.value;
        return (
          <button
            key={tf.value}
            onClick={() => setTimeframe(tf.value)}
            style={{
              padding: '6px 12px',
              borderRadius: '8px',
              border: isActive
                ? '1px solid rgba(88, 166, 255, 0.9)'
                : '1px solid rgba(48, 54, 61, 0.8)',
              background: isActive ? '#21262d' : '#161b22',
              color: isActive ? '#f0f6fc' : '#c9d1d9',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition:
                'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.05s ease',
              fontFamily: 'inherit',
              outline: 'none',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = '#1c2128';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = '#161b22';
              }
            }}
          >
            {tf.label}
          </button>
        );
      })}
    </div>
  );
}
