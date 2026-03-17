'use client';

import { useEffect, useRef, useState } from 'react';
import { useTradingStore } from '@/store/useTradingStore';

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

const sectionStyle = {
  padding: '10px 12px',
  borderBottom: '1px solid var(--border)',
} as const;

const sectionTitleStyle = {
  fontSize: '0.7rem',
  color: 'var(--text-muted)',
  marginBottom: '8px',
  fontWeight: 600,
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

export default function Tick200IndicatorsPopover() {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const showImbalanceTrend = useTradingStore((s) => s.showImbalanceTrend);
  const setShowImbalanceTrend = useTradingStore((s) => s.setShowImbalanceTrend);
  const imbalanceLevels = useTradingStore((s) => s.imbalanceLevels);
  const setImbalanceLevels = useTradingStore((s) => s.setImbalanceLevels);

  const showBidAskHistogram = useTradingStore((s) => s.showBidAskHistogram);
  const setShowBidAskHistogram = useTradingStore((s) => s.setShowBidAskHistogram);

  const showLiquidityImbalance = useTradingStore((s) => s.showLiquidityImbalance);
  const setShowLiquidityImbalance = useTradingStore((s) => s.setShowLiquidityImbalance);

  const showBigOrders = useTradingStore((s) => s.showBigOrders);
  const setShowBigOrders = useTradingStore((s) => s.setShowBigOrders);
  const bigOrderMultiplier = useTradingStore((s) => s.bigOrderMultiplier);
  const setBigOrderMultiplier = useTradingStore((s) => s.setBigOrderMultiplier);

  const activeCount =
    (showImbalanceTrend ? 1 : 0) +
    (showBidAskHistogram ? 1 : 0) +
    (showLiquidityImbalance ? 1 : 0) +
    (showBigOrders ? 1 : 0);

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
        className="popover-trigger-btn popover-trigger-btn-cyan"
        data-open={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        style={{
          ...popoverBtnStyle,
          background: isOpen ? 'rgba(0, 212, 255, 0.12)' : '#161b22',
          borderColor: isOpen ? '#00d4ff' : 'rgba(48, 54, 61, 0.8)',
          boxShadow: isOpen ? '0 0 0 2px rgba(0, 212, 255, 0.2)' : 'none',
        }}
        onMouseEnter={(e) => {
          if (!isOpen) {
            e.currentTarget.style.background = '#21262d';
            e.currentTarget.style.borderColor = '#00d4ff';
          }
        }}
        onMouseLeave={(e) => {
          if (!isOpen) {
            e.currentTarget.style.background = '#161b22';
            e.currentTarget.style.borderColor = 'rgba(48, 54, 61, 0.8)';
          }
        }}
        title="Индикаторы"
      >
        <span style={{ fontSize: '1rem' }}>📊</span>
        Индикаторы
        {activeCount > 0 && (
          <span
            style={{
              background: '#00d4ff',
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
            minWidth: '280px',
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
              color: '#00d4ff',
            }}
          >
            Индикаторы
          </div>

          {/* Imbalance */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Imbalance</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={showImbalanceTrend}
                  onChange={(e) => setShowImbalanceTrend(e.target.checked)}
                  style={{ cursor: 'pointer', accentColor: '#00d4ff' }}
                />
                <span>Тренд</span>
              </label>
              <select
                value={imbalanceLevels}
                onChange={(e) => setImbalanceLevels(Number(e.target.value))}
                style={{
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-main)',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '4px 8px',
                  fontSize: '0.75rem',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  outline: 'none',
                }}
                title="Уровни стакана"
              >
                <option value={5}>5 lvl</option>
                <option value={10}>10 lvl</option>
                <option value={20}>20 lvl</option>
              </select>
            </div>
          </div>

          {/* Bid-Ask */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Объёмы</div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              <input
                type="checkbox"
                checked={showBidAskHistogram}
                onChange={(e) => setShowBidAskHistogram(e.target.checked)}
                style={{ cursor: 'pointer', accentColor: '#089981' }}
              />
              <span>Bid-Ask гистограмма</span>
              <TooltipIcon title="Объём на бидах и асках по каждой свече. Показывает давление покупателей и продавцов." />
            </label>
          </div>

          {/* Liquidity */}
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Ликвидность</div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                fontSize: '0.8rem',
              }}
            >
              <input
                type="checkbox"
                checked={showLiquidityImbalance}
                onChange={(e) => setShowLiquidityImbalance(e.target.checked)}
                style={{ cursor: 'pointer', accentColor: '#089981' }}
              />
              <span>Дисбаланс</span>
            </label>
          </div>

          {/* Big Orders */}
          <div style={{ ...sectionStyle, borderBottom: 'none' }}>
            <div style={sectionTitleStyle}>Крупные ордера</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={showBigOrders}
                  onChange={(e) => setShowBigOrders(e.target.checked)}
                  style={{ cursor: 'pointer', accentColor: '#3b82f6' }}
                />
                <span>{bigOrderMultiplier}x</span>
                <TooltipIcon title="Подсветка ордеров, в N раз крупнее среднего. Помогает видеть стены и крупных участников." />
              </label>
              {showBigOrders && (
                <input
                  type="range"
                  min={2}
                  max={20}
                  value={bigOrderMultiplier}
                  onChange={(e) => setBigOrderMultiplier(parseInt(e.target.value))}
                  style={{
                    flex: 1,
                    minWidth: '80px',
                    cursor: 'pointer',
                    accentColor: '#3b82f6',
                  }}
                  title={`Множитель: ${bigOrderMultiplier}x`}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
