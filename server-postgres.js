const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.PORT || 8787);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 });
const sessions = new Map();
const sessionLifetimeMs = 24 * 60 * 60 * 1000;

app.use(express.json({ limit: "5mb" }));
app.use(express.static(__dirname));

function publicUser(user) {
  return { id: user.id, storeId: user.store_id, name: user.name, role: user.role, active: Boolean(user.active), shiftStart: user.shift_start, shiftEnd: user.shift_end, grace: user.grace_minutes };
}
function publicStore(store) { return { id: store.id, name: store.name, email: store.email, createdAt: store.created_at }; }
function publicLog(log) {
  return { id: log.id, userId: log.user_id, userName: log.user_name, userRole: log.user_role, clockInAt: log.clock_in_at, clockOutAt: log.clock_out_at, inLat: log.in_lat, inLng: log.in_lng, outLat: log.out_lat, outLng: log.out_lng, selfieIn: log.selfie_in, selfieOut: log.selfie_out, geofenceDistanceIn: log.geofence_distance_in, geofenceDistanceOut: log.geofence_distance_out, source: log.source, notes: log.notes, auditTrail: log.audit_trail || [], createdAt: log.created_at, updatedAt: log.updated_at };
}
function validPin(pin) { return /^\d{4,8}$/.test(String(pin || "")); }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "")); }
function publicSettings(store) { return { storeName: store.name, lat: Number(store.store_lat), lng: Number(store.store_lng), radius: Number(store.store_radius), lateGrace: Number(store.late_grace), otThreshold: Number(store.ot_threshold) }; }
function token() { return crypto.randomBytes(32).toString("hex"); }
async function one(sql, params = []) { const result = await pool.query(sql, params); return result.rows[0] || null; }
async function many(sql, params = []) { return (await pool.query(sql, params)).rows; }
async function run(sql, params = []) { return pool.query(sql, params); }
async function withTransaction(callback) { const client = await pool.connect(); try { await client.query("BEGIN"); const result = await callback(client); await client.query("COMMIT"); return result; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
async function ensureSchema() {
  const schema = fs.readFileSync(path.join(__dirname, "database", "schema-postgres.sql"), "utf8");
  await pool.query(schema);
  await pool.query(`
    ALTER TABLE stores
      ADD COLUMN IF NOT EXISTS store_lat DOUBLE PRECISION NOT NULL DEFAULT 13.7563,
      ADD COLUMN IF NOT EXISTS store_lng DOUBLE PRECISION NOT NULL DEFAULT 100.5018,
      ADD COLUMN IF NOT EXISTS store_radius DOUBLE PRECISION NOT NULL DEFAULT 250,
      ADD COLUMN IF NOT EXISTS late_grace INTEGER NOT NULL DEFAULT 10,
      ADD COLUMN IF NOT EXISTS ot_threshold DOUBLE PRECISION NOT NULL DEFAULT 9
  `);
}
function requireAuth(request, response, next) { const value = String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""); const current = sessions.get(value); if (!current || current.expiresAt < Date.now()) { sessions.delete(value); return response.status(401).json({ error: "กรุณาเข้าสู่ระบบใหม่" }); } request.auth = { token: value, ...current }; next(); }
function requireAdmin(request, response, next) { if (request.auth.role !== "admin") return response.status(403).json({ error: "ต้องใช้บัญชี Admin" }); next(); }
function sameStore(request, response, next) { if (request.auth.storeId !== request.params.storeId) return response.status(403).json({ error: "ไม่มีสิทธิ์เข้าถึงร้านนี้" }); next(); }

app.get("/api/health", async (request, response) => { try { await run("SELECT 1"); response.json({ ok: true, database: "postgres" }); } catch (error) { console.error(error); response.status(503).json({ ok: false, error: "database unavailable" }); } });

app.post("/api/stores", async (request, response, next) => {
  const { name, email, password, adminName = "Admin", adminPin } = request.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!String(name || "").trim() || !validEmail(normalizedEmail) || String(password || "").length < 6 || !validPin(adminPin)) return response.status(400).json({ error: "กรอกชื่อร้าน อีเมล รหัสผ่าน และ PIN admin ให้ถูกต้อง" });
  const storeId = crypto.randomUUID(); const adminId = crypto.randomUUID();
  try {
    const passwordHash = await bcrypt.hash(password, 12); const pinHash = await bcrypt.hash(String(adminPin), 12);
    await withTransaction(async (client) => { await client.query("INSERT INTO stores (id,name,email,password_hash) VALUES ($1,$2,$3,$4)", [storeId, String(name).trim(), normalizedEmail, passwordHash]); await client.query("INSERT INTO users (id,store_id,name,role,pin_hash) VALUES ($1,$2,$3,'admin',$4)", [adminId, storeId, String(adminName).trim() || "Admin", pinHash]); });
    const store = await one("SELECT id,name,email,created_at FROM stores WHERE id=$1", [storeId]); const admin = await one("SELECT * FROM users WHERE id=$1", [adminId]); response.status(201).json({ store: publicStore(store), admin: publicUser(admin) });
  } catch (error) { if (error.code === "23505") return response.status(409).json({ error: "อีเมลร้านนี้มีอยู่แล้ว" }); next(error); }
});

app.post("/api/auth/login", async (request, response, next) => {
  try {
    const { email, password, pin } = request.body || {}; const store = await one("SELECT * FROM stores WHERE LOWER(email)=LOWER($1)", [String(email || "").trim()]);
    if (!store || !(await bcrypt.compare(String(password || ""), store.password_hash))) return response.status(401).json({ error: "อีเมลหรือรหัสผ่านร้านไม่ถูกต้อง" });
    const users = await many("SELECT * FROM users WHERE store_id=$1 AND active=TRUE", [store.id]); let user = null;
    for (const candidate of users) if (await bcrypt.compare(String(pin || ""), candidate.pin_hash)) { user = candidate; break; }
    if (!user) return response.status(401).json({ error: "PIN พนักงานไม่ถูกต้อง" });
    const authToken = token(); sessions.set(authToken, { storeId: store.id, userId: user.id, role: user.role, expiresAt: Date.now() + sessionLifetimeMs });
    response.json({ token: authToken, store: publicStore(store), user: publicUser(user) });
  } catch (error) { next(error); }
});
app.post("/api/auth/logout", requireAuth, (request, response) => { sessions.delete(request.auth.token); response.status(204).end(); });

app.get("/api/stores/:storeId/settings", requireAuth, sameStore, async (request, response, next) => { try { const store = await one("SELECT * FROM stores WHERE id=$1", [request.params.storeId]); if (!store) return response.status(404).json({ error: "ไม่พบร้านค้า" }); response.json({ settings: publicSettings(store) }); } catch (error) { next(error); } });
app.put("/api/stores/:storeId/settings", requireAuth, sameStore, requireAdmin, async (request, response, next) => { try { const { storeName, lat, lng, radius, lateGrace, otThreshold } = request.body || {}; const values = [Number(lat), Number(lng), Number(radius), Number(lateGrace), Number(otThreshold)]; if (!String(storeName || "").trim() || values.some((value) => !Number.isFinite(value)) || values[2] <= 0 || values[3] < 0 || values[4] < 0 || values[0] < -90 || values[0] > 90 || values[1] < -180 || values[1] > 180) return response.status(400).json({ error: "ข้อมูลการตั้งค่าร้านไม่ถูกต้อง" }); const store = await one("UPDATE stores SET name=$1,store_lat=$2,store_lng=$3,store_radius=$4,late_grace=$5,ot_threshold=$6,updated_at=NOW() WHERE id=$7 RETURNING *", [String(storeName).trim(), ...values, request.params.storeId]); if (!store) return response.status(404).json({ error: "ไม่พบร้านค้า" }); response.json({ settings: publicSettings(store) }); } catch (error) { next(error); } });

app.post("/api/stores/:storeId/users", requireAuth, sameStore, requireAdmin, async (request, response, next) => {
  try { const { name, role = "employee", pin, shiftStart = "09:00", shiftEnd = "18:00", grace = 10 } = request.body || {}; if (!String(name || "").trim() || !["admin", "employee"].includes(role) || !validPin(pin) || Number(grace) < 0) return response.status(400).json({ error: "ข้อมูลผู้ใช้หรือ PIN ไม่ถูกต้อง" }); const id = crypto.randomUUID(); const hash = await bcrypt.hash(String(pin), 12); await run("INSERT INTO users (id,store_id,name,role,pin_hash,shift_start,shift_end,grace_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [id, request.params.storeId, String(name).trim(), role, hash, shiftStart, shiftEnd, Number(grace)]); response.status(201).json({ user: publicUser(await one("SELECT * FROM users WHERE id=$1", [id])) }); } catch (error) { next(error); }
});
app.put("/api/stores/:storeId/users/:userId", requireAuth, sameStore, requireAdmin, async (request, response, next) => {
  try { const { name, role = "employee", pin, shiftStart = "09:00", shiftEnd = "18:00", grace = 10, active = true } = request.body || {}; const old = await one("SELECT * FROM users WHERE id=$1 AND store_id=$2", [request.params.userId, request.params.storeId]); if (!old) return response.status(404).json({ error: "ไม่พบผู้ใช้" }); if (!String(name || "").trim() || !["admin", "employee"].includes(role) || (pin && !validPin(pin)) || Number(grace) < 0) return response.status(400).json({ error: "ข้อมูลผู้ใช้หรือ PIN ไม่ถูกต้อง" }); const hash = pin ? await bcrypt.hash(String(pin), 12) : old.pin_hash; await run("UPDATE users SET name=$1,role=$2,pin_hash=$3,active=$4,shift_start=$5,shift_end=$6,grace_minutes=$7,updated_at=NOW() WHERE id=$8 AND store_id=$9", [String(name).trim(), role, hash, Boolean(active), shiftStart, shiftEnd, Number(grace), old.id, request.params.storeId]); response.json({ user: publicUser(await one("SELECT * FROM users WHERE id=$1", [old.id])) }); } catch (error) { next(error); }
});
app.delete("/api/stores/:storeId/users/:userId", requireAuth, sameStore, requireAdmin, async (request, response, next) => { try { const result = await run("DELETE FROM users WHERE id=$1 AND store_id=$2 AND role!='admin'", [request.params.userId, request.params.storeId]); if (!result.rowCount) return response.status(404).json({ error: "ไม่พบผู้ใช้หรือไม่สามารถลบ Admin ได้" }); response.status(204).end(); } catch (error) { next(error); } });
app.get("/api/stores/:storeId/users", requireAuth, sameStore, async (request, response, next) => { try { response.json({ users: (await many("SELECT * FROM users WHERE store_id=$1 ORDER BY name", [request.params.storeId])).map(publicUser) }); } catch (error) { next(error); } });

app.post("/api/stores/:storeId/attendance/clock-in", requireAuth, sameStore, async (request, response, next) => { try { const { location, distance, selfie = null } = request.body || {}; const user = await one("SELECT * FROM users WHERE id=$1 AND store_id=$2 AND active=TRUE", [request.auth.userId, request.params.storeId]); if (!user) return response.status(404).json({ error: "ไม่พบผู้ใช้ที่ใช้งานอยู่" }); if (await one("SELECT id FROM attendance_logs WHERE user_id=$1 AND clock_out_at IS NULL", [user.id])) return response.status(409).json({ error: "มีรายการลงเวลาที่เปิดอยู่แล้ว" }); const id = crypto.randomUUID(); const now = new Date().toISOString(); await run("INSERT INTO attendance_logs (id,store_id,user_id,user_name,user_role,clock_in_at,in_lat,in_lng,selfie_in,geofence_distance_in,audit_trail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)", [id, request.params.storeId, user.id, user.name, user.role, now, location?.latitude ?? null, location?.longitude ?? null, selfie, Math.round(Number(distance) || 0), JSON.stringify([{ at: now, action: "clock-in", reason: "self-service" }])]); response.status(201).json({ log: publicLog(await one("SELECT * FROM attendance_logs WHERE id=$1", [id])) }); } catch (error) { next(error); } });
app.post("/api/stores/:storeId/attendance/clock-out", requireAuth, sameStore, async (request, response, next) => { try { const { location, distance, selfie = null } = request.body || {}; const log = await one("SELECT * FROM attendance_logs WHERE user_id=$1 AND store_id=$2 AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1", [request.auth.userId, request.params.storeId]); if (!log) return response.status(404).json({ error: "ไม่พบรายการ Clock In" }); const now = new Date().toISOString(); const audit = [...(log.audit_trail || []), { at: now, action: "clock-out", reason: "self-service" }]; await run("UPDATE attendance_logs SET clock_out_at=$1,out_lat=$2,out_lng=$3,selfie_out=$4,geofence_distance_out=$5,audit_trail=$6::jsonb,updated_at=$1 WHERE id=$7", [now, location?.latitude ?? null, location?.longitude ?? null, selfie, Math.round(Number(distance) || 0), JSON.stringify(audit), log.id]); response.json({ log: publicLog(await one("SELECT * FROM attendance_logs WHERE id=$1", [log.id])) }); } catch (error) { next(error); } });
app.get("/api/stores/:storeId/attendance", requireAuth, sameStore, async (request, response, next) => { try { response.json({ logs: (await many("SELECT * FROM attendance_logs WHERE store_id=$1 ORDER BY clock_in_at DESC", [request.params.storeId])).map(publicLog) }); } catch (error) { next(error); } });
app.put("/api/stores/:storeId/attendance/:logId", requireAuth, sameStore, requireAdmin, async (request, response, next) => { try { const { clockInAt, clockOutAt, reason } = request.body || {}; const log = await one("SELECT * FROM attendance_logs WHERE id=$1 AND store_id=$2", [request.params.logId, request.params.storeId]); if (!log) return response.status(404).json({ error: "ไม่พบรายการลงเวลา" }); if (!reason || !clockInAt) return response.status(400).json({ error: "ต้องระบุเวลาเข้าและเหตุผล" }); const now = new Date().toISOString(); const audit = [...(log.audit_trail || []), { at: now, action: "manual-adjustment", reason: String(reason).trim() }]; await run("UPDATE attendance_logs SET clock_in_at=$1,clock_out_at=$2,audit_trail=$3::jsonb,updated_at=$4 WHERE id=$5", [clockInAt, clockOutAt || null, JSON.stringify(audit), now, log.id]); response.json({ log: publicLog(await one("SELECT * FROM attendance_logs WHERE id=$1", [log.id])) }); } catch (error) { next(error); } });
app.post("/api/stores/:storeId/attendance/migrate", requireAuth, sameStore, requireAdmin, async (request, response, next) => { try { const logs = Array.isArray(request.body?.logs) ? request.body.logs : []; const users = new Set((await many("SELECT id FROM users WHERE store_id=$1", [request.params.storeId])).map((user) => user.id)); let migrated = 0; for (const log of logs) { if (!log.id || !users.has(log.userId) || !log.clockInAt) continue; const result = await run("INSERT INTO attendance_logs (id,store_id,user_id,user_name,user_role,clock_in_at,clock_out_at,in_lat,in_lng,out_lat,out_lng,selfie_in,selfie_out,geofence_distance_in,geofence_distance_out,source,notes,audit_trail,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20) ON CONFLICT (id) DO NOTHING", [log.id, request.params.storeId, log.userId, log.userName || "", log.userRole || "employee", log.clockInAt, log.clockOutAt || null, log.inLat ?? null, log.inLng ?? null, log.outLat ?? null, log.outLng ?? null, log.selfieIn || null, log.selfieOut || null, log.geofenceDistanceIn ?? null, log.geofenceDistanceOut ?? null, "migration", log.notes || "", JSON.stringify(log.auditTrail || []), log.createdAt || log.clockInAt, log.updatedAt || log.clockInAt]); migrated += result.rowCount; } response.json({ migrated }); } catch (error) { next(error); } });

app.use((error, request, response, next) => { console.error(error); response.status(500).json({ error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" }); });

(async () => { try { await ensureSchema(); app.listen(port, "0.0.0.0", () => console.log(`Time to Work PostgreSQL API running at port ${port}`)); } catch (error) { console.error("PostgreSQL startup failed", error.code || error.message); process.exit(1); } })();
