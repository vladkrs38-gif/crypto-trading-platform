'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useDensityMapStore } from '@/store/useDensityMapStore';
import { getDensityZone } from '@/lib/densityScanner';
import { checkApiHealth, fetchDensitiesFromApi } from '@/lib/densityApi';
import type { Density } from '@/types/density';
import DensityCircle from './DensityCircle';
import MiniChart from './MiniChart';

export default function DensityMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 800 });
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const [pinnedDensity, setPinnedDensity] = useState<Density | null>(null);
  const [pinnedPosition, setPinnedPosition] = useState<{ x: number; y: number } | null>(null);
  const [isChartHovered, setIsChartHovered] = useState(false);
  const [apiConnected, setApiConnected] = useState<boolean | null>(null);
  const [trackedCoins, setTrackedCoins] = useState(0);
  
  const {
    densities,
    isScanning,
    settings,
    zoom,
    hoveredDensity,
    setDensities,
    setIsScanning,
    setHoveredDensity,
    setError,
    getFilteredDensities,
    getOppositeDensity,
  } = useDensityMapStore();
  
  const filteredDensities = useMemo(() => getFilteredDensities(), [densities, settings]);
  
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const size = Math.min(rect.width, rect.height);
        setDimensions({ width: size, height: size });
      }
    };
    
    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);
  
  // Проверяем доступность Python API при монтировании
  useEffect(() => {
    const checkApi = async () => {
      const isAvailable = await checkApiHealth();
      setApiConnected(isAvailable);
      if (!isAvailable) {
        setError('Python Tracker не запущен. Запустите start_tracker.bat');
      }
      console.log(`[DensityMap] Python Tracker API: ${isAvailable ? 'CONNECTED' : 'NOT AVAILABLE'}`);
    };
    checkApi();
  }, [setError]);
  
  const performScan = useCallback(async () => {
    if (isScanning || !apiConnected) return;
    
    setIsScanning(true);
    setError(null);
    
    try {
      // Используем Python API
      const result = await fetchDensitiesFromApi({
        minLifetime: settings.minLifetimeMinutes * 60,
        minAmount: settings.minDensityUSD,
        maxDistance: settings.maxDistancePercent,
        limit: 500, // Запрашиваем много, фронтенд отфильтрует по blacklist
      });
      setDensities(result.densities);
      setTrackedCoins(result.trackedCoins);
      setApiConnected(true);
    } catch (error) {
      setApiConnected(false);
      setError('Ошибка подключения к Python Tracker');
      console.error('[DensityMap] API error:', error);
    } finally {
      setIsScanning(false);
    }
  }, [settings, isScanning, apiConnected, setDensities, setIsScanning, setError]);
  
  useEffect(() => {
    if (apiConnected) {
      performScan();
    }
  }, [apiConnected]);
  
  // Перезапрашиваем при изменении фильтров
  useEffect(() => {
    if (apiConnected && !isScanning) {
      performScan();
    }
  }, [settings.minLifetimeMinutes, settings.minDensityUSD, settings.maxDistancePercent]);
  
  useEffect(() => {
    if (!settings.autoUpdate || !apiConnected) return;
    
    const interval = setInterval(performScan, settings.updateInterval * 1000);
    return () => clearInterval(interval);
  }, [settings.autoUpdate, settings.updateInterval, apiConnected, performScan]);
  
  const circlePositions = useMemo(() => {
    const centerX = dimensions.width / 2;
    const centerY = dimensions.height / 2;
    const maxRadius = Math.min(dimensions.width, dimensions.height) / 2 - 80;
    
    const zones: Record<string, Density[]> = {
      inner: [],
      middle: [],
      outer: [],
    };
    
    for (const density of filteredDensities) {
      const zone = getDensityZone(density.distancePercent);
      zones[zone].push(density);
    }
    
    const positions: { density: Density; x: number; y: number }[] = [];
    
    const innerRadius = maxRadius * 0.65;  // Зона 1% - самая большая
    const middleRadius = maxRadius * 0.82;  // Зона 1-3%
    const outerRadius = maxRadius * 0.95;
    
    const distributeInZone = (
      items: Density[], 
      radiusMin: number, 
      radiusMax: number,
      startAngle: number = 0
    ) => {
      if (items.length === 0) return;
      
      const sorted = [...items].sort((a, b) => b.dissolutionTime - a.dissolutionTime);
      const angleStep = (Math.PI * 2) / Math.max(sorted.length, 1);
      
      sorted.forEach((density, index) => {
        const radiusJitter = (Math.random() - 0.5) * (radiusMax - radiusMin) * 0.5;
        const radius = (radiusMin + radiusMax) / 2 + radiusJitter;
        const angleJitter = (Math.random() - 0.5) * angleStep * 0.3;
        const angle = startAngle + index * angleStep + angleJitter - Math.PI / 2;
        
        const x = centerX + radius * Math.cos(angle);
        const y = centerY + radius * Math.sin(angle);
        
        positions.push({ density, x, y });
      });
    };
    
    distributeInZone(zones.inner, 0, innerRadius);
    distributeInZone(zones.middle, innerRadius + 20, middleRadius);
    distributeInZone(zones.outer, middleRadius + 20, outerRadius);
    
    return positions;
  }, [filteredDensities, dimensions]);
  
  const handleHover = useCallback((density: Density | null, position: { x: number; y: number } | null) => {
    // Не меняем если график закреплён или наведён на график
    if (pinnedDensity || isChartHovered) return;
    
    setHoveredDensity(density);
    setTooltipPosition(position);
  }, [setHoveredDensity, pinnedDensity, isChartHovered]);
  
  const handleCircleClick = useCallback((density: Density) => {
    // При клике на круг - закрепляем график
    const position = circlePositions.find(p => p.density.id === density.id);
    if (position) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setPinnedDensity(density);
        setPinnedPosition({
          x: rect.left + position.x * zoom + 60,
          y: rect.top + position.y * zoom,
        });
        setHoveredDensity(null);
        setTooltipPosition(null);
      }
    }
  }, [circlePositions, zoom, setHoveredDensity]);
  
  const handleCloseChart = useCallback(() => {
    setPinnedDensity(null);
    setPinnedPosition(null);
    setIsChartHovered(false);
  }, []);
  
  const handleChartMouseEnter = useCallback(() => {
    setIsChartHovered(true);
  }, []);
  
  const handleChartMouseLeave = useCallback(() => {
    setIsChartHovered(false);
    // Если график не закреплён - закрываем при уходе
    if (!pinnedDensity) {
      setHoveredDensity(null);
      setTooltipPosition(null);
    }
  }, [pinnedDensity, setHoveredDensity]);
  
  const handleOpenInScreener = useCallback((density: Density) => {
    window.open(`/?symbol=${density.symbol}`, '_blank');
  }, []);
  
  const centerX = dimensions.width / 2;
  const centerY = dimensions.height / 2;
  const maxRadius = Math.min(dimensions.width, dimensions.height) / 2 - 80;
  
  // Определяем какую плотность показывать в графике
  const activeDensity = pinnedDensity || hoveredDensity;
  const activePosition = pinnedDensity ? pinnedPosition : tooltipPosition;
  
  // Мемоизируем противоположную плотность чтобы избежать лишних ререндеров
  const oppositeDensity = useMemo(() => {
    if (!activeDensity) return null;
    return getOppositeDensity(activeDensity);
  }, [activeDensity?.id, densities]);
  
  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 600,
        background: 'var(--bg-main)',
        overflow: 'hidden',
      }}
    >
      <svg
        width={dimensions.width}
        height={dimensions.height}
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) scale(${zoom})`,
        }}
      >
        <circle
          cx={centerX}
          cy={centerY}
          r={maxRadius}
          fill="none"
          stroke="rgba(75, 85, 99, 0.3)"
          strokeWidth="1"
          strokeDasharray="5,5"
        />
        
        {settings.maxDistancePercent > 3 && (
          <circle
            cx={centerX}
            cy={centerY}
            r={maxRadius * 0.85}
            fill="none"
            stroke="rgba(75, 85, 99, 0.4)"
            strokeWidth="1"
          />
        )}
        
        <circle
          cx={centerX}
          cy={centerY}
          r={maxRadius * 0.7}
          fill="rgba(30, 41, 59, 0.5)"
          stroke="rgba(75, 85, 99, 0.5)"
          strokeWidth="2"
        />
        
        <text
          x={centerX}
          y={centerY - maxRadius * 0.7 - 10}
          textAnchor="middle"
          fill="rgba(156, 163, 175, 0.6)"
          fontSize="12"
          fontFamily="JetBrains Mono"
        >
          1%
        </text>
        {settings.maxDistancePercent > 3 && (
          <text
            x={centerX}
            y={centerY - maxRadius * 0.85 - 10}
            textAnchor="middle"
            fill="rgba(156, 163, 175, 0.6)"
            fontSize="12"
            fontFamily="JetBrains Mono"
          >
            3%
          </text>
        )}
        <text
          x={centerX}
          y={centerY - maxRadius - 10}
          textAnchor="middle"
          fill="rgba(156, 163, 175, 0.5)"
          fontSize="12"
          fontFamily="JetBrains Mono"
        >
          {settings.maxDistancePercent}%
        </text>
        
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
          const rad = (angle * Math.PI) / 180;
          return (
            <line
              key={angle}
              x1={centerX}
              y1={centerY}
              x2={centerX + maxRadius * Math.cos(rad)}
              y2={centerY + maxRadius * Math.sin(rad)}
              stroke="rgba(75, 85, 99, 0.15)"
              strokeWidth="1"
            />
          );
        })}
        
        <circle
          cx={centerX}
          cy={centerY}
          r={5}
          fill="#3b82f6"
        />
      </svg>
      
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: dimensions.width,
          height: dimensions.height,
          transform: `translate(-50%, -50%) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      >
        {circlePositions.map(({ density, x, y }) => (
          <DensityCircle
            key={density.id}
            density={density}
            x={x}
            y={y}
            zoom={1}
            showDistance={settings.showDistance}
            showExchange={settings.showExchange}
            onHover={handleHover}
            onClick={handleCircleClick}
          />
        ))}
      </div>
      
      {/* Статус справа вверху */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* Индикатор подключения */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            background: apiConnected ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
            borderRadius: 6,
            border: `1px solid ${apiConnected ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)'}`,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: apiConnected ? '#22c55e' : '#ef4444',
            }}
          />
          <span style={{ fontSize: '0.7rem', color: apiConnected ? '#22c55e' : '#ef4444', fontWeight: 500 }}>
            {apiConnected === null ? 'Подключение...' : apiConnected ? 'Tracker API' : 'Нет подключения'}
          </span>
        </div>
        
        {/* Обновление */}
        {isScanning && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              background: 'rgba(30, 41, 59, 0.9)',
              borderRadius: 8,
              border: '1px solid var(--border)',
            }}
          >
            <div className="loading-spinner" />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Обновление...
            </span>
          </div>
        )}
      </div>
      
      <div
        style={{
          position: 'absolute',
          bottom: 20,
          left: 20,
          display: 'flex',
          gap: 16,
          padding: '8px 12px',
          background: 'rgba(30, 41, 59, 0.9)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          fontSize: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <span style={{ color: 'var(--text-muted)' }}>Плотностей: </span>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
            {filteredDensities.length}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
            <span style={{ color: 'var(--text-muted)' }}>Buy: </span>
            <span style={{ color: '#22c55e', fontWeight: 600 }}>
              {filteredDensities.filter(d => d.type === 'buy').length}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
            <span style={{ color: 'var(--text-muted)' }}>Sell: </span>
            <span style={{ color: '#ef4444', fontWeight: 600 }}>
              {filteredDensities.filter(d => d.type === 'sell').length}
            </span>
          </div>
        </div>
        {trackedCoins > 0 && (
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Монет: </span>
            <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>
              {trackedCoins}
            </span>
          </div>
        )}
        {apiConnected && settings.minLifetimeMinutes > 0 && (
          <div style={{ color: '#22c55e', fontSize: '0.7rem' }}>
            ✓ Мин. {settings.minLifetimeMinutes >= 60 
              ? `${Math.floor(settings.minLifetimeMinutes / 60)}ч` 
              : `${settings.minLifetimeMinutes}м`} жизни
          </div>
        )}
      </div>
      
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '12px',
          background: 'rgba(30, 41, 59, 0.9)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          fontSize: '0.7rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ 
            width: 12, height: 12, borderRadius: '50%', 
            border: '2px solid var(--text-muted)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.5rem', color: 'var(--text-muted)'
          }}>
            ?
          </div>
          <span style={{ color: 'var(--text-muted)' }}>– Время разъедания</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ 
            width: 12, height: 12, borderRadius: '50%', 
            background: '#22c55e'
          }} />
          <span style={{ color: 'var(--text-muted)' }}>– Лонговая плотность</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ 
            width: 12, height: 12, borderRadius: '50%', 
            background: '#ef4444'
          }} />
          <span style={{ color: 'var(--text-muted)' }}>– Шортовая плотность</span>
        </div>
        <div style={{ 
          marginTop: 4, 
          paddingTop: 8, 
          borderTop: '1px solid var(--border)',
          color: 'var(--text-muted)',
          fontSize: '0.65rem',
        }}>
          Клик на плотность — закрепить график
        </div>
      </div>
      
      {activeDensity && activePosition && (
        <MiniChart
          density={activeDensity}
          oppositeDensity={oppositeDensity}
          position={activePosition}
          timeframe={settings.chartTimeframe}
          bars={settings.chartBars}
          isPinned={!!pinnedDensity}
          onClose={handleCloseChart}
          onMouseEnter={handleChartMouseEnter}
          onMouseLeave={handleChartMouseLeave}
          onOpenInScreener={handleOpenInScreener}
        />
      )}
    </div>
  );
}
