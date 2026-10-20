import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addFact, endCampaign, removeFact, setCharacter, startCampaign, updateCampaign, useCampaign } from "@/lib/campaign";

/** The games and playful things: today the Dungeon Master campaign. */
export function FunPanel() {
  const camp = useCampaign();
  const [premise, setPremise] = useState("");
  const [fact, setFact] = useState("");
  return (
    <div className="notes-panel">
      <section>
        <h3>Dungeon Master <span>{camp.active ? "campaign running" : "off"}</span></h3>
        {camp.active ? (
          <>
            <p className="docs-note"><b>{camp.title}</b> — the first pal narrates, the rest are your party. Just say what you do. <code>/roll d20</code> rolls dice.</p>
            <label className="grid gap-1">
              <span className="text-xs">Your character</span>
              <Input aria-label="Your character" placeholder="e.g. a nervous halfling locksmith" value={camp.character} onChange={(e) => updateCampaign((c) => setCharacter(c, e.target.value))} />
            </label>
            <ul>
              {camp.facts.map((f, i) => (
                <li key={f}>
                  <span>{f}</span>
                  <button type="button" aria-label={`Remove fact ${i + 1}`} onClick={() => updateCampaign((c) => removeFact(c, i + 1))}><Trash2 size={13} /></button>
                </li>
              ))}
              {camp.facts.length === 0 && <li className="empty">No facts yet. Add things the Dungeon Master must not forget.</li>}
            </ul>
            <form onSubmit={(e) => { e.preventDefault(); updateCampaign((c) => addFact(c, fact)); setFact(""); }}>
              <Input aria-label="New fact" placeholder="e.g. The keeper vanished three nights ago" value={fact} onChange={(e) => setFact(e.target.value)} />
              <Button type="submit" size="sm" disabled={!fact.trim()}>Add</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => updateCampaign(endCampaign)}>End campaign</Button>
            </form>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (premise.trim()) { updateCampaign(() => startCampaign(premise)); setPremise(""); } }}>
            <Input aria-label="Adventure premise" placeholder="Start an adventure: a haunted lighthouse on a stormy coast" value={premise} onChange={(e) => setPremise(e.target.value)} />
            <Button type="submit" size="sm" disabled={!premise.trim()}>Begin</Button>
          </form>
        )}
      </section>
    </div>
  );
}
