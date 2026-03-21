import { useState, useEffect, useCallback } from 'react'

import { API } from '../config'

const STATUS_MAP = {
  new: { label: 'Новая', cls: 'text-accent-hover bg-accent/10' },
  applied: { label: 'Откликнулись', cls: 'text-success bg-success/10' },
  already_applied: { label: 'Откликнулись', cls: 'text-success bg-success/10' },
  error: { label: 'Ошибка', cls: 'text-danger bg-danger/10' },
  test_required: { label: 'Нужен тест', cls: 'text-warn bg-warn/10' },
  no_button: { label: 'Нет кнопки', cls: 'text-slate-400 bg-dark-400' },
  skipped: { label: 'Пропущена', cls: 'text-slate-400 bg-dark-400' },
}

const FILTERS = [
  { id: null, label: 'Все' },
  { id: 'new', label: 'Новые' },
  { id: 'applied', label: 'Откликнулись' },
  { id: 'error', label: 'Ошибки' },
  { id: 'test_required', label: 'Тест' },
]

export default function VacanciesPage({ onRefreshStats, token, visible }) {
  const [vacancies, setVacancies] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')

  const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {}

  const loadVacancies = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '500' })
      if (filter) params.set('status', filter)
      const r = await fetch(`${API}/db/vacancies?${params}`, { headers: authHeaders })
      if (r.ok) setVacancies(await r.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [filter, token])

  useEffect(() => { loadVacancies() }, [loadVacancies])
  useEffect(() => { if (visible) loadVacancies() }, [visible])

  const formatSalary = (v) => {
    if (!v.salary_from && !v.salary_to) return '—'
    const parts = []
    if (v.salary_from) parts.push(v.salary_from.toLocaleString('ru'))
    if (v.salary_to) parts.push(v.salary_to.toLocaleString('ru'))
    return parts.join(' – ') + ' ' + (v.salary_currency || '₽')
  }

  const formatDate = (d) => {
    if (!d) return ''
    return new Date(d).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const filtered = searchTerm.trim()
    ? vacancies.filter(v =>
        (v.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (v.company || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (v.location || '').toLowerCase().includes(searchTerm.toLowerCase())
      )
    : vacancies

  const counts = {}
  for (const v of vacancies) {
    counts[v.status] = (counts[v.status] || 0) + 1
  }

  return (
    <div className="p-4 sm:p-6 w-full space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">База вакансий</h2>
          <p className="text-sm text-slate-500 mt-0.5">{vacancies.length} записей в базе</p>
        </div>
        <button onClick={loadVacancies}
          className="px-3 py-1.5 text-xs bg-dark-500 text-slate-400 rounded-lg hover:bg-dark-400 hover:text-slate-200 transition">
          Обновить
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 sm:gap-2">
        {FILTERS.map(f => (
          <button key={f.id ?? 'all'} onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
              filter === f.id
                ? 'bg-accent text-white'
                : 'bg-dark-500 text-slate-400 hover:bg-dark-400 hover:text-slate-200'
            }`}>
            {f.label}
            {f.id === null ? ` (${vacancies.length})` : counts[f.id] ? ` (${counts[f.id]})` : ''}
          </button>
        ))}
        <div className="w-full sm:w-auto sm:ml-auto">
          <input
            type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="Поиск по названию..."
            className="px-3 py-2 sm:py-1.5 border border-dark-300 rounded-lg text-sm sm:text-xs w-full sm:w-56 focus:ring-2"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-dark-700 rounded-xl border border-dark-300 overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-2">
            {[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-dark-500 rounded animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-600">
            {vacancies.length === 0 ? 'База пуста. Запустите поиск или автопилот.' : 'Нет вакансий по фильтру'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-dark-300 text-xs text-slate-500 uppercase tracking-wider">
                  <th className="px-4 py-3 text-left w-10">#</th>
                  <th className="px-4 py-3 text-left">Вакансия</th>
                  <th className="px-4 py-3 text-left">Компания</th>
                  <th className="px-4 py-3 text-left">Город</th>
                  <th className="px-4 py-3 text-left">Зарплата</th>
                  <th className="px-4 py-3 text-left">Статус</th>
                  <th className="px-4 py-3 text-left">Найдена</th>
                  <th className="px-4 py-3 text-left w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-300">
                {filtered.map((v, i) => {
                  const st = STATUS_MAP[v.status] || { label: v.status, cls: 'text-slate-400 bg-dark-400' }
                  return (
                    <tr key={v.id} className="hover:bg-dark-600/50 transition">
                      <td className="px-4 py-2.5 text-slate-600 text-xs">{i + 1}</td>
                      <td className="px-4 py-2.5">
                        <div className="text-slate-200 max-w-xs truncate">{v.title}</div>
                        <div className="text-xs text-slate-600">{v.search_query}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-400 max-w-[150px] truncate">{v.company || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs max-w-[120px] truncate">{v.location || '—'}</td>
                      <td className="px-4 py-2.5 text-slate-400 text-xs">{formatSalary(v)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">{formatDate(v.found_at)}</td>
                      <td className="px-4 py-2.5">
                        <a href={v.url || `https://hh.ru/vacancy/${v.hh_id}`} target="_blank" rel="noreferrer"
                          className="text-accent hover:text-accent-hover text-xs transition">
                          →
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
