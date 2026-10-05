import numpy as np
import numba
import pytest

from arena.engine import board
from arena.engine import simulate as sim
from arena.engine.duel_models import MODELS, MODEL_INDEX, win_prob


def full(rows, cols, value=True):
    return [[value] * cols for _ in range(rows)]


# ---------- duel models ----------

@pytest.mark.parametrize("model", [m["id"] for m in MODELS])
@pytest.mark.parametrize("scale", [0.3, 1.0, 3.0])
@pytest.mark.parametrize("luck", [0.0, 0.4])
def test_model_properties(model, scale, luck):
    m = MODEL_INDEX[model]
    param = MODELS[m]["param"]["default"] * scale
    grid = np.linspace(0.0, 1.0, 21)
    for p1 in grid:
        assert win_prob(m, p1, p1, param, luck) == pytest.approx(0.5)
        for p2 in grid:
            f = win_prob(m, p1, p2, param, luck)
            assert 0.0 <= f <= 1.0
            assert f + win_prob(m, p2, p1, param, luck) == pytest.approx(1.0)
            if p1 > p2:
                assert f >= 0.5


# ---------- board ----------

def test_two_islands_detected():
    active = full(4, 5)
    for r in range(4):
        active[r][2] = False
    res = board.validate(active, "orth")
    assert not res["ok"] and len(res["components"]) == 2 and not res["isolated"]


def test_corner_touch_connects_only_with_diagonals():
    active = full(2, 2, False)
    active[0][0] = active[1][1] = True
    assert not board.validate(active, "orth")["ok"]
    assert board.validate(active, "both")["ok"]


def test_isolated_cell_detected():
    active = full(4, 4, False)
    active[0][0] = active[0][1] = True
    active[3][3] = True
    res = board.validate(active, "orth")
    assert res["isolated"] == [(3, 3)]
    assert len(res["components"]) == 2


def test_full_board_valid():
    for adj in ("orth", "both"):
        assert board.validate(full(8, 8), adj)["ok"]


# ---------- engine ----------

def run(active, p, a, adjacency="orth", prize_every=8, selection="all", n=4000, seed=7,
        model="power", param=1.0):
    prep = sim.Prepared(active, p, a, adjacency, model, param, 0.0)
    return prep, sim.run(prep, n, prize_every, selection, seed=seed)


@pytest.mark.parametrize("selection", ["all", "singles"])
@pytest.mark.parametrize("prize_every", [0, 2, 5, 8])
def test_invariants(selection, prize_every):
    _, res = run(full(5, 6), full(5, 6, 0.5), full(5, 6, 0.7), "both", prize_every, selection)
    c = res["counts"]
    n_sims = res["n_done"]
    assert (c.sum(axis=(1, 2)) == n_sims).all()            # every player counted once per game
    assert c[:, :, 1].sum() == n_sims                      # exactly one big winner per game
    k = np.arange(c.shape[1])
    expected = sim.max_small_prizes(30, prize_every)
    assert (c.sum(axis=2) * k[None, :]).sum() == expected * n_sims


def test_two_players_final_matches_model():
    active = [[True, True]]
    _, res = run(active, [[0.8, 0.4]], [[0.5, 0.5]], n=40000)
    p_big = res["counts"][0, :, 1].sum() / res["n_done"]
    assert p_big == pytest.approx(0.8 / 1.2, abs=0.01)


def test_symmetric_board_symmetric_results():
    prep, res = run(full(6, 6), full(6, 6, 0.5), full(6, 6, 0.5), n=40000)
    idx = {rc: i for i, rc in enumerate(prep.coords)}
    big = res["counts"][:, :, 1].sum(axis=1) / res["n_done"]
    corners = [big[idx[rc]] for rc in [(0, 0), (0, 5), (5, 0), (5, 5)]]
    assert max(corners) - min(corners) < 0.01


def test_deterministic_across_thread_counts():
    _, r1 = run(full(5, 5), full(5, 5, 0.5), full(5, 5, 0.5), seed=123)
    old = numba.get_num_threads()
    numba.set_num_threads(1)
    try:
        _, r2 = run(full(5, 5), full(5, 5, 0.5), full(5, 5, 0.5), seed=123)
    finally:
        numba.set_num_threads(old)
    assert (r1["counts"] == r2["counts"]).all()


def test_dominant_player_wins_more():
    p = full(4, 4, 0.3)
    p[1][1] = 0.95
    prep, res = run(full(4, 4), p, full(4, 4, 0.5), n=20000, model="logistic", param=8.0)
    big = res["counts"][:, :, 1].sum(axis=1) / res["n_done"]
    star = prep.coords.index((1, 1))
    assert big[star] == big.max() and big[star] > 3 / 16


def test_cancel_returns_partial():
    prep = sim.Prepared(full(8, 8), full(8, 8, 0.5), full(8, 8, 0.5), "orth", "power", 1.0, 0.0)
    calls = []
    res = sim.run(prep, 100000, 8, "all", seed=1,
                  progress=lambda d, t: calls.append(d), should_stop=lambda: len(calls) >= 3)
    assert res["cancelled"] and res["n_done"] == calls[-1] < 100000
