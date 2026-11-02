import { scrubChatText } from "@/lib/chat-scrub";
import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Message, MessageContent, MessageResponse } from "./ai-elements/message";
import { MemoryCenter } from "./memory-center";
import { assistantApi } from "@/lib/assistant-client";
import { useEngine, turnProviders } from "@/lib/engine";
import { messageString, sensitive, type Conversation, type Memory } from "@/lib/assistant";
import "./general-chat.css";
export function GeneralChat({
  open,
  initialView = "chat",
}: {
  open: boolean;
  initialView?: "chat" | "memory";
}) {
  useEffect(() => {
    if (window.innerWidth > 700) setDrawer(true);
  }, []);
  const engine = useEngine();
  const [list, setList] = useState<Conversation[]>([]),
    [projects, setProjects] = useState<{ id: string; name: string }[]>([]),
    [legacy, setLegacy] = useState<{ id: string; title: string }[]>([]),
    [current, setCurrent] = useState<Conversation | null>(null),
    [draft, setDraft] = useState(""),
    [query, setQuery] = useState(""),
    [view, setView] = useState(initialView),
    [filter, setFilter] = useState("active"),
    [drawer, setDrawer] = useState(false),
    [note, setNote] = useState(""),
    [provider, setProvider] = useState("auto"),
    [model, setModel] = useState(""),
    [research, setResearch] = useState(false),
    [maskIdentifiers, setMaskIdentifiers] = useState(false),
    [pending, setPending] = useState<string[]>([]),
    [show, setShow] = useState(80),
    [inspector, setInspector] = useState<Pick<Memory, "id" | "title" | "text" | "scope">[] | null>(
      null,
    );
  const [privateRecords, setPrivateRecords] = useState<Memory[] | null>(null),
    [grants, setGrants] = useState<string[]>([]);
  const currentRef = useRef<Conversation | null>(null),
    draftRef = useRef(""),
    controllers = useRef(new Map<string, AbortController>()),
    loaded = useRef(false),
    drafts = useRef<Record<string, string>>({});
  currentRef.current = current;
  draftRef.current = draft;
  const refresh = async () => {
    const d = await assistantApi(undefined, query ? "?q=" + encodeURIComponent(query) : "");
    setList(d.conversations);
    setProjects(d.projects);
    setLegacy(d.legacy);
    if (d.privacy?.maskIdentifiers) setMaskIdentifiers(true);
    return d;
  };
  const select = async (id: string, save = true) => {
    try {
      const previous = currentRef.current;
      if (previous && save && !controllers.current.has(previous.id)) {
        drafts.current[previous.id] = draftRef.current;
        await assistantApi({
          op: "update",
          id: previous.id,
          revision: previous.assistant.revision,
          patch: { draft: draftRef.current, choice: { provider, model, research } },
        });
      }
      const d = await assistantApi(undefined, "?id=" + encodeURIComponent(id));
      setCurrent(d.conversation);
      setProvider(d.conversation.assistant.choice?.provider ?? "auto");
      setModel(d.conversation.assistant.choice?.model ?? "");
      setResearch(d.conversation.assistant.choice?.research ?? false);
      let saved = "";
      try {
        saved = localStorage.getItem("pixel-pals-assistant-draft-" + id) ?? "";
        localStorage.setItem("pixel-pals-assistant-selected", id);
      } catch {
        /* Browser storage may be unavailable; server history stays authoritative. */
      }
      setDraft(
        scrubChatText(drafts.current[id] ?? (saved || d.conversation.assistant.draft || "")),
      );
      setShow(80);
      setView("chat");
      setDrawer(false);
      setInspector(null);
      void refresh();
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  const create = async (extra: Record<string, unknown> = {}) => {
    try {
      const previous = currentRef.current;
      if (previous && !controllers.current.has(previous.id))
        await assistantApi({
          op: "update",
          id: previous.id,
          revision: previous.assistant.revision,
          patch: { draft: draftRef.current, choice: { provider, model, research } },
        });
      const d = await assistantApi({ op: "create", ...extra });
      setCurrent(d.conversation);
      setProvider("auto");
      setModel("");
      setResearch(false);
      setDraft("");
      setView("chat");
      setDrawer(false);
      try {
        localStorage.setItem("pixel-pals-assistant-selected", d.conversation.id);
      } catch {
        /* Browser storage may be unavailable; server history stays authoritative. */
      }
      await refresh();
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    void (async () => {
      try {
        const d = await refresh();
        let selected = "";
        try {
          selected = localStorage.getItem("pixel-pals-assistant-selected") ?? "";
        } catch {
          /* Browser storage may be unavailable; server history stays authoritative. */
        }
        const found =
          d.conversations.find(
            (c: Conversation) => c.id === selected && c.assistant.status !== "deleted",
          ) ?? d.conversations.find((c: Conversation) => c.assistant.status === "active");
        if (found) await select(found.id, false);
        else await create();
        setView(initialView);
      } catch (e) {
        setNote((e as Error).message);
      }
    })();
    // Initialize once when opened; later selections use current event handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    setView(initialView);
  }, [initialView]);
  useEffect(() => {
    const c = currentRef.current;
    if (!c || sensitive(draft)) return;
    drafts.current[c.id] = draft;
    try {
      localStorage.setItem("pixel-pals-assistant-draft-" + c.id, draft);
    } catch {
      /* Browser storage may be unavailable; server history stays authoritative. */
    }
  }, [draft, current?.id]);
  useEffect(
    () => () => {
      for (const c of controllers.current.values()) c.abort();
    },
    [],
  );
  const update = async (patch: Record<string, unknown>, confirmScope = false) => {
    if (!current) return;
    try {
      const d = await assistantApi({
        op: "update",
        id: current.id,
        revision: current.assistant.revision,
        patch: { draft, ...patch },
        confirmScope,
      });
      setCurrent(d.conversation);
      await refresh();
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  const send = async () => {
    const c = currentRef.current,
      q = draftRef.current;
    if (!c || !q.trim() || controllers.current.has(c.id)) return;
    const controller = new AbortController();
    controllers.current.set(c.id, controller);
    setPending([...controllers.current.keys()]);
    setNote("");
    try {
      const r = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "ask",
          id: c.id,
          revision: c.assistant.revision,
          question: q,
          engine,
          provider,
          model,
          research,
          maskIdentifiers,
        }),
        signal: controller.signal,
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "Could not answer");
      drafts.current[c.id] = "";
      try {
        localStorage.removeItem("pixel-pals-assistant-draft-" + c.id);
      } catch {
        /* Browser storage may be unavailable; server history stays authoritative. */
      }
      if (currentRef.current?.id === c.id) {
        setCurrent(d.conversation);
        setDraft("");
        setNote(
          `Answered with ${d.route.provider} · ${d.route.model}${d.usedMemories.length ? ` · ${d.usedMemories.length} relevant memories` : ""}`,
        );
      } else setNote("Answer saved in " + d.conversation.title);
      await refresh();
    } catch (e) {
      if (!controller.signal.aborted) setNote((e as Error).message);
      else setNote("Answer stopped; your question is saved.");
      const d = await assistantApi(undefined, "?id=" + c.id).catch(() => null);
      if (d && currentRef.current?.id === c.id) setCurrent(d.conversation);
    } finally {
      controllers.current.delete(c.id);
      setPending([...controllers.current.keys()]);
    }
  };
  const continueFresh = async () => {
    if (!current) return;
    if (
      (current.assistant.project || current.assistant.privateIds.length) &&
      !confirm(
        "Carry this conversation’s project and private memory permissions into a fresh chat?",
      )
    )
      return;
    await create({
      op: "continue",
      id: current.id,
      confirmScope: true,
      title: "Continue: " + current.title,
    });
  };
  const rendered = list
    .filter((c) => c.assistant.status === filter)
    .sort(
      (a, b) =>
        Number(b.assistant.pinned) - Number(a.assistant.pinned) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  return (
    <div className="general-assistant" aria-label="General Chat assistant">
      <header className="assistant-top">
        <Button variant="outline" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>
          {drawer ? "Hide conversations" : "Conversations"}
        </Button>
        <h1>{view === "memory" ? "Memory Center" : "General Chat"}</h1>
        <div className="assistant-actions">
          <Button
            variant="outline"
            onClick={() => {
              if (view === "memory" && current) void select(current.id, false);
              setView("chat");
              setTimeout(() => document.getElementById("ask-anything")?.focus(), 0);
            }}
          >
            Ask Anything
          </Button>
          <Button variant="outline" onClick={() => setView("memory")}>
            Memory Center
          </Button>
        </div>
      </header>
      {note && (
        <p role="status" className="assistant-notice">
          {note}
        </p>
      )}
      <div className={"assistant-layout " + (drawer ? "drawer-open" : "")}>
        <aside className="assistant-sidebar" aria-label="Conversation navigation">
          <Button
            variant="outline"
            onClick={() => {
              setView("chat");
              setDrawer(false);
              setTimeout(() => document.getElementById("ask-anything")?.focus(), 0);
            }}
          >
            General Chat · Ask Anything
          </Button>
          <Button onClick={() => void create()}>New Chat</Button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void refresh();
            }}
          >
            <label>
              Search conversations
              <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={160} />
            </label>
            <Button type="submit" variant="outline">
              Search history
            </Button>
          </form>
          <label>
            Conversation list
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="active">Recent & pinned</option>
              <option value="archived">Archived conversations</option>
              <option value="deleted">Recoverable deleted</option>
            </select>
          </label>
          {rendered.map((c) => (
            <button
              className="assistant-chat-link"
              aria-current={current?.id === c.id ? "page" : undefined}
              key={c.id}
              onClick={() => void select(c.id)}
            >
              {c.assistant.pinned ? "★ " : ""}
              {c.title}
              <small>
                {projects.find((p) => p.id === c.assistant.project)?.name || "General"} ·{" "}
                {c.updatedAt.slice(0, 10)}
              </small>
              {pending.includes(c.id) && <small>Answering…</small>}
            </button>
          ))}
          <details>
            <summary>Project categories</summary>
            {projects.map((p) => (
              <div key={p.id}>
                <strong>{p.name}</strong>
                <Button size="sm" variant="outline" onClick={() => void create({ project: p.id })}>
                  New {p.name} chat
                </Button>
                {list
                  .filter((c) => c.assistant.project === p.id && c.assistant.status === "active")
                  .map((c) => (
                    <button
                      className="assistant-chat-link"
                      key={c.id}
                      onClick={() => void select(c.id)}
                    >
                      {c.title}
                    </button>
                  ))}
              </div>
            ))}
            <Button
              variant="outline"
              onClick={async () => {
                const name = prompt("Project name");
                if (name) {
                  await assistantApi({ op: "project", name });
                  await refresh();
                }
              }}
            >
              Add project
            </Button>
          </details>
          <details>
            <summary>Import existing saved chats</summary>
            <p>Copies into a live conversation; the original remains untouched.</p>
            {legacy.map((c) => (
              <Button
                key={c.id}
                variant="outline"
                onClick={() => void create({ op: "import-legacy", id: c.id, title: c.title })}
              >
                Import {c.title}
              </Button>
            ))}
          </details>
        </aside>
        <main className="assistant-main">
          {view === "memory" ? (
            <MemoryCenter />
          ) : current ? (
            <>
              <header className="assistant-conversation-heading">
                <h2>{current.title}</h2>
                <p className="assistant-muted">
                  {projects.find((p) => p.id === current.assistant.project)?.name ||
                    "Everyday questions, no category required"}{" "}
                  ·{" "}
                  {current.assistant.provider
                    ? current.assistant.provider.kind + " · " + current.assistant.provider.model
                    : "Auto · local Ollama preferred"}
                </p>
                <details>
                  <summary>Conversation controls</summary>
                  <div className="assistant-actions">
                    <Button
                      variant="outline"
                      onClick={() => {
                        const title = prompt("Conversation name", current.title);
                        if (title) void update({ title });
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void update({ pinned: !current.assistant.pinned })}
                    >
                      {current.assistant.pinned ? "Unpin conversation" : "Pin conversation"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void update({
                          status: current.assistant.status === "active" ? "archived" : "active",
                        })
                      }
                    >
                      {current.assistant.status === "active"
                        ? "Archive conversation"
                        : "Restore conversation"}
                    </Button>
                    <Button variant="outline" onClick={() => void continueFresh()}>
                      Continue in fresh chat
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void assistantApi({ op: "checkpoint", id: current.id })
                          .then((d) => {
                            setCurrent(d.conversation);
                            setNote("Checkpoint queued for local processing.");
                          })
                          .catch((e) => setNote((e as Error).message))
                      }
                    >
                      Queue checkpoint
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (confirm("Move this conversation to recoverable deleted chats?"))
                          void update({ status: "deleted" });
                      }}
                    >
                      Delete conversation
                    </Button>
                  </div>
                  <label>
                    Project
                    <select
                      value={current.assistant.project}
                      onChange={(e) => {
                        if (
                          confirm(
                            "Approve moving this conversation? Project memory access will change. Old checkpoints are cleared.",
                          )
                        )
                          void update({ project: e.target.value }, true);
                      }}
                    >
                      <option value="">General</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Memory collection
                    <select
                      value={current.assistant.collect}
                      onChange={(e) => void update({ collect: e.target.value })}
                    >
                      <option value="off">Off — do not extract this chat</option>
                      <option value="review">Review — propose memories first</option>
                      <option value="auto">
                        Auto — same-project / conversation facts; uncertain conflicts still reviewed
                      </option>
                    </select>
                  </label>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      try {
                        const d = await assistantApi(undefined, "?view=memory");
                        setPrivateRecords(
                          d.records.filter(
                            (m: Memory) => m.scope === "private" && m.status === "active",
                          ),
                        );
                        setGrants([...current.assistant.privateIds]);
                      } catch (e) {
                        setNote((e as Error).message);
                      }
                    }}
                  >
                    Manage private memory access
                  </Button>
                  {privateRecords && (
                    <fieldset className="assistant-card">
                      <legend>Private memories allowed in this conversation</legend>
                      {privateRecords.map((m) => (
                        <label className="assistant-check" key={m.id}>
                          <input
                            type="checkbox"
                            checked={grants.includes(m.id)}
                            onChange={(e) =>
                              setGrants(
                                e.target.checked
                                  ? [...grants, m.id]
                                  : grants.filter((id) => id !== m.id),
                              )
                            }
                          />
                          {m.title}
                        </label>
                      ))}
                      <Button
                        onClick={() => {
                          if (
                            confirm(
                              "Approve these private memory permissions for this conversation?",
                            )
                          ) {
                            void update({ privateIds: grants }, true);
                            setPrivateRecords(null);
                          }
                        }}
                      >
                        Save private memory access
                      </Button>
                      <Button variant="ghost" onClick={() => setPrivateRecords(null)}>
                        Cancel private access
                      </Button>
                    </fieldset>
                  )}
                  <div className="assistant-actions">
                    <label>
                      Answer provider
                      <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                        <option value="auto">Auto — prefer local, configured free fallback</option>
                        <option value="ollama-server">Local Ollama only</option>
                        {turnProviders(engine).map((p) => (
                          <option key={p.kind} value={p.kind}>
                            {p.kind} (configured)
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Manual Ollama model
                      <input
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder="Automatic installed model"
                        maxLength={120}
                      />
                    </label>
                  </div>
                  <label className="assistant-check">
                    <input
                      type="checkbox"
                      checked={research}
                      onChange={(e) => setResearch(e.target.checked)}
                    />
                    Use configured web search when this question needs it
                  </label>
                  <label className="assistant-check">
                    <input
                      type="checkbox"
                      checked={maskIdentifiers}
                      onChange={(e) => {
                        setMaskIdentifiers(e.target.checked);
                        if (e.target.checked)
                          setDraft(scrubChatText(draft, { maskIdentifiers: true }));
                      }}
                    />
                    Also mask standalone email addresses in this chat
                  </label>
                  <p className="assistant-muted">
                    Credentials are sent per request to the existing AI gateway and are never saved
                    in this conversation. Browser WebGPU and browser-direct Ollama stay available in
                    Pals. Private/vault memory stays local unless cloud-memory sharing is enabled in
                    Settings.
                  </p>
                </details>
              </header>
              {current.assistant.suggestions?.project && (
                <p className="assistant-notice">
                  Related project:{" "}
                  {projects.find((p) => p.id === current.assistant.suggestions!.project)?.name}.{" "}
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (confirm("Associate this chat with the suggested project and its memory?"))
                        void update({ project: current.assistant.suggestions!.project }, true);
                    }}
                  >
                    Associate project
                  </Button>
                </p>
              )}
              {current.assistant.continuation && (
                <p className="assistant-notice">
                  Continued from {current.assistant.continuation.id}. A compact checkpoint / recent
                  user goals were restored, not the full old transcript.
                </p>
              )}
              <div className="assistant-messages" role="log" aria-label="General conversation">
                {current.messages.length > show && (
                  <Button variant="outline" onClick={() => setShow(show + 100)}>
                    Load earlier messages ({current.messages.length - show})
                  </Button>
                )}
                {!current.messages.length && (
                  <div className="assistant-welcome">
                    <h2>What’s on your mind?</h2>
                    <p>
                      Ask a question, troubleshoot something, or work through a plan. Create project
                      chats whenever you need them.
                    </p>
                  </div>
                )}
                {current.messages.slice(-show).map((m) => (
                  <Message key={m.id} from={m.role}>
                    <MessageContent>
                      {m.role === "assistant" ? (
                        <MessageResponse>{messageString(m)}</MessageResponse>
                      ) : (
                        <p className="assistant-text">{messageString(m)}</p>
                      )}
                    </MessageContent>
                    {m.role === "assistant" && (
                      <div className="assistant-message-meta">
                        {m.metadata?.via} · {m.metadata?.model}
                        {!!m.metadata?.memoryIds?.length && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              try {
                                const d = await assistantApi({
                                  op: "inspect",
                                  id: current.id,
                                  messageId: m.id,
                                });
                                setInspector(d.memories);
                              } catch (e) {
                                setNote((e as Error).message);
                              }
                            }}
                          >
                            Memories used ({m.metadata.memoryIds.length})
                          </Button>
                        )}
                      </div>
                    )}
                  </Message>
                ))}
              </div>
              {inspector && (
                <aside className="assistant-card" aria-label="Response memory inspector">
                  <h3>Memories supplied to this answer</h3>
                  {inspector.length ? (
                    inspector.map((m) => (
                      <p key={m.id}>
                        <strong>{m.title}</strong> · {m.scope}
                        <br />
                        {m.text}
                      </p>
                    ))
                  ) : (
                    <p>These memories were removed or are no longer authorized.</p>
                  )}
                  <Button variant="ghost" onClick={() => setInspector(null)}>
                    Close memory inspector
                  </Button>
                </aside>
              )}
              {current.assistant.status === "active" ? (
                <form
                  className="assistant-compose"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <label htmlFor="ask-anything">Ask Anything</label>
                  <textarea
                    id="ask-anything"
                    rows={3}
                    maxLength={10000}
                    value={draft}
                    onChange={(e) => setDraft(scrubChatText(e.target.value, { maskIdentifiers }))}
                    placeholder="Ask anything…"
                  />
                  <div className="assistant-actions">
                    <Button type="submit" disabled={!draft.trim() || pending.includes(current.id)}>
                      Send question
                    </Button>
                    {pending.includes(current.id) && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => controllers.current.get(current.id)?.abort()}
                      >
                        Stop answer
                      </Button>
                    )}
                    <span className="assistant-muted">
                      {pending.includes(current.id)
                        ? "Answering… You can switch to another chat."
                        : "Draft stays with this conversation. Recognizable credentials are hidden automatically."}
                    </span>
                  </div>
                </form>
              ) : (
                <p className="assistant-notice">
                  Restore this conversation to continue asking questions.
                </p>
              )}
            </>
          ) : (
            <p>
              Connecting to persistent conversations… Check workspace settings if server storage is
              unavailable.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
