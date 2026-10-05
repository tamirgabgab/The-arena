// Rules & model tab: adjacency, attacker selection, prizes, duel model with LaTeX and live preview.
import { state, emit } from './state.js';
import { OFFSETS } from './validate.js';
import { CATEGORICAL, cssVar } from './colors.js';
import { winProb } from './models.js';
import { attachThousands, fmtMoney, readNum, writeNum } from './format.js';

const $ = (id) => document.getElementById(id);
let chart = null;

const ADJ = [
  { id: 'orth', name: 'ישר בלבד (4)' },
  { id: 'both', name: 'ישר + אלכסון (8)' },
];

function adjIcon(mode) {
  const on = new Set(OFFSETS[mode].map(([r, c]) => `${r},${c}`));
  let out = '';
  for (let r = -1; r <= 1; r++)
    for (let c = -1; c <= 1; c++) {
      const x = (c + 1) * 18 + 1, y = (r + 1) * 18 + 1;
      const center = r === 0 && c === 0, nb = on.has(`${r},${c}`);
      const style = center ? 'fill:var(--ink)' : nb ? 'fill:currentColor' : 'fill:none;stroke:var(--line-strong);stroke-dasharray:2 2';
      out += `<rect x="${x}" y="${y}" width="16" height="16" rx="3" style="${style}"/>`;
      if (nb) out += `<line x1="27" y1="27" x2="${x + 8}" y2="${y + 8}" style="stroke:var(--ink);stroke-width:1.5;opacity:.5"/>`;
    }
  return `<svg viewBox="0 0 56 56" aria-hidden="true">${out}</svg>`;
}

const model = () => state.models.find((m) => m.id === state.model) || state.models[0];

function bindPair(rangeEl, numEl, get, set) {
  rangeEl.value = get();
  numEl.value = get();
  rangeEl.oninput = () => { numEl.value = rangeEl.value; set(+rangeEl.value); };
  numEl.onchange = () => {
    const v = Math.min(+numEl.max || Infinity, Math.max(+numEl.min || 0, +numEl.value));
    numEl.value = v; rangeEl.value = v; set(v);
  };
}

export function initRules() {
  // adjacency
  $('adj-choices').innerHTML = ADJ.map((a) => `<button data-adj="${a.id}">${adjIcon(a.id)}${a.name}</button>`).join('');
  $('adj-choices').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.adjacency = b.dataset.adj;
    emit('rules');
    emit('board');
  };

  // attacker selection
  for (const el of document.querySelectorAll('input[name=sel]')) {
    el.onchange = () => { state.selection = el.value; emit('rules'); };
  }

  // prizes
  $('in-prize-every').onchange = (e) => {
    state.prizeEvery = Math.max(2, Math.round(+e.target.value) || 2);
    emit('rules');
  };
  $('chk-prize-off').onchange = (e) => { state.prizeOff = e.target.checked; emit('rules'); };
  for (const [id, key] of [['in-small', 'smallPrize'], ['in-big', 'bigPrize']]) {
    attachThousands($(id));
    $(id).onchange = (e) => {
      const v = readNum(e.target);
      state[key] = Number.isFinite(v) ? v : 0;
      emit('rules');
    };
  }

  // model
  $('model-select').innerHTML = state.models.map((m) => `<option value="${m.id}">${m.name}</option>`).join('');
  $('model-select').onchange = (e) => {
    state.model = e.target.value;
    state.modelParam = model().param.default;
    emit('rules');
  };
  bindPair($('in-luck'), $('num-luck'), () => state.luck, (v) => { state.luck = v; emit('rules'); });
  renderLuckFormula();
}

function renderLuckFormula() {
  const tex = String.raw`f_{\text{final}}=(1-\lambda)\,f(p_1,p_2)+\tfrac{\lambda}{2}`;
  if (typeof katex !== 'undefined') katex.render(tex, $('luck-formula'), { throwOnError: false, displayMode: false });
  else $('luck-formula').textContent = tex;
}

/** Sync all inputs of the tab with state (called on every state change). */
export function syncRules() {
  for (const b of $('adj-choices').children) b.classList.toggle('active', b.dataset.adj === state.adjacency);
  for (const el of document.querySelectorAll('input[name=sel]')) el.checked = el.value === state.selection;
  $('in-prize-every').value = state.prizeEvery;
  $('in-prize-every').disabled = state.prizeOff;
  $('chk-prize-off').checked = state.prizeOff;
  writeNum($('in-small'), state.smallPrize);
  $('in-small').disabled = state.prizeOff;
  writeNum($('in-big'), state.bigPrize);
  $('in-luck').value = state.luck;
  $('num-luck').value = state.luck;

  const n = state.active.reduce((s, v) => s + (v ? 1 : 0), 0);
  const nPrize = state.prizeOff || n < 3 ? 0 : Math.floor((n - 3) / (state.prizeEvery - 1));
  $('prize-hint').textContent = n >= 2
    ? `במפה הנוכחית: ${n} מתמודדים → ${n - 2} הדחות, ${nPrize} קרבות על פרס קטן (${fmtMoney(nPrize * state.smallPrize)} סה״כ) וגמר אחד על ${fmtMoney(state.bigPrize)}.`
    : '';

  const m = model();
  if (!m) return;
  $('model-select').value = m.id;
  if (typeof katex !== 'undefined') katex.render(m.latex, $('model-formula'), { throwOnError: false, displayMode: true });
  else $('model-formula').textContent = m.latex;
  $('model-desc').textContent = m.description;
  $('model-param-label').textContent = `חדות ${m.param.symbol}`;
  const r = $('in-mparam'), num = $('num-mparam');
  for (const el of [r, num]) Object.assign(el, { min: m.param.min, max: m.param.max, step: m.param.step });
  bindPair(r, num, () => state.modelParam, (v) => { state.modelParam = v; emit('rules'); });
  drawModelChart();
}

function drawModelChart() {
  if (typeof Chart === 'undefined') return;
  const xs = Array.from({ length: 101 }, (_, i) => i / 100);
  const p2s = [0.2, 0.5, 0.8];
  const datasets = p2s.map((p2, j) => ({
    label: `p₂ = ${p2}`,
    data: xs.map((x) => ({ x, y: winProb(state.model, x, p2, state.modelParam, state.luck) })),
    borderColor: CATEGORICAL[j], backgroundColor: CATEGORICAL[j], borderWidth: 2, pointRadius: 0, tension: 0,
  }));
  const ink2 = cssVar('--ink-2'), grid = cssVar('--line');
  const options = {
    responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', rtl: true, labels: { color: ink2, boxWidth: 12, boxHeight: 2 } },
      tooltip: {
        rtl: true,
        callbacks: {
          title: (items) => `p₁ = ${items[0].parsed.x.toFixed(2)}`,
          label: (item) => `${item.dataset.label}: f = ${item.parsed.y.toFixed(3)}`,
        },
      },
    },
    scales: {
      x: { type: 'linear', min: 0, max: 1, title: { display: true, text: 'p₁ (יכולת התוקף)', color: ink2 }, ticks: { color: ink2 }, grid: { color: grid } },
      y: { min: 0, max: 1, title: { display: true, text: 'f – הסתברות ניצחון', color: ink2 }, ticks: { color: ink2 }, grid: { color: grid } },
    },
  };
  if (chart) {
    chart.data.datasets = datasets;
    chart.update();
  } else {
    chart = new Chart($('model-chart'), { type: 'line', data: { datasets }, options });
  }
}
