import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { entryLabel, formatMinutes, type EventCode, type EventEntry, type EventRow, type TaskNote } from "@/lib/work-tools";
import {
  applyReview, emptyReviewDraft, validEntry, type ReviewDraft, type ReviewLine,
} from "@/lib/showpilot-review";

const CODES: EventCode[] = ["S","MI","Exmi","MO","MO?","Arr","Breakfast","Lunch","Dinner","Food","MTG"];
const human = (n: number) => {
  const h = Math.floor((n % 1440) / 60).toString().padStart(2, "0");
  const m = (n % 60).toString().padStart(2, "0");
  return h + ":" + m;
};
const minutes = (s: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const uniqueId = (type: string) => type + ":" + Date.now() + ":" + Math.random().toString(36).slice(2, 10);

export function ScheduleReview({
  originalRows, proposed, suggestedTasks, draft, onChange, onSaveProject,
}: {
  originalRows: EventRow[];
  proposed: EventEntry[];
  suggestedTasks: TaskNote[];
  draft: ReviewDraft;
  onChange: (draft: ReviewDraft) => void;
  onSaveProject: () => void;
}) {
  const [mode, setMode] = useState<"imported"|"review"|"changes">("review");
  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [editable, setEditable] = useState<EventEntry | null>(null);
  const [error, setError] = useState("");
  const [editingTask, setEditingTask] = useState<string | null>(null);
  const [taskText, setTaskText] = useState("");
  const result = useMemo(() => applyReview(proposed, suggestedTasks, draft), [proposed, suggestedTasks, draft]);
  const changes = result.entryLines.filter((row) => row.status !== "unchanged").length
    + result.taskLines.filter((row) => row.status !== "unchanged").length;
  const dates = useMemo(() => [...new Set([...proposed.map((r)=>r.date),...result.entries.map((r)=>r.date)])].sort(), [proposed, result.entries]);
  const allowedSpaces = useMemo(() => [...new Set(proposed.map((e) => e.space))].sort(), [proposed]);
  const filtered = result.entryLines.filter((line) => {
    const e = line.final ?? line.source;
    if (!e) return false;
    if (mode === "changes" && line.status === "unchanged") return false;
    if (date && e.date !== date && line.source?.date !== date) return false;
    const q = search.trim().toLowerCase();
    return !q || [e.title,e.space,e.date,e.code,e.eventId ?? ""].join(" ").toLowerCase().includes(q);
  });
  const pageSize = 35, pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(Math.min(page, pageCount - 1) * pageSize, (Math.min(page, pageCount - 1) + 1) * pageSize);
  const update = (next: ReviewDraft) => { setError(""); onChange(next); };
  function replaceEntry(line: ReviewLine<EventEntry>, value: EventEntry) {
    if (!validEntry(value) || !allowedSpaces.includes(value.space)) {
      setError("Enter a real date, a verified convention-center room, an event name, and an end time after the start time."); return;
    }
    if (line.status === "added") update({...draft, addedEntries: draft.addedEntries.map((row) => row.id === line.id ? {...row,value} : row)});
    else update({...draft, entries: {...draft.entries, [line.id]: {action:"replace",value}}});
    setEditing(null);setEditable(null);
  }
  function removeEntry(line: ReviewLine<EventEntry>) {
    if (line.status === "added") update({...draft,addedEntries:draft.addedEntries.filter((r) => r.id !== line.id)});
    else update({...draft,entries:{...draft.entries,[line.id]:{action:"remove"}}});
    setEditing(null);
  }
  function restoreEntry(line: ReviewLine<EventEntry>) {
    const entries = {...draft.entries}; delete entries[line.id];
    update({...draft,entries}); setEditing(null);
  }
  function editTask(line: ReviewLine<TaskNote>, text: string) {
    const original = line.final ?? line.source; if (!original) return;
    if (!text.trim()) { setError("Task text cannot be empty."); return; }
    const value = {...original,text:text.trim()};
    if (line.status === "added") update({...draft,addedTasks:draft.addedTasks.map((t)=>t.id===line.id?{...t,value}:t)});
    else update({...draft,tasks:{...draft.tasks,[line.id]:{action:"replace",value}}});
    setEditingTask(null);
  }
  function removeTask(line: ReviewLine<TaskNote>) {
    if (line.status === "added") update({...draft,addedTasks:draft.addedTasks.filter((r)=>r.id!==line.id)});
    else update({...draft,tasks:{...draft.tasks,[line.id]:{action:"remove"}}});
  }
  function restoreTask(line: ReviewLine<TaskNote>) {
    const tasks = {...draft.tasks};delete tasks[line.id];update({...draft,tasks});
  }
  const imported = originalRows.filter((r)=> (!date || r.date === date) && (!search ||
    [r.date,r.space,r.event??"",r.description,r.eventId??""].join(" ").toLowerCase().includes(search.toLowerCase())));
  return <section className="space-y-4 rounded-xl border border-border p-3 sm:p-4" aria-label="Two-layer engineering schedule">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-base font-semibold">Imported report → reviewed engineering schedule</h3>
        <p className="text-xs text-muted-foreground">The original Ungerboeck lines stay unchanged. Only reviewed entries and tasks are used when exporting Excel.</p>
      </div>
      <Button variant="outline" size="sm" onClick={onSaveProject}>Save review project (.json)</Button>
    </div>
    <div className="grid grid-cols-3 gap-2 text-center">
      <div className="rounded-lg bg-muted p-2"><strong className="block text-lg">{originalRows.length}</strong><span className="text-xs">Original functions</span></div>
      <div className="rounded-lg bg-muted p-2"><strong className="block text-lg">{result.entries.length}</strong><span className="text-xs">Final entries</span></div>
      <div className="rounded-lg bg-muted p-2"><strong className="block text-lg">{changes}</strong><span className="text-xs">Reviewed changes</span></div>
    </div>
    {result.unmatchedChanges > 0 && <p className="rounded border border-amber-500 p-2 text-xs">Heads-up: {result.unmatchedChanges} saved changes no longer match the latest proposed entries. They were not applied. Export your project before discarding or reimporting.</p>}
    <div className="flex flex-wrap gap-2">
      {([["imported","1. Original functions"],["review","2. Edit schedule"],["changes","3. Changes / comparison"]] as const).map(([id,label])=>
        <Button key={id} variant={mode===id?"default":"outline"} size="sm" onClick={()=>{setMode(id);setPage(0);setEditing(null)}}>{label}</Button>
      )}
    </div>
    <div className="flex flex-wrap gap-2">
      <Input className="max-w-sm" aria-label="Search events or rooms" placeholder="Search events or rooms…" value={search} onChange={(e)=>{setSearch(e.target.value);setPage(0)}}/>
      <select className="rounded-md border border-border bg-background px-3 py-2 text-sm" aria-label="Filter by date" value={date} onChange={(e)=>{setDate(e.target.value);setPage(0)}}>
        <option value="">All dates</option>{dates.map((d)=><option value={d} key={d}>{d}</option>)}
      </select>
      {mode==="review" && proposed.length>0 && <Button variant="outline" size="sm" onClick={()=>{
        const d = date || proposed[0]?.date || new Date().toISOString().slice(0,10);
        const space = allowedSpaces[0] ?? "Hall A";
        const value: EventEntry = {date:d,space,title:"New event",code:"S",start:480,end:1020};
        const id=uniqueId("manual-entry");
        update({...draft,addedEntries:[...draft.addedEntries,{id,value}]});
        setSearch("");setDate(d);setPage(0);setEditing(id);setEditable(value);
      }}>+ Add event entry</Button>}
    </div>
    {mode==="imported" ? <div className="max-h-96 overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted text-left"><tr>{["Date","Event / ID","Space","Original description","Start","End"].map((h)=><th className="p-2" key={h}>{h}</th>)}</tr></thead>
        <tbody>{imported.slice(0,150).map((r,i)=><tr className="border-t" key={i}><td className="p-2 whitespace-nowrap">{r.date}</td><td className="p-2">{r.event || "—"} {r.eventId && <span className="text-muted-foreground">#{r.eventId}</span>}</td><td className="p-2">{r.space}</td><td className="p-2">{r.description}</td><td className="p-2 whitespace-nowrap">{r.start}</td><td className="p-2 whitespace-nowrap">{r.end}</td></tr>)}</tbody>
      </table>{imported.length>150&&<p className="p-2 text-xs text-muted-foreground">Showing first 150 of {imported.length} functions; narrow by date or search.</p>}
    </div> : <>
      <div className="max-h-[32rem] overflow-auto rounded-md border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted text-left"><tr><th className="p-2">Day / room</th><th className="p-2">Suggested from Ungerboeck</th><th className="p-2">Reviewed final</th><th className="p-2">Action</th></tr></thead>
          <tbody>{visible.map((line)=>{
            const original=line.source, final=line.final;
            const current = final ?? original;
            if(!current)return null;
            return <tr className="border-t align-top" key={line.id}>
              <td className="p-2 min-w-28">{current.date}<div className="font-semibold">{current.space}</div><span className="text-muted-foreground">{line.status}</span></td>
              <td className="p-2 min-w-36">{original?<><div>{entryLabel(original)}</div><div>{original.title}</div></>:<em>Manually added</em>}</td>
              <td className="p-2 min-w-40">{editing===line.id&&editable ? <div className="grid min-w-56 gap-2">
                <label>Event title<Input aria-label="Event title" value={editable.title} onChange={e=>setEditable({...editable,title:e.target.value})}/></label>
                <label>Date<Input type="date" aria-label="Event date" value={editable.date} onChange={e=>setEditable({...editable,date:e.target.value})}/></label>
                <label>Room<select aria-label="Verified room" className="w-full rounded-md border bg-background p-2" value={editable.space} onChange={e=>setEditable({...editable,space:e.target.value})}>{allowedSpaces.map(s=><option key={s}>{s}</option>)}</select></label>
                <label>Phase<select aria-label="Event phase" className="w-full rounded-md border bg-background p-2" value={editable.code} onChange={e=>setEditable({...editable,code:e.target.value as EventCode})}>{CODES.map(s=><option key={s}>{s}</option>)}</select></label>
                <div className="grid grid-cols-2 gap-2">
                  <label>Start<Input type="time" aria-label="Start time" value={human(editable.start)} onChange={e=>{const n=minutes(e.target.value);if(Number.isFinite(n))setEditable({...editable,start:n})}}/></label>
                  <label>End<Input type="time" aria-label="End time" value={human(editable.end)} onChange={e=>{const n=minutes(e.target.value);if(Number.isFinite(n))setEditable({...editable,end:n+(editable.end>=1440?1440:0)})}}/></label>
                </div>
                <label className="flex items-center gap-2"><input type="checkbox" checked={editable.end>=1440} onChange={e=>setEditable({...editable,end:editable.end%1440+(e.target.checked?1440:0)})}/> Ends next day</label>
                <div className="flex gap-2"><Button size="sm" onClick={()=>replaceEntry(line,editable)}>Save</Button><Button variant="outline" size="sm" onClick={()=>setEditing(null)}>Cancel</Button></div>
              </div> : final ? <><div>{entryLabel(final)}</div><div>{final.title}</div></> : <em>Removed from schedule</em>}</td>
              <td className="p-2 whitespace-nowrap">
                {editing!==line.id && <div className="flex flex-wrap gap-1">
                  {final && <Button size="sm" variant="outline" onClick={()=>{setEditing(line.id);setEditable({...final});setError("")}}>Edit</Button>}
                  {final && <Button size="sm" variant="outline" onClick={()=>removeEntry(line)}>Remove</Button>}
                  {original && line.status!=="unchanged" && <Button size="sm" variant="outline" onClick={()=>restoreEntry(line)}>Restore</Button>}
                </div>}
              </td>
            </tr>;
          })}</tbody>
        </table>
        {!visible.length&&<p className="p-4 text-sm text-muted-foreground">No matching entries.</p>}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{filtered.length} matching entries; showing {Math.min(page,pageCount-1)*pageSize+Math.min(1,filtered.length)}–{Math.min((Math.min(page,pageCount-1)+1)*pageSize,filtered.length)}</span>
        <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page<=0} onClick={()=>setPage(v=>v-1)}>Previous</Button><span>{Math.min(page,pageCount-1)+1} / {pageCount}</span><Button variant="outline" size="sm" disabled={page>=pageCount-1} onClick={()=>setPage(v=>v+1)}>Next</Button></div>
      </div>
      <div className="rounded-lg border border-border p-3">
        <div className="flex justify-between gap-2"><div><h4 className="font-semibold">Air-wall, stage and room-turn tasks</h4><p className="text-xs text-muted-foreground">Suggestions are separate from the final task instructions. Existing typed tasks in uploaded Excel schedules remain untouched.</p></div>
          {mode==="review"&&<Button size="sm" variant="outline" onClick={()=>{
            const value:TaskNote={date:date||proposed[0]?.date||new Date().toISOString().slice(0,10),section:"HALLS",text:"Manual task"};
            update({...draft,addedTasks:[...draft.addedTasks,{id:uniqueId("manual-task"),value}]});
          }}>+ Add task</Button>}</div>
        <div className="mt-2 max-h-56 overflow-auto space-y-2">
          {result.taskLines.filter(l=>mode!=="changes"||l.status!=="unchanged").filter(l=>!date||(l.final??l.source)?.date===date).map((line)=>{
            const t=line.final??line.source;if(!t)return null;
            return <div className="flex flex-wrap items-start justify-between gap-2 border-t pt-2 text-xs" key={line.id}>
              <div className="flex-1 min-w-48"><strong>{t.date} · {t.section}</strong> <span className="text-muted-foreground">({line.status})</span>
                {editingTask===line.id ? <div className="mt-1 flex gap-2"><Input aria-label="Task instructions" value={taskText} onChange={e=>setTaskText(e.target.value)}/><Button size="sm" onClick={()=>editTask(line,taskText)}>Save</Button></div> :
                <p>{line.final?.text??<s>{line.source?.text}</s>}</p>}
                {line.source&&line.status==="edited"&&<p className="text-muted-foreground">Original: {line.source.text}</p>}
              </div>
              <div className="flex flex-wrap gap-1">
                {line.final&&mode==="review"&&<><Button variant="outline" size="sm" onClick={()=>{setEditingTask(line.id);setTaskText(line.final?.text??"")}}>Edit</Button><Button variant="outline" size="sm" onClick={()=>removeTask(line)}>Remove</Button></>}
                {line.source&&line.status!=="unchanged"&&<Button variant="outline" size="sm" onClick={()=>restoreTask(line)}>Restore</Button>}
              </div>
            </div>;
          })}
        </div>
      </div>
    </>}
    {error && <p role="alert" className="rounded border border-destructive p-2 text-xs text-destructive">{error}</p>}
    <p className="text-xs text-muted-foreground">All edits are local to this imported report. Saving a project preserves source lines and decisions in one file. A PDF may contain functions not yet handled by the keyword classifier; review unknown and guessed MO? entries before publishing.</p>
  </section>;
}
