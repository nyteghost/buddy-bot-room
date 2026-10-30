import { Fragment, lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { startPolling } from "@/lib/poll";
import { DefaultChatTransport, readUIMessageStream } from "ai";
import { Puzzle, ArrowUpRight, Check, ChevronDown, CircleHelp, Copy, Download, ListTodo, Scale, MessageSquare, Mic, LayoutGrid, History, PanelLeftClose, PanelLeftOpen, Gamepad2, FlaskConical, Wrench, Minus, Play, Plus, Radio, Swords, RotateCcw, Search, Settings2, Square, Users, X, Bug, Volume2, VolumeX, Ellipsis, Maximize2, Minimize2, Mail, CalendarDays, CheckSquare, Sun, FileText, Workflow, Sparkles } from "lucide-react";
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
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { PixelCharacter } from "./pixel-character";
import { MessageRow, type RowActions } from "./message-row";
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
  ALL_MODES,
  type RoomMessage,
} from "@/lib/agents";
import { listLocalOrServer } from "@/lib/chat-store";
import type { SavedDiscussion } from "@/lib/saved-discussions";
import { SavedDiscussions } from "./saved-discussions";
import { WorkspaceLayoutMenu } from "./workspace-layout-menu";
import { JustStartDialog } from "./just-start-dialog";
import matrixRoomImage from "@/assets/matrix-room.jpg";
import fantasyRoomImage from "@/assets/final-fantasy-room.jpg";
import roomImage from "@/assets/pixel-room.jpg";
import devRoomImage from "@/assets/devteam-room.jpg";
import officeRoomImage from "@/assets/office-room.jpg";
import cyberRoomImage from "@/assets/cyberpunk-room.jpg";
import hellRoomImage from "@/assets/hellraiser-room.jpg";
import horrorRoomImage from "@/assets/horror-room.jpg";
import dccRoomImage from "@/assets/dcc-room.jpg";
import { benchProvider, chainAfter, cloudFallbackChain, isBenched, orderByHealth, providerNames, type Bench, freeModels, palEngineLabel, providerLabel, providerForTurn, localServerProvider, replyTokens, useEngine } from "@/lib/engine";
import { estimateTokens } from "@/lib/usage";
import { isOverCap, recordUsage } from "@/lib/usage-store";
import { hasWebGPU, localTurn, ollamaTurn } from "@/lib/local-llm";
import { AutoModelDownload, EngineSettingsDialog, WebGpuUsageBox } from "./engine-settings";
import { OllamaMascot } from "./ollama-mascot";
import mascot from "@/assets/mascot.png";
import { UpdatePopup } from "./update-popup";
import { UpdateBanner } from "./update-banner";
import { linuxContext } from "@/lib/linux";
import { isTauri } from "@/lib/local-llm";
const LinuxTerminal = lazy(() => import("./linux-terminal"));
import { AccountButton } from "./account-button";
// Secondary windows load their code the first time they are opened, so the first screen has less to download and run.
const ShowServicesTools = lazy(() => import("./work-tools").then((m) => ({ default: m.ShowServicesTools })));
const PlaytestsPanel = lazy(() => import("./playtests-panel").then((m) => ({ default: m.PlaytestsPanel })));
import { WorkspaceWindow } from "./workspace-window";
import { MicRecorder } from "./mic-recorder";
import { deckReply } from "@/lib/deck-solver";
import { priceReply } from "@/lib/work-tools";
import { cn } from "@/lib/utils";
import { parseSlash, slashSuggestions, helpText, modeNames, themeNames, type SlashAction } from "@/lib/slash-commands";
import { freshRecall, promptHistory, recallStep, type RecallState } from "@/lib/prompt-recall";
import { celebrate } from "@/lib/confetti";
import { CompareDialog } from "./compare-dialog";
import { SeerrDialog } from "./seerr-dialog";
import { NotesPanel } from "./notes-panel";
import { DebugLogDialog } from "./debug-log-dialog";
import { buildRecentReport, clientLog, installGlobalLogging, logClient } from "@/lib/debug-log";
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
import { DocumentsPanel } from "@/components/doc-viewer/documents-panel";
import { DocumentModalHost } from "@/components/doc-viewer/document-modal";
import { MailAlertPopup, ReminderPopup } from "@/components/mail-alerts";
import { AddonWindows, useAddons } from "@/components/addons";
import { TasksPanel, TodayPanel } from "@/components/day-panels";
import { SetupPanel } from "@/components/setup-panel";
import { FunPanel } from "@/components/fun-panel";
import { TaskSync } from "@/components/task-sync";
import { BUILT_IN_PROMPTS, addPrompt, findPrompt, promptList, type SavedPrompt } from "@/lib/prompts";
import { getPrompts, setPrompts, usePrompts } from "@/lib/prompts-store";
import { mergeCaptures, type Capture } from "@/lib/capture";
import { SearchPanel } from "@/components/search-panel";
import { setHideSecrets, getHideSecrets, useHideSecrets } from "@/lib/privacy-store";
import { MicButton } from "@/components/mic-button";
import { smartRetrieve } from "@/lib/smart-docs";
import { createThrottle, systemClock } from "@/lib/stream-throttle";
import { createDebouncedSaver } from "@/lib/debounced-save";
import { installUuidPolyfill } from "@/lib/uuid-polyfill";
import { wantsWeb, webContext } from "@/lib/web-context";
import { autoSearch } from "@/lib/prefs";
import { getNotes } from "@/lib/agent-notes";
import { getOverrides, mayUseRealData, memoryAccess, useOverrides } from "@/lib/character-overrides";
import { runClientMigrations } from "@/lib/migrate-client";
import { chatSlice, lowPower, useEverTrue, usePowerAttributes } from "@/lib/power";
import { getProjects, logRun, projectBrief, updateProject, useProjects } from "@/lib/projects";
import { applyBackup, buildBackup } from "@/lib/settings-io";
import { libraryMarkdown, type LibraryItem } from "@/lib/jellyfin";
import { addFact, addRoll, campaignContext, endCampaign, getCampaign, removeFact, setCharacter, startCampaign, statusText, updateCampaign } from "@/lib/campaign";
import { parseDice, rollDice, secureRng } from "@/lib/dice";
import { diagnoseTopic, NOT_SET_UP, statusMarkdown, type UnraidReply } from "@/lib/unraid";
import { UnraidBanner } from "./unraid-banner";
import { nextTopic, traktListsMarkdown, traktMarkdown, type TraktItem, type TraktList } from "@/lib/trakt";
import { sharedText } from "@/lib/share-prefill";
import { setVoiceSettings, speakItems, stopSpeaking, useSpeakingId, useVoice, voiceSupported } from "@/lib/voice";
import { plexMarkdown, watchTopic, type PlexItem } from "@/lib/plex";
import { parseSeerr, type SeerrQuery } from "@/lib/seerr";
import { hitsMarkdown, researchTopic, type SearchHit } from "@/lib/search";
import { RoomLive } from "@/components/room-live";
import { awardXp } from "@/lib/progress-store";
import { UsageMeter } from "@/components/usage-panel";
import { calendarText, dayWant, mailText, tasksText, wantsAny } from "@/lib/day-context";
import { extractSteps } from "@/lib/solve-steps";
import { defaultOpenModes, modeHelp, modeLabel, modePlaceholder, modeSuggestions, perMode, suggestions } from "@/lib/mode-meta";
import { planTurns } from "@/lib/turn-plan";
import { dispatchTurn } from "@/lib/turn-dispatch";
import { buildHandoff, cleanSmartConfig, defaultSmartConfig, isRepeat, outOfTime, shouldRun, SMART_ROLES, type SmartConfig, type SmartRole } from "@/lib/smart-team";
import { addEntry, addPalMemory, addTodo, clearDone, getWorkbench, removePalMemory, listText, promptContextFor, removeAt, toggleTodo, updateWorkbench } from "@/lib/workbench";
import { pickMemories, visibleMemories } from "@/lib/memory-rank";
import { memoryBoost } from "@/lib/memory-boost";
import { activeProject } from "@/lib/prefs";

runClientMigrations();
const storageKey = "pixel-pals-conversation-v1";
const chatsKey = "pixel-pals-conversations-v2";

installUuidPolyfill(); // plain-http pages have no crypto.randomUUID

export function Room() {
  // Each conversation mode (Roundtable, Broadcast, One-on-one, Problem solving, Debate) has its own window, chat and draft.
  const [chats, setChats] = useState<Record<Mode, RoomMessage[]>>(() => perMode(() => []));
  const [drafts, setDrafts] = useState<Record<Mode, string>>(() => perMode(() => ""));
  /** The mode window you are working in; plain "messages" and "topic" below mean that window's. */
  const [mode, setMode] = useState<Mode>("roundtable");
  const messages = chats[mode];
  const topic = drafts[mode];
  function setMessagesIn(target: Mode, value: RoomMessage[] | ((current: RoomMessage[]) => RoomMessage[])) {
    setChats((all) => ({ ...all, [target]: typeof value === "function" ? value(all[target]) : value }));
  }
  function setDraftIn(target: Mode, value: string | ((current: string) => string)) {
    setDrafts((all) => ({ ...all, [target]: typeof value === "function" ? value(all[target]) : value }));
  }
  const setMessages = (value: RoomMessage[] | ((current: RoomMessage[]) => RoomMessage[])) => setMessagesIn(mode, value);
  const setTopic = (value: string | ((current: string) => string)) => setDraftIn(mode, value);
  useOverrides();
  usePowerAttributes();
  const rowActions = useRef({} as RowActions);
  const [shownCount, setShownCount] = useState<Record<string, number>>({});
  const projectsAll = useProjects();
  const activeName = activeProject.use();
  // Resume: when a project with assigned pals is active (including right after a restart), seat exactly those pals.
  const seatKey = activeName && projectsAll[activeName]?.status !== "done" ? (projectsAll[activeName]?.agents ?? []).join(",") : "";
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
  // Preload only while active. When someone returns after Ollama's idle timeout,
  // re-warm the model without forcing it to stay resident all day.
  useEffect(() => {
    if (engine.kind !== "ollama" && engine.kind !== "auto-ollama") return;
    const warm = () => {
      if (document.visibilityState === "hidden") return;
      void warmOllama(engine.ollamaUrl, engine.ollamaModel).then((ok) => {
        if (ok) logClient("info", `Ollama model ${engine.ollamaModel} preloaded`);
      });
    };
    warm();
    window.addEventListener("focus", warm);
    document.addEventListener("visibilitychange", warm);
    return () => { window.removeEventListener("focus", warm); document.removeEventListener("visibilitychange", warm); };
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

  const [recorderOpen, setRecorderOpen] = useState(false);
  const [playtestsOpen, setPlaytestsOpen] = useState(false);
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
  const [rounds, setRounds] = useState(2);
  const [judgeOn, setJudgeOn] = useState(false);
  // Smart Team settings (how many pals, time limit, who plays which role). Remembered on this device.
  const [smartCfg, setSmartCfgState] = useState<SmartConfig>(defaultSmartConfig);
  useEffect(() => { try { setSmartCfgState(cleanSmartConfig(JSON.parse(localStorage.getItem("pixel-pals-smart-v1") ?? "null"))); } catch { /* optional storage */ } }, []);
  const setSmartCfg = (patch: Partial<SmartConfig>) => setSmartCfgState((cur) => { const next = cleanSmartConfig({ ...cur, ...patch }); try { localStorage.setItem("pixel-pals-smart-v1", JSON.stringify(next)); } catch { /* optional storage */ } return next; });
  // "Short answers" per mode window: cheaper and quicker replies. Remembered on this device.
  const [shortOn, setShortOn] = useState<Record<Mode, boolean>>(() => perMode(() => false));
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem("pixel-pals-short-v1") ?? "null"); if (v && typeof v === "object") setShortOn((cur) => ({ ...cur, ...Object.fromEntries(ALL_MODES.map((m) => [m, v[m] === true])) })); } catch { /* optional storage */ } }, []);
  const setShort = (m: Mode, on: boolean) => setShortOn((cur) => { const next = { ...cur, [m]: on }; try { localStorage.setItem("pixel-pals-short-v1", JSON.stringify(next)); } catch { /* optional storage */ } return next; });
  const [partner, setPartner] = useState<AgentId>("claude");
  const [enabled, setEnabled] = useState<AgentId[]>(agents.filter((a) => a.id !== "saiyan").map((a) => a.id)); // Saiyan joins when you switch him on
  useEffect(() => {
    const ids = seatKey.split(",").filter(Boolean) as AgentId[];
    if (ids.length) setEnabled(agents.filter((a) => ids.includes(a.id)).map((a) => a.id));
  }, [seatKey]);
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
  const savedPrompts = usePrompts();
  useEffect(() => {
    // Things you sent from your phone (Telegram, share sheet) are waiting on the server; fold them into notes and tasks.
    const collect = async (): Promise<boolean> => {
      try {
        const res = await fetch("/api/capture", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "take" }) });
        if (!res.ok) return false;
        const { items } = (await res.json()) as { items?: Capture[] };
        if (items?.length) updateWorkbench((w) => mergeCaptures(w, items));
        return true;
      } catch { return false; /* offline or not the owner: ask less often */ }
    };
    return startPolling(collect, 60_000, { maxMs: 600_000 });
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
  const [openModes, setOpenModes] = useState<Record<Mode, boolean>>(defaultOpenModes);
  const conversationOpen = ALL_MODES.some((m) => openModes[m]);
  const showMode = (m: Mode) => setOpenModes((o) => (o[m] ? o : { ...o, [m]: true }));
  const toggleMode = (m: Mode) => setOpenModes((o) => ({ ...o, [m]: !o[m] }));
  const setConversationOpen = (value: boolean) => { if (value) showMode(mode); };
  const resetModes = () => setOpenModes(defaultOpenModes);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsSeen = useEverTrue(toolsOpen);
  const playtestsSeen = useEverTrue(playtestsOpen);
  const [notesOpen, setNotesOpen] = useState(false);
  const [funOpen, setFunOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [chatter, setChatter] = useState<AgentId | null>(null);
  /** Phones: one window at a time. Closes the rest and opens the one tapped in the bottom tab bar. */
  function mobileTab(tab: "chat" | "today" | "tasks" | "notes" | "room" | "mail" | "calendar") {
    setOpenModes(perMode(() => false));
    setRoomOpen(tab === "room"); setTodayOpen(tab === "today"); setTasksOpen(tab === "tasks"); setNotesOpen(tab === "notes");
    setMailOpen(tab === "mail"); setCalendarOpen(tab === "calendar");
    setToolsOpen(false); setFunOpen(false); setSetupOpen(false); setSearchOpen(false); setRecorderOpen(false);
    if (tab === "chat") showMode(mode);
  }
  const [mailOpen, setMailOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [todayOpen, setTodayOpen] = useState(false);
  const [justStartOpen, setJustStartOpen] = useState(false);
  const [justStartTask, setJustStartTask] = useState("");
  const beginFocusTask = (task = "") => { setJustStartTask(task); setJustStartOpen(true); };
  const [tasksOpen, setTasksOpen] = useState(false);
  const { addons } = useAddons();
  const [addonOpen, setAddonOpen] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  /** AIs that failed recently: later turns skip them (see orderByHealth). */
  const benchRef = useRef<Bench>(new Map());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [forkSignals, setForkSignals] = useState<Record<Mode, number>>(() => perMode(() => 0));
  const bumpFork = (m: Mode) => setForkSignals((f) => ({ ...f, [m]: f[m] + 1 }));
  const [runningMode, setRunningMode] = useState<Mode | null>(null);
  const [regen, setRegen] = useState<{ text: string; mode: Mode } | null>(null);
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
        if (saved.openModes && typeof saved.openModes === "object") setOpenModes({ ...defaultOpenModes, ...Object.fromEntries(ALL_MODES.map((m) => [m, saved.openModes[m] === true])) });
        else setOpenModes({ ...defaultOpenModes, roundtable: saved.conversationOpen !== false });
        setSidebarCompact(saved.sidebarCompact === true);
        if (saved.todayOpen !== undefined) setTodayOpen(saved.todayOpen === true);
      } else {
        // First visit: Today is the front page.
        setTodayOpen(true);
        if (localStorage.getItem("pixel-pals-compact-v1") === "1") setRoomOpen(false);
      }
    } catch { /* optional layout preferences */ }
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem("pixel-pals-workspace-v1", JSON.stringify({ roomOpen, openModes, sidebarCompact, todayOpen })); } catch { /* optional storage */ }
  }, [roomOpen, openModes, sidebarCompact, todayOpen, ready]);
  const abortRef = useRef<AbortController | null>(null);
  const replayRef = useRef<AbortController | null>(null);
  const [replayId, setReplayId] = useState<string | null>(null);
  const inputEls = useRef<Partial<Record<Mode, HTMLTextAreaElement | null>>>({});
  const modeNow = useRef(mode);
  modeNow.current = mode;
  /** The message box of the window you are working in. */
  const inputRef = { get current(): HTMLTextAreaElement | null { return inputEls.current[modeNow.current] ?? null; } };
  const runLock = useRef(false);
  const recall = useRef<RecallState>(freshRecall);

  useEffect(() => {
    try {
      const validList = (v: unknown): v is RoomMessage[] => Array.isArray(v) && v.every((m) => m && typeof m.id === "string" && Array.isArray(m.parts));
      const savedAll = localStorage.getItem(chatsKey);
      if (savedAll) {
        const parsed = JSON.parse(savedAll);
        if (parsed && typeof parsed === "object") setChats((c) => ({ ...c, ...Object.fromEntries(ALL_MODES.filter((m) => validList(parsed[m])).map((m) => [m, parsed[m]])) }));
      } else {
        // Before the mode windows there was one chat; it becomes the Roundtable chat.
        const legacy = localStorage.getItem(storageKey);
        const parsed = legacy ? JSON.parse(legacy) : null;
        if (validList(parsed)) setChats((c) => ({ ...c, roundtable: parsed }));
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
  // Saving rewrites every conversation, so it waits for a quiet moment (and at most 2 s during a long reply) instead of running per token.
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const saverRef = useRef<ReturnType<typeof createDebouncedSaver> | null>(null);
  saverRef.current ??= createDebouncedSaver(() => {
    try {
      localStorage.setItem(chatsKey, JSON.stringify(chatsRef.current));
    } catch {
      setSaveError("Browser storage is full. This conversation could not be saved.");
    }
  }, 400, 2000, systemClock);
  useEffect(() => {
    if (!ready || cloud) return;
    saverRef.current?.schedule();
  }, [chats, ready, cloud]);
  useEffect(() => {
    const flush = () => saverRef.current?.flush();
    const hidden = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", hidden); flush(); };
  }, []);

  const stop = () => {
    stopSpeaking();
    const running = abortRef.current;
    running?.abort();
    replayRef.current?.abort();
    // If the run is stuck waiting on something that ignores the abort (a slow lookup, a model that is still loading),
    // give it a moment, then free the room anyway. The old run is cancelled, so anything it finishes later is dropped.
    if (running)
      window.setTimeout(() => {
        if (abortRef.current !== running) return;
        setRunning(false);
        setRunningMode(null);
        setSpeaking(null);
        runLock.current = false;
        abortRef.current = null;
      }, 700);
  };

  /** Sends in the given mode window (the one you are working in when none is given). */
  async function start(ask?: { partner: AgentId; text: string }, override?: string, inMode?: Mode, extra?: { summary?: boolean }) {
    // Anything that goes wrong before the run's own error handling (a missing browser feature, say) must never leave the room "thinking".
    return startIn(inMode ?? mode, ask, override, extra).catch((err: unknown) => {
      logClient("error", "could not start the discussion", err);
      setRunning(false);
      setRunningMode(null);
      setSpeaking(null);
      runLock.current = false;
      abortRef.current = null;
      setError(err instanceof Error ? `Couldn't start: ${err.message}` : "Couldn't start the discussion.");
    });
  }
  async function startIn(mode: Mode, ask?: { partner: AgentId; text: string }, override?: string, extra?: { summary?: boolean }) {
    if (runLock.current) return;
    const messages = chats[mode];
    const topicDraft = drafts[mode];
    const direct0 = mode === "direct";
    const setMessages = (value: RoomMessage[] | ((current: RoomMessage[]) => RoomMessage[])) => setMessagesIn(mode, value);
    const setTopic = (value: string | ((current: string) => string)) => setDraftIn(mode, value);
    showMode(mode);
    replayRef.current?.abort();
    setReplayId(null);
    const topic = ask?.text ?? override ?? topicDraft;
    const mentioned = ask || override ? null : resolveMention(topic, modeRef.current);
    const direct = ask || mentioned ? true : direct0;
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
      else if (slash.error.startsWith("Unknown command")) {
        const raw = topic.trim();
        const m = /^\/([^\s]+)\s*([\s\S]*)$/.exec(raw);
        void (async () => {
          try {
            const res = await fetch("/api/addons", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "command", name: m?.[1] ?? "", text: m?.[2] ?? "" }) });
            const json = (await res.json()) as { text?: string | null };
            say(raw, typeof json.text === "string" ? json.text : slash.error);
          } catch { say(raw, slash.error); }
        })();
      } else say(topic.trim(), slash.error);
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
    setRunningMode(mode);
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
    const personasNow = getOverrides();
    const projectNow = getProjects()[activeProject.get()];
    // When the active project lists its own documents, only those are searched.
    const docsAll = getDocs();
    const docsNow = projectNow?.docs.length && docsAll.some((d) => projectNow.docs.includes(d.name)) ? docsAll.filter((d) => projectNow.docs.includes(d.name)) : docsAll;
    let docText = docsNow.length ? docContext(await smartRetrieve(allChunks(docsNow), topic)) : "";
    // Only when the memories do not all fit in a prompt: score them against this question (keyword + meaning) so the right ones are kept.
    let memBoost: ReadonlyMap<string, number> | undefined;
    {
      const wbNow = getWorkbench();
      const project = activeProject.get() || undefined;
      const ids = (direct ? [partner] : enabled) as string[];
      if (ids.some((id) => pickMemories(wbNow, topic, { pal: id, project, access: memoryAccess(personasNow, id) }).ranked)) {
        const seen = new Map<string, string>();
        for (const id of ids) for (const v of visibleMemories(wbNow, { pal: id, project, access: memoryAccess(personasNow, id) })) seen.set(v.entry.id, v.entry.text);
        memBoost = await memoryBoost([...seen].map(([id, text]) => ({ id, text })), topic);
      }
    }
    // Optional: let the pals look things up themselves when the question needs current facts (/web on).
    if (autoSearch.get() && wantsWeb(topic)) {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(topic.trim().slice(0, 200))}`, { signal: AbortSignal.timeout(8000) });
        const json = (await res.json()) as { hits?: SearchHit[] };
        if (res.ok && json.hits?.length) docText = `${docText}\n\n${webContext(topic.trim(), json.hits.slice(0, 5))}`.trim();
      } catch { /* search is optional; carry on without it */ }
    }
    // Real data (calendar, unread mail subjects, open tasks) only when this message asks for it.
    const want = dayWant(topic, mentioned ?? (ask ? ask.partner : null));
    let realCache: Promise<{ calendar: string; mail: string; tasks: string }> | null = null;
    const loadReal = () => (realCache ??= (async () => {
      const get = async (path: string) => { try { const r = await fetch(path, { signal: AbortSignal.timeout(10_000) }); return r.ok ? await r.json() : null; } catch { return null; } };
      const [cal, mail] = await Promise.all([want.calendar ? get("/api/calendar?days=7") : null, want.mail ? get("/api/mail") : null]);
      return {
        calendar: want.calendar ? (cal?.configured ? calendarText(cal.items ?? [], cal.tz ?? "UTC") : "Calendar: not connected (Settings → Calendar).") : "",
        mail: want.mail ? (mail?.configured ? mailText(mail.items ?? []) : "Mail: not connected (Settings → Mail).") : "",
        tasks: want.tasks ? tasksText(getWorkbench().todos) : "",
      };
    })());
    const realDataFor = async (id: AgentId): Promise<string | undefined> => {
      if (!wantsAny(want) || !mayUseRealData(personasNow, id)) return undefined;
      const day = want.calendar && want.mail && want.tasks;
      const r = await loadReal();
      // A mentioned job pal gets just its own data; "my day" gives everyone the lot.
      const parts = day ? [r.calendar, r.mail, r.tasks] : [id === "sage" || !mentioned ? r.calendar : "", id === "nova" || !mentioned ? r.mail : "", id === "byte" || !mentioned ? r.tasks : ""];
      const text = parts.filter(Boolean).join("\n\n");
      return text || undefined;
    };
    try {
      const seated = direct
        ? agents.filter((a) => a.id === partner)
        : agents.filter((a) => enabled.includes(a.id));
      const smartDone: { role: SmartRole; name: string; text: string }[] = [];
      const smartStarted = Date.now();
      const { turns, smartPlan } = planTurns({ seated, mode, direct, rounds, judgeOn, campaignActive: getCampaign().active, summary: !!extra?.summary, topic, smart: smartCfg });
      if (smartPlan) logClient("info", `Smart team: ${smartPlan.why}`);
      {
        for (const [turnIndex, { agent, round: currentRound, verdict, dmRole, role, side, summary }] of turns.entries()) {
          setRound(currentRound);
          if (controller.signal.aborted) return;
          const smartRole = smartPlan && role && (SMART_ROLES as string[]).includes(role) ? (role as SmartRole) : null;
          if (smartPlan && smartRole && smartDone.length) {
            if (!shouldRun({ agentId: agent.id, role: smartRole }, smartPlan, smartDone)) { logClient("info", `Smart team: ${smartRole} not needed`); continue; }
            if (outOfTime(smartStarted, Date.now(), smartCfg)) {
              transcript = [...transcript, { id: crypto.randomUUID(), role: "assistant", metadata: { agentId: "echo", characterMode: modeRef.current }, parts: [{ type: "text", text: `Smart team stopped: the ${smartCfg.maxSeconds}s time limit was reached. You can raise it in the Smart team settings.` }] }];
              setMessages(transcript);
              break;
            }
          }
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
            mode: dmRole || summary ? ("roundtable" as Mode) : direct ? ("direct" as Mode) : mode,
            ...(role ? { role } : {}),
            ...(smartRole ? { handoff: buildHandoff(smartDone) } : {}),
            ...(side ? { side } : {}),
            ...(summary ? { summary: true } : {}),
            ...(shortOn[mode] ? { short: true } : {}),
            campaign: dmRole ? { role: dmRole, context: campaignContext(getCampaign()) } : undefined,
            assistant: assistantRef.current || !!ask || !!mentioned,
            memoryContext: [projectNow ? projectBrief(projectNow, (pid) => agentName(pid as AgentId, false, false, "normal")) : "", promptContextFor(getWorkbench(), topic, { pal: agent.id, project: activeProject.get() || undefined, access: memoryAccess(personasNow, agent.id), boost: memBoost })].filter(Boolean).join("\n\n"),
            contextChars: engine.kind === "local" || engine.kind === "ollama" || engine.kind === "local-server" ? 6000 : 12000,
            agentNote: notesNow[agent.id] ?? "",
            ...(Object.keys(personasNow).length ? { personas: personasNow } : {}),
            docContext: docText,
            linuxContext: assistantRef.current ? await linuxContext(agent.id) : undefined,
            realData: await realDataFor(agent.id),
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
          const consume = async (stream: Awaited<ReturnType<typeof runLocal>>, via?: string) => {
            // The first token shows at once; after that the screen updates at most every 50 ms, and the last one is always delivered.
            const ui = createThrottle<RoomMessage[]>((list) => setMessages(list), 50);
            try {
            for await (const partial of readUIMessageStream<RoomMessage>({ stream, terminateOnError: true })) {
              if (controller.signal.aborted) break;
              answer = {
                ...partial,
                id: answerId,
                metadata: {
                  ...partial.metadata,
                  ...(via ? { via } : {}),
                  agentId: agent.id,
                  characterMode: turnMode,
                  assistant: assistantRef.current,
                  round: currentRound,
                  ...(verdict ? { verdict: true } : {}),
                  ...(side ? { side } : {}),
                  ...(role ? { role } : {}),
                  ...(summary ? { summary: true } : {}),
                  ...(dmRole ? { dm: dmRole } : {}),
                  elapsed: (performance.now() - began) / 1000,
                },
              };
              ui.push([...transcript, answer]);
            }
            } finally { ui.flush(); }
          };
          const lastUser = [...transcript].reverse().find((m) => m.role === "user");
          const blockPaid = isOverCap(engine.spendCapUsd, { inPerM: engine.customPriceIn, outPerM: engine.customPriceOut });
          const provider = providerForTurn(engine, direct && !dmRole ? Math.max(0, agents.findIndex((x) => x.id === agent.id)) : turnIndex, { agentId: agent.id, mode: dmRole || summary ? "roundtable" : direct ? "direct" : mode, text: lastUser ? messageText(lastUser) : "" }, blockPaid);
          // Try the provider; if it errors before any text, move on to the next one (free keys first, then paid "fallback" ones).
          const runChain = async (first: NonNullable<typeof provider>) => {
            const chain = orderByHealth([first, ...chainAfter(engine, first, blockPaid)], benchRef.current);
            const failures: string[] = [];
            let lastError: unknown;
            for (const p of chain) {
              try {
                await consume(await runCloud(p), providerLabel(p));
                const outText = answer ? messageText(answer) : "";
                const inChars = Math.min(transcript.reduce((n, m) => n + messageText(m).length, 0), requestBody.contextChars) + 2000;
                recordUsage({ kind: p.kind, model: p.model ?? (p.kind in freeModels ? freeModels[p.kind as keyof typeof freeModels] : p.kind), inTok: estimateTokens(inChars), outTok: estimateTokens(outText.length) });
                return;
              } catch (err) {
                if (controller.signal.aborted || (answer && messageText(answer).trim())) throw err;
                answer = undefined;
                failures.push(`${providerNames[p.kind]}: ${err instanceof Error ? err.message : String(err)}`);
                lastError = new Error(failures.join(" · "));
                benchProvider(benchRef.current, p, err);
                logClient("warn", `${p.kind} failed, skipping it for a few minutes and trying the next AI`, err);
              }
            }
            throw lastError;
          };
          // Your own Ollama didn't answer: skip it and use the next AI you have set up (Local-Only mode on the server still blocks cloud AI).
          const cloudFallback = async (why: unknown) => {
            if (controller.signal.aborted || (answer && messageText(answer).trim())) throw why;
            // Mail, calendar and task details never go to a cloud AI, so with those in the question there is nothing to fall back to.
            if (requestBody.realData) throw why;
            const rest = orderByHealth(cloudFallbackChain(engine, blockPaid), benchRef.current);
            if (!rest.length) throw new Error(`${why instanceof Error ? why.message : "Your local AI didn't answer."} No other AI is set up to take over: add a free key in AI engine settings (or switch the engine to Auto) and chats will fall back to it.`);
            answer = undefined;
            logClient("warn", "Ollama didn't answer, trying the next AI", why);
            const failures: string[] = [];
            let lastError: unknown = why;
            for (const p of rest) {
              try { await consume(await runCloud(p), providerLabel(p)); return; }
              catch (err) {
                if (controller.signal.aborted || (answer && messageText(answer).trim())) throw err;
                answer = undefined;
                failures.push(`${providerNames[p.kind]}: ${err instanceof Error ? err.message : String(err)}`);
                lastError = new Error(failures.join(" · "));
                benchProvider(benchRef.current, p, err);
              }
            }
            throw new Error(`${why instanceof Error ? why.message : "Your local AI didn't answer."} The cloud AIs didn't answer either (${lastError instanceof Error ? lastError.message : String(lastError)}).`);
          };
          const runOllama = async () =>
            consume(
              await ollamaTurn(
                await fetchPrompt(),
                { url: engine.ollamaUrl, model: engine.ollamaModel, maxTokens: replyTokens[engine.replyLength] },
                { agentId: agent.id, round: currentRound },
                controller.signal,
              ),
              `Ollama · ${engine.ollamaModel}`,
            );
          const ollamaKey = { kind: "ollama-server" as const, baseUrl: engine.ollamaUrl };
          await dispatchTurn({
            engine,
            provider,
            realData: !!requestBody.realData,
            blockPaid,
            hasWebGpu: hasWebGPU(),
            aborted: () => controller.signal.aborted,
            hasAnswer: () => !!(answer && messageText(answer).trim()),
            clearAnswer: () => { answer = undefined; },
            runChain,
            localChain: () => runChain(localServerProvider(engine, { agentId: agent.id, mode: dmRole || summary ? "roundtable" : direct ? "direct" : mode, text: lastUser ? messageText(lastUser) : "" })),
            runOllama,
            runBrowserModel: async () => consume(await runLocal(), "In-browser model"),
            cloudFallback,
            ollamaBenchedWithBackup: () => isBenched(benchRef.current, ollamaKey) && cloudFallbackChain(engine, blockPaid).length > 0,
            benchOllama: (err) => { if (!controller.signal.aborted && !isBenched(benchRef.current, ollamaKey)) benchProvider(benchRef.current, ollamaKey, err); },
            log: (level, msg, err) => logClient(level, msg, err),
          });
          if (answer && messageText(answer).trim()) {
            if (smartRole) {
              const said = messageText(answer);
              // A pal that only repeats what an earlier one said is dropped instead of cluttering the chat.
              if (isRepeat(said, smartDone.map((d) => d.text))) { logClient("info", `Smart team: dropped a repeated ${smartRole} reply`); setMessages(transcript); continue; }
              smartDone.push({ role: smartRole, name: agent.name, text: said });
            }
            transcript = [...transcript, answer];
            setMessages(transcript);
          } else if (!controller.signal.aborted)
            throw new Error("This agent returned no answer. The discussion has stopped.");
        }
      }
      if (!controller.signal.aborted) awardXp(Math.min(10, turns.length));
      // Keep a short run history for the active project so it can be resumed after a restart.
      if (!controller.signal.aborted && projectNow) {
        const lastReply = [...transcript].reverse().find((m) => m.role === "assistant" && m.metadata?.agentId !== "echo");
        updateProject(projectNow.name, (p) => logRun(p, { topic, mode: String(mode), pals: [...new Set(turns.map((t) => agentName(t.agent.id, false, false, "normal")))], gist: lastReply ? messageText(lastReply).replace(/\s+/g, " ").slice(0, 200) : "" }));
      }
      if (mode === "solve" && !direct && !controller.signal.aborted) celebrate();
    } catch (err) {
      if (!controller.signal.aborted) {
        const raw = err instanceof Error ? err.message : "The discussion could not continue.";
        logClient("error", "discussion failed", err);
        setError(friendlyError(raw, { engine: engine.kind, ollamaUrl: engine.ollamaUrl, ollamaModel: engine.ollamaModel }));
      }
    } finally {
      // Only the run that is still current may reset the room (Stop may already have freed it for a newer run).
      if (abortRef.current === controller || abortRef.current === null) {
        setRunning(false);
        setRunningMode(null);
        setSpeaking(null);
        runLock.current = false;
        abortRef.current = null;
      }
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
      case "mode": setMode(action.mode); showMode(action.mode); return say(command, `Conversation mode: ${action.mode === "direct" ? "one-on-one" : action.mode}.`);
      case "rounds": setRounds(action.rounds); return say(command, `Pals will debate for ${action.rounds} round${action.rounds === 1 ? "" : "s"}.`);
      case "theme": setCharacterMode(action.theme); return say(command, `Theme switched to ${action.theme}.`);
      case "assistant": setAssistantMode(action.on); return say(command, `Assistant Mode ${action.on ? "on" : "off"}.`);
      case "remember":
        if (action.pal) {
          updateWorkbench((w) => addPalMemory(w, action.pal as string, action.text));
          return say(command, `Got it — only ${agentName(action.pal, false, false, modeRef.current)} will remember: “${action.text}”.`);
        }
        updateWorkbench((w) => ({ ...w, memories: addEntry(w.memories, action.text) }));
        return say(command, `Got it — every pal will remember: “${action.text}”.`);
      case "memories": {
        const w = getWorkbench();
        const shared = listText("The pals remember:", w.memories, "Nothing remembered for everyone yet. Try `/remember I run Unraid with a 3080`.");
        const mine = Object.entries(w.pal ?? {}).filter(([, l]) => l.length).map(([id, l]) => listText(`Only ${agentName(id as AgentId, false, false, modeRef.current)} knows (/forget @${id} N):`, l, ""));
        return say(command, [shared, ...mine].join("\n\n"));
      }
      case "forget": {
        if (action.pal) {
          const before = getWorkbench().pal?.[action.pal]?.length ?? 0;
          updateWorkbench((w) => removePalMemory(w, action.pal as string, action.target));
          const gone = before - (getWorkbench().pal?.[action.pal]?.length ?? 0);
          return say(command, gone ? `Forgotten (${gone}).` : `${agentName(action.pal, false, false, modeRef.current)} has no memory with that number. /memories shows them.`);
        }
        const before = getWorkbench().memories.length;
        updateWorkbench((w) => ({ ...w, memories: action.target === "all" ? [] : removeAt(w.memories, action.target) }));
        const removed = before - getWorkbench().memories.length;
        return say(command, removed ? `Forgotten (${removed}).` : "There's no memory with that number. Use /memories to see them.");
      }
      case "prompt": {
        const saved = getPrompts();
        if (action.op === "list") return say(command, promptList(saved));
        if (action.op === "save") {
          const r = addPrompt(saved, action.name, action.text, crypto.randomUUID().slice(0, 8));
          if (!r.ok) return say(command, r.error);
          setPrompts(r.list);
          return say(command, `Saved. Use it any time with /prompt ${findPrompt(r.list, action.name)?.name ?? action.name}.`);
        }
        if (action.op === "remove") {
          const hit = saved.find((p) => p.name === findPrompt(saved, action.name)?.name);
          if (!hit) return say(command, BUILT_IN_PROMPTS.some((b) => findPrompt([b], action.name)) ? "Built-in prompts can't be removed." : "No saved prompt with that name. /prompt shows them.");
          setPrompts(saved.filter((p) => p !== hit));
          return say(command, `Removed “${hit.name}”.`);
        }
        const hit = findPrompt([...BUILT_IN_PROMPTS, ...saved], action.name);
        if (!hit) return say(command, `No prompt called “${action.name}”. /prompt lists them.`);
        setTopic(`${hit.text}${action.text}`);
        inputRef.current?.focus();
        return;
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
      case "logfile": void downloadRecentLog(action.seconds, command); return;
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
      case "lowpower": {
        const on = action.on ?? !lowPower.get();
        lowPower.set(on);
        return say(command, on ? "Low-power mode is on: background timers are slower, decorative animations are paused and the app polls less often. Replies and features are unchanged. /lowpower off turns it off." : "Low-power mode is off.");
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
      case "update": {
        void (async () => {
          try {
            const res = await fetch("/api/update", { method: "POST" });
            const json = (await res.json()) as { text?: string; error?: string; enabled?: boolean };
            say(command, json.enabled === false ? "Update checks are turned off (UPDATE_CHECK=0)." : json.text ?? json.error ?? "No answer.");
          } catch { say(command, "I couldn't reach the server."); }
        })();
        return;
      }
      case "review": void briefCmd(command, action.send, "/api/weekly"); return;
      case "backup": void backupCmd(command, action.now, action.op ? { op: action.op, name: action.name ?? "", confirm: !!action.confirm } : undefined); return;
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
  function editAndRetry(target: Mode, id: string) {
    const list = chats[target];
    const index = list.findIndex((m) => m.id === id);
    if (index < 0 || running) return;
    setMode(target);
    setDraftIn(target, messageText(list[index]!));
    setMessagesIn(target, list.slice(0, index));
    inputEls.current[target]?.focus();
  }
  /** Start a fresh chat (and a fresh saved-chat record). */
  function newChat() {
    if (runLock.current) return;
    setMessages([]); setRound(0); setError(""); bumpFork(mode);
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
  async function backupCmd(command: string, now: boolean, extra?: { op: string; name: string; confirm: boolean }) {
    try {
      const res = await fetch("/api/backup", extra ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(extra) } : { method: now ? "POST" : "GET" });
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
  function regenerate(target: Mode) {
    if (running) return;
    const list = chats[target];
    const at = list.map((m) => m.role).lastIndexOf("user");
    const last = list[at];
    if (at < 0 || !last) return;
    setMode(target);
    setRegen({ text: messageText(last), mode: target });
    setMessagesIn(target, list.slice(0, at));
  }
  /** Continue from an earlier message as a separate saved chat. */
  function branchFrom(target: Mode, id: string) {
    const list = chats[target];
    const at = list.findIndex((m) => m.id === id);
    if (at < 0 || running) return;
    setMessagesIn(target, list.slice(0, at + 1));
    bumpFork(target);
  }
  /** Problem solving: put the plan's numbered steps on the Tasks list. */
  function addStepsToTasks(m: RoomMessage) {
    const steps = extractSteps(messageText(m));
    if (!steps.length) return;
    updateWorkbench((w) => ({ ...w, todos: steps.reduce((list, step) => addTodo(list, step), w.todos) }));
    say("Add steps to Tasks", `Added ${steps.length} step${steps.length === 1 ? "" : "s"} to your Tasks.`);
  }
  useEffect(() => {
    if (regen === null || running) return;
    const { text, mode: target } = regen;
    setRegen(null);
    void startRef.current?.(undefined, text, target);
  }, [regen, running]); // eslint-disable-line react-hooks/exhaustive-deps
  function download(name: string, text: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = url; link.download = name; link.click();
    URL.revokeObjectURL(url);
  }
  async function downloadRecentLog(seconds: number, command: string) {
    const nowMs = Date.now();
    const server = await fetch("/api/debuglog").then((r) => (r.ok ? r.text() : "")).catch(() => "");
    const report = buildRecentReport({
      app: `${__APP_VERSION__} · ${__APP_COMMIT__}`, seconds, nowMs, server, client: clientLog(),
      context: [`engine: ${engine.kind}${engine.kind.includes("ollama") ? ` (${engine.ollamaUrl} · ${engine.ollamaModel})` : ""}`, `last error shown: ${error || "none"}`],
    });
    download(`pixel-pals-log-${new Date(nowMs).toISOString().replace(/[:.]/g, "-").slice(0, 19)}.txt`, report, "text/plain");
    const empty = report.includes("(no server events in the last") && report.includes("(nothing logged in this browser");
    say(command, empty ? `Downloaded, but nothing was logged in the last ${seconds} seconds. If the problem happened earlier, try @log 60.` : `Downloaded the log lines from the last ${seconds} seconds.`);
  }
  function exportSettings(includeKeys: boolean) {
    saverRef.current?.flush(); download(includeKeys ? "pixel-pals-backup-with-keys.json" : "pixel-pals-backup.json", JSON.stringify(buildBackup(localStorage, includeKeys), null, 2), "application/json");
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
  // Recent saved chats show up in the command palette (loaded when it opens).
  const [recentChats, setRecentChats] = useState<SavedDiscussion[]>([]);
  useEffect(() => {
    if (!paletteOpen) return;
    let stop = false;
    void listLocalOrServer().then((rows) => { if (!stop) setRecentChats([...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12)); }).catch(() => undefined);
    return () => { stop = true; };
  }, [paletteOpen]);
  const palette: PaletteAction[] = [
    ...recentChats.map((row): PaletteAction => ({ id: `chat-open-${row.id}`, group: "Saved chats", label: `${modeLabel[row.mode as Mode] ?? row.mode}: ${row.title.slice(0, 60)}`, keywords: "open saved chat history", run: () => { showMode(row.mode); setMode(row.mode); window.setTimeout(() => window.dispatchEvent(new CustomEvent("pixelpals:open-chat", { detail: row })), 50); } })),
    { id: "win-room", group: "Windows", label: "Toggle Pixel room", run: () => setRoomOpen((v) => !v) },
    { id: "win-tools", group: "Windows", label: "Toggle Work tools", run: () => setToolsOpen((v) => !v) },
    { id: "win-rec", group: "Windows", label: "Toggle Recorder", run: () => setRecorderOpen((v) => !v) },
    { id: "win-notes", group: "Windows", label: "Open Notes, memories, documents & pal instructions", keywords: "memories todos files", run: () => setNotesOpen(true) },
    { id: "win-search", group: "Windows", label: "Search everything (chats, notes, tasks)", keywords: "find look up history", run: () => setSearchOpen(true) },
    ...[...BUILT_IN_PROMPTS, ...savedPrompts].map((p: SavedPrompt) => ({ id: `prompt-${p.id}`, group: "Prompts", label: `Prompt: ${p.name}`, keywords: p.text.slice(0, 80), run: () => { setTopic(p.text); inputRef.current?.focus(); } })),
    { id: "win-setup", group: "Windows", label: "Open Settings (connect things, test connections)", keywords: "settings integrations status connect test env", run: () => setSetupOpen(true) },
    { id: "win-hide", group: "Windows", label: "Hide or show secrets (for screenshots)", keywords: "privacy blur mask secrets token screenshot", run: () => setHideSecrets(!getHideSecrets()) },
    { id: "win-today", group: "Windows", label: "Open Today (weather, calendar, mail, tasks)", keywords: "morning overview agenda day", run: () => setTodayOpen(true) },
    { id: "win-tasks", group: "Windows", label: "Open Tasks and reminders", keywords: "todo to-do remind reminder checklist", run: () => setTasksOpen(true) },
    { id: "win-calendar", group: "Windows", label: "Open Calendar (next 7 days)", keywords: "schedule events agenda ics google outlook", run: () => setCalendarOpen(true) },
    { id: "win-mail", group: "Windows", label: "Open Mail (unread)", keywords: "email inbox imap gmail outlook", run: () => setMailOpen(true) },
    { id: "win-docs", group: "Windows", label: "Open Documents (PDF and Excel viewer)", keywords: "pdf excel xlsx csv viewer file spreadsheet", run: () => setDocsOpen(true) },
    { id: "win-fun", group: "Windows", label: "Open Fun (Dungeon Master campaign)", keywords: "dnd rpg adventure dice dungeon master games", run: () => setFunOpen(true) },
    { id: "win-reset", group: "Windows", label: "Reset layout", run: () => { setResetVersion((v) => v + 1); setRoomOpen(true); resetModes(); setToolsOpen(false); setNotesOpen(false); setFunOpen(false); setCalendarOpen(false); setMailOpen(false); setTodayOpen(false); setTasksOpen(false); setSetupOpen(false); setSearchOpen(false); } },
    { id: "chat-new", group: "Chat", label: "New chat", hint: "Ctrl+Shift+O", run: newChat },
    { id: "chat-saved", group: "Chat", label: "Saved chats", keywords: "history search pin rename", run: () => { setConversationOpen(true); setHistoryRequest((v) => v + 1); } },
    { id: "chat-regen", group: "Chat", label: "Regenerate the last answer", run: () => regenerate(mode) },
    { id: "chat-export", group: "Chat", label: "Export this chat as Markdown", run: () => exportChat(mode) },
    { id: "chat-stop", group: "Chat", label: "Stop the discussion", hint: "Esc", run: stop },
    { id: "chat-compare", group: "Chat", label: "Compare models (blind test)", run: () => { setCompareQuestion(""); setCompareOpen(true); } },
    ...modeNames.map((m): PaletteAction => ({ id: `mode-${m}`, group: "Mode", label: `Mode: ${m}`, run: () => { setMode(m as Mode); showMode(m as Mode); } })),
    ...themeNames.map((t): PaletteAction => ({ id: `theme-${t}`, group: "Theme", label: `Theme: ${t}`, run: () => setCharacterMode(t as CharacterMode) })),
    { id: "next", group: "Chat", label: "What should we watch next? (Trakt list)", keywords: "trakt list watchlist movie show tv", run: () => void trakt("", "/next", "") },
    { id: "lowpower-toggle", group: "View", label: "Low-power mode: on / off", keywords: "battery save power phone animation", run: () => runSlash({ type: "lowpower", on: null }, "/lowpower") },
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
  const tooFewFor = (m: Mode) => m !== "direct" && !resolveMention(drafts[m], characterMode) && enabled.length < 2;
  function exportChat(target: Mode = mode) {
    const text = chats[target]
      .map(
        (m) =>
          `### ${m.metadata?.agentId ? agentName(m.metadata?.agentId, m.metadata?.characterMode === "hellraiser", m.metadata?.characterMode === "horror", m.metadata?.characterMode ?? characterMode) : "You"}\n\n${messageText(m)}`,
      )
      .join("\n\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `pixel-pals-${target}-chat.md`;
    link.click();
    URL.revokeObjectURL(url);
  }
  const suggestions_ = slashSuggestions(topic);
  const activeAgent = agents.find((a) => a.id === speaking);
  const lastMessage = messages[messages.length - 1];
  // Rows are memoised; this one object keeps their click handlers current without changing identity.
  Object.assign(rowActions.current, { regenerate, branchFrom, editAndRetry, addStepsToTasks, speak: (items: { id: string; text: string; agentId: string }[]) => void speakItems(items), stopSpeaking });
  const liveText =
    running && lastMessage?.metadata?.agentId === speaking ? messageText(lastMessage).trim() : "";
  const bubbleText = liveText.length > 70 ? `…${liveText.slice(-70)}` : liveText;
  /** One window per conversation mode, each with its own chat and message box. */
  function renderModeWindow(wm: Mode) {
    const msgs = chats[wm];
    const busyHere = running && runningMode === wm;
    const icons: Record<Mode, ReactNode> = { roundtable: <Users className="size-4" />, broadcast: <Radio className="size-4" />, direct: <MessageSquare className="size-4" />, solve: <Wrench className="size-4" />, debate: <Swords className="size-4" />, smart: <Workflow className="size-4" /> };
    return (
      <WorkspaceWindow id={`mode-${wm}`} className={cn("window-conversation window-mode", `window-mode-${wm}`, wm === mode && "window-mode-active")} title={modeLabel[wm]} icon={icons[wm]} open={openModes[wm]} onClose={() => setOpenModes((o) => ({ ...o, [wm]: false }))} resetVersion={resetVersion}>
        <section className="conversation-panel" onPointerDownCapture={() => { if (mode !== wm) setMode(wm); }}>
          <div className="conversation-header">
            <h2>
              <MessageSquare size={18} />
              {modeLabel[wm]}
              <span className="message-count">
                {msgs.filter((m) => m.role === "assistant").length}
              </span>
            </h2>
            <div>
              <Button
                variant="ghost"
                size="icon"
                title="Download conversation"
                aria-label="Download conversation"
                onClick={() => exportChat(wm)}
                disabled={!msgs.length}
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
                    disabled={running || !msgs.length}
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
                      setMessagesIn(wm, []);
                      setForkSignals((f) => ({ ...f, [wm]: f[wm] + 1 }));
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
          <div className="mobile-modes" role="tablist" aria-label="Conversation mode">
            {ALL_MODES.map((m) => (
              <button key={m} type="button" role="tab" aria-selected={m === wm} disabled={running && m !== wm} onClick={() => { setMode(m); setOpenModes(perMode((k) => k === m)); }}>{modeLabel[m]}</button>
            ))}
          </div>
          <SavedDiscussions perMode openRequest={wm === mode ? historyRequest : 0} forkSignal={forkSignals[wm]} messages={msgs} mode={wm} theme={characterMode} running={running} onOpen={(items, theme, discussionMode) => { setMessagesIn(wm, items); setCharacterMode(theme); setMode(wm); setRound(0); setError(""); void discussionMode; }} />
          <div className="conversation-subhead">
            <span className="status-dot" />
            {busyHere
              ? `${activeAgent ? `${agentName(activeAgent.id, hell, horror, characterMode)} is` : horror ? "The icons are" : hell ? "The Order is" : "Your pals are"} thinking…`
              : msgs.length
                ? "The floor is yours"
                : "The room is open"}
            <span title={modeHelp[wm]}>{modeLabel[wm].toUpperCase()}</span>
          </div>
          <Conversation className="chat-log">
            <ConversationContent
              className={cn("chat-content", !msgs.length && "empty-content")}
            >
              {!msgs.length ? (
                <div className="chat-empty">
                  <div className="empty-pals">
                    <PixelCharacter id="byte" />
                    <PixelCharacter id="nova" />
                    <PixelCharacter id="sage" />
                  </div>
                  <div className="pixel-speech">···</div>
                  <h3>
                    {modeLabel[wm]}
                  </h3>
                  <p>{modeHelp[wm]}</p>
                  <span className="empty-divider" />
                  <span className="empty-caption">FOUR PERSONALITIES. ENDLESS POSSIBILITIES.</span>
                </div>
              ) : (
                <>
                {(() => { const sl = chatSlice(msgs, shownCount[wm] ?? 0); return sl.hidden > 0 ? (
                  <button type="button" className="show-earlier" onClick={() => setShownCount((c) => ({ ...c, [wm]: msgs.length - sl.hidden + 60 }))}>Show {Math.min(60, sl.hidden)} earlier messages ({sl.hidden} hidden to keep the page fast)</button>
                ) : null; })()}
                {chatSlice<RoomMessage>(msgs, shownCount[wm] ?? 0).items.map((m) => (
                  <MessageRow key={m.id} m={m} wm={wm} characterMode={characterMode} running={running} isLast={m.id === lastMessage?.id} speaking={speakingMessage === m.id} canSpeak={canSpeak} desktopApp={desktopApp} act={rowActions.current} />
                ))}
                </>
              )}
              {busyHere && (
                <div className="thinking-row">
                  {speaking && <PixelCharacter id={speaking} animated />}
                  <Shimmer>{`${activeAgent ? `${agentName(activeAgent.id, hell, horror, characterMode)} is` : horror ? "The icons are" : hell ? "The Order is" : "Your pals are"} thinking…`}</Shimmer>
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
              {busyHere
                ? `ROUND ${round} / ${rounds}`
                : round && runningMode === wm
                  ? `${round} ROUND${round > 1 ? "S" : ""} COMPLETE`
                  : "READY TO START"}
            </span>
            <span>
              <Check size={12} /> AUTO-SAVED
            </span>
            <UsageMeter />
          </footer>
                  <section className="workspace-composer" aria-label={`${modeLabel[wm]} message box`}>
            <button type="button" className="focus-options-btn" aria-expanded={focusOptions} onClick={() => setFocusOptions((v) => !v)}>{focusOptions ? "Hide options" : "Options"}</button>
            <div className="topic-section">
              {wm === mode && suggestions_.length > 0 && (
                <ul className="slash-menu" role="listbox" aria-label="Slash commands">
                  {suggestions_.slice(0, 6).map((item, i) => (
                    <li key={item.insert} role="option" aria-selected={i === 0}>
                      <button type="button" onClick={() => { setDraftIn(wm, item.insert); inputEls.current[wm]?.focus(); }}>
                        <code>{item.label}</code>
                        {item.description && <span>{item.description}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <PromptInput onSubmit={() => start(undefined, undefined, wm)} className="topic-composer">
                <PromptInputTextarea
                  ref={(el) => { inputEls.current[wm] = el; }}
                  aria-label={`${modeLabel[wm]} message`}
                  placeholder={modePlaceholder[wm]}
                  value={drafts[wm]}
                  onFocus={() => setMode(wm)}
                  onChange={(e) => {
                    recall.current = freshRecall;
                    setMode(wm);
                    setDraftIn(wm, e.target.value);
                  }}
                  onKeyDown={onComposerKeyDown}
                  className="min-h-12"
                  disabled={running}
                />
                <PromptInputFooter>
                  <span className="composer-label">
                    <MessageSquare size={13} /> {modeHelp[wm]}
                  </span>
                  <MicButton disabled={running} onText={(t) => { setDraftIn(wm, (cur) => (cur.trim() ? `${cur.trim()} ${t}` : t)); inputEls.current[wm]?.focus(); }} />
                  <PromptInputSubmit
                    aria-label={busyHere ? "Stop" : "Send"}
                    status={busyHere ? "streaming" : "ready"}
                    onStop={stop}
                    disabled={running ? !busyHere : !drafts[wm].trim() || (!characterModeCommand(drafts[wm]) && !drafts[wm].trim().startsWith("/") && tooFewFor(wm)) || !ready}
                  />
                </PromptInputFooter>
              </PromptInput>
              <div className="suggestions">
                {modeSuggestions[wm].map((text) => (
                  <Button key={text} variant="ghost" size="sm" disabled={running} onClick={() => { setMode(wm); setDraftIn(wm, text); inputEls.current[wm]?.focus(); }}>
                    {text}
                    <ArrowUpRight size={12} />
                  </Button>
                ))}
              </div>
            </div>
            <div className="launch-controls">
              {wm === "direct" && (
                <div>
                  <span className="control-label">TALK WITH</span>
                  <select className="partner-select" aria-label="Pal to talk with" value={partner} disabled={running} onChange={(e) => setPartner(e.target.value as AgentId)}>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {agentName(a.id, hell, horror, characterMode)} ({palEngineLabel(engine, agents.findIndex((x) => x.id === a.id))})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {wm !== "direct" && (
                <div>
                  <span className="control-label">ROUNDS</span>
                  <div className="round-stepper">
                    <Button variant="ghost" size="icon" aria-label="Fewer rounds" disabled={running || rounds <= 1} onClick={() => setRounds(rounds - 1)}><Minus /></Button>
                    <span>{rounds}</span>
                    <Button variant="ghost" size="icon" aria-label="More rounds" disabled={running || rounds >= 5} onClick={() => setRounds(rounds + 1)}><Plus /></Button>
                  </div>
                </div>
              )}
              <label className="judge-toggle" title="Replies of 1–3 sentences: faster and cheaper">
                <input type="checkbox" checked={shortOn[wm]} disabled={running} onChange={(e) => setShort(wm, e.target.checked)} /> Short answers
              </label>
              {wm === "smart" && (
                <details className="judge-toggle" title="Smart team settings">
                  <summary>Team settings</summary>
                  <div className="grid gap-1 p-1 text-xs">
                    <label>Most pals per answer <input type="number" min={1} max={6} value={smartCfg.maxTurns} disabled={running} onChange={(e) => setSmartCfg({ maxTurns: Number(e.target.value) })} style={{ width: "3.5rem" }} /></label>
                    <label>Time limit (seconds) <input type="number" min={20} max={900} value={smartCfg.maxSeconds} disabled={running} onChange={(e) => setSmartCfg({ maxSeconds: Number(e.target.value) })} style={{ width: "4.5rem" }} /></label>
                    <label><input type="checkbox" checked={smartCfg.singleOnly} disabled={running} onChange={(e) => setSmartCfg({ singleOnly: e.target.checked })} /> Always use just one pal</label>
                    {SMART_ROLES.map((r) => (
                      <label key={r} className="capitalize">{r}{" "}
                        <select value={smartCfg.assign[r] ?? "auto"} disabled={running} onChange={(e) => setSmartCfg({ assign: { ...smartCfg.assign, [r]: e.target.value } })}>
                          <option value="auto">auto</option>
                          {agents.filter((a) => enabled.includes(a.id)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </label>
                    ))}
                  </div>
                </details>
              )}
              {wm === "broadcast" && (
                <label className="judge-toggle" title="After everyone answers, one pal ranks the answers and picks the best">
                  <input type="checkbox" checked={judgeOn} disabled={running} onChange={(e) => setJudgeOn(e.target.checked)} /> Judge picks the best
                </label>
              )}
              {msgs.length > 0 && !running && (
                <>
                  <Button variant="ghost" size="sm" title="Take it one step further" onClick={() => void start(undefined, "Keep going: build on that and take it one step further.", wm)}>Keep going</Button>
                  <Button variant="ghost" size="sm" title="Short summary of this chat" onClick={() => void start(undefined, "Summarize this chat.", wm, { summary: true })}>Summarize</Button>
                </>
              )}
              <Button
                className="start-button"
                onClick={busyHere ? stop : () => void start(undefined, undefined, wm)}
                disabled={running ? !busyHere : !drafts[wm].trim() || (!characterModeCommand(drafts[wm]) && tooFewFor(wm)) || !ready}
              >
                {busyHere ? <Square /> : <Play fill="currentColor" />}
                {busyHere ? "Stop" : wm === "direct" ? "Send" : wm === "debate" ? "Start debate" : wm === "solve" ? "Solve it" : wm === "smart" ? "Ask the team" : wm === "broadcast" ? "Ask everyone" : "Start discussion"}
              </Button>
            </div>
            {tooFewFor(wm) && <p className="validation-note">Invite at least two pals to start.</p>}
          </section>
        </section>
      </WorkspaceWindow>
    );
  }
  return (
    <div className={cn("app-shell modular-workspace", sidebarCompact && "sidebar-collapsed", focusMode && "focus-mode", focusMode && focusOptions && "focus-options")}>
      <header className="app-header">
        <a href="/" className="brand">
          <span className="brand-icon">
            <img src={mascot} width={34} height={34} alt="Pixel Pals mascot" draggable={false} className="brand-mascot" />
          </span>
          <span>
            pixel<span className="text-primary">pals</span>
            <span className="brand-chat"> / chat</span>
          </span>
        </a>
        <Button variant="outline" size="sm" className="just-start-header" aria-label="Just Start" onClick={() => beginFocusTask()} title="Just Start: one small action at a time"><Sparkles className="size-4" /> <span>Just Start</span></Button>
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
          {canSpeak && (
            <Button variant="ghost" size="sm" className="engine-trigger" aria-pressed={voice.auto} title={voice.auto ? "Replies are read aloud. Click to turn off." : "Read replies aloud"} onClick={() => { if (voice.auto) stopSpeaking(); setVoiceSettings({ auto: !voice.auto }); }}>
              {voice.auto ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />} Voice
            </Button>
          )}
          <Button variant="ghost" size="sm" className="engine-trigger" aria-pressed={setupOpen} title="Settings: connect things and test them" onClick={() => setSetupOpen((value) => !value)}><Settings2 className="size-4" /> Settings</Button>
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
          <Button variant="ghost" size="sm" className="engine-trigger mobile-only" onClick={() => window.location.assign("/work")}><Wrench className="size-4" /> Work tools</Button>
          <Button variant="ghost" size="sm" className="engine-trigger mobile-only" onClick={() => setLogOpen(true)}><Bug className="size-4" /> Debug log</Button>
          <Button variant="ghost" size="sm" className="engine-trigger mobile-only" onClick={() => { setCompareQuestion(""); setCompareOpen(true); }}><Scale className="size-4" /> Compare models</Button>
          <Button variant="ghost" size="sm" className="engine-trigger mobile-only" onClick={() => { setResetVersion((value) => value + 1); setRoomOpen(true); resetModes(); setToolsOpen(false); setNotesOpen(false); setFunOpen(false); setCalendarOpen(false); setMailOpen(false); setTodayOpen(false); setTasksOpen(false); setSetupOpen(false); setSearchOpen(false); }}><LayoutGrid className="size-4" /> Reset layout</Button>
        </div>
      </header>
      <button type="button" className="mobile-strip" onClick={() => setRoomOpen((v) => !v)}>
        <span className={cn("status-dot", running && "pulse-dot")} />
        {running && activeAgent ? `${agentName(activeAgent.id, hell, horror, characterMode)} ${bubbleText ? "is talking…" : "is thinking…"}` : "Pals are ready"}
        <span className="mobile-strip-hint">tap for the room</span>
      </button>
      <TaskSync />
      <JustStartDialog open={justStartOpen} onOpenChange={setJustStartOpen} initialTask={justStartTask} />
      {!desktopApp && <UpdateBanner />}
      <UnraidBanner onDiagnose={() => void serverCheck("/diagnose", true)} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} actions={palette} />
      <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => { void importSettings(e.target.files?.[0]); e.target.value = ""; }} />
      <DebugLogDialog open={logOpen} onOpenChange={setLogOpen} context={[`engine: ${engine.kind}${engine.kind.includes("ollama") ? ` (${engine.ollamaUrl} · ${engine.ollamaModel})` : ""}`, `theme: ${characterMode} · mode: ${mode} · rounds: ${rounds}`, `messages in chat: ${messages.length}`, `last error shown: ${error || "none"}`]} />
      <CompareDialog open={compareOpen} onOpenChange={setCompareOpen} initialQuestion={compareQuestion} />
      <SeerrDialog query={seerrQuery} onClose={() => setSeerrQuery(null)} onRequested={(summary) => say(`@seerr ${seerrQuery?.title ?? ""}${seerrQuery?.is4k ? " 4k" : ""}`.trim(), summary)} />
      <div className="workspace-frame">
        <nav className="workspace-sidebar" aria-label="Workspace">
          <div className="sidebar-heading"><span>WORKSPACE</span><Button variant="ghost" size="icon" aria-label={sidebarCompact ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCompact ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setSidebarCompact((value) => !value)}>{sidebarCompact ? <PanelLeftOpen /> : <PanelLeftClose />}</Button></div>
          {ALL_MODES.map((m) => (
            <Button key={m} variant="ghost" className="sidebar-item" title={`${modeLabel[m]}: ${modeHelp[m]}`} aria-pressed={openModes[m]} onClick={() => { toggleMode(m); setMode(m); }}>{m === "roundtable" ? <Users /> : m === "broadcast" ? <Radio /> : m === "direct" ? <MessageSquare /> : m === "solve" ? <Wrench /> : m === "debate" ? <Swords /> : <Workflow />}<span>{modeLabel[m]}</span><i className={openModes[m] ? "status-dot" : ""} /></Button>
          ))}
          <Button variant="ghost" className="sidebar-item" title="Pixel room" aria-pressed={roomOpen} onClick={() => setRoomOpen((value) => !value)}><Users /><span>Pixel room</span><i className={roomOpen ? "status-dot" : ""} /></Button>
          <Button variant="ghost" className="sidebar-item" title="Just Start: help me start a task" onClick={() => beginFocusTask()}><Sparkles /><span>Just Start</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Today: weather, calendar, mail, tasks and a pick" aria-pressed={todayOpen} onClick={() => setTodayOpen((value) => !value)}><Sun /><span>Today</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Notes and memories" aria-pressed={notesOpen} onClick={() => setNotesOpen((value) => !value)}><ListTodo /><span>Notes</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Fun: Dungeon Master campaigns" aria-pressed={funOpen} onClick={() => setFunOpen((value) => !value)}><Gamepad2 /><span>Fun</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Tasks and reminders" aria-pressed={tasksOpen} onClick={() => setTasksOpen((value) => !value)}><CheckSquare /><span>Tasks</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Calendar: your next 7 days" aria-pressed={calendarOpen} onClick={() => setCalendarOpen((value) => !value)}><CalendarDays /><span>Calendar</span></Button>
          {addons.filter((a) => a.enabled && a.window).map((a) => (
            <Button key={a.id} variant="ghost" className="sidebar-item" title={`Add-on: ${a.name}`} aria-pressed={addonOpen === a.id} onClick={() => setAddonOpen((v) => (v === a.id ? null : a.id))}><Puzzle /><span>{a.window?.title ?? a.name}</span></Button>
          ))}
          <Button variant="ghost" className="sidebar-item" title="Mail: unread subjects" aria-pressed={mailOpen} onClick={() => setMailOpen((value) => !value)}><Mail /><span>Mail</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Documents: read PDF and Excel files" aria-pressed={docsOpen} onClick={() => setDocsOpen((value) => !value)}><FileText /><span>Documents</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Work tools, recorder, compare models and the debug log" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}><ChevronDown className={moreOpen ? "" : "-rotate-90"} /><span>More</span></Button>
          {moreOpen && <>
          <Button variant="ghost" className="sidebar-item" title="Work tools" aria-pressed={toolsOpen} onClick={() => setToolsOpen((value) => !value)}><Wrench /><span>Work tools</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Open betas and playtests" aria-pressed={playtestsOpen} onClick={() => setPlaytestsOpen((value) => !value)}><FlaskConical /><span>Playtests</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Recorder" aria-pressed={recorderOpen} onClick={() => setRecorderOpen((value) => !value)}><Mic /><span>Recorder</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Blind model comparison" onClick={() => { setCompareQuestion(""); setCompareOpen(true); }}><Scale /><span>Compare models</span></Button>
          <Button variant="ghost" className="sidebar-item" title="Copy a bug report for Claude" onClick={() => setLogOpen(true)}><Bug /><span>Debug log</span></Button>
          </>}
          <div className="sidebar-divider" />
          <WorkspaceLayoutMenu onShow={(ids) => {
            const show = (id: string) => ids.includes(id);
            setOpenModes(perMode((m) => show(`mode-${m}`)));
            const selectedMode = ALL_MODES.find((m) => show(`mode-${m}`));
            if (selectedMode) setMode(selectedMode);
            setRoomOpen(show("room"));
            setTodayOpen(show("today"));
            setMailOpen(show("mail"));
            setDocsOpen(show("documents"));
            setToolsOpen(show("tools"));
            setSetupOpen(show("setup"));
            setNotesOpen(show("notes"));
            setTasksOpen(show("tasks"));
            setCalendarOpen(show("calendar"));
            setFunOpen(show("fun"));
            setRecorderOpen(show("recorder"));
            setPlaytestsOpen(show("playtests"));
            setAddonOpen(addons.find((a) => show(`addon-${a.id}`))?.id ?? null);
            setSearchOpen(show("search"));
            setMoreOpen(show("tools") || show("setup"));
            setSidebarCompact(false);
          }} />
          <Button variant="ghost" className="sidebar-item" title="Reset layout" onClick={() => { setResetVersion((value) => value + 1); setRoomOpen(true); resetModes(); setToolsOpen(false); setNotesOpen(false); setFunOpen(false); setCalendarOpen(false); setMailOpen(false); setTodayOpen(false); setTasksOpen(false); setSetupOpen(false); setSearchOpen(false); }}><LayoutGrid /><span>Reset layout</span></Button>
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
            <RoomLive active={roomOpen} running={running} theme={characterMode} onChatter={setChatter} onOpen={(t) => { if (t === "today") setTodayOpen(true); else if (t === "mail") setMailOpen(true); else if (t === "calendar") setCalendarOpen(true); else if (t === "tasks") setTasksOpen(true); else setSetupOpen(true); }} />
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
                  !running && chatter === a.id && "is-chatting",
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
                <Users size={13} /> {modeLabel[mode as Mode]}
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
            {ALL_MODES.map((wm) => <Fragment key={wm}>{renderModeWindow(wm)}</Fragment>)}
            <WorkspaceWindow id="tools" title="Show Services tools" icon={<Wrench className="size-4" />} open={toolsOpen} onClose={() => setToolsOpen(false)} resetVersion={resetVersion}>
              {toolsSeen && <Suspense fallback={<div className="p-4 text-sm opacity-70" role="status">Loading…</div>}><ShowServicesTools /></Suspense>}
            </WorkspaceWindow>
            <WorkspaceWindow id="playtests" title="Betas & playtests" icon={<FlaskConical className="size-4" />} open={playtestsOpen} onClose={() => setPlaytestsOpen(false)} resetVersion={resetVersion}>
              {playtestsSeen && <Suspense fallback={<div className="p-4 text-sm opacity-70" role="status">Loading…</div>}><PlaytestsPanel /></Suspense>}
            </WorkspaceWindow>
            <WorkspaceWindow id="recorder" title="Echo’s recorder" icon={<Mic className="size-4" />} open={recorderOpen} onClose={() => setRecorderOpen(false)} resetVersion={resetVersion}>
              <MicRecorder onClose={() => setRecorderOpen(false)} />
            </WorkspaceWindow>
            <WorkspaceWindow id="notes" title="Notes" icon={<ListTodo className="size-4" />} open={notesOpen} onClose={() => setNotesOpen(false)} resetVersion={resetVersion}>
              <NotesPanel />
            </WorkspaceWindow>
            <WorkspaceWindow id="fun" title="Fun" icon={<Gamepad2 className="size-4" />} open={funOpen} onClose={() => setFunOpen(false)} resetVersion={resetVersion}>
              <FunPanel />
            </WorkspaceWindow>
            <WorkspaceWindow id="search" title="Search" icon={<Search className="size-4" />} open={searchOpen} onClose={() => setSearchOpen(false)} resetVersion={resetVersion}>
              <SearchPanel open={searchOpen} onOpenChat={(row) => { setMessagesIn(row.mode, row.messages); setCharacterMode(row.theme); setMode(row.mode); showMode(row.mode); setRound(0); setError(""); }} />
            </WorkspaceWindow>
            <WorkspaceWindow id="setup" title="Settings" icon={<Settings2 className="size-4" />} open={setupOpen} onClose={() => setSetupOpen(false)} resetVersion={resetVersion}>
              <SetupPanel open={setupOpen} />
            </WorkspaceWindow>
            <WorkspaceWindow id="today" title="Today" icon={<Sun className="size-4" />} open={todayOpen} onClose={() => setTodayOpen(false)} resetVersion={resetVersion}>
              <TodayPanel open={todayOpen} onOpenMail={() => setMailOpen(true)} onOpenCalendar={() => setCalendarOpen(true)} onOpenTasks={() => setTasksOpen(true)} />
            </WorkspaceWindow>
            <WorkspaceWindow id="tasks" title="Tasks & reminders" icon={<CheckSquare className="size-4" />} open={tasksOpen} onClose={() => setTasksOpen(false)} resetVersion={resetVersion}>
              <TasksPanel open={tasksOpen} onJustStart={beginFocusTask} />
            </WorkspaceWindow>
            <WorkspaceWindow id="calendar" title="Calendar" icon={<CalendarDays className="size-4" />} open={calendarOpen} onClose={() => setCalendarOpen(false)} resetVersion={resetVersion}>
              <CalendarPanel open={calendarOpen} />
            </WorkspaceWindow>
            <ReminderPopup />
            <AddonWindows addons={addons} openId={addonOpen} onClose={() => setAddonOpen(null)} resetVersion={resetVersion} />
            <MailAlertPopup onRead={(a) => { (window as unknown as { __ppOpenMail?: { folder: string; uid: number } }).__ppOpenMail = { folder: a.folder, uid: a.uid }; setMailOpen(true); window.setTimeout(() => window.dispatchEvent(new Event("pixelpals:open-mail")), 250); }} />
            <WorkspaceWindow id="mail" title="Mail" icon={<Mail className="size-4" />} open={mailOpen} onClose={() => setMailOpen(false)} resetVersion={resetVersion}>
              <MailPanel open={mailOpen} />
            </WorkspaceWindow>
            <WorkspaceWindow id="documents" title="Documents" icon={<FileText className="size-4" />} open={docsOpen} onClose={() => setDocsOpen(false)} resetVersion={resetVersion}>
              <DocumentsPanel />
            </WorkspaceWindow>
            <DocumentModalHost />
            {!roomOpen && !conversationOpen && !toolsOpen && !playtestsOpen && !recorderOpen && !notesOpen && !funOpen && !calendarOpen && !mailOpen && !docsOpen && !todayOpen && !tasksOpen && !setupOpen && !searchOpen && <div className="workspace-rest"><img src={mascot} width={128} height={128} alt="Pixel Pals mascot" draggable={false} className="pixel-character native-sprite brand-mascot-big" /><h1>Pixel Pals</h1></div>}
          </main>
        </div>
      </div>
      <nav className="mobile-tabbar" aria-label="Windows">
        <button type="button" aria-pressed={conversationOpen} onClick={() => mobileTab("chat")}><MessageSquare /><span>Chat</span></button>
        <button type="button" aria-pressed={todayOpen} onClick={() => mobileTab("today")}><Sun /><span>Today</span></button>
        <button type="button" aria-pressed={tasksOpen} onClick={() => mobileTab("tasks")}><CheckSquare /><span>Tasks</span></button>
        <button type="button" aria-pressed={notesOpen} onClick={() => mobileTab("notes")}><ListTodo /><span>Notes</span></button>
        <button type="button" aria-pressed={roomOpen} onClick={() => mobileTab("room")}><Users /><span>Room</span></button>
        <button type="button" aria-pressed={setupOpen} onClick={() => { mobileTab("chat"); setOpenModes((o) => ({ ...o, [mode]: false })); setSetupOpen(true); }}><Settings2 /><span>Settings</span></button>
      </nav>
      <footer className="app-footer">
        <span>SMALL PIXELS. BIG PERSPECTIVES.</span>
        <span>
          Made for a meeting of minds <span className="text-primary">✳</span>
        </span>
      </footer>
    </div>
  );
}
