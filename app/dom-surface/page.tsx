'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import Chart from '@/components/Chart';
import TickerSpeedIndicator from '@/components/TickerSpeedIndicator';
import { useTradingStore } from '@/store/useTradingStore';
import { useDomSurfaceStore, runApexSimulation, runKanalSimulation } from '@/store/useDomSurfaceStore';
import type { LabBotType } from '@/store/useDomSurfaceStore';
import {
  getHistoryStatus,
  startDownloadHistory,
  getDownloadStatus,
  optimizeOnHistory,
  getOptimizationProgress,
  getEquityCurve,
  getMlModelStatus,
  mlExport,
  mlPrepare,
  mlTrain,
  getHistoryCandles,
  type LabHistoryStatus,
  type MlModelStatus,
} from '@/lib/labApi';

const LAB_EQUITY_PARAMS_KEY = 'labEquityParams';
import type { Timeframe } from '@/types/binance';

type OptimizationResult = {
  id: number;
  scannerSigma: number;
  takeAlpha: number;
  dropLengthMinutes: number;  // Длина (L)
  maxLossPct: number;  // Макс. убыток в % от equity
  gridLegs: number;
  gridStepPct: number;
  martinMultiplier: number;
  profitFactor: number;
  totalPnlPct: number;
  tradesCount: number;
  winratePct: number;
  maxDrawdownPct: number;
  recoveryFactor: number;
};

export default function LabPage() {
  const { chartPeriod, setChartPeriod, setIsLabMode, setChartMode, timeframe, chartData, selectedPair, setChartDataAndFit } =
    useTradingStore((state) => ({
      chartPeriod: state.chartPeriod,
      setChartPeriod: state.setChartPeriod,
      setIsLabMode: state.setIsLabMode,
      setChartMode: state.setChartMode,
      timeframe: state.timeframe,
      chartData: state.chartData,
      selectedPair: state.selectedPair,
      setChartDataAndFit: state.setChartDataAndFit,
    }));

  const {
    mode,
    setMode,
    botType,
    setBotType,
    resetSession,
    setSimulationResult,
    setLiveState,
    setLiveModeStartTradeCount,
    initialEquity,
    stats,
    apexParams,
    setApexParams,
    apexPreset,
    setApexPreset,
    kanalParams,
    setKanalParams,
    trades,
    equityCurve,
  } = useDomSurfaceStore((state) => ({
    mode: state.mode,
    setMode: state.setMode,
    botType: state.botType,
    setBotType: state.setBotType,
    resetSession: state.resetSession,
    setSimulationResult: state.setSimulationResult,
    setLiveState: state.setLiveState,
    setLiveModeStartTradeCount: state.setLiveModeStartTradeCount,
    initialEquity: state.initialEquity,
    stats: state.stats,
    apexParams: state.apexParams,
    setApexParams: state.setApexParams,
    apexPreset: state.apexPreset,
    setApexPreset: state.setApexPreset,
    kanalParams: state.kanalParams,
    setKanalParams: state.setKanalParams,
    trades: state.trades,
    equityCurve: state.equityCurve,
  }));

  const [localPeriod, setLocalPeriod] = useState<number>(chartPeriod || 3);
  const [historyStatus, setHistoryStatus] = useState<LabHistoryStatus | null>(null);
  const [downloadRunning, setDownloadRunning] = useState(false);
  const [downloadDaysSoFar, setDownloadDaysSoFar] = useState<number | null>(null);
  const [downloadTimeframe, setDownloadTimeframe] = useState<Timeframe>(timeframe);
  const [optimizationRunning, setOptimizationRunning] = useState(false);
  const [optimizationResults, setOptimizationResults] = useState<OptimizationResult[]>([]);
  const [optimizationProgress, setOptimizationProgress] = useState<{ current: number; total: number } | null>(null);
  const [optimizationId, setOptimizationId] = useState<string | null>(null);
  const [optimizationHistoryDays, setOptimizationHistoryDays] = useState<number | null>(30); // По умолчанию 30 дней
  const [useFullHistory, setUseFullHistory] = useState(false);
  const [optimizationFastMode, setOptimizationFastMode] = useState(true); // По умолчанию включен быстрый режим
  const [sortColumn, setSortColumn] = useState<keyof OptimizationResult | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [sigmaRange, setSigmaRange] = useState({ min: 2, max: 5, step: 0.1 });
  const [alphaRange, setAlphaRange] = useState({ min: 1, max: 10, step: 1 });
  const [lengthRange, setLengthRange] = useState({ min: 10, max: 100, step: 10 });
  const [gridLegsRange, setGridLegsRange] = useState({ min: 0, max: 3, step: 1 });
  const [gridStepRange, setGridStepRange] = useState({ min: 1, max: 3, step: 0.5 });
  const [mlExportLoading, setMlExportLoading] = useState(false);
  const [mlPrepareLoading, setMlPrepareLoading] = useState(false);
  const [mlTrainLoading, setMlTrainLoading] = useState(false);
  const [mlMessage, setMlMessage] = useState<string | null>(null);
  const [mlModelStatus, setMlModelStatus] = useState<MlModelStatus | null>(null);
  const [historyRunLoading, setHistoryRunLoading] = useState(false);
  const [mlTradesLoading, setMlTradesLoading] = useState(false);
  const [mlTradesPhase, setMlTradesPhase] = useState<'idle' | 'history' | 'model' | 'run'>('idle');
  const router = useRouter();

  const exchange = 'binance';

  const fetchHistoryStatus = useCallback(
    async (sym: string, tf: string) => {
      try {
        const st = await getHistoryStatus(sym, tf, exchange);
        setHistoryStatus(st);
      } catch {
        setHistoryStatus({ available: false });
      }
    },
    []
  );

  useEffect(() => {
    if (!selectedPair?.symbol) {
      setHistoryStatus(null);
      return;
    }
    fetchHistoryStatus(selectedPair.symbol, timeframe);
  }, [selectedPair, timeframe, fetchHistoryStatus]);

  const labTf = timeframe === '200t' ? '5' : timeframe;
  useEffect(() => {
    if (!selectedPair?.symbol || !labTf) {
      setMlModelStatus(null);
      return;
    }
    getMlModelStatus(selectedPair.symbol, labTf)
      .then(setMlModelStatus)
      .catch(() => setMlModelStatus({ available: false, path: '' }));
  }, [selectedPair?.symbol, labTf]);

  useEffect(() => {
    if (!selectedPair?.symbol || !downloadRunning) return;
    const sym = selectedPair.symbol;
    const t = setInterval(async () => {
      const st = await getDownloadStatus(sym, downloadTimeframe, exchange);
      if (st.running && st.days_so_far != null) {
        setDownloadDaysSoFar(st.days_so_far);
      }
      if (!st.running) {
        setDownloadRunning(false);
        setDownloadDaysSoFar(null);
        fetchHistoryStatus(sym, timeframe);
      }
    }, 1500);
    return () => clearInterval(t);
  }, [selectedPair, downloadTimeframe, downloadRunning, timeframe, fetchHistoryStatus]);

  const handleStartDownload = async () => {
    if (!selectedPair?.symbol || downloadRunning) return;
    try {
      setDownloadDaysSoFar(null);
      await startDownloadHistory(selectedPair.symbol, downloadTimeframe, exchange);
      setDownloadRunning(true);
    } catch (e) {
      console.error(e);
    }
  };

  const timeframeLabels: Record<Timeframe, string> = useMemo(
    () => ({
      '1': '1m',
      '3': '3m',
      '5': '5m',
      '15': '15m',
      '30': '30m',
      '60': '1h',
      '120': '2h',
      '240': '4h',
      '360': '6h',
      '480': '8h',
      '720': '12h',
      D: '1d',
      W: '1w',
      M: '1M',
      '200t': '20t',
    }),
    []
  );
  const labTimeframes: Timeframe[] = ['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'W', 'M'];

  useEffect(() => {
    setDownloadTimeframe((prev) => (timeframe === '200t' ? '5' : timeframe));
  }, [timeframe]);

  useEffect(() => {
    setIsLabMode(true);
    setChartMode('standard');
    return () => {
      setIsLabMode(false);
    };
  }, [setIsLabMode, setChartMode]);

  // При смене инструмента в лаборатории сбрасываем виртуального бота,
  // чтобы не тянуть сделки и метрики с предыдущего символа.
  useEffect(() => {
    if (!selectedPair) return;
    resetSession();
  }, [selectedPair, resetSession]);

  const handleApplyPeriod = () => {
    const clamped = Math.max(1, Math.min(365, Number.isFinite(localPeriod) ? localPeriod : 3));
    setChartPeriod(clamped);
  };

  const timeframeMinutes = useMemo(() => {
    switch (timeframe) {
      case '1':
        return 1;
      case '3':
        return 3;
      case '5':
        return 5;
      case '15':
        return 15;
      case '30':
        return 30;
      case '60':
        return 60;
      case '120':
        return 120;
      case '240':
        return 240;
      case '360':
        return 360;
      case '480':
        return 480;
      case '720':
        return 720;
      case 'D':
        return 1440;
      case 'W':
        return 10080;
      case 'M':
        return 43200;
      default:
        return 1;
    }
  }, [timeframe]);

  const canOptimize =
    !!historyStatus?.available &&
    !!selectedPair?.symbol &&
    timeframe !== '200t';

  const handleOptimize = async () => {
    if (!selectedPair?.symbol || optimizationRunning) {
      console.warn('[Optimization] Cannot start: symbol=', selectedPair?.symbol, 'running=', optimizationRunning);
      return;
    }

    console.log('[Optimization] Starting optimization...');
    console.log('[Optimization] Symbol:', selectedPair.symbol);
    console.log('[Optimization] Timeframe:', timeframe);
    console.log('[Optimization] Exchange:', exchange);
    
    // Проверяем доступность API перед запуском
    try {
      const apiBase = process.env.NEXT_PUBLIC_DENSITY_API ?? process.env.NEXT_PUBLIC_SCREENER_API ?? 'http://127.0.0.1:8765';
      console.log('[Optimization] Checking API availability at:', apiBase);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const healthCheck = await fetch(`${apiBase}/`, { method: 'GET', signal: controller.signal });
      clearTimeout(timeoutId);
      if (!healthCheck.ok) {
        throw new Error(`API server returned ${healthCheck.status}`);
      }
      console.log('[Optimization] API server is available');
    } catch (e) {
      console.error('[Optimization] API health check failed:', e);
      if (e instanceof Error && e.name === 'AbortError') {
        alert('Сервер API не отвечает в течение 5 секунд. Убедитесь, что Python сервер запущен на порту 8765.');
      } else {
        alert(`Не удалось подключиться к серверу API. Убедитесь, что Python сервер запущен на порту 8765.\n\nОшибка: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    
    setOptimizationRunning(true);
    setOptimizationProgress({ current: 0, total: 1 });
    setOptimizationResults([]); // Очищаем предыдущие результаты при новом запуске
    
    let currentOptimizationId: string | null = null;
    
    try {
      const tf = timeframe === '200t' ? '5' : timeframe;
      console.log('[Optimization] Calling optimizeOnHistory API...');
      const response = await optimizeOnHistory(
        selectedPair.symbol,
        tf,
        exchange,
        {
          startLotUsd: apexParams.startLotUsd,
          dropLengthMinutes: apexParams.dropLengthMinutes,
          commissionPct: apexParams.commissionPct,
          initialEquity: apexParams.initialEquity,
          retrospective: apexParams.retrospective,
          obiFilterEnabled: apexParams.obiFilterEnabled,
          obiThreshold: apexParams.obiThreshold,
          slippagePct: apexParams.slippagePct,
          historyDays: useFullHistory ? null : (optimizationHistoryDays || null),
          fastMode: optimizationFastMode,
          sigmaRange: sigmaRange,
          alphaRange: alphaRange,
          lengthRange: lengthRange,
          gridLegsRange: gridLegsRange,
          gridStepRange: gridStepRange,
        }
      );
      
      const { results } = response;
      
      console.log('[Optimization] Raw response:', response);
      console.log('[Optimization] Raw results:', results);
      console.log('[Optimization] Results type:', typeof results);
      console.log('[Optimization] Results is array:', Array.isArray(results));
      console.log('[Optimization] Results length:', results?.length);
      console.log('[Optimization] First result sample:', results?.[0]);
      
      // Если результатов нет или пустой массив - показываем предупреждение
      if (!results || !Array.isArray(results) || results.length === 0) {
        console.warn('[Optimization] No results returned');
        if (response.optimizationId) {
          console.log('[Optimization] Has optimizationId, will wait for completion via polling');
          currentOptimizationId = response.optimizationId;
          setOptimizationId(response.optimizationId);
          // НЕ очищаем результаты - оставляем предыдущие, если они есть
          // setOptimizationResults([]); // УБРАНО - не очищаем результаты
          return;
        } else {
          console.error('[Optimization] No results and no optimizationId - optimization failed');
          setOptimizationRunning(false);
          setOptimizationProgress(null);
          // НЕ очищаем результаты при ошибке - возможно пользователь хочет видеть предыдущие
          // setOptimizationResults([]); // УБРАНО
          alert('Оптимизация завершилась без результатов. Проверьте параметры и историю данных.');
          return;
        }
      }
      
      console.log('[Optimization] Processing', results.length, 'results...');
      
      // Сначала останавливаем индикатор загрузки, чтобы UI не зависал
      setOptimizationProgress(null);
      setOptimizationId(null);
      setOptimizationRunning(false);
      console.log('[Optimization] Loading indicator stopped, starting background processing');
      
      // Быстро создаем базовые результаты для немедленного отображения
      const quickMapped = results.slice(0, Math.min(100, results.length)).map((r, i) => {
        const maxDrawdownPct = r.maxDrawdownPct ?? 0;
        const totalPnlPct = r.totalPnlPct ?? 0;
        const recoveryFactor = maxDrawdownPct > 0 ? totalPnlPct / maxDrawdownPct : 0;
        return {
          id: i + 1,
          scannerSigma: r.scannerSigma,
          takeAlpha: r.takeAlpha,
          dropLengthMinutes: r.dropLengthMinutes ?? apexParams.dropLengthMinutes,
          maxLossPct: r.maxLossPct,
          gridLegs: r.gridLegs,
          gridStepPct: r.gridStepPct,
          martinMultiplier: r.martinMultiplier,
          profitFactor: r.profitFactor,
          totalPnlPct: totalPnlPct,
          tradesCount: r.tradesCount ?? 0,
          winratePct: r.winratePct ?? 0,
          maxDrawdownPct: maxDrawdownPct,
          recoveryFactor: recoveryFactor,
        };
      });
      
      // Устанавливаем первые результаты сразу
      setOptimizationResults(quickMapped);
      console.log('[Optimization] First', quickMapped.length, 'results displayed immediately');
      
      // Обрабатываем остальные результаты в фоне небольшими батчами
      if (results.length > 100) {
        const processRemaining = async () => {
          const BATCH_SIZE = 100; // Уменьшенный размер батча
          const mappedResults: any[] = [...quickMapped];
          
          for (let i = 100; i < results.length; i += BATCH_SIZE) {
            const batch = results.slice(i, i + BATCH_SIZE);
            const batchMapped = batch.map((r, batchIdx) => {
              const idx = i + batchIdx;
              const maxDrawdownPct = r.maxDrawdownPct ?? 0;
              const totalPnlPct = r.totalPnlPct ?? 0;
              const recoveryFactor = maxDrawdownPct > 0 ? totalPnlPct / maxDrawdownPct : 0;
              return {
                id: idx + 1,
                scannerSigma: r.scannerSigma,
                takeAlpha: r.takeAlpha,
                dropLengthMinutes: r.dropLengthMinutes ?? apexParams.dropLengthMinutes,
                maxLossPct: r.maxLossPct,
                gridLegs: r.gridLegs,
                gridStepPct: r.gridStepPct,
                martinMultiplier: r.martinMultiplier,
                profitFactor: r.profitFactor,
                totalPnlPct: totalPnlPct,
                tradesCount: r.tradesCount ?? 0,
                winratePct: r.winratePct ?? 0,
                maxDrawdownPct: maxDrawdownPct,
                recoveryFactor: recoveryFactor,
              };
            });
            mappedResults.push(...batchMapped);
            
            // Обновляем результаты каждые 500 элементов
            if (mappedResults.length % 500 === 0 || i + BATCH_SIZE >= results.length) {
              setOptimizationResults([...mappedResults]);
              console.log('[Optimization] Updated results:', mappedResults.length, 'of', results.length);
            }
            
            // Даем браузеру время на обновление UI
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          
          // Финальное обновление со всеми результатами
          setOptimizationResults(mappedResults);
          console.log('[Optimization] All', mappedResults.length, 'results processed');
        };
        
        // Запускаем обработку в фоне без блокировки
        processRemaining().catch(err => {
          console.error('[Optimization] Error processing remaining results:', err);
        });
      }
      
      if (results.length === 0) {
        console.error('[Optimization] ERROR: No results returned');
        alert('Оптимизация завершилась без результатов. Проверьте параметры и историю данных.');
      } else {
        console.log('[Optimization] SUCCESS: Results processing started');
      }
    } catch (e) {
      console.error('[Optimization] Error:', e);
      console.error('[Optimization] Error details:', JSON.stringify(e, null, 2));
      setOptimizationProgress(null);
      setOptimizationId(null);
      setOptimizationRunning(false);
      alert(`Ошибка оптимизации: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      // optimizationRunning уже установлен в false выше, если результаты получены
      // или в catch блоке, если была ошибка
      // Дополнительная логика не требуется
    }
  };

  // Polling прогресса оптимизации
  useEffect(() => {
    if (!optimizationId || !optimizationRunning) {
      if (!optimizationRunning && optimizationId) {
        // Если оптимизация завершена, очищаем состояние
        setOptimizationProgress(null);
        setOptimizationId(null);
      }
      return;
    }

    const interval = setInterval(async () => {
      try {
        const progress = await getOptimizationProgress(optimizationId);
        if (progress.status === 'completed' || progress.status === 'not_found') {
          clearInterval(interval);
          setOptimizationProgress(null);
          setOptimizationId(null);
          setOptimizationRunning(false);
          
          // Если оптимизация завершена, но результатов еще нет - перезапускаем запрос результатов
          if (progress.status === 'completed' && optimizationResults.length === 0) {
            console.log('[Optimization] Completed, fetching results...');
            // Повторно вызываем оптимизацию для получения результатов
            // Но это не сработает, так как оптимизация уже завершена
            // Нужно добавить endpoint для получения результатов по ID
            console.warn('[Optimization] Results not available after completion. Need to implement result fetching endpoint.');
          }
        } else if (progress.status === 'running') {
          setOptimizationProgress({ current: progress.current, total: progress.total });
        }
      } catch (e) {
        console.error('Failed to fetch optimization progress:', e);
      }
    }, 500); // Обновление каждые 500мс

    return () => clearInterval(interval);
  }, [optimizationId, optimizationRunning]);

  /** Одна кнопка: сама качает историю, обучает модель (если нет), гоняет прогон с ML — сделки ниже. */
  const handleMlTradesOneClick = async () => {
    const tf = timeframe === '200t' ? '5' : timeframe;
    if (!selectedPair?.symbol) {
      alert('Выберите пару на графике.');
      return;
    }
    if (timeframe === '200t') {
      alert('Выберите обычный таймфрейм (1m, 5m, 15m и т.д.).');
      return;
    }
    setMlTradesLoading(true);
    try {
      let hasHistory = historyStatus?.available ?? false;
      if (!hasHistory) {
        setMlTradesPhase('history');
        await startDownloadHistory(selectedPair.symbol, tf, exchange);
        const deadline = Date.now() + 600000;
        while (Date.now() < deadline) {
          const st = await getDownloadStatus(selectedPair.symbol, tf, exchange);
          if (!st.running) break;
          await new Promise((r) => setTimeout(r, 2000));
        }
        const st = await getHistoryStatus(selectedPair.symbol, tf, exchange);
        hasHistory = st.available;
        if (!hasHistory) {
          alert('Не удалось загрузить историю. Подождите и нажмите снова или проверьте API.');
          return;
        }
        setHistoryStatus(st);
      }

      let modelOk = mlModelStatus?.available ?? false;
      if (!modelOk) {
        setMlTradesPhase('model');
        const ex = await mlExport(selectedPair.symbol, tf, exchange);
        if (!ex.ok) {
          alert(ex.error ?? 'Ошибка экспорта.');
          return;
        }
        const prep = await mlPrepare(selectedPair.symbol, tf);
        if (!prep.ok) {
          alert(prep.error ?? 'Ошибка подготовки фичей.');
          return;
        }
        const train = await mlTrain(selectedPair.symbol, tf);
        if (!train.ok) {
          alert(train.error ?? 'Ошибка обучения модели.');
          return;
        }
        const status = await getMlModelStatus(selectedPair.symbol, tf);
        setMlModelStatus(status);
        modelOk = status.available;
      }

      setMlTradesPhase('run');
      const mlStatus = await getMlModelStatus(selectedPair.symbol, tf);
      const params: Record<string, unknown> = {
        symbol: selectedPair.symbol,
        timeframe: tf,
        startLotUsd: apexParams.startLotUsd,
        scannerSigma: apexParams.scannerSigma,
        dropLengthMinutes: apexParams.dropLengthMinutes,
        retrospective: apexParams.retrospective,
        obiFilterEnabled: apexParams.obiFilterEnabled,
        obiThreshold: apexParams.obiThreshold,
        gridLegs: apexParams.gridLegs,
        gridStepPct: apexParams.gridStepPct,
        gridStepMode: apexParams.gridStepMode,
        atrPeriod: apexParams.atrPeriod,
        martinMultiplier: apexParams.martinMultiplier,
        takeAlpha: apexParams.takeAlpha,
        takeProfitPct: apexParams.takeProfitPct,
        breakEvenAfterLegs: apexParams.breakEvenAfterLegs ?? 0,
        maxLossPct: apexParams.maxLossPct,
        commissionPct: apexParams.commissionPct,
        slippagePct: apexParams.slippagePct,
        initialEquity: apexParams.initialEquity,
        allowShort: apexParams.allowShort ?? true,
        trendFilterEnabled: apexParams.trendFilterEnabled,
        emaPeriod: apexParams.emaPeriod,
        cooldownBars: apexParams.cooldownBars,
        dynamicAlphaEnabled: apexParams.dynamicAlphaEnabled,
        exposureCapBoth: apexParams.exposureCapBoth,
        atrRegimeFilterEnabled: apexParams.atrRegimeFilterEnabled,
        atrRegimeMin: apexParams.atrRegimeMin,
        atrRegimeMax: apexParams.atrRegimeMax,
        localExtremumBars: apexParams.localExtremumBars,
        trendFilterMarginPct: apexParams.trendFilterMarginPct,
        minRRatio: apexParams.minRRatio,
        mlFilterEnabled: true,
        mlModelPath: mlStatus?.available ? mlStatus.path : undefined,
        mlLongThreshold: 0.52,
        mlShortThreshold: 0.52,
      };
      const res = await getEquityCurve(selectedPair.symbol, tf, exchange, params);
      const initialEquityVal = apexParams.initialEquity;
      const m = res.metrics;
      const labTrades = res.trades.map((t, i) => ({
        id: i + 1,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        volume: 0,
        pnlUsd: t.pnlUsd,
        pnlPct: initialEquityVal > 0 ? (t.pnlUsd / initialEquityVal) * 100 : 0,
        legDetails: t.legDetails,
        exitReason: (t.reason === 'stop' ? 'SL' : t.reason === 'take' ? 'TP' : 'end') as 'SL' | 'TP' | 'end',
        side: (t.side === 'short' ? 'short' : 'long') as 'long' | 'short',
      }));
      const finalEquityVal = initialEquityVal + (m.netProfitUsd ?? 0);
      const avgLegs =
        res.trades.length > 0
          ? res.trades.reduce((s, t) => s + (t.legs ?? 0), 0) / res.trades.length
          : 0;
      const statsVal = {
        totalPnlUsd: m.netProfitUsd ?? 0,
        totalPnlPct: m.netProfitPct ?? 0,
        maxDrawdownPct: m.maxDrawdownPct ?? 0,
        tradesCount: res.trades.length,
        winratePct: m.winRate ?? 0,
        avgPnlUsd: m.avgTrade ?? 0,
        avgPnlPct: res.trades.length > 0 ? (m.netProfitPct ?? 0) / res.trades.length : 0,
        profitFactor: m.profitFactor ?? 0,
        avgLegsCount: avgLegs,
      };
      setSimulationResult(labTrades, res.equityCurve, statsVal, finalEquityVal);
      if (mode === 'live') {
        setLiveModeStartTradeCount(labTrades.length);
        setLiveState(null);
      }
      // Загружаем историю на график, чтобы сделки были визуально видны
      try {
        const candlesRes = await getHistoryCandles(selectedPair.symbol, tf, exchange, 50000);
        if (candlesRes.candles?.length > 0) {
          setChartDataAndFit(candlesRes.candles);
        }
      } catch (err) {
        console.warn('[ML] Не удалось загрузить свечи на график:', err);
      }
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : 'Ошибка. Проверьте API на порту 8765.');
    } finally {
      setMlTradesLoading(false);
      setMlTradesPhase('idle');
    }
  };

  const handleOpenEquityPage = () => {
    if (!selectedPair?.symbol || !historyStatus?.available) return;
    const tf = timeframe === '200t' ? '5' : timeframe;
    try {
      const equityParams = { exchange, ...apexParams };
      sessionStorage.setItem(LAB_EQUITY_PARAMS_KEY, JSON.stringify(equityParams));
      // Открываем в новой вкладке браузера
      const url = `/dom-surface/equity?symbol=${encodeURIComponent(selectedPair.symbol)}&timeframe=${encodeURIComponent(tf)}`;
      window.open(url, '_blank');
    } catch (e) {
      console.error(e);
    }
  };

  const handleRunHistory = async () => {
    const tf = timeframe === '200t' ? '5' : timeframe;
    const useMl = apexParams.mlFilterEnabled === true;
    const canUseBackend = useMl && selectedPair?.symbol && historyStatus?.available;

    if (canUseBackend) {
      if (!historyStatus?.available) {
        alert('Для прогона с ML нужна загруженная история (шаг 1 в инструкции выше).');
        return;
      }
      setHistoryRunLoading(true);
      try {
        const params = {
          startLotUsd: apexParams.startLotUsd,
          scannerSigma: apexParams.scannerSigma,
          dropLengthMinutes: apexParams.dropLengthMinutes,
          retrospective: apexParams.retrospective,
          obiFilterEnabled: apexParams.obiFilterEnabled,
          obiThreshold: apexParams.obiThreshold,
          gridLegs: apexParams.gridLegs,
          gridStepPct: apexParams.gridStepPct,
          gridStepMode: apexParams.gridStepMode,
          atrPeriod: apexParams.atrPeriod,
          martinMultiplier: apexParams.martinMultiplier,
          takeAlpha: apexParams.takeAlpha,
          takeProfitPct: apexParams.takeProfitPct,
          breakEvenAfterLegs: apexParams.breakEvenAfterLegs ?? 0,
          maxLossPct: apexParams.maxLossPct,
          commissionPct: apexParams.commissionPct,
          slippagePct: apexParams.slippagePct,
          initialEquity: apexParams.initialEquity,
          allowShort: apexParams.allowShort ?? true,
          trendFilterEnabled: apexParams.trendFilterEnabled,
          emaPeriod: apexParams.emaPeriod,
          cooldownBars: apexParams.cooldownBars,
          dynamicAlphaEnabled: apexParams.dynamicAlphaEnabled,
          exposureCapBoth: apexParams.exposureCapBoth,
          atrRegimeFilterEnabled: apexParams.atrRegimeFilterEnabled,
          atrRegimeMin: apexParams.atrRegimeMin,
          atrRegimeMax: apexParams.atrRegimeMax,
          localExtremumBars: apexParams.localExtremumBars,
          trendFilterMarginPct: apexParams.trendFilterMarginPct,
          minRRatio: apexParams.minRRatio,
          mlFilterEnabled: true,
          mlModelPath: apexParams.mlModelPath ?? undefined,
          mlLongThreshold: apexParams.mlLongThreshold ?? 0.55,
          mlShortThreshold: apexParams.mlShortThreshold ?? 0.55,
        };
        const res = await getEquityCurve(selectedPair!.symbol, tf, exchange, params);
        const initialEquity = apexParams.initialEquity;
        const m = res.metrics;
        const labTrades = res.trades.map((t, i) => ({
          id: i + 1,
          entryTime: t.entryTime,
          exitTime: t.exitTime,
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          volume: 0,
          pnlUsd: t.pnlUsd,
          pnlPct: initialEquity > 0 ? (t.pnlUsd / initialEquity) * 100 : 0,
          legDetails: t.legDetails,
          exitReason: (t.reason === 'stop' ? 'SL' : t.reason === 'take' ? 'TP' : 'end') as 'SL' | 'TP' | 'end',
        }));
        const finalEquity = initialEquity + (m.netProfitUsd ?? 0);
        const avgLegs = res.trades.length > 0
          ? res.trades.reduce((s, t) => s + (t.legs ?? 0), 0) / res.trades.length
          : 0;
        const stats = {
          totalPnlUsd: m.netProfitUsd ?? 0,
          totalPnlPct: m.netProfitPct ?? 0,
          maxDrawdownPct: m.maxDrawdownPct ?? 0,
          tradesCount: res.trades.length,
          winratePct: m.winRate ?? 0,
          avgPnlUsd: m.avgTrade ?? 0,
          avgPnlPct: res.trades.length > 0 ? (m.netProfitPct ?? 0) / res.trades.length : 0,
          profitFactor: m.profitFactor ?? 0,
          avgLegsCount: avgLegs,
        };
        setSimulationResult(labTrades, res.equityCurve, stats, finalEquity);
        if (mode === 'live') {
          setLiveModeStartTradeCount(labTrades.length);
          setLiveState(null);
        }
        if (labTrades.length === 0) {
          alert(
            'Сделок не было. Попробуйте: пресет «Агрессивный», ослабить фильтры (Sigma, Alpha), отключить ML-фильтр или проверить, что модель обучена для этой пары и таймфрейма.'
          );
        }
      } catch (e) {
        console.error(e);
        alert(e instanceof Error ? e.message : 'Ошибка расчёта на бэкенде (с ML). Проверьте, что модель обучена и API запущен.');
      } finally {
        setHistoryRunLoading(false);
      }
      return;
    }

    if (!chartData || chartData.length === 0) {
      alert('Без ML прогон идёт по данным графика. Задайте период истории (дней) и нажмите «Применить», затем «Старт история».');
      return;
    }

    if (botType === 'kanal') {
      const result = runKanalSimulation(chartData, { ...kanalParams });
      setSimulationResult(result.trades, result.equityCurve, result.stats, result.finalEquity);
      if (result.trades.length === 0) {
        alert('Сделок не было. Попробуйте увеличить период истории (дней), уменьшить период SMA или увеличить ширину канала.');
      }
      return;
    }

    const result = runApexSimulation(chartData, { ...apexParams, timeframeMinutes });
    setSimulationResult(result.trades, result.equityCurve, result.stats, result.finalEquity);
    if (mode === 'live') {
      setLiveModeStartTradeCount(result.trades.length);
      setLiveState(result.endState);
    }
    if (result.trades.length === 0) {
      alert(
        'Сделок не было по данным графика. Увеличьте период (дней), выберите пресет «Агрессивный» или ослабьте фильтры. Для полной истории с ML включите ML-фильтр и загрузите историю (шаги 1–4).'
      );
    }
  };

  const handleReset = () => {
    resetSession();
  };

  const handleExportSimulation = () => {
    if (!trades.length && !equityCurve?.length) return;
    const payload = {
      meta: {
        symbol: selectedPair?.symbol ?? '',
        timeframe,
        exportedAt: new Date().toISOString(),
      },
      params: { ...apexParams, preset: apexPreset },
      stats: stats ?? null,
      trades,
      equityCurve: equityCurve ?? [],
      candles: chartData ?? [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simulation_${selectedPair?.symbol ?? 'export'}_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Сортировка результатов оптимизации с дедупликацией и ограничением до топ-10
  const sortedResults = useMemo(() => {
    if (optimizationResults.length === 0) return [];
    
    // Дедупликация по уникальным комбинациям параметров
    const uniqueMap = new Map<string, OptimizationResult>();
    for (const result of optimizationResults) {
      // Ключ уникальности: Sigma + Alpha + L + Grid
      const key = `${result.scannerSigma}_${result.takeAlpha}_${result.dropLengthMinutes}_${result.gridLegs}`;
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, result);
      } else {
        // Если уже есть, берем тот у которого больше PnL
        const existing = uniqueMap.get(key)!;
        if (result.totalPnlPct > existing.totalPnlPct) {
          uniqueMap.set(key, result);
        }
      }
    }
    
    // Преобразуем в массив и сортируем по PnL по убыванию
    let sorted = Array.from(uniqueMap.values()).sort((a, b) => {
      return b.totalPnlPct - a.totalPnlPct; // По убыванию PnL
    });
    
    // Если выбрана другая сортировка, применяем её
    if (sortColumn && sortColumn !== 'totalPnlPct') {
      sorted = sorted.sort((a, b) => {
        const aVal = a[sortColumn];
        const bVal = b[sortColumn];
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortDirection === 'desc' ? bVal - aVal : aVal - bVal;
        }
        return 0;
      });
    } else if (sortColumn === 'totalPnlPct') {
      // Если сортировка по PnL, применяем направление
      if (sortDirection === 'asc') {
        sorted = sorted.reverse();
      }
    }
    
    // Ограничиваем до топ-10
    return sorted.slice(0, 10);
  }, [optimizationResults, sortColumn, sortDirection]);

  const handleSort = (column: keyof OptimizationResult) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Header />
      <TickerSpeedIndicator />

      <main
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'row',
          overflow: 'hidden',
          gap: '8px',
          padding: '4px 8px 8px 8px',
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderRadius: '8px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Период истории:</span>
              <input
                type="number"
                min={1}
                max={365}
                value={localPeriod}
                onChange={(e) => setLocalPeriod(parseInt(e.target.value || '1', 10))}
                style={{
                  width: '70px',
                  padding: '4px 6px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-main)',
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                }}
              />
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>дней</span>
              <button
                onClick={handleApplyPeriod}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                  color: 'white',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Применить
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>История:</span>
              {historyStatus?.available ? (
                <span style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>
                  {historyStatus.days ?? 0} дн.
                </span>
              ) : selectedPair ? (
                <>
                  <select
                    value={downloadTimeframe}
                    onChange={(e) => setDownloadTimeframe(e.target.value as Timeframe)}
                    disabled={downloadRunning}
                    style={{
                      padding: '4px 6px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-main)',
                      color: 'var(--text-main)',
                      fontSize: '0.85rem',
                    }}
                  >
                    {labTimeframes.map((tf) => (
                      <option key={tf} value={tf}>
                        {timeframeLabels[tf]}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleStartDownload}
                    disabled={downloadRunning}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '6px',
                      border: 'none',
                      background: downloadRunning
                        ? 'var(--bg-main)'
                        : 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)',
                      color: downloadRunning ? 'var(--text-muted)' : 'white',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: downloadRunning ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {downloadRunning
                      ? (downloadDaysSoFar != null ? `Загрузка… ${downloadDaysSoFar} дн.` : 'Загрузка…')
                      : 'Начать загрузку истории'}
                  </button>
                </>
              ) : (
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>выберите пару</span>
              )}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }} title="Дельта по истории планируется отдельно (тиковые сделки)">
              В загрузке: свечи + объём по свече. Дельта по истории пока не поддерживается.
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Режим:</span>
              <button
                onClick={() => setMode('history')}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: mode === 'history' ? '2px solid #3b82f6' : '1px solid var(--border)',
                  background:
                    mode === 'history'
                      ? 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)'
                      : 'var(--bg-main)',
                  color: mode === 'history' ? 'white' : 'var(--text-main)',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                История
              </button>
              <button
                onClick={() => setMode('live')}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: mode === 'live' ? '2px solid #22c55e' : '1px solid var(--border)',
                  background:
                    mode === 'live'
                      ? 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)'
                      : 'var(--bg-main)',
                  color: mode === 'live' ? 'white' : 'var(--text-main)',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                Лайв (виртуально)
              </button>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              borderRadius: '8px',
              overflow: 'hidden',
              border: '1px solid var(--border)',
              background: 'var(--bg-main)',
            }}
          >
            <Chart />
          </div>
        </div>

        <aside
          style={{
            width: '320px',
            maxWidth: '35%',
            minWidth: '260px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div
            style={{
              padding: '16px',
              borderRadius: '8px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            {/* Bot type switcher */}
            <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-main)', borderRadius: '8px', padding: '3px' }}>
              <button
                onClick={() => setBotType('apex')}
                style={{
                  flex: 1,
                  padding: '7px 0',
                  borderRadius: '6px',
                  border: 'none',
                  background: botType === 'apex' ? 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)' : 'transparent',
                  color: botType === 'apex' ? 'white' : 'var(--text-muted)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                Apex
              </button>
              <button
                onClick={() => setBotType('kanal')}
                style={{
                  flex: 1,
                  padding: '7px 0',
                  borderRadius: '6px',
                  border: 'none',
                  background: botType === 'kanal' ? 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)' : 'transparent',
                  color: botType === 'kanal' ? 'white' : 'var(--text-muted)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                Kanal
              </button>
            </div>

            {/* Header */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)' }}>
                {botType === 'apex' ? 'Apex бот (виртуальный)' : 'Kanal бот (Боллинджер)'}
              </span>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                {botType === 'apex'
                  ? <>Виртуальный депозит: <strong style={{ color: 'var(--text-main)' }}>{initialEquity}&nbsp;$</strong>. Торгуем только на истории и в лайве без реальных ордеров.</>
                  : <>Стратегия «Возврат к среднему». Вход от границ канала, выход на средней линии. Депозит: <strong style={{ color: 'var(--text-main)' }}>{kanalParams.initialEquity}&nbsp;$</strong>.</>
                }
              </div>
            </div>

            {/* Settings */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {botType === 'apex' ? (
                <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Режим бота</span>
                <select
                  value={apexPreset}
                  onChange={(e) => setApexPreset(e.target.value as 'conservative' | 'balanced' | 'aggressive')}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-main)',
                    color: 'var(--text-main)',
                    fontSize: '0.85rem',
                  }}
                >
                  <option value="conservative">Консервативный (меньше сделок, меньше риск)</option>
                  <option value="balanced">Сбалансированный</option>
                  <option value="aggressive">Агрессивный (больше сделок, выше риск)</option>
                </select>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Депозит, $</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={apexParams.initialEquity}
                    onChange={(e) => setApexParams({ initialEquity: parseFloat(e.target.value || '100') })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-main)',
                      color: 'var(--text-main)',
                      fontSize: '0.8rem',
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Старт лот, $</span>
                  <input
                    type="number"
                    min={1}
                    value={apexParams.startLotUsd}
                    onChange={(e) => setApexParams({ startLotUsd: parseFloat(e.target.value || '10') })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-main)',
                      color: 'var(--text-main)',
                      fontSize: '0.8rem',
                    }}
                  />
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Комиссия, %</span>
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    value={apexParams.commissionPct}
                    onChange={(e) => setApexParams({ commissionPct: parseFloat(e.target.value || '0.04') })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-main)',
                      color: 'var(--text-main)',
                      fontSize: '0.8rem',
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Проскальз., %</span>
                  <input
                    type="number"
                    step={0.005}
                    min={0}
                    value={apexParams.slippagePct}
                    onChange={(e) => setApexParams({ slippagePct: parseFloat(e.target.value || '0.01') })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-main)',
                      color: 'var(--text-main)',
                      fontSize: '0.8rem',
                    }}
                  />
                </label>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem' }}>
                <input
                  type="checkbox"
                  checked={apexParams.allowShort ?? true}
                  onChange={(e) => setApexParams({ allowShort: e.target.checked })}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ color: 'var(--text-muted)' }}>Разрешить шорты (Z ≥ +S)</span>
              </label>
                </>
              ) : (
                <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Период SMA: <strong style={{ color: 'var(--text-main)' }}>{kanalParams.period}</strong></span>
                <input
                  type="range"
                  min={5}
                  max={50}
                  value={kanalParams.period}
                  onChange={(e) => setKanalParams({ period: parseInt(e.target.value) })}
                  style={{ width: '100%', accentColor: '#0ea5e9' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Ширина канала (σ): <strong style={{ color: 'var(--text-main)' }}>{kanalParams.multiplier}</strong></span>
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.1}
                  value={kanalParams.multiplier}
                  onChange={(e) => setKanalParams({ multiplier: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: '#0ea5e9' }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem' }}>
                <input
                  type="checkbox"
                  checked={kanalParams.stopLossEnabled ?? false}
                  onChange={(e) => setKanalParams({ stopLossEnabled: e.target.checked })}
                  style={{ accentColor: '#0ea5e9' }}
                />
                <span style={{ color: 'var(--text-muted)' }}>Стоп-лосс (% от входа)</span>
              </label>
              {kanalParams.stopLossEnabled && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Стоп-лосс, %: <strong style={{ color: 'var(--text-main)' }}>{kanalParams.stopLossPct ?? 2}</strong></span>
                  <input
                    type="range"
                    min={0.2}
                    max={10}
                    step={0.1}
                    value={kanalParams.stopLossPct ?? 2}
                    onChange={(e) => setKanalParams({ stopLossPct: parseFloat(e.target.value) })}
                    style={{ width: '100%', accentColor: '#0ea5e9' }}
                  />
                </label>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Депозит, $</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={kanalParams.initialEquity}
                    onChange={(e) => setKanalParams({ initialEquity: parseFloat(e.target.value || '100') })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-main)',
                      color: 'var(--text-main)',
                      fontSize: '0.8rem',
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Старт лот, $</span>
                  <input
                    type="number"
                    min={1}
                    value={kanalParams.startLotUsd}
                    onChange={(e) => setKanalParams({ startLotUsd: parseFloat(e.target.value || '10') })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-main)',
                      color: 'var(--text-main)',
                      fontSize: '0.8rem',
                    }}
                  />
                </label>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Комиссия, %</span>
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    value={kanalParams.commissionPct}
                    onChange={(e) => setKanalParams({ commissionPct: parseFloat(e.target.value || '0.04') })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-main)',
                      color: 'var(--text-main)',
                      fontSize: '0.8rem',
                    }}
                  />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Проскальз., %</span>
                  <input
                    type="number"
                    step={0.005}
                    min={0}
                    value={kanalParams.slippagePct}
                    onChange={(e) => setKanalParams({ slippagePct: parseFloat(e.target.value || '0.01') })}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'var(--bg-main)',
                      color: 'var(--text-main)',
                      fontSize: '0.8rem',
                    }}
                  />
                </label>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem' }}>
                <input
                  type="checkbox"
                  checked={kanalParams.allowShort}
                  onChange={(e) => setKanalParams({ allowShort: e.target.checked })}
                  style={{ accentColor: '#0ea5e9' }}
                />
                <span style={{ color: 'var(--text-muted)' }}>Разрешить шорты (от верхней границы)</span>
              </label>
                </>
              )}

            </div>

            {/* Action buttons */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                paddingTop: '8px',
                borderTop: '1px solid var(--border)',
              }}
            >
              {botType === 'kanal' ? (
                <button
                  type="button"
                  onClick={handleRunHistory}
                  disabled={!selectedPair?.symbol || !chartData || chartData.length === 0}
                  style={{
                    width: '100%',
                    padding: '14px 20px',
                    borderRadius: '8px',
                    border: 'none',
                    background:
                      !selectedPair?.symbol || !chartData || chartData.length === 0
                        ? 'var(--bg-main)'
                        : 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)',
                    color: !selectedPair?.symbol || !chartData?.length ? 'var(--text-muted)' : 'white',
                    fontSize: '1rem',
                    fontWeight: 700,
                    cursor: !selectedPair?.symbol || !chartData?.length ? 'not-allowed' : 'pointer',
                    transition: 'opacity 0.2s',
                    opacity: !selectedPair?.symbol || !chartData?.length ? 0.7 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (selectedPair?.symbol && chartData?.length) e.currentTarget.style.opacity = '0.9';
                  }}
                  onMouseLeave={(e) => {
                    if (selectedPair?.symbol && chartData?.length) e.currentTarget.style.opacity = '1';
                  }}
                >
                  Тест на истории
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleMlTradesOneClick}
                  disabled={mlTradesLoading || !selectedPair?.symbol || timeframe === '200t'}
                  title="Выберите пару — нажмите. Всё остальное (история, модель, сделки) сделается само."
                  style={{
                    width: '100%',
                    padding: '14px 20px',
                    borderRadius: '8px',
                    border: 'none',
                    background:
                      mlTradesLoading || !selectedPair?.symbol
                        ? 'var(--bg-main)'
                        : 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)',
                    color: mlTradesLoading || !selectedPair?.symbol ? 'var(--text-muted)' : 'white',
                    fontSize: '1rem',
                    fontWeight: 700,
                    cursor: mlTradesLoading || !selectedPair?.symbol ? 'not-allowed' : 'pointer',
                    transition: 'opacity 0.2s',
                    opacity: mlTradesLoading || !selectedPair?.symbol ? 0.7 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!mlTradesLoading && selectedPair?.symbol) e.currentTarget.style.opacity = '0.9';
                  }}
                  onMouseLeave={(e) => {
                    if (!mlTradesLoading && selectedPair?.symbol) e.currentTarget.style.opacity = '1';
                  }}
                >
                  {mlTradesLoading
                    ? mlTradesPhase === 'history'
                      ? 'Загрузка истории…'
                      : mlTradesPhase === 'model'
                        ? 'Обучение модели…'
                        : mlTradesPhase === 'run'
                          ? 'Прогон…'
                          : '…'
                    : 'Сделки по ML'}
                </button>
              )}
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={handleExportSimulation}
                  disabled={!trades.length && !(equityCurve?.length)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    background: trades.length || equityCurve?.length ? 'var(--bg-card)' : 'var(--bg-main)',
                    color: trades.length || equityCurve?.length ? 'var(--text-main)' : 'var(--text-muted)',
                    fontSize: '0.8rem',
                    cursor: trades.length || equityCurve?.length ? 'pointer' : 'not-allowed',
                  }}
                >
                  Выгрузить
                </button>
                <button
                  onClick={handleReset}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-main)',
                    color: 'var(--text-main)',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  Сброс
                </button>
              </div>
            </div>
          </div>

          <div
            style={{
              padding: '10px 12px',
              borderRadius: '8px',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Метрики</span>
            {stats ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '6px 12px',
                  fontSize: '0.8rem',
                }}
              >
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>PnL, $</div>
                  <div>{stats.totalPnlUsd.toFixed(2)}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>PnL, %</div>
                  <div>{stats.totalPnlPct.toFixed(2)}%</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>Max DD, %</div>
                  <div>{stats.maxDrawdownPct.toFixed(2)}%</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>Сделок</div>
                  <div>{stats.tradesCount}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>Winrate</div>
                  <div>{stats.winratePct.toFixed(1)}%</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>Profit factor</div>
                  <div>
                    {Number.isFinite(stats.profitFactor)
                      ? stats.profitFactor.toFixed(2)
                      : '∞'}
                  </div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>Ср. колен</div>
                  <div>{stats.avgLegsCount.toFixed(1)}</div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Запусти прогон на истории, чтобы увидеть PnL, просадку и другие метрики.
              </div>
            )}
            {trades.length > 0 && (
              <div
                style={{
                  marginTop: '8px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border)',
                  maxHeight: '200px',
                  overflowY: 'auto',
                }}
              >
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  Сделки ({trades.length})
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px', fontSize: '0.7rem' }}>
                  {trades.slice(-15).reverse().map((t) => (
                    <div
                      key={t.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '4px 6px',
                        borderRadius: '4px',
                        background: t.pnlUsd >= 0 ? 'rgba(22, 163, 74, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: 'var(--text-main)',
                      }}
                    >
                      <span>#{t.id} {t.side === 'short' ? 'S' : 'L'}</span>
                      <span style={{ color: t.pnlUsd >= 0 ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                        {t.pnlUsd >= 0 ? '+' : ''}{t.pnlUsd.toFixed(2)}$
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        {optimizationResults && optimizationResults.length > 0 && (
          <aside
            style={{
              width: '380px',
              minWidth: '380px',
              maxWidth: '380px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div
              style={{
                padding: '12px',
                borderRadius: '8px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                minHeight: 0,
                overflow: 'hidden',
                flex: 1,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Результаты оптимизации</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  Топ-10 (уникальные)
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  overflowY: 'auto',
                  minHeight: 0,
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '0.6fr 0.5fr 0.5fr 0.5fr 0.4fr 0.4fr 0.5fr 0.6fr',
                    gap: '4px',
                    paddingBottom: '4px',
                    borderBottom: '1px solid var(--border)',
                    color: 'var(--text-muted)',
                    fontSize: '0.65rem',
                    fontWeight: 500,
                    flexShrink: 0,
                  }}
                >
                  <span>Sigma</span>
                  <span>Alpha</span>
                  <span>L</span>
                  <span>Grid</span>
                  <span>Step%</span>
                  <span>Mart</span>
                  <span
                    onClick={() => handleSort('profitFactor')}
                    style={{
                      cursor: 'pointer',
                      userSelect: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px',
                      color: sortColumn === 'profitFactor' ? 'var(--text-main)' : 'var(--text-muted)',
                      fontWeight: sortColumn === 'profitFactor' ? 600 : 500,
                    }}
                    title="Кликните для сортировки"
                  >
                    PF
                    {sortColumn === 'profitFactor' && (sortDirection === 'desc' ? ' ↓' : ' ↑')}
                  </span>
                  <span
                    onClick={() => handleSort('totalPnlPct')}
                    style={{
                      cursor: 'pointer',
                      userSelect: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '2px',
                      color: sortColumn === 'totalPnlPct' ? 'var(--text-main)' : 'var(--text-muted)',
                      fontWeight: sortColumn === 'totalPnlPct' ? 600 : 500,
                    }}
                    title="Кликните для сортировки"
                  >
                    PnL%
                    {sortColumn === 'totalPnlPct' && (sortDirection === 'desc' ? ' ↓' : ' ↑')}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {sortedResults.length > 0 && console.log('[Table] Rendering rows, first row:', sortedResults[0])}
                  {sortedResults.map((row) => (
                    <div
                      key={row.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        padding: '8px',
                        borderRadius: '6px',
                        background: 'var(--bg-main)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '0.6fr 0.5fr 0.5fr 0.5fr 0.4fr 0.4fr 0.5fr 0.6fr',
                          gap: '4px',
                          alignItems: 'center',
                          fontSize: '0.7rem',
                          marginBottom: '6px',
                        }}
                      >
                        <span>{row.scannerSigma}</span>
                        <span>{row.takeAlpha}</span>
                        <span>{row.dropLengthMinutes}</span>
                        <span>{row.gridLegs}</span>
                        <span>{row.gridStepPct || '—'}</span>
                        <span>{row.martinMultiplier}x</span>
                        <span style={{ fontWeight: 600 }}>{row.profitFactor.toFixed(2)}</span>
                        <span style={{ fontWeight: 600, color: row.totalPnlPct >= 0 ? '#22c55e' : '#ef4444' }}>
                          {row.totalPnlPct >= 0 ? '+' : ''}{row.totalPnlPct.toFixed(1)}%
                        </span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          gap: '12px',
                          fontSize: '0.65rem',
                          paddingTop: '6px',
                          borderTop: '1px solid var(--border)',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <span
                          onClick={() => handleSort('tradesCount')}
                          style={{
                            cursor: 'pointer',
                            userSelect: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: sortColumn === 'tradesCount' ? 'var(--text-main)' : 'var(--text-muted)',
                            fontWeight: sortColumn === 'tradesCount' ? 600 : 500,
                          }}
                          title="Кликните для сортировки"
                        >
                          <span style={{ color: 'var(--text-main)' }}>{row.tradesCount ?? 0}</span>
                          <span>Trades</span>
                          {sortColumn === 'tradesCount' && (sortDirection === 'desc' ? ' ↓' : ' ↑')}
                        </span>
                        <span
                          onClick={() => handleSort('maxDrawdownPct')}
                          style={{
                            cursor: 'pointer',
                            userSelect: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: sortColumn === 'maxDrawdownPct' ? 'var(--text-main)' : 'var(--text-muted)',
                            fontWeight: sortColumn === 'maxDrawdownPct' ? 600 : 500,
                          }}
                          title="Кликните для сортировки"
                        >
                          <span style={{ color: (row.maxDrawdownPct ?? 0) > 20 ? '#ef4444' : (row.maxDrawdownPct ?? 0) > 10 ? '#f59e0b' : 'var(--text-main)' }}>
                            {(row.maxDrawdownPct ?? 0).toFixed(2)}%
                          </span>
                          <span>Max DD%</span>
                          {sortColumn === 'maxDrawdownPct' && (sortDirection === 'desc' ? ' ↓' : ' ↑')}
                        </span>
                        <span
                          onClick={() => handleSort('recoveryFactor')}
                          style={{
                            cursor: 'pointer',
                            userSelect: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            color: sortColumn === 'recoveryFactor' ? 'var(--text-main)' : 'var(--text-muted)',
                            fontWeight: sortColumn === 'recoveryFactor' ? 600 : 500,
                          }}
                          title="Кликните для сортировки"
                        >
                          <span style={{ fontWeight: 600, color: (row.recoveryFactor ?? 0) > 1 ? '#22c55e' : (row.recoveryFactor ?? 0) > 0.5 ? '#f59e0b' : '#ef4444' }}>
                            {(row.recoveryFactor ?? 0).toFixed(2)}
                          </span>
                          <span>RF</span>
                          {sortColumn === 'recoveryFactor' && (sortDirection === 'desc' ? ' ↓' : ' ↑')}
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          setApexParams({
                            scannerSigma: row.scannerSigma,
                            takeAlpha: row.takeAlpha,
                            dropLengthMinutes: row.dropLengthMinutes,
                            maxLossPct: row.maxLossPct,
                            gridLegs: row.gridLegs,
                            gridStepPct: row.gridStepPct,
                            martinMultiplier: row.martinMultiplier,
                          })
                        }
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          border: '1px solid var(--border)',
                          background: 'var(--bg-card)',
                          color: 'var(--text-main)',
                          fontSize: '0.75rem',
                          fontWeight: 500,
                          cursor: 'pointer',
                          transition: 'background 0.2s',
                          alignSelf: 'flex-start',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-main)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-card)')}
                      >
                        Применить сетап
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}

