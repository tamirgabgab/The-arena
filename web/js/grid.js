// Canvas grid: layout, hi-DPI, pointer -> cell mapping, tooltip and draw scheduling.
// What gets drawn and what pointer input does are supplied by a renderer and a controller.

export class Grid {
  constructor(host, canvas, tooltip) {
    this.host = host;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tooltip = tooltip;
    this.pad = 4;
    this.cs = 40;
    this.rows = 1;
    this.cols = 1;
    this.hover = -1;
    this.dragging = false;
    this.renderer = null;
    this.controller = null;
    this._raf = 0;

    new ResizeObserver(() => this.layout()).observe(host);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e));
    canvas.addEventListener('pointercancel', (e) => this._up(e));
    canvas.addEventListener('pointerleave', () => this._leave());
  }

  setView(renderer, controller) {
    this.renderer = renderer;
    this.controller = controller;
    this.dragging = false;
    this.layout();
  }

  layout() {
    if (!this.renderer) return;
    const { rows, cols } = this.renderer.dims();
    this.rows = rows;
    this.cols = cols;
    const w = this.host.clientWidth - 2 * this.pad;
    const h = this.host.clientHeight - 2 * this.pad;
    this.cs = Math.max(8, Math.min(96, Math.floor(Math.min(w / cols, h / rows))));
    const cssW = this.cs * cols + 2 * this.pad;
    const cssH = this.cs * rows + 2 * this.pad;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.dpr = dpr;
    this.draw();
  }

  cellRect(k) {
    const r = (k / this.cols) | 0, c = k % this.cols;
    return { x: this.pad + c * this.cs, y: this.pad + r * this.cs, r, c };
  }

  cellAt(e, clamp = false) {
    const rect = this.canvas.getBoundingClientRect();
    let c = Math.floor((e.clientX - rect.left - this.pad) / this.cs);
    let r = Math.floor((e.clientY - rect.top - this.pad) / this.cs);
    if (clamp) {
      r = Math.max(0, Math.min(this.rows - 1, r));
      c = Math.max(0, Math.min(this.cols - 1, c));
    } else if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) {
      return null;
    }
    return { r, c, k: r * this.cols + c };
  }

  draw() {
    this._raf = 0;
    if (!this.renderer) return;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.renderer.draw(ctx, this);
    if (this.renderer.animating?.()) this.requestDraw();
  }

  requestDraw() {
    if (!this._raf) this._raf = requestAnimationFrame(() => this.draw());
  }

  // ---------- pointer ----------
  _down(e) {
    if (e.button !== 0 && e.button !== 2) return;
    const cell = this.cellAt(e);
    if (!cell || !this.controller) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.dragging = true;
    this._hideTip();
    this.controller.down?.(cell, e);
    this.requestDraw();
  }

  _move(e) {
    const cell = this.cellAt(e, this.dragging);
    const k = cell ? cell.k : -1;
    if (this.dragging) {
      this.controller?.move?.(cell, e);
    } else {
      this.controller?.hover?.(cell, e);
      this._showTip(k, e);
    }
    if (k !== this.hover || this.dragging) {
      this.hover = k;
      this.requestDraw();
    }
  }

  _up(e) {
    if (!this.dragging) return;
    this.dragging = false;
    this.controller?.up?.(this.cellAt(e, true), e);
    this.requestDraw();
  }

  _leave() {
    if (this.dragging) return;
    this.hover = -1;
    this.controller?.hover?.(null);
    this._hideTip();
    this.requestDraw();
  }

  _showTip(k, e) {
    const html = k >= 0 ? this.renderer?.tooltip?.(k) : null;
    if (!html) return this._hideTip();
    const t = this.tooltip;
    t.innerHTML = html;
    t.hidden = false;
    const pad = 14, w = t.offsetWidth, h = t.offsetHeight;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
  }

  _hideTip() {
    this.tooltip.hidden = true;
  }
}
