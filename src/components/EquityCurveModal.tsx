'use client';

import type { EquityCurvePoint, DrawdownCurvePoint } from '@/lib/labApi';
import EquityCurveCharts from './EquityCurveCharts';

interface EquityCurveModalProps {
  equityCurve: EquityCurvePoint[];
  drawdownCurve: DrawdownCurvePoint[];
  onClose: () => void;
}

export default function EquityCurveModal({ equityCurve, drawdownCurve, onClose }: EquityCurveModalProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-main)',
        padding: '12px 16px 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontSize: '1rem', fontWeight: 600 }}>Эквити по всей истории</span>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--text-main)',
            fontSize: '0.85rem',
            cursor: 'pointer',
          }}
        >
          Закрыть
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <EquityCurveCharts equityCurve={equityCurve} drawdownCurve={drawdownCurve} />
      </div>
    </div>
  );
}
