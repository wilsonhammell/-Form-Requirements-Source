"""Serves this folder over HTTP so the designer can run.

The app cannot be opened straight off the filesystem: it loads as an ES module
and reads two JSON files, and browsers block both over file://. So it needs an
HTTP origin, which is all this does. Python's standard library only, no install.

The .mjs mapping below is not optional. Python maps .mjs to text/plain, and a
browser refuses to run a module script served as text/plain, which would leave
pdf.js with no worker and no page ever rendering.

Usage: python serve.py [port] [--lan]

Without --lan this listens on 127.0.0.1 and is reachable from this machine
only. Read the warning under --lan before using it.
"""

import http.server
import mimetypes
import socket
import socketserver
import sys
import threading
import webbrowser

mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/json", ".json")


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # The field lists are meant to be swapped without a rebuild, so make
        # sure a stale copy is never served back.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # Keep the window readable; errors still surface in the browser.


def free_port(host, preferred):
    for port in [preferred] + list(range(preferred + 1, preferred + 20)):
        with socket.socket() as s:
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    raise SystemExit("No free port in range.")


def main():
    args = [a for a in sys.argv[1:] if a != "--lan"]
    lan = "--lan" in sys.argv
    preferred = int(args[0]) if args else 8000

    host = "0.0.0.0" if lan else "127.0.0.1"
    port = free_port(host, preferred)

    if lan:
        # Anyone who can reach this machine on this port gets the app, with no
        # login of any kind. Nothing here checks who is asking.
        print("*** --lan: this is now reachable by other machines on the network. ***")
        print("*** There is no authentication. Check this is allowed before use. ***")
        print(f"Others use: http://{socket.gethostname()}:{port}/")

    url = f"http://127.0.0.1:{port}/"
    with socketserver.TCPServer((host, port), Handler) as httpd:
        print(f"PDF Requirement Designer running at {url}")
        print("Leave this window open. Press Ctrl+C to stop.")
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")


if __name__ == "__main__":
    main()
