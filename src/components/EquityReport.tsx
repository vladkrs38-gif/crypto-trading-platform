'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, IChartApi, Time } from 'lightweight-charts';
import type { EquityCurvePoint, DrawdownCurvePoint, EquityMetrics, TradeDetail, EquityWarning } from '@/lib/labApi';

interface EquityReportProps {
  equityCurve: EquityCurvePoint[];
  drawdownCurve: DrawdownCurvePoint[];
  metrics: EquityMetrics;
  trades: TradeDetail[];
  warnings: EquityWarning[];
  symbol: string;
  timeframe: string;
  initialEquity: number;
}

// Функция для сортировки и удаления дубликатов по времени
function prepareChartData<T extends { time: number }>(data: T[], getValue: (p: T) => number): { time: Time; value: number }[] {
  // Сортируем по времени
  const sorted = [...data].sort((a, b) => a.time - b.time);
  // Удаляем дубликаты по времени, оставляя последнее значение
  const unique = new Map<number, { time: Time; value: number }>();
  for (const point of sorted) {
    unique.set(point.time, { time: point.time as Time, value: getValue(point) });
  }
  return Array.from(unique.values());
}

export default function EquityReport({ equityCurve, drawdownCurve, metrics, trades, warnings, symbol, timeframe, initialEquity }: EquityReportProps) {
  const equityChartRef = useRef<HTMLDivElement>(null);
  const drawdownChartRef = useRef<HTMLDivElement>(null);
  const equityChartInstance = useRef<IChartApi | null>(null);
  const drawdownChartInstance = useRef<IChartApi | null>(null);
  const [selectedTradeIndex, setSelectedTradeIndex] = useState<number | null>(null);
  
  // Фильтрация по датам
  const [dateFilterEnabled, setDateFilterEnabled] = useState(true); // По умолчанию включен
  const [appliedStartDate, setAppliedStartDate] = useState<string>(''); // Примененная дата начала
  const [appliedEndDate, setAppliedEndDate] = useState<string>(''); // Примененная дата конца
  
  // Временные значения для селекторов (до нажатия "Применить")
  const [tempStartDay, setTempStartDay] = useState<number>(1);
  const [tempStartMonth, setTempStartMonth] = useState<number>(1);
  const [tempStartYear, setTempStartYear] = useState<number>(2026);
  const [tempEndDay, setTempEndDay] = useState<number>(31);
  const [tempEndMonth, setTempEndMonth] = useState<number>(12);
  const [tempEndYear, setTempEndYear] = useState<number>(2026);
  
  // Определяем диапазон дат из данных
  const dateRange = useMemo(() => {
    if (!equityCurve.length) return { min: '', max: '', minDate: null, maxDate: null };
    // Используем reduce вместо spread operator для избежания переполнения стека
    const times = equityCurve.map(p => p.time);
    const minTime = times.reduce((min, time) => time < min ? time : min, times[0]);
    const maxTime = times.reduce((max, time) => time > max ? time : max, times[0]);
    const minDate = new Date(minTime * 1000);
    const maxDate = new Date(maxTime * 1000);
    return {
      min: minDate.toISOString().split('T')[0],
      max: maxDate.toISOString().split('T')[0],
      minDate,
      maxDate,
    };
  }, [equityCurve]);
  
  // Инициализация дат: по умолчанию 30 дней назад от последней даты
  useEffect(() => {
    if (dateRange.maxDate && !appliedStartDate && !appliedEndDate) {
      const endDateObj = new Date(dateRange.maxDate);
      const startDateObj = new Date(endDateObj);
      startDateObj.setDate(startDateObj.getDate() - 30); // 30 дней назад
      
      // Устанавливаем примененные даты
      setAppliedStartDate(startDateObj.toISOString().split('T')[0]);
      setAppliedEndDate(endDateObj.toISOString().split('T')[0]);
      
      // Устанавливаем временные значения для селекторов
      setTempStartDay(startDateObj.getDate());
      setTempStartMonth(startDateObj.getMonth() + 1);
      setTempStartYear(startDateObj.getFullYear());
      setTempEndDay(endDateObj.getDate());
      setTempEndMonth(endDateObj.getMonth() + 1);
      setTempEndYear(endDateObj.getFullYear());
    }
  }, [dateRange, appliedStartDate, appliedEndDate]);
  
  // Автоматическая корректировка дня при изменении месяца/года
  useEffect(() => {
    const maxDay = getDaysInMonth(tempStartYear, tempStartMonth);
    if (tempStartDay > maxDay) {
      setTempStartDay(maxDay);
    }
  }, [tempStartYear, tempStartMonth, tempStartDay]);
  
  useEffect(() => {
    const maxDay = getDaysInMonth(tempEndYear, tempEndMonth);
    if (tempEndDay > maxDay) {
      setTempEndDay(maxDay);
    }
  }, [tempEndYear, tempEndMonth, tempEndDay]);
  
  // Функция применения фильтра
  const applyDateFilter = () => {
    const startDateObj = new Date(tempStartYear, tempStartMonth - 1, tempStartDay);
    const endDateObj = new Date(tempEndYear, tempEndMonth - 1, tempEndDay);
    
    // Проверяем валидность дат
    if (isNaN(startDateObj.getTime()) || isNaN(endDateObj.getTime())) {
      alert('Некорректные даты');
      return;
    }
    
    if (startDateObj > endDateObj) {
      alert('Дата начала должна быть раньше даты конца');
      return;
    }
    
    setAppliedStartDate(startDateObj.toISOString().split('T')[0]);
    setAppliedEndDate(endDateObj.toISOString().split('T')[0]);
  };
  
  // Генерация опций для селекторов
  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month, 0).getDate();
  };
  
  const generateDays = (year: number, month: number) => {
    const days = getDaysInMonth(year, month);
    return Array.from({ length: days }, (_, i) => i + 1);
  };
  
  const months = [
    { value: 1, label: 'Январь' },
    { value: 2, label: 'Февраль' },
    { value: 3, label: 'Март' },
    { value: 4, label: 'Апрель' },
    { value: 5, label: 'Май' },
    { value: 6, label: 'Июнь' },
    { value: 7, label: 'Июль' },
    { value: 8, label: 'Август' },
    { value: 9, label: 'Сентябрь' },
    { value: 10, label: 'Октябрь' },
    { value: 11, label: 'Ноябрь' },
    { value: 12, label: 'Декабрь' },
  ];
  
  const generateYears = () => {
    if (!dateRange.minDate || !dateRange.maxDate) return [];
    const minYear = dateRange.minDate.getFullYear();
    const dataMaxYear = dateRange.maxDate.getFullYear();
    const currentYear = new Date().getFullYear();
    const maxYear = Math.max(dataMaxYear, currentYear);
    return Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);
  };
  
  // Фильтрация данных по выбранному диапазону дат
  const filteredData = useMemo(() => {
    if (!dateFilterEnabled || !appliedStartDate || !appliedEndDate) {
      return {
        equityCurve,
        drawdownCurve,
        trades,
        warnings,
      };
    }
    
    const startTimestamp = Math.floor(new Date(appliedStartDate).getTime() / 1000);
    const endTimestamp = Math.floor(new Date(appliedEndDate).getTime() / 1000) + 86400; // +1 день для включения конца
    
    // ИСПРАВЛЕНИЕ: Включаем точку ДО начала периода для правильного расчета initialEquity
    // Находим последнюю точку перед началом периода
    const pointsBeforePeriod = equityCurve.filter(p => p.time < startTimestamp);
    const lastPointBefore = pointsBeforePeriod.length > 0 
      ? [...pointsBeforePeriod].sort((a, b) => b.time - a.time)[0]
      : null;
    
    // Если есть точка до периода, добавляем её в начало для правильного расчета просадки
    const equityToFilter = lastPointBefore 
      ? [lastPointBefore, ...equityCurve.filter(p => p.time >= startTimestamp && p.time <= endTimestamp)]
      : equityCurve.filter(p => p.time >= startTimestamp && p.time <= endTimestamp);
    
    const drawdownToFilter = lastPointBefore
      ? [drawdownCurve.find(p => p.time === lastPointBefore.time) || { time: lastPointBefore.time, drawdown: 0 }, ...drawdownCurve.filter(p => p.time >= startTimestamp && p.time <= endTimestamp)]
      : drawdownCurve.filter(p => p.time >= startTimestamp && p.time <= endTimestamp);
    
    const filteredEquity = equityToFilter;
    const filteredDrawdown = drawdownToFilter;
    const filteredTrades = trades.filter(t => {
      const entryTime = t.entryTime || 0;
      const exitTime = t.exitTime || 0;
      return (entryTime >= startTimestamp && entryTime <= endTimestamp) ||
             (exitTime >= startTimestamp && exitTime <= endTimestamp) ||
             (entryTime < startTimestamp && exitTime > endTimestamp);
    });
    // Пересоздаем warnings с правильными индексами для отфильтрованных сделок
    const filteredWarnings = warnings
      .map(w => {
        const trade = trades[w.tradeIndex];
        if (!trade) return null;
        const entryTime = trade.entryTime || 0;
        const exitTime = trade.exitTime || 0;
        const isInRange = (entryTime >= startTimestamp && entryTime <= endTimestamp) ||
                         (exitTime >= startTimestamp && exitTime <= endTimestamp) ||
                         (entryTime < startTimestamp && exitTime > endTimestamp);
        if (!isInRange) return null;
        // Находим новый индекс в отфильтрованных сделках
        const newIndex = filteredTrades.findIndex(ft => 
          ft.entryTime === trade.entryTime && ft.exitTime === trade.exitTime
        );
        if (newIndex === -1) return null;
        return {
          ...w,
          tradeIndex: newIndex,
        };
      })
      .filter((w): w is EquityWarning => w !== null);
    
      return {
        equityCurve: filteredEquity,
        drawdownCurve: filteredDrawdown,
        trades: filteredTrades,
        warnings: filteredWarnings,
      };
  }, [dateFilterEnabled, appliedStartDate, appliedEndDate, equityCurve, drawdownCurve, trades, warnings, initialEquity]);
  
  // Пересчет метрик под отфильтрованные данные
  const filteredMetrics = useMemo(() => {
    if (!filteredData.equityCurve.length) return metrics;
    
    const equity = filteredData.equityCurve;
    
    // ИСПРАВЛЕНИЕ: Находим начальное equity ДО выбранного периода
    // Если есть точки до выбранного периода, используем последнюю из них
    // Иначе используем переданный initialEquity
    let periodStartEquity = initialEquity;
    if (appliedStartDate) {
      const startTimestamp = Math.floor(new Date(appliedStartDate).getTime() / 1000);
      // Ищем последнюю точку ДО начала выбранного периода
      const pointsBeforePeriod = equityCurve.filter(p => p.time < startTimestamp);
      if (pointsBeforePeriod.length > 0) {
        // Берем последнюю точку перед началом периода
        const sortedBefore = [...pointsBeforePeriod].sort((a, b) => b.time - a.time);
        periodStartEquity = sortedBefore[0].equity;
      }
    }
    
    const finalEquity = equity[equity.length - 1].equity;
    
    // Net Profit рассчитываем от начального капитала на начало периода
    const netProfitUsd = finalEquity - periodStartEquity;
    const netProfitPct = periodStartEquity > 0 ? (netProfitUsd / periodStartEquity * 100) : 0;
    
    // Расчет максимальной просадки
    // Max Drawdown % рассчитывается от Initial Equity (а не от peakEquity)
    // Формула: Max Drawdown % = ((peakEquity - currentEquity) / initialEquity) * 100
    let peak = periodStartEquity;
    let maxDrawdownPct = 0;
    for (const point of equity) {
      if (point.equity > peak) {
        peak = point.equity;
      }
      const dd = periodStartEquity > 0 ? ((peak - point.equity) / periodStartEquity * 100) : 0;
      if (dd > maxDrawdownPct) {
        maxDrawdownPct = dd;
      }
    }
    
    // Recovery Factor
    const recoveryFactor = maxDrawdownPct > 0 
      ? (netProfitUsd / (maxDrawdownPct * periodStartEquity / 100))
      : 0;
    
    // Profit Factor и Win Rate из отфильтрованных сделок
    const filteredTrades = filteredData.trades;
    const wins = filteredTrades.filter(t => t.pnlUsd > 0);
    const losses = filteredTrades.filter(t => t.pnlUsd < 0);
    const winRate = filteredTrades.length > 0 ? (wins.length / filteredTrades.length * 100) : 0;
    const grossProfit = wins.reduce((sum, t) => sum + t.pnlUsd, 0);
    const grossLoss = losses.reduce((sum, t) => sum + Math.abs(t.pnlUsd), 0);
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss) : (grossProfit > 0 ? 999.99 : 0);
    
    // Avg Trade
    const avgTrade = filteredTrades.length > 0 ? (netProfitUsd / filteredTrades.length) : 0;
    
    return {
      netProfitUsd: Math.round(netProfitUsd * 100) / 100,
      netProfitPct: Math.round(netProfitPct * 100) / 100,
      maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
      recoveryFactor: Math.round(recoveryFactor * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      winRate: Math.round(winRate * 10) / 10,
      avgTrade: Math.round(avgTrade * 100) / 100,
    };
  }, [filteredData, metrics]);
  
  // Используем отфильтрованные данные и метрики
  const displayEquityCurve = filteredData.equityCurve;
  const displayDrawdownCurve = filteredData.drawdownCurve;
  const displayMetrics = dateFilterEnabled ? filteredMetrics : metrics;
  const displayTrades = filteredData.trades;
  const displayWarnings = filteredData.warnings;

  // Инициализация графиков
  useEffect(() => {
    if (!displayEquityCurve.length || !equityChartRef.current || !drawdownChartRef.current) return;

    const equityData = prepareChartData(displayEquityCurve, (p) => p.equity);
    const drawdownData = prepareChartData(displayDrawdownCurve, (p) => -p.drawdown);

    // График эквити
    const equityChart = createChart(equityChartRef.current, {
      layout: { background: { type: 'solid', color: '#0f0f12' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: '#2d2d33' }, horzLines: { color: '#2d2d33' } },
      width: equityChartRef.current.clientWidth,
      height: 400,
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

    // График просадки (Underwater Chart)
    const drawdownChart = createChart(drawdownChartRef.current, {
      layout: { background: { type: 'solid', color: '#0f0f12' }, textColor: '#9ca3af' },
      grid: { vertLines: { color: '#2d2d33' }, horzLines: { color: '#2d2d33' } },
      width: drawdownChartRef.current.clientWidth,
      height: 250,
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: '#2d2d33', scaleMargins: { top: 0.1, bottom: 0.1 } },
    });
    drawdownChartInstance.current = drawdownChart;

    const drawdownSeries = drawdownChart.addAreaSeries({
      lineColor: '#ef4444',
      topColor: 'rgba(239, 68, 68, 0)',
      bottomColor: 'rgba(239, 68, 68, 0.3)',
      lineWidth: 2,
    });
    drawdownSeries.setData(drawdownData);
    drawdownChart.timeScale().fitContent();
    
    // Сохраняем ссылки на серии для обновления данных
    (equityChartInstance.current as any).equitySeries = equitySeries;
    (drawdownChartInstance.current as any).drawdownSeries = drawdownSeries;

    // Синхронизация временной шкалы между графиками
    const syncCharts = () => {
      const equityTimeScale = equityChart.timeScale();
      const drawdownTimeScale = drawdownChart.timeScale();
      
      equityChart.subscribeCrosshairMove((param) => {
        if (param.time) {
          drawdownTimeScale.setVisibleRange({
            from: equityTimeScale.getVisibleRange()?.from as Time,
            to: equityTimeScale.getVisibleRange()?.to as Time,
          });
        }
      });
      
      drawdownChart.subscribeCrosshairMove((param) => {
        if (param.time) {
          equityTimeScale.setVisibleRange({
            from: drawdownTimeScale.getVisibleRange()?.from as Time,
            to: drawdownTimeScale.getVisibleRange()?.to as Time,
          });
        }
      });
    };
    syncCharts();

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
  }, [displayEquityCurve, displayDrawdownCurve]);
  
  // Обновление данных графиков при изменении фильтра
  useEffect(() => {
    if (!equityChartInstance.current || !drawdownChartInstance.current) return;
    
    const equitySeries = (equityChartInstance.current as any).equitySeries;
    const drawdownSeries = (drawdownChartInstance.current as any).drawdownSeries;
    
    if (equitySeries && displayEquityCurve.length > 0) {
      const equityData = prepareChartData(displayEquityCurve, (p) => p.equity);
      equitySeries.setData(equityData);
      equityChartInstance.current.timeScale().fitContent();
    }
    
    if (drawdownSeries && displayDrawdownCurve.length > 0) {
      const drawdownData = prepareChartData(displayDrawdownCurve, (p) => -p.drawdown);
      drawdownSeries.setData(drawdownData);
      drawdownChartInstance.current.timeScale().fitContent();
    }
  }, [displayEquityCurve, displayDrawdownCurve]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
      {/* Фильтр по датам */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={dateFilterEnabled}
              onChange={(e) => setDateFilterEnabled(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>Фильтр по датам</span>
          </label>
          {dateFilterEnabled && dateRange.maxDate && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              Показано: {displayEquityCurve.length} точек из {equityCurve.length}
            </span>
          )}
        </div>
        
        {dateFilterEnabled && dateRange.maxDate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>От:</label>
              <select
                value={tempStartDay}
                onChange={(e) => {
                  const day = parseInt(e.target.value);
                  setTempStartDay(day);
                  const maxDay = getDaysInMonth(tempStartYear, tempStartMonth);
                  if (day > maxDay) setTempStartDay(maxDay);
                }}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-main)',
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                {generateDays(tempStartYear, tempStartMonth).map(day => (
                  <option key={day} value={day}>{day}</option>
                ))}
              </select>
              <select
                value={tempStartMonth}
                onChange={(e) => {
                  const month = parseInt(e.target.value);
                  setTempStartMonth(month);
                  const maxDay = getDaysInMonth(tempStartYear, month);
                  if (tempStartDay > maxDay) setTempStartDay(maxDay);
                }}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-main)',
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                {months.map(month => (
                  <option key={month.value} value={month.value}>{month.label}</option>
                ))}
              </select>
              <select
                value={tempStartYear}
                onChange={(e) => {
                  const year = parseInt(e.target.value);
                  setTempStartYear(year);
                  const maxDay = getDaysInMonth(year, tempStartMonth);
                  if (tempStartDay > maxDay) setTempStartDay(maxDay);
                }}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-main)',
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                {generateYears().map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>До:</label>
              <select
                value={tempEndDay}
                onChange={(e) => {
                  const day = parseInt(e.target.value);
                  setTempEndDay(day);
                  const maxDay = getDaysInMonth(tempEndYear, tempEndMonth);
                  if (day > maxDay) setTempEndDay(maxDay);
                }}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-main)',
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                {generateDays(tempEndYear, tempEndMonth).map(day => (
                  <option key={day} value={day}>{day}</option>
                ))}
              </select>
              <select
                value={tempEndMonth}
                onChange={(e) => {
                  const month = parseInt(e.target.value);
                  setTempEndMonth(month);
                  const maxDay = getDaysInMonth(tempEndYear, month);
                  if (tempEndDay > maxDay) setTempEndDay(maxDay);
                }}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-main)',
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                {months.map(month => (
                  <option key={month.value} value={month.value}>{month.label}</option>
                ))}
              </select>
              <select
                value={tempEndYear}
                onChange={(e) => {
                  const year = parseInt(e.target.value);
                  setTempEndYear(year);
                  const maxDay = getDaysInMonth(year, tempEndMonth);
                  if (tempEndDay > maxDay) setTempEndDay(maxDay);
                }}
                style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-main)',
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                {generateYears().map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
            
            <button
              onClick={applyDateFilter}
              style={{
                padding: '6px 16px',
                borderRadius: '4px',
                border: 'none',
                background: 'var(--accent-color, #3b82f6)',
                color: 'white',
                fontSize: '0.85rem',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              Применить
            </button>
          </div>
        )}
      </div>

      {/* Блок метрик (Summary) */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '20px',
        }}
      >
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px', color: 'var(--text-main)' }}>
          Сводка результатов{dateFilterEnabled ? ' (за выбранный период)' : ''}
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
          }}
        >
          <MetricCard
            label="Net Profit"
            value={formatCurrency(displayMetrics.netProfitUsd)}
            subValue={formatPercent(displayMetrics.netProfitPct)}
            color={displayMetrics.netProfitUsd >= 0 ? '#22c55e' : '#ef4444'}
          />
          <MetricCard
            label="Max Drawdown"
            value={formatPercent(displayMetrics.maxDrawdownPct)}
            subValue="Максимальная просадка"
            color={displayMetrics.maxDrawdownPct < 20 ? '#22c55e' : displayMetrics.maxDrawdownPct < 50 ? '#f59e0b' : '#ef4444'}
          />
          <MetricCard
            label="Recovery Factor"
            value={displayMetrics.recoveryFactor.toFixed(2)}
            subValue={displayMetrics.recoveryFactor >= 2 ? '✓ Хорошо' : '⚠ Низкий'}
            color={displayMetrics.recoveryFactor >= 2 ? '#22c55e' : '#f59e0b'}
          />
          <MetricCard
            label="Profit Factor"
            value={displayMetrics.profitFactor.toFixed(2)}
            subValue={displayMetrics.profitFactor >= 1.5 ? '✓ Хорошо' : '⚠ Низкий'}
            color={displayMetrics.profitFactor >= 1.5 ? '#22c55e' : '#f59e0b'}
          />
          <MetricCard
            label="Win Rate"
            value={formatPercent(displayMetrics.winRate)}
            subValue={`${displayTrades.length} сделок`}
            color={displayMetrics.winRate >= 50 ? '#22c55e' : '#f59e0b'}
          />
          <MetricCard
            label="Avg Trade"
            value={formatCurrency(displayMetrics.avgTrade)}
            subValue="Средняя прибыль на сделку"
            color={displayMetrics.avgTrade >= 0 ? '#22c55e' : '#ef4444'}
          />
        </div>
      </div>

      {/* Графики Equity & Drawdown */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '20px',
        }}
      >
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px', color: 'var(--text-main)' }}>
          Кривая капитала и просадка
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '8px' }}>
              Доход (эквити), $
            </div>
            <div ref={equityChartRef} style={{ width: '100%', height: '400px' }} />
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '8px' }}>
              Просадка, $ (Underwater Chart)
            </div>
            <div ref={drawdownChartRef} style={{ width: '100%', height: '250px' }} />
          </div>
        </div>
      </div>

      {/* Визуализация сделок на графике цены - заглушка */}
      {selectedTradeIndex !== null && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '20px',
          }}
        >
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px', color: 'var(--text-main)' }}>
            График цены с метками сделки
          </h2>
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Для отображения графика цены с метками сделок нужны детали сделок из API.
            <br />
            (Зеленые стрелки: входы, Синие/Красные линии: тейк/стоп, Флажок: выход)
          </div>
        </div>
      )}

      {/* Лог "Скелетов в шкафу" */}
      {displayWarnings.length > 0 && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '20px',
          }}
        >
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '16px', color: '#f59e0b' }}>
            ⚠ Скелеты в шкафу
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {displayWarnings.map((warning, idx) => {
              const trade = displayTrades[warning.tradeIndex];
              if (!trade) return null;
              
              const durationHours = trade.duration / 3600;
              return (
                <div
                  key={idx}
                  style={{
                    padding: '12px',
                    background: 'rgba(245, 158, 11, 0.1)',
                    borderRadius: '6px',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setSelectedTradeIndex(warning.tradeIndex)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 600, color: '#f59e0b' }}>{warning.message}</span>
                      <div style={{ marginTop: '4px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        Вход: {new Date(trade.entryTime * 1000).toLocaleString()} | 
                        Выход: {new Date(trade.exitTime * 1000).toLocaleString()} | 
                        Колен: {trade.legs} | 
                        Длительность: {durationHours.toFixed(1)} ч | 
                        Причина: {trade.reason}
                      </div>
                    </div>
                    <span style={{ color: trade.pnlUsd >= 0 ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                      {formatCurrency(trade.pnlUsd)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  subValue: string;
  color: string;
}

function MetricCard({ label, value, subValue, color }: MetricCardProps) {
  return (
    <div
      style={{
        padding: '12px',
        background: 'var(--bg-main)',
        borderRadius: '6px',
        border: '1px solid var(--border)',
      }}
    >
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '1.25rem', fontWeight: 600, color, marginBottom: '4px' }}>{value}</div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{subValue}</div>
    </div>
  );
}
