export default function PaymentModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-dark-700 border border-dark-300 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center text-accent text-lg">
              &#9733;
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Пополнение откликов</h2>
              <p className="text-xs text-slate-500">100 откликов — 1 000 ₽</p>
            </div>
          </div>

          <div className="bg-dark-600 rounded-xl p-4 space-y-3 mb-5">
            <div className="text-sm text-slate-300">
              Переведите нужную сумму по номеру телефона или карты:
            </div>
            <div className="bg-dark-800 rounded-lg p-3 flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-500 mb-0.5">Телефон / Сбербанк / Тинькофф</div>
                <div className="text-white font-mono font-semibold tracking-wide">8-902-927-25-52</div>
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText('89029272552')
                  const btn = document.getElementById('copy-phone-btn')
                  if (btn) { btn.textContent = 'Скопировано!'; setTimeout(() => btn.textContent = 'Копировать', 1500) }
                }}
                id="copy-phone-btn"
                className="px-3 py-1.5 bg-accent/20 text-accent text-xs font-medium rounded-lg hover:bg-accent/30 transition shrink-0"
              >
                Копировать
              </button>
            </div>
            <div className="text-sm text-slate-400">
              После перевода напишите или позвоните по этому же номеру — кредиты будут начислены в течение нескольких минут.
            </div>
          </div>

          <div className="bg-accent/5 border border-accent/15 rounded-xl p-3 mb-5">
            <div className="text-xs text-slate-400 space-y-1">
              <div className="text-accent font-medium mb-1.5">Тарифы:</div>
              <div className="flex justify-between"><span>20 откликов</span><span className="text-white font-medium">200 ₽</span></div>
              <div className="flex justify-between"><span>50 откликов</span><span className="text-white font-medium">500 ₽</span></div>
              <div className="flex justify-between"><span>100 откликов</span><span className="text-accent font-semibold">1 000 ₽</span></div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full py-3 bg-dark-500 text-slate-300 font-medium rounded-xl hover:bg-dark-400 transition text-sm"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
