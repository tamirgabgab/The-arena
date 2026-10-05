// Saved-run storage. Locally the server keeps runs in saved_runs/; on the hosted (public)
// deployment each visitor's runs are kept in their own browser (IndexedDB).

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`שגיאת שרת (${res.status})`);
  return res.json();
}

const serverStore = {
  list: () => api('GET', '/api/runs'),
  get: (id) => api('GET', `/api/runs/${id}`),
  save: (name, snap, result) => api('POST', '/api/runs', { name, snap, result }),
  rename: (id, name) => api('PATCH', `/api/runs/${id}`, { name }),
  remove: (id) => api('DELETE', `/api/runs/${id}`),
};

// ---------- IndexedDB ----------
const DB_NAME = 'the-arena', STORE = 'runs';
let dbPromise = null;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'meta.id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('הדפדפן לא מאפשר שמירה מקומית (IndexedDB)'));
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error || new Error('שגיאת שמירה מקומית'));
  });
}

function makeMeta(name, snap, result) {
  const cfg = snap.config;
  return {
    id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
    name: name.trim() || 'סימולציה ללא שם',
    created: Date.now() / 1000,
    rows: cfg.rows, cols: cfg.cols,
    players: result.coords.length,
    n_sims: result.n_sims,
    small_prize: result.small_prize, big_prize: result.big_prize,
    model: cfg.model, model_param: cfg.model_param, luck: cfg.luck,
    adjacency: cfg.adjacency, selection: cfg.selection, prize_every: cfg.prize_every,
  };
}

const browserStore = {
  async list() {
    const all = await tx('readonly', (s) => s.getAll());
    return all.map((r) => r.meta).sort((a, b) => b.created - a.created);
  },
  async get(id) {
    const rec = await tx('readonly', (s) => s.get(id));
    if (!rec) throw new Error('הסימולציה לא נמצאה');
    return rec;
  },
  async save(name, snap, result) {
    const meta = makeMeta(name, snap, result);
    await tx('readwrite', (s) => s.put({ meta, snap, result }));
    return meta;
  },
  async rename(id, name) {
    const rec = await this.get(id);
    rec.meta.name = name;
    await tx('readwrite', (s) => s.put(rec));
    return rec.meta;
  },
  async remove(id) {
    await tx('readwrite', (s) => s.delete(id));
    return { ok: true };
  },
};

export const runStore = (mode) => (mode === 'browser' ? browserStore : serverStore);
