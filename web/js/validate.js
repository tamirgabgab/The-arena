// Board validation (mirrors arena/engine/board.py): isolated cells and connected components.

const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
export const OFFSETS = { orth: ORTH, both: [...ORTH, ...DIAG] };

export function validateBoard(rows, cols, active, adjacency) {
  const offs = OFFSETS[adjacency];
  const n = rows * cols;
  const isolated = new Uint8Array(n);
  const comp = new Int32Array(n).fill(-1);
  const compSizes = [];
  let nActive = 0, nIsolated = 0;

  const forNeighbors = (k, fn) => {
    const r = (k / cols) | 0, c = k % cols;
    for (const [dr, dc] of offs) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && active[rr * cols + cc]) fn(rr * cols + cc);
    }
  };

  for (let k = 0; k < n; k++) {
    if (!active[k]) continue;
    nActive++;
    let has = false;
    forNeighbors(k, () => { has = true; });
    if (!has) { isolated[k] = 1; nIsolated++; }
  }

  const queue = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    if (!active[k] || comp[k] >= 0) continue;
    const id = compSizes.length;
    let head = 0, tail = 0;
    queue[tail++] = k; comp[k] = id;
    while (head < tail) {
      forNeighbors(queue[head++], (j) => {
        if (comp[j] < 0) { comp[j] = id; queue[tail++] = j; }
      });
    }
    compSizes.push(tail);
  }

  const errors = [];
  if (nActive < 2) errors.push('נדרשות לפחות 2 משבצות פעילות');
  if (nIsolated) errors.push(`${nIsolated} ${nIsolated === 1 ? 'משבצת' : 'משבצות'} ללא אף שכן`);
  if (compSizes.length > 1) errors.push(`המפה מפוצלת ל-${compSizes.length} איים נפרדים – כל המתמודדים חייבים להיות מחוברים`);
  return { ok: errors.length === 0, errors, isolated, nIsolated, comp, compSizes, nActive };
}
