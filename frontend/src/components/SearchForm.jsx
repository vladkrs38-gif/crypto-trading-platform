import { useState } from 'react'

const AREAS = [
  { id: 113, name: 'Вся Россия' },
  { id: 54, name: 'Красноярск' },
]

export default function SearchForm({ onSearch, loading }) {
  const [text, setText] = useState('')
  const [area, setArea] = useState('113')
  const [salary, setSalary] = useState('')
  const [remote, setRemote] = useState(true)

  const handleSubmit = (e) => {
    e.preventDefault()
    onSearch({
      text: text.trim(),
      area: area ? parseInt(area) : undefined,
      salary: salary ? parseInt(salary) : undefined,
      schedule: remote ? 'remote' : undefined,
      perPage: 20,
      page: 0,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow p-4 flex flex-wrap gap-3 items-end">
      <div className="flex-1 min-w-[200px]">
        <label className="block text-sm font-medium text-slate-600 mb-1">Поиск</label>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="python, frontend, аналитик..."
          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-hh-red focus:border-transparent"
        />
      </div>
      <div className="w-48">
        <label className="block text-sm font-medium text-slate-600 mb-1">Город</label>
        <select
          value={area}
          onChange={(e) => setArea(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-hh-red focus:border-transparent"
        >
          <option value="">Любой</option>
          {AREAS.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <div className="w-32">
        <label className="block text-sm font-medium text-slate-600 mb-1">Зарплата от</label>
        <input
          type="number"
          value={salary}
          onChange={(e) => setSalary(e.target.value)}
          placeholder="100000"
          min={0}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-hh-red focus:border-transparent"
        />
      </div>
      <label className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer select-none pb-1">
        <input
          type="checkbox"
          checked={remote}
          onChange={(e) => setRemote(e.target.checked)}
          className="w-4 h-4 accent-hh-red rounded"
        />
        Удалёнка
      </label>
      <button
        type="submit"
        disabled={loading}
        className="px-5 py-2 bg-hh-red text-white font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {loading ? 'Поиск...' : 'Найти'}
      </button>
    </form>
  )
}
