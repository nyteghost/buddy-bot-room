"""Offline tests for tools/core. No network, no credentials, no AI calls.

The lifecycle tests build a throwaway git repository with a SYNTHETIC agent
assignment and run the real scripts end to end against a fixture GitHub backend:
relay generate -> relay post -> relay parse -> verify-claim. They need the
ChatGPT-owned tools/guard (PR #50); without it they are skipped with a reason.
"""
from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import pplib  # noqa: E402

PY = [sys.executable, "-B"]
SHA_A = "a" * 40
GUARD_PRESENT = (ROOT / "tools" / "guard" / "guardlib.py").is_file()


class FakeGH:
    def __init__(self, routes):
        self.routes, self.calls = routes, 0

    def get(self, path, params=None):
        self.calls += 1
        return self.routes[path]


class RelayParsing(unittest.TestCase):
    CANON = ("intro\n<!-- pixel-pals-relay:v1 -->\nFrom: chatgpt-dev-tooling\nTo: owner\n"
             "Status: DONE\nBranch: chatgpt/dev-tooling\nBase: beta @ 099f0698bddc494a5cdfd819f0d32944a766e341\n"
             f"Commit: `{SHA_A}`\nPR: https://example/pull/50\n<!-- /pixel-pals-relay -->\nBranch: evil/branch\n")

    def test_canonical_block(self):
        r = pplib.parse_relay(self.CANON)
        self.assertTrue(r["canonical"], r["problems"])
        self.assertEqual(("chatgpt-dev-tooling", "chatgpt/dev-tooling", SHA_A),
                         (r["agent"], r["branch"], r["sha"]))
        self.assertEqual(("beta", "099f0698bddc494a5cdfd819f0d32944a766e341"), (r["base_ref"], r["base_sha"]))
        self.assertEqual("claimed", r["provenance"])

    def test_fields_outside_envelope_are_ignored(self):
        # Prose after the closing marker must not override the header.
        self.assertEqual("chatgpt/dev-tooling", pplib.parse_relay(self.CANON)["branch"])

    def test_legacy_block_without_close_marker_or_sha(self):
        body = ("<!-- pixel-pals-relay:v1 -->\nFrom: windows-desktop-developer\nStatus: READY\n"
                "Summary: head 6b3f6f7de794adba980bf6f59d1083474b2a7d0a\n\n## Details\nBranch: x\n")
        r = pplib.parse_relay(body)
        self.assertFalse(r["canonical"])
        self.assertEqual("", r["branch"])  # "Branch: x" is below the blank line, outside the header
        self.assertIn("no 40-character Commit/Exact commit/Exact SHA", r["problems"])

    def test_alternate_sha_labels_and_bad_agent(self):
        body = f"<!-- pixel-pals-relay:v1 -->\nFrom: Project Manager (acting QA)\nBranch: a/b\nExact SHA: {SHA_A}\n"
        r = pplib.parse_relay(body)
        self.assertEqual(SHA_A, r["sha"])
        self.assertFalse(r["canonical"])
        self.assertIn("From is missing or not an agent id", r["problems"])

    def test_short_or_uppercase_sha_is_not_canonical(self):
        for value in ("abc1234", SHA_A.upper(), SHA_A + "0"):
            body = f"<!-- pixel-pals-relay:v1 -->\nFrom: x\nBranch: a\nCommit: {value}\n"
            self.assertEqual("", pplib.parse_relay(body)["sha"], value)

    def test_no_block(self):
        self.assertIsNone(pplib.parse_relay("just a comment mentioning pixel-pals-relay:v1"))


class CiRollup(unittest.TestCase):
    def rollup(self, runs, statuses=()):
        gh = FakeGH({f"/repos/o/r/commits/{SHA_A}/check-runs": {"check_runs": runs},
                     f"/repos/o/r/commits/{SHA_A}/status": {"statuses": list(statuses)}})
        return pplib.ci_for_sha(gh, "o/r", SHA_A)

    @staticmethod
    def run_(name, status="completed", conclusion="success", sha=SHA_A):
        return {"name": name, "status": status, "conclusion": conclusion, "head_sha": sha, "html_url": ""}

    def test_states(self):
        self.assertEqual("pass", self.rollup([self.run_("a"), self.run_("b", conclusion="skipped")])["state"])
        self.assertEqual("fail", self.rollup([self.run_("a"), self.run_("b", conclusion="failure")])["state"])
        self.assertEqual("fail", self.rollup([self.run_("a", conclusion="cancelled")])["state"])
        self.assertEqual("pending", self.rollup([self.run_("a"), self.run_("b", "in_progress", None)])["state"])
        self.assertEqual("none", self.rollup([])["state"])
        self.assertEqual("fail", self.rollup([self.run_("a")], [{"state": "error", "context": "x"}])["state"])

    def test_check_run_for_other_sha_is_not_evidence(self):
        self.assertEqual("fail", self.rollup([self.run_("a", sha="b" * 40)])["state"])

    def test_ignored_check(self):
        gh = FakeGH({f"/repos/o/r/commits/{SHA_A}/check-runs": {"check_runs": [
            self.run_("verify-relay", conclusion="failure"), self.run_("test")]},
            f"/repos/o/r/commits/{SHA_A}/status": {"statuses": []}})
        self.assertEqual("pass", pplib.ci_for_sha(gh, "o/r", SHA_A, ignore=("verify-relay",))["state"])


class Schemas(unittest.TestCase):
    def test_test_results_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = pathlib.Path(tmp) / "r.json"
            p.write_text(json.dumps({"schema": "pp-test-results/v1", "results": [
                {"name": "x", "evidence_level": "unit", "status": "pass"}]}))
            self.assertEqual(1, len(pplib.load_test_results(p)["results"]))
            p.write_text(json.dumps({"schema": "pp-test-results/v1", "results": [
                {"name": "x", "evidence_level": "vibes", "status": "pass"}]}))
            with self.assertRaises(pplib.ToolError):
                pplib.load_test_results(p)

    def test_findings_doc_shape(self):
        d = pplib.findings_doc("verify-claim", "b", SHA_A, [pplib.finding("r", "info", "m")], verdict="VERIFIED")
        self.assertEqual({"schema", "tool", "branch", "sha", "generated_at", "findings", "verdict"}, set(d))
        self.assertEqual("pp-findings/v1", d["schema"])


def sh(cmd, cwd, env=None, check=True):
    p = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, env=env, timeout=120)
    if check and p.returncode not in (0, 1):
        raise AssertionError(f"{cmd} -> {p.returncode}\n{p.stdout}\n{p.stderr}")
    return p


@unittest.skipUnless(GUARD_PRESENT, "tools/guard (ChatGPT PR #50) not in this checkout; "
                                    "run in a tree that contains both halves")
class Lifecycle(unittest.TestCase):
    """Synthetic assignment -> handoff -> retrieval -> independent verification."""

    AGENT, BRANCH = "synthetic-dev", "synthetic/feature"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = pathlib.Path(self.tmp.name) / "repo"
        (self.repo / "tools").mkdir(parents=True)
        shutil.copytree(HERE, self.repo / "tools" / "core", ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copytree(ROOT / "tools" / "guard", self.repo / "tools" / "guard",
                        ignore=shutil.ignore_patterns("__pycache__"))
        # Synthetic assignment: the trusted policy lives on beta in this throwaway repo.
        policy = {"version": 1, "agents": {
            self.AGENT: {"branches": [self.BRANCH], "paths": ["app/**"]},
            "other-dev": {"branches": ["other/*"], "paths": ["infra/**"]}},
            "shared_readonly": ["docs/**"]}
        (self.repo / "ownership.yml").write_text("# synthetic test policy\n" + json.dumps(policy, indent=2))
        g = lambda *a: sh(["git", *a], self.repo)  # noqa: E731
        g("init", "-q", "-b", "beta")
        g("config", "user.email", "t@example.invalid")
        g("config", "user.name", "Test")
        (self.repo / "README.md").write_text("base\n")
        g("add", "-A")
        g("commit", "-q", "-m", "base")
        g("checkout", "-q", "-b", self.BRANCH)
        (self.repo / "app").mkdir()
        (self.repo / "app" / "feature.txt").write_text("work\n")
        g("add", "-A")
        g("commit", "-q", "-m", "feat: synthetic work")
        self.sha = sh(["git", "rev-parse", "HEAD"], self.repo).stdout.strip()
        self.fixtures = pathlib.Path(self.tmp.name) / "fixtures"
        self.fixtures.mkdir()
        self.env = {**os.environ, "PP_GH_FIXTURES": str(self.fixtures), "PP_REPO": "o/r"}
        self.write_routes()

    def tearDown(self):
        self.tmp.cleanup()

    def write_routes(self, conclusion="success", status="completed", files=None, run_sha=None,
                     compare_status="identical"):
        enc = urllib.parse.quote(self.BRANCH, safe="")
        files = files if files is not None else ["app/feature.txt"]
        routes = {
            "/repos/o/r/issues/37/comments": [],
            f"/repos/o/r/commits/{self.sha}": {"sha": self.sha, "commit": {
                "author": {"name": "Synthetic"}, "message": "feat: synthetic work"}},
            f"/repos/o/r/compare/{self.sha}...{enc}": {"status": compare_status, "ahead_by": 0,
                                                       "commits": []},
            f"/repos/o/r/commits/{self.sha}/check-runs": {"check_runs": [
                {"name": "test", "status": status, "conclusion": conclusion if status == "completed" else None,
                 "head_sha": run_sha or self.sha, "html_url": "fixture://run"}]},
            f"/repos/o/r/commits/{self.sha}/status": {"statuses": []},
            f"/repos/o/r/compare/beta...{self.sha}": {"files": [{"filename": f} for f in files]},
        }
        (self.fixtures / "routes.json").write_text(json.dumps(routes))

    def tool(self, name, *args):
        return sh(PY + [str(self.repo / "tools" / "core" / name), *args], self.repo, self.env, check=False)

    def publish_and_retrieve(self):
        # 1. developer runs its checks (self-reported evidence)
        r = self.tool("pp-test", "--preset", "desktop", "--cmd", "smoke:unit:git --version")
        self.assertEqual(0, r.returncode, r.stdout + r.stderr)
        results = self.repo / "tools" / "out" / "test-results.json"
        tr = json.loads(results.read_text())
        self.assertEqual((self.sha, False, "claimed"), (tr["sha"], tr["dirty"], tr["provenance"]))
        # 2. developer generates and publishes a handoff
        r = self.tool("relay", "generate", "--from", self.AGENT, "--to", "qa", "--status", "READY",
                      "--test-results", str(results), "--output", "tools/out/msg.md")
        self.assertEqual(0, r.returncode, r.stderr)
        self.assertIn(f"Commit: {self.sha}", r.stdout)
        self.assertIn("1 pass / 0 fail", r.stdout)
        self.assertIn("Pushed:** NO", r.stdout)  # honest: nothing was pushed in this synthetic repo
        r = self.tool("relay", "post", "--file", "tools/out/msg.md", "--confirm")
        self.assertEqual(0, r.returncode, r.stderr)
        # 3. another agent retrieves it
        r = self.tool("relay", "parse", "--json", "--canonical-only")
        relays = json.loads(r.stdout)["relays"]
        self.assertEqual(1, len(relays))
        got = relays[0]
        self.assertEqual((self.AGENT, self.BRANCH, self.sha, "claimed"),
                         (got["agent"], got["branch"], got["sha"], got["provenance"]))
        return got, results

    def verify(self, got, *extra):
        r = self.tool("verify-claim", "--branch", got["branch"], "--sha", got["sha"],
                      "--agent", got["agent"], "--json", *extra)
        doc = json.loads(r.stdout)
        self.assertEqual("pp-findings/v1", doc["schema"])
        self.assertEqual("verify-claim", doc["tool"])
        return r.returncode, doc, {c["check"]: c for c in doc["checks"]}

    def test_full_lifecycle_verified(self):
        got, results = self.publish_and_retrieve()
        code, doc, checks = self.verify(got, "--test-results", str(results))
        self.assertEqual(0, code, json.dumps(doc, indent=2))
        self.assertEqual("VERIFIED", doc["verdict"])
        for name in ("assignment", "commit-exists", "on-branch", "ci-exact-sha", "file-ownership"):
            self.assertEqual(("verified", "independent"),
                             (checks[name]["status"], checks[name]["provenance"]), name)
        # self-reported tests never become "verified"
        self.assertEqual(("unverified", "claimed"),
                         (checks["claimed-tests"]["status"], checks["claimed-tests"]["provenance"]))

    def test_failed_ci(self):
        got, _ = self.publish_and_retrieve()
        self.write_routes(conclusion="failure")
        code, doc, checks = self.verify(got)
        self.assertEqual((1, "FAILED", "failed"), (code, doc["verdict"], checks["ci-exact-sha"]["status"]))

    def test_pending_ci_is_unverified_not_pass(self):
        got, _ = self.publish_and_retrieve()
        self.write_routes(status="in_progress")
        code, doc, checks = self.verify(got)
        self.assertEqual((1, "UNVERIFIED", "unverified"), (code, doc["verdict"], checks["ci-exact-sha"]["status"]))

    def test_ci_from_another_sha_is_rejected(self):
        got, _ = self.publish_and_retrieve()
        self.write_routes(run_sha="b" * 40)
        code, doc, checks = self.verify(got)
        self.assertEqual((1, "failed"), (code, checks["ci-exact-sha"]["status"]))

    def test_out_of_scope_and_policy_tampering(self):
        got, _ = self.publish_and_retrieve()
        self.write_routes(files=["app/feature.txt", "infra/deploy.sh", "ownership.yml", "docs/x.md"])
        code, doc, checks = self.verify(got)
        self.assertEqual((1, "FAILED", "failed"), (code, doc["verdict"], checks["file-ownership"]["status"]))
        bad = {f["file"] for f in doc["findings"] if f["rule"] in ("out-of-scope", "readonly-shared")}
        self.assertEqual({"infra/deploy.sh", "ownership.yml", "docs/x.md"}, bad)

    def test_commit_not_on_branch(self):
        got, _ = self.publish_and_retrieve()
        self.write_routes(compare_status="diverged")
        code, doc, checks = self.verify(got)
        self.assertEqual((1, "failed"), (code, checks["on-branch"]["status"]))

    def test_agent_not_assigned_to_branch(self):
        got, _ = self.publish_and_retrieve()
        got = dict(got, agent="other-dev")
        code, doc, checks = self.verify(got)
        self.assertEqual((1, "failed", "unverified"),
                         (code, checks["assignment"]["status"], checks["file-ownership"]["status"]))

    def test_stale_test_results(self):
        got, results = self.publish_and_retrieve()
        data = json.loads(results.read_text())
        data["sha"] = "c" * 40
        results.write_text(json.dumps(data))
        code, doc, checks = self.verify(got, "--test-results", str(results))
        self.assertEqual((1, "failed"), (code, checks["claimed-tests"]["status"]))

    def test_pp_test_only_keeps_custom_checks_and_records_not_run(self):
        # security-lint (ChatGPT tool) runs for real against the synthetic branch
        r = self.tool("pp-test", "--only", "security-lint", "--cmd", "extra:static:git --version",
                      "--cmd", "missing:unit:definitely-not-installed-xyz", "--output", "tools/out/t.json")
        doc = json.loads((self.repo / "tools" / "out" / "t.json").read_text())
        by = {x["name"]: x for x in doc["results"]}
        self.assertEqual({"security-lint", "extra", "missing"}, set(by))
        self.assertEqual("pass", by["security-lint"]["status"])
        self.assertEqual("pass", by["extra"]["status"])
        self.assertEqual("not_run", by["missing"]["status"])
        self.assertIn("not installed", by["missing"]["reason"])
        self.assertEqual(0, r.returncode, r.stdout)
        self.assertEqual(2, self.tool("pp-test", "--only", "nope").returncode)

    def test_dirty_tree_is_flagged(self):
        (self.repo / "app" / "feature.txt").write_text("uncommitted\n")
        self.tool("pp-test", "--preset", "desktop", "--cmd", "x:unit:git --version", "--output", "tools/out/d.json")
        self.assertTrue(json.loads((self.repo / "tools" / "out" / "d.json").read_text())["dirty"])

    def test_invalid_sha_is_tool_error(self):
        r = self.tool("verify-claim", "--branch", self.BRANCH, "--sha", "abc", "--agent", self.AGENT, "--json")
        self.assertEqual(2, r.returncode)
        self.assertEqual("tool-error", json.loads(r.stdout)["findings"][0]["rule"])

    def test_post_refuses_non_canonical_and_defaults_to_dry_run(self):
        msg = self.repo / "tools" / "out" / "bad.md"
        msg.parent.mkdir(parents=True, exist_ok=True)
        msg.write_text("<!-- pixel-pals-relay:v1 -->\nFrom: x\n<!-- /pixel-pals-relay -->\n")
        self.assertEqual(2, self.tool("relay", "post", "--file", str(msg), "--confirm").returncode)
        good = self.repo / "tools" / "out" / "good.md"
        good.write_text(f"<!-- pixel-pals-relay:v1 -->\nFrom: x\nBranch: a\nCommit: {SHA_A}\n"
                        "<!-- /pixel-pals-relay -->\n")
        self.assertEqual(0, self.tool("relay", "post", "--file", str(good)).returncode)
        self.assertFalse((self.fixtures / "posted.json").exists())


if __name__ == "__main__":
    unittest.main()
