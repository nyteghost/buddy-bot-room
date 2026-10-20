# Removing Lovable, step by step

Goal: edit this app with Claude and build it with a plain Vite config, without Lovable. Each step is pushed on its own and checked in CI and on the running app before the next one. Self-hosted Docker builds already skip Lovable Cloud (`BUDDY_SELF_HOSTED=1`).

| # | Step | Risk | Status |
|---|------|------|--------|
| 1 | Delete code nothing imports (`lib/lovable-error-reporting.ts`) | none | done |
| 2 | Drop the Lovable Cloud Google sign-in in `account-button.tsx` and `integrations/lovable/index.ts` (self-hosted already uses its own sign-in) | low | todo |
| 3 | Drop `integrations/lovable/appUserConnector.ts` and the Lovable-connector calendar paths (`calendar.functions.ts`, `api/oauth/google/return.ts`, popup in `work-tools.tsx`); the self-hosted Google Calendar flow replaces them | medium | todo |
| 4 | Drop the Lovable AI gateway helpers (`lib/ai/*`, used by `chat.server.ts`) and `LOVABLE_API_KEY` speech/transcribe paths | medium | todo |
| 5 | Replace `@lovable.dev/vite-tanstack-config` in `vite.config.ts` with the plain plugins it wraps | highest | todo |
| 6 | Remove the `.lovable/` folder, Lovable lines in README/AGENTS.md, and the npm packages | low | todo |

Do step 5 last: it changes how everything builds, so it needs a real build check on the server.
