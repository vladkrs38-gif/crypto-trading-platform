"""One-time script to create admin user."""
import db
import bcrypt as _bcrypt

db.init_db()
pw = _bcrypt.hashpw("admin123".encode(), _bcrypt.gensalt()).decode()
user = db.create_user("admin@proplatforma.ru", pw, "Admin")
print("User created:", user)

conn = db._get_conn()
conn.execute("UPDATE users SET is_admin = 1, credits = 99999 WHERE email = ?", ("admin@proplatforma.ru",))
conn.commit()
print("Admin privileges set!")
