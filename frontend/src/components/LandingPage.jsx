export default function LandingPage({ onGoToAuth }) {
  return (
    <div className="min-h-screen bg-dark-900 text-white overflow-y-auto">
      {/* Header */}
      <header className="border-b border-dark-300/30 sticky top-0 z-50 bg-dark-900/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-500-500 flex items-center justify-center font-extrabold text-sm text-white shadow-md shadow-orange-500/30">KB</div>
            <span className="text-lg font-bold tracking-tight">KlikBot</span>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden sm:flex items-center gap-1.5 text-slate-400">
              <span className="text-orange-500 font-medium">Оплата:</span> 8-902-927-25-52
              <span className="text-slate-600">Сбер | Тинькофф</span>
            </span>
            <a href="https://t.me/ViP_KRS" target="_blank" rel="noopener"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-success/15 text-success text-xs font-medium rounded-full border border-success/20">
              <span>@ViP_KRS</span>
            </a>
            <button onClick={onGoToAuth}
              className="px-5 py-2 bg-orange-500 text-white text-sm font-semibold rounded-lg hover:bg-orange-600 transition shadow-md shadow-orange-500/30">
              Войти
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-block px-4 py-1.5 rounded-full bg-orange-500/10 text-orange-500 text-xs font-medium mb-8 border border-orange/20">
          AI автоматизация откликов на hh.ru
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight mb-6">
          Получай звонки<br className="hidden sm:block" /> от работодателей,<br />
          <span className="bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent">а не тишину</span>
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          AI пишет <span className="text-white font-semibold">уникальное сопроводительное письмо</span> под каждую
          вакансию. Именно поэтому работодатели звонят вам, а не другим.
        </p>
        <button onClick={onGoToAuth}
          className="px-10 py-4 bg-orange-500 text-white text-lg font-bold rounded-2xl hover:bg-orange-600 transition shadow-xl shadow-orange-500/30">
          Начать бесплатно — 20 откликов &rarr;
        </button>
        <p className="text-sm text-slate-600 mt-4">Без привязки карты. Результат через 10 минут.</p>
      </section>

      {/* Stats */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { num: '5 000+', label: 'вакансий за поиск' },
            { num: '< 2 мин', label: 'на 100 откликов' },
            { num: '100%', label: 'уникальные письма' },
            { num: '3 сек', label: 'на одно AI письмо' },
          ].map((s, i) => (
            <div key={i} className="text-center py-5">
              <div className="text-2xl sm:text-3xl font-extrabold text-orange-500 mb-1">{s.num}</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Real story */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-center mb-3">
          Реальная история. <span className="text-orange-500">Реальный результат.</span>
        </h2>
        <p className="text-center text-slate-500 mb-10">Это не маркетинг — это личный опыт создателя сервиса</p>
        <div className="grid sm:grid-cols-2 gap-5">
          <div className="bg-dark-700 rounded-2xl border border-dark-300 p-6">
            <div className="text-xs font-bold text-danger uppercase tracking-wider mb-4">Ручной поиск</div>
            <div className="space-y-4 text-sm text-slate-300">
              <div><span className="text-white font-semibold">Целый год поиска</span><br/><span className="text-slate-500">Ежедневно часы на просмотр вакансий и написание откликов</span></div>
              <div><span className="text-white font-semibold">200 откликов отправлено</span><br/><span className="text-slate-500">Каждый — без сопроводительного. Просто «Рассмотрите кандидатуру»</span></div>
            </div>
          </div>
          <div className="bg-dark-700 rounded-2xl border border-orange/20 p-6">
            <div className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-4">С KlikBot</div>
            <div className="space-y-4 text-sm text-slate-300">
              <div><span className="text-white font-semibold">100 откликов за 2 минуты</span><br/><span className="text-slate-500">AI подобрал вакансии, написал письма и отправил автоматически</span></div>
              <div><span className="text-white font-semibold">Каждый — с AI-письмом</span><br/><span className="text-slate-500">Уникальное сопроводительное для конкретной вакансии</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 pb-20">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-center mb-3">
          Всё для поиска работы. <span className="text-orange-500">В одном сервисе.</span>
        </h2>
        <p className="text-center text-slate-500 mb-12">&nbsp;</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { title: 'AI-подбор вакансий', desc: 'Подбирает и генерирует оптимальные запросы по вашему резюме', color: 'text-blue-400' },
            { title: 'Массовый отклик', desc: 'Сотни откликов одним нажатием — за минуты, а не за месяцы', color: 'text-orange-500' },
            { title: 'AI-письма', desc: 'Уникальное сопроводительное под каждую вакансию автоматически', color: 'text-purple-400' },
            { title: 'Оценка совпадения', desc: 'Показывает соответствие резюме и вакансии со стороны работодателя', color: 'text-emerald-400' },
            { title: 'Умные фильтры', desc: 'Удалёнка, зарплата, город, опыт — точная настройка', color: 'text-pink-400' },
            { title: 'База откликов', desc: 'Вся история, статусы, письма и аналитика', color: 'text-yellow-400' },
            { title: 'Chrome расширение', desc: 'Работает в вашем браузере — безопасно и удобно', color: 'text-red-400' },
            { title: 'Автопилот', desc: 'Автоматический поиск и отклик по расписанию', color: 'text-cyan-400' },
          ].map((f, i) => (
            <div key={i} className="bg-dark-700 rounded-xl border border-dark-300 p-5 hover:border-dark-200 transition">
              <div className={`text-lg mb-2 ${f.color}`}>&#9670;</div>
              <div className="text-sm font-bold text-white mb-1">{f.title}</div>
              <div className="text-xs text-slate-500 leading-relaxed">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-5xl mx-auto px-6 py-20">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-center mb-3">Простые тарифы</h2>
        <p className="text-center text-slate-500 mb-12">Без подвохов, без скрытых платежей</p>
        <div className="grid sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {/* Старт */}
          <div className="bg-dark-700 rounded-2xl border border-dark-300 p-6 flex flex-col">
            <div className="text-xs font-medium text-slate-500 mb-3">Старт</div>
            <div className="text-3xl font-extrabold mb-1">Бесплатно</div>
            <div className="text-xs text-slate-500 mb-6">при регистрации</div>
            <ul className="space-y-2.5 text-sm text-slate-300 mb-8 flex-1">
              {['20 откликов', 'AI-подбор вакансий', 'AI-сопроводительные', 'Chrome расширение'].map((f, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-success text-xs">&#10003;</span> {f}
                </li>
              ))}
            </ul>
            <button onClick={onGoToAuth}
              className="w-full py-3 bg-dark-500 text-white font-semibold rounded-xl hover:bg-dark-400 transition text-sm border border-dark-300">
              Начать бесплатно
            </button>
          </div>

          {/* Стандарт */}
          <div className="bg-dark-700 rounded-2xl border border-dark-300 p-6 flex flex-col">
            <div className="text-xs font-medium text-slate-500 mb-3">Стандарт</div>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-3xl font-extrabold">1 999</span>
              <span className="text-base text-slate-500">&#8381;</span>
            </div>
            <div className="text-xs text-slate-500 mb-6">7 дней бесплатно</div>
            <ul className="space-y-2.5 text-sm text-slate-300 mb-8 flex-1">
              {['Безлимитные отклики', 'AI подбор вакансий', 'AI-сопроводительные', 'Chrome расширение', 'Автопилот'].map((f, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-success text-xs">&#10003;</span> {f}
                </li>
              ))}
            </ul>
            <button onClick={onGoToAuth}
              className="w-full py-3 bg-dark-500 text-white font-semibold rounded-xl hover:bg-dark-400 transition text-sm border border-dark-300">
              Купить
            </button>
          </div>

          {/* Про */}
          <div className="bg-dark-700 rounded-2xl border-2 border-orange p-6 flex flex-col relative">
            <div className="absolute -top-3 right-5 px-3 py-0.5 bg-orange-500 text-white text-xs font-bold rounded-full shadow-md shadow-orange-500/30">Выгодно</div>
            <div className="text-xs font-medium text-orange-500 mb-3">Про</div>
            <div className="flex items-baseline gap-1 mb-1">
              <span className="text-3xl font-extrabold">3 499</span>
              <span className="text-base text-slate-500">&#8381;</span>
            </div>
            <div className="text-xs text-slate-500 mb-6">14 дней бесплатно</div>
            <ul className="space-y-2.5 text-sm text-slate-300 mb-8 flex-1">
              {['Безлимитные отклики', 'AI-подбор вакансий', 'AI сопроводительные', 'Chrome расширение', 'Автопилот', 'Приоритетная поддержка'].map((f, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-success text-xs">&#10003;</span> {f}
                </li>
              ))}
            </ul>
            <button onClick={onGoToAuth}
              className="w-full py-3 bg-orange-500 text-white font-semibold rounded-xl hover:bg-orange-600 transition text-sm shadow-lg shadow-orange-500/30">
              Выбрать лучший
            </button>
          </div>
        </div>
        <p className="text-center text-xs text-slate-600 mt-6">
          Оплата переводом на Сбербанк / Тинькофф (по номеру): 8-902-927-25-52
        </p>
      </section>

      {/* Cover letter section */}
      <section className="max-w-5xl mx-auto px-6 pb-20 text-center">
        <h2 className="text-3xl sm:text-4xl font-extrabold mb-3">
          Сопроводительное письмо —<br />
          <span className="bg-gradient-to-r from-orange to-yellow-400 bg-clip-text text-transparent">это то, что решает всё</span>
        </h2>
        <p className="text-slate-400 mb-8">Все работодатели, которые позвонили, сказали одно:<br /><span className="text-white font-semibold">«Нас зацепило ваше письмо»</span></p>
        <div className="bg-dark-700 rounded-2xl border border-dark-300 p-6 max-w-2xl mx-auto text-left">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-orange-500/20 flex items-center justify-center text-orange-500 font-bold text-sm">AI</div>
            <div>
              <div className="text-sm font-semibold text-white">AI сопроводительное письмо</div>
              <div className="text-xs text-slate-500">Сгенерировано за 3 секунды</div>
            </div>
            <div className="ml-auto px-2.5 py-1 bg-success/15 text-success text-xs font-medium rounded-lg">Уникальное</div>
          </div>
          <div className="text-sm text-slate-300 leading-relaxed bg-dark-800 rounded-xl p-4 border border-dark-300">
            Здравствуйте! Ваша вакансия Frontend-разработчика привлекла моё внимание — особенно задача по оптимизации
            производительности SPA. В последнем проекте я сократил время загрузки на 40% через <span className="text-white font-medium">code splitting</span> и
            <span className="text-white font-medium"> виртуализацию списков на React</span>. Мой 3-летний опыт с TypeScript и работа в продуктовой команде из 8 человек
            позволят мне быстро влиться в ваш процесс. Буду рад обсудить, как могу усилить вашу команду.
          </div>
          <div className="flex gap-4 mt-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="text-success">&#10003;</span> Учтены требования вакансии</span>
            <span className="flex items-center gap-1"><span className="text-success">&#10003;</span> Подчёркнут релевантный опыт</span>
            <span className="flex items-center gap-1"><span className="text-success">&#10003;</span> Конкретные достижения</span>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 pb-20">
        <h2 className="text-3xl font-extrabold text-center mb-10">Вопросы и ответы</h2>
        <div className="space-y-3">
          {[
            'Не забанит ли меня на hh.ru?',
            'Как работает AI-генерация писем?',
            'Нужно ли держать компьютер включённым?',
            'Сколько бесплатных откликов?',
            'Как быстро придут ответы?',
          ].map((q, i) => (
            <details key={i} className="group bg-dark-700 rounded-xl border border-dark-300">
              <summary className="flex items-center justify-between px-5 py-4 cursor-pointer text-sm font-medium text-white list-none">
                {q}
                <span className="text-orange-500 transition-transform group-open:rotate-180">&#9660;</span>
              </summary>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 pb-20 text-center">
        <h2 className="text-3xl sm:text-4xl font-extrabold mb-3">
          Хватит отправлять отклики<br />
          <span className="bg-gradient-to-r from-orange to-yellow-400 bg-clip-text text-transparent">в пустоту</span>
        </h2>
        <p className="text-slate-400 mb-8">20 бесплатных AI-откликов. Первые звонки — уже на этой неделе.</p>
        <button onClick={onGoToAuth}
          className="px-10 py-4 bg-orange-500 text-white text-lg font-bold rounded-2xl hover:bg-orange-600 transition shadow-xl shadow-orange-500/30">
          Начать бесплатно &rarr;
        </button>
        <p className="text-xs text-slate-600 mt-4">Без привязки карты. Без рисков. Результат через 10 минут.</p>
      </section>

      {/* Footer */}
      <footer className="border-t border-dark-300/30 py-10">
        <div className="max-w-6xl mx-auto px-6 grid sm:grid-cols-3 gap-8 text-sm">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-orange-500/20 flex items-center justify-center text-orange-500 text-xs font-bold">KB</div>
              <span className="font-bold">KlikBot</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">AI сервис автоматических откликов на hh.ru с персональными сопроводительными письмами</p>
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Оплата</div>
            <div className="text-white font-semibold">8-902-927-25-52</div>
            <div className="text-xs text-slate-500">Сбербанк / Тинькофф<br />@kpd-topup в Telegram</div>
          </div>
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Контакты</div>
            <div className="text-white font-semibold">Telegram @ViP_KRS</div>
            <div className="text-xs text-slate-500">KlikBot.ru</div>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-6 mt-8 pt-6 border-t border-dark-300/20 flex justify-between text-xs text-slate-700">
          <span>KlikBot &copy; 2026</span>
          <span>Разработчик: Ишутинов Владислав</span>
        </div>
      </footer>
    </div>
  )
}
