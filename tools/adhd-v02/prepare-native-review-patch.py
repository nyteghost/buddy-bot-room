#!/usr/bin/env python3
"""Fail-closed, DRY-RUN staging of ADHD Assistant's Pixel Pals review inbox.

The script NEVER modifies installed source files, user SQLite databases,
Docker networking, Caddy, peers, settings or any running container.
It produces a private temporary, inspectable candidate overlay only.

Requires inspection of the INSTALLED server.py source; no hardcoded method
line numbers. Refuses ambiguous app handlers and unsafe auth code.
"""
from __future__ import annotations

import argparse
import ast
from hashlib import sha256
import json
import os
from pathlib import Path
import stat
import sys

FRIENDLY_METHODS = ("do_GET", "do_POST", "_local", "_read")
MODULES = (
    "approved_task_export.py",
    "native_local_intake.py",
    "native_review_inbox.py",
    "native_review_http.py",
    "native_review_page.html",
)
EXPECTED_ROUTES = (
    "/pixel-pals-inbox",
    "/api/pixel-pals/inbox",
    "/api/pixel-pals/inbox/review",
    "/api/pixel-pals/inbox/import",
)


def _is_permission_raise(method: ast.AST) -> bool:
    # _local is called by installed server routes. For new routes it MUST
    # prevent unauthorized execution by raising, not merely returning False.
    return any(
        isinstance(node, ast.Raise)
        and isinstance(node.exc, ast.Call)
        and isinstance(node.exc.func, (ast.Name, ast.Attribute))
        and (node.exc.func.id if isinstance(node.exc.func, ast.Name)
             else node.exc.func.attr) == "PermissionError"
        for node in ast.walk(method)
    )


def _urlsplit_self_path(node: ast.AST) -> bool:
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "urlsplit"
        and len(node.args) == 1 and not node.keywords
        and isinstance(node.args[0], ast.Attribute)
        and node.args[0].attr == "path"
        and isinstance(node.args[0].value, ast.Name)
        and node.args[0].value.id == "self"
    )


def _method_with_path(method: ast.FunctionDef) -> tuple[int, int]:
    """Find either verified installed route idiom; reject other layouts.

    Supported:
      path = urlsplit(self.path).path
      url = urlsplit(self.path); path = url.path; params = ...
    The actual installed ADHD Assistant uses the second form, sometimes with
    semicolon-separated assignments on the same physical source line.
    """
    assignments = [
        node for node in ast.walk(method)
        if isinstance(node, ast.Assign)
        and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)
    ]
    matches = []
    for node in assignments:
        if node.targets[0].id != "path":
            continue
        expr = node.value
        valid = False
        if isinstance(expr, ast.Attribute) and expr.attr == "path":
            if _urlsplit_self_path(expr.value):
                valid = True
            elif isinstance(expr.value, ast.Name):
                name = expr.value.id
                origins = [
                    prev for prev in assignments
                    if prev.targets[0].id == name and _urlsplit_self_path(prev.value)
                    and prev.lineno <= node.lineno
                ]
                valid = len(origins) == 1
        if valid:
            matches.append((node.end_lineno, node.col_offset))
    if len(matches) != 1:
        raise ValueError("Unsupported native route parsing layout")
    return matches[0]


def _native_auth_contract(source: str) -> dict[str, object]:
    """Describe risks, not a proxy-compatibility approval."""
    methods = _handler_class(ast.parse(source))
    constants = {
        n.value for n in ast.walk(methods["_local"])
        if isinstance(n, ast.Constant) and isinstance(n.value, str)
    }
    loopback = bool({"127.0.0.1", "localhost", "::1"} & constants)
    return {
        "local_session_token_guard_detected": "X-ADHD-Local-Token" in constants,
        "loopback_host_restriction_detected": "Host" in constants and loopback,
        "loopback_origin_restriction_detected": "Origin" in constants and loopback,
        "caddy_proxy_behavior_verified": False,
        "browser_write_routes_ready_for_deployment": False,
    }


def _handler_class(tree: ast.Module) -> dict[str, ast.FunctionDef]:
    candidates = []
    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        methods = {n.name: n for n in node.body if isinstance(n, ast.FunctionDef)}
        if all(name in methods for name in FRIENDLY_METHODS):
            candidates.append(methods)
    if len(candidates) != 1:
        raise ValueError("Native server handler has ambiguous or missing methods")
    methods = candidates[0]
    if not _is_permission_raise(methods["_local"]):
        raise ValueError("Native _local() does not have a verified authorization exception")
    for name in ("do_GET", "do_POST"):
        method = methods[name]
        # It must handle rejected requests by a normal exception branch;
        # abort instead of injecting into an unknown server lifecycle.
        if not any(isinstance(node, ast.ExceptHandler) for node in ast.walk(method)):
            raise ValueError("Native " + name + " error handling is unverified")
    return methods


def patch_source(original: str) -> str:
    tree = ast.parse(original)
    methods = _handler_class(tree)
    if any(isinstance(n, ast.Constant) and n.value in EXPECTED_ROUTES
           for n in ast.walk(tree)):
        raise ValueError("One or more Pixel Pals routes already exist")
    get_line, get_indent = _method_with_path(methods["do_GET"])
    post_line, post_indent = _method_with_path(methods["do_POST"])
    if get_line == post_line:
        raise ValueError("Native methods overlap unexpectedly")
    if get_indent < 8 or post_indent < 8:
        raise ValueError("Unexpected native handler indentation")

    def block(indent: int, *, post: bool) -> str:
        sp = " " * indent
        if post:
            return (
                sp + 'if path in ("/api/pixel-pals/inbox/review", "/api/pixel-pals/inbox/import"):\n'
                + sp + "    from pathlib import Path as _PPIPath\n"
                + sp + "    from native_review_http import handle_post as _PPIHandle\n"
                + sp + "    _PPIStore = self.server.store\n"
                + sp + '    if _PPIHandle(self, bridge_db=_PPIPath(_PPIStore.directory) / "bridge-v02.sqlite3", store=_PPIStore):\n'
                + sp + "        return\n"
            )
        return (
            sp + 'if path in ("/pixel-pals-inbox", "/api/pixel-pals/inbox"):\n'
            + sp + "    from pathlib import Path as _PPIPath\n"
            + sp + "    from native_review_http import handle_get as _PPIHandle\n"
            + sp + "    _PPIStore = self.server.store\n"
            + sp + '    if _PPIHandle(self, bridge_db=_PPIPath(_PPIStore.directory) / "bridge-v02.sqlite3", page_dir=_PPIPath(__file__).resolve().parent.parent, store=_PPIStore):\n'
            + sp + "        return\n"
        )

    lines = original.splitlines(keepends=True)
    # Insert after the exact AST-verified path assignment in each method.
    # Reverse order guarantees that line offsets do not drift.
    for line, indent, is_post in sorted((
        (get_line, get_indent, False),
        (post_line, post_indent, True),
    ), reverse=True):
        snippet = block(indent, post=is_post)
        lines.insert(line, snippet)
    result = "".join(lines)
    ast.parse(result)
    if result.count('from native_review_http import') != 2:
        raise ValueError("Candidate route patch did not compile as expected")
    return result


def prepare(source_root: Path, source_modules: Path, stage: Path | None) -> dict[str, object]:
    root = source_root.resolve(strict=True)
    app_server = root / "adhd_assistant" / "server.py"
    if not app_server.is_file() or app_server.is_symlink():
        raise ValueError("Installed native server.py not found")
    original = app_server.read_text(encoding="utf-8")
    patched = patch_source(original)
    for filename in MODULES:
        path = source_modules / filename
        if not path.is_file() or path.is_symlink():
            raise ValueError("Review inbox dependency is unavailable: " + filename)
        if filename.endswith(".py"):
            ast.parse(path.read_text(encoding="utf-8"))
    report = {
        "result": "compatible_source_layout",
        "source_sha256": sha256(original.encode("utf-8")).hexdigest(),
        "patch_changes_installed_app": False,
        "installed_database_touched": False,
        "native_bridge_settings_changed": False,
        "network_service_added": False,
        "routes_prepared": len(EXPECTED_ROUTES),
        "native_auth_contract": _native_auth_contract(original),
        "live_installation_authorized": False,
    }
    if stage is not None:
        # Deliberately refuse stages under appdata, the user home directory,
        # or any existing path: never overwrite files, backups or live source.
        allowed = Path("/tmp").resolve()
        path = stage.absolute()
        if path.is_symlink() or path.exists():
            raise ValueError("Staging directory must be a new, nonexistent path")
        if path.resolve().parent != allowed:
            raise ValueError("Staging directory must be a direct child of /tmp")
        path.mkdir(mode=0o700)
        try:
            staged_server = path / "adhd_assistant" / "server.py"
            staged_server.parent.mkdir(mode=0o700)
            staged_server.write_text(patched, encoding="utf-8")
            staged_server.chmod(stat.S_IRUSR | stat.S_IWUSR)
            for filename in MODULES:
                data = (source_modules / filename).read_bytes()
                candidate = path / filename
                candidate.write_bytes(data)
                candidate.chmod(stat.S_IRUSR | stat.S_IWUSR)
            report["staging_prepared"] = True
        except Exception:
            # On incomplete stage, leave the staged output available for
            # inspection; no installed files have been touched.
            raise
    else:
        report["staging_prepared"] = False
    return report


def main() -> int:
    cli = argparse.ArgumentParser(description="Read-only native ADHD review UI patch preflight")
    cli.add_argument("--source-root", type=Path, required=True)
    cli.add_argument("--stage", type=Path, default=None,
                     help="Only write a private, new /tmp/<dirname> candidate overlay")
    args = cli.parse_args()
    try:
        result = prepare(args.source_root, Path(__file__).parent, args.stage)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (OSError, UnicodeError, ValueError, SyntaxError):
        # Never print source code or private file paths from errors.
        print("Review UI patch staging refused: unfamiliar source layout or unsafe path",
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
