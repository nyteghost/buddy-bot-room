# Remote Ollama routing and status beta

## Causes and fixes

- The sidebar read the browser-only `ollamaUrl` and fetched `/api/tags` directly. It did not use the working server `OLLAMA_URL`, and omitted the Local AI server mode. The new shared, authenticated `/api/ollama-health` polls only the configured server endpoint and exposes no address, credentials or application hardware. Sidebar states are Checking, Connected, Offline, Configuration required and Model unavailable.
- Ollama and Auto (keys + Ollama) called the browser-native stream and preloader even with a healthy backend connection. All backend modes now use the server's existing `/api/chat` Ollama provider. Automatic transport prefers a configured backend; browser-direct is still available explicitly, and remains the compatibility fallback when no backend is configured. A Checking backend does not trigger speculative browser probes. Direct warm-up/model discovery only runs on the direct path.
- Browser-direct `ollamaModel`, shared `localChat`, automatic task choices and Pal overrides were separate sources of selection. Backend modes now share `pickModel`: an explicit Pal override wins, then the shared task/default choice. Legacy direct URL/model settings are retained for direct connections. Connect saves both default aliases for consistency. New settings default to installed-model automatic selection, and automatic general chat prefers installed `qwen3.5:9b` when usable. Existing explicit selections are not migrated or overwritten.
- Missing explicit models used to pass to inference and return an Ollama 404. Chat now checks installed names first and returns `ollama-model` with a repair explanation. Settings lists missing task/Pal assignments and offers installed replacements requiring an explicit click. Default replacement does not alter Pal assignments. Explicit Pal assignments also disable silent memory fallback to a different model. Optional catalog downloads are labeled separately from installed models.
- Remote hardware inherited the application server's CPU/RAM. Responses now distinguish application hardware from the processing host. Unknown remote CPU/RAM remain unknown. Manually configured VRAM is labeled manual, observed loaded-model memory is labeled a lower bound, and no RTX model is inferred from VRAM. Unknown remote capacity does not reject installed auto selections using Unraid's hardware budget.
- Local-Only previously relied on backend rejection after the browser tried cloud rotation and could suggest blocked keys as fallback. Turn dispatch now selects the backend local chain first under this policy. A local chain itself contains no cloud providers. Backend guards remain authoritative. Missing-model and Local-Only errors are kept distinct, and JSON error bodies are reduced to their readable message instead of accumulated provider chains.

## Using the fixed beta

Your working network, UFW rule, Ollama systemd service and Docker `OLLAMA_URL` do not need changes.

1. Update the existing Compose Manager project, then reload Pixel Pals.
2. Open **More → Settings → Connect Ollama**. The tested address is saved in the existing settings store; the confirmation states that the backend reaches the remote host. No redeploy or model download is performed by Connect.
3. Choose `qwen3.5:9b` in **Default installed model** if desired. Review any Model unavailable rows individually; changing a default never deletes an intentional Pal assignment.
4. In AI engine settings, Local AI, Ollama on my computer and Auto (keys + Ollama) use the configured backend. For the last two, leave **Ollama connection path → Automatic — prefer Pixel Pals backend**, or explicitly select the backend option. The browser-direct option is for installations that intentionally need it.
5. For a remote RTX 3080 with 10 GB, optionally enter **Ollama machine's GPU memory (GB) = 10** in advanced Local AI settings. This is labeled manually configured, not detected. Do not enter Unraid's RAM as the PC's RAM. The app cannot detect the remote GPU's name from the standard tags API.

## Existing Unraid Compose Manager installation

For project **pixelpals**, container **buddy-bot-room**, using `ghcr.io/nyteghost/buddy-bot-room:beta`:

1. Open Unraid's Docker page and the Compose Manager controls for **pixelpals**.
2. Run **Compose Pull** and wait for the beta image download to finish.
3. Run **Compose Up** to recreate with that image, preserving the existing volumes, port mapping and `.env`.
4. Reload `http://10.200.1.30:8090` (hard refresh if needed). Confirm the sidebar build revision matches the verified beta commit.
5. Check Local AI status, then test a short chat in each mode and review any missing Pal assignments. The PC must remain awake.

Do not delete the Compose project, remove volumes, switch to `:latest`, edit firewall/service settings, or change the working `.env` address for this fix. Keep the usual appdata backup before any update.

## Validation and limits

Unit coverage includes healthy/offline/configuration states, server-vs-direct policy, owner/guest authorization, missing models, explicit override repair, remote hardware provenance, installed preferred selection, Local-Only dispatch, and Connect persistence. Browser smoke uses a localhost-only protocol fixture with static completions to exercise authenticated backend streaming, model rejection, cloud blocking, mobile sends in all three modes, and the absence of direct browser Ollama traffic. No tests contact the owner's PC or change its working network.

The standard Ollama API does not establish the remote GPU's product name or total physical memory. There is no automatic model download or overwrite of saved assignments. Auto mode still uses configured free keys first when Local-Only is off. The repository's full lint is not clean: the unchanged starting beta has 10,515 errors and 39 warnings, mainly Prettier formatting. Changed-file checks are also run separately so this work does not require an unrelated repository-wide reformat.
