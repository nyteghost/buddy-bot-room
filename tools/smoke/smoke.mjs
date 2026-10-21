// Browser smoke test: opens the built app, creates a throwaway account, clicks through the main windows and fails on
// any uncaught page error or console error. CI runs it against a fresh production build (see .github/workflows/ci.yml).
// Run it yourself:  PW_PATH=/path/to/node_modules/playwright SMOKE_URL=http://localhost:8090 node tools/smoke/smoke.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");

const URL_ = process.env.SMOKE_URL || "http://localhost:8090";
const USER = process.env.SMOKE_USER || "smoke";
const PASS = process.env.SMOKE_PASS || "Smoke-test-only-1";
// Windows to open from the sidebar (matched by visible text). Missing ones are reported, not fatal, so renames don't break CI.
const WINDOWS = ["Today", "Notes", "Calendar", "Work tools", "Playtests"];
// Console noise that is expected in a bare test environment (no Ollama, no internet-only services, no favicon).
const IGNORE = [/favicon/i, /Failed to load resource/i, /ERR_CONNECTION/i, /ERR_NAME_NOT_RESOLVED/i, /net::ERR/i, /ollama/i, /WebSocket/i];

const problems = [];
const notes = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (!IGNORE.some((r) => r.test(t))) problems.push(`console error: ${t.slice(0, 300)}`);
});

async function step(name, fn) {
  try { await fn(); notes.push(`ok   ${name}`); }
  catch (e) { problems.push(`${name}: ${String(e.message).split("\n")[0]}`); notes.push(`FAIL ${name}`); }
}

await step("home page loads", async () => {
  const r = await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
  // The sign-in page is served with 401 before the first login; anything else that isn't OK is a real failure.
  if (!r || !(r.ok() || r.status() === 401)) throw new Error(`status ${r?.status()}`);
});
await step("create the first account", async () => {
  const create = page.getByRole("button", { name: /create account/i });
  if (await create.count()) {
    const boxes = page.locator("input");
    await boxes.nth(0).fill(USER);
    await boxes.nth(1).fill(PASS);
    await boxes.nth(2).fill(PASS);
    await create.click();
  } else {
    const signIn = page.getByRole("button", { name: /sign in/i });
    if (await signIn.count()) {
      const boxes = page.locator("input");
      await boxes.nth(0).fill(USER);
      await boxes.nth(1).fill(PASS);
      await signIn.click();
    }
  }
  await page.locator("main").first().waitFor({ timeout: 45000 });
});
await page.waitForTimeout(3000);
// Some entries live under the sidebar's "More" group.
await step("expand the sidebar More group", async () => {
  const more = page.locator(".sidebar-item", { hasText: /^\s*More\s*$/i }).first();
  if (await more.count()) await more.click({ timeout: 8000 });
});
for (const label of WINDOWS) {
  await step(`open "${label}"`, async () => {
    const item = page.locator(".sidebar-item", { hasText: new RegExp(`^\\s*${label}\\s*$`, "i") }).first();
    if (!(await item.count())) throw new Error("no such sidebar item");
    await item.click({ timeout: 8000 });
    await page.waitForTimeout(1500);
  });
}
await step("planner file is served", async () => {
  const r = await page.request.get(`${URL_}/stage-planner.html`);
  if (!r.ok()) throw new Error(`status ${r.status()}`);
});
await step("health endpoint", async () => {
  const r = await page.request.get(`${URL_}/__health`);
  if (!r.ok()) throw new Error(`status ${r.status()}`);
});
await page.screenshot({ path: process.env.SMOKE_SHOT || "smoke.png", fullPage: false }).catch(() => undefined);
await browser.close();

console.log(notes.join("\n"));
if (problems.length) {
  console.log("\nProblems:\n" + problems.map((p) => ` - ${p}`).join("\n"));
  process.exit(1);
}
console.log("\nSmoke test passed.");
