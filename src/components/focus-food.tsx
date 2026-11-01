import { FoodMacroCheck } from "./food-macros";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { PixelCharacter } from "./pixel-character";
import { FoodPal } from "./food-pal";
import { FOOD_KEY, foodCoach, newFoodSession, pastedRecipe, readFoodSession, validRecipe, type FoodRecipe, type FoodSession } from "@/lib/focus-food";
import "./focus-food.css";
const empty: FoodRecipe = { title: "", ingredients: [], steps: [], servings: "", nutrition: "", source: "" };
export function FocusFood({ open }: { open: boolean }) {
  const [session, setSession] = useState<FoodSession | null>(null);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<FoodRecipe>(empty);
  const [ingredients, setIngredients] = useState("");
  const [instructions, setInstructions] = useState("");
  const [review, setReview] = useState(false);
  const [url, setUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState("");
  const [paused, setPaused] = useState(false);
  const [minutes, setMinutes] = useState("5");
  const [timerLabel, setTimerLabel] = useState("Cooking timer");
  const [now, setNow] = useState(Date.now());
  const pending = useRef<AbortController | null>(null);
  const stepRef = useRef<HTMLHeadingElement>(null);
  const cancel = () => { pending.current?.abort(); pending.current = null; setBusy(false); };
  useEffect(() => {
    try { setSession(readFoodSession(localStorage.getItem(FOOD_KEY))); } catch { /* Storage may be unavailable. */ }
    setReady(true);
    return () => pending.current?.abort();
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { if (session) localStorage.setItem(FOOD_KEY, JSON.stringify(session)); else localStorage.removeItem(FOOD_KEY); }
    catch { setNote("Browser storage is unavailable. Keep this tab open; progress cannot be saved."); }
  }, [session, ready]);
  useEffect(() => { if (!open) cancel(); }, [open]);
  useEffect(() => { cancel(); setHelp(""); if (open && session) stepRef.current?.focus({ preventScroll: true }); }, [session?.index, session?.stage]);
  useEffect(() => {
    if (!session?.timer || !open) return;
    setNow(Date.now()); const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [session?.timer, open]);
  const edit = (r: FoodRecipe) => { cancel(); setDraft(r); setIngredients(r.ingredients.join("\n")); setInstructions(r.steps.join("\n\n")); setReview(true); setNote("Review every ingredient, instruction and safety detail against your source before starting."); };
  const call = async (body: Record<string, unknown>) => {
    cancel(); const controller = new AbortController(); pending.current = controller; setBusy(true);
    try {
      const response = await fetch("/api/focus-food", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const data = await response.json();
      if (controller.signal.aborted || pending.current !== controller) return;
      if (!response.ok) { setNote(typeof data.error === "string" ? data.error : "That could not finish. Manual entry still works."); return; }
      if (body["op"] === "help") setHelp(typeof data.text === "string" ? data.text : "Keep following the original recipe.");
      else { const r = validRecipe(data.recipe); if (r) { if (body["op"] === "import") setPasted(""); edit(r); } else setNote("No complete recipe found. Enter the ingredients and instructions manually."); }
    } catch { if (!controller.signal.aborted) setNote("Connection unavailable. You can still paste or enter your recipe and cook offline."); }
    finally { if (pending.current === controller) { pending.current = null; setBusy(false); } }
  };
  const begin = () => {
    const recipe = validRecipe({ ...draft, ingredients: ingredients.split(/\r?\n/).map(x => x.trim()).filter(Boolean), steps: instructions.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean) });
    if (!recipe) { setNote("Add a recipe title, ingredients and instructions. Keep each ingredient under 1,200 characters and each step under 6,000; separate steps with a blank line."); return; }
    cancel(); setSession(newFoodSession(recipe)); setReview(false); setPaused(false); setNote("");
  };
  const reset = () => { if (!window.confirm("Clear this cooking session and its timer? Your tasks, notes and other Focus Assist progress stay saved.")) return; cancel(); setSession(null); setReview(false); setDraft(empty); setIngredients(""); setInstructions(""); setHelp(""); setPaused(false); setNote(""); };
  const remaining = session?.timer ? Math.max(0, Math.ceil((session.timer.end - now) / 1000)) : 0;
  return <div className="focus-food" aria-label="Focus Food cooking assistant">
    <header className="food-heading">{!session && <PixelCharacter id="echo" motion="idle" />}<div><h2>Focus Food</h2><p>One recipe. One manageable step at a time.</p></div></header>
    <p className="food-muted">Recipes and cooking progress stay in this browser. Importing contacts the recipe website; Local AI is optional and never falls back to cloud AI.</p>
    {note && <p role="status" className="food-notice">{note}</p>}
    {!ready ? <p role="status">Loading your saved place…</p> : !session ? <>
      {!review && <section className="food-card" aria-label="Import a recipe">
        <label>Recipe link<input type="url" value={url} maxLength={2000} onChange={e => { cancel(); setUrl(e.target.value); }} placeholder="https://…" /></label>
        <Button disabled={busy || !url.trim()} onClick={() => void call({ op: "import", url: url.trim() })}>Import recipe link</Button>
        <p className="food-muted">Some sites block importing. Paste the recipe or enter it manually instead.</p>
        <label>Paste recipe text<textarea rows={7} maxLength={24000} value={pasted} onChange={e => { cancel(); setPasted(e.target.value); }} placeholder={"Recipe name\nIngredients\n1 cup rice\nInstructions\nFollow the complete source instruction…"} /></label>
        <div className="food-actions"><Button variant="outline" disabled={busy || !pasted.trim()} onClick={() => { const r = pastedRecipe(pasted); if (r) edit(r); else setNote("Use Ingredients and Instructions headings, or choose Enter manually. Put each instruction on its own line."); }}>Use pasted text</Button>
          <Button variant="outline" disabled={busy || !pasted.trim()} onClick={() => void call({ op: "organize", text: pasted })}>Organize with Local AI</Button>
          <Button variant="ghost" disabled={busy} onClick={() => edit(empty)}>Enter manually</Button></div>
      </section>}
      {review && <section className="food-card" aria-label="Review recipe">
        <h3>Review before cooking</h3><p>Check for missing steps, allergies, cooking temperatures and doneness checks. AI organization can omit text; compare with the complete source.</p>
        {draft.source && <a href={draft.source} target="_blank" rel="noopener noreferrer">Open original recipe</a>}
        {pasted && <details><summary>Compare with pasted original</summary><p className="food-original">{pasted}</p></details>}
        <label>Recipe title<input value={draft.title} maxLength={240} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <label>Recipe yield / servings<input value={draft.servings} maxLength={240} onChange={e => setDraft({ ...draft, servings: e.target.value })} placeholder="As written in the recipe" /></label>
        <label>Ingredients — one per line<textarea rows={7} maxLength={24000} value={ingredients} onChange={e => setIngredients(e.target.value)} /></label>
        <label>Full instructions — blank line between steps<textarea rows={10} maxLength={100000} value={instructions} onChange={e => setInstructions(e.target.value)} /></label>
        {draft.nutrition && <p className="food-muted">Source nutrition (basis unverified; confirm per serving vs whole recipe): {draft.nutrition}</p>}
        <div className="food-actions"><Button onClick={begin}>Save recipe and get ready</Button><Button variant="ghost" onClick={() => { cancel(); setReview(false); }}>Back to import</Button></div>
      </section>}
    </> : <>
      <FoodPal session={session} paused={paused} open={open} />
      <section className="food-card" aria-label="Cooking session">
        <h3>{session.recipe.title}</h3>{session.recipe.source && <a href={session.recipe.source} target="_blank" rel="noopener noreferrer">Original recipe</a>}
        {session.recipe.servings && <p>Recipe yield: {session.recipe.servings}</p>}
        {session.stage === "prep" ? <>
          <h3 ref={stepRef} tabIndex={-1}>First, gather what you need</h3><p>Check off ingredients as you find them. Read the full recipe for equipment, thawing or advance preparation before starting.</p>
          {session.recipe.ingredients.map((ingredient, i) => <label className="food-check" key={i}><input type="checkbox" checked={session.checked.includes(i)} onChange={e => setSession({ ...session, checked: e.target.checked ? [...session.checked, i] : session.checked.filter(x => x !== i) })} /><span>{ingredient}</span></label>)}
          <label>Portion plan (optional)<input maxLength={80} value={session.portions} placeholder="e.g. Dinner plus two lunch containers" onChange={e => setSession({ ...session, portions: e.target.value })} /></label>
          <p className="food-muted">Ingredient quantities stay as written. A portion plan does not scale the recipe.</p>
          <Button onClick={() => setSession({ ...session, stage: "cook" })}>I’m ready — show the first step</Button>
        </> : session.stage === "cook" ? <>
          <h3 ref={stepRef} tabIndex={-1}>Step {session.index + 1} of {session.recipe.steps.length}</h3>
          <p className="food-original food-step">{session.recipe.steps[session.index]}</p>
          {paused ? <><p>Your place is saved. Any running timer continues; pausing this screen does not pause cooking.</p><Button onClick={() => setPaused(false)}>Resume cooking</Button></> : <>
            <div className="food-actions"><Button onClick={() => setSession(session.index + 1 < session.recipe.steps.length ? { ...session, index: session.index + 1 } : { ...session, stage: "done" })}>Done with this step</Button>
              <Button variant="outline" disabled={session.index === 0} onClick={() => setSession({ ...session, index: session.index - 1 })}>Previous step</Button>
              <Button variant="outline" onClick={() => { cancel(); setPaused(true); }}>Pause / save my place</Button></div>
            <div className="food-actions"><Button variant="outline" onClick={() => { cancel(); setHelp(foodCoach(session.recipe.steps[session.index]!)); }}>I’m stuck — help me begin</Button>
              <Button variant="ghost" disabled={busy} onClick={() => void call({ op: "help", step: session.recipe.steps[session.index] })}>Ask Local AI for a preparation cue</Button></div>
          </>}
          {help && <div className="food-notice" role="status"><p className="food-original">{help}</p><p className="food-muted">A preparation cue, not a replacement cooking instruction.</p></div>}
        </> : <><h3 ref={stepRef} tabIndex={-1}>You worked through the recipe.</h3><p>Check the recipe’s doneness and food-storage instructions before eating or packing portions. Completing this checklist does not verify that food is safely cooked.</p>{session.portions && <p>Your portion plan: {session.portions}</p>}<p>When you’re ready, set out your containers, then follow the source’s storage instructions. Cleanup can be one small item at a time.</p><Button variant="outline" onClick={() => setSession({ ...session, stage: "cook" })}>Review last step</Button></>}
        <details><summary>Full recipe and ingredients</summary><ul>{session.recipe.ingredients.map((x, i) => <li key={i}>{x}</li>)}</ul><ol>{session.recipe.steps.map((x, i) => <li className="food-original" key={i}>{x}</li>)}</ol>{session.recipe.nutrition && <p>Source nutrition (confirm serving basis): {session.recipe.nutrition}</p>}</details>
      </section>
      {session.stage === "done" && <FoodMacroCheck recipe={session.recipe} value={session.macroCheck} onChange={macroCheck => setSession({ ...session, macroCheck })} />}
      <section className="food-card" aria-label="Cooking timer"><h3>Named timer</h3><p className="food-muted">Check the source for duration. Browser timers can be delayed when your phone sleeps; use a kitchen or phone alarm for critical timing. No alarm sound or background notification is sent.</p>
        {session.timer ? <><p role="timer" aria-label={session.timer.label}>{session.timer.label}: {remaining > 0 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "Time is up — check your recipe"}</p><Button variant="outline" onClick={() => setSession({ ...session, timer: null })}>Clear timer</Button></> : <><label>Timer name<input value={timerLabel} maxLength={80} onChange={e => setTimerLabel(e.target.value)} /></label><label>Minutes<input type="number" min="0.1" max="1440" step="0.1" value={minutes} onChange={e => setMinutes(e.target.value)} /></label><Button variant="outline" disabled={!timerLabel.trim() || !Number.isFinite(+minutes) || +minutes < 0.1 || +minutes > 1440} onClick={() => { setNow(Date.now()); setSession({ ...session, timer: { label: timerLabel.trim(), end: Date.now() + +minutes * 60000 } }); }}>Start timer</Button></>}
      </section>
      <p className="food-muted">Progress saves in this browser as you go. Closing Focus Food keeps your place. It does not sync to another device or your Obsidian vault.</p><Button variant="ghost" onClick={reset}>Clear recipe and start another</Button>
    </>}
    {busy && <div role="status" className="food-actions"><span>Working… Offline and manual options remain available.</span><Button variant="ghost" onClick={cancel}>Cancel request</Button></div>}
  </div>;
}
