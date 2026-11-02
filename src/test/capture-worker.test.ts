import { beforeEach, afterEach, it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { processCaptureJob } from "@/lib/capture-inbox-worker.server";
import { captureTransaction, readCaptures } from "@/lib/capture.server";
import { inboxMeta } from "@/lib/capture-inbox";
import { readOllamaHealth } from "@/lib/ollama-health.server";
vi.mock("@/lib/ollama-health.server", () => ({ readOllamaHealth: vi.fn() }));
let dir = "";
const original = "I need to prepare lunches.";
const healthy = {
  configured: true,
  reachable: true,
  state: "connected",
  remote: true,
  localOnly: true,
  models: [
    { name: "small:3b", gb: 2 },
    { name: "big:9b", gb: 6 },
  ],
} as const;
const response = () =>
  Response.json({
    response: JSON.stringify({
      suggestions: [
        {
          kind: "task",
          text: "Prepare lunches",
          quote: "prepare lunches",
          firstStep: "Get one container",
          minutes: 10,
          materials: [],
        },
      ],
    }),
  });
beforeEach(async () => {
  dir = await fs.mkdtemp(tmpdir() + "/capture-worker-");
  vi.stubEnv("BUDDY_DATA_DIR", dir);
  vi.stubEnv("CAPTURE_AUTO_PROCESS", "on");
  vi.stubEnv("OLLAMA_URL", "http://ollama.local:11434");
  vi.stubEnv("WHISPER_URL", "http://whisper.local");
  vi.stubEnv("MEMORY_KEEPER_MODEL", "auto");
  vi.mocked(readOllamaHealth).mockResolvedValue({ ...healthy, models: [...healthy.models] });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response()),
  );
  await captureTransaction((rows) =>
    rows.push({
      id: "worker-capture",
      kind: "note",
      text: original,
      at: Date.now(),
      inbox: inboxMeta(original),
    }),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await fs.rm(dir, { recursive: true, force: true });
});
it("uses the configured Memory Keeper model for bounded suggestions, without applying them", async () => {
  await processCaptureJob(new AbortController().signal);
  const row = (await readCaptures())[0]!;
  expect(row.inbox!.job.state).toBe("done");
  expect(row.inbox!.status).toBe("pending");
  expect(row.inbox!.approved).toEqual([]);
  expect(row.inbox!.suggestions[0]!.firstStep).toBe("Get one container");
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
  expect(body).toMatchObject({ model: "small:3b", think: false, keep_alive: 0, stream: false });
  await expect(fs.stat(dir + "/today.json")).rejects.toThrow();
});
it("keeps offline work pending beyond five attempts, then completes it when the host returns", async () => {
  vi.mocked(readOllamaHealth).mockResolvedValue({ ...healthy, reachable: false, models: [] });
  await captureTransaction((rows) => {
    rows[0]!.inbox!.job.attempts = 7;
  });
  await processCaptureJob(new AbortController().signal);
  expect((await readCaptures())[0]!.inbox!.job.state).toBe("pending");
  vi.mocked(readOllamaHealth).mockResolvedValue({ ...healthy, models: [...healthy.models] });
  await captureTransaction((rows) => {
    rows[0]!.inbox!.job.next = 0;
  });
  await processCaptureJob(new AbortController().signal);
  expect((await readCaptures())[0]!.inbox!.job.state).toBe("done");
});
it("keeps recordings on Unraid when local transcription is offline", async () => {
  await fs.mkdir(dir + "/capture-audio");
  await fs.writeFile(dir + "/capture-audio/abcdef.wav", new Uint8Array([1, 2]));
  await captureTransaction((rows) => {
    rows[0]!.inbox!.audio = { name: "abcdef.wav", type: "audio/wav", bytes: 2 };
    rows[0]!.inbox!.source = "audio";
  });
  vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 503 }));
  await processCaptureJob(new AbortController().signal);
  expect((await readCaptures())[0]!.inbox!.audio).toBeDefined();
  expect((await fs.stat(dir + "/capture-audio/abcdef.wav")).size).toBe(2);
});
it("scrubs the transcript, deletes processed audio and leaves text review usable when Ollama is offline", async () => {
  await fs.mkdir(dir + "/capture-audio");
  await fs.writeFile(dir + "/capture-audio/abcdef.wav", new Uint8Array([1, 2]));
  await captureTransaction((rows) => {
    rows[0]!.inbox!.audio = { name: "abcdef.wav", type: "audio/wav", bytes: 2 };
  });
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ text: "I need to prepare lunches password=secretvalue" }),
  );
  vi.mocked(readOllamaHealth).mockResolvedValue({ ...healthy, reachable: false, models: [] });
  await processCaptureJob(new AbortController().signal);
  const row = (await readCaptures())[0]!;
  expect(row.text).not.toContain("secretvalue");
  expect(row.inbox!.suggestions.length).toBeGreaterThan(0);
  expect(row.inbox!.audio).toBeUndefined();
  await expect(fs.stat(dir + "/capture-audio/abcdef.wav")).rejects.toThrow();
});
it("does not overwrite a capture that entered manual review during model processing", async () => {
  let release: ((r: Response) => void) | undefined;
  vi.mocked(fetch).mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const working = processCaptureJob(new AbortController().signal);
  await vi.waitFor(() => expect(release).toBeDefined());
  await captureTransaction((rows) => {
    rows[0]!.inbox!.revision++;
    rows[0]!.inbox!.job.state = "done";
    rows[0]!.inbox!.suggestions[0]!.text = "Manually reviewed choice";
  });
  release!(response());
  await working;
  expect((await readCaptures())[0]!.inbox!.suggestions[0]!.text).toBe("Manually reviewed choice");
});
it("never silently swaps a missing configured model and respects paused capture processing", async () => {
  vi.stubEnv("MEMORY_KEEPER_MODEL", "missing:3b");
  await processCaptureJob(new AbortController().signal);
  expect(fetch).not.toHaveBeenCalled();
  expect((await readCaptures())[0]!.inbox!.job.state).toBe("pending");
  vi.stubEnv("CAPTURE_AUTO_PROCESS", "off");
  expect(await processCaptureJob(new AbortController().signal)).toBe(false);
});
it("refuses fabricated evidence and supports recovery of jobs marked working after restart", async () => {
  await captureTransaction((rows) => {
    rows[0]!.inbox!.job.state = "working";
  });
  vi.mocked(fetch).mockResolvedValue(
    Response.json({
      response: JSON.stringify({
        suggestions: [{ kind: "memory", text: "Invented fact", quote: "not in source" }],
      }),
    }),
  );
  await processCaptureJob(new AbortController().signal);
  expect((await readCaptures())[0]!.inbox!.job.state).toBe("pending");
  expect((await readCaptures())[0]!.inbox!.suggestions[0]!.text).toBe(original);
});
it("retains the original recording and stops retries rather than truncating a long transcript", async () => {
  await fs.mkdir(dir + "/capture-audio");
  await fs.writeFile(dir + "/capture-audio/abcdef.wav", new Uint8Array([1, 2]));
  await captureTransaction((rows) => {
    rows[0]!.inbox!.audio = { name: "abcdef.wav", type: "audio/wav", bytes: 2 };
  });
  vi.mocked(fetch).mockResolvedValue(Response.json({ text: "word ".repeat(1000) }));
  await processCaptureJob(new AbortController().signal);
  const row = (await readCaptures())[0]!;
  expect(row.text).toBe(original);
  expect(row.inbox!.job.state).toBe("failed");
  expect(row.inbox!.job.note).toContain("shorter clips");
  expect(row.inbox!.audio).toBeDefined();
  expect((await fs.stat(dir + "/capture-audio/abcdef.wav")).size).toBe(2);
});
