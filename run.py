"""Start The Arena simulator: python run.py [--port 8000] [--no-browser]"""
import argparse
import threading
import webbrowser

import uvicorn


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    url = f"http://127.0.0.1:{args.port}"
    if not args.no_browser:
        threading.Timer(1.5, webbrowser.open, args=[url]).start()
    print(f"The Arena running at {url}")
    uvicorn.run("arena.server:app", host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
