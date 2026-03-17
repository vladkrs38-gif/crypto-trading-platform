/**
 * Pre-Pump Screener API
 * Модуль расчёта метрик для поиска монет до пампa.
 * Удаление: можно удалить папку pre-pump целиком.
 */

import axios from 'axios';

const BINANCE_API = 'https://api.binance.com/api/v3';

const STABLECOIN_BLACKLIST = new Set([
  'USDCUSDT', 'USDTUSDT', 'USDEUSDT', 'XUSDUSDT', 'USD1USDT',
  'FDUSDUSDT', 'TUSDUSDT', 'BUSDUSDT', 'DAIUSDT', 'FRAXUSDT',
  'USDPUSDT', 'PYUSDUSDT', 'RLUSDUSDT', 'BFUSDUSDT', 'EURUSDT',
]);

export type PrePumpExchange = 'Binance' | 'Bybit';

export interface PrePumpSignal {
  symbol: string;
  exchange: PrePumpExchange;
  score: number;
  volumeRatio: number;
  pricePosition: number;
  takerBuyPercent: number;
  priceChangePercent: number;
  correlation: number;
  quoteVolume: number;
}

interface Ticker24h {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string;
}

// Binance 1d klines: [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBaseVolume, takerBuyQuoteVolume]
async function getBinanceKlinesRaw(symbol: string, interval: string, limit: number): Promise<any[]> {
  try {
    const res = await axios.get(`${BINANCE_API}/klines`, {
      params: { symbol: symbol.toUpperCase(), interval, limit },
    });
    return res.data as any[];
  } catch {
    return [];
  }
}

/** Volume Ratio = объём последних 24h / средний объём за 6 предыдущих дней */
export async function getVolumeRatio(symbol: string): Promise<number> {
  const klines = await getBinanceKlinesRaw(symbol, '1d', 8);
  if (klines.length < 7) return 1;

  const lastQuoteVol = parseFloat(klines[klines.length - 1]?.[7] || '0');
  const prevQuoteVols = klines.slice(0, -1).map((k) => parseFloat(k[7] || '0'));
  const avg = prevQuoteVols.reduce((a, b) => a + b, 0) / prevQuoteVols.length;
  if (avg <= 0) return 1;
  return lastQuoteVol / avg;
}

/** Price Position 0-100: где цена между low и high за 24h (0=у low, 100=у high) */
export function getPricePosition(high: number, low: number, last: number): number {
  if (high <= low) return 50;
  return Math.max(0, Math.min(100, ((last - low) / (high - low)) * 100));
}

/** Taker Buy % за последние 24h (1h свечи) */
export async function getTakerBuyPercent(symbol: string): Promise<number> {
  const klines = await getBinanceKlinesRaw(symbol, '1h', 24);
  if (klines.length === 0) return 50;

  let totalQuote = 0;
  let totalTakerBuy = 0;
  for (const k of klines) {
    const q = parseFloat(k[7] || '0');
    const tb = parseFloat(k[10] || '0');
    totalQuote += q;
    totalTakerBuy += tb;
  }
  if (totalQuote <= 0) return 50;
  return (totalTakerBuy / totalQuote) * 100;
}

/** Pre-Pump Score 0-100 */
function calcScore(params: {
  volumeRatio: number;
  pricePosition: number;
  takerBuyPercent: number;
  priceChangePercent: number;
  correlation: number;
}): number {
  let score = 0;

  // Volume ratio: > 1.5 хорошо
  if (params.volumeRatio >= 2) score += 25;
  else if (params.volumeRatio >= 1.5) score += 18;
  else if (params.volumeRatio >= 1.2) score += 10;

  // Price position: 20-70% — не у хая, есть потенциал
  if (params.pricePosition >= 20 && params.pricePosition <= 70) {
    score += 20;
  } else if (params.pricePosition >= 15 && params.pricePosition <= 80) {
    score += 10;
  }

  // Taker buy > 55%
  if (params.takerBuyPercent >= 60) score += 20;
  else if (params.takerBuyPercent >= 55) score += 12;

  // Price change: 0-5% — ещё не памп
  const chg = params.priceChangePercent;
  if (chg >= 0 && chg <= 5) score += 15;
  else if (chg >= 0 && chg <= 8) score += 8;

  // Correlation < 0.5 — альт может двигаться сам
  const corr = Math.abs(params.correlation);
  if (corr < 0.4) score += 20;
  else if (corr < 0.5) score += 10;

  return Math.min(100, score);
}

/** Идеальный Pre-Pump: Score 60+, Vol 1.5x+, Buy% 55+, Δ% 0–5% */
export function isIdealSignal(s: PrePumpSignal): boolean {
  return (
    s.score >= 60 &&
    s.volumeRatio >= 1.5 &&
    s.takerBuyPercent >= 55 &&
    s.priceChangePercent >= 0 &&
    s.priceChangePercent <= 5
  );
}

export interface PrePumpFetchOptions {
  limit?: number;
  minVolume?: number;
  correlationWithBtc?: (symbol: string, exchange: PrePumpExchange) => Promise<number>;
}

/**
 * Загрузка и расчёт Pre-Pump сигналов для топ пар.
 */
export async function fetchPrePumpSignals(
  options: PrePumpFetchOptions = {}
): Promise<PrePumpSignal[]> {
  const { limit = 20, minVolume = 1_000_000, correlationWithBtc } = options;

  try {
    const tickerRes = await axios.get(`${BINANCE_API}/ticker/24hr`);
    const tickers = (tickerRes.data as any[])
      .filter(
        (t: any) =>
          t.symbol?.endsWith('USDT') &&
          t.symbol !== 'BTCUSDT' &&
          !STABLECOIN_BLACKLIST.has(t.symbol)
      )
      .map((t: any) => ({
        symbol: t.symbol,
        lastPrice: t.lastPrice || t.price,
        priceChangePercent: parseFloat(t.priceChangePercent || 0),
        highPrice: parseFloat(t.highPrice || t.lastPrice || 0),
        lowPrice: parseFloat(t.lowPrice || t.lastPrice || 0),
        quoteVolume: parseFloat(t.quoteVolume || 0),
      }))
      .filter((t) => t.quoteVolume >= minVolume)
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, 60);

    const batchSize = 5;
    const signals: PrePumpSignal[] = [];

    for (let i = 0; i < tickers.length; i += batchSize) {
      const batch = tickers.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (t) => {
          const [volRatio, takerBuy, correlation] = await Promise.all([
            getVolumeRatio(t.symbol),
            getTakerBuyPercent(t.symbol),
            correlationWithBtc ? correlationWithBtc(t.symbol, 'Binance') : Promise.resolve(0),
          ]);

          const pricePosition = getPricePosition(t.highPrice, t.lowPrice, parseFloat(t.lastPrice));
          const score = calcScore({
            volumeRatio: volRatio,
            pricePosition,
            takerBuyPercent: takerBuy,
            priceChangePercent: t.priceChangePercent,
            correlation,
          });

          return {
            symbol: t.symbol,
            exchange: 'Binance' as PrePumpExchange,
            score,
            volumeRatio: volRatio,
            pricePosition,
            takerBuyPercent: takerBuy,
            priceChangePercent: t.priceChangePercent,
            correlation,
            quoteVolume: t.quoteVolume,
          };
        })
      );
      signals.push(...results);
      if (i + batchSize < tickers.length) {
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    return signals
      .filter((s) => s.score >= 20)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch (err) {
    console.error('[PrePump] fetchPrePumpSignals error:', err);
    return [];
  }
}
