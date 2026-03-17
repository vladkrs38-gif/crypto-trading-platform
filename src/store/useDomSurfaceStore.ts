import { create } from 'zustand';
import type { CandleData } from '@/types/binance';

export type LabBotMode = 'history' | 'live';
export type LabBotType = 'apex' | 'kanal';

export interface LabTrade {
  id: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  volume: number;
  pnlUsd: number;
  pnlPct: number;
  /** true = сделка из лайв-режима (цвет синий/жёлтый), false/undefined = с истории (зелёный/красный) */
  isLive?: boolean;
  /** Детали колен (усреднений) */
  legDetails?: Array<{ price: number; qty: number; time: number }>;
  /** История Take Profit (динамически пересчитывается при каждом колене) */
  takeProfitHistory?: Array<{ time: number; price: number }>;
  /** Причина выхода: 'SL' стоп-лосс, 'TP' тейк-профит, 'end' принудительное закрытие в конце периода */
  exitReason?: 'SL' | 'TP' | 'end';
  /** Сторона позиции: 'long' | 'short' (Apex Logic) */
  side?: 'long' | 'short';
}

export interface LabEquityPoint {
  time: number;
  equity: number;
}

export interface LabStats {
  totalPnlUsd: number;
  totalPnlPct: number;
  maxDrawdownPct: number;
  tradesCount: number;
  winratePct: number;
  avgPnlUsd: number;
  avgPnlPct: number;
  profitFactor: number;
  avgLegsCount: number; // Среднее количество колен на сделку
}

/** Одно колено (запись в сетке) */
interface PositionLeg {
  price: number;
  qty: number;
  time: number;
}

/** Состояние одной позиции (лонг или шорт) для одновременного удержания */
interface PosState {
  legs: PositionLeg[];
  totalQty: number;
  totalCost: number;
  pAvg: number;
  pDropAvg: number;
  totalFees: number;
  entryAtr: number;
  takeProfitHistory: Array<{ time: number; price: number }>;
}

/** Состояние симуляции на границе «история / лайв» для инкрементальной обработки только новых свечей. Поддержка двух позиций (лонг + шорт одновременно). */
export interface LiveState {
  lastProcessedIndex: number;
  equity: number;
  // Две позиции (лонг и шорт независимо)
  legsLong: PositionLeg[];
  totalQtyLong: number;
  totalCostLong: number;
  pAvgLong: number;
  pDropAvgLong: number;
  totalFeesLong: number;
  entryAtrLong: number;
  legsShort: PositionLeg[];
  totalQtyShort: number;
  totalCostShort: number;
  pAvgShort: number;
  pDropAvgShort: number;
  totalFeesShort: number;
  entryAtrShort: number;
  // Rolling Z-Score state
  retroWindow: number[];
  retroSum: number;
  retroSumSq: number;
  volWindow: number[];
  volSum: number;
  lastCloseBarLong?: number;
  lastCloseBarShort?: number;
  // Legacy: одна позиция (если есть — мигрируем в long/short при загрузке)
  posSide?: 'long' | 'short';
  legs?: PositionLeg[];
  totalQty?: number;
  totalCost?: number;
  pAvg?: number;
  pDropAvg?: number;
  totalFees?: number;
  entryAtr?: number;
}

export interface KanalParams {
  period: number;
  multiplier: number;
  /** Включить стоп-лосс в % от цены входа */
  stopLossEnabled: boolean;
  /** Макс. убыток в % от цены входа (лонг: выход при low <= entry*(1 - stopLossPct/100); шорт: при high >= entry*(1 + stopLossPct/100)) */
  stopLossPct: number;
  startLotUsd: number;
  commissionPct: number;
  slippagePct: number;
  initialEquity: number;
  allowShort: boolean;
}

interface DomSurfaceState {
  mode: LabBotMode;
  botType: LabBotType;
  initialEquity: number;
  equity: number;
  isRunning: boolean;
  trades: LabTrade[];
  equityCurve: LabEquityPoint[];
  stats: LabStats | null;
  apexParams: ApexParams;
  apexPreset: ApexPresetId;
  kanalParams: KanalParams;
  liveModeStartTradeCount: number | null;
  /** Состояние для инкрементального лайва (только новые свечи); null = ещё не инициализировано */
  liveState: LiveState | null;

  setMode: (mode: LabBotMode) => void;
  setBotType: (botType: LabBotType) => void;
  resetSession: () => void;
  setSimulationResult: (
    trades: LabTrade[],
    equityCurve: LabEquityPoint[],
    stats: LabStats,
    finalEquity: number
  ) => void;
  /** Добавить сделки, посчитанные в лайве по новым свечам; пересчитывает эквити и метрики */
  appendLiveTrades: (newTrades: LabTrade[], finalEquity: number, newEquityCurvePoints: LabEquityPoint[]) => void;
  setLiveState: (state: LiveState | null) => void;
  setLiveModeStartTradeCount: (count: number) => void;
  setApexParams: (patch: Partial<ApexParams>) => void;
  setApexPreset: (preset: ApexPresetId) => void;
  setKanalParams: (patch: Partial<KanalParams>) => void;
}

const DEFAULT_STATS: LabStats = {
  totalPnlUsd: 0,
  totalPnlPct: 0,
  maxDrawdownPct: 0,
  tradesCount: 0,
  winratePct: 0,
  avgPnlUsd: 0,
  avgPnlPct: 0,
  profitFactor: 0,
  avgLegsCount: 0,
};

function computeStatsFromTrades(trades: LabTrade[], initialEquity: number): LabStats {
  const tradesCount = trades.length;
  if (tradesCount === 0) {
    return { ...DEFAULT_STATS };
  }
  let equity = initialEquity;
  let peakEquity = initialEquity;
  let maxDrawdownPct = 0;
  for (const t of trades) {
    equity += t.pnlUsd;
    if (equity > peakEquity) peakEquity = equity;
    // Max Drawdown % рассчитывается от Initial Equity (а не от peakEquity)
    // Формула: Max Drawdown % = ((peakEquity - currentEquity) / initialEquity) * 100
    const ddPct = initialEquity > 0 ? ((peakEquity - equity) / initialEquity) * 100 : 0;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
  }
  const totalPnlUsd = equity - initialEquity;
  const totalPnlPct = (totalPnlUsd / initialEquity) * 100;
  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd < 0);
  const winratePct = (wins.length / tradesCount) * 100;
  const avgPnlUsd = totalPnlUsd / tradesCount;
  const avgPnlPct = totalPnlPct / tradesCount;
  const grossProfit = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = losses.reduce((s, t) => s + Math.abs(t.pnlUsd), 0);
  const profitFactor =
    grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? Infinity : 0;
  
  // Среднее количество колен на сделку
  const totalLegs = trades.reduce((sum, t) => {
    const legsCount = t.legDetails ? t.legDetails.length : 1;
    return sum + legsCount;
  }, 0);
  const avgLegsCount = tradesCount > 0 ? totalLegs / tradesCount : 0;
  
  return {
    totalPnlUsd,
    totalPnlPct,
    maxDrawdownPct,
    tradesCount,
    winratePct,
    avgPnlUsd,
    avgPnlPct,
    profitFactor,
    avgLegsCount,
  };
}

export const useDomSurfaceStore = create<DomSurfaceState>((set) => ({
  mode: 'history',
  botType: 'apex',
  initialEquity: 100,
  equity: 100,
  isRunning: false,
  trades: [],
  equityCurve: [],
  stats: null,
  liveModeStartTradeCount: null,
  liveState: null,
  kanalParams: {
    period: 20,
    multiplier: 2,
    stopLossEnabled: false,
    stopLossPct: 2,
    startLotUsd: 10,
    commissionPct: 0.04,
    slippagePct: 0.01,
    initialEquity: 100,
    allowShort: true,
  },
  apexPreset: 'balanced',
  apexParams: {
    startLotUsd: 10,
    scannerSigma: 3.8,
    dropLengthMinutes: 5,
    retrospective: 100,
    obiFilterEnabled: true,
    obiThreshold: 0.68,
    gridLegs: 1,
    gridStepPct: 1.0,
    gridStepMode: 'atr',
    atrPeriod: 14,
    martinMultiplier: 1.08,
    takeAlpha: 1.35,
    takeProfitPct: 0.003,
    breakEvenAfterLegs: 0,
    maxLossPct: 2.2,
    commissionPct: 0.04,
    slippagePct: 0.01,
    timeframeMinutes: 1,
    initialEquity: 100,
    allowShort: true,
    trendFilterEnabled: true,
    emaPeriod: 50,
    cooldownBars: 10,
    dynamicAlphaEnabled: true,
    exposureCapBoth: true,
    atrRegimeFilterEnabled: true,
    atrRegimeMin: 0.6,
    atrRegimeMax: 1.7,
    localExtremumBars: 2,
    trendFilterMarginPct: 0.06,
    minRRatio: 1.15,
  },

  setMode: (mode) =>
    set((state) => {
      if (mode === 'live') {
        return {
          mode,
          liveModeStartTradeCount: state.liveModeStartTradeCount ?? state.trades.length,
        };
      }
      return { mode, liveModeStartTradeCount: null, liveState: null };
    }),

  setBotType: (botType) =>
    set({
      botType,
      trades: [],
      equityCurve: [],
      stats: DEFAULT_STATS,
      equity: 100,
      liveModeStartTradeCount: null,
      liveState: null,
    }),

  resetSession: () =>
    set({
      equity: 100,
      isRunning: false,
      trades: [],
      equityCurve: [],
      stats: DEFAULT_STATS,
      liveModeStartTradeCount: null,
      liveState: null,
    }),

  setLiveState: (state) => set({ liveState: state }),

  setLiveModeStartTradeCount: (count) => set({ liveModeStartTradeCount: count }),

  appendLiveTrades: (newTrades, finalEquity, newEquityCurvePoints) =>
    set((state) => {
      if (newTrades.length === 0 && newEquityCurvePoints.length === 0) {
        return { equity: finalEquity };
      }
      const nextId = state.trades.length > 0
        ? Math.max(...state.trades.map((t) => t.id)) + 1
        : 1;
      const taggedNew: LabTrade[] = newTrades.map((t, i) => ({
        ...t,
        id: nextId + i,
        isLive: true,
      }));
      const allTrades = [...state.trades, ...taggedNew];
      const allEquityCurve = [...state.equityCurve, ...newEquityCurvePoints];
      const stats = computeStatsFromTrades(allTrades, state.initialEquity);
      return {
        trades: allTrades,
        equityCurve: allEquityCurve,
        equity: finalEquity,
        stats,
        isRunning: false,
      };
    }),

  setSimulationResult: (trades, equityCurve, stats, finalEquity) =>
    set((state) => {
      const taggedTrades: LabTrade[] = trades.map((t, i) => ({
        ...t,
        isLive:
          state.mode === 'history'
            ? false
            : state.liveModeStartTradeCount != null
              ? i >= state.liveModeStartTradeCount!
              : false,
      }));
      return {
        trades: taggedTrades,
        equityCurve,
        stats,
        equity: finalEquity,
        isRunning: false,
      };
    }),
  
  setApexParams: (patch) =>
    set((state) => ({
      apexParams: {
        ...state.apexParams,
        ...patch,
      },
    })),

  setApexPreset: (preset) =>
    set((state) => ({
      apexPreset: preset,
      apexParams: {
        ...state.apexParams,
        ...APEX_PRESETS[preset],
        initialEquity: state.apexParams.initialEquity,
        startLotUsd: state.apexParams.startLotUsd,
        commissionPct: state.apexParams.commissionPct,
        slippagePct: state.apexParams.slippagePct,
      },
    })),

  setKanalParams: (patch) =>
    set((state) => ({
      kanalParams: {
        ...state.kanalParams,
        ...patch,
      },
    })),
}));

// ====== Модернизированная Apex-симуляция: Z-Score + Сетка/Мартингейл + Продвинутый Тейк ======

export interface ApexParams {
  // Сканер
  startLotUsd: number;
  scannerSigma: number;      // S — порог Z-Score (вход при Z <= -S)
  dropLengthMinutes: number;  // L в минутах
  retrospective: number;      // R — окно для μ/σ в барах
  // OBI фильтр
  obiFilterEnabled: boolean;
  obiThreshold: number;       // мин. vol/avg для входа
  // Сетка / Мартингейл
  gridLegs: number;           // макс. колен усреднения (0 = выкл)
  gridStepPct: number;        // шаг сетки %
  gridStepMode: 'fixed' | 'atr';
  atrPeriod: number;
  martinMultiplier: number;   // множитель лота на колено
  // Тейк-профит
  takeAlpha: number | null;   // α для формулы, null = legacy
  takeProfitPct: number;      // legacy фиксированный %
  breakEvenAfterLegs: number; // после N колен — режим БУ
  // Риск
  maxLossPct: number;  // Макс. убыток в % от средней цены входа (P_avg)
                       // Формула: StopPrice = P_avg * (1 - maxLossPct / 100)
                       // Обеспечивает одинаковое поведение при любом Start Lot и количестве колен
  // Исполнение
  commissionPct: number;
  slippagePct: number;
  // Мета
  timeframeMinutes: number;
  initialEquity: number;
  allowShort: boolean;
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
  /** Минимальное R:R при входе: тейк-дистанция >= minRRatio * стоп-дистанция (default 1.15) */
  minRRatio?: number;
  /** ML-фильтр входа: использовать предсказание XGBoost (только бэкенд equity-curve/оптимизация) */
  mlFilterEnabled?: boolean;
  mlModelPath?: string | null;
  mlLongThreshold?: number;
  mlShortThreshold?: number;
}

export type ApexPresetId = 'conservative' | 'balanced' | 'aggressive';

export const APEX_PRESETS: Record<ApexPresetId, Partial<ApexParams>> = {
  conservative: {
    scannerSigma: 4.2, dropLengthMinutes: 5, retrospective: 100,
    obiFilterEnabled: true, obiThreshold: 0.78,
    gridLegs: 0, gridStepPct: 1, gridStepMode: 'atr', atrPeriod: 14, martinMultiplier: 1,
    takeAlpha: 1.25, takeProfitPct: 0.003, breakEvenAfterLegs: 0, maxLossPct: 1.8,
    trendFilterEnabled: true, emaPeriod: 50, cooldownBars: 18, dynamicAlphaEnabled: true, exposureCapBoth: true,
    atrRegimeFilterEnabled: true, atrRegimeMin: 0.6, atrRegimeMax: 1.7, localExtremumBars: 2, trendFilterMarginPct: 0.06,
    minRRatio: 1.2,
  },
  balanced: {
    scannerSigma: 3.8, dropLengthMinutes: 5, retrospective: 100,
    obiFilterEnabled: true, obiThreshold: 0.68,
    gridLegs: 1, gridStepPct: 1, gridStepMode: 'atr', atrPeriod: 14, martinMultiplier: 1.08,
    takeAlpha: 1.35, takeProfitPct: 0.003, breakEvenAfterLegs: 0, maxLossPct: 2.2,
    trendFilterEnabled: true, emaPeriod: 50, cooldownBars: 10, dynamicAlphaEnabled: true, exposureCapBoth: true,
    atrRegimeFilterEnabled: true, atrRegimeMin: 0.6, atrRegimeMax: 1.7, localExtremumBars: 2, trendFilterMarginPct: 0.06,
    minRRatio: 1.15,
  },
  aggressive: {
    scannerSigma: 3.5, dropLengthMinutes: 5, retrospective: 100,
    obiFilterEnabled: true, obiThreshold: 0.64,
    gridLegs: 1, gridStepPct: 1, gridStepMode: 'atr', atrPeriod: 14, martinMultiplier: 1.08,
    takeAlpha: 1.4, takeProfitPct: 0.003, breakEvenAfterLegs: 0, maxLossPct: 2.2,
    trendFilterEnabled: true, emaPeriod: 50, cooldownBars: 7, dynamicAlphaEnabled: true, exposureCapBoth: true,
    atrRegimeFilterEnabled: true, atrRegimeMin: 0.6, atrRegimeMax: 1.7, localExtremumBars: 2, trendFilterMarginPct: 0.05,
    minRRatio: 1.15,
  },
};

export interface ApexSimulationResult {
  trades: LabTrade[];
  equityCurve: LabEquityPoint[];
  stats: LabStats;
  finalEquity: number;
  /** Состояние после последней свечи — для продолжения в лайве */
  endState: LiveState;
}

// ─── Вспомогательные функции ───

function _calcAtr(candles: CandleData[], endIdx: number, period: number): number {
  const start = Math.max(1, endIdx - period + 1);
  if (start > endIdx) return 0;
  let sum = 0;
  let count = 0;
  for (let j = start; j <= endIdx; j++) {
    const h = candles[j].high;
    const l = candles[j].low;
    const prevC = candles[j - 1].close;
    const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    sum += tr;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/** EMA(period) at endIdx (Apex: trend filter). */
function _calcEma(closes: number[], endIdx: number, period: number): number {
  if (endIdx < 0 || period < 1) return 0;
  const k = 2 / (period + 1);
  let ema = closes[Math.max(0, endIdx - period)];
  for (let j = endIdx - period + 1; j <= endIdx; j++) {
    if (j >= 0) ema = closes[j] * k + ema * (1 - k);
  }
  return ema;
}

/** Median of ATR over [endIdx - lookback + 1, endIdx] (Apex: dynamic alpha). */
function _calcAtrMedian(candles: CandleData[], endIdx: number, atrPeriod: number, lookback: number): number {
  const start = Math.max(atrPeriod, endIdx - lookback + 1);
  if (start > endIdx) return _calcAtr(candles, endIdx, atrPeriod);
  const arr: number[] = [];
  for (let j = start; j <= endIdx; j++) {
    arr.push(_calcAtr(candles, j, atrPeriod));
  }
  arr.sort((a, b) => a - b);
  const mid = arr.length >> 1;
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function _getTime(candle: CandleData): number {
  return typeof candle.time === 'number' ? candle.time : parseFloat(String(candle.time));
}

function _slip(price: number, isBuy: boolean, rate: number): number {
  return isBuy ? price * (1 + rate) : price * (1 - rate);
}

function _emptyLiveState(equity: number): LiveState {
  return {
    lastProcessedIndex: -1,
    equity,
    legsLong: [], totalQtyLong: 0, totalCostLong: 0, pAvgLong: 0, pDropAvgLong: 0, totalFeesLong: 0, entryAtrLong: 0,
    legsShort: [], totalQtyShort: 0, totalCostShort: 0, pAvgShort: 0, pDropAvgShort: 0, totalFeesShort: 0, entryAtrShort: 0,
    retroWindow: [], retroSum: 0, retroSumSq: 0,
    volWindow: [], volSum: 0,
  };
}

// ─── Основная симуляция: Z-Score + Grid/Martingale + Advanced Take ───

export function runApexSimulation(
  candles: CandleData[],
  params: ApexParams
): ApexSimulationResult {
  const initialEquity = params.initialEquity || 100;
  if (!candles || candles.length === 0) {
    return {
      trades: [], equityCurve: [], stats: DEFAULT_STATS,
      finalEquity: initialEquity, endState: _emptyLiveState(initialEquity),
    };
  }

  const {
    startLotUsd, scannerSigma, dropLengthMinutes, retrospective: R,
    obiFilterEnabled, obiThreshold,
    gridLegs, gridStepPct, gridStepMode, atrPeriod, martinMultiplier,
    takeAlpha, takeProfitPct, breakEvenAfterLegs,
    maxLossPct, commissionPct, slippagePct, timeframeMinutes,
    allowShort = true,
    trendFilterEnabled = true,
    emaPeriod = 50,
    cooldownBars = 5,
    dynamicAlphaEnabled = true,
    exposureCapBoth = true,
    atrRegimeFilterEnabled = true,
    atrRegimeMin = 0.5,
    atrRegimeMax = 2,
    localExtremumBars = 2,
    trendFilterMarginPct = 0.05,
    minRRatio = 1.15,
  } = params;

  const L = Math.max(1, Math.round(dropLengthMinutes / timeframeMinutes));
  const commissionRate = commissionPct / 100;
  const slippageRate = slippagePct / 100;
  const gridStepFrac = gridStepPct / 100;
  const n = candles.length;

  // Предвычисления: closes, volumes, L-bar returns
  const closes: number[] = new Array(n);
  const volumes: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    closes[i] = candles[i].close;
    volumes[i] = (candles[i] as any).volume ?? 0;
  }
  const returns: number[] = new Array(n).fill(0);
  for (let i = L; i < n; i++) {
    if (closes[i - L] > 0) returns[i] = (closes[i] - closes[i - L]) / closes[i - L];
  }

  const startBar = L + R;
  if (startBar >= n) {
    return {
      trades: [], equityCurve: [], stats: DEFAULT_STATS,
      finalEquity: initialEquity, endState: _emptyLiveState(initialEquity),
    };
  }

  // Init rolling retrospective window
  const retroWindow: number[] = [];
  let retroSum = 0, retroSumSq = 0;
  for (let j = L; j < L + R; j++) {
    retroWindow.push(returns[j]);
    retroSum += returns[j];
    retroSumSq += returns[j] * returns[j];
  }

  // Init rolling volume window
  const volWindow: number[] = [];
  let volSum = 0;
  const volStart = Math.max(0, startBar - R);
  for (let j = volStart; j < startBar; j++) {
    volWindow.push(volumes[j]);
    volSum += volumes[j];
  }

  let equity = initialEquity;
  let tradeId = 1;
  const trades: LabTrade[] = [];
  const equityCurve: LabEquityPoint[] = [];

  const long: PosState = { legs: [], totalQty: 0, totalCost: 0, pAvg: 0, pDropAvg: 0, totalFees: 0, entryAtr: 0, takeProfitHistory: [] };
  const short: PosState = { legs: [], totalQty: 0, totalCost: 0, pAvg: 0, pDropAvg: 0, totalFees: 0, entryAtr: 0, takeProfitHistory: [] };
  let lastCloseBarLong = -999;
  let lastCloseBarShort = -999;

  const addLeg = (pos: PosState, price: number, qty: number, time: number, fee: number) => {
    pos.legs.push({ price, qty, time });
    pos.totalCost += price * qty;
    pos.totalQty += qty;
    pos.pAvg = pos.totalQty > 0 ? pos.totalCost / pos.totalQty : 0;
    pos.totalFees += fee;
    updateTakeProfitHistory(pos, time, pos === long);
  };

  const resetPos = (pos: PosState) => {
    pos.legs = [];
    pos.totalQty = 0;
    pos.totalCost = 0;
    pos.pAvg = 0;
    pos.pDropAvg = 0;
    pos.totalFees = 0;
    pos.entryAtr = 0;
    pos.takeProfitHistory = [];
  };

  const updateTakeProfitHistory = (pos: PosState, time: number, isLong: boolean, alphaOverride?: number | null) => {
    if (pos.legs.length === 0) return;
    const alpha = alphaOverride !== undefined ? alphaOverride : takeAlpha;
    let takePrice: number;
    if (isLong) {
      if (breakEvenAfterLegs > 0 && pos.legs.length >= breakEvenAfterLegs) {
        takePrice = pos.pAvg + (pos.totalQty > 0 ? (pos.totalFees + pos.pAvg * pos.totalQty * commissionRate) / pos.totalQty : 0);
      } else if (alpha !== null && alpha !== undefined && pos.pDropAvg > 0) {
        takePrice = pos.pAvg + (pos.pDropAvg - pos.pAvg) * alpha;
      } else {
        takePrice = pos.pAvg * (1 + takeProfitPct);
      }
    } else {
      if (breakEvenAfterLegs > 0 && pos.legs.length >= breakEvenAfterLegs) {
        takePrice = pos.pAvg - (pos.totalQty > 0 ? (pos.totalFees + pos.pAvg * pos.totalQty * commissionRate) / pos.totalQty : 0);
      } else if (alpha !== null && alpha !== undefined && pos.pDropAvg > 0) {
        takePrice = pos.pAvg - (pos.pDropAvg - pos.pAvg) * alpha;
      } else {
        takePrice = pos.pAvg * (1 - takeProfitPct);
      }
    }
    pos.takeProfitHistory.push({ time, price: takePrice });
  };

  const currentEquity = (closeI: number) =>
    equity +
    (long.totalQty > 0 ? (closeI - long.pAvg) * long.totalQty - long.totalFees : 0) +
    (short.totalQty > 0 ? (short.pAvg - closeI) * short.totalQty - short.totalFees : 0);

  const closePosition = (side: 'long' | 'short', exitPriceRaw: number, time: number, exitReason: 'SL' | 'TP' | 'end' = 'TP') => {
    const pos = side === 'long' ? long : short;
    const exitPrice = _slip(exitPriceRaw, side === 'long' ? false : true, slippageRate);
    const exitFee = exitPrice * pos.totalQty * commissionRate;
    const grossPnl = side === 'long' ? (exitPrice - pos.pAvg) * pos.totalQty : (pos.pAvg - exitPrice) * pos.totalQty;
    const pnlUsd = grossPnl - pos.totalFees - exitFee;
    const pnlPct = equity > 0 ? (pnlUsd / equity) * 100 : 0;
    equity += pnlUsd;

    trades.push({
      id: tradeId++,
      entryTime: pos.legs.length > 0 ? pos.legs[0].time : time,
      exitTime: time,
      entryPrice: pos.pAvg,
      exitPrice,
      volume: pos.totalQty,
      pnlUsd,
      pnlPct,
      legDetails: pos.legs.length > 0 ? [...pos.legs] : undefined,
      takeProfitHistory: pos.takeProfitHistory.length > 0 ? [...pos.takeProfitHistory] : undefined,
      exitReason,
      side,
    });
    equityCurve.push({ time, equity });
    resetPos(pos);
  };

  // Main loop
  for (let i = startBar; i < n; i++) {
    const timeI = _getTime(candles[i]);
    const closeI = closes[i];
    const lowI = candles[i].low;
    const highI = candles[i].high;

    const atrNow = _calcAtr(candles, i, atrPeriod);
    const atrMedian = _calcAtrMedian(candles, i, atrPeriod, 50);
    const alphaEff =
      (dynamicAlphaEnabled && takeAlpha != null && atrMedian > 1e-12)
        ? takeAlpha * (atrNow / atrMedian)
        : takeAlpha;
    const gridLegsEff =
      exposureCapBoth && long.legs.length > 0 && short.legs.length > 0 ? 0 : gridLegs;
    const ema = _calcEma(closes, i, emaPeriod);
    const atrRatio = atrMedian > 1e-12 ? atrNow / atrMedian : 1;
    const atrRegimeOk = !atrRegimeFilterEnabled || (atrRatio >= atrRegimeMin && atrRatio <= atrRegimeMax);
    const lookback = Math.min(localExtremumBars, i - startBar);
    const localMinOk = lookback <= 0 || returns[i] <= Math.min(...Array.from({ length: lookback + 1 }, (_, k) => returns[i - k]));
    const localMaxOk = lookback <= 0 || returns[i] >= Math.max(...Array.from({ length: lookback + 1 }, (_, k) => returns[i - k]));
    const marginMult = 1 + trendFilterMarginPct / 100;

    // Rolling Z-Score: лонг при падении (Z <= -S), шорт при всплеске (Z >= +S)
    const mu = R > 0 ? retroSum / R : 0;
    const variance = R > 0 ? (retroSumSq / R) - (mu * mu) : 0;
    const sigma = Math.sqrt(Math.max(0, variance));
    const zScore = sigma > 1e-12 ? (returns[i] - mu) / sigma : 0;
    const signalLong = zScore <= -scannerSigma;
    const signalShort = zScore >= scannerSigma;

    const avgVol = volWindow.length > 0 ? volSum / volWindow.length : 1;
    const volRatio = avgVol > 0 ? volumes[i] / avgVol : 0;
    const curEq = currentEquity(closeI);

    // Управление лонгом
    if (long.legs.length > 0) {
      const stopPrice = long.pAvg * (1 - maxLossPct / 100);
      if (lowI <= stopPrice) {
        closePosition('long', stopPrice, timeI, 'SL');
        lastCloseBarLong = i;
      } else {
        if (gridLegsEff > 0 && long.legs.length < gridLegsEff + 1) {
          let step = gridStepFrac;
          if (gridStepMode === 'atr' && long.entryAtr > 0) step = gridStepFrac * (_calcAtr(candles, i, atrPeriod) / long.entryAtr);
          const nextLevel = long.pAvg * (1 - step);
          if (lowI <= nextLevel) {
            const legLot = startLotUsd * Math.pow(martinMultiplier, long.legs.length);
            if (legLot <= curEq) {
              const buyPrice = _slip(nextLevel, true, slippageRate);
              const legQty = buyPrice > 0 ? legLot / buyPrice : 0;
              addLeg(long, buyPrice, legQty, timeI, buyPrice * legQty * commissionRate);
            }
          }
        }
        if (long.legs.length > 0) {
          let takePrice: number;
          if (breakEvenAfterLegs > 0 && long.legs.length >= breakEvenAfterLegs) {
            takePrice = long.pAvg + (long.totalQty > 0 ? (long.totalFees + long.pAvg * long.totalQty * commissionRate) / long.totalQty : 0);
          } else if (alphaEff != null && long.pDropAvg > 0) {
            takePrice = long.pAvg + (long.pDropAvg - long.pAvg) * alphaEff;
          } else {
            takePrice = long.pAvg * (1 + takeProfitPct);
          }
          const lastTake = long.takeProfitHistory.length > 0 ? long.takeProfitHistory[long.takeProfitHistory.length - 1].price : 0;
          if (Math.abs(takePrice - lastTake) > 1e-8) updateTakeProfitHistory(long, timeI, true, alphaEff);
          if (highI >= takePrice) {
            closePosition('long', takePrice, timeI, 'TP');
            lastCloseBarLong = i;
          }
        }
      }
    }

    // Управление шортом
    if (short.legs.length > 0) {
      const stopPrice = short.pAvg * (1 + maxLossPct / 100);
      if (highI >= stopPrice) {
        closePosition('short', stopPrice, timeI, 'SL');
        lastCloseBarShort = i;
      } else {
        if (gridLegsEff > 0 && short.legs.length < gridLegsEff + 1) {
          let step = gridStepFrac;
          if (gridStepMode === 'atr' && short.entryAtr > 0) step = gridStepFrac * (_calcAtr(candles, i, atrPeriod) / short.entryAtr);
          const nextLevel = short.pAvg * (1 + step);
          if (highI >= nextLevel && startLotUsd * Math.pow(martinMultiplier, short.legs.length) <= currentEquity(closeI)) {
            const sellPrice = _slip(nextLevel, false, slippageRate);
            const legQty = sellPrice > 0 ? (startLotUsd * Math.pow(martinMultiplier, short.legs.length)) / sellPrice : 0;
            addLeg(short, sellPrice, legQty, timeI, sellPrice * legQty * commissionRate);
          }
        }
        if (short.legs.length > 0) {
          let takePrice: number;
          if (breakEvenAfterLegs > 0 && short.legs.length >= breakEvenAfterLegs) {
            takePrice = short.pAvg - (short.totalQty > 0 ? (short.totalFees + short.pAvg * short.totalQty * commissionRate) / short.totalQty : 0);
          } else if (alphaEff != null && short.pDropAvg > 0) {
            takePrice = short.pAvg - (short.pDropAvg - short.pAvg) * alphaEff;
          } else {
            takePrice = short.pAvg * (1 - takeProfitPct);
          }
          const lastTake = short.takeProfitHistory.length > 0 ? short.takeProfitHistory[short.takeProfitHistory.length - 1].price : 0;
          if (Math.abs(takePrice - lastTake) > 1e-8) updateTakeProfitHistory(short, timeI, false, alphaEff);
          if (lowI <= takePrice) {
            closePosition('short', takePrice, timeI, 'TP');
            lastCloseBarShort = i;
          }
        }
      }
    }

    // Вход: лонг и шорт независимо (ATR-режим + локальный экстремум + запас по тренду)
    const trendOkLong = !trendFilterEnabled || closeI >= ema * marginMult;
    const trendOkShort = !trendFilterEnabled || closeI <= ema * (2 - marginMult);
    const cooldownOkLong = i >= lastCloseBarLong + cooldownBars;
    const cooldownOkShort = i >= lastCloseBarShort + cooldownBars;
    if (long.legs.length === 0 && signalLong && trendOkLong && cooldownOkLong && atrRegimeOk && localMinOk && !(obiFilterEnabled && volRatio < obiThreshold) && startLotUsd <= curEq) {
      const buyPrice = _slip(closeI, true, slippageRate);
      const wStart = Math.max(0, i - L);
      let wSum = 0;
      for (let w = wStart; w <= i; w++) wSum += closes[w];
      const pDropAvgLong = wStart <= i ? wSum / (i - wStart + 1) : closeI;
      const stopPriceLong = buyPrice * (1 - maxLossPct / 100);
      const takePriceLong = alphaEff != null && pDropAvgLong > 0
        ? buyPrice + (pDropAvgLong - buyPrice) * alphaEff
        : buyPrice * (1 + takeProfitPct);
      const takeDistLong = takePriceLong - buyPrice;
      const stopDistLong = buyPrice - stopPriceLong;
      if (stopDistLong > 1e-12 && takeDistLong > 0 && takeDistLong >= minRRatio * stopDistLong) {
        const qty = buyPrice > 0 ? startLotUsd / buyPrice : 0;
        addLeg(long, buyPrice, qty, timeI, buyPrice * qty * commissionRate);
        long.pDropAvg = pDropAvgLong;
        if (gridStepMode === 'atr') long.entryAtr = _calcAtr(candles, i, atrPeriod);
      }
    }
    if (short.legs.length === 0 && allowShort && signalShort && trendOkShort && cooldownOkShort && atrRegimeOk && localMaxOk && !(obiFilterEnabled && volRatio < obiThreshold) && startLotUsd <= currentEquity(closeI)) {
      const sellPrice = _slip(closeI, false, slippageRate);
      const wStart = Math.max(0, i - L);
      let wSum = 0;
      for (let w = wStart; w <= i; w++) wSum += closes[w];
      const pDropAvgShort = wStart <= i ? wSum / (i - wStart + 1) : closeI;
      const stopPriceShort = sellPrice * (1 + maxLossPct / 100);
      const takePriceShort = alphaEff != null && pDropAvgShort > 0
        ? sellPrice - (sellPrice - pDropAvgShort) * alphaEff
        : sellPrice * (1 - takeProfitPct);
      const takeDistShort = sellPrice - takePriceShort;
      const stopDistShort = stopPriceShort - sellPrice;
      if (stopDistShort > 1e-12 && takeDistShort > 0 && takeDistShort >= minRRatio * stopDistShort) {
        const qty = sellPrice > 0 ? startLotUsd / sellPrice : 0;
        addLeg(short, sellPrice, qty, timeI, sellPrice * qty * commissionRate);
        short.pDropAvg = pDropAvgShort;
        if (gridStepMode === 'atr') short.entryAtr = _calcAtr(candles, i, atrPeriod);
      }
    }

    // Slide retrospective window
    const oldRet = retroWindow.shift()!;
    retroSum -= oldRet;
    retroSumSq -= oldRet * oldRet;
    retroWindow.push(returns[i]);
    retroSum += returns[i];
    retroSumSq += returns[i] * returns[i];

    // Slide volume window
    volWindow.push(volumes[i]);
    volSum += volumes[i];
    if (volWindow.length > R) {
      const oldVol = volWindow.shift()!;
      volSum -= oldVol;
    }
  }

  const endTime = _getTime(candles[n - 1]);
  const endPrice = closes[n - 1];
  if (long.legs.length > 0 && long.totalQty > 0) {
    closePosition('long', endPrice, endTime, 'end');
  }
  if (short.legs.length > 0 && short.totalQty > 0) {
    closePosition('short', endPrice, endTime, 'end');
  }

  // Stats
  const totalPnlUsd = equity - initialEquity;
  const totalPnlPct = initialEquity > 0 ? (totalPnlUsd / initialEquity) * 100 : 0;
  const tradesCount = trades.length;
  const wins = trades.filter((t) => t.pnlUsd > 0);
  const losses = trades.filter((t) => t.pnlUsd < 0);
  const winratePct = tradesCount > 0 ? (wins.length / tradesCount) * 100 : 0;
  const avgPnlUsd = tradesCount > 0 ? totalPnlUsd / tradesCount : 0;
  const avgPnlPct = tradesCount > 0 ? totalPnlPct / tradesCount : 0;
  const grossProfit = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = losses.reduce((s, t) => s + Math.abs(t.pnlUsd), 0);
  const profitFactor = grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? Infinity : 0;

  // Среднее количество колен на сделку
  const totalLegs = trades.reduce((sum, t) => {
    const legsCount = t.legDetails ? t.legDetails.length : 1;
    return sum + legsCount;
  }, 0);
  const avgLegsCount = tradesCount > 0 ? totalLegs / tradesCount : 0;

  // Max Drawdown % рассчитывается от Initial Equity (а не от peakEquity)
  let peakEquity = initialEquity;
  let maxDrawdownPct = 0;
  const allEq = [{ time: _getTime(candles[0]), equity: initialEquity }, ...equityCurve];
  for (const p of allEq) {
    if (p.equity > peakEquity) peakEquity = p.equity;
    // Формула: Max Drawdown % = ((peakEquity - currentEquity) / initialEquity) * 100
    const ddPct = initialEquity > 0 ? ((peakEquity - p.equity) / initialEquity) * 100 : 0;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
  }

  return {
    trades,
    equityCurve,
    stats: { totalPnlUsd, totalPnlPct, maxDrawdownPct, tradesCount, winratePct, avgPnlUsd, avgPnlPct, profitFactor, avgLegsCount },
    finalEquity: equity,
    endState: {
      lastProcessedIndex: n - 1,
      equity,
      legsLong: [...long.legs], totalQtyLong: long.totalQty, totalCostLong: long.totalCost, pAvgLong: long.pAvg, pDropAvgLong: long.pDropAvg, totalFeesLong: long.totalFees, entryAtrLong: long.entryAtr,
      legsShort: [...short.legs], totalQtyShort: short.totalQty, totalCostShort: short.totalCost, pAvgShort: short.pAvg, pDropAvgShort: short.pDropAvg, totalFeesShort: short.totalFees, entryAtrShort: short.entryAtr,
      retroWindow: [...retroWindow], retroSum, retroSumSq,
      volWindow: [...volWindow], volSum,
      lastCloseBarLong, lastCloseBarShort,
    },
  };
}

// ====== Kanal-симуляция: Bollinger Bands Mean Reversion ======

/**
 * Стратегия «Kanal» — возврат к среднему через полосы Боллинджера.
 *
 * Вход LONG: цена (low свечи) касается нижней границы канала (SMA − multiplier × StdDev).
 * Вход SHORT: цена (high свечи) касается верхней границы (SMA + multiplier × StdDev).
 * Выход: возврат к средней линии (SMA).
 *
 * Одна позиция за раз, без сетки/мартингейла. Комиссия и проскальзывание учитываются.
 */
export function runKanalSimulation(
  candles: CandleData[],
  params: KanalParams
): ApexSimulationResult {
  const { period, multiplier, stopLossEnabled = false, stopLossPct = 2, startLotUsd, commissionPct, slippagePct, initialEquity: initEq, allowShort } = params;
  const initialEquity = initEq || 100;
  const commissionRate = commissionPct / 100;
  const slippageRate = slippagePct / 100;

  if (!candles || candles.length === 0 || period >= candles.length) {
    return {
      trades: [], equityCurve: [], stats: DEFAULT_STATS,
      finalEquity: initialEquity, endState: _emptyLiveState(initialEquity),
    };
  }

  const n = candles.length;
  const closes: number[] = new Array(n);
  for (let i = 0; i < n; i++) closes[i] = candles[i].close;

  const sma: (number | null)[] = new Array(n).fill(null);
  const stdDev: (number | null)[] = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += closes[i - j];
    const mean = sum / period;
    sma[i] = mean;
    let sqSum = 0;
    for (let j = 0; j < period; j++) {
      const diff = closes[i - j] - mean;
      sqSum += diff * diff;
    }
    stdDev[i] = Math.sqrt(sqSum / period);
  }

  let equity = initialEquity;
  let tradeId = 1;
  const trades: LabTrade[] = [];
  const equityCurve: LabEquityPoint[] = [];

  let currentPos: { side: 'long' | 'short'; entryPrice: number; qty: number; entryTime: number; entryFee: number } | null = null;

  for (let i = period; i < n; i++) {
    const mid = sma[i]!;
    const sd = stdDev[i]!;
    const upper = mid + sd * multiplier;
    const lower = mid - sd * multiplier;
    const timeI = _getTime(candles[i]);
    const lowI = candles[i].low;
    const highI = candles[i].high;

    if (!currentPos) {
      if (lowI <= lower && startLotUsd <= equity) {
        const buyPrice = _slip(lower, true, slippageRate);
        const qty = buyPrice > 0 ? startLotUsd / buyPrice : 0;
        const fee = buyPrice * qty * commissionRate;
        currentPos = { side: 'long', entryPrice: buyPrice, qty, entryTime: timeI, entryFee: fee };
      } else if (allowShort && highI >= upper && startLotUsd <= equity) {
        const sellPrice = _slip(upper, false, slippageRate);
        const qty = sellPrice > 0 ? startLotUsd / sellPrice : 0;
        const fee = sellPrice * qty * commissionRate;
        currentPos = { side: 'short', entryPrice: sellPrice, qty, entryTime: timeI, entryFee: fee };
      }
    } else {
      let shouldClose = false;
      let exitPriceRaw = mid;
      let exitReason: 'SL' | 'TP' = 'TP';

      if (stopLossEnabled && stopLossPct > 0) {
        const pctFrac = stopLossPct / 100;
        if (currentPos.side === 'long') {
          const stopPrice = currentPos.entryPrice * (1 - pctFrac);
          if (lowI <= stopPrice) {
            shouldClose = true;
            exitPriceRaw = stopPrice;
            exitReason = 'SL';
          }
        } else {
          const stopPrice = currentPos.entryPrice * (1 + pctFrac);
          if (highI >= stopPrice) {
            shouldClose = true;
            exitPriceRaw = stopPrice;
            exitReason = 'SL';
          }
        }
      }
      if (!shouldClose) {
        if (currentPos.side === 'long' && highI >= mid) {
          shouldClose = true;
          exitPriceRaw = mid;
        } else if (currentPos.side === 'short' && lowI <= mid) {
          shouldClose = true;
          exitPriceRaw = mid;
        }
      }

      if (shouldClose) {
        const isBuyExit = currentPos.side === 'short';
        const exitPrice = _slip(exitPriceRaw, isBuyExit, slippageRate);
        const exitFee = exitPrice * currentPos.qty * commissionRate;
        const grossPnl = currentPos.side === 'long'
          ? (exitPrice - currentPos.entryPrice) * currentPos.qty
          : (currentPos.entryPrice - exitPrice) * currentPos.qty;
        const pnlUsd = grossPnl - currentPos.entryFee - exitFee;
        const pnlPct = equity > 0 ? (pnlUsd / equity) * 100 : 0;
        equity += pnlUsd;

        trades.push({
          id: tradeId++,
          entryTime: currentPos.entryTime,
          exitTime: timeI,
          entryPrice: currentPos.entryPrice,
          exitPrice,
          volume: currentPos.qty,
          pnlUsd,
          pnlPct,
          exitReason,
          side: currentPos.side,
        });
        equityCurve.push({ time: timeI, equity });
        currentPos = null;
      }
    }
  }

  if (currentPos) {
    const endPrice = closes[n - 1];
    const endTime = _getTime(candles[n - 1]);
    const isBuyExit = currentPos.side === 'short';
    const exitPrice = _slip(endPrice, isBuyExit, slippageRate);
    const exitFee = exitPrice * currentPos.qty * commissionRate;
    const grossPnl = currentPos.side === 'long'
      ? (exitPrice - currentPos.entryPrice) * currentPos.qty
      : (currentPos.entryPrice - exitPrice) * currentPos.qty;
    const pnlUsd = grossPnl - currentPos.entryFee - exitFee;
    const pnlPct = equity > 0 ? (pnlUsd / equity) * 100 : 0;
    equity += pnlUsd;
    trades.push({
      id: tradeId++,
      entryTime: currentPos.entryTime,
      exitTime: endTime,
      entryPrice: currentPos.entryPrice,
      exitPrice,
      volume: currentPos.qty,
      pnlUsd,
      pnlPct,
      exitReason: 'end',
      side: currentPos.side,
    });
    equityCurve.push({ time: endTime, equity });
  }

  const stats = computeStatsFromTrades(trades, initialEquity);

  return {
    trades,
    equityCurve,
    stats,
    finalEquity: equity,
    endState: _emptyLiveState(equity),
  };
}

/**
 * Инкрементальная обработка ТОЛЬКО новых свечей (для лайва).
 * Продолжает с сохранённого LiveState, включая rolling Z-Score окна.
 */
export function runApexIncremental(
  candles: CandleData[],
  startIndex: number,
  initialState: LiveState,
  params: ApexParams,
  nextTradeId: number
): { newTrades: LabTrade[]; newState: LiveState; newEquityCurvePoints: LabEquityPoint[] } {
  const initialEquity = params.initialEquity || 100;
  const newTrades: LabTrade[] = [];
  const newEquityCurvePoints: LabEquityPoint[] = [];
  if (startIndex >= candles.length) {
    return { newTrades, newState: initialState, newEquityCurvePoints };
  }

  const {
    startLotUsd, scannerSigma, dropLengthMinutes,
    retrospective: R, obiFilterEnabled, obiThreshold,
    gridLegs, gridStepPct, gridStepMode, atrPeriod, martinMultiplier,
    takeAlpha, takeProfitPct, breakEvenAfterLegs,
    maxLossPct, commissionPct, slippagePct, timeframeMinutes,
    allowShort = true,
    trendFilterEnabled = true,
    emaPeriod = 50,
    cooldownBars = 5,
    dynamicAlphaEnabled = true,
    exposureCapBoth = true,
    atrRegimeFilterEnabled = true,
    atrRegimeMin = 0.5,
    atrRegimeMax = 2,
    localExtremumBars = 2,
    trendFilterMarginPct = 0.05,
    minRRatio = 1.15,
  } = params;

  const L = Math.max(1, Math.round(dropLengthMinutes / timeframeMinutes));
  const commissionRate = commissionPct / 100;
  const slippageRate = slippagePct / 100;
  const gridStepFrac = gridStepPct / 100;
  const startBar = L + R;

  let equity = initialState.equity;
  let tradeId = nextTradeId;
  let lastCloseBarLong = initialState.lastCloseBarLong ?? -999;
  let lastCloseBarShort = initialState.lastCloseBarShort ?? -999;
  const retroWindow = [...initialState.retroWindow];
  let retroSum = initialState.retroSum;
  let retroSumSq = initialState.retroSumSq;
  const volWindow = [...initialState.volWindow];
  let volSum = initialState.volSum;

  const long: PosState = {
    legs: initialState.legsLong ? [...initialState.legsLong] : (initialState.posSide === 'long' && initialState.legs ? [...initialState.legs] : []),
    totalQty: initialState.totalQtyLong ?? (initialState.posSide === 'long' ? initialState.totalQty ?? 0 : 0),
    totalCost: initialState.totalCostLong ?? (initialState.posSide === 'long' ? initialState.totalCost ?? 0 : 0),
    pAvg: initialState.pAvgLong ?? (initialState.posSide === 'long' ? initialState.pAvg ?? 0 : 0),
    pDropAvg: initialState.pDropAvgLong ?? (initialState.posSide === 'long' ? initialState.pDropAvg ?? 0 : 0),
    totalFees: initialState.totalFeesLong ?? (initialState.posSide === 'long' ? initialState.totalFees ?? 0 : 0),
    entryAtr: initialState.entryAtrLong ?? (initialState.posSide === 'long' ? initialState.entryAtr ?? 0 : 0),
    takeProfitHistory: [],
  };
  const short: PosState = {
    legs: initialState.legsShort ? [...initialState.legsShort] : (initialState.posSide === 'short' && initialState.legs ? [...initialState.legs] : []),
    totalQty: initialState.totalQtyShort ?? (initialState.posSide === 'short' ? initialState.totalQty ?? 0 : 0),
    totalCost: initialState.totalCostShort ?? (initialState.posSide === 'short' ? initialState.totalCost ?? 0 : 0),
    pAvg: initialState.pAvgShort ?? (initialState.posSide === 'short' ? initialState.pAvg ?? 0 : 0),
    pDropAvg: initialState.pDropAvgShort ?? (initialState.posSide === 'short' ? initialState.pDropAvg ?? 0 : 0),
    totalFees: initialState.totalFeesShort ?? (initialState.posSide === 'short' ? initialState.totalFees ?? 0 : 0),
    entryAtr: initialState.entryAtrShort ?? (initialState.posSide === 'short' ? initialState.entryAtr ?? 0 : 0),
    takeProfitHistory: [],
  };

  const n = candles.length;
  const closes: number[] = new Array(n);
  const volumes: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    closes[i] = candles[i].close;
    volumes[i] = (candles[i] as any).volume ?? 0;
  }

  const addLeg = (pos: PosState, price: number, qty: number, time: number, fee: number) => {
    pos.legs.push({ price, qty, time });
    pos.totalCost += price * qty;
    pos.totalQty += qty;
    pos.pAvg = pos.totalQty > 0 ? pos.totalCost / pos.totalQty : 0;
    pos.totalFees += fee;
    updateTakeProfitHistoryInc(pos, time, pos === long);
  };

  const resetPos = (pos: PosState) => {
    pos.legs = [];
    pos.totalQty = 0;
    pos.totalCost = 0;
    pos.pAvg = 0;
    pos.pDropAvg = 0;
    pos.totalFees = 0;
    pos.entryAtr = 0;
    pos.takeProfitHistory = [];
  };

  const updateTakeProfitHistoryInc = (pos: PosState, time: number, isLong: boolean, alphaOverride?: number | null) => {
    if (pos.legs.length === 0) return;
    const alpha = alphaOverride !== undefined ? alphaOverride : takeAlpha;
    let takePrice: number;
    if (isLong) {
      if (breakEvenAfterLegs > 0 && pos.legs.length >= breakEvenAfterLegs) {
        takePrice = pos.pAvg + (pos.totalQty > 0 ? (pos.totalFees + pos.pAvg * pos.totalQty * commissionRate) / pos.totalQty : 0);
      } else if (alpha != null && pos.pDropAvg > 0) takePrice = pos.pAvg + (pos.pDropAvg - pos.pAvg) * alpha;
      else takePrice = pos.pAvg * (1 + takeProfitPct);
    } else {
      if (breakEvenAfterLegs > 0 && pos.legs.length >= breakEvenAfterLegs) {
        takePrice = pos.pAvg - (pos.totalQty > 0 ? (pos.totalFees + pos.pAvg * pos.totalQty * commissionRate) / pos.totalQty : 0);
      } else if (alpha != null && pos.pDropAvg > 0) takePrice = pos.pAvg - (pos.pDropAvg - pos.pAvg) * alpha;
      else takePrice = pos.pAvg * (1 - takeProfitPct);
    }
    pos.takeProfitHistory.push({ time, price: takePrice });
  };

  const currentEquityInc = (closeI: number) =>
    equity +
    (long.totalQty > 0 ? (closeI - long.pAvg) * long.totalQty - long.totalFees : 0) +
    (short.totalQty > 0 ? (short.pAvg - closeI) * short.totalQty - short.totalFees : 0);

  const closePosition = (side: 'long' | 'short', exitPriceRaw: number, time: number, exitReason: 'SL' | 'TP' | 'end' = 'TP') => {
    const pos = side === 'long' ? long : short;
    const exitPrice = _slip(exitPriceRaw, side === 'long' ? false : true, slippageRate);
    const exitFee = exitPrice * pos.totalQty * commissionRate;
    const grossPnl = side === 'long' ? (exitPrice - pos.pAvg) * pos.totalQty : (pos.pAvg - exitPrice) * pos.totalQty;
    const pnlUsd = grossPnl - pos.totalFees - exitFee;
    const pnlPct = equity > 0 ? (pnlUsd / equity) * 100 : 0;
    equity += pnlUsd;
    newTrades.push({
      id: tradeId++,
      entryTime: pos.legs.length > 0 ? pos.legs[0].time : time,
      exitTime: time,
      entryPrice: pos.pAvg,
      exitPrice,
      volume: pos.totalQty,
      pnlUsd,
      pnlPct,
      legDetails: pos.legs.length > 0 ? [...pos.legs] : undefined,
      takeProfitHistory: pos.takeProfitHistory.length > 0 ? [...pos.takeProfitHistory] : undefined,
      exitReason,
      side,
    });
    newEquityCurvePoints.push({ time, equity });
    resetPos(pos);
  };

  for (let i = startIndex; i < n; i++) {
    const timeI = _getTime(candles[i]);
    const closeI = closes[i];
    const lowI = candles[i].low;
    const highI = candles[i].high;

    const atrNow = _calcAtr(candles, i, atrPeriod);
    const atrMedian = _calcAtrMedian(candles, i, atrPeriod, 50);
    const alphaEff =
      (dynamicAlphaEnabled && takeAlpha != null && atrMedian > 1e-12)
        ? takeAlpha * (atrNow / atrMedian)
        : takeAlpha;
    const gridLegsEff =
      exposureCapBoth && long.legs.length > 0 && short.legs.length > 0 ? 0 : gridLegs;
    const ema = _calcEma(closes, i, emaPeriod);
    const retI = (i >= L && closes[i - L] > 0) ? (closeI - closes[i - L]) / closes[i - L] : 0;
    const atrRatio = atrMedian > 1e-12 ? atrNow / atrMedian : 1;
    const atrRegimeOk = !atrRegimeFilterEnabled || (atrRatio >= atrRegimeMin && atrRatio <= atrRegimeMax);
    const retPrev = (i >= L + 1 && closes[i - 1 - L] > 0) ? (closes[i - 1] - closes[i - 1 - L]) / closes[i - 1 - L] : retI;
    const retPrev2 = (i >= L + 2 && closes[i - 2 - L] > 0) ? (closes[i - 2] - closes[i - 2 - L]) / closes[i - 2 - L] : retI;
    const lookbackInc = Math.min(localExtremumBars, i - startBar);
    const localMinOk = lookbackInc <= 0 || retI <= Math.min(retI, retPrev, retPrev2);
    const localMaxOk = lookbackInc <= 0 || retI >= Math.max(retI, retPrev, retPrev2);
    const marginMult = 1 + trendFilterMarginPct / 100;
    const mu = retroWindow.length > 0 ? retroSum / retroWindow.length : 0;
    const vari = retroWindow.length > 0 ? (retroSumSq / retroWindow.length) - (mu * mu) : 0;
    const sig = Math.sqrt(Math.max(0, vari));
    const zScore = sig > 1e-12 ? (retI - mu) / sig : 0;
    const signalLong = zScore <= -scannerSigma;
    const signalShort = zScore >= scannerSigma;
    const avgVol = volWindow.length > 0 ? volSum / volWindow.length : 1;
    const volRatio = avgVol > 0 ? volumes[i] / avgVol : 0;
    const curEq = currentEquityInc(closeI);

    if (long.legs.length > 0) {
      const stopPrice = long.pAvg * (1 - maxLossPct / 100);
      if (lowI <= stopPrice) {
        closePosition('long', stopPrice, timeI, 'SL');
        lastCloseBarLong = i;
      } else {
        if (gridLegsEff > 0 && long.legs.length < gridLegsEff + 1) {
          let step = gridStepFrac;
          if (gridStepMode === 'atr' && long.entryAtr > 0) step = gridStepFrac * (_calcAtr(candles, i, atrPeriod) / long.entryAtr);
          const nextLevel = long.pAvg * (1 - step);
          if (lowI <= nextLevel && startLotUsd * Math.pow(martinMultiplier, long.legs.length) <= curEq) {
            const buyPrice = _slip(nextLevel, true, slippageRate);
            const legQty = buyPrice > 0 ? (startLotUsd * Math.pow(martinMultiplier, long.legs.length)) / buyPrice : 0;
            addLeg(long, buyPrice, legQty, timeI, buyPrice * legQty * commissionRate);
          }
        }
        if (long.legs.length > 0) {
          let takePrice: number;
          if (breakEvenAfterLegs > 0 && long.legs.length >= breakEvenAfterLegs) {
            takePrice = long.pAvg + (long.totalQty > 0 ? (long.totalFees + long.pAvg * long.totalQty * commissionRate) / long.totalQty : 0);
          } else if (alphaEff != null && long.pDropAvg > 0) takePrice = long.pAvg + (long.pDropAvg - long.pAvg) * alphaEff;
          else takePrice = long.pAvg * (1 + takeProfitPct);
          const lastTake = long.takeProfitHistory.length > 0 ? long.takeProfitHistory[long.takeProfitHistory.length - 1].price : 0;
          if (Math.abs(takePrice - lastTake) > 1e-8) updateTakeProfitHistoryInc(long, timeI, true, alphaEff);
          if (highI >= takePrice) {
            closePosition('long', takePrice, timeI);
            lastCloseBarLong = i;
          }
        }
      }
    }

    if (short.legs.length > 0) {
      const stopPrice = short.pAvg * (1 + maxLossPct / 100);
      if (highI >= stopPrice) {
        closePosition('short', stopPrice, timeI, 'SL');
        lastCloseBarShort = i;
      } else {
        if (gridLegsEff > 0 && short.legs.length < gridLegsEff + 1) {
          let step = gridStepFrac;
          if (gridStepMode === 'atr' && short.entryAtr > 0) step = gridStepFrac * (_calcAtr(candles, i, atrPeriod) / short.entryAtr);
          const nextLevel = short.pAvg * (1 + step);
          if (highI >= nextLevel && startLotUsd * Math.pow(martinMultiplier, short.legs.length) <= currentEquityInc(closeI)) {
            const sellPrice = _slip(nextLevel, false, slippageRate);
            const legQty = sellPrice > 0 ? (startLotUsd * Math.pow(martinMultiplier, short.legs.length)) / sellPrice : 0;
            addLeg(short, sellPrice, legQty, timeI, sellPrice * legQty * commissionRate);
          }
        }
        if (short.legs.length > 0) {
          let takePrice: number;
          if (breakEvenAfterLegs > 0 && short.legs.length >= breakEvenAfterLegs) {
            takePrice = short.pAvg - (short.totalQty > 0 ? (short.totalFees + short.pAvg * short.totalQty * commissionRate) / short.totalQty : 0);
          } else if (alphaEff != null && short.pDropAvg > 0) takePrice = short.pAvg - (short.pDropAvg - short.pAvg) * alphaEff;
          else takePrice = short.pAvg * (1 - takeProfitPct);
          const lastTake = short.takeProfitHistory.length > 0 ? short.takeProfitHistory[short.takeProfitHistory.length - 1].price : 0;
          if (Math.abs(takePrice - lastTake) > 1e-8) updateTakeProfitHistoryInc(short, timeI, false, alphaEff);
          if (lowI <= takePrice) {
            closePosition('short', takePrice, timeI);
            lastCloseBarShort = i;
          }
        }
      }
    }

    const trendOkLong = !trendFilterEnabled || closeI >= ema * marginMult;
    const trendOkShort = !trendFilterEnabled || closeI <= ema * (2 - marginMult);
    const cooldownOkLong = i >= lastCloseBarLong + cooldownBars;
    const cooldownOkShort = i >= lastCloseBarShort + cooldownBars;
    if (long.legs.length === 0 && signalLong && trendOkLong && cooldownOkLong && atrRegimeOk && localMinOk && !(obiFilterEnabled && volRatio < obiThreshold) && startLotUsd <= curEq) {
      const buyPrice = _slip(closeI, true, slippageRate);
      const wStart = Math.max(0, i - L);
      let wSum = 0;
      for (let w = wStart; w <= i; w++) wSum += closes[w];
      const pDropAvgLong = wStart <= i ? wSum / (i - wStart + 1) : closeI;
      const stopPriceLong = buyPrice * (1 - maxLossPct / 100);
      const takePriceLong = alphaEff != null && pDropAvgLong > 0 ? buyPrice + (pDropAvgLong - buyPrice) * alphaEff : buyPrice * (1 + takeProfitPct);
      const takeDistLong = takePriceLong - buyPrice;
      const stopDistLong = buyPrice - stopPriceLong;
      if (stopDistLong > 1e-12 && takeDistLong > 0 && takeDistLong >= minRRatio * stopDistLong) {
        const qty = buyPrice > 0 ? startLotUsd / buyPrice : 0;
        addLeg(long, buyPrice, qty, timeI, buyPrice * qty * commissionRate);
        long.pDropAvg = pDropAvgLong;
        if (gridStepMode === 'atr') long.entryAtr = _calcAtr(candles, i, atrPeriod);
      }
    }
    if (short.legs.length === 0 && allowShort && signalShort && trendOkShort && cooldownOkShort && atrRegimeOk && localMaxOk && !(obiFilterEnabled && volRatio < obiThreshold) && startLotUsd <= currentEquityInc(closeI)) {
      const sellPrice = _slip(closeI, false, slippageRate);
      const wStart = Math.max(0, i - L);
      let wSum = 0;
      for (let w = wStart; w <= i; w++) wSum += closes[w];
      const pDropAvgShort = wStart <= i ? wSum / (i - wStart + 1) : closeI;
      const stopPriceShort = sellPrice * (1 + maxLossPct / 100);
      const takePriceShort = alphaEff != null && pDropAvgShort > 0 ? sellPrice - (sellPrice - pDropAvgShort) * alphaEff : sellPrice * (1 - takeProfitPct);
      const takeDistShort = sellPrice - takePriceShort;
      const stopDistShort = stopPriceShort - sellPrice;
      if (stopDistShort > 1e-12 && takeDistShort > 0 && takeDistShort >= minRRatio * stopDistShort) {
        const qty = sellPrice > 0 ? startLotUsd / sellPrice : 0;
        addLeg(short, sellPrice, qty, timeI, sellPrice * qty * commissionRate);
        short.pDropAvg = pDropAvgShort;
        if (gridStepMode === 'atr') short.entryAtr = _calcAtr(candles, i, atrPeriod);
      }
    }

    // Slide windows
    if (retroWindow.length >= R) {
      const old = retroWindow.shift()!;
      retroSum -= old;
      retroSumSq -= old * old;
    }
    retroWindow.push(retI);
    retroSum += retI;
    retroSumSq += retI * retI;

    volWindow.push(volumes[i]);
    volSum += volumes[i];
    if (volWindow.length > R) {
      const oldV = volWindow.shift()!;
      volSum -= oldV;
    }
  }

  const endTime = _getTime(candles[n - 1]);
  const endPrice = closes[n - 1];
  if (long.legs.length > 0 && long.totalQty > 0) {
    closePosition('long', endPrice, endTime, 'end');
  }
  if (short.legs.length > 0 && short.totalQty > 0) {
    closePosition('short', endPrice, endTime, 'end');
  }

  return {
    newTrades,
    newState: {
      lastProcessedIndex: n - 1,
      equity,
      legsLong: [...long.legs], totalQtyLong: long.totalQty, totalCostLong: long.totalCost, pAvgLong: long.pAvg, pDropAvgLong: long.pDropAvg, totalFeesLong: long.totalFees, entryAtrLong: long.entryAtr,
      legsShort: [...short.legs], totalQtyShort: short.totalQty, totalCostShort: short.totalCost, pAvgShort: short.pAvg, pDropAvgShort: short.pDropAvg, totalFeesShort: short.totalFees, entryAtrShort: short.entryAtr,
      retroWindow: [...retroWindow], retroSum, retroSumSq,
      volWindow: [...volWindow], volSum,
      lastCloseBarLong, lastCloseBarShort,
    },
    newEquityCurvePoints,
  };
}

