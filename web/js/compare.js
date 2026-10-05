// Saved runs (server-side) and the comparison tab: settings/results table, per-cell
// difference heat map between two runs, and a per-contestant comparison modal.
import { state, applyServerConfig } from './state.js';
import { CATEGORICAL, cssVar, inkOn } from './colors.js';
import { processResults } from './results.js';
import { percentAxis } from './detail.js';
import { fmtInt, fmtMoney, fmtPct } from './format.js';

const $ = (id) => document.getElementById(id);
const MAX_COMPARE = 4;

const cache = new Map();          // run id -> processed results
const colorOf = new Map();        // run id -> categorical slot (fixed while selected)
let selected = [];                // run ids, in selection order
let pair = [null, null];          // [A, B] for the difference map
let cmpMetric = 'mean';
let hooks = {};

// ---------------- API ----------------
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`שגיאת שרת (${res.status})`);
  return res.json();
}

async function loadRun(id) {
  if (cache.has(id)) return cache.get(id);
  const data = await api('GET', `/api/runs/${id}`);
  const res = processResults(data.result, data.snap);
  res.savedId = id;
  res.name = data.meta.name;
  cache.set(id, res);
  return res;
}

export async function refreshRuns() {
  try {
    state.saved = await api('GET', '/api/runs');
  } catch (err) {
    hooks.toast?.(`לא ניתן לטעון סימולציות שמורות: ${err.message}`, 'error');
    state.saved = [];
  }
  selected = selected.filter((id) => state.saved.some((m) => m.id === id));
  renderRunList();
  await renderCompare();
}

export async function saveCurrentRun(name) {
  const res = state.results;
  const meta = await api('POST', '/api/runs', { name, snap: res.raw.snap, result: res.raw.msg });
  res.savedId = meta.id;
  res.name = meta.name;
  cache.set(meta.id, res);
  await refreshRuns();
  return meta;
}

// ---------------- descriptions ----------------
const modelOf = (id) => state.models.find((m) => m.id === id);
const adjName = (a) => (a === 'both' ? 'ישר + אלכסון' : 'ישר בלבד');
const selName = (s) => (s === 'singles' ? 'רק בעלי משבצת אחת' : 'מכל המתמודדים');
const modelLabel = (cfg) => {
  const m = modelOf(cfg.model);
  return m ? `${m.name.split(' (')[0]}, ${m.param.symbol}=${cfg.model_param}` : cfg.model;
};
const fmtDate = (t) => new Date(t * 1000).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });

function spread(values) {
  const lo = Math.min(...values), hi = Math.max(...values);
  if (lo === hi) return `כולם ${lo.toFixed(2)}`;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return `${lo.toFixed(2)}–${hi.toFixed(2)} (ממוצע ${mean.toFixed(2)})`;
}

const cellName = (pl) => `(${pl.r + 1}, ${pl.c + 1})`;
const runColor = (id) => CATEGORICAL[colorOf.get(id) ?? 0];
const sameLayout = (a, b) => a.rows === b.rows && a.cols === b.cols &&
  a.players.length === b.players.length && a.players.every((pl, i) => b.playerAt[pl.r * b.cols + pl.c] >= 0);

// ---------------- run list ----------------
function renderRunList() {
  $('runs-empty').hidden = state.saved.length > 0;
  $('run-list').innerHTML = state.saved.map((m) => {
    const on = selected.includes(m.id);
    const cfgLike = { model: m.model, model_param: m.model_param };
    return `<li class="run-item ${on ? 'checked' : ''}" data-id="${m.id}">
      <input type="checkbox" data-act="toggle" ${on ? 'checked' : ''} aria-label="בחר להשוואה">
      <div class="run-name">${on ? `<span class="run-dot" style="background:${runColor(m.id)}"></span>` : ''}${escapeHtml(m.name)}</div>
      <div class="run-meta">${m.rows}×${m.cols} · ${m.players} מתמודדים · ${escapeHtml(modelLabel(cfgLike))} · ${fmtInt(m.n_sims)} ריצות · ${fmtDate(m.created)}</div>
      <div class="run-actions">
        <button class="btn" data-act="show">הצג תוצאות</button>
        <button class="btn" data-act="load">טען הגדרות לעריכה</button>
        <button class="btn" data-act="rename">שנה שם</button>
        <button class="btn danger" data-act="delete">מחק</button>
      </div>
    </li>`;
  }).join('');
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function onRunAction(e) {
  const li = e.target.closest('.run-item');
  const act = e.target.dataset.act;
  if (!li || !act) return;
  const id = li.dataset.id;
  const meta = state.saved.find((m) => m.id === id);
  try {
    if (act === 'toggle') {
      if (e.target.checked) {
        if (selected.length >= MAX_COMPARE) {
          e.target.checked = false;
          return hooks.toast?.(`אפשר להשוות עד ${MAX_COMPARE} סימולציות`);
        }
        const used = new Set(colorOf.values());
        colorOf.set(id, [0, 1, 2, 3].find((i) => !used.has(i)));
        selected.push(id);
      } else {
        selected = selected.filter((x) => x !== id);
        colorOf.delete(id);
      }
      renderRunList();
      await renderCompare();
    } else if (act === 'show') {
      state.results = await loadRun(id);
      state.resultsStale = false;
      hooks.setTab('results');
    } else if (act === 'load') {
      const run = await loadRun(id);
      applyServerConfig(run.raw.snap.config);
      hooks.afterBulkChange();
      hooks.toast?.(`ההגדרות של "${meta.name}" נטענו לעריכה`);
    } else if (act === 'rename') {
      const name = prompt('שם חדש לסימולציה:', meta.name);
      if (!name || !name.trim()) return;
      await api('PATCH', `/api/runs/${id}`, { name: name.trim() });
      if (cache.has(id)) cache.get(id).name = name.trim();
      await refreshRuns();
    } else if (act === 'delete') {
      if (!confirm(`למחוק את "${meta.name}"? לא ניתן לשחזר.`)) return;
      await api('DELETE', `/api/runs/${id}`);
      cache.delete(id);
      colorOf.delete(id);
      if (state.results?.savedId === id) state.results.savedId = null;
      await refreshRuns();
      hooks.toast?.('הסימולציה נמחקה');
    }
  } catch (err) {
    hooks.toast?.(err.message, 'error');
  }
}

// ---------------- comparison table ----------------
async function renderCompare() {
  const ready = selected.length >= 2;
  $('compare-body').hidden = !ready;
  if (!ready) { pair = [null, null]; hooks.refreshView?.(); return; }
  const runs = await Promise.all(selected.map(loadRun));

  const head = `<thead><tr><th></th>${runs.map((r) =>
    `<th><span class="run-name"><span class="run-dot" style="background:${runColor(r.savedId)}"></span>${escapeHtml(r.name)}</span></th>`).join('')}</tr></thead>`;

  const settings = [
    ['לוח', (r) => `${r.rows}×${r.cols}`],
    ['מתמודדים', (r) => r.players.length],
    ['שכנות', (r) => adjName(r.raw.snap.config.adjacency)],
    ['בחירת תוקף', (r) => selName(r.raw.snap.config.selection)],
    ['פרס קטן כל', (r) => (r.raw.snap.config.prize_every ? `${r.raw.snap.config.prize_every} קרבות` : 'ללא')],
    ['פרס קטן', (r) => fmtMoney(r.smallPrize)],
    ['פרס גדול', (r) => fmtMoney(r.bigPrize)],
    ['מודל', (r) => modelLabel(r.raw.snap.config)],
    ['מזל λ', (r) => r.raw.snap.config.luck],
    ['יכולות p', (r) => spread(r.players.map((p) => p.p))],
    ['אגרסיביות a', (r) => spread(r.players.map((p) => p.a))],
    ['סימולציות', (r) => fmtInt(r.n)],
    ['Seed', (r) => r.seed],
  ];
  const extreme = (r, pick) => {
    const best = r.players.reduce((x, y) => (pick(y) > pick(x) ? y : x));
    return best;
  };
  const results = [
    ['כסף ממוצע למשחק', (r) => fmtMoney(r.players.reduce((s, p) => s + p.mean, 0))],
    ['רווח ממוצע – הגבוה', (r) => { const b = extreme(r, (p) => p.mean); return `${fmtMoney(b.mean)} ${cellName(b)}`; }],
    ['רווח ממוצע – הנמוך', (r) => { const b = extreme(r, (p) => -p.mean); return `${fmtMoney(b.mean)} ${cellName(b)}`; }],
    ['פיזור בין מתמודדים (ס״ת של הממוצעים)', (r) => {
      const ms = r.players.map((p) => p.mean), mu = ms.reduce((s, v) => s + v, 0) / ms.length;
      return fmtMoney(Math.sqrt(ms.reduce((s, v) => s + (v - mu) ** 2, 0) / ms.length));
    }],
    ['P(פרס גדול) – הגבוה', (r) => { const b = extreme(r, (p) => p.pBig); return `${fmtPct(b.pBig, 2)} ${cellName(b)}`; }],
    ['P(פרס קטן ≥ 1) – הגבוה', (r) => { const b = extreme(r, (p) => p.pSmall); return `${fmtPct(b.pSmall, 2)} ${cellName(b)}`; }],
  ];
  const rowHtml = ([label, fn], markDiff) => {
    const vals = runs.map((r) => String(fn(r)));
    const diff = markDiff && new Set(vals).size > 1;
    return `<tr class="${diff ? 'diff' : ''}"><td>${label}</td>${vals.map((v) => `<td class="num">${escapeHtml(v)}</td>`).join('')}</tr>`;
  };
  $('cmp-table').innerHTML = `${head}<tbody>
    <tr class="section"><td colspan="${runs.length + 1}">הגדרות</td></tr>
    ${settings.map((s) => rowHtml(s, true)).join('')}
    <tr class="section"><td colspan="${runs.length + 1}">תוצאות</td></tr>
    ${results.map((s) => rowHtml(s, false)).join('')}
  </tbody>`;

  // A / B selectors
  if (!selected.includes(pair[0])) pair[0] = selected[0];
  if (!selected.includes(pair[1]) || pair[1] === pair[0]) pair[1] = selected.find((id) => id !== pair[0]);
  for (const [i, el] of [[0, $('cmp-a')], [1, $('cmp-b')]]) {
    el.innerHTML = runs.map((r) => `<option value="${r.savedId}">${escapeHtml(r.name)}</option>`).join('');
    el.value = pair[i];
  }
  updateDiffHint();
  hooks.refreshView?.();
}

function updateDiffHint() {
  const [a, b] = pair.map((id) => cache.get(id));
  if (!a || !b) { $('diff-hint').textContent = ''; return; }
  $('diff-hint').textContent = pair[0] === pair[1]
    ? 'בחרו שתי סימולציות שונות.'
    : sameLayout(a, b)
      ? 'כחול = B גבוה יותר מ-A, אדום = B נמוך יותר. במשבצת: ההפרש, ומתחתיו A → B. לחיצה על משבצת משווה את המתמודד בכל הסימולציות המסומנות.'
      : 'ללוחות של A ו-B יש מבנה שונה, ולכן אי אפשר להשוות משבצת מול משבצת. הטבלה למעלה עדיין תקפה.';
}

// ---------------- difference heat map ----------------
const POS = ['#f0efec', '#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
const NEG = ['#f0efec', '#f9d3d2', '#f2a3a2', '#e66767', '#c13a3a', '#8a2323'];

function rampAt(ramp, t) {
  const x = Math.min(1, Math.max(0, t)) * (ramp.length - 1), i = Math.min(ramp.length - 2, Math.floor(x)), f = x - i;
  const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const [p, q] = [hex(ramp[i]), hex(ramp[i + 1])];
  return `rgb(${p.map((v, k) => Math.round(v + (q[k] - v) * f)).join(',')})`;
}
const divergingColor = (t) => (t >= 0 ? rampAt(POS, t) : rampAt(NEG, -t));

const metricOf = (pl) => (cmpMetric === 'small' ? pl.pSmall : cmpMetric === 'big' ? pl.pBig : pl.mean);
const fmtMetric = (v, compact = true) => (cmpMetric === 'mean' ? fmtMoney(v, compact) : fmtPct(v, 1));
const fmtDelta = (d) => {
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  return cmpMetric === 'mean' ? `${sign}${fmtMoney(Math.abs(d), true)}` : `${sign}${(Math.abs(d) * 100).toFixed(1)}pp`;
};

function diffPair() {
  const [a, b] = pair.map((id) => cache.get(id));
  return a && b && pair[0] !== pair[1] && sameLayout(a, b) ? [a, b] : null;
}

function diffs() {
  const [a, b] = diffPair();
  const out = a.players.map((pa) => {
    const pb = b.players[b.playerAt[pa.r * b.cols + pa.c]];
    return { pa, pb, d: metricOf(pb) - metricOf(pa) };
  });
  const maxAbs = Math.max(1e-12, ...out.map((x) => Math.abs(x.d)));
  return { a, b, out, maxAbs };
}

export function diffAvailable() {
  return state.tab === 'compare' && selected.length >= 2 && !!diffPair();
}

export const diffView = {
  renderer: {
    dims: () => { const [a] = diffPair() || [state]; return { rows: a.rows, cols: a.cols }; },
    draw(ctx, g) {
      if (!diffPair()) return;
      const { a, out, maxAbs } = diffs();
      const ground = cssVar('--ground'), groundLine = cssVar('--ground-line'), ink = cssVar('--ink');
      const gap = Math.max(1, Math.round(g.cs * 0.06)), s = g.cs - gap, rad = Math.min(7, g.cs * 0.16);
      const byCell = new Map(out.map((x) => [x.pa.r * a.cols + x.pa.c, x]));
      for (let k = 0; k < a.rows * a.cols; k++) {
        const { x, y } = g.cellRect(k);
        const bx = x + gap / 2, by = y + gap / 2;
        const item = byCell.get(k);
        ctx.beginPath();
        ctx.roundRect(bx, by, s, s, rad);
        if (!item) {
          ctx.fillStyle = ground; ctx.fill();
          ctx.setLineDash([3, 3]); ctx.strokeStyle = groundLine; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
          continue;
        }
        const fill = divergingColor(item.d / maxAbs);
        ctx.fillStyle = fill; ctx.fill();
        ctx.fillStyle = inkOn(fill);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const cx = bx + s / 2;
        if (g.cs >= 62) {
          ctx.font = `700 ${Math.round(Math.min(16, g.cs * 0.2))}px Heebo, sans-serif`;
          ctx.fillText(fmtDelta(item.d), cx, by + s * 0.38);
          ctx.font = `500 ${Math.round(Math.min(11, g.cs * 0.13))}px Heebo, sans-serif`;
          ctx.globalAlpha = 0.85;
          ctx.fillText(`${fmtMetric(metricOf(item.pa))} → ${fmtMetric(metricOf(item.pb))}`, cx, by + s * 0.68);
          ctx.globalAlpha = 1;
        } else if (g.cs >= 34) {
          ctx.font = `600 ${Math.round(g.cs * 0.22)}px Heebo, sans-serif`;
          ctx.fillText(fmtDelta(item.d), cx, by + s / 2 + 1);
        }
      }
      if (g.hover >= 0) {
        const { x, y } = g.cellRect(g.hover);
        ctx.beginPath(); ctx.roundRect(x + gap / 2 + 1, y + gap / 2 + 1, s - 2, s - 2, rad);
        ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.stroke();
      }
    },
    tooltip(k) {
      if (!diffPair()) return null;
      const { a, b, out } = diffs();
      const item = out.find((x) => x.pa.r * a.cols + x.pa.c === k);
      if (!item) return null;
      const line = (name, pl) => `<b>${escapeHtml(name)}</b>: ${fmtMoney(pl.mean)} · ק ${fmtPct(pl.pSmall, 1)} · ג ${fmtPct(pl.pBig, 1)}`;
      return `מתמודד <b>${cellName(item.pa)}</b><br>${line(`A – ${a.name}`, item.pa)}<br>${line(`B – ${b.name}`, item.pb)}<br>הפרש: <b dir="ltr">${fmtDelta(item.d)}</b><br><span style="opacity:.7">לחצו להשוואה מלאה</span>`;
    },
  },
  controller: {
    down(cell) {
      if (!cell || !diffPair()) return;
      const [a] = diffPair();
      const i = a.playerAt[cell.k];
      if (i >= 0) openCompareDetail(a.players[i]);
    },
  },
};

export function diffLegendHtml() {
  if (!diffAvailable()) return '';
  const { maxAbs } = diffs();
  const grad = `linear-gradient(to right, ${[...NEG].reverse().join(',')}, ${POS.slice(1).join(',')})`;
  return `<span dir="rtl">B נמוך מ-A</span><span>${fmtDelta(-maxAbs)}</span><div class="ramp" style="background:${grad}"></div><span>${fmtDelta(maxAbs)}</span><span dir="rtl">B גבוה מ-A</span>`;
}

// ---------------- per-contestant comparison modal ----------------
let cmpChart = null;
let cmpScale = 'nozero';
let cmpCurrent = null;

function openCompareDetail(plA) {
  const base = cache.get(pair[0]);
  const runs = selected.map((id) => cache.get(id)).filter((r) => r && sameLayout(base, r));
  const players = runs.map((r) => r.players[r.playerAt[plA.r * r.cols + plA.c]]);
  cmpCurrent = { runs, players, cell: plA };
  $('cmp-detail-title').textContent = `השוואת המתמודד בשורה ${plA.r + 1}, עמודה ${plA.c + 1}`;
  $('cmp-detail-sub').textContent = `${runs.length} סימולציות`;
  const rows = [
    ['יכולת p', (p) => p.p.toFixed(2)],
    ['אגרסיביות a', (p) => p.a.toFixed(2)],
    ['רווח ממוצע', (p) => fmtMoney(p.mean)],
    ['סטיית תקן', (p) => fmtMoney(p.std)],
    ['חציון', (p) => fmtMoney(p.median)],
    ['אחוזון 10', (p) => fmtMoney(p.p10)],
    ['אחוזון 90', (p) => fmtMoney(p.p90)],
    ['P(₪0)', (p) => fmtPct((p.entries.find((e) => e.amount === 0)?.count ?? 0) / p.n)],
    ['P(פרס קטן ≥ 1)', (p) => fmtPct(p.pSmall)],
    ['P(פרס גדול)', (p) => fmtPct(p.pBig)],
    ['ממוצע פרסים קטנים', (p) => p.avgSmallCount.toFixed(3)],
  ];
  $('cmp-stats').innerHTML = `<thead><tr><th></th>${runs.map((r) =>
    `<th><span class="run-name"><span class="run-dot" style="background:${runColor(r.savedId)}"></span>${escapeHtml(r.name)}</span></th>`).join('')}</tr></thead>
    <tbody>${rows.map(([label, fn]) => `<tr><td>${label}</td>${players.map((p) => `<td class="num">${fn(p)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  $('cmp-detail').hidden = false;
  drawCompareChart();
}

function closeCompareDetail() {
  $('cmp-detail').hidden = true;
  cmpChart?.destroy();
  cmpChart = null;
}

function drawCompareChart() {
  if (typeof Chart === 'undefined' || !cmpCurrent) return;
  const { runs, players } = cmpCurrent;
  for (const x of $('cmp-scale-seg').children) x.classList.toggle('active', x.dataset.scale === cmpScale);
  const amounts = [...new Set(players.flatMap((p) => p.entries.map((e) => e.amount)))]
    .filter((v) => cmpScale !== 'nozero' || v !== 0).sort((x, y) => x - y);
  const datasets = runs.map((r, j) => {
    const pl = players[j];
    const byAmount = new Map(pl.entries.map((e) => [e.amount, e.count]));
    return {
      label: r.name,
      data: amounts.map((v) => ((byAmount.get(v) || 0) / pl.n) * 100),
      backgroundColor: runColor(r.savedId), borderRadius: 3, borderSkipped: 'bottom', maxBarThickness: 28,
    };
  });
  $('cmp-chart-note').innerHTML = cmpScale === 'nozero'
    ? `₪0 מוסתר: ${runs.map((r, j) => `${escapeHtml(r.name)} <b>${fmtPct((players[j].entries.find((e) => e.amount === 0)?.count ?? 0) / players[j].n, 2)}</b>`).join(' · ')}`
    : cmpScale === 'log' ? 'ציר Y לוגריתמי – כל קו רשת מייצג פי 10.' : '';
  const ink2 = cssVar('--ink-2');
  const options = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
    plugins: {
      legend: { position: 'top', rtl: true, labels: { color: ink2, boxWidth: 12 } },
      tooltip: {
        rtl: true,
        callbacks: {
          title: (items) => fmtMoney(amounts[items[0].dataIndex]),
          label: (item) => `${item.dataset.label}: ${item.raw.toFixed(3)}%`,
        },
      },
    },
    scales: {
      x: { ticks: { color: ink2, maxRotation: 0, autoSkip: true }, grid: { display: false }, title: { display: true, text: 'סכום זכייה', color: ink2 } },
      y: percentAxis(cmpScale, 'pmf', datasets.flatMap((d) => d.data), 'הסתברות'),
    },
  };
  cmpChart?.destroy();
  cmpChart = new Chart($('cmp-chart'), { type: 'bar', data: { labels: amounts.map((v) => fmtMoney(v, true)), datasets }, options });
}

// ---------------- init ----------------
export function initCompare(h) {
  hooks = h;
  $('run-list').addEventListener('click', (e) => { if (e.target.dataset.act && e.target.dataset.act !== 'toggle') onRunAction(e); });
  $('run-list').addEventListener('change', (e) => { if (e.target.dataset.act === 'toggle') onRunAction(e); });
  $('cmp-a').onchange = (e) => { pair[0] = e.target.value; updateDiffHint(); hooks.refreshView?.(); };
  $('cmp-b').onchange = (e) => { pair[1] = e.target.value; updateDiffHint(); hooks.refreshView?.(); };
  $('cmp-metric-seg').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    cmpMetric = b.dataset.metric;
    for (const x of $('cmp-metric-seg').children) x.classList.toggle('active', x === b);
    hooks.refreshView?.();
  };
  $('cmp-scale-seg').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    cmpScale = b.dataset.scale;
    drawCompareChart();
  };
  $('cmp-detail-close').onclick = closeCompareDetail;
  $('cmp-detail').addEventListener('click', (e) => { if (e.target.id === 'cmp-detail') closeCompareDetail(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('cmp-detail').hidden) closeCompareDetail(); });
  refreshRuns();
}
