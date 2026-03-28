"""SQLite database for tracking vacancies, applications, users and credits."""
import sqlite3
import json
import threading
from pathlib import Path
from datetime import datetime
from typing import Optional

DB_PATH = Path(__file__).parent / "hh.db"
_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA foreign_keys=ON")
    return _local.conn


def init_db():
    conn = _get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT DEFAULT '',
            credits INTEGER DEFAULT 10,
            is_admin INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            amount INTEGER NOT NULL,
            reason TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS vacancies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            hh_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            company TEXT DEFAULT '',
            salary_from INTEGER,
            salary_to INTEGER,
            salary_currency TEXT DEFAULT 'RUR',
            url TEXT DEFAULT '',
            search_query TEXT DEFAULT '',
            found_at TEXT DEFAULT (datetime('now')),
            status TEXT DEFAULT 'new',
            user_id INTEGER DEFAULT 0,
            location TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vacancy_hh_id TEXT NOT NULL,
            applied_at TEXT DEFAULT (datetime('now')),
            cover_letter TEXT DEFAULT '',
            status TEXT DEFAULT '',
            error TEXT DEFAULT '',
            user_id INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS auto_config (
            id INTEGER PRIMARY KEY,
            resume_text TEXT DEFAULT '',
            area INTEGER DEFAULT 113,
            remote_only INTEGER DEFAULT 1,
            search_queries TEXT DEFAULT '[]',
            interval_minutes INTEGER DEFAULT 60,
            is_active INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now')),
            user_id INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS negotiation_stats (
            id INTEGER PRIMARY KEY,
            sent INTEGER DEFAULT 0,
            viewed INTEGER DEFAULT 0,
            invitations INTEGER DEFAULT 0,
            rejections INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now')),
            user_id INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS user_search_state (
            user_id INTEGER PRIMARY KEY,
            state_json TEXT DEFAULT '{}',
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_vacancies_status ON vacancies(status);
        CREATE INDEX IF NOT EXISTS idx_vacancies_hh_id ON vacancies(hh_id);
        CREATE INDEX IF NOT EXISTS idx_applications_hh_id ON applications(vacancy_hh_id);
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
    """)
    _migrate(conn)
    conn.executescript("""
        CREATE INDEX IF NOT EXISTS idx_vacancies_user ON vacancies(user_id);
        CREATE INDEX IF NOT EXISTS idx_applications_user ON applications(user_id);
    """)
    conn.commit()


def _migrate(conn):
    """Add columns to existing tables if they don't exist yet."""
    int_cols = [
        ("vacancies", "user_id", "0"),
        ("vacancies", "location", "''"),
        ("applications", "user_id", "0"),
        ("auto_config", "user_id", "0"),
        ("negotiation_stats", "user_id", "0"),
    ]
    for table, col, default in int_cols:
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} INTEGER DEFAULT {default}")
        except sqlite3.OperationalError:
            pass
    text_cols = [
        ("users", "resume_text", "''"),
        ("users", "subscription_expires_at", "NULL"),
    ]
    for table, col, default in text_cols:
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} TEXT DEFAULT {default}")
        except sqlite3.OperationalError:
            pass
    # Remove UNIQUE constraint on vacancies.hh_id if it exists (now per-user)
    try:
        conn.execute("CREATE INDEX IF NOT EXISTS idx_vacancies_user_hh ON vacancies(user_id, hh_id)")
    except sqlite3.OperationalError:
        pass

    # Remove CHECK(id=1) from old single-row tables (breaks multi-user)
    for table, create_sql in [
        ("negotiation_stats", """CREATE TABLE negotiation_stats (
            id INTEGER PRIMARY KEY,
            sent INTEGER DEFAULT 0, viewed INTEGER DEFAULT 0,
            invitations INTEGER DEFAULT 0, rejections INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now')), user_id INTEGER DEFAULT 0
        )"""),
        ("auto_config", """CREATE TABLE auto_config (
            id INTEGER PRIMARY KEY,
            resume_text TEXT DEFAULT '', area INTEGER DEFAULT 113,
            remote_only INTEGER DEFAULT 1, search_queries TEXT DEFAULT '[]',
            interval_minutes INTEGER DEFAULT 60, is_active INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now')), user_id INTEGER DEFAULT 0
        )"""),
    ]:
        try:
            check = conn.execute(f"SELECT sql FROM sqlite_master WHERE type='table' AND name='{table}'").fetchone()
            if check and 'CHECK' in (check[0] or ''):
                conn.execute(f"ALTER TABLE {table} RENAME TO _{table}_old")
                conn.execute(create_sql)
                cols = [r[1] for r in conn.execute(f"PRAGMA table_info(_{table}_old)").fetchall()]
                col_list = ", ".join(cols)
                conn.execute(f"INSERT INTO {table} ({col_list}) SELECT {col_list} FROM _{table}_old")
                conn.execute(f"DROP TABLE _{table}_old")
        except Exception:
            pass


# --------------- Users ---------------

def create_user(email: str, password_hash: str, name: str = "") -> dict:
    conn = _get_conn()
    conn.execute(
        "INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)",
        (email.lower().strip(), password_hash, name.strip()),
    )
    conn.commit()
    return get_user_by_email(email)


def get_user_by_email(email: str) -> Optional[dict]:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email.lower().strip(),)).fetchone()
    return dict(row) if row else None


def get_user_by_id(user_id: int) -> Optional[dict]:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def deduct_credit(user_id: int) -> bool:
    """Deduct 1 credit. Returns False if insufficient."""
    conn = _get_conn()
    cur = conn.execute(
        "UPDATE users SET credits = credits - 1 WHERE id = ? AND credits > 0",
        (user_id,),
    )
    if cur.rowcount == 0:
        return False
    conn.execute(
        "INSERT INTO transactions (user_id, amount, reason) VALUES (?, ?, ?)",
        (user_id, -1, "apply"),
    )
    conn.commit()
    return True


def add_credits(user_id: int, amount: int, reason: str = "admin_topup") -> int:
    conn = _get_conn()
    conn.execute("UPDATE users SET credits = credits + ? WHERE id = ?", (amount, user_id))
    conn.execute(
        "INSERT INTO transactions (user_id, amount, reason) VALUES (?, ?, ?)",
        (user_id, amount, reason),
    )
    conn.commit()
    user = get_user_by_id(user_id)
    return user["credits"] if user else 0


def get_user_credits(user_id: int) -> int:
    user = get_user_by_id(user_id)
    return user["credits"] if user else 0


def get_all_users() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute("""
        SELECT u.*,
               (SELECT COUNT(*) FROM applications WHERE user_id = u.id) as total_applies,
               (SELECT COUNT(*) FROM applications WHERE user_id = u.id AND status IN ('sent','cover_letter_filled','applied')) as successful_applies,
               (SELECT COUNT(*) FROM vacancies WHERE user_id = u.id) as total_vacancies
        FROM users u ORDER BY u.created_at DESC
    """).fetchall()
    return [dict(r) for r in rows]


def delete_user(user_id: int):
    conn = _get_conn()
    conn.execute("DELETE FROM transactions WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM applications WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM vacancies WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM auto_config WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM negotiation_stats WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM user_search_state WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()


def update_user_password(user_id: int, new_password_hash: str):
    conn = _get_conn()
    conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_password_hash, user_id))
    conn.commit()


def get_user_transactions(user_id: int, limit: int = 100) -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
        (user_id, limit),
    ).fetchall()
    return [dict(r) for r in rows]


# --------------- Vacancies ---------------

def upsert_vacancy(hh_id: str, title: str, company: str,
                   salary_from: Optional[int], salary_to: Optional[int],
                   salary_currency: str, url: str, search_query: str,
                   user_id: int = 0, location: str = "") -> bool:
    """Insert vacancy if not exists for this user. Returns True if newly inserted."""
    conn = _get_conn()
    existing = conn.execute(
        "SELECT id FROM vacancies WHERE hh_id = ? AND user_id = ?", (hh_id, user_id)
    ).fetchone()
    if existing:
        if location and not existing.get("location" if isinstance(existing, dict) else 0):
            conn.execute("UPDATE vacancies SET location = ? WHERE hh_id = ? AND user_id = ?",
                         (location, hh_id, user_id))
            conn.commit()
        return False
    conn.execute(
        """INSERT INTO vacancies (hh_id, title, company, salary_from, salary_to,
           salary_currency, url, search_query, user_id, location)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (hh_id, title, company, salary_from, salary_to, salary_currency, url, search_query, user_id, location),
    )
    conn.commit()
    return True


def update_vacancy_status(hh_id: str, status: str, user_id: int = 0):
    conn = _get_conn()
    conn.execute(
        "UPDATE vacancies SET status = ? WHERE hh_id = ? AND user_id = ?",
        (status, hh_id, user_id),
    )
    conn.commit()


def get_vacancy_status(hh_id: str, user_id: int = 0) -> Optional[str]:
    conn = _get_conn()
    row = conn.execute(
        "SELECT status FROM vacancies WHERE hh_id = ? AND user_id = ?",
        (hh_id, user_id),
    ).fetchone()
    return row["status"] if row else None


def get_vacancy_statuses(hh_ids: list[str], user_id: int = 0) -> dict[str, str]:
    if not hh_ids:
        return {}
    conn = _get_conn()
    placeholders = ",".join("?" * len(hh_ids))
    rows = conn.execute(
        f"SELECT hh_id, status FROM vacancies WHERE hh_id IN ({placeholders}) AND user_id = ?",
        [*hh_ids, user_id],
    ).fetchall()
    return {row["hh_id"]: row["status"] for row in rows}


def is_vacancy_processed(hh_id: str, user_id: int = 0) -> bool:
    status = get_vacancy_status(hh_id, user_id)
    return status is not None and status != "new"


def get_new_vacancies(user_id: int = 0) -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM vacancies WHERE status = 'new' AND user_id = ? ORDER BY found_at DESC",
        (user_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def get_all_vacancies(status_filter: Optional[str] = None, limit: int = 500,
                      user_id: int = 0) -> list[dict]:
    conn = _get_conn()
    if status_filter:
        rows = conn.execute(
            "SELECT * FROM vacancies WHERE status = ? AND user_id = ? ORDER BY found_at DESC LIMIT ?",
            (status_filter, user_id, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM vacancies WHERE user_id = ? ORDER BY found_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def get_stats(user_id: int = 0) -> dict:
    conn = _get_conn()
    total = conn.execute("SELECT COUNT(*) as c FROM vacancies WHERE user_id = ?", (user_id,)).fetchone()["c"]
    new = conn.execute("SELECT COUNT(*) as c FROM vacancies WHERE status='new' AND user_id = ?", (user_id,)).fetchone()["c"]
    applied = conn.execute("SELECT COUNT(*) as c FROM vacancies WHERE status='applied' AND user_id = ?", (user_id,)).fetchone()["c"]
    error = conn.execute("SELECT COUNT(*) as c FROM vacancies WHERE status='error' AND user_id = ?", (user_id,)).fetchone()["c"]
    skipped = conn.execute("SELECT COUNT(*) as c FROM vacancies WHERE status IN ('skipped','test_required','no_button') AND user_id = ?", (user_id,)).fetchone()["c"]
    today = datetime.now().strftime("%Y-%m-%d")
    today_applied = conn.execute(
        "SELECT COUNT(*) as c FROM applications WHERE applied_at >= ? AND user_id = ?",
        (today, user_id),
    ).fetchone()["c"]
    return {
        "total": total, "new": new, "applied": applied,
        "error": error, "skipped": skipped, "today_applied": today_applied,
    }


# --------------- Applications ---------------

def log_application(vacancy_hh_id: str, cover_letter: str, status: str,
                    error: str = "", user_id: int = 0):
    conn = _get_conn()
    conn.execute(
        "INSERT INTO applications (vacancy_hh_id, cover_letter, status, error, user_id) VALUES (?, ?, ?, ?, ?)",
        (vacancy_hh_id, cover_letter, status, error, user_id),
    )
    conn.commit()


def get_recent_applications(limit: int = 50, user_id: int = 0) -> list[dict]:
    conn = _get_conn()
    rows = conn.execute("""
        SELECT a.*, v.title, v.company
        FROM applications a
        LEFT JOIN vacancies v ON a.vacancy_hh_id = v.hh_id AND v.user_id = a.user_id
        WHERE a.user_id = ?
        ORDER BY a.applied_at DESC LIMIT ?
    """, (user_id, limit)).fetchall()
    return [dict(r) for r in rows]


# --------------- Negotiation Stats ---------------

def get_negotiation_stats(user_id: int = 0) -> dict:
    conn = _get_conn()
    row = conn.execute(
        "SELECT sent, viewed, invitations, rejections, updated_at FROM negotiation_stats WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if row:
        return {"sent": row["sent"], "viewed": row["viewed"], "invitations": row["invitations"],
                "rejections": row["rejections"], "updated_at": row["updated_at"]}
    return {"sent": 0, "viewed": 0, "invitations": 0, "rejections": 0, "updated_at": None}


def save_negotiation_stats(sent: int, viewed: int, invitations: int, rejections: int,
                           user_id: int = 0):
    conn = _get_conn()
    existing = conn.execute("SELECT id FROM negotiation_stats WHERE user_id = ?", (user_id,)).fetchone()
    if existing:
        conn.execute(
            """UPDATE negotiation_stats SET sent=?, viewed=?, invitations=?, rejections=?,
               updated_at=datetime('now') WHERE user_id = ?""",
            (sent, viewed, invitations, rejections, user_id),
        )
    else:
        conn.execute(
            """INSERT INTO negotiation_stats (sent, viewed, invitations, rejections, user_id)
               VALUES (?, ?, ?, ?, ?)""",
            (sent, viewed, invitations, rejections, user_id),
        )
    conn.commit()


# --------------- Auto Config ---------------

def get_auto_config(user_id: int = 0) -> dict:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM auto_config WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        conn.execute("INSERT INTO auto_config (user_id) VALUES (?)", (user_id,))
        conn.commit()
        row = conn.execute("SELECT * FROM auto_config WHERE user_id = ?", (user_id,)).fetchone()
    d = dict(row)
    d["search_queries"] = json.loads(d.get("search_queries") or "[]")
    d["is_active"] = bool(d.get("is_active"))
    d["remote_only"] = bool(d.get("remote_only"))
    return d


# --------------- User Resume ---------------

def get_user_resume(user_id: int) -> str:
    conn = _get_conn()
    row = conn.execute("SELECT resume_text FROM users WHERE id = ?", (user_id,)).fetchone()
    return (row["resume_text"] or "") if row else ""


def save_user_resume(user_id: int, text: str):
    conn = _get_conn()
    conn.execute("UPDATE users SET resume_text = ? WHERE id = ?", (text, user_id))
    conn.commit()


# --------------- User Search State ---------------

def get_search_state(user_id: int) -> Optional[dict]:
    conn = _get_conn()
    row = conn.execute(
        "SELECT state_json, updated_at FROM user_search_state WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if not row or not row["state_json"]:
        return None
    try:
        data = json.loads(row["state_json"])
        data["_updated_at"] = row["updated_at"]
        return data
    except (json.JSONDecodeError, TypeError):
        return None


def save_search_state(user_id: int, state: dict):
    conn = _get_conn()
    state_json = json.dumps(state, ensure_ascii=False)
    existing = conn.execute(
        "SELECT user_id FROM user_search_state WHERE user_id = ?", (user_id,)
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE user_search_state SET state_json = ?, updated_at = datetime('now') WHERE user_id = ?",
            (state_json, user_id),
        )
    else:
        conn.execute(
            "INSERT INTO user_search_state (user_id, state_json) VALUES (?, ?)",
            (user_id, state_json),
        )
    conn.commit()


def clear_search_state(user_id: int):
    conn = _get_conn()
    conn.execute("DELETE FROM user_search_state WHERE user_id = ?", (user_id,))
    conn.commit()


# --------------- Auto Config ---------------

def save_auto_config(resume_text: str = None, area: int = None,
                     remote_only: bool = None, search_queries: list = None,
                     interval_minutes: int = None, is_active: bool = None,
                     user_id: int = 0):
    conn = _get_conn()
    current = get_auto_config(user_id)
    conn.execute(
        """UPDATE auto_config SET
           resume_text = ?, area = ?, remote_only = ?,
           search_queries = ?, interval_minutes = ?, is_active = ?,
           updated_at = datetime('now')
           WHERE user_id = ?""",
        (
            resume_text if resume_text is not None else current["resume_text"],
            area if area is not None else current["area"],
            int(remote_only) if remote_only is not None else int(current["remote_only"]),
            json.dumps(search_queries) if search_queries is not None else json.dumps(current["search_queries"]),
            interval_minutes if interval_minutes is not None else current["interval_minutes"],
            int(is_active) if is_active is not None else int(current["is_active"]),
            user_id,
        ),
    )
    conn.commit()


def deactivate_auto_config(user_id: int):
    conn = _get_conn()
    conn.execute(
        "UPDATE auto_config SET is_active = 0, updated_at = datetime('now') WHERE user_id = ?",
        (user_id,),
    )
    conn.commit()


def get_all_active_auto_configs() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM auto_config WHERE is_active = 1"
    ).fetchall()
    result = []
    for row in rows:
        d = dict(row)
        d["search_queries"] = json.loads(d.get("search_queries") or "[]")
        d["is_active"] = bool(d.get("is_active"))
        d["remote_only"] = bool(d.get("remote_only"))
        result.append(d)
    return result


def check_user_can_apply(user_id: int) -> tuple[bool, str]:
    """Check if user has credits and active subscription. Returns (can_apply, reason)."""
    user = get_user_by_id(user_id)
    if not user:
        return False, "user_not_found"
    if user["credits"] <= 0:
        return False, "no_credits"
    sub_expires = user.get("subscription_expires_at")
    if sub_expires:
        try:
            expires_dt = datetime.fromisoformat(sub_expires)
            if expires_dt < datetime.now():
                return False, "subscription_expired"
        except (ValueError, TypeError):
            pass
    return True, "ok"


def set_subscription(user_id: int, expires_at: Optional[str]):
    conn = _get_conn()
    conn.execute(
        "UPDATE users SET subscription_expires_at = ? WHERE id = ?",
        (expires_at, user_id),
    )
    conn.commit()
