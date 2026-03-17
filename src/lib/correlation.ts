import axios from 'axios';
import { getBybitUSDTPairs, getBybitKlines } from './bybit';

const BINANCE_API_BASE = 'https://api.binance.com/api/v3';

export type Exchange = 'Binance' | 'Bybit';

// Интерфейс для данных пары с аналитикой
export interface AnalyticsPair {
  symbol: string;
  price: string;
  priceChangePercent: string;
  volume: string;
  quoteVolume: string;
  count: number; // Количество сделок за 24ч
  correlation?: number; // Корреляция с BTC (-1 до +1)
  correlationLoading?: boolean;
  exchange: Exchange; // Биржа
}

// ОПТИМИЗАЦИЯ: Кэш для аналитических данных пар
let analyticsPairsCache: { data: AnalyticsPair[]; timestamp: number } | null = null;
const ANALYTICS_CACHE_DURATION = 60 * 1000; // 1 минута (данные меняются часто)

// Получение всех USDT пар с количеством сделок (Binance + Bybit)
export async function getAllPairsWithTrades(): Promise<AnalyticsPair[]> {
  // Проверяем кэш
  const now = Date.now();
  if (analyticsPairsCache && (now - analyticsPairsCache.timestamp) < ANALYTICS_CACHE_DURATION) {
    return analyticsPairsCache.data;
  }
  try {
    // === BINANCE ===
    let binancePairs: AnalyticsPair[] = [];
    const binanceSymbols = new Set<string>();
    
    try {
      // Получаем exchangeInfo для фильтрации активных пар
      let tradingSymbols: Set<string> = new Set();
      try {
        const exchangeRes = await axios.get<{ symbols?: Array<{ symbol: string; status?: string }> }>(
          `${BINANCE_API_BASE}/exchangeInfo`
        );
        const symbols = exchangeRes.data?.symbols ?? [];
        tradingSymbols = new Set(symbols.filter(s => s.status === 'TRADING').map(s => s.symbol));
      } catch {
        // Если exchangeInfo недоступен — не фильтруем по статусу
      }

      const response = await axios.get(`${BINANCE_API_BASE}/ticker/24hr`);
      const allBinancePairs = response.data as any[];
      
      binancePairs = allBinancePairs
        .filter(pair => 
          pair.symbol.endsWith('USDT') && 
          (tradingSymbols.size === 0 || tradingSymbols.has(pair.symbol)) &&
          pair.symbol !== 'BTCUSDT'
        )
        .map(pair => {
          binanceSymbols.add(pair.symbol);
          return {
            symbol: pair.symbol,
            price: pair.lastPrice || pair.price,
            priceChangePercent: pair.priceChangePercent,
            volume: pair.volume,
            quoteVolume: pair.quoteVolume,
            count: parseInt(pair.count) || 0,
            correlation: undefined,
            correlationLoading: true,
            exchange: 'Binance' as Exchange,
          };
        });
    } catch (error) {
      console.error('Error fetching Binance pairs:', error);
    }
    
    // === BYBIT ===
    let bybitPairs: AnalyticsPair[] = [];
    
    try {
      const bybitTickers = await getBybitUSDTPairs();
      
      // Добавляем только те пары которых НЕТ на Binance
      bybitPairs = bybitTickers
        .filter(ticker => 
          !binanceSymbols.has(ticker.symbol) && 
          ticker.symbol !== 'BTCUSDT'
        )
        .map(ticker => ({
          symbol: ticker.symbol,
          price: ticker.lastPrice,
          // Bybit возвращает в формате 0.05 = 5%, конвертируем
          priceChangePercent: (parseFloat(ticker.price24hPcnt) * 100).toFixed(2),
          volume: ticker.volume24h,
          quoteVolume: ticker.turnover24h,
          count: parseInt(ticker.count24h || '0') || 0,
          correlation: undefined,
          correlationLoading: true,
          exchange: 'Bybit' as Exchange,
        }));
    } catch (error) {
      console.error('Error fetching Bybit pairs:', error);
    }
    
    // Объединяем и сортируем по изменению цены
    const allPairs = [...binancePairs, ...bybitPairs]
      .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));
    
    // Сохраняем в кэш
    analyticsPairsCache = { data: allPairs, timestamp: Date.now() };
    
    return allPairs;
  } catch (error) {
    console.error('Error fetching pairs:', error);
    throw error;
  }
}

// Получение исторических данных (klines) для пары
async function getKlines(symbol: string, interval: string = '1h', limit: number = 24): Promise<number[]> {
  try {
    const response = await axios.get(`${BINANCE_API_BASE}/klines`, {
      params: {
        symbol: symbol.toUpperCase(),
        interval,
        limit,
      },
    });
    
    // Возвращаем массив цен закрытия
    return (response.data as any[]).map(kline => parseFloat(kline[4]));
  } catch (error) {
    console.error(`Error fetching klines for ${symbol}:`, error);
    return [];
  }
}

// Расчёт returns (процентных изменений) из цен
function calculateReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] !== 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }
  return returns;
}

// Расчёт корреляции Пирсона
export function calculatePearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length < 2) return 0;
  
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
  
  if (denominator === 0) return 0;
  
  const correlation = numerator / denominator;
  
  // Ограничиваем до [-1, 1] на случай погрешностей
  return Math.max(-1, Math.min(1, correlation));
}

// Кэш для BTC данных
let btcReturnsCache: { returns: number[]; timestamp: number } | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 минут

// Получение returns BTC (с кэшированием)
export async function getBtcReturns(): Promise<number[]> {
  const now = Date.now();
  
  if (btcReturnsCache && (now - btcReturnsCache.timestamp) < CACHE_DURATION) {
    return btcReturnsCache.returns;
  }
  
  const btcPrices = await getKlines('BTCUSDT', '1h', 25); // 25 свечей = 24 returns
  const returns = calculateReturns(btcPrices);
  
  btcReturnsCache = { returns, timestamp: now };
  return returns;
}

// Расчёт корреляции пары с BTC
export async function calculateCorrelationWithBtc(
  symbol: string, 
  btcReturns: number[], 
  exchange: Exchange = 'Binance'
): Promise<number> {
  try {
    let pairPrices: number[];
    
    if (exchange === 'Bybit') {
      pairPrices = await getBybitKlines(symbol, '60', 25); // '60' = 1 hour для Bybit
    } else {
      pairPrices = await getKlines(symbol, '1h', 25);
    }
    
    const pairReturns = calculateReturns(pairPrices);
    
    // Выравниваем длины массивов
    const minLength = Math.min(btcReturns.length, pairReturns.length);
    const btcSlice = btcReturns.slice(-minLength);
    const pairSlice = pairReturns.slice(-minLength);
    
    return calculatePearsonCorrelation(pairSlice, btcSlice);
  } catch (error) {
    console.error(`Error calculating correlation for ${symbol}:`, error);
    return 0;
  }
}

// Интерпретация силы корреляции
export function getCorrelationStrength(correlation: number): {
  text: string;
  color: string;
  bgColor: string;
  level: 'strong' | 'medium' | 'weak';
} {
  const absCorr = Math.abs(correlation);
  const isPositive = correlation >= 0;
  
  if (absCorr >= 0.7) {
    return {
      text: isPositive ? 'Сильная +' : 'Сильная −',
      color: isPositive ? '#089981' : '#f23645',
      bgColor: isPositive ? 'rgba(8, 153, 129, 0.15)' : 'rgba(242, 54, 69, 0.15)',
      level: 'strong',
    };
  } else if (absCorr >= 0.4) {
    return {
      text: isPositive ? 'Средняя +' : 'Средняя −',
      color: '#f0b90b',
      bgColor: 'rgba(240, 185, 11, 0.15)',
      level: 'medium',
    };
  } else {
    return {
      text: 'Слабая',
      color: '#848e9c',
      bgColor: 'rgba(132, 142, 156, 0.1)',
      level: 'weak',
    };
  }
}

// Получение цвета для градиента корреляции
export function getCorrelationGradientColor(correlation: number): string {
  // От -1 (красный) через 0 (серый) до +1 (зелёный)
  if (correlation >= 0) {
    // Зелёный градиент для положительной
    const intensity = Math.min(correlation, 1);
    return `rgba(8, 153, 129, ${0.2 + intensity * 0.6})`;
  } else {
    // Красный градиент для отрицательной
    const intensity = Math.min(Math.abs(correlation), 1);
    return `rgba(242, 54, 69, ${0.2 + intensity * 0.6})`;
  }
}
