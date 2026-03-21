import { useRef, useState } from 'react'

import { API } from '../config'
const AREAS = [
  { id: 113, name: 'Вся Россия' },
  { id: 54, name: 'Красноярск' },
]

export default function ResumeSection({ resume, setResume, onSearchByResume, loading }) {
  const fileInputRef = useRef(null)
  const [area, setArea] = useState(54)
  const [remoteOnly, setRemoteOnly] = useState(true)

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
        const r = await fetch(`${API}/extract-resume`, { method: 'POST', body: fd })
        const data = await r.json()
        if (r.ok) setResume(data.text || '')
        else alert(data.detail || 'Ошибка загрузки PDF')
      } catch (err) {
        alert('Ошибка: ' + err.message)
      }
      return
    }

    alert('Поддерживаются только .txt и .pdf')
    e.target.value = ''
  }

  const saveResume = () => {
    localStorage.setItem('hh-resume', resume)
  }

  return (
    <div className="bg-white rounded-xl shadow p-4 mb-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Ваше резюме</h3>
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.pdf"
          onChange={handleFileChange}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 border-2 border-slate-300 text-slate-700 font-medium rounded-lg hover:border-hh-red hover:text-hh-red transition"
        >
          📄 Загрузить резюме (TXT/PDF)
        </button>
        <span className="text-sm text-slate-500">или вставьте текст ниже</span>
      </div>
      <textarea
        value={resume}
        onChange={(e) => setResume(e.target.value)}
        onBlur={saveResume}
        placeholder="Вставьте текст резюме или загрузите файл..."
        rows={4}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-hh-red focus:border-transparent text-sm mb-3"
      />
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={area}
          onChange={(e) => setArea(parseInt(e.target.value))}
          className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-hh-red text-sm"
        >
          {AREAS.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remoteOnly}
            onChange={(e) => setRemoteOnly(e.target.checked)}
            className="w-4 h-4 accent-hh-red rounded"
          />
          Только удалёнка
        </label>
        <button
          type="button"
          onClick={() => onSearchByResume(resume, area, remoteOnly)}
          disabled={loading || !resume.trim()}
          className="px-5 py-2 bg-hh-red text-white font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {loading ? 'Поиск...' : '🤖 Подобрать вакансии по резюме'}
        </button>
        <span className="text-xs text-slate-500">
          ИИ изучит резюме, подберёт запрос и найдёт подходящие вакансии
        </span>
      </div>
    </div>
  )
}
