<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Application rules
- Linux and Assistant room movement uses one shared browser-only station choreography and activity renderer, so both modes stay visually in sync without invoking machine actions.
- Keep the current browser chat separate from named browser-only saved snapshots when signed out; optional Google sign-in syncs saved discussions and settings to the account.
- Run one streamed model call per character turn through `/api/chat`; browser orchestration controls rounds and cancellation, keeping each server request short.
- Keep agent identities and mode context rules in a shared browser-safe module; model prompts and gateway clients stay server-only.
- Keep character themes mutually exclusive in one browser-persisted store and shared persona catalog, preserving legacy preferences so sprites, names, prompts and voices stay consistent.
- Override AI SDK stream error logging to treat AbortError as cancellation, and return 499 at server boundaries; genuine failures remain reported so Stop does not trigger the runtime crash overlay.
- Compose chat surfaces with the installed AI Elements primitives and use semantic CSS tokens for the pixel-room visual theme.
- Draw character forms from browser-safe native pixel grids with semantic material palettes so visual detail is independent of display size.
- Store character mode on new replies and use one cancellable replay stream at a time; disable manual replay during discussion to prevent overlapping voices.
- Free engines (user keys, in-browser WebGPU, or Auto = keys first with per-turn WebGPU fallback when a key fails before any text) are chosen in a browser-persisted engine store; keys travel per request and are never stored server-side, and the local engine fetches its prompt from /api/chat (preparePrompt) so prompts stay server-authored.
- Signed-in users (Google) sync engine choice, theme and saved discussions to owner-only tables via requireSupabaseAuth server functions; free-engine keys are AES-GCM encrypted server-side with SETTINGS_ENCRYPTION_KEY. Signed-out users keep browser-only storage, so login stays optional.
- Linux Mode's machine access (PTY terminal, system stats, notes, file listing, self-update) lives only in Tauri commands in src-tauri/src/main.rs, wrapped by src/lib/linux.ts; pals receive this as read-only `linuxContext` text and every command/note they propose needs a user click — so the web build stays safe and nothing runs unattended.
