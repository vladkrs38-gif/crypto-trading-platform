export default function LandingPage({ onGoToAuth }) {
  return (
    <div className="min-h-screen bg-dark-800 text-white overflow-y-auto">
      {/* Header */}
      <header className="border-b border-dark-300/50 backdrop-blur-sm bg-dark-800/80 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center font-bold text-sm">HH</div>
            <span className="text-lg font-bold">AutoPilot</span>
          </div>
          <button onClick={onGoToAuth}
            className="px-5 py-2 bg-accent text-white text-sm font-semibold rounded-lg hover:bg-accent-hover transition">
            Войти
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-block px-4 py-1.5 rounded-full bg-accent/10 text-accent text-xs font-medium mb-6 border border-accent/20">
          AI-автоматизация откликов на hh.ru
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight mb-6">
          Автоматические отклики<br />
          <span className="text-accent">с AI-письмами</span>
        </h1>
        <p className="text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Загрузите резюме — AI подберёт вакансии и отправит персональное сопроводительное письмо
          на каждую. Сотни откликов за минуты, не за дни.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button onClick={onGoToAuth}
            className="px-8 py-3.5 bg-accent text-white text-base font-semibold rounded-xl hover:bg-accent-hover transition shadow-lg shadow-accent/20">
            Начать бесплатно
          </button>
          <a href="#pricing"
            className="px-8 py-3.5 bg-dark-600 text-slate-300 text-base font-medium rounded-xl hover:bg-dark-500 transition border border-dark-300">
            Тарифы
          </a>
        </div>
        <p className="text-sm text-slate-500 mt-4">10 откликов бесплатно. Без привязки карты.</p>
      </section>

      {/* Stats */}
      <section className="max-w-4xl mx-auto px-6 pb-16">
        <div className="grid grid-cols-3 gap-4">
          {[
            { num: '5 000+', label: 'Вакансий за поиск' },
            { num: '< 2 мин', label: 'На 100 откликов' },
            { num: 'AI', label: 'Персональные письма' },
          ].map((s, i) => (
            <div key={i} className="bg-dark-700 rounded-xl border border-dark-300 p-5 text-center">
              <div className="text-2xl sm:text-3xl font-bold text-accent mb-1">{s.num}</div>
              <div className="text-xs sm:text-sm text-slate-400">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">Как это работает</h2>
        <div className="grid sm:grid-cols-3 gap-6">
          {[
            {
              step: '01',
              title: 'Загрузите резюме',
              desc: 'Вставьте текст или загрузите PDF. AI проанализирует ваш опыт и навыки.',
              icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              ),
            },
            {
              step: '02',
              title: 'AI подбирает вакансии',
              desc: 'Генерирует поисковые запросы и находит максимально релевантные вакансии на hh.ru.',
              icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              ),
            },
            {
              step: '03',
              title: 'Автоотклик с письмом',
              desc: 'Для каждой вакансии генерируется уникальное сопроводительное письмо и отправляется отклик.',
              icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              ),
            },
          ].map((item, i) => (
            <div key={i} className="bg-dark-700 rounded-xl border border-dark-300 p-6 relative overflow-hidden group hover:border-accent/30 transition">
              <div className="absolute top-4 right-4 text-5xl font-black text-dark-500 group-hover:text-accent/10 transition">{item.step}</div>
              <div className="w-10 h-10 rounded-lg bg-accent/10 text-accent flex items-center justify-center mb-4">
                {item.icon}
              </div>
              <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="bg-dark-700/50 border-y border-dark-300/50 py-16">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">Возможности</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { title: 'AI-подбор', desc: 'Умный поиск вакансий по вашему резюме' },
              { title: 'Массовый отклик', desc: 'Отправка сотен откликов одним кликом' },
              { title: 'AI-письма', desc: 'Уникальное сопроводительное для каждой вакансии' },
              { title: 'Оценка совпадения', desc: 'Показывает % соответствия резюме и вакансии' },
              { title: 'Фильтры', desc: 'Удалёнка, зарплата, город, опыт' },
              { title: 'База откликов', desc: 'Вся история в одном месте' },
              { title: 'Расширение Chrome', desc: 'Откликайтесь прямо из браузера' },
              { title: 'Автопилот', desc: 'Автоматический поиск и отклик по расписанию' },
            ].map((f, i) => (
              <div key={i} className="bg-dark-700 rounded-lg border border-dark-300 px-4 py-3.5">
                <div className="text-sm font-semibold text-white mb-0.5">{f.title}</div>
                <div className="text-xs text-slate-400">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-4xl mx-auto px-6 py-20">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-3">Тарифы</h2>
        <p className="text-center text-slate-400 mb-12">Начните бесплатно, масштабируйтесь по мере необходимости</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 max-w-5xl mx-auto">
          {/* Free */}
          <div className="bg-dark-700 rounded-2xl border border-dark-300 p-5 flex flex-col">
            <div className="text-sm font-medium text-slate-400 mb-2">Старт</div>
            <div className="text-2xl font-extrabold mb-1">Бесплатно</div>
            <div className="text-xs text-slate-500 mb-5">при регистрации</div>
            <ul className="space-y-2 text-sm text-slate-300 mb-6 flex-1">
              {['10 откликов', 'AI-подбор вакансий', 'AI-письма'].map((f, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-accent">&#10003;</span> {f}
                </li>
              ))}
            </ul>
            <button onClick={onGoToAuth}
              className="w-full py-2.5 bg-dark-500 text-white font-semibold rounded-xl hover:bg-dark-400 transition text-sm">
              Начать
            </button>
          </div>

          {/* 200 RUB */}
          <div className="bg-dark-700 rounded-2xl border border-dark-300 p-5 flex flex-col">
            <div className="text-sm font-medium text-slate-400 mb-2">Лайт</div>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-2xl font-extrabold">200</span>
              <span className="text-base text-slate-400">&#8381;</span>
            </div>
            <div className="text-xs text-slate-500 mb-5">20 откликов</div>
            <ul className="space-y-2 text-sm text-slate-300 mb-6 flex-1">
              {['20 откликов', 'Всё из бесплатного', 'Расширение Chrome'].map((f, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-accent">&#10003;</span> {f}
                </li>
              ))}
            </ul>
            <button onClick={onGoToAuth}
              className="w-full py-2.5 bg-dark-500 text-white font-semibold rounded-xl hover:bg-dark-400 transition text-sm">
              Купить
            </button>
          </div>

          {/* 500 RUB */}
          <div className="bg-dark-700 rounded-2xl border border-dark-300 p-5 flex flex-col">
            <div className="text-sm font-medium text-slate-400 mb-2">Стандарт</div>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-2xl font-extrabold">500</span>
              <span className="text-base text-slate-400">&#8381;</span>
            </div>
            <div className="text-xs text-slate-500 mb-5">50 откликов</div>
            <ul className="space-y-2 text-sm text-slate-300 mb-6 flex-1">
              {['50 откликов', 'Всё из бесплатного', 'Автопилот'].map((f, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-accent">&#10003;</span> {f}
                </li>
              ))}
            </ul>
            <button onClick={onGoToAuth}
              className="w-full py-2.5 bg-dark-500 text-white font-semibold rounded-xl hover:bg-dark-400 transition text-sm">
              Купить
            </button>
          </div>

          {/* 1000 RUB */}
          <div className="bg-dark-700 rounded-2xl border-2 border-accent p-5 flex flex-col relative">
            <div className="absolute -top-3 right-5 px-3 py-0.5 bg-accent text-white text-xs font-bold rounded-full">Хит</div>
            <div className="text-sm font-medium text-accent mb-2">Про</div>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-2xl font-extrabold">1 000</span>
              <span className="text-base text-slate-400">&#8381;</span>
            </div>
            <div className="text-xs text-slate-500 mb-5">100 откликов</div>
            <ul className="space-y-2 text-sm text-slate-300 mb-6 flex-1">
              {['100 откликов', 'Всё из бесплатного', 'Автопилот', 'Приоритетная поддержка'].map((f, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-accent">&#10003;</span> {f}
                </li>
              ))}
            </ul>
            <button onClick={onGoToAuth}
              className="w-full py-2.5 bg-accent text-white font-semibold rounded-xl hover:bg-accent-hover transition text-sm shadow-lg shadow-accent/20">
              Купить
            </button>
          </div>
        </div>
        <p className="text-center text-xs text-slate-500 mt-6">
          Оплата переводом на Сбербанк / Тинькофф. Кредиты начисляются в течение нескольких минут.
        </p>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-6 pb-20 text-center">
        <div className="bg-gradient-to-br from-accent/10 to-accent/5 rounded-2xl border border-accent/20 p-10">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">Готовы найти работу быстрее?</h2>
          <p className="text-slate-400 mb-8">Зарегистрируйтесь и получите 10 бесплатных откликов прямо сейчас</p>
          <button onClick={onGoToAuth}
            className="px-10 py-3.5 bg-accent text-white text-base font-semibold rounded-xl hover:bg-accent-hover transition shadow-lg shadow-accent/20">
            Создать аккаунт
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-dark-300/50 py-8">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-accent/20 flex items-center justify-center text-accent text-[10px] font-bold">HH</div>
            <span>AutoPilot</span>
          </div>
          <div>proplatforma.ru/hh</div>
        </div>
      </footer>
    </div>
  )
}
