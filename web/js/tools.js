// Pointer controllers: map painting, player selection / value painting, results clicks.
import { state, emit, pushUndo } from './state.js';
import { brushCells, ellipseCells, floodRegion, lineCells, rectCells } from './shapes.js';

/** Shared preview of what the current gesture would change; read by the renderer. */
export const ghost = { cells: null, value: 1, rect: null };

const clearGhost = () => { ghost.cells = null; ghost.rect = null; };
const isErase = (e) => e && (e.button === 2 || e.shiftKey);

/** Cells covered by dragging a brush from `from` to `to` (no gaps on fast moves). */
function strokeCells(from, to, size) {
  const out = new Set();
  for (const k of lineCells(from.r, from.c, to.r, to.c, state.cols)) {
    const r = (k / state.cols) | 0, c = k % state.cols;
    for (const j of brushCells(r, c, size, state.rows, state.cols)) out.add(j);
  }
  return [...out];
}

// ---------------- map ----------------
export function mapController() {
  let anchor = null, last = null, value = 1;

  const shapeCells = (a, b) => {
    const { cols } = state;
    switch (state.mapTool) {
      case 'rect': return rectCells(a.r, a.c, b.r, b.c, cols);
      case 'ellipse': return ellipseCells(a.r, a.c, b.r, b.c, cols);
      case 'line': return lineCells(a.r, a.c, b.r, b.c, cols);
      default: return [];
    }
  };
  const paint = (cells) => {
    let changed = false;
    for (const k of cells) if (state.active[k] !== value) { state.active[k] = value; changed = true; }
    if (changed) emit('board');
  };

  return {
    down(cell, e) {
      const tool = state.mapTool;
      value = tool === 'eraser' || isErase(e) ? 0 : 1;
      if (tool === 'brush' || tool === 'eraser') {
        pushUndo();
        last = cell;
        paint(brushCells(cell.r, cell.c, state.brushSize, state.rows, state.cols));
        ghost.cells = null;
      } else if (tool === 'fill') {
        pushUndo();
        value = state.active[cell.k] ? 0 : 1;
        paint(floodRegion(state.active, state.rows, state.cols, cell.r, cell.c));
        clearGhost();
      } else {
        anchor = cell;
        ghost.cells = shapeCells(anchor, cell);
        ghost.value = value;
      }
    },
    move(cell) {
      if (!cell) return;
      const tool = state.mapTool;
      if (tool === 'brush' || tool === 'eraser') {
        paint(strokeCells(last, cell, state.brushSize));
        last = cell;
      } else if (anchor) {
        ghost.cells = shapeCells(anchor, cell);
      }
    },
    up() {
      if (anchor && ghost.cells) {
        pushUndo();
        paint(ghost.cells);
      }
      anchor = null;
      last = null;
      clearGhost();
    },
    hover(cell, e) {
      if (!cell) return clearGhost();
      const tool = state.mapTool;
      ghost.value = tool === 'eraser' || isErase(e) ? 0 : 1;
      if (tool === 'brush' || tool === 'eraser') {
        ghost.cells = brushCells(cell.r, cell.c, state.brushSize, state.rows, state.cols);
      } else if (tool === 'fill') {
        ghost.value = state.active[cell.k] ? 0 : 1;
        ghost.cells = floodRegion(state.active, state.rows, state.cols, cell.r, cell.c);
      } else {
        ghost.cells = [cell.k];
      }
    },
  };
}

// ---------------- players ----------------
export function playersController(getPaintValues) {
  let anchor = null, last = null, dragged = false, additive = false, value = 1;

  const setSel = (cells, v) => {
    for (const k of cells) if (state.active[k]) state.sel[k] = v;
  };
  const paintValues = (cells) => {
    const { p, a, useP, useA } = getPaintValues();
    let changed = false;
    for (const k of cells) {
      if (!state.active[k]) continue;
      if (useP && state.p[k] !== p) { state.p[k] = p; changed = true; }
      if (useA && state.a[k] !== a) { state.a[k] = a; changed = true; }
    }
    if (changed) emit('players');
  };

  return {
    down(cell, e) {
      const tool = state.playerTool;
      value = isErase(e) ? 0 : 1;
      last = cell;
      if (tool === 'select') {
        anchor = cell;
        dragged = false;
        additive = e.shiftKey || e.ctrlKey || e.metaKey;
        ghost.rect = [cell, cell];
      } else if (tool === 'selbrush') {
        setSel(brushCells(cell.r, cell.c, state.brushSize, state.rows, state.cols), value);
        emit('selection');
      } else if (tool === 'paint') {
        pushUndo();
        paintValues(brushCells(cell.r, cell.c, state.brushSize, state.rows, state.cols));
      }
    },
    move(cell) {
      if (!cell) return;
      const tool = state.playerTool;
      if (tool === 'select' && anchor) {
        if (cell.k !== anchor.k) dragged = true;
        ghost.rect = [anchor, cell];
      } else if (tool === 'selbrush') {
        setSel(strokeCells(last, cell, state.brushSize), value);
        emit('selection');
      } else if (tool === 'paint') {
        paintValues(strokeCells(last, cell, state.brushSize));
      }
      last = cell;
    },
    up(cell, e) {
      if (state.playerTool === 'select' && anchor) {
        if (!dragged) {
          const k = anchor.k;
          if (additive) {
            if (state.active[k]) state.sel[k] ^= 1;
          } else {
            const only = state.sel[k] && state.sel.reduce((s, v) => s + v, 0) === 1;
            state.sel.fill(0);
            if (!only && state.active[k]) state.sel[k] = 1;
          }
        } else {
          if (!additive && !isErase(e)) state.sel.fill(0);
          setSel(rectCells(anchor.r, anchor.c, cell.r, cell.c, state.cols), isErase(e) ? 0 : 1);
        }
        emit('selection');
      }
      anchor = null;
      last = null;
      clearGhost();
    },
    hover(cell) {
      const tool = state.playerTool;
      if (!cell || tool === 'select') return clearGhost();
      ghost.cells = brushCells(cell.r, cell.c, state.brushSize, state.rows, state.cols);
    },
  };
}

// ---------------- results ----------------
export function resultsController(openDetail) {
  return {
    down(cell) {
      const res = state.results;
      if (!res || !cell) return;
      const i = res.playerAt[cell.k];
      if (i >= 0) openDetail(i);
    },
  };
}
