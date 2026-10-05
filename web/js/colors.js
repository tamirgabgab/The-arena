// Sequential ramps (light -> dark) and helpers.

// Skill p: blue ramp.
export const BLUE = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5',
  '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
// Results heatmap: orange ramp (second sequential context).
export const ORANGE = ['#fdeee6', '#fbd9c6', '#f8c1a3', '#f4a67e', '#f08a5a', '#eb6834',
  '#d4572a', '#b94820', '#9b3b19', '#7c2f14', '#5e230f'];
// Categorical order (chart series).
export const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
// Extra islands on a split map. Island 1 (the largest) keeps the "active" blue; blue, orange
// (inactive) and red (isolated) are reserved, so they are not used here.
export const ISLANDS = ['#1baf7a', '#4a3aa7', '#e87ba4', '#eda100', '#008300', '#8c6d4f'];

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export function rampColor(ramp, t) {
  t = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const x = t * (ramp.length - 1), i = Math.min(ramp.length - 2, Math.floor(x)), f = x - i;
  const a = hexToRgb(ramp[i]), b = hexToRgb(ramp[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Readable ink (near-black or white) for text on a given rgb()/hex fill. */
export function inkOn(color) {
  const m = color.startsWith('#') ? hexToRgb(color) : color.match(/\d+/g).map(Number);
  const lin = m.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return L > 0.36 ? '#0b0b0b' : '#ffffff';
}

export const rampCss = (ramp) => `linear-gradient(to right, ${ramp.join(',')})`;

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
