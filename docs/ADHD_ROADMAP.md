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
| Mail refresh | Explainable subject-only follow-up hints, opt-in review in Brain Dump, no automatic mail changes or sends | Partial; three-pane responsive redesign and body summaries remain future work |
| Pal personality & memory | Existing themed roles, Pal-specific memories, project notes, and saved checkpoints | Existing; further continuity enhancements planned |
| Reliability & accessibility | Existing local AI safeguards, fallback paths, reduced-motion support, tests, release gates | Ongoing |

## Remaining longer-term work
1. **Connected work with explicit permission and undo**: fine-grained scopes per app and file, preview each proposed write, confirmation, audit trail, safe undo, and no unprompted actions.
2. **Mail 2.0 layout**: responsive three-pane navigation and optional local-only message summaries after mailbox permission review.
3. **More useful personal continuity**: named reusable project context with opt-in local saving, easy review/deletion and no private information sent to cloud AI by default.
4. **Visual time blindness support**: configurable visual time horizon, quieter transitions and notifications only after an explicit choice.
5. **Accessibility review**: keyboard, screen reader, mobile focus and responsive workspace testing.
6. **Pal Room storytelling**: additional themed scene changes; keep decorations and quests opt-in and non-punitive.
7. **Technical review**: model failure recovery, offline loading and caching, permission boundaries and external integrations.

## Acceptance checks
- Unit tests and production build pass.
- Browser smoke tests cover Pick for Me / Today, Brain Dump categorization and day placement, the Pal quest, and owner-initiated sample work.
- No changes to main without owner testing.
- Never characterize mock or animated Pal work as actual access to screens, files, email or tools.
