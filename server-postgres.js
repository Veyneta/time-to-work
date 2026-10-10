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
app.use((request, response, next) => {
  if (request.path.startsWith("/api/")) response.set("Cache-Control", "no-store, no-cache, must-revalidate");
  next();
});

function publicUser(user) {
  return { id: user.id, storeId: user.store_id, name: user.name, role: user.role, active: Boolean(user.active), shiftStart: user.shift_start, shiftEnd: user.shift_end, grace: user.grace_minutes };
}
function publicStore(store) { return { id: store.id, accountId: store.account_id, name: store.name, email: store.email, createdAt: store.created_at }; }
function publicLog(log) {
  return { id: log.id, userId: log.user_id, userName: log.user_name, userRole: log.user_role, clockInAt: log.clock_in_at, clockOutAt: log.clock_out_at, inLat: log.in_lat, inLng: log.in_lng, outLat: log.out_lat, outLng: log.out_lng, geofenceDistanceIn: log.geofence_distance_in, geofenceDistanceOut: log.geofence_distance_out, source: log.source, notes: log.notes, auditTrail: log.audit_trail || [], createdAt: log.created_at, updatedAt: log.updated_at };
}
function validPin(pin) { return /^\d{4,8}$/.test(String(pin || "")); }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "")); }
function publicSettings(store) { return { storeName: store.name, lat: Number(store.store_lat), lng: Number(store.store_lng), radius: Number(store.store_radius), lateGrace: Number(store.late_grace) }; }
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
      ADD COLUMN IF NOT EXISTS account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS store_lat DOUBLE PRECISION NOT NULL DEFAULT 13.7563,
      ADD COLUMN IF NOT EXISTS store_lng DOUBLE PRECISION NOT NULL DEFAULT 100.5018,
      ADD COLUMN IF NOT EXISTS store_radius DOUBLE PRECISION NOT NULL DEFAULT 250,
      ADD COLUMN IF NOT EXISTS late_grace INTEGER NOT NULL DEFAULT 10
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_stores_account ON stores(account_id)");
  await pool.query("ALTER TABLE stores DROP CONSTRAINT IF EXISTS stores_email_key");
  await pool.query("INSERT INTO accounts (id, name, email, password_hash) SELECT id, name, email, password_hash FROM stores WHERE account_id IS NULL ON CONFLICT (email) DO NOTHING");
  await pool.query("UPDATE stores AS stores SET account_id = accounts.id FROM accounts WHERE stores.account_id IS NULL AND accounts.email = stores.email");
}
function requireAuth(request, response, next) { const value = String(request.headers.authorization || "").replace(/^Bearer\s+/i, ""); const current = sessions.get(value); if (!current || current.expiresAt < Date.now()) { sessions.delete(value); return response.status(401).json({ error: "กรุณาเข้าสู่ระบบใหม่" }); } request.auth = { token: value, ...current }; next(); }
function requireAdmin(request, response, next) { if (request.auth.role !== "admin") return response.status(403).json({ error: "ต้องใช้บัญชี Admin" }); next(); }
function sameStore(request, response, next) { if (request.auth.storeId !== request.params.storeId) return response.status(403).json({ error: "ไม่มีสิทธิ์เข้าถึงร้านนี้" }); next(); }
function sameAccount(request, response, next) { if (!request.auth.accountId) return response.status(403).json({ error: "บัญชีนี้ยังไม่รองรับหลายสาขา" }); next(); }

app.get("/api/health", async (request, response) => { try { await run("SELECT 1"); response.json({ ok: true, database: "postgres" }); } catch (error) { console.error(error); response.status(503).json({ ok: false, error: "database unavailable" }); } });

app.post("/api/stores", async (request, response, next) => {
  const { name, email, password, adminName = "Admin", adminPin } = request.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!String(name || "").trim() || !validEmail(normalizedEmail) || String(password || "").length < 6 || !validPin(adminPin)) return response.status(400).json({ error: "กรอกชื่อร้าน อีเมล รหัสผ่าน และ PIN admin ให้ถูกต้อง" });
  const accountId = crypto.randomUUID(); const storeId = crypto.randomUUID(); const adminId = crypto.randomUUID();
  try {
    const passwordHash = await bcrypt.hash(password, 12); const pinHash = await bcrypt.hash(String(adminPin), 12);
    await withTransaction(async (client) => { await client.query("INSERT INTO accounts (id,name,email,password_hash) VALUES ($1,$2,$3,$4)", [accountId, String(name).trim(), normalizedEmail, passwordHash]); await client.query("INSERT INTO stores (id,account_id,name,email,password_hash) VALUES ($1,$2,$3,$4,$5)", [storeId, accountId, String(name).trim(), normalizedEmail, passwordHash]); await client.query("INSERT INTO users (id,store_id,name,role,pin_hash) VALUES ($1,$2,$3,'admin',$4)", [adminId, storeId, String(adminName).trim() || "Admin", pinHash]); });
    const store = await one("SELECT id,name,email,created_at FROM stores WHERE id=$1", [storeId]); const admin = await one("SELECT * FROM users WHERE id=$1", [adminId]); response.status(201).json({ store: publicStore(store), admin: publicUser(admin) });
  } catch (error) { if (error.code === "23505") return response.status(409).json({ error: "อีเมลร้านนี้มีอยู่แล้ว" }); next(error); }
});

app.post("/api/stores/:storeId/branches", requireAuth, sameStore, requireAdmin, async (request, response, next) => {
  try {
    const name = String(request.body?.name || "").trim();
    if (!name) return response.status(400).json({ error: "กรอกชื่อสาขา" });
    const account = await one("SELECT * FROM accounts WHERE id=$1", [request.auth.accountId]);
    const admin = await one("SELECT * FROM users WHERE id=$1 AND store_id=$2", [request.auth.userId, request.params.storeId]);
    if (!account || !admin) return response.status(403).json({ error: "ไม่มีสิทธิ์สร้างสาขา" });
    const branchId = crypto.randomUUID();
    const adminId = crypto.randomUUID();
    await withTransaction(async (client) => {
      await client.query("INSERT INTO stores (id,account_id,name,email,password_hash) VALUES ($1,$2,$3,$4,$5)", [branchId, account.id, name, account.email, account.password_hash]);
      await client.query("INSERT INTO users (id,store_id,name,role,pin_hash) VALUES ($1,$2,$3,'admin',$4)", [adminId, branchId, admin.name, admin.pin_hash]);
    });
    const branch = await one("SELECT * FROM stores WHERE id=$1", [branchId]);
    response.status(201).json({ branch: publicStore(branch), user: publicUser(await one("SELECT * FROM users WHERE id=$1", [adminId])) });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", async (request, response, next) => {
  try {
    const { email, password, pin } = request.body || {}; const account = await one("SELECT * FROM accounts WHERE LOWER(email)=LOWER($1)", [String(email || "").trim()]);
    if (!account || !(await bcrypt.compare(String(password || ""), account.password_hash))) return response.status(401).json({ error: "อีเมลหรือรหัสผ่านร้านไม่ถูกต้อง" });
    const branches = await many("SELECT * FROM stores WHERE account_id=$1 ORDER BY created_at", [account.id]);
    const users = await many("SELECT users.*, stores.account_id FROM users JOIN stores ON stores.id=users.store_id WHERE stores.account_id=$1 AND users.active=TRUE", [account.id]); let user = null;
    for (const candidate of users) if (await bcrypt.compare(String(pin || ""), candidate.pin_hash)) { user = candidate; break; }
    if (!user) return response.status(401).json({ error: "PIN พนักงานไม่ถูกต้อง" });
    const store = branches.find((branch) => branch.id === user.store_id) || branches[0];
    const authToken = token(); sessions.set(authToken, { accountId: account.id, storeId: store.id, userId: user.id, role: user.role, expiresAt: Date.now() + sessionLifetimeMs });
    response.json({ token: authToken, accountId: account.id, store: publicStore(store), branches: branches.map(publicStore), settings: publicSettings(store), user: publicUser(user) });
  } catch (error) { next(error); }
});
app.post("/api/auth/logout", requireAuth, (request, response) => { sessions.delete(request.auth.token); response.status(204).end(); });
app.get("/api/auth/branches", requireAuth, async (request, response, next) => { try { response.json({ branches: (await many("SELECT * FROM stores WHERE account_id=$1 ORDER BY created_at", [request.auth.accountId])).map(publicStore) }); } catch (error) { next(error); } });

app.post("/api/auth/switch-branch", requireAuth, async (request, response, next) => {
  try {
    const branch = await one("SELECT * FROM stores WHERE id=$1 AND account_id=$2", [request.body?.storeId, request.auth.accountId]);
    if (!branch) return response.status(404).json({ error: "ไม่พบสาขาที่เลือก" });
    let branchUser;
    if (request.auth.role === "admin") {
      branchUser = await one("SELECT * FROM users WHERE store_id=$1 AND role='admin' AND active=TRUE ORDER BY created_at LIMIT 1", [branch.id]);
    } else {
      const candidates = await many("SELECT * FROM users WHERE store_id=$1 AND role='employee' AND active=TRUE AND LOWER(name)=LOWER($2)", [branch.id, String(request.body?.userName || "")]);
      for (const candidate of candidates) {
        if (await bcrypt.compare(String(request.body?.pin || ""), candidate.pin_hash)) {
          branchUser = candidate;
          break;
        }
      }
    }
    if (!branchUser) return response.status(409).json({ error: request.auth.role === "admin" ? "สาขานี้ยังไม่มีผู้ดูแล" : "คุณไม่มีข้อมูลพนักงานในสาขานี้ จึงไม่สามารถลงเวลาได้" });
    const current = sessions.get(request.auth.token);
    current.storeId = branch.id;
    current.userId = branchUser.id;
    current.role = branchUser.role;
    sessions.set(request.auth.token, current);
    response.json({ store: publicStore(branch), settings: publicSettings(branch), user: publicUser(branchUser) });
  } catch (error) { next(error); }
});

app.get("/api/stores/:storeId/settings", requireAuth, sameStore, async (request, response, next) => { try { const store = await one("SELECT * FROM stores WHERE id=$1", [request.params.storeId]); if (!store) return response.status(404).json({ error: "ไม่พบร้านค้า" }); response.json({ settings: publicSettings(store) }); } catch (error) { next(error); } });
app.put("/api/stores/:storeId/settings", requireAuth, sameStore, requireAdmin, async (request, response, next) => { try { const { storeName, lat, lng, radius, lateGrace } = request.body || {}; const values = [Number(lat), Number(lng), Number(radius), Number(lateGrace)]; if (!String(storeName || "").trim() || values.some((value) => !Number.isFinite(value)) || values[2] <= 0 || values[3] < 0 || values[0] < -90 || values[0] > 90 || values[1] < -180 || values[1] > 180) return response.status(400).json({ error: "ข้อมูลการตั้งค่าร้านไม่ถูกต้อง" }); const store = await one("UPDATE stores SET name=$1,store_lat=$2,store_lng=$3,store_radius=$4,late_grace=$5,updated_at=NOW() WHERE id=$6 RETURNING *", [String(storeName).trim(), ...values, request.params.storeId]); if (!store) return response.status(404).json({ error: "ไม่พบร้านค้า" }); response.json({ settings: publicSettings(store) }); } catch (error) { next(error); } });

app.post("/api/stores/:storeId/users", requireAuth, sameStore, requireAdmin, async (request, response, next) => {
  try { const { name, role = "employee", pin, shiftStart = "09:00", shiftEnd = "18:00", grace = 10 } = request.body || {}; if (!String(name || "").trim() || !["admin", "employee"].includes(role) || !validPin(pin) || Number(grace) < 0) return response.status(400).json({ error: "ข้อมูลผู้ใช้หรือ PIN ไม่ถูกต้อง" }); const id = crypto.randomUUID(); const hash = await bcrypt.hash(String(pin), 12); await run("INSERT INTO users (id,store_id,name,role,pin_hash,shift_start,shift_end,grace_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [id, request.params.storeId, String(name).trim(), role, hash, shiftStart, shiftEnd, Number(grace)]); response.status(201).json({ user: publicUser(await one("SELECT * FROM users WHERE id=$1", [id])) }); } catch (error) { next(error); }
});
app.put("/api/stores/:storeId/users/:userId", requireAuth, sameStore, requireAdmin, async (request, response, next) => {
  try { const { name, role = "employee", pin, shiftStart = "09:00", shiftEnd = "18:00", grace = 10, active = true } = request.body || {}; const old = await one("SELECT * FROM users WHERE id=$1 AND store_id=$2", [request.params.userId, request.params.storeId]); if (!old) return response.status(404).json({ error: "ไม่พบผู้ใช้" }); if (!String(name || "").trim() || !["admin", "employee"].includes(role) || (pin && !validPin(pin)) || Number(grace) < 0) return response.status(400).json({ error: "ข้อมูลผู้ใช้หรือ PIN ไม่ถูกต้อง" }); const hash = pin ? await bcrypt.hash(String(pin), 12) : old.pin_hash; await run("UPDATE users SET name=$1,role=$2,pin_hash=$3,active=$4,shift_start=$5,shift_end=$6,grace_minutes=$7,updated_at=NOW() WHERE id=$8 AND store_id=$9", [String(name).trim(), role, hash, Boolean(active), shiftStart, shiftEnd, Number(grace), old.id, request.params.storeId]); response.json({ user: publicUser(await one("SELECT * FROM users WHERE id=$1", [old.id])) }); } catch (error) { next(error); }
});
app.delete("/api/stores/:storeId/users/:userId", requireAuth, sameStore, requireAdmin, async (request, response, next) => { try { const result = await run("DELETE FROM users WHERE id=$1 AND store_id=$2 AND role!='admin'", [request.params.userId, request.params.storeId]); if (!result.rowCount) return response.status(404).json({ error: "ไม่พบผู้ใช้หรือไม่สามารถลบ Admin ได้" }); response.status(204).end(); } catch (error) { next(error); } });
app.get("/api/stores/:storeId/users", requireAuth, sameStore, async (request, response, next) => { try { response.json({ users: (await many("SELECT * FROM users WHERE store_id=$1 ORDER BY name", [request.params.storeId])).map(publicUser) }); } catch (error) { next(error); } });

app.post("/api/stores/:storeId/users/import", requireAuth, sameStore, requireAdmin, sameAccount, async (request, response, next) => {
  try {
    const sourceStoreId = String(request.body?.sourceStoreId || "");
    if (!sourceStoreId || sourceStoreId === request.params.storeId) return response.status(400).json({ error: "เลือกสาขาต้นทางให้ถูกต้อง" });
    const source = await one("SELECT id FROM stores WHERE id=$1 AND account_id=$2", [sourceStoreId, request.auth.accountId]);
    if (!source) return response.status(404).json({ error: "ไม่พบสาขาต้นทาง" });
    const sourceUsers = await many("SELECT * FROM users WHERE store_id=$1 AND role='employee'", [sourceStoreId]);
    const targetUsers = await many("SELECT name FROM users WHERE store_id=$1", [request.params.storeId]);
    const existingNames = new Set(targetUsers.map((user) => user.name.trim().toLowerCase()));
    let imported = 0;
    await withTransaction(async (client) => {
      for (const user of sourceUsers) {
        const normalizedName = user.name.trim().toLowerCase();
        if (existingNames.has(normalizedName)) continue;
        await client.query("INSERT INTO users (id,store_id,name,role,pin_hash,active,shift_start,shift_end,grace_minutes) VALUES ($1,$2,$3,'employee',$4,$5,$6,$7,$8)", [crypto.randomUUID(), request.params.storeId, user.name, user.pin_hash, user.active, user.shift_start, user.shift_end, user.grace_minutes]);
        existingNames.add(normalizedName);
        imported += 1;
      }
    });
    response.json({ imported, users: (await many("SELECT * FROM users WHERE store_id=$1 ORDER BY name", [request.params.storeId])).map(publicUser) });
  } catch (error) { next(error); }
});

app.post("/api/stores/:storeId/attendance/clock-in", requireAuth, sameStore, async (request, response, next) => { try { const { location, distance } = request.body || {}; const user = await one("SELECT * FROM users WHERE id=$1 AND store_id=$2 AND active=TRUE", [request.auth.userId, request.params.storeId]); if (!user) return response.status(404).json({ error: "ไม่พบผู้ใช้ที่ใช้งานอยู่" }); if (await one("SELECT id FROM attendance_logs WHERE user_id=$1 AND clock_out_at IS NULL", [user.id])) return response.status(409).json({ error: "มีรายการลงเวลาที่เปิดอยู่แล้ว" }); const id = crypto.randomUUID(); const now = new Date().toISOString(); await run("INSERT INTO attendance_logs (id,store_id,user_id,user_name,user_role,clock_in_at,in_lat,in_lng,geofence_distance_in,audit_trail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)", [id, request.params.storeId, user.id, user.name, user.role, now, location?.latitude ?? null, location?.longitude ?? null, Math.round(Number(distance) || 0), JSON.stringify([{ at: now, action: "clock-in", reason: "self-service" }])]); response.status(201).json({ log: publicLog(await one("SELECT * FROM attendance_logs WHERE id=$1", [id])) }); } catch (error) { next(error); } });
app.post("/api/stores/:storeId/attendance/clock-out", requireAuth, sameStore, async (request, response, next) => { try { const { location, distance } = request.body || {}; const log = await one("SELECT * FROM attendance_logs WHERE user_id=$1 AND store_id=$2 AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1", [request.auth.userId, request.params.storeId]); if (!log) return response.status(404).json({ error: "ไม่พบรายการ Clock In" }); const now = new Date().toISOString(); const audit = [...(log.audit_trail || []), { at: now, action: "clock-out", reason: "self-service" }]; await run("UPDATE attendance_logs SET clock_out_at=$1,out_lat=$2,out_lng=$3,geofence_distance_out=$4,audit_trail=$5::jsonb,updated_at=$1 WHERE id=$6", [now, location?.latitude ?? null, location?.longitude ?? null, Math.round(Number(distance) || 0), JSON.stringify(audit), log.id]); response.json({ log: publicLog(await one("SELECT * FROM attendance_logs WHERE id=$1", [log.id])) }); } catch (error) { next(error); } });
app.get("/api/stores/:storeId/attendance", requireAuth, sameStore, async (request, response, next) => { try { response.json({ logs: (await many("SELECT * FROM attendance_logs WHERE store_id=$1 ORDER BY clock_in_at DESC", [request.params.storeId])).map(publicLog) }); } catch (error) { next(error); } });
app.put("/api/stores/:storeId/attendance/:logId", requireAuth, sameStore, requireAdmin, async (request, response, next) => { try { const { clockInAt, clockOutAt, reason } = request.body || {}; const log = await one("SELECT * FROM attendance_logs WHERE id=$1 AND store_id=$2", [request.params.logId, request.params.storeId]); if (!log) return response.status(404).json({ error: "ไม่พบรายการลงเวลา" }); if (!reason || !clockInAt) return response.status(400).json({ error: "ต้องระบุเวลาเข้าและเหตุผล" }); const now = new Date().toISOString(); const audit = [...(log.audit_trail || []), { at: now, action: "manual-adjustment", reason: String(reason).trim() }]; await run("UPDATE attendance_logs SET clock_in_at=$1,clock_out_at=$2,audit_trail=$3::jsonb,updated_at=$4 WHERE id=$5", [clockInAt, clockOutAt || null, JSON.stringify(audit), now, log.id]); response.json({ log: publicLog(await one("SELECT * FROM attendance_logs WHERE id=$1", [log.id])) }); } catch (error) { next(error); } });
app.post("/api/stores/:storeId/attendance/migrate", requireAuth, sameStore, requireAdmin, async (request, response, next) => { try { const logs = Array.isArray(request.body?.logs) ? request.body.logs : []; const users = new Set((await many("SELECT id FROM users WHERE store_id=$1", [request.params.storeId])).map((user) => user.id)); let migrated = 0; for (const log of logs) { if (!log.id || !users.has(log.userId) || !log.clockInAt) continue; const result = await run("INSERT INTO attendance_logs (id,store_id,user_id,user_name,user_role,clock_in_at,clock_out_at,in_lat,in_lng,out_lat,out_lng,geofence_distance_in,geofence_distance_out,source,notes,audit_trail,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18) ON CONFLICT (id) DO NOTHING", [log.id, request.params.storeId, log.userId, log.userName || "", log.userRole || "employee", log.clockInAt, log.clockOutAt || null, log.inLat ?? null, log.inLng ?? null, log.outLat ?? null, log.outLng ?? null, log.geofenceDistanceIn ?? null, log.geofenceDistanceOut ?? null, "migration", log.notes || "", JSON.stringify(log.auditTrail || []), log.createdAt || log.clockInAt, log.updatedAt || log.clockInAt]); migrated += result.rowCount; } response.json({ migrated }); } catch (error) { next(error); } });

app.use((error, request, response, next) => { console.error(error); response.status(500).json({ error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" }); });

(async () => { try { await ensureSchema(); app.listen(port, "0.0.0.0", () => console.log(`Time to Work PostgreSQL API running at port ${port}`)); } catch (error) { console.error("PostgreSQL startup failed", error.code || error.message); process.exit(1); } })();
