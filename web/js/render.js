// Grid renderers for the three views: map editing, contestants, results heat map.
import { state } from './state.js';
import { BLUE, ISLANDS, ORANGE, cssVar, inkOn, rampColor } from './colors.js';
import { ghost } from './tools.js';
import { fmtMoney, fmtPct } from './format.js';

function cellBox(g, k) {
  const { x, y, r, c } = g.cellRect(k);
  const gap = Math.max(1, Math.round(g.cs * 0.06));
  const s = g.cs - gap;
  return { x: x + gap / 2, y: y + gap / 2, s, r, c, rad: Math.min(7, g.cs * 0.16) };
}

function box(ctx, b, fill, stroke, lw = 1) {
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.s, b.s, b.rad);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

function outline(ctx, b, color, lw) {
  ctx.beginPath();
  ctx.roundRect(b.x + lw / 2, b.y + lw / 2, b.s - lw, b.s - lw, Math.max(1, b.rad - lw / 2));
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.stroke();
}

/** An empty (inactive) cell: soft orange on the editing views, neutral gray on the heat map. */
function ground(ctx, b, t, neutral = false) {
  box(ctx, b, neutral ? t.ground : t.inactive);
  ctx.setLineDash([3, 3]);
  outline(ctx, b, neutral ? t.groundLine : t.inactiveLine, neutral ? 1 : 1.5);
  ctx.setLineDash([]);
}

/** Color per island: the largest island keeps the active blue, the rest get distinct hues. */
export function islandColors(v, activeColor) {
  return islandRanks(v).map((rank) => (rank === 0 ? activeColor : ISLANDS[(rank - 1) % ISLANDS.length]));
}

/** rank[component] = 0 for the largest island, 1 for the next, ... */
export function islandRanks(v) {
  const order = v.compSizes.map((s, i) => [s, i]).sort((x, y) => y[0] - x[0]).map(([, i]) => i);
  const ranks = new Array(order.length);
  order.forEach((i, rank) => { ranks[i] = rank; });
  return ranks;
}

const tokens = () => ({
  ground: cssVar('--ground'), groundLine: cssVar('--ground-line'), active: cssVar('--cell-active'),
  inactive: cssVar('--inactive'), inactiveLine: cssVar('--inactive-line'),
  accent: cssVar('--accent'), danger: cssVar('--danger'), ink: cssVar('--ink'), sel: cssVar('--sel'),
  aBar: cssVar('--a-bar'), aTrack: cssVar('--a-track'), surface: cssVar('--surface'),
});

function drawGhostCells(ctx, g, t) {
  if (!ghost.cells) return;
  ctx.globalAlpha = 0.55;
  for (const k of ghost.cells) {
    const b = cellBox(g, k);
    box(ctx, b, ghost.value ? t.accent : t.danger);
  }
  ctx.globalAlpha = 1;
}

function drawHover(ctx, g, t) {
  if (g.hover < 0 || g.dragging) return;
  outline(ctx, cellBox(g, g.hover), t.ink, 2);
}

// ---------------- map ----------------
export function mapRenderer() {
  return {
    dims: () => ({ rows: state.rows, cols: state.cols }),
    animating: () => state.validation && state.validation.nIsolated > 0,
    draw(ctx, g) {
      const t = tokens(), v = state.validation;
      const split = v && v.compSizes.length > 1;
      const islands = split ? islandColors(v, t.active) : null;
      const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 220);
      for (let k = 0; k < state.rows * state.cols; k++) {
        const b = cellBox(g, k);
        if (!state.active[k]) { ground(ctx, b, t); continue; }
        const fill = v?.isolated[k] ? t.danger : split ? islands[v.comp[k]] : t.active;
        box(ctx, b, fill);
      }
      drawGhostCells(ctx, g, t);
      if (v && v.nIsolated) {
        for (let k = 0; k < v.isolated.length; k++) {
          if (!v.isolated[k]) continue;
          const b = cellBox(g, k);
          ctx.globalAlpha = pulse;
          outline(ctx, b, t.ink, Math.max(2.5, g.cs * 0.09));
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#fff';
          ctx.font = `700 ${Math.round(b.s * 0.5)}px Heebo, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('!', b.x + b.s / 2, b.y + b.s / 2 + 1);
        }
      }
      drawHover(ctx, g, t);
    },
    tooltip(k) {
      const r = (k / state.cols) | 0, c = k % state.cols;
      const v = state.validation;
      let html = `משבצת <b>(${r + 1}, ${c + 1})</b> · ${state.active[k] ? 'פעילה' : 'ריקה'}`;
      if (v?.isolated[k]) html += '<br><b>⚠ אין לה אף שכן</b>';
      else if (state.active[k] && v?.compSizes.length > 1) html += `<br>אי מס׳ ${islandRanks(v)[v.comp[k]] + 1} (${v.compSizes[v.comp[k]]} משבצות)`;
      return html;
    },
  };
}

// ---------------- players ----------------
function drawPlayerCell(ctx, b, p, a, t, cs) {
  const fill = rampColor(BLUE, p);
  box(ctx, b, fill);
  const inset = Math.max(2, b.s * 0.12);
  const bh = Math.max(3, Math.round(b.s * 0.13));
  const bx = b.x + inset, by = b.y + b.s - inset - bh, bw = b.s - 2 * inset;
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, bh / 2); ctx.fillStyle = t.aTrack; ctx.fill();
  if (a > 0) {
    ctx.beginPath(); ctx.roundRect(bx, by, Math.max(bh, bw * a), bh, bh / 2); ctx.fillStyle = t.aBar; ctx.fill();
  }
  if (cs >= 30) {
    ctx.fillStyle = inkOn(fill);
    ctx.font = `600 ${Math.round(Math.min(16, cs * 0.25))}px Heebo, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.toFixed(2), b.x + b.s / 2, b.y + (b.s - bh - inset) / 2 + 1);
  }
}

export function playersRenderer() {
  return {
    dims: () => ({ rows: state.rows, cols: state.cols }),
    draw(ctx, g) {
      const t = tokens();
      const editing = state.tab === 'players';
      for (let k = 0; k < state.rows * state.cols; k++) {
        const b = cellBox(g, k);
        if (!state.active[k]) { ground(ctx, b, t); continue; }
        drawPlayerCell(ctx, b, state.p[k], state.a[k], t, g.cs);
      }
      if (editing) {
        const lw = Math.max(2.5, g.cs * 0.08);
        for (let k = 0; k < state.sel.length; k++) {
          if (!state.sel[k]) continue;
          const b = cellBox(g, k);
          outline(ctx, b, t.surface, lw + 2);
          outline(ctx, b, t.sel, lw);
        }
        if (ghost.cells) {
          for (const k of ghost.cells) if (state.active[k]) outline(ctx, cellBox(g, k), t.ink, 2);
        }
        if (ghost.rect) {
          const [a, b] = ghost.rect;
          const x0 = g.pad + Math.min(a.c, b.c) * g.cs, y0 = g.pad + Math.min(a.r, b.r) * g.cs;
          const w = (Math.abs(a.c - b.c) + 1) * g.cs, h = (Math.abs(a.r - b.r) + 1) * g.cs;
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = t.sel; ctx.lineWidth = 2;
          ctx.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
          ctx.setLineDash([]);
        }
      }
      drawHover(ctx, g, t);
    },
    tooltip(k) {
      const r = (k / state.cols) | 0, c = k % state.cols;
      if (!state.active[k]) return `משבצת <b>(${r + 1}, ${c + 1})</b> · ריקה`;
      return `מתמודד <b>(${r + 1}, ${c + 1})</b><br>יכולת p = <b>${state.p[k].toFixed(2)}</b><br>אגרסיביות a = <b>${state.a[k].toFixed(2)}</b>`;
    },
  };
}

// ---------------- results ----------------
export function metricValue(pl, metric) {
  return metric === 'small' ? pl.pSmall : metric === 'big' ? pl.pBig : pl.mean;
}

export function resultsRenderer() {
  return {
    dims: () => (state.results ? { rows: state.results.rows, cols: state.results.cols } : { rows: state.rows, cols: state.cols }),
    draw(ctx, g) {
      const t = tokens(), res = state.results;
      if (!res) return;
      const max = res.metricMax[state.metric] || 1;
      for (let k = 0; k < res.rows * res.cols; k++) {
        const b = cellBox(g, k);
        const i = res.playerAt[k];
        if (i < 0) { ground(ctx, b, t, true); continue; }
        const pl = res.players[i];
        const fill = rampColor(ORANGE, metricValue(pl, state.metric) / max);
        box(ctx, b, fill);
        const ink = inkOn(fill);
        ctx.fillStyle = ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const cx = b.x + b.s / 2;
        if (g.cs >= 62) {
          ctx.font = `700 ${Math.round(Math.min(17, g.cs * 0.21))}px Heebo, sans-serif`;
          ctx.fillText(fmtMoney(pl.mean, true), cx, b.y + b.s * 0.3);
          ctx.font = `500 ${Math.round(Math.min(12.5, g.cs * 0.15))}px Heebo, sans-serif`;
          ctx.globalAlpha = 0.9;
          ctx.fillText(`ק ${fmtPct(pl.pSmall, 1)}`, cx, b.y + b.s * 0.58);
          ctx.fillText(`ג ${fmtPct(pl.pBig, 1)}`, cx, b.y + b.s * 0.8);
          ctx.globalAlpha = 1;
        } else if (g.cs >= 34) {
          ctx.font = `600 ${Math.round(g.cs * 0.24)}px Heebo, sans-serif`;
          const txt = state.metric === 'mean' ? fmtMoney(pl.mean, true) : fmtPct(metricValue(pl, state.metric), 0);
          ctx.fillText(txt, cx, b.y + b.s / 2 + 1);
        }
      }
      drawHover(ctx, g, t);
    },
    tooltip(k) {
      const res = state.results;
      const i = res?.playerAt[k] ?? -1;
      if (i < 0) return null;
      const pl = res.players[i];
      return `מתמודד <b>(${pl.r + 1}, ${pl.c + 1})</b> · p=${pl.p.toFixed(2)}, a=${pl.a.toFixed(2)}<br>
        רווח ממוצע: <b>${fmtMoney(pl.mean)}</b><br>
        P(פרס קטן ≥ 1): <b>${fmtPct(pl.pSmall, 2)}</b><br>
        P(פרס גדול): <b>${fmtPct(pl.pBig, 2)}</b><br><span style="opacity:.7">לחצו לפרטים</span>`;
    },
  };
}
