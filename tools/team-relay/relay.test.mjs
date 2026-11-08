import test from "node:test";
import assert from "node:assert/strict";
import { parseHandoff, trustedHandoff, renderBoard, BOARD_MARKER } from "./relay.mjs";

const envelope = [
  "<!-- pixel-pals-relay:v1 -->",
  "From: core",
  "To: pm, qa",
  "Status: ready-for-review",
  "Summary: Need review of draft PR #25",
  "Next: Review the tests",
  "<!-- /pixel-pals-relay -->"
].join("\n");

test("valid relay envelope routes only recognized roles", () => {
  const result = parseHandoff(envelope);
  assert.deepEqual(result, { from: "core", to: ["pm", "qa"], status: "ready-for-review" });
  assert.equal(parseHandoff(envelope.replace("From: core", "From: stranger")), null);
  assert.equal(parseHandoff(envelope.replace("Status: ready-for-review", "Status: execute")), null);
  assert.equal(parseHandoff(envelope.replace("Summary: Need review of draft PR #25", "Summary: ")), null);
  assert.equal(parseHandoff("From: core\nTo: pm\nStatus: complete\nSummary: ignored"), null);
});

test("only trusted human-authored handoffs enter the shared index", () => {
  const comment = { user: { login: "nyteghost", type: "User" }, body: envelope,
    html_url: "https://github.com/nyteghost/buddy-bot-room/issues/23#issuecomment-123",
    created_at: "2026-11-08T00:00:00Z", author_association: "OWNER" };
  assert.equal(trustedHandoff(comment, "nyteghost")?.from, "core");
  assert.equal(trustedHandoff({ ...comment, user: { login: "untrusted", type: "User" }, author_association: "NONE" }, "nyteghost"), null);
  assert.equal(trustedHandoff({ ...comment, user: { login: "github-actions[bot]", type: "Bot" } }, "nyteghost"), null);
  assert.equal(trustedHandoff({ ...comment, body: "random comment" }, "nyteghost"), null);
});

test("the board uses links, not the text of private or malicious reports", () => {
  const handoffs = [{ from: "artist", to: ["pm", "claude"], status: "blocked", time: "2026-11-08T00:00:00Z",
    url: "https://github.com/nyteghost/buddy-bot-room/issues/26#issuecomment-123",
    summary: "SENSITIVE SHOULD NEVER BE POSTED" }];
  const md = renderBoard({ handoffs, pulls: [{ number: 24, state: "open", draft: true, base: {ref: "beta"},
      head: {ref: "claude/living-universe-hd256", sha: "abc"}, title: "Living Universe", }],
    runs: [{ head_sha: "abc", status: "completed", conclusion: "success",
       html_url: "https://github.com/nyteghost/buddy-bot-room/actions/runs/123", created_at: "2026-11-08" }] });
  assert.ok(md.startsWith(BOARD_MARKER));
  assert.match(md, /#24 Living Universe/);
  assert.match(md, /blocked/);
  assert.match(md, /issues\/26#issuecomment-123/);
  assert.doesNotMatch(md, /SENSITIVE/);
  assert.doesNotMatch(md, /<script>/);
});

test("malformed URLs never become clickable links", () => {
  const md = renderBoard({ handoffs: [{ from: "qa", to: ["pm"], status: "progress", time: "2026-11-08", url: "javascript:alert(1)" }] });
  assert.doesNotMatch(md, /javascript/);
});
