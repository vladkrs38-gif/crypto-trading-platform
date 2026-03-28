import { useState, useEffect } from 'react'

export default function PaymentModal({ onClose, blocking, blockReason, onCheckCredits }) {
  const [checking, setChecking] = useState(false)
  const [checkFailed, setCheckFailed] = useState(false)

  useEffect(() => {
    if (!blocking) return
    const interval = setInterval(async () => {
      if (onCheckCredits) {
        const hasCredits = await onCheckCredits()
        if (hasCredits) onClose()
      }
    }, 15000)
    return () => clearInterval(interval)
  }, [blocking, onCheckCredits, onClose])

  const handleManualCheck = async () => {
    setChecking(true)
    setCheckFailed(false)
    try {
      if (onCheckCredits) {
        const hasCredits = await onCheckCredits()
        if (!hasCredits) {
          setCheckFailed(true)
          setTimeout(() => { setChecking(false); setCheckFailed(false) }, 2500)
        }
      }
    } catch {
      setCheckFailed(true)
      setTimeout(() => { setChecking(false); setCheckFailed(false) }, 2500)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={e => !blocking && e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl">
        <div className="bg-dark-800 border border-white/[0.06] rounded-3xl shadow-2xl overflow-hidden">
          <div className="p-6 sm:p-8">
            {blocking && (
              <div className="bg-danger/10 border border-danger/20 rounded-xl px-4 py-3 mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-3 h-3 bg-danger rounded-full animate-pulse shrink-0" />
                  <span className="text-danger font-semibold text-sm">
                    {blockReason === 'subscription_expired' ? 'Подписка истекла' : 'Отклики закончились'}
                  </span>
                </div>
                <div className="text-xs text-slate-400">
                  Для продолжения работы оформите подписку. Все операции приостановлены.
                </div>
              </div>
            )}

            <h2 className="text-xl sm:text-2xl font-extrabold text-white text-center mb-2">Простые тарифы</h2>
            <p className="text-center text-slate-500 text-sm mb-6">Без подвохов, без скрытых платежей</p>

            {/* Tariff cards */}
            <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
              {/* Старт */}
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5 flex flex-col">
                <div className="text-xs font-bold text-slate-500 mb-3">Старт</div>
                <div className="text-xl sm:text-2xl font-extrabold text-white mb-0.5">Бесплатно</div>
                <div className="text-xs text-slate-500 mb-4">при регистрации</div>
                <ul className="space-y-2 flex-1 mb-4 text-xs text-slate-300">
                  {['20 откликов', 'AI-подбор', 'AI-письма', 'Chrome'].map((f, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <span className="text-emerald-500">&#10003;</span> {f}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Стандарт */}
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5 flex flex-col">
                <div className="text-xs font-bold text-slate-500 mb-3">Стандарт</div>
                <div className="flex items-baseline gap-1 mb-0.5">
                  <span className="text-xl sm:text-2xl font-extrabold text-white">1 999</span>
                  <span className="text-sm text-slate-500">&#8381;</span>
                </div>
                <div className="text-xs text-slate-500 mb-4">7 дней бесплатно</div>
                <ul className="space-y-2 flex-1 mb-4 text-xs text-slate-300">
                  {['Безлимит', 'AI-подбор', 'AI-письма', 'Chrome', 'Автопилот'].map((f, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <span className="text-emerald-500">&#10003;</span> {f}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Про */}
              <div className="rounded-2xl border-2 border-orange-500/25 bg-orange-500/[0.04] p-4 sm:p-5 flex flex-col relative">
                <div className="absolute -top-2.5 right-3 sm:right-4 px-3 py-0.5 rounded-full bg-gradient-to-r from-orange-500 to-amber-500 text-white text-[10px] font-bold shadow-lg shadow-orange-500/30">
                  Выгодно
                </div>
                <div className="text-xs font-bold text-orange-400 mb-3">Про</div>
                <div className="flex items-baseline gap-1 mb-0.5">
                  <span className="text-xl sm:text-2xl font-extrabold text-white">3 499</span>
                  <span className="text-sm text-slate-500">&#8381;</span>
                </div>
                <div className="text-xs text-slate-500 mb-4">14 дней бесплатно</div>
                <ul className="space-y-2 flex-1 mb-4 text-xs text-slate-300">
                  {['Безлимит', 'AI-подбор', 'AI-письма', 'Chrome', 'Автопилот', 'Поддержка'].map((f, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <span className="text-emerald-500">&#10003;</span> {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Payment info */}
            <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-4 mb-5">
              <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Оплата переводом</div>
              <div className="bg-dark-900 rounded-lg p-3 flex items-center justify-between mb-2">
                <div>
                  <div className="text-[11px] text-slate-500 mb-0.5">Сбербанк / Тинькофф / СБП</div>
                  <div className="text-white font-mono font-bold text-lg tracking-wider">8-902-927-25-52</div>
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText('89029272552')
                    const btn = document.getElementById('copy-phone-btn')
                    if (btn) { btn.textContent = 'Готово!'; setTimeout(() => btn.textContent = 'Копировать', 1500) }
                  }}
                  id="copy-phone-btn"
                  className="px-4 py-2 bg-gradient-to-r from-orange-500 to-amber-500 text-white text-xs font-bold rounded-lg hover:from-orange-600 hover:to-amber-600 transition shrink-0 shadow-md shadow-orange-500/20"
                >
                  Копировать
                </button>
              </div>
              <p className="text-[11px] text-slate-600">
                После перевода напишите по этому же номеру — подписка будет активирована в течение нескольких минут.
              </p>
            </div>

            {/* Actions */}
            {blocking ? (
              <div className="space-y-2">
                <button
                  onClick={handleManualCheck}
                  disabled={checking}
                  className={`w-full py-3.5 font-bold rounded-xl transition text-sm ${
                    checkFailed
                      ? 'bg-danger/15 text-danger border border-danger/20'
                      : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 shadow-lg shadow-orange-500/20'
                  } disabled:opacity-60`}
                >
                  {checkFailed ? 'Оплата пока не поступила' : checking ? 'Проверяем...' : 'Проверить оплату'}
                </button>
                <p className="text-center text-[11px] text-slate-600">
                  После оплаты и начисления нажмите кнопку выше
                </p>
              </div>
            ) : (
              <button
                onClick={onClose}
                className="w-full py-3 bg-white/[0.06] border border-white/[0.08] text-white font-bold rounded-xl hover:bg-white/[0.1] transition text-sm"
              >
                Закрыть
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
