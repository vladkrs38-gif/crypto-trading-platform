'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time, CrosshairMode, LogicalRange } from 'lightweight-charts';
import { useTradingStore } from '@/store/useTradingStore';
import { BinanceTickStream, BinanceDepthStream, OrderBookData, calculateLiquidityImbalance } from '@/lib/binance';
import { BybitTickStream, BybitDepthStream, type BybitOrderBookData } from '@/lib/bybit';
import type { TickData } from '@/types/binance';
import { getPriceFormatFromRange } from '@/lib/chartPriceFormat';
import { getAdaptiveDepthLevels } from '@/lib/orderBookUtils';
import { useDrawingTools, DrawingToolbar } from './DrawingTools';

interface TickCandle {
  time: number; // Индекс свечи (для графика)
  realTime: number; // Реальное время в миллисекундах (для отображения)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickCount: number;
  barDelta: number; // Побарная дельта
  cumulativeDelta: number; // Кумулятивная дельта
  imbalanceTrend: number; // Тренд дисбаланса
  imbalanceEma: number; // EMA тренда дисбаланса
  currentImbalance?: number; // Текущий imbalance для определения процента перевеса (-1 до +1)
  bidVolume?: number; // Объем бидов для свечи
  askVolume?: number; // Объем асков для свечи
}

// Глобальный счётчик для уникальных индексов свечей
let candleIndexCounter = 0;

// EMA для сглаживания imbalance
function calculateEMA(currentValue: number, previousEMA: number, period: number): number {
  const multiplier = 2 / (period + 1);
  return currentValue * multiplier + previousEMA * (1 - multiplier);
}

// Форматирование объёма в USDT для отображения
function formatVolumeUsdt(volume: number): string {
  if (volume >= 1000000) {
    return (volume / 1000000).toFixed(1) + 'M';
  } else if (volume >= 1000) {
    return (volume / 1000).toFixed(0) + 'K';
  }
  return volume.toFixed(0);
}

// Вычисление цвета линии в зависимости от процента перевеса (70-100%)
function getHeatMapColor(imbalancePercent: number): string {
  if (!imbalancePercent || imbalancePercent < 70) {
    return '#00d4ff'; // Синий по умолчанию
  }
  
  // Нормализуем от 70% до 100% в диапазон 0-1
  const intensity = (imbalancePercent - 70) / 30; // 0 при 70%, 1 при 100%
  
  // Интерполируем от бледно-розового (#FFB3BA) до красного (#FF0000)
  const r1 = 255, g1 = 179, b1 = 186; // Бледно-розовый
  const r2 = 255, g2 = 0, b2 = 0; // Красный
  
  const r = Math.round(r1 + (r2 - r1) * intensity);
  const g = Math.round(g1 + (g2 - g1) * intensity);
  const b = Math.round(b1 + (b2 - b1) * intensity);
  
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Вычисление цвета маркера в зависимости от силы перевеса (4 шага: 70%, 80%, 90%, 100%)
// imbalance - текущий imbalance от -1 до +1
function getMarkerColor(imbalance: number | undefined): string | null {
  if (imbalance === undefined) return null;
  
  const absImbalance = Math.abs(imbalance);
  
  // Только если перевес >= 70%
  if (absImbalance < 0.7) {
    return null; // Нет маркера
  }
  
  // Покупатели (Bids, imbalance > 0)
  if (imbalance > 0) {
    if (absImbalance >= 1.0) {
      return '#006400'; // 100% - очень тёмно-зелёный
    } else if (absImbalance >= 0.9) {
      return '#228B22'; // 90% - тёмно-зелёный
    } else if (absImbalance >= 0.8) {
      return '#32CD32'; // 80% - зелёный
    } else {
      return '#90EE90'; // 70% - светло-зелёный
    }
  }
  // Продавцы (Asks, imbalance < 0)
  else {
    if (absImbalance >= 1.0) {
      return '#8B0000'; // 100% - очень тёмно-красный
    } else if (absImbalance >= 0.9) {
      return '#DC143C'; // 90% - тёмно-красный
    } else if (absImbalance >= 0.8) {
      return '#FF6B6B'; // 80% - красный
    } else {
      return '#FFB3BA'; // 70% - светло-розовый
    }
  }
}

// Функция расчёта тренда кумулятивной дельты
function calculateCDTrend(
  data: { time: Time; value: number }[],
  period: number,
  offsetPercent: number
): { time: Time; value: number; color: string }[] {
  if (data.length < 2) return [];
  
  const result: { time: Time; value: number; color: string }[] = [];
  
  // Вычисляем диапазон данных для расчёта отступа
  let dataMin = data[0].value;
  let dataMax = data[0].value;
  for (const point of data) {
    if (point.value < dataMin) dataMin = point.value;
    if (point.value > dataMax) dataMax = point.value;
  }
  const dataRange = dataMax - dataMin;
  const trendOffset = dataRange * (offsetPercent / 100);
  
  let trendLevel = data[0].value;
  let isUptrend = true;
  let periodHigh = data[0].value;
  let periodLow = data[0].value;
  
  const upColor = '#3fb950';
  const downColor = '#f85149';
  
  for (let i = 0; i < data.length; i++) {
    const currentValue = data[i].value;
    
    const lookbackStart = Math.max(0, i - period);
    periodHigh = data[lookbackStart].value;
    periodLow = data[lookbackStart].value;
    
    for (let j = lookbackStart; j < i; j++) {
      if (data[j].value > periodHigh) periodHigh = data[j].value;
      if (data[j].value < periodLow) periodLow = data[j].value;
    }
    
    if (isUptrend) {
      if (currentValue < periodLow) {
        isUptrend = false;
        trendLevel = currentValue;
      } else if (currentValue > trendLevel) {
        trendLevel = currentValue;
      }
    } else {
      if (currentValue > periodHigh) {
        isUptrend = true;
        trendLevel = currentValue;
      } else if (currentValue < trendLevel) {
        trendLevel = currentValue;
      }
    }
    
    // При восходящем тренде (зелёный) линия снизу, при нисходящем (красный) - сверху
    const offsetValue = isUptrend ? trendLevel - trendOffset : trendLevel + trendOffset;
    
    result.push({
      time: data[i].time,
      value: offsetValue,
      color: isUptrend ? upColor : downColor,
    });
  }
  
  return result;
}

// Модальное окно настроек КД для 200-тикового графика
function CumulativeDeltaSettingsModalTick200({ 
  isOpen, 
  onClose 
}: { 
  isOpen: boolean; 
  onClose: () => void;
}) {
  const showCumulativeDeltaTrend = useTradingStore((state) => state.showCumulativeDeltaTrendTick200);
  const setShowCumulativeDeltaTrend = useTradingStore((state) => state.setShowCumulativeDeltaTrendTick200);
  const cumulativeDeltaTrendPeriod = useTradingStore((state) => state.cumulativeDeltaTrendPeriodTick200);
  const setCumulativeDeltaTrendPeriod = useTradingStore((state) => state.setCumulativeDeltaTrendPeriodTick200);
  const cumulativeDeltaTrendOffset = useTradingStore((state) => state.cumulativeDeltaTrendOffsetTick200);
  const setCumulativeDeltaTrendOffset = useTradingStore((state) => state.setCumulativeDeltaTrendOffsetTick200);
  const cumulativeDeltaDisplayMode = useTradingStore((state) => state.cumulativeDeltaDisplayModeTick200);
  const setCumulativeDeltaDisplayMode = useTradingStore((state) => state.setCumulativeDeltaDisplayModeTick200);

  if (!isOpen) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div 
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '20px',
          minWidth: '360px',
          maxWidth: '450px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '20px',
          paddingBottom: '12px',
          borderBottom: '1px solid var(--border)',
        }}>
          <h3 style={{ 
            margin: 0, 
            color: '#f0b90b', 
            fontSize: '1rem',
            fontWeight: 600,
          }}>
            ⚙️ Настройки КД (200-тик)
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Режим отображения */}
          <div style={{ 
            padding: '12px',
            background: 'var(--bg-main)',
            borderRadius: '8px',
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '10px' }}>
              Режим отображения
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setCumulativeDeltaDisplayMode('candle')}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  background: cumulativeDeltaDisplayMode === 'candle' ? 'rgba(240, 185, 11, 0.2)' : 'var(--bg-card)',
                  border: `2px solid ${cumulativeDeltaDisplayMode === 'candle' ? '#f0b90b' : 'var(--border)'}`,
                  borderRadius: '8px',
                  color: cumulativeDeltaDisplayMode === 'candle' ? '#f0b90b' : 'var(--text-main)',
                  cursor: 'pointer',
                  fontWeight: cumulativeDeltaDisplayMode === 'candle' ? 600 : 400,
                  fontSize: '0.85rem',
                }}
              >
                📊 Свечи
              </button>
              <button
                onClick={() => setCumulativeDeltaDisplayMode('line')}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  background: cumulativeDeltaDisplayMode === 'line' ? 'rgba(240, 185, 11, 0.2)' : 'var(--bg-card)',
                  border: `2px solid ${cumulativeDeltaDisplayMode === 'line' ? '#f0b90b' : 'var(--border)'}`,
                  borderRadius: '8px',
                  color: cumulativeDeltaDisplayMode === 'line' ? '#f0b90b' : 'var(--text-main)',
                  cursor: 'pointer',
                  fontWeight: cumulativeDeltaDisplayMode === 'line' ? 600 : 400,
                  fontSize: '0.85rem',
                }}
              >
                📈 Линия
              </button>
            </div>
          </div>

          {/* Разделитель - Тренд */}
          <div style={{ 
            borderTop: '1px solid var(--border)', 
            paddingTop: '16px',
            marginTop: '4px',
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Линия тренда
            </div>
          </div>

          {/* Включить/выключить тренд */}
          <label style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '10px', 
            cursor: 'pointer',
            padding: '8px 12px',
            background: 'var(--bg-main)',
            borderRadius: '8px',
          }}>
            <input
              type="checkbox"
              checked={showCumulativeDeltaTrend}
              onChange={(e) => setShowCumulativeDeltaTrend(e.target.checked)}
              style={{ 
                cursor: 'pointer',
                width: '18px',
                height: '18px',
                accentColor: '#f0b90b',
              }}
            />
            <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>
              Показывать линию тренда
            </span>
          </label>

          {/* Период */}
          <div style={{ 
            padding: '12px',
            background: 'var(--bg-main)',
            borderRadius: '8px',
            opacity: showCumulativeDeltaTrend ? 1 : 0.5,
          }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Период (свечей)
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="range"
                  min={3}
                  max={200}
                  value={cumulativeDeltaTrendPeriod}
                  onChange={(e) => setCumulativeDeltaTrendPeriod(parseInt(e.target.value))}
                  disabled={!showCumulativeDeltaTrend}
                  style={{ 
                    flex: 1,
                    cursor: showCumulativeDeltaTrend ? 'pointer' : 'not-allowed',
                    accentColor: '#f0b90b',
                  }}
                />
                <input
                  type="number"
                  min={3}
                  max={200}
                  value={cumulativeDeltaTrendPeriod}
                  onChange={(e) => setCumulativeDeltaTrendPeriod(Math.max(3, Math.min(200, parseInt(e.target.value) || 14)))}
                  disabled={!showCumulativeDeltaTrend}
                  style={{
                    width: '70px',
                    padding: '6px 8px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    color: 'var(--text-main)',
                    fontSize: '0.9rem',
                    textAlign: 'center',
                  }}
                />
              </div>
            </label>
          </div>

          {/* Отступ */}
          <div style={{ 
            padding: '12px',
            background: 'var(--bg-main)',
            borderRadius: '8px',
            opacity: showCumulativeDeltaTrend ? 1 : 0.5,
          }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Отступ от КД (%)
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={cumulativeDeltaTrendOffset}
                  onChange={(e) => setCumulativeDeltaTrendOffset(parseInt(e.target.value))}
                  disabled={!showCumulativeDeltaTrend}
                  style={{ 
                    flex: 1,
                    cursor: showCumulativeDeltaTrend ? 'pointer' : 'not-allowed',
                    accentColor: '#f0b90b',
                  }}
                />
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={cumulativeDeltaTrendOffset}
                  onChange={(e) => setCumulativeDeltaTrendOffset(Math.max(0, Math.min(50, parseInt(e.target.value) || 15)))}
                  disabled={!showCumulativeDeltaTrend}
                  style={{
                    width: '70px',
                    padding: '6px 8px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    color: 'var(--text-main)',
                    fontSize: '0.9rem',
                    textAlign: 'center',
                  }}
                />
              </div>
            </label>
          </div>

          {/* Легенда */}
          <div style={{ 
            padding: '12px',
            background: 'rgba(240, 185, 11, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(240, 185, 11, 0.2)',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Как читать тренд:
            </div>
            <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '12px', height: '12px', background: '#3fb950', borderRadius: '2px' }} />
                <span style={{ color: 'var(--text-main)' }}>Восходящий (снизу)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '12px', height: '12px', background: '#f85149', borderRadius: '2px' }} />
                <span style={{ color: 'var(--text-main)' }}>Нисходящий (сверху)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Модальное окно настроек Imbalance Trend
function ImbalanceSettingsModal({ 
  isOpen, 
  onClose 
}: { 
  isOpen: boolean; 
  onClose: () => void;
}) {
  const imbalanceLevels = useTradingStore((state) => state.imbalanceLevels);
  const setImbalanceLevels = useTradingStore((state) => state.setImbalanceLevels);
  const imbalanceEmaPeriod = useTradingStore((state) => state.imbalanceEmaPeriod);
  const setImbalanceEmaPeriod = useTradingStore((state) => state.setImbalanceEmaPeriod);
  const imbalanceMultiplier = useTradingStore((state) => state.imbalanceMultiplier);
  const setImbalanceMultiplier = useTradingStore((state) => state.setImbalanceMultiplier);
  const showImbalanceEma = useTradingStore((state) => state.showImbalanceEma);
  const setShowImbalanceEma = useTradingStore((state) => state.setShowImbalanceEma);
  const imbalanceHeatMap = useTradingStore((state) => state.imbalanceHeatMap);
  const setImbalanceHeatMap = useTradingStore((state) => state.setImbalanceHeatMap);
  const showImbalanceMarkers = useTradingStore((state) => state.showImbalanceMarkers);
  const setShowImbalanceMarkers = useTradingStore((state) => state.setShowImbalanceMarkers);
  const imbalanceMinStrength = useTradingStore((state) => state.imbalanceMinStrength);
  const setImbalanceMinStrength = useTradingStore((state) => state.setImbalanceMinStrength);
  if (!isOpen) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div 
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '20px',
          minWidth: '360px',
          maxWidth: '450px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '20px',
          paddingBottom: '12px',
          borderBottom: '1px solid var(--border)',
        }}>
          <h3 style={{ 
            margin: 0, 
            color: '#00d4ff', 
            fontSize: '1rem',
            fontWeight: 600,
          }}>
            ⚙️ Настройки Imbalance Trend
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Уровни стакана */}
          <div style={{ 
            padding: '12px',
            background: 'var(--bg-main)',
            borderRadius: '8px',
          }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Уровни стакана (глубина)
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="range"
                  min={5}
                  max={20}
                  step={1}
                  value={imbalanceLevels}
                  onChange={(e) => setImbalanceLevels(parseInt(e.target.value))}
                  style={{ 
                    flex: 1,
                    cursor: 'pointer',
                    accentColor: '#00d4ff',
                  }}
                />
                <input
                  type="number"
                  min={5}
                  max={20}
                  value={imbalanceLevels}
                  onChange={(e) => setImbalanceLevels(Math.max(5, Math.min(20, parseInt(e.target.value) || 5)))}
                  style={{
                    width: '70px',
                    padding: '6px 8px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    color: 'var(--text-main)',
                    fontSize: '0.9rem',
                    textAlign: 'center',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                {[5, 10, 15, 20].map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setImbalanceLevels(level)}
                    style={{
                      flex: 1,
                      padding: '4px 8px',
                      background: imbalanceLevels === level ? '#00d4ff' : 'var(--bg-elevated)',
                      color: imbalanceLevels === level ? '#fff' : 'var(--text-main)',
                      border: `1px solid ${imbalanceLevels === level ? '#00d4ff' : 'var(--border)'}`,
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: imbalanceLevels === level ? 600 : 400,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      if (imbalanceLevels !== level) {
                        e.currentTarget.style.background = 'var(--bg-card)';
                        e.currentTarget.style.borderColor = '#00d4ff';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (imbalanceLevels !== level) {
                        e.currentTarget.style.background = 'var(--bg-elevated)';
                        e.currentTarget.style.borderColor = 'var(--border)';
                      }
                    }}
                  >
                    {level} lvl
                  </button>
                ))}
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                Больше уровней = более глубокий анализ стакана
              </span>
            </label>
          </div>

          {/* Множитель сигнала */}
          <div style={{ 
            padding: '12px',
            background: 'var(--bg-main)',
            borderRadius: '8px',
          }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Множитель сигнала
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="range"
                  min={1}
                  max={50}
                  value={imbalanceMultiplier}
                  onChange={(e) => setImbalanceMultiplier(parseInt(e.target.value))}
                  style={{ 
                    flex: 1,
                    cursor: 'pointer',
                    accentColor: '#00d4ff',
                  }}
                />
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={imbalanceMultiplier}
                  onChange={(e) => setImbalanceMultiplier(Math.max(1, Math.min(50, parseInt(e.target.value) || 10)))}
                  style={{
                    width: '70px',
                    padding: '6px 8px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    color: 'var(--text-main)',
                    fontSize: '0.9rem',
                    textAlign: 'center',
                  }}
                />
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                Увеличивает амплитуду сигнала для лучшей видимости
              </span>
            </label>
          </div>

          {/* Разделитель - EMA */}
          <div style={{ 
            borderTop: '1px solid var(--border)', 
            paddingTop: '16px',
            marginTop: '4px',
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Линия EMA (сглаживание)
            </div>
          </div>

          {/* Включить/выключить EMA */}
          <label style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '10px', 
            cursor: 'pointer',
            padding: '8px 12px',
            background: 'var(--bg-main)',
            borderRadius: '8px',
          }}>
            <input
              type="checkbox"
              checked={showImbalanceEma}
              onChange={(e) => setShowImbalanceEma(e.target.checked)}
              style={{ 
                cursor: 'pointer',
                width: '18px',
                height: '18px',
                accentColor: '#00d4ff',
              }}
            />
            <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>
              Показывать EMA линию
            </span>
          </label>

          {/* Период EMA */}
          <div style={{ 
            padding: '12px',
            background: 'var(--bg-main)',
            borderRadius: '8px',
            opacity: showImbalanceEma ? 1 : 0.5,
          }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Период EMA
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="range"
                  min={2}
                  max={20}
                  value={imbalanceEmaPeriod}
                  onChange={(e) => setImbalanceEmaPeriod(parseInt(e.target.value))}
                  disabled={!showImbalanceEma}
                  style={{ 
                    flex: 1,
                    cursor: showImbalanceEma ? 'pointer' : 'not-allowed',
                    accentColor: '#00d4ff',
                  }}
                />
                <input
                  type="number"
                  min={2}
                  max={20}
                  value={imbalanceEmaPeriod}
                  onChange={(e) => setImbalanceEmaPeriod(Math.max(2, Math.min(20, parseInt(e.target.value) || 5)))}
                  disabled={!showImbalanceEma}
                  style={{
                    width: '70px',
                    padding: '6px 8px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    color: 'var(--text-main)',
                    fontSize: '0.9rem',
                    textAlign: 'center',
                  }}
                />
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                Меньше = быстрее реагирует, больше = плавнее
              </span>
            </label>
          </div>

          {/* Разделитель - Цветовая индикация */}
          <div style={{ 
            borderTop: '1px solid var(--border)', 
            paddingTop: '16px',
            marginTop: '4px',
          }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Цветовая индикация
            </div>
          </div>

          {/* Цветовая индикация нагрева */}
          <label style={{ 
            display: 'flex', 
            alignItems: 'flex-start', 
            gap: '10px', 
            cursor: 'pointer',
            padding: '12px',
            background: 'var(--bg-main)',
            borderRadius: '8px',
            border: '1px solid rgba(255, 179, 186, 0.3)',
          }}>
            <input
              type="checkbox"
              checked={imbalanceHeatMap}
              onChange={(e) => setImbalanceHeatMap(e.target.checked)}
              style={{ 
                cursor: 'pointer',
                width: '18px',
                height: '18px',
                accentColor: '#FFB3BA',
                marginTop: '2px',
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ color: '#FFB3BA', fontWeight: 500, marginBottom: '4px', fontSize: '0.9rem' }}>
                🔥 Цветовая индикация &quot;нагрева&quot;
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: 1.4 }}>
                Линия меняет цвет от <span style={{ color: '#FFB3BA' }}>бледно-розового</span> до <span style={{ color: '#FF0000' }}>красного</span> при перевесе <strong>70-100%</strong>. В остальных случаях остаётся синей.
              </div>
            </div>
          </label>

          {/* Маркеры силы на графике цены */}
          <label style={{ 
            display: 'flex', 
            alignItems: 'flex-start', 
            gap: '10px', 
            cursor: 'pointer',
            padding: '12px',
            background: 'var(--bg-main)',
            borderRadius: '8px',
            border: '1px solid rgba(144, 238, 144, 0.3)',
          }}>
            <input
              type="checkbox"
              checked={showImbalanceMarkers}
              onChange={(e) => setShowImbalanceMarkers(e.target.checked)}
              style={{ 
                cursor: 'pointer',
                width: '18px',
                height: '18px',
                accentColor: '#90EE90',
                marginTop: '2px',
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ color: '#90EE90', fontWeight: 500, marginBottom: '4px', fontSize: '0.9rem' }}>
                📍 Маркеры силы на графике цены
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: 1.4 }}>
                Показывает маркеры на свечном графике при перевесе <strong>≥70%</strong>. 
                <span style={{ color: '#90EE90' }}>Зелёные</span> под свечами (покупатели), 
                <span style={{ color: '#FFB3BA' }}>красные</span> над свечами (продавцы). 
                Цвет зависит от силы: 70% → 80% → 90% → 100%.
              </div>
            </div>
          </label>

          {/* Минимальный уровень силы маркеров */}
          {showImbalanceMarkers && (
            <div style={{ 
              padding: '12px',
              background: 'var(--bg-main)',
              borderRadius: '8px',
              border: '1px solid rgba(144, 238, 144, 0.3)',
            }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#90EE90', fontSize: '0.85rem', fontWeight: 500 }}>
                    💪 Минимальный уровень силы маркеров
                  </span>
                  <span style={{ 
                    color: '#90EE90',
                    fontSize: '0.9rem',
                    fontWeight: 600,
                  }}>
                    {imbalanceMinStrength}%
                  </span>
                </div>
                <input
                  type="range"
                  min={70}
                  max={100}
                  step={10}
                  value={imbalanceMinStrength}
                  onChange={(e) => setImbalanceMinStrength(parseInt(e.target.value))}
                  style={{ 
                    width: '100%',
                    cursor: 'pointer',
                    accentColor: '#90EE90',
                    height: '8px',
                  }}
                />
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)',
                }}>
                  <span>70% (все)</span>
                  <span>80%</span>
                  <span>90%</span>
                  <span>100% (только максимум)</span>
                </div>
              </label>
            </div>
          )}

          {/* Легенда */}
          <div style={{ 
            padding: '12px',
            background: 'rgba(0, 212, 255, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(0, 212, 255, 0.2)',
          }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
              Как читать индикатор:
            </div>
            <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '12px', height: '12px', background: '#00d4ff', borderRadius: '2px' }} />
                <span style={{ color: 'var(--text-main)' }}>Тренд дисбаланса</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '12px', height: '3px', background: '#f0b90b', borderRadius: '2px' }} />
                <span style={{ color: 'var(--text-main)' }}>EMA (пунктир)</span>
              </div>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '8px' }}>
              📈 Растёт = покупатели сильнее<br/>
              📉 Падает = продавцы сильнее
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Модальное окно настроек Дисбаланса ликвидности
function LiquidityImbalanceSettingsModal({ 
  isOpen, 
  onClose 
}: { 
  isOpen: boolean; 
  onClose: () => void;
}) {
  const liquidityImbalanceDepthPercent = useTradingStore((state) => state.liquidityImbalanceDepthPercent);
  const setLiquidityImbalanceDepthPercent = useTradingStore((state) => state.setLiquidityImbalanceDepthPercent);
  const liquidityImbalanceShowLine = useTradingStore((state) => state.liquidityImbalanceShowLine);
  const setLiquidityImbalanceShowLine = useTradingStore((state) => state.setLiquidityImbalanceShowLine);
  
  if (!isOpen) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div 
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: '12px',
          padding: '20px',
          minWidth: '360px',
          maxWidth: '450px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: '20px',
          paddingBottom: '12px',
          borderBottom: '1px solid var(--border)',
        }}>
          <h3 style={{ 
            margin: 0, 
            color: '#089981', 
            fontSize: '1rem',
            fontWeight: 600,
          }}>
            ⚙️ Настройки Дисбаланса ликвидности
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: '4px',
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Глубина */}
          <div style={{ 
            padding: '12px',
            background: 'var(--bg-main)',
            borderRadius: '8px',
          }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Глубина (% от mid price)
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="range"
                  min={0.5}
                  max={3}
                  step={0.1}
                  value={liquidityImbalanceDepthPercent}
                  onChange={(e) => {
                    const newValue = parseFloat(e.target.value);
                    console.log('[LIQUIDITY_IMBALANCE] Слайдер изменен:', {
                      oldValue: liquidityImbalanceDepthPercent,
                      newValue,
                      eventValue: e.target.value,
                    });
                    setLiquidityImbalanceDepthPercent(newValue);
                  }}
                  style={{
                    flex: 1,
                    height: '6px',
                    background: 'var(--bg-main)',
                    borderRadius: '3px',
                    outline: 'none',
                  }}
                />
                <span style={{ 
                  minWidth: '50px', 
                  textAlign: 'right',
                  fontFamily: 'JetBrains Mono, monospace',
                  color: '#089981',
                  fontWeight: 600,
                }}>
                  {liquidityImbalanceDepthPercent.toFixed(1)}%
                </span>
              </div>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                fontSize: '0.7rem', 
                color: 'var(--text-muted)' 
              }}>
                <span>0.5%</span>
                <span>3%</span>
              </div>
            </label>
          </div>

          {/* Линия */}
          <div style={{ 
            padding: '12px',
            background: 'var(--bg-main)',
            borderRadius: '8px',
          }}>
            <label style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              cursor: 'pointer',
            }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                Линия
              </span>
              <input
                type="checkbox"
                checked={liquidityImbalanceShowLine}
                onChange={(e) => setLiquidityImbalanceShowLine(e.target.checked)}
                style={{
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer',
                }}
              />
            </label>
            <div style={{ 
              marginTop: '8px',
              fontSize: '0.75rem', 
              color: 'var(--text-muted)' 
            }}>
              Показывать нулевую линию и линию перевеса вместо гистограммы
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Tick200Chart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const barDeltaContainerRef = useRef<HTMLDivElement>(null);
  const cumulativeDeltaContainerRef = useRef<HTMLDivElement>(null);
  const imbalanceContainerRef = useRef<HTMLDivElement>(null);
  const bidAskHistogramContainerRef = useRef<HTMLDivElement>(null);
  const bigOrderHistogramContainerRef = useRef<HTMLDivElement>(null);
  const liquidityImbalanceContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const barDeltaChartRef = useRef<IChartApi | null>(null);
  const cumulativeDeltaChartRef = useRef<IChartApi | null>(null);
  const imbalanceChartRef = useRef<IChartApi | null>(null);
  const bidAskHistogramChartRef = useRef<IChartApi | null>(null);
  const liquidityImbalanceChartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const barDeltaSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const cumulativeDeltaLineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const cumulativeDeltaCandleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const cumulativeDeltaTrendSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const imbalanceTrendSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const imbalanceEmaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bidSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const askSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const bigOrderHistogramChartRef = useRef<IChartApi | null>(null);
  const bigOrderHistogramX1Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const bigOrderHistogramX2Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const bigOrderHistogramX3Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const bigOrderPressurePositiveRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const bigOrderPressureNegativeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const liquidityImbalanceSeriesRef = useRef<ISeriesApi<'Histogram'> | ISeriesApi<'Line'> | null>(null);
  const liquidityImbalanceHistogramPositiveRef = useRef<ISeriesApi<'Histogram'> | null>(null); // Гистограмма для положительных значений (синяя)
  const liquidityImbalanceHistogramNegativeRef = useRef<ISeriesApi<'Histogram'> | null>(null); // Гистограмма для отрицательных значений (желтая)
  const tickStreamRef = useRef<BinanceTickStream | BybitTickStream | null>(null);
  const depthStreamRef = useRef<BinanceDepthStream | BybitDepthStream | null>(null);
  
  // Хранение свечей и текущей формирующейся свечи
  const completedCandlesRef = useRef<TickCandle[]>([]);
  const currentCandleRef = useRef<TickCandle | null>(null);
  const currentTicksRef = useRef<TickData[]>([]);
  const currentPairRef = useRef<string | null>(null);
  // Маппинг времени свечи (индекс) -> реальное время для timeFormatter
  const timeToRealTimeMapRef = useRef<Map<number, number>>(new Map());
  
  const [tickCount, setTickCount] = useState(0);
  const tickCountRef = useRef(0); // Ref для быстрого доступа без ре-рендера
  const ticksPerCandle = 20;
  const [totalCandlesCount, setTotalCandlesCount] = useState(0); // Общее количество свечей в истории
  const pendingStoreUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cumulativeDeltaRef = useRef<number>(0); // Накопленная дельта
  const cumulativeImbalanceRef = useRef<number>(0); // Накопленный дисбаланс
  const lastImbalanceEmaRef = useRef<number>(0); // Последняя EMA дисбаланса
  const currentImbalanceRef = useRef<number>(0); // Текущий дисбаланс от depth stream
  const currentBidVolumeRef = useRef<number>(0); // Текущий объем бидов
  const currentAskVolumeRef = useRef<number>(0); // Текущий объем асков
  const currentLiquidityImbalanceRef = useRef<number>(0); // Текущий дисбаланс ликвидности
  const liquidityImbalanceDataRef = useRef<Array<{ time: Time; value: number }>>([]); // Данные для графика
  const previousLiquidityImbalanceRef = useRef<number>(0); // Предыдущее значение для отслеживания пересечения нуля (для линии)
  const lastDepthDataRef = useRef<OrderBookData | null>(null); // Последние данные depth stream для пересчета при изменении процента
  
  // Крупные лимитные ордера
  const bigOrdersCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bigOrdersRef = useRef<Array<{ price: number; volumeUsdt: number; side: 'bid' | 'ask' }>>([]);
  // Накопление по порогам x1, x2, x3 за текущую свечу (для гистограммы перевеса)
  const currentCandleBigOrderAccumulatorRef = useRef<{
    x1: { bid: number; ask: number };
    x2: { bid: number; ask: number };
    x3: { bid: number; ask: number };
  }>({ x1: { bid: 0, ask: 0 }, x2: { bid: 0, ask: 0 }, x3: { bid: 0, ask: 0 } });
  const bigOrderExcessDataRef = useRef<Array<{ time: Time; x1: number; x2: number; x3: number; pressure: number }>>([]);
  const bigOrderMarkersRef = useRef<Array<{ time: Time; side: 'bid' | 'ask'; volumeUsdt: number }>>([]);
  const lastBigOrderTimeRef = useRef<number>(0);
  /** Текущее давление из стакана (дисбаланс первых N уровней), обновляется при каждом depth — чтобы гистограмма показывала живое значение */
  const currentBigOrderPressureRef = useRef<number>(0);
  
  // State для отображения текущего дисбаланса
  const [currentImbalanceDisplay, setCurrentImbalanceDisplay] = useState<number>(0);
  // State для отображения текущего дисбаланса ликвидности
  const [currentLiquidityImbalanceDisplay, setCurrentLiquidityImbalanceDisplay] = useState<number>(0);
  
  // Маркеры силы imbalance для отрисовки на графике цены
  const imbalanceMarkersRef = useRef<Array<{time: Time; color: string; direction: 'long' | 'short'; strength?: number}>>([]);
  const updateAllMarkersRef = useRef<(() => void) | null>(null);
  
  // Refs для оптимизации производительности
  const pendingUpdateRef = useRef<number | null>(null);
  const lastCandleCountRef = useRef<number>(0);
  const lastMarkerUpdateTimeRef = useRef<number>(0);
  const cachedTrendDataRef = useRef<{ time: Time; value: number; color: string }[] | null>(null);
  const cachedTrendDataLengthRef = useRef<number>(0);
  
  // Ref для отслеживания видимого диапазона (для подгрузки свечей при скролле)
  const visibleRangeRef = useRef<{ from: number; to: number } | null>(null);
  const lastRenderedRangeRef = useRef<{ from: number; to: number } | null>(null);
  // Текущее загруженное окно данных (для виртуализации)
  const loadedWindowRef = useRef<{ from: number; to: number } | null>(null);
  // Debounce таймер для подгрузки данных
  const loadDataDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs для панелей (для ресайза)
  const barDeltaPanelRef = useRef<HTMLDivElement>(null);
  const cumulativeDeltaPanelRef = useRef<HTMLDivElement>(null);
  const imbalancePanelRef = useRef<HTMLDivElement>(null);
  const bidAskHistogramPanelRef = useRef<HTMLDivElement>(null);
  const bigOrderHistogramPanelRef = useRef<HTMLDivElement>(null);
  const liquidityImbalancePanelRef = useRef<HTMLDivElement>(null);

  const { 
    selectedPair, 
    isLoadingTick200, 
    setIsLoadingTick200,
    showBarDeltaTick100,
    showCumulativeDeltaTick100,
    showImbalanceTrend,
    showBidAskHistogram,
    imbalanceLevels,
    imbalanceEmaPeriod,
    imbalanceMultiplier,
    showImbalanceEma,
    imbalanceHeatMap,
    showImbalanceMarkers,
    imbalanceMinStrength,
    setTick200ChartData,
    // ОПТИМИЗАЦИЯ: убран addTick - TickerSpeedIndicator имеет собственный tick stream
    // Настройки КД для 200-тикового графика
    showCumulativeDeltaTrendTick200,
    cumulativeDeltaTrendPeriodTick200,
    cumulativeDeltaTrendOffsetTick200,
    cumulativeDeltaDisplayModeTick200,
    showLiquidityImbalance,
    liquidityImbalanceDepthPercent,
    liquidityImbalanceShowLine,
    setShowLiquidityImbalance,
    setLiquidityImbalanceDepthPercent,
    // Крупные лимитные ордера
    showBigOrders,
    bigOrderMultiplier,
    setShowBigOrders,
    setBigOrderMultiplier,
  } = useTradingStore();
  
  // Ref для процента глубины (для обновления на лету без переподключения WebSocket)
  const liquidityImbalanceDepthPercentRef = useRef<number>(liquidityImbalanceDepthPercent);
  
  // State для модального окна настроек КД
  const [isCDSettingsOpen, setIsCDSettingsOpen] = useState(false);
  // State для модального окна настроек Imbalance
  const [isImbalanceSettingsOpen, setIsImbalanceSettingsOpen] = useState(false);
  // State для модального окна настроек Liquidity Imbalance
  const [isLiquidityImbalanceSettingsOpen, setIsLiquidityImbalanceSettingsOpen] = useState(false);
  const [tickChartError, setTickChartError] = useState<string | null>(null);
  const hasReceivedTickRef = useRef(false);
  const noDataTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Инструменты рисования
  const {
    activeTool,
    setActiveTool,
    drawings,
    clearAllDrawings,
  } = useDrawingTools({
    chartRef: chartRef as React.RefObject<IChartApi | null>,
    seriesRef: seriesRef as React.RefObject<ISeriesApi<'Candlestick'> | null>,
    containerRef: chartContainerRef,
  });

  // Функция принудительного обновления размеров всех графиков
  const resizeAllCharts = useCallback(() => {
    // Основной график
    if (chartRef.current && chartContainerRef.current) {
      const rect = chartContainerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        chartRef.current.applyOptions({ width: rect.width, height: rect.height });
      }
    }
    // График побарной дельты
    if (barDeltaChartRef.current && barDeltaContainerRef.current) {
      const rect = barDeltaContainerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        barDeltaChartRef.current.applyOptions({ width: rect.width, height: rect.height });
      }
    }
    // График кумулятивной дельты
    if (cumulativeDeltaChartRef.current && cumulativeDeltaContainerRef.current) {
      const rect = cumulativeDeltaContainerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        cumulativeDeltaChartRef.current.applyOptions({ width: rect.width, height: rect.height });
      }
    }
    // График imbalance
    if (imbalanceChartRef.current && imbalanceContainerRef.current) {
      const rect = imbalanceContainerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        imbalanceChartRef.current.applyOptions({ width: rect.width, height: rect.height });
      }
    }
    // График bid-ask гистограммы
    if (bidAskHistogramChartRef.current && bidAskHistogramContainerRef.current) {
      const rect = bidAskHistogramContainerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        bidAskHistogramChartRef.current.applyOptions({ width: rect.width, height: rect.height });
      }
    }
    // Гистограмма перевеса крупных ордеров
    if (bigOrderHistogramChartRef.current && bigOrderHistogramContainerRef.current) {
      const rect = bigOrderHistogramContainerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        bigOrderHistogramChartRef.current.applyOptions({ width: rect.width, height: rect.height });
      }
    }
    // График дисбаланса ликвидности
    if (liquidityImbalanceChartRef.current && liquidityImbalanceContainerRef.current) {
      const rect = liquidityImbalanceContainerRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        liquidityImbalanceChartRef.current.applyOptions({ width: rect.width, height: rect.height });
      }
    }
  }, []);

  // Обработчик ресайза панели с учётом всех видимых панелей
  const handlePanelResize = useCallback((e: React.MouseEvent<HTMLDivElement>, panelRef: React.RefObject<HTMLDivElement | null>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const panel = panelRef.current;
    const mainChart = chartContainerRef.current;
    const container = mainChart?.parentElement;
    if (!panel || !mainChart || !container) return;
    
    const startY = e.clientY;
    const startPanelHeight = panel.offsetHeight;
    const startChartHeight = mainChart.offsetHeight;
    const containerHeight = container.clientHeight;
    
    // Подсчитываем высоту всех остальных панелей (кроме текущей и основного графика)
    const getOtherPanelsHeight = () => {
      let otherHeight = 0;
      const panels = [barDeltaPanelRef, cumulativeDeltaPanelRef, imbalancePanelRef, bidAskHistogramPanelRef, bigOrderHistogramPanelRef, liquidityImbalancePanelRef];
      panels.forEach(ref => {
        if (ref.current && ref !== panelRef) {
          otherHeight += ref.current.offsetHeight;
        }
      });
      return otherHeight;
    };
    
    const otherPanelsHeight = getOtherPanelsHeight();
    const minChartHeight = 150;
    const minPanelHeight = 80;
    
    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      
      // Тянем вверх (delta < 0) → панель растёт, график сжимается
      let newPanelHeight = startPanelHeight - delta;
      let newChartHeight = startChartHeight + delta;
      
      // Ограничиваем минимальную высоту панели
      newPanelHeight = Math.max(minPanelHeight, newPanelHeight);
      
      // Ограничиваем минимальную высоту основного графика
      newChartHeight = Math.max(minChartHeight, newChartHeight);
      
      // Проверяем, что суммарная высота не превышает контейнер
      const totalHeight = newPanelHeight + newChartHeight + otherPanelsHeight;
      if (totalHeight > containerHeight) {
        // Пересчитываем максимальную высоту панели
        const maxPanelHeight = containerHeight - minChartHeight - otherPanelsHeight;
        newPanelHeight = Math.min(newPanelHeight, maxPanelHeight);
        newChartHeight = containerHeight - newPanelHeight - otherPanelsHeight;
      }
      
      // Дополнительная проверка на неотрицательные значения
      if (newPanelHeight < minPanelHeight || newChartHeight < minChartHeight) return;
      
      panel.style.height = newPanelHeight + 'px';
      panel.style.flex = 'none';
      mainChart.style.height = newChartHeight + 'px';
      mainChart.style.flex = 'none';
      
      // Принудительно обновляем размеры всех графиков для масштабирования
      requestAnimationFrame(resizeAllCharts);
    };
    
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // Финальное обновление размеров после завершения ресайза
      requestAnimationFrame(resizeAllCharts);
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [resizeAllCharts]);

  // ОПТИМИЗИРОВАННАЯ: Обновление маркеров с кешированием и ограничением
  const updateAllMarkers = useCallback(() => {
    if (!seriesRef.current) return;
    
    const allMarkers: any[] = [];
    
    // Ограничиваем количество маркеров для отображения (последние 1000)
    const MAX_MARKERS = 1000;
    
    // Маркеры imbalance (если настройка включена)
    // Получаем актуальные значения из store (не из замыкания)
    const storeState = useTradingStore.getState();
    const currentShowImbalanceMarkers = storeState.showImbalanceMarkers;
    const currentMinStrength = storeState.imbalanceMinStrength;
    
    if (currentShowImbalanceMarkers) {
      // Ограничиваем и фильтруем маркеры imbalance
      const displayImbalanceMarkers = imbalanceMarkersRef.current.slice(-MAX_MARKERS);
      const filteredMarkers = displayImbalanceMarkers.filter((m) => (m.strength || 0) >= currentMinStrength);
      filteredMarkers.forEach((m) => {
        allMarkers.push({
          time: m.time,
          position: m.direction === 'long' ? 'belowBar' as const : 'aboveBar' as const,
          color: m.color,
          shape: m.direction === 'long' ? 'arrowUp' as const : 'arrowDown' as const,
          size: 1,
        });
      });
    }
    
    // Маркеры крупных ордеров (если настройка включена)
    const currentShowBigOrders = storeState.showBigOrders;
    if (currentShowBigOrders) {
      const displayBigOrderMarkers = bigOrderMarkersRef.current.slice(-MAX_MARKERS);
      displayBigOrderMarkers.forEach((m) => {
        allMarkers.push({
          time: m.time,
          position: m.side === 'bid' ? 'belowBar' as const : 'aboveBar' as const,
          color: m.side === 'bid' ? '#3b82f6' : '#ef4444', // Синий для bid, красный для ask
          shape: m.side === 'bid' ? 'arrowUp' as const : 'arrowDown' as const,
          size: 2, // Крупнее чем imbalance маркеры
          text: formatVolumeUsdt(m.volumeUsdt),
        });
      });
    }
    
    // Сортируем маркеры по времени (требование lightweight-charts)
    allMarkers.sort((a, b) => (a.time as number) - (b.time as number));
    
    try {
      seriesRef.current.setMarkers(allMarkers);
    } catch (e) {
      // Ignore marker errors
    }
  }, []);
  
  // Сохраняем функцию в ref для использования в updateChart
  updateAllMarkersRef.current = updateAllMarkers;


  // Создать свечу из тиков с расчетом дельты и imbalance
  const createCandleFromTicks = (ticks: TickData[], addToCumulative = false, index?: number): TickCandle | null => {
    if (ticks.length === 0) return null;
    
    const prices = ticks.map(t => t.price);
    const volumes = ticks.map(t => t.volume);
    
    // Берём время последнего тика (в миллисекундах)
    const lastTickTime = ticks[ticks.length - 1].time;
    
    // Рассчитываем побарную дельту: buy volume - sell volume
    // isBuyerMaker = true означает продажу (sell), false - покупку (buy)
    let barDelta = 0;
    ticks.forEach(tick => {
      const deltaVolume = tick.isBuyerMaker ? -tick.volume : tick.volume;
      barDelta += deltaVolume;
    });
    
    // Обновляем кумулятивную дельту
    if (addToCumulative) {
      cumulativeDeltaRef.current += barDelta;
      // Рассчитываем EMA для imbalance (imbalance уже накапливается непрерывно в handleDepthUpdate)
      lastImbalanceEmaRef.current = calculateEMA(
        cumulativeImbalanceRef.current,
        lastImbalanceEmaRef.current,
        imbalanceEmaPeriod
      );
      candleIndexCounter++;
    }
    
    return {
      time: index !== undefined ? index : candleIndexCounter,
      realTime: lastTickTime,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
      volume: volumes.reduce((a, b) => a + b, 0),
      tickCount: ticks.length,
      barDelta,
      cumulativeDelta: cumulativeDeltaRef.current,
      imbalanceTrend: cumulativeImbalanceRef.current,
      imbalanceEma: lastImbalanceEmaRef.current,
      currentImbalance: currentImbalanceRef.current, // Текущий imbalance для маркеров
      bidVolume: currentBidVolumeRef.current, // Объем бидов для свечи
      askVolume: currentAskVolumeRef.current, // Объем асков для свечи
    };
  };

  // ОПТИМИЗИРОВАННАЯ: Обновить график с батчингом и ограничением видимых свечей
  const updateChart = useCallback((fitContent = false, forceFullUpdate = false) => {
    if (!seriesRef.current || !chartRef.current) return;

    // ВИРТУАЛИЗАЦИЯ: Загружаем большое окно вокруг видимой области
    // Это позволяет хранить ВСЮ историю в памяти, но рендерить только нужную часть
    const MAX_RENDER_WINDOW = 10000; // Максимум свечей в одном рендере
    const BUFFER_SIZE = 2000; // Буфер с каждой стороны видимой области
    const completedCandles = completedCandlesRef.current;
    
    let startIndex: number;
    let candlesToRender: TickCandle[];

    if (completedCandles.length <= MAX_RENDER_WINDOW) {
      // Если свечей мало - рендерим все
      candlesToRender = completedCandles;
      startIndex = 0;
    } else if (visibleRangeRef.current) {
      // Есть информация о видимом диапазоне - умная виртуализация
      const visibleRange = visibleRangeRef.current;
      // Преобразуем logical range в индексы: time = index + 1, значит index = time - 1
      const fromIndex = Math.max(0, Math.floor(visibleRange.from) - 1);
      const toIndex = Math.min(completedCandles.length - 1, Math.ceil(visibleRange.to) - 1);
      
      // Проверяем, входит ли видимый диапазон в уже загруженное окно
      const currentWindow = loadedWindowRef.current;
      const needsReload = !currentWindow || 
        fromIndex < currentWindow.from + BUFFER_SIZE / 2 || // Приближаемся к левому краю
        toIndex > currentWindow.to - BUFFER_SIZE / 2; // Приближаемся к правому краю
      
      if (needsReload || forceFullUpdate) {
        // Вычисляем новое окно с центром на видимой области
        const visibleCenter = Math.floor((fromIndex + toIndex) / 2);
        const halfWindow = Math.floor(MAX_RENDER_WINDOW / 2);
        
        let windowStart = Math.max(0, visibleCenter - halfWindow);
        let windowEnd = Math.min(completedCandles.length, windowStart + MAX_RENDER_WINDOW);
        
        // Корректируем, если упёрлись в конец
        if (windowEnd === completedCandles.length && windowEnd - windowStart < MAX_RENDER_WINDOW) {
          windowStart = Math.max(0, windowEnd - MAX_RENDER_WINDOW);
        }
        
        candlesToRender = completedCandles.slice(windowStart, windowEnd);
        startIndex = windowStart;
        loadedWindowRef.current = { from: windowStart, to: windowEnd };
      } else {
        // Используем текущее окно
        candlesToRender = completedCandles.slice(currentWindow.from, currentWindow.to);
        startIndex = currentWindow.from;
      }
    } else {
      // Нет информации о видимом диапазоне - показываем последние свечи
      const windowStart = Math.max(0, completedCandles.length - MAX_RENDER_WINDOW);
      candlesToRender = completedCandles.slice(windowStart);
      startIndex = windowStart;
      loadedWindowRef.current = { from: windowStart, to: completedCandles.length };
    }

    // Проверяем, нужен ли полный пересчет
    const currentCandleCount = completedCandles.length;
    const needsFullUpdate = forceFullUpdate || 
      currentCandleCount === 0 || 
      Math.abs(currentCandleCount - lastCandleCountRef.current) > 1 ||
      lastCandleCountRef.current === 0;

    const allCandles: CandlestickData[] = [];
    const barDeltaData: { time: Time; value: number; color?: string }[] = [];
    const cumulativeDeltaLineData: { time: Time; value: number }[] = [];
    const cumulativeDeltaCandleData: CandlestickData[] = [];
    const imbalanceTrendData: { time: Time; value: number }[] = [];
    const imbalanceEmaData: { time: Time; value: number }[] = [];
    
    let prevCumulativeDelta = startIndex > 0 ? completedCandles[startIndex - 1].cumulativeDelta : 0;
    
    // Добавляем видимые завершенные свечи
    candlesToRender.forEach((candle, localIndex) => {
      const index = startIndex + localIndex;
      const time = (index + 1) as Time;
      allCandles.push({
        time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });
      
      barDeltaData.push({
        time,
        value: candle.barDelta,
        color: candle.barDelta >= 0 ? '#089981' : '#f2385a',
      });
      
      cumulativeDeltaLineData.push({
        time,
        value: candle.cumulativeDelta,
      });
      
      const cdOpen = prevCumulativeDelta;
      const cdClose = candle.cumulativeDelta;
      prevCumulativeDelta = cdClose;
      
      cumulativeDeltaCandleData.push({
        time,
        open: cdOpen,
        high: Math.max(cdOpen, cdClose),
        low: Math.min(cdOpen, cdClose),
        close: cdClose,
      });
      
      imbalanceTrendData.push({
        time,
        value: candle.imbalanceTrend,
      });
      
      imbalanceEmaData.push({
        time,
        value: candle.imbalanceEma,
      });
    });

    // Данные для bid-ask гистограммы
    const bidData: { time: Time; value: number; color: string }[] = [];
    const askData: { time: Time; value: number; color: string }[] = [];
    
    // Данные для дисбаланса ликвидности
    const liquidityImbalanceData: { time: Time; value: number; color: string }[] = [];
    
    candlesToRender.forEach((candle, localIndex) => {
      const index = startIndex + localIndex;
      const time = (index + 1) as Time;
      const bidVolume = candle.bidVolume || 0;
      const askVolume = candle.askVolume || 0;
      
      bidData.push({
        time,
        value: bidVolume,
        color: '#089981', // Зеленый для бидов
      });
      
      askData.push({
        time,
        value: -askVolume, // Отрицательное значение для асков (ниже нуля)
        color: '#f2385a', // Красный для асков
      });
      
      // Данные для дисбаланса ликвидности (берем из сохраненных данных или 0)
      const savedData = liquidityImbalanceDataRef.current.find(d => d.time === time);
      const imbalanceValue = savedData?.value || 0;
      // Данные будут разделены на положительные и отрицательные при обновлении графика
      liquidityImbalanceData.push({
        time,
        value: imbalanceValue,
      });
    });

    // Добавляем текущую формирующуюся свечу
    if (currentCandleRef.current) {
      const candle = currentCandleRef.current;
      const time = (completedCandles.length + 1) as Time;
      allCandles.push({
        time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });
      
      barDeltaData.push({
        time,
        value: candle.barDelta,
        color: candle.barDelta >= 0 ? '#089981' : '#f2385a',
      });
      
      cumulativeDeltaLineData.push({
        time,
        value: candle.cumulativeDelta,
      });
      
      // Для текущей свечи используем ТЕКУЩИЕ значения imbalance (они накапливаются непрерывно)
      imbalanceTrendData.push({
        time,
        value: cumulativeImbalanceRef.current,
      });
      
      imbalanceEmaData.push({
        time,
        value: calculateEMA(cumulativeImbalanceRef.current, lastImbalanceEmaRef.current, imbalanceEmaPeriod),
      });
      
      // Данные для текущей свечи в bid-ask гистограмме
      const currentBidVolume = currentBidVolumeRef.current;
      const currentAskVolume = currentAskVolumeRef.current;
      
      bidData.push({
        time,
        value: currentBidVolume,
        color: '#089981',
      });
      
      askData.push({
        time,
        value: -currentAskVolume,
        color: '#f2385a',
      });
      
      // Данные для текущей свечи в дисбалансе ликвидности
      const currentValue = currentLiquidityImbalanceRef.current;
      // Данные будут разделены на положительные и отрицательные при обновлении графика
      liquidityImbalanceData.push({
        time,
        value: currentValue,
      });
    }

    // Данные перевеса x1, x2, x3 и давления крупных ордеров для гистограммы
    const bigOrderMap = new Map<Time, { x1: number; x2: number; x3: number; pressure: number }>();
    const arr = bigOrderExcessDataRef.current;
    if (barDeltaData.length > 0 && arr.length > 0) {
      const minT = barDeltaData[0].time as number;
      const maxT = barDeltaData[barDeltaData.length - 1].time as number;
      let lo = 0;
      let hi = arr.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((arr[mid].time as number) < minT) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < arr.length; i++) {
        const t = arr[i].time as number;
        if (t > maxT) break;
        const d = arr[i];
        bigOrderMap.set(d.time, { x1: d.x1, x2: d.x2, x3: d.x3, pressure: d.pressure ?? 0 });
      }
    }
    const bigOrderX1Data: { time: Time; value: number }[] = [];
    const bigOrderX2Data: { time: Time; value: number }[] = [];
    const bigOrderX3Data: { time: Time; value: number }[] = [];
    const bigOrderPressurePositiveData: { time: Time; value: number }[] = [];
    const bigOrderPressureNegativeData: { time: Time; value: number }[] = [];
    const currentCandleTimeForPressure = (completedCandlesRef.current.length + 1) as Time;
    barDeltaData.forEach(({ time }, index) => {
      const row = bigOrderMap.get(time) ?? { x1: 0, x2: 0, x3: 0, pressure: 0 };
      // Для текущей свечи используем живое давление из стакана (обновляется при каждом depth)
      const isCurrentCandle = (time as number) === (currentCandleTimeForPressure as number);
      const pressure = isCurrentCandle ? currentBigOrderPressureRef.current : row.pressure;
      bigOrderX1Data.push({ time, value: row.x1 });
      bigOrderX2Data.push({ time, value: row.x2 });
      bigOrderX3Data.push({ time, value: row.x3 });
      bigOrderPressurePositiveData.push({ time, value: pressure >= 0 ? pressure : 0 });
      bigOrderPressureNegativeData.push({ time, value: pressure < 0 ? pressure : 0 });
    });

    if (allCandles.length > 0) {
      try {
        // Адаптивный формат ценовой шкалы: учитываем средний размер свечи, чтобы между 2.06 и 2.08 были подписи
        if (needsFullUpdate || allCandles.length <= 1) {
          let dataHigh = -Infinity, dataLow = Infinity, sumBarRange = 0, barCount = 0;
          allCandles.forEach((c) => {
            if (isFinite(c.high)) dataHigh = Math.max(dataHigh, c.high);
            if (isFinite(c.low)) dataLow = Math.min(dataLow, c.low);
            if (isFinite(c.high) && isFinite(c.low)) { sumBarRange += c.high - c.low; barCount++; }
          });
          const avgBarRange = barCount > 0 ? sumBarRange / barCount : undefined;
          if (dataHigh > dataLow && seriesRef.current) {
            seriesRef.current.applyOptions({ priceFormat: getPriceFormatFromRange(dataHigh, dataLow, avgBarRange) });
          }
        }
        // Обновляем маппинг времени свечи -> реальное время
        timeToRealTimeMapRef.current.clear();
        candlesToRender.forEach((candle, localIndex) => {
          const index = startIndex + localIndex;
          const time = (index + 1) as Time;
          if (candle.realTime) {
            timeToRealTimeMapRef.current.set(time as number, candle.realTime);
          }
        });
        // Добавляем текущую формирующуюся свечу в маппинг
        if (currentCandleRef.current) {
          const totalCandles = completedCandlesRef.current.length;
          const currentCandleTime = (totalCandles + 1) as Time;
          if (currentCandleRef.current.realTime) {
            timeToRealTimeMapRef.current.set(currentCandleTime as number, currentCandleRef.current.realTime);
          }
        }
        
        
        // Используем setData только при полном обновлении, иначе update для последней свечи
        if (needsFullUpdate || allCandles.length <= 1) {
          seriesRef.current.setData(allCandles);
        } else {
          // Инкрементальное обновление: добавляем только последнюю свечу
          const lastCandle = allCandles[allCandles.length - 1];
          seriesRef.current.update(lastCandle);
          
          // Обновляем маппинг для последней свечи
          if (lastCandle.time && typeof lastCandle.time === 'number') {
            const candleIndex = lastCandle.time as number;
            // Ищем свечу в candlesToRender или currentCandle
            if (currentCandleRef.current && candleIndex === completedCandlesRef.current.length + 1) {
              if (currentCandleRef.current.realTime) {
                timeToRealTimeMapRef.current.set(candleIndex, currentCandleRef.current.realTime);
              }
            } else {
              const globalIndex = candleIndex - 1;
              if (globalIndex >= 0 && globalIndex < completedCandlesRef.current.length) {
                const candle = completedCandlesRef.current[globalIndex];
                if (candle && candle.realTime) {
                  timeToRealTimeMapRef.current.set(candleIndex, candle.realTime);
                }
              }
            }
          }
        }
        
        // Обновляем отдельные графики дельты
        if (barDeltaChartRef.current && barDeltaSeriesRef.current) {
          if (needsFullUpdate || barDeltaData.length <= 1) {
            barDeltaSeriesRef.current.setData(barDeltaData);
          } else {
            const lastBar = barDeltaData[barDeltaData.length - 1];
            barDeltaSeriesRef.current.update(lastBar);
          }
        }
        
        // Обновляем КД в зависимости от режима отображения
        if (cumulativeDeltaChartRef.current) {
          if (cumulativeDeltaCandleSeriesRef.current) {
            if (needsFullUpdate || cumulativeDeltaCandleData.length <= 1) {
              cumulativeDeltaCandleSeriesRef.current.setData(cumulativeDeltaCandleData);
            } else {
              const lastCandle = cumulativeDeltaCandleData[cumulativeDeltaCandleData.length - 1];
              cumulativeDeltaCandleSeriesRef.current.update(lastCandle);
            }
          }
          if (cumulativeDeltaLineSeriesRef.current) {
            if (needsFullUpdate || cumulativeDeltaLineData.length <= 1) {
              cumulativeDeltaLineSeriesRef.current.setData(cumulativeDeltaLineData);
            } else {
              const lastPoint = cumulativeDeltaLineData[cumulativeDeltaLineData.length - 1];
              cumulativeDeltaLineSeriesRef.current.update(lastPoint);
            }
          }
          
          // Оптимизация calculateCDTrend: пересчитываем только если данные изменились
          if (cumulativeDeltaTrendSeriesRef.current && cumulativeDeltaLineData.length > 0) {
            const shouldRecalculate = needsFullUpdate || 
              cumulativeDeltaLineData.length !== cachedTrendDataLengthRef.current;
            
            if (shouldRecalculate) {
              const trendData = calculateCDTrend(
                cumulativeDeltaLineData, 
                cumulativeDeltaTrendPeriodTick200, 
                cumulativeDeltaTrendOffsetTick200
              );
              cachedTrendDataRef.current = trendData;
              cachedTrendDataLengthRef.current = cumulativeDeltaLineData.length;
              cumulativeDeltaTrendSeriesRef.current.setData(trendData);
            } else if (cachedTrendDataRef.current && cachedTrendDataRef.current.length > 0) {
              // Обновляем только последнюю точку тренда
              const lastTrendPoint = cachedTrendDataRef.current[cachedTrendDataRef.current.length - 1];
              cumulativeDeltaTrendSeriesRef.current.update(lastTrendPoint);
            }
          }
        }
        
        // Обновляем график imbalance trend
        if (imbalanceChartRef.current && imbalanceTrendSeriesRef.current) {
          if (needsFullUpdate || imbalanceTrendData.length <= 1) {
            imbalanceTrendSeriesRef.current.setData(imbalanceTrendData);
          } else {
            const lastTrend = imbalanceTrendData[imbalanceTrendData.length - 1];
            imbalanceTrendSeriesRef.current.update(lastTrend);
          }
          
          if (imbalanceEmaSeriesRef.current) {
            if (needsFullUpdate || imbalanceEmaData.length <= 1) {
              imbalanceEmaSeriesRef.current.setData(imbalanceEmaData);
            } else {
              const lastEma = imbalanceEmaData[imbalanceEmaData.length - 1];
              imbalanceEmaSeriesRef.current.update(lastEma);
            }
          }
        }
        
        // Обновляем график bid-ask гистограммы
        if (bidAskHistogramChartRef.current && bidSeriesRef.current && askSeriesRef.current) {
          if (needsFullUpdate || bidData.length <= 1) {
            bidSeriesRef.current.setData(bidData);
            askSeriesRef.current.setData(askData);
          } else {
            const lastBid = bidData[bidData.length - 1];
            const lastAsk = askData[askData.length - 1];
            bidSeriesRef.current.update(lastBid);
            askSeriesRef.current.update(lastAsk);
          }
        }
        
        // Обновляем график дисбаланса ликвидности
        if (liquidityImbalanceChartRef.current) {
          // Читаем актуальное значение из store напрямую
          const currentLiquidityImbalanceShowLine = useTradingStore.getState().liquidityImbalanceShowLine;
          
          // Подготавливаем данные (сортировка и удаление дубликатов)
          // Создаем Map для удаления дубликатов (оставляем последнее значение для каждого времени)
          const timeMap = new Map<Time, number>();
          for (const point of liquidityImbalanceData) {
            timeMap.set(point.time, point.value);
          }
          
          // Преобразуем обратно в массив и сортируем по времени
          const uniqueData = Array.from(timeMap.entries())
            .map(([time, value]) => ({ time, value }))
            .sort((a, b) => (a.time as number) - (b.time as number));
          
          const lineData: { time: Time; value: number }[] = uniqueData;
          const positiveData: { time: Time; value: number }[] = [];
          const negativeData: { time: Time; value: number }[] = [];
          
          uniqueData.forEach(point => {
            if (point.value >= 0) {
              positiveData.push({ time: point.time, value: point.value });
            } else {
              negativeData.push({ time: point.time, value: point.value });
            }
          });
          
          if (currentLiquidityImbalanceShowLine && liquidityImbalanceSeriesRef.current) {
            // Для линии - используем подготовленные данные
            liquidityImbalanceSeriesRef.current.setData(lineData);
            // Принудительно обновляем ценовую шкалу
            if (liquidityImbalanceChartRef.current) {
              liquidityImbalanceChartRef.current.priceScale('right').applyOptions({
                autoScale: true,
              });
            }
          } else if (liquidityImbalanceHistogramPositiveRef.current && liquidityImbalanceHistogramNegativeRef.current) {
            // Для гистограммы - используем подготовленные данные
            if (needsFullUpdate || positiveData.length <= 1) {
              liquidityImbalanceHistogramPositiveRef.current.setData(positiveData);
            } else if (positiveData.length > 0) {
              liquidityImbalanceHistogramPositiveRef.current.update(positiveData[positiveData.length - 1]);
            }
            
            if (needsFullUpdate || negativeData.length <= 1) {
              liquidityImbalanceHistogramNegativeRef.current.setData(negativeData);
            } else if (negativeData.length > 0) {
              liquidityImbalanceHistogramNegativeRef.current.update(negativeData[negativeData.length - 1]);
            }
            // Принудительно обновляем ценовую шкалу для гистограмм
            if (liquidityImbalanceChartRef.current) {
              liquidityImbalanceChartRef.current.priceScale('right').applyOptions({
                autoScale: true,
              });
            }
          }
        }
        
        // Обновляем только гистограмму давления (покуп сверху, продаж снизу)
        if (bigOrderHistogramChartRef.current && bigOrderPressurePositiveRef.current && bigOrderPressureNegativeRef.current) {
          if (needsFullUpdate || bigOrderPressurePositiveData.length <= 1) {
            bigOrderPressurePositiveRef.current.setData(bigOrderPressurePositiveData);
            bigOrderPressureNegativeRef.current.setData(bigOrderPressureNegativeData);
          } else if (bigOrderPressurePositiveData.length > 0) {
            const last = bigOrderPressurePositiveData.length - 1;
            bigOrderPressurePositiveRef.current.update(bigOrderPressurePositiveData[last]);
            bigOrderPressureNegativeRef.current.update(bigOrderPressureNegativeData[last]);
          }
          bigOrderHistogramChartRef.current.priceScale('left').applyOptions({ autoScale: true });
        }
        
        // Обновляем счетчик свечей
        lastCandleCountRef.current = currentCandleCount;
        
        // Синхронизируем временную шкалу (только при необходимости)
        if (fitContent) {
          chartRef.current.timeScale().fitContent();
        }
        
        // Синхронизируем графики дельты с основным графиком (батчинг)
        const logicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
        if (logicalRange) {
          requestAnimationFrame(() => {
            if (barDeltaChartRef.current && chartRef.current) {
              try {
                const currentRange = chartRef.current.timeScale().getVisibleLogicalRange();
                if (currentRange) {
                  barDeltaChartRef.current.timeScale().setVisibleLogicalRange(currentRange);
                }
              } catch (e) {
                // Ignore
              }
            }
            if (cumulativeDeltaChartRef.current && chartRef.current) {
              try {
                const currentRange = chartRef.current.timeScale().getVisibleLogicalRange();
                if (currentRange) {
                  cumulativeDeltaChartRef.current.timeScale().setVisibleLogicalRange(currentRange);
                }
              } catch (e) {
                // Ignore
              }
            }
            if (imbalanceChartRef.current && chartRef.current) {
              try {
                const currentRange = chartRef.current.timeScale().getVisibleLogicalRange();
                if (currentRange) {
                  imbalanceChartRef.current.timeScale().setVisibleLogicalRange(currentRange);
                }
              } catch (e) {
                // Ignore
              }
            }
            if (bidAskHistogramChartRef.current && chartRef.current) {
              try {
                const currentRange = chartRef.current.timeScale().getVisibleLogicalRange();
                if (currentRange) {
                  bidAskHistogramChartRef.current.timeScale().setVisibleLogicalRange(currentRange);
                }
              } catch (e) {
                // Ignore
              }
            }
            if (bigOrderHistogramChartRef.current && chartRef.current) {
              try {
                const currentRange = chartRef.current.timeScale().getVisibleLogicalRange();
                if (currentRange) {
                  bigOrderHistogramChartRef.current.timeScale().setVisibleLogicalRange(currentRange);
                }
              } catch (e) {
                // Ignore
              }
            }
            if (liquidityImbalanceChartRef.current && chartRef.current) {
              try {
                const currentRange = chartRef.current.timeScale().getVisibleLogicalRange();
                if (currentRange) {
                  liquidityImbalanceChartRef.current.timeScale().setVisibleLogicalRange(currentRange);
                }
              } catch (e) {
                // Ignore
              }
            }
          });
        }
        
        // Обновляем маркеры реже (только при добавлении новой свечи с маркером)
        const now = Date.now();
        if (now - lastMarkerUpdateTimeRef.current > 100 || needsFullUpdate) {
          if (updateAllMarkersRef.current) {
            updateAllMarkersRef.current();
          }
          lastMarkerUpdateTimeRef.current = now;
        }
      } catch (error) {
        // При ошибке делаем полное обновление при следующем вызове
        lastCandleCountRef.current = 0;
      }
    }
  }, [imbalanceEmaPeriod, cumulativeDeltaTrendPeriodTick200, cumulativeDeltaTrendOffsetTick200]);

  // БАТЧИНГ: Обертка для updateChart с requestAnimationFrame
  const scheduleChartUpdate = useCallback((fitContent = false, forceFullUpdate = false) => {
    if (pendingUpdateRef.current !== null) {
      cancelAnimationFrame(pendingUpdateRef.current);
    }
    
    pendingUpdateRef.current = requestAnimationFrame(() => {
      updateChart(fitContent, forceFullUpdate);
      pendingUpdateRef.current = null;
    });
  }, [updateChart]);

  // Инициализация графика
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const initChart = () => {
      const container = chartContainerRef.current;
      if (!container) return;

      // Удаляем старый график если есть
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }

      const rect = container.getBoundingClientRect();
      const width = rect.width || container.clientWidth || 800;
      const height = rect.height || container.clientHeight || 600;

      if (width <= 0 || height <= 0) {
        setTimeout(initChart, 200);
        return;
      }

      try {
        const chart = createChart(container, {
          width,
          height,
          layout: {
            background: { color: '#0d1117' },
            textColor: '#c9d1d9',
          },
          grid: {
            vertLines: { color: 'rgba(48, 54, 61, 0.3)' },
            horzLines: { color: 'rgba(48, 54, 61, 0.3)' },
          },
          crosshair: {
            mode: CrosshairMode.Normal,
            vertLine: {
              color: '#758696',
              width: 1,
              style: 3,
              labelBackgroundColor: '#2B2B43',
            },
            horzLine: {
              color: '#758696',
              width: 1,
              style: 3,
              labelBackgroundColor: '#2B2B43',
            },
          },
          timeScale: {
            timeVisible: true,
            secondsVisible: false, // Как на основном графике - без секунд
            rightOffset: 12,
            barSpacing: 8,
            minBarSpacing: 0.1, // Позволяет очень сильно сжимать график
            fixLeftEdge: false,
            fixRightEdge: false,
            tickMarkFormatter: (time: number) => {
              // Ищем свечу по индексу и показываем её реальное время в UTC (без секунд, как на основном графике)
              const candle = completedCandlesRef.current[time - 1] || currentCandleRef.current;
              if (candle && candle.realTime) {
                // realTime хранится в секундах, нужно умножить на 1000 для миллисекунд
                const date = new Date(candle.realTime * 1000);
                return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
              }
              return `#${time}`;
            },
          },
          rightPriceScale: {
            scaleMargins: {
              top: 0.1,
              bottom: 0.1,
            },
          },
          handleScroll: {
            mouseWheel: true,
            pressedMouseMove: true,
            horzTouchDrag: true,
            vertTouchDrag: true,
          },
          handleScale: {
            axisPressedMouseMove: true,
            mouseWheel: true,
            pinch: true,
          },
          localization: {
            priceFormatter: formatPriceValue,
          },
        });

        const candlestickSeries = chart.addCandlestickSeries({
          upColor: '#089981',
          downColor: '#f2385a',
          borderVisible: false,
          wickUpColor: '#089981',
          wickDownColor: '#f2385a',
          priceFormat: {
            type: 'custom',
            formatter: formatPriceValue,
            minMove: 0.000001,
          },
        });

        chartRef.current = chart;
        seriesRef.current = candlestickSeries;

        // Обновляем timeFormatter после создания серии для доступа к актуальным данным
        // Используем setTimeout чтобы убедиться, что серия полностью инициализирована
        setTimeout(() => {
          if (chartRef.current) {
            chartRef.current.applyOptions({
              localization: {
                timeFormatter: (time: Time) => {
                  // Форматируем время crosshair как на основном графике (без секунд) - HH:MM
                  if (typeof time === 'number') {
                    // Для индексов свечей ищем реальное время
                    const candleIndex = Math.floor(time);
                    
                    // Сначала пробуем получить из маппинга
                    let realTime = timeToRealTimeMapRef.current.get(candleIndex);
                    
                    // Если не нашли в маппинге, пробуем получить данные из серии
                    if (!realTime && seriesRef.current) {
                      try {
                        const logicalIndex = candleIndex - 1;
                        const seriesData = seriesRef.current.dataByIndex(logicalIndex);
                        if (seriesData && typeof seriesData.time === 'number') {
                          // seriesData.time - это индекс времени (1-based)
                          const seriesTimeIndex = seriesData.time as number;
                          // Ищем свечу в completedCandles по этому индексу
                          const globalIndex = seriesTimeIndex - 1;
                          if (globalIndex >= 0 && globalIndex < completedCandlesRef.current.length) {
                            const candle = completedCandlesRef.current[globalIndex];
                            if (candle && candle.realTime) {
                              realTime = candle.realTime;
                              // Сохраняем в маппинг для будущего использования
                              timeToRealTimeMapRef.current.set(candleIndex, realTime);
                            }
                          }
                        }
                      } catch (e) {
                        // Игнорируем ошибки
                      }
                    }
                    
                    // Если все еще не нашли, ищем напрямую в completedCandles
                    if (!realTime) {
                      const globalIndex = candleIndex - 1;
                      if (globalIndex >= 0 && globalIndex < completedCandlesRef.current.length) {
                        const candle = completedCandlesRef.current[globalIndex];
                        if (candle && candle.realTime) {
                          realTime = candle.realTime;
                          timeToRealTimeMapRef.current.set(candleIndex, realTime);
                        }
                      }
                    }
                    
                    // Проверяем currentCandle для последней свечи
                    if (!realTime && currentCandleRef.current) {
                      const totalCandles = completedCandlesRef.current.length;
                      if (candleIndex === totalCandles + 1 && currentCandleRef.current.realTime) {
                        realTime = currentCandleRef.current.realTime;
                        timeToRealTimeMapRef.current.set(candleIndex, realTime);
                      }
                    }
                    
                    if (realTime) {
                      // realTime хранится в секундах (из TickData.time), нужно умножить на 1000 для миллисекунд
                      const date = new Date(realTime * 1000);
                      const formatted = `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
                      // Формат как на основном графике: HH:MM (без секунд)
                      return formatted;
                    }
                    
                    // Если не нашли, возвращаем индекс
                    return `#${candleIndex}`;
                  } else if (time && typeof time === 'object' && 'year' in time) {
                    // Для объектов времени (UTC) - формат без секунд
                    const hours = (time.hour ?? 0).toString().padStart(2, '0');
                    const minutes = (time.minute ?? 0).toString().padStart(2, '0');
                    return `${hours}:${minutes}`;
                  }
                  // Fallback
                  return String(time);
                },
              },
            });
          }
        }, 0);

        const resizeObserver = new ResizeObserver(() => {
          if (container && chartRef.current) {
            const newRect = container.getBoundingClientRect();
            const newWidth = newRect.width || container.clientWidth;
            const newHeight = newRect.height || container.clientHeight;
            if (newWidth > 0 && newHeight > 0) {
              chartRef.current.applyOptions({ width: newWidth, height: newHeight });
            }
          }
        });

        resizeObserver.observe(container);

        return () => {
          resizeObserver.disconnect();
        };
      } catch (error) {
        // Ignore chart initialization errors
      }
    };

    const timeoutId = setTimeout(initChart, 100);

    return () => {
      clearTimeout(timeoutId);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      seriesRef.current = null;
    };
  }, []);

  // Форматирование цены для шкалы (адаптивная точность)
  const formatPriceValue = (price: number): string => {
    if (!isFinite(price)) return '';
    const absPrice = Math.abs(price);
    if (absPrice < 0.0001) return price.toFixed(8);
    if (absPrice < 0.01) return price.toFixed(6);
    if (absPrice < 1) return price.toFixed(6);
    if (absPrice < 100) return price.toFixed(4);
    if (absPrice < 10000) return price.toFixed(2);
    return price.toFixed(0);
  };

  // Форматирование чисел для шкалы дельты
  const formatDeltaValue = (value: number): string => {
    const absValue = Math.abs(value);
    if (absValue >= 1000000) {
      return (value / 1000000).toFixed(1) + 'M';
    } else if (absValue >= 1000) {
      return (value / 1000).toFixed(1) + 'K';
    }
    return value.toFixed(2);
  };

  // Отрисовка линий крупных лимитных ордеров
  const drawBigOrders = useCallback(() => {
    const canvas = bigOrdersCanvasRef.current;
    const chart = chartRef.current;
    const series = seriesRef.current;
    const container = chartContainerRef.current;
    
    if (!canvas || !chart || !series || !container) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Обновляем размер canvas
    const rect = container.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
    
    // Очищаем canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const bigOrders = bigOrdersRef.current;
    if (bigOrders.length === 0) return;
    
    bigOrders.forEach(order => {
      // Получаем Y координату для цены
      const y = series.priceToCoordinate(order.price);
      if (y === null) return;
      
      // Цвета: синий для bid (покупка), красный для ask (продажа)
      const color = order.side === 'bid' ? '#3b82f6' : '#ef4444';
      const bgColor = order.side === 'bid' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(239, 68, 68, 0.15)';
      
      // Рисуем полупрозрачный фон линии
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, y - 10, canvas.width - 60, 20);
      
      // Рисуем пунктирную линию
      ctx.beginPath();
      ctx.setLineDash([5, 3]);
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width - 60, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Рисуем метку с объёмом справа
      const label = formatVolumeUsdt(order.volumeUsdt);
      ctx.font = 'bold 11px Arial';
      const textWidth = ctx.measureText(label).width;
      
      // Фон метки
      const labelX = canvas.width - 58;
      const labelY = y - 8;
      const labelHeight = 16;
      const labelPadding = 4;
      
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(labelX, labelY, textWidth + labelPadding * 2, labelHeight, 3);
      ctx.fill();
      
      // Текст метки
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, labelX + labelPadding, y);
    });
  }, []);

  // Инициализация графика побарной дельты
  useEffect(() => {
    if (!barDeltaContainerRef.current || !showBarDeltaTick100) {
      if (barDeltaChartRef.current) {
        barDeltaChartRef.current.remove();
        barDeltaChartRef.current = null;
        barDeltaSeriesRef.current = null;
      }
      return;
    }

    const initChart = () => {
      const container = barDeltaContainerRef.current;
      if (!container || !chartRef.current) {
        setTimeout(initChart, 200);
        return;
      }

      if (barDeltaChartRef.current) {
        barDeltaChartRef.current.remove();
        barDeltaChartRef.current = null;
        barDeltaSeriesRef.current = null;
      }

      const rect = container.getBoundingClientRect();
      const width = rect.width || container.clientWidth || 800;
      const height = rect.height || container.clientHeight || 120;

      if (width <= 0 || height <= 0) {
        setTimeout(initChart, 200);
        return;
      }

      try {
        const mainTimeScaleOptions = chartRef.current.timeScale().options();
        
        const chart = createChart(container, {
          width,
          height,
          layout: {
            background: { color: '#0d1117' },
            textColor: '#c9d1d9',
          },
          grid: {
            vertLines: { color: 'rgba(48, 54, 61, 0.3)' },
            horzLines: { color: 'rgba(48, 54, 61, 0.3)' },
          },
          crosshair: {
            horzLine: { visible: false }, // Только вертикальная линия
          },
          timeScale: {
            visible: false, // Скрываем временную шкалу
            rightOffset: mainTimeScaleOptions.rightOffset,
            barSpacing: mainTimeScaleOptions.barSpacing,
            minBarSpacing: mainTimeScaleOptions.minBarSpacing,
          },
          rightPriceScale: {
            scaleMargins: { top: 0.1, bottom: 0.1 },
          },
          localization: {
            priceFormatter: formatDeltaValue,
          },
          handleScroll: false,
          handleScale: false,
        });

        const barDeltaSeries = chart.addHistogramSeries({
          priceFormat: {
            type: 'custom',
            formatter: formatDeltaValue,
          },
        });

        barDeltaChartRef.current = chart;
        barDeltaSeriesRef.current = barDeltaSeries;

        // Синхронизируем с основным графиком
        const syncTimeScale = () => {
          if (chartRef.current && barDeltaChartRef.current) {
            const logicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
            if (logicalRange) {
              barDeltaChartRef.current.timeScale().setVisibleLogicalRange(logicalRange);
            }
          }
        };

        if (completedCandlesRef.current.length > 0) {
          scheduleChartUpdate(false, true); // forceFullUpdate = true при инициализации
          syncTimeScale();
          // Повторная синхронизация с задержкой для гарантии
          setTimeout(syncTimeScale, 100);
        }

        const resizeObserver = new ResizeObserver(() => {
          if (container && barDeltaChartRef.current) {
            const newRect = container.getBoundingClientRect();
            const newWidth = newRect.width || container.clientWidth;
            const newHeight = newRect.height || container.clientHeight;
            if (newWidth > 0 && newHeight > 0) {
              barDeltaChartRef.current.applyOptions({ width: newWidth, height: newHeight });
            }
          }
        });

        resizeObserver.observe(container);

        return () => {
          resizeObserver.disconnect();
        };
      } catch (error) {
        // Ignore bar delta chart initialization errors
      }
    };

    const timeoutId = setTimeout(initChart, 200);

    return () => {
      clearTimeout(timeoutId);
      if (barDeltaChartRef.current) {
        barDeltaChartRef.current.remove();
        barDeltaChartRef.current = null;
      }
      barDeltaSeriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBarDeltaTick100]);

  // Инициализация графика кумулятивной дельты
  useEffect(() => {
    if (!cumulativeDeltaContainerRef.current || !showCumulativeDeltaTick100) {
      if (cumulativeDeltaChartRef.current) {
        cumulativeDeltaChartRef.current.remove();
        cumulativeDeltaChartRef.current = null;
        cumulativeDeltaLineSeriesRef.current = null;
        cumulativeDeltaCandleSeriesRef.current = null;
      }
      return;
    }

    const initChart = () => {
      const container = cumulativeDeltaContainerRef.current;
      if (!container || !chartRef.current) {
        setTimeout(initChart, 200);
        return;
      }

      if (cumulativeDeltaChartRef.current) {
        cumulativeDeltaChartRef.current.remove();
        cumulativeDeltaChartRef.current = null;
        cumulativeDeltaLineSeriesRef.current = null;
        cumulativeDeltaCandleSeriesRef.current = null;
      }

      const rect = container.getBoundingClientRect();
      const width = rect.width || container.clientWidth || 800;
      const height = rect.height || container.clientHeight || 120;

      if (width <= 0 || height <= 0) {
        setTimeout(initChart, 200);
        return;
      }

      try {
        const mainTimeScaleOptions = chartRef.current.timeScale().options();
        
        const chart = createChart(container, {
          width,
          height,
          layout: {
            background: { color: '#0d1117' },
            textColor: '#c9d1d9',
          },
          grid: {
            vertLines: { color: 'rgba(48, 54, 61, 0.3)' },
            horzLines: { color: 'rgba(48, 54, 61, 0.3)' },
          },
          crosshair: {
            horzLine: { visible: false }, // Только вертикальная линия
          },
          timeScale: {
            visible: false, // Скрываем временную шкалу
            rightOffset: mainTimeScaleOptions.rightOffset,
            barSpacing: mainTimeScaleOptions.barSpacing,
            minBarSpacing: mainTimeScaleOptions.minBarSpacing,
          },
          rightPriceScale: {
            scaleMargins: { top: 0.1, bottom: 0.1 },
          },
          localization: {
            priceFormatter: formatDeltaValue,
          },
          handleScroll: false,
          handleScale: false,
        });

        cumulativeDeltaChartRef.current = chart;
        
        // Создаём серию в зависимости от режима отображения
        if (cumulativeDeltaDisplayModeTick200 === 'candle') {
          const candleSeries = chart.addCandlestickSeries({
            upColor: '#089981',
            downColor: '#f2385a',
            borderVisible: false,
            wickUpColor: '#089981',
            wickDownColor: '#f2385a',
            priceFormat: {
              type: 'custom',
              formatter: formatDeltaValue,
            },
          });
          cumulativeDeltaCandleSeriesRef.current = candleSeries;
        } else {
          const lineSeries = chart.addLineSeries({
            color: '#f0b90b',
            lineWidth: 2,
            priceFormat: {
              type: 'custom',
              formatter: formatDeltaValue,
            },
          });
          cumulativeDeltaLineSeriesRef.current = lineSeries;
        }
        
        // Добавляем линию тренда если включена
        if (showCumulativeDeltaTrendTick200) {
          const trendSeries = chart.addLineSeries({
            color: '#3fb950',
            lineWidth: 2,
            lastValueVisible: true,
            priceLineVisible: false,
            crosshairMarkerVisible: false,
            priceFormat: {
              type: 'custom',
              formatter: formatDeltaValue,
            },
          });
          cumulativeDeltaTrendSeriesRef.current = trendSeries;
        }

        // Синхронизируем с основным графиком
        const syncTimeScale = () => {
          if (chartRef.current && cumulativeDeltaChartRef.current) {
            const logicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
            if (logicalRange) {
              cumulativeDeltaChartRef.current.timeScale().setVisibleLogicalRange(logicalRange);
            }
          }
        };

        if (completedCandlesRef.current.length > 0) {
          scheduleChartUpdate(false, true); // forceFullUpdate = true при инициализации
          syncTimeScale();
          // Повторная синхронизация с задержкой для гарантии
          setTimeout(syncTimeScale, 100);
        }

        const resizeObserver = new ResizeObserver(() => {
          if (container && cumulativeDeltaChartRef.current) {
            const newRect = container.getBoundingClientRect();
            const newWidth = newRect.width || container.clientWidth;
            const newHeight = newRect.height || container.clientHeight;
            if (newWidth > 0 && newHeight > 0) {
              cumulativeDeltaChartRef.current.applyOptions({ width: newWidth, height: newHeight });
            }
          }
        });

        resizeObserver.observe(container);

        return () => {
          resizeObserver.disconnect();
        };
      } catch (error) {
        // Ignore cumulative delta chart initialization errors
      }
    };

    const timeoutId = setTimeout(initChart, 200);

    return () => {
      clearTimeout(timeoutId);
      if (cumulativeDeltaChartRef.current) {
        cumulativeDeltaChartRef.current.remove();
        cumulativeDeltaChartRef.current = null;
      }
      cumulativeDeltaLineSeriesRef.current = null;
      cumulativeDeltaCandleSeriesRef.current = null;
      cumulativeDeltaTrendSeriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCumulativeDeltaTick100, cumulativeDeltaDisplayModeTick200, showCumulativeDeltaTrendTick200]);

  // Инициализация графика Imbalance Trend (как кумулятивная дельта)
  useEffect(() => {
    console.log('[Tick200Chart] Imbalance Trend useEffect triggered:', {
      hasContainer: !!imbalanceContainerRef.current,
      showImbalanceTrend,
      hasChart: !!imbalanceChartRef.current,
      hasSeries: !!imbalanceTrendSeriesRef.current
    });
    
    if (!imbalanceContainerRef.current || !showImbalanceTrend) {
      console.log('[Tick200Chart] Imbalance Trend chart not initialized:', {
        hasContainer: !!imbalanceContainerRef.current,
        showImbalanceTrend
      });
      if (imbalanceChartRef.current) {
        imbalanceChartRef.current.remove();
        imbalanceChartRef.current = null;
        imbalanceTrendSeriesRef.current = null;
        imbalanceEmaSeriesRef.current = null;
      }
      return;
    }

    const initChart = () => {
      const container = imbalanceContainerRef.current;
      if (!container || !chartRef.current) {
        setTimeout(initChart, 200);
        return;
      }

      if (imbalanceChartRef.current) {
        imbalanceChartRef.current.remove();
        imbalanceChartRef.current = null;
        imbalanceTrendSeriesRef.current = null;
        imbalanceEmaSeriesRef.current = null;
      }

      const rect = container.getBoundingClientRect();
      const width = rect.width || container.clientWidth || 800;
      const height = rect.height || container.clientHeight || 120;

      if (width <= 0 || height <= 0) {
        setTimeout(initChart, 200);
        return;
      }

      try {
        const mainTimeScaleOptions = chartRef.current.timeScale().options();
        
        const chart = createChart(container, {
          width,
          height,
          layout: {
            background: { color: '#0d1117' },
            textColor: '#c9d1d9',
          },
          grid: {
            vertLines: { color: 'rgba(48, 54, 61, 0.3)' },
            horzLines: { color: 'rgba(48, 54, 61, 0.3)' },
          },
          crosshair: {
            horzLine: { visible: false }, // Только вертикальная линия
          },
          timeScale: {
            visible: false, // Скрываем временную шкалу
            rightOffset: mainTimeScaleOptions.rightOffset,
            barSpacing: mainTimeScaleOptions.barSpacing,
            minBarSpacing: mainTimeScaleOptions.minBarSpacing,
          },
          rightPriceScale: {
            scaleMargins: { top: 0.1, bottom: 0.1 },
          },
          localization: {
            priceFormatter: formatDeltaValue,
          },
          handleScroll: false,
          handleScale: false,
        });

        // Линия тренда (основная)
        const trendSeries = chart.addLineSeries({
          color: '#00d4ff',
          lineWidth: 2,
          priceFormat: {
            type: 'custom',
            formatter: formatDeltaValue,
          },
        });

        imbalanceChartRef.current = chart;
        imbalanceTrendSeriesRef.current = trendSeries;
        
        console.log('[Tick200Chart] Imbalance Trend series created:', {
          hasChart: !!imbalanceChartRef.current,
          hasSeries: !!imbalanceTrendSeriesRef.current
        });
        
        // Линия EMA (пунктирная) - создаём только если включена
        if (showImbalanceEma) {
          const emaSeries = chart.addLineSeries({
            color: '#f0b90b',
            lineWidth: 1,
            lineStyle: 2, // Пунктир
            priceFormat: {
              type: 'custom',
              formatter: formatDeltaValue,
            },
          });
          imbalanceEmaSeriesRef.current = emaSeries;
        } else {
          imbalanceEmaSeriesRef.current = null;
        }

        // Синхронизируем с основным графиком
        const syncTimeScale = () => {
          if (chartRef.current && imbalanceChartRef.current) {
            const logicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
            if (logicalRange) {
              imbalanceChartRef.current.timeScale().setVisibleLogicalRange(logicalRange);
            }
          }
        };

        if (completedCandlesRef.current.length > 0) {
          scheduleChartUpdate(false, true); // forceFullUpdate = true при инициализации
          syncTimeScale();
          setTimeout(syncTimeScale, 100);
        }

        const resizeObserver = new ResizeObserver(() => {
          if (container && imbalanceChartRef.current) {
            const newRect = container.getBoundingClientRect();
            const newWidth = newRect.width || container.clientWidth;
            const newHeight = newRect.height || container.clientHeight;
            if (newWidth > 0 && newHeight > 0) {
              imbalanceChartRef.current.applyOptions({ width: newWidth, height: newHeight });
            }
          }
        });

        resizeObserver.observe(container);

        return () => {
          resizeObserver.disconnect();
        };
      } catch (error) {
        // Ignore imbalance chart initialization errors
      }
    };

    const timeoutId = setTimeout(initChart, 200);

    return () => {
      clearTimeout(timeoutId);
      if (imbalanceChartRef.current) {
        imbalanceChartRef.current.remove();
        imbalanceChartRef.current = null;
      }
      imbalanceTrendSeriesRef.current = null;
      imbalanceEmaSeriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showImbalanceTrend, showImbalanceEma]);

  // Инициализация графика Bid-Ask гистограммы
  useEffect(() => {
    if (!bidAskHistogramContainerRef.current || !showBidAskHistogram) {
      if (bidAskHistogramChartRef.current) {
        bidAskHistogramChartRef.current.remove();
        bidAskHistogramChartRef.current = null;
        bidSeriesRef.current = null;
        askSeriesRef.current = null;
      }
      return;
    }

    const initChart = () => {
      const container = bidAskHistogramContainerRef.current;
      if (!container || !chartRef.current) {
        setTimeout(initChart, 200);
        return;
      }

      if (bidAskHistogramChartRef.current) {
        bidAskHistogramChartRef.current.remove();
        bidAskHistogramChartRef.current = null;
        bidSeriesRef.current = null;
        askSeriesRef.current = null;
      }

      const rect = container.getBoundingClientRect();
      const width = rect.width || container.clientWidth || 800;
      const height = rect.height || container.clientHeight || 120;

      if (width <= 0 || height <= 0) {
        setTimeout(initChart, 200);
        return;
      }

      try {
        const mainTimeScaleOptions = chartRef.current.timeScale().options();
        
        const chart = createChart(container, {
          width,
          height,
          layout: {
            background: { color: '#0d1117' },
            textColor: '#c9d1d9',
          },
          grid: {
            vertLines: { color: 'rgba(48, 54, 61, 0.3)' },
            horzLines: { color: 'rgba(48, 54, 61, 0.3)' },
          },
          crosshair: {
            horzLine: { visible: false },
          },
          timeScale: {
            visible: false,
            rightOffset: mainTimeScaleOptions.rightOffset,
            barSpacing: mainTimeScaleOptions.barSpacing,
            minBarSpacing: mainTimeScaleOptions.minBarSpacing,
          },
          rightPriceScale: {
            scaleMargins: { top: 0.1, bottom: 0.1 },
          },
          localization: {
            priceFormatter: formatDeltaValue,
          },
          handleScroll: false,
          handleScale: false,
        });

        const bidSeries = chart.addHistogramSeries({
          priceFormat: {
            type: 'custom',
            formatter: formatDeltaValue,
          },
        });

        const askSeries = chart.addHistogramSeries({
          priceFormat: {
            type: 'custom',
            formatter: formatDeltaValue,
          },
        });

        bidAskHistogramChartRef.current = chart;
        bidSeriesRef.current = bidSeries;
        askSeriesRef.current = askSeries;

        // Синхронизируем с основным графиком
        const syncTimeScale = () => {
          if (chartRef.current && bidAskHistogramChartRef.current) {
            const logicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
            if (logicalRange) {
              bidAskHistogramChartRef.current.timeScale().setVisibleLogicalRange(logicalRange);
            }
          }
        };

        if (completedCandlesRef.current.length > 0) {
          scheduleChartUpdate(false, true);
          syncTimeScale();
          setTimeout(syncTimeScale, 100);
        }

        const resizeObserver = new ResizeObserver(() => {
          if (container && bidAskHistogramChartRef.current) {
            const newRect = container.getBoundingClientRect();
            const newWidth = newRect.width || container.clientWidth;
            const newHeight = newRect.height || container.clientHeight;
            if (newWidth > 0 && newHeight > 0) {
              bidAskHistogramChartRef.current.applyOptions({ width: newWidth, height: newHeight });
            }
          }
        });

        resizeObserver.observe(container);

        return () => {
          resizeObserver.disconnect();
        };
      } catch (error) {
        // Ignore bid-ask histogram chart initialization errors
      }
    };

    const timeoutId = setTimeout(initChart, 200);

    return () => {
      clearTimeout(timeoutId);
      if (bidAskHistogramChartRef.current) {
        bidAskHistogramChartRef.current.remove();
        bidAskHistogramChartRef.current = null;
      }
      bidSeriesRef.current = null;
      askSeriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBidAskHistogram]);

  // Инициализация гистограммы перевеса крупных ордеров (x1, x2, x3)
  useEffect(() => {
    if (!bigOrderHistogramContainerRef.current || !showBigOrders) {
      if (bigOrderHistogramChartRef.current) {
        bigOrderHistogramChartRef.current.remove();
        bigOrderHistogramChartRef.current = null;
        bigOrderHistogramX1Ref.current = null;
        bigOrderHistogramX2Ref.current = null;
        bigOrderHistogramX3Ref.current = null;
        bigOrderPressurePositiveRef.current = null;
        bigOrderPressureNegativeRef.current = null;
      }
      return;
    }

    const initChart = () => {
      const container = bigOrderHistogramContainerRef.current;
      if (!container || !chartRef.current) {
        setTimeout(initChart, 200);
        return;
      }

      if (bigOrderHistogramChartRef.current) {
        bigOrderHistogramChartRef.current.remove();
        bigOrderHistogramChartRef.current = null;
        bigOrderHistogramX1Ref.current = null;
        bigOrderHistogramX2Ref.current = null;
        bigOrderHistogramX3Ref.current = null;
        bigOrderPressurePositiveRef.current = null;
        bigOrderPressureNegativeRef.current = null;
      }

      const rect = container.getBoundingClientRect();
      const width = rect.width || container.clientWidth || 800;
      const height = rect.height || container.clientHeight || 120;

      if (width <= 0 || height <= 0) {
        setTimeout(initChart, 200);
        return;
      }

      try {
        const mainTimeScaleOptions = chartRef.current.timeScale().options();

        const chart = createChart(container, {
          width,
          height,
          layout: {
            background: { color: '#0d1117' },
            textColor: '#c9d1d9',
          },
          grid: {
            vertLines: { color: 'rgba(48, 54, 61, 0.3)' },
            horzLines: { color: 'rgba(48, 54, 61, 0.3)' },
          },
          crosshair: {
            horzLine: { visible: false },
          },
          timeScale: {
            visible: false,
            rightOffset: mainTimeScaleOptions.rightOffset,
            barSpacing: mainTimeScaleOptions.barSpacing,
            minBarSpacing: mainTimeScaleOptions.minBarSpacing,
          },
          rightPriceScale: { visible: false },
          leftPriceScale: {
            visible: true,
            scaleMargins: { top: 0.08, bottom: 0.08 },
            borderVisible: true,
          },
          localization: {
            priceFormatter: (value: number) => (value * 100).toFixed(0) + '%',
          },
          handleScroll: false,
          handleScale: false,
        });

        // Только давление стакана: сверху — покупатели (зелёные), снизу — продавцы (оранжевые). Без x1/x2/x3, чтобы не было каши.
        const pressurePositiveHistogram = chart.addHistogramSeries({
          priceScaleId: 'left',
          color: '#26a69a',
          priceFormat: { type: 'custom', formatter: (v: number) => (v * 100).toFixed(0) + '%' },
          title: 'Покуп',
        });
        const pressureNegativeHistogram = chart.addHistogramSeries({
          priceScaleId: 'left',
          color: '#c17817',
          priceFormat: { type: 'custom', formatter: (v: number) => (v * 100).toFixed(0) + '%' },
          title: 'Продаж',
        });
        chart.priceScale('left').applyOptions({
          scaleMargins: { top: 0.08, bottom: 0.08 },
          autoScale: true,
          borderVisible: true,
        });

        bigOrderHistogramChartRef.current = chart;
        bigOrderHistogramX1Ref.current = null;
        bigOrderHistogramX2Ref.current = null;
        bigOrderHistogramX3Ref.current = null;
        bigOrderPressurePositiveRef.current = pressurePositiveHistogram;
        bigOrderPressureNegativeRef.current = pressureNegativeHistogram;

        if (completedCandlesRef.current.length > 0 || bigOrderExcessDataRef.current.length > 0) {
          scheduleChartUpdate(false, true);
        }
        const syncTimeScale = () => {
          if (chartRef.current && bigOrderHistogramChartRef.current) {
            const logicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
            if (logicalRange) {
              bigOrderHistogramChartRef.current.timeScale().setVisibleLogicalRange(logicalRange);
            }
          }
        };
        syncTimeScale();
        setTimeout(syncTimeScale, 100);

        const resizeObserver = new ResizeObserver(() => {
          if (container && bigOrderHistogramChartRef.current) {
            const newRect = container.getBoundingClientRect();
            const newWidth = newRect.width || container.clientWidth;
            const newHeight = newRect.height || container.clientHeight;
            if (newWidth > 0 && newHeight > 0) {
              bigOrderHistogramChartRef.current.applyOptions({ width: newWidth, height: newHeight });
            }
          }
        });
        resizeObserver.observe(container);

        return () => {
          resizeObserver.disconnect();
        };
      } catch (error) {
        // Ignore big order histogram init errors
      }
    };

    const timeoutId = setTimeout(initChart, 200);

    return () => {
      clearTimeout(timeoutId);
      if (bigOrderHistogramChartRef.current) {
        bigOrderHistogramChartRef.current.remove();
        bigOrderHistogramChartRef.current = null;
      }
      bigOrderHistogramX1Ref.current = null;
      bigOrderHistogramX2Ref.current = null;
      bigOrderHistogramX3Ref.current = null;
      bigOrderPressurePositiveRef.current = null;
      bigOrderPressureNegativeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBigOrders]);

  // Функция для очистки и сортировки данных (удаление дубликатов времени)
  const prepareLiquidityData = useCallback(() => {
    if (liquidityImbalanceDataRef.current.length === 0) {
      return { lineData: [], positiveData: [], negativeData: [] };
    }
    
    // Создаем Map для удаления дубликатов (оставляем последнее значение для каждого времени)
    const timeMap = new Map<Time, number>();
    for (const point of liquidityImbalanceDataRef.current) {
      timeMap.set(point.time, point.value);
    }
    
    // Преобразуем обратно в массив и сортируем по времени
    const uniqueData = Array.from(timeMap.entries())
      .map(([time, value]) => ({ time, value }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    
    const lineData: { time: Time; value: number }[] = uniqueData;
    const positiveData: { time: Time; value: number }[] = [];
    const negativeData: { time: Time; value: number }[] = [];
    
    uniqueData.forEach(point => {
      if (point.value >= 0) {
        positiveData.push({ time: point.time, value: point.value });
      } else {
        negativeData.push({ time: point.time, value: point.value });
      }
    });
    
    return { lineData, positiveData, negativeData };
  }, []);

  // Функция переключения между линией и гистограммой на существующем графике
  const switchSeriesMode = useCallback(() => {
    if (!liquidityImbalanceChartRef.current) return;
    
    const chart = liquidityImbalanceChartRef.current;
    const currentShowLine = useTradingStore.getState().liquidityImbalanceShowLine;
    
    console.log('[Tick200Chart] Switching series mode:', {
      showLine: currentShowLine,
      dataPoints: liquidityImbalanceDataRef.current.length
    });
    
    // Удаляем старые серии
    if (liquidityImbalanceSeriesRef.current) {
      chart.removeSeries(liquidityImbalanceSeriesRef.current);
      liquidityImbalanceSeriesRef.current = null;
    }
    if (liquidityImbalanceHistogramPositiveRef.current) {
      chart.removeSeries(liquidityImbalanceHistogramPositiveRef.current);
      liquidityImbalanceHistogramPositiveRef.current = null;
    }
    if (liquidityImbalanceHistogramNegativeRef.current) {
      chart.removeSeries(liquidityImbalanceHistogramNegativeRef.current);
      liquidityImbalanceHistogramNegativeRef.current = null;
    }
    
    // Подготавливаем данные (сортировка и удаление дубликатов)
    const { lineData, positiveData, negativeData } = prepareLiquidityData();
    
    // Создаем новые серии в зависимости от режима
    if (currentShowLine) {
      // Создаем линию
      const series = chart.addLineSeries({
        color: '#ffffff',
        lineWidth: 2,
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
        lastValueVisible: true,
        priceLineVisible: false,
        priceFormat: {
          type: 'custom',
          formatter: formatDeltaValue,
        },
      });
      
      series.createPriceLine({
        price: 0,
        color: 'rgba(128, 128, 128, 0.5)',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '',
      });
      
      liquidityImbalanceSeriesRef.current = series;
      
      // Восстанавливаем данные
      if (lineData.length > 0) {
        series.setData(lineData);
        console.log('[Tick200Chart] Restored line data:', lineData.length, 'points');
        // Принудительно обновляем ценовую шкалу
        chart.priceScale('right').applyOptions({
          autoScale: true,
        });
      }
    } else {
      // Создаем гистограммы
      const positiveHistogram = chart.addHistogramSeries({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
        color: '#3b82f6',
        priceFormat: {
          type: 'custom',
          formatter: formatDeltaValue,
        },
      });
      
      const negativeHistogram = chart.addHistogramSeries({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
        color: '#fbbf24',
        priceFormat: {
          type: 'custom',
          formatter: formatDeltaValue,
        },
      });
      
      liquidityImbalanceHistogramPositiveRef.current = positiveHistogram;
      liquidityImbalanceHistogramNegativeRef.current = negativeHistogram;
      
      // Восстанавливаем данные
      if (positiveData.length > 0 || negativeData.length > 0) {
        positiveHistogram.setData(positiveData);
        negativeHistogram.setData(negativeData);
        console.log('[Tick200Chart] Restored histogram data:', {
          positive: positiveData.length,
          negative: negativeData.length
        });
        // Принудительно обновляем ценовую шкалу
        chart.priceScale('right').applyOptions({
          autoScale: true,
        });
      }
    }
  }, [prepareLiquidityData]);

  // Инициализация графика Дисбаланса ликвидности (создается один раз)
  useEffect(() => {
    if (!liquidityImbalanceContainerRef.current || !showLiquidityImbalance) {
      if (liquidityImbalanceChartRef.current) {
        liquidityImbalanceChartRef.current.remove();
        liquidityImbalanceChartRef.current = null;
        liquidityImbalanceSeriesRef.current = null;
        liquidityImbalanceHistogramPositiveRef.current = null;
        liquidityImbalanceHistogramNegativeRef.current = null;
      }
      return;
    }

    const initChart = () => {
      const container = liquidityImbalanceContainerRef.current;
      if (!container || !chartRef.current) {
        setTimeout(initChart, 200);
        return;
      }

      // Если график уже существует, не пересоздаем его
      if (liquidityImbalanceChartRef.current) {
        return;
      }

      const rect = container.getBoundingClientRect();
      const width = rect.width || container.clientWidth || 800;
      const height = rect.height || container.clientHeight || 120;

      if (width <= 0 || height <= 0) {
        setTimeout(initChart, 200);
        return;
      }

      try {
        const mainTimeScaleOptions = chartRef.current.timeScale().options();
        
        const chart = createChart(container, {
          width,
          height,
          layout: {
            background: { color: '#0d1117' },
            textColor: '#c9d1d9',
          },
          grid: {
            vertLines: { color: 'rgba(48, 54, 61, 0.3)' },
            horzLines: { color: 'rgba(48, 54, 61, 0.3)' },
          },
          crosshair: {
            horzLine: { visible: false },
          },
          timeScale: {
            visible: false,
            rightOffset: mainTimeScaleOptions.rightOffset,
            barSpacing: mainTimeScaleOptions.barSpacing,
            minBarSpacing: mainTimeScaleOptions.minBarSpacing,
          },
          rightPriceScale: {
            visible: true,
            scaleMargins: { top: 0.1, bottom: 0.1 },
            autoScale: true,
          },
          localization: {
            priceFormatter: formatDeltaValue,
          },
          handleScroll: false,
          handleScale: false,
        });

        liquidityImbalanceChartRef.current = chart;

        // Создаем начальные серии в зависимости от текущего режима
        // Используем ту же логику, что и в switchSeriesMode
        const currentShowLine = liquidityImbalanceShowLine;
        if (currentShowLine) {
          const series = chart.addLineSeries({
            color: '#ffffff',
            lineWidth: 2,
            scaleMargins: {
              top: 0.1,
              bottom: 0.1,
            },
            lastValueVisible: true,
            priceLineVisible: false,
            priceFormat: {
              type: 'custom',
              formatter: formatDeltaValue,
            },
          });
          
          series.createPriceLine({
            price: 0,
            color: 'rgba(128, 128, 128, 0.5)',
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: '',
          });
          
          liquidityImbalanceSeriesRef.current = series;
        } else {
          const positiveHistogram = chart.addHistogramSeries({
            scaleMargins: {
              top: 0.8,
              bottom: 0,
            },
            color: '#3b82f6',
            priceFormat: {
              type: 'custom',
              formatter: formatDeltaValue,
            },
          });
          
          const negativeHistogram = chart.addHistogramSeries({
            scaleMargins: {
              top: 0.8,
              bottom: 0,
            },
            color: '#fbbf24',
            priceFormat: {
              type: 'custom',
              formatter: formatDeltaValue,
            },
          });
          
          liquidityImbalanceHistogramPositiveRef.current = positiveHistogram;
          liquidityImbalanceHistogramNegativeRef.current = negativeHistogram;
        }

        // Синхронизируем с основным графиком
        const syncTimeScale = () => {
          if (chartRef.current && liquidityImbalanceChartRef.current) {
            const logicalRange = chartRef.current.timeScale().getVisibleLogicalRange();
            if (logicalRange) {
              liquidityImbalanceChartRef.current.timeScale().setVisibleLogicalRange(logicalRange);
            }
          }
        };

        // Восстанавливаем данные после инициализации
        console.log('[Tick200Chart] Chart initialized:', {
          showLine: currentShowLine,
          dataPoints: liquidityImbalanceDataRef.current.length
        });
        
        // Подготавливаем данные (сортировка и удаление дубликатов)
        const { lineData, positiveData, negativeData } = prepareLiquidityData();
        
        if (lineData.length > 0 || positiveData.length > 0 || negativeData.length > 0) {
          if (currentShowLine && liquidityImbalanceSeriesRef.current) {
            liquidityImbalanceSeriesRef.current.setData(lineData);
            console.log('[Tick200Chart] Restored line data:', lineData.length, 'points');
            // Принудительно обновляем ценовую шкалу
            chart.priceScale('right').applyOptions({
              autoScale: true,
            });
          } else if (liquidityImbalanceHistogramPositiveRef.current && liquidityImbalanceHistogramNegativeRef.current) {
            liquidityImbalanceHistogramPositiveRef.current.setData(positiveData);
            liquidityImbalanceHistogramNegativeRef.current.setData(negativeData);
            console.log('[Tick200Chart] Restored histogram data:', {
              positive: positiveData.length,
              negative: negativeData.length
            });
            // Принудительно обновляем ценовую шкалу
            chart.priceScale('right').applyOptions({
              autoScale: true,
            });
          }
        }
        
        if (completedCandlesRef.current.length > 0 || liquidityImbalanceDataRef.current.length > 0) {
          // Небольшая задержка для гарантии, что график полностью инициализирован
          setTimeout(() => {
            scheduleChartUpdate(false, true);
            syncTimeScale();
          }, 100);
          setTimeout(() => {
            scheduleChartUpdate(false, true);
            syncTimeScale();
          }, 300);
        }

        const resizeObserver = new ResizeObserver(() => {
          if (container && liquidityImbalanceChartRef.current) {
            const newRect = container.getBoundingClientRect();
            const newWidth = newRect.width || container.clientWidth;
            const newHeight = newRect.height || container.clientHeight;
            if (newWidth > 0 && newHeight > 0) {
              liquidityImbalanceChartRef.current.applyOptions({ width: newWidth, height: newHeight });
            }
          }
        });

        resizeObserver.observe(container);

        return () => {
          resizeObserver.disconnect();
        };
      } catch (error) {
        // Ignore liquidity imbalance chart initialization errors
      }
    };

    const timeoutId = setTimeout(initChart, 200);

    return () => {
      clearTimeout(timeoutId);
      if (liquidityImbalanceChartRef.current) {
        liquidityImbalanceChartRef.current.remove();
        liquidityImbalanceChartRef.current = null;
      }
      liquidityImbalanceSeriesRef.current = null;
      liquidityImbalanceHistogramPositiveRef.current = null;
      liquidityImbalanceHistogramNegativeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLiquidityImbalance]);

  // Переключение между линией и гистограммой (без пересоздания графика)
  useEffect(() => {
    if (!showLiquidityImbalance || !liquidityImbalanceChartRef.current) {
      return;
    }
    
    // Переключаем серии на существующем графике
    switchSeriesMode();
  }, [liquidityImbalanceShowLine, showLiquidityImbalance, switchSeriesMode]);

  // Подписка на Depth Stream для imbalance, bid-ask гистограммы, дисбаланса ликвидности и крупных ордеров
  useEffect(() => {
    if (!selectedPair || (!showImbalanceTrend && !showBidAskHistogram && !showLiquidityImbalance && !showBigOrders)) {
      if (depthStreamRef.current) {
        depthStreamRef.current.disconnect();
        depthStreamRef.current = null;
      }
      return;
    }

    const pairSymbol = selectedPair.symbol;

    // Отключаем старый стрим при смене уровней
    if (depthStreamRef.current) {
      depthStreamRef.current.disconnect();
      depthStreamRef.current = null;
    }

    // Сбрасываем imbalance данные
    cumulativeImbalanceRef.current = 0;
    lastImbalanceEmaRef.current = 0;
    currentImbalanceRef.current = 0;
    setCurrentImbalanceDisplay(0);
    currentBidVolumeRef.current = 0;
    currentAskVolumeRef.current = 0;
    currentLiquidityImbalanceRef.current = 0;
    previousLiquidityImbalanceRef.current = 0;
    
    // Убеждаемся, что ref синхронизирован с текущим значением из store
    liquidityImbalanceDepthPercentRef.current = liquidityImbalanceDepthPercent;

    const handleDepthUpdate = (data: OrderBookData) => {
      console.log('[Tick200Chart] handleDepthUpdate called:', {
        imbalance: data.imbalance,
        bidTotal: data.bidTotal,
        askTotal: data.askTotal,
        timestamp: Date.now(),
        candleCount: completedCandlesRef.current.length,
        showImbalanceTrend,
        hasSeries: !!imbalanceTrendSeriesRef.current
      });
      
      // Сохраняем последние данные для пересчета при изменении процента
      lastDepthDataRef.current = data;
      
      const imbalancePercent = Math.abs(data.imbalance * 100);
      
      // Обновляем текущее значение для отображения (показываем исходное значение)
      currentImbalanceRef.current = data.imbalance;
      setCurrentImbalanceDisplay(data.imbalance);
      
      // Обновляем объемы bid/ask для текущей свечи
      currentBidVolumeRef.current = data.bidTotal;
      currentAskVolumeRef.current = data.askTotal;
      
      // Пропорциональное накопление: чем больше перевес, тем сильнее рост
      // Используем степень 1.5 для более плавной кривой (1.0 = линейно, 1.5 = среднее, 2.0 = квадрат)
      const weight = (imbalancePercent / 100) ** 1.5;
      
      // Накапливаем пропорционально силе перевеса
      // Умножаем на множитель из настроек для более заметных значений
      const oldCumulative = cumulativeImbalanceRef.current;
      cumulativeImbalanceRef.current += data.imbalance * imbalanceMultiplier * weight;
      
      console.log('[Tick200Chart] Cumulative imbalance updated:', {
        old: oldCumulative,
        new: cumulativeImbalanceRef.current,
        delta: cumulativeImbalanceRef.current - oldCumulative
      });
      
      // Обновляем линию imbalance trend в реальном времени
      // Читаем актуальное значение из store напрямую, чтобы избежать проблем с замыканием
      const currentShowImbalanceTrend = useTradingStore.getState().showImbalanceTrend;
      
      if (currentShowImbalanceTrend && imbalanceTrendSeriesRef.current) {
        try {
          const completedCandlesCount = completedCandlesRef.current.length;
          // Используем индекс текущей формирующейся свечи (completedCandlesCount + 1)
          // чтобы линия обновлялась в реальном времени, а не отставала на одну свечу
          const currentCandleTime = (completedCandlesCount + 1) as Time;
          
          console.log('[Tick200Chart] Updating imbalance trend line:', {
            completedCandlesCount,
            currentCandleTime,
            hasSeries: !!imbalanceTrendSeriesRef.current,
            showImbalanceTrend: currentShowImbalanceTrend
          });
          
          if (completedCandlesCount >= 0) { // >= 0, чтобы обновлять даже для первой свечи
            const newValue = cumulativeImbalanceRef.current;
            const currentEmaPeriod = useTradingStore.getState().imbalanceEmaPeriod;
            const newEma = calculateEMA(newValue, lastImbalanceEmaRef.current, currentEmaPeriod);
            lastImbalanceEmaRef.current = newEma;
            
            console.log('[Tick200Chart] Calling imbalanceTrendSeriesRef.current.update:', {
              time: currentCandleTime,
              value: newValue,
              ema: newEma
            });
            
            // Обновляем линию на графике для текущей формирующейся свечи
            imbalanceTrendSeriesRef.current.update({ time: currentCandleTime, value: newValue });
            
            const currentShowImbalanceEma = useTradingStore.getState().showImbalanceEma;
            if (currentShowImbalanceEma && imbalanceEmaSeriesRef.current) {
              imbalanceEmaSeriesRef.current.update({ time: currentCandleTime, value: newEma });
            }
            
            console.log('[Tick200Chart] Line updated successfully');
          } else {
            console.log('[Tick200Chart] No candles yet, skipping line update');
          }
        } catch (e) {
          console.error('[Tick200Chart] Error updating imbalance trend line:', e);
        }
      } else {
        console.log('[Tick200Chart] Cannot update line:', {
            showImbalanceTrend: currentShowImbalanceTrend,
            hasSeries: !!imbalanceTrendSeriesRef.current
          });
      }
      
      // Расчет дисбаланса ликвидности
      if (showLiquidityImbalance) {
        // Всегда читаем актуальное значение из store напрямую, а не из ref
        // Это гарантирует, что используется правильное значение даже при изменении в другом окне
        const currentDepthPercent = useTradingStore.getState().liquidityImbalanceDepthPercent;
        liquidityImbalanceDepthPercentRef.current = currentDepthPercent; // Синхронизируем ref
        
        const liquidityImbalance = calculateLiquidityImbalance(
          data.bids,
          data.asks,
          currentDepthPercent // Используем актуальное значение из store
        );
        
        currentLiquidityImbalanceRef.current = liquidityImbalance;
        setCurrentLiquidityImbalanceDisplay(liquidityImbalance);
        
        // Обновляем линию дисбаланса ликвидности в реальном времени
        const currentLiquidityImbalanceShowLine = useTradingStore.getState().liquidityImbalanceShowLine;
        if (currentLiquidityImbalanceShowLine && liquidityImbalanceSeriesRef.current) {
          try {
            const completedCandlesCount = completedCandlesRef.current.length;
            // Используем индекс текущей формирующейся свечи (completedCandlesCount + 1)
            // чтобы линия обновлялась в реальном времени, а не отставала на одну свечу
            const currentCandleTime = (completedCandlesCount + 1) as Time;
            
            if (completedCandlesCount >= 0) { // >= 0, чтобы обновлять даже для первой свечи
              // Обновляем или добавляем точку в данных
              const existingIndex = liquidityImbalanceDataRef.current.findIndex(
                point => point.time === currentCandleTime
              );
              
              const newPoint = { time: currentCandleTime, value: liquidityImbalance };
              
              if (existingIndex >= 0) {
                liquidityImbalanceDataRef.current[existingIndex] = newPoint;
              } else {
                liquidityImbalanceDataRef.current.push(newPoint);
              }
              
              // Обновляем линию на графике для текущей формирующейся свечи
              try {
                liquidityImbalanceSeriesRef.current.update(newPoint);
                
                console.log('[Tick200Chart] Liquidity imbalance line updated:', {
                  time: currentCandleTime,
                  value: liquidityImbalance,
                  completedCandlesCount,
                  hasSeries: !!liquidityImbalanceSeriesRef.current,
                  dataPointsCount: liquidityImbalanceDataRef.current.length
                });
              } catch (updateError) {
                console.error('[Tick200Chart] Error in update call:', updateError);
                // Если update не работает, попробуем setData для всех точек
                const allData = liquidityImbalanceDataRef.current.map(p => ({
                  time: p.time,
                  value: p.value
                }));
                liquidityImbalanceSeriesRef.current.setData(allData);
                console.log('[Tick200Chart] Used setData fallback, restored', allData.length, 'points');
              }
            }
          } catch (e) {
            console.error('[Tick200Chart] Error updating liquidity imbalance line:', e);
          }
        }
      }
      
      // Определение крупных лимитных ордеров
      // Адаптивное число уровней по паре: BTC/ETH — больше, альты — меньше
      const currentShowBigOrders = useTradingStore.getState().showBigOrders;
      if (currentShowBigOrders && data.bids.length > 0 && data.asks.length > 0) {
        const currentMultiplier = useTradingStore.getState().bigOrderMultiplier;
        const adaptiveLevels = getAdaptiveDepthLevels(selectedPair?.symbol ?? '');
        
        const bidLevels = data.bids.slice(0, adaptiveLevels);
        const askLevels = data.asks.slice(0, adaptiveLevels);
        
        const avgBidVolume = bidLevels.length > 0 
          ? bidLevels.reduce((sum, b) => sum + b.quantity * b.price, 0) / bidLevels.length
          : 0;
        const avgAskVolume = askLevels.length > 0
          ? askLevels.reduce((sum, a) => sum + a.quantity * a.price, 0) / askLevels.length
          : 0;
        
        // Все уровни с объёмом в USDT, фильтр: объём >= средний * множитель
        const allBidCandidates = bidLevels.map(b => ({ price: b.price, volumeUsdt: b.price * b.quantity, side: 'bid' as const }))
          .filter(x => avgBidVolume > 0 && x.volumeUsdt >= avgBidVolume * currentMultiplier);
        const allAskCandidates = askLevels.map(a => ({ price: a.price, volumeUsdt: a.price * a.quantity, side: 'ask' as const }))
          .filter(x => avgAskVolume > 0 && x.volumeUsdt >= avgAskVolume * currentMultiplier);
        
        // Топ-10 стен: сортируем по объёму и берём 10 крупнейших (bid и ask вместе)
        const allCandidates = [...allBidCandidates, ...allAskCandidates]
          .sort((a, b) => b.volumeUsdt - a.volumeUsdt)
          .slice(0, 10);
        
        bigOrdersRef.current = allCandidates;
        
        // Накопление по порогам x1, x2, x3 для гистограммы: из топ-10 стен
        const acc = currentCandleBigOrderAccumulatorRef.current;
        allCandidates.forEach((level) => {
          const vol = level.volumeUsdt;
          const avg = level.side === 'bid' ? avgBidVolume : avgAskVolume;
          if (avg > 0) {
            if (vol >= avg * 1) acc.x1[level.side] += vol;
            if (vol >= avg * 2) acc.x2[level.side] += vol;
            if (vol >= avg * 3) acc.x3[level.side] += vol;
          }
        });
        
        // Перерисовываем линии крупных ордеров
        drawBigOrders();

        // Живое давление = дисбаланс стакана (как коричневый столбец), чтобы гистограмма показывала значение в реальном времени
        currentBigOrderPressureRef.current = data.imbalance;
        const currentShowBigOrdersCheck = useTradingStore.getState().showBigOrders;
        if (currentShowBigOrdersCheck && bigOrderPressurePositiveRef.current && bigOrderPressureNegativeRef.current) {
          try {
            const completedCount = completedCandlesRef.current.length;
            const currentCandleTime = (completedCount + 1) as Time;
            const p = data.imbalance;
            bigOrderPressurePositiveRef.current.update({ time: currentCandleTime, value: p >= 0 ? p : 0 });
            bigOrderPressureNegativeRef.current.update({ time: currentCandleTime, value: p < 0 ? p : 0 });
          } catch (_e) {
            // ignore
          }
        }
      } else {
        bigOrdersRef.current = [];
        // Очищаем canvas если отключено
        const canvas = bigOrdersCanvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    };

    // Используем максимальное количество уровней из всех индикаторов
    // Для крупных ордеров: 50 уровней для расчёта средней крупности, из них топ-10 отображаем как стены
    const maxLevels = Math.max(
      showImbalanceTrend ? imbalanceLevels : 0,
      showBidAskHistogram ? 20 : 0,
      showLiquidityImbalance ? 20 : 0,
      showBigOrders ? 50 : 0
    );

    const isBybit = selectedPair?.exchange === 'Bybit';
    
    if (isBybit) {
      // Для Bybit создаём адаптер для данных
      const bybitDepthHandler = (data: BybitOrderBookData) => {
        // Конвертируем Bybit формат в формат совместимый с Binance
        const adaptedData: OrderBookData = {
          bids: data.bids,
          asks: data.asks,
          imbalance: data.imbalance,
          bidTotal: data.bidVolume,
          askTotal: data.askVolume,
        };
        handleDepthUpdate(adaptedData);
      };
      
      const bybitDepthStream = new BybitDepthStream(pairSymbol, maxLevels || 20, bybitDepthHandler);
      bybitDepthStream.connect();
      depthStreamRef.current = bybitDepthStream;
    } else {
      const binanceDepthStream = new BinanceDepthStream(
        pairSymbol,
        maxLevels || 20,
        handleDepthUpdate
      );
      binanceDepthStream.connect().catch((error) => {
        console.error('Failed to connect depth stream:', error);
      });
      depthStreamRef.current = binanceDepthStream;
    }

    return () => {
      if (depthStreamRef.current) {
        depthStreamRef.current.disconnect();
        depthStreamRef.current = null;
      }
    };
  }, [selectedPair?.symbol, selectedPair?.exchange, showImbalanceTrend, showBidAskHistogram, showLiquidityImbalance, showBigOrders, imbalanceLevels, imbalanceMultiplier]);

  // Синхронизация ref процента глубины с store значением (для обновления на лету без переподключения WebSocket)
  useEffect(() => {
    console.log('[LIQUIDITY_IMBALANCE] Процент изменился:',
      `\n  Старое: ${liquidityImbalanceDepthPercentRef.current}%`,
      `\n  Новое: ${liquidityImbalanceDepthPercent}%`,
      `\n  Показан: ${showLiquidityImbalance}`,
      `\n  Есть данные: ${!!lastDepthDataRef.current}`,
      `\n  Бидов: ${lastDepthDataRef.current?.bids?.length || 0}`,
      `\n  Асков: ${lastDepthDataRef.current?.asks?.length || 0}`
    );
    
    liquidityImbalanceDepthPercentRef.current = liquidityImbalanceDepthPercent;
    
    // Если есть активный depth stream и последние данные, пересчитываем значение сразу
    if (showLiquidityImbalance && lastDepthDataRef.current) {
      const oldValue = currentLiquidityImbalanceRef.current;
      const data = lastDepthDataRef.current;
      
      // Пересчитываем текущее значение с новым процентом используя последние данные depth stream
      const midPrice = (data.bids[0]?.price + data.asks[0]?.price) / 2;
      const lowBoundary = midPrice * (1 - liquidityImbalanceDepthPercent / 100);
      const highBoundary = midPrice * (1 + liquidityImbalanceDepthPercent / 100);
      
      const bidsInRange = data.bids.filter(bid => bid.price >= lowBoundary);
      const asksInRange = data.asks.filter(ask => ask.price <= highBoundary);
      
      const liquidityImbalance = calculateLiquidityImbalance(
        data.bids,
        data.asks,
        liquidityImbalanceDepthPercent // Используем новое значение из store
      );
      
      const totalBidsVol = bidsInRange.reduce((sum, bid) => sum + bid.quantity, 0);
      const totalAsksVol = asksInRange.reduce((sum, ask) => sum + ask.quantity, 0);
      
      // Логирование только если значение действительно изменилось
      if (Math.abs(oldValue - liquidityImbalance) > 0.01) {
        console.log('[LIQUIDITY_IMBALANCE] Пересчет - значение изменилось:',
          `\n  Было: ${oldValue.toFixed(2)}`,
          `\n  Стало: ${liquidityImbalance.toFixed(2)}`,
          `\n  Процент: ${liquidityImbalanceDepthPercent}%`,
          `\n  Бидов в диапазоне: ${bidsInRange.length}/${data.bids.length}`,
          `\n  Асков в диапазоне: ${asksInRange.length}/${data.asks.length}`
        );
      }
      
      // Всегда обновляем значение и отображение при изменении процента
      currentLiquidityImbalanceRef.current = liquidityImbalance;
      setCurrentLiquidityImbalanceDisplay(liquidityImbalance);
      
      // Очищаем исторические данные, чтобы они пересчитались с новым процентом
      // Это гарантирует, что график будет показывать правильные значения
      liquidityImbalanceDataRef.current = [];
      
      // Принудительно обновляем график для отображения нового значения
      if (liquidityImbalanceChartRef.current) {
        scheduleChartUpdate(false, true);
      }
    } else {
      console.log('[LIQUIDITY_IMBALANCE] Пересчет не выполнен:', {
        showLiquidityImbalance,
        hasLastDepthData: !!lastDepthDataRef.current,
      });
    }
  }, [liquidityImbalanceDepthPercent, showLiquidityImbalance]);

  // Обновление цвета линии imbalance с учетом heatmap
  useEffect(() => {
    if (!imbalanceTrendSeriesRef.current) return;
    
    const imbalancePercent = Math.abs(currentImbalanceDisplay * 100);
    
    try {
      // Обычный цвет или heatmap (без проверки порога)
      if (imbalanceHeatMap) {
        const newColor = getHeatMapColor(imbalancePercent);
        imbalanceTrendSeriesRef.current.applyOptions({ 
          color: newColor,
          lineWidth: 2 // Обычная толщина
        });
      } else {
        imbalanceTrendSeriesRef.current.applyOptions({ 
          color: '#00E5FF', // Синий по умолчанию
          lineWidth: 2 // Обычная толщина
        });
      }
    } catch (e) {
      // Игнорируем ошибки
    }
  }, [currentImbalanceDisplay, imbalanceHeatMap]);

  // Сброс цвета при выключении индикации
  useEffect(() => {
    if (!imbalanceTrendSeriesRef.current || imbalanceHeatMap) return;
    
    try {
      imbalanceTrendSeriesRef.current.applyOptions({ color: '#00d4ff' });
    } catch (e) {
      // Игнорируем ошибки
    }
  }, [imbalanceHeatMap]);

  // Обновление маркеров при изменении настройки showImbalanceMarkers
  useEffect(() => {
    if (!showImbalanceMarkers) {
      // Очищаем маркеры imbalance при выключении
      imbalanceMarkersRef.current = [];
    }
    // Обновляем все маркеры
    updateAllMarkers();
  }, [showImbalanceMarkers, updateAllMarkers]);

  // Очистка данных гистограммы крупных ордеров при выключении
  useEffect(() => {
    if (!showBigOrders) {
      bigOrderMarkersRef.current = [];
      lastBigOrderTimeRef.current = 0;
      bigOrderExcessDataRef.current = [];
      currentBigOrderPressureRef.current = 0;
      currentCandleBigOrderAccumulatorRef.current = {
        x1: { bid: 0, ask: 0 },
        x2: { bid: 0, ask: 0 },
        x3: { bid: 0, ask: 0 },
      };
    }
    updateAllMarkers();
  }, [showBigOrders, updateAllMarkers]);

  // Подписка на тики - с правильной очисткой при смене пары
  useEffect(() => {
    const pairSymbol = selectedPair?.symbol || null;
    
    // Если пара не изменилась и уже есть подключение - не делаем ничего
    if (pairSymbol === currentPairRef.current && tickStreamRef.current) {
      return;
    }

    // === ОПТИМИЗАЦИЯ: Сразу показываем loading для мгновенной обратной связи ===
    setIsLoadingTick200(true);
    setTickChartError(null);
    
    // Сохраняем новые параметры сразу
    currentPairRef.current = pairSymbol;

    if (!pairSymbol) {
      setIsLoadingTick200(false);
      return;
    }

    // Флаг отмены при быстром переключении пар
    let cancelled = false;

    // === Выносим тяжёлую работу в setTimeout(0) чтобы браузер успел отрисовать loading ===
    const workTimeoutId = setTimeout(() => {
      if (cancelled) return;

      // Отключаем старый стрим
      if (tickStreamRef.current) {
        tickStreamRef.current.disconnect();
        tickStreamRef.current = null;
      }

      // Очищаем данные
      completedCandlesRef.current = [];
      currentCandleRef.current = null;
      currentTicksRef.current = [];
      setTickCount(0);
      setTotalCandlesCount(0);
      cumulativeDeltaRef.current = 0;
      cumulativeImbalanceRef.current = 0;
      candleIndexCounter = 0;
      lastImbalanceEmaRef.current = 0;
      currentImbalanceRef.current = 0;
      currentBidVolumeRef.current = 0;
      // Сбрасываем окно виртуализации
      loadedWindowRef.current = null;
      visibleRangeRef.current = null;
      lastRenderedRangeRef.current = null;
      currentAskVolumeRef.current = 0;
      
      if (seriesRef.current) {
        seriesRef.current.setData([]);
        seriesRef.current.applyOptions({
          priceFormat: {
            type: 'price',
            precision: 6,
            minMove: 0.000001,
          },
        });
      }
      if (barDeltaSeriesRef.current && barDeltaChartRef.current) {
        barDeltaSeriesRef.current.setData([]);
      }
      if (cumulativeDeltaLineSeriesRef.current && cumulativeDeltaChartRef.current) {
        cumulativeDeltaLineSeriesRef.current.setData([]);
      }
      if (cumulativeDeltaCandleSeriesRef.current && cumulativeDeltaChartRef.current) {
        cumulativeDeltaCandleSeriesRef.current.setData([]);
      }
      if (imbalanceTrendSeriesRef.current && imbalanceEmaSeriesRef.current && imbalanceChartRef.current) {
        imbalanceTrendSeriesRef.current.setData([]);
        imbalanceEmaSeriesRef.current.setData([]);
      }
      if (bidSeriesRef.current && askSeriesRef.current && bidAskHistogramChartRef.current) {
        bidSeriesRef.current.setData([]);
        askSeriesRef.current.setData([]);
      }
      if (bigOrderPressurePositiveRef.current && bigOrderPressureNegativeRef.current && bigOrderHistogramChartRef.current) {
        bigOrderPressurePositiveRef.current.setData([]);
        bigOrderPressureNegativeRef.current.setData([]);
      }
      if (liquidityImbalanceChartRef.current) {
        if (liquidityImbalanceShowLine && liquidityImbalanceSeriesRef.current) {
          liquidityImbalanceSeriesRef.current.setData([]);
        } else if (liquidityImbalanceHistogramPositiveRef.current && liquidityImbalanceHistogramNegativeRef.current) {
          liquidityImbalanceHistogramPositiveRef.current.setData([]);
          liquidityImbalanceHistogramNegativeRef.current.setData([]);
        }
      }
      
      bigOrderExcessDataRef.current = [];
      currentBigOrderPressureRef.current = 0;
      currentCandleBigOrderAccumulatorRef.current = {
        x1: { bid: 0, ask: 0 },
        x2: { bid: 0, ask: 0 },
        x3: { bid: 0, ask: 0 },
      };
      // Очищаем данные дисбаланса ликвидности
      liquidityImbalanceDataRef.current = [];
      currentLiquidityImbalanceRef.current = 0;
      previousLiquidityImbalanceRef.current = 0;
      setCurrentLiquidityImbalanceDisplay(0);
      
      hasReceivedTickRef.current = false;
      if (noDataTimeoutRef.current) {
        clearTimeout(noDataTimeoutRef.current);
        noDataTimeoutRef.current = null;
      }
      
      // Сбрасываем ценовую шкалу для новой пары
      if (chartRef.current) {
        chartRef.current.priceScale('right').applyOptions({
          autoScale: true,
        });
      }
      
      // Очищаем кеши при смене пары
      cachedTrendDataRef.current = null;
      cachedTrendDataLengthRef.current = 0;
      lastCandleCountRef.current = 0;
      // Очищаем debounce таймер
      if (loadDataDebounceRef.current) {
        clearTimeout(loadDataDebounceRef.current);
        loadDataDebounceRef.current = null;
      }
      
      // Очищаем маркеры imbalance и данные гистограммы крупных ордеров при смене пары
      imbalanceMarkersRef.current = [];
      bigOrderMarkersRef.current = [];
      lastBigOrderTimeRef.current = 0;
      bigOrderExcessDataRef.current = [];
      currentBigOrderPressureRef.current = 0;
      currentCandleBigOrderAccumulatorRef.current = {
        x1: { bid: 0, ask: 0 },
        x2: { bid: 0, ask: 0 },
        x3: { bid: 0, ask: 0 },
      };
      if (seriesRef.current) {
        try {
          seriesRef.current.setMarkers([]);
        } catch (e) {
          // Ignore
        }
      }

      if (cancelled) return;

      // Ждём готовности графика (без лишних задержек)
      const startStream = () => {
        if (cancelled) return;
        
        if (!chartRef.current || !seriesRef.current) {
          setTimeout(startStream, 16); // ~1 frame вместо 200ms
          return;
        }

        // Проверяем, что пара не изменилась пока ждали
        if (currentPairRef.current !== pairSymbol || cancelled) {
          return;
        }

        let isFirstData = true;
        const isBybit = selectedPair?.exchange === 'Bybit';
        
        // Обработчик тиков (общий для обеих бирж)
        const handleTick = (tick: TickData) => {
          // Проверяем, что пара всё ещё актуальна
          if (cancelled || currentPairRef.current !== pairSymbol) {
            return;
          }
          hasReceivedTickRef.current = true;
          // Очищаем таймаут и сообщение об ошибке при получении первого тика
          if (noDataTimeoutRef.current) {
            clearTimeout(noDataTimeoutRef.current);
            noDataTimeoutRef.current = null;
          }
          setTickChartError(null);

          currentTicksRef.current.push(tick);
          const count = currentTicksRef.current.length;
          tickCountRef.current = count;
          
          // ОПТИМИЗАЦИЯ: убран addTick - TickerSpeedIndicator имеет собственный tick stream
          
          // Обновляем UI счетчика реже (только на определенных тиках)
          if (count === 1 || count === 5 || count === 10 || count === 15 || count === ticksPerCandle) {
            setTickCount(count);
          }

          // Когда накопилось ровно 20 тиков - создаем свечу
          if (count === ticksPerCandle) {
            const ticksForCandle = currentTicksRef.current.slice(0, ticksPerCandle);
            const candle = createCandleFromTicks(ticksForCandle, true);
            
            if (candle) {
              completedCandlesRef.current.push(candle);
              // УБРАН ЖЁСТКИЙ ЛИМИТ: теперь храним всю историю с момента включения
              // Для очень длинных сессий (>200к свечей) можно включить очистку,
              // но для обычной торговой сессии памяти достаточно
              const MAX_HISTORY_CANDLES = 500000; // ~500к свечей = ~10М тиков = целый день активной торговли
              if (completedCandlesRef.current.length > MAX_HISTORY_CANDLES) {
                completedCandlesRef.current = completedCandlesRef.current.slice(-MAX_HISTORY_CANDLES);
                lastCandleCountRef.current = 0;
                liquidityImbalanceDataRef.current = liquidityImbalanceDataRef.current.slice(-MAX_HISTORY_CANDLES);
                // Сбрасываем загруженное окно, чтобы перезагрузить данные
                loadedWindowRef.current = null;
              }
              const candleIndex = completedCandlesRef.current.length;
              const candleTime = candleIndex as Time;
              liquidityImbalanceDataRef.current.push({
                time: candleTime,
                value: currentLiquidityImbalanceRef.current,
              });
              if (liquidityImbalanceDataRef.current.length > MAX_HISTORY_CANDLES) {
                liquidityImbalanceDataRef.current = liquidityImbalanceDataRef.current.slice(-MAX_HISTORY_CANDLES);
              }
              
              const storeState = useTradingStore.getState();
              const currentShowImbalanceMarkers = storeState.showImbalanceMarkers;
              const currentMinStrength = storeState.imbalanceMinStrength;
              const minStrengthThreshold = currentMinStrength / 100;
              
              const currentImbalance = candle.currentImbalance !== undefined 
                ? candle.currentImbalance 
                : currentImbalanceRef.current;
              const absImbalance = Math.abs(currentImbalance);
              
              if (currentShowImbalanceMarkers && absImbalance >= minStrengthThreshold) {
                const markerColor = getMarkerColor(currentImbalance);
                
                if (markerColor) {
                  const candleIndex = completedCandlesRef.current.length;
                  const candleTime = candleIndex as Time;
                  const markerStrength = absImbalance * 100;
                  imbalanceMarkersRef.current.push({
                    time: candleTime,
                    color: markerColor,
                    direction: currentImbalance > 0 ? 'long' : 'short',
                    strength: markerStrength,
                  });
                  if (imbalanceMarkersRef.current.length > 5000) {
                    imbalanceMarkersRef.current = imbalanceMarkersRef.current.slice(-5000);
                  }
                  updateAllMarkers();
                }
              }
              
              // Перевес x1, x2, x3 и давление (дисбаланс стакана) за свечу — пишем в гистограмму после закрытия
              const currentShowBigOrders = storeState.showBigOrders;
              if (currentShowBigOrders) {
                const acc = currentCandleBigOrderAccumulatorRef.current;
                // Давление = тот же дисбаланс, что и коричневый столбец (первые N уровней), чтобы всегда было видно
                const pressure = currentImbalanceRef.current;
                bigOrderExcessDataRef.current.push({
                  time: candleTime,
                  x1: acc.x1.bid - acc.x1.ask,
                  x2: acc.x2.bid - acc.x2.ask,
                  x3: acc.x3.bid - acc.x3.ask,
                  pressure,
                });
                if (bigOrderExcessDataRef.current.length > MAX_HISTORY_CANDLES) {
                  bigOrderExcessDataRef.current = bigOrderExcessDataRef.current.slice(-MAX_HISTORY_CANDLES);
                }
                currentCandleBigOrderAccumulatorRef.current = {
                  x1: { bid: 0, ask: 0 },
                  x2: { bid: 0, ask: 0 },
                  x3: { bid: 0, ask: 0 },
                };
              }
              
              if (pendingStoreUpdateRef.current) {
                clearTimeout(pendingStoreUpdateRef.current);
              }
              pendingStoreUpdateRef.current = setTimeout(() => {
                setTick200ChartData(completedCandlesRef.current.map((c) => ({
                  time: c.realTime,
                  open: c.open,
                  high: c.high,
                  low: c.low,
                  close: c.close,
                  volume: c.volume,
                  barDelta: c.barDelta,
                  cumulativeDelta: c.cumulativeDelta,
                  imbalanceTrend: c.imbalanceTrend,
                })));
                pendingStoreUpdateRef.current = null;
              }, 150);
            }
            
            currentCandleRef.current = null;
            currentTicksRef.current = [];
            tickCountRef.current = 0;
            setTickCount(0);
            // Обновляем счетчик общего количества свечей (не чаще чем раз в 10 свечей для производительности)
            if (completedCandlesRef.current.length % 10 === 0) {
              setTotalCandlesCount(completedCandlesRef.current.length);
            }
          } else {
            currentCandleRef.current = createCandleFromTicks(currentTicksRef.current, false);
          }

          const shouldFit = isFirstData;
          scheduleChartUpdate(shouldFit, isFirstData);
          if (isFirstData) {
            isFirstData = false;
            hasReceivedTickRef.current = true;
            setIsLoadingTick200(false);
            setTickChartError(null);
            if (noDataTimeoutRef.current) {
              clearTimeout(noDataTimeoutRef.current);
              noDataTimeoutRef.current = null;
            }
          }
        };

        // Создаём stream в зависимости от биржи
        let tickStream: BinanceTickStream | BybitTickStream;
        if (isBybit) {
          tickStream = new BybitTickStream(pairSymbol, handleTick);
        } else {
          tickStream = new BinanceTickStream(pairSymbol, handleTick);
        }

        tickStream.connect();
        tickStreamRef.current = tickStream;
        noDataTimeoutRef.current = setTimeout(() => {
          if (!hasReceivedTickRef.current && currentPairRef.current === pairSymbol) {
            setTickChartError('Нет данных по сделкам для этой пары. Пара может быть снята с торгов или неактивна.');
            setIsLoadingTick200(false);
          }
          noDataTimeoutRef.current = null;
        }, 25000);
      };

      // Запускаем сразу, без дополнительной задержки
      startStream();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(workTimeoutId);
      if (noDataTimeoutRef.current) {
        clearTimeout(noDataTimeoutRef.current);
        noDataTimeoutRef.current = null;
      }
      if (pendingStoreUpdateRef.current) {
        clearTimeout(pendingStoreUpdateRef.current);
        pendingStoreUpdateRef.current = null;
      }
      if (pendingUpdateRef.current) {
        cancelAnimationFrame(pendingUpdateRef.current);
        pendingUpdateRef.current = null;
      }
      if (tickStreamRef.current) {
        tickStreamRef.current.disconnect();
        tickStreamRef.current = null;
      }
    };
  }, [selectedPair?.symbol, selectedPair?.exchange, setIsLoadingTick200, scheduleChartUpdate, updateAllMarkers]);

  // Автоматическое расширение основного графика при выключении индикаторов
  useEffect(() => {
    const mainChart = chartContainerRef.current;
    if (!mainChart) return;
    
    // Проверяем, есть ли хотя бы один видимый индикатор
    const hasVisibleIndicators = showBarDeltaTick100 || showCumulativeDeltaTick100 || showImbalanceTrend || showBidAskHistogram || showBigOrders || showLiquidityImbalance;
    
    if (!hasVisibleIndicators) {
      // Если нет видимых индикаторов - сбрасываем фиксированную высоту, возвращаем flex: 1
      mainChart.style.height = '';
      mainChart.style.flex = '1';
      
      // Обновляем размер графика после сброса стилей
      requestAnimationFrame(() => {
        resizeAllCharts();
      });
    }
  }, [showBarDeltaTick100, showCumulativeDeltaTick100, showImbalanceTrend, showBidAskHistogram, showLiquidityImbalance, resizeAllCharts]);

  // ОПТИМИЗИРОВАНО: Очистка при размонтировании компонента
  useEffect(() => {
    return () => {
      if (pendingUpdateRef.current) {
        cancelAnimationFrame(pendingUpdateRef.current);
        pendingUpdateRef.current = null;
      }
    };
  }, []);

  // Синхронизация временной шкалы между графиками
  useEffect(() => {
    if (!chartRef.current) return;

    const timeScale = chartRef.current.timeScale();
    
    // ОПТИМИЗАЦИЯ: throttle для синхронизации через requestAnimationFrame
    let syncPending = false;
    let pendingRange: { from: number; to: number } | null = null;
    
    // Функция синхронизации всех индикаторов
    const syncAllCharts = (logicalRange: { from: number; to: number } | null) => {
      if (!logicalRange) return;
      
      pendingRange = logicalRange;
      
      if (!syncPending) {
        syncPending = true;
        requestAnimationFrame(() => {
          if (pendingRange) {
            // Синхронизация графика побарной дельты
            if (barDeltaChartRef.current) {
              try {
                barDeltaChartRef.current.timeScale().setVisibleLogicalRange(pendingRange);
              } catch (e) {
                // Ignore errors during sync
              }
            }
            // Синхронизация графика кумулятивной дельты
            if (cumulativeDeltaChartRef.current) {
              try {
                cumulativeDeltaChartRef.current.timeScale().setVisibleLogicalRange(pendingRange);
              } catch (e) {
                // Ignore errors during sync
              }
            }
            // Синхронизация графика Imbalance Trend (теперь интегрирован, как дельта)
            if (imbalanceChartRef.current) {
              try {
                imbalanceChartRef.current.timeScale().setVisibleLogicalRange(pendingRange);
              } catch (e) {
                // Ignore errors during sync
              }
            }
            // Синхронизация графика bid-ask гистограммы
            if (bidAskHistogramChartRef.current) {
              try {
                bidAskHistogramChartRef.current.timeScale().setVisibleLogicalRange(pendingRange);
              } catch (e) {
                // Ignore errors during sync
              }
            }
            // Синхронизация гистограммы перевеса крупных ордеров
            if (bigOrderHistogramChartRef.current) {
              try {
                bigOrderHistogramChartRef.current.timeScale().setVisibleLogicalRange(pendingRange);
              } catch (e) {
                // Ignore errors during sync
              }
            }
            // Синхронизация графика дисбаланса ликвидности
            if (liquidityImbalanceChartRef.current) {
              try {
                liquidityImbalanceChartRef.current.timeScale().setVisibleLogicalRange(pendingRange);
              } catch (e) {
                // Ignore errors during sync
              }
            }
          }
          syncPending = false;
        });
      }
    };
    
    // Используем subscribeVisibleLogicalRangeChange для точной синхронизации
    const unsubscribe = timeScale.subscribeVisibleLogicalRangeChange(syncAllCharts) as unknown as (() => void) | undefined;
    
    // Принудительная синхронизация при появлении графиков
    const currentRange = timeScale.getVisibleLogicalRange();
    if (currentRange) {
      syncAllCharts(currentRange);
    }

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [showBarDeltaTick100, showCumulativeDeltaTick100, showImbalanceTrend, showBidAskHistogram, showLiquidityImbalance]);

  // Отслеживание видимого диапазона для подгрузки свечей при скролле
  useEffect(() => {
    if (!chartRef.current) return;
    
    const timeScale = chartRef.current.timeScale();
    
    const handleVisibleRangeChange = (logicalRange: { from: number; to: number } | null) => {
      if (!logicalRange) {
        return;
      }
      
      // Всегда обновляем ref для актуальности
      visibleRangeRef.current = logicalRange;
      lastRenderedRangeRef.current = logicalRange;
      
      // Проверяем, нужно ли подгрузить данные (приближаемся к краю загруженного окна)
      const currentWindow = loadedWindowRef.current;
      if (!currentWindow) return;
      
      const fromIndex = Math.max(0, Math.floor(logicalRange.from) - 1);
      const toIndex = Math.min(completedCandlesRef.current.length - 1, Math.ceil(logicalRange.to) - 1);
      
      const BUFFER_SIZE = 2000;
      const needsReload = 
        fromIndex < currentWindow.from + BUFFER_SIZE / 2 || // Приближаемся к левому краю
        toIndex > currentWindow.to - BUFFER_SIZE / 2; // Приближаемся к правому краю
      
      if (needsReload && completedCandlesRef.current.length > 10000) {
        // Debounce для предотвращения частых перезагрузок при быстром скролле
        if (loadDataDebounceRef.current) {
          clearTimeout(loadDataDebounceRef.current);
        }
        loadDataDebounceRef.current = setTimeout(() => {
          console.log('[VisibleRange] 📥 Подгрузка данных для диапазона:', {
            visible: { from: fromIndex, to: toIndex },
            currentWindow,
            totalCandles: completedCandlesRef.current.length
          });
          scheduleChartUpdate(false, true);
        }, 150); // 150ms debounce
      }
    };
    
    const unsubscribe = timeScale.subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
    
    // Инициализируем текущий диапазон
    const currentRange = timeScale.getVisibleLogicalRange();
    if (currentRange) {
      visibleRangeRef.current = currentRange;
      lastRenderedRangeRef.current = currentRange;
    }
    
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [scheduleChartUpdate]);

  // Синхронизация crosshair (вертикальной линии) между всеми графиками
  // ОПТИМИЗАЦИЯ: добавляем throttle для синхронизации crosshair
  useEffect(() => {
    if (!chartRef.current) return;
    
    const mainChart = chartRef.current;
    let lastSyncTime = 0;
    
    // Функция синхронизации вертикальной линии crosshair на все дочерние графики
    const syncCrosshair = (param: any) => {
      // ОПТИМИЗАЦИЯ: throttle - синхронизируем не чаще чем раз в 32ms (~30fps)
      const now = performance.now();
      if (now - lastSyncTime < 32) return;
      lastSyncTime = now;
      
      const time = param.time;
      
      // Синхронизируем на график побарной дельты
      if (barDeltaChartRef.current && barDeltaSeriesRef.current) {
        if (time) {
          try {
            // Передаём 0 для value - горизонтальная линия скрыта
            barDeltaChartRef.current.setCrosshairPosition(0, time, barDeltaSeriesRef.current);
          } catch (e) {
            // Игнорируем ошибки
          }
        } else {
          barDeltaChartRef.current.clearCrosshairPosition();
        }
      }
      
      // Синхронизируем на график кумулятивной дельты
      const cdSeries = cumulativeDeltaLineSeriesRef.current || cumulativeDeltaCandleSeriesRef.current;
      if (cumulativeDeltaChartRef.current && cdSeries) {
        if (time) {
          try {
            cumulativeDeltaChartRef.current.setCrosshairPosition(0, time, cdSeries);
          } catch (e) {
            // Игнорируем ошибки
          }
        } else {
          cumulativeDeltaChartRef.current.clearCrosshairPosition();
        }
      }
      
      // Синхронизируем на график Imbalance Trend
      if (imbalanceChartRef.current && imbalanceTrendSeriesRef.current) {
        if (time) {
          try {
            imbalanceChartRef.current.setCrosshairPosition(0, time, imbalanceTrendSeriesRef.current);
          } catch (e) {
            // Игнорируем ошибки
          }
        } else {
          imbalanceChartRef.current.clearCrosshairPosition();
        }
      }

      // Синхронизируем на график Bid-Ask гистограммы
      if (bidAskHistogramChartRef.current && bidSeriesRef.current) {
        if (time) {
          try {
            bidAskHistogramChartRef.current.setCrosshairPosition(0, time, bidSeriesRef.current);
          } catch (e) {
            // Игнорируем ошибки
          }
        } else {
          bidAskHistogramChartRef.current.clearCrosshairPosition();
        }
      }

      // Синхронизируем на гистограмму давления (покуп/продаж)
      const bigOrderSeries = bigOrderPressurePositiveRef.current || bigOrderPressureNegativeRef.current;
      if (bigOrderHistogramChartRef.current && bigOrderSeries) {
        if (time) {
          try {
            bigOrderHistogramChartRef.current.setCrosshairPosition(0, time, bigOrderSeries);
          } catch (e) {
            // Игнорируем ошибки
          }
        } else {
          bigOrderHistogramChartRef.current.clearCrosshairPosition();
        }
      }

      // Синхронизируем на график Дисбаланса ликвидности
      if (liquidityImbalanceChartRef.current && liquidityImbalanceSeriesRef.current) {
        if (time) {
          try {
            liquidityImbalanceChartRef.current.setCrosshairPosition(0, time, liquidityImbalanceSeriesRef.current);
          } catch (e) {
            // Игнорируем ошибки
          }
        } else {
          liquidityImbalanceChartRef.current.clearCrosshairPosition();
        }
      }
    };
    
    const unsubscribe = mainChart.subscribeCrosshairMove(syncCrosshair) as unknown as (() => void) | undefined;
    
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [showBarDeltaTick100, showCumulativeDeltaTick100, showImbalanceTrend, showBidAskHistogram, showLiquidityImbalance]);

  // Перерисовка крупных ордеров при изменении видимого диапазона или скролле
  // ОПТИМИЗАЦИЯ: убираем subscribeCrosshairMove - перерисовка нужна только при изменении масштаба
  useEffect(() => {
    if (!chartRef.current || !showBigOrders) return;
    
    const chart = chartRef.current;
    
    // ОПТИМИЗАЦИЯ: throttle для перерисовки (не чаще чем 60fps)
    let drawPending = false;
    const throttledDrawBigOrders = () => {
      if (!drawPending) {
        drawPending = true;
        requestAnimationFrame(() => {
          drawBigOrders();
          drawPending = false;
        });
      }
    };
    
    // Перерисовываем при изменении видимого диапазона
    const handleTimeRangeChange = () => {
      throttledDrawBigOrders();
    };
    
    chart.timeScale().subscribeVisibleTimeRangeChange(handleTimeRangeChange);
    // ОПТИМИЗАЦИЯ: убран subscribeCrosshairMove - не нужен для отрисовки ордеров
    
    // Начальная отрисовка
    setTimeout(drawBigOrders, 100);
    
    return () => {
      try {
        chart.timeScale().unsubscribeVisibleTimeRangeChange(handleTimeRangeChange);
      } catch (e) {
        // Игнорируем ошибки при отписке
      }
    };
  }, [showBigOrders, drawBigOrders]);

  if (!selectedPair) {
    return (
      <div className="chart-container" style={{ width: '100%', height: '100%' }}>
        <div className="chart-placeholder">Выберите пару для отображения графика</div>
      </div>
    );
  }

  return (
    <div className="chart-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* Основной график */}
      <div 
        ref={chartContainerRef} 
        style={{ 
          width: '100%', 
          flex: 1,
          minHeight: '150px',
          position: 'relative',
          overflow: 'hidden'
        }} 
      >
        {/* Панель инструментов рисования */}
        <DrawingToolbar
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          onClear={clearAllDrawings}
          hasDrawings={drawings.length > 0}
        />
        
        {/* Canvas для отрисовки крупных лимитных ордеров */}
        {showBigOrders && (
          <canvas
            ref={bigOrdersCanvasRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          />
        )}
      </div>
      
      {/* Компактный счетчик тиков и истории */}
      <div
        style={{
          position: 'absolute',
          top: '48px',
          right: '60px',
          padding: '4px 8px',
          fontSize: '0.75rem',
          fontFamily: 'JetBrains Mono, monospace',
          fontWeight: 600,
          color: tickCount >= 16 ? '#f0b90b' : '#c9d1d9',
          zIndex: 10,
          pointerEvents: 'none',
          textShadow: '0 0 4px rgba(0, 0, 0, 0.9)',
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
        }}
      >
        <span>{tickCount}/{ticksPerCandle}</span>
        {totalCandlesCount > 0 && (
          <span style={{ color: '#58a6ff', fontSize: '0.7rem' }} title="Всего свечей в истории">
            📊 {totalCandlesCount.toLocaleString()}
          </span>
        )}
      </div>
      
      {/* График побарной дельты */}
      {showBarDeltaTick100 && (
        <div ref={barDeltaPanelRef} style={{ height: '120px', minHeight: '80px', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div 
            onMouseDown={(e) => handlePanelResize(e, barDeltaPanelRef)}
            style={{ 
              padding: '4px 8px', 
              fontSize: '0.7rem', 
              color: 'var(--text-muted)', 
              background: 'var(--bg-card)',
              cursor: 'ns-resize',
              userSelect: 'none',
              borderTop: '1px solid var(--border)',
              flexShrink: 0,
            }}
          >
            Побарная дельта
          </div>
          <div ref={barDeltaContainerRef} style={{ width: '100%', flex: 1, minHeight: 0, overflow: 'hidden' }} />
        </div>
      )}
      
      {/* График кумулятивной дельты */}
      {showCumulativeDeltaTick100 && (
        <div ref={cumulativeDeltaPanelRef} style={{ height: '120px', minHeight: '80px', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div 
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              handlePanelResize(e, cumulativeDeltaPanelRef);
            }}
            style={{ 
              padding: '4px 8px', 
              fontSize: '0.7rem', 
              color: 'var(--text-muted)', 
              background: 'var(--bg-card)',
              cursor: 'ns-resize',
              userSelect: 'none',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexShrink: 0,
            }}
          >
            <span>Кумулятивная дельта</span>
            {showCumulativeDeltaTrendTick200 && (
              <span style={{ 
                color: '#f0b90b', 
                fontSize: '0.6rem',
                padding: '1px 4px',
                background: 'rgba(240, 185, 11, 0.15)',
                borderRadius: '3px',
              }}>
                + Тренд ({cumulativeDeltaTrendPeriodTick200})
              </span>
            )}
            <button
              onClick={() => setIsCDSettingsOpen(true)}
              style={{
                marginLeft: 'auto',
                background: 'rgba(240, 185, 11, 0.1)',
                border: '1px solid rgba(240, 185, 11, 0.3)',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '0.6rem',
                color: '#f0b90b',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              ⚙️ Настройки
            </button>
          </div>
          <div ref={cumulativeDeltaContainerRef} style={{ width: '100%', flex: 1, minHeight: 0, overflow: 'hidden' }} />
        </div>
      )}
      
      {/* Индикатор Imbalance Trend */}
      {showImbalanceTrend && (
        <div ref={imbalancePanelRef} style={{ height: '120px', minHeight: '80px', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div 
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              handlePanelResize(e, imbalancePanelRef);
            }}
            style={{ 
              padding: '4px 8px', 
              fontSize: '0.7rem', 
              color: 'var(--text-muted)', 
              background: 'var(--bg-card)', 
              display: 'flex', 
              alignItems: 'center',
              gap: '8px',
              cursor: 'ns-resize',
              userSelect: 'none',
              borderTop: '1px solid var(--border)',
              flexShrink: 0,
            }}
          >
            <span>Imbalance Trend</span>
            <span style={{ 
              color: '#00d4ff', 
              fontSize: '0.6rem',
              padding: '1px 4px',
              background: 'rgba(0, 212, 255, 0.15)',
              borderRadius: '3px',
            }}>
              {imbalanceLevels} lvl × {imbalanceMultiplier}
            </span>
            {showImbalanceEma && (
              <span style={{ 
                color: '#f0b90b', 
                fontSize: '0.6rem',
                padding: '1px 4px',
                background: 'rgba(240, 185, 11, 0.15)',
                borderRadius: '3px',
              }}>
                EMA({imbalanceEmaPeriod})
              </span>
            )}
            {imbalanceHeatMap && (
              <span style={{ 
                color: '#FFB3BA', 
                fontSize: '0.6rem',
                padding: '1px 4px',
                background: 'rgba(255, 179, 186, 0.2)',
                borderRadius: '3px',
                border: '1px solid rgba(255, 179, 186, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
              }}>
                🔥 Heat
              </span>
            )}
            {showImbalanceMarkers && (
              <>
                <span style={{ 
                  color: '#90EE90', 
                  fontSize: '0.6rem',
                  padding: '1px 4px',
                  background: 'rgba(144, 238, 144, 0.2)',
                  borderRadius: '3px',
                  border: '1px solid rgba(144, 238, 144, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                }}>
                  📍 Markers
                </span>
                <span style={{ 
                  color: '#ffc107', 
                  fontSize: '0.6rem',
                  padding: '1px 4px',
                  background: 'rgba(255, 193, 7, 0.2)',
                  borderRadius: '3px',
                  border: '1px solid rgba(255, 193, 7, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                }}>
                  💪{imbalanceMinStrength}%
                </span>
              </>
            )}
            <span style={{ 
              marginLeft: 'auto', 
              color: currentImbalanceDisplay >= 0 ? '#3fb950' : '#f85149',
              fontWeight: 600,
            }}>
              {(currentImbalanceDisplay * 100).toFixed(1)}%
            </span>
            <button
              onClick={() => setIsImbalanceSettingsOpen(true)}
              title="Настройки индикатора Imbalance Trend"
              style={{
                background: 'rgba(0, 212, 255, 0.1)',
                border: '1px solid rgba(0, 212, 255, 0.3)',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '0.6rem',
                color: '#00d4ff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(0, 212, 255, 0.2)';
                e.currentTarget.style.borderColor = 'rgba(0, 212, 255, 0.5)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(0, 212, 255, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(0, 212, 255, 0.3)';
              }}
            >
              ⚙️ Настройки
            </button>
          </div>
          <div ref={imbalanceContainerRef} style={{ width: '100%', flex: 1, minHeight: 0, overflow: 'hidden' }} />
        </div>
      )}
      
      {/* Гистограмма Bid-Ask */}
      {showBidAskHistogram && (
        <div ref={bidAskHistogramPanelRef} style={{ height: '120px', minHeight: '80px', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div 
            onMouseDown={(e) => handlePanelResize(e, bidAskHistogramPanelRef)}
            style={{ 
              padding: '4px 8px', 
              fontSize: '0.7rem', 
              color: 'var(--text-muted)', 
              background: 'var(--bg-card)',
              cursor: 'ns-resize',
              userSelect: 'none',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexShrink: 0,
            }}
          >
            <span>Bid-Ask Гистограмма</span>
            <div style={{ 
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '12px', height: '12px', background: '#089981', borderRadius: '2px' }} />
                <span style={{ fontSize: '0.6rem' }}>Bid</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '12px', height: '12px', background: '#f2385a', borderRadius: '2px' }} />
                <span style={{ fontSize: '0.6rem' }}>Ask</span>
              </div>
            </div>
          </div>
          <div ref={bidAskHistogramContainerRef} style={{ width: '100%', flex: 1, minHeight: 0, overflow: 'hidden' }} />
        </div>
      )}
      
      {/* Давление стакана: сверху покуп, снизу продаж. Одна шкала −100%..+100% на всех монетах. */}
      {showBigOrders && (
        <div ref={bigOrderHistogramPanelRef} style={{ height: '120px', minHeight: '80px', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div
            onMouseDown={(e) => handlePanelResize(e, bigOrderHistogramPanelRef)}
            style={{
              padding: '4px 8px',
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              background: 'var(--bg-card)',
              cursor: 'ns-resize',
              userSelect: 'none',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              flexShrink: 0,
            }}
          >
            <span>Давление стакана</span>
            <span style={{ fontSize: '0.6rem', opacity: 0.8 }} title="Уровней стакана для этой пары">
              {selectedPair ? getAdaptiveDepthLevels(selectedPair.symbol) : 20} lvl
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '12px', height: '8px', background: '#26a69a', borderRadius: '2px' }} />
                <span style={{ fontSize: '0.65rem' }}>покуп ↑</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '12px', height: '8px', background: '#c17817', borderRadius: '2px' }} />
                <span style={{ fontSize: '0.65rem' }}>продаж ↓</span>
              </div>
            </div>
          </div>
          <div ref={bigOrderHistogramContainerRef} style={{ width: '100%', flex: 1, minHeight: 0, overflow: 'hidden' }} />
        </div>
      )}
      
      {/* Индикатор Дисбаланса ликвидности */}
      {showLiquidityImbalance && (
        <div ref={liquidityImbalancePanelRef} style={{ height: '120px', minHeight: '80px', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div 
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              handlePanelResize(e, liquidityImbalancePanelRef);
            }}
            style={{ 
              padding: '4px 8px', 
              fontSize: '0.7rem', 
              color: 'var(--text-muted)', 
              background: 'var(--bg-card)',
              cursor: 'ns-resize',
              userSelect: 'none',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexShrink: 0,
            }}
          >
            <span>Дисбаланс ликвидности</span>
            <span style={{ 
              color: '#3b82f6', 
              fontSize: '0.6rem',
              padding: '1px 4px',
              background: 'rgba(59, 130, 246, 0.15)',
              borderRadius: '3px',
            }}>
              {liquidityImbalanceDepthPercent.toFixed(1)}%
            </span>
            <span style={{ 
              marginLeft: 'auto', 
              color: currentLiquidityImbalanceDisplay >= 0 ? '#3b82f6' : '#fbbf24',
              fontWeight: 600,
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: '0.7rem',
            }}>
              {currentLiquidityImbalanceDisplay >= 0 ? '+' : ''}{currentLiquidityImbalanceDisplay.toFixed(2)}
            </span>
            <button
              onClick={() => setIsLiquidityImbalanceSettingsOpen(true)}
              title="Настройки индикатора Дисбаланса ликвидности"
              style={{
                background: 'rgba(8, 153, 129, 0.1)',
                border: '1px solid rgba(8, 153, 129, 0.3)',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '0.6rem',
                color: '#089981',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(8, 153, 129, 0.2)';
                e.currentTarget.style.borderColor = 'rgba(8, 153, 129, 0.5)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(8, 153, 129, 0.1)';
                e.currentTarget.style.borderColor = 'rgba(8, 153, 129, 0.3)';
              }}
            >
              ⚙️ Настройки
            </button>
          </div>
          <div ref={liquidityImbalanceContainerRef} style={{ width: '100%', flex: 1, minHeight: 0, overflow: 'hidden' }} />
        </div>
      )}
      
      {tickChartError && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '12px 16px',
            background: 'rgba(22, 27, 34, 0.95)',
            borderRadius: '6px',
            fontSize: '0.8rem',
            color: '#f85149',
            zIndex: 10,
            maxWidth: '320px',
            textAlign: 'center',
          }}
        >
          {tickChartError}
        </div>
      )}
      
      {isLoadingTick200 && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '8px 12px',
            background: 'rgba(22, 27, 34, 0.9)',
            borderRadius: '6px',
            fontSize: '0.75rem',
            color: '#c9d1d9',
            zIndex: 10,
          }}
        >
          Ожидание тиков...
        </div>
      )}
      
      {/* Модальное окно настроек КД */}
      <CumulativeDeltaSettingsModalTick200 
        isOpen={isCDSettingsOpen} 
        onClose={() => setIsCDSettingsOpen(false)} 
      />
      
      {/* Модальное окно настроек Imbalance */}
      <ImbalanceSettingsModal 
        isOpen={isImbalanceSettingsOpen} 
        onClose={() => setIsImbalanceSettingsOpen(false)} 
      />
      
      {/* Модальное окно настроек Дисбаланса ликвидности */}
      <LiquidityImbalanceSettingsModal 
        isOpen={isLiquidityImbalanceSettingsOpen} 
        onClose={() => setIsLiquidityImbalanceSettingsOpen(false)} 
      />
    </div>
  );
}
