ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN is_email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN balance INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE users ADD COLUMN reset_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN leaderboard_profit REAL NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN leaderboard_correct_stake REAL NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN leaderboard_resolved_stake REAL NOT NULL DEFAULT 0;

UPDATE users
SET username = 'user' || id
WHERE username IS NULL OR username = '';

CREATE UNIQUE INDEX users_username_unique ON users(username);

CREATE TABLE markets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('politics', 'tech', 'climate', 'community')),
  close_at TEXT NOT NULL,
  resolution_criteria TEXT NOT NULL,
  source_of_truth TEXT NOT NULL,
  fallback_rule TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved_yes', 'resolved_no', 'expired')),
  q_yes REAL NOT NULL DEFAULT 0,
  q_no REAL NOT NULL DEFAULT 0,
  resolved_at TEXT,
  expired_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER markets_updated_at
AFTER UPDATE ON markets
FOR EACH ROW
BEGIN
  UPDATE markets SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TABLE positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  yes_shares REAL NOT NULL DEFAULT 0,
  no_shares REAL NOT NULL DEFAULT 0,
  yes_cost REAL NOT NULL DEFAULT 0,
  no_cost REAL NOT NULL DEFAULT 0,
  reset_generation INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, market_id)
);

CREATE TRIGGER positions_updated_at
AFTER UPDATE ON positions
FOR EACH ROW
BEGIN
  UPDATE positions SET updated_at = datetime('now') WHERE id = OLD.id;
END;

CREATE TABLE trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('buy', 'sell')),
  side TEXT NOT NULL CHECK (side IN ('yes', 'no')),
  shares REAL NOT NULL,
  credits REAL NOT NULL,
  average_price REAL NOT NULL,
  price_after REAL NOT NULL,
  price_impact REAL NOT NULL,
  reset_generation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX trades_market_created_idx ON trades(market_id, created_at);
CREATE INDEX trades_user_created_idx ON trades(user_id, created_at);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX comments_market_created_idx ON comments(market_id, created_at);
