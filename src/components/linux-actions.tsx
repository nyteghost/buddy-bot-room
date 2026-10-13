import { useState } from "react";
import { toast } from "sonner";
import { desktop, extractCommands, extractNotes, isRiskyCommand, notesDir, runInTerminal } from "@/lib/linux";
import { isTauri } from "@/lib/local-llm";
import { cn } from "@/lib/utils";

/** Approval cards under a Linux Mode reply: nothing runs or saves without a click. */
export function LinuxActions({ text, canRun = true }: { text: string; canRun?: boolean }) {
  const commands = extractCommands(text);
  const notes = extractNotes(text);
  if (!commands.length && !notes.length) return null;
  return (
    <div className="linux-actions">
      {commands.map((cmd, i) => <CommandCard key={`c${i}`} cmd={cmd} canRun={canRun} />)}
      {notes.map((n, i) => <NoteCard key={`n${i}`} {...n} />)}
    </div>
  );
}

function CommandCard({ cmd, canRun }: { cmd: string; canRun: boolean }) {
  const [done, setDone] = useState(false);
  const [hidden, setHidden] = useState(false);
  const risky = isRiskyCommand(cmd);
  const desktopApp = canRun && isTauri();
  if (hidden) return null;
  function run() {
    if (risky && !window.confirm(`This command can change your system or delete data:\n\n${cmd}\n\nRun it?`)) return;
    runInTerminal(cmd);
    setDone(true);
  }
  return (
    <div className={cn("command-card", risky && "command-risky")}>
      {risky && <b className="command-warning">Risky — double-check before running</b>}
      <pre>{cmd}</pre>
      <div className="command-buttons">
        {desktopApp && (
          <button type="button" onClick={run} disabled={done}>
            {done ? "Sent to terminal" : "Run"}
          </button>
        )}
        <button type="button" onClick={() => void navigator.clipboard.writeText(cmd).then(() => toast.success("Copied"))}>Copy</button>
        <button type="button" className="ghost" onClick={() => setHidden(true)}>Dismiss</button>
      </div>
    </div>
  );
}

function NoteCard({ name, content }: { name: string; content: string }) {
  const [saved, setSaved] = useState("");
  if (!isTauri()) return null;
  return (
    <div className="command-card">
      <b>Save note “{name}” to {notesDir()}?</b>
      <pre>{content.slice(0, 400)}</pre>
      <div className="command-buttons">
        <button
          type="button"
          disabled={!!saved}
          onClick={() =>
            void desktop.writeNote(notesDir(), name, content).then(setSaved, (e) => toast.error(String(e)))
          }
        >
          {saved ? "Saved" : "Save note"}
        </button>
      </div>
    </div>
  );
}
