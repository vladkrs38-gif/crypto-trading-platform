'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTradingStore } from '@/store/useTradingStore';
import {
  getAllPairsWithTrades,
  getBtcReturns,
  calculateCorrelationWithBtc,
  getCorrelationStrength,
  type AnalyticsPair,
  type Exchange,
} from '@/lib/correlation';

type SortField = 'priceChangePercent' | 'count' | 'correlation' | 'quoteVolume';
type SortDirection = 'asc' | 'desc';

export default function AnalyticsPage() {
  const router = useRouter();
  const { setSelectedPair } = useTradingStore();
  
  const [pairs, setPairs] = useState<AnalyticsPair[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('priceChangePercent');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [displayCount, setDisplayCount] = useState(30);
  const [correlationsLoaded, setCorrelationsLoaded] = useState(0);

  // Загрузка данных
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setCorrelationsLoaded(0);
    
    try {
      // Получаем все пары
      const allPairs = await getAllPairsWithTrades();
      setPairs(allPairs);
      setIsLoading(false);
      
      // Загружаем BTC returns один раз
      const btcReturns = await getBtcReturns();
      
      // Загружаем корреляции параллельно (с ограничением concurrency)
      const BATCH_SIZE = 10;
      const topPairs = allPairs.slice(0, displayCount + 20); // Берём с запасом для сортировки
      
      for (let i = 0; i < topPairs.length; i += BATCH_SIZE) {
        const batch = topPairs.slice(i, i + BATCH_SIZE);
        
        const correlationPromises = batch.map(async (pair) => {
          const correlation = await calculateCorrelationWithBtc(pair.symbol, btcReturns, pair.exchange);
          return { symbol: pair.symbol, correlation };
        });
        
        const results = await Promise.all(correlationPromises);
        
        // Обновляем state с корреляциями
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
        
        // Небольшая задержка между батчами для избежания rate limit
        if (i + BATCH_SIZE < topPairs.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    } catch (err) {
      setError('Ошибка загрузки данных');
      console.error(err);
      setIsLoading(false);
    }
  }, [displayCount]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Сортировка пар
  const sortedPairs = [...pairs].sort((a, b) => {
    let aVal: number;
    let bVal: number;
    
    switch (sortField) {
      case 'priceChangePercent':
        aVal = parseFloat(a.priceChangePercent);
        bVal = parseFloat(b.priceChangePercent);
        break;
      case 'count':
        aVal = a.count;
        bVal = b.count;
        break;
      case 'correlation':
        aVal = a.correlation ?? -999;
        bVal = b.correlation ?? -999;
        break;
      case 'quoteVolume':
        aVal = parseFloat(a.quoteVolume);
        bVal = parseFloat(b.quoteVolume);
        break;
      default:
        return 0;
    }
    
    return sortDirection === 'desc' ? bVal - aVal : aVal - bVal;
  }).slice(0, displayCount);

  // Обработка клика по паре
  const handlePairClick = (pair: AnalyticsPair) => {
    // Переходим на главную с символом в URL
    router.push(`/?symbol=${pair.symbol}`);
  };

  // Обработка сортировки
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Форматирование цены
  const formatPrice = (price: string) => {
    const num = parseFloat(price);
    if (num >= 1000) return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (num >= 1) return num.toFixed(2);
    if (num >= 0.01) return num.toFixed(4);
    return num.toFixed(8);
  };

  // Форматирование изменения цены
  const formatChange = (change: string) => {
    const num = parseFloat(change);
    const sign = num >= 0 ? '+' : '';
    return `${sign}${num.toFixed(2)}%`;
  };

  // Форматирование объёма
  const formatVolume = (volume: string) => {
    const num = parseFloat(volume);
    if (num >= 1_000_000_000) return `$${(num / 1_000_000_000).toFixed(2)}B`;
    if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
    return `$${num.toFixed(2)}`;
  };

  // Форматирование количества сделок
  const formatCount = (count: number) => {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return count.toString();
  };

  // Рендер индикатора сортировки
  const renderSortIndicator = (field: SortField) => {
    if (sortField !== field) return null;
    return <span style={{ marginLeft: '4px' }}>{sortDirection === 'desc' ? '▼' : '▲'}</span>;
  };

  // Рендер ячейки корреляции
  const renderCorrelation = (pair: AnalyticsPair) => {
    if (pair.correlationLoading || pair.correlation === undefined) {
      return (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          color: 'var(--text-muted)',
        }}>
          <div className="correlation-loading" />
          <span>...</span>
        </div>
      );
    }

    const strength = getCorrelationStrength(pair.correlation);
    const percentage = Math.abs(pair.correlation) * 100;

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
        {/* Числовое значение */}
        <span style={{ 
          fontWeight: 600, 
          color: strength.color,
          minWidth: '50px',
          fontFamily: 'monospace',
        }}>
          {pair.correlation >= 0 ? '+' : ''}{pair.correlation.toFixed(2)}
        </span>
        
        {/* Визуальная шкала */}
        <div style={{ 
          flex: 1, 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          maxWidth: '200px',
        }}>
          <div style={{
            flex: 1,
            height: '8px',
            background: 'var(--bg-elevated)',
            borderRadius: '4px',
            overflow: 'hidden',
            position: 'relative',
          }}>
            {/* Центральная линия (0) */}
            <div style={{
              position: 'absolute',
              left: '50%',
              top: 0,
              bottom: 0,
              width: '1px',
              background: 'var(--border)',
              zIndex: 1,
            }} />
            
            {/* Полоска корреляции */}
            <div style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: pair.correlation >= 0 ? '50%' : `${50 - percentage / 2}%`,
              width: `${percentage / 2}%`,
              background: strength.color,
              borderRadius: '4px',
              transition: 'all 0.3s ease',
            }} />
          </div>
        </div>
        
        {/* Текстовая метка */}
        <span style={{
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '0.75rem',
          fontWeight: 500,
          background: strength.bgColor,
          color: strength.color,
          whiteSpace: 'nowrap',
        }}>
          {strength.text}
        </span>
      </div>
    );
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'var(--bg-main)', 
      color: 'var(--text-main)',
      padding: '20px',
    }}>
      {/* Заголовок */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        marginBottom: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={() => router.push('/')}
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '8px 16px',
              color: 'var(--text-main)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.9rem',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.background = 'var(--bg-card)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.background = 'var(--bg-elevated)';
            }}
          >
            ← Назад
          </button>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Аналитика рынка</h1>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Индикатор загрузки корреляций */}
          {correlationsLoaded > 0 && correlationsLoaded < displayCount && (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Корреляции: {correlationsLoaded}/{Math.min(displayCount, pairs.length)}
            </span>
          )}
          
          {/* Селектор количества */}
          <select
            value={displayCount}
            onChange={(e) => setDisplayCount(Number(e.target.value))}
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-main)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '8px 12px',
              fontSize: '0.9rem',
              cursor: 'pointer',
            }}
          >
            <option value={30}>30 пар</option>
            <option value={50}>50 пар</option>
            <option value={100}>100 пар</option>
          </select>
          
          {/* Кнопка обновления */}
          <button
            onClick={loadData}
            disabled={isLoading}
            style={{
              background: 'var(--accent)',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 16px',
              color: 'white',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isLoading ? 'Загрузка...' : 'Обновить'}
          </button>
        </div>
      </div>

      {/* Информационная панель */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: '12px',
        padding: '16px 20px',
        marginBottom: '20px',
        border: '1px solid var(--border)',
        display: 'flex',
        gap: '24px',
        flexWrap: 'wrap',
      }}>
        <div>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Корреляция с BTC</span>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Рассчитана по изменениям цены за последние 24 часа (1h свечи)
          </div>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#089981' }} />
            <span style={{ fontSize: '0.8rem' }}>Сильная + (≥0.7)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#f0b90b' }} />
            <span style={{ fontSize: '0.8rem' }}>Средняя (0.4-0.7)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#848e9c' }} />
            <span style={{ fontSize: '0.8rem' }}>Слабая (&lt;0.4)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: '#f23645' }} />
            <span style={{ fontSize: '0.8rem' }}>Отрицательная</span>
          </div>
        </div>
      </div>

      {/* Ошибка */}
      {error && (
        <div style={{
          background: 'rgba(242, 54, 69, 0.1)',
          border: '1px solid rgba(242, 54, 69, 0.3)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '20px',
          color: '#f23645',
        }}>
          {error}
        </div>
      )}

      {/* Таблица */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: '12px',
        border: '1px solid var(--border)',
        overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-elevated)' }}>
              <th style={{ 
                padding: '14px 16px', 
                textAlign: 'left', 
                fontWeight: 600,
                fontSize: '0.85rem',
                color: 'var(--text-muted)',
                borderBottom: '1px solid var(--border)',
              }}>
                #
              </th>
              <th style={{ 
                padding: '14px 16px', 
                textAlign: 'left', 
                fontWeight: 600,
                fontSize: '0.85rem',
                color: 'var(--text-muted)',
                borderBottom: '1px solid var(--border)',
              }}>
                Пара
              </th>
              <th style={{ 
                padding: '14px 16px', 
                textAlign: 'right', 
                fontWeight: 600,
                fontSize: '0.85rem',
                color: 'var(--text-muted)',
                borderBottom: '1px solid var(--border)',
              }}>
                Цена
              </th>
              <th 
                onClick={() => handleSort('priceChangePercent')}
                style={{ 
                  padding: '14px 16px', 
                  textAlign: 'right', 
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  color: sortField === 'priceChangePercent' ? 'var(--accent)' : 'var(--text-muted)',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                Рост 24ч {renderSortIndicator('priceChangePercent')}
              </th>
              <th 
                onClick={() => handleSort('count')}
                style={{ 
                  padding: '14px 16px', 
                  textAlign: 'right', 
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  color: sortField === 'count' ? 'var(--accent)' : 'var(--text-muted)',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                Сделки 24ч {renderSortIndicator('count')}
              </th>
              <th 
                onClick={() => handleSort('quoteVolume')}
                style={{ 
                  padding: '14px 16px', 
                  textAlign: 'right', 
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  color: sortField === 'quoteVolume' ? 'var(--accent)' : 'var(--text-muted)',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                Объём 24ч {renderSortIndicator('quoteVolume')}
              </th>
              <th 
                onClick={() => handleSort('correlation')}
                style={{ 
                  padding: '14px 16px', 
                  textAlign: 'left', 
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  color: sortField === 'correlation' ? 'var(--accent)' : 'var(--text-muted)',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  userSelect: 'none',
                  minWidth: '300px',
                }}
              >
                Корреляция с BTC {renderSortIndicator('correlation')}
              </th>
              <th style={{ 
                padding: '14px 16px', 
                textAlign: 'center', 
                fontWeight: 600,
                fontSize: '0.85rem',
                color: 'var(--text-muted)',
                borderBottom: '1px solid var(--border)',
              }}>
                Биржа
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && pairs.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ 
                  padding: '40px', 
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                }}>
                  Загрузка данных...
                </td>
              </tr>
            ) : sortedPairs.map((pair, index) => (
              <tr 
                key={pair.symbol}
                onClick={() => handlePairClick(pair)}
                style={{ 
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-elevated)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <td style={{ 
                  padding: '14px 16px', 
                  borderBottom: '1px solid var(--border)',
                  color: 'var(--text-muted)',
                  fontSize: '0.85rem',
                }}>
                  {index + 1}
                </td>
                <td style={{ 
                  padding: '14px 16px', 
                  borderBottom: '1px solid var(--border)',
                  fontWeight: 600,
                }}>
                  {pair.symbol.replace('USDT', '')}
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/USDT</span>
                </td>
                <td style={{ 
                  padding: '14px 16px', 
                  textAlign: 'right',
                  borderBottom: '1px solid var(--border)',
                  fontFamily: 'monospace',
                }}>
                  ${formatPrice(pair.price)}
                </td>
                <td style={{ 
                  padding: '14px 16px', 
                  textAlign: 'right',
                  borderBottom: '1px solid var(--border)',
                  fontWeight: 600,
                  color: parseFloat(pair.priceChangePercent) >= 0 ? '#089981' : '#f23645',
                  fontFamily: 'monospace',
                }}>
                  {formatChange(pair.priceChangePercent)}
                </td>
                <td style={{ 
                  padding: '14px 16px', 
                  textAlign: 'right',
                  borderBottom: '1px solid var(--border)',
                  fontFamily: 'monospace',
                  color: pair.count === 0 ? 'var(--text-muted)' : 'inherit',
                }}>
                  {pair.count === 0 ? '—' : formatCount(pair.count)}
                </td>
                <td style={{ 
                  padding: '14px 16px', 
                  textAlign: 'right',
                  borderBottom: '1px solid var(--border)',
                  fontFamily: 'monospace',
                }}>
                  {formatVolume(pair.quoteVolume)}
                </td>
                <td style={{ 
                  padding: '14px 16px', 
                  borderBottom: '1px solid var(--border)',
                }}>
                  {renderCorrelation(pair)}
                </td>
                <td style={{ 
                  padding: '14px 16px', 
                  textAlign: 'center',
                  borderBottom: '1px solid var(--border)',
                }}>
                  <span style={{
                    padding: '3px 8px',
                    borderRadius: '4px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    background: pair.exchange === 'Binance' ? 'rgba(240, 185, 11, 0.15)' : 'rgba(242, 153, 74, 0.15)',
                    color: pair.exchange === 'Binance' ? '#f0b90b' : '#f2994a',
                  }}>
                    {pair.exchange}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* CSS для анимации загрузки */}
      <style jsx>{`
        .correlation-loading {
          width: 16px;
          height: 16px;
          border: 2px solid var(--border);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
