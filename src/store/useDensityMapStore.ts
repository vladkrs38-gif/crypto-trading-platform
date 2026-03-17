import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Density, DensityMapSettings, MiniChartData } from '@/types/density';

interface DensityMapState {
  densities: Density[];
  isLoading: boolean;
  isScanning: boolean;
  lastUpdate: number | null;
  error: string | null;
  hoveredDensity: Density | null;
  miniChartData: MiniChartData | null;
  isMiniChartLoading: boolean;
  zoom: number;
  settingsOpen: boolean;
  settings: DensityMapSettings;
  
  setDensities: (densities: Density[]) => void;
  addDensity: (density: Density) => void;
  removeDensity: (id: string) => void;
  updateDensity: (id: string, updates: Partial<Density>) => void;
  clearDensities: () => void;
  setIsLoading: (loading: boolean) => void;
  setIsScanning: (scanning: boolean) => void;
  setLastUpdate: (timestamp: number) => void;
  setError: (error: string | null) => void;
  setHoveredDensity: (density: Density | null) => void;
  setMiniChartData: (data: MiniChartData | null) => void;
  setIsMiniChartLoading: (loading: boolean) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setSettingsOpen: (open: boolean) => void;
  toggleSettings: () => void;
  updateSettings: (updates: Partial<DensityMapSettings>) => void;
  resetSettings: () => void;
  addToBlacklist: (symbol: string) => void;
  removeFromBlacklist: (symbol: string) => void;
  getFilteredDensities: () => Density[];
  getOppositeDensity: (density: Density) => Density | null;
}

const defaultSettings: DensityMapSettings = {
  autoUpdate: true,
  updateInterval: 5,
  orderTypeFilter: 'all',
  maxDistancePercent: 3,
  minVolume24h: 1_000_000,   // $1M минимум по умолчанию
  maxVolume24h: 0,           // 0 = без ограничения
  minDensityUSD: 100_000,
  minDissolutionTime: 0,
  minLifetimeMinutes: 60, // 1 час по умолчанию
  maxDensities: 30,
  chartBars: 120,
  chartTimeframe: '5m',
  blacklist: ['BTCUSDT', 'ETHUSDT', 'XRPUSDT', 'BNBUSDT', 'SOLUSDT'],
  showExchange: true,
  showDistance: true,
  exchanges: {
    binance: true,
    bybit: true,
  },
  telegram: {
    enabled: false,
    botToken: '',
    chatId: '',
    alertDistancePercent: 0.5,
    cooldownMinutes: 5,
  },
};

export const useDensityMapStore = create<DensityMapState>()(
  persist(
    (set, get) => ({
      densities: [],
      isLoading: false,
      isScanning: false,
      lastUpdate: null,
      error: null,
      hoveredDensity: null,
      miniChartData: null,
      isMiniChartLoading: false,
      zoom: 1,
      settingsOpen: false,
      settings: defaultSettings,
      
      setDensities: (densities) => set({ densities, lastUpdate: Date.now() }),
      
      addDensity: (density) => set((state) => ({
        densities: [...state.densities, density],
      })),
      
      removeDensity: (id) => set((state) => ({
        densities: state.densities.filter((d) => d.id !== id),
      })),
      
      updateDensity: (id, updates) => set((state) => ({
        densities: state.densities.map((d) =>
          d.id === id ? { ...d, ...updates } : d
        ),
      })),
      
      clearDensities: () => set({ densities: [] }),
      setIsLoading: (isLoading) => set({ isLoading }),
      setIsScanning: (isScanning) => set({ isScanning }),
      setLastUpdate: (lastUpdate) => set({ lastUpdate }),
      setError: (error) => set({ error }),
      setHoveredDensity: (hoveredDensity) => set({ hoveredDensity }),
      setMiniChartData: (miniChartData) => set({ miniChartData }),
      setIsMiniChartLoading: (isMiniChartLoading) => set({ isMiniChartLoading }),
      setZoom: (zoom) => set({ zoom: Math.max(0.5, Math.min(2, zoom)) }),
      zoomIn: () => set((state) => ({ zoom: Math.min(2, state.zoom + 0.1) })),
      zoomOut: () => set((state) => ({ zoom: Math.max(0.5, state.zoom - 0.1) })),
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen })),
      
      updateSettings: (updates) => set((state) => ({
        settings: { ...state.settings, ...updates },
      })),
      
      resetSettings: () => set({ settings: defaultSettings }),
      
      addToBlacklist: (symbol) => set((state) => ({
        settings: {
          ...state.settings,
          blacklist: [...new Set([...state.settings.blacklist, symbol.toUpperCase()])],
        },
      })),
      
      removeFromBlacklist: (symbol) => set((state) => ({
        settings: {
          ...state.settings,
          blacklist: state.settings.blacklist.filter(
            (s) => s !== symbol.toUpperCase()
          ),
        },
      })),
      
      getFilteredDensities: () => {
        const { densities, settings } = get();
        
        const filtered = densities.filter((d) => {
          // Проверяем чёрный список (поддерживаем и полные названия и частичные)
          const isBlacklisted = settings.blacklist.some(
            (bl) => d.symbol === bl || d.symbol.startsWith(bl) || d.symbol.includes(bl)
          );
          if (isBlacklisted) return false;
          if (settings.orderTypeFilter !== 'all' && d.type !== settings.orderTypeFilter) return false;
          if (d.distancePercent > settings.maxDistancePercent) return false;
          if (d.exchange === 'binance' && !settings.exchanges.binance) return false;
          if (d.exchange === 'bybit' && !settings.exchanges.bybit) return false;
          if (d.amountUSD < settings.minDensityUSD) return false;
          if (d.dissolutionTime < settings.minDissolutionTime) return false;
          
          // Фильтр по 24h объёму монеты (только если volume24h известен)
          const volume = d.volume24h || 0;
          if (volume > 0) {
            // Применяем фильтр только если данные о volume есть
            if (volume < settings.minVolume24h) return false;
            if (settings.maxVolume24h > 0 && volume > settings.maxVolume24h) return false;
          }
          // Если volume24h = 0 (данных нет) - пропускаем плотность
          
          return true;
        });
        
        // Убираем дубликаты: для каждой монеты + типа (buy/sell) оставляем только ближайшую к цене
        // Плотность за первой плотностью не имеет смысла показывать
        const uniqueBySymbolType = new Map<string, Density>();
        
        for (const d of filtered) {
          const key = `${d.symbol}-${d.exchange}-${d.type}`;
          const existing = uniqueBySymbolType.get(key);
          
          // Если нет существующей или текущая ближе к цене - заменяем
          if (!existing || d.distancePercent < existing.distancePercent) {
            uniqueBySymbolType.set(key, d);
          }
        }
        
        const deduplicated = Array.from(uniqueBySymbolType.values());
        
        // Сортируем по времени разъедания (самые значимые сверху)
        // и ограничиваем количество
        return deduplicated
          .sort((a, b) => b.dissolutionTime - a.dissolutionTime)
          .slice(0, settings.maxDensities);
      },
      
      // Получить противоположную плотность для монеты
      getOppositeDensity: (density: Density) => {
        const { densities, settings } = get();
        const oppositeType = density.type === 'buy' ? 'sell' : 'buy';
        
        // Ищем противоположную плотность для этой же монеты и биржи
        const candidates = densities.filter((d) => {
          if (d.symbol !== density.symbol) return false;
          if (d.exchange !== density.exchange) return false;
          if (d.type !== oppositeType) return false;
          if (d.distancePercent > settings.maxDistancePercent) return false;
          return true;
        });
        
        // Возвращаем ближайшую к цене
        if (candidates.length === 0) return null;
        
        return candidates.reduce((closest, d) => 
          d.distancePercent < closest.distancePercent ? d : closest
        );
      },
    }),
    {
      name: 'density-map-storage',
      partialize: (state) => ({
        settings: state.settings,
        zoom: state.zoom,
      }),
      // Миграция: объединяем сохранённые настройки с дефолтными (для новых полей)
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<DensityMapState>;
        return {
          ...currentState,
          zoom: persisted.zoom ?? currentState.zoom,
          settings: {
            ...defaultSettings,
            ...persisted.settings,
            // Глубокое слияние для вложенных объектов
            exchanges: {
              ...defaultSettings.exchanges,
              ...(persisted.settings?.exchanges || {}),
            },
            telegram: {
              ...defaultSettings.telegram,
              ...(persisted.settings?.telegram || {}),
            },
          },
        };
      },
    }
  )
);
