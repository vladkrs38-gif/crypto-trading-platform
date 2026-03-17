// Типы для Binance API

export interface BinancePair {
  symbol: string;
  price: string;
  priceChange: string;
  priceChangePercent: string;
  volume: string;
  quoteVolume: string;
  exchange?: 'Binance' | 'Bybit'; // Биржа (по умолчанию Binance)
}

export interface BinanceKline {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  quoteVolume: string;
  trades: number;
  takerBuyBaseVolume: string;
  takerBuyQuoteVolume: string;
}

export interface BinanceTick {
  e: string; // Event type
  E: number; // Event time
  s: string; // Symbol
  p: string; // Price
  q: string; // Quantity
  T: number; // Trade time
  m: boolean; // Is buyer maker
}

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  barDelta?: number; // Побарная дельта (опционально)
  cumulativeDelta?: number; // Кумулятивная дельта (опционально)
  imbalanceTrend?: number; // Кумулятивный лимитный дисбаланс (опционально)
}

export interface TickData {
  time: number;
  price: number;
  volume: number;
  isBuyerMaker: boolean;
}

export type Timeframe = '1' | '3' | '5' | '15' | '30' | '60' | '120' | '240' | '360' | '480' | '720' | 'D' | 'W' | 'M' | '200t';

export interface ChartData {
  candles: CandleData[];
  ticks: TickData[]; // Для 200-тикового графика
}