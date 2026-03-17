'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { DensityMap, DensitySettings } from '@/components/density-map';
import { useDensityMapStore } from '@/store/useDensityMapStore';
import { scanDensities } from '@/lib/densityScanner';

export default function DensityMapPage() {
  const {
    zoom,
    zoomIn,
    zoomOut,
    setZoom,
    settings,
    settingsOpen,
    toggleSettings,
    setSettingsOpen,
    isScanning,
    lastUpdate,
    densities,
    setDensities,
    setIsScanning,
    setError,
  } = useDensityMapStore();
  
  // Ручное обновление
  const handleRefresh = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setError(null);
    
    try {
      const result = await scanDensities(settings);
      setDensities(result.densities);
    } catch (error) {
      setError('Ошибка сканирования');
    } finally {
      setIsScanning(false);
    }
  }, [settings, isScanning, setDensities, setIsScanning, setError]);
  
  const formatLastUpdate = () => {
    if (!lastUpdate) return 'Никогда';
    const diff = Math.floor((Date.now() - lastUpdate) / 1000);
    if (diff < 60) return `${diff} сек назад`;
    return `${Math.floor(diff / 60)} мин назад`;
  };
  
  return (
    <div className="density-map-page" style={{ background: 'var(--bg-main)' }}>
      {/* Хедер */}
      <header
        className="density-map-header"
        style={{
          background: 'var(--bg-card)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="density-map-header-left">
          {/* Навигация назад */}
          <Link
            href="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-main)',
              textDecoration: 'none',
              fontSize: '0.8rem',
              transition: 'all 0.2s',
            }}
          >
            ← Скринер
          </Link>
          
          {/* Заголовок */}
          <div
            style={{
              fontSize: '1.2rem',
              fontWeight: 700,
              background: 'linear-gradient(135deg, #22c55e, #3b82f6)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Карта плотностей
          </div>
          
          {/* Статус */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 10px',
              background: 'var(--bg-elevated)',
              borderRadius: 20,
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: settings.autoUpdate ? '#22c55e' : '#6b7280',
                boxShadow: settings.autoUpdate ? '0 0 6px #22c55e' : 'none',
              }}
            />
            {settings.autoUpdate ? 'Авто' : 'Вручную'} • {formatLastUpdate()}
          </div>
        </div>
        
        <div className="density-map-header-right">
          {/* Zoom контролы */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px',
              background: 'var(--bg-elevated)',
              borderRadius: 8,
              border: '1px solid var(--border)',
            }}
          >
            <button
              onClick={zoomOut}
              disabled={zoom <= 0.5}
              style={{
                padding: '6px 10px',
                background: 'transparent',
                border: 'none',
                color: zoom <= 0.5 ? 'var(--text-muted)' : 'var(--text-main)',
                cursor: zoom <= 0.5 ? 'not-allowed' : 'pointer',
                fontSize: '1rem',
                borderRadius: 4,
              }}
            >
              −
            </button>
            <span
              style={{
                padding: '0 8px',
                fontSize: '0.8rem',
                color: 'var(--text-main)',
                minWidth: 50,
                textAlign: 'center',
              }}
            >
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={zoomIn}
              disabled={zoom >= 2}
              style={{
                padding: '6px 10px',
                background: 'transparent',
                border: 'none',
                color: zoom >= 2 ? 'var(--text-muted)' : 'var(--text-main)',
                cursor: zoom >= 2 ? 'not-allowed' : 'pointer',
                fontSize: '1rem',
                borderRadius: 4,
              }}
            >
              +
            </button>
          </div>
          
          {/* Кнопка обновления */}
          <button
            onClick={handleRefresh}
            disabled={isScanning}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-main)',
              cursor: isScanning ? 'not-allowed' : 'pointer',
              fontSize: '0.8rem',
              opacity: isScanning ? 0.6 : 1,
            }}
          >
            <span style={{ 
              display: 'inline-block',
              animation: isScanning ? 'spin 1s linear infinite' : 'none',
            }}>
              🔄
            </span>
            Обновить
          </button>
          
          {/* Кнопка настроек */}
          <button
            onClick={toggleSettings}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              background: settingsOpen ? 'var(--accent)' : 'var(--bg-elevated)',
              border: '1px solid',
              borderColor: settingsOpen ? 'var(--accent)' : 'var(--border)',
              borderRadius: 6,
              color: settingsOpen ? 'white' : 'var(--text-main)',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: settingsOpen ? 600 : 400,
            }}
          >
            ⚙️ Настройки
          </button>
        </div>
      </header>
      
      {/* Основной контент */}
      <main className="density-map-main">
        {/* Карта плотностей */}
        <div className="density-map-canvas-wrap">
          <DensityMap />
        </div>
        
        {/* Боковая панель с информацией */}
        <div className="density-map-sidebar">
          {/* Легенда */}
          <div>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: 12 }}>
              Легенда
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#22c55e' }} />
                <span style={{ color: 'var(--text-muted)' }}>Лонговая плотность (Buy)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#ef4444' }} />
                <span style={{ color: 'var(--text-muted)' }}>Шортовая плотность (Sell)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ 
                  width: 16, height: 16, borderRadius: '50%', 
                  background: 'rgba(139, 92, 246, 0.8)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.6rem', color: 'white'
                }}>
                  ⏱
                </div>
                <span style={{ color: 'var(--text-muted)' }}>Время разъедания</span>
              </div>
            </div>
          </div>
          
          {/* Зоны */}
          <div>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: 12 }}>
              Зоны дистанции
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ 
                  width: 16, height: 16, borderRadius: '50%', 
                  background: 'rgba(30, 41, 59, 0.8)',
                  border: '2px solid rgba(75, 85, 99, 0.5)'
                }} />
                <span style={{ color: 'var(--text-muted)' }}>Центр: до 1% от цены</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ 
                  width: 16, height: 16, borderRadius: '50%', 
                  border: '2px solid rgba(75, 85, 99, 0.4)'
                }} />
                <span style={{ color: 'var(--text-muted)' }}>Среднее: 1-3% от цены</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ 
                  width: 16, height: 16, borderRadius: '50%', 
                  border: '2px dashed rgba(75, 85, 99, 0.3)'
                }} />
                <span style={{ color: 'var(--text-muted)' }}>Внешнее: 3%+ от цены</span>
              </div>
            </div>
          </div>
          
          {/* Размеры */}
          <div>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: 12 }}>
              Размер круга
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>Малый: {'<'}1 мин разъедания</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>Средний: 1-3 мин</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>Большой: 3-10 мин</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>Огромный: {'>'}10 мин</span>
              </div>
            </div>
          </div>
          
          {/* Инструкция */}
          <div style={{ marginTop: 'auto', paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: 12 }}>
              Как использовать
            </h3>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              <p style={{ marginBottom: 8 }}>
                <strong>1.</strong> Наведите на круг для просмотра мини-графика и деталей плотности.
              </p>
              <p style={{ marginBottom: 8 }}>
                <strong>2.</strong> Кликните на круг, чтобы открыть монету в скринере.
              </p>
              <p style={{ marginBottom: 8 }}>
                <strong>3.</strong> Большие круги = значимые плотности (долгое время разъедания).
              </p>
              <p>
                <strong>4.</strong> Используйте фильтры в настройках для фокуса на интересующих плотностях.
              </p>
            </div>
          </div>
        </div>
      </main>
      
      {/* Модальное окно настроек */}
      {settingsOpen && (
        <DensitySettings onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
