# ADHD Assistant task intake: approved handoff export (beta development)

This is **development-stage, read-only groundwork**, not a live task synchronization or import feature. The installed ADHD Assistant dashboard remains v0.1 and continues using its original database. No new Docker volumes, ports, routes, permissions, or application restarts are required by this source change.

## What the new exporter does

`tools/adhd-v02/approved_task_export.py` reads the existing **bridge** SQLite database `bridge-v02.sqlite3` in SQLite `mode=ro` and produces one JSON snapshot on standard output. It includes **only tasks that have both**:

- receiver state `approved` (approval on the ADHD Assistant side, not just approval inside Pixel Pals), and
- a recorded `approve` event for the same handoff.

It excludes pending and rejected handoffs, handoffs of kind `note`, and manually altered approval rows without an approval event. It fails closed on invalid stored fields or more than 500 results instead of silently truncating records.

### Example of the future importer contract

```json
{
  "format": "adhd-assistant-approved-task-intake",
  "version": 1,
  "source": "pixel-pals-bridge",
  "tasks": [{
    "source_id": "pixel-pals:approved123",
    "handoff_id": "approved123",
    "approved_at": "2026-11-05T19:10:00Z",
    "title": "Test the bridge",
    "notes": null,
    "due_at": null,
    "project": null
  }]
}
```

The stable `source_id` is intended to enable deduplication when a future ADHD Assistant task importer is implemented. Exporting the same approved queue twice produces the same JSON (unless approval state or the queue changes). The exporter **does not** mark anything imported, does not schedule reminders, and does not create tasks in Today, Upcoming, or Projects.

## Developer-only local test

```bash
python3 -B tools/adhd-v02/test_approved_task_export.py
```

CI runs this through `tools/adhd-v02/test-unified-compose.sh`. Its tests use a disposable SQLite fixture: no Unraid appdata or private handoff content is accessed.

If needed in a separately approved developer environment, `approved_task_export.py --data-dir /path/to/test/bridge-data` prints the JSON contract. **Do not paste the output into chats or logs:** approved task titles and notes may contain private information. This new script has **not** been installed inside the user's running bridge container. Do not use it against the user's live appdata without confirming the use case and access permissions.

## Next steps before real task creation

1. Inspect the **installed** standalone ADHD Assistant v0.1 code and task-store schema read-only (we do not yet have that schema in this GitHub repository).
2. Implement an opt-in, authenticated import endpoint **inside ADHD Assistant**, with explicit owner review, a unique source ID, and transaction-safe idempotency.
3. Test task creation, existing task preservation, due date handling, crash recovery, duplicate submissions and rollback against a disposable copy of the ADHD task database.
4. Add an ADHD Assistant handoff inbox UI, and keep task approval separate from execution.
5. Only after staging tests and owner permission, install the new importer on Unraid. Existing Caddy, the bridge sidecar and Pixel Pals should remain independently functional.

Work on Pixel Pals HD character art is separate and must not modify this bridge contract or ADHD runtime.
