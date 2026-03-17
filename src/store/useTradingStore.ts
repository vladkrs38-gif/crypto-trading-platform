import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BinancePair, CandleData, TickData, Timeframe } from '@/types/binance';

export type ChartMode = 'standard' | 'tick200' | 'both';

// Тип для горизонтальных уровней (лучи от точки вправо)
export interface PriceLevel {
  id: string;
  price: number;
  color: string;
  label?: string;
  createdAt: number;
  startTime: number; // Время начала уровня (от какой свечи рисовать)
}

// Хранилище уровней по символам (сохраняется в localStorage)
export interface PriceLevelsStore {
  levels: Record<string, PriceLevel[]>; // symbol -> levels
  addLevel: (symbol: string, price: number, startTime: number, color?: string, label?: string) => void;
  removeLevel: (symbol: string, levelId: string) => void;
  getLevels: (symbol: string) => PriceLevel[];
  clearLevels: (symbol: string) => void;
}

export const usePriceLevelsStore = create<PriceLevelsStore>()(
  persist(
    (set, get) => ({
      levels: {},
      
      addLevel: (symbol, price, startTime, color = '#f0b90b', label) => {
        const newLevel: PriceLevel = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          price,
          color,
          label,
          createdAt: Date.now(),
          startTime, // Время начала уровня
        };
        
        set((state) => ({
          levels: {
            ...state.levels,
            [symbol]: [...(state.levels[symbol] || []), newLevel],
          },
        }));
      },
      
      removeLevel: (symbol, levelId) => {
        set((state) => ({
          levels: {
            ...state.levels,
            [symbol]: (state.levels[symbol] || []).filter((l) => l.id !== levelId),
          },
        }));
      },
      
      getLevels: (symbol) => {
        return get().levels[symbol] || [];
      },
      
      clearLevels: (symbol) => {
        set((state) => ({
          levels: {
            ...state.levels,
            [symbol]: [],
          },
        }));
      },
    }),
    {
      name: 'price-levels-storage',
    }
  )
);

// Тип для активного алерта (когда цена приблизилась к уровню)
export interface ActiveAlert {
  symbol: string;
  levelId: string;
  levelPrice: number;
  currentPrice: number;
  triggeredAt: number;
  exchange: 'Binance' | 'Bybit';
}

// Store для активных алертов
interface ActiveAlertsStore {
  alerts: ActiveAlert[];
  addAlert: (alert: ActiveAlert) => void;
  removeAlert: (symbol: string, levelId: string) => void;
  clearAlerts: () => void;
  clearExpiredAlerts: (maxAge?: number) => void;
  getAlertsForSymbol: (symbol: string) => ActiveAlert[];
  hasActiveAlert: (symbol: string) => boolean;
}

export const useActiveAlertsStore = create<ActiveAlertsStore>((set, get) => ({
  alerts: [],
  
  addAlert: (alert) => {
    set((state) => {
      // Не добавляем дубликаты (по symbol + levelId)
      const exists = state.alerts.some(
        a => a.symbol === alert.symbol && a.levelId === alert.levelId
      );
      if (exists) {
        // Обновляем существующий алерт
        return {
          alerts: state.alerts.map(a => 
            a.symbol === alert.symbol && a.levelId === alert.levelId
              ? { ...a, currentPrice: alert.currentPrice, triggeredAt: alert.triggeredAt }
              : a
          ),
        };
      }
      return { alerts: [...state.alerts, alert] };
    });
  },
  
  removeAlert: (symbol, levelId) => {
    set((state) => ({
      alerts: state.alerts.filter(a => !(a.symbol === symbol && a.levelId === levelId)),
    }));
  },
  
  clearAlerts: () => set({ alerts: [] }),
  
  clearExpiredAlerts: (maxAge = 15000) => {
    const now = Date.now();
    set((state) => ({
      alerts: state.alerts.filter(a => now - a.triggeredAt < maxAge),
    }));
  },
  
  getAlertsForSymbol: (symbol) => {
    return get().alerts.filter(a => a.symbol === symbol);
  },
  
  hasActiveAlert: (symbol) => {
    return get().alerts.some(a => a.symbol === symbol);
  },
}));

interface TradingState {
  // Пары
  top10Pairs: BinancePair[];
  selectedPair: BinancePair | null;
  
  // Режим работы (основной график или лаборатория)
  isLabMode: boolean;
  
  // График
  timeframe: Timeframe;
  chartPeriod: number; // Период для стандартного графика в днях (1, 2, 3, 5, 7, 10, 15)
  chartData: CandleData[];
  /** Триггер для подгонки видимой области после загрузки истории (ML) */
  chartDataFitTrigger: number;
  tickData: TickData[]; // Для 20-тикового графика
  tick200ChartData: CandleData[]; // Данные для 20-тикового графика
  
  // Режим отображения графиков
  chartMode: ChartMode;
  
  // Состояние подключения
  binanceConnected: boolean;
  
  // Загрузка
  isLoadingPairs: boolean;
  isLoadingChart: boolean;
  isLoadingTick200: boolean;
  
  // Индикаторы дельты для стандартного графика
  showBarDeltaStandard: boolean;
  showCumulativeDeltaStandard: boolean;
  showDeltaRotationStandard: boolean;
  deltaRotationThreshold: number; // Порог для фильтрации шума (0 = простая версия, > 0 = с фильтром)
  
  // Индикаторы дельты для 100-тикового графика
  showBarDeltaTick100: boolean;
  showCumulativeDeltaTick100: boolean;
  showBidAskHistogram: boolean; // Гистограмма бид-аск для 20-тикового графика
  
  // Индикатор Imbalance Trend для 20-тикового графика
  showImbalanceTrend: boolean;
  imbalanceLevels: number; // Количество уровней стакана для отслеживания
  imbalanceEmaPeriod: number; // Период EMA для сглаживания
  imbalanceMultiplier: number; // Множитель для усиления сигнала
  showImbalanceEma: boolean; // Показывать ли EMA линию
  imbalanceHeatMap: boolean; // Цветовая индикация "нагрева" при большом перевесе (70-100%)
  showImbalanceMarkers: boolean; // Показывать маркеры силы на свечном графике
  imbalanceMinStrength: number; // Минимальный уровень силы маркеров (70, 80, 90, 100)
  
  // Индикатор тренда кумулятивной дельты (стандартный график)
  showCumulativeDeltaTrend: boolean;
  cumulativeDeltaTrendPeriod: number; // Период для расчёта тренда (количество свечей для определения экстремумов)
  cumulativeDeltaTrendOffset: number; // Отступ линии тренда от КД (в процентах от диапазона)
  cumulativeDeltaDisplayMode: 'line' | 'candle'; // Режим отображения КД
  
  // Индикатор тренда кумулятивной дельты (200-тиковый график)
  showCumulativeDeltaTrendTick200: boolean;
  cumulativeDeltaTrendPeriodTick200: number;
  cumulativeDeltaTrendOffsetTick200: number;
  cumulativeDeltaDisplayModeTick200: 'line' | 'candle';
  
  // Индикатор дисбаланса ликвидности для 20-тикового графика
  showLiquidityImbalance: boolean;
  liquidityImbalanceDepthPercent: number; // Процент глубины от mid price (0.5-3%, по умолчанию 1%)
  
  // Крупные лимитные ордера на 20-тиковом графике
  showBigOrders: boolean;
  bigOrderMultiplier: number; // Множитель от среднего объёма (2-20x, по умолчанию 5x)
  
  // Боковая панель аналитики
  showAnalyticsSidebar: boolean;
  // Боковая панель Pre-Pump
  showPrePumpSidebar: boolean;
  
  // Действия
  setTop10Pairs: (pairs: BinancePair[]) => void;
  setSelectedPair: (pair: BinancePair | null) => void;
  setIsLabMode: (isLabMode: boolean) => void;
  setTimeframe: (timeframe: Timeframe) => void;
  setChartPeriod: (period: number) => void;
  setChartData: (data: CandleData[]) => void;
  /** Установить данные и подогнать видимую область (для ML-сделок на истории) */
  setChartDataAndFit: (data: CandleData[]) => void;
  addCandle: (candle: CandleData) => void;
  updateLastCandle: (candle: Partial<CandleData>) => void;
  setTickData: (ticks: TickData[]) => void;
  addTick: (tick: TickData) => void;
  setTick200ChartData: (data: CandleData[]) => void;
  setChartMode: (mode: ChartMode) => void;
  setBinanceConnected: (connected: boolean) => void;
  setIsLoadingPairs: (loading: boolean) => void;
  setIsLoadingChart: (loading: boolean) => void;
  setIsLoadingTick200: (loading: boolean) => void;
  
  // Действия для индикаторов дельты стандартного графика
  setShowBarDeltaStandard: (show: boolean) => void;
  setShowCumulativeDeltaStandard: (show: boolean) => void;
  setShowDeltaRotationStandard: (show: boolean) => void;
  setDeltaRotationThreshold: (threshold: number) => void;
  
  // Действия для индикаторов дельты 100-тикового графика
  setShowBarDeltaTick100: (show: boolean) => void;
  setShowCumulativeDeltaTick100: (show: boolean) => void;
  setShowBidAskHistogram: (show: boolean) => void;
  
  // Действия для индикатора Imbalance Trend
  setShowImbalanceTrend: (show: boolean) => void;
  setImbalanceLevels: (levels: number) => void;
  setImbalanceEmaPeriod: (period: number) => void;
  setImbalanceMultiplier: (multiplier: number) => void;
  setShowImbalanceEma: (show: boolean) => void;
  setImbalanceHeatMap: (enabled: boolean) => void;
  setShowImbalanceMarkers: (enabled: boolean) => void;
  setImbalanceMinStrength: (minStrength: number) => void;
  
  // Действия для индикатора тренда кумулятивной дельты (стандартный график)
  setShowCumulativeDeltaTrend: (show: boolean) => void;
  setCumulativeDeltaTrendPeriod: (period: number) => void;
  setCumulativeDeltaTrendOffset: (offset: number) => void;
  setCumulativeDeltaDisplayMode: (mode: 'line' | 'candle') => void;
  
  // Действия для индикатора тренда кумулятивной дельты (200-тиковый график)
  setShowCumulativeDeltaTrendTick200: (show: boolean) => void;
  setCumulativeDeltaTrendPeriodTick200: (period: number) => void;
  setCumulativeDeltaTrendOffsetTick200: (offset: number) => void;
  setCumulativeDeltaDisplayModeTick200: (mode: 'line' | 'candle') => void;
  
  // Действия для индикатора дисбаланса ликвидности
  setShowLiquidityImbalance: (show: boolean) => void;
  setLiquidityImbalanceDepthPercent: (percent: number) => void;
  setLiquidityImbalanceShowLine: (show: boolean) => void;
  
  // Действия для крупных лимитных ордеров
  setShowBigOrders: (show: boolean) => void;
  setBigOrderMultiplier: (multiplier: number) => void;
  
  // Действия для боковой панели аналитики
  setShowAnalyticsSidebar: (show: boolean) => void;
  toggleAnalyticsSidebar: () => void;
  // Действия для боковой панели Pre-Pump
  setShowPrePumpSidebar: (show: boolean) => void;
  togglePrePumpSidebar: () => void;
}

export const useTradingStore = create<TradingState>((set) => ({
  // Начальное состояние
  top10Pairs: [],
  selectedPair: null,
  isLabMode: false,
  timeframe: '5',
  chartPeriod: 3, // По умолчанию 3 дня
  chartData: [],
  chartDataFitTrigger: 0,
  tickData: [],
  tick200ChartData: [],
  chartMode: 'standard',
  binanceConnected: false,
  isLoadingPairs: false,
  isLoadingChart: false,
  isLoadingTick200: false,
  
  // Индикаторы дельты
  showBarDeltaStandard: false,
  showCumulativeDeltaStandard: false,
  showDeltaRotationStandard: false,
  deltaRotationThreshold: 0, // 0 = простая версия (сброс при смене знака), > 0 = с фильтром шума
  showBarDeltaTick100: false,
  showCumulativeDeltaTick100: false,
  showBidAskHistogram: false,
  
  // Индикатор Imbalance Trend
  showImbalanceTrend: false,
  imbalanceLevels: 10, // По умолчанию 10 уровней
  imbalanceEmaPeriod: 5, // По умолчанию EMA с периодом 5
  imbalanceMultiplier: 10, // Множитель сигнала
  showImbalanceEma: true, // По умолчанию показываем EMA
  imbalanceHeatMap: false, // По умолчанию выключено
  showImbalanceMarkers: false, // По умолчанию выключено
  imbalanceMinStrength: 70, // По умолчанию минимальный уровень силы 70%
  
  // Индикатор тренда кумулятивной дельты (стандартный график)
  showCumulativeDeltaTrend: false,
  cumulativeDeltaTrendPeriod: 14, // По умолчанию 14 свечей для определения тренда
  cumulativeDeltaTrendOffset: 15, // По умолчанию 15% отступ
  cumulativeDeltaDisplayMode: 'candle', // По умолчанию свечной режим
  
  // Индикатор тренда кумулятивной дельты (200-тиковый график)
  showCumulativeDeltaTrendTick200: false,
  cumulativeDeltaTrendPeriodTick200: 14,
  cumulativeDeltaTrendOffsetTick200: 15,
  cumulativeDeltaDisplayModeTick200: 'candle',
  
  // Индикатор дисбаланса ликвидности
  showLiquidityImbalance: false,
  liquidityImbalanceDepthPercent: 1, // По умолчанию 1%
  liquidityImbalanceShowLine: false, // По умолчанию гистограмма
  
  // Крупные лимитные ордера
  showBigOrders: false,
  bigOrderMultiplier: 5, // По умолчанию 5x от среднего
  
  // Боковая панель аналитики
  showAnalyticsSidebar: false,
  // Боковая панель Pre-Pump
  showPrePumpSidebar: false,
  
  // Действия
  setTop10Pairs: (pairs) => set({ top10Pairs: pairs }),
  
  setSelectedPair: (pair) => set({ 
    selectedPair: pair,
    // Очищаем данные графиков при смене пары
    chartData: [],
    tickData: [],
    tick200ChartData: [],
  }),
  
  // Переключение режима лаборатории
  setIsLabMode: (isLabMode: boolean) => set({ isLabMode }),
  
  setTimeframe: (timeframe) => set({ 
    timeframe,
    // Очищаем данные графика при смене таймфрейма
    chartData: [],
  }),
  
  setChartPeriod: (period) => set({ chartPeriod: period }),
  
  setChartData: (data) => set({ chartData: data }),
  
  setChartDataAndFit: (data) => set((s) => ({ chartData: data, chartDataFitTrigger: s.chartDataFitTrigger + 1 })),
  
  addCandle: (candle) => set((state) => ({
    chartData: [...state.chartData, candle],
  })),
  
  updateLastCandle: (updates) => set((state) => {
    if (state.chartData.length === 0) return state;
    
    const lastCandle = state.chartData[state.chartData.length - 1];
    const updatedCandle = { ...lastCandle, ...updates };
    const newChartData = [...state.chartData];
    newChartData[newChartData.length - 1] = updatedCandle;
    
    return { chartData: newChartData };
  }),
  
  setTickData: (ticks) => set({ tickData: ticks }),
  
  addTick: (tick) => set((state) => {
    // Для 20-тикового графика сохраняем только последние 20 тиков
      const newTicks = [...state.tickData, tick];
      return { tickData: newTicks.slice(-20) };
  }),
  
  setTick200ChartData: (data) => set({ tick200ChartData: data }),
  
  setChartMode: (mode) => set({ 
    chartMode: mode,
    // НЕ очищаем данные - они должны сохраняться при переключении режимов
    // Компоненты просто показываются/скрываются через условный рендеринг
  }),
  
  setBinanceConnected: (connected) => set({ binanceConnected: connected }),
  
  setIsLoadingPairs: (loading) => set({ isLoadingPairs: loading }),
  
  setIsLoadingChart: (loading) => set({ isLoadingChart: loading }),
  
  setIsLoadingTick200: (loading) => set({ isLoadingTick200: loading }),
  
  // Индикаторы дельты стандартного графика
  setShowBarDeltaStandard: (show) => set({ showBarDeltaStandard: show }),
  
  setShowCumulativeDeltaStandard: (show) => set({ showCumulativeDeltaStandard: show }),
  
  setShowDeltaRotationStandard: (show) => set({ showDeltaRotationStandard: show }),
  
  setDeltaRotationThreshold: (threshold) => set({ deltaRotationThreshold: threshold }),
  
  // Индикаторы дельты 100-тикового графика
  setShowBarDeltaTick100: (show) => set({ showBarDeltaTick100: show }),
  
  setShowCumulativeDeltaTick100: (show) => set({ showCumulativeDeltaTick100: show }),
  
  setShowBidAskHistogram: (show) => set({ showBidAskHistogram: show }),
  
  // Индикатор Imbalance Trend
  setShowImbalanceTrend: (show) => set({ showImbalanceTrend: show }),
  setImbalanceLevels: (levels) => set({ imbalanceLevels: levels }),
  setImbalanceEmaPeriod: (period) => set({ imbalanceEmaPeriod: period }),
  setImbalanceMultiplier: (multiplier) => set({ imbalanceMultiplier: multiplier }),
  setShowImbalanceEma: (show) => set({ showImbalanceEma: show }),
  setImbalanceHeatMap: (enabled) => set({ imbalanceHeatMap: enabled }),
  setShowImbalanceMarkers: (enabled) => set({ showImbalanceMarkers: enabled }),
  setImbalanceMinStrength: (minStrength) => set({ imbalanceMinStrength: minStrength }),
  
  // Индикатор тренда кумулятивной дельты (стандартный график)
  setShowCumulativeDeltaTrend: (show) => set({ showCumulativeDeltaTrend: show }),
  
  setCumulativeDeltaTrendPeriod: (period) => set({ cumulativeDeltaTrendPeriod: period }),
  
  setCumulativeDeltaTrendOffset: (offset) => set({ cumulativeDeltaTrendOffset: offset }),
  
  setCumulativeDeltaDisplayMode: (mode) => set({ cumulativeDeltaDisplayMode: mode }),
  
  // Индикатор тренда кумулятивной дельты (200-тиковый график)
  setShowCumulativeDeltaTrendTick200: (show) => set({ showCumulativeDeltaTrendTick200: show }),
  
  setCumulativeDeltaTrendPeriodTick200: (period) => set({ cumulativeDeltaTrendPeriodTick200: period }),
  
  setCumulativeDeltaTrendOffsetTick200: (offset) => set({ cumulativeDeltaTrendOffsetTick200: offset }),
  
  setCumulativeDeltaDisplayModeTick200: (mode) => set({ cumulativeDeltaDisplayModeTick200: mode }),
  
  // Индикатор дисбаланса ликвидности
  setShowLiquidityImbalance: (show) => set({ showLiquidityImbalance: show }),
  setLiquidityImbalanceDepthPercent: (percent) => {
    const clampedPercent = Math.max(0.5, Math.min(3, percent));
    console.log('[LIQUIDITY_IMBALANCE] Store обновление:', {
      inputPercent: percent,
      clampedPercent,
      currentState: useTradingStore.getState().liquidityImbalanceDepthPercent,
    });
    set({ liquidityImbalanceDepthPercent: clampedPercent });
  },
  setLiquidityImbalanceShowLine: (show) => set({ liquidityImbalanceShowLine: show }),
  
  // Крупные лимитные ордера
  setShowBigOrders: (show) => set({ showBigOrders: show }),
  setBigOrderMultiplier: (multiplier) => {
    const clamped = Math.max(2, Math.min(20, multiplier));
    set({ bigOrderMultiplier: clamped });
  },
  
  // Боковая панель аналитики
  setShowAnalyticsSidebar: (show) => set({ showAnalyticsSidebar: show }),
  toggleAnalyticsSidebar: () => set((state) => ({ showAnalyticsSidebar: !state.showAnalyticsSidebar })),
  // Боковая панель Pre-Pump
  setShowPrePumpSidebar: (show) => set({ showPrePumpSidebar: show }),
  togglePrePumpSidebar: () => set((state) => ({ showPrePumpSidebar: !state.showPrePumpSidebar })),
}));
