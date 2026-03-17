'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import Link from 'next/link';
import { useTradingStore, useActiveAlertsStore } from '@/store/useTradingStore';
import { usePrePumpStore } from '@/store/usePrePumpStore';
import { getTop10Pairs, getAllUSDTPairs } from '@/lib/binance';
import { getBybitUSDTPairs } from '@/lib/bybit';
import type { BinancePair } from '@/types/binance';
import TimeframeSelector from '@/components/TimeframeSelector';
import ChartModeSelector from '@/components/ChartModeSelector';
import DeltaPopover from '@/components/DeltaPopover';
import Tick200IndicatorsPopover from '@/components/Tick200IndicatorsPopover';
import { shallow } from 'zustand/shallow';

export default function Header() {
  // ОПТИМИЗАЦИЯ: используем shallow comparison для предотвращения лишних ререндеров
  const {
    top10Pairs,
    selectedPair,
    binanceConnected,
    isLoadingPairs,
    setTop10Pairs,
    setSelectedPair,
    setIsLoadingPairs,
    setBinanceConnected,
    chartMode,
    showAnalyticsSidebar,
    toggleAnalyticsSidebar,
    showPrePumpSidebar,
    togglePrePumpSidebar,
    isLabMode,
  } = useTradingStore(
    (state) => ({
      top10Pairs: state.top10Pairs,
      selectedPair: state.selectedPair,
      binanceConnected: state.binanceConnected,
      isLoadingPairs: state.isLoadingPairs,
      setTop10Pairs: state.setTop10Pairs,
      setSelectedPair: state.setSelectedPair,
      setIsLoadingPairs: state.setIsLoadingPairs,
      setBinanceConnected: state.setBinanceConnected,
      chartMode: state.chartMode,
      showAnalyticsSidebar: state.showAnalyticsSidebar,
      toggleAnalyticsSidebar: state.toggleAnalyticsSidebar,
      showPrePumpSidebar: state.showPrePumpSidebar,
      togglePrePumpSidebar: state.togglePrePumpSidebar,
      isLabMode: state.isLabMode,
    }),
    shallow
  );

  const activeAlertsCount = useActiveAlertsStore((state) => state.alerts.length);
  const prePumpIdealCount = usePrePumpStore((state) => state.idealCount);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [allPairs, setAllPairs] = useState<BinancePair[]>([]);
  const [isLoadingAllPairs, setIsLoadingAllPairs] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Загрузка всех пар при монтировании (единый запрос, top10 из кэша)
  useEffect(() => {
    loadAllPairs();
  }, []);

  // Фильтрация пар по поисковому запросу
  const filteredPairs = useMemo(() => {
    if (!searchQuery.trim()) {
      return allPairs.slice(0, 10); // Показываем топ-10 если нет запроса
    }
    
    const query = searchQuery.toUpperCase().trim();
    return allPairs.filter(pair => 
      pair.symbol.includes(query) || 
      pair.symbol.replace('USDT', '').includes(query)
    ).slice(0, 25);
  }, [searchQuery, allPairs]);

  // Автоматический выбор BTCUSDT после загрузки пар
  useEffect(() => {
    if (allPairs.length > 0 && !selectedPair) {
      // Ищем BTCUSDT в списке всех пар
      const btcPair = allPairs.find(pair => pair.symbol === 'BTCUSDT');
      if (btcPair) {
        setSelectedPair(btcPair);
        setSearchQuery(btcPair.symbol);
      } else if (allPairs.length > 0) {
        // Если BTCUSDT нет, выбираем первую пару
        setSelectedPair(allPairs[0]);
        setSearchQuery(allPairs[0].symbol);
      }
    }
  }, [allPairs, selectedPair, setSelectedPair]);

  // Обновление поискового запроса при изменении выбранной пары (только если поле не в фокусе)
  useEffect(() => {
    if (selectedPair && document.activeElement !== inputRef.current) {
      setSearchQuery(selectedPair.symbol);
    }
  }, [selectedPair]);

  // Закрытие dropdown при клике вне его
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadAllPairs = async () => {
    setIsLoadingAllPairs(true);
    setIsLoadingPairs(true);
    try {
      // Binance и Bybit загружаются параллельно; если Binance упал — Bybit всё равно даст пары
      const [binanceResult, bybitResult] = await Promise.allSettled([
        getAllUSDTPairs(),
        getBybitUSDTPairs(),
      ]);

      const binancePairs = binanceResult.status === 'fulfilled' ? binanceResult.value : [];
      const bybitTickers = bybitResult.status === 'fulfilled' ? bybitResult.value : [];

      const binanceSymbols = new Set(binancePairs.map((p) => p.symbol));
      const binanceWithExchange: BinancePair[] = binancePairs.map((p) => ({
        ...p,
        exchange: 'Binance' as const,
      }));
      const bybitPairs: BinancePair[] = bybitTickers.map((t) => ({
        symbol: t.symbol,
        price: t.lastPrice,
        priceChange: '0',
        priceChangePercent: (parseFloat(t.price24hPcnt || '0') * 100).toFixed(2),
        volume: t.volume24h,
        quoteVolume: t.turnover24h,
        exchange: 'Bybit' as const,
      }));
      const merged: BinancePair[] = [
        ...binanceWithExchange,
        ...bybitPairs.filter((p) => !binanceSymbols.has(p.symbol)),
      ];
      merged.sort((a, b) => parseFloat(b.quoteVolume || '0') - parseFloat(a.quoteVolume || '0'));
      setAllPairs(merged);

      const binanceOk = binancePairs.length > 0;
      setBinanceConnected(binanceOk);

      // Top-10 из уже загруженных данных (без лишнего запроса)
      try {
        const top10 = await getTop10Pairs();
        setTop10Pairs(top10);
      } catch {
        if (merged.length > 0) setTop10Pairs(merged.slice(0, 10));
      }
    } catch (error) {
      setBinanceConnected(false);
    } finally {
      setIsLoadingAllPairs(false);
      setIsLoadingPairs(false);
    }
  };

  const handlePairSelect = (pair: BinancePair) => {
    setSelectedPair(pair);
    setSearchQuery(pair.symbol);
    setIsDropdownOpen(false);
    if (inputRef.current) {
      inputRef.current.blur();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setIsDropdownOpen(value.length > 0 || filteredPairs.length > 0);
  };

  const handleInputFocus = () => {
    setIsDropdownOpen(true);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && filteredPairs.length > 0) {
      handlePairSelect(filteredPairs[0]);
    } else if (e.key === 'Escape') {
      setIsDropdownOpen(false);
      if (inputRef.current) {
        inputRef.current.blur();
      }
    }
  };

  const formatPrice = (price: string) => {
    const num = parseFloat(price);
    if (num >= 1) return num.toFixed(2);
    if (num >= 0.01) return num.toFixed(4);
    return num.toFixed(8);
  };

  const formatChange = (change: string) => {
    const num = parseFloat(change);
    const sign = num >= 0 ? '+' : '';
    return `${sign}${num.toFixed(2)}%`;
  };

  return (
    <header style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
      <div className="header-left">
        <div className="title">Crypto Trading Platform</div>
        
        {/* Кнопка аналитики - toggle боковой панели */}
        <button
          onClick={toggleAnalyticsSidebar}
          style={{
            position: 'relative',
            background: showAnalyticsSidebar 
              ? 'linear-gradient(135deg, #764ba2 0%, #667eea 100%)' 
              : activeAlertsCount > 0
                ? 'linear-gradient(135deg, #f0b90b 0%, #f5a623 100%)'
                : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            border: showAnalyticsSidebar ? '2px solid #667eea' : 'none',
            borderRadius: '8px',
            padding: '8px 16px',
            color: 'white',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.2s',
            boxShadow: activeAlertsCount > 0 && !showAnalyticsSidebar
              ? '0 0 15px rgba(240, 185, 11, 0.6)'
              : showAnalyticsSidebar 
                ? '0 0 12px rgba(102, 126, 234, 0.6)' 
                : '0 2px 8px rgba(102, 126, 234, 0.3)',
            animation: activeAlertsCount > 0 && !showAnalyticsSidebar ? 'pulse 1.5s infinite' : 'none',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = activeAlertsCount > 0 && !showAnalyticsSidebar
              ? '0 0 15px rgba(240, 185, 11, 0.6)'
              : showAnalyticsSidebar 
                ? '0 0 12px rgba(102, 126, 234, 0.6)' 
                : '0 2px 8px rgba(102, 126, 234, 0.3)';
          }}
        >
          <span style={{ fontSize: '1rem' }}>{activeAlertsCount > 0 ? '🔔' : '📊'}</span>
          Аналитика
          {activeAlertsCount > 0 && (
            <span style={{
              position: 'absolute',
              top: '-6px',
              right: '-6px',
              background: '#f23645',
              color: 'white',
              borderRadius: '50%',
              width: '20px',
              height: '20px',
              fontSize: '0.7rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px solid var(--bg-main)',
            }}>
              {activeAlertsCount}
            </span>
          )}
          {showAnalyticsSidebar && !activeAlertsCount && <span style={{ fontSize: '0.7rem' }}>✓</span>}
        </button>

        {/* Pre-Pump — сайдбар на странице графика (как аналитика) */}
        <button
          onClick={togglePrePumpSidebar}
          style={{
            position: 'relative',
            background: showPrePumpSidebar
              ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
              : 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)',
            border: showPrePumpSidebar ? '2px solid #22c55e' : 'none',
            borderRadius: '8px',
            padding: '8px 14px',
            color: 'white',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.2s',
            boxShadow: prePumpIdealCount > 0 && !showPrePumpSidebar
              ? '0 0 15px rgba(34, 197, 94, 0.6)'
              : showPrePumpSidebar ? '0 0 12px rgba(34, 197, 94, 0.5)' : '0 2px 8px rgba(34, 197, 94, 0.3)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(34, 197, 94, 0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = prePumpIdealCount > 0 && !showPrePumpSidebar
              ? '0 0 15px rgba(34, 197, 94, 0.6)'
              : showPrePumpSidebar ? '0 0 12px rgba(34, 197, 94, 0.5)' : '0 2px 8px rgba(34, 197, 94, 0.3)';
          }}
        >
          <span style={{ fontSize: '1rem' }}>🚀</span>
          Pre-Pump
          {prePumpIdealCount > 0 && (
            <span style={{
              position: 'absolute',
              top: '-6px',
              right: '-6px',
              background: '#22c55e',
              color: 'white',
              borderRadius: '50%',
              minWidth: '20px',
              height: '20px',
              fontSize: '0.7rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 5px',
              border: '2px solid var(--bg-main)',
            }}>
              {prePumpIdealCount}
            </span>
          )}
          {showPrePumpSidebar && prePumpIdealCount === 0 && <span style={{ fontSize: '0.7rem' }}>✓</span>}
        </button>
        
        {/* Кнопка карты плотностей — в отдельном окне браузера */}
        <Link
          href="/density-map"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 16px',
            background: 'linear-gradient(135deg, #22c55e 0%, #3b82f6 100%)',
            border: 'none',
            borderRadius: '8px',
            color: 'white',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 600,
            textDecoration: 'none',
            transition: 'all 0.2s',
            boxShadow: '0 2px 8px rgba(34, 197, 94, 0.3)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(34, 197, 94, 0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(34, 197, 94, 0.3)';
          }}
        >
          <span style={{ fontSize: '1rem' }}>🎯</span>
          Карта плотностей
        </Link>

        {/* Лаборатория — отдельная страница в этой же вкладке */}
        <Link
          href="/dom-surface"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 16px',
            background: 'linear-gradient(135deg, #f97316 0%, #ec4899 100%)',
            border: 'none',
            borderRadius: '8px',
            color: 'white',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 600,
            textDecoration: 'none',
            transition: 'all 0.2s',
            boxShadow: '0 2px 8px rgba(248, 113, 113, 0.3)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(248, 113, 113, 0.6)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(248, 113, 113, 0.3)';
          }}
        >
          <span style={{ fontSize: '1rem' }}>🧪</span>
          Лаборатория
        </Link>

        <Link
          href="/screener"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 16px',
            background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
            border: 'none',
            borderRadius: '8px',
            color: 'white',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 600,
            textDecoration: 'none',
            transition: 'all 0.2s',
            boxShadow: '0 2px 8px rgba(59, 130, 246, 0.3)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.3)';
          }}
        >
          <span style={{ fontSize: '1rem' }}>📊</span>
          Скринер уровней
        </Link>
        
        {/* Умный поиск пар */}
        <div className={`pairs-selector ${selectedPair ? 'active' : ''} ${isDropdownOpen ? 'open' : ''}`} ref={selectorRef}>
          <div className="pairs-selector-input-wrapper">
            <input
              ref={inputRef}
              type="text"
              className="pairs-selector-input"
              placeholder={selectedPair ? selectedPair.symbol : 'Введите пару (например: BTC)'}
              value={searchQuery}
              onChange={handleInputChange}
              onFocus={handleInputFocus}
              onKeyDown={handleInputKeyDown}
            />
            {isLoadingAllPairs && (
              <span className="pairs-selector-loading">⏳</span>
            )}
          </div>
          
          {isDropdownOpen && filteredPairs.length > 0 && (
            <div className="pairs-selector-dropdown">
              <div className="pairs-selector-header">
                <span>
                  {searchQuery.trim() 
                    ? `Найдено: ${filteredPairs.length}${filteredPairs.length === 25 ? '+' : ''}` 
                    : 'Популярные пары'}
                </span>
              </div>
              
              <div className="pairs-selector-list">
                {filteredPairs.map((pair) => (
                  <div
                    key={`${pair.symbol}-${pair.exchange || 'Binance'}`}
                    className={`pairs-selector-item ${selectedPair?.symbol === pair.symbol && (selectedPair?.exchange || 'Binance') === (pair.exchange || 'Binance') ? 'active' : ''}`}
                    onClick={() => handlePairSelect(pair)}
                  >
                    <div className="pairs-selector-item-left">
                      <span className="pairs-selector-item-symbol">{pair.symbol}</span>
                      {pair.exchange === 'Bybit' ? (
                        <span style={{ fontSize: '0.6rem', padding: '1px 4px', borderRadius: '3px', background: 'rgba(242, 153, 74, 0.2)', color: '#f2994a', fontWeight: 600, marginLeft: '4px' }}>BB</span>
                      ) : (
                        <span style={{ fontSize: '0.6rem', padding: '1px 4px', borderRadius: '3px', background: 'rgba(240, 185, 11, 0.2)', color: '#f0b90b', fontWeight: 600, marginLeft: '4px' }}>BN</span>
                      )}
                      <span className="pairs-selector-item-price">
                        ${formatPrice(pair.price)}
                      </span>
                    </div>
                    <span
                      className={`pairs-selector-item-change ${
                        parseFloat(pair.priceChangePercent || '0') >= 0 ? 'positive' : 'negative'
                      }`}
                    >
                      {formatChange(pair.priceChangePercent || '0')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {isDropdownOpen && searchQuery.trim() && filteredPairs.length === 0 && !isLoadingAllPairs && (
            <div className="pairs-selector-dropdown">
              <div className="pairs-selector-header">
                <span>Ничего не найдено</span>
              </div>
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                Попробуйте другой запрос
              </div>
            </div>
          )}
        </div>
        
        {/* Селектор режима графика - в лаборатории 20-тиковый график не используется */}
        {!isLabMode && <ChartModeSelector />}
        
        {/* Селектор таймфрейма - только для стандартного графика */}
        {(chartMode === 'standard' || chartMode === 'both') && (
          <TimeframeSelector />
        )}
      </div>
      
      {/* Компактные popover-кнопки: Дельта + Индикаторы */}
      <div className="header-center" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <DeltaPopover chartMode={chartMode} />
        {!isLabMode && (chartMode === 'tick200' || chartMode === 'both') && (
          <Tick200IndicatorsPopover />
        )}
      </div>
      
      {/* Статус подключения */}
      <div className="status">
        <div className="status-indicator">
          <span className={`status-dot ${binanceConnected ? 'connected' : ''}`} />
          <span>Binance</span>
        </div>
      </div>
      </div>
    </header>
  );
}
