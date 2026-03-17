/**
 * API лаборатории: статус истории и загрузка с бэкенда (Python).
 */

const API_BASE = process.env.NEXT_PUBLIC_DENSITY_API ?? process.env.NEXT_PUBLIC_SCREENER_API ?? 'http://127.0.0.1:8765';

export interface LabHistoryStatus {
  available: boolean;
  days?: number;
  candlesCount?: number;
  firstTs?: number;
  lastTs?: number;
}

export interface LabDownloadStatus {
  running: boolean;
  result?: { ok: boolean; days?: number; candlesCount?: number; error?: string };
  days_so_far?: number;
}

export async function getHistoryStatus(
  symbol: string,
  timeframe: string,
  exchange: string = 'binance'
): Promise<LabHistoryStatus> {
  const params = new URLSearchParams({ symbol, timeframe, exchange });
  const res = await fetch(`${API_BASE}/api/lab/history-status?${params}`);
  if (!res.ok) return { available: false };
  return res.json();
}

export async function startDownloadHistory(
  symbol: string,
  timeframe: string,
  exchange: string = 'binance'
): Promise<{ status: string; symbol: string; timeframe: string }> {
  const res = await fetch(`${API_BASE}/api/lab/download-history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, timeframe, exchange }),
  });
  if (!res.ok) throw new Error('Download start failed');
  return res.json();
}

export async function getDownloadStatus(
  symbol: string,
  timeframe: string,
  exchange: string = 'binance'
): Promise<LabDownloadStatus> {
  const params = new URLSearchParams({ symbol, timeframe, exchange });
  const res = await fetch(`${API_BASE}/api/lab/download-status?${params}`);
  if (!res.ok) return { running: false };
  return res.json();
}

export interface LabOptimizeResult {
  scannerSigma: number;
  takeAlpha: number;
  dropLengthMinutes?: number; // Длина (L) в минутах
  maxLossUsd?: number;
  maxLossPct?: number; // Макс. убыток в % от equity
  gridLegs: number;
  gridStepPct: number;
  martinMultiplier: number;
  profitFactor: number;
  totalPnlPct: number;
  totalPnlUsd?: number;
  maxDrawdownPct?: number;
  tradesCount?: number;
  winratePct?: number;
  avgLegsPerTrade?: number;
  gridTradesCount?: number;
}

export interface OptimizationProgress {
  current: number;
  total: number;
  status: 'running' | 'completed' | 'not_found';
}

export async function optimizeOnHistory(
  symbol: string,
  timeframe: string,
  exchange: string = 'binance',
  params: {
    startLotUsd: number;
    dropLengthMinutes: number;
    commissionPct: number;
    initialEquity: number;
    retrospective?: number;
    obiFilterEnabled?: boolean;
    obiThreshold?: number;
    slippagePct?: number;
    historyDays?: number | null; // null или 0 = вся история, иначе количество дней
    fastMode?: boolean; // Быстрый режим оптимизации с уменьшенным набором параметров
    sigmaRange?: { min: number; max: number; step: number }; // Диапазон для Sigma
    alphaRange?: { min: number; max: number; step: number }; // Диапазон для Alpha
    lengthRange?: { min: number; max: number; step: number }; // Диапазон для Длины (L)
    gridLegsRange?: { min: number; max: number; step: number }; // Диапазон для Колен сетки
    gridStepRange?: { min: number; max: number; step: number }; // Диапазон для Шага сетки (%)
  }
): Promise<{ results: LabOptimizeResult[]; optimizationId?: string }> {
  const url = `${API_BASE}/api/lab/optimize`;
  console.log('[API] optimizeOnHistory - URL:', url);
  console.log('[API] optimizeOnHistory - API_BASE:', API_BASE);
  console.log('[API] optimizeOnHistory - Request body:', {
    symbol,
    timeframe,
    exchange,
    ...params,
  });
  
  try {
    // Создаем AbortController для таймаута (10 минут для оптимизации)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 минут
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        timeframe,
        exchange,
        ...params,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error('[API] optimizeOnHistory - Response not OK:', res.status, res.statusText);
      console.error('[API] optimizeOnHistory - Error body:', errorText);
      throw new Error(`Optimize failed: ${res.status} ${res.statusText}. ${errorText.substring(0, 200)}`);
    }
    
    const data = await res.json();
    console.log('[API] optimizeOnHistory - Success, results count:', data.results?.length || 0);
    if (data.error) {
      console.error('[API] optimizeOnHistory - Server returned error:', data.error);
      throw new Error(`Ошибка оптимизации на сервере: ${data.error}`);
    }
    return data;
  } catch (error) {
    console.error('[API] optimizeOnHistory - Fetch error:', error);
    if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('Failed to fetch'))) {
      throw new Error(`Не удалось подключиться к серверу API (${API_BASE}). Убедитесь, что Python сервер запущен на порту 8765. Проверьте консоль сервера на наличие ошибок.`);
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Оптимизация превысила время ожидания (10 минут). Попробуйте уменьшить диапазоны параметров или использовать быстрый режим.');
    }
    throw error;
  }
}

export async function getOptimizationProgress(optimizationId: string): Promise<OptimizationProgress> {
  const res = await fetch(`${API_BASE}/api/lab/optimize-progress?optimization_id=${optimizationId}`);
  if (!res.ok) return { current: 0, total: 0, status: 'not_found' };
  return res.json();
}

export interface EquityCurvePoint {
  time: number;
  equity: number;
}

export interface DrawdownCurvePoint {
  time: number;
  drawdown: number;
}

export interface TradeLegDetail {
  price: number;
  qty: number;
  time: number;
}

export interface TradeDetail {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  pAvg: number;
  pDropAvg: number;
  pnlUsd: number;
  legs: number;
  totalQty: number;
  duration: number;
  reason: string;
  legDetails: TradeLegDetail[];
  side?: 'long' | 'short';
}

export interface EquityMetrics {
  netProfitUsd: number;
  netProfitPct: number;
  maxDrawdownPct: number;
  recoveryFactor: number;
  profitFactor: number;
  winRate: number;
  avgTrade: number;
}

export interface EquityWarning {
  type: string;
  message: string;
  tradeIndex: number;
}

export interface EquityCurveResponse {
  equityCurve: EquityCurvePoint[];
  drawdownCurve: DrawdownCurvePoint[];
  metrics: EquityMetrics;
  trades: TradeDetail[];
  warnings: EquityWarning[];
}

export async function getEquityCurve(
  symbol: string,
  timeframe: string,
  exchange: string = 'binance',
  params: {
    startLotUsd: number;
    scannerSigma: number;
    dropLengthMinutes: number;
    retrospective?: number;
    obiFilterEnabled?: boolean;
    obiThreshold?: number;
    gridLegs?: number;
    gridStepPct?: number;
    gridStepMode?: string;
    atrPeriod?: number;
    martinMultiplier?: number;
    takeAlpha?: number | null;
    takeProfitPct?: number;
    breakEvenAfterLegs?: number;
    maxLossPct: number;
    commissionPct: number;
    slippagePct?: number;
    initialEquity: number;
    allowShort?: boolean;
    trendFilterEnabled?: boolean;
    emaPeriod?: number;
    cooldownBars?: number;
    dynamicAlphaEnabled?: boolean;
    exposureCapBoth?: boolean;
    atrRegimeFilterEnabled?: boolean;
    atrRegimeMin?: number;
    atrRegimeMax?: number;
    localExtremumBars?: number;
    trendFilterMarginPct?: number;
    minRRatio?: number;
    mlFilterEnabled?: boolean;
    mlModelPath?: string | null;
    mlLongThreshold?: number;
    mlShortThreshold?: number;
  }
): Promise<EquityCurveResponse> {
  // Таймаут 60 мин для расчёта эквити (большая история + ML на 1m может быть долгим)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60 * 60 * 1000); // 60 минут
  
  try {
    const res = await fetch(`${API_BASE}/api/lab/equity-curve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol,
        timeframe,
        exchange,
        ...params,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      throw new Error(`Equity curve failed: ${res.status} ${errorText}`);
    }
    
    const data = await res.json();
    
    // Пустая кривая — симуляция не дала ни одной точки (мало данных или нет сделок)
    if (!data.equityCurve || data.equityCurve.length === 0) {
      throw new Error(
        (data as { error?: string }).error ||
          'Нет данных эквити. Проверьте: история загружена, модель обучена, параметры не слишком строгие.'
      );
    }

    return data;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Таймаут (60 мин): расчёт занял слишком много времени. Выберите таймфрейм 15m или 1h — расчёт будет быстрее.');
    }
    throw error;
  }
}

// ─── ML pipeline (экспорт, фичи, обучение) ───

export interface MlExportResult {
  ok: boolean;
  rows: number;
  path: string;
  error: string | null;
}

export interface MlPrepareResult {
  ok: boolean;
  trainRows: number;
  valRows: number;
  testRows: number;
  error: string | null;
}

export interface MlTrainResult {
  ok: boolean;
  path: string;
  accuracyTrain: number;
  accuracyVal: number | null;
  error: string | null;
}

export async function mlExport(
  symbol: string,
  timeframe: string,
  exchange: string = 'binance',
): Promise<MlExportResult> {
  const res = await fetch(`${API_BASE}/api/lab/ml-export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, timeframe, exchange }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => 'ml-export failed'));
  return res.json();
}

export async function mlPrepare(
  symbol: string,
  timeframe: string,
  params?: { forwardBars?: number; thresholdPct?: number; trainRatio?: number; valRatio?: number },
): Promise<MlPrepareResult> {
  const res = await fetch(`${API_BASE}/api/lab/ml-prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol,
      timeframe,
      forwardBars: params?.forwardBars ?? 5,
      thresholdPct: params?.thresholdPct ?? 0.1,
      trainRatio: params?.trainRatio ?? 0.7,
      valRatio: params?.valRatio ?? 0.15,
    }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => 'ml-prepare failed'));
  return res.json();
}

export async function mlTrain(
  symbol: string,
  timeframe: string,
  params?: { maxDepth?: number; nEstimators?: number; learningRate?: number },
): Promise<MlTrainResult> {
  const res = await fetch(`${API_BASE}/api/lab/ml-train`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol,
      timeframe,
      maxDepth: params?.maxDepth ?? 6,
      nEstimators: params?.nEstimators ?? 100,
      learningRate: params?.learningRate ?? 0.1,
    }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => 'ml-train failed'));
  return res.json();
}

export interface MlModelStatus {
  available: boolean;
  path: string;
}

export async function getMlModelStatus(
  symbol: string,
  timeframe: string,
): Promise<MlModelStatus> {
  const params = new URLSearchParams({ symbol, timeframe });
  const res = await fetch(`${API_BASE}/api/lab/ml-model-status?${params}`);
  if (!res.ok) return { available: false, path: '' };
  return res.json();
}

/** Свечи из локальной истории для отображения на графике (совпадают с данными симуляции ML). */
export interface HistoryCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoryCandlesResponse {
  candles: HistoryCandle[];
  error?: string;
}

export async function getHistoryCandles(
  symbol: string,
  timeframe: string,
  exchange: string = 'binance',
  limit: number = 50000,
): Promise<HistoryCandlesResponse> {
  const params = new URLSearchParams({ symbol, timeframe, exchange, limit: String(limit) });
  const res = await fetch(`${API_BASE}/api/lab/history-candles?${params}`);
  if (!res.ok) return { candles: [], error: await res.text().catch(() => 'Failed to fetch') };
  return res.json();
}
