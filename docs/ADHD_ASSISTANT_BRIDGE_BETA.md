# Optional ADHD Assistant bridge — Pixel Pals beta

This is a **manual, owner-reviewed, outbound-only integration increment**. It does not modify Pixel Pals AI memories, agents, Obsidian vault, existing calendars, emails, or other private data. It is independent of Living World HD character development and does not install or update anything on Unraid.

## Use in Pixel Pals

Open **Pal Room → Send a task to ADHD Assistant (optional)**. The closed section is inert unless opened. Enter a non-sensitive task title, optional notes and due date. Choose **Create draft for review**, inspect the saved entry, then choose **Approve this task** and **Send to ADHD Assistant**.

The sender's receipt means the ADHD Assistant receiver accepted the message into its **incoming review queue**; it does *not* mean a reminder was scheduled or completed. The ADHD Assistant owner must separately approve it in Handoffs. A failed send stays approved for an explicit retry using the same idempotent message ID. A delivered entry cannot be cancelled retroactively.

## Data separation and safety

- Local outbox is stored under the **existing beta** `BUDDY_DATA_DIR/adhd-bridge-outbox.json` (atomic updates, mode 0600); it does not replace or import a Pixel Pals memory file.
- GET/POST `/api/adhd-bridge` require the signed-in Pixel Pals **owner**. Strict JSON validation rejects hidden fields and unknown actions.
- Only the manually typed task title, notes, optional due date/project and a random message ID enter the outgoing envelope. No chats or private memory are gathered automatically.
- The destination address and bearer secret are **server environment settings**, never supplied by the browser and never returned to the UI. Redirects are not followed; requests time out. Secret values must not be committed or pasted into chats.
- The integration and network are both **off by default**. Imported visual visitors cannot invoke it or receive new tools.
- No incoming Pixel Pals peer endpoint exists yet; reverse ADHD Assistant → Pixel Pals handoffs remain a separate milestone.

## Opt-in beta environment (DO NOT APPLY until a network-ready ADHD receiver is installed)

```text
ADHD_BRIDGE_ENABLED=1
ADHD_BRIDGE_PEER_URL=http://host.docker.internal:<private-bridge-port>
ADHD_BRIDGE_ALLOW_DOCKER_HOST=1
ADHD_BRIDGE_PEER_TOKEN=<unique-long-token-matching-enabled-ADHD-peer>
```

The ADHD Assistant **0.1.0** container currently running on Unraid exposes only the localhost dashboard; it cannot receive requests from a separate Docker network. **Do not** point the adapter at the Caddy LAN browser proxy, open public port forwarding, or enable these settings prematurely.

ADHD Assistant **0.2.0-beta** adds a distinct, CIDR-restricted and bearer-authenticated bridge-only listener. Pairing requires the correct Unraid Docker gateway/subnet and a controlled, backup-safe update of the ADHD Assistant container. See its bundled `docs/DOCKER_BRIDGE_BETA.md` guide.

## Verification and remaining gates

- Pure unit tests validate draft/approval/cancel states, destination restrictions, receipt IDs and unsupported inputs.
- A Node client speaking this same envelope has been tested against a Python ADHD Assistant receiver over real loopback HTTP, with explicit receiver approval. This is **not** live Unraid validation.
- Check **current beta CI, browser smoke, and image publication**, then manually inspect the panel and test a real task handoff after enabling peer settings.
- Next: inbound/reverse handoff endpoint, task-state polling, symmetric peer revocation, explicit shared memory grants and visiting companion handoff scopes.
