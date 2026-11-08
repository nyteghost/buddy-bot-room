# One-site browser access for ADHD Assistant Photo Beta

## Status and verified environment

The owner approved a direct browser path on **CachyOS and iPhone**. The beta service is already healthy on Unraid loopback at `127.0.0.1:18767`. Pixel Pals, production ADHD Assistant and their bridge are healthy. The existing `adhd-assistant-lan` Caddy v2.11.8 is running on host-network `*:18765` and has an authenticated existing production ADHD route with upstream Host/Origin rewriting. Its certificate issuer is **Caddy's internal CA** and trust on either client is **not yet verified**. Owner verified port **18768** was free. The existing AI model `qwen3-vl:4b` is installed on the gaming PC.

**This beta gateway is LAN-only at first.** It does not automatically provide remote cellular access; remote use requires a separately verified private VPN / Tailscale path.

## Additional beta route

The installer `tools/adhd-v02/install-adhd-beta-browser-gateway.sh` adds one **separately authenticated HTTPS** site:

```text
CachyOS / iPhone Safari
        ↓ HTTPS, Caddy internal certificate, Basic Authentication
https://10.200.1.30:18768
        ↓ existing Caddy container (bind 10.200.1.30, not 0.0.0.0)
http://127.0.0.1:18767
        ↓ existing beta container
ADHD Assistant — Do It With Me Photo Guidance
        ↓ opt-in image request to approved gaming-PC LAN IP
Ollama qwen3-vl:4b
```

The beta backend stays on loopback. The installer verifies live Caddy layout, beta health, production containers and ports, then asks for a new **unique** username/password, hashes the password through Caddy's stdin (password never appears in the command line), and writes a candidate Caddyfile. It verifies `caddy adapt` and `caddy validate` against the *existing Caddy binary and same relative file directory* before applying. It requires explicitly typing **`ADD ADHD HTTPS BETA`**, saves a timestamped **private** backup of the original Caddyfile, atomically installs the candidate, and hot-reloads Caddy (no restart). If reload or unauthenticated route verification fails, the script restores the original file and reloads the original configuration.

The site uses `tls internal`, `basic_auth` before every reverse-proxied request, blocks browser requests from other Origin values and blocks `/bridge/v1/*` externally. It forwards required upstream Host and Origin to the localhost-only native server, and removes `Authorization` upstream. **Never expose or forward port 18767 publicly**, and do not disable the native local-token check.

## Installation

Read the [installer](../tools/adhd-v02/install-adhd-beta-browser-gateway.sh) before running. From **Unraid Terminal**, download an **exact pinned, reviewed commit**, run `bash -n`, then run the installer. Its interactive prompts are not suitable for `curl | bash`. Never paste the chosen password in ChatGPT or GitHub.

### After installer reports success

1. First verify the **401 Unauthorized** response for an unauthenticated request. From Unraid:

   ```bash
   curl -ksS --max-time 5 -o /dev/null -w '%{http_code}\n' \
     https://10.200.1.30:18768/api/bootstrap
   ```

   Expect `401`. The `-k` above is ONLY for a local **negative auth test**. **Do not** turn off certificate verification in normal browser use.

2. Verify the public root CA certificate path in the existing Caddy container (do NOT access/export any private key):

   ```bash
   docker exec adhd-assistant-lan test -f /data/caddy/pki/authorities/local/root.crt
   ```

   From **CachyOS Konsole**, obtain the public certificate, using your authenticated SSH access:

   ```bash
   scp root@10.200.1.30:/mnt/user/appdata/adhd-assistant/lan-proxy/data/caddy/pki/authorities/local/root.crt \
     ~/Downloads/adhd-caddy-local-root.crt
   ```

   Check the file with `openssl x509 -in ~/Downloads/adhd-caddy-local-root.crt -noout -subject -fingerprint -sha256`. Verify its fingerprint against a read-only check on Unraid or the Caddy container using `openssl` before trusting it. **Only the public `.crt` file should be transferred. Do not share `root.key` or other private keys.**

3. On **CachyOS**, trust the root CA only if you explicitly accept the implications (a trusted CA can issue other TLS certificates). You may import it into your specific browser's certificate authorities, or use the operating-system's certificate store after verifying it is your own Caddy CA. Browser-specific trust behavior varies; **do not bypass certificate warnings**.

4. On **iPhone**, securely transfer the same **public** `adhd-caddy-local-root.crt` (e.g., through your private Files/iCloud Drive workflow), open it, install the downloaded profile under **Settings → General → VPN & Device Management**, then enable **Settings → General → About → Certificate Trust Settings → Full Trust** for that root. Only do this for a verified CA certificate you control. Apple instructions: https://support.apple.com/en-us/102390

5. On both devices while connected to the same private LAN, open **https://10.200.1.30:18768**. The browser should show a trusted HTTPS connection and prompt for the beta credentials. Open **Do It With Me**. In **Settings**, select `Local Ollama` and enter **`qwen3-vl:4b`** as the vision model. Test **Start without photo**, then explicitly choose a non-sensitive room photo and select **Analyze photo for tiny steps**. Ask for one smaller step, mark Done, verify calm/no-shame guidance.

## Non-destructive verification and rollback

- The existing Caddy config backup is stored under `/mnt/user/appdata/adhd-assistant/lan-proxy/conf/Caddyfile.before-photo-beta-<UTC timestamp>`. This contains existing production config and may include credential hashes. Never post it publicly.
- On unexpected errors, **do not** run `docker compose down`, stop the existing Caddy, stop `buddy-bot-room`, or delete any SQLite database. If the installer reports a rollback failure, stop and inspect the Caddy state before changing anything.
- No production route, original 18765 listener, Pixel Pals, native ADHD Assistant or bridge should change. Verify they remain healthy after a reload.
- Do not enable access from the public internet merely by forwarding 18768. A separate security review is needed for Tailscale/WAN access, mobile phone on cellular data, rate limiting, and continued certificate/credential protections.
- The early photo beta still does **not** persist companion sessions across reload or implement conversational voice body doubling.

## Testing limitations

Automated Bash syntax / synthetic Caddy structure and redaction checks are necessary but **cannot prove the actual live Caddyfile will validate or reload**, that the iPhone trusts the internal CA, or that the Qwen model yields useful photo guidance. The installer fails closed on unrecognized layouts and prompts; acceptance requires a successful live browser test. No password, credential hash, certificate private key, user photo or app database belongs in GitHub issues or PRs.
