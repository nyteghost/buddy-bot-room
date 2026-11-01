# Connect Ollama from Pixel Pals

Open **More → Settings → Connect Ollama**, at the top of Settings. The same connector appears in AI engine settings for Local AI and browser-direct Ollama modes. It remains visible if Ollama is unconfigured or unreachable. This replaces the old unconfigured Local AI message that directed users to Portainer.

1. Enter the Ollama PC's LAN base address, such as `http://192.168.1.50:11434`. `localhost` means the Pixel Pals container when using this connector. Common `/v1` and `/api/tags` suffixes are removed automatically.
2. Choose **Test connection**. The server makes one read-only GET to that address's `/api/tags`. Testing does not save anything or switch engines. Select an installed local model; cloud-tagged models are excluded.
3. Choose **Save and connect**. Pixel Pals rechecks the selected model, saves `OLLAMA_URL` using the existing in-app settings store, then selects the server-proxied Local AI engine and that default model in the browser. Automatic task routing is turned off for this explicit choice; advanced per-Pal model overrides are retained. Existing account sync continues to handle browser engine preferences. There is no Docker redeploy or model download.

The Test and Save buttons are always visible to the owner. Save is disabled until an address has passed a test and an installed model is selected; the adjacent text explains why. Changing the address invalidates its model list and cancels/ignores pending replies. Cancel stops browser requests; a save already accepted by the server may have completed. Failed network/model checks do not replace the previous working address. Storage failures are reported separately and do not switch the browser's engine.

Expand **PC not reachable? CachyOS / Fish setup** for copyable commands that add an Ollama systemd service override and restart Ollama. Run them on the PC yourself. The web app does not change the PC's services/firewall, scan the LAN or execute shell commands. Keep port 11434 on the trusted network and keep the PC awake. No browser CORS wildcard is necessary for the server-proxied connection. Other installation types, such as Docker or a manually launched Ollama process, need their own host binding configuration.

Legacy browser-direct fields remain for advanced use and continue saving as typed; they are labeled accordingly. The guided connector is recommended when Pixel Pals runs on Unraid and is used from a phone. Advanced Settings fields remain available, including GPU/RAM hints and the separate Local-Only AI policy switch. This flow does not change that global policy or delete cloud keys.

## Boundaries and testing

`/api/ollama-connect` is owner-only, does not return secrets and only contacts the explicitly entered tags endpoint. Credential-bearing/query URLs and non-HTTP schemes are rejected; redirects are refused, responses are capped at 200 KB and calls have a six-second abort budget. It sends no credentials, prompts or recipe text, and makes no inference/pull/delete requests. The selected address is persisted in the existing `app-settings.json`; existing in-app precedence and fallback-to-stack behavior are unchanged.

Tests cover owner authorization, URL validation, duplicate/cloud model filtering, cancellation, stale replies, no save on Test or failed model checks, and persistence failures. Browser smoke uses `tools/smoke/ollama.mjs`, a localhost-only read-only fixture, to check the real server test/save path and browser engine selection. Start that fixture before manually running `tools/smoke/smoke.mjs`; CI starts it in the app startup step. Real PC/Unraid firewall and service connectivity still require the owner's deployment.

Ollama's official network/service configuration: https://docs.ollama.com/faq#how-do-i-configure-ollama-server

## Remote routing/status follow-up

The sidebar and proxied modes now share authenticated backend health. Local AI, Ollama and Auto use the shared task/default model when the backend path is active; legacy direct URL/model fields are retained for explicit browser-direct operation. Missing task/Pal models have individual repair controls, and Local-Only mode bypasses cloud rotation. See [REMOTE_OLLAMA_BETA.md](REMOTE_OLLAMA_BETA.md) for root causes, hardware provenance, validation and existing Compose Manager update instructions.
