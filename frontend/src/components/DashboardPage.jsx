import { useState, useEffect } from 'react'

import { API } from '../config'

const FUNNEL_ITEMS = [
  { key: 'sent', label: 'Всего откликов', icon: '✈', color: 'text-slate-300' },
  { key: 'viewed', label: 'В ожидании', icon: '👁', color: 'text-warn' },
  { key: 'invitations', label: 'Приглашения / Собеседование', icon: '✓', color: 'text-success' },
  { key: 'rejections', label: 'Отказы', icon: '✕', color: 'text-danger' },
]

export default function DashboardPage({ stats, onRefreshStats, extensionConnected, sendExtMessage, token }) {
  const [recentApps, setRecentApps] = useState([])
  const [autoStatus, setAutoStatus] = useState(null)
  const [negStats, setNegStats] = useState(null)
  const [negLoading, setNegLoading] = useState(false)
  const [negError, setNegError] = useState(null)

  const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {}

  useEffect(() => {
    fetch(`${API}/db/applications?limit=10`, { headers: authHeaders })
      .then(r => r.ok ? r.json() : [])
      .then(setRecentApps)
      .catch(() => {})
    fetch(`${API}/auto/status`, { headers: authHeaders })
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setAutoStatus(d))
      .catch(() => {})
    fetch(`${API}/negotiations/stats`, { headers: authHeaders })
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setNegStats(d))
      .catch(() => {})
  }, [stats, token])

  const refreshNegStats = async () => {
    setNegLoading(true)
    setNegError(null)
    try {
      if (extensionConnected && sendExtMessage) {
        const result = await sendExtMessage({ type: 'get_negotiations_stats' })
        if (!result?.ok) throw new Error(result?.error || 'Расширение не вернуло данные')
        const s = result.stats
        const r = await fetch(`${API}/negotiations/stats/save`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sent: s.sent || 0, viewed: s.viewed || 0, invitations: s.invitations || 0, rejections: s.rejections || 0 }),
        })
        if (r.ok) setNegStats(await r.json())
        else {
          const d = await r.json().catch(() => ({}))
          throw new Error(d.detail || `Ошибка сохранения (${r.status})`)
        }
      } else {
        const r = await fetch(`${API}/negotiations/stats/refresh`, { method: 'POST', headers: authHeaders })
        if (r.ok) setNegStats(await r.json())
        else {
          const d = await r.json().catch(() => ({}))
          throw new Error(d.detail || 'Ошибка обновления статистики')
        }
      }
    } catch (e) {
      console.warn('refreshNegStats error:', e)
      setNegError(e.message || 'Ошибка обновления')
      setTimeout(() => setNegError(null), 8000)
    } finally {
      setNegLoading(false)
    }
  }

  const statCards = [
    { label: 'Всего вакансий', value: stats?.total ?? '—', color: 'text-white', bg: 'bg-dark-600' },
    { label: 'Откликнулись', value: stats?.applied ?? '—', color: 'text-success', bg: 'bg-success/10' },
    { label: 'Новые', value: stats?.new ?? '—', color: 'text-accent-hover', bg: 'bg-accent/10' },
    { label: 'Ошибки', value: stats?.error ?? '—', color: 'text-danger', bg: 'bg-danger/10' },
    { label: 'Пропущено', value: stats?.skipped ?? '—', color: 'text-warn', bg: 'bg-warn/10' },
    { label: 'Сегодня откликов', value: stats?.today_applied ?? '—', color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
  ]

  const STATUS_LABELS = {
    sent: { text: 'Отправлен', cls: 'text-success bg-success/10' },
    applied: { text: 'Отправлен', cls: 'text-success bg-success/10' },
    error: { text: 'Ошибка', cls: 'text-danger bg-danger/10' },
    test_required: { text: 'Нужен тест', cls: 'text-warn bg-warn/10' },
    no_button: { text: 'Нет кнопки', cls: 'text-slate-400 bg-dark-400' },
  }

  return (
    <div className="p-4 sm:p-6 w-full space-y-5 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Дашборд</h2>
          <p className="text-sm text-slate-500 mt-0.5">Обзор автоматизации откликов</p>
        </div>
        <button
          onClick={onRefreshStats}
          className="px-3 py-1.5 text-xs bg-dark-500 text-slate-400 rounded-lg hover:bg-dark-400 hover:text-slate-200 transition"
        >
          Обновить
        </button>
      </div>

      {/* Status banner */}
      {extensionConnected ? (
        <div className="bg-success/10 border border-success/20 rounded-xl px-4 sm:px-5 py-4 flex items-center gap-3">
          <span className="w-3 h-3 bg-success rounded-full shrink-0 animate-pulse" />
          <div>
            <div className="text-success font-medium text-sm">Расширение подключено</div>
            <div className="text-xs text-slate-400 mt-0.5">Готов к откликам. Перейдите в «Поиск и отклик» или настройте «Автопилот»</div>
          </div>
        </div>
      ) : (
        <div className="bg-warn/10 border border-warn/20 rounded-xl px-4 sm:px-5 py-4 flex items-center gap-3">
          <span className="w-3 h-3 bg-warn rounded-full shrink-0" />
          <div>
            <div className="text-warn font-medium text-sm">Расширение не подключено</div>
            <div className="text-xs text-slate-400 mt-0.5">Установите расширение для Яндекс Браузера или Chrome, чтобы откликаться на вакансии</div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {statCards.map((s) => (
          <div key={s.label} className={`${s.bg} rounded-xl px-4 sm:px-5 py-4 sm:py-3.5 border border-dark-300/50`}>
            <div className="text-xs sm:text-sm text-slate-500 mb-1">{s.label}</div>
            <div className={`text-xl sm:text-2xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Negotiations funnel */}
      <div className="bg-dark-700 rounded-xl border border-dark-300 p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Статистика откликов</h3>
            <p className="text-xs text-slate-500 mt-0.5">Воронка по статусам</p>
          </div>
          <button
            onClick={refreshNegStats}
            disabled={negLoading || !extensionConnected}
            className="px-4 py-2 bg-accent text-white text-sm font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {negLoading ? 'Обновляем…' : 'Обновить статистику'}
          </button>
        </div>
        <div className="space-y-3">
          {FUNNEL_ITEMS.map(({ key, label, icon, color }) => (
            <div key={key} className="flex items-center gap-3 py-2 border-b border-dark-300 last:border-0">
              <span className="w-8 h-8 rounded-lg bg-dark-500 flex items-center justify-center text-slate-400 text-sm shrink-0">
                {icon}
              </span>
              <span className="text-sm text-slate-300 flex-1">{label}</span>
              <span className={`text-lg font-bold ${color}`}>
                {negStats ? negStats[key] : '—'}
              </span>
            </div>
          ))}
        </div>
        {negError && (
          <div className="mt-3 px-3 py-2 bg-danger/10 border border-danger/20 rounded-lg text-xs text-danger flex items-center justify-between">
            <span>{negError}</span>
            <button onClick={() => setNegError(null)} className="ml-2 text-danger/60 hover:text-danger">✕</button>
          </div>
        )}
        {!extensionConnected && (
          <p className="text-xs text-slate-500 mt-3">Установите расширение для обновления статистики</p>
        )}
      </div>

      {/* Auto-pilot status */}
      {autoStatus && (
        <div className="bg-dark-700 rounded-xl border border-dark-300 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Автопилот</h3>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
              autoStatus.is_active
                ? 'bg-success/15 text-success'
                : 'bg-dark-400 text-slate-500'
            }`}>
              {autoStatus.is_active ? 'Активен' : 'Выключен'}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs sm:text-sm">
            <div>
              <span className="text-slate-500">Интервал</span>
              <div className="text-slate-300 mt-0.5">каждые {autoStatus.interval_minutes} мин</div>
            </div>
            <div>
              <span className="text-slate-500">Последний запуск</span>
              <div className="text-slate-300 mt-0.5">
                {autoStatus.last_run ? new Date(autoStatus.last_run).toLocaleString('ru') : 'ещё не запускался'}
              </div>
            </div>
            <div>
              <span className="text-slate-500">Статус</span>
              <div className="text-slate-300 mt-0.5">
                {autoStatus.is_running ? 'Выполняется...' : 'Ожидание'}
              </div>
            </div>
          </div>
          {autoStatus.last_run_result && Object.keys(autoStatus.last_run_result).length > 0 && (
            <div className="mt-3 pt-3 border-t border-dark-300 flex gap-4 text-xs">
              <span className="text-accent-hover">Найдено новых: {autoStatus.last_run_result.new_found ?? 0}</span>
              <span className="text-success">Откликов: {autoStatus.last_run_result.applied ?? 0}</span>
              <span className="text-danger">Ошибок: {autoStatus.last_run_result.errors ?? 0}</span>
            </div>
          )}
        </div>
      )}

      {/* How to use guide — adaptive to current state */}
      <div className="bg-dark-700 rounded-xl border border-dark-300 p-5">
        <h3 className="text-sm font-semibold text-white mb-3">Как начать</h3>
        <div className="space-y-2 text-sm text-slate-400">
          <div className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-warn/20 text-warn">!</span>
            <span>Установите расширение для <b className="text-slate-300">Яндекс Браузера</b> или <b className="text-slate-300">Chrome</b> — скачайте ZIP внизу бокового меню</span>
          </div>
          <div className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-accent/20 text-accent-hover">1</span>
            <span>Перейдите в <b className="text-slate-300">«Поиск и отклик»</b> — загрузите резюме, найдите вакансии</span>
          </div>
          <div className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-accent/20 text-accent-hover">2</span>
            <span>Нажмите <b className="text-slate-300">«Откликнуться на все»</b> — AI сгенерирует письмо для каждой и отправит</span>
          </div>
          <div className="flex gap-3">
            <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-accent/20 text-accent-hover">3</span>
            <span>Или настройте <b className="text-slate-300">«Автопилот»</b> — будет искать новые вакансии каждый час и откликаться сам</span>
          </div>
        </div>
      </div>

      {/* Recent applications */}
      <div className="bg-dark-700 rounded-xl border border-dark-300 overflow-hidden">
        <div className="px-5 py-3 border-b border-dark-300">
          <h3 className="text-sm font-semibold text-white">Последние отклики</h3>
        </div>
        {recentApps.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">
            Откликов пока нет
          </div>
        ) : (
          <div className="divide-y divide-dark-300 max-h-[400px] overflow-y-auto">
            {recentApps.map((app, i) => {
              const st = STATUS_LABELS[app.status] || { text: app.status, cls: 'text-slate-400 bg-dark-400' }
              return (
                <div key={app.id || i} className="px-5 py-3 flex items-center gap-3 hover:bg-dark-600/50 transition">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-200 truncate">{app.title || app.vacancy_hh_id}</div>
                    <div className="text-xs text-slate-500">{app.company}</div>
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${st.cls}`}>
                    {st.text}
                  </span>
                  <span className="shrink-0 text-xs text-slate-600">
                    {app.applied_at ? new Date(app.applied_at).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
