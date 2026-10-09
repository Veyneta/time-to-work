const test = require('node:test');
const assert = require('node:assert/strict');
const { saveSession, loadSession, clearSession } = require('../session-storage.js');

function createStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(String(key)) ? String(store.get(String(key))) : null;
    },
    setItem(key, value) {
      store.set(String(key), String(value));
    },
    removeItem(key) {
      store.delete(String(key));
    },
  };
}

test('stay-signed-in stores session in persistent storage', () => {
  const sessionKey = 'test.session';
  const persistentKey = 'test.session.persistent';
  const sessionStorage = createStorage();
  const localStorage = createStorage();

  globalThis.sessionStorage = sessionStorage;
  globalThis.localStorage = localStorage;

  const result = saveSession({ token: 'abc', userId: 'u1', storeId: 's1', remember: true }, { sessionKey, persistentKey });

  assert.equal(result.remember, true);
  assert.equal(JSON.parse(sessionStorage.getItem(sessionKey)).token, 'abc');
  assert.equal(JSON.parse(localStorage.getItem(persistentKey)).token, 'abc');
  assert.deepEqual(loadSession({ sessionKey, persistentKey }), { token: 'abc', userId: 'u1', storeId: 's1', remember: true });

  clearSession({ sessionKey, persistentKey });
  assert.equal(sessionStorage.getItem(sessionKey), null);
  assert.equal(localStorage.getItem(persistentKey), null);
});
