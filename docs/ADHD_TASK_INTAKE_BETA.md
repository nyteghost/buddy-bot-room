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


## Read-only preview against the verified ADHD-A v0.1 schema

The owner provided a read-only schema inspection on November 5, 2026. The installed `adhd.sqlite3` has `tasks` with these columns:

`id, title, notes, due_at, status, project_id, source, created_at, updated_at`.

The installed `projects` table has:

`id, title, next_action, notes, status, created_at, updated_at`.

No task or memory rows were exposed by that inspection. It **did not establish task status conventions, uniqueness on `source`, defaults, or the dashboard's normal task-creation API**.

`tools/adhd-v02/approved_task_plan.py` is a second **read-only development step**:

- Opens the bridge and ADHD task databases using SQLite `mode=ro` with `query_only=ON`.
- Uses the approved handoff snapshot as the only candidate input.
- Checks the installed task table shape against the verified v0.1 columns.
- Looks only at `tasks.source` values to identify already-present `pixel-pals:<handoff-id>` records.
- Holds tasks specifying a project name for manual foreign-key mapping: a project name is **not** a safe `project_id`.
- Detects duplicate existing source identifiers instead of guessing which task is correct.
- Prints aggregate counts only; never prints private titles, notes, project names, source IDs, or existing task contents.
- Does not create/update tasks, mark handoffs consumed, change indexes, or restart services.

Developer-only example, against a **disposable copy** of both SQLite databases:

```bash
python3 -B tools/adhd-v02/test_approved_task_plan.py
python3 -B tools/adhd-v02/approved_task_plan.py --bridge-data-dir /path/to/safe-fixture --adhd-data-dir /path/to/safe-fixture
```

This preview helper is committed to GitHub beta but **has not been mounted or deployed** into the user's live Unraid containers. Existing data remains untouched.

Before implementing any actual import writes, inspect the original ADHD Assistant task API, task status values, indexes/constraints, and recovery semantics. A source ID alone provides a stable matching key, but does **not** automatically enforce a unique source constraint: an approved importer needs transaction-safe deduplication and should preferably use the app's normal task API/storage layer, not bypass it with unreviewed SQL.

## Experimental reviewed task importer — isolated fixtures only

The next backend increment is `tools/adhd-v02/reviewed_task_import.py`. It is **not installed on Unraid** and **not approved for use against the live ADHD task database** until the installed ADHD Assistant v0.1 task-creation code, status vocabulary, constraints and backup restore process have been independently inspected.

- **No-argument/default behavior:** read-only preview (no database writes).
- **Opt-in prototype apply:** requires `--apply`, an exact confirmation phrase, the explicitly supplied `open` task status verified by the installed table's default, and a pre-existing private backup directory (mode 0700).
- Reads only bridge tasks separately approved on the ADHD receiver side, never drafts, merely delivered messages, notes, pending tasks, or rejected handoffs.
- Creates a separate SQLite backup before any task insert; backup file permissions are 0600.
- Checks the existing task schema; rejects unreviewed task-table triggers, mismatched NOT NULL/default constraints, unknown status values, and duplicate source IDs.
- Stores a stable `tasks.source` value `pixel-pals:<handoff-id>`. Repeated imports skip already-created tasks. The insert pass uses a SQLite `BEGIN IMMEDIATE` transaction and checks duplicates again within that transaction.
- Any insert failure rolls back the **whole batch**. No existing task row is updated or deleted.
- Handoffs with a named project stay on hold for manual `project_id` mapping. No auto-created projects.
- CLI output contains aggregate counts, not private task names or notes.

**Testing:** `python3 -B tools/adhd-v02/test_reviewed_task_import.py` uses disposable SQLite fixture databases. Tests include preview-only behavior, excluded handoffs, consent guard, status guard, private backup, source-ID idempotency, bad schema rejection, no-file creation, transactional rollback, and non-disclosure of task content.

**Known limitations:** a status value appearing in the existing task table does not by itself prove that it is the appropriate newly-created status. The live application API may perform additional validation or side effects (planning, scheduling, notifications) not reproduced by raw SQL. The importer prototype has no in-app review interface, no per-task scheduling behavior, and no integration with the dashboard's normal task-creation service. It must not be deployed or run against live appdata until those items are reviewed and the owner explicitly approves a guarded staging test.

The HD256 / Living Universe Work stream has separate file ownership and must not modify these ADHD bridge or task-intake tools.

## Verified Unraid v0.1 constraints (November 6, 2026)

The owner ran another **read-only** SQLite inspection of the installed `/data/adhd.sqlite3`. This confirmed the complete `tasks` DDL, not merely the column list:

- `id TEXT PRIMARY KEY`; `title TEXT NOT NULL`.
- `notes TEXT NOT NULL DEFAULT ''`: absent notes must become an empty string, not SQL NULL.
- `status TEXT NOT NULL DEFAULT 'open'`: `open` is the only task status verified by the schema. The live tasks table currently has **no rows**, so `SELECT DISTINCT status` returned `[]`. This does not establish which other statuses the application supports.
- `source TEXT NOT NULL DEFAULT 'manual'`; no unique index on `source` exists. The importer must serialize and re-check duplicate source IDs, but true cross-client uniqueness is **not** guaranteed without an app-level constraint.
- `project_id` has a foreign key to `projects(id)` with `ON DELETE SET NULL`; project names cannot safely be put into `project_id`.
- The only observed indexes are `task_due_idx` and the SQLite primary-key autoindex.

The experimental importer has been updated to check the verified NOT NULL/default contract, allow **only the verified `open` status** without requiring an existing task row, and convert omitted notes to `''`. The regression fixture now matches the actual v0.1 DDL and starts with an empty `tasks` table. The import remains an **undeployed development prototype**: the dashboard's task-creation endpoint and application-layer validations still must be reviewed before any live import is authorized.

## Native ADHD Assistant handoff adapter — preferred path (November 6, 2026)

A read-only inspection of the **installed** ADHD Assistant v0.1 source clarified that it already implements the correct task-creation and audit workflow:

- `Store.create_handoff(kind, payload, peer_id, direction="in", message_id=...)` creates or deduplicates an incoming native handoff and rejects ID/payload/peer collisions.
- `Store.approve_handoff(message_id)` reviews a pending native handoff, creates exactly one `open` task with ID `handoff-<message_id>`, and records `handoff.approved` in its audit log.
- `POST /api/handoff/approve` invokes that Store method from ADHD Assistant's existing local-only API.

The **installed bridge sidecar uses a separate SQLite queue** and its CLI approval does not invoke the native Store. This is why sidecar-approved tasks currently do not appear in the dashboard.

`tools/adhd-v02/native_handoff_reconcile.py` introduces a small, **injectable and undeployed** integration adapter using the native Store instead of directly inserting task records:

- Requires the bridge-side receiver to have already approved a task, with a matching approval audit event.
- Requires an explicit handoff ID, a previously registered **enabled native ADHD peer ID**, and a distinct confirmation string for owner-authorized linking.
- Requires `native_store.backup()` to succeed before writing through the native Store methods.
- Uses native `create_handoff` and `approve_handoff`, preserving the existing `handoff-<id>` task IDs, task status rules, native audit trail and idempotency.
- When a native pending handoff exists after an interruption, the adapter can finish its native approval on an explicitly approved retry; it does not replace or overwrite existing tasks.
- Refuses native rejected records, mismatched IDs or payloads, missing task records after native approval, disabled/unregistered peers, and handoffs whose project names need mapping.
- Returns only status labels and backup presence. It does **not** echo task titles, notes, peer tokens, or private memory.
- Does not auto-import all handoffs and does not grant imported character assets any tool, memory, or AI permissions.

**Important:** This is a reusable library, NOT a command to run on Unraid. The installed native Store must be inspected further for its constructor and peer registration details before providing an owner-facing installer or calling these methods in the live dashboard. The existing `reviewed_task_import.py` raw-SQL implementation remains a **fixture-only experimental prototype** and should NOT be deployed; native handoff approval is the preferred pathway.

The new regression file `tools/adhd-v02/test_native_handoff_reconcile.py` exercises the API contract using disposable SQLite bridge and native Store fixture databases. No actual user task content is used and no running Unraid container is touched.

### Next steps to deploy native linking safely

1. Confirm the installed native Store initialization, peer registration and backup methods using **read-only source inspection**. Never display peer tokens.
2. Test against the **actual ADHD-A v0.1 source** copied into a disposable container/fixture, including crashes and duplicate link attempts.
3. Add a native handoff review/approval UI inside ADHD Assistant rather than relying on terminal approval.
4. Provide an owner-reviewed, backup-first Unraid upgrade path. Only after explicit approval, enable task creation and test one harmless handoff.
5. Keep the private Docker bridge and Pixel Pals independent if ADHD Assistant is stopped.
