CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER users_updated_at
AFTER UPDATE ON users
FOR EACH ROW
BEGIN
  UPDATE users SET updated_at = datetime('now') WHERE id = OLD.id;
END;
