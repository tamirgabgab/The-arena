import {
  state, emit, onChange, newBoard, resizeBoard, pushUndo, undo, redo, clamp01,
  exportConfig, importConfig, resetToDefaults,
} from './state.js';
import { validateBoard } from './validate.js';
import { presetList, presetIcon, presetMask } from './shapes.js';
import { BLUE, ISLANDS, ORANGE, cssVar, rampCss } from './colors.js';
import { Grid } from './grid.js';
import { mapRenderer, playersRenderer, resultsRenderer } from './render.js';
import { ghost, mapController, playersController, resultsController } from './tools.js';
import { initRules, syncRules } from './rules.js';
import { initDetail, openDetail } from './detail.js';
import { runSimulation, cancelSimulation } from './runner.js';
import { resultsCsv } from './results.js';
import { diffAvailable, diffLegendHtml, diffView, initCompare, saveCurrentRun } from './compare.js';
import { attachThousands, fmtInt, fmtMoney, fmtPct, readNum, writeNum } from './format.js';

const $ = (id) => document.getElementById(id);
const grid = new Grid($('grid-host'), $('grid'), $('tooltip'));

// ---------------- helpers ----------------
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('toasts').append(el);
  setTimeout(() => el.remove(), type === 'error' ? 7000 : 3500);
}

function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const selectedCells = () => {
  const out = [];
  for (let k = 0; k < state.sel.length; k++) if (state.sel[k] && state.active[k]) out.push(k);
  return out;
};
const activeCells = () => state.active.flatMap((v, k) => (v ? [k] : []));

// ---------------- views ----------------
const views = {
  map: { renderer: mapRenderer(), controller: mapController() },
  players: { renderer: playersRenderer(), controller: playersController(paintValues) },
  view: { renderer: playersRenderer(), controller: null },
  results: { renderer: resultsRenderer(), controller: resultsController(openDetail) },
};

function setGridView() {
  const tab = state.tab;
  const v = tab === 'map' ? views.map
    : tab === 'players' ? views.players
    : tab === 'results' && state.results ? views.results
    : tab === 'compare' && diffAvailable() ? diffView
    : views.view;
  grid.setView(v.renderer, v.controller);
}

function setTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === tab);
  for (const s of document.querySelectorAll('.tab-body')) s.hidden = s.dataset.body !== tab;
  ghost.cells = null;
  ghost.rect = null;
  setGridView();
  if (tab === 'rules') syncRules();
  if (tab === 'results') renderResultsPanel();
  renderBanners();
  renderLegend();
}

// ---------------- validation / run gating ----------------
function revalidate() {
  state.validation = validateBoard(state.rows, state.cols, state.active, state.adjacency);
  const v = state.validation;
  const blocked = !v.ok;
  for (const id of ['btn-run', 'btn-run2']) {
    $(id).disabled = blocked || state.running;
    $(id).title = blocked ? v.errors.join(' · ') : '';
  }
  $('run-blocker').hidden = !blocked;
  $('run-blocker').textContent = blocked ? `⚠ ${v.errors[0]}` : '';
  $('map-stats').innerHTML = `<b>${v.nActive}</b> משבצות פעילות מתוך ${state.rows * state.cols}` +
    (v.compSizes.length === 1 ? ' · מפה מחוברת ✓' : '');
}

function splitExplanation(v) {
  if (v.compSizes.length < 2) return '';
  return '<span class="why">שתי קבוצות מתמודדים שאין ביניהן שום מסלול של שכנים לא יוכלו לעולם להתמודד זו מול זו, ולכן אי אפשר להגיע לגמר.</span>';
}

function renderBanners() {
  const v = state.validation;
  const parts = [];
  if (v && !v.ok && !['results', 'compare'].includes(state.tab)) {
    const split = v.compSizes.length > 1;
    const largest = split ? Math.max(...v.compSizes) : 0;
    parts.push(`<div class="banner error"><b>לא ניתן להריץ:</b> ${v.errors.join(' · ')}.
      ${v.nIsolated ? ' משבצות ללא שכן מסומנות באדום בלשונית "מפה".' : ''}
      ${splitExplanation(v)}
      ${split && state.tab !== 'map' ? '<button class="btn small" data-act="show-islands">הצג את האיים במפה</button>' : ''}
      ${split && largest >= 2 ? `<button class="btn small" data-act="keep-largest">השאר רק את האי הגדול (${largest} משבצות)</button>` : ''}
    </div>`);
  }
  if (state.tab === 'results' && state.results?.cancelled) {
    parts.push(`<div class="banner warn">הסימולציה בוטלה – מוצגות ${fmtInt(state.results.n)} ריצות שהושלמו מתוך ${fmtInt(state.results.requested)}.</div>`);
  }
  $('banners').innerHTML = parts.join('');
}

function renderLegend() {
  const el = $('stage-legend');
  el.dir = state.tab === 'map' ? 'rtl' : 'ltr';  // ramps read left (low) to right (high)
  if (state.tab === 'map') {
    const v = state.validation;
    const items = [
      `<span class="item"><span class="swatch" style="background:var(--cell-active)"></span>פעילה – יש בה מתמודד</span>`,
      `<span class="item"><span class="swatch inactive"></span>לא פעילה – ריקה</span>`,
    ];
    if (v?.nIsolated) items.push(`<span class="item"><span class="swatch" style="background:var(--danger)">!</span>ללא אף שכן</span>`);
    if (v?.compSizes.length > 1) {
      const n = v.compSizes.length;
      const sw = [cssVar('--cell-active'), ...ISLANDS].slice(0, Math.min(n, 7))
        .map((c) => `<span class="swatch" style="background:${c}"></span>`).join('');
      items.push(`<span class="item">${sw}${n} איים מנותקים (הכחול הוא הגדול)</span>`);
    }
    el.innerHTML = items.join('');
  } else if (state.tab === 'results' && state.results) {
    const max = state.results.metricMax[state.metric];
    const fmt = state.metric === 'mean' ? (x) => fmtMoney(x, true) : (x) => fmtPct(x, 1);
    const label = { mean: 'רווח ממוצע', small: 'P(פרס קטן ≥ 1)', big: 'P(פרס גדול)' }[state.metric];
    el.innerHTML = `<span>${fmt(0)}</span><div class="ramp" style="background:${rampCss(ORANGE)}"></div><span>${fmt(max)}</span><span dir="rtl">${label}</span>`;
  } else if (state.tab === 'compare' && diffAvailable()) {
    el.innerHTML = diffLegendHtml();
  } else {
    el.innerHTML = `<span>p = 0</span><div class="ramp" style="background:${rampCss(BLUE)}"></div><span>p = 1</span>
      <span dir="rtl" style="margin-inline-start:16px">פס כתום בתחתית = a</span>
      <span class="item" dir="rtl" style="margin-inline-start:16px"><span class="swatch inactive"></span>משבצת ריקה</span>`;
  }
}

// ---------------- map tab ----------------
function initMapTab() {
  $('in-rows').onchange = () => resizeBoard(+$('in-rows').value, state.cols);
  $('in-cols').onchange = () => resizeBoard(state.rows, +$('in-cols').value);
  $('map-tools').onclick = (e) => {
    const b = e.target.closest('button');
    if (b) { state.mapTool = b.dataset.tool; syncTools(); }
  };
  for (const [rangeId, outId] of [['in-brush', 'out-brush'], ['in-brush2', 'out-brush2']]) {
    $(rangeId).oninput = (e) => { state.brushSize = +e.target.value; syncTools(); };
  }
  $('presets').innerHTML = presetList.map((p) => `<button data-preset="${p.id}" title="${p.name}">${presetIcon(p.id)}${p.name}</button>`).join('');
  $('presets').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    pushUndo();
    state.active = presetMask(b.dataset.preset, state.rows, state.cols);
    emit('board');
  };
  const setAll = (fn) => () => { pushUndo(); state.active = state.active.map(fn); emit('board'); };
  $('btn-fill-all').onclick = setAll(() => 1);
  $('btn-clear-all').onclick = setAll(() => 0);
  $('btn-invert').onclick = setAll((v) => (v ? 0 : 1));
  $('btn-undo').onclick = undo;
  $('btn-redo').onclick = redo;
}

function syncTools() {
  for (const b of $('map-tools').children) b.classList.toggle('active', b.dataset.tool === state.mapTool);
  for (const b of $('player-tools').children) b.classList.toggle('active', b.dataset.tool === state.playerTool);
  for (const [rangeId, outId] of [['in-brush', 'out-brush'], ['in-brush2', 'out-brush2']]) {
    $(rangeId).value = state.brushSize;
    $(outId).textContent = state.brushSize;
  }
}

// ---------------- players tab ----------------
function paintValues() {
  return {
    p: clamp01(+$('num-p').value), a: clamp01(+$('num-a').value),
    useP: $('chk-p').checked, useA: $('chk-a').checked,
  };
}

function initPlayersTab() {
  $('player-tools').onclick = (e) => {
    const b = e.target.closest('button');
    if (b) { state.playerTool = b.dataset.tool; syncTools(); }
  };
  for (const name of ['p', 'a']) {
    const r = $(`in-${name}`), n = $(`num-${name}`);
    r.value = n.value = 0.5;
    r.oninput = () => { n.value = r.value; };
    n.onchange = () => { n.value = clamp01(+n.value); r.value = n.value; };
  }
  $('btn-apply').onclick = () => {
    const cells = selectedCells();
    if (!cells.length) return toast('לא נבחרו מתמודדים – בחרו משבצות על הלוח');
    const { p, a, useP, useA } = paintValues();
    pushUndo();
    for (const k of cells) {
      if (useP) state.p[k] = p;
      if (useA) state.a[k] = a;
    }
    emit('players');
    toast(`עודכנו ${cells.length} מתמודדים`);
  };
  $('btn-sel-all').onclick = () => { state.sel = Uint8Array.from(state.active); emit('selection'); };
  $('btn-sel-none').onclick = () => { state.sel.fill(0); emit('selection'); };
  $('btn-sel-invert').onclick = () => {
    state.sel = state.sel.map((v, k) => (state.active[k] ? v ^ 1 : 0));
    emit('selection');
  };
  $('btn-sel-similar').onclick = () => {
    const keys = new Set(selectedCells().map((k) => `${state.p[k]}|${state.a[k]}`));
    if (!keys.size) return toast('בחרו קודם מתמודד אחד או יותר');
    for (let k = 0; k < state.sel.length; k++) {
      if (state.active[k] && keys.has(`${state.p[k]}|${state.a[k]}`)) state.sel[k] = 1;
    }
    emit('selection');
  };

  const syncDistLabels = () => {
    const normal = $('rnd-dist').value === 'normal';
    $('rnd-l1').firstChild.textContent = normal ? 'ממוצע μ' : 'מ-';
    $('rnd-l2').firstChild.textContent = normal ? 'סטיית תקן σ' : 'עד';
  };
  $('rnd-dist').onchange = () => {
    const normal = $('rnd-dist').value === 'normal';
    $('rnd-x').value = normal ? 0.5 : 0.2;
    $('rnd-y').value = normal ? 0.15 : 0.8;
    syncDistLabels();
  };
  syncDistLabels();
  $('btn-random').onclick = () => {
    const cells = selectedCells().length ? selectedCells() : activeCells();
    const target = $('rnd-target').value, x = +$('rnd-x').value, y = +$('rnd-y').value;
    const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
    const draw = () => {
      if ($('rnd-dist').value === 'uniform') return Math.min(x, y) + Math.random() * Math.abs(y - x);
      for (let i = 0; i < 100; i++) {
        const v = x + y * gauss();
        if (v >= 0 && v <= 1) return v;
      }
      return x;
    };
    pushUndo();
    for (const k of cells) state[target][k] = Math.round(clamp01(draw()) * 100) / 100;
    emit('players');
    toast(`הוגרלו ערכי ${target} ל-${cells.length} מתמודדים`);
  };
}

function syncSelectionPanel() {
  const cells = selectedCells();
  $('sel-count').textContent = cells.length ? `נבחרו ${cells.length} מתמודדים` : 'לא נבחרו מתמודדים';
  $('btn-apply').textContent = cells.length ? `החל על ${cells.length} הנבחרים` : 'החל על הנבחרים';
  if (!cells.length) return;
  for (const name of ['p', 'a']) {
    const vals = new Set(cells.map((k) => state[name][k]));
    if (vals.size === 1) {
      const v = [...vals][0];
      $(`in-${name}`).value = v;
      $(`num-${name}`).value = v;
    }
  }
}

// ---------------- sim tab ----------------
function initSimTab() {
  attachThousands($('in-nsims'));
  $('in-nsims').onchange = (e) => {
    const v = readNum(e.target);
    const max = state.server.max_sims;
    state.nSims = Math.max(1, Math.min(max, Number.isFinite(v) ? v : 1));
    writeNum(e.target, state.nSims);
    if (v > max) toast(`המקסימום כאן הוא ${fmtInt(max)} סימולציות בהרצה`);
    emit('sim');
  };
  $('in-seed').onchange = (e) => {
    const v = e.target.value.trim();
    if (v !== '' && !/^\d{1,18}$/.test(v)) {
      toast('Seed חייב להיות מספר שלם חיובי', 'error');
      e.target.value = state.seed;
      return;
    }
    state.seed = v;
    emit('sim');
  };
  $('btn-save').onclick = () => download('arena-config.json', JSON.stringify(exportConfig(), null, 1), 'application/json');
  $('btn-load').onclick = () => $('file-load').click();
  $('file-load').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      importConfig(JSON.parse(await f.text()));
      afterBulkChange();
      toast('הקונפיגורציה נטענה');
    } catch (err) {
      toast(`שגיאה בטעינה: ${err.message}`, 'error');
    }
  };
  $('btn-reset').onclick = () => { resetToDefaults(); afterBulkChange(); toast('אופס לברירת המחדל'); };
}

function afterBulkChange() {
  if (!state.models.some((m) => m.id === state.model)) state.model = state.models[0].id;
  syncInputs();
  emit('board');
  emit('rules');
}

function syncInputs() {
  $('in-rows').value = state.rows;
  $('in-cols').value = state.cols;
  writeNum($('in-nsims'), state.nSims);
  $('in-seed').value = state.seed;
  syncTools();
}

// ---------------- results ----------------
function renderResultsPanel() {
  const res = state.results;
  $('results-empty').hidden = !!res;
  $('results-body').hidden = !res;
  if (!res) return;
  $('stale-banner').hidden = !state.resultsStale;
  for (const b of $('metric-seg').children) b.classList.toggle('active', b.dataset.metric === state.metric);
  const totalMean = res.players.reduce((s, p) => s + p.mean, 0);
  $('results-summary').innerHTML = `<h3>סיכום ההרצה</h3><dl class="kv">
    ${res.name ? `<dt>שם</dt><dd><b>${res.name.replace(/[<>&]/g, '')}</b></dd>` : ''}
    <dt>סימולציות</dt><dd>${fmtInt(res.n)}${res.cancelled ? ` מתוך ${fmtInt(res.requested)}` : ''}</dd>
    <dt>זמן ריצה</dt><dd>${res.elapsed.toFixed(2)} שניות · ${fmtInt(res.n / Math.max(res.elapsed, 1e-6))} משחקים/שנייה · ${res.threads} ליבות</dd>
    <dt>Seed</dt><dd dir="ltr" style="text-align:right">${res.seed} <button class="btn small" id="btn-reuse-seed">השתמש</button></dd>
    <dt>כסף ממוצע למשחק</dt><dd>${fmtMoney(totalMean)}</dd>
  </dl>`;
  $('btn-reuse-seed').onclick = () => { state.seed = res.seed; syncInputs(); toast('ה-seed הועתק ללשונית סימולציה'); };
  const top = [...res.players].sort((a, b) => b.mean - a.mean).slice(0, 10);
  $('top-list').innerHTML = top.map((p) =>
    `<li data-i="${p.i}">(${p.r + 1}, ${p.c + 1}) · p=${p.p.toFixed(2)}, a=${p.a.toFixed(2)} — <span class="v">${fmtMoney(p.mean)}</span></li>`).join('');
  renderSaveGroup();
  renderSimSummary();
}

function defaultRunName(res) {
  const cfg = res.raw.snap.config;
  const m = state.models.find((x) => x.id === cfg.model);
  const model = m ? `${m.name.split(' (')[0]} ${m.param.symbol}=${cfg.model_param}` : cfg.model;
  return `${model} · ${res.rows}×${res.cols} · ${fmtInt(res.n)} ריצות`;
}

function renderSaveGroup() {
  const res = state.results;
  const saved = !!res.savedId;
  $('in-run-name').disabled = saved;
  $('btn-save-run').disabled = saved;
  $('in-run-name').value = saved ? res.name : ($('in-run-name').dataset.for === String(res.seed) ? $('in-run-name').value : defaultRunName(res));
  $('in-run-name').dataset.for = String(res.seed);
  $('save-hint').textContent = saved
    ? '✓ שמורה. אפשר להשוות אותה לסימולציות אחרות בלשונית "השוואה".'
    : state.server.storage === 'browser'
      ? 'סימולציות שמורות מופיעות בלשונית "השוואה". הן נשמרות בדפדפן הזה בלבד.'
      : 'סימולציות שמורות מופיעות בלשונית "השוואה", ונשמרות גם אחרי סגירת הדפדפן.';
}

function renderSimSummary() {
  const res = state.results;
  $('sim-summary').innerHTML = res
    ? `<h3>הרצה אחרונה</h3><p class="stat-line">${fmtInt(res.n)} משחקים ב-${res.elapsed.toFixed(2)} שניות (seed ${res.seed})</p>`
    : '';
}

function initResultsTab() {
  $('metric-seg').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.metric = b.dataset.metric;
    renderResultsPanel();
    renderLegend();
    grid.requestDraw();
  };
  $('top-list').onclick = (e) => {
    const li = e.target.closest('li');
    if (li) openDetail(+li.dataset.i);
  };
  $('btn-save-run').onclick = async () => {
    const name = $('in-run-name').value.trim();
    if (!name) return toast('תנו שם לסימולציה');
    try {
      await saveCurrentRun(name);
      renderResultsPanel();
      toast(`נשמרה: ${name}`);
    } catch (err) {
      toast(`השמירה נכשלה: ${err.message}`, 'error');
    }
  };
  $('in-run-name').onkeydown = (e) => { if (e.key === 'Enter') $('btn-save-run').click(); };
  $('btn-csv').onclick = () => state.results && download('arena-results.csv', '﻿' + resultsCsv(state.results), 'text/csv');
}

// ---------------- run ----------------
function startRun() {
  revalidate();
  if (!state.validation.ok || state.running) return;
  runSimulation({
    onStart: () => revalidate(),
    onResult: (res) => {
      state.results = res;
      state.resultsStale = false;
      setTab('results');
      toast(res.cancelled ? `בוטל – מוצגות ${fmtInt(res.n)} ריצות` : `הסתיים: ${fmtInt(res.n)} משחקים ב-${res.elapsed.toFixed(2)} שניות`);
    },
    onError: (m) => toast(m, 'error'),
    onEnd: () => revalidate(),
  });
}

// ---------------- change handling ----------------
let lastDims = '';
onChange((kind) => {
  if (kind === 'board' || kind === 'rules') {
    revalidate();
    renderBanners();
    if (state.tab === 'map') renderLegend();
    const dims = `${state.rows}x${state.cols}`;
    if (dims !== lastDims) { lastDims = dims; syncInputs(); grid.layout(); }
  }
  if (kind === 'rules' || (kind === 'board' && state.tab === 'rules')) syncRules();
  if (kind === 'selection' || kind === 'board' || kind === 'players') syncSelectionPanel();
  if (state.results && state.tab === 'results') $('stale-banner').hidden = !state.resultsStale;
  grid.requestDraw();
});

document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && !typing) {
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    return;
  }
  if (typing || state.tab !== 'map') return;
  const tool = { b: 'brush', e: 'eraser', r: 'rect', o: 'ellipse', l: 'line', f: 'fill' }[e.key.toLowerCase()];
  if (tool) { state.mapTool = tool; syncTools(); }
});

// ---------------- boot ----------------
async function boot() {
  try {
    [state.models, state.server] = await Promise.all(
      ['/api/models', '/api/config'].map(async (u) => (await fetch(u)).json()));
  } catch {
    toast('לא ניתן להתחבר לשרת הסימולציה', 'error');
  }
  state.server ??= { storage: 'server', max_sims: 10_000_000 };
  try { localStorage.removeItem('arena-config-v1'); } catch { /* drop the old auto-saved board */ }
  newBoard(state.rows, state.cols);
  if (!state.models.some((m) => m.id === state.model) && state.models.length) state.model = state.models[0].id;

  $('ramp-p').style.background = rampCss(BLUE);
  initMapTab();
  initPlayersTab();
  initRules();
  initSimTab();
  initResultsTab();
  initDetail();
  initCompare({
    setTab, afterBulkChange, toast,
    refreshView: () => { if (state.tab === 'compare') { setGridView(); renderLegend(); } },
  }, state.server.storage);
  for (const b of document.querySelectorAll('.tab')) b.onclick = () => setTab(b.dataset.tab);
  $('banners').onclick = (e) => {
    const act = e.target.closest('button')?.dataset.act;
    const v = state.validation;
    if (act === 'show-islands') setTab('map');
    if (act === 'keep-largest') {
      const best = v.compSizes.indexOf(Math.max(...v.compSizes));
      pushUndo();
      state.active = state.active.map((a, k) => (a && v.comp[k] === best ? 1 : 0));
      emit('board');
      toast('נשאר רק האי הגדול ביותר (Ctrl+Z לביטול)');
    }
  };
  $('btn-run').onclick = startRun;
  $('btn-run2').onclick = startRun;
  $('btn-cancel').onclick = cancelSimulation;

  syncInputs();
  lastDims = `${state.rows}x${state.cols}`;
  revalidate();
  syncRules();
  syncSelectionPanel();
  setTab('map');
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { grid.requestDraw(); syncRules(); });
}

boot();
