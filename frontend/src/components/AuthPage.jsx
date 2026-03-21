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

  return (
    <div className="min-h-screen bg-dark-800 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center font-bold text-sm">HH</div>
            <span className="text-xl font-bold text-white">AutoPilot</span>
          </div>
          <h1 className="text-2xl font-bold text-white">
            {mode === 'login' ? 'Вход в аккаунт' : 'Регистрация'}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            {mode === 'login'
              ? 'Введите email и пароль'
              : '10 бесплатных откликов при регистрации'
            }
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-dark-700 rounded-2xl border border-dark-300 p-6 space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Имя</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Как вас зовут"
                className="w-full px-3.5 py-2.5 bg-dark-600 border border-dark-300 rounded-lg text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-accent focus:border-transparent transition"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full px-3.5 py-2.5 bg-dark-600 border border-dark-300 rounded-lg text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-accent focus:border-transparent transition"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'Минимум 6 символов' : 'Ваш пароль'}
              required
              minLength={mode === 'register' ? 6 : 1}
              className="w-full px-3.5 py-2.5 bg-dark-600 border border-dark-300 rounded-lg text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-accent focus:border-transparent transition"
            />
          </div>

          {error && (
            <div className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-accent text-white font-semibold rounded-xl hover:bg-accent-hover disabled:opacity-50 transition text-sm"
          >
            {loading ? 'Подождите...' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </button>
        </form>

        <div className="text-center mt-5">
          {mode === 'login' ? (
            <p className="text-sm text-slate-400">
              Нет аккаунта?{' '}
              <button onClick={() => { setMode('register'); setError('') }}
                className="text-accent hover:text-accent-hover font-medium transition">
                Зарегистрироваться
              </button>
            </p>
          ) : (
            <p className="text-sm text-slate-400">
              Уже есть аккаунт?{' '}
              <button onClick={() => { setMode('login'); setError('') }}
                className="text-accent hover:text-accent-hover font-medium transition">
                Войти
              </button>
            </p>
          )}
        </div>

        <div className="text-center mt-4">
          <button onClick={onBack} className="text-xs text-slate-500 hover:text-slate-300 transition">
            &#8592; На главную
          </button>
        </div>
      </div>
    </div>
  )
}
