'use client';

import { useEffect, useRef } from 'react';
import { createChart, IChartApi } from 'lightweight-charts';
import type { EquityCurvePoint, DrawdownCurvePoint } from '@/lib/labApi';

interface EquityCurveChartsProps {
  equityCurve: EquityCurvePoint[];
  drawdownCurve: DrawdownCurvePoint[];
}

export default function EquityCurveCharts({ equityCurve, drawdownCurve }: EquityCurveChartsProps) {
  const equityChartRef = useRef<HTMLDivElement>(null);
  const drawdownChartRef = useRef<HTMLDivElement>(null);
  const equityChartInstance = useRef<IChartApi | null>(null);
  const drawdownChartInstance = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!equityCurve.length || !equityChartRef.current || !drawdownChartRef.current) return;

    const equityData = equityCurve.map((p) => ({ time: p.time as any, value: p.equity }));
    const drawdownData = drawdownCurve.map((p) => ({ time: p.time as any, value: -p.drawdown }));

    const equityChart = createChart(equityChartRef.current, {
      layout: { background: { type: 'solid', color: '#0f0f12' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: '#2d2d33' }, horzLines: { color: '#2d2d33' } },
      width: equityChartRef.current.clientWidth,
      height: 320,
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#2d2d33', scaleMargins: { top: 0.1, bottom: 0.1 } },
    });
    equityChartInstance.current = equityChart;

    const equitySeries = equityChart.addAreaSeries({
      lineColor: '#22c55e',
      topColor: 'rgba(34, 197, 94, 0.4)',
      bottomColor: 'rgba(34, 197, 94, 0)',
      lineWidth: 2,
    });
    equitySeries.setData(equityData);
    equityChart.timeScale().fitContent();

    const drawdownChart = createChart(drawdownChartRef.current, {
      layout: { background: { type: 'solid', color: '#0f0f12' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: '#2d2d33' }, horzLines: { color: '#2d2d33' } },
      width: drawdownChartRef.current.clientWidth,
      height: 200,
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#2d2d33', scaleMargins: { top: 0.1, bottom: 0.1 } },
    });
    drawdownChartInstance.current = drawdownChart;

    const drawdownSeries = drawdownChart.addAreaSeries({
      lineColor: '#3b82f6',
      topColor: 'rgba(59, 130, 246, 0)',
      bottomColor: 'rgba(59, 130, 246, 0.3)',
      lineWidth: 2,
    });
    drawdownSeries.setData(drawdownData);
    drawdownChart.timeScale().fitContent();

    const handleResize = () => {
      if (equityChartRef.current && equityChartInstance.current)
        equityChartInstance.current.applyOptions({ width: equityChartRef.current.clientWidth });
      if (drawdownChartRef.current && drawdownChartInstance.current)
        drawdownChartInstance.current.applyOptions({ width: drawdownChartRef.current.clientWidth });
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      equityChartInstance.current?.remove();
      equityChartInstance.current = null;
      drawdownChartInstance.current?.remove();
      drawdownChartInstance.current = null;
    };
  }, [equityCurve, drawdownCurve]);

  return (
    <>
      <div>
        <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: '4px' }}>Доход (эквити), $</div>
        <div ref={equityChartRef} style={{ width: '100%', height: '320px' }} />
      </div>
      <div>
        <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: '4px' }}>Просадка, $ (под водой)</div>
        <div ref={drawdownChartRef} style={{ width: '100%', height: '200px' }} />
      </div>
    </>
  );
}
