import { useState } from 'react'

const NAV = [
  { id: 'dashboard', label: 'Дашборд', icon: '◈' },
  { id: 'search', label: 'Поиск и отклик', icon: '⊕' },
  { id: 'vacancies', label: 'База вакансий', icon: '☰' },
  { id: 'autopilot', label: 'Автопилот', icon: '⟐', disabled: true },
]

export default function Sidebar({ currentPage, onNavigate, stats, isOpen, onClose, extensionConnected, userCode, user, onLogout, onShowPayment }) {
  const [showInstall, setShowInstall] = useState(false)

  const subExpires = user?.subscription_expires_at
  const hasActiveSub = subExpires && new Date(subExpires + (subExpires.includes('Z') ? '' : 'Z')) > new Date()
  const daysLeft = hasActiveSub
    ? Math.max(0, Math.ceil((new Date(subExpires + (subExpires.includes('Z') ? '' : 'Z')) - new Date()) / 864e5))
    : 0

  const credits = user?.credits ?? 0
  const pct = Math.min(100, credits / 20 * 100)
  const isLow = credits <= 10 && credits > 5
  const isCritical = credits <= 5 && credits > 0
  const isEmpty = credits <= 0

  return (
    <aside className={`
      fixed md:relative inset-y-0 left-0 z-50 w-64 md:w-64
      bg-dark-800 border-r border-dark-300 flex flex-col shrink-0
      transform transition-transform duration-200 ease-out
      md:translate-x-0
      ${isOpen ? 'translate-x-0' : '-translate-x-full'}
    `}>
      <div className="px-5 py-5 border-b border-dark-300 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold text-white tracking-tight">HH AutoPilot</h1>
          <p className="text-xs text-slate-500 mt-0.5">AI-автоматизация откликов</p>
        </div>
        <button
          onClick={onClose}
          className="md:hidden p-2 -mr-2 text-slate-500 hover:text-white rounded-lg transition"
          aria-label="Закрыть меню"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Subscription / Credits display */}
      {user && (
        <div className="px-3 pt-3">
          {hasActiveSub ? (
            <div className="rounded-lg px-3 py-2.5 bg-success/10 border border-success/20">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Подписка активна</span>
                <span className="text-sm font-bold text-success">Активна</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Осталось {daysLeft} {daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'}
              </div>
              {credits > 0 && (
                <div className="text-[10px] text-slate-600 mt-1">
                  + {credits} бесплатных откликов
                </div>
              )}
            </div>
          ) : (
            <div className={`rounded-lg px-3 py-2.5 ${
              isEmpty ? 'bg-danger/10 border border-danger/20'
                : isCritical ? 'bg-danger/10 border border-danger/20'
                : isLow ? 'bg-warn/10 border border-warn/20'
                : 'bg-accent/10 border border-accent/20'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Бесплатные отклики</span>
                <span className={`text-lg font-bold transition-all ${
                  isEmpty ? 'text-danger animate-pulse'
                    : isCritical ? 'text-danger'
                    : isLow ? 'text-warn'
                    : 'text-accent'
                }`}>{credits}</span>
              </div>
              <div className="mt-2 h-1.5 bg-dark-500 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${
                  isEmpty ? 'bg-danger animate-pulse'
                    : isCritical ? 'bg-danger'
                    : isLow ? 'bg-warn'
                    : 'bg-accent'
                }`} style={{ width: `${pct}%` }} />
              </div>
              <div className={`text-xs mt-1.5 ${
                isEmpty || isCritical ? 'text-danger/80'
                  : isLow ? 'text-warn/80'
                  : 'text-slate-500'
              }`}>
                {isEmpty ? 'Отклики закончились'
                  : isCritical ? 'Почти закончились!'
                  : isLow ? 'Отклики заканчиваются'
                  : 'Бесплатный тариф'}
              </div>
              <button onClick={onShowPayment}
                className="w-full mt-2.5 py-2.5 text-xs font-bold rounded-lg transition-all bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:from-orange-600 hover:to-amber-600 shadow-lg shadow-orange-500/20 hover:shadow-orange-500/30">
                Купить подписку
              </button>
            </div>
          )}
        </div>
      )}

      {/* Extension download */}
      <div className="px-3 pb-1">
        <a href="/hh-autopilot-extension.zip" download
          className="flex items-center gap-2 px-3 py-2 text-xs text-slate-500 hover:text-slate-300 hover:bg-dark-600 rounded-lg transition">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Скачать расширение
        </a>
        <button onClick={() => setShowInstall(!showInstall)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-600 hover:text-slate-400 transition w-full">
          <svg className={`w-3 h-3 shrink-0 transition-transform ${showInstall ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          Как установить?
        </button>
        {showInstall && (
          <div className="mx-1 mt-1 p-3 bg-dark-600 rounded-lg text-xs text-slate-400 space-y-3">
            <div>
              <div className="text-slate-300 font-medium mb-1.5">Google Chrome / Яндекс Браузер</div>
              <ol className="space-y-1 list-decimal list-inside">
                <li>Скачайте ZIP и распакуйте</li>
                <li>Откройте <span className="text-slate-300">chrome://extensions</span></li>
                <li>Включите <span className="text-slate-300">«Режим разработчика»</span></li>
                <li>Нажмите <span className="text-slate-300">«Загрузить распакованное»</span></li>
                <li>Выберите распакованную папку</li>
              </ol>
            </div>
            <div className="border-t border-dark-300 pt-2 text-slate-500">
              После установки обновите эту страницу.
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 py-3 px-3 space-y-0.5">
        {NAV.map((item) => (
          <button
            key={item.id}
            onClick={() => !item.disabled && onNavigate(item.id)}
            disabled={item.disabled}
            className={`w-full flex items-center gap-3 px-3 py-3 sm:py-2.5 rounded-lg text-sm sm:text-base font-medium transition-all ${
              item.disabled
                ? 'text-slate-600 cursor-not-allowed opacity-50'
                : currentPage === item.id
                  ? 'bg-accent/15 text-accent-hover'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-dark-500'
            }`}
          >
            <span className="text-base opacity-70">{item.icon}</span>
            {item.label}
            {item.disabled && (
              <span className="ml-auto text-[10px] bg-dark-400 text-slate-500 px-1.5 py-0.5 rounded">скоро</span>
            )}
          </button>
        ))}
        {user?.is_admin && (
          <button
            onClick={() => onNavigate('admin')}
            className={`w-full flex items-center gap-3 px-3 py-3 sm:py-2.5 rounded-lg text-sm sm:text-base font-medium transition-all ${
              currentPage === 'admin'
                ? 'bg-accent/15 text-accent-hover'
                : 'text-slate-400 hover:text-slate-200 hover:bg-dark-500'
            }`}
          >
            <span className="text-base opacity-70">&#9881;</span>
            Админ
          </button>
        )}
      </nav>

      {/* Extension status */}
      <div className="px-3 py-3 border-t border-dark-300">
        {extensionConnected ? (
          <div className="rounded-lg p-3 bg-success/10">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2.5 h-2.5 rounded-full bg-success animate-pulse shrink-0" />
              <span className="text-xs font-medium text-success">Расширение подключено</span>
            </div>
            <div className="text-xs text-success/70 mb-2">Готов к откликам через браузер</div>
            {userCode && (
              <div className="flex items-center gap-2 bg-dark-600 rounded px-2.5 py-1.5">
                <span className="text-xs text-slate-500">Код:</span>
                <span className="text-xs font-mono font-bold text-accent-hover tracking-wider">{userCode}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg p-3 bg-dark-600">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-dark-200" />
              <span className="text-xs font-medium text-slate-400">Расширение не найдено</span>
            </div>
            <div className="text-xs text-slate-500">Установите расширение для откликов</div>
          </div>
        )}
      </div>

      {/* Stats */}
      {stats && (
        <div className="px-3 pb-3">
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <div className="bg-dark-600 rounded-lg px-2.5 py-2">
              <div className="text-slate-500">Всего</div>
              <div className="text-white font-bold text-sm">{stats.total}</div>
            </div>
            <div className="bg-dark-600 rounded-lg px-2.5 py-2">
              <div className="text-slate-500">Отклики</div>
              <div className="text-success font-bold text-sm">{stats.applied}</div>
            </div>
            <div className="bg-dark-600 rounded-lg px-2.5 py-2">
              <div className="text-slate-500">Новые</div>
              <div className="text-accent-hover font-bold text-sm">{stats.new}</div>
            </div>
            <div className="bg-dark-600 rounded-lg px-2.5 py-2">
              <div className="text-slate-500">Сегодня</div>
              <div className="text-warn font-bold text-sm">{stats.today_applied}</div>
            </div>
          </div>
        </div>
      )}

      {/* User info + logout */}
      {user && (
        <div className="px-3 py-2 border-t border-dark-300">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center text-accent text-xs font-bold shrink-0">
              {(user.name || user.email)[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-slate-300 truncate">{user.name || user.email}</div>
              {user.name && <div className="text-[10px] text-slate-500 truncate">{user.email}</div>}
            </div>
            <button onClick={onLogout} title="Выйти"
              className="p-1.5 text-slate-500 hover:text-danger rounded transition shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
