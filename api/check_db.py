import db, sqlite3
from pathlib import Path
db.init_db()
for u in db.get_all_users():
    print(f"User {u['id']}: {u['email']} credits={u['credits']} admin={u['is_admin']}")
DB_PATH = Path(__file__).parent / "hh.db"
print(f"\nDB path: {DB_PATH} exists={DB_PATH.exists()}")
conn = sqlite3.connect(str(DB_PATH))
conn.row_factory = sqlite3.Row
rows = conn.execute("SELECT user_id, COUNT(*) as cnt, status FROM vacancies GROUP BY user_id, status").fetchall()
print("\nVacancies by user_id/status:")
for r in rows:
    print(f"  user_id={r['user_id']} status={r['status']} count={r['cnt']}")
apps = conn.execute("SELECT user_id, COUNT(*) as cnt FROM applications GROUP BY user_id").fetchall()
print("\nApplications by user_id:")
for r in apps:
    print(f"  user_id={r['user_id']} count={r['cnt']}")
