// Frontend profile (informational, never fails the build): seeds a long chat, then measures page size, typing latency and running animations.
// Run:  PW_PATH=/path/to/node_modules/playwright SMOKE_URL=http://localhost:8090 node tools/smoke/profile.mjs
// Numbers are printed as JSON lines; nothing is estimated. Typing latency = time from a keystroke to the next painted frame, measured in the page.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");
const URL_ = process.env.SMOKE_URL || "http://localhost:8090";
const USER = process.env.SMOKE_USER || "smoke";
const PASS = process.env.SMOKE_PASS || "Smoke-test-only-1";
const COUNT = Number(process.env.PROFILE_MESSAGES || 400);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const out = (k, v) => console.log(`PROFILE ${k} ${JSON.stringify(v)}`);

async function signIn() {
  await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 60000 });
  const boxes = page.locator("input");
  const create = page.getByRole("button", { name: /create account/i });
  const signin = page.getByRole("button", { name: /sign in/i });
  if (await create.count()) { await boxes.nth(0).fill(USER); await boxes.nth(1).fill(PASS); await boxes.nth(2).fill(PASS); await create.click(); }
  else if (await signin.count()) { await boxes.nth(0).fill(USER); await boxes.nth(1).fill(PASS); await signin.click(); }
  await page.locator("main").first().waitFor({ timeout: 45000 });
  await page.waitForTimeout(2500);
}

const body = (i) => `Message ${i}. Here is a **reply** with a list:\n\n- first point about the server\n- second point with \`inline code\`\n- third point\n\n\`\`\`bash\ndocker compose pull && docker compose up -d\n\`\`\`\n\n` + "More words to make the paragraph a realistic length. ".repeat(6);
const seed = (n) => {
  const agents = ["nova", "byte", "sage", "pip"];
  const list = [];
  for (let i = 0; i < n; i++) {
    const user = i % 5 === 0;
    list.push({ id: `seed-${i}`, role: user ? "user" : "assistant", metadata: user ? undefined : { agentId: agents[i % 4], characterMode: "normal", round: 1 }, parts: [{ type: "text", text: body(i) }] });
  }
  localStorage.setItem("pixel-pals-conversations-v2", JSON.stringify({ roundtable: list }));
};

async function measure(label) {
  const nodes = await page.evaluate(() => document.querySelectorAll("*").length);
  const rows = await page.locator(".room-message").count();
  const anim = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
  const typing = await page.evaluate(async () => {
    const ta = [...document.querySelectorAll(".workspace-composer textarea, textarea")].find((e) => e.offsetParent !== null);
    if (!ta) return null;
    ta.focus();
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    const times = [];
    let text = "";
    for (let i = 0; i < 40; i++) {
      text += "abcdefghij"[i % 10];
      const t0 = performance.now();
      set.call(ta, text);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      times.push(performance.now() - t0);
    }
    set.call(ta, ""); ta.dispatchEvent(new Event("input", { bubbles: true }));
    times.sort((a, b) => a - b);
    return { medianMs: +times[20].toFixed(1), p95Ms: +times[37].toFixed(1), maxMs: +times[39].toFixed(1) };
  });
  out(label, { domNodes: nodes, messageRows: rows, runningAnimations: anim, typing });
}

try {
  await signIn();
  await page.evaluate(seed, COUNT);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".room-message").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await measure(`chat-${COUNT}-window-default`);
  // Show every earlier message, which is what the page used to draw all the time.
  for (let i = 0; i < 20; i++) {
    const more = page.locator(".show-earlier");
    if (!(await more.count())) break;
    await more.first().click();
    await page.waitForTimeout(300);
  }
  await measure(`chat-${COUNT}-all-shown`);
  // Low-power mode: same page, decorative animations paused.
  await page.evaluate(() => localStorage.setItem("pixel-pals-lowpower-v1", "1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".room-message").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await measure(`chat-${COUNT}-window-default-lowpower`);
  await page.evaluate(() => { localStorage.removeItem("pixel-pals-lowpower-v1"); localStorage.removeItem("pixel-pals-conversations-v2"); });
} catch (e) {
  out("error", String(e && e.message || e).split("\n")[0]);
} finally {
  await browser.close();
}
