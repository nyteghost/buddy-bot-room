# Project Control Auto — isolated Unraid installer

This folder holds a one-command installation of Project Control Auto v1.0.
It was published on the isolated `project-control-auto-v1` branch of
`nyteghost/buddy-bot-room`; it does **not** change Pixel Pals `main` or `beta`.

## Install from the Unraid root terminal

```bash
bash -c 'set -e; f=$(mktemp); trap "rm -f $f" EXIT; curl -fsSL https://raw.githubusercontent.com/nyteghost/buddy-bot-room/project-control-auto-v1/project-control-installer/install-unraid.sh -o "$f"; bash "$f"'
```

The installer fetches seven versioned payload parts over HTTPS, checks the
SHA-256 of the reconstructed tarball before extracting, and **refuses to overwrite**
an existing `/mnt/user/appdata/project-control-auto` folder or container.
The installer prompts for a *fine-grained read-only GitHub token* scoped only to
the six project repositories, and detects the host's Tailscale IPv4 (or asks for
one). **Never paste credentials in GitHub issues, ChatGPT, or a public terminal log.**

The installer builds and launches one isolated Docker container,
`project-control-auto`, listening on port `8788`. It performs an authenticated
HTTP health check, then prints the dashboard URL and locally generated password.
The existing Pixel Pals container on port `8090` remains unchanged.

Current automated collection: GitHub commits, branches, Actions metadata,
issues, pull requests, and readable roadmap checkboxes every 15 minutes.
Obsidian notes and Unraid host health require optional setup; the existing
@Sites dashboard is **not** edited. A passing CI build is not proof of deployment.

**Not verified here:** Live installation on the user's Unraid server. The package
passed ten Python unit/integration tests, shell syntax verification, and remote
payload SHA-256 verification, but the host must run the installer to establish
operational success.

To inspect status after installation:
```bash
docker ps -a --filter name=project-control-auto
docker logs --tail=60 project-control-auto
```

Do not point the service at public interfaces; the installer rejects
`0.0.0.0`. Use a trusted private Tailscale address, and keep secrets local.
