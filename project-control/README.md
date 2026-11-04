# Project Control Auto — isolated Unraid installer

This lives **only** on the `project-control-auto-v1` branch of `nyteghost/buddy-bot-room`. Nothing in the existing Pixel Pals `main` or `beta` branches was altered.

## Single-line installation (Unraid Terminal, root)

The script is downloaded from GitHub over HTTPS and **verified against its pinned SHA-256** before execution:

```bash
bash -c 'set -e; f=$(mktemp); trap "rm -f \"$f\"" EXIT; curl --proto "=https" --tlsv1.2 -fsSL https://raw.githubusercontent.com/nyteghost/buddy-bot-room/project-control-auto-v1/project-control/install-unraid.sh -o "$f"; echo "09c4194fe3cbff47f7eb03dd8af1daa9c24e6d65daffeebad0dde91489a5c477  $f" | sha256sum -c -; bash "$f"'
```

The script downloads five public, checksum-verified package segments, reconstructs the application, asks **interactively** for a fine-grained **read-only** GitHub token (needed for private repositories), detects your Tailscale IPv4 or asks for it, creates only `/mnt/user/appdata/project-control-auto`, builds a dedicated Docker image, starts only `project-control-auto`, and checks authenticated HTTP health before reporting success. It refuses an existing install rather than overwriting it.

## Open dashboard

After successful installation, the terminal prints the full `http://TAILSCALE_IP:8788` URL, `admin` username, and randomly generated dashboard password. Do not paste the GitHub token or dashboard password into ChatGPT or a public issue.

```bash
docker logs --tail=80 project-control-auto
docker ps --filter name=project-control-auto
```

## What runs automatically

The collector reads configured GitHub repositories, preferred branches, commits, GitHub Actions, job conclusions, pull requests, issues, releases, and checked task lists in roadmaps/READMEs every 15 minutes. It **never writes to GitHub**. Its dashboard has an overview, roadmap, CI, testing, deployment, and manually editable notes. Successful CI is *not* treated as proof of deployment.

The GitHub token should have repository access **only to the needed projects**, with Contents, Actions, Issues and Pull requests read-only, and Metadata read automatically. Credentials are stored under the new app directory in permission-restricted secret files and never baked into the image.

## Existing @Sites dashboard and Unraid/Obsidian

This is an **independent dashboard**, not a replacement for or automatic edit to the existing @Sites Site. Site cross-origin integration requires a suitable secure HTTPS/Tailscale configuration and a user-approved Site change. Do not expose port 8788 on 0.0.0.0 or the public internet.

The service supports an optional read-only Obsidian vault mount (disabled by default), and can consume a local host snapshot JSON file. Host monitoring is **not live by default**; it needs explicit additional setup. It does not inspect or change the running Pixel Pals, ShowPilot, Vibelight, Vibebeam, BMS, RTP, Unraid, or Tailscale services.

## Verification

- Local source: 10 unit/integration tests passed; Python syntax and Bash syntax passed.
- Installer: successfully simulated on a mock Unraid environment with checksum verification, interactive credential prompt, directory setup, and health-test flow. A mock run is **not** a real host installation.
- GitHub Actions: `.github/workflows/project-control-auto-ci.yml` verifies the combined package SHA-256, Python/Bash syntax, Docker image build, authenticated HTTP health, and rejection of unauthenticated requests.
- Real Unraid deployment: **not verified** until you run the installer on your own host.

The complete original source and testing files are separately downloadable as the `project-control-auto-v1.0.zip` artifact in ChatGPT.
