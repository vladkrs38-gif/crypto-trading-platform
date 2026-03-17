/**
 * Pre-Pump store — данные от Python API.
 * Удалить вместе с pre-pump.
 */

import { create } from 'zustand';
import type { PrePumpSignalApi } from '@/lib/screenerApi';

interface PrePumpState {
  signals: PrePumpSignalApi[];
  idealSymbols: string[];
  idealCount: number;
  setPrePumpData: (data: {
    signals: PrePumpSignalApi[];
    idealSymbols: string[];
    idealCount: number;
  }) => void;
}

export const usePrePumpStore = create<PrePumpState>((set) => ({
  signals: [],
  idealSymbols: [],
  idealCount: 0,
  setPrePumpData: (data) =>
    set({
      signals: data.signals,
      idealSymbols: data.idealSymbols,
      idealCount: data.idealCount,
    }),
}));
