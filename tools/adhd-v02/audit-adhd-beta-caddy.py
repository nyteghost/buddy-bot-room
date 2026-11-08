#!/usr/bin/env python3
"""Secret-redacting, read-only Caddy route inventory for an Unraid beta gateway.

Adapted Caddy JSON is read ONLY from stdin and never printed, saved, or logged.
Reports structural facts without hostnames, password hashes, token values,
certificate material, upstream addresses, or private route paths.

This is NOT an authorization or proof of browser authentication.
"""
from __future__ import annotations

import json
import sys

NATIVE_TARGETS = {"127.0.0.1:8765", "localhost:8765", "[::1]:8765"}
BETA_TARGETS = {"127.0.0.1:18767", "localhost:18767", "[::1]:18767"}


def inspect(data: object) -> dict:
    if not isinstance(data, dict):
        raise ValueError("Caddy JSON object required")
    apps = data.get("apps")
    if not isinstance(apps, dict):
        raise ValueError("No Caddy apps")
    http = apps.get("http")
    if not isinstance(http, dict):
        raise ValueError("No HTTP app")
    servers = http.get("servers")
    if not isinstance(servers, dict) or not servers:
        raise ValueError("No Caddy HTTP servers")

    counters = {
        "servers": 0,
        "https_policy_servers": 0,
        "localhost_native_routes": 0,
        "localhost_beta_routes": 0,
        "native_routes_with_prior_basic_auth": 0,
        "beta_routes_with_prior_basic_auth": 0,
        "native_routes_with_host_rewrite": 0,
        "native_routes_with_origin_rewrite": 0,
        "native_routes_with_local_token_header": 0,
        "other_proxy_routes": 0,
    }
    listener_types = set()
    unknown = False

    def walk(routes: object, *, basic: bool = False, depth: int = 0):
        nonlocal unknown
        if depth > 12 or not isinstance(routes, list):
            unknown = True
            return
        for route in routes:
            if not isinstance(route, dict):
                unknown = True
                continue
            handlers = route.get("handle")
            if not isinstance(handlers, list):
                unknown = True
                continue
            current_basic = basic
            for handler in handlers:
                if not isinstance(handler, dict):
                    unknown = True
                    continue
                kind = handler.get("handler")
                if kind == "authentication":
                    providers = handler.get("providers")
                    if isinstance(providers, dict) and "http_basic" in providers:
                        current_basic = True
                    else:
                        unknown = True
                elif kind == "subroute":
                    walk(handler.get("routes"), basic=current_basic, depth=depth+1)
                elif kind == "reverse_proxy":
                    ups = handler.get("upstreams", [])
                    if not isinstance(ups, list) or not ups:
                        unknown = True
                        continue
                    dials = [u.get("dial") if isinstance(u, dict) else None for u in ups]
                    target = (
                        "native" if all(d in NATIVE_TARGETS for d in dials)
                        else "beta" if all(d in BETA_TARGETS for d in dials)
                        else "other"
                    )
                    if target == "other":
                        counters["other_proxy_routes"] += 1
                        continue
                    counters[f"localhost_{target}_routes"] += 1
                    if current_basic:
                        counters[f"{target}_routes_with_prior_basic_auth"] += 1
                    keys = handler.get("headers", {}).get("request", {}).get("set", {})
                    keys = {str(k).lower() for k in keys} if isinstance(keys, dict) else set()
                    if target == "native":
                        counters["native_routes_with_host_rewrite"] += int("host" in keys)
                        counters["native_routes_with_origin_rewrite"] += int("origin" in keys)
                        counters["native_routes_with_local_token_header"] += int(
                            "x-adhd-local-token" in keys)
                elif kind in ("headers", "encode", "vars", "rewrite", "static_response", "request_body"):
                    continue
                else:
                    # Some extensions or Caddy versions use unfamiliar handlers.
                    unknown = True

    for server in servers.values():
        if not isinstance(server, dict):
            unknown = True
            continue
        counters["servers"] += 1
        if server.get("tls_connection_policies"):
            counters["https_policy_servers"] += 1
        listens = server.get("listen", [])
        if not isinstance(listens, list):
            unknown = True
            listens = []
        for listen in listens:
            if not isinstance(listen, str):
                unknown = True
                continue
            # No private hostnames or raw bind addresses are returned.
            if listen.endswith(":18765"):
                listener_types.add("existing_18765")
            elif listen.endswith(":443"):
                listener_types.add("https_443")
            else:
                listener_types.add("other")
        walk(server.get("routes", []))

    return {
        "audit": "read_only_structure_no_credentials",
        "caddy_servers": counters["servers"],
        "listener_classes": sorted(listener_types),
        "https_policy_servers": counters["https_policy_servers"],
        "production_adhd_loopback_routes": counters["localhost_native_routes"],
        "production_adhd_routes_with_basic_auth_before_proxy":
            counters["native_routes_with_prior_basic_auth"],
        "production_adhd_host_rewrite_routes": counters["native_routes_with_host_rewrite"],
        "production_adhd_origin_rewrite_routes": counters["native_routes_with_origin_rewrite"],
        "production_adhd_proxy_token_header_present":
            bool(counters["native_routes_with_local_token_header"]),
        "photo_beta_loopback_routes": counters["localhost_beta_routes"],
        "photo_beta_routes_with_basic_auth_before_proxy":
            counters["beta_routes_with_prior_basic_auth"],
        "other_proxy_routes": counters["other_proxy_routes"],
        "unrecognized_route_features": unknown,
        "browser_https_auth_verified": False,
        "certificate_trust_verified": False,
        "configuration_changed": False,
        "secret_values_printed": False,
    }


def main() -> int:
    try:
        report = inspect(json.load(sys.stdin))
    except (ValueError, TypeError, KeyError, AttributeError, RecursionError):
        print("REFUSED: Caddy configuration could not be safely inspected.", file=sys.stderr)
        return 2
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
