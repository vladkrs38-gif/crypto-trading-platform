import axios from 'axios';
import type { Density, Exchange, DensityMapSettings } from '@/types/density';

const BINANCE_API = 'https://api.binance.com/api/v3';
const BYBIT_API = 'https://api.bybit.com/v5';

interface TickerInfo {
  symbol: string;
  price: number;
  volume24h: number;
  exchange: Exchange;
}

async function getBinanceTickers(): Promise<TickerInfo[]> {
  try {
    const response = await axios.get(`${BINANCE_API}/ticker/24hr`);
    return response.data
      .filter((t: any) => t.symbol.endsWith('USDT'))
      .map((t: any) => ({
        symbol: t.symbol,
        price: parseFloat(t.lastPrice),
        volume24h: parseFloat(t.quoteVolume),
        exchange: 'binance' as Exchange,
      }));
  } catch (error) {
    console.error('[DensityScanner] Binance tickers error:', error);
    return [];
  }
}

async function getBybitTickers(): Promise<TickerInfo[]> {
  try {
    const response = await axios.get(`${BYBIT_API}/market/tickers`, {
      params: { category: 'linear' },
    });
    
    if (response.data?.retCode !== 0) return [];
    
    return (response.data?.result?.list || [])
      .filter((t: any) => t.symbol.endsWith('USDT'))
      .map((t: any) => ({
        symbol: t.symbol,
        price: parseFloat(t.lastPrice),
        volume24h: parseFloat(t.turnover24h),
        exchange: 'bybit' as Exchange,
      }));
  } catch (error) {
    console.error('[DensityScanner] Bybit tickers error:', error);
    return [];
  }
}

interface OrderBookLevel {
  price: number;
  quantity: number;
  amountUSD: number;
}

interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  currentPrice: number;
}

async function getBinanceOrderBook(symbol: string, limit: number = 500): Promise<OrderBook | null> {
  try {
    const [depthResponse, priceResponse] = await Promise.all([
      axios.get(`${BINANCE_API}/depth`, {
        params: { symbol, limit },
      }),
      axios.get(`${BINANCE_API}/ticker/price`, {
        params: { symbol },
      }),
    ]);
    
    const currentPrice = parseFloat(priceResponse.data.price);
    
    const bids: OrderBookLevel[] = depthResponse.data.bids.map((level: string[]) => {
      const price = parseFloat(level[0]);
      const quantity = parseFloat(level[1]);
      return { price, quantity, amountUSD: price * quantity };
    });
    
    const asks: OrderBookLevel[] = depthResponse.data.asks.map((level: string[]) => {
      const price = parseFloat(level[0]);
      const quantity = parseFloat(level[1]);
      return { price, quantity, amountUSD: price * quantity };
    });
    
    return { bids, asks, currentPrice };
  } catch (error) {
    console.error(`[DensityScanner] Binance order book error for ${symbol}:`, error);
    return null;
  }
}

async function getBybitOrderBook(symbol: string, limit: number = 500): Promise<OrderBook | null> {
  try {
    const response = await axios.get(`${BYBIT_API}/market/orderbook`, {
      params: { 
        category: 'linear',
        symbol,
        limit: Math.min(limit, 500),
      },
    });
    
    if (response.data?.retCode !== 0) return null;
    
    const data = response.data.result;
    const bestBid = parseFloat(data.b?.[0]?.[0] || '0');
    const bestAsk = parseFloat(data.a?.[0]?.[0] || '0');
    const currentPrice = (bestBid + bestAsk) / 2;
    
    const bids: OrderBookLevel[] = (data.b || []).map((level: string[]) => {
      const price = parseFloat(level[0]);
      const quantity = parseFloat(level[1]);
      return { price, quantity, amountUSD: price * quantity };
    });
    
    const asks: OrderBookLevel[] = (data.a || []).map((level: string[]) => {
      const price = parseFloat(level[0]);
      const quantity = parseFloat(level[1]);
      return { price, quantity, amountUSD: price * quantity };
    });
    
    return { bids, asks, currentPrice };
  } catch (error) {
    console.error(`[DensityScanner] Bybit order book error for ${symbol}:`, error);
    return null;
  }
}

async function getAverageVolumePerMinute(
  symbol: string, 
  exchange: Exchange,
  periodHours: number = 4
): Promise<number> {
  try {
    if (exchange === 'binance') {
      const response = await axios.get(`${BINANCE_API}/klines`, {
        params: { symbol, interval: '1h', limit: periodHours },
      });
      
      const totalVolume = response.data.reduce((sum: number, kline: any) => {
        return sum + parseFloat(kline[7]);
      }, 0);
      
      return totalVolume / (periodHours * 60);
    } else {
      const response = await axios.get(`${BYBIT_API}/market/kline`, {
        params: { category: 'linear', symbol, interval: '60', limit: periodHours },
      });
      
      if (response.data?.retCode !== 0) return 0;
      
      const klines = response.data.result?.list || [];
      const totalVolume = klines.reduce((sum: number, kline: any) => {
        return sum + parseFloat(kline[6]);
      }, 0);
      
      return totalVolume / (periodHours * 60);
    }
  } catch (error) {
    console.error(`[DensityScanner] Volume calculation error for ${symbol}:`, error);
    return 0;
  }
}

interface VolumeCache {
  [key: string]: { avgVolumePerMin: number; timestamp: number };
}

const volumeCache: VolumeCache = {};
const VOLUME_CACHE_TTL = 5 * 60 * 1000;

async function getCachedAverageVolume(symbol: string, exchange: Exchange): Promise<number> {
  const key = `${exchange}:${symbol}`;
  const cached = volumeCache[key];
  
  if (cached && Date.now() - cached.timestamp < VOLUME_CACHE_TTL) {
    return cached.avgVolumePerMin;
  }
  
  const avgVolumePerMin = await getAverageVolumePerMinute(symbol, exchange);
  volumeCache[key] = { avgVolumePerMin, timestamp: Date.now() };
  
  return avgVolumePerMin;
}

interface DensityCandidate {
  price: number;
  quantity: number;
  amountUSD: number;
  type: 'buy' | 'sell';
}

function findLargeLevels(
  orderBook: OrderBook,
  avgVolumePerMin: number,
  maxDistancePercent: number,
  minAmountUSD: number
): DensityCandidate[] {
  const candidates: DensityCandidate[] = [];
  const { bids, asks, currentPrice } = orderBook;
  
  for (const level of bids) {
    const distancePercent = ((currentPrice - level.price) / currentPrice) * 100;
    if (distancePercent > maxDistancePercent) continue;
    if (distancePercent < 0) continue;
    if (level.amountUSD < minAmountUSD) continue;
    
    candidates.push({
      price: level.price,
      quantity: level.quantity,
      amountUSD: level.amountUSD,
      type: 'buy',
    });
  }
  
  for (const level of asks) {
    const distancePercent = ((level.price - currentPrice) / currentPrice) * 100;
    if (distancePercent > maxDistancePercent) continue;
    if (distancePercent < 0) continue;
    if (level.amountUSD < minAmountUSD) continue;
    
    candidates.push({
      price: level.price,
      quantity: level.quantity,
      amountUSD: level.amountUSD,
      type: 'sell',
    });
  }
  
  return candidates;
}

function clusterLevels(
  candidates: DensityCandidate[],
  currentPrice: number,
  clusterThresholdPercent: number = 0.1
): DensityCandidate[] {
  if (candidates.length === 0) return [];
  
  const sorted = [...candidates].sort((a, b) => a.price - b.price);
  const clusters: DensityCandidate[] = [];
  let currentCluster: DensityCandidate | null = null;
  
  for (const level of sorted) {
    if (!currentCluster) {
      currentCluster = { ...level };
      continue;
    }
    
    const priceDiff = Math.abs(level.price - currentCluster.price) / currentPrice * 100;
    
    if (priceDiff <= clusterThresholdPercent && level.type === currentCluster.type) {
      currentCluster.amountUSD += level.amountUSD;
      currentCluster.quantity += level.quantity;
      currentCluster.price = (currentCluster.price * (currentCluster.amountUSD - level.amountUSD) + 
        level.price * level.amountUSD) / currentCluster.amountUSD;
    } else {
      clusters.push(currentCluster);
      currentCluster = { ...level };
    }
  }
  
  if (currentCluster) {
    clusters.push(currentCluster);
  }
  
  return clusters;
}

export interface ScanResult {
  densities: Density[];
  scannedCoins: number;
  errors: number;
}

export async function scanDensities(settings: DensityMapSettings): Promise<ScanResult> {
  const densities: Density[] = [];
  let scannedCoins = 0;
  let errors = 0;
  
  const [binanceTickers, bybitTickers] = await Promise.all([
    settings.exchanges.binance ? getBinanceTickers() : Promise.resolve([]),
    settings.exchanges.bybit ? getBybitTickers() : Promise.resolve([]),
  ]);
  
  const filteredTickers = [
    ...binanceTickers.filter(t => 
      t.volume24h >= settings.minVolume24h && 
      !settings.blacklist.includes(t.symbol)
    ),
    ...bybitTickers.filter(t => 
      t.volume24h >= settings.minVolume24h && 
      !settings.blacklist.includes(t.symbol)
    ),
  ];
  
  const tickerMap = new Map<string, TickerInfo>();
  for (const ticker of filteredTickers) {
    const existing = tickerMap.get(ticker.symbol);
    if (!existing || ticker.volume24h > existing.volume24h) {
      tickerMap.set(ticker.symbol, ticker);
    }
  }
  
  const uniqueTickers = Array.from(tickerMap.values())
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 100);
  
  console.log(`[DensityScanner] Scanning ${uniqueTickers.length} coins...`);
  
  const BATCH_SIZE = 10;
  
  for (let i = 0; i < uniqueTickers.length; i += BATCH_SIZE) {
    const batch = uniqueTickers.slice(i, i + BATCH_SIZE);
    
    const batchResults = await Promise.all(
      batch.map(async (ticker) => {
        try {
          const orderBook = ticker.exchange === 'binance'
            ? await getBinanceOrderBook(ticker.symbol)
            : await getBybitOrderBook(ticker.symbol);
          
          if (!orderBook) {
            errors++;
            return [];
          }
          
          const avgVolumePerMin = await getCachedAverageVolume(ticker.symbol, ticker.exchange);
          
          if (avgVolumePerMin <= 0) return [];
          
          const candidates = findLargeLevels(orderBook, avgVolumePerMin, settings.maxDistancePercent, settings.minDensityUSD);
          const clustered = clusterLevels(candidates, orderBook.currentPrice);
          
          const coinDensities: Density[] = clustered
            .map(c => {
              const distancePercent = c.type === 'buy'
                ? ((orderBook.currentPrice - c.price) / orderBook.currentPrice) * 100
                : ((c.price - orderBook.currentPrice) / orderBook.currentPrice) * 100;
              
              const dissolutionTime = c.amountUSD / avgVolumePerMin;
              
              return {
                id: `${ticker.exchange}-${ticker.symbol}-${c.type}-${c.price.toFixed(8)}`,
                symbol: ticker.symbol,
                exchange: ticker.exchange,
                type: c.type,
                price: c.price,
                currentPrice: orderBook.currentPrice,
                distancePercent: Math.abs(distancePercent),
                amountUSD: c.amountUSD,
                amountCoins: c.quantity,
                dissolutionTime,
                lifeTime: 0,
                avgVolumePerMin,
                createdAt: Date.now(),
                touchCount: 0,
              };
            })
            .filter(d => d.dissolutionTime >= settings.minDissolutionTime);
          
          scannedCoins++;
          return coinDensities;
        } catch (error) {
          errors++;
          return [];
        }
      })
    );
    
    for (const result of batchResults) {
      densities.push(...result);
    }
    
    if (i + BATCH_SIZE < uniqueTickers.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  densities.sort((a, b) => b.dissolutionTime - a.dissolutionTime);
  
  console.log(`[DensityScanner] Found ${densities.length} densities from ${scannedCoins} coins`);
  
  return { densities, scannedCoins, errors };
}

export async function getMiniChartCandles(
  symbol: string,
  exchange: Exchange,
  timeframe: string,
  bars: number
): Promise<{ time: number; open: number; high: number; low: number; close: number; volume: number }[]> {
  try {
    if (exchange === 'binance') {
      const intervalMap: Record<string, string> = {
        '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d',
      };
      
      const response = await axios.get(`${BINANCE_API}/klines`, {
        params: { symbol, interval: intervalMap[timeframe] || '5m', limit: bars },
      });
      
      return response.data.map((kline: any) => ({
        time: Math.floor(kline[0] / 1000),
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5]),
      }));
    } else {
      const intervalMap: Record<string, string> = {
        '1m': '1', '5m': '5', '15m': '15', '1h': '60', '4h': '240', '1d': 'D',
      };
      
      const response = await axios.get(`${BYBIT_API}/market/kline`, {
        params: { category: 'linear', symbol, interval: intervalMap[timeframe] || '5', limit: bars },
      });
      
      if (response.data?.retCode !== 0) return [];
      
      const klines = response.data.result?.list || [];
      return klines
        .map((kline: any) => ({
          time: Math.floor(parseInt(kline[0]) / 1000),
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4]),
          volume: parseFloat(kline[5]),
        }))
        .reverse();
    }
  } catch (error) {
    console.error(`[DensityScanner] Mini chart error for ${symbol}:`, error);
    return [];
  }
}

export function getDensityZone(distancePercent: number): 'inner' | 'middle' | 'outer' {
  if (distancePercent <= 1) return 'inner';
  if (distancePercent <= 3) return 'middle';
  return 'outer';
}

export function getCircleSize(dissolutionTime: number): 'small' | 'medium' | 'large' | 'xlarge' {
  if (dissolutionTime < 1) return 'small';
  if (dissolutionTime < 3) return 'medium';
  if (dissolutionTime < 10) return 'large';
  return 'xlarge';
}

export function getDensityHint(density: Density): { type: 'bounce' | 'breakout' | 'neutral'; message: string } {
  if (density.touchCount === 0) {
    if (density.dissolutionTime > 5) {
      return {
        type: 'bounce',
        message: 'Крупная плотность, первый подход — вероятен отскок',
      };
    }
  }
  
  if (density.touchCount >= 2) {
    return {
      type: 'breakout',
      message: `${density.touchCount} касания — плотность ослаблена, возможен пробой`,
    };
  }
  
  return {
    type: 'neutral',
    message: 'Наблюдайте за реакцией цены',
  };
}

export function formatAmount(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M$`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K$`;
  return `${amount.toFixed(0)}$`;
}

export function formatDissolutionTime(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)}с`;
  if (minutes < 60) return `${minutes.toFixed(1)}м`;
  return `${(minutes / 60).toFixed(1)}ч`;
}
