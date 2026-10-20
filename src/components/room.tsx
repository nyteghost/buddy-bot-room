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
  Search,
  Settings2,
  Square,
  Users,
  X,
  Bug,
  GitBranch,
  RefreshCw,
  Volume2,
  VolumeX,
  Ellipsis,
  Maximize2,
  Minimize2,
  Mail,
  CalendarDays,
  CheckSquare,
  Sun,
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
import { chainAfter, freeModels, providerForTurn, replyTokens, useEngine } from "@/lib/engine";
import { estimateTokens } from "@/lib/usage";
import { isOverCap, recordUsage } from "@/lib/usage-store";
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
import { parseSlash, slashSuggestions, helpText, modeNames, themeNames, type SlashAction } from "@/lib/slash-commands";
import { freshRecall, promptHistory, recallStep, type RecallState } from "@/lib/prompt-recall";
import { replaceEmojiShortcodes } from "@/lib/emoji-shortcodes";
import { celebrate } from "@/lib/confetti";
import { CompareDialog } from "./compare-dialog";
import { SeerrDialog } from "./seerr-dialog";
import { NotesPanel } from "./notes-panel";
import { DebugLogDialog } from "./debug-log-dialog";
import { installGlobalLogging, logClient } from "@/lib/debug-log";
import { warmOllama } from "@/lib/ollama-models";
import { CommandPalette, type PaletteAction } from "./command-palette";
import { matchShortcut, shortcutList } from "@/lib/shortcuts";
import { friendlyError } from "@/lib/friendly-error";
import { allChunks, getDocs } from "@/lib/documents";
import { docContext } from "@/lib/rag";
import { appearanceFromWords } from "@/lib/appearance";
import { getAppearance, setAppearance, useAppearance } from "@/lib/appearance-store";
import { weatherText, type Weather } from "@/lib/weather";
import { eventLinks, icsQuery, parseEventArgs } from "@/lib/events";
import { whenLabel } from "@/lib/when";
import { CalendarPanel, MailPanel } from "@/components/inbox-panels";
import { TasksPanel, TodayPanel } from "@/components/day-panels";
import { SetupPanel } from "@/components/setup-panel";
import { mergeCaptures, type Capture } from "@/lib/capture";
import { SearchPanel } from "@/components/search-panel";
import { setHideSecrets, getHideSecrets, useHideSecrets } from "@/lib/privacy-store";
import { MicButton } from "@/components/mic-button";
import { smartRetrieve } from "@/lib/smart-docs";
import { wantsWeb, webContext } from "@/lib/web-context";
import { autoSearch } from "@/lib/prefs";
import { getNotes } from "@/lib/agent-notes";
import { applyBackup, buildBackup } from "@/lib/settings-io";
import { libraryMarkdown, type LibraryItem } from "@/lib/jellyfin";
import { addFact, addRoll, campaignContext, endCampaign, getCampaign, removeFact, setCharacter, startCampaign, statusText, updateCampaign, type DmRole } from "@/lib/campaign";
import { parseDice, rollDice, secureRng } from "@/lib/dice";
import { diagnoseTopic, NOT_SET_UP, statusMarkdown, type UnraidReply } from "@/lib/unraid";
import { UnraidBanner } from "./unraid-banner";
import { nextTopic, traktListsMarkdown, traktMarkdown, type TraktItem, type TraktList } from "@/lib/trakt";
import { sharedText } from "@/lib/share-prefill";
import { setVoiceSettings, speakItems, stopSpeaking, useSpeakingId, useVoice, voiceSupported } from "@/lib/voice";
import { plexMarkdown, watchTopic, type PlexItem } from "@/lib/plex";
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
  useEffect(() => { installGlobalLogging(); }, []);
  // Preload the Ollama model as soon as it's the chosen engine, so the first reply isn't slow.
  useEffect(() => {
    if (engine.kind !== "ollama" && engine.kind !== "auto-ollama") return;
    void warmOllama(engine.ollamaUrl, engine.ollamaModel).then((ok) => { if (ok) logClient("info", `Ollama model ${engine.ollamaModel} preloaded`); });
  }, [engine.kind, engine.ollamaUrl, engine.ollamaModel]);
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
  const [menuOpen, setMenuOpen] = useState(false);
  // Focus mode: a calm, chat-only view. Saved per device (a phone and a desktop can differ).
  const [focusMode, setFocusMode] = useState(false);
  const [focusOptions, setFocusOptions] = useState(false);
  useEffect(() => { try { setFocusMode(localStorage.getItem("pixel-pals-focus-v1") === "1"); } catch { /* optional storage */ } }, []);
  useEffect(() => { try { localStorage.setItem("pixel-pals-focus-v1", focusMode ? "1" : "0"); } catch { /* optional storage */ } if (!focusMode) setFocusOptions(false); }, [focusMode]);
  // Phones: swipe right from the left edge opens saved chats.
  useEffect(() => {
    let sx = 0, sy = 0, edge = false;
    const down = (e: TouchEvent) => { const t = e.touches[0]; if (!t) return; sx = t.clientX; sy = t.clientY; edge = t.clientX < 28; };
    const up = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!edge || !t || window.innerWidth > 760) return;
      if (t.clientX - sx > 80 && Math.abs(t.clientY - sy) < 50) { setConversationOpen(true); setHistoryRequest((v) => v + 1); }
      edge = false;
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    return () => { window.removeEventListener("touchstart", down); window.removeEventListener("touchend", up); };
  }, []);
  const [mode, setMode] = useState<Mode>("roundtable");
  const [rounds, setRounds] = useState(2);
  const [partner, setPartner] = useState<AgentId>("claude");
  const [enabled, setEnabled] = useState<AgentId[]>(agents.filter((a) => a.id !== "saiyan").map((a) => a.id)); // Saiyan joins when you switch him on
  const direct = mode === "direct";
  const mentionTarget = resolveMention(topic, characterMode);
  const tooFew = !direct && !mentionTarget && enabled.length < 2;
  const topicDraft = topic;
  // Shared into Pixel Pals from the iPhone share sheet (a Shortcut opening /?q=...): put it in the box, don't send it.
  useEffect(() => {
    const text = sharedText(window.location.search);
    if (!text) return;
    setTopic((t) => t || text);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  const directMode = direct;
  const partnerChoice = partner;
  const [desktopApp, setDesktopApp] = useState(false);
  useEffect(() => setDesktopApp(isTauri()), []);
  const startRef = useRef<(ask?: { partner: AgentId; text: string }, override?: string) => Promise<void>>(async () => {});
  useEffect(() => {
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent<{ partner: AgentId; text: string }>).detail;
      if (detail?.text) void startRef.current(detail);
    };
    const onRequest = (e: Event) => {
      const title = (e as CustomEvent<{ title?: string }>).detail?.title;
      if (title) setSeerrQuery({ title, is4k: false });
    };
    window.addEventListener("pixelpals:request", onRequest);
    window.addEventListener("pixelpals:ask", onAsk);
    return () => { window.removeEventListener("pixelpals:ask", onAsk); window.removeEventListener("pixelpals:request", onRequest); };
  }, []);
  const [selectedModels, setSelectedModels] = useState<Record<AgentId, string>>({
    nova: agents[0].model,
    byte: agents[1].model,
    sage: agents[2].model,
    pip: agents[3].model,
    echo: agents[4].model,
    rune: agents[5].model,
    claude: agents[6].model,
    saiyan: agents[7].model,
  });
  const [running, setRunning] = useState(false);
  // Read replies aloud (opt-in, browser speech): after each discussion finishes, each new reply in its pal's voice.
  const voice = useVoice();
  useAppearance();
  useHideSecrets();
  useEffect(() => {
    // Things you sent from your phone (Telegram, share sheet) are waiting on the server; fold them into notes and tasks.
    const collect = async () => {
      try {
        const res = await fetch("/api/capture", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "take" }) });
        if (!res.ok) return;
        const { items } = (await res.json()) as { items?: Capture[] };
        if (items?.length) updateWorkbench((w) => mergeCaptures(w, items));
      } catch { /* offline or not the owner */ }
    };
    void collect();
    const t = window.setInterval(() => void collect(), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const speakingMessage = useSpeakingId();
  const [canSpeak, setCanSpeak] = useState(false);
  useEffect(() => { setCanSpeak(voiceSupported()); }, []);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const runStart = useRef(0);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running && !wasRunning.current) { runStart.current = messagesRef.current.length; stopSpeaking(); }
    if (!running && wasRunning.current && voice.auto) {
      const items = messagesRef.current.slice(runStart.current)
        .filter((m) => m.role === "assistant" && messageText(m).trim())
        .map((m) => ({ id: m.id, text: messageText(m), agentId: String(m.metadata?.agentId ?? "echo") }));
      if (items.length) void speakItems(items);
    }
    wasRunning.current = running;
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps
  const [speaking, setSpeaking] = useState<AgentId | null>(null);
  const [round, setRound] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => { if (error) logClient("error", `Shown to user: ${error}`); }, [error]);
  const [saveError, setSaveError] = useState("");
  const [settings, setSettings] = useState(false);
  const [palsOpen, setPalsOpen] = useState(true);
  const [roomOpen, setRoomOpen] = useState(true);
  const [conversationOpen, setConversationOpen] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [todayOpen, setTodayOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [forkSignal, setForkSignal] = useState(0);
  const [regen, setRegen] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
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
    stopSpeaking();
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
    // Chat with your files: pull the passages that best match this question (no AI call needed).
    const notesNow = getNotes();
    const docsNow = getDocs();
    let docText = docsNow.length ? docContext(await smartRetrieve(allChunks(docsNow), topic)) : "";
    // Optional: let the pals look things up themselves when the question needs current facts (/web on).
    if (autoSearch.get() && wantsWeb(topic)) {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(topic.trim().slice(0, 200))}`, { signal: AbortSignal.timeout(8000) });
        const json = (await res.json()) as { hits?: SearchHit[] };
        if (res.ok && json.hits?.length) docText = `${docText}\n\n${webContext(topic.trim(), json.hits.slice(0, 5))}`.trim();
      } catch { /* search is optional; carry on without it */ }
    }
    try {
      const seated = direct
        ? agents.filter((a) => a.id === partner)
        : agents.filter((a) => enabled.includes(a.id));
      const turns: { agent: (typeof agents)[number]; round: number; verdict: boolean; dmRole?: DmRole }[] = [];
      // Dungeon Master mode: the first seated pal narrates, the rest react as the party, one pass per action.
      const campaign = getCampaign();
      if (campaign.active) seated.forEach((agent, i) => turns.push({ agent, round: 1, verdict: false, dmRole: i === 0 ? "dm" : "party" }));
      else {
        for (let r = 1; r <= (direct ? 1 : rounds); r++)
          for (const agent of seated) turns.push({ agent, round: r, verdict: false });
        const lead = seated[0];
        if ((mode === "roundtable" || mode === "solve") && seated.length > 1 && lead)
          turns.push({ agent: lead, round: rounds, verdict: true });
      }
      {
        for (const [turnIndex, { agent, round: currentRound, verdict, dmRole }] of turns.entries()) {
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
            // In a campaign every pal needs to see the whole table, even in one-on-one.
            mode: dmRole ? ("roundtable" as Mode) : direct ? ("direct" as Mode) : mode,
            campaign: dmRole ? { role: dmRole, context: campaignContext(getCampaign()) } : undefined,
            assistant: assistantRef.current,
            memoryContext: promptContext(getWorkbench()),
            contextChars: engine.kind === "local" || engine.kind === "ollama" || engine.kind === "local-server" ? 6000 : 12000,
            agentNote: notesNow[agent.id] ?? "",
            docContext: docText,
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
                  ...(dmRole ? { dm: dmRole } : {}),
                  elapsed: (performance.now() - began) / 1000,
                },
              };
              setMessages([...transcript, answer]);
            }
          };
          const lastUser = [...transcript].reverse().find((m) => m.role === "user");
          const blockPaid = isOverCap(engine.spendCapUsd, { inPerM: engine.customPriceIn, outPerM: engine.customPriceOut });
          const provider = providerForTurn(engine, turnIndex, { agentId: agent.id, mode: dmRole ? "roundtable" : direct ? "direct" : mode, text: lastUser ? messageText(lastUser) : "" }, blockPaid);
          // Try the provider; if it errors before any text, move on to the next one (free keys first, then paid "fallback" ones).
          const runChain = async (first: NonNullable<typeof provider>) => {
            const chain = [first, ...chainAfter(engine, first, blockPaid)];
            let lastError: unknown;
            for (const p of chain) {
              try {
                await consume(await runCloud(p));
                const outText = answer ? messageText(answer) : "";
                const inChars = Math.min(transcript.reduce((n, m) => n + messageText(m).length, 0), requestBody.contextChars) + 2000;
                recordUsage({ kind: p.kind, model: p.model ?? (p.kind in freeModels ? freeModels[p.kind as keyof typeof freeModels] : p.kind), inTok: estimateTokens(inChars), outTok: estimateTokens(outText.length) });
                return;
              } catch (err) {
                if (controller.signal.aborted || (answer && messageText(answer).trim())) throw err;
                answer = undefined;
                lastError = err;
                logClient("warn", `${p.kind} failed, trying the next provider`, err);
              }
            }
            throw lastError;
          };
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
                await runChain(provider);
              } catch (err) {
                if (controller.signal.aborted || (answer && messageText(answer).trim())) throw err;
                answer = undefined;
                await runOllama();
              }
            }
          } else if (engine.kind === "local-server") {
            if (!provider) throw new Error("Local AI isn't available.");
            await runChain(provider);
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
            throw new Error(blockPaid ? "Your monthly spend cap is reached and no free provider is set up. Raise the cap in AI engine settings, add a free key, or choose In-browser." : "Add at least one free key in AI engine settings (Groq, Gemini or OpenRouter), or choose In-browser.");
          } else if (engine.kind === "auto") {
            // Auto: free keys are far faster; the in-browser model takes over when a key hits its limit.
            try {
              await runChain(provider);
            } catch (err) {
              if (controller.signal.aborted || !hasWebGPU() || (answer && messageText(answer).trim())) throw err;
              answer = undefined;
              await consume(await runLocal());
            }
          } else {
            await runChain(provider);
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
      if (!controller.signal.aborted) {
        const raw = err instanceof Error ? err.message : "The discussion could not continue.";
        logClient("error", "discussion failed", err);
        setError(friendlyError(raw, { engine: engine.kind, ollamaUrl: engine.ollamaUrl, ollamaModel: engine.ollamaModel }));
      }
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
      case "clear": newChat(); return;
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
      case "log": setLogOpen(true); return;
      case "library": void library(action.query, command); return;
      case "plex": void plex(action.query, command, null); return;
      case "watch": void plex("", command, action.mood); return;
      case "trakt-write": {
        void (async () => {
          try {
            const res = await fetch("/api/trakt-write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: action.op, text: action.text }) });
            const json = (await res.json()) as { text?: string; error?: string };
            say(command, json.text ?? json.error ?? "Nothing came back.");
          } catch { say(command, "I couldn't reach the server."); }
        })();
        return;
      }
      case "m365": {
        void (async () => {
          try {
            const res = await fetch("/api/m365", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: action.op }) });
            const json = (await res.json()) as { text?: string; error?: string };
            say(command, json.text ?? json.error ?? "Nothing came back.");
          } catch { say(command, "I couldn't reach the server."); }
        })();
        return;
      }
      case "schedule": {
        void (async () => {
          try {
            const res = await fetch("/api/schedules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: action.op, text: action.text }) });
            const json = (await res.json()) as { text?: string; error?: string };
            say(command, json.text ?? json.error ?? "Nothing came back.");
          } catch { say(command, "I couldn't reach the server."); }
        })();
        return;
      }
      case "appearance": {
        const next = appearanceFromWords(action.words, getAppearance());
        if (!next) return say(command, "Use light, dark or auto for the colours, and small, normal or large for the text size, for example /appearance light large.");
        setAppearance(next);
        return say(command, `Appearance: ${next.scheme} colours, ${next.size} text.${next.scheme !== "dark" ? " (Light applies to the Normal theme; other themes keep their own palettes.)" : ""}`);
      }
      case "panel": {
        if (action.panel === "calendar") setCalendarOpen(true); else if (action.panel === "mail") setMailOpen(true); else if (action.panel === "today") setTodayOpen(true); else if (action.panel === "setup") setSetupOpen(true); else if (action.panel === "search") setSearchOpen(true); else setTasksOpen(true);
        return say(command, action.panel === "calendar" ? "Calendar is open in the workspace." : "Mail is open in the workspace.");
      }
      case "remind": {
        void (async () => {
          try {
            const res = await fetch("/api/reminders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: action.op, text: action.text }) });
            const json = (await res.json()) as { text?: string; error?: string };
            say(command, json.text ?? json.error ?? "Nothing came back.");
          } catch { say(command, "I couldn't reach the server."); }
        })();
        return;
      }
      case "event": {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const ev = parseEventArgs(action.text, Date.now(), tz);
        if ("error" in ev) return say(command, ev.error);
        const links = eventLinks(ev, tz);
        return say(command, `**${ev.title}** — ${whenLabel(ev.start, tz, !ev.allDay)}${ev.allDay ? " (all day)" : ""}\n\n[Download .ics](/api/ics?${icsQuery(ev)}) (opens in Apple, Outlook, Google and most calendar apps) · [Add to Google Calendar](${links.google}) · [Add to Outlook](${links.outlook})\n\nI can't write to your calendar directly, since that needs sign-in permissions I don't ask for, so you finish it with one tap.`);
      }
      case "hide": {
        const next = action.mode === "toggle" ? !getHideSecrets() : action.mode === "on";
        setHideSecrets(next);
        return say(command, next ? "Secrets are hidden on this device. Links and addresses are blurred until you click into them." : "Secrets are visible again.");
      }
      case "weather": {
        void (async () => {
          try {
            const res = await fetch("/api/weather");
            const json = (await res.json()) as { weather?: Weather; error?: string };
            say(command, json.weather ? weatherText(json.weather) : json.error ?? "No weather available.");
          } catch { say(command, "I couldn't reach the server."); }
        })();
        return;
      }
      case "status": {
        void (async () => {
          try {
            const res = await fetch("/api/status");
            const json = (await res.json()) as { text?: string };
            say(command, json.text ?? "No status available.");
          } catch { say(command, "I couldn't reach the server to check."); }
        })();
        return;
      }
      case "web": {
        const next = action.mode === "toggle" ? !autoSearch.get() : action.mode === "on";
        autoSearch.set(next);
        return say(command, next ? "Web lookup is on: when a question needs current facts the pals will search first and cite what they find. Needs your SearXNG set up. /web off to stop." : "Web lookup is off. /search and /research still work.");
      }
      case "focus": {
        const next = action.mode === "toggle" ? !focusMode : action.mode === "on";
        setFocusMode(next);
        if (next) setConversationOpen(true);
        return say(command, next ? "Focus mode is on: just the chat. Use the Focus button or /focus off to bring everything back." : "Focus mode is off.");
      }
      case "voice": {
        if (!canSpeak) return say(command, "This browser can't read aloud (no speech engine found).");
        const next = action.mode === "toggle" ? !voice.auto : action.mode === "on";
        if (!next) stopSpeaking();
        setVoiceSettings({ auto: next });
        return say(command, next ? "Voice is on: I'll read each discussion's replies aloud when it finishes, in a different voice per pal. Use the speaker button on any reply to hear just that one. (iPhone: sound plays only after you've tapped something on the page.)" : "Voice is off.");
      }
      case "brief": void briefCmd(command, action.send); return;
      case "review": void briefCmd(command, action.send, "/api/weekly"); return;
      case "backup": void backupCmd(command, action.now); return;
      case "request": { const q = parseSeerr(`@seerr ${action.title}`); if (q) setSeerrQuery(q); return; }
      case "trakt": void trakt(action.list, command, null); return;
      case "next": void trakt(action.list, command, action.mood); return;
      case "server": void serverCheck(command, false); return;
      case "diagnose": void serverCheck(command, true); return;
      case "roll": {
        const spec = parseDice(action.expr);
        if (!spec.ok) return say(command, spec.error);
        const roll = rollDice(spec, secureRng());
        updateCampaign((c) => addRoll(c, roll.text));
        if (roll.nat20) celebrate();
        return say(command, roll.text);
      }
      case "dm": {
        const c = getCampaign();
        switch (action.sub) {
          case "start":
            updateCampaign(() => startCampaign(action.text));
            return say(command, `**Campaign started.** The first pal is your Dungeon Master and the rest are your party. Describe your character with \`/dm character …\`, then just tell them what you do. Roll with \`/roll d20\`. End it any time with \`/dm end\`.`);
          case "end":
            updateCampaign(endCampaign);
            return say(command, c.active ? "Campaign paused. Normal discussions are back. Your facts and character are kept." : "There's no campaign running.");
          case "character":
            updateCampaign((x) => setCharacter(x, action.text));
            return say(command, `Your character: ${action.text}`);
          case "fact":
            updateCampaign((x) => addFact(x, action.text));
            return say(command, `Saved. The Dungeon Master won't forget: ${action.text}`);
          case "unfact":
            updateCampaign((x) => removeFact(x, action.n ?? 0));
            return say(command, "Removed that fact (if the number existed).");
          default:
            return say(command, statusText(c));
        }
      }
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
  /** Start a fresh chat (and a fresh saved-chat record). */
  function newChat() {
    if (runLock.current) return;
    setMessages([]); setRound(0); setError(""); setForkSignal((v) => v + 1);
    inputRef.current?.focus();
  }
  /** Jellyfin lookup: shows what's in your library (needs JELLYFIN_URL on the server). */
  async function library(query: string, command: string) {
    try {
      const res = await fetch(`/api/jellyfin?q=${encodeURIComponent(query)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return say(command, json.error ?? "The library lookup failed.");
      return say(command, libraryMarkdown(query, (json.items ?? []) as LibraryItem[], json.publicUrl));
    } catch {
      return say(command, "I couldn't reach the library service.");
    }
  }
  /** /plex looks things up; /watch hands the recently-added list to the pals to pick from. */
  async function plex(query: string, command: string, mood: string | null) {
    try {
      const res = await fetch(`/api/plex?${mood !== null ? "mode=pool" : `q=${encodeURIComponent(query)}`}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return say(command, json.error ?? "The Plex lookup failed.");
      const items = (json.items ?? []) as PlexItem[];
      if (mood !== null) return items.length ? void start(undefined, watchTopic(mood, items)) : say(command, "Plex has nothing recently added to pick from.");
      return say(command, plexMarkdown(query, items));
    } catch {
      return say(command, "I couldn't reach the Plex service.");
    }
  }
  /** /trakt shows lists or one list; /next hands the list to the pals to pick from. Items are marked when Plex already has them. */
  async function trakt(list: string, command: string, mood: string | null) {
    try {
      const wantLists = mood === null && list.trim().toLowerCase() === "lists";
      const res = await fetch(`/api/trakt?${wantLists ? "mode=lists" : `plex=1${list.trim() ? `&list=${encodeURIComponent(list.trim())}` : ""}`}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return say(command, json.error ?? "The Trakt lookup failed.");
      if (wantLists) return say(command, traktListsMarkdown((json.lists ?? []) as TraktList[]));
      const items = (json.items ?? []) as TraktItem[];
      const name = String(json.list ?? (list || "watchlist"));
      if (mood !== null) return items.some((i) => !i.watched) ? void start(undefined, nextTopic(mood, name, items)) : say(command, `There's nothing unwatched in the Trakt list “${name}”.`);
      return say(command, traktMarkdown(name, items));
    } catch {
      return say(command, "I couldn't reach the Trakt service.");
    }
  }
  /** /brief previews the morning brief; /brief send pushes it to your phone. */
  async function briefCmd(command: string, send: boolean, url = "/api/brief") {
    try {
      const res = await fetch(url, { method: send ? "POST" : "GET" });
      const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      return say(command, json.text ?? json.error ?? "The brief failed.");
    } catch {
      return say(command, "I couldn't reach the brief service.");
    }
  }
  /** /backup shows the nightly backup status; /backup now makes one. */
  async function backupCmd(command: string, now: boolean) {
    try {
      const res = await fetch("/api/backup", { method: now ? "POST" : "GET" });
      const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      return say(command, json.text ?? json.error ?? "The backup check failed.");
    } catch {
      return say(command, "I couldn't reach the backup service.");
    }
  }
  /** /server shows Unraid's health; /diagnose also hands it to the pals to reason about. */
  async function serverCheck(command: string, discuss: boolean) {
    try {
      const res = await fetch("/api/unraid?refresh=1");
      const json = (await res.json().catch(() => null)) as UnraidReply | null;
      if (!res.ok || !json) return say(command, "I couldn't ask the server about Unraid.");
      if (!json.configured) return say(command, NOT_SET_UP);
      if (!json.status) return say(command, "No check has finished yet. Try again in a few seconds.");
      if (discuss) return void start(undefined, diagnoseTopic(json.status));
      return say(command, statusMarkdown(json.status));
    } catch {
      return say(command, "I couldn't reach the Pixel Pals server to check Unraid.");
    }
  }
  /** Re-run the last question: drop the replies after it and ask again. */
  function regenerate() {
    if (running) return;
    const at = messages.map((m) => m.role).lastIndexOf("user");
    const last = messages[at];
    if (at < 0 || !last) return;
    setRegen(messageText(last));
    setMessages(messages.slice(0, at));
  }
  /** Continue from an earlier message as a separate saved chat. */
  function branchFrom(id: string) {
    const at = messages.findIndex((m) => m.id === id);
    if (at < 0 || running) return;
    setMessages(messages.slice(0, at + 1));
    setForkSignal((v) => v + 1);
  }
  useEffect(() => {
    if (regen === null || running) return;
    const text = regen;
    setRegen(null);
    void startRef.current?.(undefined, text);
  }, [regen, running]); // eslint-disable-line react-hooks/exhaustive-deps
  function download(name: string, text: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = url; link.download = name; link.click();
    URL.revokeObjectURL(url);
  }
  function exportSettings(includeKeys: boolean) {
    download(includeKeys ? "pixel-pals-backup-with-keys.json" : "pixel-pals-backup.json", JSON.stringify(buildBackup(localStorage, includeKeys), null, 2), "application/json");
    say("/backup", includeKeys ? "Backup downloaded, including your API keys. Keep that file private." : "Backup downloaded. API keys were left out for safety.");
  }
  async function importSettings(file: File | undefined) {
    if (!file) return;
    const result = applyBackup(localStorage, await file.text());
    if (!result.ok) return say("/restore", result.error);
    logClient("info", `settings restored (${result.restored.length} sections)`);
    say("/restore", `Restored ${result.restored.length} sections. Reloading…`);
    setTimeout(() => window.location.reload(), 900);
  }
  const palette: PaletteAction[] = [
    { id: "win-room", group: "Windows", label: "Toggle Pixel room", run: () => setRoomOpen((v) => !v) },
    { id: "win-tools", group: "Windows", label: "Toggle Work tools", run: () => setToolsOpen((v) => !v) },
    { id: "win-rec", group: "Windows", label: "Toggle Recorder", run: () => setRecorderOpen((v) => !v) },
    { id: "win-notes", group: "Windows", label: "Open Notes, tasks, documents & pal instructions", keywords: "memories todos files", run: () => setNotesOpen(true) },
    { id: "win-search", group: "Windows", label: "Search everything (chats, notes, tasks)", keywords: "find look up history", run: () => setSearchOpen(true) },
    { id: "win-setup", group: "Windows", label: "Open Setup (what is connected, test connections)", keywords: "settings integrations status connect test env", run: () => setSetupOpen(true) },
    { id: "win-hide", group: "Windows", label: "Hide or show secrets (for screenshots)", keywords: "privacy blur mask secrets token screenshot", run: () => setHideSecrets(!getHideSecrets()) },
    { id: "win-today", group: "Windows", label: "Open Today (weather, calendar, mail, tasks)", keywords: "morning overview agenda day", run: () => setTodayOpen(true) },
    { id: "win-tasks", group: "Windows", label: "Open Tasks and reminders", keywords: "todo to-do remind reminder checklist", run: () => setTasksOpen(true) },
    { id: "win-calendar", group: "Windows", label: "Open Calendar (next 7 days)", keywords: "schedule events agenda ics google outlook", run: () => setCalendarOpen(true) },
    { id: "win-mail", group: "Windows", label: "Open Mail (unread)", keywords: "email inbox imap gmail outlook", run: () => setMailOpen(true) },
    { id: "win-dm", group: "Windows", label: "Dungeon Master (campaign)", keywords: "dnd rpg adventure dice", run: () => setNotesOpen(true) },
    { id: "win-reset", group: "Windows", label: "Reset layout", run: () => { setResetVersion((v) => v + 1); setRoomOpen(true); setConversationOpen(true); setToolsOpen(false); setNotesOpen(false); setCalendarOpen(false); setMailOpen(false); setTodayOpen(false); setTasksOpen(false); setSetupOpen(false); setSearchOpen(false); } },
    { id: "chat-new", group: "Chat", label: "New chat", hint: "Ctrl+Shift+O", run: newChat },
    { id: "chat-saved", group: "Chat", label: "Saved chats", keywords: "history search pin rename", run: () => { setConversationOpen(true); setHistoryRequest((v) => v + 1); } },
    { id: "chat-regen", group: "Chat", label: "Regenerate the last answer", run: regenerate },
    { id: "chat-export", group: "Chat", label: "Export this chat as Markdown", run: exportChat },
    { id: "chat-stop", group: "Chat", label: "Stop the discussion", hint: "Esc", run: stop },
    { id: "chat-compare", group: "Chat", label: "Compare models (blind test)", run: () => { setCompareQuestion(""); setCompareOpen(true); } },
    ...modeNames.map((m): PaletteAction => ({ id: `mode-${m}`, group: "Mode", label: `Mode: ${m}`, run: () => setMode(m as Mode) })),
    ...themeNames.map((t): PaletteAction => ({ id: `theme-${t}`, group: "Theme", label: `Theme: ${t}`, run: () => setCharacterMode(t as CharacterMode) })),
    { id: "assist-on", group: "Theme", label: "Assistant Mode on", run: () => setAssistantMode(true) },
    { id: "assist-off", group: "Theme", label: "Assistant Mode off", run: () => setAssistantMode(false) },
    { id: "next", group: "Chat", label: "What should we watch next? (Trakt list)", keywords: "trakt list watchlist movie show tv", run: () => void trakt("", "/next", "") },
    { id: "appearance-light", group: "View", label: "Appearance: light colours", keywords: "light mode bright theme", run: () => runSlash({ type: "appearance", words: "light" }, "/appearance light") },
    { id: "appearance-dark", group: "View", label: "Appearance: dark colours", keywords: "dark mode", run: () => runSlash({ type: "appearance", words: "dark" }, "/appearance dark") },
    { id: "appearance-large", group: "View", label: "Text size: larger", keywords: "font zoom bigger accessibility", run: () => runSlash({ type: "appearance", words: "large" }, "/appearance large") },
    { id: "appearance-normal", group: "View", label: "Text size: normal", keywords: "font zoom reset", run: () => runSlash({ type: "appearance", words: "normal" }, "/appearance normal") },
    { id: "web-lookup", group: "Chat", label: autoSearch.get() ? "Turn off automatic web lookup" : "Turn on automatic web lookup", keywords: "search internet current facts", run: () => runSlash({ type: "web", mode: "toggle" }, "/web") },
    { id: "status", group: "Chat", label: "Check services (status)", keywords: "health ollama plex unraid", run: () => runSlash({ type: "status" }, "/status") },
    { id: "focus", group: "View", label: focusMode ? "Leave focus mode" : "Focus mode (just the chat)", hint: "Ctrl+Shift+F", keywords: "calm minimal distraction fullscreen expand chat", run: () => runSlash({ type: "focus", mode: "toggle" }, "/focus") },
    { id: "voice", group: "Chat", label: voice.auto ? "Turn off reading replies aloud" : "Read replies aloud", keywords: "voice speak tts sound audio", run: () => runSlash({ type: "voice", mode: "toggle" }, "/voice") },
    { id: "watch", group: "Chat", label: "What should we watch tonight?", keywords: "plex movie show tv", run: () => void plex("", "/watch", "") },
    { id: "srv", group: "Chat", label: "Check my Unraid server", keywords: "server health status", run: () => void serverCheck("/server", false) },
    { id: "srv-why", group: "Chat", label: "What's wrong with my server? (pals diagnose)", keywords: "unraid diagnose", run: () => void serverCheck("/diagnose", true) },
    { id: "log", group: "Help", label: "Debug log (copy for Claude)", hint: "Ctrl+Shift+L", keywords: "bug error report", run: () => setLogOpen(true) },
    { id: "help", group: "Help", label: "List slash commands", run: () => say("/help", helpText()) },
    { id: "keys", group: "Help", label: "Keyboard shortcuts", run: () => say("/shortcuts", "Keyboard shortcuts:\n" + shortcutList.map((k) => `• \`${k.keys}\` — ${k.label}`).join("\n")) },
    { id: "bk-out", group: "Backup", label: "Export settings (without API keys)", keywords: "download save backup", run: () => exportSettings(false) },
    { id: "bk-keys", group: "Backup", label: "Export settings including API keys", run: () => exportSettings(true) },
    { id: "bk-in", group: "Backup", label: "Import settings from a backup file…", keywords: "restore upload", run: () => importRef.current?.click() },
  ];
  const shortcutState = useRef({ running, dialogOpen: false });
  shortcutState.current = { running, dialogOpen: compareOpen || logOpen || paletteOpen || !!seerrQuery };
  const actionsRef = useRef({ newChat, stop, palette: () => setPaletteOpen((v) => !v), focus: () => inputRef.current?.focus(), sidebar: () => setSidebarCompact((v) => !v), log: () => setLogOpen(true), focusMode: () => setFocusMode((v) => !v) });
  actionsRef.current = { newChat, stop, palette: () => setPaletteOpen((v) => !v), focus: () => inputRef.current?.focus(), sidebar: () => setSidebarCompact((v) => !v), log: () => setLogOpen(true), focusMode: () => setFocusMode((v) => !v) };
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const action = matchShortcut(e, shortcutState.current.running, shortcutState.current.dialogOpen);
      if (!action) return;
      e.preventDefault();
      const a = actionsRef.current;
      if (action === "palette") a.palette();
      else if (action === "newChat") a.newChat();
      else if (action === "focusComposer") a.focus();
      else if (action === "toggleSidebar") a.sidebar();
      else if (action === "debugLog") a.log();
      else if (action === "focusMode") a.focusMode();
      else a.stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
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
    <div className={cn("app-shell modular-workspace", sidebarCompact && "sidebar-collapsed", focusMode && "focus-mode", focusMode && focusOptions && "focus-options")}>
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
        <Button variant="ghost" size="icon" className="header-focus-btn" aria-label={focusMode ? "Leave focus mode" : "Focus mode"} aria-pressed={focusMode} title={focusMode ? "Leave focus mode (Ctrl+Shift+F)" : "Focus mode: just the chat (Ctrl+Shift+F)"} onClick={() => setFocusMode((v) => !v)}>{focusMode ? <Minimize2 /> : <Maximize2 />}</Button>
        <Button variant="ghost" size="icon" className="header-menu-btn" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}><Ellipsis /></Button>
        <div
          className={cn("header-right", menuOpen && "header-open")}
          onClick={(e) => { const el = e.target as HTMLElement; if (el.closest("button") && !el.closest("[role=combobox],[role=switch],.header-menu-btn")) setMenuOpen(false); }}
        >
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
          {canSpeak && (
            <Button variant="ghost" size="sm" className="engine-trigger" aria-pressed={voice.auto} title={voice.auto ? "Replies are read aloud. Click to turn off." : "Read replies aloud"} onClick={() => { if (voice.auto) stopSpeaking(); setVoiceSettings({ auto: !voice.auto }); }}>
              {voice.auto ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />} Voice
            </Button>
          )}
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
          <Button variant="ghost" size="sm" className="engine-trigger mobile-only" onClick={() => setLogOpen(true)}><Bug className="size-4" /> Debug log</Button>
          <Button variant="ghost" size="sm" className="engine-trigger mobile-only" onClick={() => { setCompareQuestion(""); setCompareOpen(true); }}><Scale className="size-4" /> Compare models</Button>
          <Button variant="ghost" size="sm" className="engine-trigger mobile-only" onClick={() => { setResetVersion((value) => value + 1); setRoomOpen(true); setConversationOpen(true); setToolsOpen(false); setNotesOpen(false); setCalendarOpen(false); setMailOpen(false); setTodayOpen(false); setTasksOpen(false); setSetupOpen(false); setSearchOpen(false); }}><LayoutGrid className="size-4" /> Reset layout</Button>
        </div>
      </header>
      <button type="button" className="mobile-strip" onClick={() => setRoomOpen((v) => !v)}>
        <span className={cn("status-dot", running && "pulse-dot")} />
        {running && activeAgent ? `${agentName(activeAgent.id, hell, horror, characterMode)} ${bubbleText ? "is talking…" : "is thinking…"}` : "Pals are ready"}
        <span className="mobile-strip-hint">tap for the room</span>
      </button>
      <UnraidBanner onDiagnose={() => void serverCheck("/diagnose", true)} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} actions={palette} />
      <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => { void importSettings(e.target.files?.[0]); e.target.value = ""; }} />
      <DebugLogDialog open={logOpen} onOpenChange={setLogOpen} context={[`engine: ${engine.kind}${engine.kind.includes("ollama") ? ` (${engine.ollamaUrl} · ${engine.ollamaModel})` : ""}`, `theme: ${characterMode} · mode: ${mode} · rounds: ${rounds}`, `messages in chat: ${messages.length}`, `last error shown: ${error || "none"}`]} />
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
          <Button variant="ghost" className="sidebar-item" title="Search chats, notes, tasks and reminders" aria-pressed={searchOpen} onClick={() => setSearchOpen((value) => !value)}><Search /><span>Search</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Setup: what's connected, with connection tests" aria-pressed={setupOpen} onClick={() => setSetupOpen((value) => !value)}><Settings2 /><span>Setup</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Today: weather, calendar, mail, tasks and a pick" aria-pressed={todayOpen} onClick={() => setTodayOpen((value) => !value)}><Sun /><span>Today</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Tasks and reminders" aria-pressed={tasksOpen} onClick={() => setTasksOpen((value) => !value)}><CheckSquare /><span>Tasks</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Calendar: your next 7 days" aria-pressed={calendarOpen} onClick={() => setCalendarOpen((value) => !value)}><CalendarDays /><span>Calendar</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Mail: unread subjects" aria-pressed={mailOpen} onClick={() => setMailOpen((value) => !value)}><Mail /><span>Mail</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Copy a bug report for Claude" onClick={() => setLogOpen(true)}><Bug /><span>Debug log</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Blind model comparison" onClick={() => { setCompareQuestion(""); setCompareOpen(true); }}><Scale /><span>Compare models</span></Button>
          <div className="sidebar-divider" />
          <Button variant="ghost" className="sidebar-item" title="Saved chats" disabled={running} onClick={() => { setConversationOpen(true); setHistoryRequest((value) => value + 1); }}><History /><span>Saved chats</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Reset layout" onClick={() => { setResetVersion((value) => value + 1); setRoomOpen(true); setConversationOpen(true); setToolsOpen(false); setNotesOpen(false); setCalendarOpen(false); setMailOpen(false); setTodayOpen(false); setTasksOpen(false); setSetupOpen(false); setSearchOpen(false); }}><LayoutGrid /><span>Reset layout</span></Button>
          <div className="sidebar-bottom">          {(engine.kind === "local" || engine.kind === "auto") && <><AutoModelDownload /><WebGpuUsageBox active /></>}
          <OllamaMascot active={running && (engine.kind === "ollama" || engine.kind === "auto-ollama")} />
          <UpdatePopup />
          <p className="build-version" title={`Commit ${__APP_COMMIT__} · built ${__APP_BUILD_DATE__}`}>
            c{desktopApp ? "Desktop" : "Web"} v{__APP_VERSION__} · {__APP_COMMIT__}
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
          <SavedDiscussions openRequest={historyRequest} forkSignal={forkSignal} messages={messages} mode={mode} theme={characterMode} running={running} onOpen={(items, theme, discussionMode) => { setMessages(items); setCharacterMode(theme); setMode(discussionMode); setRound(0); setError(""); }} />
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
                              : m.metadata?.dm === "dm"
                                ? "DUNGEON MASTER"
                                : m.metadata?.dm === "party"
                                  ? "PARTY"
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
                              <>
                                <MessageAction tooltip="Copy reply" label="Copy reply" onClick={() => void navigator.clipboard?.writeText(messageText(m))}>
                                  <Copy size={13} />
                                </MessageAction>
                                {canSpeak && (
                                  <MessageAction tooltip={speakingMessage === m.id ? "Stop reading" : "Read aloud"} label={speakingMessage === m.id ? "Stop reading" : "Read aloud"} onClick={() => { if (speakingMessage === m.id) stopSpeaking(); else void speakItems([{ id: m.id, text: messageText(m), agentId: String(m.metadata?.agentId ?? "echo") }]); }}>
                                    {speakingMessage === m.id ? <VolumeX size={13} /> : <Volume2 size={13} />}
                                  </MessageAction>
                                )}
                                {m.id === lastMessage?.id && m.metadata?.agentId !== "echo" && (
                                  <MessageAction tooltip="Regenerate" label="Regenerate answer" onClick={regenerate}>
                                    <RefreshCw size={13} />
                                  </MessageAction>
                                )}
                                <MessageAction tooltip="Branch a new chat from here" label="Branch from here" onClick={() => branchFrom(m.id)}>
                                  <GitBranch size={13} />
                                </MessageAction>
                              </>
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
            <WorkspaceWindow id="search" title="Search" icon={<Search className="size-4" />} open={searchOpen} onClose={() => setSearchOpen(false)} resetVersion={resetVersion}>
              <SearchPanel open={searchOpen} onOpenChat={(row) => { setMessages(row.messages); setCharacterMode(row.theme); setMode(row.mode); setRound(0); setError(""); setConversationOpen(true); }} />
            </WorkspaceWindow>
            <WorkspaceWindow id="setup" title="Setup" icon={<Settings2 className="size-4" />} open={setupOpen} onClose={() => setSetupOpen(false)} resetVersion={resetVersion}>
              <SetupPanel open={setupOpen} />
            </WorkspaceWindow>
            <WorkspaceWindow id="today" title="Today" icon={<Sun className="size-4" />} open={todayOpen} onClose={() => setTodayOpen(false)} resetVersion={resetVersion}>
              <TodayPanel open={todayOpen} />
            </WorkspaceWindow>
            <WorkspaceWindow id="tasks" title="Tasks & reminders" icon={<CheckSquare className="size-4" />} open={tasksOpen} onClose={() => setTasksOpen(false)} resetVersion={resetVersion}>
              <TasksPanel open={tasksOpen} />
            </WorkspaceWindow>
            <WorkspaceWindow id="calendar" title="Calendar" icon={<CalendarDays className="size-4" />} open={calendarOpen} onClose={() => setCalendarOpen(false)} resetVersion={resetVersion}>
              <CalendarPanel open={calendarOpen} />
            </WorkspaceWindow>
            <WorkspaceWindow id="mail" title="Mail" icon={<Mail className="size-4" />} open={mailOpen} onClose={() => setMailOpen(false)} resetVersion={resetVersion}>
              <MailPanel open={mailOpen} />
            </WorkspaceWindow>
            {!roomOpen && !conversationOpen && !toolsOpen && !recorderOpen && !notesOpen && !calendarOpen && !mailOpen && !todayOpen && !tasksOpen && !setupOpen && !searchOpen && <div className="workspace-rest"><PixelCharacter id="nova" /><h1>Pixel Pals</h1></div>}
          </main>
          <section className="workspace-composer" aria-label="Message composer">
            <button type="button" className="focus-options-btn" aria-expanded={focusOptions} onClick={() => setFocusOptions((v) => !v)}>{focusOptions ? "Hide options" : "Options"}</button>
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
                <MicButton disabled={running} onText={(t) => { setTopic((cur) => (cur.trim() ? `${cur.trim()} ${t}` : t)); inputRef.current?.focus(); }} />
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
