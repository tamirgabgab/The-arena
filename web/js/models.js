// JS mirror of arena/engine/duel_models.py, used for the live preview chart.

const ratio = (u, v, z) => {
  if (u <= 0 && v <= 0) return 0.5;
  if (u <= 0) return 0;
  if (v <= 0) return 1;
  const r = z * (Math.log(v) - Math.log(u));
  return r > 700 ? 0 : r < -700 ? 1 : 1 / (1 + Math.exp(r));
};

// Abramowitz–Stegun 7.1.26 (|error| < 1.5e-7), enough for plotting.
function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

const IMPL = {
  power: (p1, p2, z) => ratio(p1, p2, z),
  log5: (p1, p2, z) => ratio(p1 * (1 - p2), p2 * (1 - p1), z),
  logistic: (p1, p2, k) => 1 / (1 + Math.exp(-k * (p1 - p2))),
  probit: (p1, p2, k) => 0.5 * (1 + erf((k * (p1 - p2)) / Math.SQRT2)),
  arctan: (p1, p2, k) => 0.5 + Math.atan(k * (p1 - p2)) / Math.PI,
  linear: (p1, p2, k) => Math.min(1, Math.max(0, 0.5 + 0.5 * k * (p1 - p2))),
  powdiff: (p1, p2, z) => { const d = p1 - p2; return d === 0 ? 0.5 : 0.5 + 0.5 * Math.sign(d) * Math.abs(d) ** z; },
  uniform_noise: (p1, p2, w) => {
    const s = (p1 - p2) / (2 * w);
    if (s >= 1) return 1;
    if (s <= -1) return 0;
    return s >= 0 ? 1 - 0.5 * (1 - s) ** 2 : 0.5 * (1 + s) ** 2;
  },
};

export function winProb(model, p1, p2, param, luck) {
  const f = IMPL[model](p1, p2, param);
  return (1 - luck) * f + 0.5 * luck;
}
