'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getEquityCurve } from '@/lib/labApi';
import EquityReport from '@/components/EquityReport';

const STORAGE_KEY = 'labEquityParams';

const defaultParams = {
  exchange: 'binance',
  startLotUsd: 10,
  scannerSigma: 2,
  dropLengthMinutes: 10,
  retrospective: 100,
  obiFilterEnabled: true,
  obiThreshold: 0.5,
  gridLegs: 0,
  gridStepPct: 1.0,
  gridStepMode: 'fixed',
  atrPeriod: 14,
  martinMultiplier: 1.0,
  takeAlpha: null as number | null,
  takeProfitPct: 0.003,
  breakEvenAfterLegs: 0,
  maxLossPct: 3,  // 3% от equity
  commissionPct: 0.04,
  slippagePct: 0.01,
  initialEquity: 100,
  allowShort: true,
  trendFilterEnabled: true,
  emaPeriod: 50,
  cooldownBars: 5,
  dynamicAlphaEnabled: true,
  exposureCapBoth: true,
  atrRegimeFilterEnabled: true,
  atrRegimeMin: 0.5,
  atrRegimeMax: 2,
  localExtremumBars: 2,
  trendFilterMarginPct: 0.05,
  minRRatio: 1.15,
  mlFilterEnabled: false,
  mlModelPath: null as string | null,
  mlLongThreshold: 0.55,
  mlShortThreshold: 0.55,
};

export default function EquityPage() {
  const searchParams = useSearchParams();
  const symbol = searchParams.get('symbol') ?? '';
  const timeframe = searchParams.get('timeframe') ?? '5';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useState(defaultParams);
  const [data, setData] = useState<{
    equityCurve: { time: number; equity: number }[];
    drawdownCurve: { time: number; drawdown: number }[];
    metrics: {
      netProfitUsd: number;
      netProfitPct: number;
      maxDrawdownPct: number;
      recoveryFactor: number;
      profitFactor: number;
      winRate: number;
      avgTrade: number;
    };
    trades: any[];
    warnings: any[];
  } | null>(null);

  useEffect(() => {
    if (!symbol) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const stored = typeof window !== 'undefined' ? window.sessionStorage.getItem(STORAGE_KEY) : null;
    const loadedParams = stored ? { ...defaultParams, ...JSON.parse(stored) } : defaultParams;
    setParams(loadedParams);

    console.log('[EquityPage] Starting equity curve request with params:', {
      symbol,
      timeframe,
      exchange: loadedParams.exchange,
      ...loadedParams,
    });
    getEquityCurve(symbol, timeframe, loadedParams.exchange, {
      startLotUsd: loadedParams.startLotUsd,
      scannerSigma: loadedParams.scannerSigma,
      dropLengthMinutes: loadedParams.dropLengthMinutes,
      retrospective: loadedParams.retrospective,
      obiFilterEnabled: loadedParams.obiFilterEnabled,
      obiThreshold: loadedParams.obiThreshold,
      gridLegs: loadedParams.gridLegs,
      gridStepPct: loadedParams.gridStepPct,
      gridStepMode: loadedParams.gridStepMode,
      atrPeriod: loadedParams.atrPeriod,
      martinMultiplier: loadedParams.martinMultiplier,
      takeAlpha: loadedParams.takeAlpha,
      takeProfitPct: loadedParams.takeProfitPct,
      breakEvenAfterLegs: loadedParams.breakEvenAfterLegs,
      maxLossPct: loadedParams.maxLossPct,
      commissionPct: loadedParams.commissionPct,
      slippagePct: loadedParams.slippagePct,
      initialEquity: loadedParams.initialEquity,
      allowShort: loadedParams.allowShort ?? true,
      trendFilterEnabled: loadedParams.trendFilterEnabled,
      emaPeriod: loadedParams.emaPeriod,
      cooldownBars: loadedParams.cooldownBars,
      dynamicAlphaEnabled: loadedParams.dynamicAlphaEnabled,
      exposureCapBoth: loadedParams.exposureCapBoth,
      atrRegimeFilterEnabled: loadedParams.atrRegimeFilterEnabled,
      atrRegimeMin: loadedParams.atrRegimeMin,
      atrRegimeMax: loadedParams.atrRegimeMax,
      localExtremumBars: loadedParams.localExtremumBars,
      trendFilterMarginPct: loadedParams.trendFilterMarginPct,
      minRRatio: loadedParams.minRRatio,
      mlFilterEnabled: loadedParams.mlFilterEnabled,
      mlModelPath: loadedParams.mlModelPath,
      mlLongThreshold: loadedParams.mlLongThreshold,
      mlShortThreshold: loadedParams.mlShortThreshold,
    })
      .then((res) => {
        console.log('[EquityPage] Equity curve received:', res.equityCurve.length, 'points');
        if (!cancelled && res.equityCurve.length > 0) {
          setData(res);
        } else if (!cancelled) {
          setError('Получены пустые данные эквити');
        }
      })
      .catch((e) => {
        console.error('[EquityPage] Error loading equity curve:', e);
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe]);

  if (!symbol) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          padding: '24px',
          background: 'var(--bg-main)',
          color: 'var(--text-main)',
        }}
      >
        <p style={{ fontSize: '1rem' }}>Откройте эквити из лаборатории (кнопка «Эквити на истории»).</p>
        <Link
          href="/dom-surface"
          style={{
            padding: '8px 16px',
            borderRadius: '8px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: 'var(--text-main)',
            textDecoration: 'none',
            fontSize: '0.9rem',
          }}
        >
          В лабораторию
        </Link>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-main)',
        color: 'var(--text-main)',
        padding: '12px 16px 16px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>
          Отчет по истории — {symbol} {timeframe}
        </span>
        <Link
          href="/dom-surface"
          style={{
            padding: '6px 14px',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--text-main)',
            fontSize: '0.85rem',
            textDecoration: 'none',
          }}
        >
          Назад в лабораторию
        </Link>
      </div>

      {loading && (
        <div style={{ padding: '24px', color: 'var(--text-muted)', textAlign: 'center' }}>
          Загрузка данных бэктеста…
        </div>
      )}
      {error && (
        <div style={{ padding: '24px', color: '#ef4444', textAlign: 'center' }}>{error}</div>
      )}
      {!loading && !error && data && (
        <EquityReport
          equityCurve={data.equityCurve}
          drawdownCurve={data.drawdownCurve}
          metrics={data.metrics}
          trades={data.trades}
          warnings={data.warnings}
          symbol={symbol}
          timeframe={timeframe}
          initialEquity={params.initialEquity}
        />
      )}
    </div>
  );
}
