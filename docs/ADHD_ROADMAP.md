# Pixel Pals ADHD-first roadmap

**Working branch:** beta. **Stable branch:** main remains untouched until the owner approves promotion.
**Packaging:** Tauri remains on hold. All opt-in AI task assistance is local-only, free/offline fallback first.

## Delivered before this roadmap expansion
- My Pals + Pal Lounge (all original conversation modes and histories retained)
- Focus Assist / Just Start 2.1: numbered task-specific tiny steps, local Ollama or safe fallback
- Focus Together: selected Pal, optional check-ins, breaks, explicit checkpoint
- Today / Tomorrow / Day After views and Smart Brain Dump with timed reminders
- Living Pal Room, Calm / Playful, Living Task Board
- Tiny Wins celebrations, without streak or pressure

## Beta roadmap expansion (October 2026)
| Theme | Scope | State |
|---|---|---|
| Pick for Me | One suggestion using urgency, importance, available time and self-reported energy; no automatic task changes | Beta implementation |
| ADHD Home | "One thing at a time" focus card inside Today with one-click Just Start and reduced clutter | Beta implementation |
| Brain Dump 2.0 | Duplicate detection, readable category hints, Today/Tomorrow/Day After planning independent of reminders | Beta implementation |
| Visual time & transitions | Optional gentle 2-minute pause; full focus timer remains available in /today | Partial |
| Daily planning | Morning and shutdown notes stored intentionally in the local browser for that day | Beta implementation |
| Tiny Quests | Optional local session-only decoration rewards based on explicitly marked steps | Beta implementation |
| Real AI body doubling | Owner-triggered local-only sample artifact beside the task, with safe offline fallback; never reads or edits outside apps | Partial; approved integrations remain future work |
| Mail refresh | Explainable subject-only follow-up hints, opt-in review in Brain Dump, no automatic mail changes or sends | Responsive folder/list/reader beta implemented; optional local body summaries remain future work |
| Pal personality & memory | Existing themed roles, Pal-specific memories, project notes, and saved checkpoints | Focus checkpoint → reviewed Second Brain note implemented; further continuity planned |
| Reliability & accessibility | Existing local AI safeguards, fallback paths, reduced-motion support, tests, release gates | Ongoing |

## Remaining longer-term work
1. **Connected work with explicit permission and undo**: fine-grained scopes per app and file, preview each proposed write, confirmation, audit trail, safe undo, and no unprompted actions.
2. **Mail 2.0**: responsive navigation is implemented in beta; optional local-only message summaries still require mailbox permission review.
3. **More useful personal continuity**: named reusable project context with opt-in local saving, easy review/deletion and no private information sent to cloud AI by default.
4. **Visual time blindness support**: configurable visual time horizon, quieter transitions and notifications only after an explicit choice.
5. **Accessibility review**: keyboard, screen reader, mobile focus and responsive workspace testing.
6. **Pal Room storytelling**: additional themed scene changes; keep decorations and quests opt-in and non-punitive.
7. **Technical review**: model failure recovery, offline loading and caching, permission boundaries and external integrations.

## Focus Food (November beta)

Finished-recipe nutrition and Macro Check are implemented: explicit source facts, confirmed portion math, user-chosen meal targets, Yes/No with reasons, and ingredient alternatives after a No. Missing facts remain unknown; no AI nutrition estimates or automatic recipe substitutions. See [FOCUS_FOOD_MACROS.md](FOCUS_FOOD_MACROS.md).

Single-recipe cooking is implemented: public recipe-link import, paste/manual fallback, optional local-only verbatim organization, mandatory review, ingredient checklist, one original instruction at a time, offline stuck help, optional preparation coaching, browser-local recovery and one named timer. Source cooking values stay unchanged; meal-prep portion notes do not scale quantities. See [FOCUS_FOOD.md](FOCUS_FOOD.md) for boundaries and device checks. Multiple-recipe weekly planning, combined groceries, recipe scaling and Obsidian recipe export remain future work.

Local AI setup now has a visible **Connect Ollama** form in Settings and the relevant AI engine menus: test from the server, choose an installed model, then Save and connect. Failed tests preserve the previous connection. See [OLLAMA_CONNECT.md](OLLAMA_CONNECT.md).

## Acceptance checks
- Unit tests and production build pass.
- Browser smoke tests cover Pick for Me / Today, Brain Dump categorization and day placement, the Pal quest, and owner-initiated sample work.
- No changes to main without owner testing.
- Never characterize mock or animated Pal work as actual access to screens, files, email or tools.


## Mobile UI 3.0 / continuity beta (October 31)

See [BETA_MOBILE_3.md](BETA_MOBILE_3.md) for release scope and owner checks, and [SECOND_BRAIN.md](SECOND_BRAIN.md) for current notebook behavior. Shared mobile controls, tool navigation, responsive Mail panes, content-revision conflict checks, and a reviewable Focus Assist notebook summary are implemented. Remaining longer-term items above stay open; a successful automated build does not replace real Unraid, iOS or mailbox testing.


## Proposed next priorities (not yet scheduled)

1. **Where was I?** Home now offers one-tap recovery of an explicitly saved Focus Assist task and next tiny step. Broader draft/workspace recovery remains proposed.
2. **I'm stuck**: implemented in Just Start and Focus Assist, with explicit Smaller / Explain / Sample choices, instant offline help and optional local-only refinement.
3. **Recovery shelf**: discover unfinished drafts and recover recently deleted tasks/notes.
4. **Memory review**: inspect each Pal's remembered context, correct stale facts, and choose privacy boundaries.
5. **Richer contextual Pal reactions**: greetings and celebrations tied to explicit activity, without claiming autonomous work. The beta animation pass supplies the pose foundation.

Prefer the first two to additional dashboard cards: they directly help task initiation. These are proposals, separate from delivered beta features.


## Security and Home resume follow-up

- Patched the two critical dependency findings with compatible pins for DOMPurify and shell-quote; beta publishing and CI now block on critical audit findings. Remaining lower-severity findings still need triage; see [SECURITY_BETA.md](SECURITY_BETA.md).
- Home shows an explicitly saved Focus Assist checkpoint with its task, completed-step count and next tiny step. Resume is user-triggered; dismissing the checkpoint does not remove tasks, notes, or drafts. No model call or automatic chat capture is involved.


## Stuck help and security triage

- I'm stuck offers three choices in Just Start and Focus Assist. Opening the choices does not call a model. A smaller step is applied only after the user chooses Use this smaller step; step number and completed progress remain intact. Explanation and sample text are previews only.
- Local inference has a 15-second budget for this feature and supports cancellation. User task/step data never falls back to a cloud provider.
- Security updates reduce the full audit from 35 findings to 4 (three moderate, one low), with zero high or critical findings. The publishing gate now blocks high and critical findings. The remaining dependency paths and follow-up work are recorded in SECURITY_BETA.md.
- Real Unraid mount/restore and iPhone interaction checks still require the owner's devices. Automated mobile/browser checks use isolated data and do not validate the owner's deployment.

## Restaurant meal comparisons and shared targets

Implemented: separate Restaurant macros view, online menu search using configured SearXNG, official restaurant starting links, bounded public-HTTPS menu import, paste/manual nutrition review, Yes/No comparisons and browser-local saved orders. Shared meal targets appear at the top of Focus Food, with an optional daily-plan split helper. Cooking state stays separate. See [restaurant guide](FOCUS_FOOD_RESTAURANTS.md) for supported formats, privacy, tests and limitations.

Implemented: Focus Food recipe discovery → select result → original recipe import → review → Pal cook-along, reusing existing search and recipe-import safeguards. See [Focus Food guide](FOCUS_FOOD.md).

Implemented: reviewed protein-powder additions from the user’s label, weighed-dose previews, optional protein-shortfall calculation, nutrition provenance and reversible ingredient changes. See [Focus Food guide](FOCUS_FOOD.md).

Implemented: recipe-aware Local AI step chat with current-step context, recent conversation, one-tap return, saved recipe-local history, cancellation and unchanged cooking progress/timers. See [Focus Food guide](FOCUS_FOOD.md).
