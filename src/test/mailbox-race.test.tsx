import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Mailbox } from "@/components/mailbox";

type Pending = { signal?: AbortSignal | undefined; respond: (data: unknown) => void };
const inbox = (subject: string) => ({
  folder: "INBOX", folders: [{ name: "INBOX", label: "Inbox", special: "inbox" }],
  messages: [{ uid: 1, subject, from: "Sender", date: "", seen: false, messageId: "" }],
  total: 1, account: "owner@example.com", gmail: false,
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("Mail request race protection", () => {
  it("does not let an obsolete list response overwrite the newer search", async () => {
    const pending: Pending[] = [];
    const fetchStub = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve) => {
      pending.push({
        signal: init?.signal ?? undefined,
        respond: (data: unknown) => resolve(new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } })),
      });
    }));
    vi.stubGlobal("fetch", fetchStub);
    const view = render(<Mailbox open />);
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("Search mail"), { target: { value: "new" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0]?.signal?.aborted).toBe(true);
    await act(async () => { pending[1]!.respond(inbox("Latest message")); });
    expect(await screen.findByText("Latest message")).toBeTruthy();
    await act(async () => { pending[0]!.respond(inbox("Stale message")); });
    expect(screen.queryByText("Stale message")).toBeNull();
    expect(screen.getByText("Latest message")).toBeTruthy();
    view.unmount();
  });
});

it("ignores older-page responses from a previous search in the same folder", async () => {
  const pending: Pending[] = [];
  vi.stubGlobal("fetch", vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>(resolve => {
    pending.push({ signal: init?.signal ?? undefined, respond: data => resolve(Response.json(data)) });
  })));
  const view = render(<Mailbox open />);
  await waitFor(() => expect(pending).toHaveLength(1));
  await act(async () => pending[0]!.respond({ ...inbox("Original"), total: 5 }));
  fireEvent.click(screen.getByRole("button", { name: "Load older" }));
  await waitFor(() => expect(pending).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Search mail"), { target: { value: "latest" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(pending).toHaveLength(3));
  await act(async () => pending[2]!.respond(inbox("Latest")));
  await act(async () => pending[1]!.respond({ ...inbox("Obsolete page"), messages: [{ ...inbox("").messages[0], uid: 2, subject: "Obsolete page" }] }));
  expect(screen.queryByText("Obsolete page")).toBeNull();
  expect(screen.getByText("Latest")).toBeTruthy();
  expect(pending[1]!.signal?.aborted).toBe(true);
  view.unmount();
});

it("keeps an unsent draft on immediate Back and resets confirmation when Cc changes", async () => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(inbox("A message"))));
  const view = render(<Mailbox open />);
  await screen.findByText("A message");
  fireEvent.click(screen.getByRole("button", { name: "Write" }));
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "friend@example.com" } });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Unsent words" } });
  fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
  expect(screen.getByRole("button", { name: "Really send it" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Cc"), { target: { value: "other@example.com" } });
  expect(screen.queryByRole("button", { name: "Really send it" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Back$/ }));
  expect(sessionStorage.getItem("pixelpals:mail-draft-v1:owner%40example.com")).toContain("Unsent words");
  view.unmount();
});
