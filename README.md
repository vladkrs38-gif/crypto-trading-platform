# HH Job Helper

Поиск вакансий на hh.ru + генерация сопроводительных писем через Deep Seek AI. **Работает без одобрения HH** — используется только публичный API.

## Быстрый старт

### 1. Backend (API)

```bash
cd api
python -m venv venv
venv\Scripts\activate    # Windows
# source venv/bin/activate  # Mac/Linux
pip install -r requirements.txt
```

Создайте файл `api/.env`:
```
DEEPSEEK_API_KEY=sk-ваш-ключ
```

Получить ключ: [platform.deepseek.com](https://platform.deepseek.com)

```bash
uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Откройте http://localhost:5173

## Как использовать

1. Введите поисковый запрос (например, "python", "frontend") и нажмите «Найти»
2. Выберите вакансию из списка
3. Вставьте текст своего резюме
4. Нажмите «Сгенерировать письмо»
5. Скопируйте письмо и откройте вакансию на HH — вставьте в поле сопроводительного письма

## Стек

- **Backend:** FastAPI, httpx, OpenAI SDK (для Deep Seek)
- **Frontend:** React, Vite, Tailwind CSS
- **HH API:** публичные эндпоинты (User-Agent)
- **AI:** Deep Seek (OpenAI-совместимый API)
