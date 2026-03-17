// Типы для карты плотностей

export type Exchange = 'binance' | 'bybit';
export type OrderType = 'buy' | 'sell';

// Плотность (крупный лимитный ордер)
export interface Density {
  id: string;
  symbol: string;
  exchange: Exchange;
  type: OrderType;
  price: number;
  currentPrice: number;
  distancePercent: number;
  amountUSD: number;
  amountCoins: number;
  dissolutionTime: number;
  lifeTime: number;
  avgVolumePerMin: number;
  createdAt: number;
  touchCount: number;
  volume24h: number; // 24h объём монеты для фильтрации
}

// Настройки Telegram уведомлений
export interface TelegramSettings {
  enabled: boolean;
  botToken: string;
  chatId: string;
  alertDistancePercent: number;  // Порог дистанции для уведомлений
  cooldownMinutes: number;        // Минимальный интервал между уведомлениями
}

// Настройки карты плотностей
export interface DensityMapSettings {
  autoUpdate: boolean;
  updateInterval: number;
  orderTypeFilter: 'all' | 'buy' | 'sell';
  maxDistancePercent: number;
  minVolume24h: number;    // Минимальный 24h объём монеты
  maxVolume24h: number;    // Максимальный 24h объём монеты (0 = без ограничения)
  minDensityUSD: number;
  minDissolutionTime: number;
  minLifetimeMinutes: number; // Минимальное время жизни плотности (для Tracker API)
  maxDensities: number;
  chartBars: number;
  chartTimeframe: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  blacklist: string[];
  showExchange: boolean;
  showDistance: boolean;
  exchanges: {
    binance: boolean;
    bybit: boolean;
  };
  telegram: TelegramSettings;
}

// Информация о монете для сканирования
export interface CoinInfo {
  symbol: string;
  exchange: Exchange;
  price: number;
  volume24h: number;
  avgVolumePerMin: number;
}

// Данные для мини-графика
export interface MiniChartData {
  symbol: string;
  exchange: Exchange;
  candles: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];
  densityPrice: number;
}

// Зоны на карте
export type DensityZone = 'inner' | 'middle' | 'outer';

// Размер круга
export type CircleSize = 'small' | 'medium' | 'large' | 'xlarge';

// AI подсказка
export interface DensityHint {
  type: 'bounce' | 'breakout' | 'neutral';
  message: string;
  confidence: number;
}
