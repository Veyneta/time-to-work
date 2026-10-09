function safeParse(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function getStorage(storage) {
  if (storage && typeof storage.getItem === 'function') return storage;
  return {
    store: new Map(),
    getItem(key) {
      return this.store.has(String(key)) ? String(this.store.get(String(key))) : null;
    },
    setItem(key, value) {
      this.store.set(String(key), String(value));
    },
    removeItem(key) {
      this.store.delete(String(key));
    },
  };
}

function saveSession(nextSession, options = {}) {
  const sessionKey = options.sessionKey || 'timecation.session.v1';
  const persistentKey = options.persistentKey || 'timecation.session.remember.v1';
  const sessionStore = getStorage(typeof globalThis !== 'undefined' ? globalThis.sessionStorage : null);
  const persistentStore = getStorage(typeof globalThis !== 'undefined' ? globalThis.localStorage : null);

  if (!nextSession) {
    sessionStore.removeItem(sessionKey);
    persistentStore.removeItem(persistentKey);
    return null;
  }

  const normalized = { ...nextSession, remember: Boolean(nextSession.remember) };
  sessionStore.setItem(sessionKey, JSON.stringify(normalized));

  if (normalized.remember) {
    persistentStore.setItem(persistentKey, JSON.stringify(normalized));
  } else {
    persistentStore.removeItem(persistentKey);
  }

  return normalized;
}

function loadSession(options = {}) {
  const sessionKey = options.sessionKey || 'timecation.session.v1';
  const persistentKey = options.persistentKey || 'timecation.session.remember.v1';
  const persistentStore = getStorage(typeof globalThis !== 'undefined' ? globalThis.localStorage : null);
  const remembered = safeParse(persistentStore.getItem(persistentKey));
  if (remembered && remembered.userId && remembered.token) {
    return remembered;
  }

  const sessionStore = getStorage(typeof globalThis !== 'undefined' ? globalThis.sessionStorage : null);
  const current = safeParse(sessionStore.getItem(sessionKey));
  if (current && current.userId && current.token) {
    return current;
  }

  return null;
}

function clearSession(options = {}) {
  return saveSession(null, options);
}

if (typeof module !== 'undefined') {
  module.exports = { saveSession, loadSession, clearSession };
}

if (typeof window !== 'undefined') {
  window.sessionStorageHelpers = { saveSession, loadSession, clearSession };
}
