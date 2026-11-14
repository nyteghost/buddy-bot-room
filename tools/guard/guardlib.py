"""Shared, deliberately small and fail-closed helpers for the tooling guardrails.

ownership.yml uses YAML 1.2 JSON-flow syntax, so parsing requires stdlib only.
This is a policy checker, not a GitHub branch protection or sandbox boundary.
"""
from __future__ import annotations
import datetime
import fnmatch
import json
import os
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
VALID_AGENT = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")
VALID_BRANCH = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$")

class GuardError(Exception):
    pass

def git(*args: str, root: pathlib.Path = ROOT) -> str:
    completed = subprocess.run(["git", *args], cwd=root, text=True, capture_output=True)
    if completed.returncode != 0:
        raise GuardError("git " + " ".join(args) + ": " + completed.stderr.strip()[:600])
    return completed.stdout.strip()

def policy(path: pathlib.Path | None = None) -> dict:
    raw = (path or ROOT / "ownership.yml").read_text(encoding="utf-8")
    # Full-line comments are permitted, matching YAML 1.2 JSON flow syntax.
    clean = "\n".join(line for line in raw.splitlines() if not line.lstrip().startswith("#"))
    try:
        data = json.loads(clean)
    except json.JSONDecodeError as exc:
        raise GuardError(f"ownership.yml must use YAML/JSON flow subset: {exc}") from exc
    if (data.get("version") != 1 or not isinstance(data.get("agents"), dict)
        or not isinstance(data.get("shared_readonly"), list)):
        raise GuardError("unsupported ownership.yml schema")
    for agent, entry in data["agents"].items():
        if not VALID_AGENT.fullmatch(agent):
            raise GuardError("invalid agent id")
        if not isinstance(entry, dict) or not all(
            isinstance(entry.get(k), list) and entry[k] and all(isinstance(x, str) and x for x in entry[k])
            for k in ("branches", "paths")
        ):
            raise GuardError(f"invalid ownership rule for {agent}")
    return data

def normalize_path(name: str) -> str:
    name = name.replace("\\", "/")
    if (not name or name.startswith("/") or name.startswith("../")
        or "/../" in name or name.endswith("/..") or "\x00" in name
        or re.match(r"^[A-Za-z]:", name)):
        raise GuardError(f"unsafe path: {name!r}")
    return name.removeprefix("./")

def matches(path: str, pattern: str) -> bool:
    # fnmatch treats * as spanning path separators; ** therefore covers deep trees.
    # A trailing /** must not inadvertently match sibling paths.
    if pattern.endswith("/**"):
        return path.startswith(pattern[:-3] + "/")
    parts, patterns = path.split("/"), pattern.split("/")
    # fnmatchcase('*') also matches '/' in Python. Match by segment to keep
    # .github/workflows/pp-*.yml from authorizing nested/other paths.
    return len(parts) == len(patterns) and all(
        fnmatch.fnmatchcase(segment, glob)
        for segment, glob in zip(parts, patterns)
    )

def select_agent(data: dict, branch: str, specified: str | None = None) -> str:
    if not VALID_BRANCH.fullmatch(branch) or ".." in branch.split("/"):
        raise GuardError("invalid branch name")
    found = [agent for agent, rules in data["agents"].items()
             if any(matches(branch, p) for p in rules["branches"])]
    if specified:
        if specified not in data["agents"] or specified not in found:
            raise GuardError(f"agent {specified!r} is not authorized for {branch!r}")
        return specified
    if len(found) != 1:
        raise GuardError(f"branch {branch!r} maps to {len(found)} agents; explicit assignment required")
    return found[0]

def branch_name() -> str:
    name = git("symbolic-ref", "--quiet", "--short", "HEAD")
    if not name or name == "HEAD":
        raise GuardError("detached HEAD: pass --branch explicitly")
    return name

def sha() -> str:
    return git("rev-parse", "HEAD")

def changed_files(base: str | None, staged: bool = False) -> list[str]:
    if staged:
        args = ("diff", "--no-renames", "--cached", "--name-only", "--diff-filter=ACMRTD", "-z")
    else:
        if not base:
            raise GuardError("pass --base (for example origin/beta) or use --staged")
        # An explicit merge base compares only this branch's changes to its base.
        merge_base = git("merge-base", base, "HEAD")
        args = ("diff", "--no-renames", "--name-only", "--diff-filter=ACMRTD", "-z", merge_base, "HEAD")
    p = subprocess.run(["git", *args], cwd=ROOT, capture_output=True)
    if p.returncode:
        raise GuardError(p.stderr.decode("utf-8", errors="replace")[:600])
    return [normalize_path(x.decode("utf-8")) for x in p.stdout.split(b"\x00") if x]

def result(tool: str, branch: str, commit: str, findings: list[dict]) -> dict:
    return {
        "schema": "pp-findings/v1",
        "tool": tool, "branch": branch, "sha": commit,
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "findings": findings
    }

def finding(rule: str, severity: str, file: str, line: int, message: str) -> dict:
    return {"rule": rule, "severity": severity, "file": file, "line": line, "message": message}

def write_result(tool: str, output: dict, path: str | None = None) -> None:
    dest = pathlib.Path(path) if path else ROOT / "tools" / "out" / f"{tool}-findings.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")

def cli_error(tool: str, error: Exception, dest: str | None = None) -> int:
    output = result(tool, "", "", [finding("tool-error", "blocker", "", 0, str(error))])
    write_result(tool, output, dest)
    print(json.dumps(output, indent=2))
    return 2
