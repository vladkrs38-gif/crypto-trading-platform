import { useState, useRef } from 'react'

import { API } from '../config'

const STATUS_LABELS = {
  sent: '✅ Отклик отправлен',
  already_applied: '🔄 Уже откликались — пропуск',
  skipped_cache: '⏭ Пропуск (откликались < 24ч назад)',
  test_required: '📝 Нужен тест — пропущена',
  no_button: '⚠️ Нет кнопки отклика',
  error: '❌ Ошибка',
  cover_letter_filled: '✅ Письмо заполнено',
}

export default function MassApply({ vacancies, resume }) {
  const [browserStatus, setBrowserStatus] = useState(null) // null | 'launching' | 'open' | 'logged_in'
  const [applying, setApplying] = useState(false)
  const [progress, setProgress] = useState([]) // [{vacancy_id, title, status, step, letter_preview}]
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [total, setTotal] = useState(0)
  const [done, setDone] = useState(false)
  const abortRef = useRef(null)

  const checkBrowser = async () => {
    try {
      const r = await fetch(`${API}/browser/status`)
      const d = await r.json()
      if (d.logged_in) setBrowserStatus('logged_in')
      else if (d.browser) setBrowserStatus('open')
      else setBrowserStatus(null)
    } catch {
      setBrowserStatus(null)
    }
  }

  const launchBrowser = async () => {
    setBrowserStatus('launching')
    try {
      await fetch(`${API}/browser/launch`, { method: 'POST' })
      setBrowserStatus('open')
    } catch (e) {
      alert('Ошибка запуска браузера: ' + e.message)
      setBrowserStatus(null)
    }
  }

  const startMassApply = async () => {
    if (!resume?.trim()) {
      alert('Загрузите резюме')
      return
    }
    if (!vacancies.length) {
      alert('Нет вакансий для отклика')
      return
    }

    setApplying(true)
    setProgress([])
    setCurrentIndex(-1)
    setDone(false)
    setTotal(vacancies.length)

    const ids = vacancies.map((v) => v.id)

    try {
      const r = await fetch(`${API}/browser/mass-apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vacancy_ids: ids, resume_text: resume }),
      })

      const reader = r.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            handleEvent(data)
          } catch {}
        }
      }
    } catch (e) {
      alert('Ошибка: ' + e.message)
    } finally {
      setApplying(false)
      setDone(true)
    }
  }

  const handleEvent = (data) => {
    if (data.type === 'start') {
      setTotal(data.total)
    } else if (data.type === 'progress') {
      setCurrentIndex(data.index)
      setProgress((prev) => {
        const exists = prev.find((p) => p.vacancy_id === data.vacancy_id)
        if (exists) {
          return prev.map((p) =>
            p.vacancy_id === data.vacancy_id ? { ...p, ...data } : p
          )
        }
        return [...prev, data]
      })
    } else if (data.type === 'result') {
      setCurrentIndex(data.index)
      setProgress((prev) => {
        const filtered = prev.filter((p) => p.vacancy_id !== data.vacancy_id)
        return [...filtered, data]
      })
    } else if (data.type === 'done') {
      setDone(true)
    }
  }

  const sentCount = progress.filter((p) => p.status === 'sent' || p.status === 'cover_letter_filled').length
  const errorCount = progress.filter((p) => p.status === 'error').length
  const skipCount = progress.filter((p) => ['test_required', 'no_button', 'already_applied', 'skipped_cache'].includes(p.status)).length
  const pct = total > 0 ? Math.round(((currentIndex + 1) / total) * 100) : 0

  if (!vacancies.length) return null

  return (
    <div className="bg-white rounded-xl shadow p-4 mt-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">
        Массовый отклик ({vacancies.length} вакансий)
      </h3>

      {!browserStatus && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">
            Для автоотклика нужно войти в ваш аккаунт HH.ru через браузер Playwright.
          </p>
          <button
            type="button"
            onClick={launchBrowser}
            className="px-5 py-2 bg-slate-800 text-white font-medium rounded-lg hover:bg-slate-700 transition"
          >
            Открыть браузер для входа в HH
          </button>
          <button
            type="button"
            onClick={checkBrowser}
            className="ml-2 px-4 py-2 border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition text-sm"
          >
            Проверить статус
          </button>
        </div>
      )}

      {browserStatus === 'launching' && (
        <p className="text-sm text-amber-600">Запуск браузера...</p>
      )}

      {browserStatus === 'open' && (
        <div className="space-y-2">
          <p className="text-sm text-amber-600">
            Браузер открыт. Войдите в свой аккаунт на hh.ru (телефон + SMS).
          </p>
          <p className="text-sm text-slate-600">
            После успешного входа нажмите кнопку ниже:
          </p>
          <button
            type="button"
            onClick={checkBrowser}
            className="px-5 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition"
          >
            ✅ Я вошёл — проверить
          </button>
        </div>
      )}

      {browserStatus === 'logged_in' && !applying && !done && (
        <div className="space-y-2">
          <p className="text-sm text-green-600 font-medium">✅ Вы вошли в HH.ru</p>
          <button
            type="button"
            onClick={startMassApply}
            disabled={!resume?.trim()}
            className="px-6 py-3 bg-hh-red text-white font-bold rounded-lg hover:bg-red-700 disabled:opacity-50 transition text-base"
          >
            🚀 Откликнуться на все {vacancies.length} вакансий
          </button>
          <p className="text-xs text-slate-500">
            AI сгенерирует сопроводительное письмо для каждой вакансии и отправит отклик автоматически
          </p>
        </div>
      )}

      {(applying || done) && (
        <div className="space-y-3">
          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-sm text-slate-600 mb-1">
              <span>{applying ? 'Отправка откликов...' : 'Завершено!'}</span>
              <span>{Math.min(currentIndex + 1, total)} / {total} ({pct}%)</span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-3">
              <div
                className="bg-hh-red h-3 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="flex gap-4 text-sm">
            <span className="text-green-600">✅ Отправлено: {sentCount}</span>
            <span className="text-amber-600">⏭ Пропущено: {skipCount}</span>
            <span className="text-red-600">❌ Ошибок: {errorCount}</span>
          </div>

          {/* Results list */}
          <ul className="divide-y max-h-[400px] overflow-y-auto border rounded-lg">
            {progress.map((p, i) => (
              <li key={p.vacancy_id} className="px-3 py-2 text-sm flex items-start gap-2">
                <span className="shrink-0 w-6 text-slate-400">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800 truncate">{p.title || p.vacancy_id}</div>
                  {p.status ? (
                    <div className={`text-xs mt-0.5 ${p.status === 'sent' ? 'text-green-600' : p.status === 'error' ? 'text-red-600' : 'text-amber-600'}`}>
                      {STATUS_LABELS[p.status] || p.status}
                      {p.error && ` — ${p.error}`}
                    </div>
                  ) : (
                    <div className="text-xs text-blue-600 mt-0.5">
                      {p.step === 'checking' && '🔍 Проверка...'}
                      {p.step === 'fetching' && '⏳ Загрузка вакансии...'}
                      {p.step === 'generating_letter' && '🤖 Генерация письма...'}
                      {p.step === 'applying' && '📨 Отправка отклика...'}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {done && (
            <button
              type="button"
              onClick={() => { setDone(false); setProgress([]); setCurrentIndex(-1) }}
              className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition text-sm"
            >
              Сбросить
            </button>
          )}
        </div>
      )}
    </div>
  )
}
