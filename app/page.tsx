'use client';

import { useState, useEffect, Suspense, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Header from '@/components/Header';
import Chart from '@/components/Chart';
import Tick200Chart from '@/components/Tick200Chart';
import TickerSpeedIndicator from '@/components/TickerSpeedIndicator';
import AnalyticsSidebar from '@/components/AnalyticsSidebar';
import PrePumpSidebar from '@/components/pre-pump/PrePumpSidebar';
import PrePumpNotifier from '@/components/pre-pump/PrePumpNotifier';
import PriceLevelMonitor from '@/components/PriceLevelMonitor';
import ScreenerNotifications from '@/components/ScreenerNotifications';
import { useTradingStore } from '@/store/useTradingStore';
import { getAllUSDTPairs } from '@/lib/binance';
import { getBybitUSDTPairs } from '@/lib/bybit';

// Компонент для обработки символа из URL
function SymbolHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { selectedPair, setSelectedPair } = useTradingStore();
  const processedSymbolRef = useRef<string | null>(null);
  
  useEffect(() => {
    const symbolFromUrl = searchParams.get('symbol');
    
    // Если нет символа в URL или мы уже обработали этот символ - ничего не делаем
    if (!symbolFromUrl || processedSymbolRef.current === symbolFromUrl) {
      return;
    }
    
    // Если символ уже выбран в store - не перезагружаем
    if (selectedPair?.symbol === symbolFromUrl) {
      processedSymbolRef.current = symbolFromUrl;
      // Очищаем URL параметр
      router.replace('/', { scroll: false });
      return;
    }
    
    // Помечаем что начали обработку этого символа
    processedSymbolRef.current = symbolFromUrl;
    
    // Загружаем данные пары: сначала Binance, если нет — Bybit
    Promise.all([getAllUSDTPairs(), getBybitUSDTPairs()]).then(([binancePairs, bybitTickers]) => {
      const bn = binancePairs.find(p => p.symbol === symbolFromUrl);
      if (bn) {
        setSelectedPair({ ...bn, exchange: 'Binance' });
        router.replace('/', { scroll: false });
        return;
      }
      const bb = bybitTickers.find(t => t.symbol === symbolFromUrl);
      if (bb) {
        setSelectedPair({
          symbol: bb.symbol,
          price: bb.lastPrice,
          priceChange: '0',
          priceChangePercent: (parseFloat(bb.price24hPcnt || '0') * 100).toFixed(2),
          volume: bb.volume24h,
          quoteVolume: bb.turnover24h,
          exchange: 'Bybit',
        });
        router.replace('/', { scroll: false });
      }
    }).catch(console.error);
  }, [searchParams, selectedPair, setSelectedPair, router]);
  
  return null;
}

function HomeContent() {
  const { chartMode } = useTradingStore();
  const [chartWasStarted, setChartWasStarted] = useState(false);
  const [tickChartWasStarted, setTickChartWasStarted] = useState(false);

  // Отслеживаем, когда компоненты показываются первый раз
  useEffect(() => {
    if (chartMode === 'standard' || chartMode === 'both') {
      setChartWasStarted(true);
    }
  }, [chartMode]);

  useEffect(() => {
    if (chartMode === 'tick200' || chartMode === 'both') {
      setTickChartWasStarted(true);
    }
  }, [chartMode]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Header />
      
      {/* Индикатор скорости ленты - между хедером и графиками */}
      <TickerSpeedIndicator />
      
      <main style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
        {/* Контейнер графиков */}
        <div className="main-charts-row" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: chartMode === 'both' ? 'row' : 'column', gap: '4px', overflow: 'hidden' }}>
          {/* Chart - монтируется когда должен быть виден или после первого запуска */}
          {((chartMode === 'standard' || chartMode === 'both') || chartWasStarted) && (
            <div style={{ 
              flex: 1, 
              minWidth: 0, 
              minHeight: 0, 
              display: (chartMode === 'standard' || chartMode === 'both') ? 'flex' : 'none', 
              flexDirection: 'column', 
              overflow: 'hidden' 
            }}>
              <Chart />
            </div>
          )}
          
          {/* Tick200Chart - монтируется когда должен быть виден или после первого запуска */}
          {((chartMode === 'tick200' || chartMode === 'both') || tickChartWasStarted) && (
            <div style={{ 
              flex: 1, 
              minWidth: 0, 
              minHeight: 0, 
              display: (chartMode === 'tick200' || chartMode === 'both') ? 'flex' : 'none', 
              flexDirection: 'column', 
              overflow: 'hidden' 
            }}>
              <Tick200Chart />
            </div>
          )}
        </div>
        
        {/* Боковая панель: аналитика или Pre-Pump */}
        <AnalyticsSidebar />
        <PrePumpSidebar />
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <>
      {/* Фоновый монитор уровней - работает независимо от активного графика */}
      <PriceLevelMonitor />
      {/* Pre-Pump: фоновый опрос API, звук при идеале */}
      <PrePumpNotifier />
      {/* Уведомления когда скринер находит монеты с уровнями крупных ордеров */}
      <ScreenerNotifications />
      <Suspense fallback={null}>
        <SymbolHandler />
      </Suspense>
      <HomeContent />
    </>
  );
}
