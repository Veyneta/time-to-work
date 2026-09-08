CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  store_lat DOUBLE PRECISION NOT NULL DEFAULT 13.7563,
  store_lng DOUBLE PRECISION NOT NULL DEFAULT 100.5018,
  store_radius DOUBLE PRECISION NOT NULL DEFAULT 250,
  late_grace INTEGER NOT NULL DEFAULT 10,
  ot_threshold DOUBLE PRECISION NOT NULL DEFAULT 9,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  role TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
  pin_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  shift_start TEXT NOT NULL DEFAULT '09:00',
  shift_end TEXT NOT NULL DEFAULT '18:00',
  grace_minutes INTEGER NOT NULL DEFAULT 10 CHECK (grace_minutes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  user_role TEXT NOT NULL,
  clock_in_at TIMESTAMPTZ NOT NULL,
  clock_out_at TIMESTAMPTZ,
  in_lat DOUBLE PRECISION,
  in_lng DOUBLE PRECISION,
  out_lat DOUBLE PRECISION,
  out_lng DOUBLE PRECISION,
  selfie_in TEXT,
  selfie_out TEXT,
  geofence_distance_in INTEGER,
  geofence_distance_out INTEGER,
  source TEXT NOT NULL DEFAULT 'web',
  notes TEXT NOT NULL DEFAULT '',
  audit_trail JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_store_active ON users(store_id, active);
CREATE INDEX IF NOT EXISTS idx_users_store_role ON users(store_id, role);
CREATE INDEX IF NOT EXISTS idx_attendance_store_date ON attendance_logs(store_id, clock_in_at);
CREATE INDEX IF NOT EXISTS idx_attendance_user_open ON attendance_logs(user_id, clock_out_at);
