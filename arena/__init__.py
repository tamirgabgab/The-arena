import os

# On Vercel the deployment bundle is read-only: let Numba cache compiled code in /tmp.
ON_VERCEL = bool(os.environ.get("VERCEL"))
if ON_VERCEL:
    os.environ.setdefault("NUMBA_CACHE_DIR", "/tmp/numba_cache")
