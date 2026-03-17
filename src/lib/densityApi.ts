/**
 * API клиент для Density Tracker (Python backend)
 */

import type { Density } from '@/types/density';

const API_BASE = process.env.NEXT_PUBLIC_DENSITY_API ?? 'http://127.0.0.1:8765';

interface DensityApiResponse {
  densities: ApiDensity[];
  total: number;
  trackedCoins: number;
  timestamp: string;
}

interface ApiDensity {
  id: string;
  symbol: string;
  exchange: 'binance' | 'bybit';
  type: 'buy' | 'sell';
  price: number;
  currentPrice: number;
  distancePercent: number;
  amountUSD: number;
  amountCoins: number;
  dissolutionTime: number;
  lifeTime: number;
  lifeTimeMinutes: number;
  avgVolumePerMin: number;
  touchCount: number;
  firstSeenAt: string;
  createdAt: number;
}

interface FetchDensitiesOptions {
  minLifetime?: number;
  symbol?: string;
  exchange?: string;
  densityType?: string;
  minAmount?: number;
  maxDistance?: number;
  limit?: number;
}

/**
 * Проверить доступность Python API
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/`, { 
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
    });
    return response.ok;
  } catch (error) {
    console.error('[DensityApi] Health check failed:', error);
    return false;
  }
}

/**
 * Получить плотности из Python API
 */
export async function fetchDensitiesFromApi(options: FetchDensitiesOptions = {}): Promise<{
  densities: Density[];
  total: number;
  trackedCoins: number;
}> {
  const params = new URLSearchParams();
  
  if (options.minLifetime !== undefined) {
    params.set('min_lifetime', options.minLifetime.toString());
  }
  if (options.symbol) {
    params.set('symbol', options.symbol);
  }
  if (options.exchange) {
    params.set('exchange', options.exchange);
  }
  if (options.densityType) {
    params.set('density_type', options.densityType);
  }
  if (options.minAmount !== undefined) {
    params.set('min_amount', options.minAmount.toString());
  }
  if (options.maxDistance !== undefined) {
    params.set('max_distance', options.maxDistance.toString());
  }
  if (options.limit !== undefined) {
    params.set('limit', options.limit.toString());
  }
  
  const url = `${API_BASE}/api/densities?${params.toString()}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
    mode: 'cors',
    cache: 'no-store',
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  
  const data: DensityApiResponse = await response.json();
  
  // Преобразуем в формат фронтенда
  const densities: Density[] = data.densities.map(d => ({
    id: d.id,
    symbol: d.symbol,
    exchange: d.exchange,
    type: d.type,
    price: d.price,
    currentPrice: d.currentPrice,
    distancePercent: d.distancePercent,
    amountUSD: d.amountUSD,
    amountCoins: d.amountCoins,
    dissolutionTime: d.dissolutionTime,
    lifeTime: d.lifeTime,
    avgVolumePerMin: d.avgVolumePerMin,
    createdAt: d.createdAt,
    touchCount: d.touchCount,
  }));
  
  return {
    densities,
    total: data.total,
    trackedCoins: data.trackedCoins,
  };
}

/**
 * Получить статистику трекера
 */
export async function fetchTrackerStats(): Promise<{
  activeDensities: number;
  inactiveDensities: number;
  totalTouches: number;
  trackedCoins: number;
  isRunning: boolean;
}> {
  const response = await fetch(`${API_BASE}/api/stats`, {
    method: 'GET',
    signal: AbortSignal.timeout(5000)
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Получить детали плотности с историей касаний
 */
export async function fetchDensityDetails(densityId: string): Promise<{
  density: ApiDensity;
  touches: Array<{
    touch_time: string;
    price_at_touch: number;
    distance_percent: number;
  }>;
}> {
  const response = await fetch(`${API_BASE}/api/densities/${encodeURIComponent(densityId)}`, {
    method: 'GET',
    signal: AbortSignal.timeout(5000)
  });
  
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  
  return response.json();
}
