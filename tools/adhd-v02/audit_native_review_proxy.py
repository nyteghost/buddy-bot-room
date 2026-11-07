#!/usr/bin/env python3
"""Offline, secret-redacting Caddy JSON route inspector for ADHD inbox paths.

Input is Caddy's adapted JSON on stdin. This is NOT a runtime probe or
permission to install. Never print input, hostnames, credentials, tokens,
header values or upstream addresses. Unknown cases fail closed.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import sys

PATHS = (
    "/pixel-pals-inbox",
    "/api/pixel-pals/inbox",
    "/api/pixel-pals/inbox/review",
    "/api/pixel-pals/inbox/import",
)


def _route_matches(route: dict, path: str, host: str) -> bool | None:
    """True/False/unknown; only recognize simple host and path matchers."""
    rules = route.get("match")
    if rules is None:
        return True
    if not isinstance(rules, list) or not rules:
        return None
    any_unknown = False
    for rule in rules:
        if not isinstance(rule, dict):
            return None
        if not set(rule) <= {"host", "path"}:
            any_unknown = True
            continue
        hosts, paths = rule.get("host"), rule.get("path")
        if hosts is not None and (not isinstance(hosts, list) or not hosts or
                                  not all(isinstance(h, str) for h in hosts)):
            return None
        if paths is not None and (not isinstance(paths, list) or not paths or
                                  not all(isinstance(p, str) for p in paths)):
            return None
        ok_host = hosts is None or any(
            fnmatch.fnmatchcase(host.lower(), h.lower()) for h in hosts)
        ok_path = paths is None or any(
            fnmatch.fnmatchcase(path, p) for p in paths)
        if ok_host and ok_path:
            return True
    return None if any_unknown else False


def _proxy_features(handler: dict) -> dict:
    request = handler.get("headers", {}).get("request", {})
    if not isinstance(request, dict):
        request = {}
    sets = request.get("set", {})
    if not isinstance(sets, dict):
        sets = {}
    keys = {str(key).lower() for key in sets}
    upstreams = handler.get("upstreams")
    expected = {"127.0.0.1:8765", "localhost:8765"}
    target_ok = (isinstance(upstreams, list) and bool(upstreams) and all(
        isinstance(upstream, dict) and upstream.get("dial") in expected
        and set(upstream) == {"dial"} for upstream in upstreams))
    return {
        "native_loopback_upstream": target_ok,
        "has_host_rewrite": "host" in keys,
        "has_origin_rewrite": "origin" in keys,
        "has_local_token_injection": "x-adhd-local-token" in keys,
        # Presence does not verify the actual configured values.
        "header_values_verified": False,
    }


def _paths(routes: object, path: str, host: str, *,
           authenticated: bool = False, uncertain: bool = False,
           depth: int = 0) -> list[dict]:
    """Conservative structural route walk, not a full Caddy interpreter."""
    if depth > 12 or not isinstance(routes, list):
        return [{"unknown": True}]
    found = []
    for route in routes:
        if not isinstance(route, dict):
            found.append({"unknown": True})
            continue
        match = _route_matches(route, path, host)
        if match is False:
            continue
        ambiguous = uncertain or match is None
        handlers = route.get("handle", [])
        if not isinstance(handlers, list):
            found.append({"unknown": True})
            continue
        passed_auth = authenticated
        for handler in handlers:
            if not isinstance(handler, dict):
                ambiguous = True
                continue
            name = handler.get("handler")
            if name == "authentication":
                providers = handler.get("providers", {})
                if isinstance(providers, dict) and "http_basic" in providers:
                    passed_auth = True
                else:
                    ambiguous = True
            elif name == "subroute":
                found.extend(_paths(handler.get("routes"), path, host,
                                    authenticated=passed_auth,
                                    uncertain=ambiguous, depth=depth + 1))
            elif name == "reverse_proxy":
                found.append({"unknown": ambiguous,
                              "basic_auth_before_proxy": passed_auth,
                              **_proxy_features(handler)})
            elif name in {"headers", "encode", "vars"}:
                # Middleware may change security headers; do not claim proof.
                if name == "headers":
                    ambiguous = True
            else:
                ambiguous = True
        # Multiple matching sibling routes remain ambiguous, by design.
    return found


def audit(config: object, host: str) -> dict:
    if not isinstance(config, dict) or not isinstance(host, str) or not host:
        raise ValueError("Invalid audit input")
    servers = config.get("apps", {}).get("http", {}).get("servers", {})
    if not isinstance(servers, dict) or not servers:
        raise ValueError("No HTTP server routes")
    checks = {}
    for path in PATHS:
        matches = []
        for server in servers.values():
            if not isinstance(server, dict):
                matches.append({"unknown": True})
                continue
            matches.extend(_paths(server.get("routes"), path, host))
        checks[path] = {
            "candidate_upstreams": len(matches),
            "basic_auth_before_proxy": bool(matches) and all(
                m.get("basic_auth_before_proxy") is True for m in matches),
            "native_loopback_upstream": bool(matches) and all(
                m.get("native_loopback_upstream") is True for m in matches),
            "host_rewrite_present": bool(matches) and all(
                m.get("has_host_rewrite") is True for m in matches),
            "origin_rewrite_present": bool(matches) and all(
                m.get("has_origin_rewrite") is True for m in matches),
            "native_token_header_injection_present": bool(matches) and all(
                m.get("has_local_token_injection") is True for m in matches),
            "route_structure_unambiguous": (
                len(matches) == 1 and not matches[0].get("unknown")),
        }
    return {
        "audit": "static_caddy_route_structure_only",
        "paths": checks,
        "secret_values_disclosed": False,
        "credential_validation_performed": False,
        "actual_browser_request_tested": False,
        "native_token_value_verified": False,
        "live_installation_authorized": False,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Offline redacted Caddy inbox route audit")
    parser.add_argument("--host", required=True,
                        help="Requested browser hostname (never printed)")
    args = parser.parse_args(argv)
    try:
        result = audit(json.load(sys.stdin), args.host)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ValueError, TypeError, KeyError, RecursionError, AttributeError):
        print("REFUSED: Caddy configuration could not be safely analyzed; no changes made.",
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
