"""Offline policy/security unit tests; no GitHub credentials or AI inference needed."""
import importlib.machinery
import importlib.util
import pathlib
import tempfile
import unittest

from guardlib import GuardError, matches, normalize_path, policy, select_agent

FOLDER = pathlib.Path(__file__).resolve().parent

def load_script(name):
    loader = importlib.machinery.SourceFileLoader(name.replace("-", "_"), str(FOLDER / name))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module

class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.policy = policy()

    def test_all_agents_have_unique_exact_branch_mapping(self):
        for agent, item in self.policy["agents"].items():
            for branch in item["branches"]:
                if "*" not in branch:
                    self.assertEqual(agent, select_agent(self.policy, branch))

    def test_guard_does_not_match_unrelated_paths(self):
        self.assertTrue(matches("tools/guard/inner/check.py", "tools/guard/**"))
        self.assertFalse(matches("tools/core/relay", "tools/guard/**"))
        self.assertFalse(matches("tools/guarded/check", "tools/guard/**"))
        self.assertTrue(matches(".github/workflows/pp-relay-check.yml", ".github/workflows/pp-*.yml"))
        self.assertFalse(matches(".github/workflows/ci.yml", ".github/workflows/pp-*.yml"))
        self.assertFalse(matches(".github/workflows/pp-trick/evil.yml", ".github/workflows/pp-*.yml"))

    def test_scope_denies_wrong_branch_and_escape(self):
        with self.assertRaises(GuardError):
            select_agent(self.policy, "beta", "chatgpt-dev-tooling")
        with self.assertRaises(GuardError):
            normalize_path("../../secrets")
        with self.assertRaises(GuardError):
            normalize_path("C:\\secrets")
        self.assertEqual("src/foo.py", normalize_path("./src/foo.py"))

    def test_owned_paths_match_known_pr_assignments(self):
        examples = {
            "security-developer": ("src-tauri/src/main.rs", "tools/core/relay"),
            "linux-desktop-integration-developer": ("desktop-town/spikes/s1/src/main.rs", "desktop-town/spikes/s4/src/main.rs"),
            "rendering-performance-developer": (".github/workflows/s2-renderer.yml", ".github/workflows/ci.yml"),
            "windows-desktop-developer": ("desktop-town/spikes/s4/README.md", "src-tauri/src/main.rs"),
            "ai-inference-developer": ("desktop-town/spikes/s3/benchmark.py", "tools/core/verify-claim"),
            "chatgpt-dev-tooling": ("ownership.yml", "tools/CONTRACTS.md"),
            "claude-dev-tooling": ("tools/core/verify-claim", "tools/guard/security-lint")
        }
        for agent, (allowed, denied) in examples.items():
            pats = self.policy["agents"][agent]["paths"]
            self.assertTrue(any(matches(allowed, p) for p in pats), agent)
            self.assertFalse(any(matches(denied, p) for p in pats), agent)

    def test_malformed_policy_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "ownership.yml"
            path.write_text('{"version": 2, "agents": {}}')
            with self.assertRaises(GuardError):
                policy(path)

class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.linter = load_script("security-lint")

    def test_wildcard_origin_and_csp_are_flagged(self):
        items = self.linter.scan_text("example.env", 'OLLAMA_ORIGINS=*\n"csp": null\n')
        self.assertEqual({"wildcard-network-origin", "permissive-csp"}, {f["rule"] for f in items})
        self.assertEqual([1, 2], [x["line"] for x in items])

    def test_privileged_ipc_and_hardcoded_token(self):
        text = 'invoke_handler(tauri::generate_handler![pty_spawn, read_text]);\n' + 'api_key = "' + "a" * 32 + '"\n'
        items = self.linter.scan_text("src-tauri/src/main.rs", text)
        self.assertIn("native-privileged-ipc", {x["rule"] for x in items})
        self.assertIn("hardcoded-credential", {x["rule"] for x in items})
        self.assertNotIn("a" * 32, repr(items))

    def test_unrelated_source_clean(self):
        self.assertEqual([], self.linter.scan_text("src/lib/pal.ts", "const localOnly = true;\nconsole.log('ready');\n"))

    def test_file_bounds_and_sanitization(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "sample.ts"
            path.write_text('const password = "' + "z" * 40 + '";\n')
            findings = self.linter.scan_paths(["sample.ts"], pathlib.Path(tmp))
            self.assertEqual("hardcoded-credential", findings[0]["rule"])

if __name__ == "__main__":
    unittest.main()
