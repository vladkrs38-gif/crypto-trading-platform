"""FastAPI backend: HH API proxy + Deep Seek cover letter + SQLite tracking + auth + credits."""
import asyncio
import json
import time
import logging
import threading
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect, Request, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import httpx
from openai import OpenAI
import os
import re
import jwt
import bcrypt as _bcrypt


def _hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode(), _bcrypt.gensalt()).decode()


def _verify_password(password: str, hashed: str) -> bool:
    return _bcrypt.checkpw(password.encode(), hashed.encode())

try:
    from pypdf import PdfReader
    HAS_PYPDF = True
except ImportError:
    HAS_PYPDF = False

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import db
import scheduler

logging.basicConfig(level=logging.INFO)

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
HH_USER_AGENT = os.getenv("HH_USER_AGENT", "JobHelper/1.0 (hh-job-helper)")
JWT_SECRET = os.getenv("JWT_SECRET", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 168  # 7 days


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    scheduler.start_scheduler()
    yield
    scheduler.stop_scheduler()


app = FastAPI(title="HH Job Helper API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


###############################################################################
# Auth helpers
###############################################################################

def _create_token(user: dict) -> str:
    payload = {
        "user_id": user["id"],
        "email": user["email"],
        "is_admin": bool(user.get("is_admin")),
        "exp": time.time() + JWT_EXPIRE_HOURS * 3600,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _get_user_from_request(request: Request) -> dict | None:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("exp", 0) < time.time():
            return None
        user = db.get_user_by_id(payload["user_id"])
        return user
    except (jwt.InvalidTokenError, KeyError):
        return None


def _require_user(request: Request) -> dict:
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    return user


def _require_admin(request: Request) -> dict:
    user = _require_user(request)
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Только для администраторов")
    return user


###############################################################################
# Auth endpoints
###############################################################################

class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/register")
async def auth_register(req: RegisterRequest):
    email = req.email.lower().strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Некорректный email")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Пароль должен быть минимум 6 символов")
    if db.get_user_by_email(email):
        raise HTTPException(status_code=409, detail="Пользователь с таким email уже существует")
    password_hash = _hash_password(req.password)
    user = db.create_user(email, password_hash, req.name)
    db.add_credits(user["id"], 10, "registration_bonus")
    user = db.get_user_by_id(user["id"])
    token = _create_token(user)
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "name": user["name"],
                 "credits": user["credits"], "is_admin": bool(user["is_admin"])},
    }


@app.post("/api/auth/login")
async def auth_login(req: LoginRequest):
    user = db.get_user_by_email(req.email)
    if not user or not _verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")
    token = _create_token(user)
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "name": user["name"],
                 "credits": user["credits"], "is_admin": bool(user["is_admin"])},
    }


@app.get("/api/auth/me")
async def auth_me(request: Request):
    user = _require_user(request)
    return {
        "id": user["id"], "email": user["email"], "name": user["name"],
        "credits": user["credits"], "is_admin": bool(user["is_admin"]),
        "resume_text": user.get("resume_text") or "",
    }


###############################################################################
# Resume persistence
###############################################################################

class SaveResumeRequest(BaseModel):
    text: str

@app.post("/api/resume")
async def save_resume(req: SaveResumeRequest, request: Request):
    user = _require_user(request)
    db.save_user_resume(user["id"], req.text)
    return {"ok": True}

@app.get("/api/resume")
async def get_resume(request: Request):
    user = _require_user(request)
    return {"text": db.get_user_resume(user["id"])}


###############################################################################
# Search state persistence
###############################################################################

class SaveSearchStateRequest(BaseModel):
    state: dict

@app.post("/api/search-state")
async def save_search_state(req: SaveSearchStateRequest, request: Request):
    user = _require_user(request)
    db.save_search_state(user["id"], req.state)
    return {"ok": True}

@app.get("/api/search-state")
async def get_search_state(request: Request):
    user = _require_user(request)
    state = db.get_search_state(user["id"])
    return {"state": state}

@app.delete("/api/search-state")
async def delete_search_state(request: Request):
    user = _require_user(request)
    db.clear_search_state(user["id"])
    return {"ok": True}


###############################################################################
# Admin endpoints
###############################################################################

class AddCreditsRequest(BaseModel):
    amount: int
    reason: str = "admin_topup"


@app.get("/api/admin/users")
async def admin_list_users(request: Request):
    _require_admin(request)
    return db.get_all_users()


@app.post("/api/admin/users/{user_id}/credits")
async def admin_add_credits(user_id: int, req: AddCreditsRequest, request: Request):
    _require_admin(request)
    target = db.get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    new_balance = db.add_credits(user_id, req.amount, req.reason)
    return {"user_id": user_id, "credits": new_balance, "added": req.amount}


@app.get("/api/admin/users/{user_id}/transactions")
async def admin_user_transactions(user_id: int, request: Request):
    _require_admin(request)
    return db.get_user_transactions(user_id)


@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(user_id: int, request: Request):
    admin = _require_admin(request)
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Нельзя удалить себя")
    target = db.get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    db.delete_user(user_id)
    return {"ok": True}


class ResetPasswordRequest(BaseModel):
    new_password: str


@app.post("/api/admin/users/{user_id}/password")
async def admin_reset_password(user_id: int, req: ResetPasswordRequest, request: Request):
    _require_admin(request)
    target = db.get_user_by_id(user_id)
    if not target:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if len(req.new_password) < 4:
        raise HTTPException(status_code=400, detail="Пароль слишком короткий (минимум 4 символа)")
    hashed = _hash_password(req.new_password)
    db.update_user_password(user_id, hashed)
    return {"ok": True}


###############################################################################
# HH API Proxy (public — no auth needed for search)
###############################################################################

@app.get("/api/vacancies")
async def search_vacancies(
    text: str = Query("", description="Поисковый запрос"),
    area: int = Query(None, description="ID региона (1=Москва)"),
    per_page: int = Query(20, ge=1, le=100),
    page: int = Query(0, ge=0),
    salary: int = Query(None, description="Минимальная зарплата"),
    schedule: str = Query(None, description="График: remote, fullDay, shift, flexible"),
):
    params = {"text": text, "per_page": per_page, "page": page}
    if area:
        params["area"] = area
    if salary:
        params["salary"] = salary
    if schedule:
        params["schedule"] = schedule

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://api.hh.ru/vacancies",
            params=params,
            headers={"User-Agent": HH_USER_AGENT},
            timeout=15.0,
        )
    resp.raise_for_status()
    return resp.json()


@app.get("/api/vacancies/{vacancy_id}")
async def get_vacancy(vacancy_id: str):
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://api.hh.ru/vacancies/{vacancy_id}",
            headers={"User-Agent": HH_USER_AGENT},
            timeout=15.0,
        )
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Вакансия не найдена")
    resp.raise_for_status()
    return resp.json()


@app.get("/api/employers/{employer_id}")
async def get_employer(employer_id: str):
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://api.hh.ru/employers/{employer_id}",
            headers={"User-Agent": HH_USER_AGENT},
            timeout=15.0,
        )
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Работодатель не найден")
    resp.raise_for_status()
    return resp.json()


@app.get("/api/areas")
async def get_areas():
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://api.hh.ru/areas",
            headers={"User-Agent": HH_USER_AGENT},
            timeout=15.0,
        )
    resp.raise_for_status()
    return resp.json()


###############################################################################
# AI helpers
###############################################################################

def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text or "").strip()


def _format_vacancy_for_prompt(vacancy: dict) -> str:
    name = vacancy.get("name", "")
    emp = vacancy.get("employer", {})
    emp_name = emp.get("name", "Не указано")
    desc = _strip_html(vacancy.get("description", ""))[:4000]
    salary = vacancy.get("salary")
    if salary:
        s = salary
        sal_str = f"{s.get('from', '')}-{s.get('to', '')} {s.get('currency', 'RUR')}"
    else:
        sal_str = "Не указана"
    return f"Вакансия: {name}\nКомпания: {emp_name}\nЗарплата: {sal_str}\n\nОписание и требования:\n{desc}"


class GenerateLetterRequest(BaseModel):
    vacancy: dict
    resume_text: str


@app.post("/api/generate-letter")
async def generate_letter(req: GenerateLetterRequest, request: Request):
    _require_user(request)
    if not DEEPSEEK_API_KEY:
        raise HTTPException(status_code=500, detail="DEEPSEEK_API_KEY не задан. Добавьте ключ в .env")

    vacancy_str = _format_vacancy_for_prompt(req.vacancy)
    client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")

    system_prompt = """Ты помощник по составлению сопроводительных писем к вакансиям на hh.ru.
Напиши краткое (2-4 абзаца) профессиональное сопроводительное письмо на русском языке.
Письмо должно:
- Быть персональным под конкретную вакансию
- Выделять релевантный опыт из резюме
- Не быть шаблонным, избегать общих фраз
- Заканчиваться призывом к действию
- Быть в деловом, но тёплом тоне
Не используй обращения типа "Уважаемый HR" — начни с представления."""

    user_content = f"Резюме соискателя:\n{req.resume_text[:6000]}\n\n---\nВакансия:\n{vacancy_str}\n\nСгенерируй сопроводительное письмо к этой вакансии."

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            max_tokens=800,
            temperature=0.7,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ошибка Deep Seek: {str(e)}")

    return {"letter": response.choices[0].message.content.strip()}


###############################################################################
# Resume
###############################################################################

@app.post("/api/extract-resume")
async def extract_resume(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Файл не выбран")
    ext = (file.filename or "").lower().split(".")[-1]
    content = await file.read()

    if ext == "txt":
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            text = content.decode("cp1251", errors="replace")
        return {"text": text.strip()}

    if ext == "pdf":
        if not HAS_PYPDF:
            raise HTTPException(status_code=500, detail="Обработка PDF недоступна. Установите: pip install pypdf")
        try:
            from io import BytesIO
            reader = PdfReader(BytesIO(content))
            text = "\n".join(p.extract_text() or "" for p in reader.pages)
            return {"text": text.strip()}
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Ошибка чтения PDF: {e}")

    raise HTTPException(status_code=400, detail="Поддерживаются только .txt и .pdf")


class AnalyzeResumeRequest(BaseModel):
    resume_text: str


@app.post("/api/analyze-resume")
async def analyze_resume(req: AnalyzeResumeRequest, request: Request):
    _require_user(request)
    if not DEEPSEEK_API_KEY:
        raise HTTPException(status_code=500, detail="DEEPSEEK_API_KEY не задан")
    if not req.resume_text.strip():
        raise HTTPException(status_code=400, detail="Резюме пустое")

    client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")

    prompt = """Проанализируй резюме соискателя и составь поисковые запросы для поиска вакансий на hh.ru.

КРИТИЧЕСКИ ВАЖНО:
- Каждый запрос: СТРОГО 1-2 слова. Больше 2 слов — НЕ НАХОДИТ ничего.
- Запросы должны быть МАКСИМАЛЬНО РЕЛЕВАНТНЫ желаемой должности и ключевым навыкам.
- Используй конкретные IT-специальности и технологии, если человек из IT.
- Верни РОВНО 5 строк — пять разных поисковых запросов.

Примеры ХОРОШИХ запросов (1-2 слова):
IT директор
Python разработчик
DevOps инженер
системный администратор
руководитель IT
fullstack разработчик

Без пояснений, без нумерации, без кавычек — только 5 запросов, каждый на отдельной строке."""

    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[{"role": "user", "content": f"Резюме:\n{req.resume_text[:8000]}\n\n{prompt}"}],
            max_tokens=150,
            temperature=0.3,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ошибка Deep Seek: {str(e)}")

    raw = response.choices[0].message.content.strip()
    queries = [q.strip().strip('"\'').strip() for q in raw.splitlines() if q.strip()][:5]
    queries = [q for q in queries if q]
    return {"search_queries": queries, "search_query": queries[0] if queries else ""}


###############################################################################
# Browser automation endpoints (Playwright)
###############################################################################

from hh_browser import get_browser


@app.post("/api/browser/launch")
async def browser_launch(request: Request):
    _require_user(request)
    browser = get_browser()
    if browser.is_open:
        return {"status": "already_open"}
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(None, browser.launch)
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"detail": str(e), "message": "Не удалось запустить браузер"},
        )
    try:
        await loop.run_in_executor(None, browser.open_login)
    except Exception:
        pass
    return {"status": "launched", "message": "Войдите в аккаунт HH в открывшемся браузере"}


@app.get("/api/browser/status")
async def browser_status():
    browser = get_browser()
    if not browser.is_open:
        return {"browser": False, "logged_in": False}
    try:
        loop = asyncio.get_event_loop()
        logged_in = await loop.run_in_executor(None, browser.check_logged_in)
        return {"browser": True, "logged_in": logged_in}
    except Exception:
        return {"browser": True, "logged_in": False}


@app.post("/api/browser/close")
async def browser_close(request: Request):
    _require_user(request)
    browser = get_browser()
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, browser.close)
    return {"status": "closed"}


@app.get("/api/browser/cookies/export")
async def browser_export_cookies(request: Request):
    _require_user(request)
    browser = get_browser()
    if not browser.is_open:
        raise HTTPException(status_code=400, detail="Браузер не запущен")
    loop = asyncio.get_event_loop()
    cookies = await loop.run_in_executor(None, browser.export_cookies)
    return {"cookies": cookies}


class ImportCookiesRequest(BaseModel):
    cookies: list[dict]


@app.post("/api/browser/cookies/import")
async def browser_import_cookies(req: ImportCookiesRequest, request: Request):
    _require_user(request)
    browser = get_browser()
    if not browser.is_open:
        raise HTTPException(status_code=400, detail="Браузер не запущен. Сначала нажмите «Запустить браузер»")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, browser.import_cookies, req.cookies)
    logged_in = await loop.run_in_executor(None, browser.check_logged_in)
    return {"status": "imported", "logged_in": logged_in}


###############################################################################
# Interactive remote browser (WebSocket)
###############################################################################

_live_session_lock = asyncio.Lock()


@app.websocket("/api/browser/live")
async def browser_live(websocket: WebSocket):
    await websocket.accept()
    if _live_session_lock.locked():
        await websocket.send_json({"type": "error", "message": "Другой пользователь уже использует браузер"})
        await websocket.close()
        return

    async with _live_session_lock:
        browser = get_browser()
        loop = asyncio.get_event_loop()

        try:
            if not browser.is_open:
                await loop.run_in_executor(None, browser.launch)
            await loop.run_in_executor(None, browser.open_login)
        except Exception as e:
            await websocket.send_json({"type": "error", "message": str(e)})
            await websocket.close()
            return

        await websocket.send_json({"type": "ready"})

        deadline = time.time() + 300

        async def send_screenshots():
            while time.time() < deadline:
                try:
                    img = await loop.run_in_executor(None, browser.take_screenshot)
                    await websocket.send_bytes(img)
                except Exception:
                    break
                await asyncio.sleep(0.35)
            try:
                await websocket.send_json({"type": "timeout"})
                await websocket.close()
            except Exception:
                pass

        screenshot_task = asyncio.create_task(send_screenshots())

        try:
            while True:
                raw = await websocket.receive_text()
                msg = json.loads(raw)
                t = msg.get("type")

                if t == "click":
                    await loop.run_in_executor(None, browser.click_at, int(msg["x"]), int(msg["y"]))
                elif t == "type":
                    await loop.run_in_executor(None, browser.type_text, msg["text"])
                elif t == "key":
                    await loop.run_in_executor(None, browser.press_key, msg["key"])
                elif t == "scroll":
                    await loop.run_in_executor(None, browser.scroll_at,
                                               int(msg.get("x", 640)), int(msg.get("y", 450)),
                                               float(msg.get("deltaX", 0)), float(msg.get("deltaY", 0)))

                await asyncio.sleep(0.15)
                logged_in = await loop.run_in_executor(None, browser.check_logged_in)
                if logged_in:
                    await websocket.send_json({"type": "logged_in"})
                    break
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            screenshot_task.cancel()


###############################################################################
# Mass apply (SSE) — with credit checks
###############################################################################

class MassApplyRequest(BaseModel):
    vacancy_ids: list[str]
    resume_text: str


_mass_apply_running = False
_mass_apply_cancel = threading.Event()


def _generate_letter_sync(vacancy: dict, resume_text: str) -> str:
    if not DEEPSEEK_API_KEY:
        return "Сопроводительное письмо (DEEPSEEK_API_KEY не задан)"
    vacancy_str = _format_vacancy_for_prompt(vacancy)
    client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")
    system_prompt = (
        "Ты помощник по составлению сопроводительных писем к вакансиям на hh.ru. "
        "Напиши краткое (2-3 абзаца) профессиональное сопроводительное письмо на русском языке. "
        "Письмо должно быть персональным, выделять релевантный опыт, не быть шаблонным. "
        'Начни сразу с представления, без обращений типа "Уважаемый HR".'
    )
    user_content = f"Резюме:\n{resume_text[:5000]}\n\nВакансия:\n{vacancy_str}\n\nСгенерируй сопроводительное письмо."
    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            max_tokens=600,
            temperature=0.7,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        return f"Не удалось сгенерировать письмо: {e}"


def _fetch_vacancy_sync(vacancy_id: str) -> dict:
    import urllib.request
    url = f"https://api.hh.ru/vacancies/{vacancy_id}"
    req = urllib.request.Request(url, headers={"User-Agent": HH_USER_AGENT})
    try:
        import json as _json
        data = _json.loads(urllib.request.urlopen(req, timeout=10).read().decode())
        return data
    except Exception:
        return {"id": vacancy_id, "name": vacancy_id}


@app.post("/api/browser/mass-apply/stop")
async def mass_apply_stop(request: Request):
    _require_user(request)
    if not _mass_apply_running:
        raise HTTPException(status_code=409, detail="Массовый отклик не запущен")
    _mass_apply_cancel.set()
    return {"status": "stopping"}


@app.post("/api/browser/mass-apply")
async def mass_apply_sse(req: MassApplyRequest, request: Request):
    user = _require_user(request)
    user_id = user["id"]
    global _mass_apply_running
    if _mass_apply_running:
        raise HTTPException(status_code=409, detail="Массовый отклик уже запущен")

    browser = get_browser()
    if not browser.is_open:
        raise HTTPException(status_code=400, detail="Браузер не запущен. Сначала войдите в HH.")

    _mass_apply_cancel.clear()
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_event_loop()

    def _run_mass_apply():
        global _mass_apply_running
        _mass_apply_running = True

        ids_to_process = [vid for vid in req.vacancy_ids if not db.is_vacancy_processed(vid, user_id)]
        total = len(ids_to_process)

        def send(data: dict):
            loop.call_soon_threadsafe(queue.put_nowait, data)

        send({"type": "start", "total": total})

        for idx, vid in enumerate(ids_to_process):
            if _mass_apply_cancel.is_set():
                send({"type": "stopped", "index": idx, "total": total})
                break

            credits = db.get_user_credits(user_id)
            if credits <= 0:
                send({"type": "no_credits", "index": idx, "total": total})
                break

            send({"type": "progress", "index": idx, "total": total, "vacancy_id": vid, "step": "checking"})

            if _mass_apply_cancel.is_set():
                send({"type": "stopped", "index": idx, "total": total})
                break

            try:
                already, vtitle = browser.check_already_applied(vid)
            except Exception:
                already, vtitle = False, vid

            if already:
                try:
                    vacancy = _fetch_vacancy_sync(vid)
                    title = vacancy.get("name", vtitle)
                    salary = vacancy.get("salary") or {}
                    area = vacancy.get("area") or {}
                    db.upsert_vacancy(
                        hh_id=vid, title=title,
                        company=(vacancy.get("employer") or {}).get("name", ""),
                        salary_from=salary.get("from"), salary_to=salary.get("to"),
                        salary_currency=salary.get("currency", "RUR"),
                        url=f"https://hh.ru/vacancy/{vid}", search_query="manual",
                        user_id=user_id,
                        location=area.get("name", ""),
                    )
                except Exception:
                    pass
                db.update_vacancy_status(vid, "applied", user_id)
                send({"type": "result", "index": idx, "total": total,
                      "vacancy_id": vid, "title": vtitle,
                      "status": "already_applied", "error": "", "letter_preview": ""})
                continue

            if _mass_apply_cancel.is_set():
                send({"type": "stopped", "index": idx, "total": total})
                break

            send({"type": "progress", "index": idx, "total": total,
                  "vacancy_id": vid, "title": vtitle, "step": "generating_letter"})

            vacancy = _fetch_vacancy_sync(vid)
            title = vacancy.get("name", vtitle)
            letter = _generate_letter_sync(vacancy, req.resume_text)

            salary = vacancy.get("salary") or {}
            area = vacancy.get("area") or {}
            db.upsert_vacancy(
                hh_id=vid, title=title,
                company=(vacancy.get("employer") or {}).get("name", ""),
                salary_from=salary.get("from"), salary_to=salary.get("to"),
                salary_currency=salary.get("currency", "RUR"),
                url=f"https://hh.ru/vacancy/{vid}", search_query="manual",
                user_id=user_id,
                location=area.get("name", ""),
            )

            if _mass_apply_cancel.is_set():
                send({"type": "stopped", "index": idx, "total": total})
                break

            send({"type": "progress", "index": idx, "total": total, "vacancy_id": vid,
                  "title": title, "step": "applying"})

            result = browser.apply_to_vacancy(vid, letter)

            if result.status in ("sent", "cover_letter_filled"):
                db.deduct_credit(user_id)

            db.update_vacancy_status(vid, result.status if result.status != "sent" else "applied", user_id)
            db.log_application(vid, letter, result.status, result.error, user_id)

            remaining_credits = db.get_user_credits(user_id)
            send({"type": "result", "index": idx, "total": total,
                  "vacancy_id": vid, "title": result.title,
                  "status": result.status, "error": result.error,
                  "letter_preview": letter[:200], "credits": remaining_credits})
        else:
            send({"type": "done", "total": total})

        send(None)
        _mass_apply_running = False

    thread = threading.Thread(target=_run_mass_apply, daemon=True)
    thread.start()

    async def event_stream():
        while True:
            item = await queue.get()
            if item is None:
                break
            yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


###############################################################################
# Database & Scheduler endpoints (user-scoped)
###############################################################################

@app.get("/api/db/stats")
async def db_stats(request: Request):
    user = _require_user(request)
    return db.get_stats(user["id"])


@app.get("/api/negotiations/stats")
async def get_negotiations_stats(request: Request):
    user = _require_user(request)
    return db.get_negotiation_stats(user["id"])


@app.post("/api/negotiations/stats/refresh")
async def refresh_negotiations_stats(request: Request):
    user = _require_user(request)
    browser = get_browser()
    if not browser.is_open:
        raise HTTPException(status_code=400, detail="Браузер не запущен.")
    loop = asyncio.get_event_loop()
    stats = await loop.run_in_executor(None, browser.parse_negotiations_stats)
    db.save_negotiation_stats(
        stats.get("sent", 0), stats.get("viewed", 0),
        stats.get("invitations", 0), stats.get("rejections", 0),
        user_id=user["id"],
    )
    return db.get_negotiation_stats(user["id"])


class SaveNegStatsRequest(BaseModel):
    sent: int = 0
    viewed: int = 0
    invitations: int = 0
    rejections: int = 0


@app.post("/api/negotiations/stats/save")
async def save_negotiations_stats(req: SaveNegStatsRequest, request: Request):
    user = _require_user(request)
    db.save_negotiation_stats(req.sent, req.viewed, req.invitations, req.rejections, user_id=user["id"])
    return db.get_negotiation_stats(user["id"])


class VacancyStatusesRequest(BaseModel):
    ids: list[str] = []


class TrackApplyRequest(BaseModel):
    vacancy_id: str
    title: str = ""
    company: str = ""
    status: str = "sent"
    cover_letter: str = ""
    error: str = ""
    location: str = ""


@app.post("/api/db/track-apply")
async def track_apply(req: TrackApplyRequest, request: Request):
    user = _require_user(request)
    user_id = user["id"]
    vid = str(req.vacancy_id)
    db_status = "applied" if req.status in ("sent", "cover_letter_filled", "already_applied") else req.status

    if req.status in ("sent", "cover_letter_filled"):
        if not db.deduct_credit(user_id):
            raise HTTPException(status_code=403, detail="Недостаточно откликов. Пополните баланс.")

    db.upsert_vacancy(vid, req.title, req.company, None, None, "",
                      f"https://hh.ru/vacancy/{vid}", "extension", user_id=user_id,
                      location=req.location)
    db.update_vacancy_status(vid, db_status, user_id)
    if req.status not in ("no_button", "test_required"):
        db.log_application(vid, req.cover_letter[:500] if req.cover_letter else "",
                          req.status, req.error, user_id=user_id)
    remaining = db.get_user_credits(user_id)
    return {"ok": True, "credits": remaining}


@app.post("/api/db/vacancy-statuses")
async def get_vacancy_statuses_batch(req: VacancyStatusesRequest, request: Request):
    user = _require_user(request)
    return db.get_vacancy_statuses(req.ids[:2000], user["id"])


class MatchScoresRequest(BaseModel):
    resume_text: str = ""
    vacancy_ids: list[str] = []


def _compute_match_score(resume_text: str, vacancy: dict) -> int:
    resume_lower = (resume_text or "").lower()
    skills = [s.get("name", "") for s in vacancy.get("key_skills", []) if s.get("name")]
    matched = sum(1 for sk in skills if sk and sk.lower() in resume_lower)
    if skills:
        base = int((matched / len(skills)) * 100)
    else:
        name = (vacancy.get("name") or "").lower()
        desc = _strip_html(vacancy.get("description", ""))[:2000].lower()
        vacancy_words = set(re.findall(r"[a-zа-яё0-9#+]{2,}", name + " " + desc))
        resume_words = set(re.findall(r"[a-zа-яё0-9#+]{2,}", resume_lower))
        hits = len(vacancy_words & resume_words)
        base = min(100, int((hits / max(1, len(vacancy_words))) * 80) + 20) if vacancy_words else 50
    return min(100, max(0, base))


@app.post("/api/match-scores")
async def compute_match_scores(req: MatchScoresRequest, request: Request):
    _require_user(request)
    result = {}
    ids = req.vacancy_ids[:50]
    if not ids or not req.resume_text.strip():
        return result
    async with httpx.AsyncClient() as client:
        for vid in ids:
            try:
                resp = await client.get(
                    f"https://api.hh.ru/vacancies/{vid}",
                    headers={"User-Agent": HH_USER_AGENT},
                    timeout=10.0,
                )
                if resp.status_code == 200:
                    vacancy = resp.json()
                    result[vid] = _compute_match_score(req.resume_text, vacancy)
            except Exception:
                result[vid] = 0
    return result


@app.get("/api/db/vacancies")
async def db_vacancies(request: Request, status: str = Query(None), limit: int = Query(500)):
    user = _require_user(request)
    return db.get_all_vacancies(status_filter=status, limit=limit, user_id=user["id"])


@app.get("/api/db/applications")
async def db_applications(request: Request, limit: int = Query(50)):
    user = _require_user(request)
    return db.get_recent_applications(limit=limit, user_id=user["id"])


class AutoConfigRequest(BaseModel):
    resume_text: str = None
    area: int = None
    remote_only: bool = None
    search_queries: list[str] = None
    interval_minutes: int = None
    is_active: bool = None


@app.get("/api/auto/config")
async def get_auto_config(request: Request):
    user = _require_user(request)
    return db.get_auto_config(user["id"])


@app.post("/api/auto/config")
async def save_auto_config(req: AutoConfigRequest, request: Request):
    user = _require_user(request)
    db.save_auto_config(
        resume_text=req.resume_text, area=req.area,
        remote_only=req.remote_only, search_queries=req.search_queries,
        interval_minutes=req.interval_minutes, is_active=req.is_active,
        user_id=user["id"],
    )
    return db.get_auto_config(user["id"])


@app.post("/api/auto/run-now")
async def auto_run_now(request: Request):
    _require_user(request)
    if scheduler._is_running:
        raise HTTPException(status_code=409, detail="Цикл уже выполняется")
    result = await scheduler.run_cycle()
    return result


@app.get("/api/auto/status")
async def auto_status():
    return scheduler.get_status()


@app.get("/api/health")
async def health():
    return {"status": "ok"}


# Serve frontend static files at /hh when dist exists (production)
_dist = Path(__file__).parent.parent / "frontend" / "dist"
if _dist.exists():
    app.mount("/hh", StaticFiles(directory=str(_dist), html=True), name="hh_static")
