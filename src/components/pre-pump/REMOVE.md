# Удаление Pre-Pump модуля

Если инструмент не понадобится:

1. Удалить папку `src/components/pre-pump/`
2. Удалить `src/store/usePrePumpStore.ts`
3. В `app/page.tsx` — убрать импорты `PrePumpSidebar`, `PrePumpNotifier` и их использование
4. В `src/components/Header.tsx` — убрать кнопку Pre-Pump, `usePrePumpStore`, `prePumpIdealCount`
5. В `src/store/useTradingStore.ts` — убрать `showPrePumpSidebar`, `setShowPrePumpSidebar`, `togglePrePumpSidebar`
6. В `src/lib/screenerApi.ts` — убрать `fetchPrePumpFromApi` и типы `PrePumpSignalApi`, `PrePumpApiResponse`
7. В `python/` — убрать `pre_pump_screener.py`, в `api_server.py` убрать импорт и endpoint
