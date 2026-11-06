#!/usr/bin/env python3
"""Candidate routes to mount INSIDE ADHD-A's existing local-only HTTP handler.

Not a server, not installed on Unraid, and does not create a new listener.
Routing must call these functions ONLY for the exact specified paths.
Each route invokes the installed native handler's _local() guard. Mutating
routes additionally require JSON, same-origin Origin, a non-simple custom
header, and explicit user action from the optional inbox page.

A separate integration test using the installed server and Caddy authorization
is still REQUIRED before these routes are installed on Unraid.
"""
from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit

from native_local_intake import CONFIRM as IMPORT_CONFIRM
from native_review_inbox import (
    APPROVE_CONFIRM, import_task, list_inbox, review,
)

PAGE = "/pixel-pals-inbox"
API = "/api/pixel-pals/inbox"
REVIEW = API + "/review"
IMPORT = API + "/import"


def _respond(handler, status: int, payload: bytes, mime: str, *,
             csp: str | None = None) -> None:
    handler.send_response(status)
    handler.send_header("Content-Type", mime)
    handler.send_header("Content-Length", str(len(payload)))
    handler.send_header("Cache-Control", "no-store, private")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("Referrer-Policy", "no-referrer")
    handler.send_header("X-Frame-Options", "DENY")
    if csp:
        handler.send_header("Content-Security-Policy", csp)
    handler.end_headers()
    handler.wfile.write(payload)


def _json(handler, status: int, data: dict) -> None:
    raw = json.dumps(data, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    _respond(handler, status, raw, "application/json; charset=utf-8")


def _page(handler, source_dir: Path) -> None:
    source = (source_dir / "native_review_page.html").read_text(encoding="utf-8")
    start = source.find("<script>")
    end = source.find("</script>", start)
    if start < 0 or end < 0:
        raise ValueError("Review UI has no trusted script")
    script = source[start + len("<script>"):end]
    checksum = base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode("ascii")
    csp = ("default-src 'none'; img-src 'self'; connect-src 'self'; "
           "script-src 'sha256-" + checksum + "'; style-src 'unsafe-inline'; "
           "frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
    _respond(handler, 200, source.encode("utf-8"), "text/html; charset=utf-8", csp=csp)


def _verify_post(handler) -> None:
    if handler.headers.get("X-ADHD-Review") != "1":
        raise PermissionError("Review request missing required same-origin header")
    if handler.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise ValueError("Review endpoint requires JSON")
    site = handler.headers.get("Sec-Fetch-Site", "")
    if site and site != "same-origin":
        raise PermissionError("Cross-site review request rejected")
    origin = handler.headers.get("Origin")
    host = handler.headers.get("Host", "")
    if not isinstance(origin, str) or not origin or not host:
        raise PermissionError("Same-origin request required")
    parsed = urlsplit(origin)
    # The proxy may terminate TLS; compare authority, not assumed server scheme.
    if (parsed.scheme not in ("http", "https") or parsed.netloc != host
       or parsed.username or parsed.password or parsed.path or parsed.query
       or parsed.fragment):
        raise PermissionError("Review request origin does not match dashboard host")
    try:
        size = int(handler.headers.get("Content-Length", "0"))
    except (TypeError, ValueError):
        size = 0
    if not 2 <= size <= 2048:
        raise ValueError("Review request size invalid")


def _read_action(handler, fields: set[str]) -> dict:
    body = handler._read()
    if not isinstance(body, dict) or set(body) != fields:
        raise ValueError("Unexpected review request fields")
    return body


def handle_get(handler, *, bridge_db: Path, page_dir: Path, store) -> bool:
    route = urlsplit(handler.path)
    if route.path not in (PAGE, API):
        return False
    handler._local()  # Require the installed native app's existing authorization.
    if route.query or route.fragment:
        raise ValueError("Review UI does not accept query parameters")
    if route.path == PAGE:
        _page(handler, page_dir)
    else:
        if handler.headers.get("X-ADHD-Review") != "1":
            raise PermissionError("Review inbox requires a same-origin header")
        _json(handler, 200, list_inbox(bridge_db, native_store=store))
    return True


def handle_post(handler, *, bridge_db: Path, store) -> bool:
    route = urlsplit(handler.path)
    if route.path not in (REVIEW, IMPORT):
        return False
    handler._local()  # Never let a network peer invoke owner review endpoints.
    if route.query or route.fragment:
        raise ValueError("Review endpoint does not accept query parameters")
    _verify_post(handler)
    if route.path == REVIEW:
        body = _read_action(handler, {"id", "decision"})
        result = review(bridge_db, handoff_id=body["id"],
                        decision=body["decision"],
                        owner_confirmation=APPROVE_CONFIRM)
    else:
        body = _read_action(handler, {"id"})
        result = import_task(bridge_db, store, handoff_id=body["id"],
                             owner_confirmation=IMPORT_CONFIRM)
    _json(handler, 200, result)
    return True
