"""Monte Carlo engine for "The Arena".

Game state per simulation (N = number of players, one per active cell at start):
  * adj      - uint64 bitset (N x ceil(N/64)): adj[i] = current opponents of player i.
               When w absorbs l, adj[w] |= adj[l] and every neighbor of l re-points
               to w - O(N/64 + deg(l)) per duel, independent of how many cells w owns.
  * alive / single - swap-remove lists (with position arrays) for O(1) random draws.
  * W        - precomputed win matrix, so the duel model is never evaluated in the loop.

Results are accumulated as counts[player, small_prizes_won, won_big_prize], which
fully determines each player's winnings distribution without storing any run.
"""
import math
import os
import time

import numpy as np
from numba import get_num_threads, njit, prange

from . import board
from .duel_models import MODEL_INDEX, build_win_matrix
from .rng import next_float, next_int, seed_state

_U = np.uint64
_ONE = _U(1)
_M1 = _U(0x5555555555555555)
_M2 = _U(0x3333333333333333)
_M4 = _U(0x0F0F0F0F0F0F0F0F)
_H01 = _U(0x0101010101010101)

SELECTION_MODES = {"all": 0, "singles": 1}


@njit(cache=True, inline="always")
def _popcount(x):
    x = x - ((x >> _ONE) & _M1)
    x = (x & _M2) + ((x >> _U(2)) & _M2)
    x = (x + (x >> _U(4))) & _M4
    return int((x * _H01) >> _U(56))


@njit(cache=True, inline="always")
def _ctz(x):
    """Index of the lowest set bit (x != 0)."""
    return _popcount((x & (~x + _ONE)) - _ONE)


@njit(cache=True, inline="always")
def _bit(j):
    return _ONE << _U(j & 63)


@njit(cache=True)
def _random_neighbor(adj, i, words, s):
    total = 0
    for q in range(words):
        total += _popcount(adj[i, q])
    r = next_int(s, total)
    for q in range(words):
        x = adj[i, q]
        c = _popcount(x)
        if r < c:
            for _ in range(r):
                x &= x - _ONE
            return (q << 6) + _ctz(x)
        r -= c
    return -1


@njit(cache=True)
def _absorb(adj, w, l, words):
    """Player w takes over player l: merge neighborhoods and re-point l's neighbors."""
    for q in range(words):
        x = adj[l, q]
        adj[w, q] |= x
        adj[l, q] = _U(0)
        while x != _U(0):
            k = (q << 6) + _ctz(x)
            x &= x - _ONE
            if k != w:
                adj[k, l >> 6] &= ~_bit(l)
                adj[k, w >> 6] |= _bit(w)
    adj[w, w >> 6] &= ~_bit(w)
    adj[w, l >> 6] &= ~_bit(l)


@njit(cache=True)
def _nth_with_value(cells, alive, n_alive, value, nth, skip):
    for t in range(n_alive):
        i = alive[t]
        if i != skip and cells[i] == value:
            if nth == 0:
                return i
            nth -= 1
    return -1


@njit(cache=True)
def _top_two(cells, alive, n_alive, s):
    """The two players with the most cells; ties are broken uniformly at random."""
    m1 = 0
    for t in range(n_alive):
        m1 = max(m1, cells[alive[t]])
    c1 = 0
    for t in range(n_alive):
        if cells[alive[t]] == m1:
            c1 += 1
    if c1 >= 2:
        r1 = next_int(s, c1)
        r2 = next_int(s, c1 - 1)
        if r2 >= r1:
            r2 += 1
        return (_nth_with_value(cells, alive, n_alive, m1, r1, -1),
                _nth_with_value(cells, alive, n_alive, m1, r2, -1))
    a = _nth_with_value(cells, alive, n_alive, m1, 0, -1)
    m2 = 0
    for t in range(n_alive):
        i = alive[t]
        if i != a:
            m2 = max(m2, cells[i])
    c2 = 0
    for t in range(n_alive):
        i = alive[t]
        if i != a and cells[i] == m2:
            c2 += 1
    return a, _nth_with_value(cells, alive, n_alive, m2, next_int(s, c2), a)


@njit(cache=True, inline="always")
def _swap_remove(lst, pos, n, i):
    p = pos[i]
    last = lst[n - 1]
    lst[p] = last
    pos[last] = p
    pos[i] = -1


@njit(cache=True)
def _play(adj_tmpl, adj, W, aggr, words, prize_gap, sel_mode, s,
          cells, alive, alive_pos, single, single_pos, small, big):
    """Play one full game; fills small[i] (# small prizes) and big[i] (0/1)."""
    n = adj_tmpl.shape[0]
    adj[:, :] = adj_tmpl
    for i in range(n):
        cells[i] = 1
        alive[i] = i
        alive_pos[i] = i
        single[i] = i
        single_pos[i] = i
        small[i] = 0
        big[i] = 0
    n_alive = n
    n_single = n
    streak = -1
    since_prize = 0

    while True:
        if n_alive == 2:  # final duel for the big prize
            i = alive[0]
            j = alive[1]
            if next_float(s) < W[i, j]:
                big[i] = 1
            else:
                big[j] = 1
            return

        if prize_gap > 0 and since_prize == prize_gap:  # small-prize duel, nobody leaves
            a, b = _top_two(cells, alive, n_alive, s)
            if next_float(s) < W[a, b]:
                small[a] += 1
            else:
                small[b] += 1
            since_prize = 0
            continue  # an ongoing streak resumes after the prize duel

        if streak >= 0:
            att = streak
        elif sel_mode == 1 and n_single > 0:
            att = single[next_int(s, n_single)]
        else:
            att = alive[next_int(s, n_alive)]
        dfd = _random_neighbor(adj, att, words, s)

        if next_float(s) < W[att, dfd]:
            w = att
            l = dfd
        else:
            w = dfd
            l = att

        _absorb(adj, w, l, words)
        if cells[w] == 1:
            _swap_remove(single, single_pos, n_single, w)
            n_single -= 1
        if cells[l] == 1:
            _swap_remove(single, single_pos, n_single, l)
            n_single -= 1
        cells[w] += cells[l]
        cells[l] = 0
        _swap_remove(alive, alive_pos, n_alive, l)
        n_alive -= 1
        since_prize += 1

        streak = w if next_float(s) < aggr[w] else -1


@njit(cache=True, parallel=True, nogil=True)
def _run_block(adj_tmpl, W, aggr, prize_gap, sel_mode, kmax, seed, start, count, n_threads):
    n, words = adj_tmpl.shape
    counts = np.zeros((n_threads, n, kmax + 1, 2), dtype=np.int64)
    per = (count + n_threads - 1) // n_threads
    for t in prange(n_threads):
        lo = t * per
        hi = min(count, lo + per)
        if lo < hi:
            adj = np.empty_like(adj_tmpl)
            cells = np.empty(n, dtype=np.int64)
            alive = np.empty(n, dtype=np.int64)
            alive_pos = np.empty(n, dtype=np.int64)
            single = np.empty(n, dtype=np.int64)
            single_pos = np.empty(n, dtype=np.int64)
            small = np.empty(n, dtype=np.int64)
            big = np.empty(n, dtype=np.int64)
            s = np.empty(4, dtype=np.uint64)
            for sim in range(lo, hi):
                seed_state(s, seed, start + sim)
                _play(adj_tmpl, adj, W, aggr, words, prize_gap, sel_mode, s,
                      cells, alive, alive_pos, single, single_pos, small, big)
                for i in range(n):
                    counts[t, i, small[i], big[i]] += 1

    total = np.zeros((n, kmax + 1, 2), dtype=np.int64)
    for t in range(n_threads):
        total += counts[t]
    return total


def max_small_prizes(n_players, prize_every):
    """Upper bound on small-prize duels in one game (they need > 2 players alive)."""
    if prize_every < 2 or n_players < 3:
        return 0
    return (n_players - 3) // (prize_every - 1)


class Prepared:
    """Everything derived from the configuration that is fixed across simulations."""

    def __init__(self, active, p_grid, a_grid, adjacency, model, model_param, luck):
        self.coords, self.adj = board.build_players(active, adjacency)
        self.p = np.array([p_grid[r][c] for r, c in self.coords], dtype=np.float64)
        self.a = np.array([a_grid[r][c] for r, c in self.coords], dtype=np.float64)
        self.W = build_win_matrix(self.p, MODEL_INDEX[model], float(model_param), float(luck))


def run(prepared, n_sims, prize_every, selection, seed=None, progress=None, should_stop=None):
    """Run n_sims games in chunks, calling progress(done, total) after each chunk.

    Returns counts (N, K+1, 2) for the simulations that completed.
    """
    if seed is None:
        seed = int.from_bytes(os.urandom(8), "little") >> 1
    n = len(prepared.coords)
    prize_gap = prize_every - 1 if prize_every >= 2 else 0
    kmax = max_small_prizes(n, prize_every)
    n_threads = get_num_threads()
    chunk = max(64, math.ceil(n_sims / 200))

    counts = np.zeros((n, kmax + 1, 2), dtype=np.int64)
    done = 0
    t0 = time.perf_counter()
    cancelled = False
    while done < n_sims:
        if should_stop is not None and should_stop():
            cancelled = True
            break
        m = min(chunk, n_sims - done)
        counts += _run_block(prepared.adj, prepared.W, prepared.a, prize_gap,
                             SELECTION_MODES[selection], kmax, seed, done, m, n_threads)
        done += m
        if progress is not None:
            progress(done, n_sims)

    return {
        "counts": counts,
        "n_done": done,
        "seed": seed,
        "elapsed": time.perf_counter() - t0,
        "cancelled": cancelled,
        "threads": n_threads,
    }


def warm_up():
    """Trigger JIT compilation on a tiny board."""
    active = [[True, True, True], [True, True, True]]
    grid = [[0.5] * 3] * 2
    prep = Prepared(active, grid, grid, "orth", "power", 1.0, 0.0)
    run(prep, 64, 2, "all", seed=1)
    run(prep, 64, 2, "singles", seed=1)
