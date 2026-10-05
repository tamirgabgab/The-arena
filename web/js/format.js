const NUM = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });

export function fmtMoney(v, compact = false) {
  if (!compact) return `₪${NUM.format(Math.round(v))}`;
  const a = Math.abs(v);
  if (a >= 1e6) return `₪${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `₪${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return `₪${Math.round(v)}`;
}

export const fmtPct = (x, digits = 3) => `${(x * 100).toFixed(digits)}%`;
export const fmtInt = (n) => NUM.format(n);

// ---------- integer text inputs with live thousands separators (1,234,567) ----------
const GROUP = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const readNum = (el) => {
  const digits = el.value.replace(/[^\d]/g, '');
  return digits === '' ? NaN : Number(digits);
};

export const writeNum = (el, v) => { el.value = Number.isFinite(v) ? GROUP.format(Math.round(v)) : ''; };

/** Re-group digits while typing, keeping the caret after the same digit. */
export function attachThousands(el) {
  el.addEventListener('input', () => {
    const caret = el.selectionStart ?? el.value.length;
    const digitsBefore = el.value.slice(0, caret).replace(/\D/g, '').length;
    const digits = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    const out = digits ? GROUP.format(Number(digits)) : '';
    el.value = out;
    let i = 0;
    for (let seen = 0; i < out.length && seen < digitsBefore; i++) if (/\d/.test(out[i])) seen++;
    el.setSelectionRange(i, i);
  });
}
