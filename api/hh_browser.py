"""Playwright browser automation for HH.ru: login + mass auto-apply.

All Playwright calls run in a single dedicated thread via a command queue,
because Playwright sync API uses greenlets tied to one thread.
"""
import os
import re
import time
import threading
from concurrent.futures import Future
from pathlib import Path
from dataclasses import dataclass
from queue import Queue
from typing import Optional, Callable

BROWSER_DATA_DIR = Path(__file__).parent / ".browser_data"


@dataclass
class ApplyResult:
    vacancy_id: str
    title: str
    status: str
    error: str = ""


class HHBrowser:
    """All Playwright calls are dispatched to a single background thread."""

    IDLE_TIMEOUT = 10 * 60  # auto-close after 10 min of inactivity

    def __init__(self):
        self._thread: Optional[threading.Thread] = None
        self._cmd_queue: Queue = Queue()
        self._is_open = False
        self._is_logged_in = False
        self._launch_error: Optional[str] = None
        self._launch_ready = threading.Event()
        self._last_activity: float = 0
        self._idle_timer: Optional[threading.Timer] = None

    @property
    def is_open(self) -> bool:
        return self._is_open

    @property
    def logged_in(self) -> bool:
        return self._is_logged_in

    def _run_command(self, fn, *args, **kwargs):
        """Submit a callable to the Playwright thread and wait for result."""
        if not self._is_open:
            raise RuntimeError(self._launch_error or "Браузер не запущен")
        self._touch_activity()
        future = Future()
        self._cmd_queue.put((fn, args, kwargs, future))
        return future.result(timeout=120)

    def _touch_activity(self):
        self._last_activity = time.time()
        self._reset_idle_timer()

    def _reset_idle_timer(self):
        if self._idle_timer:
            self._idle_timer.cancel()
        self._idle_timer = threading.Timer(self.IDLE_TIMEOUT, self._idle_close)
        self._idle_timer.daemon = True
        self._idle_timer.start()

    def _idle_close(self):
        if self._is_open and (time.time() - self._last_activity >= self.IDLE_TIMEOUT - 5):
            self.close()

    def _worker(self):
        """Dedicated Playwright thread: launch browser and process commands."""
        from playwright.sync_api import sync_playwright

        try:
            BROWSER_DATA_DIR.mkdir(exist_ok=True)
            pw = sync_playwright().start()
            headless = not os.environ.get("DISPLAY")
            context = pw.chromium.launch_persistent_context(
                str(BROWSER_DATA_DIR),
                headless=headless,
                locale="ru-RU",
                viewport={"width": 1280, "height": 900},
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--no-sandbox",
                    "--single-process",
                    "--disable-extensions",
                    "--disable-background-networking",
                    "--disable-default-apps",
                    "--disable-translate",
                    "--js-flags=--max-old-space-size=256",
                ],
            )
        except Exception as e:
            self._launch_error = str(e)
            self._launch_ready.set()
            return

        page = context.pages[0] if context.pages else context.new_page()
        self._is_open = True
        self._launch_error = None
        self._launch_ready.set()

        while True:
            item = self._cmd_queue.get()
            if item is None:
                break
            fn, args, kwargs, future = item
            try:
                result = fn(page, *args, **kwargs)
                future.set_result(result)
            except Exception as e:
                future.set_exception(e)

        try:
            context.close()
            pw.stop()
        except Exception:
            pass
        self._is_open = False

    def launch(self):
        if self._thread and self._thread.is_alive():
            return
        self._launch_error = None
        self._launch_ready.clear()
        self._thread = threading.Thread(target=self._worker, daemon=True)
        self._thread.start()
        self._launch_ready.wait(timeout=30)
        if self._launch_error:
            raise RuntimeError(self._launch_error)
        self._touch_activity()

    def close(self):
        if self._idle_timer:
            self._idle_timer.cancel()
            self._idle_timer = None
        if self._thread and self._thread.is_alive():
            self._cmd_queue.put(None)
            self._thread.join(timeout=10)
        self._is_open = False
        self._thread = None

    def open_login(self):
        def _do(page):
            page.goto("https://hh.ru/account/login", wait_until="domcontentloaded")
        self._run_command(_do)

    def check_logged_in(self) -> bool:
        def _do(page):
            url = page.url or ""
            if "account/login" in url or "auth" in url:
                return False
            if page.locator('[data-qa="mainmenu_myResumes"]').first.count() > 0:
                return True
            if page.locator('[data-qa="menu-item-applicant"]').first.count() > 0:
                return True
            # Navigate only if we're still on login page
            if "hh.ru" not in url:
                page.goto("https://hh.ru/", wait_until="domcontentloaded")
                time.sleep(2)
                return page.locator('[data-qa="mainmenu_myResumes"]').first.count() > 0
            login_link = page.locator('[data-qa="login"]').first
            return login_link.count() == 0
        try:
            result = self._run_command(_do)
            self._is_logged_in = result
            return result
        except Exception:
            return False

    def check_already_applied(self, vacancy_id: str) -> tuple[bool, str]:
        """Quick check: visit vacancy page, return (already_applied, title)."""
        def _do(page):
            url = f"https://hh.ru/vacancy/{vacancy_id}"
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_timeout(1500)
            title = vacancy_id
            title_el = page.locator('[data-qa="vacancy-title"]').first
            if title_el.count() > 0:
                title = title_el.inner_text().strip()
            already = _check_applied_text(page)
            return (already, title)
        return self._run_command(_do)

    def apply_to_vacancy(self, vacancy_id: str, cover_letter: str) -> ApplyResult:
        def _do(page):
            return _apply_impl(page, vacancy_id, cover_letter)
        return self._run_command(_do)

    def parse_negotiations_stats(self) -> dict:
        """Open HH negotiations page and parse response stats: sent, viewed, invitations, rejections."""
        def _do(page):
            return _parse_negotiations_impl(page)
        return self._run_command(_do)

    def export_cookies(self) -> list[dict]:
        def _do(page):
            return page.context.cookies()
        return self._run_command(_do)

    def import_cookies(self, cookies: list[dict]):
        def _do(page):
            page.context.add_cookies(cookies)
            page.goto("https://hh.ru/", wait_until="domcontentloaded")
            time.sleep(2)
        self._run_command(_do)

    # --- Interactive remote browser methods ---

    def take_screenshot(self) -> bytes:
        def _do(page):
            return page.screenshot(type="jpeg", quality=55)
        return self._run_command(_do)

    def click_at(self, x: int, y: int):
        def _do(page):
            page.mouse.click(x, y)
            page.wait_for_timeout(100)
        self._run_command(_do)

    def type_text(self, text: str):
        def _do(page):
            page.keyboard.type(text, delay=30)
        self._run_command(_do)

    def press_key(self, key: str):
        def _do(page):
            page.keyboard.press(key)
        self._run_command(_do)

    def scroll_at(self, x: int, y: int, delta_x: float = 0, delta_y: float = 0):
        def _do(page):
            page.mouse.move(x, y)
            page.mouse.wheel(delta_x, delta_y)
        self._run_command(_do)


def _check_applied_text(page) -> bool:
    """Check for any variation of 'already applied' text on the page."""
    for text in ["Вы откликнулись", "Вы уже откликнулись", "Отклик отправлен", "Резюме доставлено"]:
        if page.locator(f'text="{text}"').count() > 0:
            return True
    # Also check data-qa attributes
    if page.locator('[data-qa="vacancy-response-link-top"]:has-text("откликнулись")').count() > 0:
        return True
    return False


def _parse_negotiations_impl(page) -> dict:
    """
    Parse HH applicant negotiations page for funnel stats.
    HH page has tabs: Все, Приглашение, Собеседование, Выход на работу, Ожидание, Отказ, Удалённые.
    Returns { sent, viewed, invitations, rejections }.
    """
    result = {"sent": 0, "viewed": 0, "invitations": 0, "rejections": 0}
    try:
        page.goto("https://hh.ru/applicant/negotiations", wait_until="domcontentloaded")
        page.wait_for_timeout(4000)

        # Strategy: find each TAB element separately — each tab has label + count in same node.
        # Use only elements with SHORT text so we don't match parent containers (which had All numbers).
        extracted = page.evaluate("""
            () => {
                const r = { sent: 0, viewed: 0, invitations: 0, rejections: 0 };
                const checks = [
                    { keys: ['все'], out: 'sent' },
                    { keys: ['ожидание'], out: 'viewed' },
                    { keys: ['собеседование', 'приглашение', 'приглашен'], out: 'invitations' },
                    { keys: ['отказ'], out: 'rejections' },
                ];

                function extractFromElement(el) {
                    const t = (el.textContent || '').trim();
                    if (t.length > 80) return;
                    const numMatch = t.match(/(\\d+)/);
                    if (!numMatch) return;
                    const n = parseInt(numMatch[1], 10);
                    const lower = t.toLowerCase();
                    for (const { keys, out } of checks) {
                        if (keys.some(k => lower.includes(k))) {
                            if (n > r[out]) r[out] = n;
                            return;
                        }
                    }
                }

                const tabSelectors = [
                    '[role="tab"]',
                    '[data-qa*="tab"]',
                    '[data-qa*="filter"]',
                    'nav a',
                    '.bloko-tabs-list a',
                    '[class*="tab"] a',
                    '[class*="Tab"]',
                ];
                const seen = new Set();
                for (const sel of tabSelectors) {
                    try {
                        document.querySelectorAll(sel).forEach(el => {
                            if (seen.has(el)) return;
                            seen.add(el);
                            extractFromElement(el);
                            el.querySelectorAll('*').forEach(child => {
                                if (seen.has(child)) return;
                                const txt = (child.textContent || '').trim();
                                if (txt.length < 20 && txt.match(/\\d+/)) {
                                    seen.add(child);
                                    extractFromElement(child);
                                }
                            });
                        });
                    } catch (e) {}
                }
                return r;
            }
        """)
        if isinstance(extracted, dict):
            result = {k: int(extracted.get(k, 0) or 0) for k in result}

        # Fallback: regex on HTML — find number in same element after tab label
        # Use >Label< or "Label" to avoid partial matches (e.g. "Отказаться" vs "Отказ")
        if result["sent"] == 0 or (result["invitations"] == 0 and result["rejections"] == 0):
            html = page.content()
            html_lower = html.lower()

            def extract_after_exact(label: str) -> int:
                for pattern in [f">{label}<", f'"{label}"', f"'{label}'", f">{label} "]:
                    idx = html_lower.find(pattern.lower())
                    if idx == -1:
                        continue
                    chunk = html[idx : idx + 60]
                    m = re.search(r"\d+", chunk)
                    if m:
                        return int(m.group(0))
                return 0

            if result["sent"] == 0:
                result["sent"] = extract_after_exact("Все") or extract_after_exact("Все ")
            if result["viewed"] == 0:
                result["viewed"] = extract_after_exact("Ожидание")
            if result["invitations"] == 0:
                result["invitations"] = extract_after_exact("Собеседование") or extract_after_exact(
                    "Приглашение"
                )
            if result["rejections"] == 0:
                result["rejections"] = extract_after_exact("Отказ<") or extract_after_exact("Отказ ")
    except Exception:
        pass
    return result


def _fill_post_apply_letter(page, cover_letter: str) -> bool:
    """After 'Резюме доставлено' page, fill the cover letter and click 'Отправить'."""
    for selector in [
        'textarea[placeholder*="Сопроводительное"]',
        'textarea[placeholder*="сопроводительное"]',
        '[data-qa="vacancy-response-popup-form-letter-input"]',
        'textarea[name="text"]',
        'textarea',
    ]:
        el = page.locator(selector).first
        if el.count() > 0 and el.is_visible():
            el.fill("")
            el.fill(cover_letter)
            page.wait_for_timeout(500)
            send_btn = page.locator('button:has-text("Отправить")').first
            if send_btn.count() > 0 and send_btn.is_visible():
                send_btn.click()
                page.wait_for_timeout(2000)
                return True
    return False


def _apply_impl(page, vacancy_id: str, cover_letter: str) -> ApplyResult:
    url = f"https://hh.ru/vacancy/{vacancy_id}"
    title = vacancy_id

    try:
        page.goto(url, wait_until="domcontentloaded")
        page.wait_for_timeout(2000)

        title_el = page.locator('[data-qa="vacancy-title"]').first
        if title_el.count() > 0:
            title = title_el.inner_text().strip()

        if _check_applied_text(page):
            return ApplyResult(vacancy_id, title, "already_applied")

        apply_btn = page.locator('[data-qa="vacancy-response-link-top"]').first
        if apply_btn.count() == 0:
            apply_btn = page.locator('a[data-qa="vacancy-response-link-top"]').first
        if apply_btn.count() == 0:
            return ApplyResult(vacancy_id, title, "no_button")

        apply_btn.click()
        page.wait_for_timeout(3000)

        # --- Flow 1: pre-apply modal (resume selection + optional cover letter) ---
        modal_submit = page.locator('[data-qa="vacancy-response-submit-popup"]').first
        modal_visible = modal_submit.count() > 0 and modal_submit.is_visible()

        if not modal_visible:
            # Also check for the "Откликнуться" button by text inside modal
            modal_submit = page.locator('button:has-text("Откликнуться")').first
            modal_visible = modal_submit.count() > 0 and modal_submit.is_visible()

        if modal_visible:
            # The cover letter field is hidden by default — click "Добавить сопроводительное" to reveal it
            letter_toggle = page.locator('[data-qa="vacancy-response-letter-toggle"]').first
            if letter_toggle.count() == 0 or not letter_toggle.is_visible():
                letter_toggle = page.locator('button:has-text("Добавить сопроводительное")').first
            if letter_toggle.count() == 0 or not letter_toggle.is_visible():
                letter_toggle = page.locator('a:has-text("Добавить сопроводительное")').first
            if letter_toggle.count() == 0 or not letter_toggle.is_visible():
                letter_toggle = page.locator('span:has-text("Добавить сопроводительное")').first

            if letter_toggle.count() > 0 and letter_toggle.is_visible():
                letter_toggle.click()
                page.wait_for_timeout(1500)

            # Now try to fill the cover letter field
            letter_input = page.locator('[data-qa="vacancy-response-popup-form-letter-input"]').first
            if letter_input.count() == 0 or not letter_input.is_visible():
                letter_input = page.locator('textarea[placeholder*="сопроводительное" i]').first
            if letter_input.count() == 0 or not letter_input.is_visible():
                letter_input = page.locator('textarea').first

            if letter_input.count() > 0 and letter_input.is_visible():
                letter_input.fill("")
                letter_input.fill(cover_letter)
                page.wait_for_timeout(500)

            # Click the submit button in the modal ("Откликнуться")
            submit_btn = page.locator('[data-qa="vacancy-response-submit-popup"]').first
            if submit_btn.count() == 0 or not submit_btn.is_visible():
                submit_btn = page.locator('button[data-qa="relocation-warning-confirm"]').first
            if submit_btn.count() == 0 or not submit_btn.is_visible():
                submit_btn = page.locator('button:has-text("Откликнуться")').first
            if submit_btn.count() > 0 and submit_btn.is_visible():
                submit_btn.click()
                page.wait_for_timeout(3000)

        # --- Flow 2: relocation warning popup ---
        reloc_btn = page.locator('button[data-qa="relocation-warning-confirm"]').first
        if reloc_btn.count() > 0 and reloc_btn.is_visible():
            reloc_btn.click()
            page.wait_for_timeout(2000)

        # --- Flow 3: "Резюме доставлено" page with post-apply letter field ---
        if page.locator('text="Резюме доставлено"').count() > 0:
            _fill_post_apply_letter(page, cover_letter)
            return ApplyResult(vacancy_id, title, "sent")

        if page.locator('text="Отклик отправлен"').count() > 0:
            _fill_post_apply_letter(page, cover_letter)
            return ApplyResult(vacancy_id, title, "sent")

        if _check_applied_text(page):
            return ApplyResult(vacancy_id, title, "already_applied")

        # --- Flow 4: test/questions required ---
        if "test" in page.url:
            container = page.locator('[data-qa="title-description"]:has-text("Для отклика необходимо ответить")').first
            if container.count() > 0:
                return ApplyResult(vacancy_id, title, "test_required")

        # If we ended up somewhere unexpected, still try to fill letter
        _fill_post_apply_letter(page, cover_letter)
        return ApplyResult(vacancy_id, title, "sent")

    except Exception as e:
        return ApplyResult(vacancy_id, title, "error", str(e))


_browser = HHBrowser()


def get_browser() -> HHBrowser:
    return _browser
