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
  catch (e) { problems.push(`${name}: ${String(e?.stack || e).slice(0, 1800)}`); notes.push(`FAIL ${name}`); }
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
    if (await boxes.count() > 3) await boxes.nth(3).fill(process.env.SMOKE_SETUP_CODE || "");
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
await step("two chat rooms retain all six conversation styles", async () => {
  const sidebar = page.locator(".workspace-sidebar");
  const my = sidebar.locator(".sidebar-item", { hasText: /^\s*My Pals\s*$/i });
  const lounge = sidebar.locator(".sidebar-item", { hasText: /^\s*Pal Lounge\s*$/i });
  await my.waitFor();
  if (await my.getAttribute("aria-pressed") !== "true") await my.click();
  if (await sidebar.locator(".sidebar-item", { hasText: /^\s*Roundtable\s*$/i }).count()) {
    throw Error("Legacy chat modes are still in the main sidebar.");
  }
  const first = page.getByRole("group", { name: "My Pals conversation style" });
  await first.getByRole("button", { name: "Ask naturally" }).waitFor();
  await first.getByRole("button", { name: "One Pal" }).click();
  await first.getByRole("button", { name: "Solve together" }).click();
  await first.getByRole("button", { name: "Ask naturally" }).click();
  const quick = page.getByRole("group", { name: "My Pals quick actions" });
  await quick.getByRole("button", { name: "Brain Dump" }).click();
  const dump = page.getByRole("region", { name: "Brain Dump" });
  await dump.getByRole("textbox", { name: "Brain dump tasks" }).waitFor();
  const todayButton = sidebar.locator(".sidebar-item", { hasText: /^\s*Today\s*$/i });
  if (await todayButton.getAttribute("aria-pressed") === "true") await todayButton.click();
  await lounge.click();
  const options = page.getByRole("group", { name: "Pal Lounge conversation style" });
  await options.getByRole("button", { name: "Roundtable" }).waitFor();
  await options.getByRole("button", { name: "Independent answers" }).click();
  await options.getByRole("button", { name: "Debate" }).click();
  await options.getByRole("button", { name: "Roundtable" }).click();
  if (await first.getByRole("button", { name: "Ask naturally" }).getAttribute("aria-pressed") !== "true") throw Error("My Pals changed while switching Pal Lounge");
  await lounge.click(); // close the optional room, keep My Pals open
  if (await my.getAttribute("aria-pressed") !== "true") throw Error("Closing Pal Lounge closed My Pals");
});

// Focus Assist browser regression: one action, smaller step, optional timer and resume.
await step("Just Start opens and remembers progress", async () => {
  await page.route("**/api/just-start", async (route) => {
    const request = route.request().postDataJSON();
    const reply = request.action === "smaller" ? "Locate the schedule file." : "Open tomorrow's show schedule.";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ step: reply, source: "local-ai" }) });
  });
  await page.locator(".workspace-sidebar .sidebar-item", { hasText: /^\s*Just Start\s*$/i }).click();
  const dialog = page.getByRole("dialog", { name: "Just Start" });
  await dialog.waitFor({ state: "visible" });
  await dialog.getByRole("textbox", { name: "What are you trying to start?" }).fill("Finish tomorrow's show schedule");
  await dialog.getByRole("button", { name: "Help me start" }).click();
  await dialog.getByText("Open tomorrow's show schedule.").waitFor({ timeout: 10000 });
  await dialog.getByText("Step 1", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Smaller step" }).click();
  await dialog.getByText("Locate the schedule file.").waitFor({ timeout: 10000 });
  await dialog.getByText("Step 1", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "I started" }).click();
  const wins = dialog.getByRole("region", { name: "Tiny wins" });
  await wins.getByText(/You showed up/).waitFor();
  await wins.getByRole("button", { name: "See wins" }).click();
  await wins.getByRole("list", { name: "Recent small actions" }).waitFor();
  await wins.getByRole("button", { name: "Hide wins" }).click();
  await dialog.getByText(/You started. That counts/).waitFor();
  await dialog.getByText("Step 2", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Try a different step" }).click();
  await dialog.getByText("Step 2", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "One more small step" }).click();
  await dialog.getByText("Step 3", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Optional 2-minute timer" }).click();
  await dialog.getByRole("button", { name: "Stop timer" }).waitFor();
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Just Start" }).first().click();
  const restored = page.getByRole("dialog", { name: "Just Start" });
  await restored.getByText(/You started. That counts/).waitFor();
  await restored.getByText("Step 3", { exact: true }).waitFor();
  await restored.getByRole("button", { name: "New start" }).click();
  if (await restored.getByRole("textbox", { name: "What are you trying to start?" }).inputValue()) throw Error("New start failed to clear task");
  await restored.getByRole("button", { name: "Close" }).click();
  await page.unroute("**/api/just-start");
});
await step("Focus Assist body double and saved checkpoint", async () => {
  await page.route("**/api/just-start", async (route) => {
    const request = route.request().postDataJSON();
    const step = request.action === "next" ? "Check the next event." : "Open tomorrow's schedule.";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ step, source: "local-ai" }) });
  });
  await page.getByRole("button", { name: "Just Start" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Just Start" });
  await dialog.getByRole("textbox", { name: "What are you trying to start?" }).fill("Review tomorrow's schedule");
  await dialog.getByRole("button", { name: "Help me start" }).click();
  await dialog.getByRole("button", { name: "I started" }).click();
  await dialog.getByText("Step 2", { exact: true }).waitFor();
  await dialog.getByRole("combobox", { name: "Your work buddy" }).selectOption("byte");
  await dialog.getByRole("button", { name: "Stay with me" }).click();
  const companion = page.getByRole("complementary", { name: "Focus Assist work companion" });
  await companion.getByText(/Review tomorrow's schedule/).waitFor();
  await companion.getByRole("region", { name: "Tiny wins" }).waitFor();
  await companion.getByText(/Step 2 · Your next tiny step/).waitFor();
  const roomEntry = page.locator(".workspace-sidebar .sidebar-item", { hasText: /^\s*Pal Room\s*$/i });
  if (await roomEntry.getAttribute("aria-pressed") !== "true") await roomEntry.click();
  const activity = page.getByRole("region", { name: "Pal Room activities" });
  await activity.getByText(/Byte is working beside you/).waitFor();
  await activity.getByRole("button", { name: "Break together" }).click();
  await activity.getByRole("button", { name: "I'm back" }).waitFor();
  if (await companion.getByRole("button", { name: "Done with step" }).isEnabled()) throw Error("Work step wasn't paused during a break");
  await activity.getByRole("button", { name: "I'm back" }).click();
  await activity.getByText(/Byte is working beside you/).waitFor();
  await companion.getByRole("button", { name: "Done with step" }).click();
  await activity.getByRole("region", { name: "Tiny wins" }).getByText(/You showed up/).waitFor();
  await roomEntry.click();
  await companion.getByText("Check the next event.").waitFor();
  await companion.getByText(/Step 3 · Your next tiny step/).waitFor();
  await companion.getByRole("button", { name: "Save my place" }).click();
  await companion.getByRole("button", { name: "Pause companion" }).click();
  const checkpoint = page.getByRole("complementary", { name: "Saved Focus Assist checkpoint" });
  await checkpoint.getByRole("button", { name: /Resume with/ }).click();
  await companion.getByText("Check the next event.").waitFor();
  await companion.getByText(/Step 3 · Your next tiny step/).waitFor();
  await companion.getByRole("button", { name: "Finish & clear" }).click();
  if (await checkpoint.count()) throw Error("Companion checkpoint was not cleared");
  await page.unroute("**/api/just-start");
});

await step("Living Pal Room task board, quick start, and calm/playful controls", async () => {
  const roomItem = page.locator(".workspace-sidebar .sidebar-item", { hasText: /^\s*Pal Room\s*$/i });
  if (await roomItem.getAttribute("aria-pressed") !== "true") await roomItem.click();
  const mood = page.getByRole("region", { name: "Pal Room activities" });
  const board = page.getByRole("region", { name: "Living Task Board" });
  await board.getByRole("button", { name: "Add a thought" }).click();
  const dump = page.getByRole("region", { name: "Brain Dump" });
  await dump.getByRole("textbox", { name: "Brain dump tasks" }).fill("Organize the garage");
  await dump.getByRole("button", { name: "Capture thoughts" }).click();
  await board.getByRole("button", { name: "Start: Organize the garage" }).waitFor();
  await board.getByRole("button", { name: "Start: Organize the garage" }).click();
  const dialog = page.getByRole("dialog", { name: "Just Start" });
  await dialog.getByRole("textbox", { name: "What are you trying to start?" }).waitFor();
  if (await dialog.getByRole("textbox", { name: "What are you trying to start?" }).inputValue() !== "Organize the garage") {
    throw Error("Living Task Board did not preload the selected task");
  }
  await dialog.getByRole("button", { name: "Close" }).click();
  await mood.getByRole("button", { name: "Switch Pal Room to Playful" }).click();
  await mood.getByRole("group", { name: "What the Pals are doing" }).getByText(/Tinkering with a computer/).waitFor();
  if (await page.evaluate(() => localStorage.getItem("pixel-pals-room-playful-v1")) !== "1") throw Error("Playful preference wasn't saved");
  await mood.getByRole("button", { name: "Switch Pal Room to Calm" }).click();
  if (await mood.getByRole("group", { name: "What the Pals are doing" }).count()) throw Error("Calm mode kept the activity list visible");
  await roomItem.click();
});

await step("Just Start fallback handles swingset as three distinct numbered steps", async () => {
  await page.route("**/api/just-start", async (route) => {
    const request = route.request().postDataJSON();
    const number = request.stepNumber ?? 1;
    const steps = [
      "Find the assembly manual and place it next to the parts.",
      "Lay out the pieces where you can see them, without assembling anything yet.",
      "Separate the bolts, washers, and brackets into small groups.",
    ];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ step: steps[Math.min(number - 1, 2)], source: "quick-start" }) });
  });
  await page.locator(".workspace-sidebar .sidebar-item", { hasText: /^\s*Just Start\s*$/i }).click();
  const dialog = page.getByRole("dialog", { name: "Just Start" });
  await dialog.getByRole("textbox", { name: "What are you trying to start?" }).fill("Build a swingset");
  await dialog.getByRole("button", { name: "Help me start" }).click();
  await dialog.getByText("Step 1", { exact: true }).waitFor();
  await dialog.getByText(/Find the assembly manual/).waitFor();
  await dialog.getByText(/What counts as done/).waitFor();
  await dialog.getByRole("button", { name: "I started" }).click();
  await dialog.getByText("Step 2", { exact: true }).waitFor();
  await dialog.getByText(/Lay out the pieces/).waitFor();
  await dialog.getByRole("button", { name: "One more small step" }).click();
  await dialog.getByText("Step 3", { exact: true }).waitFor();
  await dialog.getByText(/Separate the bolts/).waitFor();
  await dialog.getByRole("button", { name: "New start" }).click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.unroute("**/api/just-start");
});

await step("expand the sidebar More group", async () => {
  const more = page.locator(".sidebar-item", { hasText: /^\s*More tools\s*$/i }).first();
  if (await more.count()) await more.click({ timeout: 8000 });
});
await step("Today future overview and important Brain Dump alert", async () => {
  await page.route("**/api/reminders", async (route) => {
    const body = route.request().postDataJSON();
    if (body.op === "add-at") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "abc12345", text: "Alert scheduled.", items: [] }) });
    } else if (body.op === "cancel") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "Alert cancelled.", items: [] }) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
    }
  });
  const todayItem = page.locator(".workspace-sidebar .sidebar-item", { hasText: /^\s*Today\s*$/i });
  if (await todayItem.getAttribute("aria-pressed") !== "true") await todayItem.click();
  const overview = page.getByRole("navigation", { name: "Day overview" });
  await overview.getByRole("button", { name: "Tomorrow" }).click();
  await overview.getByRole("button", { name: "Day after" }).click();
  await overview.getByRole("button", { name: "Today" }).click();
  const dump = page.getByRole("region", { name: "Brain Dump" });
  await dump.getByRole("textbox", { name: "Brain dump tasks" }).fill("Review next week's show schedule");
  await dump.getByRole("button", { name: "Capture thoughts" }).click();
  await dump.getByRole("checkbox", { name: "Important: Review next week's show schedule" }).check();
  const future = await page.evaluate(() => {
    const dt = new Date(Date.now() + 5 * 86_400_000);
    dt.setHours(10, 0, 0, 0);
    const pad = (v) => String(v).padStart(2, "0");
    return dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate()) + "T10:00";
  });
  await dump.getByLabel("Alert time: Review next week's show schedule").fill(future);
  await dump.getByRole("button", { name: "Set alert" }).click();
  await dump.getByText(/Alert set:/).waitFor();
  await dump.getByRole("checkbox", { name: "Done: Review next week's show schedule" }).click();
  await dump.getByText(/Marked done/).waitFor();
  // Natural-language date/time capture must appear in tomorrow, not today.
  await dump.getByRole("textbox", { name: "Brain dump tasks" }).fill("Pick up Kids @5pm, Tomorrow");
  await dump.getByRole("button", { name: "Capture thoughts" }).click();
  await dump.getByRole("checkbox", { name: "Important: Pick up Kids" }).check();
  await dump.getByText(/Alert set:/).waitFor();
  await overview.getByRole("button", { name: "Tomorrow" }).click();
  await page.getByRole("button", { name: /Pick up Kids/ }).first().waitFor();
  await dump.getByRole("checkbox", { name: "Done: Pick up Kids" }).click();
  await page.unroute("**/api/reminders");
});


for (const label of WINDOWS) {
  await step(`open "${label}"`, async () => {
    const item = page.locator(".sidebar-item", { hasText: new RegExp(`^\\s*${label}\\s*$`, "i") }).first();
    if (!(await item.count())) throw new Error("no such sidebar item");
    await item.click({ timeout: 8000 });
    await page.waitForTimeout(1500);
  });
}

// ---- Documents window: real PDF and spreadsheet files through the built-in viewers ----
function makePdf(texts) {
  const objs = [];
  const n = texts.length;
  const font = 3 + n * 2;
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${texts.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`;
  texts.forEach((t, i) => {
    const id = 3 + i * 2;
    objs[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${id + 1} 0 R >>`;
    const stream = `BT /F1 36 Tf 72 700 Td (${t}) Tj ET`;
    objs[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objs[font] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let out = "%PDF-1.4\n"; const offs = [];
  for (let i = 1; i < objs.length; i++) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offs.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
async function openDocuments() {
  const item = page.locator(".sidebar-item", { hasText: /^\s*Documents\s*$/i }).first();
  if (!(await item.count())) throw new Error("no Documents sidebar item");
  await item.click({ timeout: 8000 });
  await page.getByTestId("doc-input").waitFor({ state: "attached", timeout: 10000 });
}
async function backToDocuments() {
  const back = page.getByRole("button", { name: /^\s*Back\s*$/ }).first();
  if (await back.count()) await back.click();
  await page.getByTestId("doc-input").waitFor({ state: "attached", timeout: 10000 });
}
await step("Documents: open a PDF, see its pages and text", async () => {
  await openDocuments();
  await page.getByTestId("doc-input").setInputFiles({ name: "smoke.pdf", mimeType: "application/pdf", buffer: makePdf(["Hello Pixel Pals viewer", "Second page marker"]) });
  await page.locator('canvas[aria-label="Page 1"]').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".pp-textlayer")].some((e) => /Hello Pixel Pals/.test(e.textContent || "")), null, { timeout: 30000 });
  const ink = await page.evaluate(() => {
    const c = document.querySelector('canvas[aria-label="Page 1"]');
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128 && d[i + 1] < 128 && d[i + 2] < 128) dark++;
    return dark;
  });
  if (ink < 50) throw new Error(`page 1 canvas looks blank (${ink} dark pixels)`);
  const total = await page.getByText(/^of 2$/).count();
  if (!total) throw new Error("page count not shown");
});
await step("Documents: search a PDF and jump to the match", async () => {
  await page.getByRole("button", { name: "Search in document" }).click();
  await page.getByLabel("Search the document").fill("marker");
  await page.getByText(/1 of 1/).first().waitFor({ timeout: 20000 });
  await page.locator('canvas[aria-label="Page 2"]').waitFor({ timeout: 20000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".pp-hit")].some((e) => /marker/i.test(e.textContent || "")), null, { timeout: 20000 });
});
await step("Documents: zoom, thumbnails and fit controls work", async () => {
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Page thumbnails" }).click();
  await page.getByRole("button", { name: "Go to page 2" }).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Fit page" }).click();
  await page.getByRole("button", { name: "Fit width" }).click();
});
await step("Documents: a PDF that is not a PDF gives a plain message", async () => {
  await backToDocuments();
  await page.getByTestId("doc-input").setInputFiles({ name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("this is not a pdf at all") });
  await page.getByRole("alert").filter({ hasText: /readable PDF|Couldn't open/ }).waitFor({ timeout: 20000 });
});
await step("Documents: open a CSV as a grid", async () => {
  await backToDocuments();
  await page.getByTestId("doc-input").setInputFiles({ name: "parts.csv", mimeType: "text/csv", buffer: Buffer.from("name,qty\nBolts,10\nNuts,7\n") });
  await page.locator('[data-cell="B2"]').waitFor({ timeout: 30000 });
  const t = (await page.locator('[data-cell="B2"]').textContent())?.trim();
  if (t !== "10") throw new Error(`B2 shows ${JSON.stringify(t)}`);
  await page.getByLabel("Search the sheet").fill("nuts");
  await page.getByText(/1 of 1/).first().waitFor({ timeout: 10000 });
  await page.getByLabel("Go to cell").fill("B3");
  await page.getByLabel("Go to cell").press("Enter");
  await page.locator('[data-cell="B3"][aria-selected="true"]').waitFor({ timeout: 10000 });
});
await step("Documents: open an .xlsx in the worker (sheets, merges, frozen header)", async () => {
  await backToDocuments();
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Budget", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(["Item", "Cost"]); ws.addRow(["Chairs", 1234.5]); ws.getCell("B2").numFmt = "$#,##0.00";
  for (let i = 3; i <= 400; i++) ws.addRow([`Row ${i}`, i]);
  ws.mergeCells("D2:E3"); ws.getCell("D2").value = "Merged";
  wb.addWorksheet("Second").getCell("A1").value = "On sheet two";
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  await page.getByTestId("doc-input").setInputFiles({ name: "budget.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
  await page.locator('[data-cell="B2"]').waitFor({ timeout: 30000 });
  const money = (await page.locator('[data-cell="B2"]').textContent())?.trim();
  if (money !== "$1,234.50") throw new Error(`B2 shows ${JSON.stringify(money)}`);
  if (!(await page.locator('[data-cell="D2"]').count())) throw new Error("merged cell missing");
  // Scroll far down: only nearby rows are drawn, and the frozen header stays.
  await page.getByTestId("sheet-scroller").evaluate((el) => { el.scrollTop = 7000; });
  await page.locator('[data-cell="A300"]').waitFor({ timeout: 10000 });
  if (await page.locator('[data-cell="A20"]').count()) throw new Error("rows far above the window are still drawn");
  if (!(await page.locator('[data-cell="A1"]').count())) throw new Error("frozen header row not drawn after scrolling");
  await page.getByRole("tab", { name: "Second" }).click();
  await page.locator('[data-cell="A1"]', { hasText: "On sheet two" }).waitFor({ timeout: 10000 });
});
await step("Documents: a non-document file is refused politely", async () => {
  await backToDocuments();
  await page.getByTestId("doc-input").setInputFiles({ name: "photo.zip", mimeType: "application/zip", buffer: Buffer.from("PK") });
  await page.getByText(/can't be viewed here/).waitFor({ timeout: 10000 });
});
await step("workspace sidebar has no horizontal overflow", async () => {
  const bar = page.locator(".workspace-sidebar");
  const size = await bar.evaluate((e) => ({ content: e.scrollWidth, visible: e.clientWidth }));
  if (size.content > size.visible + 2) throw new Error(`sidebar scrolls sideways: ${size.content} > ${size.visible}`);
});
await step("workspace layouts save, switch, and restore the open windows", async () => {
  const picker = page.getByRole("combobox", { name: "Workspace layout" });
  await picker.selectOption("mail");
  await page.locator('[data-window-id="mail"]').waitFor({ state: "visible" });
  await picker.selectOption("work");
  await page.locator('[data-window-id="tools"]').waitFor({ state: "visible" });
  await page.locator('[data-window-id="documents"]').waitFor({ state: "visible" });
  await picker.selectOption("chat");
  await page.locator('[data-window-id="room"]').waitFor({ state: "visible" });
  await page.locator('[data-window-id="chat-my-pals"]').waitFor({ state: "visible" });
  if (await page.locator('[data-window-id="mail"]').isVisible()) throw new Error("Mail stayed open in Chat layout");
  await page.getByRole("button", { name: "Save current layout" }).click();
  await picker.selectOption("mail");
  await picker.selectOption("saved");
  await page.locator('[data-window-id="room"]').waitFor({ state: "visible" });
  if (await page.locator('[data-window-id="mail"]').isVisible()) throw new Error("Saved Chat layout did not restore");
});
await step("dragging a title bar against an edge snaps the window to half width", async () => {
  const picker = page.getByRole("combobox", { name: "Workspace layout" });
  await picker.selectOption("mail");
  const canvas = await page.locator(".window-canvas").boundingBox();
  const bar = await page.locator('[data-window-id="mail"] .window-titlebar').boundingBox();
  if (!canvas || !bar) throw new Error("workspace or Mail titlebar is missing");
  await page.mouse.move(bar.x + bar.width / 2, bar.y + 16);
  await page.mouse.down();
  await page.mouse.move(canvas.x + 5, canvas.y + Math.min(canvas.height / 3, 180), { steps: 12 });
  await page.mouse.up();
  const rect = await page.locator('[data-window-id="mail"]').boundingBox();
  if (!rect || Math.abs(rect.x - canvas.x) > 8 || Math.abs(rect.width - canvas.width / 2) > 12) {
    throw new Error(`Mail did not snap to left: ${JSON.stringify(rect)}`);
  }
});
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
