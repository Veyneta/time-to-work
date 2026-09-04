if (process.env.DATABASE_URL) {
  require("./server-postgres");
} else {
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const express = require("express");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const app = express();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
const dataDirectory = path.join(__dirname, "data");
const databasePath = path.join(dataDirectory, "timecation.db");

fs.mkdirSync(dataDirectory, { recursive: true });
const db = new Database(databasePath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.exec(fs.readFileSync(path.join(__dirname, "database", "schema.sql"), "utf8"));

const sessions = new Map();
const sessionLifetimeMs = 24 * 60 * 60 * 1000;
app.use(express.json({ limit: "5mb" }));
app.use(express.static(__dirname));

function publicUser(user) {
  return {
    id: user.id,
    storeId: user.store_id,
    name: user.name,
    role: user.role,
    active: Boolean(user.active),
    shiftStart: user.shift_start,
    shiftEnd: user.shift_end,
    grace: user.grace_minutes,
  };
}

function publicStore(store) {
  return {
    id: store.id,
    name: store.name,
    email: store.email,
    createdAt: store.created_at,
  };
}

function publicLog(log) {
  return {
    id: log.id,
    userId: log.user_id,
    userName: log.user_name,
    userRole: log.user_role,
    clockInAt: log.clock_in_at,
    clockOutAt: log.clock_out_at,
    inLat: log.in_lat,
    inLng: log.in_lng,
    outLat: log.out_lat,
    outLng: log.out_lng,
    selfieIn: log.selfie_in,
    selfieOut: log.selfie_out,
    geofenceDistanceIn: log.geofence_distance_in,
    geofenceDistanceOut: log.geofence_distance_out,
    source: log.source,
    notes: log.notes,
    auditTrail: JSON.parse(log.audit_trail || "[]"),
    createdAt: log.created_at,
    updatedAt: log.updated_at,
  };
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function requireAuth(request, response, next) {
  const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return response.status(401).json({ error: "กรุณาเข้าสู่ระบบใหม่" });
  }
  request.auth = { token, ...session };
  next();
}

function requireAdmin(request, response, next) {
  if (request.auth.role !== "admin") return response.status(403).json({ error: "ต้องใช้บัญชี Admin" });
  next();
}

function sameStore(request, response, next) {
  if (request.auth.storeId !== request.params.storeId) return response.status(403).json({ error: "ไม่มีสิทธิ์เข้าถึงร้านนี้" });
  next();
}

function dbLogForId(id, storeId) {
  return db.prepare("SELECT * FROM attendance_logs WHERE id = ? AND store_id = ?").get(id, storeId);
}

function isValidPin(pin) {
  return /^\d{4,8}$/.test(String(pin || ""));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

app.get("/api/health", (request, response) => {
  response.json({ ok: true });
});

app.post("/api/stores", async (request, response) => {
  const { name, email, password, adminName = "Admin", adminPin } = request.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!String(name || "").trim() || !isValidEmail(normalizedEmail) || String(password || "").length < 6 || !isValidPin(adminPin)) {
    return response.status(400).json({ error: "กรอกชื่อร้าน อีเมล รหัสผ่าน และ PIN admin ให้ถูกต้อง" });
  }

  const storeId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);
  const pinHash = await bcrypt.hash(String(adminPin), 12);

  try {
    const createStore = db.transaction(() => {
      db.prepare(`INSERT INTO stores (id, name, email, password_hash) VALUES (?, ?, ?, ?)`).run(
        storeId,
        String(name).trim(),
        normalizedEmail,
        passwordHash,
      );
      db.prepare(`INSERT INTO users (id, store_id, name, role, pin_hash) VALUES (?, ?, ?, 'admin', ?)`).run(
        adminId,
        storeId,
        String(adminName).trim() || "Admin",
        pinHash,
      );
    });
    createStore();
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return response.status(409).json({ error: "อีเมลร้านนี้มีอยู่แล้ว" });
    }
    if (error.code === "SQLITE_BUSY") {
      return response.status(503).json({ error: "ฐานข้อมูลกำลังถูกเปิดแก้ไขอยู่ กรุณาปิด DB Browser หรือกด Revert Changes แล้วลองใหม่" });
    }
    throw error;
  }

  const store = db.prepare("SELECT id, name, email, created_at FROM stores WHERE id = ?").get(storeId);
  const admin = db.prepare("SELECT * FROM users WHERE id = ?").get(adminId);
  response.status(201).json({ store: publicStore(store), admin: publicUser(admin) });
});

app.post("/api/auth/login", async (request, response) => {
  const { email, password, pin } = request.body || {};
  const store = db.prepare("SELECT * FROM stores WHERE email = ? COLLATE NOCASE").get(String(email || "").trim());
  if (!store || !(await bcrypt.compare(String(password || ""), store.password_hash))) {
    return response.status(401).json({ error: "อีเมลหรือรหัสผ่านร้านไม่ถูกต้อง" });
  }

  const users = db.prepare("SELECT * FROM users WHERE store_id = ? AND active = 1").all(store.id);
  let user = null;
  for (const candidate of users) {
    if (await bcrypt.compare(String(pin || ""), candidate.pin_hash)) {
      user = candidate;
      break;
    }
  }
  if (!user) return response.status(401).json({ error: "PIN พนักงานไม่ถูกต้อง" });

  const token = createToken();
  sessions.set(token, { storeId: store.id, userId: user.id, role: user.role, expiresAt: Date.now() + sessionLifetimeMs });
  response.json({ token, store: publicStore(store), user: publicUser(user) });
});

app.post("/api/auth/logout", requireAuth, (request, response) => {
  sessions.delete(request.auth.token);
  response.status(204).end();
});

app.post("/api/stores/:storeId/users", requireAuth, sameStore, requireAdmin, async (request, response) => {
  const { name, role = "employee", pin, shiftStart = "09:00", shiftEnd = "18:00", grace = 10 } = request.body || {};
  if (!String(name || "").trim() || !["admin", "employee"].includes(role) || !isValidPin(pin) || Number(grace) < 0) {
    return response.status(400).json({ error: "ข้อมูลผู้ใช้หรือ PIN ไม่ถูกต้อง" });
  }

  const store = db.prepare("SELECT id FROM stores WHERE id = ?").get(request.params.storeId);
  if (!store) return response.status(404).json({ error: "ไม่พบร้านค้า" });

  const userId = crypto.randomUUID();
  const pinHash = await bcrypt.hash(String(pin), 12);
  db.prepare(`
    INSERT INTO users (id, store_id, name, role, pin_hash, shift_start, shift_end, grace_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, store.id, String(name).trim(), role, pinHash, shiftStart, shiftEnd, Number(grace));

  response.status(201).json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(userId)) });
});

app.put("/api/stores/:storeId/users/:userId", requireAuth, sameStore, requireAdmin, async (request, response) => {
  const { name, role = "employee", pin, shiftStart = "09:00", shiftEnd = "18:00", grace = 10, active = true } = request.body || {};
  if (!String(name || "").trim() || !["admin", "employee"].includes(role) || (pin && !isValidPin(pin)) || Number(grace) < 0) {
    return response.status(400).json({ error: "ข้อมูลผู้ใช้หรือ PIN ไม่ถูกต้อง" });
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ? AND store_id = ?").get(request.params.userId, request.params.storeId);
  if (!user) return response.status(404).json({ error: "ไม่พบผู้ใช้" });

  const pinHash = pin ? await bcrypt.hash(String(pin), 12) : user.pin_hash;
  db.prepare(`
    UPDATE users
    SET name = ?, role = ?, pin_hash = ?, active = ?, shift_start = ?, shift_end = ?, grace_minutes = ?, updated_at = datetime('now')
    WHERE id = ? AND store_id = ?
  `).run(String(name).trim(), role, pinHash, active ? 1 : 0, shiftStart, shiftEnd, Number(grace), user.id, request.params.storeId);

  response.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(user.id)) });
});

app.delete("/api/stores/:storeId/users/:userId", requireAuth, sameStore, requireAdmin, (request, response) => {
  const result = db.prepare("DELETE FROM users WHERE id = ? AND store_id = ? AND role != 'admin'").run(request.params.userId, request.params.storeId);
  if (!result.changes) return response.status(404).json({ error: "ไม่พบผู้ใช้หรือไม่สามารถลบ Admin ได้" });
  response.status(204).end();
});

app.get("/api/stores/:storeId/users", requireAuth, sameStore, (request, response) => {
  const users = db.prepare("SELECT * FROM users WHERE store_id = ? ORDER BY name").all(request.params.storeId);
  response.json({ users: users.map(publicUser) });
});

app.post("/api/stores/:storeId/attendance/clock-in", requireAuth, sameStore, async (request, response) => {
  const { location, distance, selfie = null } = request.body || {};
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND store_id = ? AND active = 1").get(request.auth.userId, request.params.storeId);
  if (!user) return response.status(404).json({ error: "ไม่พบผู้ใช้ที่ใช้งานอยู่" });
  if (db.prepare("SELECT id FROM attendance_logs WHERE user_id = ? AND clock_out_at IS NULL").get(user.id)) {
    return response.status(409).json({ error: "มีรายการลงเวลาที่เปิดอยู่แล้ว" });
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO attendance_logs (id, store_id, user_id, user_name, user_role, clock_in_at, in_lat, in_lng, selfie_in, geofence_distance_in, audit_trail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, request.params.storeId, user.id, user.name, user.role, now, location?.latitude ?? null, location?.longitude ?? null, selfie, Math.round(Number(distance) || 0), JSON.stringify([{ at: now, action: "clock-in", reason: "self-service" }]));
  response.status(201).json({ log: publicLog(dbLogForId(id, request.params.storeId)) });
});

app.post("/api/stores/:storeId/attendance/clock-out", requireAuth, sameStore, async (request, response) => {
  const { location, distance, selfie = null } = request.body || {};
  const log = db.prepare("SELECT * FROM attendance_logs WHERE user_id = ? AND store_id = ? AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1").get(request.auth.userId, request.params.storeId);
  if (!log) return response.status(404).json({ error: "ไม่พบรายการ Clock In" });
  const now = new Date().toISOString();
  const auditTrail = JSON.parse(log.audit_trail || "[]");
  auditTrail.push({ at: now, action: "clock-out", reason: "self-service" });
  db.prepare("UPDATE attendance_logs SET clock_out_at = ?, out_lat = ?, out_lng = ?, selfie_out = ?, geofence_distance_out = ?, audit_trail = ?, updated_at = ? WHERE id = ?")
    .run(now, location?.latitude ?? null, location?.longitude ?? null, selfie, Math.round(Number(distance) || 0), JSON.stringify(auditTrail), now, log.id);
  response.json({ log: publicLog(dbLogForId(log.id, request.params.storeId)) });
});

app.get("/api/stores/:storeId/attendance", requireAuth, sameStore, (request, response) => {
  const logs = db.prepare("SELECT * FROM attendance_logs WHERE store_id = ? ORDER BY clock_in_at DESC").all(request.params.storeId);
  response.json({ logs: logs.map(publicLog) });
});
app.post("/api/stores/:storeId/attendance/migrate", requireAuth, sameStore, requireAdmin, (request, response) => {
  const logs = Array.isArray(request.body?.logs) ? request.body.logs : [];
  const users = new Set(db.prepare("SELECT id FROM users WHERE store_id = ?").all(request.params.storeId).map((user) => user.id));
  const insert = db.prepare(`INSERT OR IGNORE INTO attendance_logs (id, store_id, user_id, user_name, user_role, clock_in_at, clock_out_at, in_lat, in_lng, out_lat, out_lng, selfie_in, selfie_out, geofence_distance_in, geofence_distance_out, source, notes, audit_trail, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const migrate = db.transaction(() => {
    let migrated = 0;
    for (const log of logs) {
      if (!log.id || !users.has(log.userId) || !log.clockInAt) continue;
      const result = insert.run(log.id, request.params.storeId, log.userId, String(log.userName || ""), String(log.userRole || "employee"), log.clockInAt, log.clockOutAt || null, log.inLat ?? null, log.inLng ?? null, log.outLat ?? null, log.outLng ?? null, log.selfieIn || null, log.selfieOut || null, log.geofenceDistanceIn ?? null, log.geofenceDistanceOut ?? null, "migration", String(log.notes || ""), JSON.stringify(log.auditTrail || []), log.createdAt || log.clockInAt, log.updatedAt || log.clockInAt);
      migrated += result.changes;
    }
    return migrated;
  });
  response.json({ migrated: migrate() });
});

app.put("/api/stores/:storeId/attendance/:logId", requireAuth, sameStore, requireAdmin, (request, response) => {
  const { clockInAt, clockOutAt, reason } = request.body || {};
  if (!reason || !clockInAt) return response.status(400).json({ error: "ต้องระบุเวลาเข้าและเหตุผล" });
  const log = dbLogForId(request.params.logId, request.params.storeId);
  if (!log) return response.status(404).json({ error: "ไม่พบรายการลงเวลา" });
  const now = new Date().toISOString();
  const auditTrail = JSON.parse(log.audit_trail || "[]");
  auditTrail.push({ at: now, action: "manual-adjustment", reason: String(reason).trim() });
  db.prepare("UPDATE attendance_logs SET clock_in_at = ?, clock_out_at = ?, audit_trail = ?, updated_at = ? WHERE id = ?").run(clockInAt, clockOutAt || null, JSON.stringify(auditTrail), now, log.id);
  response.json({ log: publicLog(dbLogForId(log.id, request.params.storeId)) });
});

app.use((error, request, response, next) => {
  console.error(error);
  response.status(500).json({ error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
});

app.listen(port, host, () => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address && address.family === "IPv4" && !address.internal)
    .map((address) => `http://${address.address}:${port}`);
  console.log(`Time to Work API running at http://localhost:${port}`);
  addresses.forEach((address) => console.log(`LAN access: ${address}`));
});
}
