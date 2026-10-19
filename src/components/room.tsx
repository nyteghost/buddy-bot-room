import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DefaultChatTransport, readUIMessageStream } from "ai";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  Download,
  ListTodo,
  Pencil,
  Scale,
  MessageSquare,
  Mic,
  LayoutGrid,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Wrench,
  Minus,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Settings2,
  Square,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { PixelCharacter } from "./pixel-character";
import { ThinkingProp } from "./thinking-prop";
import { OfficePal } from "./office-pal";
import { assistantCommand, characterModeCommand, setAssistantMode, setCharacterMode, useAssistantMode, useCharacterMode, type CharacterMode } from "@/lib/hellraiser";
import {
  agents,
  agentName,
  agentPersona,
  resolveMention,
  models,
  messageText,
  type AgentId,
  type Mode,
  type RoomMessage,
} from "@/lib/agents";
import { SavedDiscussions } from "./saved-discussions";
import matrixRoomImage from "@/assets/matrix-room.jpg";
import fantasyRoomImage from "@/assets/final-fantasy-room.jpg";
import roomImage from "@/assets/pixel-room.jpg";
import devRoomImage from "@/assets/devteam-room.jpg";
import officeRoomImage from "@/assets/office-room.jpg";
import cyberRoomImage from "@/assets/cyberpunk-room.jpg";
import hellRoomImage from "@/assets/hellraiser-room.jpg";
import horrorRoomImage from "@/assets/horror-room.jpg";
import dccRoomImage from "@/assets/dcc-room.jpg";
import { providerForTurn, replyTokens, useEngine } from "@/lib/engine";
import { hasWebGPU, localTurn, ollamaTurn } from "@/lib/local-llm";
import { AutoModelDownload, EngineSettingsDialog, WebGpuUsageBox } from "./engine-settings";
import { OllamaMascot } from "./ollama-mascot";
import { LinuxActions } from "./linux-actions";
import { UpdatePopup } from "./update-popup";
import { linuxContext } from "@/lib/linux";
import { isTauri } from "@/lib/local-llm";
const LinuxTerminal = lazy(() => import("./linux-terminal"));
import { AccountButton } from "./account-button";
import { ShowServicesTools } from "./work-tools";
import { WorkspaceWindow } from "./workspace-window";
import { MicRecorder } from "./mic-recorder";
import { deckReply } from "@/lib/deck-solver";
import { priceReply } from "@/lib/work-tools";
import { cn } from "@/lib/utils";
import { parseSlash, slashSuggestions, helpText, type SlashAction } from "@/lib/slash-commands";
import { freshRecall, promptHistory, recallStep, type RecallState } from "@/lib/prompt-recall";
import { replaceEmojiShortcodes } from "@/lib/emoji-shortcodes";
import { celebrate } from "@/lib/confetti";
import { CompareDialog } from "./compare-dialog";
import { SeerrDialog } from "./seerr-dialog";
import { NotesPanel } from "./notes-panel";
import { parseSeerr, type SeerrQuery } from "@/lib/seerr";
import { hitsMarkdown, researchTopic, type SearchHit } from "@/lib/search";
import { addEntry, addTodo, clearDone, getWorkbench, listText, promptContext, removeAt, toggleTodo, updateWorkbench } from "@/lib/workbench";

const storageKey = "pixel-pals-conversation-v1";
const suggestions = [
  "What would a city designed by AI look like?",
  "Is creativity uniquely human?",
  "Pitch the next big indie game",
];

export function Room() {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const characterMode = useCharacterMode();
  const assistantOn = useAssistantMode();
  const assistantRef = useRef(assistantOn);
  assistantRef.current = assistantOn;
  const [cloud, setCloud] = useState(false);
  const browserMessages = useRef<RoomMessage[]>([]);
  function changeStorage(value: boolean) {
    if (value === cloud) return;
    if (value) browserMessages.current = messages;
    else setMessages(browserMessages.current);
    setCloud(value);
  }
  const engine = useEngine();
  const hell = characterMode === "hellraiser";
  const horror = characterMode === "horror";
  useEffect(() => {
    document.documentElement.classList.toggle("hellraiser", hell);
    document.documentElement.classList.toggle("horror", horror);
    document.documentElement.classList.toggle("matrix", characterMode === "matrix");
    document.documentElement.classList.toggle("finalfantasy", characterMode === "finalfantasy");
    document.documentElement.classList.toggle("devteam", characterMode === "devteam");
    document.documentElement.classList.toggle("cyberpunk", characterMode === "cyberpunk");
    document.documentElement.classList.toggle("linux", assistantOn);
    document.documentElement.classList.toggle("dcc", characterMode === "dcc");
  }, [hell, horror, characterMode, assistantOn]);
  const modeRef = useRef(characterMode);
  modeRef.current = characterMode;
  const [ready, setReady] = useState(false);

  const [topic, setTopic] = useState("");
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("roundtable");
  const [rounds, setRounds] = useState(2);
  const [partner, setPartner] = useState<AgentId>("claude");
  const [enabled, setEnabled] = useState<AgentId[]>(agents.map((a) => a.id));
  const direct = mode === "direct";
  const mentionTarget = resolveMention(topic, characterMode);
  const tooFew = !direct && !mentionTarget && enabled.length < 2;
  const topicDraft = topic;
  const directMode = direct;
  const partnerChoice = partner;
  const [desktopApp, setDesktopApp] = useState(false);
  useEffect(() => setDesktopApp(isTauri()), []);
  const startRef = useRef<(ask?: { partner: AgentId; text: string }) => Promise<void>>(async () => {});
  useEffect(() => {
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent<{ partner: AgentId; text: string }>).detail;
      if (detail?.text) void startRef.current(detail);
    };
    window.addEventListener("pixelpals:ask", onAsk);
    return () => window.removeEventListener("pixelpals:ask", onAsk);
  }, []);
  const [selectedModels, setSelectedModels] = useState<Record<AgentId, string>>({
    nova: agents[0].model,
    byte: agents[1].model,
    sage: agents[2].model,
    pip: agents[3].model,
    echo: agents[4].model,
    rune: agents[5].model,
    claude: agents[6].model,
  });
  const [running, setRunning] = useState(false);
  const [speaking, setSpeaking] = useState<AgentId | null>(null);
  const [round, setRound] = useState(0);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [settings, setSettings] = useState(false);
  const [palsOpen, setPalsOpen] = useState(true);
  const [roomOpen, setRoomOpen] = useState(true);
  const [conversationOpen, setConversationOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareQuestion, setCompareQuestion] = useState("");
  const [seerrQuery, setSeerrQuery] = useState<SeerrQuery | null>(null);
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const [historyRequest, setHistoryRequest] = useState(0);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("pixel-pals-workspace-v1") ?? "null");
      if (saved) {
        setRoomOpen(saved.roomOpen !== false);
        setConversationOpen(saved.conversationOpen !== false);
        setSidebarCompact(saved.sidebarCompact === true);
      } else if (localStorage.getItem("pixel-pals-compact-v1") === "1") setRoomOpen(false);
    } catch { /* optional layout preferences */ }
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem("pixel-pals-workspace-v1", JSON.stringify({ roomOpen, conversationOpen, sidebarCompact })); } catch { /* optional storage */ }
  }, [roomOpen, conversationOpen, sidebarCompact, ready]);
  const abortRef = useRef<AbortController | null>(null);
  const replayRef = useRef<AbortController | null>(null);
  const [replayId, setReplayId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const runLock = useRef(false);
  const recall = useRef<RecallState>(freshRecall);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          Array.isArray(parsed) &&
          parsed.every((m) => typeof m.id === "string" && Array.isArray(m.parts))
        )
          setMessages(parsed);
      }
    } catch {
      setSaveError("Your saved conversation could not be opened.");
    }
    setReady(true);
    inputRef.current?.focus();
    return () => {
      abortRef.current?.abort();
      replayRef.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!ready || cloud) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch {
      setSaveError("Browser storage is full. This conversation could not be saved.");
    }
  }, [messages, ready, cloud]);

  const stop = () => {
    abortRef.current?.abort();
    replayRef.current?.abort();
  };

  async function start(ask?: { partner: AgentId; text: string }, override?: string) {
    if (runLock.current) return;
    setConversationOpen(true);
    replayRef.current?.abort();
    setReplayId(null);
    const topic = ask?.text ?? override ?? topicDraft;
    const mentioned = ask || override ? null : resolveMention(topic, modeRef.current);
    const direct = ask || mentioned ? true : directMode;
    const partner = ask?.partner ?? mentioned ?? partnerChoice;
    const tooFew = !direct && enabled.length < 2;
    const seerr = ask || override ? null : parseSeerr(topic);
    if (seerr) {
      setTopic("");
      setSeerrQuery(seerr);
      return;
    }
    const slash = ask || override ? null : parseSlash(topic);
    if (slash) {
      setTopic("");
      recall.current = freshRecall;
      if (slash.ok) runSlash(slash.action, topic.trim());
      else say(topic.trim(), slash.error);
      return;
    }
    const assistantToggle = ask ? null : assistantCommand(topic);
    if (assistantToggle !== null) {
      setAssistantMode(assistantToggle);
      setTopic("");
      return;
    }
    const command = ask ? null : characterModeCommand(topic);
    if (command) {
      setCharacterMode(command);
      setTopic("");
      inputRef.current?.focus();
      return;
    }
    if (!ask && /^@(record|recorder|mic)\b/i.test(topic.trim())) {
      setRecorderOpen(true);
      setMessages([
        ...messages,
        { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: topic.trim() }] },
        { id: crypto.randomUUID(), role: "assistant", metadata: { agentId: "echo", characterMode: modeRef.current }, parts: [{ type: "text", text: "Recorder is open below — press Record, then Stop. Tap Transcribe on a clip and I will write it out (long recordings split into 14-minute parts automatically), labelling each voice Man 1, Woman 1 and so on." }] },
      ]);
      setTopic("");
      return;
    }
    const toolReply = ask ? null : deckReply(topic) ?? priceReply(topic);
    if (toolReply) {
      const toolAgent: AgentId = /^@(deck|stage|staging)\b/i.test(topic.trim()) ? "rune" : "byte";
      setMessages([
        ...messages,
        { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: topic.trim() }] },
        { id: crypto.randomUUID(), role: "assistant", metadata: { agentId: toolAgent, characterMode: modeRef.current }, parts: [{ type: "text", text: toolReply }] },
      ]);
      setTopic("");
      return;
    }
    if (runLock.current || !topic.trim() || tooFew || !ready) return;
    runLock.current = true;
    setRunning(true);
    setError("");
    setRound(0);
    const controller = new AbortController();
    abortRef.current = controller;
    let transcript: RoomMessage[] = [
      ...messages,
      { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: topic.trim() }] },
    ];
    setMessages(transcript);
    setTopic("");
    inputRef.current?.focus();
    try {
      const seated = direct
        ? agents.filter((a) => a.id === partner)
        : agents.filter((a) => enabled.includes(a.id));
      const turns: { agent: (typeof agents)[number]; round: number; verdict: boolean }[] = [];
      for (let r = 1; r <= (direct ? 1 : rounds); r++)
        for (const agent of seated) turns.push({ agent, round: r, verdict: false });
      const lead = seated[0];
      if ((mode === "roundtable" || mode === "solve") && seated.length > 1 && lead)
        turns.push({ agent: lead, round: rounds, verdict: true });
      {
        for (const [turnIndex, { agent, round: currentRound, verdict }] of turns.entries()) {
          setRound(currentRound);
          if (controller.signal.aborted) return;
          setSpeaking(agent.id);
          const began = performance.now();
          // Read the theme live so switching themes mid-discussion applies to the very next speaker.
          const turnMode = modeRef.current;
          const requestBody = {
            agentId: agent.id,
            model: selectedModels[agent.id],
            round: currentRound,
            verdict,
            hellraiser: turnMode === "hellraiser",
            horror: turnMode === "horror",
            characterMode: turnMode,
            mode: direct ? ("direct" as Mode) : mode,
            assistant: assistantRef.current,
            memoryContext: promptContext(getWorkbench()),
            linuxContext: assistantRef.current ? await linuxContext(agent.id) : undefined,
          };
          const fetchPrompt = async () => {
            const res = await fetch("/api/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...requestBody, messages: transcript, preparePrompt: true }),
              signal: controller.signal,
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Prompt failed.");
            return res.json();
          };
          const runLocal = async () =>
            localTurn(await fetchPrompt(), { agentId: agent.id, round: currentRound }, controller.signal);
          const runCloud = (provider: NonNullable<ReturnType<typeof providerForTurn>>) =>
            new DefaultChatTransport<RoomMessage>({ api: "/api/chat", body: { ...requestBody, engine: provider } }).sendMessages({
              chatId: "pixel-pals-room",
              messageId: undefined,
              messages: transcript,
              trigger: "submit-message",
              abortSignal: controller.signal,
            });
          let answer: RoomMessage | undefined;
          const answerId = crypto.randomUUID();
          const consume = async (stream: Awaited<ReturnType<typeof runLocal>>) => {
            for await (const partial of readUIMessageStream<RoomMessage>({ stream, terminateOnError: true })) {
              answer = {
                ...partial,
                id: answerId,
                metadata: {
                  ...partial.metadata,
                  agentId: agent.id,
                  characterMode: turnMode,
                  assistant: assistantRef.current,
                  round: currentRound,
                  ...(verdict ? { verdict: true } : {}),
                  elapsed: (performance.now() - began) / 1000,
                },
              };
              setMessages([...transcript, answer]);
            }
          };
          const provider = providerForTurn(engine, turnIndex);
          const runOllama = async () =>
            consume(
              await ollamaTurn(
                await fetchPrompt(),
                { url: engine.ollamaUrl, model: engine.ollamaModel, maxTokens: replyTokens[engine.replyLength] },
                { agentId: agent.id, round: currentRound },
                controller.signal,
              ),
            );
          if (engine.kind === "auto-ollama") {
            // Free keys first; local Ollama takes over when no key is set or a key fails before any text.
            if (!provider) await runOllama();
            else {
              try {
                await consume(await runCloud(provider));
              } catch (err) {
                if (controller.signal.aborted || (answer && messageText(answer).trim())) throw err;
                answer = undefined;
                await runOllama();
              }
            }
          } else if (engine.kind === "ollama") {
            await consume(
              await ollamaTurn(
                await fetchPrompt(),
                { url: engine.ollamaUrl, model: engine.ollamaModel, maxTokens: replyTokens[engine.replyLength] },
                { agentId: agent.id, round: currentRound },
                controller.signal,
              ),
            );
          } else if (engine.kind === "local" || (engine.kind === "auto" && !provider)) {
            await consume(await runLocal());
          } else if (!provider) {
            throw new Error("Add at least one free key in AI engine settings (Groq, Gemini or OpenRouter), or choose In-browser.");
          } else if (engine.kind === "auto") {
            // Auto: free keys are far faster; the in-browser model takes over when a key hits its limit.
            try {
              await consume(await runCloud(provider));
            } catch (err) {
              if (controller.signal.aborted || !hasWebGPU() || (answer && messageText(answer).trim())) throw err;
              answer = undefined;
              await consume(await runLocal());
            }
          } else {
            await consume(await runCloud(provider));
          }
          if (answer && messageText(answer).trim()) {
            transcript = [...transcript, answer];
            setMessages(transcript);
          } else if (!controller.signal.aborted)
            throw new Error("This agent returned no answer. The discussion has stopped.");
        }
      }
      if (mode === "solve" && !direct && !controller.signal.aborted) celebrate();
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : "The discussion could not continue.");
    } finally {
      setRunning(false);
      setSpeaking(null);
      runLock.current = false;
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }
  startRef.current = start;
  /** Posts a local (no-AI) exchange: the command you typed and Echo's answer. */
  function say(command: string, reply: string) {
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: command }] },
      { id: crypto.randomUUID(), role: "assistant", metadata: { agentId: "echo", characterMode: modeRef.current }, parts: [{ type: "text", text: reply }] },
    ]);
    setConversationOpen(true);
  }
  function runSlash(action: SlashAction, command: string) {
    switch (action.type) {
      case "help": return say(command, helpText());
      case "clear": setMessages([]); setRound(0); setError(""); return;
      case "stop": stop(); return;
      case "export": exportChat(); return say(command, "Chat downloaded as Markdown.");
      case "record": setRecorderOpen(true); return say(command, "Recorder is open — press Record, then Stop.");
      case "confetti": celebrate(); return;
      case "mode": setMode(action.mode); return say(command, `Conversation mode: ${action.mode === "direct" ? "one-on-one" : action.mode}.`);
      case "rounds": setRounds(action.rounds); return say(command, `Pals will debate for ${action.rounds} round${action.rounds === 1 ? "" : "s"}.`);
      case "theme": setCharacterMode(action.theme); return say(command, `Theme switched to ${action.theme}.`);
      case "assistant": setAssistantMode(action.on); return say(command, `Assistant Mode ${action.on ? "on" : "off"}.`);
      case "remember":
        updateWorkbench((w) => ({ ...w, memories: addEntry(w.memories, action.text) }));
        return say(command, `Got it — every pal will remember: “${action.text}”.`);
      case "memories":
        return say(command, listText("The pals remember:", getWorkbench().memories, "Nothing remembered yet. Try `/remember I run Unraid with a 3080`."));
      case "forget": {
        const before = getWorkbench().memories.length;
        updateWorkbench((w) => ({ ...w, memories: action.target === "all" ? [] : removeAt(w.memories, action.target) }));
        const removed = before - getWorkbench().memories.length;
        return say(command, removed ? `Forgotten (${removed}).` : "There's no memory with that number. Use /memories to see them.");
      }
      case "note":
        updateWorkbench((w) => ({ ...w, notes: addEntry(w.notes, action.text) }));
        return say(command, "Note saved.");
      case "todo":
        updateWorkbench((w) => ({ ...w, todos: addTodo(w.todos, action.text) }));
        return say(command, `Added to your to-dos: ${action.text}`);
      case "done": {
        const todos = getWorkbench().todos;
        if (action.n < 1 || action.n > todos.length) return say(command, "There's no to-do with that number.");
        updateWorkbench((w) => ({ ...w, todos: toggleTodo(w.todos, action.n) }));
        return say(command, listText("Your to-dos:", getWorkbench().todos, ""));
      }
      case "clearDone":
        updateWorkbench((w) => ({ ...w, todos: clearDone(w.todos) }));
        return say(command, "Cleared the finished to-dos.");
      case "tasks": setNotesOpen(true); return;
      case "compare": setCompareQuestion(action.question); setCompareOpen(true); return;
      case "search": void webSearch(action.query, command, false); return;
      case "research": void webSearch(action.query, command, true); return;
    }
  }
  /** /search shows the results; /research hands them to the pals as the discussion topic. */
  async function webSearch(query: string, command: string, discuss: boolean) {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return say(command, json.error ?? "The search failed.");
      const hits: SearchHit[] = json.hits ?? [];
      if (discuss && hits.length) return void start(undefined, researchTopic(query, hits));
      return say(command, hitsMarkdown(query, hits));
    } catch {
      return say(command, "I couldn't reach the search service.");
    }
  }
  /** Put a message you sent back in the box and rewind the chat to just before it. */
  function editAndRetry(id: string) {
    const index = messages.findIndex((m) => m.id === id);
    if (index < 0 || running) return;
    setTopic(messageText(messages[index]));
    setMessages(messages.slice(0, index));
    inputRef.current?.focus();
  }
  function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
    if (e.key === "Tab" && suggestions_.length) {
      e.preventDefault();
      setTopic(suggestions_[0]?.insert ?? topic);
      return;
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    const step = recallStep(
      recall.current,
      e.key,
      e.currentTarget.value,
      promptHistory(messages.filter((m) => m.role === "user").map(messageText)),
    );
    if (!step) return;
    e.preventDefault();
    recall.current = step.state;
    setTopic(step.value);
  }
  function exportChat() {
    const text = messages
      .map(
        (m) =>
          `### ${m.metadata?.agentId ? agentName(m.metadata?.agentId, m.metadata?.characterMode === "hellraiser", m.metadata?.characterMode === "horror", m.metadata?.characterMode ?? characterMode) : "You"}\n\n${messageText(m)}`,
      )
      .join("\n\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "pixel-pals-chat.md";
    link.click();
    URL.revokeObjectURL(url);
  }
  const suggestions_ = slashSuggestions(topic);
  const activeAgent = agents.find((a) => a.id === speaking);
  const lastMessage = messages[messages.length - 1];
  const liveText =
    running && lastMessage?.metadata?.agentId === speaking ? messageText(lastMessage).trim() : "";
  const bubbleText = liveText.length > 70 ? `…${liveText.slice(-70)}` : liveText;
  return (
    <div className={cn("app-shell modular-workspace", sidebarCompact && "sidebar-collapsed")}>
      <header className="app-header">
        <a href="/" className="brand">
          <span className="brand-icon">
            <PixelCharacter id="nova" />
          </span>
          <span>
            pixel<span className="text-primary">pals</span>
            <span className="brand-chat"> / chat</span>
          </span>
        </a>
        <div className="header-right">
          <span className="lab-badge">
            <span className="status-dot" /> THE MULTI-MODEL PLAYGROUND
          </span>
          <EngineSettingsDialog />
          <Button
            variant="ghost"
            size="sm"
            className="engine-trigger"
            aria-pressed={recorderOpen}
            onClick={() => setRecorderOpen((open) => !open)}
          >
            <Mic className="size-4" /> Record
          </Button>
          <Button variant="ghost" size="sm" className="engine-trigger" aria-pressed={toolsOpen} onClick={() => setToolsOpen((value) => !value)}><Wrench className="size-4" /> Work tools</Button>
          <AccountButton theme={characterMode} onTheme={setCharacterMode} />
          <Select
            value={characterMode}
            disabled={running}
            onValueChange={(value) => setCharacterMode(value as CharacterMode)}
          >
            <SelectTrigger aria-label="Theme" className="theme-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal Mode</SelectItem>
              <SelectItem value="hellraiser">Hellraiser Mode</SelectItem>
              <SelectItem value="horror">Horror Mode</SelectItem>
              <SelectItem value="matrix">Matrix Theme</SelectItem>
              <SelectItem value="finalfantasy">Final Fantasy Theme</SelectItem>
              <SelectItem value="devteam">Dev Team Theme</SelectItem>
              <SelectItem value="cyberpunk">Cyberpunk Theme</SelectItem>
              <SelectItem value="dcc">Dungeon Crawler Carl</SelectItem>
              <SelectItem value="linux">Linux Theme</SelectItem>
            </SelectContent>
          </Select>
          <label className="assistant-toggle" title="Pals act as your assistants for mail, tasks, calendar, notes, Q&A and system">
            <Switch checked={assistantOn} disabled={running} onCheckedChange={setAssistantMode} aria-label="Assistant Mode" />
            <span>Assistant</span>
          </label>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="About this room">
                <CircleHelp />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>A little room for big ideas</DialogTitle>
                <DialogDescription>
                  Roundtable lets the pals respond to each other. Broadcast gives independent
                  answers. Choose at least two pals, set your topic, and start. Your conversation is
                  saved only in this browser. Choose Saved discussions to keep and reopen multiple conversations. AI replies use your free keys or the in-browser model — no credits.
                </DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
        </div>
      </header>
      <CompareDialog open={compareOpen} onOpenChange={setCompareOpen} initialQuestion={compareQuestion} />
      <SeerrDialog query={seerrQuery} onClose={() => setSeerrQuery(null)} onRequested={(summary) => say(`@seerr ${seerrQuery?.title ?? ""}${seerrQuery?.is4k ? " 4k" : ""}`.trim(), summary)} />
      <div className="workspace-frame">
        <nav className="workspace-sidebar" aria-label="Workspace">
          <div className="sidebar-heading"><span>WORKSPACE</span><Button variant="ghost" size="icon" aria-label={sidebarCompact ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCompact ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setSidebarCompact((value) => !value)}>{sidebarCompact ? <PanelLeftOpen /> : <PanelLeftClose />}</Button></div>
          <Button variant="ghost" className="sidebar-item" title="Conversation" aria-pressed={conversationOpen} onClick={() => setConversationOpen((value) => !value)}><MessageSquare /><span>Conversation</span><i className={conversationOpen ? "status-dot" : ""} /></Button>
          <Button variant="ghost" className="sidebar-item" title="Pixel room" aria-pressed={roomOpen} onClick={() => setRoomOpen((value) => !value)}><Users /><span>Pixel room</span><i className={roomOpen ? "status-dot" : ""} /></Button>
          <Button variant="ghost" className="sidebar-item" title="Work tools" aria-pressed={toolsOpen} onClick={() => setToolsOpen((value) => !value)}><Wrench /><span>Work tools</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Recorder" aria-pressed={recorderOpen} onClick={() => setRecorderOpen((value) => !value)}><Mic /><span>Recorder</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Notes, memories and to-dos" aria-pressed={notesOpen} onClick={() => setNotesOpen((value) => !value)}><ListTodo /><span>Notes &amp; tasks</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Blind model comparison" onClick={() => { setCompareQuestion(""); setCompareOpen(true); }}><Scale /><span>Compare models</span></Button>
          <div className="sidebar-divider" />
          <Button variant="ghost" className="sidebar-item" title="Saved chats" disabled={running} onClick={() => { setConversationOpen(true); setHistoryRequest((value) => value + 1); }}><History /><span>Saved chats</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Reset layout" onClick={() => { setResetVersion((value) => value + 1); setRoomOpen(true); setConversationOpen(true); setToolsOpen(false); setNotesOpen(false); }}><LayoutGrid /><span>Reset layout</span></Button>
          <div className="sidebar-bottom">          {(engine.kind === "local" || engine.kind === "auto") && <><AutoModelDownload /><WebGpuUsageBox active /></>}
          <OllamaMascot active={running && (engine.kind === "ollama" || engine.kind === "auto-ollama")} />
          <UpdatePopup />
          <p className="build-version" title={`Commit ${__APP_COMMIT__} · built ${__APP_BUILD_DATE__}`}>
            {desktopApp ? "Desktop" : "Web"} v{__APP_VERSION__} · {__APP_COMMIT__}
          </p>
          {assistantOn && (desktopApp ? (
            <Suspense fallback={<div className="linux-terminal">Opening terminal…</div>}><LinuxTerminal /></Suspense>
          ) : (
            <p className="linux-note">Tux's terminal, notes, files and system stats work in the Pixel Pals desktop app. Here, pals can still help and give you commands to copy.</p>
          ))}
</div>
        </nav>
        <div className="workspace-stage">
          <main className="window-canvas" aria-label="Floating workspace">
            <WorkspaceWindow id="room" title="Pixel room" icon={<Users className="size-4" />} open={roomOpen} onClose={() => setRoomOpen(false)} resetVersion={resetVersion}>
              <div className="room-column">          <div className="room-scene">
            <img
              src={assistantOn ? officeRoomImage : characterMode === "dcc" ? dccRoomImage : characterMode === "cyberpunk" ? cyberRoomImage : characterMode === "linux" ? officeRoomImage : characterMode === "devteam" ? devRoomImage : characterMode === "matrix" ? matrixRoomImage : characterMode === "finalfantasy" ? fantasyRoomImage : characterMode === "horror" ? horrorRoomImage : hell ? hellRoomImage : roomImage}
              className={cn("pixel-room-image", hell && "hell-room-image")}
              width={1536}
              height={864}
              alt={
                characterMode === "dcc" && !assistantOn ? "Dungeon safe room with loot chests, a round table and a glowing stairwell" : characterMode === "horror" ? "Creepy candle-lit mansion parlor with a Ouija board, armchairs and a static-filled TV" : characterMode === "cyberpunk" ? "Neon-lit cyberpunk hacker den with holographic terminals" : characterMode === "devteam" || characterMode === "linux" || characterMode === "assistant" ? "Pixel-art software office with seven computer desks" : characterMode === "matrix" ? "Matrix hacker room with green code terminals and a discussion table" : characterMode === "finalfantasy" ? "Final Fantasy airship room with a glowing crystal and round table" : hell
                  ? "Pixel-art Cenobite chamber with chains, candles and a glowing puzzle box"
                  : "Pixel-art common room with a discussion table, computer stations, and plants"
              }
            />
            {hell && <div className="hell-glow" aria-hidden />}
            {assistantOn && (
              <img src={officeRoomImage} className="pixel-room-image office-foreground" width={1536} height={864} alt="" aria-hidden />
            )}
            <div className="scene-top">
              <span>
                <span className={cn("status-dot", running && "pulse-dot")} />
                {running ? "CONVERSATION IN PROGRESS" : "WAITING FOR A GOOD IDEA"}
              </span>
              <span className="flex items-center gap-2">
                {enabled.length} PALS IN ROOM
              </span>
            </div>
            {agents.map((a, i) => assistantOn ? (
              <OfficePal key={a.id} id={a.id} index={i} mode={characterMode} active={running && speaking === a.id} enabled={enabled.includes(a.id)} />
            ) : (
              <div
                key={a.id}
                className={cn(
                  "scene-pal",
                  `scene-pal-${i}`,
                  !enabled.includes(a.id) && "pal-away",
                  speaking === a.id && "is-speaking",
                  running && speaking && speaking !== a.id && enabled.includes(a.id) && "is-listening",
                )}
              >
                {speaking === a.id && (
                  <div className={`speech-bubble agent-${a.id}`} aria-hidden="true">
                    {bubbleText || "···"}
                  </div>
                )}
                {speaking === a.id && !bubbleText && <ThinkingProp id={a.id} mode={characterMode} />}
                <PixelCharacter id={a.id} animated={speaking === a.id} />
                <span className={`agent-${a.id}`}>
                  {agentName(a.id, hell, horror, characterMode)}
                  {speaking === a.id && " ···"}
                </span>
              </div>
            ))}
            <div className="scene-bottom">
              <span>
                <Users size={13} /> {mode === "roundtable" ? "Roundtable" : direct ? "One-on-one" : mode === "solve" ? "Problem solving" : "Broadcast"}
              </span>
              <span>
                {running ? (direct ? "Chatting" : `Round ${round} of ${rounds}`) : "Ready when you are"}
                <span className="scene-cursor">_</span>
              </span>
            </div>
          </div>
          <div className="section-heading">
            <button
              type="button"
              className="pals-toggle"
              aria-expanded={palsOpen}
              title={palsOpen ? "Hide pals" : "Show pals"}
              onClick={() => setPalsOpen((v) => !v)}
            >
              <h2>
                The pals <span>{enabled.length}/{agents.length}</span>
              </h2>
              <ChevronDown
                size={16}
                className={cn("pals-chevron", !palsOpen && "pals-chevron-closed")}
              />
            </button>
            <Button variant="ghost" size="sm" onClick={() => setSettings(!settings)}>
              <Settings2 size={14} />
              {settings ? "Hide settings" : "Model settings"}
            </Button>
          </div>
          {palsOpen && (
            <div className="agent-grid">
              {agents.map((a) => (
                <div
                  key={a.id}
                  className={cn(
                    "agent-card",
                    `agent-${a.id}`,
                    !enabled.includes(a.id) && "agent-disabled",
                  )}
                >
                  <div className="agent-card-top">
                    <span className="avatar-tile">
                      <PixelCharacter id={a.id} />
                    </span>
                    <Switch
                      aria-label={`Enable ${agentName(a.id, hell, horror, characterMode)}`}
                      checked={enabled.includes(a.id)}
                      disabled={running}
                      onCheckedChange={(checked) =>
                        setEnabled((prev) =>
                          checked ? [...prev, a.id] : prev.filter((id) => id !== a.id),
                        )
                      }
                    />
                  </div>
                  <h3>
                    {agentName(a.id, hell, horror, characterMode)}
                    <span className="agent-dot" />
                  </h3>
                  <p>{agentPersona(a.id, hell, horror, characterMode).role}</p>
                  <span className="model-label">
                    {models.find((m) => m.id === selectedModels[a.id])?.label}
                  </span>
                  {settings && (
                    <Select
                      value={selectedModels[a.id]}
                      disabled={running}
                      onValueChange={(value) =>
                        setSelectedModels((prev) => ({ ...prev, [a.id]: value }))
                      }
                    >
                      <SelectTrigger
                        aria-label={`${agentName(a.id, hell, horror, characterMode)} model`}
                        className="mt-3"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {models.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ))}
            </div>
          )}
</div>
            </WorkspaceWindow>
            <WorkspaceWindow id="conversation" title="Conversation" icon={<MessageSquare className="size-4" />} open={conversationOpen} onClose={() => setConversationOpen(false)} resetVersion={resetVersion}>
        <section className="conversation-panel">
          <div className="conversation-header">
            <h2>
              <MessageSquare size={18} />
              The conversation
              <span className="message-count">
                {messages.filter((m) => m.role === "assistant").length}
              </span>
            </h2>
            <div>
              <Button
                variant="ghost"
                size="icon"
                title="Download conversation"
                aria-label="Download conversation"
                onClick={exportChat}
                disabled={!messages.length}
              >
                <Download />
              </Button>
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Clear conversation"
                    aria-label="Clear conversation"
                    disabled={running || !messages.length}
                  >
                    <RotateCcw />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Clear this conversation?</DialogTitle>
                    <DialogDescription>
                      This clears the current chat. Previously saved discussions stay until you delete them. Download a copy first if you want to
                      keep it.
                    </DialogDescription>
                  </DialogHeader>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setMessages([]);
                      setRound(0);
                      setError("");
                    }}
                  >
                    Clear conversation
                  </Button>
                </DialogContent>
              </Dialog>
            </div>
          </div>
          <SavedDiscussions openRequest={historyRequest} messages={messages} mode={mode} theme={characterMode} running={running} onOpen={(items, theme, discussionMode) => { setMessages(items); setCharacterMode(theme); setMode(discussionMode); setRound(0); setError(""); }} />
          <div className="conversation-subhead">
            <span className="status-dot" />
            {running
              ? `${activeAgent ? agentName(activeAgent.id, hell, horror, characterMode) : horror ? "The icons" : hell ? "The Order" : "Your pals"} is thinking…`
              : messages.length
                ? "The floor is yours"
                : "The room is open"}
            <span>{mode === "roundtable" ? "ROUND TABLE" : direct ? "ONE-ON-ONE" : mode === "solve" ? "PROBLEM SOLVING" : "BROADCAST"}</span>
          </div>
          <Conversation className="chat-log">
            <ConversationContent
              className={cn("chat-content", !messages.length && "empty-content")}
            >
              {!messages.length ? (
                <div className="chat-empty">
                  <div className="empty-pals">
                    <PixelCharacter id="byte" />
                    <PixelCharacter id="nova" />
                    <PixelCharacter id="sage" />
                  </div>
                  <div className="pixel-speech">···</div>
                  <h3>
                    Good conversations
                    <br />
                    start with a little curiosity.
                  </h3>
                  <p>
                    Your pals are all here.
                    <br />
                    What should they talk about?
                  </p>
                  <span className="empty-divider" />
                  <span className="empty-caption">FOUR PERSONALITIES. ENDLESS POSSIBILITIES.</span>
                </div>
              ) : (
                messages.map((m) => {
                  const a = agents.find((a) => a.id === m.metadata?.agentId);
                  const messageMode = m.metadata?.characterMode ?? characterMode;
                  const name = a
                    ? agentName(a.id, messageMode === "hellraiser", messageMode === "horror", messageMode)
                    : "You";
                  return (
                    <Message
                      key={m.id}
                      from={m.role}
                      className={cn("room-message", m.metadata?.verdict && "verdict-message")}
                    >
                      {a && (
                        <div className={`message-avatar agent-${a.id}`}>
                          <PixelCharacter id={a.id} mode={messageMode} />
                        </div>
                      )}
                      <div className="message-main">
                        <div className="message-heading">
                          <b className={a ? `agent-${a.id}` : "text-primary"}>{name}</b>
                          <span>
                            {!a
                              ? "THE TOPIC"
                              : m.metadata?.verdict
                                ? "THE VERDICT"
                                : `ROUND ${m.metadata?.round ?? 1}`}
                          </span>
                          {m.metadata?.elapsed && (
                            <span className="ml-auto">{m.metadata.elapsed.toFixed(1)}s</span>
                          )}
                        </div>
                        <MessageContent className={cn(m.role === "user" && "user-message-content")}>
                          {m.parts.map((part, i) =>
                            part.type === "text" ? (
                              <div key={i}>
                                <MessageResponse>{m.role === "assistant" ? replaceEmojiShortcodes(part.text) : part.text}</MessageResponse>
                                {m.role === "assistant" && (m.metadata?.assistant ?? (m.metadata?.characterMode === "linux" || m.metadata?.characterMode === "assistant")) && !running && <LinuxActions text={part.text} canRun={desktopApp} />}
                              </div>
                            ) : part.type === "reasoning" ? (
                              <details className="reasoning" key={i}>
                                <summary>Thinking</summary>
                                <MessageResponse>{part.text}</MessageResponse>
                              </details>
                            ) : null,
                          )}
                        </MessageContent>
                        {!running && (
                          <div className="message-actions">
                            {m.role === "assistant" ? (
                              <MessageAction tooltip="Copy reply" label="Copy reply" onClick={() => void navigator.clipboard?.writeText(messageText(m))}>
                                <Copy size={13} />
                              </MessageAction>
                            ) : (
                              <MessageAction tooltip="Edit and resend" label="Edit and resend" onClick={() => editAndRetry(m.id)}>
                                <Pencil size={13} />
                              </MessageAction>
                            )}
                          </div>
                        )}
                      </div>
                    </Message>
                  );
                })
              )}
              {running && (
                <div className="thinking-row">
                  {speaking && <PixelCharacter id={speaking} animated />}
                  <Shimmer>{`${activeAgent ? agentName(activeAgent.id, hell, horror, characterMode) : horror ? "The icons" : hell ? "The Order" : "Your pals"} is thinking…`}</Shimmer>
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
          {(error || saveError) && (
            <div className="chat-error" role="alert">
              {error || saveError}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Dismiss error"
                onClick={() => {
                  setError("");
                  setSaveError("");
                }}
              >
                <X />
              </Button>
            </div>
          )}
          <footer className="conversation-footer">
            <span>
              <span className="status-dot" />
              {running
                ? `ROUND ${round} / ${rounds}`
                : round
                  ? `${round} ROUND${round > 1 ? "S" : ""} COMPLETE`
                  : "READY TO START"}
            </span>
            <span>
              <Check size={12} /> AUTO-SAVED
            </span>
          </footer>
        </section>
            </WorkspaceWindow>
            <WorkspaceWindow id="tools" title="Show Services tools" icon={<Wrench className="size-4" />} open={toolsOpen} onClose={() => setToolsOpen(false)} resetVersion={resetVersion}>
              <ShowServicesTools />
            </WorkspaceWindow>
            <WorkspaceWindow id="recorder" title="Echo’s recorder" icon={<Mic className="size-4" />} open={recorderOpen} onClose={() => setRecorderOpen(false)} resetVersion={resetVersion}>
              <MicRecorder onClose={() => setRecorderOpen(false)} />
            </WorkspaceWindow>
            <WorkspaceWindow id="notes" title="Notes & tasks" icon={<ListTodo className="size-4" />} open={notesOpen} onClose={() => setNotesOpen(false)} resetVersion={resetVersion}>
              <NotesPanel />
            </WorkspaceWindow>
            {!roomOpen && !conversationOpen && !toolsOpen && !recorderOpen && !notesOpen && <div className="workspace-rest"><PixelCharacter id="nova" /><h1>Pixel Pals</h1></div>}
          </main>
          <section className="workspace-composer" aria-label="Message composer">
          <div className="mode-row">
            <span className="control-label">CONVERSATION MODE</span>
            <div className="mode-switch">
              <Button
                variant="ghost"
                disabled={running}
                aria-pressed={mode === "roundtable"}
                className={cn(mode === "roundtable" && "mode-active")}
                onClick={() => setMode("roundtable")}
              >
                <Users />
                Roundtable
              </Button>
              <Button
                variant="ghost"
                disabled={running}
                aria-pressed={mode === "broadcast"}
                className={cn(mode === "broadcast" && "mode-active")}
                onClick={() => setMode("broadcast")}
              >
                <Radio />
                Broadcast
              </Button>
              <Button
                variant="ghost"
                disabled={running}
                aria-pressed={direct}
                className={cn(direct && "mode-active")}
                onClick={() => setMode("direct")}
              >
                <MessageSquare />
                One-on-one
              </Button>
              <Button
                variant="ghost"
                disabled={running}
                aria-pressed={mode === "solve"}
                className={cn(mode === "solve" && "mode-active")}
                onClick={() => setMode("solve")}
              >
                <Wrench />
                Problem solving
              </Button>
            </div>
          </div>
          <div className="topic-section">
            <div className="section-heading">
              <h2>What's on your mind?</h2>

              <span className="muted-label">YOU SET THE TOPIC</span>
            </div>
            {suggestions_.length > 0 && (
              <ul className="slash-menu" role="listbox" aria-label="Slash commands">
                {suggestions_.slice(0, 6).map((item, i) => (
                  <li key={item.insert} role="option" aria-selected={i === 0}>
                    <button type="button" onClick={() => { setTopic(item.insert); inputRef.current?.focus(); }}>
                      <code>{item.label}</code>
                      {item.description && <span>{item.description}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <PromptInput onSubmit={() => start()} className="topic-composer">
              <PromptInputTextarea
                ref={inputRef}
                aria-label="Discussion topic"
                placeholder="Give your pals something to talk about…"
                value={topic}
                onChange={(e) => {
                  recall.current = freshRecall;
                  setTopic(e.target.value);
                }}
                onKeyDown={onComposerKeyDown}
                className="min-h-12"
                disabled={running}
              />
              <PromptInputFooter>
                <span className="composer-label">
                  <MessageSquare size={13} /> A question, an idea, a rabbit hole.
                </span>
                <PromptInputSubmit
                  aria-label={running ? "Stop discussion" : "Start topic"}
                  status={running ? "streaming" : "ready"}
                  onStop={stop}
                  disabled={
                    !running &&
                    (!topic.trim() ||
                      (!characterModeCommand(topic) && !topic.trim().startsWith("/") && tooFew) ||
                      !ready)
                  }
                />
              </PromptInputFooter>
            </PromptInput>
            <div className="suggestions">
              {suggestions.map((s) => (
                <Button
                  key={s}
                  variant="ghost"
                  size="sm"
                  disabled={running}
                  onClick={() => {
                    setTopic(s);
                    inputRef.current?.focus();
                  }}
                >
                  {s}
                  <ArrowUpRight size={12} />
                </Button>
              ))}
            </div>
          </div>
          <div className="launch-controls">
            {direct && (

              <div>
                <span className="control-label">TALK WITH</span>
                <select
                  className="partner-select"
                  aria-label="Pal to talk with"
                  value={partner}
                  disabled={running}
                  onChange={(e) => setPartner(e.target.value as AgentId)}
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {agentName(a.id, hell, horror, characterMode)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {!direct && (
            <div>
              <span className="control-label">ROUNDS</span>
              <div className="round-stepper">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Fewer rounds"
                  disabled={running || rounds <= 1}
                  onClick={() => setRounds(rounds - 1)}
                >
                  <Minus />
                </Button>
                <span>{rounds}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="More rounds"
                  disabled={running || rounds >= 5}
                  onClick={() => setRounds(rounds + 1)}
                >
                  <Plus />
                </Button>
              </div>
            </div>
            )}
            <Button
              className="start-button"
              onClick={running ? stop : () => void start()}
              disabled={
                !running &&
                (!topic.trim() || (!characterModeCommand(topic) && tooFew) || !ready)
              }
            >
              {running ? <Square /> : <Play fill="currentColor" />}
              {running ? "Stop" : direct ? "Send" : "Start discussion"}
            </Button>
          </div>
          {tooFew && (
            <p className="validation-note">Invite at least two pals to start a discussion.</p>
          )}
          </section>
        </div>
      </div>
      <footer className="app-footer">
        <span>SMALL PIXELS. BIG PERSPECTIVES.</span>
        <span>
          Made for a meeting of minds <span className="text-primary">✳</span>
        </span>
      </footer>
    </div>
  );
}
