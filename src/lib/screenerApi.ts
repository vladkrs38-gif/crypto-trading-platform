/**
 * API клиент для скринера крупных ордеров (Python backend)
 */

const API_BASE = process.env.NEXT_PUBLIC_SCREENER_API ?? 'http://127.0.0.1:8765';

export interface BigOrderLevel {
  price: number;
  volumeUsdt: number;
  side: 'bid' | 'ask';
  /** Время свечи отскока (Unix сек) — уровень рисуется от этой свечи вправо */
  startTime?: number;
  /** Биржа: Binance или Bybit */
  exchange?: 'Binance' | 'Bybit';
}

export interface ScreenerSymbol {
  symbol: string;
  levels: BigOrderLevel[];
}

export interface ScreenerBigOrdersResponse {
  multiplier: number;
  symbols: ScreenerSymbol[];
  count: number;
}

/**
 * Получить результат скринера: монеты с уровнями крупных ордеров (Binance).
 * Множитель задаётся в .bat: set BIG_ORDER_MULTIPLIER=5
 */
export async function fetchScreenerBigOrders(): Promise<ScreenerBigOrdersResponse> {
  const response = await fetch(`${API_BASE}/api/screener/big-orders`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Screener API error: ${response.status}`);
  }
  return response.json();
}

// ===== Pre-Pump API =====

export interface PrePumpSignalApi {
  symbol: string;
  exchange: string;
  score: number;
  volumeRatio: number;
  pricePosition: number;
  takerBuyPercent: number;
  priceChangePercent: number;
  correlation: number;
  quoteVolume: number;
}

export interface PrePumpApiResponse {
  signals: PrePumpSignalApi[];
  idealSymbols: string[];
  idealCount: number;
}

export async function fetchPrePumpFromApi(): Promise<PrePumpApiResponse> {
  const response = await fetch(`${API_BASE}/api/screener/pre-pump`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`Pre-Pump API error: ${response.status}`);
  }
  return response.json();
}
