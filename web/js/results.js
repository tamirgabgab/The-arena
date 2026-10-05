// Turns the server's counts[player][smallPrizes][wonBig] into per-player distributions and stats.

function quantile(entries, n, q) {
  let cum = 0;
  for (const e of entries) {
    cum += e.count;
    if (cum >= q * n - 1e-9) return e.amount;
  }
  return entries.length ? entries[entries.length - 1].amount : 0;
}

/**
 * @param msg  server "result" message
 * @param snap board snapshot taken when the run started ({rows, cols, p, a, ...})
 */
export function processResults(msg, snap) {
  const { counts, coords, n_sims: n, small_prize: y, big_prize: big } = msg;
  const playerAt = new Int32Array(snap.rows * snap.cols).fill(-1);

  const players = coords.map(([r, c], i) => {
    const k0 = r * snap.cols + c;
    playerAt[k0] = i;
    const dist = new Map();
    let small = 0, bigWins = 0, smallTotal = 0;
    counts[i].forEach((pair, k) => pair.forEach((cnt, b) => {
      if (!cnt) return;
      const amount = k * y + b * big;
      dist.set(amount, (dist.get(amount) || 0) + cnt);
      if (k > 0) small += cnt;
      if (b) bigWins += cnt;
      smallTotal += k * cnt;
    }));
    const entries = [...dist].sort((u, v) => u[0] - v[0]).map(([amount, count]) => ({ amount, count }));
    let mean = 0;
    for (const e of entries) mean += e.amount * e.count;
    mean /= n;
    let variance = 0;
    for (const e of entries) variance += (e.amount - mean) ** 2 * e.count;
    variance /= n;
    return {
      i, r, c, p: snap.p[k0], a: snap.a[k0],
      entries, n, mean, variance, std: Math.sqrt(variance), se: Math.sqrt(variance / n),
      median: quantile(entries, n, 0.5), p10: quantile(entries, n, 0.1), p90: quantile(entries, n, 0.9),
      pSmall: small / n, pBig: bigWins / n, avgSmallCount: smallTotal / n,
      maxAmount: entries.length ? entries[entries.length - 1].amount : 0,
    };
  });

  const metricMax = {
    mean: Math.max(...players.map((p) => p.mean)),
    small: Math.max(...players.map((p) => p.pSmall)),
    big: Math.max(...players.map((p) => p.pBig)),
  };

  return {
    ...snap, players, playerAt, metricMax, n,
    raw: { snap, msg },   // what gets saved; reprocessed with processResults on load
    savedId: null, name: null,
    requested: msg.requested, cancelled: msg.cancelled, seed: msg.seed,
    elapsed: msg.elapsed, threads: msg.threads, smallPrize: y, bigPrize: big,
  };
}

export function resultsCsv(res) {
  const head = ['row', 'col', 'p', 'a', 'mean', 'std', 'median', 'p10', 'p90', 'P_small_at_least_1', 'P_big', 'avg_small_prizes'];
  const lines = [head.join(',')];
  for (const pl of res.players) {
    lines.push([pl.r + 1, pl.c + 1, pl.p, pl.a, pl.mean.toFixed(2), pl.std.toFixed(2), pl.median, pl.p10, pl.p90,
      pl.pSmall.toFixed(6), pl.pBig.toFixed(6), pl.avgSmallCount.toFixed(4)].join(','));
  }
  return lines.join('\n');
}
