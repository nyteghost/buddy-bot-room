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
- Requires an explicit handoff ID, a previously registered **enabled native ADHD peer ID**, the native ADHD `bridge_enabled` setting explicitly set to `on`, and a distinct confirmation string for owner-authorized linking.
- Requires `native_store.backup()` to succeed before writing through the native Store methods.
- Uses native `create_handoff` and `approve_handoff`, preserving the existing `handoff-<id>` task IDs, task status rules, native audit trail and idempotency.
- When a native pending handoff exists after an interruption, the adapter can finish its native approval on an explicitly approved retry; it does not replace or overwrite existing tasks.
- Refuses native rejected records, mismatched IDs or payloads, missing task records after native approval, task ID collisions from other sources, disabled/unregistered peers, and handoffs whose project names need mapping.
- Returns only status labels and backup presence. It does **not** echo task titles, notes, peer tokens, or private memory.
- Does not auto-import all handoffs and does not grant imported character assets any tool, memory, or AI permissions.

**Important:** This is a reusable library, NOT a command to run on Unraid. The installed native Store must be inspected further for its constructor and peer registration details before providing an owner-facing installer or calling these methods in the live dashboard. The existing `reviewed_task_import.py` raw-SQL implementation remains a **fixture-only experimental prototype**; its `--apply` CLI mode is now explicitly **disabled** to prevent accidental task writes. It should NOT be deployed; native handoff approval is the preferred pathway.

The new regression file `tools/adhd-v02/test_native_handoff_reconcile.py` exercises the API contract using disposable SQLite bridge and native Store fixture databases. No actual user task content is used and no running Unraid container is touched.

### Next steps to deploy native linking safely

1. Confirm the installed native Store initialization, peer registration and backup methods using **read-only source inspection**. Never display peer tokens.
2. Test against the **actual ADHD-A v0.1 source** copied into a disposable container/fixture, including crashes and duplicate link attempts.
3. Add a native handoff review/approval UI inside ADHD Assistant rather than relying on terminal approval.
4. Provide an owner-reviewed, backup-first Unraid upgrade path. Only after explicit approval, enable task creation and test one harmless handoff.
5. Keep the private Docker bridge and Pixel Pals independent if ADHD Assistant is stopped.


## Native pairing readiness — read-only diagnostics (November 6, 2026)

The owner inspected their installed native ADHD Assistant v0.1 server **without displaying peer secrets**:

- Native Store includes `__init__`, `connect`, `add_peer`, `update_peer`, `setting`, and `backup`.
- Native `bridge_enabled` setting: **unset** (equivalent to off for our integration).
- Native enabled peer count: **0**.
- The separate `adhd-assistant-bridge` sidecar already works; it is not the same as the native Store's peer registration and approval queue.

No native peer was added and no setting was modified.

`tools/adhd-v02/native_pairing_preflight.py` now provides a **read-only** readiness diagnostic. It parses method signatures using Python's AST without importing or executing the installed application source, queries only schema and aggregate peer metadata, and opens the native SQLite database with `mode=ro` and `query_only=ON`. It never reads peer tokens, task titles or private memories and does not log peer IDs or endpoints.

Developer-only example for an environment where code and data are already accessible:

```bash
python3 -B tools/adhd-v02/native_pairing_preflight.py \
  --source-root /path/to/source \
  --database /path/to/existing/adhd.sqlite3
```

The JSON report includes `native_schema_matches`, `native_store_methods_present`, `native_bridge_enabled`, `enabled_native_peer_count`, `intended_native_peer_enabled`, `ready_for_staging` and named readiness blockers. The optional `--expected-peer-id` flag checks a specific registered native peer **without printing its ID**. Without a verified intended peer, `ready_for_staging` stays false even if unrelated peers are enabled. **Even when all readiness checks pass**, `live_task_creation_authorized` is always false; explicit owner authorization and separate staging tests are still required.

Automated fixture tests: `python3 -B tools/adhd-v02/test_native_pairing_preflight.py` (included in CI). The actual Unraid installation has **not** been modified or inspected by this new script.

### Pairing and delivery design still to finish

Do not enable the native `bridge_enabled` setting or register peers just to satisfy a test; doing so could activate unrelated outgoing-sharing capabilities in the native application. Before pairing:

1. Inspect native `Store.__init__`, `Store.add_peer`, `Store.setting`, and `Store.backup` bodies and `server._local` authorization (source only, no secrets).
2. Decide whether to use a distinct, narrowly scoped `Pixel Pals task intake` permission instead of enabling the wider native bridge feature.
3. Rehearse the native adapter against the **real** ADHD Assistant source using disposable databases and a private backup directory; fixture-only tests do not prove live compatibility.
4. Verify opt-in creation of the native peer record and a secure way to store its bearer token, without exposing a dashboard/admin endpoint on the Docker network.
5. Only with explicit approval, stage the change in a backup-preserving environment, inspect the single test handoff, and then consider an in-app review UI.

This diagnostic does not authorize or schedule an installation.


## A more restrictive option: local-only native Store handoff (November 6, 2026)

A subsequent read-only inspection of the installed `adhd_assistant/database.py` showed why enabling the native network bridge is inappropriate for this first local handoff:

- `Store.connect()` is a **`@contextlib.contextmanager`** that owns locking, the SQLite connection, commits and rollbacks. The original prototype wrongly treated it like a bare SQLite connection. `native_handoff_reconcile.py` and its fixture have now been corrected to use `with store.connect() as db:` and to test connection lifecycle, rollback and close.
- `Store.add_peer` rejects non-loopback endpoints. Native peers therefore cannot simply be configured with `http://adhd-bridge:18766`. Do **not** bypass that restriction, expose new ports, or switch on the native bridge to import approved local tasks.
- `Store.backup()` makes a real SQLite backup inside `self.directory / "backups"`; we can require this before any approved task import. Its contents and path must remain private.
- `Store.create_handoff()` and `Store.approve_handoff()` are the existing native task-creation/audit methods. Source review so far does **not** establish whether the native `handoffs.peer_id` column has a foreign-key constraint. That remains an explicit staging verification gate.

`tools/adhd-v02/native_local_intake.py` is a **separate, undeployed development library** exploring this local-only path. It reads the sidecar's approved-with-audit task queue, uses the native Store APIs for task creation, and never opens a listener, adds a peer, enables `bridge_enabled`, or exposes remote memory and AI tools. It uses a fixed **non-network local provenance ID** rather than impersonating a registered peer. It refuses to operate if that ID is registered as a network peer, if the native HTTP bridge is enabled, or if native `handoffs.peer_id` has a foreign key requiring a registered peer.

Local-only linking is a **single-task, explicit owner action**, not an automatic background job. The development library requires a distinct confirmation string, a successful existing Store backup, receiver-side approval plus audit event, matching native handoff payload/identity, and native task-source verification. It never writes directly to task tables; it calls only `Store.create_handoff` / `Store.approve_handoff`. It does not process notes, knowledge or project-linked tasks. It never prints private task content.

The companion test suite `tools/adhd-v02/test_native_local_intake.py` exercises an empty native peer table with `bridge_enabled` off, duplicate protection, native audit, owner confirmation, bridge approval checks, project hold, task ID collision, reserved local identity collision, prohibited foreign keys, backup failure and interruption retries. It uses **disposable synthetic SQLite databases only** and is run by CI. Tests do not establish that the installed native Store accepts this local principal; that requires an explicit source-schema inspection and staging test against a disposable copy of the real app, not trial-and-error on the live DB.

**No update or installation of ADHD Assistant or the sidecar is authorized by this experiment.** Continue keeping the current running sidecar and Pixel Pals deployment untouched. The HD256 Work session owns character and smoke-test failures separately.


## Installed native handoff schema verified; disposable real-Store rehearsal ready

On November 6, 2026, the owner checked the **installed native** `adhd.sqlite3` using a read-only SQLite connection:

- `PRAGMA foreign_key_list(handoffs)` returned **`[]`**.
- `handoffs` has: `id, direction, peer_id, kind, payload, state, attempts, last_error, receipt, created_at, updated_at`.
- Therefore native `handoffs.peer_id` has no SQLite foreign-key restriction, allowing a reserved **local-only provenance identifier** without creating a network peer. This proves schema compatibility, **not live end-to-end operation**.
- The native `bridge_enabled` setting remains unset and the enabled native peer count was zero at the most recent inspection. Do **not** turn it on to satisfy a setup check.

A new script `tools/adhd-v02/stage_native_local_intake.py` rehearses the **actual installed** `adhd_assistant.database.Store` methods in a disposable environment. It verifies native task creation, `open` status, the `handoff-<id>` source linkage, native audit, native SQLite backup, repeat-call idempotency, and zero network peers. The synthetic test task uses only hardcoded nonprivate content. All state lives in an ephemeral temporary directory that is deleted afterwards; **the real `/data` directory is neither mounted nor read**. The script refuses to run if `ADHD_STAGING_ONLY=1` is absent or if `/data/adhd.sqlite3` is present.

The rehearsal is intentionally designed for an offline disposable Docker container with the application's source mounted **read-only** and no network, live task database, user memory vault, or source-code write access. Its Python unit tests use a synthetic Store fixture. Until the owner explicitly runs the isolated rehearsal, no claim of compatibility with the installed native Store may be made.

Example developer invocation from a disposable environment where the repo's `tools/adhd-v02` files and ADHD app source are already mounted:

```bash
ADHD_STAGING_ONLY=1 PYTHONPATH="/opt/adhd:/checks" \
  python3 -B /checks/stage_native_local_intake.py
```

The **recommended Docker execution environment** for this test must be `--network none --read-only`, with `/opt/adhd` bound read-only to the current source directory, `/checks` bound read-only to the scripts, `/tmp` provided as a limited tmpfs and **no user data volume mounted**. A passing rehearsal is **not authorization** to install the adapter in the live container; owner review, a real restore rehearsal, explicit one-task opt-in and in-app approval UI are still required.

### Development ownership and CI status

Shared Intelligence work is limited to `tools/adhd-v02/` and `docs/ADHD_TASK_INTAKE_BETA.md`. The latest known HD256 v3 browser smoke regression, `Signature action did not hold the visitor in place`, is owned by the separate Living Universe Work stream. This is not an ADHD backend-test failure. Do not modify Work's character files from the ADHD integration stream.


## Owner review inbox UI — beta module, NOT installed (November 6, 2026)

The user's **isolated Unraid native Store rehearsal returned `result: PASS`**, with `real_app_source_tested: true`, `native_audit_verified: true`, `backup_verified: true`, `duplicate_protection_verified: true`, `network_bridge_enabled: false`, `native_peer_created: false`, and `user_database_accessed: false`. The synthetic staging container exited and discarded its databases. The warning about unsupported kernel swap limits is a Docker host warning, not a staging failure.

That is strong evidence that the local-only adapter can use the real installed Store code. It is **not** evidence that the running live dashboard has received a new update or that any real tasks have been imported.

### New implementation (source and unit tests only)

- `native_review_inbox.py`: review service. A list of pending/approved/rejected sidecar handoffs; explicit audited approve/reject transitions; separate explicit native Store task import through `native_local_intake.link_local_task`. A review does **not** create a task; a reject is final. Nothing runs automatically or shares memories.
- `native_review_page.html`: self-contained responsive browser inbox for the existing ADHD dashboard. All titles/notes are inserted using `textContent`, never raw HTML. No remote CDN, authentication code, or external analytics.
- `native_review_http.py`: integration adapter for **the existing** ADHD local-only HTTP handler. It uses that handler's `_local()` protection, requires a custom same-origin request header, rejects cross-site POST requests using the `Origin`/`Host` match, requires JSON and a bounded body, adds no-store/no-frame/no-sniff headers, and uses a SHA-256 Content Security Policy hash for the embedded script.
- `test_native_review_inbox.py` and `test_native_review_http.py`: offline tests for approval/rejection, explicit second-stage import, idempotency, invalid IDs, private-data non-disclosure, no unauthorized writes, and cross-origin rejection.

The planned same-origin routes (not yet wired to the native server) are:

| HTTP route | Purpose | Safety requirement |
| --- | --- | --- |
| `GET /pixel-pals-inbox` | Review page | Native local authorization + existing Caddy authentication |
| `GET /api/pixel-pals/inbox` | Private owner inbox summary | Native local authorization, same-origin custom header, no-store |
| `POST /api/pixel-pals/inbox/review` | Explicit approve or reject | Native local authorization, Origin/Host match, JSON, exact reviewed ID |
| `POST /api/pixel-pals/inbox/import` | Explicitly add receiver-approved task via native Store | Separate owner action, native SQLite backup and audit, duplicate checks |

### Still required before enabling the browser page

1. Inspect the installed `server.py` `_local` implementation and routing conventions, and the installed Caddy proxy's authentication and Host handling **without exposing passwords**. The in-app UI must not accidentally bypass either.
2. Rehearse the exact new routes with the actual ADHD Assistant server source and an offline synthetic database (not only mock HTTP handlers).
3. Integrate these modules into a versioned ADHD Assistant package. Do not inject source patches into the live Unraid volume without making a full recovery backup.
4. Add a clear dashboard navigation entry to the inbox, then test on iPhone and Windows at LAN/Tailscale addresses.
5. Only after owner approval, install on Unraid, validate the private review page and existing dashboard, and perform one harmless task handoff. Keep independent apps, Caddy access, previous native tasks, and bridge sidecar data intact.

The reviewed page is a **beta integration candidate**, not a link that currently works on the user's installed ADHD Assistant. No new user-facing route or login has been activated.


## Fail-closed browser route staging patch (November 6, 2026)

The browser inbox modules and tests now include `prepare-native-review-patch.py`:

- It parses the installed `adhd_assistant/server.py` with the Python AST and requires exactly one HTTP handler with `do_GET`, `do_POST`, `_read` and `_local` methods.
- It verifies that `_local` **raises `PermissionError`** for unauthorized callers. A guard that merely returns false or has an unfamiliar structure is rejected.
- It requires exactly one known `path=urlsplit(self.path).path` assignment in each handler and exception-handling branches. It refuses existing Pixel Pals route names to avoid duplicate injection.
- It prepares the reviewed GET/POST dispatch only at those verified insertion points, never by overwriting or replacing unrelated methods.
- Default mode is **read-only preflight**: parse and hash source, check dependencies, report that the route overlay is compatible; do not write anything.
- Optional `--stage /tmp/<new-empty-name>` mode writes only to a new, private temp directory. It stages a patched copy of `server.py`, the local-only task intake/review modules, and the standalone browser page. It does **not** install files into the running container or change the real `adhd.sqlite3` database.
- The patcher does not request tokens, activate the native network bridge, open a new port, or modify Caddy.
- No production installation command is provided yet. First inspect the running server's exact `_local` implementation and Caddy proxy behavior, then run the preflight and route security tests in a disposable environment.

The inbox now checks the **full native handoff** (direction, peer provenance, kind, original approved payload, native approval state and task source) before labeling a task as linked. A matching task ID alone is insufficient. Interrupted native approvals display as pending and require an explicit second confirmation to finish. Any mismatch disables the import action.

The new regression suite `test_prepare_native_review_patch.py` tests that unfamiliar native auth methods, route parsing, duplicate routes, ambiguous HTTP handlers and unsafe staging paths fail closed; it also confirms the original server file remains byte-for-byte untouched.


## Installed native browser authorization verified — Caddy remains a deployment blocker (November 6, 2026)

The user provided a read-only source inspection of the installed `adhd_assistant/server.py`:

- `_local()` checks the `X-ADHD-Local-Token` header using `hmac.compare_digest` against the server's private local token.
- When `Origin` is present, its hostname must be loopback and its port must equal the native server's bound port.
- `Host` must also resolve to `127.0.0.1`, `localhost`, or `::1`.
- `do_GET` uses the exact source idiom `url=urlsplit(self.path);path=url.path;params=parse_qs(url.query)`, not the earlier fixture's `path=urlsplit(self.path).path`.

`prepare-native-review-patch.py` now supports both AST-verified URL idioms without changing `_local()`. It reports flags for the local-token guard, loopback Host restriction, loopback Origin restriction and **always states that Caddy proxy behavior and browser writes are not verified**. The test fixture mirrors the installed source, including semicolon-separated statements, and exercises malformed or ambiguous path parsing.

**Do not install the browser review page or enable write routes yet.** The user views ADHD Assistant through an existing HTTPS Caddy reverse proxy, rather than visiting the native `127.0.0.1:8765` server directly. A browser POST from that public-facing local-network origin may be rejected by native `_local()` if Caddy forwards `Origin` unchanged; forwarding a loopback `Host` to satisfy native checks can also conflict with the staged route's stricter Origin/Host comparison. Both native authorization **and** the existing Caddy Basic Auth must remain effective. We must inspect proxy header handling read-only and test a disposable HTTP stack before any deployment. Do **not** blindly strip Origin, disable the local token check, open a new port, or relax loopback restrictions to make the new page work.

The existing Pixel Pals → sidecar handoff bridge is unaffected by this issue; it is separate from the native browser inbox.


## Read-only Unraid source preflight without another screenshot (November 6, 2026)

`tools/adhd-v02/run-native-review-preflight.sh` is available in GitHub beta. It downloads only the reviewed patcher and inbox module sources from the pinned GitHub commit, runs a **new disposable Python container with `--network none`, `--read-only`, dropped capabilities and no `/data` mount**, and parses the existing `server.py` code read-only. It never installs routes, imports user tasks, changes Caddy or starts a new listener. When the existing `adhd-assistant-lan` Caddy container is available, it also checks `/etc/caddy/Caddyfile` for the **presence** of a few reverse-proxy, authentication and header-rewrite keywords. It prints only yes/no markers, never the Caddyfile, authentication hashes or header values. Keyword detection is advisory and does not prove the proxy's actual authorization behavior.

The report includes `native_auth_contract`, confirming whether the code contains the local token, loopback Host restriction and loopback Origin restriction. It explicitly marks `caddy_proxy_behavior_verified: false`, `browser_write_routes_ready_for_deployment: false` and `live_installation_authorized: false`. Source compatibility is **not** proof that the remote browser origin will work through Caddy.

On a read-only preflight failure, leave all running apps untouched; the next step is source review, not force-applying a patch. On a passing preflight, the next step is a **redacted Caddy header and authentication inspection**, not installation. Do not disclose the native session token, Caddy Basic Auth hashes, private task titles or memory contents in diagnostic output.


## Offline Caddy route-security audit (November 6, 2026)

The first user-run source preflight confirmed that the installed native server's route
parsing is compatible and its local authorization still requires the private
X-ADHD-Local-Token, loopback Host, and loopback Origin. The prior Caddy check
detected Basic Auth and Host/Origin-rewrite keywords, but **did not detect**
the native token forwarding header. These keyword observations were not a
runtime authentication test and did not authorize installing the inbox.

The new beta source audit lives at
`tools/adhd-v02/audit_native_review_proxy.py` with its 12 synthetic regression
tests and the operator wrapper `tools/adhd-v02/run-native-proxy-audit.sh`.
The wrapper asks the existing Caddy container to **adapt its current
configuration into JSON** and streams it, without recording or printing it,
into a disposable Python container with no network, no user-data mounts,
dropped capabilities, a read-only root filesystem, and no image pull.
Only the boolean **structure** of the four native inbox routes is printed:
whether the expected native loopback upstream is targeted; whether basic
authentication is ordered ahead of reverse proxying; whether Host, Origin and
local-token header rewrites are configured; and whether there is ambiguous
dispatch. Unknown matchers, alternative routes, middleware, and missing
protection are flagged as unverified. The checker **never outputs configured
header values, Caddy Basic Auth hashes, user names, private hostnames or
upstream addresses**.

On the Unraid host, this read-only command runs the wrapper (no restart,
install, new port, change to Caddy, or access to the user's task database):

```bash
bash -o pipefail -c 'curl -fsSL https://raw.githubusercontent.com/nyteghost/buddy-bot-room/24b295dfa8596b88f737b57f1aba301bccb292d2/tools/adhd-v02/run-native-proxy-audit.sh | bash'
```

The hostname defaults to the currently observed Tailscale HTTPS name.
To use a different Caddy hostname, save the wrapper locally and pass only the
hostname as its first argument. **Do not paste Caddy's adapted JSON into chat
or a terminal transcript**: it may contain private password hashes and tokens.
The wrapper intentionally suppresses Caddy adapter stderr and does not log or
save raw JSON. Its analysis can report false negatives when Caddy's route
structure is more complex than the small supported set; it must never be used
to automatically relax an existing authorization policy.

**Static structure is not live verification.** In particular, the audit does
not verify the actual token value, Basic Auth coverage on the live request path,
origin-rewrite safety, header injection behavior, proxy reachability, or
browser request/CSRF behavior. Every report explicitly contains
`live_installation_authorized: false`. Do not inject the native session
token into Caddy or install the review UI merely because some flags are true.

Next: review the redacted structure result, select an explicitly scoped,
secret-safe Caddy integration, and test authenticated and unauthenticated
requests through an isolated HTTP/Caddy fixture. Only after a full
backup/restore rehearsal and owner approval should a controlled, rollback-
capable deployment to the existing LAN/Tailscale address be considered.

### Additional browser write-route defense

The staged native inbox now **requires** `Sec-Fetch-Site: same-origin`
for POST review and import requests, not merely accepting that header when
present. This is an additional CSRF safeguard for the existing Caddy proxy,
which may rewrite the upstream `Origin` and `Host` to loopback. A browser
request with missing, cross-site, same-site or `none` fetch metadata is
rejected even if the proxy makes its Origin and Host appear to match.
The actual Origin/Host check, custom review header, JSON-only body, installed
native local token and Caddy Basic Auth remain independently required.
The strict check targets modern HTTPS browsers; unknown clients may be
rejected rather than silently weakening the write permission. These are
candidate routes only: live browser compatibility remains unverified.
GitHub CI now runs both the synthetic proxy audit and native HTTP security
tests. The live Unraid server, Caddy and native database remain unchanged.
