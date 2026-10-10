#!/usr/bin/env python3
"""Serve the viewer for local work, telling the browser to revalidate.

    python3 serve_viewer.py 5273

`python3 -m http.server` sends no Cache-Control, so a browser keeps a module
by heuristic for hours: `map.html` imports its siblings with no cache buster,
and an edited `hull-bodies.js` goes on running as its old self behind a fresh
page, through a hard reload. `no-cache` makes every request conditional (a 304
when the file has not changed), which is what mesh/nginx.conf sends in
production.
"""

from __future__ import annotations

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5273
    directory = sys.argv[2] if len(sys.argv) > 2 else str(Path(__file__).resolve().parent / "viewer")
    ThreadingHTTPServer(("", port), partial(Handler, directory=directory)).serve_forever()


if __name__ == "__main__":
    main()
