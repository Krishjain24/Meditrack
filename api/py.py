"""Vercel Python Serverless Function wrapper for MediTrack backend."""

import os
import sys
from urllib.parse import parse_qs, urlencode, urlparse

os.environ.setdefault("VERCEL", "1")
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from backend.app import MediTrackHandler, init_db  # noqa: E402

init_db()


class handler(MediTrackHandler):
    def _normalize_path(self) -> None:
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        if "path" in qs and qs["path"]:
            target = qs["path"][0]
            if not target.startswith("/api/py"):
                target = f"/api/py/{target.lstrip('/')}"
            extra = {k: v for k, v in qs.items() if k != "path"}
            if extra:
                sep = "&" if "?" in target else "?"
                target = f"{target}{sep}{urlencode(extra, doseq=True)}"
            self.path = target
        elif not parsed.path.startswith("/api/py"):
            target = f"/api/py/{parsed.path.lstrip('/')}"
            if parsed.query:
                target = f"{target}?{parsed.query}"
            self.path = target

    def do_GET(self) -> None:  # type: ignore[override]
        init_db()
        self._normalize_path()
        super().do_GET()

    def do_POST(self) -> None:  # type: ignore[override]
        init_db()
        self._normalize_path()
        super().do_POST()

    def do_PUT(self) -> None:  # type: ignore[override]
        init_db()
        self._normalize_path()
        super().do_PUT()

    def do_DELETE(self) -> None:  # type: ignore[override]
        init_db()
        self._normalize_path()
        super().do_DELETE()

    def do_OPTIONS(self) -> None:  # type: ignore[override]
        self._normalize_path()
        super().do_OPTIONS()

