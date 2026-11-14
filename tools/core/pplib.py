"""Shared helpers for the Claude-owned Pixel Pals coordination tools (tools/core).

Stdlib only. Talks to GitHub through the REST API (never GraphQL) using one of
three backends:

* ``fixtures`` - a local directory of canned responses (tests, offline demos);
* ``gh``       - the GitHub CLI's ``gh api`` (uses whatever auth gh has);
* ``http``     - urllib with GH_TOKEN/GITHUB_TOKEN if set, unauthenticated
                 otherwise (works for this public repository, rate limited).

Every fact these tools report carries a provenance:

* ``independent`` - checked by the tool itself against git or the GitHub API;
* ``claimed``     - copied from a developer's own report (relay text,
                    self-produced test results) and NOT independently checked.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
CORE = pathlib.Path(__file__).resolve().parent
GUARD = ROOT / "tools" / "guard"
OUT = ROOT / "tools" / "out"

DEFAULT_REPO = "nyteghost/buddy-bot-room"
COORDINATION_ISSUE = 37
RELAY_OPEN = "<!-- pixel-pals-relay:v1 -->"
RELAY_CLOSE = "<!-- /pixel-pals-relay -->"

SHA40 = re.compile(r"^[0-9a-f]{40}$")
VALID_AGENT = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")          # same as tools/guard
VALID_BRANCH = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$")  # same as tools/guard
VALID_REPO = re.compile(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$")

EVIDENCE_LEVELS = ("static", "unit", "integration", "ci", "native", "hardware")
TEST_STATUSES = ("pass", "fail", "skipped", "not_run")
SEVERITIES = ("blocker", "high", "medium", "low", "info")


class ToolError(Exception):
    """A problem with the tool or its environment (exit code 2)."""


def now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


# --------------------------------------------------------------------------- git

def git(*args: str, cwd: pathlib.Path | None = None, check: bool = True) -> str:
    p = subprocess.run(["git", *args], cwd=cwd or ROOT, text=True, capture_output=True)
    if check and p.returncode != 0:
        raise ToolError("git " + " ".join(args) + ": " + p.stderr.strip()[:500])
    return p.stdout.strip() if p.returncode == 0 else ""


def current_branch(cwd: pathlib.Path | None = None) -> str:
    return git("symbolic-ref", "--quiet", "--short", "HEAD", cwd=cwd, check=False)


def head_sha(cwd: pathlib.Path | None = None) -> str:
    return git("rev-parse", "HEAD", cwd=cwd)


def worktree_dirty(cwd: pathlib.Path | None = None) -> bool:
    # Untracked files under tools/out are generated evidence, not source.
    status = git("status", "--porcelain", "--untracked-files=normal", cwd=cwd)
    return any(line and not line[3:].startswith("tools/out/") for line in status.splitlines())


def resolve_base(base: str, cwd: pathlib.Path | None = None) -> str:
    """Return the first existing ref among origin/<base>, <base>."""
    for ref in (f"origin/{base}", base):
        if git("rev-parse", "--verify", "--quiet", ref + "^{commit}", cwd=cwd, check=False):
            return ref
    raise ToolError(f"base ref {base!r} not found locally (try: git fetch origin {base})")


def repo_slug(explicit: str | None = None) -> str:
    slug = explicit or os.environ.get("PP_REPO") or os.environ.get("GITHUB_REPOSITORY")
    if not slug:
        url = git("remote", "get-url", "origin", check=False)
        m = re.search(r"github\.com[:/]([^/]+/[^/]+?)(?:\.git)?$", url)
        slug = m.group(1) if m else DEFAULT_REPO
    if not VALID_REPO.fullmatch(slug):
        raise ToolError(f"invalid repository slug {slug!r}")
    return slug


# ------------------------------------------------------------------------ GitHub

class GitHub:
    """Minimal REST client. ``path`` is like ``/repos/o/r/pulls``."""

    def __init__(self, backend: str | None = None):
        self.backend = backend or self._auto()
        self.calls = 0
        if self.backend == "fixtures":
            self.fixture_dir = pathlib.Path(os.environ["PP_GH_FIXTURES"])
            self.routes = json.loads((self.fixture_dir / "routes.json").read_text("utf-8"))

    @staticmethod
    def _auto() -> str:
        chosen = os.environ.get("PP_GH_BACKEND")
        if chosen:
            if chosen not in ("fixtures", "gh", "http"):
                raise ToolError(f"unknown PP_GH_BACKEND {chosen!r}")
            return chosen
        if os.environ.get("PP_GH_FIXTURES"):
            return "fixtures"
        return "gh" if shutil.which("gh") else "http"

    # -- public API
    def get(self, path: str, params: dict | None = None):
        self.calls += 1
        if self.backend == "fixtures":
            return self._fixture_get(path)
        if self.backend == "gh":
            try:
                return self._gh("GET", path, params)
            except ToolError as exc:
                # gh without auth (e.g. Actions without GH_TOKEN): fall back to
                # unauthenticated REST, which is enough for a public repository.
                if "auth" in str(exc).lower() or "login" in str(exc).lower():
                    self.backend = "http"
                    return self._http("GET", path, params)
                raise
        return self._http("GET", path, params)

    def paginate(self, path: str, params: dict | None = None, key: str | None = None,
                 max_pages: int = 5, per_page: int = 100) -> list:
        items: list = []
        params = dict(params or {})
        params["per_page"] = per_page
        for page in range(1, max_pages + 1):
            params["page"] = page
            data = self.get(path, params)
            batch = data.get(key, []) if key else data
            if not isinstance(batch, list):
                raise ToolError(f"unexpected response shape from {path}")
            items.extend(batch)
            if len(batch) < per_page or self.backend == "fixtures":
                break
        return items

    def post(self, path: str, body: dict):
        self.calls += 1
        if self.backend == "fixtures":
            posted = self.fixture_dir / "posted.json"
            items = json.loads(posted.read_text("utf-8")) if posted.exists() else []
            record = {"id": 900000 + len(items), "path": path, "created_at": now(),
                      "user": {"login": "fixture-poster"}, "body": body.get("body", ""),
                      "html_url": f"fixture://{path}#{900000 + len(items)}"}
            items.append(record)
            posted.write_text(json.dumps(items, indent=2), "utf-8")
            return record
        if self.backend == "gh":
            return self._gh("POST", path, None, body)
        return self._http("POST", path, None, body)

    # -- backends
    def _fixture_get(self, path: str):
        key = path.split("?", 1)[0]
        if key not in self.routes:
            raise ToolError(f"fixture missing for GET {key}")
        data = self.routes[key]
        if key.endswith("/comments"):
            posted = self.fixture_dir / "posted.json"
            if posted.exists():
                extra = [c for c in json.loads(posted.read_text("utf-8")) if c["path"] == key]
                data = list(data) + extra
        return data

    def _gh(self, method: str, path: str, params: dict | None, body: dict | None = None):
        url = path.lstrip("/")
        if params:
            url += "?" + urllib.parse.urlencode(params)
        cmd = ["gh", "api", "-X", method, "-H", "Accept: application/vnd.github+json", url]
        stdin = None
        if body is not None:
            cmd += ["--input", "-"]
            stdin = json.dumps(body)
        p = subprocess.run(cmd, text=True, capture_output=True, input=stdin, timeout=60)
        if p.returncode != 0:
            raise ToolError(f"gh api {method} {path}: {(p.stderr or p.stdout).strip()[:400]}")
        return json.loads(p.stdout or "null")

    def _http(self, method: str, path: str, params: dict | None, body: dict | None = None):
        url = "https://api.github.com" + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "pixel-pals-tools",
                   "X-GitHub-Api-Version": "2022-11-28"}
        token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8") or "null")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            raise ToolError(f"GitHub {method} {path}: HTTP {exc.code} {detail}") from exc
        except urllib.error.URLError as exc:
            raise ToolError(f"GitHub {method} {path}: {exc.reason}") from exc


def ci_for_sha(gh: GitHub, repo: str, sha: str, ignore: tuple[str, ...] = ()) -> dict:
    """Independent CI rollup for one exact commit (check runs + legacy statuses).

    state: pass | fail | pending | none
    """
    runs = gh.get(f"/repos/{repo}/commits/{sha}/check-runs", {"per_page": 100}).get("check_runs", [])
    combined = gh.get(f"/repos/{repo}/commits/{sha}/status")
    checks = []
    for r in runs:
        if r.get("name") in ignore:
            continue
        checks.append({"name": r.get("name", ""), "status": r.get("status", ""),
                       "conclusion": r.get("conclusion"), "url": r.get("html_url", ""),
                       "head_sha": r.get("head_sha", sha)})
    for s in (combined or {}).get("statuses", []) or []:
        state = s.get("state")
        checks.append({"name": s.get("context", ""), "status": "completed" if state != "pending" else "in_progress",
                       "conclusion": {"success": "success", "failure": "failure", "error": "failure"}.get(state),
                       "url": s.get("target_url") or "", "head_sha": sha})
    wrong_sha = [c for c in checks if c["head_sha"] != sha]
    good = {"success", "neutral", "skipped"}
    if wrong_sha:
        state = "fail"
    elif not checks:
        state = "none"
    elif any(c["status"] == "completed" and c["conclusion"] not in good for c in checks):
        state = "fail"
    elif any(c["status"] != "completed" for c in checks):
        state = "pending"
    else:
        state = "pass"
    return {"sha": sha, "state": state, "checks": checks,
            "summary": f"{sum(c['conclusion'] in good for c in checks)}/{len(checks)} green",
            "provenance": "independent"}


# ------------------------------------------------------------------------ relay

FIELD_RE = re.compile(r"^([A-Za-z][A-Za-z ]{0,30}?)\s*:\s*(.*\S)\s*$")
SHA_FIELDS = ("Commit", "Exact commit", "Exact SHA")


def relay_envelope(body: str) -> str | None:
    start = body.find(RELAY_OPEN)
    if start < 0:
        return None
    rest = body[start + len(RELAY_OPEN):]
    end = rest.find(RELAY_CLOSE)
    if end >= 0:
        return rest[:end]
    # Legacy blocks without a closing marker: header lines until the first blank line.
    lines = []
    for line in rest.lstrip("\n").splitlines():
        if not line.strip():
            break
        lines.append(line)
    return "\n".join(lines)


def parse_relay(body: str) -> dict | None:
    """Parse a pixel-pals-relay:v1 header. Values are CLAIMED, never trusted."""
    env = relay_envelope(body)
    if env is None:
        return None
    fields: dict[str, str] = {}
    for line in env.splitlines():
        m = FIELD_RE.match(line.strip())
        if m and m.group(1) not in fields:
            fields[m.group(1).strip()] = m.group(2).strip().strip("`").strip()
    sha = ""
    for label in SHA_FIELDS:
        if SHA40.fullmatch(fields.get(label, "")):
            sha = fields[label]
            break
    base_ref, base_sha = "", ""
    m = re.match(r"^([A-Za-z0-9._/-]+)\s*@\s*`?([0-9a-f]{7,40})`?$", fields.get("Base", ""))
    if m:
        base_ref, base_sha = m.group(1), m.group(2)
    agent, branch = fields.get("From", ""), fields.get("Branch", "")
    problems = []
    if not VALID_AGENT.fullmatch(agent):
        problems.append("From is missing or not an agent id")
    if not VALID_BRANCH.fullmatch(branch) or ".." in branch.split("/"):
        problems.append("Branch is missing or invalid")
    if not sha:
        problems.append("no 40-character Commit/Exact commit/Exact SHA")
    return {
        "fields": fields, "agent": agent, "branch": branch, "sha": sha,
        "base_ref": base_ref, "base_sha": base_sha, "pr": fields.get("PR", ""),
        "status": fields.get("Status", ""), "closed": RELAY_CLOSE in body,
        "canonical": not problems, "problems": problems, "provenance": "claimed",
    }


def issue_relays(gh: GitHub, repo: str, issue: int, limit: int = 20) -> list[dict]:
    """Newest-last list of relay blocks from an issue's comments."""
    comments = gh.paginate(f"/repos/{repo}/issues/{issue}/comments", max_pages=10)
    out = []
    for c in comments:
        parsed = parse_relay(c.get("body") or "")
        if parsed:
            parsed.update({"comment_id": c.get("id"), "url": c.get("html_url", ""),
                           "created_at": c.get("created_at", ""),
                           "posted_by": (c.get("user") or {}).get("login", "")})
            out.append(parsed)
    return out[-limit:] if limit else out


# ---------------------------------------------------------------- shared output

def write_json(path: pathlib.Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def findings_doc(tool: str, branch: str, sha: str, findings: list[dict], **extra) -> dict:
    """pp-findings/v1 document (extra keys are optional additive fields)."""
    doc = {"schema": "pp-findings/v1", "tool": tool, "branch": branch, "sha": sha,
           "generated_at": now(), "findings": findings}
    doc.update(extra)
    return doc


def finding(rule: str, severity: str, message: str, file: str = "", line: int = 0) -> dict:
    assert severity in SEVERITIES
    return {"rule": rule, "severity": severity, "file": file, "line": line, "message": message}


def load_test_results(path: pathlib.Path) -> dict:
    data = json.loads(path.read_text("utf-8"))
    if data.get("schema") != "pp-test-results/v1" or not isinstance(data.get("results"), list):
        raise ToolError(f"{path} is not pp-test-results/v1")
    for r in data["results"]:
        if r.get("evidence_level") not in EVIDENCE_LEVELS or r.get("status") not in TEST_STATUSES:
            raise ToolError(f"{path}: invalid evidence_level/status in {r.get('name')!r}")
    return data


def load_findings(path: pathlib.Path) -> dict:
    data = json.loads(path.read_text("utf-8"))
    if data.get("schema") != "pp-findings/v1" or not isinstance(data.get("findings"), list):
        raise ToolError(f"{path} is not pp-findings/v1")
    return data


def guard_script(name: str) -> pathlib.Path | None:
    """Path to a ChatGPT-owned guard tool, or None when it is not in this checkout."""
    p = GUARD / name
    return p if p.is_file() else None


def import_guardlib():
    """Import ChatGPT-owned tools/guard/guardlib.py (read-only reuse, never edited here)."""
    if not (GUARD / "guardlib.py").is_file():
        raise ToolError("tools/guard/guardlib.py not present in this checkout "
                        "(ownership checks need ChatGPT's guard tooling, PR #50)")
    if str(GUARD) not in sys.path:
        sys.path.insert(0, str(GUARD))
    import guardlib  # type: ignore
    return guardlib


def die(tool: str, exc: Exception, as_json: bool) -> int:
    doc = findings_doc(tool, "", "", [finding("tool-error", "blocker", str(exc))])
    if as_json:
        print(json.dumps(doc, indent=2))
    else:
        print(f"{tool}: error: {exc}", file=sys.stderr)
    return 2
