// Browser smoke test: opens the built app, creates a throwaway account, clicks through the main windows and fails on
// any uncaught page error or console error. CI runs it against a fresh production build (see .github/workflows/ci.yml).
// Run it yourself:  PW_PATH=/path/to/node_modules/playwright SMOKE_URL=http://localhost:8090 node tools/smoke/smoke.mjs
import { createRequire } from "node:module";
import { hdCharacterSmokeZip } from "./hd-character-zip.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");

const URL_ = process.env.SMOKE_URL || "http://localhost:8090";
const USER = process.env.SMOKE_USER || "smoke";
const PASS = process.env.SMOKE_PASS || "Smoke-test-only-1";
// Windows to open from the sidebar (matched by visible text). Missing ones are reported, not fatal, so renames don't break CI.
const WINDOWS = ["Today", "Notes", "Calendar", "Legacy work tools", "Playtests"];
// Console noise that is expected in a bare test environment (no Ollama, no internet-only services, no favicon).
const IGNORE = [/favicon/i, /Failed to load resource/i, /ERR_CONNECTION/i, /ERR_NAME_NOT_RESOLVED/i, /net::ERR/i, /ollama/i, /WebSocket/i];

const problems = [];
const notes = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
// Browser checks use the local test server and controlled fixtures only.
await page.route("**/*", route => { const url = new globalThis.URL(route.request().url()); return [new globalThis.URL(URL_).origin].includes(url.origin) || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort(); });
page.on("pageerror", (e) => { problems.push(`page error: ${e.message}`); console.log(`Browser page error: ${e.stack || e.message}`); });
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (!IGNORE.some((r) => r.test(t))) problems.push(`console error: ${t.slice(0, 300)}`);
});

async function assistantResult(request) {
  // Inspect the application's final UI and durable receipt; CDP does not reliably retain stream bodies.
  await page.locator('.general-assistant .assistant-notice').filter({hasText:/^Answered with/}).waitFor();
  await page.getByTestId('assistant-stream-preview').waitFor({state:'hidden'});
  const id=request.postDataJSON().id;
  const saved=await (await page.request.get(URL_+'/api/assistant?id='+id)).json();
  const message=saved.conversation?.messages.at(-1);
  if(message?.role!=='assistant') throw Error('Streaming UI did not commit a completed assistant reply: '+JSON.stringify(saved));
  return { conversation:saved.conversation, web:message.metadata.web, route:saved.conversation.assistant.provider };
}

async function step(name, fn) {
  try { await fn(); notes.push(`ok   ${name}`); console.log(`ok   ${name}`); }
  catch (e) { await page.screenshot({path:"/tmp/pixel-smoke-failure.png"}).catch(()=>undefined); problems.push(`${name}: ${String(e?.stack || e).slice(0, 1800)}`); notes.push(`FAIL ${name}`); console.log(`FAIL ${name}: ${e.message}`); }
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
  await page.locator('.modular-workspace[aria-busy="false"]').waitFor({ timeout: 45000 });
});
await step("Today is the opening window on desktop and mobile", async () => {
  // A failed mobile assertion must not strand the rest of the desktop suite at phone width.
  try {
    for(const width of [1500,390]) {
      await page.setViewportSize({width,height:844});
      await page.goto(URL_);
      await page.locator('.modular-workspace[aria-busy="false"]').waitFor();
      const today=page.locator('[data-window-id="today"]');
      await today.waitFor({state:'visible'});
      if(await page.locator('.general-assistant').isVisible()) throw Error('General Chat replaced Today on startup');
      if(width===390) {
        // The mobile tab state is restored by a React effect after the workspace mounts.
        const home = page.locator('.mobile-tabbar button', {hasText:'Home'});
        await home.waitFor({state:'visible'});
        const selected = await page.waitForFunction(() => document.querySelector('.mobile-tabbar button:first-child')?.getAttribute('aria-pressed') === 'true',undefined,{timeout:12000}).catch(()=>null);
        if(!selected) throw Error('Home tab was not selected');
        await page.screenshot({path:process.env.SMOKE_TODAY_SHOT || '/tmp/pixel-today-home.png'});
      }
      // Do not toggle Today closed while verifying it starts open; that mutates saved UI state.
    }
  } finally {
    await page.setViewportSize({width:1500,height:900});
  }
});
await step("Adaptive Today launch, parking and cross-device persistence",async()=>{
  page.setDefaultTimeout(20000);
  await page.locator('.modular-workspace[aria-busy="false"]').waitFor();
  const home=page.locator('.workspace-sidebar .sidebar-item',{hasText:/^\s*Today\s*$/});
  if(await home.getAttribute('aria-pressed')!=='true')await home.evaluate(b=>b.click());
  const today=page.locator('[data-window-id="today"]');
  await today.getByText('Today at a glance',{exact:true}).waitFor();
  await today.getByText('Customize Today',{exact:true}).click();
  await today.getByLabel('Today mode',{exact:true}).selectOption('low');
  await page.waitForFunction(async()=>{const r=await fetch('/api/adaptive-today');return (await r.json()).adaptive.mode==='low';},undefined,{timeout:15000});console.log('adaptive mode saved');
  await today.getByRole('button',{name:'Move up Weather',exact:true}).click();
  await page.waitForFunction(async()=>{const r=await fetch('/api/adaptive-today');return (await r.json()).adaptive.sections.findIndex(s=>s.id==='weather')===5;},undefined,{timeout:15000});console.log('adaptive order saved');
  await today.getByText('Customize Today',{exact:true}).click();
  await today.getByRole('button',{name:"I'm Stuck",exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'One tiny action is enough'});
  await dialog.getByRole('button',{name:'Make it easier',exact:true}).click();
  await dialog.getByRole('button',{name:'Start this small step',exact:true}).click();
  const companion=page.getByRole('complementary',{name:'Focus Assist work companion'});
  await companion.waitFor();
  await page.waitForFunction(async()=>{const r=await fetch('/api/adaptive-today');return (await r.json()).adaptive.checkpoints.length===1;},undefined,{timeout:15000});console.log('adaptive checkpoint saved');
  await companion.getByRole('button',{name:'Park a thought',exact:true}).click();
  const parking=page.getByRole('dialog',{name:'Park this thought'});
  await parking.getByLabel('Thought to park',{exact:true}).fill('Synthetic parked thought');
  await parking.getByRole('button',{name:'Save and return',exact:true}).click();
  await parking.waitFor({state:'hidden'});
  if(!await companion.isVisible())throw Error('Parking abandoned focus');
  const second=await browser.newContext({storageState:await page.context().storageState()});
  const saved=await (await second.request.get(URL_+'/api/adaptive-today')).json();
  if(saved.adaptive.mode!=='low'||saved.adaptive.checkpoints.length!==1)throw Error('Second device lost preferences or checkpoint');
  await second.close();
  await page.request.post(URL_+'/api/adaptive-today',{data:{op:'delete',revision:saved.adaptive.revision,id:saved.adaptive.checkpoints[0].id}});
  const fresh=await (await page.request.get(URL_+'/api/adaptive-today')).json();
  const order=['focus','calendar','tasks','memory','parking','brain-dump','weather','mail','tonight','watch-queue'];
  await page.request.post(URL_+'/api/adaptive-today',{data:{op:'preferences',revision:fresh.adaptive.revision,patch:{mode:'normal',sections:order.map(id=>({id,hidden:false,collapsed:id==='memory'||id==='parking'}))}}});
  await page.evaluate(()=>localStorage.removeItem('pixel-pals-focus-checkpoint-v1'));
  await page.goto(URL_);await page.locator('.modular-workspace[aria-busy="false"]').waitFor();
});
// A previous adaptive-Today action can still finish its client-side navigation.
// Playwright reports ERR_ABORTED when that navigation supersedes a goto; retry
// only that transient case and require the real workspace-ready assertion.
for (let attempt = 0; attempt < 3; attempt++) {
  try {
    await page.goto(URL_ + "/?workspace=1", { waitUntil: "domcontentloaded" });
    break;
  } catch (error) {
    if (!String(error).includes("net::ERR_ABORTED") || attempt === 2) throw error;
    await page.waitForTimeout(350);
  }
}
await page.locator('.modular-workspace[aria-busy="false"]').waitFor({ timeout: 45000 });
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
  const helpRequests = [];
  await page.route("**/api/focus-help", async route => {
    const body = route.request().postDataJSON(); helpRequests.push(body.choice);
    const text = body.choice === "smaller" ? "Look at the schedule title." : body.choice === "sample" ? "Sample: Event name — start time — question to check." : "Read only the first event. One detail is enough.";
    await route.fulfill({ json: { choice: body.choice, text, source: "local-ai" } });
  });
  const initialStep = await companion.locator(".focus-companion-step > p").nth(1).innerText();
  await companion.getByRole("button", { name: "I'm stuck", exact: true }).click();
  if (helpRequests.length) throw Error("Opening stuck help invoked AI without a choice");
  const stuck = companion.getByRole("region", { name: "Help when stuck" });
  await stuck.getByRole("button", { name: "Explain it", exact: true }).click();
  await stuck.getByText("Read only the first event. One detail is enough.", { exact: true }).waitFor();
  if (await companion.locator(".focus-companion-step > p").nth(1).innerText() !== initialStep) throw Error("Explanation changed the current step");
  await stuck.getByRole("button", { name: "Show a sample", exact: true }).click();
  await stuck.getByText("Sample: Event name — start time — question to check.", { exact: true }).waitFor();
  await stuck.getByRole("button", { name: "Make it smaller", exact: true }).click();
  await stuck.getByText("Look at the schedule title.", { exact: true }).waitFor();
  await stuck.getByRole("button", { name: "Use this smaller step", exact: true }).click();
  await companion.locator(".focus-companion-step").getByText("Look at the schedule title.", { exact: true }).waitFor();
  await companion.getByText(/Step 2 · Your next tiny step/).waitFor();
  await page.unroute("**/api/focus-help");
  const offlineHelp = await page.request.post(`${URL_}/api/focus-help`, { data: { task: "Write a report", step: "Open the document", choice: "explain" } });
  if (!offlineHelp.ok() || (await offlineHelp.json()).source !== "offline") throw Error("The real stuck-help endpoint did not provide an offline fallback");

  await page.route("**/api/pal-work", async (route) => {
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({draft:"Sample plan:\n- Review the first shift",source:"offline-example"})});
  });
  await companion.getByRole("button", { name: "Pal: make a sample" }).click();
  await companion.getByRole("textbox", { name: "Pal draft to review and copy" }).waitFor();
  if (!(await companion.getByRole("textbox", { name: "Pal draft to review and copy" }).inputValue()).includes("Review the first shift")) throw Error("Pal didn't prepare sample work");
  await page.unroute("**/api/pal-work");
  // Focus Assist and the open chat can cover room controls. Navigate using the
  // actual visible UI, and minimize the companion before interacting with the room.
  const myPalsEntry = page.locator(".workspace-sidebar .sidebar-item", { hasText: /^\s*My Pals\s*$/i });
  if (await myPalsEntry.getAttribute("aria-pressed") === "true") await myPalsEntry.click();
  const roomEntry = page.locator(".workspace-sidebar .sidebar-item", { hasText: /^\s*Pal Room\s*$/i });
  if (await roomEntry.getAttribute("aria-pressed") !== "true") await roomEntry.click();
  const minimizeCompanion = companion.getByRole("button", { name: "Minimize Focus Assist" });
  if (await minimizeCompanion.count()) await minimizeCompanion.click();
  await companion.getByRole("button", { name: "Expand Focus Assist" }).waitFor();
  const activity = page.getByRole("region", { name: "Pal Room activities" });
  await activity.getByText(/Byte is working beside you/).waitFor();
  const quest = page.getByRole("region", { name: "Tiny Quest Corner" });
  await quest.getByRole("button", { name: "Enable quests" }).click();
  await quest.getByText(/decorating a cozy corner/).waitFor();
  await activity.getByRole("button", { name: "Break together" }).click();
  await activity.getByRole("button", { name: "I'm back" }).waitFor();
  await companion.getByRole("button", { name: "Expand Focus Assist" }).click();
  if (await companion.getByRole("button", { name: "Done with step" }).isEnabled()) throw Error("Work step wasn't paused during a break");
  await activity.getByRole("button", { name: "I'm back" }).click();
  await activity.getByText(/Byte is working beside you/).waitFor();
  await companion.getByRole("button", { name: "Expand Focus Assist" }).click();
  await companion.getByRole("button", { name: "Done with step" }).click();
  await activity.getByRole("region", { name: "Tiny wins" }).getByText(/You showed up/).waitFor();
  await roomEntry.click();
  await companion.getByRole("button", { name: "Expand Focus Assist" }).click();
  await companion.getByText("Check the next event.").waitFor();
  await companion.getByText(/Step 3 · Your next tiny step/).waitFor();
  await companion.getByRole("button", { name: "Save my place" }).click();
  await companion.getByRole("button", { name: "Pause companion" }).click();
  const checkpoint = page.getByRole("complementary", { name: "Saved Focus Assist checkpoint" });
  await checkpoint.waitFor();
  const todayEntry = page.locator(".workspace-sidebar .sidebar-item", { hasText: /^\s*Today\s*$/i });
  if (await todayEntry.getAttribute("aria-pressed") !== "true") await todayEntry.click();
  const resume = page.locator('[data-window-id="today"]').getByRole("region", { name: "Where was I?", exact: true });
  await resume.getByText("Review tomorrow's schedule", { exact: true }).waitFor();
  await resume.getByRole("button", { name: "Resume my saved step" }).click();
  await companion.getByText("Check the next event.").waitFor();
  await companion.getByText(/Step 3 · Your next tiny step/).waitFor();
  await companion.getByRole("button", { name: "Finish & clear" }).click();
  if (await checkpoint.count()) throw Error("Companion checkpoint was not cleared");
  if (await resume.count()) throw Error("Home kept a cleared checkpoint");
  if (await todayEntry.getAttribute("aria-pressed") === "true") await todayEntry.click();
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
  // The Today window may be above the Pal Room; close it before selecting a board task.
  const todayItem = page.locator(".workspace-sidebar .sidebar-item", { hasText: /^\s*Today\s*$/i });
  if (await todayItem.getAttribute("aria-pressed") === "true") await todayItem.click();
  await board.getByRole("button", { name: "Start: Organize the garage" }).waitFor();
  await board.getByRole("button", { name: "Start: Organize the garage" }).click();
  const dialog = page.getByRole("dialog", { name: "Just Start" });
  await dialog.getByRole("textbox", { name: "What are you trying to start?" }).waitFor();
  if (await dialog.getByRole("textbox", { name: "What are you trying to start?" }).inputValue() !== "Organize the garage") {
    throw Error("Living Task Board did not preload the selected task");
  }
  await dialog.getByRole("button", { name: "Close" }).click();
  // The control has a dynamic accessible label. Hold onto the same role-based
  // locator across toggles instead of relying on the old default or label.
  const moodToggle = mood.getByRole("button", { name: /^Switch Pal Room to (Calm|Playful)$/ });
  await moodToggle.waitFor();
  if (await moodToggle.getAttribute("aria-pressed") === "true") {
    await moodToggle.click();
    if (await moodToggle.getAttribute("aria-pressed") !== "false") throw Error("Room mood did not switch to Calm");
  }
  await moodToggle.click();
  if (await moodToggle.getAttribute("aria-pressed") !== "true") throw Error("Room mood did not switch back to Playful");
  await mood.getByRole("group", { name: "What the Pals are doing" }).getByText(/Tinkering with a computer/).waitFor();
  if (await page.evaluate(() => localStorage.getItem("pixel-pals-room-playful-v1")) !== "1") throw Error("Playful preference wasn't saved");
  const rig = page.locator('.room-scene .world-native-sprite').first();
  await rig.waitFor({ state: "visible" });
  if (await rig.getAttribute("viewBox") !== "0 0 32 32") throw Error("Living World lost native 32px pixel models");
  const animated = await rig.evaluate(e => e.getAnimations({ subtree: true }).some(animation => animation.playState === "running"));
  if (!animated) throw Error("Playful Living World poses are not animating");
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (await rig.evaluate(e => e.getAnimations({ subtree: true }).some(animation => animation.playState === "running"))) throw Error("Reduced motion kept a decorative pose running");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.locator(".room-scene").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/pixel-pals-playful.png" });
  await page.getByRole("combobox", { name: "Theme", exact: true }).click();
  await page.getByRole("option", { name: "Linux Theme", exact: true }).click();
  await page.locator(".office-walking:not(.pal-away) .world-native-sprite").first().waitFor();
  const walkingPal = page.locator(".office-walking:not(.pal-away)").first();
  const beforeWalk = await walkingPal.getAttribute("style");
  await page.waitForTimeout(500);
  if (await walkingPal.getAttribute("style") === beforeWalk) throw Error("Office Pal did not advance along its route");
  await page.locator(".room-scene").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/pixel-pals-office.png" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => document.querySelectorAll(".office-walking").length === 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("combobox", { name: "Theme", exact: true }).click();
  await page.getByRole("option", { name: "Normal Mode", exact: true }).click();
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
  const hub = page.getByRole("region", { name: "ADHD home and task picker" });
  await hub.getByText("One thing at a time").waitFor();
  await hub.getByRole("combobox", { name: "Your energy today" }).selectOption("low");
  await hub.getByRole("combobox", { name: "Available minutes" }).selectOption("5");
  await hub.getByRole("button", { name: "Gentle 2-minute pause" }).click();
  await hub.getByRole("button", { name: /Pause:/ }).waitFor();
  await hub.getByRole("button", { name: /Pause:/ }).click();
  await hub.getByRole("button", { name: /Open daily check-in/ }).click();
  await hub.getByPlaceholder("A single priority is enough.").fill("Review one event");
  await hub.getByRole("button", { name: "Save today's note" }).click();
  await hub.getByText(/Saved in this browser for today/).waitFor();
  const overview = page.getByRole("navigation", { name: "Day overview" });
  await overview.getByRole("button", { name: "Tomorrow" }).click();
  await overview.getByRole("button", { name: "Day after" }).click();
  await overview.getByRole("button", { name: "Today" }).click();
  const dump = page.getByRole("region", { name: "Brain Dump" });
  await dump.getByRole("textbox", { name: "Brain dump tasks" }).fill("Review next week's show schedule");
  await dump.getByRole("button", { name: "Capture thoughts" }).click();
  await dump.getByRole("group", { name: "Choose a day for Review next week's show schedule" }).getByRole("button", { name: "Tomorrow" }).click();
  await dump.getByRole("group", { name: "Choose a day for Review next week's show schedule" }).getByRole("button", { name: "Today" }).click();
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
await step("Mail 2.0 folders, list and reader with controlled messages", async () => {
  await page.route("**/api/mail", route => route.fulfill({ json: { configured: true, imap: true, m365: false, items: [], errors: [] } }));
  await page.route("**/api/mailbox**", async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") throw Error("Smoke must not send or modify real mail");
    const message = { uid: 101, subject: "Controlled smoke message", from: "Test sender", fromAddr: "test@example.invalid", date: "2026-10-31T12:00:00Z", seen: false, messageId: "smoke-message", text: "A safe test message body.", to: "owner@example.invalid", cc: "", attachments: [], files: [], references: "" };
    await route.fulfill({ json: url.searchParams.get("op") === "read" ? { message } : { folder: "INBOX", folders: [{ name: "INBOX", label: "Inbox", special: "inbox" }], messages: [message], total: 1, account: "owner@example.invalid", gmail: false } });
  });
  const picker = page.getByRole("combobox", { name: "Workspace layout" });
  await picker.selectOption("chat");
  await picker.selectOption("mail");
  const mail = page.locator('[data-window-id="mail"]');
  await mail.getByRole("button", { name: "Refresh", exact: true }).click();
  await mail.locator(".mail-message-row > button:first-child").filter({ hasText: "Controlled smoke message" }).click();
  await mail.getByText("A safe test message body.", { exact: true }).waitFor();
  if (!await mail.locator(".mail-list").isVisible() || !await mail.locator(".mail-detail").isVisible()) throw Error("Mail list and reader must stay visible together in a wide window");
  if (!await mail.getByRole("navigation", { name: "Mail folders" }).isVisible()) throw Error("Folder navigation missing in a wide window");
  await page.screenshot({ path: process.env.SMOKE_MAIL_SHOT || "/tmp/pixel-mail-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await mail.locator(".mail-list").isVisible()) throw Error("Phone reader should replace the list");
  await mail.getByRole("button", { name: "Back", exact: true }).click();
  if (!await mail.locator(".mail-list").isVisible()) throw Error("Back did not restore the phone message list");
  await page.screenshot({ path: "/tmp/pixel-mail-mobile.png" });
  await page.unroute("**/api/mailbox**");
  await page.unroute("**/api/mail");
});
await step("Second Brain approved note lifecycle in the throwaway vault", async () => {
  const now = new Date().toISOString();
  const note = { id: "smoke-" + Date.now(), category: "Focus Sessions", title: "Smoke checkpoint", body: "Next step: open a blank page", createdAt: now, updatedAt: now, source: "task-progress", tags: [] };
  const savedResponse = await page.request.post(`${URL_}/api/second-brain`, { data: { op: "save", note } });
  if (!savedResponse.ok()) throw Error(`Vault save failed: ${savedResponse.status()}`);
  const saved = (await savedResponse.json()).note;
  const found = await page.request.get(`${URL_}/api/second-brain?q=checkpoint`);
  if (!(await found.json()).notes.some(n => n.id === saved.id)) throw Error("Approved note was not found");
  const stale = await page.request.post(`${URL_}/api/second-brain`, { data: { op: "save", note: saved, revision: "stale" } });
  if (stale.status() !== 409) throw Error("Stale memory edit was accepted");
  const trashed = await page.request.post(`${URL_}/api/second-brain`, { data: { op: "trash", id: saved.id, revision: saved.revision } });
  if (!trashed.ok()) throw Error("Could not soft-trash the test note");
});
await step("Focus Food reviewed recipe, offline cooking and saved progress", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#mobile-more-trigger").click();
  await page.getByRole("group", { name: "More mobile tools" }).getByRole("button", { name: "Focus Food", exact: true }).click();
  const food = page.locator('[data-window-id="focus-food"]');
  const recipeFixture = async route => {
    const data = route.request().postDataJSON();
    if (data.op === "recipe-search") return route.fulfill({ json: { hits: [{ title: "Rice bowls", url: "https://recipes.example/rice", snippet: "Recipe source description" }] } });
    if (data.op === "import" && data.url === "https://recipes.example/rice") return route.fulfill({ json: { recipe: { title: "Rice bowls", ingredients: ["1 cup rice", "2 cups water"], steps: ["Bring water to a boil. Cover and simmer 18 minutes.", "Rest for 5 minutes."], source: "https://recipes.example/rice", servings: "2 bowls", nutrition: "" } } });
    return route.continue();
  };
  await page.route("**/api/focus-food", recipeFixture);
  await food.getByLabel("Recipe search", { exact: true }).fill("rice bowls");
  await food.getByRole("button", { name: "Search recipes", exact: true }).click();
  await food.getByRole("button", { name: "Use this recipe", exact: true }).click();
  await food.getByRole("heading", { name: "Review before cooking" }).waitFor();
  await page.unroute("**/api/focus-food", recipeFixture);
  const powder = food.getByRole("region", { name: "Protein powder calculator", exact: true });
  await powder.getByRole("button", { name: "Add protein powder", exact: true }).click();
  for (const [label, value] of [["Protein powder name / flavour", "Smoke label"], ["Powder weight per label serving (g)", "30"], ["Protein per label serving (g)", "24"], ["Calories per label serving (kcal)", "120"], ["Carbs per label serving (g)", "3"], ["Fat per label serving (g)", "1.5"], ["Portions in the finished recipe", "4"], ["Extra protein wanted per portion (g)", "10"]]) await powder.getByLabel(label, { exact: true }).fill(value);
  await powder.getByText("Weigh 50.0 g of Smoke label for the whole recipe", { exact: true }).waitFor();
  if (!await powder.getByRole("button", { name: "Apply measured powder addition", exact: true }).isDisabled()) throw Error("Powder applied without suitability review");
  await powder.getByText("Include the recipe’s existing nutrition / use my protein shortfall", { exact: true }).click();
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 844 });
    if (await powder.evaluate(el => el.scrollWidth > el.clientWidth + 1)) throw Error(`Powder calculator overflows at ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await powder.getByRole("checkbox", { name: /I checked this product’s allergens/ }).check();
  await powder.getByRole("button", { name: "Apply measured powder addition", exact: true }).click();
  const modifiedIngredients = await food.getByRole("textbox", { name: "Ingredients — one per line", exact: true }).inputValue();
  if (!modifiedIngredients.includes("50.0 g Smoke label")) throw Error("Calculated powder amount missing from recipe");
  await food.getByRole("button", { name: "Remove powder addition", exact: true }).click();
  if (await food.getByRole("textbox", { name: "Ingredients — one per line", exact: true }).inputValue() !== "1 cup rice\n2 cups water") throw Error("Removing powder did not restore original ingredients");
  await food.getByRole("button", { name: "Save recipe and get ready" }).click();
  const kitchen = food.getByRole("complementary", { name: "Cook-along Pal" });
  if (await kitchen.getAttribute("data-kitchen-action") !== "gather") throw Error("Pal did not join ingredient prep");
  await food.getByRole("checkbox", { name: "1 cup rice", exact: true }).check();
  await food.getByRole("button", { name: "I’m ready — show the first step" }).click();
  if (await kitchen.getAttribute("data-kitchen-action") !== "heat") throw Error("Pal did not follow the cooking step");
  await food.getByRole("button", { name: "Calm Pal", exact: true }).click();
  if (await kitchen.getAttribute("data-kitchen-still") !== "true") throw Error("Calm Pal did not pause decorative motion");
  await food.getByRole("button", { name: "Animate Pal", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (await kitchen.locator(".kitchen-steam").evaluate(e => getComputedStyle(e).animationName) !== "none") throw Error("Kitchen ignores reduced motion");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await food.getByRole("button", { name: "I’m stuck — help me begin" }).click();
  await food.getByRole("heading", { name: "Step 1 of 2", exact: true }).waitFor();
  if (!(await food.locator(".food-step").innerText()).includes("18 minutes")) throw Error("Original cooking time changed");
  await food.getByLabel("Timer name", { exact: true }).fill("Rice");
  await food.getByRole("button", { name: "Start timer", exact: true }).click();
  const beforeChat = await page.evaluate(() => JSON.parse(localStorage.getItem("pixel-pals-focus-food-v1")));
  const cookingQuestions = [];
  const chatFixture = async route => {
    const data = route.request().postDataJSON();
    if (data.op !== "chat") return route.continue();
    cookingQuestions.push(data);
    return route.fulfill({ json: { text: `Recipe-aware answer for step ${data.index + 1}.`, source: "local-ai" } });
  };
  await page.route("**/api/focus-food", chatFixture);
  await food.getByRole("button", { name: "Ask about this step", exact: true }).click();
  const stepChat = food.getByRole("region", { name: "Recipe step chat", exact: true });
  await stepChat.getByRole("textbox", { name: "Question about this recipe", exact: true }).fill("What does simmer mean here?");
  await stepChat.getByRole("button", { name: "Ask cooking assistant", exact: true }).click();
  await stepChat.getByText("Recipe-aware answer for step 1.", { exact: false }).waitFor();
  await stepChat.getByRole("button", { name: "Back to recipe", exact: true }).click();
  const afterChat = await page.evaluate(() => JSON.parse(localStorage.getItem("pixel-pals-focus-food-v1")));
  if (afterChat.index !== beforeChat.index || afterChat.timer.end !== beforeChat.timer.end || JSON.stringify(afterChat.recipe) !== JSON.stringify(beforeChat.recipe)) throw Error("Cooking chat changed recipe, step or timer");
  await food.getByRole("button", { name: "Done with this step", exact: true }).click();
  await food.getByRole("button", { name: "Ask about this step", exact: true }).click();
  await stepChat.getByRole("textbox", { name: "Question about this recipe", exact: true }).fill("What is this step for?");
  await stepChat.getByRole("button", { name: "Ask cooking assistant", exact: true }).click();
  await stepChat.getByText("Recipe-aware answer for step 2.", { exact: false }).waitFor();
  if (cookingQuestions[1].index !== 1 || cookingQuestions[1].history[0].index !== 0 || cookingQuestions[1].recipe.steps[0] !== beforeChat.recipe.steps[0]) throw Error("Cooking chat lost recipe, step or recent questions");
  for (const width of [320, 390, 700]) { await page.setViewportSize({ width, height: 844 }); if (await stepChat.evaluate(el => el.scrollWidth > el.clientWidth + 1)) throw Error(`Step chat overflows at ${width}px`); }
  await page.setViewportSize({ width: 390, height: 844 });
  await stepChat.getByRole("button", { name: "Back to recipe", exact: true }).click();
  await page.unroute("**/api/focus-food", chatFixture);
  await food.getByRole("heading", { name: "Step 2 of 2", exact: true }).waitFor();
  await page.locator('.mobile-tabbar button', { hasText: "Home" }).click();
  await page.locator("#mobile-more-trigger").click();
  await page.getByRole("group", { name: "More mobile tools" }).getByRole("button", { name: "Focus Food", exact: true }).click();
  await food.getByRole("heading", { name: "Step 2 of 2", exact: true }).waitFor();
  await page.reload();
  await page.locator('.modular-workspace[aria-busy="false"]').waitFor();
  await page.locator("#mobile-more-trigger").click();
  await page.getByRole("group", { name: "More mobile tools" }).getByRole("button", { name: "Focus Food", exact: true }).click();
  await food.getByRole("heading", { name: "Step 2 of 2", exact: true }).waitFor();
  await food.getByRole("timer", { name: "Rice", exact: true }).waitFor();
  await food.getByRole("button", { name: "Ask about this step", exact: true }).click();
  await stepChat.getByText("Recipe-aware answer for step 1.", { exact: false }).waitFor();
  await stepChat.getByText("Recipe-aware answer for step 2.", { exact: false }).waitFor();
  await stepChat.getByRole("button", { name: "Back to recipe", exact: true }).click();
  if (await kitchen.getAttribute("data-kitchen-action") !== "wait") throw Error("Kitchen lost its step after reload");
  const blocked = await page.request.post(`${URL_}/api/focus-food`, { data: { op: "import", url: "https://127.0.0.1/" } });
  if (blocked.status() !== 422) throw Error("Recipe importer accepted a private address");
  await page.screenshot({ path: process.env.SMOKE_FOOD_SHOT || "/tmp/pixel-food-mobile.png" });
  await food.getByRole("button", { name: "Done with this step", exact: true }).click();
  const macros = food.getByRole("region", { name: "Finished recipe nutrition and macro check", exact: true });
  await macros.getByText("Not enough information to judge", { exact: true }).waitFor();
  await macros.getByText("Review nutrition, portion and meal targets", { exact: true }).click();
  await food.getByText("Edit meal targets / use a daily plan", { exact: true }).click();
  for (const [label, value] of [["Source calories (kcal)", "500"], ["Source protein (g)", "40"], ["Source carbs (g)", "50"], ["Source fat (g)", "15"], ["Meal calorie budget (kcal)", "400"], ["Meal protein minimum (g)", "35"], ["Meal carb limit (g, optional)", "40"]]) await (label.startsWith("Meal ") ? food.getByRole("region", { name: "Shared meal targets", exact: true }) : macros).getByLabel(label, { exact: true }).fill(value);
  await macros.getByLabel("Nutrition serving basis", { exact: true }).selectOption("serving");
  await macros.getByRole("checkbox").check();
  await macros.getByText("No — doesn’t fit your meal targets", { exact: true }).waitFor();
  await macros.getByText(/compare replacing part of the rice with cauliflower rice/).waitFor();
  await food.getByLabel("Meal calorie budget (kcal)", { exact: true }).fill("600");
  await food.getByLabel("Meal carb limit (g, optional)", { exact: true }).fill("");
  await macros.getByText("Yes — fits your meal targets", { exact: true }).waitFor();
  await food.getByRole("button", { name: "Remember meal targets", exact: true }).click();
  await page.reload();
  await page.locator('.modular-workspace[aria-busy="false"]').waitFor();
  await page.locator("#mobile-more-trigger").click();
  await page.getByRole("group", { name: "More mobile tools" }).getByRole("button", { name: "Focus Food", exact: true }).click();
  await macros.getByText("Yes — fits your meal targets", { exact: true }).waitFor();
  const savedFood = await page.evaluate(() => JSON.parse(localStorage.getItem("pixel-pals-focus-food-v1") || "{}"));
  if (savedFood.recipe.ingredients[0] !== "1 cup rice" || savedFood.recipe.steps[0] !== "Bring water to a boil. Cover and simmer 18 minutes.") throw Error("Macro suggestions changed the original recipe");
  await macros.screenshot({ path: "/tmp/pixel-food-macrocheck.png" });
});
await step("Restaurant menu search, review, saved macros and cooking separation", async () => {
  const food = page.locator('[data-window-id="focus-food"]');
  const original = await page.evaluate(() => localStorage.getItem("pixel-pals-focus-food-v1"));
  await food.getByRole("button", { name: "Restaurant macros", exact: true }).click();
  const restaurant = food.getByRole("region", { name: "Restaurant macro finder", exact: true });
  const fixture = async route => {
    const data = route.request().postDataJSON();
    if (data.op === "restaurant-search") return route.fulfill({ json: { hits: [{ title: "Test Grill official nutrition", url: "https://restaurant.example/menu", snippet: "Menu nutrition" }] } });
    if (data.op === "restaurant-import") return route.fulfill({ json: { items: [{ name: "Fixture chicken bowl", serving: "1 bowl", source: "https://restaurant.example/menu", nutrition: "calories: 500 kcal · protein: 40 g · carbs: 50 g · fat: 15 g" }] } });
    return route.continue();
  };
  await page.route("**/api/focus-food", fixture);
  await restaurant.getByLabel("Restaurant or meal search", { exact: true }).fill("Test Grill");
  await restaurant.getByRole("button", { name: "Search menus online", exact: true }).click();
  await restaurant.getByRole("button", { name: "Use this menu link", exact: true }).click();
  await restaurant.getByRole("button", { name: "Load menu nutrition", exact: true }).click();
  await restaurant.getByRole("button", { name: "Review Fixture chicken bowl", exact: true }).click();
  const macros = restaurant.getByRole("region", { name: "Restaurant nutrition and macro check", exact: true });
  await macros.getByText("Not enough information to judge", { exact: true }).waitFor();
  await restaurant.getByLabel("Restaurant name", { exact: true }).fill("Test Grill");
  await macros.getByText("Review nutrition, portion and meal targets", { exact: true }).click();
  await macros.getByLabel("Nutrition serving basis", { exact: true }).selectOption("serving");
  await macros.getByRole("checkbox").check();
  await macros.getByText("Yes — fits your meal targets", { exact: true }).waitFor();
  await restaurant.getByRole("button", { name: "Save reviewed order", exact: true }).click();
  await restaurant.getByText("Yes — fits current meal targets", { exact: true }).waitFor();
  await food.getByText("Edit meal targets / use a daily plan", { exact: true }).click();
  await food.getByLabel("Meal calorie budget (kcal)", { exact: true }).fill("400");
  await restaurant.getByText("No — doesn’t fit current meal targets", { exact: true }).waitFor();
  await restaurant.getByRole("button", { name: "Compare Fixture chicken bowl", exact: true }).click();
  await macros.getByText("No — doesn’t fit your meal targets", { exact: true }).waitFor();
  await restaurant.getByLabel("Menu item / complete order", { exact: true }).fill("Changed custom order");
  await macros.getByText("Not enough information to judge", { exact: true }).waitFor();
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 844 });
    const overflow = await restaurant.evaluate(el => el.scrollWidth > el.clientWidth + 1);
    if (overflow) throw Error(`Restaurant panel overflows at ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await restaurant.getByRole("button", { name: "1. Find a meal", exact: true }).click();
  await restaurant.screenshot({ path: "/tmp/pixel-restaurant-finder.png" });
  await page.unroute("**/api/focus-food", fixture);
  const blocked = await page.request.post(`${URL_}/api/focus-food`, { data: { op: "restaurant-import", url: "https://127.0.0.1/" } });
  if (blocked.status() !== 422) throw Error("Private restaurant URLs were not refused");
  await food.getByRole("button", { name: "Cook a recipe", exact: true }).click();
  if (await page.evaluate(() => localStorage.getItem("pixel-pals-focus-food-v1")) !== original) throw Error("Restaurant workflow modified cooking data");
});
await step("mobile chat uses clean full-screen layout and collapsible settings", async () => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.locator('.mobile-tabbar button', { hasText: "Pals" }).click();
  const chat = page.locator('[data-window-id="chat-my-pals"]');
  await chat.waitFor({ state: "visible" });
  if (await chat.locator('.window-titlebar').isVisible()) throw Error("desktop window title still visible on mobile");
  const more = chat.locator(".mobile-chat-options");
  await more.locator(":scope > summary").waitFor({ state: "visible" });
  if (await more.getAttribute("open") !== null) throw Error("Advanced options unexpectedly open");
  await more.locator(":scope > summary").click();
  if (await more.getAttribute("open") === null) throw Error("Advanced chat options did not expand");
  await more.locator(":scope > summary").click();
  const bounds = await chat.boundingBox();
  if (!bounds || bounds.width < 375 || bounds.x > 5) throw Error("Chat is not full width on mobile");
  await page.locator('.mobile-tabbar button', { hasText: "Home" }).click();
  const today = page.locator('[data-window-id="today"]');
  await today.waitFor({state:"visible"});
  const weather = today.locator(".mobile-today-block", {hasText:"Weather"}).first();
  await weather.locator(".mobile-today-block-toggle").waitFor();
  if (await weather.locator(".mobile-today-block-toggle").getAttribute("aria-expanded") !== "false") throw Error("Weather is not collapsed on mobile");
  await weather.locator(".mobile-today-block-toggle").click();
  if (await weather.locator(".mobile-today-block-toggle").getAttribute("aria-expanded") !== "true") throw Error("Weather did not expand");
  await page.locator('.mobile-tabbar button', { hasText: "More" }).click();
  await page.getByRole("group", { name: "More mobile tools" }).getByRole("button", { name: "Notes" }).waitFor();
  await page.getByRole("group", { name: "More mobile tools" }).getByRole("button", { name: "Notes" }).click();
  const shell = await page.locator(".modular-workspace").evaluate(e => ({ body: e.scrollWidth, view: e.clientWidth }));
  if (shell.body > shell.view + 4) throw Error("Mobile shell has horizontal overflow");
});
await step("Mobile UI 3.0 tool navigation at narrow and wide phone sizes", async () => {
  for (const width of [320, 390, 700]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [label, id] of [["Focus Food", "focus-food"], ["Home", "today"], ["Tasks", "tasks"], ["Pals", "chat-my-pals"], ["Notes", "notes"], ["Calendar", "calendar"], ["Mail", "mail"], ["Documents", "documents"], ["Recorder", "recorder"], ["Fun", "fun"], ["Playtests", "playtests"], ["Settings", "setup"]]) {
      if (["Home", "Tasks", "Pals"].includes(label)) await page.locator(".mobile-tabbar").getByRole("button", { name: label, exact: true }).click();
      else {
        await page.locator("#mobile-more-trigger").click();
        await page.getByRole("group", { name: "More mobile tools" }).getByRole("button", { name: label, exact: true }).click();
      }
      const panel = page.locator(`[data-window-id="${id}"]`);
      await panel.waitFor({ state: "visible" });
      const visible = await page.locator(".workspace-window:visible").count();
      if (visible !== 1) throw Error(`${label}: ${visible} windows visible at ${width}px`);
      const size = await panel.evaluate(e => ({ scroll: e.scrollWidth, width: e.clientWidth }));
      if (size.scroll > size.width + 4) throw Error(`${label} overflows at ${width}px`);
      if (await panel.locator(".window-resize:visible").count()) throw Error(`${label} shows desktop resize handles`);
    }
    await page.locator("#mobile-more-trigger").click();
    await page.keyboard.press("Escape");
    if (await page.locator("#mobile-more-trigger").getAttribute("aria-expanded") !== "false") throw Error("Escape did not close More");
  }
});
await step("Connect Ollama tests from the server, saves address and selects its installed model", async () => {
  await page.locator("#mobile-more-trigger").click();
  await page.getByRole("group", { name: "More mobile tools" }).getByRole("button", { name: "Settings", exact: true }).click();
  const connector = page.locator('[data-window-id="setup"]').getByRole("region", { name: "Connect Ollama", exact: true });
  const address = `http://127.0.0.1:${process.env.SMOKE_OLLAMA_PORT || "11435"}`;
  await connector.getByLabel("Ollama server address", { exact: true }).fill(address);
  if (!await connector.getByRole("button", { name: "Save and connect", exact: true }).isDisabled()) throw Error("Untested endpoint could be saved");
  await connector.getByRole("button", { name: "Test connection", exact: true }).click();
  await connector.getByRole("combobox", { name: "Installed local model", exact: true }).waitFor();
  const before = await page.request.get(`${URL_}/api/settings`);
  if ((await before.json()).settings.find(x => x.key === "OLLAMA_URL")?.source === "app") throw Error("Testing saved the address prematurely");
  await connector.getByRole("button", { name: "Save and connect", exact: true }).click();
  await connector.getByText(/Saved and connected/).waitFor();
  const saved = await page.request.get(`${URL_}/api/settings`);
  if ((await saved.json()).settings.find(x => x.key === "OLLAMA_URL")?.value !== address) throw Error("Ollama address did not persist on the server");
  const engine = await page.evaluate(() => JSON.parse(localStorage.getItem("pixel-pals-engine-v1") || "{}"));
  if (engine.kind !== "local-server" || engine.localChat !== "qwen3.5:9b") throw Error("Selected model was not applied to the local server engine");
});
await step("Remote Ollama backend inference, missing models, policy and authentication", async () => {
  const health = await page.request.get(`${URL_}/api/ollama-health`);
  const status = await health.json();
  if (!status.reachable || !status.models.some(m => m.name === "qwen3.5:9b")) throw Error("Backend health did not see installed Ollama");
  if (JSON.stringify(status).includes("127.0.0.1")) throw Error("Health response exposed a private endpoint");
  const anonymous = await browser.newContext();
  for (const path of ["/api/ollama-health", "/api/ollama", "/api/assistant", "/api/assistant?view=memory"]) {
    const denied = await anonymous.request.get(`${URL_}${path}`);
    if (![401, 403].includes(denied.status())) throw Error(`${path} exposed internal metadata without authentication`);
  }
  const deniedFoodChat = await anonymous.request.post(`${URL_}/api/focus-food`, { data: { op: "chat" } });
  if (![401, 403].includes(deniedFoodChat.status())) throw Error("Cooking chat allowed an unauthenticated request");
  await anonymous.close();
  const body = { agentId: "nova", model: "openai/gpt-6-astra", mode: "direct", round: 1, messages: [{ id: "smoke-local-u", role: "user", parts: [{ type: "text", text: "Hello" }] }], engine: { kind: "ollama-server", apiKey: "", model: "qwen3.5:9b", maxTokens: 200 } };
  const missing = await page.request.post(`${URL_}/api/chat`, { data: { ...body, engine: { ...body.engine, model: "llama3.2:3b" } } });
  if (missing.status() !== 409 || (await missing.json()).code !== "ollama-model") throw Error("Missing model was sent to inference instead of rejected with a repair explanation");
  const answer = await page.request.post(`${URL_}/api/chat`, { data: body });
  if (!answer.ok() || answer.headers()["x-pixelpals-model"] !== "qwen3.5:9b" || !(await answer.text()).includes("Local fixture reply.")) throw Error("Server-proxied model did not stream the fixture reply");
  await page.request.post(`${URL_}/api/settings`, { data: { values: { LOCAL_ONLY_AI: "on" } } });
  const blocked = await page.request.post(`${URL_}/api/chat`, { data: { ...body, engine: { kind: "groq", apiKey: "smoke-not-a-real-key" } } });
  if (blocked.status() !== 403 || (await blocked.json()).code !== "local-only") throw Error("Local-Only allowed a cloud provider");
  const directRequests = [];
  const watchDirect = request => { if (["11434", "11435"].includes(new globalThis.URL(request.url()).port)) directRequests.push(request.url()); };
  page.on("request", watchDirect);
  for (const [label, localOnly] of [["Local AI (this server)", false], ["Ollama on my computer", false], ["Auto (keys + Ollama)", false], ["Auto (keys + Ollama)", true]]) {
    await page.request.post(`${URL_}/api/settings`, { data: { values: { LOCAL_ONLY_AI: localOnly ? "on" : "off" } } });
    const policy = page.waitForResponse(r => r.url().endsWith("/api/ollama-health"));
    await page.evaluate(() => window.dispatchEvent(new Event("pixelpals:ollama-connected")));
    await policy;
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.getByRole("button", { name: "AI engine", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "AI engine", exact: true });
    await dialog.getByRole("radio", { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
    if (label !== "Local AI (this server)") await dialog.getByLabel("Ollama connection path", { exact: true }).selectOption("auto");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator(".ollama-mascot").getByText("Local AI — Connected", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".mobile-tabbar").getByRole("button", { name: "Pals", exact: true }).click();
    const chat = page.locator('[data-window-id="chat-my-pals"]');
    await chat.getByLabel("My Pals message", { exact: true }).fill("@nova Say hello.");
    const response = page.waitForResponse(r => r.url().endsWith("/api/chat") && r.request().postDataJSON()?.engine?.kind === "ollama-server", { timeout: 30000 });
    await chat.getByRole("button", { name: "Send", exact: true }).click();
    const actual = await response;
    if (!actual.ok() || actual.headers()["x-pixelpals-model"] !== "qwen3.5:9b") throw Error(`${label} did not use the installed backend model`);
    await chat.getByRole("button", { name: "Send", exact: true }).waitFor();
  }
  const cookingAnswer = await page.request.post(`${URL_}/api/focus-food`, { data: { op: "chat", question: "Explain this step briefly.", recipe: { title: "Smoke recipe", ingredients: ["Rice"], steps: ["Follow the original source."], servings: "1", nutrition: "", source: "" }, index: 0, stage: "cook", history: [] } });
  if (!cookingAnswer.ok() || (await cookingAnswer.json()).text !== "Local fixture reply.") throw Error("Cooking chat did not use backend Local AI under Local-Only mode");
  page.off("request", watchDirect);
  if (directRequests.length) throw Error("A proxied mode contacted an Ollama endpoint from the browser");
  await page.request.post(`${URL_}/api/settings`, { data: { values: { LOCAL_ONLY_AI: "off" } } });
});
await step("Seerr request opens editable integration settings and saves protected credentials without restart", async () => {
  await page.setViewportSize({width:390,height:844});
  const box=page.locator('[data-window-id="chat-my-pals"]').getByLabel('My Pals message',{exact:true});
  await box.fill('@seerr Maiden Blood');
  await page.locator('[data-window-id="chat-my-pals"]').getByRole('button',{name:'Send',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Request “Maiden Blood”',exact:true});
  await dialog.getByText(/Open Settings.*Integrations/).waitFor();
  await dialog.getByRole('button',{name:'Seerr integration settings',exact:true}).click();
  const card=page.locator('[data-window-id="setup"] [data-integration-id="seerr"]');
  await card.getByLabel(/^Seerr address/).waitFor();
  await page.setViewportSize({width:1500,height:900});
  await card.getByLabel(/^Seerr address/).fill(`http://127.0.0.1:${process.env.SMOKE_OLLAMA_PORT || "11435"}`);
  const key=card.getByLabel(/^Seerr API key/);
  if(await key.getAttribute('type')!=='password') throw Error('Seerr key is not a password field');
  await key.fill('smoke-seerr-settings-key');
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/settings') && r.request().method()==='POST');
  await card.getByRole('button',{name:'Save',exact:true}).click();
  const result=await saved;
  if(!result.ok() || (await result.text()).includes('smoke-seerr-settings-key')) throw Error('Settings save failed or returned the secret');
  await card.getByRole('button',{name:'Test',exact:true}).click();
  await card.getByText('✅ Connected to Seerr. API key verified.',{exact:true}).waitFor();
  const lookup=await page.request.get(URL_+'/api/seerr?q=Maiden%20Blood');
  if(!lookup.ok()) throw Error('Saved Seerr connection was not immediately usable');
});
await step("General Chat, independent drafts, automatic scrub and Memory Center on desktop/mobile", async () => {
  await page.setViewportSize({width:1500,height:900});
  await page.goto(URL_ + "/?chat=1");
  const chat = page.locator('.general-assistant');
  const input = chat.getByRole('textbox', {name:'Ask Anything',exact:true});
  await input.waitFor();
  const floating=page.locator('[data-window-id="general-chat"]');
  await floating.waitFor({state:'visible'});
  const canvasBox=await page.locator('.window-canvas').boundingBox();
  const originalBox=await floating.boundingBox();
  if(!canvasBox || !originalBox || originalBox.width>=canvasBox.width-10) throw Error('General Chat is still a full-screen page');
  const title=await floating.locator('.window-title').boundingBox();
  await page.mouse.move(title.x+30,title.y+title.height/2); await page.mouse.down();
  await page.mouse.move(title.x-20,title.y+title.height/2,{steps:5}); await page.mouse.up();
  const moved=await floating.boundingBox();
  if(moved.x>originalBox.x-25) throw Error('General Chat cannot be moved');
  const edge=await floating.locator('.window-resize-e').boundingBox();
  await page.mouse.move(edge.x+edge.width/2,edge.y+60); await page.mouse.down();
  await page.mouse.move(edge.x-100,edge.y+60,{steps:5}); await page.mouse.up();
  if((await floating.boundingBox()).width>moved.width-60) throw Error('General Chat cannot be resized');
  await floating.getByRole('button',{name:'Maximize General Chat',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-window-id="general-chat"]')?.classList.contains('window-expanded'));
  await floating.getByRole('button',{name:'Restore General Chat',exact:true}).click();
  await input.fill('Draft survives hiding this window');
  await floating.getByRole('button',{name:'Hide General Chat',exact:true}).click();
  await floating.waitFor({state:'hidden'});
  await page.locator('.workspace-sidebar .sidebar-item',{hasText:'General Chat · Ask Anything'}).click();
  await input.waitFor();
  if(await input.inputValue()!=='Draft survives hiding this window') throw Error('Closing the window discarded the draft');
  await input.fill('How do I restart Ollama? password=smoke-secret-not-real');
  if ((await input.inputValue()).includes('smoke-secret-not-real')) throw Error('Credential remained in chat input');
  const answer = page.waitForRequest(r => r.url().endsWith('/api/assistant') && r.postDataJSON()?.op === 'ask');
  await chat.getByRole('button',{name:'Send question',exact:true}).click();
  const replied = await answer; const data = await assistantResult(replied);
  if (data.conversation.messages.at(-1).parts[0].text !== 'Local fixture reply.') throw Error('General Chat failed backend answer: '+JSON.stringify(data));
  if (JSON.stringify(data).includes('smoke-secret-not-real')) throw Error('General Chat saved raw credentials');
  await page.screenshot({path:process.env.SMOKE_CHAT_WINDOW_SHOT || '/tmp/pixel-general-window.png'});
  const first = data.conversation.id;
  await input.fill('Keep this draft in the first chat');
  const drawer = chat.getByRole('button',{name:'Conversations',exact:true});
  if (await drawer.count()) await drawer.click();
  const created = page.waitForResponse(r => r.url().endsWith('/api/assistant') && r.request().postDataJSON()?.op === 'create');
  await chat.getByRole('button',{name:'New Chat',exact:true}).click();
  await created;
  await chat.locator('h2').filter({hasText:/^General Chat$/}).waitFor();
  await page.waitForFunction(() => document.querySelector('.assistant-top button')?.getAttribute('aria-expanded') === 'false');
  await input.fill('Independent second draft');
  const open = chat.getByRole('button',{name:'Conversations',exact:true}); if(await open.count()) await open.click();
  await chat.locator('.assistant-chat-link').filter({hasText:/How do I restart Ollama/}).first().click();
  await page.waitForFunction(() => document.querySelector('#ask-anything')?.value === 'Keep this draft in the first chat');
  if(await input.inputValue() !== 'Keep this draft in the first chat') throw Error('Switching conversations lost draft');
  const saved = await (await page.request.get(URL_+'/api/assistant?id='+first)).json();
  if(saved.conversation.messages.length !== 2) throw Error('Independent conversations mixed history');
  const memory = await page.request.post(URL_+'/api/assistant',{data:{op:'memory-save',title:'Smoke Ollama service',text:'Ollama runs as a systemd service on CachyOS.',scope:'global'}});
  if(!memory.ok()) throw Error('Owner could not save a memory');
  await chat.getByRole('button',{name:'Memory Center',exact:true}).click();
  const center = chat.getByRole('region',{name:'Memory Center',exact:true});
  await center.getByText('Smoke Ollama service',{exact:true}).waitFor();
  await center.getByRole('textbox',{name:'Search all memories',exact:true}).fill('Unsubmitted memory search');
  await floating.getByRole('button',{name:'Hide General Chat',exact:true}).click();
  await floating.waitFor({state:'hidden'});
  await page.locator('.workspace-sidebar .sidebar-item',{hasText:'General Chat · Ask Anything'}).click();
  await center.waitFor({state:'visible'});
  if(await center.getByRole('textbox',{name:'Search all memories',exact:true}).inputValue()!=='Unsubmitted memory search') throw Error('Hiding the window reset Memory Center controls');
  await center.getByRole('textbox',{name:'Search all memories',exact:true}).fill('');
  await center.getByRole('button',{name:'Sync Obsidian',exact:true}).click();
  await center.getByRole('status').filter({hasText:/Sync|synced|notes|Saved/i}).waitFor();
  for (const width of [320,390,700]) {
    await page.setViewportSize({width,height:844});
    const dimensions=await page.evaluate(()=>({body:document.documentElement.scrollWidth,view:innerWidth}));
    if(dimensions.body>dimensions.view+1) throw Error('General Chat/Memory Center overflows at '+width);
  }
  await page.screenshot({path:process.env.SMOKE_MEMORY_SHOT || '/tmp/pixel-memory-mobile.png'});
  await chat.getByRole('button',{name:'Ask Anything',exact:true}).click();
  await input.waitFor();
  await page.reload();
  await input.waitFor();
  if(await input.inputValue() !== 'Keep this draft in the first chat') throw Error('Draft did not survive reload');
  const restoredFrame=await floating.boundingBox();
  if(!restoredFrame) throw Error('General Chat did not reopen inside its window');
  await floating.getByRole('button',{name:'Hide General Chat',exact:true}).click();
  await page.locator('[data-window-id="today"]').waitFor({state:'visible'});
  await page.locator('#mobile-more-trigger').click();
  await page.locator('#mobile-more-tools').getByRole('button',{name:'General Chat · Ask Anything',exact:true}).click();
  await input.waitFor();
  if(await input.inputValue() !== 'Keep this draft in the first chat') throw Error('Mobile navigation discarded the chat draft');
});
await step("Web Auto uses configured search and displays sources while Off stays local", async()=>{
  await page.setViewportSize({width:1500,height:900});
  await page.request.post(URL_+'/api/settings',{data:{values:{SEARXNG_URL:`http://127.0.0.1:${process.env.SMOKE_OLLAMA_PORT || "11435"}`}}});
  const chat=page.locator('.general-assistant');
  await chat.getByRole('combobox',{name:'Web search mode',exact:true}).selectOption('auto');
  await chat.getByRole('textbox',{name:'Ask Anything',exact:true}).fill('When are the midterms?');
  const result=page.waitForRequest(r=>r.url().endsWith('/api/assistant')&&r.postDataJSON()?.op==='ask');
  await chat.getByRole('button',{name:'Send question',exact:true}).click();
  const web=(await assistantResult(await result)).web;if(web.state!=='connected')throw Error('Auto did not use configured search: '+JSON.stringify(web));
  const sources=chat.locator('details').filter({has:page.locator('summary',{hasText:/^Web sources/})}).last();await sources.locator('summary').click();
  await sources.getByRole('link',{name:'Current information fixture',exact:true}).waitFor();
  await chat.getByRole('combobox',{name:'Web search mode',exact:true}).selectOption('off');
  await chat.getByRole('textbox',{name:'Ask Anything',exact:true}).fill('Latest news');
  const noWeb=page.waitForRequest(r=>r.url().endsWith('/api/assistant')&&r.postDataJSON()?.op==='ask');await chat.getByRole('button',{name:'Send question',exact:true}).click();if((await assistantResult(await noWeb)).web.state!=='off')throw Error('Explicit Off was ignored');
});
await step("Capture Inbox stores, reviews and starts a task; Today brief reflects the durable task",async()=>{
  await page.request.post(URL_+'/api/settings',{data:{values:{CAPTURE_AUTO_PROCESS:'off'}}});
  await page.evaluate(()=>window.dispatchEvent(new Event('pixelpals:inbox')));
  const inbox=page.locator('[data-window-id="capture-inbox"]');await inbox.waitFor({state:'visible'});
  await inbox.getByRole('textbox',{name:'Capture a thought',exact:true}).fill('I need to prepare lunches password=fixture-secret');
  await inbox.getByRole('button',{name:'Save thought',exact:true}).click();await inbox.getByRole('button',{name:'Review suggestion',exact:true}).first().waitFor();
  const raw=await (await page.request.get(URL_+'/api/inbox')).json();if(JSON.stringify(raw).includes('fixture-secret'))throw Error('Capture saved raw credentials');
  const before=await (await page.request.post(URL_+'/api/today',{data:{op:'get'}})).json();const count=before.state.tasks.length;
  await inbox.getByRole('button',{name:'Review suggestion',exact:true}).first().click();const editor=inbox.getByRole('form',{name:'Review capture suggestion',exact:true});
  await editor.getByLabel('Save as',{exact:true}).selectOption('task');await editor.getByLabel('Reviewed text',{exact:true}).fill('Prepare lunches from capture');await editor.getByLabel('Small first step',{exact:true}).fill('Get one container');
  await editor.getByRole('button',{name:'Save and help me start',exact:true}).click();await page.getByRole('dialog',{name:'Just Start',exact:true}).waitFor();await page.getByRole('dialog',{name:'Just Start',exact:true}).getByRole('button',{name:'Close',exact:true}).click();
  const after=await (await page.request.post(URL_+'/api/today',{data:{op:'get'}})).json();if(after.state.tasks.length!==count+1||!after.state.tasks.some(t=>t.title==='Prepare lunches from capture'))throw Error('Review did not save exactly one planner task');
  const brief=await (await page.request.get(URL_+'/api/inbox?view=brief&tz=America%2FNew_York')).json();if(!brief.priorities.some(t=>t.title==='Prepare lunches from capture'))throw Error('Today brief missed approved task');
  await page.setViewportSize({width:390,height:844});await page.locator('.mobile-tabbar').getByRole('button',{name:'Home',exact:true}).click();
  const overview=page.getByRole('region',{name:'Personalized Today briefing',exact:true});await overview.getByText('Prepare lunches from capture',{exact:true}).waitFor();
  await overview.getByText('Gentle weekly review',{exact:true}).click();await overview.getByText(/tasks completed in the last seven days/).waitFor();
  await page.screenshot({path:process.env.SMOKE_BRIEF_SHOT || '/tmp/pixel-capture-brief.png'});
  await overview.getByRole('button',{name:/Capture a thought/}).click();await inbox.waitFor({state:'visible'});
  for(const width of [320,390,700]){await page.setViewportSize({width,height:844});const dimensions=await page.evaluate(()=>({body:document.documentElement.scrollWidth,view:innerWidth}));if(dimensions.body>dimensions.view+1)throw Error('Capture inbox overflows at '+width);}
});
await step("Voice memos survive capture and are transcribed through the local queue",async()=>{
  const inbox=page.locator('[data-window-id="capture-inbox"]');
  await page.request.post(URL_+'/api/settings',{data:{values:{WHISPER_URL:`http://127.0.0.1:${process.env.SMOKE_OLLAMA_PORT || "11435"}`,CAPTURE_AUTO_PROCESS:'on'}}});
  await inbox.getByText('Voice memo',{exact:true}).click();
  await inbox.getByLabel('Upload voice memo',{exact:true}).setInputFiles({name:'memo.wav',mimeType:'audio/wav',buffer:Buffer.from([82,73,70,70,0,0,0,0])});
  await inbox.getByRole('button',{name:'Save voice memo',exact:true}).click();
  await inbox.getByText('I need to prepare lunches.',{exact:true}).waitFor({timeout:90000});
  const data=await (await page.request.get(URL_+'/api/inbox')).json();const voice=data.items.find(i=>i.inbox.source==='audio');if(!voice||voice.inbox.audio||!voice.inbox.suggestions.length)throw Error('Voice processing did not retain a reviewable transcript and remove processed audio');
});
await step("General Chat shows an early reply on desktop/mobile and Stop keeps partials out of history", async () => {
  await page.setViewportSize({width:1500,height:900});
  await page.evaluate(() => window.dispatchEvent(new Event('pixelpals:general-chat')));
  const chat=page.locator('.general-assistant');
  await chat.getByRole('combobox',{name:'Web search mode',exact:true}).selectOption('off');
  for (const width of [1500,390]) {
    await page.setViewportSize({width,height:844});
    await chat.getByRole('textbox',{name:'Ask Anything',exact:true}).fill('Streaming fixture verification '+width);
    // Attach a rejection handler immediately: a preceding UI assertion can fail
    // before this watcher is awaited, and must not crash the entire smoke process.
    const finished=page.waitForRequest(r=>r.url().endsWith('/api/assistant')&&r.postDataJSON()?.op==='ask').catch(()=>null);
    await chat.getByRole('button',{name:'Send question',exact:true}).click();
    const preview=chat.getByTestId('assistant-stream-preview');
    await preview.getByText('Early streaming fixture reply.',{exact:true}).waitFor();
    await chat.getByRole('button',{name:'Stop answer',exact:true}).waitFor();
    if(width===1500) {
      await chat.getByRole('button',{name:'Stop answer',exact:true}).click();
      await preview.waitFor({state:'hidden'});
      await chat.getByText('Answer stopped. Your draft is kept; completed history is unchanged.',{exact:true}).waitFor();
      const stopped=await finished;
      if(!stopped)throw Error('General Chat did not send the expected request before Stop');
      const id=stopped.postDataJSON().id;
      const saved=await (await page.request.get(URL_+'/api/assistant?id='+id)).json();
      if(saved.conversation.messages.some(m=>m.role==='assistant'&&m.parts.some(p=>p.text?.includes('Early streaming fixture')))) throw Error('Stopped preview was persisted');
    } else {
      await chat.getByRole('textbox',{name:'Ask Anything',exact:true}).fill('Next question drafted while streaming');
      await page.locator('[data-window-id="general-chat"]').getByRole('button',{name:'Hide General Chat',exact:true}).click();
      await page.evaluate(() => window.dispatchEvent(new Event('pixelpals:general-chat')));
      await preview.waitFor();
      const completed=await finished;
      if(!completed)throw Error('General Chat did not send the expected streaming request');
      const result=await assistantResult(completed);
      if(!result.conversation.messages.at(-1).parts[0].text.includes('Complete streaming fixture reply.')) throw Error('Stream completion was not saved');
      await preview.waitFor({state:'hidden'});
      if(await chat.getByRole('textbox',{name:'Ask Anything',exact:true}).inputValue()!=='Next question drafted while streaming') throw Error('Stream completion discarded a follow-up draft');
    }
  }
});
await step("Working Pals recurring approval and pause-all preserve results",async()=>{
  await page.setViewportSize({width:1500,height:900});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('pixelpals:configure-integration',{detail:{id:'seerr'}})));
  const setup=page.locator('[data-window-id="setup"]');await setup.waitFor();
  await setup.getByRole('button',{name:'Working Pals',exact:true}).click();
  const inbox=setup.getByRole('region',{name:'Working Pals Inbox'});
  await inbox.getByPlaceholder('Summarize my next steps').fill('Synthetic recurring mission');
  await inbox.getByPlaceholder('Help me choose the smallest next step for my plan…').fill('Suggest one small first step.');
  await inbox.getByRole('button',{name:'Add for approval',exact:true}).click();
  const job=inbox.locator('article').filter({hasText:'Synthetic recurring mission'});
  await job.getByRole('button',{name:'Approve',exact:true}).click();
  await job.getByRole('button',{name:'Run approved job',exact:true}).waitFor();
  await job.getByLabel('I approve repeating this exact local-only question').check();
  await job.getByRole('button',{name:'Approve recurring mission',exact:true}).click();
  await job.getByText(/Recurring: every 1440 minutes/).waitFor();
  await inbox.getByRole('button',{name:'Pause all Pal jobs',exact:true}).click();
  await job.getByText(/paused — approval required to resume/).waitFor();
  const rows=await (await page.request.get(URL_+'/api/working-pals')).json();
  if(rows.missions[0].schedule.enabled||rows.missions[0].status!=='paused')throw Error('Pause did not persist');
});
await step("Named ICS import is consented, persistent, and can be hidden without deletion",async()=>{
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('pixelpals:configure-integration',{detail:{id:'seerr'}})));
  const setup=page.locator('[data-window-id="setup"]');
  await setup.getByRole('navigation',{name:'Settings categories'}).getByRole('button',{name:/Calendar/}).click();
  await setup.getByText('Manage imported calendars',{exact:true}).click();
  await setup.getByLabel('Calendar name',{exact:true}).fill('Synthetic personal calendar');
  await setup.getByLabel('ICS file (up to 1 MB)',{exact:true}).setInputFiles({name:'personal.ics',mimeType:'text/calendar',buffer:Buffer.from('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR')});
  await setup.getByLabel('I have permission to store this calendar on my personal server').check();
  await setup.getByRole('button',{name:'Import snapshot',exact:true}).click();
  const visible=setup.getByRole('checkbox',{name:/Synthetic personal calendar/});await visible.waitFor();
  // The controlled checkbox confirms the saved server state asynchronously.
  await visible.click();
  await page.waitForFunction(async()=>{const r=await fetch('/api/calendar?uploads=1');return (await r.json()).snapshots.some(s=>s.name==='Synthetic personal calendar'&&!s.enabled);},undefined,{timeout:15000});
  const data=await (await page.request.get(URL_+'/api/calendar?uploads=1')).json();
  if(data.snapshots[0].body!==undefined)throw Error('Snapshot endpoint leaked full calendar');
  for (const width of [1500,390,320]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('pixelpals:configure-integration',{detail:{id:'seerr'}})));
    await setup.getByRole('navigation',{name:'Settings categories'}).getByRole('button',{name:/Calendar/}).click();
    const summary=setup.getByText('Manage imported calendars',{exact:true});
    const panel=summary.locator('..');
    if((await panel.getAttribute('open'))===null) await summary.click();
    if(await panel.evaluate(el=>el.scrollWidth>el.clientWidth+2)) throw Error('Calendar import overflows at '+width);
  }

});
await step("Character Universe custom art, guest roster and interaction controls",async()=>{
  await page.setViewportSize({width:1500,height:900});
  const state=await page.request.get(URL_+"/api/character-universe");
  if(!state.ok())throw Error("Owner Character Universe endpoint is not available: "+state.status());
  const snapshot=await state.json();
  if(!Array.isArray(snapshot.characters)||!Array.isArray(snapshot.enabled)||!Number.isInteger(snapshot.revision))
   throw Error("Character Universe did not return a versioned library");
  await page.goto(URL_+"/?workspace=1");
  await page.locator('.modular-workspace[aria-busy="false"]').waitFor();
  const roomEntry=page.locator(".workspace-sidebar .sidebar-item",{hasText:/^\s*Pal Room\s*$/i});
  if(await roomEntry.getAttribute("aria-pressed")!=="true")await roomEntry.click();
  const room=page.locator('[data-window-id="room"]');
  const activities=room.getByRole("region",{name:"Pal Room activities"});
  const mood=activities.getByRole("button",{name:/^Switch Pal Room to (Calm|Playful)$/});
  if(await mood.getAttribute("aria-pressed")!=="true")await mood.click();
  await activities.getByRole("button",{name:"Wave to all Pals"}).waitFor();
  await activities.getByRole("button",{name:"Wave to all Pals"}).click();
  await page.locator('.room-scene .office-pal[data-world-cue="wave"]').first().waitFor({state:"visible"});
  const library=room.locator("details.world-character-library");
  await library.locator("summary").click();
  await library.getByText("Goku · Fan Tribute",{exact:true}).waitFor();
  await library.getByText("Homer · Fan Tribute",{exact:true}).waitFor();
  await library.getByRole("button",{name:"Create character"}).click();
  const editor=library.getByRole("region",{name:"Pixel character creator"});
  if(await editor.getByRole("group",{name:"32 by 32 pixel drawing grid"}).locator("button").count()!==1024)
   throw Error("Character Creator lost its 32x32 pixel grid");
  await editor.getByRole("button",{name:"Close editor"}).click();
});
for(const version of [2,3])await step(`import v${version} 256x256 ZIP, preview, approve, render, and clean up`,async()=>{
  const library=page.locator('[data-window-id="room"] details.world-character-library');
  await library.waitFor({state:"visible"});
  if(await library.getAttribute("open")===null)await library.locator("summary").click();
  const pack=hdCharacterSmokeZip(version);
  const input=library.getByLabel("Choose character ZIP file");
  await input.setInputFiles({name:"smoke-hd-character.zip",mimeType:"application/zip",buffer:pack});
  await library.getByText("Smoke HD Pack · 256×256 character preview",{exact:true}).waitFor({timeout:12000});
  const preview=library.locator(version===3?'img[alt="Smoke HD Bot Front idle preview"]':'img[alt="Smoke HD Bot high resolution pixel art"]');
  await preview.waitFor({state:"visible"});
  const previewDimensions=await preview.evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight}));
  if(previewDimensions.width!==256||previewDimensions.height!==256)
   throw Error("The ZIP importer failed to decode and preview 256px PNG art: "+JSON.stringify(previewDimensions));
  const before=await (await page.request.get(URL_+"/api/character-universe")).json();
  if(before.characters?.some(c=>c.id==="user-smokebot2026"))throw Error("Synthetic smoke character already existed");
  const approve=library.getByRole("button",{name:"Approve & install 1 character(s)"});
  await approve.click();
  await library.getByRole("status").filter({hasText:"1 character(s) installed."}).waitFor({timeout:15000});
  const after=await (await page.request.get(URL_+"/api/character-universe")).json();
  if(!after.characters?.some(c=>c.id==="user-smokebot2026")||after.revision!==before.revision+1)
   throw Error("Owner-approved ZIP install was not saved to the Character Universe");
  await library.getByRole("button",{name:"Enable Smoke HD Bot"}).click();
  const guest=page.locator('.room-scene .world-custom-guest img[alt="Smoke HD Bot 256 pixel character"]');
  await guest.waitFor({state:"visible",timeout:15000});
  const rendered=await guest.evaluate(img=>({w:img.naturalWidth,h:img.naturalHeight}));
  if(rendered.w!==256||rendered.h!==256)throw Error("Imported HD art is not rendered in the Living World");
  if(version===3){
    const saved=after.characters.find(c=>c.id==="user-smokebot2026");
    const src=saved.hd3?.directions?.s?.idle?.frames?.[0]?.src;
    if(!src?.startsWith("/api/character-universe?asset="))throw Error("HD256 assets were not persisted outside metadata");
    const asset=await page.request.get(URL_+src);
    if(!asset.ok()||!asset.headers()["content-type"]?.includes("image/png"))throw Error("Owner cannot load persisted HD256 PNG");
    await library.getByRole("button",{name:"Signature action for Smoke HD Bot",exact:true}).click();
    await page.waitForFunction(()=>{
      const img=document.querySelector('img[alt="Smoke HD Bot 256 pixel character"]');
      return img?.closest(".world-custom-guest")?.getAttribute("data-action")==="signature";
    },undefined,{timeout:1500}).catch(async()=>{
      const state=await guest.evaluate(img=>({actor:img.closest(".world-custom-guest")?.outerHTML,hidden:document.hidden,lowPower:document.documentElement.dataset.lowpower,mood:localStorage.getItem("pixel-pals-room-playful-v1"),focus:localStorage.getItem("pixel-pals-focus-v1"),reduced:matchMedia("(prefers-reduced-motion: reduce)").matches}));
      throw Error("Signature action did not start: "+JSON.stringify(state));
    });
    const held=await guest.evaluate(async img=>{
      const actor=img.closest(".world-custom-guest");
      const before=actor.getAttribute("style");
      const action=actor.getAttribute("data-action");
      await new Promise(resolve=>setTimeout(resolve,300));
      return {before,after:actor.getAttribute("style"),action};
    });
    if(held.action!=="signature"||held.before!==held.after)throw Error("Signature action did not hold the visitor in place: "+JSON.stringify(held));
    const exported=await page.request.get(URL_+"/api/character-universe?export=1");
    if(!exported.ok())throw Error("HD256 backup export failed");
  }
  page.once("dialog",dialog=>dialog.accept());
  await library.getByRole("button",{name:"Delete Smoke HD Bot"}).click();
  await page.waitForFunction(async()=>{
    const r=await fetch("/api/character-universe",{credentials:"same-origin"});
    return r.ok&&!((await r.json()).characters??[]).some(c=>c.id==="user-smokebot2026");
  },undefined,{timeout:15000});
});

await step("health endpoint", async () => {
  const r = await page.request.get(`${URL_}/__health`);
  if (!r.ok()) throw new Error(`status ${r.status()}`);
});
await page.screenshot({ path: process.env.SMOKE_SHOT || "smoke.png", fullPage: false }).catch(() => undefined);
if (process.env.SMOKE_STORAGE_STATE) await page.context().storageState({path:process.env.SMOKE_STORAGE_STATE});
await browser.close();

console.log(notes.join("\n"));
if (problems.length) {
  console.log("\nProblems:\n" + problems.map((p) => ` - ${p}`).join("\n"));
  process.exit(1);
}
console.log("\nSmoke test passed.");
