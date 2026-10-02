"""Local dev server for fevga: like `python -m http.server`, but tells the browser never to
cache, so an edited ES module is always reloaded (plain http.server sends no Cache-Control and
Chrome then reuses stale modules on reload - a burl texture change was invisible because of it).

    python serve.py [port]      (default 8831, binds 127.0.0.1)
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8831
    here = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=here)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"fevga dev server on http://127.0.0.1:{port}/ (no-store)")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
