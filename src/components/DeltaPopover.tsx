'use client';

import { useEffect, useRef, useState } from 'react';
import { useTradingStore } from '@/store/useTradingStore';
import type { ChartMode } from '@/components/ChartModeSelector';

interface DeltaPopoverProps {
  chartMode: ChartMode;
}

const popoverBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 12px',
  background: '#161b22',
  border: '1px solid rgba(48, 54, 61, 0.8)',
  borderRadius: '8px',
  color: '#c9d1d9',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.2s',
  fontFamily: 'inherit',
} as const;

function TooltipIcon({ title }: { title: string }) {
  return (
    <span
      style={{
        cursor: 'help',
        marginLeft: '4px',
        color: 'var(--text-muted)',
        fontSize: '0.75rem',
        fontWeight: 600,
        width: '14px',
        height: '14px',
        borderRadius: '50%',
        border: '1px solid var(--text-muted)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      title={title}
    >
      ?
    </span>
  );
}

export default function DeltaPopover({ chartMode }: DeltaPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const showBarDeltaStandard = useTradingStore((s) => s.showBarDeltaStandard);
  const showCumulativeDeltaStandard = useTradingStore((s) => s.showCumulativeDeltaStandard);
  const showDeltaRotationStandard = useTradingStore((s) => s.showDeltaRotationStandard);
  const setShowBarDeltaStandard = useTradingStore((s) => s.setShowBarDeltaStandard);
  const setShowCumulativeDeltaStandard = useTradingStore((s) => s.setShowCumulativeDeltaStandard);
  const setShowDeltaRotationStandard = useTradingStore((s) => s.setShowDeltaRotationStandard);

  const showBarDeltaTick100 = useTradingStore((s) => s.showBarDeltaTick100);
  const showCumulativeDeltaTick100 = useTradingStore((s) => s.showCumulativeDeltaTick100);
  const setShowBarDeltaTick100 = useTradingStore((s) => s.setShowBarDeltaTick100);
  const setShowCumulativeDeltaTick100 = useTradingStore((s) => s.setShowCumulativeDeltaTick100);

  const activeCount =
    (showBarDeltaStandard ? 1 : 0) +
    (showCumulativeDeltaStandard ? 1 : 0) +
    (showDeltaRotationStandard ? 1 : 0) +
    (showBarDeltaTick100 ? 1 : 0) +
    (showCumulativeDeltaTick100 ? 1 : 0);

  const showStandard = chartMode === 'standard' || chartMode === 'both';
  const showTick100 = chartMode === 'tick200' || chartMode === 'both';

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        className="popover-trigger-btn"
        data-open={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        style={{
          ...popoverBtnStyle,
          background: isOpen ? 'rgba(88, 166, 255, 0.15)' : '#161b22',
          borderColor: isOpen ? '#58a6ff' : 'rgba(48, 54, 61, 0.8)',
          boxShadow: isOpen ? '0 0 0 2px rgba(88, 166, 255, 0.2)' : 'none',
        }}
        onMouseEnter={(e) => {
          if (!isOpen) {
            e.currentTarget.style.background = '#21262d';
            e.currentTarget.style.borderColor = '#58a6ff';
          }
        }}
        onMouseLeave={(e) => {
          if (!isOpen) {
            e.currentTarget.style.background = '#161b22';
            e.currentTarget.style.borderColor = 'rgba(48, 54, 61, 0.8)';
          }
        }}
        title="Настройки дельты"
      >
        <span style={{ fontSize: '1rem' }}>Δ</span>
        Дельта
        {activeCount > 0 && (
          <span
            style={{
              background: 'var(--accent)',
              color: 'var(--bg-main)',
              borderRadius: '10px',
              minWidth: '18px',
              height: '18px',
              fontSize: '0.7rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 4px',
            }}
          >
            {activeCount}
          </span>
        )}
        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>▼</span>
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            minWidth: '260px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
            zIndex: 1000,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '12px',
              borderBottom: '1px solid var(--border)',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--text-muted)',
            }}
          >
            Δ Дельта
          </div>
          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {showStandard && (
              <div>
                <div
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                    marginBottom: '8px',
                    fontWeight: 600,
                  }}
                >
                  Стандарт
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
                    <input
                      type="checkbox"
                      checked={showBarDeltaStandard}
                      onChange={(e) => setShowBarDeltaStandard(e.target.checked)}
                      style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
                    />
                    <span>Побарная</span>
                    <TooltipIcon title="Order flow по свече: покупки минус продажи. Зелёный — агрессия покупателей, красный — продавцов. Дивергенция с ценой часто предшествует развороту." />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
                    <input
                      type="checkbox"
                      checked={showCumulativeDeltaStandard}
                      onChange={(e) => setShowCumulativeDeltaStandard(e.target.checked)}
                      style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
                    />
                    <span>Кумулятивная</span>
                    <TooltipIcon title="Накопленная дельта сессии. Видно истощение тренда или нарастание давления перед импульсом — без привязки к отдельной свече." />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
                    <input
                      type="checkbox"
                      checked={showDeltaRotationStandard}
                      onChange={(e) => setShowDeltaRotationStandard(e.target.checked)}
                      style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
                    />
                    <span>Rotation</span>
                    <TooltipIcon title="Сбрасываемая дельта: накопление до смены тренда или порога. Синий — покупки, красный — продажи. Ловит локальные циклы давления без шума всей сессии." />
                  </label>
                </div>
              </div>
            )}

            {showTick100 && (
              <div>
                <div
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                    marginBottom: '8px',
                    fontWeight: 600,
                  }}
                >
                  20 тик
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
                    <input
                      type="checkbox"
                      checked={showBarDeltaTick100}
                      onChange={(e) => setShowBarDeltaTick100(e.target.checked)}
                      style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
                    />
                    <span>Побарная</span>
                    <TooltipIcon title="Дельта по каждой 20-тиковой свече. Показывает давление покупателей и продавцов внутри тиков." />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
                    <input
                      type="checkbox"
                      checked={showCumulativeDeltaTick100}
                      onChange={(e) => setShowCumulativeDeltaTick100(e.target.checked)}
                      style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
                    />
                    <span>Кумулятивная</span>
                    <TooltipIcon title="Накопленная дельта по тикам. Перевес order flow на микро-таймфрейме — накопление перед движением." />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
