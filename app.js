const STORAGE_KEY = "timecation.state.v1";
const SESSION_KEY = "timecation.session.v1";

const defaultState = {
  settings: {
    storeName: "Time to Work",
    lat: 13.7563,
    lng: 100.5018,
    radius: 250,
    selfieRequired: true,
    lateGrace: 10,
    otThreshold: 9,
  },
  users: [
    { id: uid(), name: "Admin", role: "admin", pin: "1234", active: true, shiftStart: "09:00", shiftEnd: "18:00", grace: 10 },
    { id: uid(), name: "Mook", role: "employee", pin: "2468", active: true, shiftStart: "09:00", shiftEnd: "18:00", grace: 10 },
    { id: uid(), name: "Natt", role: "employee", pin: "1357", active: true, shiftStart: "10:00", shiftEnd: "19:00", grace: 15 },
  ],
  logs: [
    seedLog("Mook", "employee", -1, 8.3, 8.8, 9.0),
    seedLog("Natt", "employee", 0, 10.2, 10.4, null),
    seedLog("Admin", "admin", 0, 8.95, 18.2, null),
  ],
};

defaultState.logs = defaultState.logs.map((log) => ({
  ...log,
  userId: defaultState.users.find((user) => user.name === log.userName)?.id || null,
}));

const state = loadState();
let session = loadSession();
if (session?.storeId && state.stores?.some((store) => store.id === session.storeId)) {
  activateStore(session.storeId);
}
let activeTab = "dashboard";
let pendingSelfieResolve = null;
let pendingSelfieReject = null;
let pendingSelfieData = "";
let pendingEmployeePinResolve = null;
let pendingEmployeePinReject = null;
let editingUserId = null;
let selectedReportMonth = monthKey(new Date());
let selectedReportUser = "all";
let selectedAdjustLog = "";
let locationCache = null;
let locationWatchId = null;
let liveClockTimer = null;
let mapPicker = null;
let mapPickerMarker = null;
let mapPickerCircle = null;
let mapPickerSelection = null;

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  seedForms();
  bindEvents();
  refreshLocation();
  syncSessionUI();
  startLiveClock();
  renderAll();
});

function cacheElements() {
  const ids = [
    "topStatus",
    "loginPanel",
    "appShell",
    "loginForm",
    "loginEmail",
    "loginPassword",
    "showRegisterBtn",
    "registrationPanel",
    "hideRegisterBtn",
    "storeForm",
    "newStoreName",
    "newStoreEmail",
    "newStorePassword",
    "logoutBtn",
    "userMenu",
    "userMenuBtn",
    "userMenuPanel",
    "userMenuName",
    "userMenuMeta",
    "tabNav",
    "dashboardChips",
    "dashboardStats",
    "activeList",
    "googleMapFrame",
    "mapGpsStatus",
    "geofenceCard",
    "clockStateCard",
    "clockChips",
    "clockInBtn",
    "clockOutBtn",
    "clockHint",
    "clockDetail",
    "recentClockList",
    "userForm",
    "userFormTitle",
    "userId",
    "userName",
    "userRole",
    "userPin",
    "userShiftStart",
    "userShiftEnd",
    "userGrace",
    "userActive",
    "userCancelBtn",
    "userList",
    "reportMonth",
    "reportUser",
    "exportCsvBtn",
    "exportJsonBtn",
    "reportStats",
    "reportTable",
    "settingsForm",
    "storeName",
    "storeLat",
    "storeLng",
    "storeRadius",
    "openMapBtn",
    "useGpsBtn",
    "lateGrace",
    "otThreshold",
    "adjustForm",
    "adjustLog",
    "adjustIn",
    "adjustOut",
    "adjustReason",
    "adjustmentHistory",
    "selfieModal",
    "selfieInput",
    "selfiePreview",
    "selfieConfirm",
    "selfieCancel",
    "selfieCancelTop",
    "employeePinModal",
    "employeePinForm",
    "employeePinInput",
    "employeePinCancel",
    "employeePinCancelTop",
    "mapPickerModal",
    "mapPickerMap",
    "mapPickerClose",
    "mapPickerUse",
    "mapPickerCoords",
    "toastStack",
  ];

  for (const id of ids) {
    els[id] = document.getElementById(id);
  }
}

function bindEvents() {
  els.loginForm.addEventListener("submit", handleLogin);
  els.showRegisterBtn.addEventListener("click", showRegistration);
  els.hideRegisterBtn.addEventListener("click", hideRegistration);
  els.storeForm.addEventListener("submit", handleStoreRegistration);
  els.logoutBtn.addEventListener("click", handleLogout);
  els.userMenuBtn.addEventListener("click", toggleUserMenu);
  document.addEventListener("click", handleDocumentClick);
  els.tabNav.addEventListener("click", handleTabClick);
  els.clockInBtn.addEventListener("click", () => handleClock("in"));
  els.clockOutBtn.addEventListener("click", () => handleClock("out"));
  els.userForm.addEventListener("submit", handleUserSave);
  els.userCancelBtn.addEventListener("click", resetUserForm);
  els.settingsForm.addEventListener("submit", handleSettingsSave);
  els.openMapBtn.addEventListener("click", openMapPicker);
  els.useGpsBtn.addEventListener("click", useCurrentGpsForStore);
  els.adjustForm.addEventListener("submit", handleAdjustmentSave);
  els.reportMonth.addEventListener("change", () => {
    selectedReportMonth = els.reportMonth.value;
    renderAll();
  });
  els.reportUser.addEventListener("change", () => {
    selectedReportUser = els.reportUser.value;
    renderAll();
  });
  els.exportCsvBtn.addEventListener("click", exportCsv);
  els.exportJsonBtn.addEventListener("click", exportJson);
  els.selfieInput.addEventListener("change", handleSelfieSelected);
  els.selfieConfirm.addEventListener("click", confirmSelfie);
  els.selfieCancel.addEventListener("click", cancelSelfie);
  els.selfieCancelTop.addEventListener("click", cancelSelfie);
  els.employeePinForm.addEventListener("submit", confirmEmployeePin);
  els.employeePinCancel.addEventListener("click", cancelEmployeePin);
  els.employeePinCancelTop.addEventListener("click", cancelEmployeePin);
  els.mapPickerClose.addEventListener("click", closeMapPicker);
  els.mapPickerUse.addEventListener("click", applyPickedMapPoint);
  els.mapPickerModal.addEventListener("click", (event) => {
    if (event.target === els.mapPickerModal) closeMapPicker();
  });
  enableTabDragScroll();
  window.addEventListener("resize", drawMap);
}

function enableTabDragScroll() {
  let isDragging = false;
  let suppressClick = false;
  let startX = 0;
  let startScrollLeft = 0;

  els.tabNav.addEventListener("pointerdown", (event) => {
    isDragging = true;
    suppressClick = false;
    startX = event.clientX;
    startScrollLeft = els.tabNav.scrollLeft;
  });

  els.tabNav.addEventListener("pointermove", (event) => {
    if (!isDragging) return;
    if (Math.abs(event.clientX - startX) < 6) return;
    suppressClick = true;
    els.tabNav.setPointerCapture(event.pointerId);
    els.tabNav.classList.add("is-dragging");
    els.tabNav.scrollLeft = startScrollLeft - (event.clientX - startX);
  });

  const stopDragging = () => {
    isDragging = false;
    els.tabNav.classList.remove("is-dragging");
  };

  els.tabNav.addEventListener("click", (event) => {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick = false;
  }, true);

  els.tabNav.addEventListener("pointerup", stopDragging);
  els.tabNav.addEventListener("pointercancel", stopDragging);
  els.tabNav.addEventListener("pointerleave", stopDragging);
}

function seedForms() {
  els.reportMonth.value = selectedReportMonth;
}

function loadState() {
  const stored = safeParse(localStorage.getItem(STORAGE_KEY));
  if (!stored) {
    const firstStore = createStoreFromLegacy(defaultState, "owner@timetowork.local", "1234");
    const initialState = { ...firstStore, stores: [firstStore], activeStoreId: firstStore.id };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ stores: initialState.stores, activeStoreId: initialState.activeStoreId }));
    return initialState;
  }

  if (Array.isArray(stored.stores) && stored.stores.length) {
    const activeStore = stored.stores.find((store) => store.id === stored.activeStoreId) || stored.stores[0];
    return { ...activeStore, stores: stored.stores, activeStoreId: activeStore.id };
  }

  const migratedStore = createStoreFromLegacy(stored, "owner@timetowork.local", "1234");
  return { ...migratedStore, stores: [migratedStore], activeStoreId: migratedStore.id };
}

function saveState(nextState = state) {
  const storeSnapshot = storeSnapshotFromState(nextState);
  nextState.stores = (nextState.stores || []).map((store) => store.id === storeSnapshot.id ? storeSnapshot : store);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ stores: nextState.stores, activeStoreId: nextState.activeStoreId }));
}

function createStoreFromLegacy(source, email, password) {
  const store = {
    id: source.id || uid(),
    storeName: source.storeName || source.settings?.storeName || "Time to Work",
    storeEmail: source.storeEmail || email,
    storePassword: source.storePassword || password,
    settings: { ...defaultState.settings, ...(source.settings || {}) },
    users: Array.isArray(source.users) && source.users.length ? structuredClone(source.users) : structuredClone(defaultState.users),
    logs: Array.isArray(source.logs) ? structuredClone(source.logs) : [],
  };
  store.settings.storeName = store.storeName;
  return store;
}

function storeSnapshotFromState(source) {
  return {
    id: source.activeStoreId,
    storeName: source.settings.storeName,
    storeEmail: source.storeEmail,
    storePassword: source.storePassword,
    settings: structuredClone(source.settings),
    users: structuredClone(source.users),
    logs: structuredClone(source.logs),
  };
}

function activateStore(storeId) {
  const store = state.stores.find((item) => item.id === storeId);
  if (!store) return false;
  state.activeStoreId = store.id;
  state.storeEmail = store.storeEmail;
  state.storePassword = store.storePassword;
  state.settings = store.settings;
  state.users = store.users;
  state.logs = store.logs;
  return true;
}

function loadSession() {
  const stored = safeParse(sessionStorage.getItem(SESSION_KEY));
  return stored && stored.userId ? stored : null;
}

function saveSession(nextSession) {
  session = nextSession;
  if (nextSession) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
  syncSessionUI();
}

function renderAll() {
  renderLoginUsers();
  renderShellVisibility();
  renderSessionInfo();
  renderTabs();
  renderDashboard();
  renderClock();
  renderUsers();
  renderReports();
  renderSettings();
  renderAdjustmentLists();
  drawMap();
}

function renderLoginUsers() {
  return;
}

function renderShellVisibility() {
  const loggedIn = Boolean(session);
  els.loginPanel.classList.toggle("hidden", loggedIn);
  els.appShell.classList.toggle("hidden", !loggedIn);
  updateTopStatus();
}

function renderSessionInfo() {
  const user = currentSessionUser();
  if (!user) {
    els.userMenuName.textContent = "ผู้ใช้ทั่วไป";
    els.userMenuMeta.textContent = "ล็อกอินเพื่อเริ่มใช้งาน";
    return;
  }

  els.userMenuName.textContent = user.name;
  els.userMenuMeta.textContent = `${user.role.toUpperCase()} · PIN ${maskPin(user.pin)}`;
}

function toggleUserMenu() {
  const isOpen = !els.userMenuPanel.classList.contains("hidden");
  els.userMenuPanel.classList.toggle("hidden", isOpen);
  els.userMenuBtn.setAttribute("aria-expanded", String(!isOpen));
}

function handleDocumentClick(event) {
  if (els.userMenu.contains(event.target)) return;
  els.userMenuPanel.classList.add("hidden");
  els.userMenuBtn.setAttribute("aria-expanded", "false");
}

function startLiveClock() {
  updateTopStatus();
  if (liveClockTimer) clearInterval(liveClockTimer);
  liveClockTimer = setInterval(updateTopStatus, 1000);
}

function updateTopStatus() {
  const nowLabel = new Intl.DateTimeFormat("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date());
  const user = currentSessionUser();
  els.topStatus.textContent = user ? `${user.name} online · ${nowLabel}` : `Offline demo · ${nowLabel}`;
}

function syncSessionUI() {
  const user = currentSessionUser();
  const canManage = user?.role === "admin";
  document.querySelectorAll(".admin-only").forEach((node) => {
    node.classList.toggle("hidden", !canManage);
  });
  if (activeTab === "users" || activeTab === "settings") {
    activeTab = "dashboard";
  }
  renderShellVisibility();
}

function renderTabs() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === activeTab);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === activeTab);
  });
}

function handleTabClick(event) {
  const button = event.target.closest(".tab");
  if (!button) return;
  const user = currentSessionUser();
  if (button.classList.contains("admin-only") && user?.role !== "admin") {
    toast("ต้องเป็นผู้ดูแลระบบ", "warning");
    return;
  }
  activeTab = button.dataset.tab;
  renderTabs();
}

async function handleLogin(event) {
  event.preventDefault();
  const email = els.loginEmail.value.trim().toLowerCase();
  const password = els.loginPassword.value;
  const store = state.stores.find((item) => item.storeEmail.toLowerCase() === email);
  if (!store || store.storePassword !== password) {
    toast("Email ร้านหรือรหัสผ่านร้านไม่ถูกต้อง", "error");
    return;
  }

  saveState();
  activateStore(store.id);
  const user = state.users.find((item) => item.active && item.role === "admin") || state.users.find((item) => item.active);
  if (!user) {
    toast("ร้านนี้ยังไม่มีผู้ใช้ที่เปิดใช้งาน", "error");
    return;
  }

  const employee = await requestEmployeePin();
  if (!employee) return;

  saveSession({ storeId: state.activeStoreId, userId: employee.id, loggedInAt: Date.now() });
  els.loginPassword.value = "";
  renderAll();
  toast(`ยินดีต้อนรับ ${employee.name}`, "success");
}

function showRegistration() {
  els.loginForm.classList.add("hidden");
  els.registrationPanel.classList.remove("hidden");
  els.loginPanel.classList.add("registration-mode");
  els.newStoreName.focus();
}

function hideRegistration() {
  els.loginForm.classList.remove("hidden");
  els.registrationPanel.classList.add("hidden");
  els.loginPanel.classList.remove("registration-mode");
  els.storeForm.reset();
}

function handleStoreRegistration(event) {
  event.preventDefault();
  const storeName = els.newStoreName.value.trim();
  const storeEmail = els.newStoreEmail.value.trim().toLowerCase();
  const storePassword = els.newStorePassword.value;
  if (state.stores.some((store) => store.storeEmail.toLowerCase() === storeEmail)) {
    toast("อีเมลนี้มีร้านค้าใช้งานแล้ว", "warning");
    return;
  }

  const newStore = createStoreFromLegacy({ settings: { ...defaultState.settings, storeName } }, storeEmail, storePassword);
  newStore.users = [{ id: uid(), name: "Admin", role: "admin", pin: "1234", active: true, shiftStart: "09:00", shiftEnd: "18:00", grace: 10 }];
  state.stores.push(newStore);
  saveState();
  activateStore(newStore.id);
  els.loginEmail.value = newStore.storeEmail;
  els.loginPassword.value = newStore.storePassword;
  hideRegistration();
  els.storeForm.reset();
  renderAll();
  toast(`สมัครร้าน ${storeName} สำเร็จ ใช้ Admin / 1234 เข้าจัดการร้าน`, "success");
}

function handleLogout() {
  els.userMenuPanel.classList.add("hidden");
  els.userMenuBtn.setAttribute("aria-expanded", "false");
  saveSession(null);
  activeTab = "dashboard";
  renderAll();
  toast("ออกจากระบบแล้ว", "success");
}

function currentSessionUser() {
  if (!session) return null;
  return state.users.find((user) => user.id === session.userId) || null;
}

async function handleClock(kind) {
  const user = currentSessionUser();
  if (!user) return;

  if (kind === "in" && getOpenLog(user.id)) {
    toast("มีรายการ clock-in ที่ยังไม่ clock-out อยู่แล้ว", "warning");
    return;
  }

  if (kind === "out" && !getOpenLog(user.id)) {
    toast("ยังไม่มีรายการ clock-in สำหรับ clock-out", "warning");
    return;
  }

  const snapshot = await capturePrerequisites();
  if (!snapshot) return;

  const geofenceCheck = verifyGeofence(snapshot.location);
  if (!geofenceCheck.allowed) {
    toast(`อยู่นอกเขตร้าน ${Math.round(geofenceCheck.distance)} เมตร`, "error");
    return;
  }

  const now = new Date();
  const openLog = getOpenLog(user.id);
  if (kind === "in") {
    state.logs.unshift({
      id: uid(),
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      clockInAt: now.toISOString(),
      clockOutAt: null,
      inLat: snapshot.location.latitude,
      inLng: snapshot.location.longitude,
      outLat: null,
      outLng: null,
      selfieIn: snapshot.selfie,
      selfieOut: null,
      geofenceDistanceIn: Math.round(snapshot.distance),
      geofenceDistanceOut: null,
      source: "web",
      notes: "",
      auditTrail: [
        { at: now.toISOString(), action: "clock-in", reason: "self-service" },
      ],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    toast("Clock in สำเร็จ", "success");
  } else if (openLog) {
    openLog.clockOutAt = now.toISOString();
    openLog.outLat = snapshot.location.latitude;
    openLog.outLng = snapshot.location.longitude;
    openLog.selfieOut = snapshot.selfie;
    openLog.geofenceDistanceOut = Math.round(snapshot.distance);
    openLog.updatedAt = now.toISOString();
    openLog.auditTrail.push({ at: now.toISOString(), action: "clock-out", reason: "self-service" });
    toast("Clock out สำเร็จ", "success");
  }

  saveState();
  renderAll();
}

function requestEmployeePin() {
  els.employeePinInput.value = "";
  els.employeePinModal.classList.remove("hidden");
  els.employeePinModal.setAttribute("aria-hidden", "false");
  els.employeePinInput.focus();
  return new Promise((resolve, reject) => {
    pendingEmployeePinResolve = resolve;
    pendingEmployeePinReject = reject;
  });
}

function confirmEmployeePin(event) {
  event.preventDefault();
  const pin = els.employeePinInput.value.trim();
  const user = state.users.find((item) => item.active && item.pin === pin);
  if (!user) {
    toast("PIN พนักงานไม่ถูกต้อง", "error");
    return;
  }
  closeEmployeePinModal();
  pendingEmployeePinResolve?.(user);
  pendingEmployeePinResolve = null;
  pendingEmployeePinReject = null;
}

function cancelEmployeePin() {
  closeEmployeePinModal();
  pendingEmployeePinResolve?.(null);
  pendingEmployeePinResolve = null;
  pendingEmployeePinReject = null;
}

function closeEmployeePinModal() {
  els.employeePinModal.classList.add("hidden");
  els.employeePinModal.setAttribute("aria-hidden", "true");
}

async function capturePrerequisites() {
  const location = await getCurrentLocation();
  if (!location) {
    toast("ไม่สามารถดึงตำแหน่ง GPS ได้", "error");
    return null;
  }

  return { selfie: null, location, distance: distanceMeters(location.latitude, location.longitude, state.settings.lat, state.settings.lng) };
}

function requestSelfie() {
  pendingSelfieData = "";
  els.selfieInput.value = "";
  els.selfiePreview.src = "";
  els.selfiePreview.classList.add("hidden");
  els.selfieModal.classList.remove("hidden");
  els.selfieModal.setAttribute("aria-hidden", "false");
  return new Promise((resolve, reject) => {
    pendingSelfieResolve = resolve;
    pendingSelfieReject = reject;
  });
}

function handleSelfieSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingSelfieData = String(reader.result || "");
    els.selfiePreview.src = pendingSelfieData;
    els.selfiePreview.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
}

function confirmSelfie() {
  if (!pendingSelfieData) {
    toast("กรุณาเลือกรูปก่อนยืนยัน", "warning");
    return;
  }
  closeSelfieModal();
  pendingSelfieResolve?.(pendingSelfieData);
  pendingSelfieResolve = null;
  pendingSelfieReject = null;
  pendingSelfieData = "";
}

function cancelSelfie() {
  closeSelfieModal();
  pendingSelfieReject?.(new Error("cancelled"));
  pendingSelfieResolve = null;
  pendingSelfieReject = null;
  pendingSelfieData = "";
}

function closeSelfieModal() {
  els.selfieModal.classList.add("hidden");
  els.selfieModal.setAttribute("aria-hidden", "true");
}

async function getCurrentLocation({ fresh = false } = {}) {
  if (!fresh && locationCache) return locationCache;
  if (!navigator.geolocation) return null;

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        locationCache = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        resolve(locationCache);
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: fresh ? 20000 : 10000, maximumAge: fresh ? 0 : 15000 },
    );
  });
}

function refreshLocation() {
  if (!navigator.geolocation) return;
  if (locationWatchId !== null) navigator.geolocation.clearWatch(locationWatchId);
  locationWatchId = navigator.geolocation.watchPosition(
    (position) => {
      locationCache = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      renderClock();
      renderDashboard();
      drawMap();
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 12000 },
  );
}

function renderDashboard() {
  const todayLogs = getFilteredLogs({ dayOnly: true });
  const activeLogs = todayLogs.filter((log) => !log.clockOutAt);
  const lateCount = todayLogs.filter((log) => lateMinutes(log) > 0).length;
  const totalHours = todayLogs.reduce((sum, log) => sum + workedHours(log), 0);
  const otHours = todayLogs.reduce((sum, log) => sum + overtimeHours(log), 0);

  els.dashboardChips.innerHTML = [
    chip(`เดือน ${selectedReportMonth}`),
    chip(`${state.settings.storeName}`),
    chip(`${state.settings.radius}m geofence`),
  ].join("");

  els.dashboardStats.innerHTML = [
    statCard("Active now", activeLogs.length),
    statCard("Today entries", todayLogs.length),
    statCard("Late", lateCount),
    statCard("Hours", totalHours.toFixed(1)),
  ].join("");

  els.activeList.innerHTML = activeLogs.length
    ? activeLogs.map((log) => listItem(`${log.userName}`, `${formatDateTime(log.clockInAt)} · ${geoLabel(log)}`)).join("")
    : emptyState("ไม่มีพนักงานที่กำลังลงเวลาอยู่");
}

function renderClock() {
  const user = currentSessionUser();
  if (!user) return;
  const openLog = getOpenLog(user.id);
  const locationText = locationCache
    ? `${locationCache.latitude.toFixed(5)}, ${locationCache.longitude.toFixed(5)} · ±${Math.round(locationCache.accuracy)}m`
    : "ยังไม่ได้รับตำแหน่ง";
  const geofenceCheck = locationCache ? verifyGeofence(locationCache) : null;
  const outsideStore = Boolean(geofenceCheck && !geofenceCheck.allowed);

  els.clockStateCard.innerHTML = `
    <strong>${openLog ? "Clocked in" : "Ready"}</strong>
    <p class="muted small">${openLog ? "คุณมีรายการเปิดอยู่" : outsideStore ? "อยู่นอกพื้นที่ร้าน ลงเวลาไม่ได้" : "สามารถลงเวลาได้"}</p>
  `;
  els.geofenceCard.innerHTML = `
    <strong>${state.settings.storeName}</strong>
    <p class="muted small">${state.settings.lat.toFixed(5)}, ${state.settings.lng.toFixed(5)}</p>
    <p class="small">${state.settings.radius}m radius · GPS verification</p>
  `;
  els.clockChips.innerHTML = [
    chip(user.role.toUpperCase()),
    chip(locationText),
    chip(geofenceCheck ? (geofenceCheck.allowed ? `inside ${Math.round(geofenceCheck.distance)}m` : `outside ${Math.round(geofenceCheck.distance)}m`) : "waiting GPS"),
  ].join("");
  els.clockHint.textContent = outsideStore
    ? "ตอนนี้อยู่นอกพื้นที่ร้าน จึงลงเวลาไม่ได้"
    : "อยู่ในพื้นที่ร้าน สามารถกดลงเวลาได้ทันที";

  els.clockInBtn.disabled = false;
  els.clockOutBtn.disabled = false;

  els.clockDetail.innerHTML = `
    ${detailItem("Shift start", user.shiftStart)}
    ${detailItem("Shift end", user.shiftEnd)}
    ${detailItem("Grace", `${user.grace ?? state.settings.lateGrace} นาที`)}
    ${detailItem("Open log", openLog ? formatDateTime(openLog.clockInAt) : "ไม่มี")}
  `;

  const recentLogs = state.logs.filter((log) => log.userId === user.id).slice(0, 5);
  els.recentClockList.innerHTML = recentLogs.length
    ? recentLogs.map((log) => listItem(`${log.clockOutAt ? "Completed" : "Open"} · ${formatDateTime(log.clockInAt)}`, `${log.userName} · ${durationLabel(log)}`)).join("")
    : emptyState("ยังไม่มีประวัติการลงเวลา");
}

function renderUsers() {
  if (!currentSessionUser() || currentSessionUser().role !== "admin") return;

  els.userList.innerHTML = `
    <table>
      <thead>
        <tr><th>Name</th><th>Role</th><th>PIN</th><th>Shift</th><th>Status</th><th>Action</th></tr>
      </thead>
      <tbody>
        ${state.users
          .map(
            (user) => `
              <tr>
                <td>${escapeHtml(user.name)}</td>
                <td>${escapeHtml(user.role)}</td>
                <td>${maskPin(user.pin)}</td>
                <td>${escapeHtml(user.shiftStart)} - ${escapeHtml(user.shiftEnd)}</td>
                <td>${user.active ? "Active" : "Disabled"}</td>
                <td>
                  <button class="ghost" data-user-edit="${user.id}">Edit</button>
                  <button class="secondary" data-user-delete="${user.id}">Delete</button>
                </td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;

  els.userList.querySelectorAll("[data-user-edit]").forEach((button) => button.addEventListener("click", () => startEditUser(button.dataset.userEdit)));
  els.userList.querySelectorAll("[data-user-delete]").forEach((button) => button.addEventListener("click", () => deleteUser(button.dataset.userDelete)));
}

function renderReports() {
  const filtered = getFilteredLogs({ month: selectedReportMonth, userId: selectedReportUser });
  const totals = summaryForLogs(filtered);
  els.reportStats.innerHTML = [
    statCard("Records", filtered.length),
    statCard("Hours", totals.hours.toFixed(1)),
    statCard("Late mins", totals.lateMinutes),
    statCard("OT hrs", totals.otHours.toFixed(1)),
  ].join("");

  els.reportTable.innerHTML = filtered.length
    ? `
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Employee</th><th>In</th><th>Out</th><th>Hours</th><th>Late</th><th>OT</th><th>Geo</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(renderReportRow).join("")}
        </tbody>
      </table>
    `
    : emptyState("ไม่มีข้อมูลตามตัวกรองที่เลือก");
}

function renderSettings() {
  const user = currentSessionUser();
  if (!user || user.role !== "admin") return;

  els.storeName.value = state.settings.storeName;
  els.storeLat.value = state.settings.lat;
  els.storeLng.value = state.settings.lng;
  els.storeRadius.value = state.settings.radius;
  els.lateGrace.value = state.settings.lateGrace;
  els.otThreshold.value = state.settings.otThreshold;
}

function openMapPicker() {
  els.mapPickerModal.classList.remove("hidden");
  els.mapPickerModal.setAttribute("aria-hidden", "false");
  const initialPoint = mapPickerSelection || {
    lat: Number(els.storeLat.value) || state.settings.lat,
    lng: Number(els.storeLng.value) || state.settings.lng,
  };
  initMapPicker(initialPoint);
}

function closeMapPicker() {
  els.mapPickerModal.classList.add("hidden");
  els.mapPickerModal.setAttribute("aria-hidden", "true");
}

function initMapPicker(point) {
  if (!window.L || !els.mapPickerMap) {
    toast("โหลดแผนที่ไม่สำเร็จ", "error");
    return;
  }

  const center = [point.lat, point.lng];
  if (!mapPicker) {
    mapPicker = L.map(els.mapPickerMap, { zoomControl: true }).setView(center, 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 20,
    }).addTo(mapPicker);
    mapPicker.on("click", (event) => setMapPickerPoint(event.latlng.lat, event.latlng.lng));
    window.__timecationMapPicker = mapPicker;
  } else {
    mapPicker.setView(center, 16);
  }

  setMapPickerPoint(point.lat, point.lng, false);
  setTimeout(() => mapPicker.invalidateSize(), 0);
}

function setMapPickerPoint(lat, lng, moveMap = true) {
  mapPickerSelection = { lat, lng };
  window.__timecationMapPickerSelection = mapPickerSelection;
  els.mapPickerCoords.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  if (!mapPicker) return;

  if (moveMap) mapPicker.setView([lat, lng], mapPicker.getZoom() || 16);
  if (mapPickerMarker) {
    mapPickerMarker.setLatLng([lat, lng]);
  } else {
    mapPickerMarker = L.marker([lat, lng], { draggable: true }).addTo(mapPicker);
    mapPickerMarker.on("dragend", () => {
      const position = mapPickerMarker.getLatLng();
      setMapPickerPoint(position.lat, position.lng, false);
    });
  }

  if (mapPickerCircle) {
    mapPickerCircle.setLatLng([lat, lng]);
    mapPickerCircle.setRadius(Number(els.storeRadius.value) || state.settings.radius);
  } else {
    mapPickerCircle = L.circle([lat, lng], {
      radius: Number(els.storeRadius.value) || state.settings.radius,
      color: "#1f5f4c",
      fillColor: "#1f5f4c",
      fillOpacity: 0.12,
      weight: 2,
    }).addTo(mapPicker);
  }
}

function applyPickedMapPoint() {
  if (!mapPickerSelection) {
    toast("เลือกพิกัดบนแผนที่ก่อน", "warning");
    return;
  }

  els.storeLat.value = mapPickerSelection.lat.toFixed(6);
  els.storeLng.value = mapPickerSelection.lng.toFixed(6);
  closeMapPicker();
  toast("ใส่พิกัดร้านจากแผนที่แล้ว", "success");
}

async function useCurrentGpsForStore() {
  els.useGpsBtn.disabled = true;
  els.useGpsBtn.textContent = "กำลังค้นหาตำแหน่ง...";
  const location = await getCurrentLocation({ fresh: true });
  els.useGpsBtn.disabled = false;
  els.useGpsBtn.textContent = "ใช้พิกัด GPS ปัจจุบัน";
  if (!location) {
    toast("ยังไม่ได้รับตำแหน่ง GPS", "warning");
    return;
  }

  els.storeLat.value = location.latitude.toFixed(6);
  els.storeLng.value = location.longitude.toFixed(6);
  mapPickerSelection = { lat: location.latitude, lng: location.longitude };
  toast(`ใช้พิกัด GPS แล้ว · คลาดเคลื่อน ±${Math.round(location.accuracy)}m`, "success");
}

function renderAdjustmentLists() {
  const user = currentSessionUser();
  if (!user || user.role !== "admin") return;

  els.adjustLog.innerHTML = [
    `<option value="">เลือกรายการ</option>`,
    ...state.logs.map((log) => `<option value="${log.id}">${escapeHtml(log.userName)} · ${formatDateTime(log.clockInAt)}</option>`),
  ].join("");

  if (!selectedAdjustLog && state.logs[0]) selectedAdjustLog = state.logs[0].id;
  if (selectedAdjustLog) els.adjustLog.value = selectedAdjustLog;

  const log = state.logs.find((item) => item.id === els.adjustLog.value || item.id === selectedAdjustLog);
  if (log) {
    els.adjustIn.value = toLocalInputValue(log.clockInAt);
    els.adjustOut.value = log.clockOutAt ? toLocalInputValue(log.clockOutAt) : "";
  }

  els.adjustLog.onchange = () => {
    selectedAdjustLog = els.adjustLog.value;
    renderAdjustmentLists();
  };

  els.adjustmentHistory.innerHTML = state.logs.slice(0, 8).map((log) => {
    const lastAudit = log.auditTrail?.at(-1);
    return listItem(
      `${log.userName} · ${formatDateTime(log.clockInAt)}`,
      `${durationLabel(log)} · ${lastAudit ? lastAudit.action : "created"}${lastAudit?.reason ? ` · ${lastAudit.reason}` : ""}`,
    );
  }).join("");
}

function startEditUser(id) {
  const user = state.users.find((item) => item.id === id);
  if (!user) return;
  editingUserId = user.id;
  els.userFormTitle.textContent = `แก้ไข ${user.name}`;
  els.userId.value = user.id;
  els.userName.value = user.name;
  els.userRole.value = user.role;
  els.userPin.value = user.pin;
  els.userShiftStart.value = user.shiftStart;
  els.userShiftEnd.value = user.shiftEnd;
  els.userGrace.value = user.grace ?? state.settings.lateGrace;
  els.userActive.checked = user.active;
}

function deleteUser(id) {
  const user = state.users.find((item) => item.id === id);
  if (!user) return;
  if (user.id === currentSessionUser()?.id) {
    toast("ไม่สามารถลบผู้ใช้ที่กำลังล็อกอินอยู่", "warning");
    return;
  }
  if (!confirm(`ลบ ${user.name} หรือไม่`)) return;
  state.users = state.users.filter((item) => item.id !== id);
  saveState();
  renderAll();
  toast("ลบผู้ใช้แล้ว", "success");
}

function resetUserForm() {
  editingUserId = null;
  els.userForm.reset();
  els.userActive.checked = true;
  els.userShiftStart.value = "09:00";
  els.userShiftEnd.value = "18:00";
  els.userGrace.value = state.settings.lateGrace;
  els.userFormTitle.textContent = "เพิ่มพนักงาน";
}

function handleUserSave(event) {
  event.preventDefault();
  const payload = {
    id: els.userId.value || uid(),
    name: els.userName.value.trim(),
    role: els.userRole.value,
    pin: els.userPin.value.trim(),
    shiftStart: els.userShiftStart.value,
    shiftEnd: els.userShiftEnd.value,
    grace: Number(els.userGrace.value || state.settings.lateGrace),
    active: els.userActive.checked,
  };

  if (!payload.name || !payload.pin) {
    toast("กรอกชื่อและ PIN ให้ครบ", "warning");
    return;
  }

  const existingIndex = state.users.findIndex((user) => user.id === payload.id);
  if (existingIndex >= 0) {
    state.users[existingIndex] = payload;
    toast("อัปเดตผู้ใช้แล้ว", "success");
  } else {
    state.users.unshift(payload);
    toast("เพิ่มผู้ใช้ใหม่แล้ว", "success");
  }

  saveState();
  resetUserForm();
  renderAll();
}

function handleSettingsSave(event) {
  event.preventDefault();
  state.settings = {
    ...state.settings,
    storeName: els.storeName.value.trim(),
    lat: Number(els.storeLat.value),
    lng: Number(els.storeLng.value),
    radius: Number(els.storeRadius.value),
    lateGrace: Number(els.lateGrace.value),
    otThreshold: Number(els.otThreshold.value),
  };
  saveState();
  renderAll();
  toast("บันทึกการตั้งค่าแล้ว", "success");
}

function handleAdjustmentSave(event) {
  event.preventDefault();
  const log = state.logs.find((item) => item.id === els.adjustLog.value);
  if (!log) {
    toast("เลือกรายการที่ต้องการแก้ไข", "warning");
    return;
  }

  if (!els.adjustReason.value.trim()) {
    toast("ระบุเหตุผลก่อนบันทึก", "warning");
    return;
  }

  if (els.adjustIn.value) log.clockInAt = new Date(els.adjustIn.value).toISOString();
  if (els.adjustOut.value) log.clockOutAt = new Date(els.adjustOut.value).toISOString();
  log.updatedAt = new Date().toISOString();
  log.auditTrail = log.auditTrail || [];
  log.auditTrail.push({
    at: new Date().toISOString(),
    action: "manual-adjustment",
    reason: els.adjustReason.value.trim(),
  });
  saveState();
  renderAll();
  toast("บันทึกการแก้ไขแล้ว", "success");
}

function getOpenLog(userId) {
  return state.logs.find((log) => log.userId === userId && !log.clockOutAt) || null;
}

function getFilteredLogs({ month = selectedReportMonth, userId = selectedReportUser, dayOnly = false } = {}) {
  let logs = state.logs.slice();
  if (userId && userId !== "all") logs = logs.filter((log) => log.userId === userId);
  if (month) logs = logs.filter((log) => formatDateKey(log.clockInAt).startsWith(month));
  if (dayOnly) logs = logs.filter((log) => formatDateKey(log.clockInAt) === formatDateKey(new Date()));
  return logs.sort((a, b) => new Date(b.clockInAt) - new Date(a.clockInAt));
}

function verifyGeofence(location) {
  const distance = distanceMeters(location.latitude, location.longitude, state.settings.lat, state.settings.lng);
  return {
    allowed: distance <= state.settings.radius,
    distance,
  };
}

function renderReportRow(log) {
  const late = lateMinutes(log);
  const ot = overtimeHours(log);
  return `
    <tr>
      <td>${formatDateKey(log.clockInAt)}</td>
      <td>${escapeHtml(log.userName)}</td>
      <td>${formatTime(log.clockInAt)}</td>
      <td>${log.clockOutAt ? formatTime(log.clockOutAt) : "Open"}</td>
      <td>${workedHours(log).toFixed(1)}</td>
      <td>${late > 0 ? `${late}m` : "-"}</td>
      <td>${ot > 0 ? `${ot.toFixed(1)}h` : "-"}</td>
      <td>${geoLabel(log)}</td>
    </tr>
  `;
}

function drawMap() {
  const mapFrame = els.googleMapFrame;
  if (mapFrame) {
    const latitude = Number(state.settings.lat).toFixed(6);
    const longitude = Number(state.settings.lng).toFixed(6);
    const mapUrl = `https://maps.google.com/maps?hl=th&q=${latitude},${longitude}&z=16&t=m&output=embed`;
    if (mapFrame.src !== mapUrl) mapFrame.src = mapUrl;

    if (els.mapGpsStatus) {
      if (locationCache) {
        const geofenceCheck = verifyGeofence(locationCache);
        els.mapGpsStatus.textContent = `GPS live · ${locationCache.latitude.toFixed(5)}, ${locationCache.longitude.toFixed(5)} · ${Math.round(geofenceCheck.distance)}m from store`;
      } else {
        els.mapGpsStatus.textContent = "GPS status: waiting for location";
      }
    }
    return;
  }

  const canvas = els.mapCanvas;
  if (!canvas) return;
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = Math.max(320, canvas.clientWidth * 0.56);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  const centerX = width / 2;
  const centerY = height / 2;
  const radiusPx = Math.min(width, height) * 0.34;

  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.98)");
  gradient.addColorStop(1, "rgba(255, 240, 242, 0.96)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  if (els.mapGpsStatus) {
    if (locationCache) {
      const geofenceCheck = verifyGeofence(locationCache);
      els.mapGpsStatus.textContent = `GPS live · ${locationCache.latitude.toFixed(5)}, ${locationCache.longitude.toFixed(5)} · ${Math.round(locationCache.accuracy)}m accuracy · ${Math.round(geofenceCheck.distance)}m from store`;
    } else {
      els.mapGpsStatus.textContent = "GPS status: waiting for location";
    }
  }

  context.save();
  context.strokeStyle = "rgba(17, 40, 68, 0.1)";
  context.lineWidth = 1;
  for (let x = 20; x < width; x += 40) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 20; y < height; y += 40) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.restore();

  context.beginPath();
  context.arc(centerX, centerY, radiusPx, 0, Math.PI * 2);
  context.fillStyle = "rgba(31, 95, 76, 0.08)";
  context.fill();
  context.strokeStyle = "rgba(31, 95, 76, 0.26)";
  context.lineWidth = 2;
  context.stroke();

  context.beginPath();
  context.arc(centerX, centerY, 9, 0, Math.PI * 2);
  context.fillStyle = "#1f5f4c";
  context.fill();

  context.fillStyle = "#10263f";
  context.font = "700 14px Noto Sans Thai, sans-serif";
  context.fillText(state.settings.storeName, centerX + 14, centerY - 12);
  context.fillText("Store center", centerX + 14, centerY + 8);

  if (locationCache) {
    const userPoint = projectPoint(locationCache.latitude, locationCache.longitude, width, height, radiusPx);
    const geofenceCheck = verifyGeofence(locationCache);
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.lineTo(userPoint.x, userPoint.y);
    context.strokeStyle = "rgba(31, 95, 76, 0.28)";
    context.lineWidth = 2;
    context.setLineDash([6, 6]);
    context.stroke();
    context.setLineDash([]);

    context.beginPath();
    context.arc(userPoint.x, userPoint.y, 18, 0, Math.PI * 2);
    context.fillStyle = geofenceCheck.allowed ? "rgba(31, 95, 76, 0.14)" : "rgba(154, 74, 63, 0.14)";
    context.fill();

    context.beginPath();
    context.arc(userPoint.x, userPoint.y, 7, 0, Math.PI * 2);
    context.fillStyle = geofenceCheck.allowed ? "#1f5f4c" : "#9a4a3f";
    context.fill();

    context.fillStyle = "#10263f";
    context.font = "700 12px Noto Sans Thai, sans-serif";
    context.fillText("You are here", userPoint.x + 10, userPoint.y - 10);
    context.fillText(`${Math.round(geofenceCheck.distance)}m from store`, userPoint.x + 10, userPoint.y + 8);
  } else {
    context.fillStyle = "rgba(16, 38, 63, 0.72)";
    context.font = "600 12px Noto Sans Thai, sans-serif";
    context.fillText("Waiting for GPS signal...", centerX - 70, centerY + radiusPx + 28);
  }

  const logs = getFilteredLogs({ month: selectedReportMonth, userId: selectedReportUser === "all" ? "all" : selectedReportUser }).slice(0, 18);
  logs.forEach((log, index) => {
    const points = [
      log.inLat ? { lat: log.inLat, lng: log.inLng, color: "#2f6d58", label: "IN" } : null,
      log.outLat ? { lat: log.outLat, lng: log.outLng, color: "#163b63", label: "OUT" } : null,
    ].filter(Boolean);
    points.forEach((point, pointIndex) => {
      const offset = projectPoint(point.lat, point.lng, width, height, radiusPx);
      context.beginPath();
      context.arc(offset.x, offset.y, 6, 0, Math.PI * 2);
      context.fillStyle = point.color;
      context.fill();
      context.fillStyle = "#10263f";
      context.font = "600 11px Noto Sans Thai, sans-serif";
      context.fillText(`${log.userName} ${point.label}`, offset.x + 8, offset.y - 8 - pointIndex * 12);
    });
  });
}

function projectPoint(lat, lng, width, height, radiusPx) {
  const latScale = 110_540;
  const lngScale = 111_320 * Math.cos((state.settings.lat * Math.PI) / 180);
  const dxMeters = (lng - state.settings.lng) * lngScale;
  const dyMeters = (state.settings.lat - lat) * latScale;
  return {
    x: width / 2 + (dxMeters / state.settings.radius) * radiusPx,
    y: height / 2 + (dyMeters / state.settings.radius) * radiusPx,
  };
}

function exportCsv() {
  const rows = getFilteredLogs({ month: selectedReportMonth, userId: selectedReportUser });
  const csv = [
    ["Date", "Employee", "Role", "Clock In", "Clock Out", "Hours", "Late Minutes", "OT Hours", "Geo"],
    ...rows.map((log) => [
      formatDateKey(log.clockInAt),
      log.userName,
      log.userRole,
      formatTime(log.clockInAt),
      log.clockOutAt ? formatTime(log.clockOutAt) : "Open",
      workedHours(log).toFixed(2),
      lateMinutes(log),
      overtimeHours(log).toFixed(2),
      geoLabel(log),
    ]),
  ]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  downloadFile(`time-report-${selectedReportMonth}.csv`, csv, "text/csv;charset=utf-8");
}

function exportJson() {
  const rows = getFilteredLogs({ month: selectedReportMonth, userId: selectedReportUser });
  downloadFile(`time-report-${selectedReportMonth}.json`, JSON.stringify(rows, null, 2), "application/json;charset=utf-8");
}

function downloadFile(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast(`ดาวน์โหลด ${name}`, "success");
}

function summaryForLogs(logs) {
  return logs.reduce(
    (accumulator, log) => {
      accumulator.hours += workedHours(log);
      accumulator.lateMinutes += lateMinutes(log);
      accumulator.otHours += overtimeHours(log);
      return accumulator;
    },
    { hours: 0, lateMinutes: 0, otHours: 0 },
  );
}

function workedHours(log) {
  if (!log.clockOutAt) return 0;
  return Math.max(0, (new Date(log.clockOutAt) - new Date(log.clockInAt)) / 36e5);
}

function overtimeHours(log) {
  if (!log.clockOutAt) return 0;
  const threshold = state.settings.otThreshold ?? 9;
  return Math.max(0, workedHours(log) - threshold);
}

function lateMinutes(log) {
  const user = state.users.find((item) => item.id === log.userId);
  const grace = user?.grace ?? state.settings.lateGrace;
  const shiftStart = shiftDateTime(log.clockInAt, user?.shiftStart || "09:00");
  const diff = (new Date(log.clockInAt) - shiftStart) / 60000 - grace;
  return Math.max(0, Math.round(diff));
}

function geoLabel(log) {
  const values = [log.geofenceDistanceIn, log.geofenceDistanceOut].filter((value) => typeof value === "number");
  if (!values.length) return "-";
  return `${Math.min(...values)}m`;
}

function detailItem(label, value) {
  return `<div class="detail-item"><div class="muted small">${label}</div><strong>${escapeHtml(String(value))}</strong></div>`;
}

function statCard(label, value) {
  return `<div class="stat-card"><div class="muted small">${label}</div><span class="stat-value">${escapeHtml(String(value))}</span></div>`;
}

function chip(value) {
  return `<span class="chip">${escapeHtml(String(value))}</span>`;
}

function listItem(title, subtitle) {
  return `<div class="list-item"><strong>${escapeHtml(title)}</strong><div class="muted small">${escapeHtml(subtitle)}</div></div>`;
}

function emptyState(message) {
  return `<div class="list-item muted">${escapeHtml(message)}</div>`;
}

function formatDateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTime(value) {
  return new Intl.DateTimeFormat("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function monthKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
  }).format(date);
}

function shiftDateTime(clockInIso, shiftTime) {
  const date = new Date(clockInIso);
  const [hour, minute] = shiftTime.split(":").map(Number);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function durationLabel(log) {
  return log.clockOutAt ? `${workedHours(log).toFixed(1)}h` : "open";
}

function toLocalInputValue(iso) {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function maskPin(pin) {
  return String(pin).replace(/.(?=.{2})/g, "•");
}

function uid() {
  return `id_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function seedLog(userName, userRole, dayOffset, inHour, outHour, userId = null) {
  const base = new Date();
  base.setDate(base.getDate() + dayOffset);
  const inAt = new Date(base);
  inAt.setHours(Math.floor(inHour), Math.round((inHour % 1) * 60), 0, 0);
  const outAt = outHour == null ? null : new Date(base);
  if (outAt) outAt.setHours(Math.floor(outHour), Math.round((outHour % 1) * 60), 0, 0);
  return {
    id: uid(),
    userId,
    userName,
    userRole,
    clockInAt: inAt.toISOString(),
    clockOutAt: outAt ? outAt.toISOString() : null,
    inLat: 13.7563 + (Math.random() - 0.5) * 0.002,
    inLng: 100.5018 + (Math.random() - 0.5) * 0.002,
    outLat: outAt ? 13.7563 + (Math.random() - 0.5) * 0.002 : null,
    outLng: outAt ? 100.5018 + (Math.random() - 0.5) * 0.002 : null,
    selfieIn: "",
    selfieOut: "",
    geofenceDistanceIn: 20,
    geofenceDistanceOut: outAt ? 20 : null,
    source: "seed",
    notes: "",
    auditTrail: [],
    createdAt: inAt.toISOString(),
    updatedAt: inAt.toISOString(),
  };
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const earth = 6371e3;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * earth * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toast(message, kind = "success") {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.textContent = message;
  els.toastStack.append(node);
  setTimeout(() => node.remove(), 3400);
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
