"""Saved simulation runs, stored as JSON files: one file per run plus an index of metadata."""
import json
import re
import threading
import time
import uuid
from pathlib import Path

DEFAULT_DIR = Path(__file__).resolve().parent.parent / "saved_runs"
_ID_RE = re.compile(r"^[0-9a-f]{12}$")
_lock = threading.Lock()


class RunStore:
    def __init__(self, root=DEFAULT_DIR):
        self.root = Path(root)

    # ---------- index ----------
    @property
    def _index_path(self):
        return self.root / "index.json"

    def _read_index(self):
        try:
            return json.loads(self._index_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return []

    def _write_index(self, items):
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self._index_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self._index_path)

    def _path(self, run_id):
        if not _ID_RE.match(run_id):
            raise KeyError(run_id)
        return self.root / f"{run_id}.json"

    # ---------- API ----------
    def list(self):
        return sorted(self._read_index(), key=lambda m: m["created"], reverse=True)

    def get(self, run_id):
        path = self._path(run_id)
        if not path.exists():
            raise KeyError(run_id)
        return json.loads(path.read_text(encoding="utf-8"))

    def save(self, name, snap, result):
        run_id = uuid.uuid4().hex[:12]
        cfg = snap["config"]
        meta = {
            "id": run_id,
            "name": name.strip() or "סימולציה ללא שם",
            "created": time.time(),
            "rows": cfg["rows"], "cols": cfg["cols"],
            "players": len(result["coords"]),
            "n_sims": result["n_sims"],
            "small_prize": result["small_prize"], "big_prize": result["big_prize"],
        }
        for key in ("model", "model_param", "luck", "adjacency", "selection", "prize_every"):
            meta[key] = cfg.get(key)
        with _lock:
            self.root.mkdir(parents=True, exist_ok=True)
            self._path(run_id).write_text(
                json.dumps({"meta": meta, "snap": snap, "result": result}, ensure_ascii=False), encoding="utf-8")
            self._write_index(self._read_index() + [meta])
        return meta

    def rename(self, run_id, name):
        with _lock:
            data = self.get(run_id)
            data["meta"]["name"] = name.strip() or data["meta"]["name"]
            self._path(run_id).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            items = [data["meta"] if m["id"] == run_id else m for m in self._read_index()]
            self._write_index(items)
        return data["meta"]

    def delete(self, run_id):
        with _lock:
            path = self._path(run_id)
            if not path.exists():
                raise KeyError(run_id)
            path.unlink()
            self._write_index([m for m in self._read_index() if m["id"] != run_id])
