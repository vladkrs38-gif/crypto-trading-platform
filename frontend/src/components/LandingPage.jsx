import { useState, useEffect, useRef } from 'react'

const faqItems = [
  {
    q: 'Не забанят ли меня на hh.ru?',
    a: 'Нет. KlikBot работает через официальный интерфейс hh.ru и соблюдает разумные паузы между откликами. Ваш аккаунт в безопасности.',
  },
  {
    q: 'Как работает AI-генерация писем?',
    a: 'AI анализирует текст вакансии и ваше резюме, затем генерирует уникальное сопроводительное письмо, подчёркивающее ваш релевантный опыт и навыки.',
  },
  {
    q: 'Нужно ли держать компьютер включённым?',
    a: 'Для работы расширения — да, Chrome должен быть открыт. Но процесс полностью автоматический: запустили и занимаетесь своими делами.',
  },
  {
    q: 'Сколько бесплатных откликов?',
    a: '20 откликов при регистрации. Этого достаточно, чтобы оценить качество AI-писем и получить первые звонки.',
  },
  {
    q: 'Как быстро придут ответы?',
    a: 'Первые ответы обычно приходят в течение 1–3 дней. Благодаря персональным письмам конверсия значительно выше обычных откликов.',
  },
]

const features = [
  { title: 'AI-подбор вакансий', desc: 'Нейросеть подберет оптимальные запросы по вашему резюме', Icon: IconTarget, iconClass: 'text-sky-400' },
  { title: 'Массовый отклик', desc: 'Сотни откликов одним кликом — за минуты, не за месяцы', Icon: IconRocket, iconClass: 'text-orange-400' },
  { title: 'AI-письма', desc: 'Уникальное сопроводительное под каждую вакансию', Icon: IconDoc, iconClass: 'text-violet-400' },
  { title: 'Оценка совпадения', desc: 'Процент соответствия резюме и вакансии до отправки', Icon: IconChart, iconClass: 'text-emerald-400' },
  { title: 'Умные фильтры', desc: 'Удаленка, зарплата, город, опыт — точная настройка', Icon: IconFunnel, iconClass: 'text-cyan-400' },
  { title: 'База откликов', desc: 'Вся история, статусы, письма и аналитика', Icon: IconFile, iconClass: 'text-pink-400' },
  { title: 'Chrome расширение', desc: 'Работает в вашем браузере — безопасно и надежно', Icon: IconChrome, iconClass: 'text-yellow-400' },
  { title: 'Автопилот', desc: 'Автоматический поиск и отклик по расписанию', Icon: IconBot, iconClass: 'text-blue-400' },
]

const articles = [
  {
    date: '27 марта 2024 г.',
    title: 'Тренды 2024: AI и автоматизация в поиске работы в России',
    desc: 'Как искусственный интеллект и автоматизация откликов меняют стратегию поиска работы для российских...',
  },
  {
    date: '27 марта 2024 г.',
    title: 'Нейросеть пишет сопроводительные письма для hh.ru: миф или реальность?',
    desc: 'Создание убедительного сопроводительного письма для каждой вакансии на hh.ru теперь можно доверить...',
  },
  {
    date: '27 марта 2024 г.',
    title: 'AI-отклики на hh.ru: как нейросеть находит вакансии за вас',
    desc: 'Искусственный интеллект меняет правила игры для соискателей, автоматизируя поиск и отклик на релевантные вакансии...',
  },
]

function IconTarget({ className }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
    </svg>
  )
}
function IconRocket({ className }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  )
}
function IconDoc({ className }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="14" y2="17" />
    </svg>
  )
}
function IconChart({ className }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}
function IconFunnel({ className }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
    </svg>
  )
}
function IconFile({ className }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  )
}
function IconChrome({ className }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" />
      <path d="M21.17 8H12M3.95 6.06l8.16 14.12M12 12L3.95 6.06" />
    </svg>
  )
}
function IconBot({ className }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="8" width="14" height="10" rx="2" /><path d="M9 8V6a3 3 0 0 1 6 0v2" />
      <circle cx="9" cy="13" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="13" r="1" fill="currentColor" stroke="none" />
      <path d="M9 18v2h6v-2" />
    </svg>
  )
}

export default function LandingPage({ onGoToAuth }) {
  const [openFaq, setOpenFaq] = useState(null)
  const containerRef = useRef(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    )
    const els = containerRef.current?.querySelectorAll('.reveal')
    els?.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="landing-page min-h-screen overflow-y-auto">

      {/* Header */}
      <header className="border-b border-white/[0.08] sticky top-0 z-50 bg-[#0a0a0a]/92 backdrop-blur-md">
        <div className="max-w-[1420px] mx-auto px-5 sm:px-8 py-[14px] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-[10px] bg-[#ff9500] flex items-center justify-center font-extrabold text-[13px] text-white shadow-[0_0_20px_rgba(255,149,0,0.35)]">KB</div>
            <span className="text-[17px] font-bold tracking-tight text-white">KlikBot</span>
          </div>
          <div className="flex items-center gap-5 text-[13px]">
            <span className="hidden lg:flex items-center gap-1 text-slate-400 whitespace-nowrap">
              <span className="text-[#ff9500] font-medium">Оплата:</span>
              <span className="text-slate-300">8-902-927-25-52</span>
              <span className="text-slate-500">Сбер / Тинькофф</span>
            </span>
            <a href="https://t.me/VIP_KRS" target="_blank" rel="noopener"
              className="hidden sm:inline-flex items-center gap-1 text-[#ff9500] font-medium hover:text-[#ffb340] transition">
              @VIP_KRS
            </a>
            <button type="button" onClick={onGoToAuth}
              className="px-[18px] py-2 bg-[#1a1a1a] text-white text-[13px] font-medium rounded-[10px] border border-white/10 hover:bg-[#222] hover:border-white/15 transition">
              Войти
            </button>
          </div>
        </div>
      </header>

      {/* Hero — ширина как у тарифов */}
      <section className="relative max-w-[1420px] mx-auto px-5 sm:px-8 pt-[56px] sm:pt-[88px] pb-[64px] sm:pb-[80px] text-center">
        <div className="hero-glow absolute inset-0 -top-20 opacity-100" />
        <div className="relative max-w-[1320px] mx-auto">
          <div className="hero-enter hero-enter-d1 inline-flex items-center gap-2.5 px-5 sm:px-6 py-2.5 sm:py-3 rounded-full text-[13px] sm:text-[15px] font-semibold mb-8 sm:mb-10 border border-orange-500/45 text-orange-300 bg-orange-500/[0.08] tracking-tight">
            <span className="text-base sm:text-lg" aria-hidden>✨</span> AI-автоматизация откликов на hh.ru
          </div>
          <h1 className="hero-enter hero-enter-d2 text-white font-extrabold leading-[1.08] tracking-[-0.02em] mb-7 sm:mb-9
            text-[clamp(2rem,5.5vw,2.85rem)] sm:text-[clamp(2.35rem,6.2vw,3.6rem)] lg:text-[clamp(2.75rem,5vw,4.25rem)]">
            Получай звонки<br className="hidden sm:block" /> от работодателей,<br />
            <span className="bg-gradient-to-r from-[#ff9500] via-[#ff8c00] to-[#fbbf24] bg-clip-text text-transparent">а не тишину</span>
          </h1>
          <p className="hero-enter hero-enter-d3 text-[16px] sm:text-[18px] lg:text-[20px] text-slate-400 max-w-[min(920px,96vw)] mx-auto mb-11 sm:mb-14 leading-[1.5] sm:leading-[1.6]">
            AI пишет <span className="text-white font-semibold">уникальное сопроводительное письмо</span> под каждую
            вакансию. Именно поэтому работодатели звонят вам, а не другим.
          </p>
          <div className="hero-enter hero-enter-d4">
            <button type="button" onClick={onGoToAuth}
              className="cta-glow inline-flex items-center justify-center min-h-[56px] sm:min-h-[64px] lg:min-h-[72px] px-10 sm:px-14 lg:px-16 py-[17px] sm:py-[19px] bg-gradient-to-r from-[#ff8c00] to-[#ff9500] text-white text-[17px] sm:text-[19px] lg:text-[21px] font-bold rounded-[16px] sm:rounded-[18px] hover:brightness-105 transition-[filter] shadow-[0_0_32px_rgba(255,140,0,0.5)] sm:shadow-[0_0_40px_rgba(255,140,0,0.55)]">
              Начать бесплатно — 20 откликов&nbsp;→
            </button>
            <p className="text-[13px] sm:text-[14px] text-slate-500 mt-5 sm:mt-6">Без привязки карты. Результат через 10 минут.</p>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="reveal max-w-[1420px] mx-auto px-5 sm:px-8 pb-[80px] lg:pb-[88px]">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-0 divide-y divide-white/[0.06] lg:divide-y-0 lg:divide-x lg:divide-white/[0.08]">
          {[
            { num: '5 000+', label: 'вакансий за поиск', color: 'text-[#ff9500]' },
            { num: '< 2 мин', label: 'на 100 откликов', color: 'text-cyan-400' },
            { num: '100%', label: 'уникальные письма', color: 'text-violet-400' },
            { num: '3 сек', label: 'на одно AI письмо', color: 'text-emerald-400' },
          ].map((s, i) => (
            <div key={i} className="text-center py-7 lg:py-8 lg:px-6">
              <div className={`text-[28px] sm:text-[34px] lg:text-[38px] font-extrabold mb-2 ${s.color}`}>{s.num}</div>
              <div className="text-[13px] sm:text-[14px] text-slate-300/90 leading-snug max-w-[220px] mx-auto">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Real story — метрики внутри тех же карточек, без отдельного ряда */}
      <section className="max-w-[1420px] mx-auto px-5 sm:px-8 pb-[88px] lg:pb-[100px]">
        <h2 className="reveal text-center text-[clamp(1.65rem,3.2vw,2.6rem)] font-extrabold leading-tight mb-3">
          <span className="text-white">Реальная история. </span>
          <span className="text-slate-500">Реальный результат.</span>
        </h2>
        <p className="reveal text-center text-[15px] text-slate-500 mb-12 lg:mb-14">Это не маркетинг — это личный опыт создателя сервиса</p>
        <div className="grid lg:grid-cols-2 gap-7 lg:gap-10 items-stretch">
          <div className="reveal reveal-d1 card-hover flex flex-col rounded-[22px] border border-red-500/40 bg-gradient-to-b from-[#160808] to-[#0a0a0a] p-7 lg:p-10 min-h-0 shadow-[inset_0_1px_0_rgba(248,113,113,0.15)]">
            <div className="text-[11px] font-bold text-red-400 uppercase tracking-[0.14em] mb-5 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" /> Ручной поиск
            </div>
            <div className="flex gap-4 mb-6">
              <div className="w-11 h-11 rounded-[10px] bg-red-500 flex items-center justify-center text-white shrink-0 shadow-lg shadow-red-500/30" aria-hidden>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </div>
              <div className="min-w-0">
                <h3 className="text-[18px] lg:text-[21px] font-bold text-white leading-tight mb-1.5">Ноль ответов</h3>
                <p className="text-[13px] lg:text-[14px] text-slate-500 leading-relaxed">Ни одного звонка, ни одного собеседования за год</p>
              </div>
            </div>
            <div className="space-y-5 text-[14px] lg:text-[15px] text-slate-300 flex-1">
              <div className="flex gap-3">
                <span className="text-red-400/90 shrink-0 mt-0.5" aria-hidden><IconClock /></span>
                <div>
                  <span className="text-white font-semibold block mb-0.5">Целый год поиска</span>
                  <span className="text-slate-500 text-[13px] lg:text-[14px] leading-relaxed">Ежедневно часы на просмотр вакансий и написание откликов</span>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-red-400/90 shrink-0 mt-0.5" aria-hidden><IconPlane /></span>
                <div>
                  <span className="text-white font-semibold block mb-0.5">200 откликов отправлено</span>
                  <span className="text-slate-500 text-[13px] lg:text-[14px] leading-relaxed">Каждый — без сопроводительного. Просто «Рассмотрите кандидатуру»</span>
                </div>
              </div>
            </div>
            <div className="mt-8 lg:mt-10 rounded-[18px] border border-red-500/35 bg-black/60 py-8 lg:py-10 px-5 lg:px-8 flex flex-col items-center justify-center min-h-[240px] lg:min-h-[280px] text-center">
              <p className="text-[13px] lg:text-[14px] text-slate-400 leading-relaxed max-w-md mx-auto mb-6 lg:mb-8">
                Сотни откликов без письма — и тишина в ответ. Рекрутер не видит причин открыть профиль: вы теряетесь среди десятков «шаблонных» кандидатов.
              </p>
              <div className="text-[clamp(3.5rem,10vw,5.5rem)] font-extrabold text-rose-400 leading-none mb-2 tracking-tight">0</div>
              <div className="text-[15px] lg:text-[16px] font-medium text-rose-400/90">собеседований</div>
              <p className="text-[12px] lg:text-[13px] text-slate-500 mt-4 max-w-sm leading-relaxed">Знакомо? Это не вы «плохой специалист» — просто без сильного сопроводительного вас не замечают.</p>
            </div>
          </div>

          <div className="reveal reveal-d2 card-hover flex flex-col rounded-[22px] border border-emerald-500/40 bg-gradient-to-b from-[#06140f] to-[#0a0a0a] p-7 lg:p-10 min-h-0 shadow-[inset_0_1px_0_rgba(52,211,153,0.12)]">
            <div className="text-[11px] font-bold text-emerald-400 uppercase tracking-[0.14em] mb-5 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" /> С KlikBot
            </div>
            <div className="flex gap-4 mb-6">
              <div className="w-11 h-11 rounded-[10px] bg-[#065f46] flex items-center justify-center text-emerald-400 shrink-0 shadow-lg shadow-emerald-500/25" aria-hidden>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 17 9 11 13 15 21 7" />
                  <polyline points="14 7 21 7 21 14" />
                </svg>
              </div>
              <div className="min-w-0">
                <h3 className="text-[18px] lg:text-[21px] font-bold text-white leading-tight mb-1.5">Звонки пошли сразу</h3>
                <p className="text-[13px] lg:text-[14px] text-slate-500 leading-relaxed">Работодатели начали звонить. Каждый отметил: «Нас зацепило ваше письмо»</p>
              </div>
            </div>
            <div className="space-y-5 text-[14px] lg:text-[15px] text-slate-300 flex-1">
              <div className="flex gap-3">
                <span className="text-emerald-400/90 shrink-0 mt-0.5" aria-hidden><IconBolt /></span>
                <div>
                  <span className="text-white font-semibold block mb-0.5">100 откликов за 2 минуты</span>
                  <span className="text-slate-500 text-[13px] lg:text-[14px] leading-relaxed">AI подобрал вакансии, написал письмо и отправил автоматически</span>
                </div>
              </div>
              <div className="flex gap-3">
                <span className="text-emerald-400/90 shrink-0 mt-0.5" aria-hidden><IconChat /></span>
                <div>
                  <span className="text-white font-semibold block mb-0.5">Каждый — с AI-письмом</span>
                  <span className="text-slate-500 text-[13px] lg:text-[14px] leading-relaxed">Уникальное сопроводительное под конкретную вакансию</span>
                </div>
              </div>
            </div>
            <div className="mt-8 lg:mt-10 rounded-[18px] border border-emerald-500/35 bg-black/60 py-8 lg:py-10 px-5 lg:px-8 flex flex-col items-center justify-center min-h-[240px] lg:min-h-[280px] text-center">
              <p className="text-[13px] lg:text-[14px] text-slate-400 leading-relaxed max-w-md mx-auto mb-6 lg:mb-8">
                С персональным AI-письмом под каждую вакансию график переворачивается: <span className="text-emerald-400/95 font-semibold">десятки звонков в неделю</span> от реальных работодателей — и почти каждый второй начинает с фразы про ваше письмо.
              </p>
              <div className="text-emerald-400 mb-4 flex justify-center">
                <svg className="w-14 h-14 lg:w-16 lg:h-16" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <polyline points="4,28 14,18 22,22 30,12 36,8" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="text-[15px] lg:text-[16px] font-medium text-emerald-400/95 leading-snug">звонки от работодателей</div>
              <p className="text-[12px] lg:text-[13px] text-slate-500 mt-4 max-w-sm leading-relaxed">Не «массовый спам», а отклики, которые цепляют — и телефон перестаёт молчать.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-[1420px] mx-auto px-5 sm:px-8 py-[88px] lg:py-[104px]">
        <h2 className="reveal text-center text-[clamp(1.65rem,3.2vw,2.75rem)] font-extrabold text-white mb-3">Простые тарифы</h2>
        <p className="reveal text-center text-[16px] lg:text-[17px] text-slate-500 mb-14 lg:mb-16">Без подвохов, без скрытых платежей</p>

        <div className="grid sm:grid-cols-3 gap-7 lg:gap-10 xl:gap-12">
          <div className="reveal reveal-d1 card-hover flex flex-col rounded-[22px] border border-white/[0.1] bg-[#141414] p-8 lg:p-11 min-h-[520px]">
            <div className="text-[13px] lg:text-[14px] font-medium text-slate-500 mb-2">Старт</div>
            <div className="text-[clamp(2rem,4vw,2.75rem)] font-extrabold text-white mb-1 leading-none">Бесплатно</div>
            <div className="text-[13px] lg:text-[14px] text-slate-500 mb-8 lg:mb-10">При регистрации</div>
            <ul className="space-y-3.5 lg:space-y-4 text-[15px] lg:text-[16px] text-slate-300 mb-10 flex-1">
              {['20 откликов', 'AI-подбор вакансий', 'AI-сопроводительные', 'Chrome расширение'].map((f, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="text-emerald-400 text-base leading-6 shrink-0">✓</span> {f}
                </li>
              ))}
            </ul>
            <button type="button" onClick={onGoToAuth}
              className="w-full py-4 lg:py-[18px] bg-[#1f1f1f] text-white text-[15px] lg:text-[16px] font-semibold rounded-[14px] border border-white/10 hover:bg-[#262626] transition">
              Начать бесплатно
            </button>
          </div>

          <div className="reveal reveal-d2 card-hover flex flex-col rounded-[22px] border border-white/[0.1] bg-[#141414] p-8 lg:p-11 min-h-[520px]">
            <div className="text-[13px] lg:text-[14px] font-medium text-slate-500 mb-2">Стандарт</div>
            <div className="flex items-baseline gap-1.5 mb-1">
              <span className="text-[clamp(2rem,4vw,2.75rem)] font-extrabold text-white">1 999</span>
              <span className="text-[20px] lg:text-[22px] text-slate-500">₽</span>
            </div>
            <div className="text-[13px] lg:text-[14px] text-slate-500 mb-8 lg:mb-10">7 дней безлимита</div>
            <ul className="space-y-3.5 lg:space-y-4 text-[15px] lg:text-[16px] text-slate-300 mb-10 flex-1">
              {['Безлимитные отклики', 'AI-подбор вакансий', 'AI-сопроводительные', 'Chrome расширение', 'Автопилот'].map((f, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="text-emerald-400 text-base leading-6 shrink-0">✓</span> {f}
                </li>
              ))}
            </ul>
            <button type="button" onClick={onGoToAuth}
              className="w-full py-4 lg:py-[18px] bg-[#1f1f1f] text-white text-[15px] lg:text-[16px] font-semibold rounded-[14px] border border-white/10 hover:bg-[#262626] transition">
              Купить
            </button>
          </div>

          <div className="reveal reveal-d3 card-hover flex flex-col rounded-[22px] border-2 border-[#ff9500]/60 bg-[#141414] p-8 lg:p-11 relative min-h-[520px] shadow-[0_0_0_1px_rgba(255,149,0,0.08)]">
            <div className="absolute -top-3 right-6 lg:right-8 px-3.5 py-1.5 bg-[#ff9500] text-white text-[12px] font-bold rounded-full shadow-[0_4px_20px_rgba(255,149,0,0.45)]">
              Выгодно
            </div>
            <div className="text-[13px] lg:text-[14px] font-medium text-orange-400 mb-2">Про</div>
            <div className="flex items-baseline gap-1.5 mb-1">
              <span className="text-[clamp(2rem,4vw,2.75rem)] font-extrabold text-white">3 499</span>
              <span className="text-[20px] lg:text-[22px] text-slate-500">₽</span>
            </div>
            <div className="text-[13px] lg:text-[14px] text-slate-500 mb-8 lg:mb-10">14 дней безлимита</div>
            <ul className="space-y-3.5 lg:space-y-4 text-[15px] lg:text-[16px] text-slate-300 mb-10 flex-1">
              {['Безлимитные отклики', 'AI-подбор вакансий', 'AI-сопроводительные', 'Chrome расширение', 'Автопилот', 'Приоритетная поддержка'].map((f, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="text-orange-400 text-base leading-6 shrink-0">✓</span> {f}
                </li>
              ))}
            </ul>
            <button type="button" onClick={onGoToAuth}
              className="w-full py-4 lg:py-[18px] bg-[#ff9500] text-white text-[15px] lg:text-[16px] font-bold rounded-[14px] hover:bg-[#e68600] transition shadow-[0_10px_32px_rgba(255,149,0,0.38)]">
              Выбрать лучший
            </button>
          </div>
        </div>

        <p className="reveal text-center text-[12px] text-slate-600 mt-8 max-w-xl mx-auto leading-relaxed">
          Оплата переводом на Сбербанк / Тинькофф по номеру 8-902-927-25-52
        </p>
      </section>

      {/* Главный секрет */}
      <div className="reveal text-center py-6">
        <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#141414] border border-white/[0.1] text-[13px] font-medium text-slate-300">
          ✨ Главный секрет
        </span>
      </div>

      {/* Cover letter */}
      <section className="max-w-[1420px] mx-auto px-5 sm:px-8 pb-[80px] lg:pb-[96px] text-center">
        <h2 className="reveal text-[clamp(1.65rem,3.2vw,2.6rem)] font-extrabold leading-[1.2] mb-4 text-white">
          Сопроводительное письмо — <span className="text-gradient-letter">это то, что решает всё</span>
        </h2>
        <p className="reveal text-[15px] lg:text-[17px] text-slate-400 mb-10 leading-relaxed max-w-[920px] mx-auto">
          Все работодатели, которые позвонили, сказали одно:<br />
          <span className="text-white font-semibold text-[16px] lg:text-[17px]">«Нас зацепило ваше письмо»</span>
        </p>
        <div className="reveal card-hover text-left rounded-[22px] border border-white/[0.1] bg-[#141414] p-7 sm:p-9 lg:p-10">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-11 h-11 rounded-full bg-orange-500/20 flex items-center justify-center text-lg" aria-hidden>🤖</div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-white">AI-сопроводительное письмо</div>
              <div className="text-[12px] text-slate-500">Сгенерировано за 3 секунды</div>
            </div>
            <div className="shrink-0 px-2.5 py-1 bg-emerald-500/15 text-emerald-400 text-[11px] font-semibold rounded-lg border border-emerald-500/25">
              Уникальное
            </div>
          </div>
          <div className="text-[15px] lg:text-[16px] text-slate-300 leading-[1.7] bg-[#0d0d0d] rounded-[16px] p-6 lg:p-7 border border-white/[0.08]">
            Здравствуйте! Ваша вакансия Frontend-разработчика привлекла моё внимание — особенно задача по оптимизации
            производительности SPA.{' '}
            <span className="letter-highlight">
              В последнем проекте я сократил время загрузки на 40% через code-splitting и виртуализацию списков на React.
            </span>{' '}
            Мой 3-летний опыт с TypeScript и работа в продуктовой команде из 8 человек
            позволят мне быстро влиться в ваш процесс. Буду рад обсудить, как могу усилить вашу команду.
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 mt-4 text-[11px] sm:text-[12px] text-slate-500">
            <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Учтены требования вакансии</span>
            <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Подчёркнут релевантный опыт</span>
            <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> Конкретные достижения</span>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-[1420px] mx-auto px-5 sm:px-8 pb-[88px] lg:pb-[96px]">
        <h2 className="reveal text-center text-[clamp(1.65rem,3.2vw,2.5rem)] font-extrabold mb-3">
          <span className="text-white">Всё для поиска работы. </span>
          <span className="text-slate-500">В одном сервисе.</span>
        </h2>
        <div className="reveal h-3 mb-12 lg:mb-14" aria-hidden />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-7">
          {features.map((f, i) => (
            <div key={i} className={`reveal reveal-d${Math.min(i + 1, 8)} card-hover rounded-[16px] border border-white/[0.1] bg-[#141414] p-6 lg:p-7 min-h-[160px]`}>
              <div className={`w-11 h-11 rounded-[11px] bg-white/[0.05] border border-white/[0.08] flex items-center justify-center mb-3.5 ${f.iconClass}`}>
                <f.Icon className="w-[24px] h-[24px]" />
              </div>
              <div className="text-[15px] lg:text-[16px] font-bold text-white mb-2">{f.title}</div>
              <div className="text-[13px] lg:text-[14px] text-slate-500 leading-relaxed">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-[1420px] mx-auto px-5 sm:px-8 pb-[96px]">
        <h2 className="reveal text-center text-[clamp(1.65rem,3.2vw,2.5rem)] font-extrabold text-white mb-10 lg:mb-14">Вопросы и ответы</h2>
        <div className="space-y-3 lg:space-y-4 w-full">
          {faqItems.map((item, i) => (
            <div key={i} className="reveal rounded-[16px] border border-white/[0.1] bg-[#141414] overflow-hidden">
              <button type="button"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="flex items-center justify-between w-full px-6 lg:px-8 py-4 lg:py-5 text-left text-[15px] lg:text-[17px] font-medium text-white"
              >
                {item.q}
                <span className={`text-orange-400 transition-transform duration-300 ml-4 shrink-0 text-sm ${openFaq === i ? 'rotate-180' : ''}`}>▼</span>
              </button>
              <div className={`faq-answer ${openFaq === i ? 'open' : ''}`}>
                <div className="px-6 lg:px-8 pb-5 text-[14px] lg:text-[15px] text-slate-400 leading-relaxed">{item.a}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-[1420px] mx-auto px-5 sm:px-8 pb-[96px] text-center">
        <div className="max-w-[1180px] mx-auto">
        <h2 className="reveal text-[clamp(1.85rem,4.5vw,3.25rem)] font-extrabold leading-[1.12] mb-5 text-white">
          Хватит отправлять отклики<br />
          <span className="text-[#ff9500]">в пустоту</span>
        </h2>
        <p className="reveal text-[16px] lg:text-[17px] text-slate-400 mb-10">20 бесплатных AI-откликов. Первые звонки — уже на этой неделе.</p>
        <div className="reveal">
          <button type="button" onClick={onGoToAuth}
            className="cta-glow inline-flex items-center justify-center min-h-[52px] px-10 py-3.5 bg-gradient-to-r from-[#ff8c00] to-[#ff9500] text-white text-[16px] font-bold rounded-[14px] hover:brightness-105 transition-[filter] shadow-[0_0_24px_rgba(255,140,0,0.45)]">
            Начать бесплатно&nbsp;→
          </button>
          <p className="text-[13px] text-slate-600 mt-4">Без привязки карты. Без риска. Результат через 10 минут.</p>
        </div>
        </div>
      </section>

      {/* News */}
      <section className="max-w-[1420px] mx-auto px-5 sm:px-8 pb-[96px]">
        <h2 className="reveal text-center text-[clamp(1.65rem,3.2vw,2.5rem)] font-extrabold text-white mb-3">Новости и тренды</h2>
        <p className="reveal text-center text-[15px] text-slate-500 mb-12 lg:mb-14">AI, автоматизация и рынок труда</p>
        <div className="grid sm:grid-cols-3 gap-6 lg:gap-8">
          {articles.map((a, i) => (
            <article key={i} className={`reveal reveal-d${i + 1} card-hover rounded-[16px] border border-white/[0.08] bg-[#141414] overflow-hidden`}>
              <div className="h-[120px] bg-gradient-to-br from-[#1a1a1a] to-[#0d0d0d] flex items-center justify-center border-b border-white/[0.05]">
                <span className="text-[40px] opacity-20" aria-hidden>📅</span>
              </div>
              <div className="p-5">
                <div className="flex items-center gap-2 mb-3 text-[12px] text-slate-500">
                  <span className="text-orange-400" aria-hidden>📅</span>
                  <span>{a.date}</span>
                </div>
                <h3 className="text-[14px] font-bold text-white mb-2 leading-snug">{a.title}</h3>
                <p className="text-[12px] text-slate-500 leading-relaxed">{a.desc}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.08] py-10">
        <div className="max-w-[1420px] mx-auto px-5 sm:px-8 grid sm:grid-cols-3 gap-10 lg:gap-12 text-[14px]">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-[8px] bg-orange-500/20 flex items-center justify-center text-orange-400 text-[11px] font-bold">KB</div>
              <span className="font-bold text-white">KlikBot</span>
            </div>
            <p className="text-[12px] text-slate-600 leading-relaxed">AI-сервис автоматических откликов на hh.ru с персональными сопроводительными письмами.</p>
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Оплата</div>
            <div className="text-white font-semibold text-[15px]">8-902-927-25-52</div>
            <div className="text-[12px] text-slate-500 mt-1 leading-relaxed">Сбербанк / Тинькофф<br />Ишутинский Владислав</div>
          </div>
          <div>
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Контакты</div>
            <a href="https://t.me/VIP_KRS" target="_blank" rel="noopener" className="text-[#ff9500] font-semibold text-[15px] hover:underline">Telegram @VIP_KRS</a>
            <div className="text-[12px] text-slate-500 mt-1">klikbot.ru</div>
          </div>
        </div>
        <div className="max-w-[1420px] mx-auto px-5 sm:px-8 mt-10 pt-6 border-t border-white/[0.06] flex flex-col sm:flex-row justify-between gap-2 text-[11px] text-slate-600">
          <span>KlikBot © 2024</span>
          <span>Разработка: Ишутинский Владислав</span>
        </div>
      </footer>
    </div>
  )
}

function IconClock() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
  )
}
function IconPlane() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" /></svg>
  )
}
function IconBolt() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>
  )
}
function IconChat() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
  )
}
