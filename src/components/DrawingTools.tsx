'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IChartApi, ISeriesApi } from 'lightweight-charts';

export type DrawingTool = 'none' | 'rectangle' | 'trendline';

export interface Drawing {
  id: string;
  type: 'rectangle' | 'trendline';
  // Координаты в терминах графика (time, price)
  startTime: number;
  startPrice: number;
  endTime: number;
  endPrice: number;
  // Автопродление вправо вместе с графиком
  autoExtend?: boolean;
}

// Тип хэндла для ресайза
type ResizeHandle = 'start' | 'end' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | null;

interface DrawingToolsProps {
  chartRef: React.RefObject<IChartApi | null>;
  seriesRef: React.RefObject<ISeriesApi<'Candlestick'> | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const DRAWING_COLOR = 'rgba(59, 130, 246, 0.8)'; // Синий
const DRAWING_FILL = 'rgba(59, 130, 246, 0.15)'; // Полупрозрачная заливка
const SELECTED_COLOR = 'rgba(34, 197, 94, 0.9)'; // Зелёный для выбранной
const SELECTED_FILL = 'rgba(34, 197, 94, 0.15)';
const AUTO_EXTEND_COLOR = 'rgba(234, 179, 8, 0.9)'; // Жёлтый для автопродления
const AUTO_EXTEND_FILL = 'rgba(234, 179, 8, 0.15)';
const HANDLE_SIZE = 8;
const HANDLE_HIT_SIZE = 12;

export function useDrawingTools({ chartRef, seriesRef, containerRef }: DrawingToolsProps) {
  const [activeTool, setActiveTool] = useState<DrawingTool>('none');
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentDrawingRef = useRef<Partial<Drawing> | null>(null);
  const drawingsRef = useRef<Drawing[]>([]);
  const resizeHandleRef = useRef<ResizeHandle>(null);
  const resizeStartRef = useRef<{ time: number; price: number } | null>(null);
  const dragStartRef = useRef<{ time: number; price: number; drawing: Drawing } | null>(null);
  
  // Синхронизируем ref с state
  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);

  // Конвертация координат экрана в координаты графика
  const screenToChartCoords = useCallback((x: number, y: number): { time: number; price: number } | null => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return null;

    const timeScale = chart.timeScale();
    const time = timeScale.coordinateToTime(x);
    const price = series.coordinateToPrice(y);
    
    if (time === null || price === null) return null;
    return { time: time as number, price };
  }, [chartRef, seriesRef]);

  // Конвертация координат графика в координаты экрана
  const chartToScreenCoords = useCallback((time: number, price: number): { x: number; y: number } | null => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return null;

    const timeScale = chart.timeScale();
    const x = timeScale.timeToCoordinate(time as any);
    const y = series.priceToCoordinate(price);
    
    if (x === null || y === null) return null;
    return { x, y };
  }, [chartRef, seriesRef]);

  // Получить хэндлы для фигуры
  const getHandles = useCallback((drawing: Drawing): { handle: ResizeHandle; x: number; y: number }[] => {
    const start = chartToScreenCoords(drawing.startTime, drawing.startPrice);
    const end = chartToScreenCoords(drawing.endTime, drawing.endPrice);
    if (!start || !end) return [];

    if (drawing.type === 'trendline') {
      return [
        { handle: 'start', x: start.x, y: start.y },
        { handle: 'end', x: end.x, y: end.y },
      ];
    } else {
      // Прямоугольник - 4 угла
      const minX = Math.min(start.x, end.x);
      const maxX = Math.max(start.x, end.x);
      const minY = Math.min(start.y, end.y);
      const maxY = Math.max(start.y, end.y);
      
      return [
        { handle: 'topLeft', x: minX, y: minY },
        { handle: 'topRight', x: maxX, y: minY },
        { handle: 'bottomLeft', x: minX, y: maxY },
        { handle: 'bottomRight', x: maxX, y: maxY },
      ];
    }
  }, [chartToScreenCoords]);

  // Проверка попадания в хэндл
  const hitTestHandle = useCallback((x: number, y: number, drawing: Drawing): ResizeHandle => {
    const handles = getHandles(drawing);
    for (const h of handles) {
      const dist = Math.sqrt((x - h.x) ** 2 + (y - h.y) ** 2);
      if (dist <= HANDLE_HIT_SIZE) {
        return h.handle;
      }
    }
    return null;
  }, [getHandles]);

  // Отрисовка всех фигур
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Очищаем canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Рисуем все сохранённые фигуры
    for (const drawing of drawingsRef.current) {
      const start = chartToScreenCoords(drawing.startTime, drawing.startPrice);
      const end = chartToScreenCoords(drawing.endTime, drawing.endPrice);
      
      if (!start || !end) continue;

      const isSelected = selectedDrawingId === drawing.id;
      // Цвет зависит только от выбора (автопродление не меняет цвет)
      const color = isSelected ? SELECTED_COLOR : DRAWING_COLOR;
      const fill = isSelected ? SELECTED_FILL : DRAWING_FILL;

      if (drawing.type === 'rectangle') {
        // Прямоугольник с заливкой
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const width = Math.abs(end.x - start.x);
        const height = Math.abs(end.y - start.y);

        ctx.fillStyle = fill;
        ctx.fillRect(x, y, width, height);
        
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
      } else if (drawing.type === 'trendline') {
        // Наклонная линия
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Рисуем хэндлы для выбранной фигуры
      if (isSelected) {
        const handles = getHandles(drawing);
        for (const h of handles) {
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = SELECTED_COLOR;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.rect(h.x - HANDLE_SIZE / 2, h.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // Рисуем текущую фигуру (в процессе рисования)
    const current = currentDrawingRef.current;
    if (current && current.startTime !== undefined && current.endTime !== undefined) {
      const start = chartToScreenCoords(current.startTime, current.startPrice!);
      const end = chartToScreenCoords(current.endTime, current.endPrice!);
      
      if (start && end) {
        // Рисуем фигуру синим (обычный цвет)
        if (current.type === 'rectangle') {
          const x = Math.min(start.x, end.x);
          const y = Math.min(start.y, end.y);
          const width = Math.abs(end.x - start.x);
          const height = Math.abs(end.y - start.y);

          ctx.fillStyle = DRAWING_FILL;
          ctx.fillRect(x, y, width, height);
          
          ctx.strokeStyle = DRAWING_COLOR;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(x, y, width, height);
          ctx.setLineDash([]);
        } else if (current.type === 'trendline') {
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.strokeStyle = DRAWING_COLOR;
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }, [chartToScreenCoords, selectedDrawingId, getHandles]);

  // Проверка попадания точки в фигуру
  const hitTest = useCallback((x: number, y: number): Drawing | null => {
    // Сначала проверяем выбранную фигуру (приоритет)
    if (selectedDrawingId) {
      const selected = drawingsRef.current.find(d => d.id === selectedDrawingId);
      if (selected) {
        const handle = hitTestHandle(x, y, selected);
        if (handle) return selected;
      }
    }

    for (const drawing of drawingsRef.current) {
      const start = chartToScreenCoords(drawing.startTime, drawing.startPrice);
      const end = chartToScreenCoords(drawing.endTime, drawing.endPrice);
      
      if (!start || !end) continue;

      if (drawing.type === 'rectangle') {
        const minX = Math.min(start.x, end.x);
        const maxX = Math.max(start.x, end.x);
        const minY = Math.min(start.y, end.y);
        const maxY = Math.max(start.y, end.y);

        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          return drawing;
        }
      } else if (drawing.type === 'trendline') {
        // Проверка близости к линии
        const dist = distanceToLine(x, y, start.x, start.y, end.x, end.y);
        if (dist < 10) {
          return drawing;
        }
      }
    }
    return null;
  }, [chartToScreenCoords, selectedDrawingId, hitTestHandle]);

  // Расстояние от точки до линии
  const distanceToLine = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    
    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;

    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Удаление фигуры
  const deleteDrawing = useCallback((id: string) => {
    setDrawings(prev => prev.filter(d => d.id !== id));
    if (selectedDrawingId === id) {
      setSelectedDrawingId(null);
    }
  }, [selectedDrawingId]);

  // Очистка всех фигур
  const clearAllDrawings = useCallback(() => {
    setDrawings([]);
    setSelectedDrawingId(null);
  }, []);

  // Обновление фигуры
  const updateDrawing = useCallback((id: string, updates: Partial<Drawing>) => {
    setDrawings(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
  }, []);

  // Автопродление фигур вправо при появлении новых свечей
  const extendDrawings = useCallback((latestTime: number) => {
    setDrawings(prev => {
      const hasAutoExtend = prev.some(d => d.autoExtend);
      if (!hasAutoExtend) return prev;
      
      return prev.map(drawing => {
        if (!drawing.autoExtend) return drawing;
      
      // Для прямоугольника - продлеваем правую границу
      if (drawing.type === 'rectangle') {
        const maxTime = Math.max(drawing.startTime, drawing.endTime);
        if (latestTime > maxTime) {
          // Определяем, какая точка была левой, какая правой
          const isStartLeft = drawing.startTime < drawing.endTime;
          const minTime = Math.min(drawing.startTime, drawing.endTime);
          const maxTimeOld = Math.max(drawing.startTime, drawing.endTime);
          
          // Сохраняем левую границу (время и цены), продлеваем правую только по времени
          // Цены правой границы остаются теми же
          if (isStartLeft) {
            // startTime был левым, endTime был правым
            return {
              ...drawing,
              startTime: minTime,
              startPrice: drawing.startPrice,
              endTime: latestTime,
              // endPrice остаётся прежним
            };
          } else {
            // endTime был левым, startTime был правым
            return {
              ...drawing,
              startTime: latestTime,
              // startPrice остаётся прежним (был правым)
              endTime: minTime,
              endPrice: drawing.endPrice,
            };
          }
        }
      } else if (drawing.type === 'trendline') {
        // Для линии - продлеваем конечную точку по наклону
        const maxTime = Math.max(drawing.startTime, drawing.endTime);
        if (latestTime > maxTime) {
          // Вычисляем наклон линии
          const timeDiff = drawing.endTime - drawing.startTime;
          const priceDiff = drawing.endPrice - drawing.startPrice;
          
          if (timeDiff !== 0) {
            const slope = priceDiff / timeDiff;
            const newPrice = drawing.endPrice + slope * (latestTime - drawing.endTime);
            
            // Определяем, какая точка была конечной
            const isEndRight = drawing.endTime > drawing.startTime;
            if (isEndRight) {
              return {
                ...drawing,
                endTime: latestTime,
                endPrice: newPrice,
              };
            } else {
              // startTime был правым, значит продлеваем его
              return {
                ...drawing,
                startTime: latestTime,
                startPrice: newPrice,
              };
            }
          }
        }
      }
      
      return drawing;
      });
    });
  }, []);

  // Инициализация canvas
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Создаём или находим canvas
    let canvas = container.querySelector('.drawing-canvas') as HTMLCanvasElement;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'drawing-canvas';
      canvas.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10;';
      container.appendChild(canvas);
    }
    canvasRef.current = canvas;

    // Обновляем размер canvas
    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      render();
    };

    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef, render]);

  // Управление pointer-events в зависимости от активного инструмента и выбранной фигуры
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    if (activeTool !== 'none' || selectedDrawingId) {
      // Когда выбран инструмент или фигура - canvas перехватывает события
      canvas.style.pointerEvents = 'auto';
      canvas.style.cursor = activeTool !== 'none' ? 'crosshair' : 'default';
    } else {
      // Когда инструмент не выбран - события проходят к графику
      canvas.style.pointerEvents = 'none';
      canvas.style.cursor = 'default';
    }
  }, [activeTool, selectedDrawingId]);

  // Подписка на изменения графика для перерисовки
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const timeScale = chart.timeScale();
    const unsubscribe = timeScale.subscribeVisibleLogicalRangeChange(() => {
      render();
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [chartRef, render]);

  // Обработчики мыши
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const getMousePos = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // Только левая кнопка

      const pos = getMousePos(e);
      const coords = screenToChartCoords(pos.x, pos.y);
      if (!coords) return;

      // Проверяем хэндлы выбранной фигуры
      if (selectedDrawingId) {
        const selected = drawingsRef.current.find(d => d.id === selectedDrawingId);
        if (selected) {
          const handle = hitTestHandle(pos.x, pos.y, selected);
          if (handle) {
            e.preventDefault();
            e.stopPropagation();
            setIsResizing(true);
            resizeHandleRef.current = handle;
            resizeStartRef.current = coords;
            return;
          }
          
          // Проверяем клик внутри выбранной фигуры для перемещения
          const start = chartToScreenCoords(selected.startTime, selected.startPrice);
          const end = chartToScreenCoords(selected.endTime, selected.endPrice);
          if (start && end) {
            let isInsideSelected = false;
            if (selected.type === 'rectangle') {
              const minX = Math.min(start.x, end.x);
              const maxX = Math.max(start.x, end.x);
              const minY = Math.min(start.y, end.y);
              const maxY = Math.max(start.y, end.y);
              isInsideSelected = pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY;
            } else {
              const dist = distanceToLine(pos.x, pos.y, start.x, start.y, end.x, end.y);
              isInsideSelected = dist < 10;
            }
            
            if (isInsideSelected) {
              e.preventDefault();
              e.stopPropagation();
              setIsDragging(true);
              dragStartRef.current = { time: coords.time, price: coords.price, drawing: { ...selected } };
              return;
            }
          }
        }
      }

      // Проверяем клик по фигуре (выбор)
      if (activeTool === 'none') {
        const hit = hitTest(pos.x, pos.y);
        if (hit) {
          e.preventDefault();
          e.stopPropagation();
          setSelectedDrawingId(hit.id);
          render();
          return;
        } else {
          // Клик в пустое место - снимаем выбор
          if (selectedDrawingId) {
            setSelectedDrawingId(null);
            render();
          }
          return;
        }
      }

      // Рисование новой фигуры
      e.preventDefault();
      e.stopPropagation();
      
      setIsDrawing(true);
      setSelectedDrawingId(null);
      currentDrawingRef.current = {
        type: activeTool as 'rectangle' | 'trendline',
        startTime: coords.time,
        startPrice: coords.price,
        endTime: coords.time,
        endPrice: coords.price,
      };
      render();
    };

    const handleMouseMove = (e: MouseEvent) => {
      const pos = getMousePos(e);
      const coords = screenToChartCoords(pos.x, pos.y);
      
      // Перемещение фигуры
      if (isDragging && selectedDrawingId && coords && dragStartRef.current) {
        e.preventDefault();
        e.stopPropagation();
        
        const { time: startTime, price: startPrice, drawing: originalDrawing } = dragStartRef.current;
        const deltaTime = coords.time - startTime;
        const deltaPrice = coords.price - startPrice;
        
        updateDrawing(selectedDrawingId, {
          startTime: originalDrawing.startTime + deltaTime,
          startPrice: originalDrawing.startPrice + deltaPrice,
          endTime: originalDrawing.endTime + deltaTime,
          endPrice: originalDrawing.endPrice + deltaPrice,
        });
        render();
        return;
      }
      
      // Ресайз фигуры
      if (isResizing && selectedDrawingId && coords && resizeHandleRef.current) {
        e.preventDefault();
        e.stopPropagation();
        
        const drawing = drawingsRef.current.find(d => d.id === selectedDrawingId);
        if (!drawing) return;

        const handle = resizeHandleRef.current;
        
        
        if (drawing.type === 'trendline') {
          if (handle === 'start') {
            updateDrawing(selectedDrawingId, { startTime: coords.time, startPrice: coords.price });
          } else if (handle === 'end') {
            updateDrawing(selectedDrawingId, { endTime: coords.time, endPrice: coords.price });
          }
        } else {
          // Прямоугольник
          const start = { time: drawing.startTime, price: drawing.startPrice };
          const end = { time: drawing.endTime, price: drawing.endPrice };
          
          // Определяем какие углы min/max
          const minTime = Math.min(start.time, end.time);
          const maxTime = Math.max(start.time, end.time);
          const minPrice = Math.min(start.price, end.price);
          const maxPrice = Math.max(start.price, end.price);
          
          let newStartTime = minTime;
          let newEndTime = maxTime;
          let newStartPrice = maxPrice; // В графике Y инвертирована
          let newEndPrice = minPrice;
          
          switch (handle) {
            case 'topLeft':
              newStartTime = coords.time;
              newStartPrice = coords.price;
              break;
            case 'topRight':
              newEndTime = coords.time;
              newStartPrice = coords.price;
              break;
            case 'bottomLeft':
              newStartTime = coords.time;
              newEndPrice = coords.price;
              break;
            case 'bottomRight':
              newEndTime = coords.time;
              newEndPrice = coords.price;
              break;
          }
          
          updateDrawing(selectedDrawingId, {
            startTime: newStartTime,
            startPrice: newStartPrice,
            endTime: newEndTime,
            endPrice: newEndPrice,
          });
        }
        render();
        return;
      }
      
      // Рисование новой фигуры
      if (isDrawing && currentDrawingRef.current && coords) {
        e.preventDefault();
        e.stopPropagation();
        
        currentDrawingRef.current.endTime = coords.time;
        currentDrawingRef.current.endPrice = coords.price;
        
        
        render();
        return;
      }
      
      // Обновление курсора при наведении на хэндлы или выбранную фигуру
      if (selectedDrawingId && activeTool === 'none') {
        const selected = drawingsRef.current.find(d => d.id === selectedDrawingId);
        if (selected) {
          const handle = hitTestHandle(pos.x, pos.y, selected);
          if (handle) {
            canvas.style.cursor = selected.type === 'trendline' ? 'grab' : 'nwse-resize';
            return;
          }
          
          // Проверяем наведение внутри выбранной фигуры для перемещения
          const start = chartToScreenCoords(selected.startTime, selected.startPrice);
          const end = chartToScreenCoords(selected.endTime, selected.endPrice);
          if (start && end) {
            let isInsideSelected = false;
            if (selected.type === 'rectangle') {
              const minX = Math.min(start.x, end.x);
              const maxX = Math.max(start.x, end.x);
              const minY = Math.min(start.y, end.y);
              const maxY = Math.max(start.y, end.y);
              isInsideSelected = pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY;
            } else {
              const dist = distanceToLine(pos.x, pos.y, start.x, start.y, end.x, end.y);
              isInsideSelected = dist < 10;
            }
            
            if (isInsideSelected) {
              canvas.style.cursor = 'move';
              return;
            }
          }
        }
      }
      
      // Проверяем наведение на фигуры
      if (activeTool === 'none') {
        const hit = hitTest(pos.x, pos.y);
        if (hit) {
          canvas.style.pointerEvents = 'auto';
          canvas.style.cursor = 'pointer';
        } else if (!selectedDrawingId) {
          canvas.style.pointerEvents = 'none';
          canvas.style.cursor = 'default';
        } else {
          canvas.style.cursor = 'default';
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      // Завершение перемещения
      if (isDragging) {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        dragStartRef.current = null;
        render();
        return;
      }
      
      // Завершение ресайза
      if (isResizing) {
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(false);
        resizeHandleRef.current = null;
        resizeStartRef.current = null;
        render();
        return;
      }
      
      // Завершение рисования
      if (!isDrawing || !currentDrawingRef.current) return;

      e.preventDefault();
      e.stopPropagation();

      const pos = getMousePos(e);
      const coords = screenToChartCoords(pos.x, pos.y);
      
      if (coords) {
        const current = currentDrawingRef.current;
        // Проверяем минимальный размер
        const dx = Math.abs((current.endTime || 0) - (current.startTime || 0));
        const dy = Math.abs((current.endPrice || 0) - (current.startPrice || 0));
        
        if (dx > 0 || dy > 0) {
          const newDrawing: Drawing = {
            id: `drawing-${Date.now()}`,
            type: current.type!,
            startTime: current.startTime!,
            startPrice: current.startPrice!,
            endTime: coords.time,
            endPrice: coords.price,
          };
          setDrawings(prev => [...prev, newDrawing]);
          // Автоматически выбираем новую фигуру
          setSelectedDrawingId(newDrawing.id);
          // Сбрасываем инструмент после рисования
          setActiveTool('none');
        }
      }

      currentDrawingRef.current = null;
      setIsDrawing(false);
      render();
    };

    const handleDoubleClick = (e: MouseEvent) => {
      if (e.button !== 0) return; // Только левая кнопка
      
      const pos = getMousePos(e);
      const hit = hitTest(pos.x, pos.y);
      
      if (hit && selectedDrawingId === hit.id) {
        e.preventDefault();
        e.stopPropagation();
        
        // Переключаем автопродление при двойном клике
        updateDrawing(hit.id, { autoExtend: !hit.autoExtend });
        render();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Игнорируем если фокус в input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedDrawingId) {
          e.preventDefault();
          deleteDrawing(selectedDrawingId);
        }
      }
      if (e.key === 'Escape') {
        if (selectedDrawingId) {
          setSelectedDrawingId(null);
        }
        setActiveTool('none');
        currentDrawingRef.current = null;
        setIsDrawing(false);
        setIsResizing(false);
        setIsDragging(false);
        dragStartRef.current = null;
        render();
      }
      // Горячие клавиши для инструментов
      if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') {
        setActiveTool(activeTool === 'rectangle' ? 'none' : 'rectangle');
        setSelectedDrawingId(null);
      }
      if (e.key === 't' || e.key === 'T' || e.key === 'е' || e.key === 'Е') {
        setActiveTool(activeTool === 'trendline' ? 'none' : 'trendline');
        setSelectedDrawingId(null);
      }
    };

    // Добавляем обработчики на canvas для перехвата событий при рисовании
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('dblclick', handleDoubleClick);
    // Также слушаем на document для mousemove/mouseup чтобы не терять события за пределами canvas
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('dblclick', handleDoubleClick);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeTool, isDrawing, isResizing, isDragging, selectedDrawingId, screenToChartCoords, chartToScreenCoords, hitTest, hitTestHandle, deleteDrawing, updateDrawing, render]);

  // Принудительная перерисовка при изменении фигур
  useEffect(() => {
    render();
  }, [drawings, render]);
  
  // Принудительная перерисовка при изменении выбранной фигуры (для обновления цвета автопродления)
  useEffect(() => {
    render();
  }, [selectedDrawingId, render]);

  return {
    activeTool,
    setActiveTool,
    drawings,
    clearAllDrawings,
    isDrawing,
    selectedDrawingId,
    setSelectedDrawingId,
    extendDrawings, // Функция для автопродления фигур
  };
}

// Компонент панели инструментов
interface DrawingToolbarProps {
  activeTool: DrawingTool;
  setActiveTool: (tool: DrawingTool) => void;
  onClear: () => void;
  hasDrawings: boolean;
}

export function DrawingToolbar({ activeTool, setActiveTool, onClear, hasDrawings }: DrawingToolbarProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: '8px',
        left: '8px',
        display: 'flex',
        gap: '4px',
        zIndex: 20,
        background: 'rgba(13, 17, 23, 0.9)',
        padding: '4px',
        borderRadius: '6px',
        border: '1px solid var(--border)',
      }}
    >
      {/* Прямоугольник */}
      <button
        onClick={() => setActiveTool(activeTool === 'rectangle' ? 'none' : 'rectangle')}
        title="Прямоугольник (R)"
        style={{
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: activeTool === 'rectangle' ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
          border: activeTool === 'rectangle' ? '1px solid rgba(59, 130, 246, 0.6)' : '1px solid transparent',
          borderRadius: '4px',
          cursor: 'pointer',
          color: activeTool === 'rectangle' ? '#3b82f6' : '#9ca3af',
          transition: 'all 0.15s',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
      </button>

      {/* Наклонная линия */}
      <button
        onClick={() => setActiveTool(activeTool === 'trendline' ? 'none' : 'trendline')}
        title="Линия тренда (T)"
        style={{
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: activeTool === 'trendline' ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
          border: activeTool === 'trendline' ? '1px solid rgba(59, 130, 246, 0.6)' : '1px solid transparent',
          borderRadius: '4px',
          cursor: 'pointer',
          color: activeTool === 'trendline' ? '#3b82f6' : '#9ca3af',
          transition: 'all 0.15s',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="4" y1="20" x2="20" y2="4" />
        </svg>
      </button>

      {/* Разделитель */}
      <div style={{ width: '1px', background: 'var(--border)', margin: '4px 2px' }} />

      {/* Очистить все */}
      <button
        onClick={onClear}
        disabled={!hasDrawings}
        title="Удалить все"
        style={{
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: '4px',
          cursor: hasDrawings ? 'pointer' : 'not-allowed',
          color: hasDrawings ? '#ef4444' : '#4b5563',
          opacity: hasDrawings ? 1 : 0.5,
          transition: 'all 0.15s',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        </svg>
      </button>
    </div>
  );
}
