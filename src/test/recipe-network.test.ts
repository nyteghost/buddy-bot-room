import { beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { recipePage } from "@/lib/recipe-import.server";
vi.mock("node:dns/promises", () => { const lookup = vi.fn(); return { lookup, default: { lookup } }; });
vi.mock("node:https", () => { const request = vi.fn(); return { request, default: { request } }; });
const dns = vi.mocked(lookup), get = vi.mocked(request);
beforeEach(() => { dns.mockReset(); get.mockReset(); });
it("rejects a public hostname resolving to a private address before socket creation", async () => {
  dns.mockResolvedValue([{ address: "10.200.1.30", family: 4 }] as never);
  await expect(recipePage("https://example.com/recipe", AbortSignal.timeout(1000))).rejects.toThrow("not a public");
  expect(get).not.toHaveBeenCalled();
});
it("pins the checked IP to HTTPS and refuses a redirect into the LAN", async () => {
  dns.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never).mockResolvedValueOnce([{ address: "192.168.1.1", family: 4 }] as never);
  get.mockImplementation(((socketUrl: URL, options: { servername: string; headers: { Host: string } }, callback: (response: unknown) => void) => {
    expect(socketUrl.hostname).toBe("93.184.216.34"); expect(options.servername).toBe("example.com"); expect(options.headers.Host).toBe("example.com");
    const req = new EventEmitter() as EventEmitter & { setTimeout: ReturnType<typeof vi.fn>; end: () => void };
    req.setTimeout = vi.fn(); req.end = () => { const response = Object.assign(new EventEmitter(), { statusCode: 302, headers: { location: "https://private.example.com/recipe" }, destroy: vi.fn() }); callback(response); };
    return req;
  }) as never);
  await expect(recipePage("https://example.com/recipe", AbortSignal.timeout(1000))).rejects.toThrow("not a public");
  expect(get).toHaveBeenCalledTimes(1); expect(dns).toHaveBeenCalledTimes(2);
});
it("reads a bounded HTML response from the pinned socket", async () => {
  dns.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
  get.mockImplementation(((_url: unknown, options: { servername: string }, callback: (response: unknown) => void) => {
    expect(options.servername).toBe("example.com");
    const req = Object.assign(new EventEmitter(), { setTimeout: vi.fn(), end: () => {
      const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: { "content-type": "text/html; charset=utf-8" }, destroy: vi.fn() });
      callback(response); response.emit("data", Buffer.from("<html>recipe</html>")); response.emit("end");
    } }); return req;
  }) as never);
  expect(await recipePage("https://example.com/recipe", AbortSignal.timeout(1000))).toEqual({ html: "<html>recipe</html>", source: "https://example.com/recipe" });
});
it("rejects an oversized page while streaming", async () => {
  dns.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
  get.mockImplementation(((_url: unknown, _options: unknown, callback: (response: unknown) => void) => Object.assign(new EventEmitter(), { setTimeout: vi.fn(), end: () => {
    const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: { "content-type": "text/html" }, destroy: vi.fn() }); callback(response); response.emit("data", Buffer.alloc(1_500_001));
  } })) as never);
  await expect(recipePage("https://example.com/recipe", AbortSignal.timeout(1000))).rejects.toThrow("too large");
});
