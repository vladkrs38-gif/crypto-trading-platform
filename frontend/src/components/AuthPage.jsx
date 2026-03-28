import { useState } from 'react'
import { API } from '../config'

export default function AuthPage({ onAuth, onBack }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register'
      const body = mode === 'login'
        ? { email, password }
        : { email, password, name }
      const r = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (!r.ok) {
        setError(data.detail || 'Ошибка')
        return
      }
      onAuth(data.token, data.user)
    } catch (err) {
      setError('Ошибка соединения с сервером')
    } finally {
      setLoading(false)
    }
  }

  const inputClass =
    'w-full px-4 py-3.5 rounded-[12px] text-[15px] text-white placeholder:text-slate-600 bg-[#0d0d0d] border border-white/[0.1] outline-none transition focus:!border-orange-500/50 focus:!ring-2 focus:!ring-orange-500/25'

  return (
    <div className="landing-page min-h-screen flex flex-col overflow-y-auto">
      <header className="border-b border-white/[0.08] shrink-0 bg-[#0a0a0a]/95 backdrop-blur-md">
        <div className="max-w-[1420px] mx-auto px-5 sm:px-8 py-[14px] flex items-center justify-between">
          <button type="button" onClick={onBack} className="flex items-center gap-2.5 text-left group">
            <div className="w-9 h-9 rounded-[10px] bg-[#ff9500] flex items-center justify-center font-extrabold text-[13px] text-white shadow-[0_0_20px_rgba(255,149,0,0.35)]">KB</div>
            <span className="text-[17px] font-bold tracking-tight text-white group-hover:text-orange-200 transition">KlikBot</span>
          </button>
          <span className="text-[12px] text-slate-500 hidden sm:inline">AI-отклики на hh.ru</span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-5 sm:px-8 py-12 lg:py-16 relative">
        <div className="hero-glow absolute inset-0 top-0 opacity-60 pointer-events-none" aria-hidden />
        <div className="relative w-full max-w-[520px] lg:max-w-[560px]">
          <div className="text-center mb-8 lg:mb-10">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-semibold mb-6 border border-orange-500/35 text-orange-300/95 bg-orange-500/[0.06]">
              ✨ {mode === 'login' ? 'С возвращением' : 'Старт за пару минут'}
            </div>
            <h1 className="text-[clamp(1.65rem,4vw,2.25rem)] font-extrabold text-white tracking-tight leading-tight">
              {mode === 'login' ? 'Вход в аккаунт' : 'Регистрация'}
            </h1>
            <p className="text-[15px] text-slate-500 mt-3 leading-relaxed max-w-md mx-auto">
              {mode === 'login'
                ? 'Введите email и пароль — и сразу к откликам с AI-письмами.'
                : '20 бесплатных AI-откликов. Без карты — только email и пароль.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="rounded-[22px] border border-white/[0.1] bg-[#141414] p-7 sm:p-9 shadow-[0_24px_80px_rgba(0,0,0,0.45)] space-y-5">
            {mode === 'register' && (
              <div>
                <label className="block text-[12px] font-medium text-slate-500 uppercase tracking-wider mb-2">Имя</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Как вас зовут"
                  className={inputClass}
                />
              </div>
            )}
            <div>
              <label className="block text-[12px] font-medium text-slate-500 uppercase tracking-wider mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-slate-500 uppercase tracking-wider mb-2">Пароль</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'Минимум 6 символов' : 'Ваш пароль'}
                required
                minLength={mode === 'register' ? 6 : 1}
                className={inputClass}
              />
            </div>

            {error && (
              <div className="text-[14px] text-red-300 bg-red-500/10 border border-red-500/25 rounded-[12px] px-4 py-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 rounded-[14px] text-[16px] font-bold text-white bg-gradient-to-r from-[#ff8c00] to-[#ff9500] hover:brightness-105 disabled:opacity-50 disabled:pointer-events-none transition-[filter] shadow-[0_0_28px_rgba(255,140,0,0.4)]"
            >
              {loading ? 'Подождите...' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
            </button>
          </form>

          <div className="text-center mt-8">
            {mode === 'login' ? (
              <p className="text-[15px] text-slate-500">
                Нет аккаунта?{' '}
                <button
                  type="button"
                  onClick={() => { setMode('register'); setError('') }}
                  className="text-[#ff9500] font-semibold hover:text-[#ffb340] transition"
                >
                  Зарегистрироваться
                </button>
              </p>
            ) : (
              <p className="text-[15px] text-slate-500">
                Уже есть аккаунт?{' '}
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError('') }}
                  className="text-[#ff9500] font-semibold hover:text-[#ffb340] transition"
                >
                  Войти
                </button>
              </p>
            )}
          </div>

          <div className="text-center mt-6">
            <button
              type="button"
              onClick={onBack}
              className="text-[14px] text-slate-500 hover:text-slate-300 transition inline-flex items-center gap-2"
            >
              <span aria-hidden>←</span> На главную
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
