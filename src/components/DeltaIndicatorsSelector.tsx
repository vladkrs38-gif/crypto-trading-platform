'use client';

import { useTradingStore } from '@/store/useTradingStore';

interface DeltaIndicatorsSelectorProps {
  chartType: 'standard' | 'tick100';
}

export default function DeltaIndicatorsSelector({ chartType }: DeltaIndicatorsSelectorProps) {
  const showBarDelta = useTradingStore(
    (state) => chartType === 'standard' ? state.showBarDeltaStandard : state.showBarDeltaTick100
  );
  const showCumulativeDelta = useTradingStore(
    (state) => chartType === 'standard' ? state.showCumulativeDeltaStandard : state.showCumulativeDeltaTick100
  );
  const showDeltaRotation = useTradingStore(
    (state) => chartType === 'standard' ? state.showDeltaRotationStandard : false
  );
  const setShowBarDelta = useTradingStore(
    (state) => chartType === 'standard' ? state.setShowBarDeltaStandard : state.setShowBarDeltaTick100
  );
  const setShowCumulativeDelta = useTradingStore(
    (state) => chartType === 'standard' ? state.setShowCumulativeDeltaStandard : state.setShowCumulativeDeltaTick100
  );
  const setShowDeltaRotation = useTradingStore(
    (state) => chartType === 'standard' ? state.setShowDeltaRotationStandard : () => {}
  );

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.75rem' }}>
      <span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>Дельта:</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={showBarDelta}
          onChange={(e) => setShowBarDelta(e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        <span style={{ color: 'var(--text-main)' }}>Побарная</span>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={showCumulativeDelta}
          onChange={(e) => setShowCumulativeDelta(e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        <span style={{ color: 'var(--text-main)' }}>Кумулятивная</span>
      </label>
      {chartType === 'standard' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showDeltaRotation}
            onChange={(e) => setShowDeltaRotation(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <span style={{ color: 'var(--text-main)' }}>Rotation</span>
        </label>
      )}
    </div>
  );
}
