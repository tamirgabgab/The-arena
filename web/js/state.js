// Central application state, change notifications, undo/redo and config files.
// Every page load starts from DEFAULTS (8x8, all cells active); configs persist only via save/load.

export const MAX_SIDE = 40;

export const DEFAULTS = {
  rows: 8, cols: 8,
  adjacency: 'orth',
  selection: 'all',
  prizeEvery: 8, prizeOff: false,
  smallPrize: 10000, bigPrize: 200000,
  model: 'power', modelParam: 1.0, luck: 0,
  nSims: 100000, seed: '',
  defaultP: 0.5, defaultA: 0.5,
};

export const state = {
  ...DEFAULTS,
  active: [], p: [], a: [],
  sel: new Uint8Array(0),
  tab: 'map',
  mapTool: 'brush', brushSize: 1,
  playerTool: 'select',
  metric: 'mean',
  models: [],
  results: null,          // processed results of the last run (with its own board snapshot)
  resultsStale: false,
  validation: null,
  running: false,
};

export const idx = (r, c) => r * state.cols + c;

// ---------- events ----------
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
/** kind: 'board' | 'players' | 'selection' | 'rules' | 'sim' | 'results' | 'tab' | 'tool' */
export function emit(kind) {
  if (['board', 'players', 'rules'].includes(kind) && state.results) state.resultsStale = true;
  for (const fn of listeners) fn(kind);
}

// ---------- board helpers ----------
export function newBoard(rows, cols) {
  state.rows = rows; state.cols = cols;
  const n = rows * cols;
  state.active = new Array(n).fill(1);
  state.p = new Array(n).fill(DEFAULTS.defaultP);
  state.a = new Array(n).fill(DEFAULTS.defaultA);
  state.sel = new Uint8Array(n);
}

/** Resize keeping the overlap. New cells are active only if the old board was full. */
export function resizeBoard(rows, cols) {
  rows = Math.max(1, Math.min(MAX_SIDE, rows | 0));
  cols = Math.max(1, Math.min(MAX_SIDE, cols | 0));
  if (rows === state.rows && cols === state.cols) return;
  pushUndo();
  const wasFull = state.active.every(Boolean);
  const n = rows * cols;
  const active = new Array(n), p = new Array(n), a = new Array(n);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = r * cols + c;
    if (r < state.rows && c < state.cols) {
      const o = r * state.cols + c;
      active[k] = state.active[o]; p[k] = state.p[o]; a[k] = state.a[o];
    } else {
      active[k] = wasFull ? 1 : 0; p[k] = DEFAULTS.defaultP; a[k] = DEFAULTS.defaultA;
    }
  }
  Object.assign(state, { rows, cols, active, p, a, sel: new Uint8Array(n) });
  emit('board');
}

// ---------- undo / redo ----------
const undoStack = [], redoStack = [];
const snapshot = () => JSON.stringify({ rows: state.rows, cols: state.cols, active: state.active, p: state.p, a: state.a });
function restore(snap) {
  const s = JSON.parse(snap);
  const resized = s.rows !== state.rows || s.cols !== state.cols;
  Object.assign(state, s);
  if (resized) state.sel = new Uint8Array(s.rows * s.cols);
}
export function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}
export function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  emit('board');
}
export function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  emit('board');
}

// ---------- config (server format & files) ----------
const to2D = (arr, map = (x) => x) => {
  const out = [];
  for (let r = 0; r < state.rows; r++) out.push(arr.slice(r * state.cols, (r + 1) * state.cols).map(map));
  return out;
};

export function serverConfig() {
  const seed = String(state.seed).trim();
  return {
    rows: state.rows, cols: state.cols,
    active: to2D(state.active, Boolean),
    p: to2D(state.p, Number), a: to2D(state.a, Number),
    adjacency: state.adjacency,
    selection: state.selection,
    prize_every: state.prizeOff ? 0 : state.prizeEvery,
    small_prize: state.smallPrize, big_prize: state.bigPrize,
    model: state.model, model_param: state.modelParam, luck: state.luck,
    n_sims: state.nSims,
    seed: seed === '' ? null : Number(seed),
  };
}

const SAVED_KEYS = ['rows', 'cols', 'active', 'p', 'a', 'adjacency', 'selection', 'prizeEvery', 'prizeOff',
  'smallPrize', 'bigPrize', 'model', 'modelParam', 'luck', 'nSims', 'seed'];

export function exportConfig() {
  const out = { app: 'the-arena', version: 1 };
  for (const k of SAVED_KEYS) out[k] = state[k];
  return out;
}

export function importConfig(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('קובץ לא תקין');
  const rows = obj.rows | 0, cols = obj.cols | 0;
  if (rows < 1 || cols < 1 || rows > MAX_SIDE || cols > MAX_SIDE) throw new Error('גודל לוח לא תקין');
  const n = rows * cols;
  for (const k of ['active', 'p', 'a']) {
    if (!Array.isArray(obj[k]) || obj[k].length !== n) throw new Error(`שדה ${k} לא תקין`);
  }
  pushUndo();
  for (const k of SAVED_KEYS) if (k in obj) state[k] = obj[k];
  if (!['orth', 'both'].includes(state.adjacency)) state.adjacency = 'orth';  // older files had 'diag'
  state.active = obj.active.map((x) => (x ? 1 : 0));
  state.p = obj.p.map((x) => clamp01(+x));
  state.a = obj.a.map((x) => clamp01(+x));
  state.sel = new Uint8Array(n);
}

/** Load the editor from a config in the server's format (as stored with saved runs). */
export function applyServerConfig(cfg) {
  importConfig({
    rows: cfg.rows, cols: cfg.cols,
    active: cfg.active.flat(), p: cfg.p.flat(), a: cfg.a.flat(),
    adjacency: cfg.adjacency, selection: cfg.selection,
    prizeOff: cfg.prize_every === 0,
    prizeEvery: cfg.prize_every >= 2 ? cfg.prize_every : DEFAULTS.prizeEvery,
    smallPrize: cfg.small_prize, bigPrize: cfg.big_prize,
    model: cfg.model, modelParam: cfg.model_param, luck: cfg.luck,
    nSims: cfg.n_sims, seed: cfg.seed == null ? '' : String(cfg.seed),
  });
}

export const clamp01 = (x) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5);

export function resetToDefaults() {
  pushUndo();
  Object.assign(state, {
    adjacency: DEFAULTS.adjacency, selection: DEFAULTS.selection,
    prizeEvery: DEFAULTS.prizeEvery, prizeOff: DEFAULTS.prizeOff,
    smallPrize: DEFAULTS.smallPrize, bigPrize: DEFAULTS.bigPrize,
    model: DEFAULTS.model, modelParam: DEFAULTS.modelParam, luck: DEFAULTS.luck,
    nSims: DEFAULTS.nSims, seed: DEFAULTS.seed,
  });
  newBoard(DEFAULTS.rows, DEFAULTS.cols);
}
