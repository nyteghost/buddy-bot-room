import { scrubBrowserChatHistory } from "@/lib/chat-scrub";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import type { Memory, Scope, KeeperJob } from "@/lib/assistant";
import { assistantApi } from "@/lib/assistant-client";
type MemoryView = {
  records: Memory[];
  projects: { id: string; name: string }[];
  conversations: { id: string; title: string }[];
  jobs: KeeperJob[];
  activity: { at: string; text: string }[];
  online: boolean;
  enabled: boolean;
  model: string;
  active: number;
  pending: number;
  total: number;
  bytes: number;
  lastSuccess: string;
  runtime: { working: boolean };
  index: { model: string; vectors: number };
  sync: { note: string; at: string };
};
export function MemoryCenter() {
  const [state, setState] = useState<MemoryView | null>(null),
    [query, setQuery] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Memory | null>(null),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [scope, setScope] = useState<Scope>("private"),
    [project, setProject] = useState(""),
    [conversation, setConversation] = useState(""),
    [model, setModel] = useState("auto");
  const refresh = async () => {
    try {
      const d = await assistantApi(undefined, "?view=memory&q=" + encodeURIComponent(query));
      setState(d);
      setModel(d.model);
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  useEffect(() => {
    void refresh();
    // Initial fetch only; search and action handlers refresh with their current query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const act = async (data: unknown) => {
    setBusy(true);
    try {
      const d = await assistantApi(data);
      setNote(d.note || "Saved.");
      await refresh();
      return true;
    } catch (e) {
      setNote((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    try {
      const d = await assistantApi({ op: "export" });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "pixel-pals-memory-export.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  const edit = (m: Memory) => {
    setEditing(m);
    setTitle(m.title);
    setBody(m.text);
    setScope(m.scope);
    setProject(m.project);
    setConversation(m.conversation);
  };
  return (
    <section className="assistant-memory" aria-label="Memory Center">
      <h2>Memory Center</h2>
      <p>
        One Memory Keeper for your conversations. Only active, authorized, relevant records are
        supplied to an answer. Pending suggestions need your review.
      </p>
      {note && (
        <p role="status" className="assistant-notice">
          {note}
        </p>
      )}
      {state && (
        <>
          <div className="assistant-stats">
            <p>
              <strong>{state.online ? "Ollama connected" : "Ollama offline"}</strong>
              <br />
              Keeper {state.enabled ? "enabled" : "paused"} ·{" "}
              {state.runtime.working ? "processing" : "idle"} · {state.model}
            </p>
            <p>
              {state.active} active · {state.pending} pending · {state.total} total
              <br />
              {state.jobs.length} queued jobs · {(state.bytes / 1024).toFixed(1)} KB
            </p>
            <p>
              Last processed: {state.lastSuccess || "Not yet"}
              <br />
              Index: {state.index.model} · {state.index.vectors} cached vectors
            </p>
            <p>
              {state.sync.note}
              <br />
              {state.sync.at || "No vault sync yet"}
            </p>
          </div>
          <details>
            <summary>Memory Keeper settings</summary>
            <label>
              Memory processing model
              <input value={model} onChange={(e) => setModel(e.target.value)} maxLength={120} />
            </label>
            <div className="assistant-actions">
              {["on", "off"].map((value) => (
                <Button
                  key={value}
                  variant="outline"
                  onClick={async () => {
                    const r = await fetch("/api/settings", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        values: { MEMORY_KEEPER_ENABLED: value, MEMORY_KEEPER_MODEL: model },
                      }),
                    });
                    setNote(
                      r.ok ? "Memory Keeper settings saved." : "Settings could not be saved.",
                    );
                    void refresh();
                  }}
                >
                  {value === "on" ? "Enable Memory Keeper" : "Pause Memory Keeper"}
                </Button>
              ))}
            </div>
            <p>
              Auto uses a smaller installed local model. Main-chat AI remains independent.
              Embedding, context budgets, vault sync and cloud-memory permission are in Settings →
              Local AI / Obsidian.
            </p>
          </details>
          <div className="assistant-actions">
            <Button disabled={busy} variant="outline" onClick={() => void act({ op: "retry" })}>
              Retry queued jobs
            </Button>
            <Button disabled={busy} variant="outline" onClick={() => void act({ op: "sync" })}>
              Sync Obsidian
            </Button>
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => void act({ op: "sync", importEdits: true })}
            >
              Import manual Obsidian edits for review
            </Button>
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => void act({ op: "import-brain" })}
            >
              Import existing Second Brain notes privately
            </Button>
            <Button disabled={busy} variant="outline" onClick={() => void act({ op: "rebuild" })}>
              Rebuild retrieval index
            </Button>
            <Button onClick={() => void download()} variant="outline">
              Export conversations & memory
            </Button>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              if (
                confirm(
                  "Recover managed Markdown as private pending records? Lost permissions will not be guessed; existing records stay intact.",
                )
              )
                void act({ op: "recover-markdown", confirm: true });
            }}
          >
            Recover managed Obsidian Markdown
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (
                confirm(
                  "Scrub recognizable credentials from all live chats and memory versions? This cannot erase previously exported files, images or backups.",
                )
              ) {
                scrubBrowserChatHistory(localStorage);
                void act({ op: "scrub-history" });
              }
            }}
          >
            Scrub existing chat history
          </Button>
          <label>
            Restore memory export
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file || file.size > 8000000) return;
                if (
                  !confirm(
                    "Merge this export? Memories return for review; recovered conversations are archived with collection off. Current data and forgotten-memory protections stay in place.",
                  )
                )
                  return;
                try {
                  await act({
                    op: "restore",
                    archive: JSON.parse(await file.text()),
                    confirm: true,
                  });
                } catch {
                  setNote("Invalid export file");
                }
              }}
            />
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void refresh();
            }}
            className="assistant-actions"
          >
            <label>
              Search all memories
              <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={200} />
            </label>
            <Button type="submit">Search memories</Button>
          </form>
          <details open={!!editing}>
            <summary>{editing ? "Correct this memory" : "Add a memory"}</summary>
            <div className="assistant-editor">
              <label>
                Memory title
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
              </label>
              <label>
                Memory text
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={2400}
                  rows={5}
                />
              </label>
              <label>
                Memory scope
                <select value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                  {["private", "conversation", "project", "global"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              {scope === "project" && (
                <label>
                  Project
                  <select value={project} onChange={(e) => setProject(e.target.value)}>
                    <option value="">Choose project</option>
                    {state.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {scope === "conversation" && (
                <label>
                  Conversation
                  <select value={conversation} onChange={(e) => setConversation(e.target.value)}>
                    <option value="">Choose conversation</option>
                    {state.conversations.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p>
                Global is shared across your chats. Project stays in that project. Private requires
                a per-chat grant. Editing or restricting a record invalidates old checkpoints.
              </p>
              <div className="assistant-actions">
                <Button
                  disabled={busy || !title.trim() || !body.trim()}
                  onClick={async () => {
                    const changed =
                      editing &&
                      (scope !== editing.scope ||
                        project !== editing.project ||
                        conversation !== editing.conversation);
                    if (
                      changed &&
                      !confirm(
                        "Approve this memory scope change? It may change which chats can access the record.",
                      )
                    )
                      return;
                    if (
                      await act({
                        op: "memory-save",
                        id: editing?.id,
                        revision: editing?.revision,
                        title,
                        text: body,
                        scope,
                        project,
                        conversation,
                        confirmScope: !!changed,
                      })
                    ) {
                      setEditing(null);
                      setTitle("");
                      setBody("");
                    }
                  }}
                >
                  Save confirmed memory
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditing(null);
                    setTitle("");
                    setBody("");
                  }}
                >
                  Cancel edit
                </Button>
              </div>
            </div>
          </details>
          <div className="assistant-memory-list">
            {state.records.map((m: Memory) => (
              <article className="assistant-card" key={m.id}>
                <h3>
                  {m.pinned ? "★ " : ""}
                  {m.title}
                </h3>
                <p className="assistant-muted">
                  {m.scope}
                  {m.scope === "project"
                    ? " · " + (state.projects.find((p) => p.id === m.project)?.name ?? "Project")
                    : m.scope === "conversation"
                      ? " · " +
                        (state.conversations.find((c) => c.id === m.conversation)?.title ??
                          "Conversation")
                      : ""}{" "}
                  · {m.status} ·{" "}
                  {m.verified ? "User confirmed" : "Unverified AI / imported suggestion"} ·
                  confidence {m.confidence} · revision {m.revision}
                </p>
                <p className="assistant-text">{m.text}</p>
                {m.conflicts.length > 0 && (
                  <p>Possible contradiction: review {m.conflicts.length} related record(s).</p>
                )}
                <details>
                  <summary>Sources & versions</summary>
                  <p>
                    ID: {m.id}
                    <br />
                    {m.updated}
                  </p>
                  {m.sources.map((s, i) => (
                    <p key={i}>
                      Conversation {s.conversation} · message {s.message}
                      <br />
                      {s.quote}
                    </p>
                  ))}
                  {m.versions.map((v, i) => (
                    <div key={i}>
                      <p>
                        {v.at} · {v.scope}: {v.text}
                      </p>
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (confirm("Restore this prior version within its current scope?"))
                            void act({
                              op: "memory-action",
                              id: m.id,
                              revision: m.revision,
                              action: "version",
                              version: i,
                            });
                        }}
                      >
                        Restore version {i + 1}
                      </Button>
                    </div>
                  ))}
                </details>
                {m.status !== "deleted" && (
                  <div className="assistant-actions">
                    <Button variant="outline" onClick={() => edit(m)}>
                      Edit / correct
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void act({
                          op: "memory-action",
                          id: m.id,
                          revision: m.revision,
                          action: "pin",
                        })
                      }
                    >
                      {m.pinned ? "Unpin" : "Pin"}
                    </Button>
                    {m.status === "pending" && (
                      <Button
                        onClick={() => {
                          if (
                            m.conflicts.length &&
                            !confirm("Approve this memory and archive conflicting records?")
                          )
                            return;
                          void act({
                            op: "memory-action",
                            id: m.id,
                            revision: m.revision,
                            action: "approve",
                            confirmReplace: true,
                          });
                        }}
                      >
                        Approve memory
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() =>
                        void act({
                          op: "memory-action",
                          id: m.id,
                          revision: m.revision,
                          action: m.status === "archived" ? "restore" : "archive",
                        })
                      }
                    >
                      {m.status === "archived" ? "Restore for review" : "Archive"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (
                          confirm(
                            "Permanently clear this memory and its versions? Its source messages will be excluded from future assistant context. Backups/manual vault conflicts may still require cleanup.",
                          )
                        )
                          void act({
                            op: "memory-action",
                            id: m.id,
                            revision: m.revision,
                            action: "delete",
                          });
                      }}
                    >
                      Delete memory
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
          <details>
            <summary>Queue & recent activity</summary>
            {state.jobs.map((j) => (
              <p key={j.conversation}>
                {j.conversation} · {j.state} · attempt {j.attempts} · {j.note}
              </p>
            ))}
            {state.activity.map((a, i) => (
              <p key={i}>
                {a.at} · {a.text}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
