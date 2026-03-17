'use client';

import { useState, useEffect } from 'react';
import { useDensityMapStore } from '@/store/useDensityMapStore';

const API_URL = process.env.NEXT_PUBLIC_DENSITY_API ?? 'http://127.0.0.1:8765';

interface DensitySettingsProps {
  onClose: () => void;
}

// Дефолтные значения для telegram (на случай миграции)
const defaultTelegram = {
  enabled: false,
  botToken: '',
  chatId: '',
  alertDistancePercent: 0.5,
  cooldownMinutes: 5,
};

export default function DensitySettings({ onClose }: DensitySettingsProps) {
  const { settings, updateSettings, resetSettings, addToBlacklist, removeFromBlacklist } = useDensityMapStore();
  const [newBlacklistItem, setNewBlacklistItem] = useState('');
  const [telegramTestStatus, setTelegramTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [telegramTestMessage, setTelegramTestMessage] = useState('');
  
  // Защита от undefined telegram (миграция старых настроек)
  const telegram = settings.telegram || defaultTelegram;
  
  // Синхронизация настроек Telegram с сервером при изменении
  const syncTelegramSettings = async () => {
    if (!telegram.botToken || !telegram.chatId) return;
    
    try {
      await fetch(`${API_URL}/api/telegram/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: telegram.enabled,
          botToken: telegram.botToken,
          chatId: telegram.chatId,
          alertDistancePercent: telegram.alertDistancePercent,
          cooldownMinutes: telegram.cooldownMinutes,
        }),
      });
    } catch (e) {
      console.error('Failed to sync telegram settings:', e);
    }
  };
  
  // Синхронизировать при изменении настроек Telegram
  useEffect(() => {
    const timeout = setTimeout(syncTelegramSettings, 500);
    return () => clearTimeout(timeout);
  }, [telegram]);
  
  const handleTestTelegram = async () => {
    setTelegramTestStatus('loading');
    setTelegramTestMessage('');
    
    try {
      // Пробуем сначала через Python сервер
      let success = false;
      
      try {
        // Сначала сохраняем настройки
        await fetch(`${API_URL}/api/telegram/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            enabled: telegram.enabled,
            botToken: telegram.botToken,
            chatId: telegram.chatId,
            alertDistancePercent: telegram.alertDistancePercent,
            cooldownMinutes: telegram.cooldownMinutes,
          }),
        });
        
        // Затем отправляем тест
        const resp = await fetch(`${API_URL}/api/telegram/test`, { method: 'POST' });
        const data = await resp.json();
        
        if (data.success) {
          setTelegramTestStatus('success');
          setTelegramTestMessage(data.message || 'Сообщение отправлено!');
          success = true;
        }
      } catch {
        // Python сервер недоступен, пробуем напрямую
      }
      
      // Если сервер недоступен - отправляем напрямую через Telegram API
      if (!success) {
        const message = `✅ Тестовое сообщение от Density Tracker!

Уведомления настроены правильно.
Вы будете получать алерты при приближении цены к плотностям.`;
        
        const telegramUrl = `https://api.telegram.org/bot${telegram.botToken}/sendMessage`;
        const resp = await fetch(telegramUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegram.chatId,
            text: message,
          }),
        });
        
        const data = await resp.json();
        
        if (data.ok) {
          setTelegramTestStatus('success');
          setTelegramTestMessage('Сообщение отправлено напрямую!');
        } else {
          setTelegramTestStatus('error');
          setTelegramTestMessage(data.description || 'Ошибка Telegram API');
        }
      }
    } catch (e: any) {
      setTelegramTestStatus('error');
      setTelegramTestMessage(e.message || 'Ошибка отправки');
    }
    
    // Сбросить статус через 5 секунд
    setTimeout(() => {
      setTelegramTestStatus('idle');
      setTelegramTestMessage('');
    }, 5000);
  };
  
  const handleAddToBlacklist = () => {
    if (newBlacklistItem.trim()) {
      addToBlacklist(newBlacklistItem.trim());
      setNewBlacklistItem('');
    }
  };
  
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.7)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 600,
          maxHeight: '90vh',
          background: 'var(--bg-card)',
          borderRadius: 12,
          border: '1px solid var(--border)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Заголовок */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
            Настройки
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '1.2rem',
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>
        
        {/* Контент */}
        <div
          style={{
            padding: 20,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          {/* Обновление данных */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
                Обновление данных
              </label>
              <select
                value={settings.autoUpdate ? 'auto' : 'manual'}
                onChange={(e) => updateSettings({ autoUpdate: e.target.value === 'auto' })}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                  fontFamily: 'inherit',
                }}
              >
                <option value="auto">Автоматически</option>
                <option value="manual">Вручную</option>
              </select>
            </div>
            
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
                Интервал обновления (сек)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => updateSettings({ updateInterval: Math.max(5, settings.updateInterval - 5) })}
                  style={{
                    padding: '8px 12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text-main)',
                    cursor: 'pointer',
                  }}
                >
                  −
                </button>
                <input
                  type="number"
                  value={settings.updateInterval}
                  onChange={(e) => updateSettings({ updateInterval: Math.max(5, parseInt(e.target.value) || 5) })}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text-main)',
                    fontSize: '0.85rem',
                    fontFamily: 'inherit',
                    textAlign: 'center',
                  }}
                />
                <button
                  onClick={() => updateSettings({ updateInterval: settings.updateInterval + 5 })}
                  style={{
                    padding: '8px 12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text-main)',
                    cursor: 'pointer',
                  }}
                >
                  +
                </button>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Минимальное значение 5
              </div>
            </div>
          </div>
          
          {/* Тип ордеров */}
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
              Тип ордеров
            </label>
            <select
              value={settings.orderTypeFilter}
              onChange={(e) => updateSettings({ orderTypeFilter: e.target.value as any })}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-main)',
                fontSize: '0.85rem',
                fontFamily: 'inherit',
              }}
            >
              <option value="all">Все ордера</option>
              <option value="buy">Только покупки</option>
              <option value="sell">Только продажи</option>
            </select>
          </div>
          
          {/* Фильтры плотностей */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
                Мин. сумма плотности ($)
              </label>
              <select
                value={settings.minDensityUSD}
                onChange={(e) => updateSettings({ minDensityUSD: parseInt(e.target.value) })}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                  fontFamily: 'inherit',
                }}
              >
                <option value="50000">$50K</option>
                <option value="100000">$100K</option>
                <option value="150000">$150K</option>
                <option value="200000">$200K</option>
                <option value="300000">$300K</option>
                <option value="500000">$500K</option>
              </select>
            </div>
            
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
                Мин. время разъедания (мин)
              </label>
              <select
                value={settings.minDissolutionTime}
                onChange={(e) => updateSettings({ minDissolutionTime: parseFloat(e.target.value) })}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                  fontFamily: 'inherit',
                }}
              >
                <option value="0">0 (все)</option>
                <option value="0.5">0.5 мин (30 сек)</option>
                <option value="1">1 мин</option>
                <option value="2">2 мин</option>
                <option value="3">3 мин</option>
                <option value="5">5 мин</option>
                <option value="10">10 мин</option>
              </select>
            </div>
          </div>
          
          {/* Фильтр ликвидности - диапазон 24h объёма */}
          <div style={{ 
            padding: 16, 
            background: 'rgba(59, 130, 246, 0.1)', 
            borderRadius: 8,
            border: '1px solid rgba(59, 130, 246, 0.3)',
          }}>
            <label style={{ fontSize: '0.8rem', color: '#3b82f6', marginBottom: 12, display: 'block', fontWeight: 600 }}>
              24h объём монеты (диапазон)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
                  Минимум
                </label>
                <select
                  value={settings.minVolume24h}
                  onChange={(e) => updateSettings({ minVolume24h: parseInt(e.target.value) })}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text-main)',
                    fontSize: '0.85rem',
                    fontFamily: 'inherit',
                  }}
                >
                  <option value="500000">$500K</option>
                  <option value="1000000">$1M</option>
                  <option value="2000000">$2M</option>
                  <option value="5000000">$5M</option>
                  <option value="10000000">$10M</option>
                  <option value="20000000">$20M</option>
                  <option value="50000000">$50M</option>
                  <option value="100000000">$100M</option>
                  <option value="200000000">$200M</option>
                  <option value="500000000">$500M</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
                  Максимум
                </label>
                <select
                  value={settings.maxVolume24h}
                  onChange={(e) => updateSettings({ maxVolume24h: parseInt(e.target.value) })}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text-main)',
                    fontSize: '0.85rem',
                    fontFamily: 'inherit',
                  }}
                >
                  <option value="0">Без ограничения</option>
                  <option value="1000000">$1M</option>
                  <option value="2000000">$2M</option>
                  <option value="5000000">$5M</option>
                  <option value="10000000">$10M</option>
                  <option value="20000000">$20M</option>
                  <option value="50000000">$50M</option>
                  <option value="100000000">$100M</option>
                  <option value="200000000">$200M</option>
                  <option value="500000000">$500M</option>
                  <option value="1000000000">$1B</option>
                </select>
              </div>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 8 }}>
              Фильтрует монеты по 24h торговому объёму.
              <br />
              <strong style={{ color: '#3b82f6' }}>Низкий объём ($1M-$10M)</strong> — альткоины с высоким временем разъедания.
              <br />
              <strong style={{ color: '#3b82f6' }}>Высокий объём (&gt;$100M)</strong> — топ монеты, больше ликвидности.
            </div>
          </div>
          
          {/* Макс количество плотностей */}
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
              Макс. количество плотностей на карте
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => updateSettings({ maxDensities: Math.max(1, settings.maxDensities - 5) })}
                style={{
                  padding: '8px 12px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: 'var(--text-main)',
                  cursor: 'pointer',
                }}
              >
                −
              </button>
              <input
                type="number"
                min="1"
                max="500"
                value={settings.maxDensities}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 1;
                  updateSettings({ maxDensities: Math.max(1, Math.min(500, val)) });
                }}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                  fontFamily: 'inherit',
                  textAlign: 'center',
                }}
              />
              <button
                onClick={() => updateSettings({ maxDensities: Math.min(500, settings.maxDensities + 5) })}
                style={{
                  padding: '8px 12px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: 'var(--text-main)',
                  cursor: 'pointer',
                }}
              >
                +
              </button>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
              От 1 до 500. Показываются самые значимые по времени разъедания
            </div>
          </div>
          
          {/* Мин. время жизни плотности (для Tracker API) */}
          <div style={{ 
            padding: 16, 
            background: 'rgba(34, 197, 94, 0.1)', 
            borderRadius: 8,
            border: '1px solid rgba(34, 197, 94, 0.3)',
          }}>
            <label style={{ fontSize: '0.8rem', color: '#22c55e', marginBottom: 8, display: 'block', fontWeight: 600 }}>
              Мин. время жизни плотности (Tracker API)
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {[
                { value: 0, label: '0 (все)' },
                { value: 5, label: '5 мин' },
                { value: 15, label: '15 мин' },
                { value: 30, label: '30 мин' },
                { value: 60, label: '1 час' },
                { value: 120, label: '2 часа' },
                { value: 240, label: '4 часа' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => updateSettings({ minLifetimeMinutes: opt.value })}
                  style={{
                    padding: '8px 14px',
                    background: settings.minLifetimeMinutes === opt.value ? '#22c55e' : 'var(--bg-elevated)',
                    border: '1px solid',
                    borderColor: settings.minLifetimeMinutes === opt.value ? '#22c55e' : 'var(--border)',
                    borderRadius: 6,
                    color: settings.minLifetimeMinutes === opt.value ? 'white' : 'var(--text-main)',
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    fontWeight: settings.minLifetimeMinutes === opt.value ? 600 : 400,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              Показывать только плотности, которые простояли в стакане указанное время.
              <br />
              <strong style={{ color: '#22c55e' }}>Рекомендуется 1 час</strong> — это отфильтрует «фейковые» ордера.
              <br />
              Для тестирования можно поставить 0 или 5 минут.
            </div>
          </div>
          
          {/* Настройки графика */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
                Количество свечей на графике
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => updateSettings({ chartBars: Math.max(50, settings.chartBars - 30) })}
                  style={{
                    padding: '8px 12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text-main)',
                    cursor: 'pointer',
                  }}
                >
                  −
                </button>
                <input
                  type="number"
                  value={settings.chartBars}
                  onChange={(e) => updateSettings({ chartBars: Math.max(50, Math.min(1000, parseInt(e.target.value) || 120)) })}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text-main)',
                    fontSize: '0.85rem',
                    fontFamily: 'inherit',
                    textAlign: 'center',
                  }}
                />
                <button
                  onClick={() => updateSettings({ chartBars: Math.min(1000, settings.chartBars + 30) })}
                  style={{
                    padding: '8px 12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text-main)',
                    cursor: 'pointer',
                  }}
                >
                  +
                </button>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Минимальное значение 50. Максимальное значение 1000
              </div>
            </div>
            
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
                Максимальная дистанция (%)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => updateSettings({ maxDistancePercent: Math.max(1, settings.maxDistancePercent - 1) })}
                  style={{
                    padding: '8px 12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text-main)',
                    cursor: 'pointer',
                  }}
                >
                  −
                </button>
                <input
                  type="number"
                  value={settings.maxDistancePercent}
                  onChange={(e) => updateSettings({ maxDistancePercent: Math.max(1, Math.min(10, parseInt(e.target.value) || 3)) })}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text-main)',
                    fontSize: '0.85rem',
                    fontFamily: 'inherit',
                    textAlign: 'center',
                  }}
                />
                <button
                  onClick={() => updateSettings({ maxDistancePercent: Math.min(10, settings.maxDistancePercent + 1) })}
                  style={{
                    padding: '8px 12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    color: 'var(--text-main)',
                    cursor: 'pointer',
                  }}
                >
                  +
                </button>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>
                Минимальное значение 1. Максимальное значение 10
              </div>
            </div>
          </div>
          
          {/* Таймфрейм графика */}
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
              Таймфрейм графика
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['1m', '5m', '15m', '1h', '4h', '1d'] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => updateSettings({ chartTimeframe: tf })}
                  style={{
                    padding: '8px 16px',
                    background: settings.chartTimeframe === tf ? 'var(--accent)' : 'var(--bg-elevated)',
                    border: '1px solid',
                    borderColor: settings.chartTimeframe === tf ? 'var(--accent)' : 'var(--border)',
                    borderRadius: 6,
                    color: settings.chartTimeframe === tf ? 'white' : 'var(--text-main)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: settings.chartTimeframe === tf ? 600 : 400,
                  }}
                >
                  {tf === '1m' ? '1м' : tf === '5m' ? '5м' : tf === '15m' ? '15м' : tf === '1h' ? '1ч' : tf === '4h' ? '4ч' : '1д'}
                </button>
              ))}
            </div>
          </div>
          
          {/* Чёрный список */}
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
              Чёрный список
            </label>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                type="text"
                value={newBlacklistItem}
                onChange={(e) => setNewBlacklistItem(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleAddToBlacklist()}
                placeholder="Добавить монету"
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                  fontFamily: 'inherit',
                }}
              />
              <button
                onClick={handleAddToBlacklist}
                style={{
                  padding: '10px 16px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  color: 'var(--text-main)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Добавить
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {settings.blacklist.map((symbol) => (
                <div
                  key={symbol}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 10px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 20,
                    fontSize: '0.8rem',
                  }}
                >
                  <span style={{ color: 'var(--text-main)' }}>{symbol}</span>
                  <button
                    onClick={() => removeFromBlacklist(symbol)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--down)',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: '0.9rem',
                      lineHeight: 1,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {settings.blacklist.length === 0 && (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  Список пуст
                </span>
              )}
            </div>
          </div>
          
          {/* Биржи */}
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
              Биржи
            </label>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={settings.exchanges.binance}
                  onChange={(e) => updateSettings({ 
                    exchanges: { ...settings.exchanges, binance: e.target.checked } 
                  })}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ color: 'var(--text-main)', fontSize: '0.85rem' }}>Binance</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={settings.exchanges.bybit}
                  onChange={(e) => updateSettings({ 
                    exchanges: { ...settings.exchanges, bybit: e.target.checked } 
                  })}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ color: 'var(--text-main)', fontSize: '0.85rem' }}>Bybit</span>
              </label>
            </div>
          </div>
          
          {/* Отображение */}
          <div>
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>
              Отображение
            </label>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={settings.showExchange}
                  onChange={(e) => updateSettings({ showExchange: e.target.checked })}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ color: 'var(--text-main)', fontSize: '0.85rem' }}>Отображать биржу</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={settings.showDistance}
                  onChange={(e) => updateSettings({ showDistance: e.target.checked })}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ color: 'var(--text-main)', fontSize: '0.85rem' }}>Отображать дистанцию</span>
              </label>
            </div>
          </div>
          
          {/* Telegram уведомления */}
          <div style={{ 
            padding: 16, 
            background: 'rgba(0, 136, 204, 0.1)', 
            borderRadius: 8,
            border: '1px solid rgba(0, 136, 204, 0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <label style={{ fontSize: '0.9rem', color: '#0088cc', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '1.2rem' }}>📱</span>
                Telegram уведомления
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={telegram.enabled}
                  onChange={(e) => updateSettings({ 
                    telegram: { ...telegram, enabled: e.target.checked } 
                  })}
                  style={{ accentColor: '#0088cc', width: 18, height: 18 }}
                />
                <span style={{ color: telegram.enabled ? '#0088cc' : 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 500 }}>
                  {telegram.enabled ? 'Включено' : 'Выключено'}
                </span>
              </label>
            </div>
            
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
                  Bot Token (от @BotFather)
                </label>
                <input
                  type="password"
                  value={telegram.botToken}
                  onChange={(e) => updateSettings({ 
                    telegram: { ...telegram, botToken: e.target.value } 
                  })}
                  placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text-main)',
                    fontSize: '0.85rem',
                    fontFamily: 'monospace',
                  }}
                />
              </div>
              
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
                  Chat ID (от @userinfobot)
                </label>
                <input
                  type="text"
                  value={telegram.chatId}
                  onChange={(e) => updateSettings({ 
                    telegram: { ...telegram, chatId: e.target.value } 
                  })}
                  placeholder="123456789"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text-main)',
                    fontSize: '0.85rem',
                    fontFamily: 'monospace',
                  }}
                />
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
                    Порог дистанции (%)
                  </label>
                  <select
                    value={telegram.alertDistancePercent}
                    onChange={(e) => updateSettings({ 
                      telegram: { ...telegram, alertDistancePercent: parseFloat(e.target.value) } 
                    })}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      color: 'var(--text-main)',
                      fontSize: '0.85rem',
                      fontFamily: 'inherit',
                    }}
                  >
                    <option value="0.1">0.1%</option>
                    <option value="0.2">0.2%</option>
                    <option value="0.3">0.3%</option>
                    <option value="0.5">0.5%</option>
                    <option value="0.75">0.75%</option>
                    <option value="1">1%</option>
                    <option value="1.5">1.5%</option>
                    <option value="2">2%</option>
                  </select>
                </div>
                
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6, display: 'block' }}>
                    Cooldown (мин)
                  </label>
                  <select
                    value={telegram.cooldownMinutes}
                    onChange={(e) => updateSettings({ 
                      telegram: { ...telegram, cooldownMinutes: parseInt(e.target.value) } 
                    })}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      color: 'var(--text-main)',
                      fontSize: '0.85rem',
                      fontFamily: 'inherit',
                    }}
                  >
                    <option value="1">1 мин</option>
                    <option value="2">2 мин</option>
                    <option value="5">5 мин</option>
                    <option value="10">10 мин</option>
                    <option value="15">15 мин</option>
                    <option value="30">30 мин</option>
                  </select>
                </div>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                <button
                  onClick={handleTestTelegram}
                  disabled={!telegram.botToken || !telegram.chatId || telegramTestStatus === 'loading'}
                  style={{
                    padding: '10px 20px',
                    background: telegramTestStatus === 'success' ? '#22c55e' : 
                                telegramTestStatus === 'error' ? '#ef4444' : '#0088cc',
                    border: 'none',
                    borderRadius: 8,
                    color: 'white',
                    cursor: (!telegram.botToken || !telegram.chatId || telegramTestStatus === 'loading') 
                      ? 'not-allowed' : 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    opacity: (!telegram.botToken || !telegram.chatId) ? 0.5 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  {telegramTestStatus === 'loading' ? (
                    <>⏳ Отправка...</>
                  ) : telegramTestStatus === 'success' ? (
                    <>✅ Успешно!</>
                  ) : telegramTestStatus === 'error' ? (
                    <>❌ Ошибка</>
                  ) : (
                    <>📤 Тест уведомления</>
                  )}
                </button>
                {telegramTestMessage && (
                  <span style={{ 
                    fontSize: '0.8rem', 
                    color: telegramTestStatus === 'success' ? '#22c55e' : '#ef4444' 
                  }}>
                    {telegramTestMessage}
                  </span>
                )}
              </div>
            </div>
            
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.5 }}>
              <strong style={{ color: '#0088cc' }}>Как настроить:</strong>
              <br />
              1. Создайте бота через <a href="https://t.me/BotFather" target="_blank" style={{ color: '#0088cc' }}>@BotFather</a> и получите токен
              <br />
              2. Напишите боту /start
              <br />
              3. Узнайте свой Chat ID у <a href="https://t.me/userinfobot" target="_blank" style={{ color: '#0088cc' }}>@userinfobot</a>
              <br />
              4. Нажмите «Тест» для проверки
            </div>
          </div>
        </div>
        
        {/* Футер */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <button
            onClick={resetSettings}
            style={{
              padding: '10px 16px',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Сбросить настройки
          </button>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={onClose}
              style={{
                padding: '10px 20px',
                background: 'transparent',
                border: '1px solid var(--border)',
                borderRadius: 8,
                color: 'var(--text-main)',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              Отмена
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '10px 20px',
                background: 'var(--accent)',
                border: 'none',
                borderRadius: 8,
                color: 'white',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              Сохранить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
