/**
 * Допустимые minMove для lightweight-charts: base = round(1/minMove) должен содержать только множители 2 и 5.
 * Иначе библиотека выбрасывает "unexpected base" в PriceTickSpanCalculator.
 */
const VALID_MIN_MOVES = [
  0.000001, 0.000002, 0.000005, 0.00001, 0.00002, 0.00005, 0.0001, 0.0002, 0.0005,
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1,
];

function toValidMinMove(minMove: number): number {
  if (!isFinite(minMove) || minMove <= 0) return 0.01;
  const clamped = Math.max(0.000001, Math.min(1, minMove));
  for (let i = 0; i < VALID_MIN_MOVES.length; i++) {
    if (VALID_MIN_MOVES[i] >= clamped) return VALID_MIN_MOVES[i];
  }
  return 1;
}

/**
 * Округляет шаг до «красивого» меньшего: 1, 2, 5 * 10^n (чтобы получить больше подписей).
 */
function niceRoundDown(x: number): number {
  if (!isFinite(x) || x <= 0) return x;
  let mag = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-12))));
  let n = x / mag;
  if (n < 1) {
    mag = mag / 10;
    n = n * 10;
  }
  const candidates = [1, 2, 5, 10];
  let pick = 1;
  for (const c of candidates) {
    if (c <= n) pick = c;
    else break;
  }
  return Math.max(1e-8, pick * mag);
}

/**
 * Вычисляет priceFormat для ценовой шкалы.
 * Учитывает и полный диапазон (high–low), и средний размер свечи (avgBarRange):
 * если полный диапазон большой (напр. 1.8–2.3), а бары мелкие (0.002), шаг делаем
 * по среднему бару, чтобы между 2.06 и 2.08 были подписи (2.062, 2.064 … 2.078).
 * avgBarRange — среднее (high-low) по свечам; можно не передавать.
 */
export function getPriceFormatFromRange(
  high: number,
  low: number,
  avgBarRange?: number
): { type: 'price'; precision: number; minMove: number } {
  let range = high - low;
  const mid = (high + low) / 2;
  if (!isFinite(range) || range <= 0) {
    range = Math.max(mid * 0.05, 1e-8);
  }
  const desiredTicks = 10;
  let rawStep = range / desiredTicks;

  // «Круглый» шаг по полному диапазону
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 1e-12))));
  const normal = rawStep / magnitude;
  const candidates = [1, 2, 5, 10];
  let nice = 10;
  for (const c of candidates) {
    if (c >= normal) {
      nice = c;
      break;
    }
  }
  let minMove = Math.max(1e-8, nice * magnitude);

  // Если средний бар мелкий — делаем шаг мельче, чтобы в «типичном» участке (2.06–2.08) были подписи
  if (avgBarRange != null && isFinite(avgBarRange) && avgBarRange > 0) {
    const fineStep = 2 * avgBarRange; // ~2 бара — типичный просвет между метками
    if (fineStep < minMove) {
      minMove = niceRoundDown(fineStep);
    }
  }

  // Нижняя граница, чтобы не уходить в микро-шаги при высоких ценах
  const minReasonable = mid > 0 ? mid * 1e-6 : 1e-8;
  minMove = Math.max(minMove, minReasonable);

  // lightweight-charts требует minMove такой, что base = round(1/minMove) содержит только 2 и 5
  minMove = toValidMinMove(minMove);

  const precision = minMove >= 1
    ? 0
    : Math.min(8, Math.max(0, -Math.floor(Math.log10(minMove))));

  return { type: 'price', precision, minMove };
}
