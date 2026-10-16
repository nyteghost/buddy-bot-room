import { afterEach, expect, it, vi } from "vitest";
import { handleSpeech } from "../lib/speech.server";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("returns 499 when voice generation is cancelled before headers", async () => {
  vi.stubEnv("LOVABLE_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new DOMException("This operation was aborted", "AbortError")),
  );
  const response = await handleSpeech(
    new Request("http://localhost/api/speech", {
      method: "POST",
      body: JSON.stringify({ agentId: "nova", text: "Hello" }),
    }),
  );
  expect(response.status).toBe(499);
});

it("closes quietly when a returned voice stream is cancelled", async () => {
  vi.stubEnv("LOVABLE_API_KEY", "test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new DOMException("This operation was aborted", "AbortError"));
          },
        }),
      ),
    ),
  );
  const response = await handleSpeech(
    new Request("http://localhost/api/speech", {
      method: "POST",
      body: JSON.stringify({ agentId: "nova", text: "Hello" }),
    }),
  );
  expect(response.status).toBe(200);
  await expect(response.text()).resolves.toBe("");
});
