import axios from 'axios';
import type { BinancePair, BinanceKline, BinanceTick, CandleData, TickData, Timeframe } from '@/types/binance';

const BINANCE_DIRECT = 'https://api.binance.com/api/v3';
const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/ws';

let _binanceApiBase: string | null = null;
function getBinanceApiBase(): string {
  if (_binanceApiBase !== null) return _binanceApiBase;
  if (typeof window === 'undefined') return BINANCE_DIRECT;
  const densityApi = process.env.NEXT_PUBLIC_DENSITY_API;
  if (densityApi) {
    _binanceApiBase = `${densityApi}/api/binance-proxy`;
  } else {
    _binanceApiBase = '/api/binance-proxy';
  }
  return _binanceApiBase;
}

const API_TIMEOUT = 15000;

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  retries = 2,
  delayMs = 1500,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const status = err?.response?.status;
      if (status === 418 || status === 403 || status === 451) throw err;
      if (i < retries) await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastError;
}

let allPairsCache: { data: BinancePair[]; timestamp: number } | null = null;
const PAIRS_CACHE_DURATION = 5 * 60 * 1000;

export async function getAllUSDTPairs(): Promise<BinancePair[]> {
  const now = Date.now();
  if (allPairsCache && (now - allPairsCache.timestamp) < PAIRS_CACHE_DURATION) {
    return allPairsCache.data;
  }

  return fetchWithRetry(async () => {
    let tradingSymbols: Set<string> = new Set();
    try {
      const exchangeRes = await axios.get<{ symbols?: Array<{ symbol: string; status?: string }> }>(
        `${getBinanceApiBase()}/exchangeInfo`,
        { timeout: API_TIMEOUT },
      );
      const symbols = exchangeRes.data?.symbols ?? [];
      tradingSymbols = new Set(symbols.filter(s => s.status === 'TRADING').map(s => s.symbol));
    } catch {
      // exchangeInfo unavailable — skip status filter
    }

    const response = await axios.get(`${getBinanceApiBase()}/ticker/24hr`, { timeout: API_TIMEOUT });
    const allPairs = response.data as BinancePair[];
    const filteredPairs = allPairs
      .filter(pair => pair.symbol.endsWith('USDT') && (tradingSymbols.size === 0 || tradingSymbols.has(pair.symbol)))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

    allPairsCache = { data: filteredPairs, timestamp: now };
    return filteredPairs;
  });
}

export async function getTop10Pairs(): Promise<BinancePair[]> {
  const allPairs = await getAllUSDTPairs();
  const requiredSymbols = ['BTCUSDT', 'GMTUSDT'];

  const topPairs = allPairs.slice(0, 10);

  for (const symbol of requiredSymbols) {
    if (!topPairs.find(p => p.symbol === symbol)) {
      const pair = allPairs.find(p => p.symbol === symbol);
      if (pair) {
        const lastNonRequired = [...topPairs].reverse().findIndex(p => !requiredSymbols.includes(p.symbol));
        if (lastNonRequired !== -1) {
          topPairs[topPairs.length - 1 - lastNonRequired] = pair;
        }
      }
    }
  }

  return topPairs.sort((a, b) => {
    if (a.symbol === 'BTCUSDT') return -1;
    if (b.symbol === 'BTCUSDT') return 1;
    if (a.symbol === 'GMTUSDT') return -1;
    if (b.symbol === 'GMTUSDT') return 1;
    return parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume);
  });
}

// Получение исторических свечей
export async function getKlines(
  symbol: string,
  interval: string,
  limit: number = 500
): Promise<CandleData[]> {
  try {
    const response = await axios.get(`${getBinanceApiBase()}/klines`, {
      params: {
        symbol: symbol.toUpperCase(),
        interval,
        limit,
      },
      timeout: API_TIMEOUT,
    });

    // Binance возвращает массив массивов, а не объектов
    // Формат: [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBaseVolume, takerBuyQuoteVolume, ignore]
    const klines = response.data as any[];
    
    let cumulativeDelta = 0;
    return klines.map((kline: any) => {
      // Если это массив (стандартный формат Binance)
      if (Array.isArray(kline)) {
        const volume = parseFloat(kline[5]);
        const quoteVolume = parseFloat(kline[7] || 0);
        const takerBuyQuoteVolume = parseFloat(kline[10] || 0);
        
        // Рассчитываем побарную дельту: buy volume - sell volume
        // takerBuyQuoteVolume - объем покупок, (quoteVolume - takerBuyQuoteVolume) - объем продаж
        const barDelta = quoteVolume > 0 && takerBuyQuoteVolume > 0
          ? 2 * takerBuyQuoteVolume - quoteVolume
          : 0;
        
        cumulativeDelta += barDelta;
        
        return {
          time: Math.floor(kline[0] / 1000), // openTime в миллисекундах -> секунды
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4]),
          volume,
          barDelta,
          cumulativeDelta,
        };
      }
      // Если это объект (уже распарсенный)
      else if (typeof kline === 'object' && kline !== null) {
        const volume = parseFloat(kline.volume || kline.v);
        const quoteVolume = parseFloat(kline.quoteVolume || kline.q || 0);
        const takerBuyQuoteVolume = parseFloat(kline.takerBuyQuoteVolume || kline.Q || 0);
        
        const barDelta = quoteVolume > 0 && takerBuyQuoteVolume > 0
          ? 2 * takerBuyQuoteVolume - quoteVolume
          : 0;
        
        cumulativeDelta += barDelta;
        
        return {
          time: Math.floor((kline.openTime || kline.t) / 1000),
          open: parseFloat(kline.open || kline.o),
          high: parseFloat(kline.high || kline.h),
          low: parseFloat(kline.low || kline.l),
          close: parseFloat(kline.close || kline.c),
          volume,
          barDelta,
          cumulativeDelta,
        };
      }
      // Неизвестный формат
      throw new Error('Unknown kline format');
    });
  } catch (error) {
    throw error;
  }
}

// Быстрое получение последних свечей (один запрос, без задержек)
export async function getKlinesInitial(
  symbol: string,
  interval: string,
  limit: number = 1000
): Promise<CandleData[]> {
  return fetchWithRetry(async () => {
    const response = await axios.get(`${getBinanceApiBase()}/klines`, {
      params: {
        symbol: symbol.toUpperCase(),
        interval,
        limit: Math.min(limit, 1000),
      },
      timeout: API_TIMEOUT,
    });

    const klines = response.data as any[];
    if (!klines || klines.length === 0) {
      return [];
    }

    let cumulativeDelta = 0;

    return klines.map((kline: any) => {
      if (Array.isArray(kline)) {
        const volume = parseFloat(kline[5]);
        const quoteVolume = parseFloat(kline[7] || 0);
        const takerBuyQuoteVolume = parseFloat(kline[10] || 0);

        const barDelta = quoteVolume > 0 && takerBuyQuoteVolume > 0
          ? 2 * takerBuyQuoteVolume - quoteVolume
          : 0;

        cumulativeDelta += barDelta;

        return {
          time: Math.floor(kline[0] / 1000),
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4]),
          volume,
          barDelta,
          cumulativeDelta,
        };
      }
      throw new Error('Unknown kline format');
    });
  });
}

// Получение исторических свечей за период (несколько запросов)
export async function getKlinesWithPeriod(
  symbol: string,
  interval: string,
  periodDays: number
): Promise<CandleData[]> {
  try {
    // Получаем текущее время (в миллисекундах)
    const endTime = Date.now();
    // Время начала периода (в миллисекундах)
    const startTime = endTime - (periodDays * 24 * 60 * 60 * 1000);
    
    const allCandles: CandleData[] = [];
    
    // Binance ограничение: максимум 1000 свечей за запрос
    const maxCandlesPerRequest = 1000;
    
    // Загружаем данные батчами от начала периода к концу
    let currentStartTime = startTime;
    
    while (currentStartTime < endTime) {
      const response = await axios.get(`${getBinanceApiBase()}/klines`, {
        params: {
          symbol: symbol.toUpperCase(),
          interval,
          limit: maxCandlesPerRequest,
          startTime: currentStartTime,
          endTime: endTime,
        },
        timeout: API_TIMEOUT,
      });
      
      const klines = response.data as any[];
      
      if (!klines || klines.length === 0) {
        break;
      }
      
      // Конвертируем свечи
      const candles: CandleData[] = klines.map((kline: any) => {
        if (Array.isArray(kline)) {
          const volume = parseFloat(kline[5]);
          const quoteVolume = parseFloat(kline[7] || 0);
          const takerBuyQuoteVolume = parseFloat(kline[10] || 0);
          
          const barDelta = quoteVolume > 0 && takerBuyQuoteVolume > 0
            ? 2 * takerBuyQuoteVolume - quoteVolume
            : 0;
          
          return {
            time: Math.floor(kline[0] / 1000),
            open: parseFloat(kline[1]),
            high: parseFloat(kline[2]),
            low: parseFloat(kline[3]),
            close: parseFloat(kline[4]),
            volume,
            barDelta,
            cumulativeDelta: 0, // Пересчитаем потом
          };
        }
        throw new Error('Unknown kline format');
      });
      
      // Добавляем свечи (Binance возвращает от старых к новым)
      allCandles.push(...candles);
      
      // Если получили меньше свечей чем запрашивали - значит дошли до конца
      if (klines.length < maxCandlesPerRequest) {
        break;
      }
      
      // Обновляем время начала для следующего запроса (берем время последней свечи + 1мс)
      currentStartTime = klines[klines.length - 1][6] + 1; // closeTime + 1мс
      
      // Минимальная задержка между запросами (Binance rate limit: 2400 запросов/мин)
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Сортируем по времени (от старых к новым) на случай если были дубликаты
    allCandles.sort((a, b) => a.time - b.time);
    
    // Удаляем дубликаты (по времени)
    const uniqueCandles: CandleData[] = [];
    const seenTimes = new Set<number>();
    for (const candle of allCandles) {
      if (!seenTimes.has(candle.time)) {
        seenTimes.add(candle.time);
        uniqueCandles.push(candle);
      }
    }
    
    // Пересчитываем кумулятивную дельту для всех свечей
    let delta = 0;
    return uniqueCandles.map(candle => {
      delta += candle.barDelta;
      return {
        ...candle,
        cumulativeDelta: delta,
      };
    });
  } catch (error) {
    throw error;
  }
}

// Получение исторических свечей ДО определённого времени (для подгрузки истории)
export async function getKlinesBeforeTime(
  symbol: string,
  interval: string,
  endTime: number, // timestamp в миллисекундах
  limit: number = 500
): Promise<CandleData[]> {
  try {
    const response = await axios.get(`${getBinanceApiBase()}/klines`, {
      params: {
        symbol: symbol.toUpperCase(),
        interval,
        limit,
        endTime: endTime - 1,
      },
      timeout: API_TIMEOUT,
    });

    const klines = response.data as any[];
    
    if (!klines || klines.length === 0) {
      return [];
    }

    // Конвертируем свечи
    const candles: CandleData[] = klines.map((kline: any) => {
      if (Array.isArray(kline)) {
        const volume = parseFloat(kline[5]);
        const quoteVolume = parseFloat(kline[7] || 0);
        const takerBuyQuoteVolume = parseFloat(kline[10] || 0);
        
        const barDelta = quoteVolume > 0 && takerBuyQuoteVolume > 0
          ? 2 * takerBuyQuoteVolume - quoteVolume
          : 0;
        
        return {
          time: Math.floor(kline[0] / 1000),
          open: parseFloat(kline[1]),
          high: parseFloat(kline[2]),
          low: parseFloat(kline[3]),
          close: parseFloat(kline[4]),
          volume,
          barDelta,
          cumulativeDelta: 0, // Пересчитаем потом
        };
      }
      throw new Error('Unknown kline format');
    });

    return candles;
  } catch (error) {
    console.error(`Error fetching klines before time for ${symbol}:`, error);
    return [];
  }
}

// Конвертация таймфрейма в интервал Binance
export function timeframeToInterval(timeframe: Timeframe): string {
  const mapping: Record<Timeframe, string> = {
    '1': '1m',
    '3': '3m',
    '5': '5m',
    '15': '15m',
    '30': '30m',
    '60': '1h',
    '120': '2h',
    '240': '4h',
    '360': '6h',
    '480': '8h',
    '720': '12h',
    'D': '1d',
    'W': '1w',
    'M': '1M',
    '200t': '1m', // Для 20-тикового используем минутный интервал
  };
  
  return mapping[timeframe] || '1m';
}

// Минуты в одном баре таймфрейма (для симуляции)
export function timeframeToMinutes(timeframe: Timeframe): number {
  const mapping: Record<Timeframe, number> = {
    '1': 1,
    '3': 3,
    '5': 5,
    '15': 15,
    '30': 30,
    '60': 60,
    '120': 120,
    '240': 240,
    '360': 360,
    '480': 480,
    '720': 720,
    D: 1440,
    W: 10080,
    M: 43200,
    '200t': 1,
  };
  return mapping[timeframe] ?? 1;
}

// WebSocket для получения тиков (для 20-тикового графика)
export class BinanceTickStream {
  private ws: WebSocket | null = null;
  private symbol: string;
  private onTick: (tick: TickData) => void;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(symbol: string, onTick: (tick: TickData) => void) {
    this.symbol = symbol.toLowerCase();
    this.onTick = onTick;
  }

  connect(): void {
    const stream = `${this.symbol}@trade`;
    const wsUrl = `${BINANCE_WS_BASE}/${stream}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as BinanceTick;
          
          // Проверяем валидность данных
          if (!data || !data.T || !data.p || !data.q) {
            return;
          }

          const tick: TickData = {
            time: Math.floor(data.T / 1000), // Конвертируем в секунды и округляем
            price: parseFloat(data.p),
            volume: parseFloat(data.q),
            isBuyerMaker: data.m || false,
          };

          // Проверяем валидность тика
          if (!isFinite(tick.time) || !isFinite(tick.price) || !isFinite(tick.volume)) {
            return;
          }

          this.onTick(tick);
        } catch (error) {
          // Ignore parsing errors
        }
      };

      this.ws.onerror = () => {
        // Ignore WebSocket errors
      };

      this.ws.onclose = () => {
        this.reconnect();
      };
    } catch (error) {
      this.reconnect();
    }
  }

  private reconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      setTimeout(() => this.connect(), delay);
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  updateSymbol(symbol: string): void {
    if (this.symbol !== symbol.toLowerCase()) {
      this.disconnect();
      this.symbol = symbol.toLowerCase();
      this.connect();
    }
  }
}

// WebSocket для получения обновлений свечей
export class BinanceKlineStream {
  private ws: WebSocket | null = null;
  private symbol: string;
  private interval: string;
  private onKline: (candle: CandleData) => void;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private intentionalDisconnect = false;

  constructor(
    symbol: string,
    interval: string,
    onKline: (candle: CandleData) => void
  ) {
    this.symbol = symbol.toLowerCase();
    this.interval = interval;
    this.onKline = onKline;
  }

  connect(): void {
    this.intentionalDisconnect = false;
    const stream = `${this.symbol}@kline_${this.interval}`;
    const wsUrl = `${BINANCE_WS_BASE}/${stream}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.k) {
            const kline = data.k;
            const volume = parseFloat(kline.v);
            const quoteVolume = parseFloat(kline.q || 0);
            const takerBuyQuoteVolume = parseFloat(kline.Q || 0);
            
            // Рассчитываем побарную дельту
            const barDelta = quoteVolume > 0 && takerBuyQuoteVolume > 0
              ? 2 * takerBuyQuoteVolume - quoteVolume
              : 0;
            
            // Проверяем, что это завершенная свеча (x === true) или обновление текущей
            const candle: CandleData = {
              time: Math.floor(kline.t / 1000), // Конвертируем в секунды и округляем
              open: parseFloat(kline.o),
              high: parseFloat(kline.h),
              low: parseFloat(kline.l),
              close: parseFloat(kline.c),
              volume,
              barDelta,
            };
            
            // Проверяем валидность данных
            if (
              isFinite(candle.time) &&
              isFinite(candle.open) &&
              isFinite(candle.high) &&
              isFinite(candle.low) &&
              isFinite(candle.close)
            ) {
              this.onKline(candle);
            } else {
              // Ignore invalid candle data
            }
          }
        } catch (error) {
          // Ignore parsing errors
        }
      };

      this.ws.onerror = () => {
        // Ignore WebSocket errors
      };

      this.ws.onclose = () => {
        this.reconnect();
      };
    } catch (error) {
      this.reconnect();
    }
  }

  private reconnect(): void {
    if (this.intentionalDisconnect) return;
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      setTimeout(() => this.connect(), delay);
    } else {
      setTimeout(() => {
        if (this.intentionalDisconnect) return;
        this.reconnectAttempts = 0;
        this.connect();
      }, 60000);
    }
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.reconnectAttempts = this.maxReconnectAttempts;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  updateSymbol(symbol: string, interval: string): void {
    const needsReconnect = 
      this.symbol !== symbol.toLowerCase() || 
      this.interval !== interval;
    
    if (needsReconnect) {
      this.disconnect();
      this.symbol = symbol.toLowerCase();
      this.interval = interval;
      this.connect();
    }
  }
}

// Интерфейс для данных стакана
export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBookData {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  imbalance: number; // -1 до +1: отношение bids к asks
  bidTotal: number;
  askTotal: number;
}

/**
 * Расчет дисбаланса ликвидности в заданном проценте от mid price
 * @param bids - Массив бидов (покупки)
 * @param asks - Массив асков (продажи)
 * @param depthPercent - Процент глубины от mid price (по умолчанию 1%)
 * @returns Разница объемов: V_bids - V_asks (положительное = больше покупателей, отрицательное = больше продавцов)
 */
export function calculateLiquidityImbalance(
  bids: OrderBookLevel[],
  asks: OrderBookLevel[],
  depthPercent: number = 1
): number {
  if (bids.length === 0 || asks.length === 0) return 0;

  // Находим mid price
  const bestBid = bids[0]?.price || 0;
  const bestAsk = asks[0]?.price || 0;
  
  if (bestBid === 0 || bestAsk === 0) return 0;

  const midPrice = (bestBid + bestAsk) / 2;
  
  // Определяем границы глубины
  const lowBoundary = midPrice * (1 - depthPercent / 100);
  const highBoundary = midPrice * (1 + depthPercent / 100);

  // Суммируем объемы Bid (покупки) в пределах -X% от mid price
  const totalBidsVolume = bids
    .filter(bid => bid.price >= lowBoundary)
    .reduce((sum, bid) => sum + bid.quantity, 0);

  // Суммируем объемы Ask (продажи) в пределах +X% от mid price
  const totalAsksVolume = asks
    .filter(ask => ask.price <= highBoundary)
    .reduce((sum, ask) => sum + ask.quantity, 0);

  // Итоговый дисбаланс: V_bids - V_asks
  return totalBidsVolume - totalAsksVolume;
}

/**
 * Получение snapshot стакана через REST API
 * @param symbol - Символ пары (например, 'BTCUSDT')
 * @param limit - Количество уровней (максимум 5000, по умолчанию 1000)
 * @returns Snapshot стакана с bids и asks
 */
export async function getOrderBookSnapshot(
  symbol: string,
  limit: number = 1000
): Promise<{ bids: OrderBookLevel[]; asks: OrderBookLevel[] }> {
  try {
    const response = await axios.get(`${getBinanceApiBase()}/depth`, {
      params: {
        symbol: symbol.toUpperCase(),
        limit: Math.min(limit, 5000),
      },
      timeout: API_TIMEOUT,
    });

    const bids: OrderBookLevel[] = (response.data.bids || [])
      .map((level: string[]) => ({
        price: parseFloat(level[0]),
        quantity: parseFloat(level[1]),
      }))
      .sort((a, b) => b.price - a.price); // Сортируем по убыванию цены

    const asks: OrderBookLevel[] = (response.data.asks || [])
      .map((level: string[]) => ({
        price: parseFloat(level[0]),
        quantity: parseFloat(level[1]),
      }))
      .sort((a, b) => a.price - b.price); // Сортируем по возрастанию цены

    return { bids, asks };
  } catch (error) {
    throw error;
  }
}

// WebSocket для получения данных стакана (Order Book)
export class BinanceDepthStream {
  private ws: WebSocket | null = null;
  private symbol: string;
  private levels: number;
  private onDepth: (data: OrderBookData) => void;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  // Полный snapshot стакана в памяти
  private fullSnapshot: { bids: OrderBookLevel[]; asks: OrderBookLevel[] } | null = null;
  private snapshotLimit: number = 100; // Уменьшено с 1000 до 100 - достаточно для 3% глубины
  private snapshotUpdateInterval: NodeJS.Timeout | null = null;
  private lastSnapshotUpdate: number = 0;

  constructor(symbol: string, levels: number, onDepth: (data: OrderBookData) => void) {
    this.symbol = symbol.toLowerCase();
    this.levels = levels;
    this.onDepth = onDepth;
  }

  // Применение обновлений к snapshot
  private applyUpdatesToSnapshot(
    bids: OrderBookLevel[],
    asks: OrderBookLevel[]
  ): void {
    if (!this.fullSnapshot) {
      return;
    }

    // Применяем обновления к bids
    for (const update of bids) {
      if (update.quantity === 0) {
        // Удаляем уровень (используем точное сравнение с учетом возможных ошибок округления)
        this.fullSnapshot.bids = this.fullSnapshot.bids.filter(
          (b) => Math.abs(b.price - update.price) > 1e-10
        );
      } else {
        // Обновляем или добавляем уровень
        const existingIndex = this.fullSnapshot.bids.findIndex(
          (b) => Math.abs(b.price - update.price) <= 1e-10
        );
        if (existingIndex >= 0) {
          this.fullSnapshot.bids[existingIndex] = update;
        } else {
          this.fullSnapshot.bids.push(update);
        }
      }
    }

    // Применяем обновления к asks
    for (const update of asks) {
      if (update.quantity === 0) {
        // Удаляем уровень
        this.fullSnapshot.asks = this.fullSnapshot.asks.filter(
          (a) => Math.abs(a.price - update.price) > 1e-10
        );
      } else {
        // Обновляем или добавляем уровень
        const existingIndex = this.fullSnapshot.asks.findIndex(
          (a) => Math.abs(a.price - update.price) <= 1e-10
        );
        if (existingIndex >= 0) {
          this.fullSnapshot.asks[existingIndex] = update;
        } else {
          this.fullSnapshot.asks.push(update);
        }
      }
    }

    // Сортируем после обновлений
    this.fullSnapshot.bids.sort((a, b) => b.price - a.price);
    this.fullSnapshot.asks.sort((a, b) => a.price - b.price);
  }

  // Периодическое обновление snapshot (каждые 30 секунд)
  private async refreshSnapshot(): Promise<void> {
    try {
      const newSnapshot = await getOrderBookSnapshot(
        this.symbol,
        this.snapshotLimit
      );
      this.fullSnapshot = newSnapshot;
      this.lastSnapshotUpdate = Date.now();
      // Отправляем обновленные данные
      this.emitSnapshotData();
    } catch (error) {
      console.error('Failed to refresh order book snapshot:', error);
    }
  }

  // Отправка данных из текущего snapshot
  private emitSnapshotData(): void {
    if (!this.fullSnapshot) {
      return;
    }

    const bids = this.fullSnapshot.bids;
    const asks = this.fullSnapshot.asks;

    // Считаем общие объемы
    const bidTotal = bids.reduce((sum, b) => sum + b.quantity, 0);
    const askTotal = asks.reduce((sum, a) => sum + a.quantity, 0);
    const total = bidTotal + askTotal;
    
    // Нормализованный дисбаланс от -1 до +1
    const imbalance = total > 0 ? (bidTotal - askTotal) / total : 0;

    if (this.onDepth) {
      try {
        this.onDepth({
          bids,
          asks,
          imbalance,
          bidTotal,
          askTotal,
        });
      } catch (error) {
        // Ignore callback errors
      }
    }
  }

  async connect(): Promise<void> {
    // Загрузка snapshot в фоне - НЕ блокирует отображение данных
    // WebSocket сразу начнёт отправлять данные, snapshot подгрузится позже
    getOrderBookSnapshot(this.symbol, this.snapshotLimit)
      .then((snapshot) => {
        this.fullSnapshot = snapshot;
        this.lastSnapshotUpdate = Date.now();
        // Отправляем данные после загрузки snapshot (если WebSocket ещё не отправил)
        this.emitSnapshotData();
        // Периодический refresh убран - WebSocket поддерживает актуальность данных
      })
      .catch(() => {
        // Продолжаем с WebSocket только - данные всё равно будут отображаться
      });
    
    // Используем depth stream с ограничением уровней (5, 10, 20, или 50)
    // Для индикатора ликвидности нужно больше уровней
    const depthLevels = this.levels <= 5 ? 5 : (this.levels <= 10 ? 10 : (this.levels <= 20 ? 20 : 50));
    const stream = `${this.symbol}@depth${depthLevels}@100ms`;
    const wsUrl = `${BINANCE_WS_BASE}/${stream}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const updateTimestamp = Date.now();
          
          // Парсим обновления бидов и асков
          const bidUpdates: OrderBookLevel[] = (data.bids || [])
            .map((level: string[]) => ({
              price: parseFloat(level[0]),
              quantity: parseFloat(level[1]),
            }));
          
          const askUpdates: OrderBookLevel[] = (data.asks || [])
            .map((level: string[]) => ({
              price: parseFloat(level[0]),
              quantity: parseFloat(level[1]),
            }));

          // Применяем обновления к полному snapshot
          if (this.fullSnapshot) {
            this.applyUpdatesToSnapshot(bidUpdates, askUpdates);
            // Используем обновленный snapshot для расчета
            this.emitSnapshotData();
          } else {
            // Если snapshot еще не загружен, используем только обновления WebSocket
            // Данные отправляются сразу, не ждём загрузки snapshot
            const bids = bidUpdates.slice(0, this.levels);
            const asks = askUpdates.slice(0, this.levels);

            // Считаем общие объемы
            const bidTotal = bids.reduce((sum, b) => sum + b.quantity, 0);
            const askTotal = asks.reduce((sum, a) => sum + a.quantity, 0);
            const total = bidTotal + askTotal;
            
            // Нормализованный дисбаланс от -1 до +1
            const imbalance = total > 0 ? (bidTotal - askTotal) / total : 0;

            // Отправляем данные при каждом обновлении
            if (this.onDepth) {
              try {
                this.onDepth({
                  bids,
                  asks,
                  imbalance,
                  bidTotal,
                  askTotal,
                });
              } catch (error) {
                // Ignore callback errors
              }
            }
          }
        } catch (error) {
          // Ignore parsing errors
        }
      };

      this.ws.onerror = () => {
        // Ignore WebSocket errors
      };

      this.ws.onclose = () => {
        this.reconnect();
      };
    } catch (error) {
      this.reconnect();
    }
  }

  private reconnect(): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      setTimeout(() => this.connect(), delay);
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.snapshotUpdateInterval) {
      clearInterval(this.snapshotUpdateInterval);
      this.snapshotUpdateInterval = null;
    }
    this.fullSnapshot = null;
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnection
  }

  updateLevels(levels: number): void {
    if (this.levels !== levels) {
      this.levels = levels;
      this.reconnectAttempts = 0;
      this.disconnect();
      this.reconnectAttempts = 0;
      this.fullSnapshot = null; // Сбрасываем snapshot при изменении уровней
      this.connect();
    }
  }
}
