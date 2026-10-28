import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Mailbox } from "@/components/mailbox";

type Pending = { signal?: AbortSignal; respond: (data: unknown) => void };
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
