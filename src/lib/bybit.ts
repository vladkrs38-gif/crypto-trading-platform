import axios from 'axios';

const BYBIT_API_BASE = 'https://api.bybit.com';
const BYBIT_TIMEOUT = 15000;

export interface BybitTicker {
  symbol: string;
  lastPrice: string;
  price24hPcnt: string; // Процент изменения за 24ч (в десятичном формате, например 0.05 = 5%)
  volume24h: string;
  turnover24h: string; // Оборот в USDT
  count24h?: string; // Количество сделок за 24ч (если доступно)
}

// Получение всех USDT spot пар с Bybit
export async function getBybitUSDTPairs(): Promise<BybitTicker[]> {
  try {
    // Запрашиваем spot и linear (фьючерсы) параллельно
    const [spotResponse, linearResponse] = await Promise.all([
      axios.get(`${BYBIT_API_BASE}/v5/market/tickers`, {
        params: { category: 'spot' },
        timeout: BYBIT_TIMEOUT,
      }),
      axios.get(`${BYBIT_API_BASE}/v5/market/tickers`, {
        params: { category: 'linear' },
        timeout: BYBIT_TIMEOUT,
      }),
    ]);
    
    if (spotResponse.data?.retCode !== 0) {
      console.error('Bybit Spot API error:', spotResponse.data?.retMsg);
      return [];
    }
    
    const spotTickers = spotResponse.data?.result?.list || [];
    
    // Создаём map количества сделок из фьючерсов
    const linearCountMap = new Map<string, string>();
    if (linearResponse.data?.retCode === 0) {
      const linearTickers = linearResponse.data?.result?.list || [];
      for (const ticker of linearTickers) {
        // Фьючерсы имеют формат BTCUSDT, матчим по символу
        if (ticker.symbol && ticker.count24h) {
          linearCountMap.set(ticker.symbol, ticker.count24h);
        }
      }
    }
    
    // Собираем данные с linear (у них есть count24h)
    const linearDataMap = new Map<string, any>();
    if (linearResponse.data?.retCode === 0) {
      const linearTickers = linearResponse.data?.result?.list || [];
      for (const ticker of linearTickers) {
        if (ticker.symbol?.endsWith('USDT')) {
          linearDataMap.set(ticker.symbol, ticker);
        }
      }
    }
    
    // Собираем все USDT пары: сначала из linear (с count24h), потом из spot (без count)
    const resultMap = new Map<string, BybitTicker>();
    
    // Добавляем все linear пары (у них есть count24h)
    for (const [symbol, ticker] of linearDataMap) {
      resultMap.set(symbol, {
        symbol: ticker.symbol,
        lastPrice: ticker.lastPrice,
        price24hPcnt: ticker.price24hPcnt,
        volume24h: ticker.volume24h,
        turnover24h: ticker.turnover24h,
        count24h: ticker.count24h || '0',
      });
    }
    
    // Добавляем spot пары, которых нет в linear (берём цену со spot, count = 0)
    for (const ticker of spotTickers) {
      if (ticker.symbol?.endsWith('USDT') && !resultMap.has(ticker.symbol)) {
        resultMap.set(ticker.symbol, {
          symbol: ticker.symbol,
          lastPrice: ticker.lastPrice,
          price24hPcnt: ticker.price24hPcnt,
          volume24h: ticker.volume24h,
          turnover24h: ticker.turnover24h,
          count24h: '0', // Нет фьючерсов - нет данных
        });
      }
    }
    
    return Array.from(resultMap.values());
  } catch (error) {
    console.error('Error fetching Bybit pairs:', error);
    return [];
  }
}

// Получение klines с Bybit для корреляции (только close prices)
export async function getBybitKlines(symbol: string, interval: string = '60', limit: number = 24): Promise<number[]> {
  try {
    // Bybit interval: 1, 3, 5, 15, 30, 60, 120, 240, 360, 720, D, M, W
    const response = await axios.get(`${BYBIT_API_BASE}/v5/market/kline`, {
      params: {
        category: 'spot',
        symbol: symbol.toUpperCase(),
        interval,
        limit,
      },
      timeout: BYBIT_TIMEOUT,
    });
    
    if (response.data?.retCode !== 0) {
      console.error(`Bybit klines error for ${symbol}:`, response.data?.retMsg);
      return [];
    }
    
    const klines = response.data?.result?.list || [];
    
    // Bybit возвращает [startTime, openPrice, highPrice, lowPrice, closePrice, volume, turnover]
    // Возвращает от новых к старым, нужно перевернуть
    return klines
      .map((kline: any) => parseFloat(kline[4])) // closePrice
      .reverse();
  } catch (error) {
    console.error(`Error fetching Bybit klines for ${symbol}:`, error);
    return [];
  }
}

import type { CandleData } from '@/types/binance';

// Конвертация интервала Binance в Bybit формат
function binanceIntervalToBybit(interval: string): string {
  const mapping: Record<string, string> = {
    '1m': '1',
    '3m': '3',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '2h': '120',
    '4h': '240',
    '6h': '360',
    '8h': '480', // Bybit не поддерживает 8h напрямую, используем 360
    '12h': '720',
    '1d': 'D',
    '1w': 'W',
    '1M': 'M',
  };
  return mapping[interval] || '60';
}

// Получение полных klines с Bybit для графика (формат CandleData)
// Пробует сначала spot, потом linear (фьючерсы)
export async function getBybitKlinesFull(
  symbol: string, 
  interval: string = '1h', 
  limit: number = 500
): Promise<CandleData[]> {
  const bybitInterval = binanceIntervalToBybit(interval);
  const categories = ['spot', 'linear']; // Пробуем сначала спот, потом фьючерсы
  
  for (const category of categories) {
    try {
      const response = await axios.get(`${BYBIT_API_BASE}/v5/market/kline`, {
        params: {
          category,
          symbol: symbol.toUpperCase(),
          interval: bybitInterval,
          limit,
        },
        timeout: BYBIT_TIMEOUT,
      });
      
      if (response.data?.retCode === 0) {
        const klines = response.data?.result?.list || [];
        
        if (klines.length > 0) {
          // Bybit возвращает [startTime, openPrice, highPrice, lowPrice, closePrice, volume, turnover]
          // Возвращает от новых к старым, нужно перевернуть
          return klines
            .map((kline: any) => ({
              time: Math.floor(parseInt(kline[0]) / 1000), // ms -> seconds
              open: parseFloat(kline[1]),
              high: parseFloat(kline[2]),
              low: parseFloat(kline[3]),
              close: parseFloat(kline[4]),
              volume: parseFloat(kline[5]),
            }))
            .reverse();
        }
      }
    } catch (error) {
      // Продолжаем к следующей категории
    }
  }
  
  console.error(`Bybit klines not available for ${symbol} (tried spot and linear)`);
  return [];
}

// Получение klines за период времени (аналог getKlinesWithPeriod)
export async function getBybitKlinesWithPeriod(
  symbol: string,
  interval: string = '1h',
  periodDays: number = 3
): Promise<CandleData[]> {
  const bybitInterval = binanceIntervalToBybit(interval);
  
  // Рассчитываем сколько свечей нужно
  const intervalMinutes: Record<string, number> = {
    '1': 1, '3': 3, '5': 5, '15': 15, '30': 30,
    '60': 60, '120': 120, '240': 240, '360': 360, '720': 720,
    'D': 1440, 'W': 10080, 'M': 43200,
  };
  
  const minutes = intervalMinutes[bybitInterval] || 60;
  const totalMinutes = periodDays * 24 * 60;
  const candlesNeeded = Math.ceil(totalMinutes / minutes);
  
  // Bybit лимит 1000 свечей за запрос
  const limit = Math.min(candlesNeeded, 1000);
  
  return getBybitKlinesFull(symbol, interval, limit);
}

// Получение klines до определённого времени (для infinite scroll)
// Пробует сначала spot, потом linear (фьючерсы)
export async function getBybitKlinesBeforeTime(
  symbol: string,
  interval: string = '1h',
  endTime: number, // timestamp в секундах
  limit: number = 500
): Promise<CandleData[]> {
  const bybitInterval = binanceIntervalToBybit(interval);
  const categories = ['spot', 'linear'];
  
  for (const category of categories) {
    try {
      const response = await axios.get(`${BYBIT_API_BASE}/v5/market/kline`, {
        params: {
          category,
          symbol: symbol.toUpperCase(),
          interval: bybitInterval,
          limit,
          end: endTime * 1000,
        },
        timeout: BYBIT_TIMEOUT,
      });
      
      if (response.data?.retCode === 0) {
        const klines = response.data?.result?.list || [];
        
        if (klines.length > 0) {
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
      }
    } catch (error) {
      // Продолжаем к следующей категории
    }
  }
  
  console.error(`Bybit klines before time not available for ${symbol}`);
  return [];
}

// ============== BYBIT WEBSOCKET STREAMS ==============

const BYBIT_WS_BASE = 'wss://stream.bybit.com/v5/public/spot';
const BYBIT_WS_LINEAR = 'wss://stream.bybit.com/v5/public/linear';

// WebSocket для получения kline данных Bybit (для основного графика)
export class BybitKlineStream {
  private ws: WebSocket | null = null;
  private symbol: string;
  private interval: string; // Bybit format: 1, 3, 5, 15, 30, 60, 120, 240, 360, 720, D, W, M
  private onCandle: (candle: CandleData) => void;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private pingInterval: NodeJS.Timeout | null = null;
  private useLinear: boolean = false;

  constructor(symbol: string, interval: string, onCandle: (candle: CandleData) => void) {
    this.symbol = symbol.toUpperCase();
    // Конвертируем Binance формат в Bybit если нужно
    this.interval = binanceIntervalToBybit(interval);
    this.onCandle = onCandle;
  }

  connect(useLinear: boolean = false): void {
    this.useLinear = useLinear;
    const wsUrl = useLinear ? BYBIT_WS_LINEAR : BYBIT_WS_BASE;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log(`[BybitKlineStream] Connected to ${useLinear ? 'linear' : 'spot'} for ${this.symbol}`);
        this.reconnectAttempts = 0;
        
        // Подписываемся на kline
        const subscribeMsg = {
          op: 'subscribe',
          args: [`kline.${this.interval}.${this.symbol}`],
        };
        this.ws?.send(JSON.stringify(subscribeMsg));
        
        // Ping каждые 20 секунд для поддержания соединения
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ op: 'ping' }));
          }
        }, 20000);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Пропускаем pong и subscription responses
          if (data.op === 'pong' || data.op === 'subscribe') {
            return;
          }
          
          // Обрабатываем kline
          // Формат: { topic: "kline.1.BTCUSDT", data: [{ start, end, interval, open, close, high, low, volume, turnover, confirm, timestamp }] }
          if (data.topic && data.topic.startsWith('kline.') && data.data && data.data.length > 0) {
            for (const kline of data.data) {
              const candle: CandleData = {
                time: Math.floor(parseInt(kline.start) / 1000) as any, // ms -> seconds
                open: parseFloat(kline.open),
                high: parseFloat(kline.high),
                low: parseFloat(kline.low),
                close: parseFloat(kline.close),
                volume: parseFloat(kline.volume),
              };

              if (isFinite(candle.open) && isFinite(candle.close)) {
                this.onCandle(candle);
              }
            }
          }
        } catch (error) {
          // Ignore parsing errors
        }
      };

      this.ws.onerror = (error) => {
        console.error('[BybitKlineStream] WebSocket error:', error);
      };

      this.ws.onclose = () => {
        console.log('[BybitKlineStream] WebSocket closed');
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        
        // Если spot не работает, пробуем linear
        if (!useLinear && this.reconnectAttempts === 0) {
          console.log('[BybitKlineStream] Trying linear...');
          setTimeout(() => this.connect(true), 1000);
          return;
        }
        
        // Переподключение
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => this.connect(this.useLinear), 1000 * this.reconnectAttempts);
        }
      };
    } catch (error) {
      console.error('[BybitKlineStream] Connection error:', error);
    }
  }

  disconnect(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Интерфейс для тика
export interface BybitTickData {
  time: number;
  price: number;
  volume: number;
  isBuyerMaker: boolean;
}

// Интерфейс для уровня стакана
export interface BybitOrderBookLevel {
  price: number;
  quantity: number;
}

// Интерфейс для данных стакана
export interface BybitOrderBookData {
  bids: BybitOrderBookLevel[];
  asks: BybitOrderBookLevel[];
  imbalance: number;
  bidVolume: number;
  askVolume: number;
}

// WebSocket для получения тиков Bybit (для 20-тикового графика)
export class BybitTickStream {
  private ws: WebSocket | null = null;
  private symbol: string;
  private onTick: (tick: BybitTickData) => void;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private pingInterval: NodeJS.Timeout | null = null;
  private useLinear: boolean = false; // Использовать linear (фьючерсы) если spot недоступен

  constructor(symbol: string, onTick: (tick: BybitTickData) => void) {
    this.symbol = symbol.toUpperCase();
    this.onTick = onTick;
  }

  connect(useLinear: boolean = false): void {
    this.useLinear = useLinear;
    const wsUrl = useLinear ? BYBIT_WS_LINEAR : BYBIT_WS_BASE;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log(`[BybitTickStream] Connected to ${useLinear ? 'linear' : 'spot'}`);
        this.reconnectAttempts = 0;
        
        // Подписываемся на trades
        const subscribeMsg = {
          op: 'subscribe',
          args: [`publicTrade.${this.symbol}`],
        };
        this.ws?.send(JSON.stringify(subscribeMsg));
        
        // Ping каждые 20 секунд для поддержания соединения
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ op: 'ping' }));
          }
        }, 20000);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Пропускаем pong и subscription responses
          if (data.op === 'pong' || data.op === 'subscribe') {
            return;
          }
          
          // Обрабатываем trades
          if (data.topic && data.topic.startsWith('publicTrade.') && data.data) {
            for (const trade of data.data) {
              const tick: BybitTickData = {
                time: Math.floor(parseInt(trade.T) / 1000), // ms -> seconds
                price: parseFloat(trade.p),
                volume: parseFloat(trade.v),
                isBuyerMaker: trade.S === 'Sell', // Sell = buyer is maker
              };

              if (isFinite(tick.time) && isFinite(tick.price) && isFinite(tick.volume)) {
                this.onTick(tick);
              }
            }
          }
        } catch (error) {
          // Ignore parsing errors
        }
      };

      this.ws.onerror = (error) => {
        console.error('[BybitTickStream] WebSocket error:', error);
      };

      this.ws.onclose = () => {
        console.log('[BybitTickStream] WebSocket closed');
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        
        // Если spot не работает, пробуем linear
        if (!useLinear && this.reconnectAttempts === 0) {
          console.log('[BybitTickStream] Trying linear...');
          setTimeout(() => this.connect(true), 1000);
          return;
        }
        
        // Переподключение
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => this.connect(this.useLinear), 1000 * this.reconnectAttempts);
        }
      };
    } catch (error) {
      console.error('[BybitTickStream] Connection error:', error);
    }
  }

  disconnect(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// WebSocket для получения данных стакана Bybit
export class BybitDepthStream {
  private ws: WebSocket | null = null;
  private symbol: string;
  private levels: number;
  private onDepth: (data: BybitOrderBookData) => void;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private pingInterval: NodeJS.Timeout | null = null;
  private orderBook: { bids: Map<string, number>; asks: Map<string, number> } = {
    bids: new Map(),
    asks: new Map(),
  };
  private useLinear: boolean = false;

  constructor(symbol: string, levels: number, onDepth: (data: BybitOrderBookData) => void) {
    this.symbol = symbol.toUpperCase();
    this.levels = levels;
    this.onDepth = onDepth;
  }

  connect(useLinear: boolean = false): void {
    this.useLinear = useLinear;
    const wsUrl = useLinear ? BYBIT_WS_LINEAR : BYBIT_WS_BASE;
    
    // Bybit поддерживает 1, 50, 200, 500 уровней
    const depthLevel = this.levels <= 1 ? 1 : this.levels <= 50 ? 50 : this.levels <= 200 ? 200 : 500;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log(`[BybitDepthStream] Connected to ${useLinear ? 'linear' : 'spot'}`);
        this.reconnectAttempts = 0;
        
        // Подписываемся на orderbook
        const subscribeMsg = {
          op: 'subscribe',
          args: [`orderbook.${depthLevel}.${this.symbol}`],
        };
        this.ws?.send(JSON.stringify(subscribeMsg));
        
        // Ping каждые 20 секунд
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ op: 'ping' }));
          }
        }, 20000);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.op === 'pong' || data.op === 'subscribe') {
            return;
          }
          
          // Обрабатываем orderbook
          if (data.topic && data.topic.startsWith('orderbook.') && data.data) {
            const isSnapshot = data.type === 'snapshot';
            
            if (isSnapshot) {
              // Полный snapshot - очищаем и заполняем заново
              this.orderBook.bids.clear();
              this.orderBook.asks.clear();
            }
            
            // Обновляем bids
            if (data.data.b) {
              for (const [price, qty] of data.data.b) {
                const quantity = parseFloat(qty);
                if (quantity === 0) {
                  this.orderBook.bids.delete(price);
                } else {
                  this.orderBook.bids.set(price, quantity);
                }
              }
            }
            
            // Обновляем asks
            if (data.data.a) {
              for (const [price, qty] of data.data.a) {
                const quantity = parseFloat(qty);
                if (quantity === 0) {
                  this.orderBook.asks.delete(price);
                } else {
                  this.orderBook.asks.set(price, quantity);
                }
              }
            }
            
            // Конвертируем в массивы и сортируем
            const bids: BybitOrderBookLevel[] = Array.from(this.orderBook.bids.entries())
              .map(([p, q]) => ({ price: parseFloat(p), quantity: q }))
              .sort((a, b) => b.price - a.price)
              .slice(0, this.levels);
              
            const asks: BybitOrderBookLevel[] = Array.from(this.orderBook.asks.entries())
              .map(([p, q]) => ({ price: parseFloat(p), quantity: q }))
              .sort((a, b) => a.price - b.price)
              .slice(0, this.levels);
            
            // Рассчитываем imbalance
            const bidVolume = bids.reduce((sum, b) => sum + b.quantity, 0);
            const askVolume = asks.reduce((sum, a) => sum + a.quantity, 0);
            const totalVolume = bidVolume + askVolume;
            const imbalance = totalVolume > 0 ? (bidVolume - askVolume) / totalVolume : 0;
            
            this.onDepth({
              bids,
              asks,
              imbalance,
              bidVolume,
              askVolume,
            });
          }
        } catch (error) {
          // Ignore parsing errors
        }
      };

      this.ws.onerror = (error) => {
        console.error('[BybitDepthStream] WebSocket error:', error);
      };

      this.ws.onclose = () => {
        console.log('[BybitDepthStream] WebSocket closed');
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        
        // Если spot не работает, пробуем linear
        if (!useLinear && this.reconnectAttempts === 0) {
          console.log('[BybitDepthStream] Trying linear...');
          setTimeout(() => this.connect(true), 1000);
          return;
        }
        
        // Переподключение
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => this.connect(this.useLinear), 1000 * this.reconnectAttempts);
        }
      };
    } catch (error) {
      console.error('[BybitDepthStream] Connection error:', error);
    }
  }

  disconnect(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
