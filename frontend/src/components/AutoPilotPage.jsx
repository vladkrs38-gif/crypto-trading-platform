import { useState, useEffect, useRef } from 'react'

import { API } from '../config'

const AREAS = [
  { id: 113, name: 'Вся Россия' },
  { id: 1, name: 'Москва' },
  { id: 2, name: 'Санкт-Петербург' },
  { id: 54, name: 'Красноярск' },
  { id: 88, name: 'Казань' },
  { id: 66, name: 'Нижний Новгород' },
]

export default function AutoPilotPage({ resume, setResume, onRefreshStats, extensionConnected, token, user, onShowPayment }) {
  const [config, setConfig] = useState(null)
  const [status, setStatus] = useState(null)
  const [saving, setSaving] = useState(false)
  const [runningNow, setRunningNow] = useState(false)
  const [queries, setQueries] = useState([])
  const [area, setArea] = useState(113)
  const [remoteOnly, setRemoteOnly] = useState(true)
  const [interval, setInterval_] = useState(60)
  const [analyzing, setAnalyzing] = useState(false)
  const fileInputRef = useRef(null)

  const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {}

  useEffect(() => {
    loadConfig()
    loadStatus()
    const timer = setInterval(() => loadStatus(), 10000)
    return () => clearInterval(timer)
  }, [token])

  const loadConfig = async () => {
    try {
      const r = await fetch(`${API}/auto/config`, { headers: authHeaders })
      if (r.ok) {
        const d = await r.json()
        setConfig(d)
        setQueries(d.search_queries || [])
        setArea(d.area || 113)
        setRemoteOnly(d.remote_only ?? true)
        setInterval_(d.interval_minutes || 60)
        if (d.resume_text && !resume) setResume(d.resume_text)
      }
    } catch {}
  }

  const loadStatus = async () => {
    try {
      const r = await fetch(`${API}/auto/status`, { headers: authHeaders })
      if (r.ok) setStatus(await r.json())
    } catch {}
  }

  const save = async (overrides = {}) => {
    setSaving(true)
    try {
      const body = {
        resume_text: resume,
        area,
        remote_only: remoteOnly,
        search_queries: queries,
        interval_minutes: interval,
        ...overrides,
      }
      const r = await fetch(`${API}/auto/config`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (r.status === 403) {
        onShowPayment?.()
        return false
      }
      if (r.ok) {
        const d = await r.json()
        setConfig(d)
        setQueries(d.search_queries || [])
        return true
      }
    } catch {}
    finally { setSaving(false) }
    return false
  }

  const toggleActive = async () => {
    const newActive = !config?.is_active
    if (newActive && user?.credits <= 0) {
      onShowPayment?.()
      return
    }
    await save({ is_active: newActive })
  }

  const runNow = async () => {
    if (user?.credits <= 0) {
      onShowPayment?.()
      return
    }
    setRunningNow(true)
    try {
      await save()
      const r = await fetch(`${API}/auto/run-now`, { method: 'POST', headers: authHeaders })
      if (r.status === 403) {
        onShowPayment?.()
        return
      }
      await loadStatus()
      onRefreshStats()
    } catch (e) {
      alert(e.message || 'Ошибка запуска')
    }
    finally { setRunningNow(false) }
  }

  const analyzeResume = async () => {
    if (!resume?.trim()) return
    setAnalyzing(true)
    try {
      const r = await fetch(`${API}/analyze-resume`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resume_text: resume }),
      })
      const d = await r.json()
      if (r.ok && d.search_queries) {
        setQueries(d.search_queries)
      }
    } catch {}
    finally { setAnalyzing(false) }
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const ext = (file.name || '').toLowerCase().split('.').pop()
    if (ext === 'txt') {
      const reader = new FileReader()
      reader.onload = () => setResume(reader.result || '')
      reader.readAsText(file, 'UTF-8')
      return
    }
    if (ext === 'pdf') {
      const fd = new FormData()
      fd.append('file', file)
      try {
        const r = await fetch(`${API}/extract-resume`, { method: 'POST', body: fd, headers: authHeaders })
        const d = await r.json()
        if (r.ok) setResume(d.text || '')
      } catch {}
    }
  }

  const addQuery = () => setQueries([...queries, ''])
  const removeQuery = (i) => setQueries(queries.filter((_, idx) => idx !== i))
  const updateQuery = (i, val) => setQueries(queries.map((q, idx) => idx === i ? val : q))

  const isActive = config?.is_active

  return (
    <div className="p-4 sm:p-6 w-full space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Автопилот</h2>
          <p className="text-sm text-slate-500 mt-0.5">Автоматический поиск и отклик на новые вакансии</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${isActive ? 'text-success' : 'text-slate-500'}`}>
            {isActive ? 'Активен' : 'Выключен'}
          </span>
          <button onClick={toggleActive}
            className={`relative w-12 h-6 rounded-full transition-colors ${isActive ? 'bg-success' : 'bg-dark-300'}`}>
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${isActive ? 'translate-x-6' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </div>

      {/* Extension status */}
      {!extensionConnected && (
        <div className="bg-warn/10 border border-warn/20 rounded-xl px-4 sm:px-5 py-4 flex items-center gap-3">
          <span className="w-3 h-3 bg-warn rounded-full shrink-0" />
          <div>
            <div className="text-warn font-medium text-sm">Расширение не подключено</div>
            <div className="text-xs text-slate-400 mt-0.5">Автопилот не сможет откликаться без расширения. Установите его для Chrome или Яндекс Браузера.</div>
          </div>
        </div>
      )}

      {/* Status card */}
      {status && (
        <div className="bg-dark-700 rounded-xl border border-dark-300 p-5">
          <h3 className="text-sm font-semibold text-white mb-3">Текущий статус</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-slate-500">Состояние</span>
              <div className={`mt-0.5 font-medium ${status.is_running ? 'text-accent-hover animate-pulse' : isActive ? 'text-success' : 'text-slate-400'}`}>
                {status.is_running ? 'Выполняется...' : isActive ? 'Ожидает' : 'Выключен'}
              </div>
            </div>
            <div>
              <span className="text-slate-500">Интервал</span>
              <div className="text-slate-300 mt-0.5">{interval} мин</div>
            </div>
            <div>
              <span className="text-slate-500">Последний запуск</span>
              <div className="text-slate-300 mt-0.5">
                {status.last_run ? new Date(status.last_run).toLocaleString('ru') : '—'}
              </div>
            </div>
            <div>
              <span className="text-slate-500">Результат</span>
              <div className="text-slate-300 mt-0.5">
                {status.last_run_result?.new_found != null
                  ? `+${status.last_run_result.new_found} новых, ${status.last_run_result.applied ?? 0} откликов`
                  : '—'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Resume */}
      <div className="bg-dark-700 rounded-xl border border-dark-300 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">Резюме</h3>
          <div className="flex gap-2">
            <input ref={fileInputRef} type="file" accept=".txt,.pdf" onChange={handleFileChange} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 text-xs bg-dark-400 text-slate-300 rounded-lg hover:bg-dark-300 transition">
              Загрузить файл
            </button>
          </div>
        </div>
        <textarea
          value={resume} onChange={e => setResume(e.target.value)}
          placeholder="Вставьте текст резюме..."
          rows={4}
          className="w-full px-3 py-2.5 border border-dark-300 rounded-lg text-base sm:text-sm resize-none focus:ring-2 min-h-[100px]"
        />
        <div className="mt-2 flex gap-2">
          <button onClick={analyzeResume} disabled={analyzing || !resume?.trim()}
            className="px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover disabled:opacity-50 transition">
            {analyzing ? 'Анализируем...' : 'AI: сгенерировать поисковые запросы'}
          </button>
        </div>
      </div>

      {/* Search queries */}
      <div className="bg-dark-700 rounded-xl border border-dark-300 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">Поисковые запросы</h3>
          <button onClick={addQuery} className="px-3 py-1 text-xs bg-dark-400 text-slate-300 rounded-lg hover:bg-dark-300 transition">
            + Добавить
          </button>
        </div>
        {queries.length === 0 ? (
          <p className="text-sm text-slate-500">Нет запросов. Загрузите резюме и нажмите «AI: сгенерировать»</p>
        ) : (
          <div className="space-y-2">
            {queries.map((q, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text" value={q} onChange={e => updateQuery(i, e.target.value)}
                  placeholder="Например: Python разработчик"
                  className="flex-1 px-3 py-2 border border-dark-300 rounded-lg text-sm focus:ring-2"
                />
                <button onClick={() => removeQuery(i)}
                  className="px-2.5 text-slate-500 hover:text-danger transition text-lg">×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Settings */}
      <div className="bg-dark-700 rounded-xl border border-dark-300 p-5">
        <h3 className="text-sm font-semibold text-white mb-3">Настройки поиска</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Регион</label>
            <select value={area} onChange={e => setArea(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-dark-300 rounded-lg text-sm focus:ring-2">
              {AREAS.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Интервал (минуты)</label>
            <input type="number" value={interval} onChange={e => setInterval_(parseInt(e.target.value) || 60)}
              min={5} max={1440}
              className="w-full px-3 py-2 border border-dark-300 rounded-lg text-sm focus:ring-2" />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
              <input type="checkbox" checked={remoteOnly} onChange={e => setRemoteOnly(e.target.checked)}
                className="w-4 h-4 accent-accent rounded" />
              Только удалёнка
            </label>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button onClick={() => save()} disabled={saving}
          className="px-5 py-2.5 bg-accent text-white font-medium rounded-lg hover:bg-accent-hover disabled:opacity-50 transition text-sm">
          {saving ? 'Сохраняем...' : 'Сохранить настройки'}
        </button>
        <button onClick={runNow} disabled={runningNow || status?.is_running}
          className="px-5 py-2.5 bg-success text-white font-medium rounded-lg hover:bg-green-600 disabled:opacity-50 transition text-sm">
          {runningNow || status?.is_running ? 'Выполняется...' : 'Запустить сейчас'}
        </button>
        <button onClick={toggleActive}
          className={`px-5 py-2.5 font-medium rounded-lg transition text-sm ${
            isActive
              ? 'bg-danger/20 text-danger hover:bg-danger/30'
              : 'bg-success/20 text-success hover:bg-success/30'
          }`}>
          {isActive ? 'Выключить автопилот' : 'Включить автопилот'}
        </button>
      </div>
    </div>
  )
}
