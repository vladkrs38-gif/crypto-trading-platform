/**
 * Адаптивное количество уровней стакана для разных пар.
 * Универсальное правило: у ликвидных пар глубже стакан — учитываем больше уровней
 * для давления крупных ордеров; у альтов — меньше уровней, чтобы не размазывать сигнал.
 */
const SYMBOL_LEVELS: Record<string, number> = {
  BTCUSDT: 50,
  BTCUSDC: 50,
  ETHUSDT: 40,
  ETHUSDC: 40,
  BNBUSDT: 30,
  SOLUSDT: 30,
  XRPUSDT: 25,
  ADAUSDT: 25,
  DOGEUSDT: 25,
  AVAXUSDT: 25,
  DOTUSDT: 25,
  MATICUSDT: 25,
  LINKUSDT: 25,
  UNIUSDT: 25,
  ATOMUSDT: 25,
  LTCUSDT: 28,
  NEARUSDT: 22,
  APTUSDT: 22,
  ARBUSDT: 22,
  OPUSDT: 22,
  INJUSDT: 20,
  SUIUSDT: 25,
  SEIUSDT: 22,
  TIAUSDT: 22,
};

const DEFAULT_LEVELS = 20;
const MIN_LEVELS = 10;
const MAX_LEVELS = 50;

/**
 * Возвращает рекомендуемое число уровней стакана для расчёта давления крупных ордеров
 * и дисбаланса по паре. Для BTC/ETH — больше уровней, для альтов — меньше.
 * Результат ограничен [MIN_LEVELS, MAX_LEVELS] и округлён до значений,
 * поддерживаемых API (Binance: 5,10,20,50; при подписке вызывающий код мапит при необходимости).
 */
export function getAdaptiveDepthLevels(symbol: string): number {
  const upper = symbol.toUpperCase();
  const levels = SYMBOL_LEVELS[upper] ?? DEFAULT_LEVELS;
  const clamped = Math.max(MIN_LEVELS, Math.min(MAX_LEVELS, levels));
  return clamped;
}
