'use client';

import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { useTradingStore, usePriceLevelsStore, useActiveAlertsStore } from '@/store/useTradingStore';
import {
  getAllPairsWithTrades,
  getBtcReturns,
  calculateCorrelationWithBtc,
  getCorrelationStrength,
  type AnalyticsPair,
} from '@/lib/correlation';

type SortField = 'priceChangePercent' | 'count' | 'correlation' | 'quoteVolume' | 'volatility' | 'alert';
type SortDirection = 'asc' | 'desc';

// CSS анимация для активных алертов + стили hover через CSS
const sidebarStyles = `
@keyframes alertPulse {
  0%, 100% { 
    box-shadow: 0 0 4px rgba(240, 185, 11, 0.3);
    border-color: rgba(240, 185, 11, 0.5);
  }
  50% { 
    box-shadow: 0 0 12px rgba(240, 185, 11, 0.8);
    border-color: rgba(240, 185, 11, 1);
  }
}
@keyframes bellRing {
  0% { transform: rotate(0deg) scale(1); }
  10% { transform: rotate(25deg) scale(1.3); }
  20% { transform: rotate(-20deg) scale(1.3); }
  30% { transform: rotate(18deg) scale(1.2); }
  40% { transform: rotate(-15deg) scale(1.2); }
  50% { transform: rotate(10deg) scale(1.1); }
  60% { transform: rotate(-8deg) scale(1.1); }
  70% { transform: rotate(4deg) scale(1.05); }
  80% { transform: rotate(0deg) scale(1); }
  100% { transform: rotate(0deg) scale(1); }
}
.analytics-pair-row {
  display: grid;
  grid-template-columns: 24px 80px 65px 60px 50px 50px 50px;
  gap: 4px;
  padding: 6px 12px;
  font-size: 0.75rem;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  transition: background 0.1s;
  background: transparent;
}
.analytics-pair-row:hover {
  background: var(--bg-elevated) !important;
}
.analytics-pair-row.selected {
  background: rgba(139, 148, 158, 0.15);
  border-left: 2px solid rgba(139, 148, 158, 0.6);
}
.analytics-pair-row.alert-active {
  animation: alertPulse 1s infinite;
  border: 1px solid rgba(240, 185, 11, 0.5);
  border-radius: 4px;
  margin: 2px 4px;
  background: rgba(240, 185, 11, 0.05);
}
.analytics-bell-ring {
  animation: bellRing 1.2s ease-in-out infinite;
  color: #f0b90b;
  filter: drop-shadow(0 0 4px rgba(240, 185, 11, 0.8));
  transform-origin: top center;
}
`;

// Вспомогательные функции форматирования (вынесены для мемоизации)
const formatVolume = (volume: string) => {
  const num = parseFloat(volume);
  if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(0)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(0)}K`;
  return num.toFixed(0);
};

const formatChange = (change: string) => {
  const num = parseFloat(change);
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
};

const formatCount = (count: number) => {
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(0)}K`;
  return count.toString();
};

// ОПТИМИЗАЦИЯ: Мемоизированный компонент строки
interface PairRowProps {
  pair: AnalyticsPair;
  isSelected: boolean;
  isAlertActive: boolean;
  hasLevels: boolean;
  levelsCount: number;
  onSelect: (pair: AnalyticsPair) => void;
}

const PairRow = memo(function PairRow({ 
  pair, 
  isSelected, 
  isAlertActive, 
  hasLevels, 
  levelsCount,
  onSelect 
}: PairRowProps) {
  const change = parseFloat(pair.priceChangePercent);
  const isPositive = change >= 0;
  const corrStrength = pair.correlation !== undefined ? getCorrelationStrength(pair.correlation) : null;
  
  // Определяем CSS классы
  let rowClass = 'analytics-pair-row';
  if (isSelected && !isAlertActive) rowClass += ' selected';
  if (isAlertActive) rowClass += ' alert-active';
  
  return (
    <div
      className={rowClass}
      onClick={() => onSelect(pair)}
    >
      {/* Колокольчик (уровни) */}
      <div style={{ 
        textAlign: 'center',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {hasLevels && (
          <span 
            title={`${levelsCount} уровней`}
            className={isAlertActive ? 'analytics-bell-ring' : ''}
            style={{
              fontSize: '0.85rem',
              color: isAlertActive ? '#f0b90b' : 'var(--text-muted)',
            }}
          >
            🔔
          </span>
        )}
      </div>
      
      {/* Монета */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ fontWeight: 600 }}>{pair.symbol.replace('USDT', '')}</span>
        {pair.exchange === 'Binance' && (
          <span style={{
            fontSize: '0.55rem',
            padding: '1px 3px',
            borderRadius: '2px',
            background: 'rgba(240, 185, 11, 0.15)',
            color: '#f0b90b',
            fontWeight: 500,
          }}>BN</span>
        )}
        {pair.exchange === 'Bybit' && (
          <span style={{
            fontSize: '0.55rem',
            padding: '1px 3px',
            borderRadius: '2px',
            background: 'rgba(242, 153, 74, 0.2)',
            color: '#f2994a',
            fontWeight: 500,
          }}>BB</span>
        )}
      </div>
      
      {/* Объём */}
      <div style={{ textAlign: 'right', fontFamily: 'monospace' }}>
        {formatVolume(pair.quoteVolume)}$
      </div>
      
      {/* Изменение цены */}
      <div style={{
        textAlign: 'right',
        fontFamily: 'monospace',
        fontWeight: 600,
        color: isPositive ? '#089981' : '#f23645',
      }}>
        {formatChange(pair.priceChangePercent)}
      </div>
      
      {/* Корреляция */}
      <div style={{
        textAlign: 'right',
        fontFamily: 'monospace',
        color: corrStrength?.color || 'var(--text-muted)',
      }}>
        {pair.correlationLoading ? '...' : 
          pair.correlation !== undefined ? `${(pair.correlation * 100).toFixed(0)}%` : '—'}
      </div>
      
      {/* Волатильность */}
      <div style={{ textAlign: 'right', fontFamily: 'monospace' }}>
        {Math.abs(change).toFixed(1)}%
      </div>
      
      {/* Сделки */}
      <div style={{
        textAlign: 'right',
        fontFamily: 'monospace',
        color: pair.count === 0 ? 'var(--text-muted)' : 'inherit',
      }}>
        {pair.count === 0 ? '—' : formatCount(pair.count)}
      </div>
    </div>
  );
});

// ОПТИМИЗАЦИЯ: Константы для виртуализации
const ROW_HEIGHT = 32; // Высота строки в пикселях
const OVERSCAN = 10; // Количество дополнительных строк сверху/снизу

export default function AnalyticsSidebar() {
  // ОПТИМИЗАЦИЯ: Выборочные подписки на store
  const showAnalyticsSidebar = useTradingStore((state) => state.showAnalyticsSidebar);
  const setShowAnalyticsSidebar = useTradingStore((state) => state.setShowAnalyticsSidebar);
  const setSelectedPair = useTradingStore((state) => state.setSelectedPair);
  const selectedPairSymbol = useTradingStore((state) => state.selectedPair?.symbol);
  
  const allLevels = usePriceLevelsStore((state) => state.levels);
  const activeAlerts = useActiveAlertsStore((state) => state.alerts);
  
  const [pairs, setPairs] = useState<AnalyticsPair[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>('priceChangePercent');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [correlationsLoaded, setCorrelationsLoaded] = useState(0);
  
  // ОПТИМИЗАЦИЯ: Виртуализация - отслеживаем скролл
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  // ОПТИМИЗАЦИЯ: Кэш для активных алертов
  const activeAlertSymbols = useMemo(() => {
    return new Set(activeAlerts.map(a => a.symbol));
  }, [activeAlerts]);

  // Загрузка данных
  const loadData = useCallback(async () => {
    if (!showAnalyticsSidebar) return;
    
    setIsLoading(true);
    setCorrelationsLoaded(0);
    
    try {
      const allPairs = await getAllPairsWithTrades();
      setPairs(allPairs);
      setIsLoading(false);
      
      // Загружаем корреляции в фоне
      const btcReturns = await getBtcReturns();
      const BATCH_SIZE = 10;
      const topPairs = allPairs.slice(0, 50);
      
      for (let i = 0; i < topPairs.length; i += BATCH_SIZE) {
        const batch = topPairs.slice(i, i + BATCH_SIZE);
        
        const correlationPromises = batch.map(async (pair) => {
          const correlation = await calculateCorrelationWithBtc(pair.symbol, btcReturns, pair.exchange);
          return { symbol: pair.symbol, correlation };
        });
        
        const results = await Promise.all(correlationPromises);
        
        setPairs(prevPairs => {
          const updated = [...prevPairs];
          for (const result of results) {
            const index = updated.findIndex(p => p.symbol === result.symbol);
            if (index !== -1) {
              updated[index] = {
                ...updated[index],
                correlation: result.correlation,
                correlationLoading: false,
              };
            }
          }
          return updated;
        });
        
        setCorrelationsLoaded(prev => prev + batch.length);
        
        if (i + BATCH_SIZE < topPairs.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    } catch (err) {
      console.error('Error loading analytics:', err);
      setIsLoading(false);
    }
  }, [showAnalyticsSidebar]);

  useEffect(() => {
    if (showAnalyticsSidebar) {
      loadData();
    }
  }, [showAnalyticsSidebar, loadData]);

  // ОПТИМИЗАЦИЯ: Мемоизированная сортировка
  const sortedPairs = useMemo(() => {
    return [...pairs].sort((a, b) => {
      let aVal: number;
      let bVal: number;
      
      switch (sortField) {
        case 'alert':
          aVal = activeAlertSymbols.has(a.symbol) ? 1 : 0;
          bVal = activeAlertSymbols.has(b.symbol) ? 1 : 0;
          if (aVal !== bVal) return sortDirection === 'desc' ? bVal - aVal : aVal - bVal;
          aVal = (allLevels[a.symbol]?.length || 0);
          bVal = (allLevels[b.symbol]?.length || 0);
          break;
        case 'priceChangePercent':
          aVal = parseFloat(a.priceChangePercent);
          bVal = parseFloat(b.priceChangePercent);
          break;
        case 'volatility':
          aVal = Math.abs(parseFloat(a.priceChangePercent));
          bVal = Math.abs(parseFloat(b.priceChangePercent));
          break;
        case 'count':
          aVal = a.count;
          bVal = b.count;
          break;
        case 'correlation':
          aVal = a.correlation ?? 0;
          bVal = b.correlation ?? 0;
          break;
        case 'quoteVolume':
          aVal = parseFloat(a.quoteVolume);
          bVal = parseFloat(b.quoteVolume);
          break;
        default:
          return 0;
      }
      
      return sortDirection === 'desc' ? bVal - aVal : aVal - bVal;
    });
  }, [pairs, sortField, sortDirection, activeAlertSymbols, allLevels]);

  const handleSort = useCallback((field: SortField) => {
    setSortField(prev => {
      if (prev === field) {
        setSortDirection(d => d === 'desc' ? 'asc' : 'desc');
        return prev;
      }
      setSortDirection('desc');
      return field;
    });
  }, []);

  // ОПТИМИЗАЦИЯ: Синхронный обработчик - НЕ делаем лишний API запрос
  // Все нужные данные уже есть в AnalyticsPair
  const handlePairClick = useCallback((pair: AnalyticsPair) => {
    setSelectedPair({
      symbol: pair.symbol,
      price: pair.price,
      priceChange: '0',
      priceChangePercent: pair.priceChangePercent,
      volume: pair.volume,
      quoteVolume: pair.quoteVolume,
      exchange: pair.exchange,
    });
  }, [setSelectedPair]);

  // ОПТИМИЗАЦИЯ: Throttled scroll handler
  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      setScrollTop(scrollContainerRef.current.scrollTop);
    }
  }, []);

  // Обновляем высоту контейнера при маунте
  useEffect(() => {
    if (scrollContainerRef.current) {
      setContainerHeight(scrollContainerRef.current.clientHeight);
      
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerHeight(entry.contentRect.height);
        }
      });
      
      resizeObserver.observe(scrollContainerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, [showAnalyticsSidebar]);

  // ОПТИМИЗАЦИЯ: Вычисляем видимые строки
  const { visiblePairs, startIndex, totalHeight, offsetY } = useMemo(() => {
    const totalHeight = sortedPairs.length * ROW_HEIGHT;
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT) + 2 * OVERSCAN;
    const endIndex = Math.min(sortedPairs.length, startIndex + visibleCount);
    const offsetY = startIndex * ROW_HEIGHT;
    
    return {
      visiblePairs: sortedPairs.slice(startIndex, endIndex),
      startIndex,
      totalHeight,
      offsetY,
    };
  }, [sortedPairs, scrollTop, containerHeight]);

  if (!showAnalyticsSidebar) return null;

  return (
    <div className="analytics-sidebar">
      {/* Инжектим CSS стили */}
      <style>{sidebarStyles}</style>
      
      {/* Заголовок */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--bg-elevated)',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
          📊 Аналитика {correlationsLoaded > 0 && correlationsLoaded < 50 && `(${correlationsLoaded}/50)`}
        </span>
        <button
          onClick={() => setShowAnalyticsSidebar(false)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontSize: '1.2rem',
            padding: '4px',
          }}
        >
          ✕
        </button>
      </div>
      
      {/* Заголовки столбцов */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '24px 80px 65px 60px 50px 50px 50px',
        gap: '4px',
        padding: '8px 12px',
        fontSize: '0.7rem',
        color: 'var(--text-muted)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-main)',
        flexShrink: 0,
      }}>
        <div 
          onClick={() => handleSort('alert')}
          style={{ textAlign: 'center', cursor: 'pointer' }} 
          title="Сортировка по алертам"
        >🔔{sortField === 'alert' ? (sortDirection === 'desc' ? '▼' : '▲') : ''}</div>
        <div>Монета</div>
        <div 
          onClick={() => handleSort('quoteVolume')}
          style={{ cursor: 'pointer', textAlign: 'right' }}
        >
          Объём {sortField === 'quoteVolume' && (sortDirection === 'desc' ? '▼' : '▲')}
        </div>
        <div 
          onClick={() => handleSort('priceChangePercent')}
          style={{ cursor: 'pointer', textAlign: 'right' }}
        >
          Цена {sortField === 'priceChangePercent' && (sortDirection === 'desc' ? '▼' : '▲')}
        </div>
        <div 
          onClick={() => handleSort('correlation')}
          style={{ cursor: 'pointer', textAlign: 'right' }}
        >
          Корр {sortField === 'correlation' && (sortDirection === 'desc' ? '▼' : '▲')}
        </div>
        <div 
          onClick={() => handleSort('volatility')}
          style={{ cursor: 'pointer', textAlign: 'right' }}
        >
          Вол {sortField === 'volatility' && (sortDirection === 'desc' ? '▼' : '▲')}
        </div>
        <div 
          onClick={() => handleSort('count')}
          style={{ cursor: 'pointer', textAlign: 'right' }}
        >
          Сдел {sortField === 'count' && (sortDirection === 'desc' ? '▼' : '▲')}
        </div>
      </div>
      
      {/* ОПТИМИЗАЦИЯ: Виртуализированный список пар */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', position: 'relative' }}
      >
        {isLoading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Загрузка...
          </div>
        ) : (
          <div style={{ height: totalHeight, position: 'relative' }}>
            <div style={{ transform: `translateY(${offsetY}px)` }}>
              {visiblePairs.map((pair) => {
                const pairLevels = allLevels[pair.symbol] || [];
                const hasLevels = pairLevels.length > 0;
                const isAlertActive = activeAlertSymbols.has(pair.symbol);
                const isSelected = selectedPairSymbol === pair.symbol;
                
                return (
                  <PairRow
                    key={pair.symbol}
                    pair={pair}
                    isSelected={isSelected}
                    isAlertActive={isAlertActive}
                    hasLevels={hasLevels}
                    levelsCount={pairLevels.length}
                    onSelect={handlePairClick}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
