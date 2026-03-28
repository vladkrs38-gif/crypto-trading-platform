"""Auto-search scheduler: periodically searches for new vacancies and auto-applies."""
import asyncio
import logging
import time
import threading
from datetime import datetime
from typing import Optional

import httpx

import db
from hh_browser import get_browser

logger = logging.getLogger("scheduler")

HH_USER_AGENT = "JobHelper/1.0 (hh-job-helper)"

_scheduler_task: Optional[asyncio.Task] = None
_last_run: Optional[str] = None
_last_run_result: dict = {}
_is_running = False


def get_status() -> dict:
    config = db.get_auto_config()
    return {
        "is_active": config["is_active"],
        "is_running": _is_running,
        "interval_minutes": config["interval_minutes"],
        "last_run": _last_run,
        "last_run_result": _last_run_result,
    }


async def _search_hh(query: str, area: int, remote_only: bool) -> list[dict]:
    """Search HH API for vacancies matching query."""
    params = {"text": query, "per_page": 100, "page": 0}
    if area:
        params["area"] = area
    if remote_only:
        params["schedule"] = "remote"

    items = []
    async with httpx.AsyncClient() as client:
        for page_num in range(5):
            params["page"] = page_num
            try:
                resp = await client.get(
                    "https://api.hh.ru/vacancies",
                    params=params,
                    headers={"User-Agent": HH_USER_AGENT},
                    timeout=15.0,
                )
                resp.raise_for_status()
                data = resp.json()
                page_items = data.get("items", [])
                if not page_items:
                    break
                items.extend(page_items)
                if page_num >= data.get("pages", 1) - 1:
                    break
            except Exception as e:
                logger.warning(f"HH search error for '{query}' page {page_num}: {e}")
                break
            await asyncio.sleep(0.3)
    return items


def _generate_letter_sync(vacancy: dict, resume_text: str) -> str:
    """Generate cover letter via DeepSeek."""
    import os
    from openai import OpenAI
    import re

    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    if not api_key:
        return ""

    def strip_html(text):
        return re.sub(r"<[^>]+>", " ", text or "").strip()

    name = vacancy.get("name", "")
    emp = vacancy.get("employer", {})
    desc = strip_html(vacancy.get("description", ""))[:4000]
    salary = vacancy.get("salary")
    sal_str = "Не указана"
    if salary:
        parts = []
        if salary.get("from"):
            parts.append(str(salary["from"]))
        if salary.get("to"):
            parts.append(str(salary["to"]))
        sal_str = "-".join(parts) + " " + salary.get("currency", "RUR")

    vacancy_str = f"Вакансия: {name}\nКомпания: {emp.get('name', '')}\nЗарплата: {sal_str}\n\nОписание:\n{desc}"

    client = OpenAI(api_key=api_key, base_url="https://api.deepseek.com")
    try:
        response = client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "system", "content": (
                    "Ты помощник по составлению сопроводительных писем к вакансиям на hh.ru. "
                    "Напиши краткое (2-3 абзаца) профессиональное сопроводительное письмо на русском языке. "
                    "Письмо должно быть персональным, выделять релевантный опыт, не быть шаблонным. "
                    'Начни сразу с представления, без обращений типа "Уважаемый HR".'
                )},
                {"role": "user", "content": (
                    f"Резюме:\n{resume_text[:5000]}\n\nВакансия:\n{vacancy_str}\n\nСгенерируй сопроводительное письмо."
                )},
            ],
            max_tokens=600,
            temperature=0.7,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"DeepSeek error: {e}")
        return ""


def _fetch_vacancy_sync(vacancy_id: str) -> dict:
    """Fetch full vacancy details from HH API."""
    import urllib.request
    import json as _json
    url = f"https://api.hh.ru/vacancies/{vacancy_id}"
    req = urllib.request.Request(url, headers={"User-Agent": HH_USER_AGENT})
    try:
        data = _json.loads(urllib.request.urlopen(req, timeout=10).read().decode())
        return data
    except Exception:
        return {"id": vacancy_id, "name": vacancy_id}


async def run_cycle(user_id: int = 0):
    """Execute one full search-and-apply cycle for a specific user."""
    global _is_running, _last_run, _last_run_result
    _is_running = True
    _last_run = datetime.now().isoformat()

    can_apply, reason = db.check_user_can_apply(user_id)
    if not can_apply:
        logger.warning(f"User {user_id} cannot apply: {reason}. Deactivating autopilot.")
        db.deactivate_auto_config(user_id)
        _last_run_result = {"new_found": 0, "applied": 0, "errors": 0, "skipped": 0,
                            "queries_run": 0, "message": f"Stopped: {reason}"}
        _is_running = False
        return _last_run_result

    config = db.get_auto_config(user_id)
    queries = config.get("search_queries", [])
    resume_text = config.get("resume_text", "")
    area = config.get("area", 113)
    remote_only = config.get("remote_only", True)

    result = {"new_found": 0, "applied": 0, "errors": 0, "skipped": 0, "queries_run": 0}

    if not queries or not resume_text:
        _last_run_result = {**result, "message": "No queries or resume configured"}
        _is_running = False
        return result

    browser = get_browser()
    if not browser.is_open:
        _last_run_result = {**result, "message": "Browser not launched"}
        _is_running = False
        return result

    seen_ids = set()
    for query in queries:
        if not query.strip():
            continue
        result["queries_run"] += 1
        items = await _search_hh(query.strip(), area, remote_only)

        for item in items:
            hh_id = str(item.get("id", ""))
            if not hh_id or hh_id in seen_ids:
                continue
            seen_ids.add(hh_id)

            salary = item.get("salary") or {}
            is_new = db.upsert_vacancy(
                hh_id=hh_id,
                title=item.get("name", ""),
                company=(item.get("employer") or {}).get("name", ""),
                salary_from=salary.get("from"),
                salary_to=salary.get("to"),
                salary_currency=salary.get("currency", "RUR"),
                url=f"https://hh.ru/vacancy/{hh_id}",
                search_query=query.strip(),
                user_id=user_id,
            )
            if is_new:
                result["new_found"] += 1

        await asyncio.sleep(0.5)

    new_vacancies = db.get_new_vacancies(user_id)
    loop = asyncio.get_event_loop()

    for vac in new_vacancies:
        credits = db.get_user_credits(user_id)
        if credits <= 0:
            logger.info(f"User {user_id} ran out of credits during autopilot cycle. Deactivating.")
            db.deactivate_auto_config(user_id)
            result["message"] = "no_credits"
            break

        hh_id = vac["hh_id"]
        try:
            vacancy_data = await loop.run_in_executor(None, _fetch_vacancy_sync, hh_id)
            letter = await loop.run_in_executor(
                None, _generate_letter_sync, vacancy_data, resume_text
            )

            apply_result = await loop.run_in_executor(
                None, browser.apply_to_vacancy, hh_id, letter
            )

            db.update_vacancy_status(hh_id, apply_result.status, user_id)
            db.log_application(hh_id, letter, apply_result.status, apply_result.error, user_id)

            if apply_result.status in ("sent", "applied", "already_applied"):
                if apply_result.status != "already_applied":
                    if not db.deduct_credit(user_id):
                        logger.info(f"User {user_id} credit deduction failed. Deactivating autopilot.")
                        db.deactivate_auto_config(user_id)
                        result["message"] = "no_credits"
                        break
                    result["applied"] += 1
                else:
                    result["skipped"] += 1
                db.update_vacancy_status(hh_id, "applied", user_id)
            elif apply_result.status in ("test_required", "no_button"):
                result["skipped"] += 1
            else:
                result["errors"] += 1

        except Exception as e:
            logger.error(f"Error applying to {hh_id}: {e}")
            db.update_vacancy_status(hh_id, "error", user_id)
            db.log_application(hh_id, "", "error", str(e), user_id)
            result["errors"] += 1

        await asyncio.sleep(2)

    _last_run_result = result
    _is_running = False
    return result


async def _scheduler_loop():
    """Main scheduler loop — iterates all users with active autopilot."""
    while True:
        active_configs = db.get_all_active_auto_configs()
        if not active_configs:
            await asyncio.sleep(10)
            continue

        for config in active_configs:
            uid = config.get("user_id", 0)

            can_apply, reason = db.check_user_can_apply(uid)
            if not can_apply:
                logger.warning(f"Scheduler: user {uid} blocked ({reason}), deactivating autopilot.")
                db.deactivate_auto_config(uid)
                continue

            try:
                await run_cycle(uid)
            except Exception as e:
                logger.error(f"Scheduler cycle error for user {uid}: {e}")

        active_configs = db.get_all_active_auto_configs()
        if active_configs:
            interval = max(min(c.get("interval_minutes", 60) for c in active_configs), 1) * 60
        else:
            interval = 60
        await asyncio.sleep(interval)


def start_scheduler():
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        return
    loop = asyncio.get_event_loop()
    _scheduler_task = loop.create_task(_scheduler_loop())
    logger.info("Scheduler started")


def stop_scheduler():
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        _scheduler_task.cancel()
        _scheduler_task = None
    logger.info("Scheduler stopped")
