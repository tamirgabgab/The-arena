// Cell-set generators for drawing tools and preset shapes. Cells are flat indices r*cols+c.

export function lineCells(r0, c0, r1, c1, cols) {
  const out = [];
  let dr = Math.abs(r1 - r0), dc = Math.abs(c1 - c0);
  const sr = r0 < r1 ? 1 : -1, sc = c0 < c1 ? 1 : -1;
  let err = dc - dr, r = r0, c = c0;
  for (;;) {
    out.push(r * cols + c);
    if (r === r1 && c === c1) break;
    const e2 = 2 * err;
    if (e2 > -dr) { err -= dr; c += sc; }
    if (e2 < dc) { err += dc; r += sr; }
  }
  return out;
}

export function rectCells(r0, c0, r1, c1, cols) {
  const out = [];
  for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++)
    for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) out.push(r * cols + c);
  return out;
}

/** Filled ellipse inscribed in the bounding box of the two corners. */
export function ellipseCells(r0, c0, r1, c1, cols) {
  const top = Math.min(r0, r1), bottom = Math.max(r0, r1);
  const left = Math.min(c0, c1), right = Math.max(c0, c1);
  const cy = (top + bottom + 1) / 2, cx = (left + right + 1) / 2;
  const ry = (bottom - top + 1) / 2, rx = (right - left + 1) / 2;
  const out = [];
  for (let r = top; r <= bottom; r++)
    for (let c = left; c <= right; c++) {
      const u = (c + 0.5 - cx) / rx, v = (r + 0.5 - cy) / ry;
      if (u * u + v * v <= 1.0001) out.push(r * cols + c);
    }
  return out;
}

export function brushCells(r, c, size, rows, cols) {
  const out = [];
  const lo = -Math.floor((size - 1) / 2), hi = lo + size - 1;
  for (let dr = lo; dr <= hi; dr++)
    for (let dc = lo; dc <= hi; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push(rr * cols + cc);
    }
  return out;
}

/** 4-connected region of cells sharing the clicked cell's active state. */
export function floodRegion(active, rows, cols, r, c) {
  const start = r * cols + c, target = active[start];
  const seen = new Uint8Array(rows * cols);
  const out = [start], stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const k = stack.pop(), kr = (k / cols) | 0, kc = k % cols;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const rr = kr + dr, cc = kc + dc;
      if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
      const j = rr * cols + cc;
      if (!seen[j] && active[j] === target) { seen[j] = 1; out.push(j); stack.push(j); }
    }
  }
  return out;
}

// ---------- presets: (u, v) in [-1, 1] at each cell center ----------
const PRESETS = [
  { id: 'full', name: 'ריבוע מלא', test: () => true },
  { id: 'disk', name: 'עיגול', test: (u, v) => u * u + v * v <= 1.0 },
  { id: 'ring', name: 'טבעת', test: (u, v) => { const d = u * u + v * v; return d <= 1.0 && d >= 0.3; } },
  { id: 'moon', name: 'ירח', test: (u, v) => u * u + v * v <= 1.0 && (u - 0.45) ** 2 + (v + 0.1) ** 2 > 0.55 },
  { id: 'diamond', name: 'יהלום', test: (u, v) => Math.abs(u) + Math.abs(v) <= 1.0 },
  { id: 'cross', name: 'צלב', test: (u, v) => Math.abs(u) <= 0.36 || Math.abs(v) <= 0.36 },
  { id: 'triangle', name: 'משולש', test: (u, v) => Math.abs(u) <= (v + 1) / 2 + 0.06 },
  { id: 'frame', name: 'מסגרת', test: (u, v) => Math.max(Math.abs(u), Math.abs(v)) >= 0.55 },
];
export const presetList = PRESETS;

export function presetMask(id, rows, cols) {
  const preset = PRESETS.find((p) => p.id === id);
  const mask = new Array(rows * cols).fill(0);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const u = ((c + 0.5) / cols) * 2 - 1, v = ((r + 0.5) / rows) * 2 - 1;
      if (preset.test(u, v)) mask[r * cols + c] = 1;
    }
  return largestComponent(mask, rows, cols);
}

/** Keep only the largest 4-connected component, so rasterized shapes never leave stray tips. */
function largestComponent(mask, rows, cols) {
  const seen = new Uint8Array(rows * cols);
  let best = [];
  for (let k = 0; k < mask.length; k++) {
    if (!mask[k] || seen[k]) continue;
    seen[k] = 1;
    const comp = [k], stack = [k];
    while (stack.length) {
      const j = stack.pop(), r = (j / cols) | 0, c = j % cols;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc, i = rr * cols + cc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && mask[i] && !seen[i]) {
          seen[i] = 1; comp.push(i); stack.push(i);
        }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  const out = new Array(mask.length).fill(0);
  for (const k of best) out[k] = 1;
  return out;
}

/** Small SVG thumbnail of a preset, drawn on a 9x9 grid. */
export function presetIcon(id) {
  const n = 9, mask = presetMask(id, n, n), s = 4;
  let rects = '';
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      rects += `<rect x="${c * s}" y="${r * s}" width="${s - 0.6}" height="${s - 0.6}" rx="0.6" fill="${mask[r * n + c] ? 'currentColor' : 'none'}" opacity="${mask[r * n + c] ? 0.85 : 0}"/>`;
  return `<svg viewBox="0 0 ${n * s} ${n * s}" aria-hidden="true">${rects}</svg>`;
}
