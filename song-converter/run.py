#!/usr/bin/env python3
import argparse
import os
from pathlib import Path
import threading
import webbrowser

ROOT = Path(__file__).resolve().parent
os.environ.setdefault("NUMBA_CACHE_DIR", str(ROOT / ".cache" / "numba"))
os.environ.setdefault("HF_HOME", str(ROOT / ".cache" / "huggingface"))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Autochart — MP3 to Clone Hero")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    import uvicorn
    if not args.no_browser:
        threading.Timer(1.5, lambda: webbrowser.open(f"http://127.0.0.1:{args.port}")).start()
    uvicorn.run("songmaker.server:app", host="127.0.0.1", port=args.port)
