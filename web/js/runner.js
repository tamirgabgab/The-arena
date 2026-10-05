// Runs a simulation over the WebSocket API and reports progress.
import { state, serverConfig } from './state.js';
import { processResults } from './results.js';
import { fmtInt } from './format.js';

const $ = (id) => document.getElementById(id);
let socket = null;

function showProgress(done, total) {
  const pct = total ? (done / total) * 100 : 0;
  $('progress-fill').style.width = `${pct}%`;
  $('progress-pct').textContent = `${pct.toFixed(pct < 100 ? 1 : 0)}%`;
  $('progress-count').textContent = `${fmtInt(done)} / ${fmtInt(total)}`;
}

/**
 * @param hooks {onStart(), onResult(results), onError(message), onEnd()}
 */
export function runSimulation(hooks) {
  if (state.running) return;
  const cfg = serverConfig();
  const snap = {
    rows: state.rows, cols: state.cols,
    active: [...state.active], p: [...state.p], a: [...state.a],
    config: cfg,
  };
  state.running = true;
  $('progress').hidden = false;
  $('btn-cancel').hidden = false;
  showProgress(0, cfg.n_sims);
  hooks.onStart?.();

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/api/run`);
  let finished = false;
  const end = () => {
    if (!state.running) return;
    state.running = false;
    socket = null;
    $('btn-cancel').hidden = true;
    setTimeout(() => { if (!state.running) $('progress').hidden = true; }, 1500);
    hooks.onEnd?.();
  };

  socket.onopen = () => socket.send(JSON.stringify(cfg));
  socket.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'progress') {
      showProgress(msg.done, msg.total);
    } else if (msg.type === 'result') {
      finished = true;
      showProgress(msg.n_sims, msg.requested);
      if (msg.n_sims > 0) hooks.onResult?.(processResults(msg, snap));
      else hooks.onError?.('הסימולציה בוטלה לפני שהושלמה ריצה אחת');
      socket.close();
      end();
    } else if (msg.type === 'error') {
      finished = true;
      hooks.onError?.(msg.message);
      end();
    }
  };
  socket.onerror = () => {
    if (!finished) hooks.onError?.('אין חיבור לשרת הסימולציה – ודאו ש-run.py רץ');
  };
  socket.onclose = end;
}

export function cancelSimulation() {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'cancel' }));
}
