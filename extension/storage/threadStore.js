// ThreadOS Sentinel — Thread Storage (chrome.storage.local adapter)

const STORE_KEY = 'tos_sentinel_threads';
const VERSION   = 1;

export const ThreadStore = {

  async init() {
    const data = await this._load();
    if (!data) {
      await chrome.storage.local.set({ [STORE_KEY]: { version: VERSION, threads: {} } });
    }
  },

  async _load() {
    const r = await chrome.storage.local.get(STORE_KEY);
    return r[STORE_KEY] || null;
  },

  async _save(state) {
    await chrome.storage.local.set({ [STORE_KEY]: state });
  },

  async _state() {
    return (await this._load()) || { version: VERSION, threads: {} };
  },

  // ── Threads ──────────────────────────────────────────────────────────────
  async getAllThreads() {
    const s = await this._state();
    return Object.values(s.threads).sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async getThread(id) {
    const s = await this._state();
    return s.threads[id] || null;
  },

  async createThread(thread) {
    const s = await this._state();
    s.threads[thread.id] = {
      ...thread,
      sessions: thread.sessions || [],
      driftFlags: thread.driftFlags || [],
      constraints: thread.constraints || [],
    };
    await this._save(s);
    return s.threads[thread.id];
  },

  async updateThread(id, changes) {
    const s = await this._state();
    if (!s.threads[id]) throw new Error(`Thread "${id}" not found`);
    s.threads[id] = { ...s.threads[id], ...changes, updatedAt: Date.now() };
    await this._save(s);
    return s.threads[id];
  },

  async deleteThread(id) {
    const s = await this._state();
    delete s.threads[id];
    await this._save(s);
  },

  // ── Sessions ──────────────────────────────────────────────────────────────
  async addSession(threadId, session) {
    const s = await this._state();
    const t = s.threads[threadId];
    if (!t) throw new Error(`Thread "${threadId}" not found`);
    t.sessions = [...(t.sessions || []), session];
    t.updatedAt = Date.now();
    await this._save(s);
    return session;
  },

  // ── Drift Flags ───────────────────────────────────────────────────────────
  async addDriftFlag(threadId, flag) {
    const s = await this._state();
    const t = s.threads[threadId];
    if (!t) throw new Error(`Thread "${threadId}" not found`);
    t.driftFlags = [...(t.driftFlags || []), flag];
    t.updatedAt = Date.now();
    await this._save(s);
    return flag;
  },

  // ── Utilities ─────────────────────────────────────────────────────────────
  async clearAll() {
    await chrome.storage.local.set({ [STORE_KEY]: { version: VERSION, threads: {} } });
  },

  async usage() {
    return new Promise(r => chrome.storage.local.getBytesInUse(null, r));
  },
};
