import { useState, useEffect } from 'react'
import { API } from '../config'

export default function AdminPage({ token }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [addCreditsModal, setAddCreditsModal] = useState(null)
  const [creditsAmount, setCreditsAmount] = useState(100)
  const [creditsReason, setCreditsReason] = useState('admin_topup')
  const [actionLoading, setActionLoading] = useState(false)
  const [deleteModal, setDeleteModal] = useState(null)
  const [passwordModal, setPasswordModal] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [expandedUser, setExpandedUser] = useState(null)
  const [subLoading, setSubLoading] = useState(null)
  const [subModal, setSubModal] = useState(null)
  const [customDays, setCustomDays] = useState(7)

  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }

  const fetchUsers = async () => {
    try {
      const r = await fetch(`${API}/admin/users`, { headers })
      if (r.ok) setUsers(await r.json())
    } catch {} finally { setLoading(false) }
  }

  useEffect(() => { fetchUsers() }, [])

  const handleAddCredits = async () => {
    if (!addCreditsModal) return
    setActionLoading(true)
    try {
      const r = await fetch(`${API}/admin/users/${addCreditsModal.id}/credits`, {
        method: 'POST', headers,
        body: JSON.stringify({ amount: creditsAmount, reason: creditsReason }),
      })
      if (r.ok) {
        await fetchUsers()
        setAddCreditsModal(null)
        setCreditsAmount(100)
      }
    } catch {} finally { setActionLoading(false) }
  }

  const handleDelete = async () => {
    if (!deleteModal) return
    setActionLoading(true)
    try {
      const r = await fetch(`${API}/admin/users/${deleteModal.id}`, { method: 'DELETE', headers })
      if (r.ok) {
        await fetchUsers()
        setDeleteModal(null)
      } else {
        const data = await r.json()
        alert(data.detail || 'Ошибка удаления')
      }
    } catch {} finally { setActionLoading(false) }
  }

  const handleResetPassword = async () => {
    if (!passwordModal || !newPassword) return
    setActionLoading(true)
    try {
      const r = await fetch(`${API}/admin/users/${passwordModal.id}/password`, {
        method: 'POST', headers,
        body: JSON.stringify({ new_password: newPassword }),
      })
      if (r.ok) {
        setPasswordModal(null)
        setNewPassword('')
        setShowPassword(false)
      } else {
        const data = await r.json()
        alert(data.detail || 'Ошибка')
      }
    } catch {} finally { setActionLoading(false) }
  }

  const handleSetSubscription = async (userId, days) => {
    setSubLoading(userId)
    try {
      let expiresAt = null
      if (days) {
        const user = users.find(u => u.id === userId)
        const sub = user ? getSubStatus(user) : { active: false }
        let base
        if (sub.active && user?.subscription_expires_at) {
          base = new Date(user.subscription_expires_at)
        } else {
          base = new Date()
        }
        expiresAt = new Date(base.getTime() + days * 86400000).toISOString().slice(0, 19)
      }
      const r = await fetch(`${API}/admin/users/${userId}/subscription`, {
        method: 'POST', headers,
        body: JSON.stringify({ expires_at: expiresAt }),
      })
      if (r.ok) {
        await fetchUsers()
        setSubModal(prev => prev?.id === userId ? { ...prev, subscription_expires_at: expiresAt } : prev)
      } else {
        const data = await r.json()
        alert(data.detail || 'Ошибка')
      }
    } catch {} finally { setSubLoading(null) }
  }

  const getSubStatus = (u) => {
    const exp = u.subscription_expires_at
    if (!exp) return { active: false, label: 'Нет', daysLeft: 0 }
    const d = new Date(exp)
    const now = new Date()
    if (d <= now) return { active: false, label: 'Истекла', daysLeft: 0 }
    const daysLeft = Math.ceil((d - now) / 86400000)
    return { active: true, label: `${daysLeft}д`, daysLeft }
  }

  const formatDate = (iso) => {
    if (!iso) return '-'
    return new Date(iso + 'Z').toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  const totalApplies = users.reduce((s, u) => s + (u.total_applies || 0), 0)
  const successfulApplies = users.reduce((s, u) => s + (u.successful_applies || 0), 0)

  return (
    <div className="p-4 sm:p-6 w-full space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl sm:text-2xl font-bold text-white">Администрирование</h2>
        <button onClick={fetchUsers}
          className="px-3 py-1.5 text-xs bg-dark-500 text-slate-400 rounded-lg hover:bg-dark-400 transition">
          Обновить
        </button>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-dark-700 rounded-xl border border-dark-300 p-4 text-center">
          <div className="text-2xl font-bold text-white">{users.length}</div>
          <div className="text-xs text-slate-400">Пользователей</div>
        </div>
        <div className="bg-dark-700 rounded-xl border border-dark-300 p-4 text-center">
          <div className="text-2xl font-bold text-accent">{users.filter(u => getSubStatus(u).active).length}</div>
          <div className="text-xs text-slate-400">С подпиской</div>
        </div>
        <div className="bg-dark-700 rounded-xl border border-dark-300 p-4 text-center">
          <div className="text-2xl font-bold text-success">{successfulApplies}</div>
          <div className="text-xs text-slate-400">Успешных откликов</div>
        </div>
        <div className="bg-dark-700 rounded-xl border border-dark-300 p-4 text-center">
          <div className="text-2xl font-bold text-slate-300">{totalApplies}</div>
          <div className="text-xs text-slate-400">Всего попыток</div>
        </div>
        <div className="bg-dark-700 rounded-xl border border-dark-300 p-4 text-center">
          <div className="text-2xl font-bold text-warn">{users.filter(u => !getSubStatus(u).active && u.credits <= 0).length}</div>
          <div className="text-xs text-slate-400">Без доступа</div>
        </div>
      </div>

      {/* Users table */}
      <div className="bg-dark-700 rounded-xl border border-dark-300 overflow-hidden">
        <div className="px-4 py-3 border-b border-dark-300">
          <h3 className="text-sm font-semibold text-white">Пользователи</h3>
        </div>
        {loading ? (
          <div className="p-8 text-center text-slate-500 text-sm">Загрузка...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 border-b border-dark-300">
                  <th className="text-left px-4 py-2.5 font-medium">ID</th>
                  <th className="text-left px-4 py-2.5 font-medium">Email</th>
                  <th className="text-left px-4 py-2.5 font-medium">Имя</th>
                  <th className="text-center px-4 py-2.5 font-medium">Подписка</th>
                  <th className="text-right px-4 py-2.5 font-medium">Кредиты</th>
                  <th className="text-right px-4 py-2.5 font-medium">Откликов</th>
                  <th className="text-left px-4 py-2.5 font-medium">Регистрация</th>
                  <th className="text-right px-4 py-2.5 font-medium">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-300">
                {users.map(u => (
                  <tr key={u.id} className={`hover:bg-dark-600 transition ${expandedUser === u.id ? 'bg-dark-600/50' : ''}`}>
                    <td className="px-4 py-2.5 text-slate-500">{u.id}</td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
                        className="text-slate-200 hover:text-accent transition text-left">
                        {u.email}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-slate-300">{u.name || '-'}</td>
                    <td className="px-4 py-2.5 text-center">
                      {(() => {
                        const sub = getSubStatus(u)
                        return (
                          <button
                            onClick={() => { setSubModal(u); setCustomDays(7) }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition hover:ring-2 hover:ring-accent/30 ${
                              sub.active
                                ? 'bg-success/15 text-success border border-success/20'
                                : 'bg-dark-500 text-slate-500 border border-dark-300 hover:text-slate-300'
                            }`}
                          >
                            {sub.active ? `${sub.daysLeft}д` : sub.label}
                          </button>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`text-xs ${u.credits > 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                        {u.credits}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="text-success font-medium">{u.successful_applies || 0}</span>
                      {u.total_applies > (u.successful_applies || 0) && (
                        <span className="text-slate-500 text-xs ml-1">/ {u.total_applies}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs">{formatDate(u.created_at)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => { setAddCreditsModal(u); setCreditsAmount(100) }}
                          className="px-2 py-1 text-xs bg-dark-500 text-slate-400 rounded-lg hover:bg-dark-400 transition"
                          title="Начислить кредиты"
                        >
                          +₽
                        </button>
                        <button
                          onClick={() => { setPasswordModal(u); setNewPassword(''); setShowPassword(false) }}
                          className="px-2 py-1 text-xs bg-accent/20 text-accent rounded-lg hover:bg-accent/30 transition"
                          title="Сменить пароль"
                        >
                          🔑
                        </button>
                        {!u.is_admin && (
                          <button
                            onClick={() => setDeleteModal(u)}
                            className="px-2 py-1 text-xs bg-danger/20 text-danger rounded-lg hover:bg-danger/30 transition"
                            title="Удалить пользователя"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add credits modal */}
      {addCreditsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setAddCreditsModal(null)}>
          <div className="bg-dark-700 rounded-2xl border border-dark-300 p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-1">Начислить кредиты</h3>
            <p className="text-sm text-slate-400 mb-5">{addCreditsModal.email} (баланс: {addCreditsModal.credits})</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Количество</label>
                <input
                  type="number"
                  value={creditsAmount}
                  onChange={e => setCreditsAmount(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-dark-600 border border-dark-300 rounded-lg text-sm text-white focus:ring-2 focus:ring-accent/40 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Причина</label>
                <select value={creditsReason} onChange={e => setCreditsReason(e.target.value)}
                  className="w-full px-3 py-2 bg-dark-600 border border-dark-300 rounded-lg text-sm text-white focus:ring-2 focus:ring-accent/40 outline-none">
                  <option value="admin_topup">Ручное пополнение</option>
                  <option value="payment">Оплата</option>
                  <option value="bonus">Бонус</option>
                  <option value="refund">Возврат</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleAddCredits} disabled={actionLoading || creditsAmount <= 0}
                className="flex-1 py-2.5 bg-success text-white font-semibold rounded-xl hover:bg-green-600 disabled:opacity-50 transition text-sm">
                {actionLoading ? 'Начисляем...' : `Начислить +${creditsAmount}`}
              </button>
              <button onClick={() => setAddCreditsModal(null)}
                className="px-4 py-2.5 bg-dark-500 text-slate-300 rounded-xl hover:bg-dark-400 transition text-sm">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete user modal */}
      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setDeleteModal(null)}>
          <div className="bg-dark-700 rounded-2xl border border-red-900/50 p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full bg-red-950/50 border border-red-900/30 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-white text-center mb-1">Удалить пользователя?</h3>
            <p className="text-sm text-slate-400 text-center mb-2">{deleteModal.email}</p>
            <div className="bg-red-950/20 border border-red-900/30 rounded-lg p-3 mb-5 text-xs text-red-300 space-y-1">
              <div>Будут удалены все данные:</div>
              <div className="text-red-400/80">• {deleteModal.total_applies || 0} откликов, {deleteModal.total_vacancies || 0} вакансий</div>
              <div className="text-red-400/80">• Транзакции и настройки</div>
              <div className="font-medium mt-1">Это действие необратимо.</div>
            </div>
            <div className="flex gap-3">
              <button onClick={handleDelete} disabled={actionLoading}
                className="flex-1 py-2.5 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 disabled:opacity-50 transition text-sm">
                {actionLoading ? 'Удаляем...' : 'Удалить навсегда'}
              </button>
              <button onClick={() => setDeleteModal(null)}
                className="px-4 py-2.5 bg-dark-500 text-slate-300 rounded-xl hover:bg-dark-400 transition text-sm">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subscription modal */}
      {subModal && (() => {
        const sub = getSubStatus(subModal)
        const expDate = subModal.subscription_expires_at
          ? new Date(subModal.subscription_expires_at).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })
          : null
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setSubModal(null)}>
            <div className="bg-dark-700 rounded-2xl border border-dark-300 p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold text-white mb-1">Подписка</h3>
              <p className="text-sm text-slate-400 mb-4">{subModal.email}</p>

              <div className={`rounded-xl p-3.5 mb-5 ${sub.active ? 'bg-success/10 border border-success/20' : 'bg-dark-600 border border-dark-300'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${sub.active ? 'bg-success' : 'bg-slate-600'}`} />
                  <span className={`text-sm font-semibold ${sub.active ? 'text-success' : 'text-slate-400'}`}>
                    {sub.active ? `Активна — ${sub.daysLeft} дн. осталось` : sub.label === 'Истекла' ? 'Подписка истекла' : 'Нет подписки'}
                  </span>
                </div>
                {expDate && (
                  <div className="text-xs text-slate-500 ml-4">
                    {sub.active ? `Истекает: ${expDate}` : `Истекла: ${expDate}`}
                  </div>
                )}
              </div>

              <div className="mb-4">
                <div className="text-xs font-medium text-slate-400 mb-2.5">
                  {sub.active ? 'Продлить подписку' : 'Добавить подписку'}
                </div>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={async () => { await handleSetSubscription(subModal.id, 7); await fetchUsers() }}
                    disabled={subLoading === subModal.id}
                    className="flex-1 py-2.5 bg-accent text-white font-semibold rounded-xl hover:bg-accent-hover disabled:opacity-50 transition text-sm"
                  >
                    {subLoading === subModal.id ? '...' : '+ 7 дней'}
                  </button>
                  <button
                    onClick={async () => { await handleSetSubscription(subModal.id, 14); await fetchUsers() }}
                    disabled={subLoading === subModal.id}
                    className="flex-1 py-2.5 bg-accent text-white font-semibold rounded-xl hover:bg-accent-hover disabled:opacity-50 transition text-sm"
                  >
                    {subLoading === subModal.id ? '...' : '+ 14 дней'}
                  </button>
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    value={customDays}
                    onChange={e => setCustomDays(Math.max(1, parseInt(e.target.value) || 1))}
                    min={1}
                    className="w-20 px-3 py-2 bg-dark-600 border border-dark-300 rounded-lg text-sm text-white text-center focus:ring-2 focus:ring-accent/40 outline-none"
                  />
                  <span className="text-xs text-slate-500 shrink-0">дней</span>
                  <button
                    onClick={async () => { await handleSetSubscription(subModal.id, customDays); await fetchUsers() }}
                    disabled={subLoading === subModal.id || customDays < 1}
                    className="flex-1 py-2 bg-dark-500 text-slate-200 text-sm font-medium rounded-lg hover:bg-dark-400 disabled:opacity-50 transition"
                  >
                    Добавить
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-dark-300">
                {sub.active ? (
                  <button
                    onClick={async () => { await handleSetSubscription(subModal.id, null); await fetchUsers() }}
                    disabled={subLoading === subModal.id}
                    className="px-3 py-2 text-xs text-danger hover:bg-danger/10 rounded-lg transition disabled:opacity-50"
                  >
                    Снять подписку
                  </button>
                ) : <span />}
                <button
                  onClick={() => setSubModal(null)}
                  className="px-5 py-2 bg-dark-500 text-slate-300 text-sm rounded-lg hover:bg-dark-400 transition"
                >
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Reset password modal */}
      {passwordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setPasswordModal(null)}>
          <div className="bg-dark-700 rounded-2xl border border-dark-300 p-6 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-1">Сменить пароль</h3>
            <p className="text-sm text-slate-400 mb-5">{passwordModal.email}</p>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Новый пароль</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Минимум 4 символа"
                  className="w-full px-3 py-2 pr-10 bg-dark-600 border border-dark-300 rounded-lg text-sm text-white focus:ring-2 focus:ring-accent/40 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition"
                >
                  {showPassword ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={handleResetPassword} disabled={actionLoading || newPassword.length < 4}
                className="flex-1 py-2.5 bg-accent text-white font-semibold rounded-xl hover:bg-accent-hover disabled:opacity-50 transition text-sm">
                {actionLoading ? 'Сохраняем...' : 'Сохранить пароль'}
              </button>
              <button onClick={() => { setPasswordModal(null); setNewPassword(''); setShowPassword(false) }}
                className="px-4 py-2.5 bg-dark-500 text-slate-300 rounded-xl hover:bg-dark-400 transition text-sm">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
