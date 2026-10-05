// Per-contestant detail modal: PMF / CDF histogram, table, statistics and range probability.
import { state } from './state.js';
import { cssVar } from './colors.js';
import { attachThousands, fmtInt, fmtMoney, fmtPct, readNum, writeNum } from './format.js';

const $ = (id) => document.getElementById(id);
let chart = null;
let current = null;
let kind = 'pmf';
let scale = 'nozero';     // 'nozero' | 'log' | 'linear'
let conditional = false;  // with 'nozero': renormalize by P(X > 0)
try { scale = localStorage.getItem('arena-scale') || scale; } catch { /* storage unavailable */ }

const gcd = (a, b) => { a = Math.round(Math.abs(a)); b = Math.round(Math.abs(b)); while (b) [a, b] = [b, a % b]; return a; };

export function initDetail() {
  $('detail-close').onclick = closeDetail;
  $('detail').addEventListener('click', (e) => { if (e.target.id === 'detail') closeDetail(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('detail').hidden) closeDetail(); });
  $('dist-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    kind = b.dataset.kind;
    for (const x of $('dist-seg').children) x.classList.toggle('active', x === b);
    drawChart();
  });
  $('scale-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    scale = b.dataset.scale;
    try { localStorage.setItem('arena-scale', scale); } catch { /* storage unavailable */ }
    if (chart) { chart.destroy(); chart = null; }  // axis type changes need a fresh chart
    drawChart();
  });
  $('chk-cond').onchange = (e) => { conditional = e.target.checked; drawChart(); };
  const onSlider = (which) => () => {
    let lo = +$('rng-lo').value, hi = +$('rng-hi').value;
    if (lo > hi) { if (which === 'lo') hi = lo; else lo = hi; }
    setRange(lo, hi);
  };
  $('rng-lo').oninput = onSlider('lo');
  $('rng-hi').oninput = onSlider('hi');
  const onNum = () => {
    let lo = readNum($('num-lo')), hi = readNum($('num-hi'));
    if (!Number.isFinite(lo)) lo = 0;
    if (!Number.isFinite(hi)) hi = lo;
    setRange(Math.min(lo, hi), Math.max(lo, hi));
  };
  for (const id of ['num-lo', 'num-hi']) {
    attachThousands($(id));
    $(id).onchange = onNum;
  }
}

export function openDetail(i) {
  const res = state.results;
  const pl = res.players[i];
  current = { pl, res, lo: 0, hi: pl.maxAmount };
  $('detail-title').textContent = `מתמודד בשורה ${pl.r + 1}, עמודה ${pl.c + 1}`;
  $('detail-sub').textContent = `יכולת p = ${pl.p.toFixed(2)} · אגרסיביות a = ${pl.a.toFixed(2)} · ${fmtInt(pl.n)} סימולציות`;

  const tiles = [
    ['רווח ממוצע', fmtMoney(pl.mean), `± ${fmtMoney(1.96 * pl.se)} (95%)`],
    ['סטיית תקן', fmtMoney(pl.std)],
    ['חציון', fmtMoney(pl.median)],
    ['אחוזון 10', fmtMoney(pl.p10)],
    ['אחוזון 90', fmtMoney(pl.p90)],
    ['P(פרס קטן ≥ 1)', fmtPct(pl.pSmall)],
    ['P(פרס גדול)', fmtPct(pl.pBig)],
    ['ממוצע פרסים קטנים', pl.avgSmallCount.toFixed(3)],
  ];
  $('detail-tiles').innerHTML = tiles.map(([k, v, sub]) =>
    `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="k" dir="ltr" style="text-align:right">${sub}</div>` : ''}</div>`).join('');

  const step = gcd(res.smallPrize, res.bigPrize) || 1;
  const max = Math.max(pl.maxAmount, step);
  for (const id of ['rng-lo', 'rng-hi']) Object.assign($(id), { min: 0, max, step });

  $('detail').hidden = false;
  setRange(0, pl.maxAmount);
}

function closeDetail() {
  $('detail').hidden = true;
  chart?.destroy();
  chart = null;
}

function setRange(lo, hi) {
  current.lo = lo;
  current.hi = hi;
  $('rng-lo').value = lo;
  $('rng-hi').value = hi;
  writeNum($('num-lo'), lo);
  writeNum($('num-hi'), hi);

  const max = +$('rng-hi').max || 1;
  let fill = $('detail').querySelector('.dual-range .fill');
  if (!fill) {
    fill = document.createElement('div');
    fill.className = 'fill';
    $('detail').querySelector('.dual-range').prepend(fill);
  }
  fill.style.left = `${(lo / max) * 100}%`;
  fill.style.width = `${((Math.min(hi, max) - lo) / max) * 100}%`;

  const { pl } = current;
  let cnt = 0;
  for (const e of pl.entries) if (e.amount >= lo && e.amount <= hi) cnt += e.count;
  $('range-result').innerHTML =
    `<span dir="ltr">P(${fmtMoney(lo)} ≤ X ≤ ${fmtMoney(hi)})</span> = <b>${fmtPct(cnt / pl.n)}</b>
     <span class="muted">(${fmtInt(cnt)} מתוך ${fmtInt(pl.n)} סימולציות)</span>`;
  drawTable();
  drawChart();
}

function drawTable() {
  const { pl, lo, hi } = current;
  let cum = 0;
  $('detail-tbody').innerHTML = pl.entries.map((e) => {
    cum += e.count;
    const inR = e.amount >= lo && e.amount <= hi ? ' class="in-range"' : '';
    return `<tr${inR}><td class="num">${fmtMoney(e.amount)}</td><td class="num">${fmtInt(e.count)}</td>
      <td class="num">${fmtPct(e.count / pl.n)}</td><td class="num">${fmtPct(cum / pl.n)}</td></tr>`;
  }).join('');
}

/** Bars to plot under the current kind / scale / conditional settings. */
function chartSeries(pl) {
  const zero = pl.entries.find((e) => e.amount === 0)?.count ?? 0;
  const hideZero = scale === 'nozero';
  const cond = hideZero && conditional && kind === 'pmf';
  const denom = cond ? pl.n - zero : pl.n;
  const rows = [];
  let cum = 0;
  for (const e of pl.entries) {
    cum += e.count;
    if (hideZero && e.amount === 0) continue;
    rows.push({ e, value: ((kind === 'pmf' ? e.count : cum) / denom) * 100 });
  }
  return { rows, zero, cond, pZero: zero / pl.n };
}

function chartNote(pl, s) {
  if (scale === 'nozero') {
    if (!s.rows.length) return 'המתמודד לא זכה בשום סכום באף סימולציה.';
    const base = `<b>₪0</b> (לא זכה בכלום): <b>${fmtPct(s.pZero)}</b> – מוסתר מהגרף כדי שאפשר יהיה לראות את שאר הסכומים.`;
    if (s.cond) return `${base} העמודות מנורמלות: P(סכום | X&gt;0), וסכומן 100%.`;
    if (kind === 'cdf') return `${base} ציר ה-Y מתחיל מ-P(₪0).`;
    return base;
  }
  if (scale === 'log') return 'ציר Y לוגריתמי: כל קו רשת מייצג פי 10, כך שגם הסתברויות זעירות נראות לצד ₪0. שימו לב: הפרשי גובה כאן אינם פרופורציונליים.';
  return '';
}

const pctTick = (v) => {
  const x = +v;
  return x >= 1 ? `${+x.toFixed(1)}%` : `${+x.toPrecision(2)}%`;
};

/** Chart.js y-axis (values in %) for the linear / log / no-₪0 display modes. */
export function percentAxis(scaleMode, kindMode, values, title) {
  const ink2 = cssVar('--ink-2'), grid = cssVar('--line');
  const positive = values.filter((v) => v > 0);
  const minV = positive.length ? Math.min(...positive) : 1;
  let y;
  if (scaleMode === 'log') {
    y = {
      type: 'logarithmic',
      min: 10 ** Math.floor(Math.log10(minV)), max: 100,
      ticks: {
        color: ink2,
        callback: (v) => (Math.abs(Math.log10(v) - Math.round(Math.log10(v))) < 1e-9 ? pctTick(v) : ''),
      },
    };
  } else {
    const zoomCdf = scaleMode === 'nozero' && kindMode === 'cdf';
    y = {
      type: 'linear', beginAtZero: !zoomCdf,
      min: zoomCdf ? Math.floor(minV) : undefined,
      max: kindMode === 'cdf' ? 100 : undefined,
      ticks: { color: ink2, callback: pctTick },
    };
  }
  return Object.assign(y, { grid: { color: grid }, title: { display: true, text: title, color: ink2 } });
}

function drawChart() {
  if (typeof Chart === 'undefined' || !current) return;
  const { pl, lo, hi } = current;
  const s = chartSeries(pl);
  $('cond-wrap').hidden = !(scale === 'nozero' && kind === 'pmf');
  $('chk-cond').checked = conditional;
  for (const x of $('scale-seg').children) x.classList.toggle('active', x.dataset.scale === scale);
  $('chart-note').innerHTML = chartNote(pl, s);

  const accent = cssVar('--accent');
  const data = {
    labels: s.rows.map((r) => fmtMoney(r.e.amount, true)),
    datasets: [{
      data: s.rows.map((r) => r.value),
      backgroundColor: s.rows.map((r) => (r.e.amount >= lo && r.e.amount <= hi ? accent : `${accent}55`)),
      borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 48,
    }],
  };
  const ink2 = cssVar('--ink-2');
  const yTitle = s.cond ? 'הסתברות בהינתן זכייה' : kind === 'pmf' ? 'הסתברות' : 'הסתברות מצטברת';
  const y = percentAxis(scale, kind, s.rows.map((r) => r.value), yTitle);
  const options = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
    plugins: {
      legend: { display: false },
      tooltip: {
        rtl: true, displayColors: false,
        callbacks: {
          title: (items) => fmtMoney(s.rows[items[0].dataIndex].e.amount),
          label: (item) => {
            const e = s.rows[item.dataIndex].e;
            if (kind === 'cdf') return [`P(X ≤ סכום) = ${item.raw.toFixed(3)}%`];
            const lines = [`הסתברות: ${fmtPct(e.count / pl.n)}`, `${fmtInt(e.count)} סימולציות`];
            if (s.cond) lines.splice(1, 0, `בהינתן זכייה: ${item.raw.toFixed(3)}%`);
            return lines;
          },
        },
      },
    },
    scales: {
      x: { ticks: { color: ink2, maxRotation: 0, autoSkip: true }, grid: { display: false }, title: { display: true, text: 'סכום זכייה', color: ink2 } },
      y,
    },
  };
  if (chart) {
    chart.data = data;
    chart.options = options;
    chart.update();
  } else {
    chart = new Chart($('detail-chart'), { type: 'bar', data, options });
  }
}
