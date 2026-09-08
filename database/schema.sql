PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  store_lat REAL NOT NULL DEFAULT 13.7563,
  store_lng REAL NOT NULL DEFAULT 100.5018,
  store_radius REAL NOT NULL DEFAULT 250,
  late_grace INTEGER NOT NULL DEFAULT 10,
  ot_threshold REAL NOT NULL DEFAULT 9,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  role TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  shift_start TEXT NOT NULL DEFAULT '09:00',
  shift_end TEXT NOT NULL DEFAULT '18:00',
  grace_minutes INTEGER NOT NULL DEFAULT 10 CHECK (grace_minutes >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_role TEXT NOT NULL,
  clock_in_at TEXT NOT NULL,
  clock_out_at TEXT,
  in_lat REAL,
  in_lng REAL,
  out_lat REAL,
  out_lng REAL,
  selfie_in TEXT,
  selfie_out TEXT,
  geofence_distance_in INTEGER,
  geofence_distance_out INTEGER,
  source TEXT NOT NULL DEFAULT 'web',
  notes TEXT NOT NULL DEFAULT '',
  audit_trail TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_store_active ON users(store_id, active);
CREATE INDEX IF NOT EXISTS idx_users_store_role ON users(store_id, role);
CREATE INDEX IF NOT EXISTS idx_attendance_store_date ON attendance_logs(store_id, clock_in_at);
CREATE INDEX IF NOT EXISTS idx_attendance_user_open ON attendance_logs(user_id, clock_out_at);
