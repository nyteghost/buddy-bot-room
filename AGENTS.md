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
- Keep a single browser-persisted AI SDK UIMessage conversation; no thread routes or server-side transcript storage, to match the chosen history shape.
- Run one streamed model call per character turn through `/api/chat`; browser orchestration controls rounds and cancellation, keeping each server request short.
- Keep agent identities and mode context rules in a shared browser-safe module; model prompts and gateway clients stay server-only.
- Keep normal, Hellraiser and horror character modes mutually exclusive in one browser-persisted store, preserving legacy Hellraiser preferences so character identities never conflict.
- Override AI SDK stream error logging to treat AbortError as cancellation, and return 499 at server boundaries; genuine failures remain reported so Stop does not trigger the runtime crash overlay.
- Compose chat surfaces with the installed AI Elements primitives and use semantic CSS tokens for the pixel-room visual theme.
