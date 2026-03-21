export default function VacancyList({ vacancies, loading, selectedId, onSelect }) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow p-6">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 bg-slate-200 rounded" />
          ))}
        </div>
      </div>
    )
  }

  if (!vacancies.length) {
    return (
      <div className="bg-white rounded-xl shadow p-6 text-center text-slate-500">
        Введите запрос и нажмите «Найти»
      </div>
    )
  }

  const formatSalary = (s) => {
    if (!s) return null
    const parts = []
    if (s.from) parts.push(s.from.toLocaleString('ru-RU'))
    if (s.to) parts.push(s.to.toLocaleString('ru-RU'))
    if (!parts.length) return null
    return parts.join(' – ') + ' ₽'
  }

  return (
    <div className="bg-white rounded-xl shadow overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b font-medium text-slate-700">
        Найдено вакансий
      </div>
      <ul className="divide-y max-h-[600px] overflow-y-auto">
        {vacancies.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              onClick={() => onSelect(v)}
              className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition ${
                selectedId === v.id ? 'bg-red-50 border-l-4 border-hh-red' : ''
              }`}
            >
              <div className="font-medium text-slate-900 line-clamp-2">{v.name}</div>
              <div className="text-sm text-slate-500 mt-0.5">{v.employer?.name}</div>
              {formatSalary(v.salary) && (
                <div className="text-sm text-green-600 mt-0.5">{formatSalary(v.salary)}</div>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
