import { create } from 'zustand';
import type { ScreenerSymbol } from '@/lib/screenerApi';

interface ScreenerNotification {
  symbol: string;
  levelsCount: number;
  triggeredAt: number;
}

interface ScreenerState {
  /** Результат скринера с бэкенда */
  symbols: ScreenerSymbol[];
  /** Порядок символов — сохраняем, чтобы карточки не мигали при обновлении */
  symbolOrder: string[];
  multiplier: number;
  lastFetchedAt: number | null;
  isLoading: boolean;
  error: string | null;
  /** Символы, которые уже показывали в уведомлении (чтобы не дублировать) */
  lastSeenSymbols: string[];
  /** Уведомления для главной страницы (новые находки скринера) */
  notifications: ScreenerNotification[];
  setResult: (symbols: ScreenerSymbol[], multiplier: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  /** Вызвать после опроса API: сравнить с lastSeenSymbols, добавить уведомления для новых символов. Возвращает число новых уведомлений. */
  processNewSymbols: (symbols: ScreenerSymbol[]) => number;
  dismissNotification: (symbol: string) => void;
  clearNotifications: () => void;
}

export const useScreenerStore = create<ScreenerState>((set, get) => ({
  symbols: [],
  symbolOrder: [],
  multiplier: 5,
  lastFetchedAt: null,
  isLoading: false,
  error: null,
  lastSeenSymbols: [],
  notifications: [],

  setResult: (newSymbols, multiplier) => {
    const { symbolOrder } = get();
    const newSymbolMap = new Map(newSymbols.map((s) => [s.symbol, s]));
    
    // Сохраняем порядок существующих карточек, добавляем новые в конец
    const existingOrder = symbolOrder.filter((sym) => newSymbolMap.has(sym));
    const newOrder = newSymbols
      .filter((s) => !symbolOrder.includes(s.symbol))
      .map((s) => s.symbol);
    const finalOrder = [...existingOrder, ...newOrder];
    
    // Сортируем symbols согласно порядку
    const sortedSymbols = finalOrder
      .map((sym) => newSymbolMap.get(sym))
      .filter((s): s is ScreenerSymbol => s !== undefined);
    
    set({
      symbols: sortedSymbols,
      symbolOrder: finalOrder,
      multiplier,
      lastFetchedAt: Date.now(),
      error: null,
    });
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error, isLoading: false }),

  processNewSymbols: (symbols) => {
    const prev = new Set(get().lastSeenSymbols);
    const hadPrevious = prev.size > 0;
    const newSymbols = symbols.filter((s) => !prev.has(s.symbol));
    symbols.forEach((s) => prev.add(s.symbol));

    // Уведомляем только о появлении новых символов после хотя бы одного опроса (не при первой загрузке)
    const newNotifications: ScreenerNotification[] = hadPrevious
      ? newSymbols.map((s) => ({
          symbol: s.symbol,
          levelsCount: s.levels.length,
          triggeredAt: Date.now(),
        }))
      : [];

    set((state) => ({
      lastSeenSymbols: Array.from(prev),
      notifications: [...newNotifications, ...state.notifications].slice(0, 20),
    }));
    return newNotifications.length;
  },

  dismissNotification: (symbol) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.symbol !== symbol),
    }));
  },

  clearNotifications: () => set({ notifications: [] }),
}));
