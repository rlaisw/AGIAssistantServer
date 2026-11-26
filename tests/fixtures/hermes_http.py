"""Spec 051 shared fake-server helper for Hermes profile routing tests."""

from __future__ import annotations

import threading
from http.server import ThreadingHTTPServer
from typing import Type


def start_server(handler: Type) -> ThreadingHTTPServer:
    """Serve *handler* on 127.0.0.1:0 in a daemon thread; caller shuts it down."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
