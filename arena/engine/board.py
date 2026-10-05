"""Board geometry: neighborhoods, validation and the initial player graph."""
from collections import deque

import numpy as np

ORTHOGONAL = ((-1, 0), (1, 0), (0, -1), (0, 1))
DIAGONAL = ((-1, -1), (-1, 1), (1, -1), (1, 1))
OFFSETS = {
    "orth": ORTHOGONAL,
    "both": ORTHOGONAL + DIAGONAL,
}


def _neighbors(active, r, c, offsets):
    rows, cols = active.shape
    for dr, dc in offsets:
        rr, cc = r + dr, c + dc
        if 0 <= rr < rows and 0 <= cc < cols and active[rr, cc]:
            yield rr, cc


def validate(active, adjacency):
    """Return isolated active cells and the connected components of active cells."""
    active = np.asarray(active, dtype=bool)
    offsets = OFFSETS[adjacency]
    cells = [tuple(map(int, rc)) for rc in np.argwhere(active)]
    isolated = [rc for rc in cells if next(_neighbors(active, *rc, offsets), None) is None]

    seen = set()
    components = []
    for start in cells:
        if start in seen:
            continue
        seen.add(start)
        comp, queue = [], deque([start])
        while queue:
            cell = queue.popleft()
            comp.append(cell)
            for nb in _neighbors(active, *cell, offsets):
                if nb not in seen:
                    seen.add(nb)
                    queue.append(nb)
        components.append(comp)

    errors = []
    if len(cells) < 2:
        errors.append("נדרשות לפחות 2 משבצות פעילות")
    if isolated:
        errors.append(f"{len(isolated)} משבצות ללא שכן")
    if len(components) > 1:
        errors.append(f"המפה מפוצלת ל-{len(components)} איים")
    return {"ok": not errors, "errors": errors, "isolated": isolated, "components": components}


def build_players(active, adjacency):
    """Map each active cell to a player and build the initial adjacency bitset.

    Returns (coords, adj_bits) where coords[i] = (r, c) of player i and
    adj_bits is a uint64 array of shape (N, ceil(N / 64)).
    """
    active = np.asarray(active, dtype=bool)
    offsets = OFFSETS[adjacency]
    coords = [tuple(map(int, rc)) for rc in np.argwhere(active)]
    index = {rc: i for i, rc in enumerate(coords)}
    n = len(coords)
    words = (n + 63) // 64
    adj = np.zeros((n, words), dtype=np.uint64)
    for i, rc in enumerate(coords):
        for nb in _neighbors(active, *rc, offsets):
            j = index[nb]
            adj[i, j >> 6] |= np.uint64(1) << np.uint64(j & 63)
    return coords, adj
