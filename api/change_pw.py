import bcrypt as _bcrypt, db
db.init_db()
pw = _bcrypt.hashpw("HhAut0P1lot!2026".encode(), _bcrypt.gensalt()).decode()
conn = db._get_conn()
conn.execute("UPDATE users SET password_hash = ? WHERE email = ?", (pw, "admin@proplatforma.ru"))
conn.commit()
print("Admin password updated to: HhAut0P1lot!2026")
