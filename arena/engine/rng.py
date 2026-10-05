"""xoshiro256** random number generator usable inside numba-jitted code.

Every simulation gets its own generator seeded from (seed, simulation index), so
results are reproducible regardless of how many threads run the simulations.
"""
import numpy as np
from numba import njit

_U = np.uint64
_SPLITMIX_GAMMA = _U(0x9E3779B97F4A7C15)
_SPLITMIX_M1 = _U(0xBF58476D1CE4E5B9)
_SPLITMIX_M2 = _U(0x94D049BB133111EB)
_INV_2_53 = 1.0 / 9007199254740992.0


@njit(cache=True, inline="always")
def _rotl(x, k):
    return (x << _U(k)) | (x >> _U(64 - k))


@njit(cache=True, inline="always")
def _splitmix(z):
    z = (z ^ (z >> _U(30))) * _SPLITMIX_M1
    z = (z ^ (z >> _U(27))) * _SPLITMIX_M2
    return z ^ (z >> _U(31))


@njit(cache=True)
def seed_state(state, seed, index):
    """Fill `state` (uint64[4]) from a 64-bit seed and a stream index."""
    z = _U(seed) ^ (_U(index) * _U(0xD1342543DE82EF95))
    for i in range(4):
        z = z + _SPLITMIX_GAMMA
        state[i] = _splitmix(z)


@njit(cache=True, inline="always")
def next_u64(s):
    result = _rotl(s[1] * _U(5), 7) * _U(9)
    t = s[1] << _U(17)
    s[2] ^= s[0]
    s[3] ^= s[1]
    s[1] ^= s[2]
    s[0] ^= s[3]
    s[2] ^= t
    s[3] = _rotl(s[3], 45)
    return result


@njit(cache=True, inline="always")
def next_float(s):
    """Uniform float in [0, 1)."""
    return float(next_u64(s) >> _U(11)) * _INV_2_53


@njit(cache=True, inline="always")
def next_int(s, n):
    """Uniform integer in [0, n)."""
    k = int(next_float(s) * n)
    return k if k < n else n - 1
