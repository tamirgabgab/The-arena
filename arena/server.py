import asyncio
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from . import ON_VERCEL
from .engine import board, simulate
from .engine.duel_models import models_for_api
from .schemas import Board, Config
from .storage import RunStore

WEB_DIR = Path(__file__).resolve().parent.parent / "web"
store = RunStore()

# Hosted (public, no persistent disk): saved runs live in each visitor's browser, and the
# per-run simulation count is capped so one visitor cannot exhaust the CPU quota.
STORAGE_MODE = "browser" if ON_VERCEL else "server"
MAX_SIMS = int(os.environ.get("ARENA_MAX_SIMS", 1_000_000 if ON_VERCEL else 10_000_000))


@asynccontextmanager
async def lifespan(_app):
    await asyncio.to_thread(simulate.warm_up)  # JIT-compile before the first request
    yield


app = FastAPI(title="The Arena", lifespan=lifespan)


@app.get("/api/models")
def get_models():
    return models_for_api()


@app.get("/api/config")
def get_config():
    return {"storage": STORAGE_MODE, "max_sims": MAX_SIMS, "hosted": ON_VERCEL}


@app.post("/api/validate")
def post_validate(b: Board):
    return board.validate(b.active, b.adjacency)


# ---------- saved runs ----------
class SaveRun(BaseModel):
    name: str = Field(max_length=120)
    snap: dict
    result: dict


class RenameRun(BaseModel):
    name: str = Field(min_length=1, max_length=120)


def _found(fn, *args):
    if STORAGE_MODE != "server":
        raise HTTPException(404, "saved runs are stored in the browser on this deployment")
    try:
        return fn(*args)
    except KeyError:
        raise HTTPException(404, "run not found")


@app.get("/api/runs")
def list_runs():
    return _found(store.list)


@app.get("/api/runs/{run_id}")
def get_run(run_id: str):
    return _found(store.get, run_id)


@app.post("/api/runs")
def save_run(body: SaveRun):
    return _found(store.save, body.name, body.snap, body.result)


@app.patch("/api/runs/{run_id}")
def rename_run(run_id: str, body: RenameRun):
    return _found(store.rename, run_id, body.name)


@app.delete("/api/runs/{run_id}")
def delete_run(run_id: str):
    _found(store.delete, run_id)
    return {"ok": True}


@app.websocket("/api/run")
async def ws_run(ws: WebSocket):
    await ws.accept()
    loop = asyncio.get_running_loop()
    stop = threading.Event()
    try:
        try:
            cfg = Config.model_validate(await ws.receive_json())
        except ValidationError as e:
            await ws.send_json({"type": "error", "message": str(e)})
            return
        if cfg.n_sims > MAX_SIMS:
            await ws.send_json({"type": "error", "message": f"בגרסה המקוונת מותר עד {MAX_SIMS:,} סימולציות בהרצה אחת"})
            return
        check = board.validate(cfg.active, cfg.adjacency)
        if not check["ok"]:
            await ws.send_json({"type": "error", "message": " · ".join(check["errors"])})
            return

        progress_q: asyncio.Queue = asyncio.Queue()

        def on_progress(done, total):
            loop.call_soon_threadsafe(progress_q.put_nowait, (done, total))

        def work():
            prep = simulate.Prepared(cfg.active, cfg.p, cfg.a, cfg.adjacency,
                                     cfg.model, cfg.model_param, cfg.luck)
            res = simulate.run(prep, cfg.n_sims, cfg.prize_every, cfg.selection, cfg.seed,
                               progress=on_progress, should_stop=stop.is_set)
            return prep, res

        async def listen_for_cancel():
            while True:
                msg = await ws.receive_json()
                if msg.get("type") == "cancel":
                    stop.set()
                    return

        task = asyncio.create_task(asyncio.to_thread(work))
        cancel_task = asyncio.create_task(listen_for_cancel())
        while not task.done():
            try:
                done, total = await asyncio.wait_for(progress_q.get(), timeout=0.1)
            except asyncio.TimeoutError:
                continue
            while not progress_q.empty():  # only the latest progress matters
                done, total = progress_q.get_nowait()
            await ws.send_json({"type": "progress", "done": done, "total": total})
        cancel_task.cancel()

        prep, res = await task
        await ws.send_json({
            "type": "result",
            "coords": prep.coords,
            "counts": res["counts"].tolist(),
            "n_sims": res["n_done"],
            "requested": cfg.n_sims,
            "cancelled": res["cancelled"],
            "seed": str(res["seed"]),
            "elapsed": res["elapsed"],
            "threads": res["threads"],
            "small_prize": cfg.small_prize,
            "big_prize": cfg.big_prize,
        })
    except WebSocketDisconnect:
        stop.set()
    finally:
        stop.set()


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
