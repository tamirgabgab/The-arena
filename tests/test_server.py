import pytest
from fastapi.testclient import TestClient

from arena import server
from arena.server import app
from arena.storage import RunStore


@pytest.fixture(autouse=True)
def temp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "store", RunStore(tmp_path / "runs"))


def config(**over):
    n = 4
    cfg = {
        "rows": n, "cols": n,
        "active": [[True] * n for _ in range(n)],
        "p": [[0.5] * n for _ in range(n)],
        "a": [[0.5] * n for _ in range(n)],
        "adjacency": "orth", "n_sims": 2000, "seed": 5,
    }
    cfg.update(over)
    return cfg


def test_config_endpoint_local():
    with TestClient(app) as client:
        assert client.get("/api/config").json()["storage"] == "server"


def test_hosted_mode_caps_sims_and_disables_server_storage(monkeypatch):
    monkeypatch.setattr(server, "STORAGE_MODE", "browser")
    monkeypatch.setattr(server, "MAX_SIMS", 1000)
    with TestClient(app) as client:
        assert client.get("/api/runs").status_code == 404
        with client.websocket_connect("/api/run") as ws:
            ws.send_json(config(n_sims=2000))
            msg = ws.receive_json()
            assert msg["type"] == "error" and "1,000" in msg["message"]


def test_models_endpoint():
    with TestClient(app) as client:
        models = client.get("/api/models").json()
        assert len(models) == 8 and all("latex" in m for m in models)


def test_run_websocket_returns_results():
    with TestClient(app) as client, client.websocket_connect("/api/run") as ws:
        ws.send_json(config())
        while (msg := ws.receive_json())["type"] == "progress":
            assert msg["done"] <= msg["total"]
        assert msg["type"] == "result"
        assert msg["n_sims"] == 2000 and len(msg["coords"]) == 16
        assert sum(sum(pair[1] for pair in player) for player in msg["counts"]) == 2000


def test_saved_runs_crud():
    with TestClient(app) as client:
        with client.websocket_connect("/api/run") as ws:
            ws.send_json(config())
            while (result := ws.receive_json())["type"] == "progress":
                pass
        snap = {"rows": 4, "cols": 4, "config": config()}
        meta = client.post("/api/runs", json={"name": "בסיס", "snap": snap, "result": result}).json()
        assert meta["name"] == "בסיס" and meta["players"] == 16 and meta["n_sims"] == 2000

        assert [m["id"] for m in client.get("/api/runs").json()] == [meta["id"]]
        full = client.get(f"/api/runs/{meta['id']}").json()
        assert full["result"]["counts"] == result["counts"]

        assert client.patch(f"/api/runs/{meta['id']}", json={"name": "חדש"}).json()["name"] == "חדש"
        assert client.get("/api/runs").json()[0]["name"] == "חדש"

        assert client.delete(f"/api/runs/{meta['id']}").json() == {"ok": True}
        assert client.get("/api/runs").json() == []
        assert client.get(f"/api/runs/{meta['id']}").status_code == 404
        assert client.get("/api/runs/..%2Fsecret").status_code == 404


def test_run_rejects_disconnected_map():
    with TestClient(app) as client, client.websocket_connect("/api/run") as ws:
        cfg = config()
        for row in cfg["active"]:
            row[1] = False  # column 1 cut out: columns 0 and 2-3 become separate islands
        ws.send_json(cfg)
        msg = ws.receive_json()
        assert msg["type"] == "error" and "איים" in msg["message"]
