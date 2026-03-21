import { useState } from 'react'

import { API } from '../config'

export default function VacancyDetail({ vacancy, resume = '', setResume = () => {}, onClose }) {
  const [letter, setLetter] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const saveResume = () => {
    localStorage.setItem('hh-resume', resume)
  }

  const generateLetter = async () => {
    if (!resume.trim()) {
      setError('Введите текст резюме')
      return
    }
    if (!vacancy) return
    setLoading(true)
    setError('')
    try {
      const r = await fetch(`${API}/generate-letter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vacancy, resume_text: resume }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || 'Ошибка')
      setLetter(data.letter)
      saveResume()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const copyLetter = async () => {
    if (!letter) return
    try {
      await navigator.clipboard.writeText(letter)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Не удалось скопировать')
    }
  }

  const openOnHH = () => {
    if (vacancy?.id) {
      window.open(`https://hh.ru/vacancy/${vacancy.id}`, '_blank')
    }
  }

  const formatSalary = (s) => {
    if (!s) return 'Зарплата не указана'
    const parts = []
    if (s.from) parts.push(s.from.toLocaleString('ru-RU'))
    if (s.to) parts.push(s.to.toLocaleString('ru-RU'))
    return parts.join(' – ') + ' ₽'
  }

  if (!vacancy) {
    return (
      <div className="bg-white rounded-xl shadow p-12 text-center text-slate-500">
        Выберите вакансию для генерации сопроводительного письма
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow overflow-hidden flex flex-col max-h-[800px]">
      <div className="p-4 border-b flex justify-between items-start">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{vacancy.name}</h2>
          <p className="text-slate-600">{vacancy.employer?.name}</p>
          <p className="text-green-600 font-medium">{formatSalary(vacancy.salary)}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Резюме */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Ваше резюме (загрузите выше или отредактируйте)</label>
          <textarea
            value={resume}
            onChange={(e) => setResume(e.target.value)}
            onBlur={saveResume}
            placeholder="Скопируйте сюда текст своего резюме с hh.ru или введите вручную..."
            rows={5}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-hh-red focus:border-transparent text-sm"
          />
        </div>

        <button
          type="button"
          onClick={generateLetter}
          disabled={loading || !resume.trim()}
          className="w-full py-3 bg-hh-red text-white font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {loading ? 'Генерация...' : 'Сгенерировать письмо'}
        </button>

        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        {letter && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Сопроводительное письмо</label>
            <div className="p-4 bg-slate-50 rounded-lg text-slate-800 whitespace-pre-wrap text-sm">
              {letter}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={copyLetter}
                className="flex-1 py-2 bg-slate-800 text-white font-medium rounded-lg hover:bg-slate-700 transition"
              >
                {copied ? 'Скопировано!' : 'Скопировать письмо'}
              </button>
              <button
                type="button"
                onClick={openOnHH}
                className="flex-1 py-2 border-2 border-hh-red text-hh-red font-medium rounded-lg hover:bg-red-50 transition"
              >
                Открыть на HH →
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Письмо скопировано. Откройте вакансию на HH и вставьте его в поле сопроводительного письма (Ctrl+V).
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
