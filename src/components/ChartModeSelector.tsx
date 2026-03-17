'use client';

import { useTradingStore } from '@/store/useTradingStore';

export type ChartMode = 'standard' | 'tick200' | 'both';

export default function ChartModeSelector() {
  const { chartMode, setChartMode } = useTradingStore();

  const modes: { value: ChartMode; label: string }[] = [
    { value: 'standard', label: 'Стандартный таймфрейм' },
    { value: 'tick200', label: '20 тик' },
    { value: 'both', label: 'Оба графика' },
  ];

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      {modes.map((mode) => (
        <button
          key={mode.value}
          onClick={() => setChartMode(mode.value)}
          style={{
            padding: '6px 12px',
            background: chartMode === mode.value ? 'var(--accent)' : 'var(--bg-elevated)',
            border: `1px solid ${chartMode === mode.value ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: '6px',
            color: chartMode === mode.value ? 'var(--bg-main)' : 'var(--text-main)',
            fontFamily: 'inherit',
            fontSize: '0.8rem',
            fontWeight: chartMode === mode.value ? 600 : 400,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            if (chartMode !== mode.value) {
              e.currentTarget.style.background = 'var(--bg-card)';
              e.currentTarget.style.borderColor = 'var(--accent)';
            }
          }}
          onMouseLeave={(e) => {
            if (chartMode !== mode.value) {
              e.currentTarget.style.background = 'var(--bg-elevated)';
              e.currentTarget.style.borderColor = 'var(--border)';
            }
          }}
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}
